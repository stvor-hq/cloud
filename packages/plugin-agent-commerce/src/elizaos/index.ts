import type { Plugin } from '@elizaos/core';
import { commerceActions } from './actions';
import { commerceProvider } from './provider';
import { commerceEvaluator, securityEvaluator } from './evaluator';
import { AgentCommerceService } from '../service';

export const agentCommercePlugin: Plugin = {
  name: 'agent-commerce',
  description:
    'Agent commerce policy plugin: rate limiting, prompt-injection heuristics, and ERC-8183 job lifecycle',
  services: [AgentCommerceService],
  actions: commerceActions,
  evaluators: [securityEvaluator, commerceEvaluator],
  providers: [commerceProvider],
};

export default agentCommercePlugin;

export { commerceActions } from './actions';
export { commerceProvider } from './provider';
export { commerceEvaluator, securityEvaluator } from './evaluator';
export { AgentCommerceService } from '../service';
