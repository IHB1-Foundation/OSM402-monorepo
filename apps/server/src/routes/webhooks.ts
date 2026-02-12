import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { keccak256, toHex } from 'viem';
import { isDeliveryProcessed, recordDelivery } from '../store/events.js';
import { handleIssueLabeled } from '../handlers/issueLabeled.js';

const router = Router();

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256)
 * Uses HMAC-SHA256 with the configured webhook secret
 */
function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!webhookSecret) {
    // In dev mode without secret, skip verification
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }
    return false;
  }

  if (!signature) {
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(payload, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

/**
 * POST /api/webhooks/github
 *
 * Handles GitHub webhook events:
 * - Verifies X-Hub-Signature-256
 * - Deduplicates by X-GitHub-Delivery
 * - Routes events to handlers
 */
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;
  const eventType = req.headers['x-github-event'] as string | undefined;

  // Verify signature
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  // Require delivery ID
  if (!deliveryId) {
    res.status(400).json({ error: 'Missing X-GitHub-Delivery header' });
    return;
  }

  // Idempotency check
  if (isDeliveryProcessed(deliveryId)) {
    res.status(200).json({ message: 'Delivery already processed', deliveryId });
    return;
  }

  // Record delivery
  const payloadHash = keccak256(toHex(new TextEncoder().encode(rawBody)));
  recordDelivery({
    id: `evt-${Date.now()}`,
    deliveryId,
    type: eventType || 'unknown',
    action: req.body?.action,
    payloadHash,
    createdAt: new Date(),
  });

  // Route by event type
  const action = req.body?.action as string | undefined;
  const eventKey = action ? `${eventType}.${action}` : eventType;

  switch (eventKey) {
    case 'issues.labeled': {
      const result = await handleIssueLabeled(req.body);
      res.json({ received: true, event: eventKey, deliveryId, ...result });
      return;
    }

    case 'pull_request.opened':
    case 'pull_request.synchronize':
      // Will be handled by GP-042
      res.json({ received: true, event: eventKey, deliveryId, handler: 'pending' });
      return;

    case 'pull_request.closed':
      // Will be handled by GP-043
      res.json({ received: true, event: eventKey, deliveryId, handler: 'pending' });
      return;

    default:
      res.json({ received: true, event: eventKey, deliveryId, handler: 'unhandled' });
      return;
  }
});

export default router;
