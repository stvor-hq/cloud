// src/plugins/agent-commerce/reputation.ts
// Reputation gate interface + mock implementation.
// Phase 3: replace with Solana oracle or ERC-8004 registry.

export interface ReputationScore {
  agentId: string;
  score: number;
  jobsCompleted: number;
  jobsFailed: number;
  lastUpdated: string;
  source: 'mock' | 'erc8004' | 'solana-oracle';
}

export interface IReputationGate {
  canFundJob(clientId: string, providerId: string, amount: string): Promise<boolean>;
  getScore(agentId: string): Promise<ReputationScore>;
  recordOutcome(jobId: string, providerId: string, success: boolean): Promise<void>;
}

export class MockReputationGate implements IReputationGate {
  private scores = new Map<string, ReputationScore>([
    ['alice',   { agentId: 'alice',   score: 95, jobsCompleted: 47, jobsFailed: 2,  lastUpdated: new Date().toISOString(), source: 'mock' }],
    ['bob',     { agentId: 'bob',     score: 88, jobsCompleted: 31, jobsFailed: 3,  lastUpdated: new Date().toISOString(), source: 'mock' }],
    ['charlie', { agentId: 'charlie', score: 72, jobsCompleted: 12, jobsFailed: 4,  lastUpdated: new Date().toISOString(), source: 'mock' }],
  ]);

  async canFundJob(clientId: string, providerId: string, _amount: string): Promise<boolean> {
    const providerScore = await this.getScore(providerId);
    return providerScore.score >= 50;
  }

  async getScore(agentId: string): Promise<ReputationScore> {
    return this.scores.get(agentId) ?? {
      agentId,
      score: 60,
      jobsCompleted: 0,
      jobsFailed: 0,
      lastUpdated: new Date().toISOString(),
      source: 'mock',
    };
  }

  async recordOutcome(jobId: string, providerId: string, success: boolean): Promise<void> {
    const score = await this.getScore(providerId);
    if (success) {
      score.jobsCompleted++;
      score.score = Math.min(100, score.score + 1);
    } else {
      score.jobsFailed++;
      score.score = Math.max(0, score.score - 5);
    }
    score.lastUpdated = new Date().toISOString();
    this.scores.set(providerId, score);
  }
}
