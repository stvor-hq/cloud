/**
 * @file HTTP API Server (API Mode) with Transport Integration
 * 
 * RESTful interface for the agent node.
 * Provides endpoints for job management, secure transport, and monitoring.
 * 
 * Built with Bun's native HTTP server (zero-overhead).
 * All endpoints return JSON with proper error handling.
 * 
 * Data flow:
 *   - Job management: Standard CRUD endpoints
 *   - Transport: PQC-encrypted payload delivery via Stvor relay
 *   - Status: Real-time connection and session monitoring
 */

import type { INodeSettings } from '../core/types';
import type { AgentRuntime } from '../core/runtime';
import type { ICommercePlugin } from '../plugins/agent-commerce';
import type { StvorTransportManager } from '../transport/pqc';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { verifyAgentChallenge, type AgentChallenge } from '../agent-identity';
import { isProductionMode, requireProductionEnv } from '../core/production';

interface StoredAgentChallenge extends AgentChallenge {
  used: boolean;
}

export interface IChallengeStore {
  get(challenge: string): StoredAgentChallenge | undefined;
  set(challenge: string, value: StoredAgentChallenge): void;
  delete(challenge: string): void;
  clear(): void;
}

interface StoredAgentChallenge extends AgentChallenge {
  used: boolean;
}

class FileChallengeStore implements IChallengeStore {
  private readonly filePath: string;
  private cache = new Map<string, StoredAgentChallenge>();
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const entries = JSON.parse(data) as Record<string, StoredAgentChallenge>;
      this.cache = new Map(Object.entries(entries));
    } catch {
      this.cache = new Map();
    }
  }

  private persist(): void {
    if (!this.dirty) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(Object.fromEntries(this.cache.entries()));
    writeFileSync(this.filePath, data, { mode: 0o600 });
    this.dirty = false;
  }

  get(challenge: string): StoredAgentChallenge | undefined {
    return this.cache.get(challenge);
  }

  set(challenge: string, value: StoredAgentChallenge): void {
    this.cache.set(challenge, value);
    this.dirty = true;
    this.persist();
  }

  delete(challenge: string): void {
    this.cache.delete(challenge);
    this.dirty = true;
    this.persist();
  }

  clear(): void {
    this.cache.clear();
    this.dirty = true;
    this.persist();
  }
}

async function parseJSON(req: Request, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) {
    throw new Error('Request body too large');
  }
  const text = await req.text();
  if (text.length > maxBytes) throw new Error('Request body too large');
  return JSON.parse(text);
}

export class ApiServer {
  private runtime: AgentRuntime;
  private settings: INodeSettings;
  private transport: StvorTransportManager | null = null;
  private readonly apiKey: string;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly agentChallenges: IChallengeStore;

  constructor(runtime: AgentRuntime, transport?: StvorTransportManager) {
    this.runtime = runtime;
    this.settings = runtime.settings;
    this.transport = transport || null;

    const production = isProductionMode();
    const apiKey = this.settings.apiKey || process.env.STVOR_API_KEY;

    if (production) {
      requireProductionEnv('STVOR_API_KEY');
      this.apiKey = apiKey!;
    } else {
      if (!apiKey) {
        console.warn(
          '[API Server] WARNING: Using default API key "stvor-demo-key". This MUST be changed for production via STVOR_API_KEY.',
        );
      }
      this.apiKey = apiKey || 'stvor-demo-key';
    }

    if (production) {
      const challengePath = process.env.STVOR_CHALLENGE_STORE || './data/challenges.json';
      this.agentChallenges = new FileChallengeStore(challengePath);
      console.log('[API Server] Persistent challenge store enabled (file-based). For clusters, use Redis.');
    } else {
      this.agentChallenges = new Map() as unknown as IChallengeStore;
    }
  }

  start(): void {
    const port = this.settings.port;
    this.server = Bun.serve({
      port,
      fetch: (req) => this._handleRequest(req),
    });

    console.log(
      `[API Server] Listening on http://localhost:${port} (${this.settings.logLevel})`,
    );
  }

  stop(): void {
    if (!this.server) {
      return;
    }
    this.server.stop();
    this.server = null;
    console.log('[API Server] Stopped');
  }

  private async _handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (path === '/health') {
        return this._response(200, { status: 'ok', agentId: this.settings.agentId });
      }

if (path.startsWith('/mcp/')) {
      return await this._handleMcpRoute(method, path, req);
    }

    if (path.startsWith('/api/')) {
      return await this._handleApiRoute(method, path, req, url);
    }

