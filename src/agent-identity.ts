import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { initSync, wasm_ec_sign, wasm_ec_verify, type WasmKeyPair } from '@stvor/web3/wasm';

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

interface HybridKeyPairLike {
  ik: WasmKeyPair;
}

let wasmInitialized = false;

function ensureWasm(): void {
  if (wasmInitialized) return;
  const wasmBytes = readFileSync(
    resolve('./node_modules/@stvor/web3/dist/wasm/stvor_crypto_bg.wasm')
  );
  initSync({ module: wasmBytes });
  wasmInitialized = true;
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

export function signChallenge(challenge: string, keyPair: HybridKeyPairLike): string {
  ensureWasm();
  return wasm_ec_sign(new TextEncoder().encode(challenge), keyPair.ik);
}

export function verifyChallenge(
  challenge: string,
  signature: string,
  publicKey: string
): boolean {
  ensureWasm();
  return wasm_ec_verify(new TextEncoder().encode(challenge), signature, publicKey);
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

  constructor(private readonly keyPair: HybridKeyPairLike) {
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
