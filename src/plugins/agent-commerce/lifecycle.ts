/**
 * @file ERC-8183 Commerce Lifecycle Hooks
 * 
 * Integration between the Stvor transport layer and the commerce state machine.
 * Provides strict validation, recovery, and peer timeout behavior.
 */

import type { IErc8183Job, ICommerceContext } from './types';
import type { StvorTransportManager} from '../../transport/pqc';
import { PayloadHasher } from '../../transport/pqc';
import type { IStvorMessage } from '../../transport/interfaces';
import { ERC8183StateMachine } from './state-machine';
import { SecurityGuard } from '../../core/security';

/**
 * Commerce Event Listener
 * 
 * Watches job state transitions and triggers secure payload delivery.
 */
export interface ICommerceEventListener {
  onJobCreated(job: IErc8183Job): Promise<void>;
  onJobFunded(job: IErc8183Job): Promise<void>;
  onJobSubmitted(job: IErc8183Job): Promise<void>;
  onJobEvaluated(job: IErc8183Job, decision: string): Promise<void>;
}

/**
 * CommerceTransportBridge: Connects job state changes to secure delivery.
 * 
 * Responsibilities:
 *   1. Listen to job state transitions
 *   2. Generate and encrypt payloads appropriate to each state
 *   3. Route payloads through Stvor SDK
 *   4. Verify payload integrity on receipt
 *   5. Recover from offline peers and abort malicious flows
 */
export class CommerceTransportBridge implements ICommerceEventListener {
  private transport: StvorTransportManager;
  private context: ICommerceContext;
  private hasher: PayloadHasher;
  private peerTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private responseWindowMs: number;

  constructor(
    transport: StvorTransportManager,
    context: ICommerceContext,
    responseWindowMs = 15000,
  ) {
    this.transport = transport;
    this.context = context;
    this.hasher = new PayloadHasher();
    this.responseWindowMs = responseWindowMs;

    this.transport.onMessage(async (msg) => {
      await this.handleIncomingMessage(msg);
    });
  }

  async onJobCreated(job: IErc8183Job): Promise<void> {
    console.log(
      `[CommerceTransportBridge] Job created: ${job.jobId} (state: ${job.state})`,
    );
    console.log(
      `  → Awaiting funding before secure payload delivery to provider`,
    );
  }

