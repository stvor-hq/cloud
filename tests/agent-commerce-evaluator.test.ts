import { describe, it, expect, afterEach } from 'bun:test';
import { securityEvaluator } from '../src/plugins/agent-commerce/elizaos/evaluator';
import type { IElizaRuntime, Memory, State } from '../src/plugins/agent-commerce/elizaos/types';

function mockRuntime(agentId = 'agent-test'): IElizaRuntime {
  return {
    agentId,
    character: { name: 'TestAgent', plugins: ['@elizaos/plugin-agent-commerce'] },
    getSetting: (key: string) => ({ STVOR_STRICT_MODE: '' })[key],
    getMemoryManager: () => ({
      createMemory: async () => {},
      searchMemoriesByEmbedding: async () => [],
    }),
  };
}

function mockMemory(overrides: Partial<Memory['content']> = {}): Memory {
  return {
    content: {
      text: 'test message',
      ...overrides,
    },
    roomId: 'room-test',
    userId: 'user-test',
    agentId: 'agent-test',
  };
}

describe('securityEvaluator', () => {
  afterEach(() => {
    delete process.env.STVOR_STRICT_MODE;
  });

  it('should pass encrypted message without error', async () => {
    const runtime = mockRuntime();
    const message = mockMemory({
      encrypted: true,
      text: 'encrypted message',
    });

    await expect(
      securityEvaluator.handler(runtime, message, {} as State),
    ).resolves.toBeUndefined();
  });

  it('should reject plaintext message in strict mode', async () => {
    process.env.STVOR_STRICT_MODE = 'true';
    const runtime = mockRuntime();
    const message = mockMemory({
      encrypted: false,
      text: 'plaintext message',
      from: 'malicious-sender',
    });

    await expect(
      securityEvaluator.handler(runtime, message, {} as State),
    ).rejects.toThrow('[SECURITY-GUARD] Unencrypted message received from malicious-sender');
  });

  it('should log warning for plaintext message in non-strict mode', async () => {
    process.env.STVOR_STRICT_MODE = 'false';
    const runtime = mockRuntime();
    const message = mockMemory({
      encrypted: false,
      text: 'plaintext message',
      from: 'sender-without-encryption',
    });

    const originalWarn = console.warn;
    let warnCalled = false;
    console.warn = (msg: string) => {
      if (msg.includes('Unencrypted message received')) {
        warnCalled = true;
      }
    };

    await securityEvaluator.handler(runtime, message, {} as State);
    expect(warnCalled).toBe(true);

    console.warn = originalWarn;
  });

  it('should pass message without encrypted flag when not in strict mode', async () => {
    process.env.STVOR_STRICT_MODE = 'false';
    const runtime = mockRuntime();
    const message = mockMemory({
      text: 'message without flag',
    });

    await expect(
      securityEvaluator.handler(runtime, message, {} as State),
    ).resolves.toBeUndefined();
  });
});