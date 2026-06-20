/**
 * @file ERC-8183 State Machine
 * 
 * Mock implementation of Agentic Commerce Protocol state transitions.
 * Handles job lifecycle: OPEN → FUNDED → SUBMITTED → COMPLETE/REFUND/EXPIRED/ABORTED
 */

import type {
  IErc8183Job,
  ICommerceContext,
  IJobStore} from './types';
import {
  EvaluationDecision,
} from './types';
import { ERC8183JobState } from '../../core/types';
import crypto from 'crypto';

export async function clearJobStore(jobStore: IJobStore): Promise<void> {
  await jobStore.clear();
}

/**
 * ERC-8183 State Machine: Core commerce logic.
 * 
 * Stateless functions that operate on jobs and enforce state transitions.
 * All state changes are validated before mutation.
 */
export class ERC8183StateMachine {
  /**
   * Create a new job in OPEN state.
   */
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

    const jobId = `job-${crypto.randomUUID().substring(0, 8)}`;
    const now = Date.now();

    const job: IErc8183Job = {
      jobId,
      clientAgent,
      providerAgent,
      state: ERC8183JobState.OPEN,
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

  /**
   * Fund a job, transitioning OPEN → FUNDED.
   */
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
    if (job.state !== ERC8183JobState.OPEN) {
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
      job.state = ERC8183JobState.FUNDED;
    }

    job.updatedAt = Date.now();
    await ctx.jobStore.save(job);

    console.log(
      `[ERC-8183] Funded job ${jobId} with ${fundAmount.toString()} (state: ${job.state})`,
    );
    return job;
  }

  /**
   * Submit a deliverable for a job, transitioning FUNDED → SUBMITTED.
   */
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
    if (job.state !== ERC8183JobState.FUNDED) {
      throw new Error(`Cannot submit to job in state ${job.state}. Expected FUNDED.`);
    }
    if (job.providerAgent !== providerAgent) {
      throw new Error('Only the provider can submit to this job');
    }

    job.deliverableHash = deliverableHash;
    job.state = ERC8183JobState.SUBMITTED;
    job.updatedAt = Date.now();

    await ctx.jobStore.save(job);
    console.log(`[ERC-8183] Submitted deliverable for job ${jobId} (hash: ${deliverableHash})`);
    return job;
  }

  /**
   * Refund an escrowed job and release locked funds.
   */
  static async refundJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === ERC8183JobState.REFUND) {
      return job;
    }

    if (
      job.state !== ERC8183JobState.OPEN &&
      job.state !== ERC8183JobState.FUNDED &&
      job.state !== ERC8183JobState.SUBMITTED &&
      job.state !== ERC8183JobState.EXPIRED
    ) {
      throw new Error(
        `Cannot refund job in state ${job.state}. Expected OPEN, FUNDED, SUBMITTED, or EXPIRED.`,
      );
    }

    job.state = ERC8183JobState.REFUND;
    job.metadata.refundReason =
      reason ?? 'Escrow refund triggered by timeout or recovery.';
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.warn(`[ERC-8183] Refund triggered for job ${jobId}: ${job.metadata.refundReason}`);
    return job;
  }

  /**
   * Mark a job expired when a peer fails to respond in time.
   */
  static async expireJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === ERC8183JobState.EXPIRED) {
      return job;
    }

    if (
      job.state !== ERC8183JobState.OPEN &&
      job.state !== ERC8183JobState.FUNDED &&
      job.state !== ERC8183JobState.SUBMITTED
    ) {
      throw new Error(
        `Cannot expire job in state ${job.state}. Expected OPEN, FUNDED, or SUBMITTED.`,
      );
    }

    job.state = ERC8183JobState.EXPIRED;
    job.metadata.expirationReason = reason ?? 'Job expired due to peer timeout.';
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.warn(`[ERC-8183] Expired job ${jobId}: ${job.metadata.expirationReason}`);
    return job;
  }

  /**
   * Abort a job due to a security violation such as hash mismatch or prompt injection.
   */
  static async abortJob(
    ctx: ICommerceContext,
    jobId: string,
    reason?: string,
  ): Promise<IErc8183Job> {
    const job = await ctx.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.state === ERC8183JobState.ABORTED) {
      return job;
    }

    if (
      job.state === ERC8183JobState.COMPLETE ||
      job.state === ERC8183JobState.REFUND ||
      job.state === ERC8183JobState.TERMINAL
    ) {
      throw new Error(`Cannot abort job in state ${job.state}.`);
    }

    job.state = ERC8183JobState.ABORTED;
    job.metadata.securityAlert = reason ?? 'Security abort triggered by validation failure.';
    job.metadata.maliciousProvider = true;
    job.updatedAt = Date.now();
    job.completedAt = Date.now();

    await ctx.jobStore.save(job);
    console.error(`[SECURITY-ALERT] Aborted job ${jobId}: ${job.metadata.securityAlert}`);
    return job;
  }

  /**
   * Evaluate a submitted deliverable, transitioning SUBMITTED → COMPLETE/REFUND.
   */
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
    if (job.state !== ERC8183JobState.SUBMITTED) {
      throw new Error(`Cannot evaluate job in state ${job.state}. Expected SUBMITTED.`);
    }

    if (decision === EvaluationDecision.ACCEPT) {
      job.state = ERC8183JobState.COMPLETE;
    } else if (decision === EvaluationDecision.REJECT) {
      job.state = ERC8183JobState.REFUND;
    } else if (decision === EvaluationDecision.PARTIAL) {
      job.state = ERC8183JobState.COMPLETE;
      job.metadata.partialCompletion = true;
    }

    job.completedAt = Date.now();
    job.updatedAt = job.completedAt;
    if (reason) {
      job.metadata.evaluationReason = reason;
    }

    await ctx.jobStore.save(job);
    console.log(`[ERC-8183] Evaluated job ${jobId}: ${decision} → state: ${job.state}`);
    return job;
  }

  /**
   * Query job state without mutation.
   */
  static async getJobState(
    ctx: ICommerceContext,
    jobId: string,
  ): Promise<ERC8183JobState | null> {
    const job = await ctx.jobStore.get(jobId);
    return job?.state ?? null;
  }
}