  async onJobFunded(job: IErc8183Job): Promise<void> {
    console.log(
      `[CommerceTransportBridge] Job funded: ${job.jobId} (amount: ${job.fundedAmount})`,
    );

    const taskPayload = {
      jobId: job.jobId,
      taskDescription: job.taskDescription,
      requiredAmount: job.requiredAmount.toString(),
      clientAgent: job.clientAgent,
      fundedAmount: job.fundedAmount.toString(),
      deadline: Date.now() + 24 * 60 * 60 * 1000,
      metadata: job.metadata,
    };

    const payloadHash = this.hasher.hashPayload(taskPayload);
    job.metadata.taskPayloadHash = payloadHash;
    await this.context.jobStore.save(job);

    console.log(
      `[CommerceTransportBridge] Prepared secure payload (hash: ${payloadHash.substring(0, 16)}...)`,
    );

    try {
      const msgId = await this.transport.sendSecurePayload(
        job.providerAgent,
        job.jobId,
        'job_prompt',
        taskPayload,
      );

      console.log(
        `[CommerceTransportBridge] Sent task specification to provider (msgId: ${msgId})`,
      );

      this.schedulePeerTimeout(
        job.jobId,
        job.providerAgent,
        `Provider did not acknowledge prompt within ${this.responseWindowMs}ms`,
      );
    } catch (error) {
      console.error(
        `[CommerceTransportBridge] Failed to send task: ${error instanceof Error ? error.message : String(error)}`,
      );
      await ERC8183StateMachine.refundJob(
        this.context,
        job.jobId,
        `Transport failure during funding: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async onJobSubmitted(job: IErc8183Job): Promise<void> {
    console.log(
      `[CommerceTransportBridge] Job submitted: ${job.jobId} (hash: ${job.deliverableHash?.substring(0, 16)}...)`,
    );

    if (!job.deliverableHash) {
      console.warn(`[CommerceTransportBridge] No deliverable hash recorded`);
      return;
    }

    console.log(
      `[CommerceTransportBridge] Deliverable attestation recorded for evaluation`,
    );

    this.schedulePeerTimeout(
      job.jobId,
      job.providerAgent,
      `Deliverable not received by evaluator within ${this.responseWindowMs}ms`,
    );
  }

  async onJobEvaluated(job: IErc8183Job, decision: string): Promise<void> {
    console.log(
      `[CommerceTransportBridge] Job evaluated: ${job.jobId} → ${job.state} (decision: ${decision})`,
    );

    this.clearPeerTimeout(job.jobId);

    if (job.completedAt) {
      const duration = job.completedAt - job.createdAt;
      console.log(`  → Cycle time: ${duration}ms`);
    }
  }

  private schedulePeerTimeout(
    jobId: string,
    peerId: string,
    reason: string,
  ): void {
    this.clearPeerTimeout(jobId);
    const timer = setTimeout(async () => {
      console.warn(
        `[RECOVERY-ACTIVE] Peer timeout for job ${jobId} (peer: ${peerId}): ${reason}`,
      );

      const job = await this.context.jobStore.get(jobId);
      if (!job) {
        return;
      }

      if (
        job.state === 'FUNDED' ||
        job.state === 'SUBMITTED' ||
        job.state === 'OPEN'
      ) {
        await ERC8183StateMachine.refundJob(this.context, jobId, reason);
      }
    }, this.responseWindowMs);

    this.peerTimeouts.set(jobId, timer);
  }

  private clearPeerTimeout(jobId: string): void {
    const timeout = this.peerTimeouts.get(jobId);
    if (timeout) {
      clearTimeout(timeout);
      this.peerTimeouts.delete(jobId);
    }
  }

  async handleIncomingMessage(msg: IStvorMessage): Promise<void> {
    try {
      SecurityGuard.assertPayloadSafe(msg.content.data);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : '[SECURITY-ALERT] Malicious payload detected';
      console.error(reason);

      if (msg.content.jobId) {
        await ERC8183StateMachine.abortJob(this.context, msg.content.jobId, reason);
      }
      return;
    }

    const job = await this.context.jobStore.get(msg.content.jobId);
    if (!job) {
      console.warn(
        `[CommerceTransportBridge] Received message for unknown job ${msg.content.jobId}`,
      );
      return;
    }

    this.clearPeerTimeout(msg.content.jobId);

    if (msg.content.type === 'job_prompt') {
      const expectedHash = job.metadata.taskPayloadHash;
      if (expectedHash) {
        const computedHash = this.hasher.hashPayload(msg.content.data);
        if (computedHash !== expectedHash) {
          const alert =
            `[SECURITY-ALERT] HASH_MISMATCH_ALERT for job ${job.jobId}: expected ${expectedHash} received ${computedHash}`;
          console.error(alert);
          await ERC8183StateMachine.abortJob(this.context, job.jobId, alert);
          return;
        }
      }
      console.log(
        `[CommerceTransportBridge] Verified job_prompt payload for job ${job.jobId}`,
      );
    }

    if (msg.content.type === 'job_deliverable') {
      if (!job.deliverableHash) {
        console.warn(
          `[CommerceTransportBridge] Received deliverable for job ${job.jobId} with no recorded hash`,
        );
        return;
      }

      const computedHash = this.hasher.hashPayload(msg.content.data);
      if (computedHash !== job.deliverableHash) {
        const alert =
          `[SECURITY-ALERT] HASH_MISMATCH_ALERT for job ${job.jobId}: expected ${job.deliverableHash} received ${computedHash}`;
        console.error(alert);
        await ERC8183StateMachine.abortJob(this.context, job.jobId, alert);
        return;
      }

      console.log(
        `[CommerceTransportBridge] Deliverable verified for job ${job.jobId} (hash matched)`,
      );
    }
  }
}

/**
 * Utility: Create event listener for a given transport and commerce context.
 */
export function createCommerceTransportBridge(
  transport: StvorTransportManager,
  context: ICommerceContext,
  responseWindowMs = 15000,
): ICommerceEventListener {
  return new CommerceTransportBridge(transport, context, responseWindowMs);
}
