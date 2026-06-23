import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createCipheriv,
  createDecipheriv,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'crypto';
import type { IStvorMessage, IStvorSession, IStvorTransport } from './interfaces';
import { KeyStore } from './key-store';
import { MockRelayClient } from './mock-relay';
import { WebSocketRelay, type IRelay, type RelayMessage } from './relay';
import { isProductionMode, requireProductionEnv, assertWssUrl } from '../core/production';
import { AuditLogger } from '../core/audit-log';

const PROTOCOL_VERSION = 'sat-v1';
const ALGORITHM = 'Ed25519 + X25519 + HKDF-SHA256 + AES-256-GCM';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SEEN_NONCES_PER_SESSION = 4096;

function toBase64Url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function exportPublicKey(key: KeyObject): string {
  return toBase64Url(key.export({ type: 'spki', format: 'der' }) as Buffer);
}

function exportPrivateKey(key: KeyObject): string {
  return toBase64Url(key.export({ type: 'pkcs8', format: 'der' }) as Buffer);
}

export function importPublicKey(encoded: string, _algorithm: 'ed25519' | 'x25519'): KeyObject {
  return createPublicKey({
    key: fromBase64Url(encoded),
    type: 'spki',
    format: 'der',
  });
}

export function importPrivateKey(encoded: string, _algorithm: 'ed25519' | 'x25519'): KeyObject {
  return createPrivateKey({
    key: fromBase64Url(encoded),
    type: 'pkcs8',
    format: 'der',
  });
}

function stableStringify(value: unknown): string {
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
      return `[${val.map((item) => helper(item, depth + 1)).join(',')}]`;
    }
    const entries = Object.entries(val as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${helper(child, depth + 1)}`);
    return `{${entries.join(',')}}`;
  };
  return helper(value, 0);
}

export interface SecureIdentityKeyPair {
  agentId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  fingerprint: string;
  ik: { public_key: string; private_key: string };
  spk: { public_key: string; private_key: string };
}

export interface SecureIdentityPublic {
  agentId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  fingerprint: string;
}

export interface SecureEnvelope {
  version: typeof PROTOCOL_VERSION;
  algorithm: typeof ALGORITHM;
  senderId: string;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
  recipientId: string;
  recipientSigningPublicKey: string;
  recipientEncryptionPublicKey: string;
  timestamp: number;
  expiresAt: number;
  sessionId: string;
  nonce: string;
  ephemeralPublicKey: string;
  ciphertext: string;
  tag: string;
  aad: string;
  payloadHash: string;
  signature: string;
}

export interface DecryptedSecureMessage {
  payload: unknown;
  senderId: string;
  recipientId: string;
  sessionId: string;
  payloadHash: string;
}

interface SessionReplayState {
  expiresAt: number;
  seenNonces: Set<string>;
  order: string[];
}

export class PayloadTooDeepError extends Error {
  constructor(depth: number) {
    super(`Payload nesting exceeds maximum depth of ${depth}`);
    this.name = 'PayloadTooDeepError';
  }
}

export class SecureTransportError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly eventId: string,
    public readonly timestamp: number,
  ) {
    super(message);
    this.name = 'SecureTransportError';
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented. Use onMessage() for event-driven message handling.`);
    this.name = 'NotImplementedError';
  }
}

export class PayloadHasher {
  static readonly MAX_STRINGIFY_DEPTH = 64;

  static hash(payload: unknown): string {
    return PayloadHasher.hashPayload(payload);
  }

  static verify(payload: unknown, storedHash: string): boolean {
    return PayloadHasher.verifyHash(payload, storedHash);
  }

  static stableStringify(value: unknown): string {
    return stableStringify(value);
  }

