import { Router, type Request, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import crypto from 'node:crypto';
import { keccak256, toHex } from 'viem';
import { isDeliveryProcessed, recordDelivery } from '../store/events.js';
import { handleIssueLabeled } from '../handlers/issueLabeled.js';
import { handlePrOpened, handlePrSynchronize } from '../handlers/prEvent.js';
import { handleMergeDetected } from '../handlers/mergeDetected.js';
import { handleAddressClaim } from '../handlers/addressClaim.js';

const router: ExpressRouter = Router();

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256)
 * Uses HMAC-SHA256 with the configured webhook secret against the raw request body.
 * Fails closed: rejects if no secret is configured (even in dev).
 */
export function verifySignature(payload: Buffer, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  if (!secret) {
    return false;
  }

  if (!signature) {
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (signature.length !== expected.length) {
    return false;
  }

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
router.post('/', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;
  const eventType = req.headers['x-github-event'] as string | undefined;

  // Verify signature using the original raw body captured before JSON parsing
  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(500).json({ error: 'Raw body not captured' });
    return;
  }
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

  // Record delivery (hash from raw body bytes)
  const payloadHash = keccak256(toHex(new Uint8Array(rawBody)));
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

  try {
    switch (eventKey) {
      case 'issues.labeled': {
        const result = await handleIssueLabeled(req.body);
        res.json({ received: true, event: eventKey, deliveryId, ...result });
        return;
      }

      case 'pull_request.opened': {
        const prResult = await handlePrOpened(req.body);
        res.json({ received: true, event: eventKey, deliveryId, ...prResult });
        return;
      }

      case 'pull_request.synchronize': {
        const syncResult = await handlePrSynchronize(req.body);
        res.json({ received: true, event: eventKey, deliveryId, ...syncResult });
        return;
      }

      case 'pull_request.closed': {
        const mergeResult = await handleMergeDetected(req.body);
        res.json({ received: true, event: eventKey, deliveryId, ...mergeResult });
        return;
      }

      case 'issue_comment.created': {
        const addrResult = await handleAddressClaim(req.body);
        res.json({ received: true, event: eventKey, deliveryId, ...addrResult });
        return;
      }

      default:
        res.json({ received: true, event: eventKey, deliveryId, handler: 'unhandled' });
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhooks] Handler failed for ${eventKey ?? 'unknown'}: ${message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Handler failed', event: eventKey, deliveryId, message });
    }
    return;
  }
});

export default router;