    return this._response(404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[API Server] Error: ${message}`);
      return this._response(500, { error: message });
    }
  }

  private async _handleMcpRoute(
    method: string,
    path: string,
    req: Request,
  ): Promise<Response> {
    if (method === 'GET' && path === '/mcp/tools') {
      const { MCP_TOOLS, MCP_SERVER_INFO } = await import('../mcp/server.js');
      return this._response(200, { serverInfo: MCP_SERVER_INFO, tools: MCP_TOOLS });
    }

    if (method === 'POST' && path === '/mcp/call') {
      const commerce = this.runtime.getPlugin<ICommercePlugin>('agent-commerce');
      const { handleMcpToolCall } = await import('../mcp/server.js');
      const body = await parseJSON(req) as { tool: string; args: Record<string, unknown> };
      try {
        const result = await handleMcpToolCall(body.tool, body.args ?? {}, commerce as unknown as {
          createJob: (a: { clientAgent: string; providerAgent: string; taskDescription: string; requiredAmount: string | bigint; }) => Promise<{ jobId: string; status: string }>;
          fundJob: (a: string, b: string, c: string | bigint) => Promise<{ jobId: string; status: string }>;
          submitJob: (a: string, b: string, c: string) => Promise<{ jobId: string; status: string }>;
          getJobState: (a: string) => Promise<unknown>;
        });
        return this._response(200, { result });
      } catch (err) {
        return this._response(400, { error: (err as Error).message });
      }
    }

    return this._response(404, { error: `MCP route not found: ${method} ${path}` });
  }

  private async _handleApiRoute(
    method: string,
    path: string,
    req: Request,
    url: URL,
  ): Promise<Response> {
    const commerce = this.runtime.getPlugin<ICommercePlugin>(
      'agent-commerce',
    );

    if (method === 'POST' && path === '/api/jobs/create') {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      try {
        const body = await parseJSON(req);
        const {
          clientAgent,
          providerAgent,
          taskDescription,
          requiredAmount,
        } = body as Record<string, unknown>;

        const job = await commerce.createJob(
          clientAgent as string,
          providerAgent as string,
          taskDescription as string,
          BigInt(requiredAmount as string | number),
        );

        return this._response(201, { success: true, job });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (method === 'POST' && path.match(/^\/api\/jobs\/[^/]+\/fund$/)) {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      try {
        const jobId = path.split('/')[3];
        const body = await parseJSON(req);
        const { clientAgent, fundAmount } = body as Record<string, unknown>;

        const job = await commerce.fundJob(
          jobId,
          clientAgent as string,
          BigInt(fundAmount as string | number),
        );

        return this._response(200, { success: true, job });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (method === 'POST' && path.match(/^\/api\/jobs\/[^/]+\/submit$/)) {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      try {
        const jobId = path.split('/')[3];
        const body = await parseJSON(req);
        const { providerAgent, deliverableHash } = body as Record<string, unknown>;

        const job = await commerce.submitJob(
          jobId,
          providerAgent as string,
          deliverableHash as string,
        );

        return this._response(200, { success: true, job });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (method === 'POST' && path.match(/^\/api\/jobs\/[^/]+\/evaluate$/)) {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      try {
        const jobId = path.split('/')[3];
        const body = await parseJSON(req);
        const { decision, reason } = body as Record<string, unknown>;

        const job = await commerce.evaluateJob(jobId, decision as 'ACCEPT' | 'REJECT' | 'PARTIAL', reason as string | undefined);

        return this._response(200, { success: true, job });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (method === 'GET' && path.match(/^\/api\/jobs\/[^/]+$/)) {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      const jobId = path.split('/')[3];
      const state = await commerce.getJobState(jobId);

      if (!state) {
        return this._response(404, { error: `Job ${jobId} not found` });
      }

      return this._response(200, { success: true, state });
    }

    if (method === 'GET' && path === '/api/jobs') {
      if (!commerce) {
        return this._response(503, { error: 'Commerce plugin not loaded' });
      }
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
        return this._response(400, {
          error: 'agentId query parameter required',
        });
      }

      const jobs = await commerce.listJobs(agentId);
      return this._response(200, { success: true, jobs, count: jobs.length });
    }

    if (method === 'POST' && path === '/api/transport/send') {
      if (!this.transport) {
        return this._response(503, { error: 'Transport layer not initialized' });
      }
      this.requireTransportAuth(req);
      try {
        const body = await parseJSON(req);
        const recipientId = this.validateStringField(body.recipientId, 'recipientId');
        const jobId = this.validateStringField(body.jobId, 'jobId');
        const messageType = this.validateStringField(body.messageType, 'messageType');
        const payload = body.payload;
        if (!['job_prompt', 'job_deliverable', 'job_evaluation', 'handshake'].includes(messageType)) {
          return this._response(400, { error: 'Invalid messageType' });
        }

        const msgId = await this.transport.sendSecurePayload(
          recipientId,
          jobId,
          messageType as 'job_prompt' | 'job_deliverable' | 'job_evaluation' | 'handshake',
          payload as Record<string, unknown>,
        );

        return this._response(200, { success: true, messageId: msgId });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (method === 'GET' && path === '/api/transport/status') {
      if (!this.transport) {
        return this._response(503, { error: 'Transport layer not initialized' });
      }
      this.requireTransportAuth(req);
      const status = await this.transport.getStatus();
      return this._response(200, { success: true, ...status });
    }

    if (
      method === 'GET' &&
      path.match(/^\/api\/transport\/session\/[^/]+$/)
    ) {
      this.requireTransportAuth(req);
      if (!this.transport) {
        return this._response(503, { error: 'Transport layer not initialized' });
      }
      const agentId = this.validateStringField(path.split('/')[4], 'agentId');
      const session = await this.transport.getSessionStatus(agentId);

      if (!session) {
        return this._response(404, {
          error: `No active session with ${agentId}`,
        });
      }

      return this._response(200, { success: true, session });
    }

    if (method === 'GET' && path === '/api/agent/id') {
      return this._response(200, {
        agentId: this.settings.agentId,
        selfAgentId: this.transport?.getAgentId() ?? null,
        publicKey: this.transport?.getPublicKey() ?? null,
      });
    }

    if (method === 'GET' && path === '/api/agent/public-key') {
      if (!this.transport) {
        return this._response(503, { error: 'Transport layer not initialized' });
      }
      return this._response(200, {
        agentId: this.transport.getAgentId(),
        publicKey: this.transport.getPublicKey(),
      });
    }

    if (method === 'GET' && path === '/api/agent/status') {
      const transportStatus = this.transport
        ? await this.transport.getStatus()
        : null;

      return this._response(200, {
        agentId: this.settings.agentId,
        selfAgentId: this.transport?.getAgentId() ?? null,
        state: this.runtime.state,
        pqcEnabled: this.settings.pqcEnabled,
        uptime: process.uptime(),
        transport: transportStatus
          ? {
              connected: transportStatus.connected,
              activeSessions: transportStatus.activeSessions,
              messagesReceived: transportStatus.messagesReceived,
              messagesSent: transportStatus.messagesSent,
            }
          : null,
      });
    }

    if (method === 'GET' && path === '/api/agent/challenge') {
      const publicKey = url.searchParams.get('publicKey');
      if (!publicKey) {
        return this._response(400, { error: 'publicKey query parameter required' });
      }
      const challenge = {
        challenge: `stvor-${Date.now()}-${randomBytes(16).toString('hex')}`,
        publicKey,
        expiresAt: Date.now() + 5 * 60 * 1000,
        createdAt: Date.now(),
      };
      this.agentChallenges.set(challenge.challenge, { ...challenge, used: false });
      return this._response(200, challenge);
    }

    if (method === 'POST' && path === '/api/agent/verify-challenge') {
      const body = await parseJSON(req) as {
        challenge?: string;
        signature?: string;
        publicKey?: string;
        agentId?: string;
      };
      const challenge = this.validateStringField(body.challenge ?? '', 'challenge');
      const signature = this.validateStringField(body.signature ?? '', 'signature');
      const publicKey = this.validateStringField(body.publicKey ?? '', 'publicKey');
      const stored = this.agentChallenges.get(challenge);

      if (!stored || stored.used || stored.expiresAt < Date.now()) {
        return this._response(400, { error: 'Invalid or expired challenge' });
      }
      if (stored.publicKey !== publicKey) {
        return this._response(400, { error: 'Challenge public key mismatch' });
      }

      const valid = verifyAgentChallenge(challenge, signature, publicKey);
      stored.used = true;
      this.agentChallenges.delete(challenge);

      return this._response(valid ? 200 : 401, {
        success: valid,
        agentId: body.agentId ?? null,
        verifiedAt: valid ? new Date().toISOString() : null,
      });
    }

    if (method === 'POST' && path === '/api/x402/deliverable') {
      const { x402Middleware } = await import('../x402/index.js');
      const middleware = x402Middleware(
        '1000000000000000',
        'Access encrypted job deliverable via PQC transport'
      );
      const paymentResult = middleware(req, url);
      if (paymentResult) return paymentResult;

      const body = await parseJSON(req) as { jobId: string };
      return this._response(200, {
        success: true,
        jobId: body.jobId,
        message: 'Payment verified. Encrypted deliverable access granted.',
        paidAt: new Date().toISOString(),
      });
    }

    if (method === 'GET' && path === '/api/x402/info') {
      const { generate402Response } = await import('../x402/index.js');
      const info = generate402Response('/api/x402/deliverable', '1000000000000000', 'Demo');
      return this._response(200, info);
    }

    return this._response(404, { error: `Route not found: ${method} ${path}` });
  }

  private validateStringField(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldName} is required and must be a non-empty string`);
    }
    if (value.includes('/')) {
      throw new Error(`${fieldName} contains invalid characters`);
    }
    return value.trim();
  }

  private requireTransportAuth(req: Request): void {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Authorization header required');
    }
    const token = authHeader.slice(7).trim();
    if (token !== this.apiKey) {
      throw new Error('Invalid API key');
    }
  }

  private _response(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