  static hashPayload(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  static verifyHash(payload: unknown, storedHash: string): boolean {
    const computed = Buffer.from(PayloadHasher.hashPayload(payload));
    const expected = Buffer.from(storedHash);
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }

  static signPayload(
    payload: unknown,
    signerKeyPair: SecureIdentityKeyPair,
  ): { hash: string; signature: string } {
    const hash = PayloadHasher.hashPayload(payload);
    return {
      hash,
      signature: ed25519Sign(Buffer.from(hash, 'utf8'), signerKeyPair),
    };
  }

  static verifySignature(
    payload: unknown,
    hash: string,
    signature: string,
    signerPublicKey: string,
  ): boolean {
    const computedHash = PayloadHasher.hashPayload(payload);
    const computed = Buffer.from(computedHash);
    const expected = Buffer.from(hash);
    if (computed.length !== expected.length || !timingSafeEqual(computed, expected)) {
      return false;
    }
    return verify(
      null,
      Buffer.from(hash, 'utf8'),
      importPublicKey(signerPublicKey, 'ed25519'),
      fromBase64Url(signature),
    );
  }

  hashPayload(payload: unknown): string {
    return PayloadHasher.hashPayload(payload);
  }

  verifyHash(payload: unknown, storedHash: string): boolean {
    return PayloadHasher.verifyHash(payload, storedHash);
  }
}

function publicIdentity(identity: SecureIdentityKeyPair): SecureIdentityPublic {
  return {
    agentId: identity.agentId,
    signingPublicKey: identity.signingPublicKey,
    encryptionPublicKey: identity.encryptionPublicKey,
    fingerprint: identity.fingerprint,
  };
}

export function ed25519Sign(message: Uint8Array, keyPair: Pick<SecureIdentityKeyPair, 'signingPrivateKey'> | { private_key: string }): string {
  const privateKey = 'signingPrivateKey' in keyPair ? keyPair.signingPrivateKey : keyPair.private_key;
  const signature = sign(null, message, importPrivateKey(privateKey, 'ed25519'));
  return toBase64Url(signature);
}

export function ed25519Verify(
  message: Uint8Array,
  signature: string,
  publicKey: string | { public_key: string },
): boolean {
  const key = typeof publicKey === 'string' ? publicKey : publicKey.public_key;
  return verify(null, message, importPublicKey(key, 'ed25519'), fromBase64Url(signature));
}

function deriveAgentId(signingPublicKey: string): string {
  return `agent-${createHash('sha256').update(signingPublicKey).digest('hex')}`;
}

function deriveFingerprint(signingPublicKey: string, encryptionPublicKey: string): string {
  return createHash('sha256')
    .update(`${PROTOCOL_VERSION}:${signingPublicKey}:${encryptionPublicKey}`)
    .digest('hex');
}

function deriveSessionId(senderId: string, recipientId: string, ephemeralPublicKey: string, recipientPublicKey: string): string {
  return createHash('sha256')
    .update(`${PROTOCOL_VERSION}:${senderId}:${recipientId}:${ephemeralPublicKey}:${recipientPublicKey}`)
    .digest('hex');
}

function deriveAeadKey(sharedSecret: Buffer, sessionId: string, aad: string): Buffer {
  const key = hkdfSync('sha256', sharedSecret, Buffer.from(sessionId, 'utf8'), Buffer.from(aad, 'utf8'), 32);
  return Buffer.from(key);
}

function envelopeSigningInput(envelope: Omit<SecureEnvelope, 'signature'>): Buffer {
  return Buffer.from(stableStringify(envelope), 'utf8');
}

function verifyPublicIdentity(identity: SecureIdentityPublic): void {
  const expectedAgentId = deriveAgentId(identity.signingPublicKey);
  if (identity.agentId !== expectedAgentId) {
    throw new Error(`Agent ID does not match signing key fingerprint for ${identity.agentId}`);
  }
  const expectedFingerprint = deriveFingerprint(identity.signingPublicKey, identity.encryptionPublicKey);
  if (identity.fingerprint !== expectedFingerprint) {
    throw new Error(`Identity fingerprint does not match key material for ${identity.agentId}`);
  }
}

export class SecureAgentTransport {
  private static replayState = new Map<string, SessionReplayState>();

