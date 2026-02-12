import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifySignature } from './webhooks.js';

const TEST_SECRET = 'test-webhook-secret-abc123';

function sign(payload: Buffer, secret: string): string {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

describe('verifySignature', () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it('accepts a valid signature from raw body buffer', () => {
    const payload = Buffer.from('{"action":"labeled","issue":{"number":1}}');
    const sig = sign(payload, TEST_SECRET);
    expect(verifySignature(payload, sig)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const original = Buffer.from('{"action":"labeled","issue":{"number":1}}');
    const tampered = Buffer.from('{"action":"labeled","issue":{"number":999}}');
    const sig = sign(original, TEST_SECRET);
    expect(verifySignature(tampered, sig)).toBe(false);
  });

  it('rejects when signature is missing', () => {
    const payload = Buffer.from('{"action":"labeled"}');
    expect(verifySignature(payload, undefined)).toBe(false);
  });

  it('rejects when signature uses wrong secret', () => {
    const payload = Buffer.from('{"action":"labeled"}');
    const wrongSig = sign(payload, 'wrong-secret');
    expect(verifySignature(payload, wrongSig)).toBe(false);
  });

  it('rejects when webhook secret is not configured (fail-closed)', () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const payload = Buffer.from('{"action":"labeled"}');
    const sig = sign(payload, 'any-secret');
    expect(verifySignature(payload, sig)).toBe(false);
  });

  it('handles UTF-8 payload correctly', () => {
    const payload = Buffer.from('{"title":"Fix è bug 🐛"}');
    const sig = sign(payload, TEST_SECRET);
    expect(verifySignature(payload, sig)).toBe(true);
  });

  it('rejects signature with wrong prefix', () => {
    const payload = Buffer.from('{"action":"labeled"}');
    const hash = crypto
      .createHmac('sha256', TEST_SECRET)
      .update(payload)
      .digest('hex');
    // Missing sha256= prefix → length mismatch → rejected
    expect(verifySignature(payload, hash)).toBe(false);
  });

  it('verifies raw body matches GitHub behavior (whitespace matters)', () => {
    // GitHub sends compact JSON; re-stringifying parsed JSON may add/remove spaces
    const compactJson = '{"action":"labeled","issue":{"number":1}}';
    const prettyJson = '{ "action": "labeled", "issue": { "number": 1 } }';

    const compactBuf = Buffer.from(compactJson);
    const prettyBuf = Buffer.from(prettyJson);

    // Signature is computed against the compact JSON (as GitHub sends it)
    const sig = sign(compactBuf, TEST_SECRET);

    // Must match raw compact body
    expect(verifySignature(compactBuf, sig)).toBe(true);
    // Must NOT match pretty-printed version (this is why raw body is critical)
    expect(verifySignature(prettyBuf, sig)).toBe(false);
  });
});
