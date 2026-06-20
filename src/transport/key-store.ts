import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WasmKeyPair } from '@stvor/web3/wasm';
import { ensureWasm } from './pqc.js';
import type { HybridKeyPair } from './pqc.js';

function getKeyDir(): string {
  return process.env.STVOR_KEY_DIR ?? './data/keys';
}

function getKeyFile(): string {
  return join(getKeyDir(), 'agent-keypair.enc');
}

function getPasswordFile(): string {
  return join(process.cwd(), '.stvor_key_pass');
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

function serializeKeyPair(kp: HybridKeyPair): Record<string, string> {
  return {
    ikPriv:  kp.ik.private_key,
    ikPub:   kp.ik.public_key,
    spkPriv: kp.spk.private_key,
    spkPub:  kp.spk.public_key,
    pqcEk:   kp.pqc.ek,
    pqcDk:   kp.pqc.dk,
  };
}

function deserializeKeyPair(data: Record<string, string>): HybridKeyPair {
  ensureWasm();
  return {
    ik:  WasmKeyPair.from_private_key(data.ikPriv),
    spk: WasmKeyPair.from_private_key(data.spkPriv),
    pqc: { ek: data.pqcEk, dk: data.pqcDk },
  };
}

function getPasswordFromEnvOrFile(): string | null {
  const envPassword = process.env.STVOR_KEY_PASSWORD;
  if (envPassword) {
    return envPassword;
  }

  const passwordFile = getPasswordFile();
  if (existsSync(passwordFile)) {
    return readFileSync(passwordFile, 'utf8').trim();
  }

  return null;
}

function generateAndStorePassword(): string {
  const password = randomBytes(32).toString('hex');
  const passwordFile = getPasswordFile();
  writeFileSync(passwordFile, password, { mode: 0o600 });
  return password;
}

export class KeyStore {
  static save(keyPair: HybridKeyPair): void {
    const envPassword = process.env.STVOR_KEY_PASSWORD;
    const filePassword = getPasswordFromEnvOrFile();
    let pwd: string | undefined = envPassword ?? filePassword ?? undefined;
    if (!pwd) {
      pwd = generateAndStorePassword();
      console.warn(
        '[KeyStore] WARNING: No STVOR_KEY_PASSWORD set. Generated a random password and stored it in .stvor_key_pass. Add this file to .gitignore and keep it safe.',
      );
    }

    if (!existsSync(getKeyDir())) mkdirSync(getKeyDir(), { recursive: true });

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(pwd, salt);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(serializeKeyPair(keyPair));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const combined = Buffer.concat([salt, iv, tag, encrypted]);
    writeFileSync(getKeyFile(), combined);
    console.log(`[KeyStore] Keys saved to ${getKeyFile()}`);
  }

  static load(): HybridKeyPair | null {
    if (!existsSync(getKeyFile())) return null;

    const password: string | undefined = process.env.STVOR_KEY_PASSWORD ?? getPasswordFromEnvOrFile() ?? undefined;
    if (!password) {
      throw new Error(
        'STVOR_KEY_PASSWORD not set and no stored password found. Set the environment variable or ensure .stvor_key_pass exists.',
      );
    }
    const combined = readFileSync(getKeyFile());

    const salt = combined.subarray(0, 16);
    const iv = combined.subarray(16, 28);
    const tag = combined.subarray(28, 44);
    const ciphertext = combined.subarray(44);

    const key = deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return deserializeKeyPair(JSON.parse(plaintext) as Record<string, string>);
  }

  static loadPassword(): string {
    return getPasswordFromEnvOrFile() ?? generateAndStorePassword();
  }

  static loadOrGenerate(generateFn: () => HybridKeyPair): HybridKeyPair {
    const existing = KeyStore.load();
    if (existing) {
      console.log('[KeyStore] Loaded existing keypair from disk.');
      return existing;
    }
    console.log('[KeyStore] No keypair found. Generating new keypair...');
    const newKeyPair = generateFn();
    KeyStore.save(newKeyPair);
    return newKeyPair;
  }

  static loadOrGenerateSync(generateFn: () => HybridKeyPair): HybridKeyPair {
    const existing = KeyStore.load();
    if (existing) {
      console.log('[KeyStore] Loaded existing keypair from disk.');
      return existing;
    }
    console.log('[KeyStore] No keypair found. Generating new keypair...');
    const newKeyPair = generateFn();
    KeyStore.save(newKeyPair);
    return newKeyPair;
  }

  static exists(): boolean {
    return existsSync(getKeyFile());
  }
}