  static readonly protocolVersion = PROTOCOL_VERSION;
  static readonly algorithm = ALGORITHM;

  static generateKeyPair(): SecureIdentityKeyPair {
    const signing = generateKeyPairSync('ed25519');
    const encryption = generateKeyPairSync('x25519');
    const signingPublicKey = exportPublicKey(signing.publicKey);
    const encryptionPublicKey = exportPublicKey(encryption.publicKey);
    const agentId = deriveAgentId(signingPublicKey);
    return {
      agentId,
      signingPublicKey,
      signingPrivateKey: exportPrivateKey(signing.privateKey),
      encryptionPublicKey,
      encryptionPrivateKey: exportPrivateKey(encryption.privateKey),
      fingerprint: deriveFingerprint(signingPublicKey, encryptionPublicKey),
      ik: { public_key: signingPublicKey, private_key: exportPrivateKey(signing.privateKey) },
      spk: { public_key: encryptionPublicKey, private_key: exportPrivateKey(encryption.privateKey) },
    };
  }

  static getPublicIdentity(identity: SecureIdentityKeyPair): SecureIdentityPublic {
    return publicIdentity(identity);
  }

  static resetReplayStateForTests(): void {
    SecureAgentTransport.replayState.clear();
  }

  static encryptOnce(
    sender: SecureIdentityKeyPair,
    recipientOrIkPub: SecureIdentityPublic | string,
    recipientSpkOrPlaintext: string | Uint8Array,
    recipientPqcOrMetadata?: string | Record<string, unknown>,
    plaintextMaybe?: Uint8Array,
  ): SecureEnvelope {
    const legacyRecipient = typeof recipientOrIkPub === 'string';
    const recipient: SecureIdentityPublic = legacyRecipient
      ? {
          agentId: deriveAgentId(recipientOrIkPub),
          signingPublicKey: recipientOrIkPub,
          encryptionPublicKey: typeof recipientSpkOrPlaintext === 'string'
            ? recipientSpkOrPlaintext
            : sender.encryptionPublicKey,
          fingerprint: deriveFingerprint(
            recipientOrIkPub,
            typeof recipientSpkOrPlaintext === 'string' ? recipientSpkOrPlaintext : sender.encryptionPublicKey,
          ),
        }
      : recipientOrIkPub;
    const plaintext = legacyRecipient
      ? (plaintextMaybe ?? new Uint8Array())
      : (recipientSpkOrPlaintext as Uint8Array);
    const metadata = legacyRecipient
      ? (typeof recipientPqcOrMetadata === 'object' && recipientPqcOrMetadata !== null ? recipientPqcOrMetadata : {})
      : (typeof recipientPqcOrMetadata === 'object' && recipientPqcOrMetadata !== null ? recipientPqcOrMetadata : {});
    verifyPublicIdentity(recipient);
    const ephemeral = generateKeyPairSync('x25519');
    const ephemeralPublicKey = exportPublicKey(ephemeral.publicKey);
    const sessionId = deriveSessionId(
      sender.agentId,
      recipient.agentId,
      ephemeralPublicKey,
      recipient.encryptionPublicKey,
    );
    const nonce = randomBytes(12);
    const timestamp = Date.now();
    const expiresAt = timestamp + SESSION_TTL_MS;
    const aadObject = {
      version: PROTOCOL_VERSION,
      algorithm: ALGORITHM,
      senderId: sender.agentId,
      senderSigningPublicKey: sender.signingPublicKey,
      senderEncryptionPublicKey: sender.encryptionPublicKey,
      recipientId: recipient.agentId,
      recipientSigningPublicKey: recipient.signingPublicKey,
      recipientEncryptionPublicKey: recipient.encryptionPublicKey,
      timestamp,
      expiresAt,
      sessionId,
      nonce: toBase64Url(nonce),
      metadata,
    };
    const aad = stableStringify(aadObject);
    const sharedSecret = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: importPublicKey(recipient.encryptionPublicKey, 'x25519'),
    });
    const key = deriveAeadKey(sharedSecret, sessionId, aad);
    const cipher = awaitlessCreateCipher(key, nonce, aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const unsigned: Omit<SecureEnvelope, 'signature'> = {
      version: PROTOCOL_VERSION,
      algorithm: ALGORITHM,
      senderId: sender.agentId,
      senderSigningPublicKey: sender.signingPublicKey,
      senderEncryptionPublicKey: sender.encryptionPublicKey,
      recipientId: recipient.agentId,
      recipientSigningPublicKey: recipient.signingPublicKey,
      recipientEncryptionPublicKey: recipient.encryptionPublicKey,
      timestamp,
      expiresAt,
      sessionId,
      nonce: toBase64Url(nonce),
      ephemeralPublicKey,
      ciphertext: toBase64Url(ciphertext),
      tag: toBase64Url(tag),
      aad,
      payloadHash: createHash('sha256').update(plaintext).digest('hex'),
    };
    const signature = sign(
      null,
      envelopeSigningInput(unsigned),
      importPrivateKey(sender.signingPrivateKey, 'ed25519'),
    );
    return { ...unsigned, signature: toBase64Url(signature) };
  }

