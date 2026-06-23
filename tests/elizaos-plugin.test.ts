import { describe, it, expect, mock } from 'bun:test';
import type { IAgentRuntime, Memory, State, UUID } from '@elizaos/core';
import { agentCommercePlugin } from '../packages/plugin-agent-commerce/src/elizaos/index';
import { AgentCommerceService, AGENT_COMMERCE_SERVICE_TYPE } from '../packages/plugin-agent-commerce/src/service';
import { MemoryJobStore, ERC8183JobState } from '../packages/plugin-agent-commerce/src/types';
import { StaticReputationProvider } from '../packages/plugin-agent-commerce/src/reputation/static';

const AGENT_ID = '00000000-0000-4000-8000-000000000007' as UUID;
const ENTITY_ID = '00000000-0000-4000-8000-000000000008' as UUID;
const ROOM_ID = '00000000-0000-4000-8000-000000000009' as UUID;

function mockRuntime(agentId: UUID = AGENT_ID): IAgentRuntime {
  const services = new Map<string, unknown>();

  const runtime = {
    agentId,
    character: { name: 'TestAgent', plugins: ['@elizaos/plugin-agent-commerce'] },
    getSetting: (_key: string) => null,
    createMemory: mock(async () => ENTITY_ID),
    getMemories: mock(async () => []),
    getService: <T>(type: string): T | null => (services.get(type) as T) ?? null,
    logger: {
      level: 'info',
      trace: mock(() => {}),
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      fatal: mock(() => {}),
      success: mock(() => {}),
      progress: mock(() => {}),
      log: mock(() => {}),
      clear: mock(() => {}),
      child: mock(function child() { return runtime.logger; }),
    },
  } as unknown as IAgentRuntime;

  const service = new AgentCommerceService(runtime, {
    jobStore: new MemoryJobStore(),
    reputationProvider: new StaticReputationProvider({ minScore: 0 }),
  });
  services.set(AGENT_COMMERCE_SERVICE_TYPE, service);

  return runtime;
}

function mockMessage(text: string, agentId: UUID = AGENT_ID): Memory {
  return {
    entityId: ENTITY_ID,
    roomId: ROOM_ID,
    agentId,
    content: { text },
  };
}

describe('agentCommercePlugin structure', () => {
  it('has correct ElizaOS plugin shape', () => {
    expect(agentCommercePlugin.name).toBe('agent-commerce');
    expect(Array.isArray(agentCommercePlugin.actions)).toBe(true);
    expect(Array.isArray(agentCommercePlugin.providers)).toBe(true);
    expect(Array.isArray(agentCommercePlugin.evaluators)).toBe(true);
    expect(Array.isArray(agentCommercePlugin.services)).toBe(true);
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

  it('registers AgentCommerceService', () => {
    expect(agentCommercePlugin.services).toHaveLength(1);
    expect(agentCommercePlugin.services![0]).toBe(AgentCommerceService);
  });
});

describe('CREATE_SECURE_JOB action', () => {
  const action = agentCommercePlugin.actions.find((a) => a.name === 'CREATE_SECURE_JOB');

  it('validates correctly', async () => {
    if (!action) throw new Error('CREATE_SECURE_JOB action not found');
    const runtime = mockRuntime();
    expect(await action.validate(runtime, mockMessage('create a job for bob'))).toBe(true);
    expect(await action.validate(runtime, mockMessage('what is the weather'))).toBe(false);
  });

  it('creates a job and returns job ID', async () => {
    if (!action) throw new Error('CREATE_SECURE_JOB action not found');
    const runtime = mockRuntime('00000000-0000-4000-8000-000000000010' as UUID);
    let responseText = '';

    await action.handler(
      runtime,
      mockMessage('Create a job for bob to build a REST API, budget 1000000', runtime.agentId),
      { values: {}, data: {}, text: '' } as State,
      {},
      async (response) => {
        responseText = response.text ?? '';
        return [];
      },
    );

    expect(responseText).toContain('job-');
    expect(responseText).toContain('OPEN');
  });
});

describe('commerce provider', () => {
  const provider = agentCommercePlugin.providers[0];

  it('returns no-jobs message when empty', async () => {
    if (!provider) throw new Error('Commerce provider not found');
    const runtime = mockRuntime('00000000-0000-4000-8000-000000000011' as UUID);
    const result = await provider.get(
      runtime,
      mockMessage('hello', runtime.agentId),
      { values: {}, data: {}, text: '' } as State,
    );
    expect(result.text).toContain('No active jobs');
  });

  it('returns job list after a job is created', async () => {
    if (!provider) throw new Error('Commerce provider not found');
    const runtime = mockRuntime('00000000-0000-4000-8000-000000000012' as UUID);
    const service = runtime.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE)!;

    await service.jobStore.save({
      jobId: 'job-test001',
      clientAgent: String(runtime.agentId),
      providerAgent: 'bob',
      state: ERC8183JobState.OPEN,
      taskDescription: 'Build a test component',
      requiredAmount: 100n,
      fundedAmount: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    });

    const result = await provider.get(
      runtime,
      mockMessage('hello', runtime.agentId),
      { values: {}, data: {}, text: '' } as State,
    );

    expect(result.text).toContain('job-test001');
    expect(result.data).toBeDefined();
    expect(Array.isArray((result.data as Record<string, unknown>)['jobs'])).toBe(true);
  });
});

describe('commerce evaluator', () => {
  const evaluator = agentCommercePlugin.evaluators.find((e) => e.name === 'COMMERCE_TRACKER')!;

  it('validates messages containing job IDs', async () => {
    if (!evaluator) throw new Error('Commerce evaluator not found');
    const runtime = mockRuntime();
    expect(await evaluator.validate(runtime, mockMessage('Check job-abc123 status'))).toBe(true);
    expect(await evaluator.validate(runtime, mockMessage('Hello world'))).toBe(false);
  });
});

describe('AgentCommerceService isolation', () => {
  it('two runtimes have independent job stores', async () => {
    const runtime1 = mockRuntime('00000000-0000-4000-8000-000000000020' as UUID);
    const runtime2 = mockRuntime('00000000-0000-4000-8000-000000000021' as UUID);

    const svc1 = runtime1.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE)!;
    const svc2 = runtime2.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE)!;

    await svc1.jobStore.save({
      jobId: 'job-r1-only',
      clientAgent: 'alice',
      providerAgent: 'bob',
      state: ERC8183JobState.OPEN,
      taskDescription: 'Task for runtime 1',
      requiredAmount: 1000n,
      fundedAmount: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    });

    const inR1 = await svc1.jobStore.get('job-r1-only');
    const inR2 = await svc2.jobStore.get('job-r1-only');

    expect(inR1).not.toBeNull();
    expect(inR2).toBeNull();
  });

  it('two runtimes have independent security guards', () => {
    const runtime1 = mockRuntime('00000000-0000-4000-8000-000000000030' as UUID);
    const runtime2 = mockRuntime('00000000-0000-4000-8000-000000000031' as UUID);

    const svc1 = runtime1.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE)!;
    const svc2 = runtime2.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE)!;

    expect(svc1.securityGuard).not.toBe(svc2.securityGuard);
  });
});
