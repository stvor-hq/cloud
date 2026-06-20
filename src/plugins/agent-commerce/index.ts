/**
 * @file ERC-8183 Commerce Plugin (ElizaOS-compatible)
 * 
 * Main entry point for the @elizaos/plugin-agent-commerce module.
 * Integrates the state machine, reputation gate, transport layer, and job store.
 * 
 * Data flow:
 *   1. Job creation (OPEN state)
 *   2. Funding with reputation gate (OPEN → FUNDED)
 *   3. Secure payload delivery via Stvor (async background)
 *   4. Provider execution and submission (FUNDED → SUBMITTED)
 *   5. Evaluation and settlement (SUBMITTED → COMPLETE/REFUND)
 * 
 * All payloads travel through encrypted Stvor channels.
 * Only hashes are recorded on the mock ledger.
 */

import { ERC8183StateMachine } from './state-machine';
import { MockPqcReputationGate } from './hooks';
import { EvaluationDecision, type IJobStore, type ICommerceContext, type IErc8183Job } from './types';
import type { ERC8183JobState } from '../../core/types';
import type { StvorTransportManager } from '../../transport/pqc';
import type { ICommerceEventListener } from './lifecycle';

/**
 * In-memory job store (Phase 2).
 * Will be replaced with PGLite/SQLite in production.
 */
export class MemoryJobStore implements IJobStore {
  private jobs: Map<string, IErc8183Job> = new Map();

  async save(job: IErc8183Job): Promise<void> {
    this.jobs.set(job.jobId, job);
  }

  async get(jobId: string): Promise<IErc8183Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listByAgent(agentId: string): Promise<IErc8183Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.clientAgent === agentId || job.providerAgent === agentId,
    );
  }

  async clear(): Promise<void> {
    this.jobs.clear();
  }
}

/**
 * ElizaOS Commerce Plugin with Transport Integration
 * 
 * Exports the main commerce interface as a plugin that agents can invoke.
 * 
 * Usage:
 *   const commerce = runtime.getPlugin('agent-commerce') as ICommercePlugin;
 *   await commerce.createJob(...);
 *   // Transport layer automatically handles secure delivery
 */
export interface ICommercePlugin {
  createJob(
    clientAgent: string,
    providerAgent: string,
    taskDescription: string,
    requiredAmount: bigint,
  ): Promise<IErc8183Job>;

  fundJob(
    jobId: string,
    clientAgent: string,
    fundAmount: bigint,
  ): Promise<IErc8183Job>;

  submitJob(
    jobId: string,
    providerAgent: string,
    deliverableHash: string,
  ): Promise<IErc8183Job>;

  evaluateJob(
    jobId: string,
    decision: 'ACCEPT' | 'REJECT' | 'PARTIAL',
    reason?: string,
  ): Promise<IErc8183Job>;

  getJobState(jobId: string): Promise<ERC8183JobState | null>;

  listJobs(agentId: string): Promise<IErc8183Job[]>;

  getContext(): ICommerceContext;

  registerEventListener(listener: ICommerceEventListener): void;

  /**
   * Retrieve the current transport manager (for advanced use).
   */
  getTransport(): StvorTransportManager | null;
}

/**
 * AgentCommercePlugin: Main plugin class with transport integration.
 * 
 * Responsibilities:
 *   1. Manage job lifecycle (state transitions)
 *   2. Enforce reputation gates
 *   3. Trigger transport events on state changes
 *   4. Record payload hashes for ledger attestation
 */
export class AgentCommercePlugin implements ICommercePlugin {
  private context: ICommerceContext;
  private transport: StvorTransportManager | null = null;
  private eventListeners: ICommerceEventListener[] = [];

  constructor(
    runtime: unknown,
    transport?: StvorTransportManager,
    context?: Partial<ICommerceContext>,
  ) {
    this.context = {
      runtime,
      jobStore: context?.jobStore ?? new MemoryJobStore(),
      reputationGate: context?.reputationGate ?? new MockPqcReputationGate(),
    };

    if (transport) {
      this.transport = transport;
      console.log('[Plugin] Transport layer integrated');
    }

    console.log('[Plugin] Initialized AgentCommercePlugin');
  }

  /**
   * Register an event listener for job state changes.
   * Listeners are invoked whenever a job transitions states.
   */
  registerEventListener(listener: ICommerceEventListener): void {
    this.eventListeners.push(listener);
    console.log(
      `[Plugin] Registered event listener (total: ${this.eventListeners.length})`,
    );
  }