  static decryptOnce(
    recipient: SecureIdentityKeyPair,
    senderOrEnvelope: SecureIdentityPublic | SecureEnvelope,
    envelopeOrOptions?: SecureEnvelope | { trackReplay?: boolean },
    maybeOptions: { trackReplay?: boolean } = {},
  ): Uint8Array {
    const sender: SecureIdentityPublic = 'version' in senderOrEnvelope
      ? {
          agentId: senderOrEnvelope.senderId,
          signingPublicKey: senderOrEnvelope.senderSigningPublicKey,
          encryptionPublicKey: senderOrEnvelope.senderEncryptionPublicKey,
          fingerprint: deriveFingerprint(
            senderOrEnvelope.senderSigningPublicKey,
            senderOrEnvelope.senderEncryptionPublicKey,
          ),
        }
      : senderOrEnvelope;
    const envelope = 'version' in senderOrEnvelope
      ? senderOrEnvelope
      : (envelopeOrOptions as SecureEnvelope);
    const options = 'version' in senderOrEnvelope
      ? (envelopeOrOptions as { trackReplay?: boolean } | undefined) ?? {}
      : maybeOptions;
    verifyPublicIdentity(sender);
    if (envelope.version !== PROTOCOL_VERSION) {
      throw new SecureTransportError(`Unsupported protocol version: ${envelope.version}`, recipient.agentId, envelope.sessionId, Date.now());
    }
    if (envelope.algorithm !== ALGORITHM) {
      throw new SecureTransportError(`Unsupported algorithm: ${envelope.algorithm}`, recipient.agentId, envelope.sessionId, Date.now());
    }
    if (envelope.senderId !== sender.agentId || envelope.recipientId !== recipient.agentId) {
      throw new SecureTransportError('Envelope sender or recipient does not match verified identities', recipient.agentId, envelope.sessionId, Date.now());
    }
    const expectedSessionId = deriveSessionId(
      envelope.senderId,
      envelope.recipientId,
      envelope.ephemeralPublicKey,
      envelope.recipientEncryptionPublicKey,
    );
    if (envelope.sessionId !== expectedSessionId) {
      throw new SecureTransportError('Session ID does not match envelope key material', recipient.agentId, envelope.sessionId, Date.now());
    }
    const now = Date.now();
    if (Math.abs(now - envelope.timestamp) > REPLAY_WINDOW_MS || now > envelope.expiresAt) {
      throw new SecureTransportError('Envelope timestamp is outside the allowed replay window', recipient.agentId, envelope.sessionId, now);
    }
    const unsigned = { ...envelope };
    delete (unsigned as Partial<SecureEnvelope>).signature;
    const signatureOk = verify(
      null,
      envelopeSigningInput(unsigned as Omit<SecureEnvelope, 'signature'>),
      importPublicKey(sender.signingPublicKey, 'ed25519'),
      fromBase64Url(envelope.signature),
    );
    if (!signatureOk) {
      throw new SecureTransportError('Envelope signature verification failed', recipient.agentId, envelope.sessionId, now);
    }
    if (options.trackReplay !== false) {
      SecureAgentTransport.trackReplay(envelope.sessionId, envelope.nonce, envelope.expiresAt);
    }
    const sharedSecret = diffieHellman({
      privateKey: importPrivateKey(recipient.encryptionPrivateKey, 'x25519'),
      publicKey: importPublicKey(envelope.ephemeralPublicKey, 'x25519'),
    });
    const key = deriveAeadKey(sharedSecret, envelope.sessionId, envelope.aad);
    const decipher = awaitlessCreateDecipher(key, fromBase64Url(envelope.nonce), envelope.aad, fromBase64Url(envelope.tag));
    const plaintext = Buffer.concat([
      decipher.update(fromBase64Url(envelope.ciphertext)),
      decipher.final(),
    ]);
    const payloadHash = createHash('sha256').update(plaintext).digest('hex');
    if (payloadHash !== envelope.payloadHash) {
      throw new SecureTransportError('Payload hash mismatch after decryption', recipient.agentId, envelope.sessionId, now);
    }
    return plaintext;
  }

