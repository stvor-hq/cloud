// src/core/audit-log.ts
// Tamper-evident audit logging for Stvor AI Security operations.

import { existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, statSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import readline from 'readline';

const MAX_LOG_BYTES = 10 * 1024 * 1024;

function getLogDir(): string {
  return process.env.STVOR_LOG_DIR ?? './data/logs';
}

function getLogFile(): string {
  return `${getLogDir()}/audit.log`;
}

interface AuditEntry {
  timestamp: string;
  event: string;
  agentId: string;
  jobId?: string;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

function getLogEntryHash(entry: Omit<AuditEntry, 'hash'>): string {
  const data = JSON.stringify({
    timestamp: entry.timestamp,
    event: entry.event,
    agentId: entry.agentId,
    jobId: entry.jobId,
    details: entry.details,
    prevHash: entry.prevHash,
  });
  return createHash('sha256').update(data).digest('hex');
}

export function auditLog(
  event: string,
  details: Record<string, unknown>,
  agentId: string,
  jobId?: string
): void {
  try {
    const logDir = getLogDir();
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const logFile = getLogFile();
    if (existsSync(logFile) && statSync(logFile).size >= MAX_LOG_BYTES) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = `${logFile}.${timestamp}`;
      renameSync(logFile, rotatedPath);
    }

    const prevHash = getLastEntryHash();
    const entry: Omit<AuditEntry, 'hash'> = {
      timestamp: new Date().toISOString(),
      event,
      agentId,
      jobId,
      details,
      prevHash,
    };

    const hash = getLogEntryHash(entry);
    const fullEntry: AuditEntry = { ...entry, hash };

    appendFileSync(logFile, JSON.stringify(fullEntry) + '\n');
  } catch {
    // never crash on logging
  }
}

function getLastEntryHash(): string {
  try {
    const logFile = getLogFile();
    if (!existsSync(logFile)) return '';
    const content = readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return '';
    const last = JSON.parse(lines[lines.length - 1]) as AuditEntry;
    return last.hash;
  } catch {
    return '';
  }
}

export interface VerifyResult {
  valid: boolean;
  entries: number;
  firstBrokenAt?: number;
}

export async function verifyAuditLog(logPath?: string): Promise<VerifyResult> {
  const actualLogPath = logPath ?? getLogFile();
  if (!existsSync(actualLogPath)) {
    return { valid: true, entries: 0 };
  }

  const stream = createReadStream(actualLogPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream });
  let expectedPrevHash = '';
  let lineIndex = 0;
  let entryCount = 0;

  try {
    for await (const line of rl) {
      if (line.trim()) {
        let entry: AuditEntry;
        try {
          entry = JSON.parse(line) as AuditEntry;
        } catch {
          return { valid: false, entries: lineIndex, firstBrokenAt: lineIndex };
        }
        const computedHash = getLogEntryHash({
          timestamp: entry.timestamp,
          event: entry.event,
          agentId: entry.agentId,
          jobId: entry.jobId,
          details: entry.details,
          prevHash: entry.prevHash,
        });

        if (computedHash !== entry.hash) {
          return { valid: false, entries: lineIndex, firstBrokenAt: lineIndex };
        }

        if (entry.prevHash !== expectedPrevHash) {
          return { valid: false, entries: lineIndex, firstBrokenAt: lineIndex };
        }

        expectedPrevHash = entry.hash;
        entryCount++;
      }
      lineIndex++;
    }
  } catch {
    return { valid: false, entries: lineIndex, firstBrokenAt: lineIndex };
  }

  return { valid: true, entries: entryCount };
}