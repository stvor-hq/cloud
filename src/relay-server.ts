import { randomBytes } from 'crypto';
import { verifyChallenge } from './agent-identity';
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
const pendingChallenges = new Map<string, { ws: RelaySocket; agentId: string; expiresAt: number }>();

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
  for (const [challengeId, pending] of pendingChallenges) {
    if (pending.ws === ws) {
      pendingChallenges.delete(challengeId);
    }
  }
}

function handleRelayMessage(ws: RelaySocket, raw: RelayRawMessage): void {
  try {
    const message = JSON.parse(Buffer.from(raw).toString('utf8')) as RelayMessage & Record<string, unknown>;

    if (message.type === 'challenge_response') {
      const challenge = message.challenge as string | undefined;
      const signature = message.signature as string | undefined;
      const publicKey = message.publicKey as string | undefined;
      const pending = pendingChallenges.get(challenge ?? '');

      if (!pending || pending.ws !== ws || !challenge || !signature || !publicKey) {
        closeSocket(ws, 1008, 'Invalid or expired challenge');
        return;
      }

      if (pending.expiresAt < Date.now()) {
        pendingChallenges.delete(challenge);
        closeSocket(ws, 1008, 'Challenge expired');
        return;
      }

      const valid = verifyChallenge(challenge, signature, publicKey);
      pendingChallenges.delete(challenge);

      if (valid) {
        registerAgent(ws, pending.agentId);
        console.log(`[Relay] agent ${pending.agentId} authenticated via challenge-response`);
      } else {
        closeSocket(ws, 1008, 'Challenge verification failed');
      }
      return;
    }

    const agentId = ws.data?.agentId;
    if (!agentId) {
      closeSocket(ws, 1008, 'Challenge-response required before sending messages');
      return;
    }

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
        const challenge = `stvor-${Date.now()}-${randomBytes(16).toString('hex')}`;
        const expiresAt = Date.now() + 5 * 60 * 1000;
        pendingChallenges.set(challenge, { ws, agentId, expiresAt });
        ws.send(JSON.stringify({ type: 'challenge', challenge, expiresAt }));
        console.log(`[Relay] client connected token=${token} agentId=${agentId} (awaiting challenge-response)`);
      } else {
        console.log(`[Relay] client connected token=${token} agentId=-`);
      }
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
