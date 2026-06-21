/**
 * @file Security guard for decrypted payload validation.
 *
 * Protects against prompt injection, buffer abuse, and toxic payloads
 * before any decrypted content is fed into downstream reasoning loops.
 */

import { Buffer } from 'buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_MAX_PAYLOAD_BYTES = 16_384;
const LLM_INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /disregard previous instructions/i,
  /system override/i,
  /export private keys?/i,
  /bypass safety/i,
  /drop all restrictions/i,
  /shutdown safety/i,
  /forget your instructions/i,
  /you are now dan/i,
  /<\s*script/i,
  /execute arbitrary/i,
  /delete all data/i,
  /disable (?:security|guard|validation)/i,
  /run without restrictions/i,
  /override.*policy/i,
];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

export interface IRateLimitStore {
  get(agentId: string): { count: number; resetTime: number } | undefined;
  set(agentId: string, value: { count: number; resetTime: number }): void;
}

class FileRateLimitStore implements IRateLimitStore {
  private readonly filePath: string;
  private cache = new Map<string, { count: number; resetTime: number }>();
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const entries = JSON.parse(data) as Record<string, { count: number; resetTime: number }>;
      this.cache = new Map(Object.entries(entries));
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (now > value.resetTime) {
          this.cache.delete(key);
        }
      }
    } catch {
      this.cache = new Map();
    }
  }

  private persist(): void {
    if (!this.dirty) return;
    const dir = join(this.filePath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(Object.fromEntries(this.cache.entries()));
    writeFileSync(this.filePath, data, { mode: 0o600 });
    this.dirty = false;
  }

  get(agentId: string): { count: number; resetTime: number } | undefined {
    return this.cache.get(agentId);
  }

  set(agentId: string, value: { count: number; resetTime: number }): void {
    this.cache.set(agentId, value);
    this.dirty = true;
    this.persist();
  }
}

function getRateLimitStore(): IRateLimitStore {
  const production = process.env.STVOR_PRODUCTION_MODE === 'true' || process.env.NODE_ENV === 'production';
  if (production) {
    const path = process.env.STVOR_RATE_LIMIT_STORE || './data/rate-limits.json';
    return new FileRateLimitStore(path);
  }
  return new Map() as unknown as IRateLimitStore;
}

const rateLimitStore = getRateLimitStore();

export class SecurityGuard {
  static readonly MAX_PAYLOAD_BYTES = DEFAULT_MAX_PAYLOAD_BYTES;

  static assertPayloadSafe(payload: unknown): void {
    const normalized = this.normalizePayload(payload);
    const payloadString = JSON.stringify(normalized);
    const size = Buffer.byteLength(payloadString, 'utf8');

    if (size > this.MAX_PAYLOAD_BYTES) {
      throw new Error(
        `[SECURITY-ALERT] Payload too large (${size} bytes). Maximum allowed is ${this.MAX_PAYLOAD_BYTES} bytes.`,
      );
    }

    this.inspectValue(normalized, 'payload');
  }

  static assertBudgetSafe(budget: string): void {
    const amount = BigInt(budget);
    if (amount <= 0 || amount > 1_000_000_000_000n) {
      throw new Error(`[SECURITY-ALERT] Invalid budget amount: ${budget}`);
    }
  }

  static checkRateLimit(agentId: string): void {
    const now = Date.now();
    const state = rateLimitStore.get(agentId);

    if (!state || now > state.resetTime) {
      rateLimitStore.set(agentId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return;
    }

    if (state.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw new Error(`[SECURITY-ALERT] Rate limit exceeded for agent ${agentId}`);
    }

    rateLimitStore.set(agentId, { count: state.count + 1, resetTime: state.resetTime });
  }

  static assertJobIdFormat(jobId: string): void {
    if (!/^job-[\w-]+$/.test(jobId)) {
      throw new Error(`[SECURITY-ALERT] Invalid job ID format: ${jobId}`);
    }
  }

  private static normalizePayload(payload: unknown): unknown {
    if (typeof payload === 'string') {
      return this.normalizeString(payload);
    }
    if (Array.isArray(payload)) {
      return payload.map((item) => this.normalizePayload(item));
    }
    if (typeof payload === 'object' && payload !== null) {
      return Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
          this.normalizeString(key),
          this.normalizePayload(value),
        ]),
      );
    }
    return payload;
  }

  private static normalizeString(value: string): string {
    const normalized = value.normalize('NFKC').replace(/\u0000/g, '');
    if (/\p{C}/u.test(normalized)) {
      throw new Error(`[SECURITY-ALERT] Unsupported control characters in payload string`);
    }
    return normalized;
  }

  private static inspectValue(value: unknown, path: string): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      if (this.isMaliciousString(value)) {
        throw new Error(
          `[SECURITY-ALERT] Malicious injection detected in ${path}: ${value}`,
        );
      }
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return;
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        this.inspectValue(value[index], `${path}[${index}]`);
      }
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        this.inspectValue(child, `${path}.${key}`);
      }
      return;
    }

    if (typeof value === 'bigint') {
      return;
    }

    throw new Error(
      `[SECURITY-ALERT] Unsupported payload type detected in ${path}: ${typeof value}`,
    );
  }

  private static isMaliciousString(value: string): boolean {
    for (const pattern of LLM_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return true;
      }
    }
    return false;
  }
}
