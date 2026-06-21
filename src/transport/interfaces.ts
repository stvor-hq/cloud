/**
 * @file Stvor SDK Integration Interfaces
 * 
 * Type definitions for secure agent-to-agent communication using Stvor SDK.
 * Stvor provides:
 *   - Signal Protocol (X3DH key exchange + Double Ratchet)
 *   - ML-KEM-768 hybrid post-quantum encryption
 *   - Perfect forward secrecy + quantum resistance
 * 
 * This layer ensures all commerce payloads (prompts, deliverables, data) bypass
 * public infrastructure and remain encrypted end-to-end.
 */

/**
 * Stvor secure message payload.
 * Wraps encrypted data with routing metadata.
 */
export interface IStvorMessage {
  /** Unique message ID for deduplication */
  id: string;

  /** Sender agent ID */
  from: string;

  /** Recipient agent ID */
  to: string;

  /** Message timestamp (Unix ms) */
  timestamp: number;

  /** Message content (encrypted by Stvor SDK) */
  content: {
    type: 'job_prompt' | 'job_deliverable' | 'job_evaluation' | 'handshake';
    jobId: string;
    data: unknown;
  };

  /** Payload metadata (for routing hints) */
  metadata?: {
    payloadHash?: string; // SHA-256 of plaintext for ledger
    actionType?: string;
    version?: string;
  };

  /** Whether the message was transmitted through encrypted Stvor transport */
  encrypted?: boolean;

  /** Whether the message used post-quantum cryptography */
  pqcEncrypted?: boolean;

  /** Crypto transport metadata, e.g. ML-KEM-768 + Double Ratchet */
  encryption?: string;

  /** Stvor session ID for tracking encrypted sessions */
  sessionId?: string;
}

/**
 * Session context for a crypto channel between two agents.
 * Maintained by Stvor SDK internally; we expose this for job lifecycle tracking.
 */
export interface IStvorSession {
  sessionId: string;
  agentA: string;
  agentB: string;
  encryptionKeyCount: number; // Double Ratchet iteration count
  createdAt: number;
  expiresAt: number;
}

/**
 * Core transport interface wrapping Stvor SDK.
 * 
 * All methods are async to reflect the event-driven, relay-based architecture.
 */
export interface IStvorTransport {
  /**
   * Initialize and connect to the Stvor relay.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the relay and cleanup resources.
   */
  disconnect(): Promise<void>;

  /**
   * Send a secure payload to another agent.
   * 
   * Args:
   *   recipientId: Target agent's ID (must be registered on relay)
   *   jobId: ERC-8183 job ID for routing and ledger reference
   *   messageType: Type of message (prompt, deliverable, evaluation, etc.)
   *   payload: Data to encrypt and send
   *   responseTimeoutMs: How long to wait for ack before returning
   * 
   * Returns the message ID sent, for tracking.
   */
   sendSecurePayload(
    recipientId: string,
    jobId: string,
    messageType: 'job_prompt' | 'job_deliverable' | 'job_evaluation' | 'handshake',
    payload: Record<string, unknown>,
    responseTimeoutMs?: number,
  ): Promise<string>;

  /**
   * Receive and decrypt an incoming message from another agent.
   * 
   * Internally, the Stvor SDK handles all decryption.
   * This method returns fully decrypted messages.
   * 
   * Args:
   *   timeoutMs: How long to block waiting for a message (default 5000)
   * 
   * Returns decrypted message or null if timeout.
   */
  receiveSecureMessage(timeoutMs?: number): Promise<IStvorMessage | null>;

  /**
   * Register a callback for incoming messages.
   * Useful for event-driven agent architectures.
   */
  onMessage(callback: (msg: IStvorMessage) => Promise<void>): void;

  /**
   * Query the status of a crypto session between two agents.
   * Used for debugging and monitoring double-ratchet state.
   */
  getSessionStatus(agentId: string): Promise<IStvorSession | null>;

  /**
   * Get transport connection status.
   */
  getStatus(): Promise<{
    connected: boolean;
    agentId: string;
    relayUrl: string;
    activeSessions: number;
    messagesReceived: number;
    messagesSent: number;
  }>;
}

/**
 * Hashing interface for ledger attestation.
 * Produces SHA-256 proofs of payloads without exposing plaintext.
 */
export interface IPayloadHasher {
  /**
   * Hash any payload to produce a deterministic proof.
   * Used to record state transitions without storing secrets.
   */
  hashPayload(data: unknown): string;

  verifyHash(data: unknown, hash: string): boolean;
}

