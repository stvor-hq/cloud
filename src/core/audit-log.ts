// src/core/audit-log.ts
// Tamper-evident audit logging for Stvor AI Security operations.

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';

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

    appendFileSync(getLogFile(), JSON.stringify(fullEntry) + '\n');
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

export function verifyAuditLog(logPath?: string): VerifyResult {
  const actualLogPath = logPath ?? getLogFile();
  if (!existsSync(actualLogPath)) {
    return { valid: true, entries: 0 };
  }

  const content = readFileSync(actualLogPath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  let expectedPrevHash = '';

  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]) as AuditEntry;
    const computedHash = getLogEntryHash({
      timestamp: entry.timestamp,
      event: entry.event,
      agentId: entry.agentId,
      jobId: entry.jobId,
      details: entry.details,
      prevHash: entry.prevHash,
    });

    if (computedHash !== entry.hash) {
      return { valid: false, entries: lines.length, firstBrokenAt: i };
    }

    if (entry.prevHash !== expectedPrevHash) {
      return { valid: false, entries: lines.length, firstBrokenAt: i };
    }

    expectedPrevHash = entry.hash;
  }

  return { valid: true, entries: lines.length };
}