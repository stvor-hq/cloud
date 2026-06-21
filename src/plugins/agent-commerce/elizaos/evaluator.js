import { persistMemory } from './memory.js';
const getStrictMode = (runtime) => {
    const runtimeStrictMode = runtime?.getSetting('STVOR_STRICT_MODE');
    const strictMode = runtimeStrictMode ?? process.env.STVOR_STRICT_MODE;
    return strictMode === 'true';
};
const isPqcEncryptedContent = (content) => {
    const explicitlyEncrypted = content.encrypted === true || content.pqcEncrypted === true;
    const encryption = String(content.encryption ?? '').toLowerCase();
    const hasPqcSignal = encryption.includes('ml-kem') ||
        encryption.includes('pqc') ||
        encryption.includes('double ratchet') ||
        encryption.includes('aes-256-gcm');
    return explicitlyEncrypted && hasPqcSignal;
};
export const securityEvaluator = {
    name: 'SECURITY_GUARD',
    description: 'Enforces ML-KEM-768/PQC encrypted transport for Stvor AI Security commerce operations',
    similes: ['secure message', 'check encryption', 'validate pqc transport', 'verify ml-kem'],
    alwaysRun: true,
    validate: async (_runtime, _message) => {
        return true;
    },
    handler: async (runtime, message, _state) => {
        const stvorMessage = message.content;
        const isPqcEncrypted = isPqcEncryptedContent(stvorMessage);
        const sender = stvorMessage.from ?? 'unknown';
        if (isPqcEncrypted) {
            return;
        }
        if (getStrictMode(runtime)) {
            const encryption = stvorMessage.encryption ? ` encryption=${stvorMessage.encryption}` : '';
            throw new Error(`[SECURITY-GUARD] Non-PQC message received from ${sender}.${encryption} In strict mode, only ML-KEM-768/PQC encrypted Stvor AI Security transport messages are allowed.`);
        }
        console.warn(`[Stvor AI Security] Non-PQC message received from ${sender}`);
    },
};
export const commerceEvaluator = {
    name: 'COMMERCE_TRACKER',
    description: 'Extracts job IDs and statuses from conversation and tracks them in agent memory',
    similes: ['track job', 'remember job'],
    alwaysRun: false,
    validate: async (_runtime, message) => {
        return /job-[\w-]+/i.test(message.content.text);
    },
    handler: async (runtime, message, _state) => {
        const jobIds = message.content.text.match(/job-[\w-]+/gi);
        if (!jobIds || jobIds.length === 0)
            return;
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
//# sourceMappingURL=evaluator.js.map