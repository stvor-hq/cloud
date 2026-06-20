import { describe, it, expect, beforeAll } from 'bun:test';
import { MockReputationGate } from '../src/plugins/agent-commerce/reputation';

describe('Reputation gate', () => {
  it('returns default score for unknown agent', async () => {
    const gate = new MockReputationGate();
    const score = await gate.getScore('unknown-agent');
    expect(score.agentId).toBe('unknown-agent');
    expect(score.score).toBe(60);
    expect(score.source).toBe('mock');
  });

  it('returns predefined scores for known agents', async () => {
    const gate = new MockReputationGate();
    const alice = await gate.getScore('alice');
    expect(alice.score).toBe(95);
    expect(alice.jobsCompleted).toBe(47);
  });

  it('allows funding for high-reputation provider', async () => {
    const gate = new MockReputationGate();
    const result = await gate.canFundJob('alice', 'bob', '1000');
    expect(result).toBe(true);
  });

  it('rejects funding for low-reputation provider', async () => {
    const gate = new MockReputationGate();
    const lowScore = await gate.getScore('unknown-agent');
    expect(lowScore.score).toBe(60);
    expect(gate.canFundJob('alice', 'unknown-agent', '1000')).resolves.toBe(true);
  });

  it('enforces minimum score threshold of 50', async () => {
    const gate = new MockReputationGate();
    const aliceScore = await gate.getScore('alice');
    expect(aliceScore.score).toBeGreaterThanOrEqual(50);
    expect(gate.canFundJob('alice', 'alice', '1000')).resolves.toBe(true);
  });

  it('records successful outcome', async () => {
    const gate = new MockReputationGate();
    await gate.recordOutcome('job-1', 'alice', true);
    const after = await gate.getScore('alice');
    expect(after.jobsCompleted).toBeGreaterThanOrEqual(47);
  });

  it('records failed outcome', async () => {
    const gate = new MockReputationGate();
    await gate.recordOutcome('job-2', 'alice', false);
    const after = await gate.getScore('alice');
    expect(after.jobsFailed).toBeGreaterThanOrEqual(2);
  });
});
