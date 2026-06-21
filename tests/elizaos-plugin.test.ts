import { describe, it, expect, mock } from 'bun:test';
import { agentCommercePlugin } from '../packages/plugin-agent-commerce/src/elizaos/index';
import type { IElizaRuntime, Memory, State } from '../packages/plugin-agent-commerce/src/elizaos/types';

function mockRuntime(agentId = 'agent-test'): IElizaRuntime {
  return {
    agentId,
    character: { name: 'TestAgent', plugins: ['@stvor/plugin-agent-commerce'] },
    getSetting: (key: string) => ({ STVOR_RELAY_URL: 'http://localhost:4444' })[key],
    getMemoryManager: () => ({
      createMemory: mock(async () => {}),
      searchMemoriesByEmbedding: mock(async () => []),
    }),
  };
}

function mockMessage(text: string, agentId = 'agent-test'): Memory {
  return {
    content: { text },
    roomId: 'room-test',
    userId: 'user-test',
    agentId,
  };
}

describe('agentCommercePlugin structure', () => {
  it('has correct ElizaOS plugin shape', () => {
    expect(agentCommercePlugin.name).toBe('agent-commerce');
    expect(Array.isArray(agentCommercePlugin.actions)).toBe(true);
    expect(Array.isArray(agentCommercePlugin.providers)).toBe(true);
    expect(Array.isArray(agentCommercePlugin.evaluators)).toBe(true);
  });

  it('exposes 4 actions', () => {
    expect(agentCommercePlugin.actions).toHaveLength(4);
    const names = agentCommercePlugin.actions.map((a) => a.name);
    expect(names).toContain('CREATE_SECURE_JOB');
    expect(names).toContain('FUND_SECURE_JOB');
    expect(names).toContain('SUBMIT_DELIVERABLE');
    expect(names).toContain('JOB_STATUS');
  });

  it('exposes 2 evaluators', () => {
    expect(agentCommercePlugin.evaluators).toHaveLength(2);
    const names = agentCommercePlugin.evaluators.map((e) => e.name);
    expect(names).toContain('SECURITY_GUARD');
    expect(names).toContain('COMMERCE_TRACKER');
  });
});

describe('CREATE_SECURE_JOB action', () => {
  const action = agentCommercePlugin.actions.find((a) => a.name === 'CREATE_SECURE_JOB');

  it('validates correctly', async () => {
    if (!action) {
      throw new Error('CREATE_SECURE_JOB action not found');
    }
    const runtime = mockRuntime();
    expect(await action.validate(runtime, mockMessage('create a job for bob'))).toBe(true);
    expect(await action.validate(runtime, mockMessage('what is the weather'))).toBe(false);
  });

  it('creates a job and returns job ID', async () => {
    if (!action) {
      throw new Error('CREATE_SECURE_JOB action not found');
    }
    const runtime = mockRuntime();
    let response: { text: string; data?: unknown } | null = null;

    await action.handler(
      runtime,
      mockMessage('Create a job for bob to build a REST API, budget 1000000'),
      {} as State,
      {},
      async (r) => {
        response = r;
      },
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error('Expected action response');
    }
    expect(response.text).toContain('job-');
    expect(response.text).toContain('OPEN');
    expect((response.data as { status: string }).status).toBe('OPEN');
  });
});

describe('commerce provider', () => {
  const provider = agentCommercePlugin.providers[0];

  it('returns no-jobs message when empty', async () => {
    if (!provider) {
      throw new Error('Commerce provider not found');
    }
    const runtime = mockRuntime('unique-agent-empty-provider');
    const result = await provider.get(runtime, mockMessage('hello', 'unique-agent-empty-provider'), {});
    expect(result).toContain('No active jobs');
  });
});

describe('commerce evaluator', () => {
  const evaluator = agentCommercePlugin.evaluators[1];

  it('validates messages containing job IDs', async () => {
    if (!evaluator) {
      throw new Error('Commerce evaluator not found');
    }
    const runtime = mockRuntime();
    expect(await evaluator.validate(runtime, mockMessage('Check job-abc123 status'))).toBe(true);
    expect(await evaluator.validate(runtime, mockMessage('Hello world'))).toBe(false);
  });
});
