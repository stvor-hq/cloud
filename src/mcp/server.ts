// src/mcp/server.ts
// Model Context Protocol server for Stvor AI Security.
// Exposes ERC-8183 commerce operations as MCP tools.

export const MCP_TOOLS = [
  {
    name: 'create_secure_job',
    description: 'Create a new ERC-8183 agentic commerce job with authenticated end-to-end transport. Locks funds in escrow and delivers encrypted task specs to the provider.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider agent ID or address' },
        task: { type: 'string', description: 'Task description' },
        budget: { type: 'string', description: 'Budget in STVOR token units' },
        expiredAt: { type: 'number', description: 'Unix timestamp expiry' },
      },
      required: ['provider', 'task', 'budget'],
    },
  },
  {
    name: 'fund_job',
    description: 'Fund an ERC-8183 job. Triggers encrypted task delivery to the provider.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID from create_secure_job' },
        clientId: { type: 'string', description: 'Client agent ID' },
      },
      required: ['jobId', 'clientId'],
    },
  },
  {
    name: 'submit_deliverable',
    description: 'Provider submits encrypted deliverable for an ERC-8183 job.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
        deliverable: { type: 'string', description: 'Deliverable content' },
      },
      required: ['jobId', 'deliverable'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Get current status of an ERC-8183 commerce job.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'get_transport_status',
    description: 'Get transport status: crypto algorithm, session count, relay connectivity.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export const MCP_SERVER_INFO = {
  name: 'stvor-ai-security',
  version: '1.0.0',
  description: 'Authenticated ERC-8183 agentic commerce — Ed25519 + X25519 + AES-256-GCM',
};

export async function handleMcpToolCall(
  toolName: string,
  args: Record<string, unknown>,
  commerce: { createJob: (a: { clientAgent: string; providerAgent: string; taskDescription: string; requiredAmount: string | bigint; }) => Promise<{ jobId: string; status: string }>; fundJob: (a: string, b: string, c: string | bigint) => Promise<{ jobId: string; status: string }>; submitJob: (a: string, b: string, c: string) => Promise<{ jobId: string; status: string }>; getJobState: (a: string) => Promise<unknown>; }
): Promise<unknown> {
  switch (toolName) {
    case 'create_secure_job': {
      const job = await commerce.createJob({
        clientAgent: 'mcp-client',
        providerAgent: args.provider as string,
        taskDescription: args.task as string,
        requiredAmount: args.budget as string,
      });
      return { jobId: job.jobId, status: job.status, createdAt: new Date().toISOString() };
    }
    case 'fund_job': {
      const amount = args.amount;
      if (typeof amount !== 'string' || amount.trim().length === 0) {
        throw new Error('amount is required for fund_job');
      }
      const job = await commerce.fundJob(args.jobId as string, args.clientId as string, amount);
      return { jobId: job.jobId, status: job.status };
    }
    case 'submit_deliverable': {
      const job = await commerce.submitJob(
        args.jobId as string, 'mcp-provider', args.deliverable as string
      );
      return { jobId: job.jobId, status: job.status };
    }
    case 'get_job_status': {
      const job = await commerce.getJobState(args.jobId as string);
      return job ?? { error: 'Job not found' };
    }
    case 'get_transport_status': {
      return {
        algorithm: 'Ed25519 + X25519 + HKDF-SHA256 + AES-256-GCM',
        sdk: 'Node crypto',
        relay: process.env.STVOR_RELAY_URL ?? 'mock (in-process)',
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
