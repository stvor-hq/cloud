import type { Memory, IElizaRuntime } from './types.js';
interface StoredMemory {
    agentId: string;
    roomId: string;
    userId: string;
    content: {
        text: string;
        [key: string]: unknown;
    };
    createdAt: string;
}
export declare class HybridMemoryManager {
    private readonly filePath;
    constructor(agentId: string);
    store(memory: Memory): Promise<void>;
    getJobHistory(jobId: string): StoredMemory[];
    private load;
}
export declare function persistMemory(runtime: IElizaRuntime, memory: Memory): Promise<void>;
export {};
//# sourceMappingURL=memory.d.ts.map