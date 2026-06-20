import { commerceActions } from './actions';
import { commerceProvider } from './provider';
import { commerceEvaluator, securityEvaluator } from './evaluator';

export const agentCommercePlugin = {
  name: '@elizaos/plugin-agent-commerce',
  description: 'ERC-8183 agentic commerce with Post-Quantum Cryptography transport (ML-KEM-768 + X25519 + AES-256-GCM)',

  init: async (config: Record<string, string>, _runtime: unknown) => {
    console.log('[AgentCommerce] Initializing PQC commerce plugin...');
    if (config.STVOR_RELAY_URL) {
      console.log(`[AgentCommerce] Relay configured: ${config.STVOR_RELAY_URL}`);
    } else {
      console.log('[AgentCommerce] Using in-process mock relay (set STVOR_RELAY_URL for production)');
    }
    if (config.STVOR_STRICT_MODE === 'true') {
      console.log('[AgentCommerce] Strict mode enabled: unencrypted messages will be rejected');
    }
  },

  actions: commerceActions,
  providers: [commerceProvider],
  evaluators: [securityEvaluator, commerceEvaluator],
};

export default agentCommercePlugin;

export { commerceActions } from './actions';
export { commerceProvider } from './provider';
export { commerceEvaluator, securityEvaluator } from './evaluator';
export type { IElizaRuntime, Memory, State, HandlerCallback, JobSummary } from './types';
