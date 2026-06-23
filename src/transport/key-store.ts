import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, scryptSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isProductionMode } from '../core/production.js';
import type { SecureIdentityKeyPair } from './pqc.js';

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

function serializeKeyPair(kp: SecureIdentityKeyPair): Record<string, string> {
  return {
    agentId: kp.agentId,
    signingPublicKey: kp.signingPublicKey,
    signingPrivateKey: kp.signingPrivateKey,
    encryptionPublicKey: kp.encryptionPublicKey,
    encryptionPrivateKey: kp.encryptionPrivateKey,
    fingerprint: kp.fingerprint,
    ikPriv: kp.ik.private_key,
    ikPub: kp.ik.public_key,
    spkPriv: kp.spk.private_key,
    spkPub: kp.spk.public_key,
  };
}

function deserializeKeyPair(data: Record<string, string>): SecureIdentityKeyPair {
  if (!data.signingPublicKey || !data.signingPrivateKey || !data.encryptionPublicKey || !data.encryptionPrivateKey) {
    throw new Error('Unsupported legacy key format');
  }
  createPublicKey({ key: Buffer.from(data.signingPublicKey, 'base64url'), type: 'spki', format: 'der' });
  createPrivateKey({ key: Buffer.from(data.signingPrivateKey, 'base64url'), type: 'pkcs8', format: 'der' });
  createPublicKey({ key: Buffer.from(data.encryptionPublicKey, 'base64url'), type: 'spki', format: 'der' });
  createPrivateKey({ key: Buffer.from(data.encryptionPrivateKey, 'base64url'), type: 'pkcs8', format: 'der' });
  const agentId = data.agentId ?? `agent-${createHash('sha256').update(data.signingPublicKey).digest('hex')}`;
  const fingerprint = data.fingerprint
    ?? createHash('sha256')
      .update(`sat-v1:${data.signingPublicKey}:${data.encryptionPublicKey}`)
      .digest('hex');
  return {
    agentId,
    signingPublicKey: data.signingPublicKey,
    signingPrivateKey: data.signingPrivateKey,
    encryptionPublicKey: data.encryptionPublicKey,
    encryptionPrivateKey: data.encryptionPrivateKey,
    fingerprint,
    ik: { public_key: data.signingPublicKey, private_key: data.signingPrivateKey },
    spk: { public_key: data.encryptionPublicKey, private_key: data.encryptionPrivateKey },
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
  static save(keyPair: SecureIdentityKeyPair): void {
    const envPassword = process.env.STVOR_KEY_PASSWORD;
    const filePassword = getPasswordFromEnvOrFile();
    let pwd: string | undefined = envPassword ?? filePassword ?? undefined;

    if (!pwd) {
      if (isProductionMode()) {
        throw new Error(
          '[Production] STVOR_KEY_PASSWORD is required in production mode. Auto-generation is disabled.',
        );
      }
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

  static load(): SecureIdentityKeyPair | null {
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
    try {
      return deserializeKeyPair(JSON.parse(plaintext) as Record<string, string>);
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('Unsupported legacy key format') ||
        error.message.includes('Failed to read asymmetric key')
      )) {
        return null;
      }
      throw error;
    }
  }

  static loadPassword(): string {
    return getPasswordFromEnvOrFile() ?? generateAndStorePassword();
  }

  static loadOrGenerate(generateFn: () => SecureIdentityKeyPair): SecureIdentityKeyPair {
    const existing = KeyStore.load();
    if (existing) {
      console.log('[KeyStore] Loaded existing keypair from disk.');
      return existing;
    }
    if (isProductionMode()) {
      throw new Error(
        '[Production] STVOR_KEY_PASSWORD is required in production mode. Cannot auto-generate keypair without password.',
      );
    }
    console.log('[KeyStore] No keypair found. Generating new keypair...');
    const newKeyPair = generateFn();
    KeyStore.save(newKeyPair);
    return newKeyPair;
  }

  static loadOrGenerateSync(generateFn: () => SecureIdentityKeyPair): SecureIdentityKeyPair {
    return KeyStore.loadOrGenerate(generateFn);
  }

  static exists(): boolean {
    return existsSync(getKeyFile());
  }
}