  /**
   * Fire event to all listeners.
   */
  private async _fireEvent(
    eventType: string,
    job: IErc8183Job,
    extra?: { decision?: string },
  ): Promise<void> {
    for (const listener of this.eventListeners) {
      try {
        if (eventType === 'created' && 'onJobCreated' in listener) {
          await listener.onJobCreated(job);
        } else if (eventType === 'funded' && 'onJobFunded' in listener) {
          await listener.onJobFunded(job);
        } else if (eventType === 'submitted' && 'onJobSubmitted' in listener) {
          await listener.onJobSubmitted(job);
        } else if (eventType === 'evaluated' && 'onJobEvaluated' in listener) {
          await listener.onJobEvaluated(job, extra?.decision || '');
        }
      } catch (error) {
        console.error(
          `[Plugin] Event listener error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Create a new job.
   */
  async createJob(
    clientAgent: string,
    providerAgent: string,
    taskDescription: string,
    requiredAmount: bigint,
  ): Promise<IErc8183Job> {
    const job = await ERC8183StateMachine.createJob(
      this.context,
      clientAgent,
      providerAgent,
      taskDescription,
      requiredAmount,
    );

    await this._fireEvent('created', job);
    return job;
  }

  /**
   * Fund an existing job.
   * 
   * When funded, the plugin automatically triggers secure payload delivery
   * to the provider via the Stvor transport (if configured).
   */
  async fundJob(
    jobId: string,
    clientAgent: string,
    fundAmount: bigint,
  ): Promise<IErc8183Job> {
    const job = await ERC8183StateMachine.fundJob(
      this.context,
      jobId,
      clientAgent,
      fundAmount,
    );

    // Trigger transport event (sends encrypted task to provider)
    await this._fireEvent('funded', job);

    return job;
  }

  /**
   * Submit a deliverable to a funded job.
   */
  async submitJob(
    jobId: string,
    providerAgent: string,
    deliverableHash: string,
  ): Promise<IErc8183Job> {
    const job = await ERC8183StateMachine.submitJob(
      this.context,
      jobId,
      providerAgent,
      deliverableHash,
    );

    await this._fireEvent('submitted', job);
    return job;
  }

  /**
   * Evaluate and finalize a submitted job.
   */
  async evaluateJob(
    jobId: string,
    decision: 'ACCEPT' | 'REJECT' | 'PARTIAL',
    reason?: string,
  ): Promise<IErc8183Job> {
    const decisionEnum: EvaluationDecision =
      decision === 'ACCEPT'
        ? EvaluationDecision.ACCEPT
        : decision === 'REJECT'
          ? EvaluationDecision.REJECT
          : EvaluationDecision.PARTIAL;
    const job = await ERC8183StateMachine.evaluateJob(
      this.context,
      jobId,
      decisionEnum,
      reason,
    );

    await this._fireEvent('evaluated', job, { decision });
    return job;
  }

  /**
   * Query job state.
   */
  async getJobState(jobId: string): Promise<ERC8183JobState | null> {
    return ERC8183StateMachine.getJobState(this.context, jobId);
  }

  /**
   * List all jobs for an agent (client or provider).
   */
  async listJobs(agentId: string): Promise<IErc8183Job[]> {
    return this.context.jobStore.listByAgent(agentId);
  }

  getContext(): ICommerceContext {
    return this.context;
  }

  /**
   * Get the transport manager (for advanced use).
   */
  getTransport(): StvorTransportManager | null {
    return this.transport;
  }

  /**
   * Plugin metadata for ElizaOS.
   */
  static getMetadata() {
    return {
      name: '@elizaos/plugin-agent-commerce',
      version: '0.2.0',
      description:
        'ERC-8183 Agentic Commerce Protocol with Stvor PQC-E2EE transport',
      features: ['secure-payload-delivery', 'hybrid-pqc', 'double-ratchet'],
    };
  }
}

/**
 * Plugin factory for ElizaOS integration with optional transport.
 */
export function createCommercePlugin(
  runtime: unknown,
  transport?: StvorTransportManager,
  context?: Partial<ICommerceContext>,
): AgentCommercePlugin {
  return new AgentCommercePlugin(runtime, transport, context);
}

export { agentCommercePlugin } from './elizaos/index';
export { agentCommercePlugin as default } from './elizaos/index';
