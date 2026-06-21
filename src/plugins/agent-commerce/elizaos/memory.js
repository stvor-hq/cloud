import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
function getMemoryDir() {
    return process.env.STVOR_MEMORY_DIR ?? './data/memory';
}
export class HybridMemoryManager {
    constructor(agentId) {
        const memoryDir = getMemoryDir();
        if (!existsSync(memoryDir))
            mkdirSync(memoryDir, { recursive: true });
        this.filePath =
            `${memoryDir}/${agentId.replace(/[^a-z0-9]/gi, '_')}.json`;
    }
    async store(memory) {
        const all = this.load();
        all.push({ ...memory, createdAt: new Date().toISOString() });
        writeFileSync(this.filePath, JSON.stringify(all.slice(-1000), null, 2));
    }
    getJobHistory(jobId) {
        return this.load().filter(m => m.content.text.includes(jobId) ||
            m.content.jobIds?.includes(jobId));
    }
    load() {
        if (!existsSync(this.filePath))
            return [];
        try {
            return JSON.parse(readFileSync(this.filePath, 'utf8'));
        }
        catch {
            return [];
        }
    }
}
export async function persistMemory(runtime, memory) {
    try {
        await runtime.getMemoryManager().createMemory(memory);
    }
    catch {
        await new HybridMemoryManager(runtime.agentId).store(memory);
    }
}
//# sourceMappingURL=memory.js.map