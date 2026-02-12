import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Middleware that verifies X-GitPay-Secret header against the configured shared secret.
 * Fails closed: rejects all requests when GITPAY_ACTION_SHARED_SECRET is unset.
 */
export function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.GITPAY_ACTION_SHARED_SECRET || '';
  if (!secret) {
    res.status(403).json({ error: 'Server shared secret not configured' });
    return;
  }

  const provided = req.headers['x-gitpay-secret'] as string | undefined;
  if (!provided) {
    res.status(401).json({ error: 'Missing X-GitPay-Secret header' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (
    secret.length !== provided.length ||
    !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided))
  ) {
    res.status(403).json({ error: 'Invalid X-GitPay-Secret' });
    return;
  }

  next();
}
