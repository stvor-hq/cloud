/**
 * @file In-process Mock Relay (offline fallback for Stvor transport)
 *
 * Provides a lightweight pub/sub relay for Stvor clients when the configured
 * relay is unavailable or when the environment is offline.
 */

import type { IStvorMessage } from './interfaces';

interface IRelayParticipant {
  handler?: (msg: IStvorMessage) => Promise<void> | void;
  connected: boolean;
}

const relayRegistry = new Map<string, IRelayParticipant>();

function createMessage(
  recipientId: string,
  senderId: string,
  content: IStvorMessage['content'],
): IStvorMessage {
  return {
    id: `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from: senderId,
    to: recipientId,
    timestamp: Date.now(),
    content,
    metadata: {
      payloadHash: '',
      version: 'mock-relay-v1',
    },
  };
}

export class MockRelayClient {
  public userId: string;
  public isConnected = false;
  private messageHandler: ((msg: IStvorMessage) => Promise<void> | void) | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  async connect(): Promise<void> {
    relayRegistry.set(this.userId, {
      handler: this.messageHandler || undefined,
      connected: true,
    });
    this.isConnected = true;
    console.log(`[MockRelay] ${this.userId} connected to in-process relay`);
  }

  async disconnect(): Promise<void> {
    relayRegistry.delete(this.userId);
    this.isConnected = false;
    console.log(`[MockRelay] ${this.userId} disconnected`);
  }

  async send(
    recipientId: string,
    content: IStvorMessage['content'],
  ): Promise<{ id: string }> {
    const recipient = relayRegistry.get(recipientId);
    if (!recipient || !recipient.connected || !recipient.handler) {
      throw new Error(`MockRelay: recipient ${recipientId} unavailable`);
    }

    const msg = createMessage(recipientId, this.userId, content);
    setTimeout(() => {
      try {
        recipient.handler?.(msg);
      } catch (error) {
        console.error(`[MockRelay] Delivery error: ${error}`);
      }
    }, 10);

    return { id: msg.id };
  }

  onMessage(callback: (msg: IStvorMessage) => Promise<void> | void): void {
    this.messageHandler = callback;
    const participant = relayRegistry.get(this.userId);
    if (participant) {
      participant.handler = callback;
    }
    console.log(`[MockRelay] Message handler registered for ${this.userId}`);
  }

  async getSession(agentId: string): Promise<{ id: string; keyVersion: number; createdAt: number; expiresAt: number } | null> {
    return {
      id: `mock-session-${this.userId}-${agentId}`,
      keyVersion: 1,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }
}
