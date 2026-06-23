import { describe, it, expect } from 'bun:test';
import { SecureAgentTransport, PayloadHasher, PayloadTooDeepError } from '../src/transport/pqc';

describe('SecureAgentTransport v1', () => {
  it('generates Ed25519 + X25519 identity keys', () => {
    const kp = SecureAgentTransport.generateKeyPair();
    expect(typeof kp.agentId).toBe('string');
    expect(typeof kp.signingPublicKey).toBe('string');
    expect(typeof kp.signingPrivateKey).toBe('string');
    expect(typeof kp.encryptionPublicKey).toBe('string');
    expect(typeof kp.encryptionPrivateKey).toBe('string');
    expect(kp.agentId).toMatch(/^agent-[a-f0-9]{64}$/);
    expect(kp.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('round-trip encrypt/decrypt via AES-256-GCM', () => {
    const alice = SecureAgentTransport.generateKeyPair();
    const bob   = SecureAgentTransport.generateKeyPair();

    const message = new TextEncoder().encode(
      JSON.stringify({ jobId: 'job-test-001', task: 'Build ML pipeline' })
    );

    const encrypted = SecureAgentTransport.encryptOnce(
      alice,
      SecureAgentTransport.getPublicIdentity(bob),
      message
    );

    const decrypted = SecureAgentTransport.decryptOnce(bob, encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(message));
  });

  it('produces different ciphertexts for the same plaintext (ephemeral key per message)', () => {
    const alice = SecureAgentTransport.generateKeyPair();
    const bob   = SecureAgentTransport.generateKeyPair();
    const msg   = new TextEncoder().encode('same message');

    const enc1 = SecureAgentTransport.encryptOnce(
      alice, SecureAgentTransport.getPublicIdentity(bob), msg
    );
    const enc2 = SecureAgentTransport.encryptOnce(
      alice, SecureAgentTransport.getPublicIdentity(bob), msg
    );

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('wrong key fails decryption', () => {
    const alice = SecureAgentTransport.generateKeyPair();
    const bob   = SecureAgentTransport.generateKeyPair();
    const eve   = SecureAgentTransport.generateKeyPair();
    const msg   = new TextEncoder().encode('secret');

    const encrypted = SecureAgentTransport.encryptOnce(
      alice, SecureAgentTransport.getPublicIdentity(bob), msg
    );

    expect(() => SecureAgentTransport.decryptOnce(eve, encrypted)).toThrow();
  });

  it('rejects replayed envelopes', () => {
    const alice = SecureAgentTransport.generateKeyPair();
    const bob   = SecureAgentTransport.generateKeyPair();
    const msg = new TextEncoder().encode('replay protected');
    const encrypted = SecureAgentTransport.encryptOnce(alice, SecureAgentTransport.getPublicIdentity(bob), msg);
    expect(() => SecureAgentTransport.decryptOnce(bob, encrypted)).not.toThrow();
    expect(() => SecureAgentTransport.decryptOnce(bob, encrypted)).toThrow('Replay detected');
  });
});

describe('PayloadHasher', () => {
  it('hashes deterministically', () => {
    const p = { jobId: 'job-001', task: 'test' };
    expect(PayloadHasher.hashPayload(p)).toBe(PayloadHasher.hashPayload(p));
  });

  it('produces the same hash regardless of key order', () => {
    const reordered1 = { task: 'ml pipeline', jobId: 'job-42' };
    const reordered2 = { jobId: 'job-42', task: 'ml pipeline' };
    const canonical = { jobId: 'job-42', task: 'ml pipeline' };
    const h1 = PayloadHasher.hashPayload(reordered1);
    const h2 = PayloadHasher.hashPayload(reordered2);
    const h3 = PayloadHasher.hashPayload(canonical);
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
  });

  it('verifies correctly and rejects tampered payload', () => {
    const p = { jobId: 'job-001' };
    const h = PayloadHasher.hashPayload(p);
    expect(PayloadHasher.verifyHash(p, h)).toBe(true);
    expect(PayloadHasher.verifyHash({ jobId: 'job-002' }, h)).toBe(false);
  });

  it('signs payload and verifies signature', () => {
    const payload = { jobId: 'job-signed-test', task: 'Secure task' };
    const alice = SecureAgentTransport.generateKeyPair();

    const signed = PayloadHasher.signPayload(payload, alice);
    expect(typeof signed.hash).toBe('string');
    expect(typeof signed.signature).toBe('string');
    expect(signed.hash.length).toBe(64); // SHA-256 hex length

    expect(
      PayloadHasher.verifySignature(payload, signed.hash, signed.signature, alice.ik.public_key),
    ).toBe(true);

    expect(
      PayloadHasher.verifySignature({ jobId: 'job-fake' }, signed.hash, signed.signature, alice.ik.public_key),
    ).toBe(false);
  });

  it('rejects deeply nested payloads exceeding max depth', () => {
    let deep = { a: 1 };
    for (let i = 0; i < 100; i++) {
      deep = { nested: deep };
    }
    expect(() => PayloadHasher.hashPayload(deep)).toThrow(PayloadTooDeepError);
  });
});
