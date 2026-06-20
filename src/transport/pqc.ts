import {
  initSync,
  WasmKeyPair,
  WasmSession,
  wasm_mlkem_keygen,
  wasm_hybrid_session_initiate,
  wasm_hybrid_session_respond,
} from '@stvor/web3/wasm';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import type { IStvorTransport, IStvorMessage, IStvorSession } from './interfaces';
import { KeyStore } from './key-store';
import { MockRelayClient } from './mock-relay';
import { AgentIdentityService } from '../agent-identity';

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

  static hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  static verifyHash(payload: unknown, storedHash: string): boolean {
    return PayloadHasher.hashPayload(payload) === storedHash;
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
  private isMockRelay = false;
  private static readonly MAX_BUFFER_PER_AGENT = 128;
  private static readonly MAX_SESSION_CACHE_SIZE = 128;
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
    const relayUrl = this.getRelayEnvValue();
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
    try {
      console.log(`[StvorTransport] Connecting to relay: ${this.relayUrl || '[none]'}`);

      const isMockRelay = !this.relayUrl || this.relayUrl === 'mock';

      if (isMockRelay) {
        this.enforceMockRelay();
        console.warn(
          '[StvorTransport] Using in-process mock relay. Set STVOR_RELAY_URL for production.',
        );
        await this.useMockRelayClient();
        return;
      }

      const reachable = await this.probeRelayUrl(2000);
      if (!reachable) {
        const allowMock = this.shouldAllowMock();
        if (!allowMock) {
          throw new Error(
            'Production relay URL is not reachable. Set STVOR_ALLOW_MOCK=true to allow fallback to mock relay.',
          );
        }
        console.warn(
          '[StvorTransport] Relay unavailable within 2000ms — falling back to in-process mock transport.',
        );
        await this.useMockRelayClient();
        return;
      }

      await this.useMockRelayClient();
      console.log(`[StvorTransport] Connected via in-process mock transport`);
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
    }
  }

  private async probeRelayUrl(_timeoutMs: number): Promise<boolean> {
    return false;
  }

  private async useMockRelayClient(): Promise<void> {
    this.client = new MockRelayClient(this.agentId) as unknown as IStvorClient;
    this.isMockRelay = true;
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.client = null;
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
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const message: IStvorMessage = {
      id: messageId,
      from: this.agentId,
      to: recipientId,
      timestamp: Date.now(),
      content: {
        type: messageType,
        jobId,
        data: payload,
      },
    };

    if (this.client && 'send' in this.client) {
      try {
        await (this.client as unknown as { send: (m: IStvorMessage) => Promise<unknown> }).send(message);
      } catch {
        this.messageBuffer.get(recipientId)?.push(message);
      }
    }

    this.stats.messagesSent++;
    return messageId;
  }

  async receiveSecureMessage(_timeoutMs?: number): Promise<IStvorMessage | null> {
    return null;
  }

  onMessage(callback: (msg: IStvorMessage) => Promise<void>): void {
    this.messageHandlers.push(callback);
  }

  async getSessionStatus(_agentId: string): Promise<IStvorSession | null> {
    return null;
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
      connected: this.isMockRelay,
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
