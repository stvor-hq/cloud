import { describe, expect, it } from 'bun:test';
import {
  AgentIdentityService,
  deriveAgentIdFromPublicKey,
  keccak256,
  verifyChallenge,
} from '../src/agent-identity';
import { SecureAgentTransport } from '../src/transport/pqc';

describe('agent identity', () => {
  it('derives the same Agent ID from the same public key', () => {
    const keyPair = SecureAgentTransport.generateKeyPair();
    const first = deriveAgentIdFromPublicKey(keyPair.ik.public_key);
    const second = deriveAgentIdFromPublicKey(keyPair.ik.public_key);

    expect(first).toBe(second);
    expect(first).toMatch(/^agent-[a-f0-9]{64}$/);
  });

  it('matches the Keccak-256 empty-string test vector', () => {
    expect(keccak256('')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });

  it('signs and verifies a challenge with the stored identity key', () => {
    const keyPair = SecureAgentTransport.generateKeyPair();
    const service = new AgentIdentityService(keyPair);
    const challenge = service.createChallenge();
    const signature = service.signChallenge(challenge.challenge);

    expect(service.verifyChallenge(challenge.challenge, signature)).toBe(true);
    expect(verifyChallenge(challenge.challenge, signature, keyPair.ik.public_key)).toBe(true);
  });
});