  private static trackReplay(sessionId: string, nonce: string, expiresAt: number): void {
    const now = Date.now();
    const existing = SecureAgentTransport.replayState.get(sessionId);
    if (existing && existing.expiresAt <= now) {
      SecureAgentTransport.replayState.delete(sessionId);
    }
    const state = SecureAgentTransport.replayState.get(sessionId) ?? {
      expiresAt,
      seenNonces: new Set<string>(),
      order: [],
    };
    if (state.seenNonces.has(nonce)) {
      throw new SecureTransportError('Replay detected: nonce was already used for this session', sessionId, sessionId, now);
    }
    state.seenNonces.add(nonce);
    state.order.push(nonce);
    while (state.order.length > MAX_SEEN_NONCES_PER_SESSION) {
      const evicted = state.order.shift();
      if (evicted) state.seenNonces.delete(evicted);
    }
    state.expiresAt = Math.max(state.expiresAt, expiresAt);
    SecureAgentTransport.replayState.set(sessionId, state);
  }
}

function awaitlessCreateCipher(key: Buffer, nonce: Buffer, aad: string) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  return cipher;
}

function awaitlessCreateDecipher(key: Buffer, nonce: Buffer, aad: string, tag: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return decipher;
}

interface RuntimeMemoryLike {
  agentId?: string;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

export class StvorTransportManager implements IStvorTransport {
  private client: { send: (message: IStvorMessage) => Promise<unknown> } | null = null;
  private relay: IRelay | null = null;
  private readonly agentId: string;
  private readonly appToken: string;
  private readonly relayUrl: string;
  private readonly identity: SecureIdentityKeyPair;
  private readonly peerIdentities = new Map<string, SecureIdentityPublic>();
  private readonly sessionCache = new Map<string, IStvorSession>();
  private readonly messageHandlers: Array<(msg: IStvorMessage) => Promise<void>> = [];
  private connected = false;
  private stats = { messagesReceived: 0, messagesSent: 0, encryptionOps: 0 };

  constructor(config: {
    agentId: string;
    appToken: string;
    relayUrl: string;
    runtime?: RuntimeMemoryLike;
  }) {
    this.identity = KeyStore.loadOrGenerateSync(() => SecureAgentTransport.generateKeyPair());
    this.agentId = config.agentId || this.identity.agentId;
    this.appToken = config.appToken;
    this.relayUrl = config.relayUrl;
    this.runtime = config.runtime;
    this.log('info', `[SecureTransport] Initialized for ${this.agentId}`);
  }

