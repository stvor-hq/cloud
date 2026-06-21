// src/relay/server.ts
// Production WebSocket relay for Stvor Cloud.
// Deploy to Railway: railway up

import { createServer } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createHash, randomBytes } from 'crypto';

const PORT = Number(process.env.PORT ?? 4444);
const APP_TOKEN = process.env.STVOR_APP_TOKEN ?? '';
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 1000);
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

type RelayMessageType =
  | 'register'
  | 'message'
  | 'ping'
  | 'pong'
  | 'registered'
  | 'connected'
  | 'delivered'
  | 'error';

interface RelayClient {
  agentId: string;
  ws: WebSocket;
  connectedAt: number;
  messagesSent: number;
  messagesReceived: number;
}

interface RelayMessage {
  type: RelayMessageType;
  to?: string;
  from?: string;
  payload?: string;
  mlkemCt?: string;
  aliceIkPub?: string;
  aliceSpkPub?: string;
  timestamp?: number;
  messageId?: string;
  error?: string;
  queued?: boolean;
}

const clients = new Map<string, RelayClient>();
let totalMessages = 0;
const startTime = Date.now();

function dataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  return data.toString('utf8');
}

function hashMessage(message: string): string {
  return createHash('sha256').update(message).digest('hex');
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connections: clients.size,
      totalMessages,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      version: '1.0.0',
    }));
    return;
  }
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connections: clients.size,
      agents: [...clients.keys()],
      totalMessages,
      messageHash: hashMessage(`${totalMessages}:${startTime}`),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_SIZE,
});

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_CONNECTIONS) {
    ws.close(1013, 'Server full');
    return;
  }

  // Token auth (optional — skip if APP_TOKEN is empty)
  if (APP_TOKEN) {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const token = url.searchParams.get('token');
    if (token !== APP_TOKEN) {
      ws.close(1008, 'Unauthorized');
      return;
    }
  }

  let agentId: string | null = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(dataToString(data)) as RelayMessage;

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (msg.type === 'register') {
        if (!msg.from || msg.from.length < 3 || msg.from.length > 64) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid agent ID' }));
          return;
        }

        // Sanitize agent ID
        agentId = msg.from.replace(/[^a-zA-Z0-9_-]/g, '');

        clients.set(agentId, {
          agentId,
          ws,
          connectedAt: Date.now(),
          messagesSent: 0,
          messagesReceived: 0,
        });

        ws.send(JSON.stringify({
          type: 'registered',
          agentId,
          timestamp: Date.now(),
        }));

        console.log(`[relay] Agent registered: ${agentId} (total: ${clients.size})`);
        return;
      }

      if (msg.type === 'message') {
        if (!agentId) {
          ws.send(JSON.stringify({ type: 'error', error: 'Not registered' }));
          return;
        }
        if (!msg.to) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing recipient' }));
          return;
        }

        const recipient = clients.get(msg.to);
        if (!recipient || recipient.ws.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            error: `Agent ${msg.to} not connected`,
            queued: false,
          }));
          return;
        }

        const envelope = {
          type: 'message',
          from: agentId,
          to: msg.to,
          payload: msg.payload,
          mlkemCt: msg.mlkemCt,
          aliceIkPub: msg.aliceIkPub,
          aliceSpkPub: msg.aliceSpkPub,
          messageId: msg.messageId ?? randomBytes(8).toString('hex'),
          timestamp: Date.now(),
        };

        recipient.ws.send(JSON.stringify(envelope));
        recipient.messagesReceived++;

        const sender = clients.get(agentId);
        if (sender) sender.messagesSent++;

        totalMessages++;

        ws.send(JSON.stringify({
          type: 'delivered',
          messageId: envelope.messageId,
          to: msg.to,
        }));
      }

    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    if (agentId) {
      clients.delete(agentId);
      console.log(`[relay] Agent disconnected: ${agentId} (total: ${clients.size})`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[relay] WebSocket error for ${agentId}:`, err.message);
  });

  // Heartbeat
  ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
});

// Ping all clients every 30s to detect dead connections
setInterval(() => {
  for (const [id, client] of clients.entries()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.ping();
    } else {
      clients.delete(id);
    }
  }
}, 30_000);

httpServer.listen(PORT, () => {
  console.log(`[relay] Stvor Cloud relay listening on port ${PORT}`);
  console.log(`[relay] Auth: ${APP_TOKEN ? 'enabled' : 'disabled (open)'}`);
  console.log(`[relay] Max connections: ${MAX_CONNECTIONS}`);
});
