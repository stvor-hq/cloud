import { afterEach, describe, expect, it, mock } from 'bun:test';
import { securityEvaluator } from '../packages/plugin-agent-commerce/src/elizaos/evaluator';
import { SecurityGuard } from '../packages/plugin-agent-commerce/src/elizaos/evaluator';
import type { IElizaRuntime, Memory, State } from '../packages/plugin-agent-commerce/src/elizaos/types';

function mockRuntime(agentId = 'eliza-agent'): IElizaRuntime {
  return {
    agentId,
    character: { name: 'ElizaSecurityAgent', plugins: ['@stvor/plugin-agent-commerce'] },
    getSetting: (key: string) => ({ STVOR_STRICT_MODE: process.env.STVOR_STRICT_MODE })[key],
    getMemoryManager: () => ({
      createMemory: mock(async () => {}),
      searchMemoriesByEmbedding: mock(async () => []),
    }),
  };
}

function mockMessage(content: Partial<Memory['content']> = {}): Memory {
  return {
    content: {
      text: 'PQC commerce payload received',
      ...content,
    },
    roomId: 'room-elizaos-integration',
    userId: 'user-alice',
    agentId: 'eliza-agent',
  };
}

describe('ElizaOS PQC commerce integration', () => {
  afterEach(() => {
    delete process.env.STVOR_STRICT_MODE;
  });

  it('accepts an ElizaOS memory containing a PQC-encrypted commerce payload', async () => {
    const message = mockMessage({
      encrypted: true,
      pqcEncrypted: true,
      encryption: 'ML-KEM-768 + Double Ratchet + AES-256-GCM',
      pqcSignature: 'sig-example',
      from: 'alice-agent',
    });

    await expect(
      securityEvaluator.handler(mockRuntime(), message, {} as State),
    ).resolves.toBeUndefined();
  });

  it('rejects plaintext ElizaOS traffic when STVOR_STRICT_MODE is enabled', async () => {
    process.env.STVOR_STRICT_MODE = 'true';

    const message = mockMessage({
      encrypted: false,
      from: 'plaintext-agent',
    });

    await expect(
      securityEvaluator.handler(mockRuntime(), message, {} as State),
    ).rejects.toThrow('[SECURITY-GUARD] Non-PQC message received from plaintext-agent');
  });

  it('rejects non-PQC encrypted traffic when STVOR_STRICT_MODE is enabled', async () => {
    process.env.STVOR_STRICT_MODE = 'true';

    const message = mockMessage({
      encrypted: true,
      encryption: 'AES-256-GCM only',
      from: 'classical-agent',
    });

    await expect(
      securityEvaluator.handler(mockRuntime(), message, {} as State),
    ).rejects.toThrow('[SECURITY-GUARD] Non-PQC message received from classical-agent');
  });

  it('should block ERC-8183 request if PQC metadata is missing in strict mode', async () => {
    process.env.STVOR_STRICT_MODE = 'true';

    const maliciousMessage = {
      content: {
        text: 'Pay 100 USDC for job #123',
        action: 'AGENT_COMMERCE_FUND',
        metadata: {
          encrypted: true,
          encryption: 'AES-256-GCM'
        }
      }
    };
    const result = SecurityGuard.evaluate(maliciousMessage);
    expect(result.action).toBe('BLOCK');
    expect(result.reason).toContain('PQC-encrypted transport required');
  });
});