  private readonly runtime?: RuntimeMemoryLike;

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    const logger = this.runtime?.logger;
    if (logger?.[level]) {
      logger[level]?.(message);
      return;
    }
    if (level === 'error') console.error(message);
    if (level === 'warn') console.warn(message);
  }

  getAgentId(): string {
    return this.identity.agentId;
  }

  getPublicKey(): string {
    return this.identity.signingPublicKey;
  }

  getKeyPair(): SecureIdentityKeyPair {
    return this.identity;
  }

  getPublicIdentity(): SecureIdentityPublic {
    return SecureAgentTransport.getPublicIdentity(this.identity);
  }

  registerPeerPublicKey(agentId: string, identity: SecureIdentityPublic | SecureIdentityKeyPair): void {
    const publicPeer = 'signingPrivateKey' in identity
      ? SecureAgentTransport.getPublicIdentity(identity)
      : identity;
    verifyPublicIdentity(publicPeer);
    this.peerIdentities.set(agentId, publicPeer);
  }

  private shouldAllowMock(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.STVOR_ALLOW_MOCK === 'true';
  }

  async connect(): Promise<void> {
    if (isProductionMode()) {
      requireProductionEnv('STVOR_RELAY_URL');
      assertWssUrl(this.relayUrl, 'STVOR_RELAY_URL');
    }
    const isMockRelay = !this.relayUrl || this.relayUrl === 'mock' || this.relayUrl === 'local';
    const isWebSocketRelay = this.relayUrl.startsWith('ws://') || this.relayUrl.startsWith('wss://');
    if (isMockRelay || !isWebSocketRelay) {
      if (!this.shouldAllowMock()) {
        throw new Error('Relay URL is not configured. Set STVOR_RELAY_URL or STVOR_ALLOW_MOCK=true for local tests.');
      }
      const mockClient = new MockRelayClient(this.agentId);
      await mockClient.connect();
      mockClient.onMessage((message) => this.handleRelayMessage(message));
      this.client = {
        send: async (message: IStvorMessage) => mockClient.send(message),
      };
      this.connected = true;
      return;
    }
    const relay = new WebSocketRelay(this.relayUrl, this.appToken, this.agentId);
    await relay.connect();
    relay.onMessage((message) => this.handleRelayMessage(message));
    this.relay = relay;
    this.client = {
      send: async (message: IStvorMessage) => relay.send(message.to, {
        to: message.to,
        messageId: message.id,
        payload: JSON.stringify(message),
      }),
    };
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.relay?.disconnect();
    this.relay = null;
    this.client = null;
    this.connected = false;
    this.sessionCache.clear();
    this.messageHandlers.length = 0;
  }

