import type { IElizaRuntime, Memory, State } from './types';
export declare const securityEvaluator: {
    name: string;
    description: string;
    similes: string[];
    alwaysRun: boolean;
    validate: (_runtime: IElizaRuntime, _message: Memory) => Promise<boolean>;
    handler: (runtime: IElizaRuntime, message: Memory, _state: State) => Promise<void>;
};
export declare const commerceEvaluator: {
    name: string;
    description: string;
    similes: string[];
    alwaysRun: boolean;
    validate: (_runtime: IElizaRuntime, message: Memory) => Promise<boolean>;
    handler: (runtime: IElizaRuntime, message: Memory, _state: State) => Promise<void>;
};
//# sourceMappingURL=evaluator.d.ts.map