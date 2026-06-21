import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { Memory, IElizaRuntime } from './types.js';

function getMemoryDir(): string {
  return process.env.STVOR_MEMORY_DIR ?? './data/memory';
}

interface StoredMemory {
  agentId: string;
  roomId: string;
  userId: string;
  content: { text: string; [key: string]: unknown };
  createdAt: string;
}

export class HybridMemoryManager {
  private readonly filePath: string;

  constructor(agentId: string) {
    const memoryDir = getMemoryDir();
    if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
    this.filePath =
      `${memoryDir}/${agentId.replace(/[^a-z0-9]/gi, '_')}.json`;
  }

  async store(memory: Memory): Promise<void> {
    const all = this.load();
    all.push({ ...memory, createdAt: new Date().toISOString() });
    writeFileSync(this.filePath, JSON.stringify(all.slice(-1000), null, 2));
  }

  getJobHistory(jobId: string): StoredMemory[] {
    return this.load().filter(m =>
      m.content.text.includes(jobId) ||
      (m.content.jobIds as string[] | undefined)?.includes(jobId)
    );
  }

  private load(): StoredMemory[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredMemory[];
    } catch { return []; }
  }
}

export async function persistMemory(
  runtime: IElizaRuntime,
  memory: Memory
): Promise<void> {
  try {
    const rt = runtime as unknown as Record<string, unknown>;
    const messageManager = rt.messageManager as { createMemory?: (m: Memory) => Promise<unknown> } | undefined;
    const databaseAdapter = rt.databaseAdapter as { createMemory?: (m: Memory) => Promise<unknown> } | undefined;
    const runtimeAny = rt as { createMemory?: (m: Memory, table?: string, unique?: boolean) => Promise<unknown> };

    if (messageManager?.createMemory) {
      await messageManager.createMemory(memory);
    } else if (databaseAdapter?.createMemory) {
      await databaseAdapter.createMemory(memory);
    } else if (runtimeAny.createMemory) {
      await runtimeAny.createMemory(memory, 'messages', false);
    } else {
      throw new Error('No compatible memory creation method found on runtime');
    }
  } catch {
    await new HybridMemoryManager(runtime.agentId).store(memory);
  }
}