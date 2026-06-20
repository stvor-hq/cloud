import { describe, it, expect } from 'bun:test';
import { HybridPQCTransport, PayloadHasher, ensureWasm } from '../src/transport/pqc';

ensureWasm();

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
  const alice = HybridPQCTransport.generateKeyPair();
  const bob   = HybridPQCTransport.generateKeyPair();
  const payload = new TextEncoder().encode(JSON.stringify({
    jobId: 'job-perf-test',
    task: 'Build secure pipeline for Waifu.fun',
    metadata: { priority: 'high', budget: 1000000 }
  }));

  it('keygen: <50ms per keypair (Rust/WASM)', () => {
    const result = bench('ML-KEM-768 + P-256 keygen', () => {
      HybridPQCTransport.generateKeyPair();
    }, 50);
    expect(result.avgMs).toBeLessThan(50);
  });

  it('encrypt: <20ms per operation', () => {
    const result = bench('hybrid encryptOnce', () => {
      HybridPQCTransport.encryptOnce(
        alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, payload
      );
    });
    expect(result.avgMs).toBeLessThan(20);
  });

  it('decrypt: <20ms per operation', () => {
    const encrypted = HybridPQCTransport.encryptOnce(
      alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, payload
    );
    const result = bench('hybrid decryptOnce', () => {
      HybridPQCTransport.decryptOnce(bob, encrypted);
    });
    expect(result.avgMs).toBeLessThan(20);
  });

  it('full round-trip: <40ms', () => {
    const result = bench('full encrypt+decrypt round-trip', () => {
      const a = HybridPQCTransport.generateKeyPair();
      const b = HybridPQCTransport.generateKeyPair();
      const enc = HybridPQCTransport.encryptOnce(
        a, b.ik.public_key, b.spk.public_key, b.pqc.ek, payload
      );
      HybridPQCTransport.decryptOnce(b, enc);
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
      HybridPQCTransport.encryptOnce(
        alice, bob.ik.public_key, bob.spk.public_key, bob.pqc.ek, payload
      );
      count++;
    }
    console.log(`[bench] Throughput: ${count} encryptions/sec`);
    expect(count).toBeGreaterThan(50);
  });
});
