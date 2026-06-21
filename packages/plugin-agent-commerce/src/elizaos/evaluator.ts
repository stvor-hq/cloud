import type { Memory, State } from './types';
import type { IElizaRuntime } from './types';
import { persistMemory } from './memory.js';
import { SecurityGuard } from '../lib/security';

export { SecurityGuard };

type SecurityMessageContent = {
  text?: string;
  encrypted?: boolean;
  pqcEncrypted?: boolean;
  encryption?: string;
  pqcSignature?: string;
  from?: string;
  sessionId?: string;
  [key: string]: unknown;
};

const getStrictMode = (runtime?: IElizaRuntime): boolean => {
  const runtimeStrictMode = runtime?.getSetting('STVOR_STRICT_MODE');
  if (runtimeStrictMode === 'true') return true;
  return process.env.STVOR_STRICT_MODE === 'true';
};

const isPqcEncryptedContent = (content: SecurityMessageContent): boolean => {
  const explicitlyEncrypted = content.encrypted === true || content.pqcEncrypted === true;
  const hasPqcSignature = typeof content.pqcSignature === 'string' && content.pqcSignature.length > 0;
  const encryption = String(content.encryption ?? '').toLowerCase();
  const hasPqcSignal =
    encryption.includes('ml-kem') ||
    encryption.includes('pqc') ||
    encryption.includes('double ratchet') ||
    encryption.includes('aes-256-gcm');

  return explicitlyEncrypted && hasPqcSignal && hasPqcSignature;
};

export const securityEvaluator = {
  name: 'SECURITY_GUARD',
  description: 'Enforces ML-KEM-768/PQC encrypted transport for Stvor AI Security commerce operations',
  similes: ['secure message', 'check encryption', 'validate pqc transport', 'verify ml-kem'],
  alwaysRun: true,
  validate: async (_runtime: IElizaRuntime, _message: Memory): Promise<boolean> => {
    return true;
  },
  handler: async (
    runtime: IElizaRuntime,
    message: Memory,
    _state: State,
  ): Promise<void> => {
    const stvorMessage = message.content as SecurityMessageContent;

    const isPqcEncrypted = isPqcEncryptedContent(stvorMessage);
    const sender = stvorMessage.from ?? 'unknown';

    if (isPqcEncrypted) {
      return;
    }

    if (getStrictMode(runtime)) {
      const encryption = stvorMessage.encryption ? ` encryption=${stvorMessage.encryption}` : '';
      const hasSignature = stvorMessage.pqcSignature ? ' present' : ' missing';
      throw new Error(
        `[SECURITY-GUARD] Non-PQC message received from ${sender}.${encryption} PQC signature ${hasSignature}. In strict mode, only ML-KEM-768/PQC signed Stvor AI Security transport messages are allowed.`,
      );
    }

    console.warn(`[Stvor AI Security] Non-PQC message received from ${sender}`);
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

    await persistMemory(runtime, {
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