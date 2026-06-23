// src/transport/relay.ts
// Production relay interface. MockRelayClient is the default.
// Set STVOR_RELAY_URL=wss://relay.stvor.xyz to use production relay.

export interface RelayMessage {
  type?: 'message' | 'challenge' | 'challenge_response' | 'register';
  to: string;
  from?: string;
  payload?: string;
  aliceIkPub?: string;
  aliceSpkPub?: string;
  timestamp?: number;
  messageId?: string;
  challenge?: string;
  signature?: string;
  publicKey?: string;
  expiresAt?: number;
}

export interface IRelay {
  connect(): Promise<void>;
  disconnect(): void;
  send(to: string, message: RelayMessage): Promise<void>;
  onMessage(handler: (msg: RelayMessage) => void): void;
  isConnected(): boolean;
  getStats(): { sent: number; received: number; latencyMs: number };
}

export class WebSocketRelay implements IRelay {
  private ws: WebSocket | null = null;
  private handlers: Array<(msg: RelayMessage) => void> = [];
  private stats = { sent: 0, received: 0, latencyMs: 0 };

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly agentId: string
  ) {}

  async connect(): Promise<void> {
    const maxAttempts = 3;
    const backoffMs = [1000, 2000, 4000];
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts - 1) {
          const delay = backoffMs[attempt] ?? 4000;
          console.warn(
            `[WebSocketRelay] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  private connectOnce(): Promise<void> {
    if (!this.url.startsWith('ws://') && !this.url.startsWith('wss://')) {
      return Promise.reject(new Error(`Invalid WebSocket relay URL: ${this.url}`));
    }

    return new Promise((resolve, reject) => {
      const params = new URLSearchParams();
      if (this.agentId) params.set('agentId', this.agentId);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      this.ws = new WebSocket(`${this.url}?${params.toString()}`, { headers });
      this.ws.onopen = () => {
        console.log(`[WebSocketRelay] Connected to ${this.url}`);
        this.ws?.send(JSON.stringify({
          type: 'register',
          from: this.agentId,
          timestamp: Date.now(),
        }));
        resolve();
      };
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as RelayMessage;
          if (msg.type !== 'message') return;
          this.stats.received++;
          for (const handler of this.handlers) handler(msg);
        } catch { /* ignore malformed */ }
      };
      this.ws.onclose = () => {
        console.log('[WebSocketRelay] Disconnected');
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  async send(to: string, message: RelayMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Relay not connected');
    }
    const start = Date.now();
    const envelope: RelayMessage = {
      type: 'message',
      to,
      payload: message.payload,
      aliceIkPub: message.aliceIkPub,
      aliceSpkPub: message.aliceSpkPub,
      messageId: message.messageId,
      from: this.agentId,
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(envelope));
    this.stats.sent++;
    this.stats.latencyMs = Date.now() - start;
  }

  onMessage(handler: (msg: RelayMessage) => void): void {
    this.handlers.push(handler);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getStats() { return { ...this.stats }; }
}

export async function createRelay(agentId = process.env.STVOR_AGENT_ID ?? 'stvor-agent'): Promise<IRelay> {
  const relayUrl = process.env.STVOR_RELAY_URL;
  const token = process.env.STVOR_APP_TOKEN ?? '';

  const shouldAllowMock = (): boolean => {
    const allowMock = process.env.STVOR_ALLOW_MOCK;
    return process.env.NODE_ENV === 'test' || allowMock === 'true';
  };

  if (relayUrl && (relayUrl.startsWith('wss://') || relayUrl.startsWith('ws://'))) {
    const relay = new WebSocketRelay(relayUrl, token, agentId ?? 'stvor-agent');
    await relay.connect();
    return relay;
  }

  if (relayUrl === 'mock' || !relayUrl) {
    if (!shouldAllowMock()) {
      throw new Error(
        'Production relay URL is not configured. Set STVOR_RELAY_URL or explicitly allow mock with STVOR_ALLOW_MOCK=true.',
      );
    }
  }

  const { MockRelayClient } = await import('./mock-relay.js');
  const fallback = new MockRelayClient('fallback-agent');
  return fallback as unknown as IRelay;
}
