// src/transport/relay.ts
// Production relay interface. MockRelayClient is the default.
// Set STVOR_RELAY_URL=wss://relay.stvor.xyz to use production relay.

export interface RelayMessage {
  to: string;
  from: string;
  payload: string;
  mlkemCt: string;
  aliceIkPub: string;
  aliceSpkPub: string;
  timestamp: number;
  messageId: string;
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

  constructor(private readonly url: string, private readonly token: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.url}?token=${this.token}`);
      this.ws.onopen = () => {
        console.log(`[WebSocketRelay] Connected to ${this.url}`);
        resolve();
      };
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as RelayMessage;
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
    this.ws.send(JSON.stringify(message));
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

export async function createRelay(): Promise<IRelay> {
  const relayUrl = process.env.STVOR_RELAY_URL;
  const token = process.env.STVOR_APP_TOKEN ?? '';

  if (relayUrl && relayUrl.startsWith('wss://')) {
    const relay = new WebSocketRelay(relayUrl, token);
    await relay.connect();
    return relay;
  }

  const { MockRelayClient } = await import('./mock-relay.js');
  const fallback = new MockRelayClient('fallback-agent');
  return fallback as unknown as IRelay;
}
