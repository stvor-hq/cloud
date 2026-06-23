import { describe, it, expect, mock } from 'bun:test';
import type { IAgentRuntime, Memory, State, UUID } from '@elizaos/core';
import { commerceEvaluator } from '../packages/plugin-agent-commerce/src/elizaos/evaluator';

const AGENT_ID = '00000000-0000-4000-8000-000000000001' as UUID;
const ENTITY_ID = '00000000-0000-4000-8000-000000000002' as UUID;
const ROOM_ID = '00000000-0000-4000-8000-000000000003' as UUID;

function mockRuntime(): IAgentRuntime {
  return {
    agentId: AGENT_ID,
    character: { name: 'TestAgent', plugins: ['@elizaos/plugin-agent-commerce'] },
    getSetting: () => null,
    createMemory: mock(async () => ENTITY_ID),
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
      child: mock(() => mockRuntime().logger),
    },
  } as unknown as IAgentRuntime;
}

describe('commerce memory integration', () => {
  it('stores job references via runtime.createMemory', async () => {
    const runtime = mockRuntime();
    const message: Memory = {
      entityId: ENTITY_ID,
      roomId: ROOM_ID,
      agentId: AGENT_ID,
      content: { text: 'Check job-abc12345 status' },
    };

    await commerceEvaluator.handler(runtime, message, {
      values: {},
      data: {},
      text: '',
    } as State);

    expect(runtime.createMemory).toHaveBeenCalled();
  });
});
