// src/x402/index.ts
// x402 payment protocol implementation for Stvor Cloud agents.
// Spec: https://x402.org

import { createHash, randomBytes } from 'crypto';
import { loadContractAddresses } from '../contracts/on-chain.js';

export interface X402PaymentRequired {
  version: 'x402/1';
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
  };
}

export interface X402PaymentHeader {
  version: 'x402/1';
  scheme: 'exact';
  network: string;
  payload: {
    from: string;
    to: string;
    asset: string;
    amount: string;
    nonce: string;
    expiresAt: number;
    signature: string;
  };
}

export interface X402PaymentReceipt {
  success: boolean;
  txHash?: string;
  error?: string;
  paidAt: string;
}

export function generate402Response(
  resource: string,
  amountWei: string,
  description: string
): X402PaymentRequired {
  const addresses = loadContractAddresses();
  const network = addresses?.network ?? 'sepolia';
  const asset = addresses?.token ?? '0x0000000000000000000000000000000000000000';
  const payTo = process.env.STVOR_TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000';

  return {
    version: 'x402/1',
    scheme: 'exact',
    network,
    maxAmountRequired: amountWei,
    resource,
    description,
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 300,
    asset,
    extra: {
      name: 'Stvor Token',
      version: '1',
    },
  };
}

export function verifyPaymentHeader(
  header: string,
  expectedAmount: string
): { valid: boolean; reason?: string } {
  try {
    const payment = JSON.parse(
      Buffer.from(header, 'base64').toString('utf8')
    ) as X402PaymentHeader;

    if (payment.version !== 'x402/1') {
      return { valid: false, reason: 'Invalid x402 version' };
    }
    if (!payment.payload.signature) {
      return { valid: false, reason: 'Missing signature' };
    }
    if (BigInt(payment.payload.amount) < BigInt(expectedAmount)) {
      return { valid: false, reason: 'Insufficient payment amount' };
    }
    if (payment.payload.expiresAt < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: 'Payment expired' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid payment header format' };
  }
}

export function generateMockPaymentHeader(
  from: string,
  to: string,
  asset: string,
  amountWei: string,
  network = 'sepolia'
): string {
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 300;

  const payload = JSON.stringify({ from, to, asset, amountWei, nonce, expiresAt });
  const mockSig = '0x' + createHash('sha256').update(payload).digest('hex');

  const header: X402PaymentHeader = {
    version: 'x402/1',
    scheme: 'exact',
    network,
    payload: {
      from,
      to,
      asset,
      amount: amountWei,
      nonce,
      expiresAt,
      signature: mockSig,
    },
  };

  return Buffer.from(JSON.stringify(header)).toString('base64');
}

export function x402Middleware(
  amountWei: string,
  description: string
): (req: Request, url: URL) => Response | null {
  return (req: Request, url: URL): Response | null => {
    const paymentHeader = req.headers.get('X-Payment');

    if (!paymentHeader) {
      const body = generate402Response(url.pathname, amountWei, description);
      return new Response(JSON.stringify(body), {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Required': 'true',
        },
      });
    }

    const { valid, reason } = verifyPaymentHeader(paymentHeader, amountWei);
    if (!valid) {
      return new Response(JSON.stringify({ error: `Payment invalid: ${reason}` }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return null;
  };
}
