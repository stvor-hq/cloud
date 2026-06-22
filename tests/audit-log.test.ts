import { describe, it, expect, afterEach } from 'bun:test';
import { auditLog, verifyAuditLog } from '../src/core/audit-log';
import { rmSync, existsSync, writeFileSync, readFileSync } from 'fs';

const TEST_DIR = './data/test-audit-' + Date.now();
process.env.STVOR_LOG_DIR = TEST_DIR;

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  process.env.STVOR_LOG_DIR = TEST_DIR;
});

describe('Audit log', () => {

  it('writes entries and verifies chain integrity', async () => {
    auditLog('JOB_CREATED', { jobId: 'job-test001' }, 'alice');
    auditLog('JOB_FUNDED', { amount: '1000' }, 'alice', 'job-test001');
    auditLog('SECURITY_BLOCKED', { pattern: 'drain wallet' }, 'attacker');

    const result = await verifyAuditLog(`${TEST_DIR}/audit.log`);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
  });

  it('detects tampered entries', async () => {
    auditLog('JOB_CREATED', { amount: '1000' }, 'alice');
    auditLog('JOB_FUNDED', { amount: '1000' }, 'alice');

    const logPath = `${TEST_DIR}/audit.log`;
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[0]);
    tampered.details.amount = '9999999';
    lines[0] = JSON.stringify(tampered);
    writeFileSync(logPath, lines.join('\n') + '\n');

    const result = await verifyAuditLog(logPath);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenAt).toBe(0);
  });

  it('never throws even with bad log dir', () => {
    process.env.STVOR_LOG_DIR = '/root/no-permission';
    expect(() => auditLog('JOB_CREATED', {})).not.toThrow();
  });
});
