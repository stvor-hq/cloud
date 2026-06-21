import type { RelayMessage } from './transport/relay';

interface RelaySocketData {
  token: string;
  agentId?: string;
}

type RelayRawMessage = string | Buffer<ArrayBuffer>;

interface RelaySocket {
  data?: RelaySocketData;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

const clientsByAgent = new Map<string, RelaySocket>();
const clientsByToken = new Set<RelaySocket>();

function getPort(): number {
  return Number(process.env.PORT ?? process.env.RELAY_PORT ?? 8787);
}

function getExpectedToken(): string {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.env.RELAY_TOKEN) {
    throw new Error('[Relay] RELAY_TOKEN is required in production mode.');
  }
  return process.env.RELAY_TOKEN ?? 'stvor-relay-dev-token';
}

function closeSocket(ws: RelaySocket, code: number, reason: string): void {
  ws.close(code, reason);
}

function registerAgent(ws: RelaySocket, agentId: string): void {
  if (agentId.length === 0) return;
  clientsByAgent.set(agentId, ws);
  ws.data = { ...(ws.data ?? { token: '' }), agentId };
}

function unregisterSocket(ws: RelaySocket): void {
  clientsByToken.delete(ws);
  for (const [agentId, client] of clientsByAgent) {
    if (client === ws) {
      clientsByAgent.delete(agentId);
    }
  }
}

function handleRelayMessage(ws: RelaySocket, raw: RelayRawMessage): void {
  try {
    const message = JSON.parse(Buffer.from(raw).toString('utf8')) as RelayMessage;
    if (!message.from || !message.to) return;

    registerAgent(ws, message.from);

    if (message.to === '*') {
      for (const client of clientsByToken) {
        if (client !== ws) {
          client.send(JSON.stringify(message));
        }
      }
      return;
    }

    const recipient = clientsByAgent.get(message.to);
    if (recipient && recipient !== ws) {
      recipient.send(JSON.stringify(message));
    }
  } catch {
    closeSocket(ws, 1003, 'Invalid relay message');
  }
}

const server = Bun.serve({
  port: getPort(),
  fetch(req, upgradeServer) {
    const url = new URL(req.url);
    if (url.pathname !== '/' && url.pathname !== '/health') {
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', clients: clientsByAgent.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = url.searchParams.get('token') ?? '';
    const agentId = url.searchParams.get('agentId') ?? '';
    const expectedToken = getExpectedToken();
    if (expectedToken && token !== expectedToken) {
      return new Response('Invalid relay token', { status: 403 });
    }

    const upgraded = (upgradeServer.upgrade as (req: Request, data: RelaySocketData) => boolean)(
      req,
      { token, agentId }
    );
    if (!upgraded) {
      return new Response('Upgrade failed', { status: 500 });
    }
    return undefined;
  },
  websocket: {
    open(ws: RelaySocket) {
      const token = ws.data?.token ?? '';
      const agentId = ws.data?.agentId ?? '';

      ws.data = { token, agentId };
      clientsByToken.add(ws);
      if (agentId) {
        clientsByAgent.set(agentId, ws);
      }
      console.log(`[Relay] client connected token=${token} agentId=${agentId || '-'}`);
    },
    message(ws: RelaySocket, message: string | Buffer<ArrayBuffer>) {
      handleRelayMessage(ws, message);
    },
    close(ws: RelaySocket) {
      unregisterSocket(ws);
      console.log('[Relay] client disconnected');
    },
  },
});

console.log(`[Relay] listening on ${server.url}`);
