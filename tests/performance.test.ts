import { describe, it, expect } from 'bun:test';
import { SecureAgentTransport, PayloadHasher } from '../src/transport/pqc';

const ITERATIONS = 100;

function bench(label: string, fn: () => void, count = ITERATIONS): { avgMs: number; totalMs: number } {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  const total = performance.now() - start;
  const avg = total / count;
  console.log(`[bench] ${label}: ${avg.toFixed(2)}ms avg over ${count} iterations (${total.toFixed(0)}ms total)`);
  return { avgMs: avg, totalMs: total };
}

describe('Performance benchmarks', () => {
  const alice = SecureAgentTransport.generateKeyPair();
  const bob   = SecureAgentTransport.generateKeyPair();
  const payload = new TextEncoder().encode(JSON.stringify({
    jobId: 'job-perf-test',
    task: 'Build secure pipeline',
    metadata: { priority: 'high', budget: 1000000 }
  }));

  it('keygen: <50ms per keypair', () => {
    const result = bench('Ed25519 + X25519 keygen', () => {
      SecureAgentTransport.generateKeyPair();
    }, 50);
    expect(result.avgMs).toBeLessThan(50);
  });

  it('encrypt: <20ms per operation', () => {
    const result = bench('hybrid encryptOnce', () => {
      SecureAgentTransport.encryptOnce(
        alice, SecureAgentTransport.getPublicIdentity(bob), payload
      );
    });
    expect(result.avgMs).toBeLessThan(20);
  });

  it('decrypt: <20ms per operation', () => {
    const encrypted = SecureAgentTransport.encryptOnce(
      alice, SecureAgentTransport.getPublicIdentity(bob), payload
    );
    const result = bench('hybrid decryptOnce', () => {
      SecureAgentTransport.decryptOnce(bob, encrypted, { trackReplay: false });
    });
    expect(result.avgMs).toBeLessThan(20);
  });

  it('full round-trip: <40ms', () => {
    const result = bench('full encrypt+decrypt round-trip', () => {
      const a = SecureAgentTransport.generateKeyPair();
      const b = SecureAgentTransport.generateKeyPair();
      const enc = SecureAgentTransport.encryptOnce(
        a, SecureAgentTransport.getPublicIdentity(b), payload
      );
      SecureAgentTransport.decryptOnce(b, enc, { trackReplay: false });
    });
    expect(result.avgMs).toBeLessThan(40);
  });

  it('SHA-256 hash: <5ms per operation', () => {
    const obj = { jobId: 'job-001', task: 'test', timestamp: Date.now() };
    const result = bench('SHA-256 payload hash', () => {
      PayloadHasher.hashPayload(obj);
    });
    expect(result.avgMs).toBeLessThan(5);
  });

  it('throughput: >50 encrypted messages per second', () => {
    const start = performance.now();
    let count = 0;
    while (performance.now() - start < 1000) {
      SecureAgentTransport.encryptOnce(
        alice, SecureAgentTransport.getPublicIdentity(bob), payload
      );
      count++;
    }
    console.log(`[bench] Throughput: ${count} encryptions/sec`);
    expect(count).toBeGreaterThan(50);
  });
});
