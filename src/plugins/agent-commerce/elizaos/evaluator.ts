import type { IElizaRuntime, Memory, State } from './types';

const getStrictMode = (): boolean => {
  const strictMode = process.env.STVOR_STRICT_MODE;
  return strictMode === 'true';
};

export const securityEvaluator = {
  name: 'SECURITY_GUARD',
  description: 'Enforces encrypted message transport for Stvor commerce operations',
  similes: ['secure message', 'check encryption', 'validate transport'],
  alwaysRun: true,
  validate: async (_runtime: IElizaRuntime, _message: Memory): Promise<boolean> => {
    return true;
  },
  handler: async (
    runtime: IElizaRuntime,
    message: Memory,
    _state: State,
  ): Promise<void> => {
    const stvorMessage = message.content as {
      encrypted?: boolean;
      from?: string;
      sessionId?: string;
    };

    const isEncrypted = stvorMessage.encrypted === true;
    const sender = stvorMessage.from ?? 'unknown';

    if (isEncrypted) {
      return;
    }

    if (getStrictMode()) {
      throw new Error(
        `[SECURITY-GUARD] Unencrypted message received from ${sender}. In strict mode, only encrypted Stvor transport messages are allowed.`,
      );
    }

    console.warn(`[Stvor] Unencrypted message received from ${sender}`);
  },
};

export const commerceEvaluator = {
  name: 'COMMERCE_TRACKER',
  description: 'Extracts job IDs and statuses from conversation and tracks them in agent memory',
  similes: ['track job', 'remember job'],
  alwaysRun: false,
  validate: async (_runtime: IElizaRuntime, message: Memory): Promise<boolean> => {
    return /job-[\w-]+/i.test(message.content.text);
  },
  handler: async (
    runtime: IElizaRuntime,
    message: Memory,
    _state: State,
  ): Promise<void> => {
    const jobIds = message.content.text.match(/job-[\w-]+/gi);
    if (!jobIds || jobIds.length === 0) return;

    await runtime.getMemoryManager().createMemory({
      content: {
        text: `Commerce job referenced: ${jobIds.join(', ')}`,
        jobIds,
        timestamp: new Date().toISOString(),
      },
      roomId: message.roomId,
      userId: message.userId,
      agentId: runtime.agentId,
    });
  },
};
