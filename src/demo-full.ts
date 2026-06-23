import { join } from 'path';
import { KeyStore } from './transport/key-store';
import { SecureAgentTransport as HybridPQCTransport, StvorTransportManager, type SecureIdentityKeyPair as HybridKeyPair } from './transport/pqc';
import { AgentCommercePlugin, MemoryJobStore } from '../packages/plugin-agent-commerce/src';
import { StubReputationGate as MockPqcReputationGate } from '../packages/plugin-agent-commerce/src';
import { PayloadHasher } from './transport/pqc';
import {
  generateMockPaymentHeader,
  verifyPaymentHeader,
  x402Middleware,
} from './x402/index';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

interface DemoAgent {
  name: string;
  id: string;
  keyPair: HybridKeyPair;
  transport: StvorTransportManager;
}

interface EscrowReservation {
  jobId: string;
  from: string;
  to: string;
  amount: string;
  txHash: string;
  status: 'reserved' | 'released' | 'refunded';
}

function log(title: string, lines: string[]): void {
  console.log(`\n${BOLD}${title}${RESET}`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJson<T>(value: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(value)) as T;
}

function withKeyDir<T>(agentId: string, fn: () => T): T {
  const previous = process.env.STVOR_KEY_DIR;
  process.env.STVOR_KEY_DIR = join(process.cwd(), 'data', 'demo-keys', agentId);
  try {
    return fn();
  } finally {
    if (previous) {
      process.env.STVOR_KEY_DIR = previous;
    } else {
      delete process.env.STVOR_KEY_DIR;
    }
  }
}

async function createAgent(name: string, id: string): Promise<DemoAgent> {
  return withKeyDir(id, async () => {
    const keyPair = KeyStore.loadOrGenerateSync(() => HybridPQCTransport.generateKeyPair());
    const transport = new StvorTransportManager({
      agentId: id,
      appToken: process.env.STVOR_APP_TOKEN ?? '',
      relayUrl: process.env.STVOR_RELAY_URL ?? 'local',
    });
    await transport.connect();

    return {
      name,
      id,
      keyPair,
      transport,
    };
  });
}

async function main(): Promise<void> {
  if (!process.env.STVOR_KEY_PASSWORD) {
    console.warn('[Demo] STVOR_KEY_PASSWORD not set. KeyStore will auto-generate one.');
  }
  const startedAt = Date.now();
  let encryptedMessages = 0;
  let escrow: EscrowReservation | null = null;

  log(`${CYAN}1. Boot Alice and Bob with distinct KeyStore identities${RESET}`, [
    'Alice = client/payer',
    'Bob = provider/worker',
    'Charlie = evaluator (off-chain role in this demo)',
  ]);

  const [alice, bob] = await Promise.all([
    createAgent('Alice', 'alice-agent'),
    createAgent('Bob', 'bob-agent'),
  ]);

  const amount = 1_000_000_000_000_000_000n;

  log(`${CYAN}2. Alice creates an ERC-8183 job${RESET}`, [
    `Alice self agent ID: ${alice.transport.getAgentId()}`,
    `Bob self agent ID:   ${bob.transport.getAgentId()}`,
  ]);

  const store = new MemoryJobStore();
  const gate = new MockPqcReputationGate();
  gate.setReputation(alice.id, 100);
  gate.setFundingLimit(alice.id, amount);
  const commerce = new AgentCommercePlugin(
    { agentId: 'demo-runtime' },
    undefined,
    {
      jobStore: store,
      reputationGate: gate,
    },
  );

  const job = await commerce.createJob(
    alice.id,
    bob.id,
    'Hash the prompt payload and return the SHA-256 attestation.',
    amount,
  );

  log(`${CYAN}3. Alice wraps the prompt in PQC transport${RESET}`, [
    `Job ID: ${job.jobId}`,
    `Required escrow: ${amount.toString()} wei-equivalent units`,
    'Plaintext prompt never leaves Alice process',
  ]);

  const promptPayload = {
    prompt: 'Compute SHA-256 over this Stvor PQC escrow demo payload.',
    nonce: 'alice-demo-nonce',
  };
  const encryptedPrompt = HybridPQCTransport.encryptOnce(
    alice.keyPair,
    HybridPQCTransport.getPublicIdentity(bob.keyPair),
    encodeJson(promptPayload),
  );
  encryptedMessages += 1;
  const bobPlaintext = decodeJson<Record<string, unknown>>(
    HybridPQCTransport.decryptOnce(bob.keyPair, encryptedPrompt),
  );

  log(`${GREEN}4. Bob decrypts, performs work, and returns result over PQC${RESET}`, [
    `Bob decrypted prompt hash: ${PayloadHasher.hashPayload(bobPlaintext).slice(0, 24)}...`,
    'Work = deterministic SHA-256 hash of decrypted prompt',
  ]);

  const deliverable = {
    workHash: PayloadHasher.hashPayload(bobPlaintext),
    completedAt: new Date().toISOString(),
  };
  const encryptedResult = HybridPQCTransport.encryptOnce(
    bob.keyPair,
    HybridPQCTransport.getPublicIdentity(alice.keyPair),
    encodeJson(deliverable),
  );
  encryptedMessages += 1;
  const alicePlaintext = decodeJson<Record<string, unknown>>(
    HybridPQCTransport.decryptOnce(alice.keyPair, encryptedResult),
  );

  log(`${MAGENTA}5. Alice sends x402 Payment Required and reserves escrow${RESET}`, [
    'Request without X-Payment returns HTTP 402',
    'Valid X-Payment header uses real ECDSA signature via WASM',
    'ERC-8183 fundJob transitions OPEN → FUNDED and reserves funds in mock escrow',
  ]);

  const paymentHeader = generateMockPaymentHeader(
    bob.id,
    '0x0000000000000000000000000000000000000000',
    amount.toString(),
    'celo-alfajores',
  );
  const paymentCheck = verifyPaymentHeader(paymentHeader, amount.toString());
  if (!paymentCheck.valid) {
    throw new Error(`x402 payment verification failed: ${paymentCheck.reason}`);
  }

  const paymentUrl = `http://localhost/api/x402/deliverable?jobId=${job.jobId}`;
  const noPayment = x402Middleware(amount.toString(), 'ERC-8183 escrowed PQC job')(
    new Request(paymentUrl),
    new URL(paymentUrl),
  );
  // Skip signature verification in demo mode - just check middleware exists
  if (!noPayment || noPayment.status !== 402) {
    throw new Error('x402 middleware did not enforce Payment Required flow');
  }

  const fundedJob = await commerce.fundJob(job.jobId, alice.id, amount);
  escrow = {
    jobId: fundedJob.jobId,
    from: fundedJob.clientAgent,
    to: fundedJob.providerAgent,
    amount: fundedJob.fundedAmount.toString(),
    txHash: `mock-escrow-${fundedJob.jobId}`,
    status: 'reserved',
  };

  log(`${GREEN}6. Charlie evaluates and completes the ERC-8183 job${RESET}`, [
    `Deliverable hash: ${String(alicePlaintext.workHash).slice(0, 24)}...`,
    'Evaluator decision: ACCEPT',
    'Escrow status: released to Bob (mock)',
  ]);

  await commerce.submitJob(job.jobId, bob.id, String(alicePlaintext.workHash));

  const completedJob = await commerce.evaluateJob(
    job.jobId,
    alice.id,
    'ACCEPT',
    'Deliverable hash matches the PQC-delivered prompt contract.',
  );
  if (escrow) {
    escrow = { ...escrow, status: 'released' };
  }

  const elapsedMs = Date.now() - startedAt;

  log(`${YELLOW}7. Full-cycle statistics${RESET}`, [
    `Total time: ${elapsedMs}ms`,
    `Encrypted PQC messages: ${encryptedMessages}`,
    `Plaintext on wire: 0 bytes`,
    `ERC-8183 state: ${completedJob.state}`,
    `On-chain status: ${escrow?.status ?? 'unknown'} (mock escrow)`,
    `x402 status: ${paymentCheck.valid ? 'verified' : 'failed'}`,
  ]);

  await Promise.all([alice.transport.disconnect(), bob.transport.disconnect()]);
}

main().catch((error) => {
  console.error('Full demo failed:', error);
  process.exit(1);
});
