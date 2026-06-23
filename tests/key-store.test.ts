import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { KeyStore } from '../src/transport/key-store';
import { SecureAgentTransport } from '../src/transport/pqc';

const TEST_KEY_DIR = './data/test-keys';
const TEST_PASSWORD = 'test-password-123';

process.env.STVOR_KEY_DIR = TEST_KEY_DIR;
process.env.STVOR_KEY_PASSWORD = TEST_PASSWORD;

describe('KeyStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_KEY_DIR)) {
      rmSync(TEST_KEY_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_KEY_DIR)) {
      rmSync(TEST_KEY_DIR, { recursive: true });
    }
  });

  it('saves and loads a keypair correctly', () => {
    const original = SecureAgentTransport.generateKeyPair();
    KeyStore.save(original);

    const loaded = KeyStore.load();
    expect(loaded).not.toBeNull();

    if (!loaded) {
      throw new Error('Expected loaded keypair');
    }

    expect(loaded.ik.private_key).toBe(original.ik.private_key);
    expect(loaded.spk.public_key).toBe(original.spk.public_key);
  });

  it('returns null from load when no key file exists', () => {
    expect(KeyStore.load()).toBeNull();
  });

  it('returns null from exists when key file is absent', () => {
    expect(KeyStore.exists()).toBe(false);
  });

  it('loadOrGenerate creates and persists a keypair on first run', () => {
    expect(KeyStore.exists()).toBe(false);
    const kp = KeyStore.loadOrGenerate(() => SecureAgentTransport.generateKeyPair());
    expect(KeyStore.exists()).toBe(true);
    expect(typeof kp.ik.public_key).toBe('string');
    expect(kp.ik.public_key.length).toBeGreaterThan(0);
  });

  it('returns the same keypair on subsequent loadOrGenerate calls', () => {
    const kp1 = KeyStore.loadOrGenerate(() => SecureAgentTransport.generateKeyPair());
    const kp2 = KeyStore.loadOrGenerate(() => SecureAgentTransport.generateKeyPair());
    expect(kp1.ik.public_key).toBe(kp2.ik.public_key);
  });

  it('throws when decryption is attempted with the wrong password', () => {
    const kp = SecureAgentTransport.generateKeyPair();
    KeyStore.save(kp);

    process.env.STVOR_KEY_PASSWORD = 'wrong-password';
    expect(() => KeyStore.load()).toThrow();
    process.env.STVOR_KEY_PASSWORD = TEST_PASSWORD;
  });
});
