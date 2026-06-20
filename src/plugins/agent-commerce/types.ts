/**
 * @file ERC-8183 Type Definitions
 * 
 * Types for the Agentic Commerce Protocol.
 * Mock state machine for agent-to-agent commerce without on-chain deployment.
 */

import type { ERC8183JobState } from '../../core/types';

/**
 * Evaluator function signature.
 * Evaluators decide if a deliverable meets the job requirements.
 */
export type EvaluatorFunction = (
  deliverable: string,
  requirements: Record<string, unknown>,
) => Promise<boolean>;

/**
 * ERC-8183 Job: Represents a unit of work in the commerce protocol.
 */
export interface IErc8183Job {
  jobId: string;
  clientAgent: string;
  providerAgent: string;
  state: ERC8183JobState;
  taskDescription: string;
  requiredAmount: bigint;
  fundedAmount: bigint;
  deliverableHash?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;
}

/**
 * PQC Reputation Gate Hook.
 * Used to guard high-value operations (e.g., fundJob) with reputation checks.
 * 
 * In a full implementation, this would verify on-chain reputation via Solana/etc.
 * For Phase 1, we mock the interface so tests can inject reputation decisions.
 */
export interface IPqcReputationGateHook {
  /**
   * Check if an agent is allowed to fund a job.
   * Returns true if reputation gate passes, false otherwise.
   */
  canFundJob(agentId: string, amount: bigint): Promise<boolean>;

  /**
   * Get the reputation score for an agent.
   * Mock returns 0-100 score.
   */
  getReputation(agentId: string): Promise<number>;
}

/**
 * In-memory job store for Phase 1 testing.
 * Will be replaced with PGLite/SQLite in later phases.
 */
export interface IJobStore {
  save(job: IErc8183Job): Promise<void>;
  get(jobId: string): Promise<IErc8183Job | null>;
  listByAgent(agentId: string): Promise<IErc8183Job[]>;
  clear(): Promise<void>;
}

/**
 * ERC-8183 Commerce Context.
 * Passed to all commerce operations, carries runtime + hooks.
 */
export interface ICommerceContext {
  runtime: unknown; // Reference to AgentRuntime
  jobStore: IJobStore;
  reputationGate: IPqcReputationGateHook;
}

/**
 * Decision result from evaluator.
 */
export enum EvaluationDecision {
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
  PARTIAL = 'PARTIAL',
}
