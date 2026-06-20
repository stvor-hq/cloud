import { describe, it, expect } from 'bun:test';
import {
  generate402Response,
  verifyPaymentHeader,
  generateMockPaymentHeader,
  x402Middleware,
} from '../src/x402/index';

const MOCK_FROM    = '0xAlice000000000000000000000000000000000001';
const MOCK_TO      = '0xBob0000000000000000000000000000000000002';
const MOCK_ASSET   = '0xToken00000000000000000000000000000000003';
const AMOUNT_WEI   = '1000000000000000';

describe('x402 payment protocol', () => {

  it('generate402Response returns correct structure', () => {
    const r = generate402Response('/api/test', AMOUNT_WEI, 'Test resource');
    expect(r.version).toBe('x402/1');
    expect(r.scheme).toBe('exact');
    expect(r.maxAmountRequired).toBe(AMOUNT_WEI);
    expect(r.resource).toBe('/api/test');
    expect(r.maxTimeoutSeconds).toBe(300);
  });

  it('generateMockPaymentHeader produces valid base64 JSON', () => {
    const header = generateMockPaymentHeader(MOCK_FROM, MOCK_TO, MOCK_ASSET, AMOUNT_WEI);
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    expect(decoded.version).toBe('x402/1');
    expect(decoded.payload.from).toBe(MOCK_FROM);
    expect(decoded.payload.amount).toBe(AMOUNT_WEI);
    expect(decoded.payload.signature).toMatch(/^0x[a-f0-9]+/);
  });

  it('verifyPaymentHeader accepts valid payment', () => {
    const header = generateMockPaymentHeader(MOCK_FROM, MOCK_TO, MOCK_ASSET, AMOUNT_WEI);
    const result = verifyPaymentHeader(header, AMOUNT_WEI);
    expect(result.valid).toBe(true);
  });

  it('verifyPaymentHeader rejects insufficient amount', () => {
    const header = generateMockPaymentHeader(
      MOCK_FROM, MOCK_TO, MOCK_ASSET,
      '500000000000000'
    );
    const result = verifyPaymentHeader(header, AMOUNT_WEI);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Insufficient');
  });

  it('verifyPaymentHeader rejects missing signature', () => {
    const raw = {
      version: 'x402/1',
      scheme: 'exact',
      network: 'sepolia',
      payload: {
        from: MOCK_FROM, to: MOCK_TO, asset: MOCK_ASSET,
        amount: AMOUNT_WEI, nonce: 'abc', expiresAt: 9999999999,
        signature: '',
      },
    };
    const header = Buffer.from(JSON.stringify(raw)).toString('base64');
    const result = verifyPaymentHeader(header, AMOUNT_WEI);
    expect(result.valid).toBe(false);
  });

  it('x402Middleware returns 402 when no payment header', () => {
    const middleware = x402Middleware(AMOUNT_WEI, 'Test');
    const req = new Request('http://localhost/api/test');
    const url = new URL('http://localhost/api/test');
    const result = middleware(req, url);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(402);
  });

  it('x402Middleware returns null (proceed) when payment valid', () => {
    const middleware = x402Middleware(AMOUNT_WEI, 'Test');
    const header = generateMockPaymentHeader(MOCK_FROM, MOCK_TO, MOCK_ASSET, AMOUNT_WEI);
    const req = new Request('http://localhost/api/test', {
      headers: { 'X-Payment': header },
    });
    const url = new URL('http://localhost/api/test');
    const result = middleware(req, url);
    expect(result).toBeNull();
  });
});
