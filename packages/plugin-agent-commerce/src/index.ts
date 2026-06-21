// Main plugin entry point - re-exports from elizaos package
export type {
  ERC8183JobState,
  IErc8183Job,
  IJobStore,
  ICommerceContext,
  IPqcReputationGateHook,
  EvaluatorFunction,
} from './types';
export { EvaluationDecision, MemoryJobStore } from './types';

export { ERC8183StateMachine } from './state-machine';
export { MockPqcReputationGate } from './hooks';

export {
  agentCommercePlugin,
  commerceActions,
  commerceEvaluator,
  commerceProvider,
  securityEvaluator,
} from './elizaos/index';

export { agentCommercePlugin as default } from './elizaos/index';