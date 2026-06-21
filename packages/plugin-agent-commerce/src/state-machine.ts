import { randomUUID } from 'crypto';
import type { IErc8183Job, ICommerceContext, IJobStore } from './types';
import { EvaluationDecision } from './types';

export async function clearJobStore(jobStore: IJobStore): Promise<void> {
  await jobStore.clear();
}

export class ERC8183StateMachine {
  static async createJob(
    ctx: ICommerceContext,
    clientAgent: string,
    providerAgent: string,
    taskDescription: string,
    requiredAmount: bigint,
  ): Promise<IErc8183Job> {
    if (!clientAgent || !providerAgent) {
      throw new Error('Both clientAgent and providerAgent are required');
    }
    if (requiredAmount <= 0n) {
      throw new Error('requiredAmount must be greater than 0');
    }

    const jobId = `job-${randomUUID().substring(0, 8)}`;
    const now = Date.now();

    const job: IErc8183Job = {
      jobId,
      clientAgent,
      providerAgent,
      state: 'OPEN',
      taskDescription,
      requiredAmount,
      fundedAmount: 0n,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    await ctx.jobStore.save(job);
    console.log(`[ERC-8183] Created job ${jobId} (OPEN)`);
    return job;
  }

  static async fundJob(
    ctx: ICommerceContext,
    jobId: string,
    clientAgent: string,
    fundAmount: bigint,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    if (job.state !== 'OPEN') {
      throw new Error(`Cannot fund job in state ${job.state}. Expected OPEN.`);
    }
    if (job.clientAgent !== clientAgent) {
      throw new Error('Only the job creator can fund this job');
    }

    const canFund = await ctx.reputationGate.canFundJob(clientAgent, fundAmount);
    if (!canFund) {
      throw new Error(`Reputation gate denied funding for agent ${clientAgent}`);
    }

    const newFundedAmount = job.fundedAmount + fundAmount;
    job.fundedAmount = newFundedAmount;

    if (newFundedAmount >= job.requiredAmount) {
      job.state = 'FUNDED';
    }

    job.updatedAt = Date.now();
    await ctx.jobStore.save(job);

    console.log(
      `[ERC-8183] Funded job ${jobId} with ${fundAmount.toString()} (state: ${job.state})`,
    );
    return job;
  }

  static async submitJob(
    ctx: ICommerceContext,
    jobId: string,
    providerAgent: string,
    deliverableHash: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    if (job.state !== 'FUNDED') {
      throw new Error(`Cannot submit to job in state ${job.state}. Expected FUNDED.`);
    }
    if (job.providerAgent !== providerAgent) {
      throw new Error('Only the provider can submit to this job');
    }

    job.deliverableHash = deliverableHash;
    job.state = 'SUBMITTED';
    job.updatedAt = Date.now();

    await ctx.jobStore.save(job);
    console.log(`[ERC-8183] Submitted deliverable for job ${jobId} (hash: ${deliverableHash})`);
    return job;
  }

  static async refundJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === 'REFUND') {
      return job;
    }

    if (
      job.state !== 'OPEN' &&
      job.state !== 'FUNDED' &&
      job.state !== 'SUBMITTED' &&
      job.state !== 'EXPIRED'
    ) {
      throw new Error(
        `Cannot refund job in state ${job.state}. Expected OPEN, FUNDED, SUBMITTED, or EXPIRED.`,
      );
    }

    job.state = 'REFUND';
    job.metadata.refundReason =
      reason ?? 'Escrow refund triggered by timeout or recovery.';
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.warn(`[ERC-8183] Refund triggered for job ${jobId}: ${job.metadata.refundReason}`);
    return job;
  }

  static async expireJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === 'EXPIRED') {
      return job;
    }

    if (
      job.state !== 'OPEN' &&
      job.state !== 'FUNDED' &&
      job.state !== 'SUBMITTED'
    ) {
      throw new Error(
        `Cannot expire job in state ${job.state}. Expected OPEN, FUNDED, or SUBMITTED.`,
      );
    }

    job.state = 'EXPIRED';
    job.metadata.expirationReason = reason ?? 'Job expired due to peer timeout.';
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.warn(`[ERC-8183] Expired job ${jobId}: ${job.metadata.expirationReason}`);
    return job;
  }

  static async abortJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === 'ABORTED') {
      return job;
    }

    if (
      job.state === 'COMPLETE' ||
      job.state === 'REFUND' ||
      job.state === 'TERMINAL'
    ) {
      throw new Error(`Cannot abort job in state ${job.state}.`);
    }

    job.state = 'ABORTED';
    job.metadata.securityAlert = reason ?? 'Security abort triggered by validation failure.';
    job.metadata.maliciousProvider = true;
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.error(`[SECURITY-ALERT] Aborted job ${jobId}: ${job.metadata.securityAlert}`);
    return job;
  }

  static async evaluateJob(
    ctx: ICommerceContext,
    jobId: string,
    decision: EvaluationDecision,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    if (job.state !== 'SUBMITTED') {
      throw new Error(`Cannot evaluate job in state ${job.state}. Expected SUBMITTED.`);
    }

    if (decision === EvaluationDecision.ACCEPT) {
      job.state = 'COMPLETE';
      job.completedAt = Date.now();
    } else if (decision === EvaluationDecision.REJECT) {
      job.state = 'REFUND';
      job.metadata.refundReason = reason ?? 'Deliverable rejected by evaluator.';
      job.completedAt = Date.now();
    } else {
      job.state = 'REFUND';
      job.metadata.refundReason = reason ?? 'Partial completion requires refund.';
      job.completedAt = Date.now();
    }

    job.updatedAt = Date.now();
    await ctx.jobStore.save(job);
    console.log(`[ERC-8183] Evaluated job ${jobId}: ${decision} → ${job.state}`);
    return job;
  }

  static async getJobState(
    ctx: ICommerceContext,
    jobId: string,
  ): Promise<'OPEN' | 'FUNDED' | 'SUBMITTED' | 'COMPLETE' | 'REFUND' | 'ABORTED' | 'EXPIRED' | 'TERMINAL' | null> {
    const job = await ctx.jobStore.get(jobId);
    return job?.state ?? null;
  }
}
