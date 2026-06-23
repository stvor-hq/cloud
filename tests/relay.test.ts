import { describe, it, expect } from 'bun:test';

// Unit tests for relay message validation logic
// (WebSocket integration tests require a running server)

interface RelayMessage {
  type: string;
  from?: string;
  to?: string;
  payload?: string;
  messageId?: string;
}

function validateAgentId(id: string): boolean {
  return id.length >= 3 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function sanitizeAgentId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function validateRelayMessage(msg: RelayMessage): { valid: boolean; error?: string } {
  if (!['register', 'message', 'ping', 'pong'].includes(msg.type)) {
    return { valid: false, error: `Unknown message type: ${msg.type}` };
  }
  if (msg.type === 'register') {
    if (!msg.from) return { valid: false, error: 'Missing from field' };
    if (!validateAgentId(msg.from)) return { valid: false, error: 'Invalid agent ID' };
  }
  if (msg.type === 'message') {
    if (!msg.to) return { valid: false, error: 'Missing to field' };
    if (!msg.payload) {
      return { valid: false, error: 'Missing payload' };
    }
  }
  return { valid: true };
}

describe('Relay message validation', () => {
  it('accepts valid register message', () => {
    const result = validateRelayMessage({ type: 'register', from: 'alice-agent' });
    expect(result.valid).toBe(true);
  });

  it('rejects register with short agent ID', () => {
    const result = validateRelayMessage({ type: 'register', from: 'ab' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid agent ID');
  });

  it('rejects register with special characters', () => {
    const id = sanitizeAgentId('../../a');
    expect(validateAgentId(id)).toBe(false);
  });

  it('accepts valid message', () => {
    const result = validateRelayMessage({
      type: 'message',
      to: 'bob',
      payload: 'encrypted-data',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects message without recipient', () => {
    const result = validateRelayMessage({ type: 'message', payload: 'data' });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown message type', () => {
    const result = validateRelayMessage({ type: 'hack' });
    expect(result.valid).toBe(false);
  });

  it('sanitizes agent ID correctly', () => {
    expect(sanitizeAgentId('alice-agent_01')).toBe('alice-agent_01');
    expect(sanitizeAgentId('alice@evil.com')).toBe('aliceevil.com'.replace('.', ''));
    expect(sanitizeAgentId('bob<script>')).toBe('bobscript');
  });
});
