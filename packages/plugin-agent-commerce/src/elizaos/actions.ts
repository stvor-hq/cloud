import type { IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { ERC8183StateMachine } from '../state-machine';
import { PayloadHasher } from '../lib/pqc';
import { AgentCommerceService, AGENT_COMMERCE_SERVICE_TYPE } from '../service';

function getService(runtime: IAgentRuntime): AgentCommerceService {
  const service = runtime.getService<AgentCommerceService>(AGENT_COMMERCE_SERVICE_TYPE);
  if (!service) {
    throw new Error(
      '[agent-commerce] AgentCommerceService is not registered. ' +
        'Add it to the plugin services array and ensure the plugin is initialized.',
    );
  }
  return service;
}

export const createJobAction = {
  name: 'CREATE_SECURE_JOB',
  description: 'Create a new ERC-8183 agentic commerce job with policy-checked transport',
  similes: ['create job', 'new job', 'start job', 'create secure job', 'hire agent'],
  examples: [[
    { name: 'user', content: { text: 'Create a job for bob to build a REST API, budget 1000000' } },
    { name: 'agent', content: { text: 'Job created successfully. Job ID: job-xxx. Status: OPEN.' } },
  ]],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content.text ?? '').toLowerCase();
    return text.includes('create') && (text.includes('job') || text.includes('task'));
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = message.content.text ?? '';
    const providerMatch = text.match(/for\s+(\w+)/i);
    const amountMatch = text.match(/(\d+)/);
    const taskMatch = text.match(/to\s+(.+?)(?:,|budget|$)/i);

    if (!providerMatch || !amountMatch) {
      await callback?.({
        text: 'Please specify: "Create a job for <provider> to <task description>, budget <amount>"',
      });
      return;
    }

    const { jobStore, reputationProvider } = getService(runtime);
    const ctx = {
      runtime,
      jobStore,
      reputationGate: {
        canFundJob: (agentId: string, amount: bigint) =>
          reputationProvider.canFundJob(agentId, amount),
        getReputation: async (agentId: string) => {
          const { score } = await reputationProvider.getScore(agentId);
          return score;
        },
      },
    };

    const job = await ERC8183StateMachine.createJob(
      ctx,
      String(runtime.agentId),
      providerMatch[1],
      taskMatch?.[1]?.trim() ?? 'Unspecified task',
      BigInt(amountMatch[1]),
    );

    await callback?.({
      text: `✅ Job created.\n**Job ID:** ${job.jobId}\n**Status:** ${job.state}\n**Provider:** ${job.providerAgent}\n**Task:** ${job.taskDescription}`,
      jobId: job.jobId,
      status: job.state,
    });
  },
};

export const fundJobAction = {
  name: 'FUND_SECURE_JOB',
  description: 'Fund an ERC-8183 job and deliver the task specification to the provider',
  similes: ['fund job', 'pay for job', 'lock funds', 'escrow'],
  examples: [[
    { name: 'user', content: { text: 'Fund job job-abc123 with 1000000' } },
    { name: 'agent', content: { text: 'Job funded. Task spec delivered to provider.' } },
  ]],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content.text ?? '').toLowerCase();
    return text.includes('fund') && text.includes('job');
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = message.content.text ?? '';
    const jobIdMatch = text.match(/job-[\w-]+/i);
    const amountMatch = text.match(/(\d+)/);

    if (!jobIdMatch) {
      await callback?.({ text: 'Please specify a job ID (e.g. "Fund job job-abc123 with 1000000")' });
      return;
    }
    if (!amountMatch) {
      await callback?.({
        text: 'Please specify a funding amount (e.g. "Fund job job-abc123 with 1000000")',
      });
      return;
    }

    const fundAmount = BigInt(amountMatch[1]);
    if (fundAmount <= 0n) {
      await callback?.({ text: 'Funding amount must be greater than 0.' });
      return;
    }

    const { jobStore, reputationProvider } = getService(runtime);
    const ctx = {
      runtime,
      jobStore,
      reputationGate: {
        canFundJob: (agentId: string, amount: bigint) =>
          reputationProvider.canFundJob(agentId, amount),
        getReputation: async (agentId: string) => {
          const { score } = await reputationProvider.getScore(agentId);
          return score;
        },
      },
    };

    try {
      const job = await ERC8183StateMachine.fundJob(
        ctx,
        jobIdMatch[0],
        String(runtime.agentId),
        fundAmount,
      );
      await callback?.({
        text: `🔐 Job funded.\n**Job ID:** ${job.jobId}\n**Status:** ${job.state}\n**Task spec delivered to provider (policy-checked, SHA-256 attestation)**`,
        jobId: job.jobId,
        status: job.state,
      });
    } catch (e) {
      await callback?.({ text: `Failed to fund job: ${(e as Error).message}` });
    }
  },
};

