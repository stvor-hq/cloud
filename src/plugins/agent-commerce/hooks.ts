/**
 * @file PQC Reputation Gate Hook
 * 
 * Phase 1 mock implementation of reputation checking.
 * In production, this would:
 *   - Query Solana on-chain reputation programs
 *   - Cache reputation scores with TTL
 *   - Implement circuit breaker for RPC failures
 */

import type { IPqcReputationGateHook } from './types';

/**
 * MockPqcReputationGate: In-memory reputation store for Phase 1 testing.
 * 
 * Future production version will fetch from:
 *   - Solana on-chain reputation accounts
 *   - Distributed reputation oracles
 *   - Agent-specific SBTs (Soulbound Tokens)
 */
export class MockPqcReputationGate implements IPqcReputationGateHook {
  private reputationScores: Map<string, number> = new Map();
  private fundingLimits: Map<string, bigint> = new Map();

  constructor() {
    // Initialize with seed data for testing
    this.reputationScores.set('agent-1', 85);
    this.reputationScores.set('agent-2', 92);
    this.reputationScores.set('agent-3', 45);
    this.reputationScores.set('agent-unknown', 0);

    // Funding limits based on reputation (mock)
    this.fundingLimits.set('agent-1', 1_000_000n); // 1M base units
    this.fundingLimits.set('agent-2', 5_000_000n); // 5M base units
    this.fundingLimits.set('agent-3', 100_000n); // 100k base units
  }

  /**
   * Check if an agent is allowed to fund a job.
   * 
   * Gate logic:
   *   - Reputation must be >= 50 (baseline)
   *   - Fund amount must not exceed agent's limit
   */
  async canFundJob(agentId: string, amount: bigint): Promise<boolean> {
    const reputation = await this.getReputation(agentId);
    const limit = this.fundingLimits.get(agentId) || 0n;

    console.log(
      `[PQC Gate] Checking funding: ${agentId} (rep=${reputation}, limit=${limit.toString()})`,
    );

    if (reputation < 50) {
      console.log(`[PQC Gate] DENIED: Reputation ${reputation} < 50`);
      return false;
    }

    if (amount > limit) {
      console.log(
        `[PQC Gate] DENIED: Amount ${amount.toString()} > limit ${limit.toString()}`,
      );
      return false;
    }

    console.log(`[PQC Gate] APPROVED: Funding allowed`);
    return true;
  }

  /**
   * Get the reputation score for an agent.
   * Returns 0 if agent is unknown.
   */
  async getReputation(agentId: string): Promise<number> {
    return this.reputationScores.get(agentId) ?? 0;
  }

  /**
   * Set reputation for testing purposes.
   */
  setReputation(agentId: string, score: number): void {
    this.reputationScores.set(agentId, score);
  }

  /**
   * Set funding limit for testing purposes.
   */
  setFundingLimit(agentId: string, limit: bigint): void {
    this.fundingLimits.set(agentId, limit);
  }
}

/**
 * Future: Production reputation gate (stubbed)
 * 
 * export class SolanaReputationGate implements IPqcReputationGateHook {
 *   constructor(private connection: Connection, private programId: PublicKey) {}
 *
 *   async canFundJob(agentId: string, amount: bigint): Promise<boolean> {
 *     const account = await this.connection.getAccountInfo(new PublicKey(agentId));
 *     // Parse on-chain reputation data
 *     // Return decision based on on-chain state
 *   }
 * }
 */
