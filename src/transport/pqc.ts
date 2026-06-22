import {
  initSync,
  WasmKeyPair,
  WasmSession,
  wasm_mlkem_keygen,
  wasm_hybrid_session_initiate,
  wasm_hybrid_session_respond,
  wasm_ec_sign,
  wasm_ec_verify,
} from '@stvor/web3/wasm';
import { readFileSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { resolve } from 'path';
import type { IStvorTransport, IStvorMessage, IStvorSession } from './interfaces';
import { KeyStore } from './key-store';
import { MockRelayClient } from './mock-relay';
import { AgentIdentityService } from '../agent-identity';
import { WebSocketRelay, type IRelay, type RelayMessage } from './relay';
import { isProductionMode, requireProductionEnv, assertWssUrl } from '../core/production';

// ─── WASM init (sync, Bun/Node compatible) ───────────────────────────────────

let initialized = false;

export function ensureWasm(): void {
  if (initialized) return;
  const wasmBytes = readFileSync(
    resolve('./node_modules/@stvor/web3/dist/wasm/stvor_crypto_bg.wasm')
  );
  initSync({ module: wasmBytes });
  initialized = true;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PqcKeyPair {
  ek: string;
  dk: string;
}

export interface HybridKeyPair {
  ik: WasmKeyPair;
  spk: WasmKeyPair;
  pqc: PqcKeyPair;
}

export interface EncryptedPayload {
  mlkemCt: string;
  aliceIkPub: string;
  aliceSpkPub: string;
  ciphertext: string;
}

export class PayloadTooDeepError extends Error {
  constructor(depth: number) {
    super(`Payload nesting exceeds maximum depth of ${depth}`);
    this.name = 'PayloadTooDeepError';
  }
}

export class PqcEncryptionError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly eventId: string,
    public readonly timestamp: number,
  ) {
    super(message);
    this.name = 'PqcEncryptionError';
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented. Use onMessage() for event-driven message handling.`);
    this.name = 'NotImplementedError';
  }
}

// ─── HybridPQCTransport ──────────────────────────────────────────────────────

export class HybridPQCTransport {

  static generateKeyPair(): HybridKeyPair {
    ensureWasm();
    const ik = new WasmKeyPair();
    const spk = new WasmKeyPair();
    const pqc = JSON.parse(wasm_mlkem_keygen()) as PqcKeyPair;
    return { ik, spk, pqc };
  }

  static encryptOnce(
    aliceKeys: HybridKeyPair,
    bobIkPub: string,
    bobSpkPub: string,
    bobPqcEk: string,
    plaintext: Uint8Array
  ): EncryptedPayload {
    ensureWasm();

    const raw = JSON.parse(
      wasm_hybrid_session_initiate(
        aliceKeys.ik,
        aliceKeys.spk,
        bobIkPub,
        bobSpkPub,
        bobPqcEk
      )
    ) as { session_json: string; mlkem_ct: string };

    const session = WasmSession.from_json(raw.session_json);
    const ciphertext = session.encrypt(plaintext);

    return {
      mlkemCt: raw.mlkem_ct,
      aliceIkPub: aliceKeys.ik.public_key,
      aliceSpkPub: aliceKeys.spk.public_key,
      ciphertext,
    };
  }

  static decryptOnce(
    bobKeys: HybridKeyPair,
    payload: EncryptedPayload
  ): Uint8Array {
    ensureWasm();

    const session = wasm_hybrid_session_respond(
      bobKeys.ik,
      bobKeys.spk,
      payload.aliceIkPub,
      payload.aliceSpkPub,
      bobKeys.pqc.dk,
      payload.mlkemCt
    );

    return session.decrypt(payload.ciphertext);
  }

  static initiateSession(
    aliceKeys: HybridKeyPair,
    bobIkPub: string,
    bobSpkPub: string,
    bobPqcEk: string
  ): { session: WasmSession; mlkemCt: string } {
    ensureWasm();

    const raw = JSON.parse(
      wasm_hybrid_session_initiate(
        aliceKeys.ik,
        aliceKeys.spk,
        bobIkPub,
        bobSpkPub,
        bobPqcEk
      )
    ) as { session_json: string; mlkem_ct: string };

    return {
      session: WasmSession.from_json(raw.session_json),
      mlkemCt: raw.mlkem_ct,
    };
  }

  static respondToSession(
    bobKeys: HybridKeyPair,
    aliceIkPub: string,
    aliceSpkPub: string,
    mlkemCt: string
  ): WasmSession {
    ensureWasm();
    return wasm_hybrid_session_respond(
      bobKeys.ik,
      bobKeys.spk,
      aliceIkPub,
      aliceSpkPub,
      bobKeys.pqc.dk,
      mlkemCt
    );
  }
}

// ─── PayloadHasher ────────────────────────────────────────────────────────────

export class PayloadHasher {
  static hash(payload: unknown): string {
    return PayloadHasher.hashPayload(payload);
  }

  static verify(payload: unknown, storedHash: string): boolean {
    return PayloadHasher.verifyHash(payload, storedHash);
  }

  private static readonly MAX_STRINGIFY_DEPTH = 64;

  static stableStringify(value: unknown): string {
    const seen = new WeakSet();
    const helper = (val: unknown, depth: number): string => {
      if (depth > PayloadHasher.MAX_STRINGIFY_DEPTH) {
        throw new PayloadTooDeepError(PayloadHasher.MAX_STRINGIFY_DEPTH);
      }
      if (val === null || typeof val !== 'object') {
        return JSON.stringify(val);
      }
      if (seen.has(val)) {
        throw new Error('Circular reference detected in payload');
      }
      seen.add(val);
      if (Array.isArray(val)) {
        return '[' + val.map(v => helper(v, depth + 1)).join(',') + ']';
      }
      const keys = Object.keys(val as Record<string, unknown>).sort();
      const pairs = keys.map(k => JSON.stringify(k) + ': ' + helper((val as Record<string, unknown>)[k], depth + 1));
      return '{' + pairs.join(',') + '}';
    };
    return helper(value, 0);
  }

  static hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(PayloadHasher.stableStringify(payload))
      .digest('hex');
  }

  static verifyHash(payload: unknown, storedHash: string): boolean {
    const computed = Buffer.from(PayloadHasher.hashPayload(payload));
    const expected = Buffer.from(storedHash);
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }

  static signPayload(
    payload: unknown,
    signerKeyPair: HybridKeyPair,
  ): { hash: string; signature: string } {
    ensureWasm();
    const hash = PayloadHasher.hashPayload(payload);
    const signature = wasm_ec_sign(
      new TextEncoder().encode(hash),
      signerKeyPair.ik,
    );
    return { hash, signature };
  }

  static verifySignature(
    payload: unknown,
    hash: string,
    signature: string,
    signerPublicKey: string,
  ): boolean {
    ensureWasm();
    const computedHash = PayloadHasher.hashPayload(payload);

    const hashBytes = Buffer.from(computedHash, 'hex');
    const storedHashBytes = Buffer.from(hash, 'hex');
    
    if (hashBytes.length !== storedHashBytes.length) return false;
    if (!timingSafeEqual(hashBytes, storedHashBytes)) return false;
    
    return wasm_ec_verify(
      new TextEncoder().encode(hash),
      signature,
      signerPublicKey,
    );
  }

  hashPayload(payload: unknown): string {
    return PayloadHasher.hashPayload(payload);
  }

  verifyHash(payload: unknown, storedHash: string): boolean {
    return PayloadHasher.verifyHash(payload, storedHash);
  }
}
// ─── StvorTransportManager ───────────────────────────────────────────────────

export class StvorTransportManager implements IStvorTransport {
  private client: IStvorClient | null = null;
  private relay: IRelay | null = null;
  private agentId: string;
  private readonly selfAgentId: string;
  private appToken: string;
  private relayUrl: string;
  private keyPair: HybridKeyPair;
  private messageHandlers: Array<(msg: IStvorMessage) => Promise<void>> = [];
  private clientMessageHandler: ((msg: IStvorMessage) => Promise<void>) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageBuffer: Map<string, IStvorMessage[]> = new Map();
  private sessionCache: Map<string, IStvorSession> = new Map();
  private peerPublicKeys: Map<string, HybridKeyPair> = new Map();
  private isMockRelay = false;
  private connected = false;
  private static readonly MAX_BUFFER_PER_AGENT = 128;
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_RETRY_DELAY_MS = 1000;
  private static readonly MAX_SESSION_CACHE_SIZE = 128;
  private errorHandlers: Array<(err: Error, messageId: string, recipientId: string) => void> = [];
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    encryptionOps: 0,
  };

  constructor(config: {
    agentId: string;
    appToken: string;
    relayUrl: string;
  }) {
    this.keyPair = this.initializeKeyPairSync();
    this.agentId = config.agentId;
    this.selfAgentId = new AgentIdentityService(this.keyPair).getAgentId();
    this.appToken = config.appToken;
    this.relayUrl = config.relayUrl;

    console.log(
      `[StvorTransport] Initialized for agent: ${this.agentId} (self: ${this.selfAgentId}, relay: ${this.relayUrl})`,
    );
  }

  private initializeKeyPairSync(): HybridKeyPair {
    ensureWasm();
    return KeyStore.loadOrGenerateSync(() => HybridPQCTransport.generateKeyPair());
  }

  getAgentId(): string {
    return this.selfAgentId;
  }

  getPublicKey(): string {
    return this.keyPair.ik.public_key;
  }

  getKeyPair(): HybridKeyPair {
    return this.keyPair;
  }

  registerPeerPublicKey(agentId: string, keys: HybridKeyPair): void {
    this.peerPublicKeys.set(agentId, keys);
  }

  private shouldAllowMock(): boolean {
    const allowMock = process.env.STVOR_ALLOW_MOCK;
    return allowMock === 'true';
  }

  private getRelayEnvValue(): string | undefined {
    const url = process.env.STVOR_RELAY_URL;
    if (!url || url === 'mock') {
      return undefined;
    }
    return url;
  }

  private enforceMockRelay(): void {
    const production = isProductionMode();
    const relayUrl = this.getRelayEnvValue();

    if (production) {
      if (!relayUrl) {
        throw new Error(
          '[Production] STVOR_RELAY_URL is required in production mode. Mock relay is disabled.',
        );
      }
      assertWssUrl(relayUrl, 'STVOR_RELAY_URL');
      return;
    }

    if (!relayUrl && !this.shouldAllowMock()) {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) {
        console.warn(
          '[StvorTransport] WARNING: Production relay URL is not configured. Set STVOR_RELAY_URL or explicitly allow mock with STVOR_ALLOW_MOCK=true.',
        );
        return;
      }
      throw new Error(
        'Production relay URL is not configured. Set STVOR_RELAY_URL or explicitly allow mock with STVOR_ALLOW_MOCK=true.',
      );
    }
  }

  async connect(): Promise<void> {
    const production = isProductionMode();

    if (production) {
      requireProductionEnv('STVOR_RELAY_URL');
      assertWssUrl(this.relayUrl, 'STVOR_RELAY_URL');
      console.log('[StvorTransport] Production mode: relay URL validated.');
    }

    try {
      console.log(`[StvorTransport] Connecting to relay: ${this.relayUrl || '[none]'}`);

      const isMockRelay = !this.relayUrl || this.relayUrl === 'mock' || this.relayUrl === 'local';

      if (isMockRelay) {
        this.enforceMockRelay();
        console.warn(
          '[StvorTransport] Using in-process mock relay. Set STVOR_RELAY_URL for production.',
        );
        await this.useMockRelayClient();
        this.connected = true;
        return;
      }

      const relay = new WebSocketRelay(this.relayUrl, this.appToken, this.agentId);
      await relay.connect();
      this.relay = relay;
      this.isMockRelay = false;
      this.connected = true;
      this.client = {
        send: async (message: IStvorMessage) => {
          await relay.send(message.to, {
            to: message.to,
            payload: JSON.stringify(message),
            messageId: message.id,
          });
          return { id: message.id };
        },
      };
      relay.onMessage((message) => this.handleRelayMessage(message));
      console.log(`[StvorTransport] Connected to production relay ${this.relayUrl}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not configured')) {
        throw error;
      }
      const allowMock = this.shouldAllowMock();
      if (!allowMock) {
        throw new Error(
          `Transport connect failed: ${error instanceof Error ? error.message : String(error)}. Set STVOR_ALLOW_MOCK=true to allow mock fallback.`,
        );
      }
console.warn(
         `[StvorTransport] Transport connect failed: ${error instanceof Error ? error.message : String(error)}`,
       );
       await this.useMockRelayClient();
       this.connected = true;
     }
   }

  private handleRelayMessage(message: RelayMessage | IStvorMessage): void {
    let parsed: IStvorMessage;
    if ('payload' in message && typeof (message as RelayMessage).payload === 'string') {
      const relayMsg = message as RelayMessage;
      if (!relayMsg.payload) return;
      try {
        parsed = JSON.parse(relayMsg.payload) as IStvorMessage;
      } catch {
        const eventId = `evt-${Date.now()}-${randomBytes(4).toString('hex')}`;
        console.error(
          `[PQC-Transport] Malformed relay payload agent=${this.agentId} eventId=${eventId} timestamp=${new Date().toISOString()}`,
        );
        return;
      }
    } else {
      parsed = message as IStvorMessage;
    }
    void this.dispatchMessage(parsed);
  }

  private async dispatchMessage(message: IStvorMessage): Promise<void> {
    this.stats.messagesReceived++;
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        const eventId = `evt-${Date.now()}-${randomBytes(4).toString('hex')}`;
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(
          `[PQC-Transport] Handler error agent=${this.agentId} eventId=${eventId} timestamp=${new Date().toISOString()} messageId=${message.id} error=${err.message}`,
        );
      }
    }
  }

  private async useMockRelayClient(): Promise<void> {
    const mockClient = new MockRelayClient(this.agentId);
    await mockClient.connect();
    mockClient.onMessage((message) => this.handleRelayMessage(message));
    this.client = {
      send: async (message: IStvorMessage) => {
        await mockClient.send(message);
        return { id: message.id };
      },
    };
    this.isMockRelay = true;
  }

  private bufferMessage(recipientId: string, message: IStvorMessage): void {
    const existing = this.messageBuffer.get(recipientId) ?? [];
    if (existing.length >= StvorTransportManager.MAX_BUFFER_PER_AGENT) {
      const removed = existing.shift();
      if (removed) {
        console.warn(
          `[PQC-Transport] Buffer full for ${recipientId}, removed oldest message ${removed.id}`,
        );
      }
    }
    existing.push(message);
    this.messageBuffer.set(recipientId, existing);
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.client = null;
    this.relay?.disconnect();
    this.relay = null;
    this.messageHandlers = [];
    this.sessionCache.clear();
  }

  async sendSecurePayload(
    recipientId: string,
    jobId: string,
    messageType: 'job_prompt' | 'job_deliverable' | 'job_evaluation' | 'handshake',
    payload: Record<string, unknown>,
    _responseTimeoutMs?: number,
  ): Promise<string> {
    const messageId = `msg-${Date.now()}-${randomBytes(8).toString('hex')}`;

    const recipientKeys = this.peerPublicKeys.get(recipientId);
    if (!recipientKeys) {
      throw new PqcEncryptionError(
        `No public key available for recipient ${recipientId}. Register peer keys before sending.`,
        this.agentId,
        messageId,
        Date.now(),
      );
    }

    const payloadHash = PayloadHasher.hashPayload(payload);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = HybridPQCTransport.encryptOnce(
      this.keyPair,
      recipientKeys.ik.public_key,
      recipientKeys.spk.public_key,
      recipientKeys.pqc.ek,
      plaintext,
    );

    const message: IStvorMessage = {
      id: messageId,
      from: this.agentId,
      to: recipientId,
      timestamp: Date.now(),
      encrypted: true,
      pqcEncrypted: true,
      encryption: 'ML-KEM-768 + Double Ratchet + AES-256-GCM',
      content: {
        type: messageType,
        jobId,
        data: encrypted.ciphertext,
        encrypted: true,
        pqcEncrypted: true,
        encryption: 'ML-KEM-768 + Double Ratchet + AES-256-GCM',
        mlkemCt: encrypted.mlkemCt,
        aliceIkPub: encrypted.aliceIkPub,
        aliceSpkPub: encrypted.aliceSpkPub,
      },
      metadata: {
        payloadHash,
        version: 'pqc-v1',
      },
    };

    this.stats.encryptionOps++;

    if (this.client && 'send' in this.client) {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < StvorTransportManager.MAX_RETRIES; attempt++) {
        try {
          await (this.client as unknown as { send: (m: IStvorMessage) => Promise<unknown> }).send(message);
          this.stats.messagesSent++;
          return messageId;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < StvorTransportManager.MAX_RETRIES - 1) {
            const delay = StvorTransportManager.BASE_RETRY_DELAY_MS * 2 ** attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      const eventId = `evt-${Date.now()}-${randomBytes(4).toString('hex')}`;
      console.error(
        `[PQC-Transport] All retries failed agent=${this.agentId} eventId=${eventId} timestamp=${new Date().toISOString()} messageId=${messageId} error=${lastError?.message}`,
      );
      for (const handler of this.errorHandlers) {
        handler(lastError ?? new Error('Unknown send failure'), messageId, recipientId);
      }
      this.bufferMessage(recipientId, message);
    }

    this.stats.messagesSent++;
    return messageId;
  }

  async receiveSecureMessage(_timeoutMs?: number): Promise<IStvorMessage | null> {
    throw new NotImplementedError('receiveSecureMessage');
  }

  onMessage(callback: (msg: IStvorMessage) => Promise<void>): void {
    this.messageHandlers.push(callback);
  }

  onError(handler: (err: Error, messageId: string, recipientId: string) => void): void {
    this.errorHandlers.push(handler);
  }

  async getSessionStatus(_agentId: string): Promise<IStvorSession | null> {
    throw new NotImplementedError('getSessionStatus');
  }

  async getStatus(): Promise<{
    connected: boolean;
    agentId: string;
    relayUrl: string;
    activeSessions: number;
    messagesReceived: number;
    messagesSent: number;
  }> {
    return {
      connected: this.connected,
      agentId: this.agentId,
      relayUrl: this.relayUrl,
      activeSessions: this.sessionCache.size,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
    };
  }

  getStats(): { messagesReceived: number; messagesSent: number; encryptionOps: number } {
    return { ...this.stats };
  }

  injectMockMessage(message: IStvorMessage): void {
    setImmediate(async () => {
      for (const handler of this.messageHandlers) {
        try {
          await handler(message);
        } catch {
          // ignore handler errors
        }
      }
    });
  }
}

interface IStvorClient {
  send: (message: IStvorMessage) => Promise<unknown>;
}