export const submitDeliverableAction = {
  name: 'SUBMIT_DELIVERABLE',
  description: 'Submit deliverable for a funded ERC-8183 job',
  similes: ['submit deliverable', 'submit work', 'complete job', 'deliver result'],
  examples: [[
    { name: 'user', content: { text: 'Submit deliverable for job-abc123: API is complete at https://api.example.com' } },
    { name: 'agent', content: { text: 'Deliverable submitted. Awaiting evaluator.' } },
  ]],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content.text ?? '').toLowerCase();
    return (
      text.includes('submit') &&
      (text.includes('deliverable') || text.includes('work') || text.includes('result'))
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = message.content.text ?? '';
    const jobIdMatch = text.match(/job-[\w-]+/i);
    const colonIdx = text.indexOf(':');
    const deliverable = colonIdx > -1 ? text.slice(colonIdx + 1).trim() : text;

    if (!jobIdMatch) {
      await callback?.({
        text: 'Please specify: "Submit deliverable for job-<id>: <your deliverable>"',
      });
      return;
    }

    const { jobStore, reputationProvider } = getService(runtime);
    const ctx = {
      runtime,
      jobStore,
      reputationGate: {
        canFundJob: (agentId: string, amount: bigint) =>
          reputationProvider.canFundJob(agentId, amount),
        getReputation: async (agentId: string) => {
          const { score } = await reputationProvider.getScore(agentId);
          return score;
        },
      },
    };

    try {
      const deliverablePayload = { text: deliverable };
      const deliverableHash = PayloadHasher.hashPayload(deliverablePayload);
      const job = await ERC8183StateMachine.submitJob(
        ctx,
        jobIdMatch[0],
        String(runtime.agentId),
        deliverableHash,
        deliverablePayload,
      );
      await callback?.({
        text: `📦 Deliverable submitted.\n**Job ID:** ${job.jobId}\n**Status:** ${job.state}\n**Hash recorded (no plaintext stored on ledger)**`,
        jobId: job.jobId,
        status: job.state,
      });
    } catch (e) {
      await callback?.({ text: `Failed to submit: ${(e as Error).message}` });
    }
  },
};

export const jobStatusAction = {
  name: 'JOB_STATUS',
  description: 'Check the status of an ERC-8183 commerce job',
  similes: ['job status', 'check job', 'what is job status', 'job state'],
  examples: [[
    { name: 'user', content: { text: 'What is the status of job-abc123?' } },
    { name: 'agent', content: { text: 'Job job-abc123 is currently FUNDED.' } },
  ]],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content.text ?? '').toLowerCase();
    return (
      (text.includes('status') || text.includes('state') || text.includes('check')) &&
      text.includes('job')
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = message.content.text ?? '';
    const jobIdMatch = text.match(/job-[\w-]+/i);

    if (!jobIdMatch) {
      await callback?.({ text: 'Please include a job ID, e.g. "status of job-abc123"' });
      return;
    }

    const { jobStore } = getService(runtime);
    try {
      const job = await jobStore.get(jobIdMatch[0]);
      if (!job) {
        await callback?.({ text: `Job ${jobIdMatch[0]} not found.` });
        return;
      }
      await callback?.({
        text: `📊 **Job:** ${job.jobId}\n**Status:** ${job.state}\n**Client:** ${job.clientAgent}\n**Provider:** ${job.providerAgent}\n**Task:** ${job.taskDescription}`,
        job: job as unknown as Record<string, unknown>,
      });
    } catch (e) {
      await callback?.({ text: `Error fetching job: ${(e as Error).message}` });
    }
  },
};

export const commerceActions = [
  createJobAction,
  fundJobAction,
  submitDeliverableAction,
  jobStatusAction,
];
