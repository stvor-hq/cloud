import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
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

const MASK64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;

const ROTATIONS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

let wasmInitialized = false;

function ensureWasm(): void {
  if (wasmInitialized) return;
  const wasmBytes = readFileSync(
    resolve('./node_modules/@stvor/web3/dist/wasm/stvor_crypto_bg.wasm')
  );
  initSync({ module: wasmBytes });
  wasmInitialized = true;
}

function rotl(x: bigint, n: number): bigint {
  const shift = BigInt(n % 64);
  if (shift === 0n) return x;
  return ((x << shift) | (x >> (64n - shift))) & MASK64;
}

function keccakF(state: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    const c = Array.from({ length: 5 }, (_, x) =>
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    );
    const d = Array.from({ length: 5 }, (_, x) =>
      c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
    );

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] ^= d[x];
      }
    }

    const b = Array.from({ length: 25 }, () => 0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const rotation = ROTATIONS[x][y];
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], rotation);
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const index = x + 5 * y;
        state[index] = b[index] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
      }
    }

    state[0] ^= ROUND_CONSTANTS[round];
  }
}

function absorbBlocks(message: Uint8Array): bigint[] {
  const state = Array.from({ length: 25 }, () => 0n);

  for (let offset = 0; offset < message.length; offset += RATE_BYTES) {
    const block = message.subarray(offset, offset + RATE_BYTES);
    for (let i = 0; i < block.length; i += 8) {
      let lane = 0n;
      for (let j = 0; j < 8 && i + j < block.length; j += 1) {
        lane |= BigInt(block[i + j]) << (8n * BigInt(j));
      }
      state[i / 8] ^= lane;
    }
    keccakF(state);
  }

  return state;
}

export function keccak256(input: Uint8Array | string): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  const padded = new Uint8Array(bytes.length + RATE_BYTES);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[RATE_BYTES - 1] ^= 0x80;

  const state = absorbBlocks(padded);
  const output = Buffer.alloc(32);

  for (let laneIndex = 0; laneIndex < 4; laneIndex += 1) {
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      const outIndex = laneIndex * 8 + byteIndex;
      if (outIndex >= output.length) break;
      output[outIndex] = Number((state[laneIndex] >> (8n * BigInt(byteIndex))) & 0xffn);
    }
  }

  return output.toString('hex');
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
