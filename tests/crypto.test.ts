import { describe, it, expect, beforeAll } from 'bun:test';
import { HybridPQCTransport, PayloadHasher, ensureWasm } from '../src/transport/pqc';

beforeAll(() => {
  ensureWasm();
});

describe('HybridPQCTransport (@stvor/web3 Rust/WASM)', () => {

  it('generates hybrid keypair (P-256 IK + SPK + ML-KEM-768)', () => {
    const kp = HybridPQCTransport.generateKeyPair();
    expect(typeof kp.ik.public_key).toBe('string');
    expect(typeof kp.spk.public_key).toBe('string');
    expect(typeof kp.pqc.ek).toBe('string');
    expect(typeof kp.pqc.dk).toBe('string');
    expect(kp.pqc.ek.length).toBeGreaterThan(1000);
    expect(kp.pqc.dk.length).toBeGreaterThan(60);
  });

  it('round-trip encrypt/decrypt via Double Ratchet', () => {
    const alice = HybridPQCTransport.generateKeyPair();
    const bob   = HybridPQCTransport.generateKeyPair();

    const message = new TextEncoder().encode(
      JSON.stringify({ jobId: 'job-test-001', task: 'Build ML pipeline' })
    );

    const encrypted = HybridPQCTransport.encryptOnce(
      alice,
      bob.ik.public_key,
      bob.spk.public_key,
      bob.pqc.ek,
      message
    );

    const decrypted = HybridPQCTransport.decryptOnce(bob, encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(message));
  });

  it('IND-CPA: different ciphertexts for same plaintext', () => {
    const alice = HybridPQCTransport.generateKeyPair();
    const bob   = HybridPQCTransport.generateKeyPair();
    const msg   = new TextEncoder().encode('same message');

    const enc1 = HybridPQCTransport.encryptOnce(
      alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, msg
    );
    const enc2 = HybridPQCTransport.encryptOnce(
      alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, msg
    );

    expect(enc1.mlkemCt).not.toBe(enc2.mlkemCt);
  });

  it('wrong key fails decryption', () => {
    const alice = HybridPQCTransport.generateKeyPair();
    const bob   = HybridPQCTransport.generateKeyPair();
    const eve   = HybridPQCTransport.generateKeyPair();
    const msg   = new TextEncoder().encode('secret');

    const encrypted = HybridPQCTransport.encryptOnce(
      alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, msg
    );

    expect(() => HybridPQCTransport.decryptOnce(eve, encrypted)).toThrow();
  });

  it('Double Ratchet: persistent session, 3 sequential messages', () => {
    const alice = HybridPQCTransport.generateKeyPair();
    const bob   = HybridPQCTransport.generateKeyPair();

    const { session: aliceSession, mlkemCt } = HybridPQCTransport.initiateSession(
      alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek
    );
    const bobSession = HybridPQCTransport.respondToSession(
      bob, alice.ik.public_key, alice.spk.public_key, mlkemCt
    );

    for (const text of ['msg one', 'msg two', 'msg three']) {
      const ct = aliceSession.encrypt(new TextEncoder().encode(text));
      const pt = bobSession.decrypt(ct);
      expect(new TextDecoder().decode(pt)).toBe(text);
    }
  });

  it('ML-KEM-768 ek is 1184 bytes (NIST FIPS 203)', () => {
    const kp = HybridPQCTransport.generateKeyPair();
    const ekBytes = Math.floor(kp.pqc.ek.length * 0.75);
    expect(ekBytes).toBeGreaterThanOrEqual(1180);
    expect(ekBytes).toBeLessThanOrEqual(1190);
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
    const alice = HybridPQCTransport.generateKeyPair();
    
    const signed = PayloadHasher.signPayload(payload, alice);
    expect(typeof signed.hash).toBe('string');
    expect(typeof signed.signature).toBe('string');
    expect(signed.hash.length).toBe(64); // SHA-256 hex length
    
    // Verify the signature with correct public key
    expect(
      PayloadHasher.verifySignature(payload, signed.hash, signed.signature, alice.ik.public_key),
    ).toBe(true);
    
    // Verify fails with tampered payload
    expect(
      PayloadHasher.verifySignature({ jobId: 'job-fake' }, signed.hash, signed.signature, alice.ik.public_key),
    ).toBe(false);
  });
});
