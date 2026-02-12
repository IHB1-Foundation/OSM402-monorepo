import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireSecret } from './authSecret.js';

const TEST_SECRET = 'my-shared-secret-123';

type MockRes = Response & {
  statusCode: number;
  body: unknown;
  status(this: MockRes, code: number): MockRes;
  json(this: MockRes, data: unknown): void;
};

function mockReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(this: MockRes, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: MockRes, data: unknown) {
      this.body = data;
    },
  } as unknown as MockRes;
  return { req, res };
}

describe('requireSecret middleware', () => {
  beforeEach(() => {
    process.env.GITPAY_ACTION_SHARED_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.GITPAY_ACTION_SHARED_SECRET;
  });

  it('calls next() when secret matches', () => {
    const { req, res } = mockReqRes({ 'x-gitpay-secret': TEST_SECRET });
    let called = false;
    const next: NextFunction = () => { called = true; };
    requireSecret(req, res, next);
    expect(called).toBe(true);
  });

  it('returns 401 when header is missing', () => {
    const { req, res } = mockReqRes({});
    const next: NextFunction = () => {};
    requireSecret(req, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns 403 when secret is wrong', () => {
    const { req, res } = mockReqRes({ 'x-gitpay-secret': 'wrong-secret' });
    const next: NextFunction = () => {};
    requireSecret(req, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 403 when server secret is not configured', () => {
    delete process.env.GITPAY_ACTION_SHARED_SECRET;
    const { req, res } = mockReqRes({ 'x-gitpay-secret': 'any-value' });
    const next: NextFunction = () => {};
    requireSecret(req, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  it('rejects secrets with different lengths safely', () => {
    const { req, res } = mockReqRes({ 'x-gitpay-secret': 'short' });
    const next: NextFunction = () => {};
    requireSecret(req, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });
});