  async sendSecurePayload(
    recipientId: string,
    jobId: string,
    messageType: 'job_prompt' | 'job_deliverable' | 'job_evaluation' | 'handshake',
    payload: Record<string, unknown>,
  ): Promise<string> {
    if (!this.connected || !this.client) {
      throw new SecureTransportError('Transport is not connected', this.agentId, `send-${Date.now()}`, Date.now());
    }
    const recipient = this.peerIdentities.get(recipientId);
    if (!recipient) {
      throw new SecureTransportError(`No verified identity registered for recipient ${recipientId}`, this.agentId, `send-${Date.now()}`, Date.now());
    }
    const messageId = `msg-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const envelope = SecureAgentTransport.encryptOnce(this.identity, recipient, plaintext, {
      messageId,
      jobId,
      type: messageType,
    });
    const message: IStvorMessage = {
      id: messageId,
      from: this.agentId,
      to: recipientId,
      timestamp: Date.now(),
      encrypted: true,
      encryption: ALGORITHM,
      sessionId: envelope.sessionId,
      content: {
        type: messageType,
        jobId,
        data: envelope,
        encrypted: true,
        encryption: ALGORITHM,
      },
      metadata: {
        payloadHash: PayloadHasher.hashPayload(payload),
        encryptedPayloadHash: envelope.payloadHash,
        version: PROTOCOL_VERSION,
      },
    };
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(message);
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
        }
      }
    }
    if (lastError) {
      AuditLogger.log('TRANSPORT_SEND_FAILURE', { error: lastError.message }, this.agentId, jobId);
      throw lastError;
    }
    this.stats.messagesSent++;
    this.stats.encryptionOps++;
    this.sessionCache.set(recipientId, {
      sessionId: envelope.sessionId,
      agentA: this.agentId,
      agentB: recipientId,
      encryptionKeyCount: 1,
      createdAt: envelope.timestamp,
      expiresAt: envelope.expiresAt,
    });
    return messageId;
  }

  async receiveSecureMessage(): Promise<IStvorMessage | null> {
    throw new NotImplementedError('receiveSecureMessage');
  }

  onMessage(callback: (msg: IStvorMessage) => Promise<void>): void {
    this.messageHandlers.push(callback);
  }

  async getSessionStatus(agentId: string): Promise<IStvorSession | null> {
    return this.sessionCache.get(agentId) ?? null;
  }

  getSession(agentId: string): { encryptionActive: boolean } | null {
    const session = this.sessionCache.get(agentId);
    if (!session || session.expiresAt < Date.now()) return null;
    return { encryptionActive: true };
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
    setImmediate(() => {
      void this.dispatchMessage(message);
    });
  }

  private handleRelayMessage(message: RelayMessage | IStvorMessage): void {
    const dispatch = (msg: IStvorMessage): void => {
      void this.dispatchMessage(msg).catch((err) => {
        this.log('error', `[SecureTransport] Dispatch error: ${err instanceof Error ? err.message : String(err)}`);
      });
    };
    if ('payload' in message && typeof message.payload === 'string') {
      try {
        dispatch(JSON.parse(message.payload) as IStvorMessage);
      } catch (error) {
        this.log('error', `[SecureTransport] Malformed relay payload: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    dispatch(message as IStvorMessage);
  }

  private async dispatchMessage(message: IStvorMessage): Promise<void> {
    this.stats.messagesReceived++;
    let delivered = message;
    if (message.encrypted || message.content.encrypted) {
      const sender = this.peerIdentities.get(message.from);
      if (!sender) {
        this.log('warn', `[SecureTransport] Message from unregistered sender ${message.from} — dropped`);
        return;
      }
      const envelope = message.content.data as SecureEnvelope;
      try {
        const plaintext = SecureAgentTransport.decryptOnce(this.identity, sender, envelope);
        delivered = {
          ...message,
          content: {
            ...message.content,
            data: JSON.parse(Buffer.from(plaintext).toString('utf8')) as unknown,
            encrypted: false,
            decrypted: true,
          },
        };
        this.sessionCache.set(message.from, {
          sessionId: envelope.sessionId,
          agentA: message.from,
          agentB: this.agentId,
          encryptionKeyCount: 1,
          createdAt: envelope.timestamp,
          expiresAt: envelope.expiresAt,
        });
      } catch (error) {
        const eventId = `evt-${Date.now()}-${randomBytes(4).toString('hex')}`;
        AuditLogger.log(
          'TRANSPORT_DECRYPT_FAILURE',
          { eventId, messageId: message.id, error: error instanceof Error ? error.message : String(error) },
          this.agentId,
          message.content.jobId,
        );
        throw error;
      }
    }
    for (const handler of this.messageHandlers) {
      await handler(delivered);
    }
  }
}

/** @deprecated use SecureAgentTransport */
export const HybridPQCTransport = SecureAgentTransport;
/** @deprecated use SecureIdentityKeyPair */
export type HybridKeyPair = SecureIdentityKeyPair;
/** @deprecated use SecureEnvelope */
export type EncryptedPayload = SecureEnvelope;
