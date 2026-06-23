import { randomBytes } from 'crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { ed25519Sign, ed25519Verify, type SecureIdentityKeyPair } from './transport/pqc';

export interface AgentChallenge {
  challenge: string;
  publicKey: string;
  expiresAt: number;
  createdAt: number;
}

export interface AgentIdentity {
  agentId: string;
  publicKey: string;
}

export function keccak256(input: Uint8Array | string): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  return Buffer.from(keccak_256(bytes)).toString('hex');
}

export function deriveAgentIdFromPublicKey(publicKey: string): string {
  if (publicKey.trim().length === 0) {
    throw new Error('Public key is required to derive agent ID');
  }
  return `agent-${keccak256(publicKey)}`;
}

export function signChallenge(challenge: string, keyPair: SecureIdentityKeyPair): string {
  return ed25519Sign(new TextEncoder().encode(challenge), keyPair);
}

export function verifyChallenge(
  challenge: string,
  signature: string,
  publicKey: string
): boolean {
  return ed25519Verify(new TextEncoder().encode(challenge), signature, publicKey);
}

export function verifyAgentChallenge(
  challenge: string,
  signature: string,
  publicKey: string
): boolean {
  return verifyChallenge(challenge, signature, publicKey);
}

export class AgentIdentityService {
  private readonly agentId: string;

  constructor(private readonly keyPair: SecureIdentityKeyPair) {
    this.agentId = deriveAgentIdFromPublicKey(keyPair.ik.public_key);
  }

  getAgentId(): string {
    return this.agentId;
  }

  getPublicKey(): string {
    return this.keyPair.ik.public_key;
  }

  createChallenge(publicKey = this.getPublicKey(), ttlMs = 5 * 60 * 1000): AgentChallenge {
    const now = Date.now();
    const randomComponent = randomBytes(16).toString('hex');
    return {
      challenge: `stvor-${now}-${randomComponent}`,
      publicKey,
      expiresAt: now + ttlMs,
      createdAt: now,
    };
  }

  signChallenge(challenge: string): string {
    return signChallenge(challenge, this.keyPair);
  }

  verifyChallenge(challenge: string, signature: string, publicKey = this.getPublicKey()): boolean {
    return verifyChallenge(challenge, signature, publicKey);
  }
}
