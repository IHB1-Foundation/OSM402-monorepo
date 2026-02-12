/**
 * POST /api/payout/execute
 * Internal endpoint to trigger payout for a given issue and PR.
 * Calls escrow.release() and records the transaction.
 */

import { Router, type Request, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { getPayout, updatePayout, acquirePayoutLock, releasePayoutLock } from '../store/payouts.js';
import { getIssue, updateIssueStatus } from '../store/issues.js';
import { releaseEscrow } from '../services/escrow.js';
import { generateCartMandate } from '../services/mandate.js';
import { postIssueComment } from '../services/github.js';
import { paidComment } from '../services/comments.js';
import { buildReleaseForPayout } from '../services/releaseConfig.js';

const router: ExpressRouter = Router();

const ExecuteSchema = z.object({
  repoKey: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive(),
});

router.post('/execute', async (req: Request, res: Response) => {
  const parseResult = ExecuteSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid request body', details: parseResult.error.format() });
    return;
  }

  const { repoKey, prNumber } = parseResult.data;

  // Get payout record
  const payout = getPayout(repoKey, prNumber);
  if (!payout) {
    res.status(404).json({ error: 'Payout not found' });
    return;
  }

  if (payout.status === 'DONE') {
    res.json({ success: true, message: 'Payout already completed', txHash: payout.txHash });
    return;
  }

  if (payout.status === 'HOLD') {
    res.status(409).json({ error: 'Payout is on HOLD', holdReasons: payout.holdReasons });
    return;
  }

  if (payout.status !== 'PENDING') {
    res.status(409).json({ error: `Invalid payout status: ${payout.status}` });
    return;
  }

  // Acquire execution lock to prevent concurrent execution
  if (!acquirePayoutLock(repoKey, prNumber)) {
    res.status(409).json({ error: 'Payout execution already in progress' });
    return;
  }

  try {

  // Get issue for escrow info
  const issue = getIssue(repoKey, payout.issueNumber);
  if (!issue || !issue.escrowAddress || !issue.intentHash) {
    res.status(400).json({ error: 'Issue not properly funded' });
    return;
  }

  if (!payout.recipient) {
    res.status(400).json({ error: 'Recipient address not set' });
    return;
  }

  // Mark as executing
  updatePayout(repoKey, prNumber, { status: 'EXECUTING' });

  // Generate cart mandate if not already done
  let cartHash = payout.cartHash;
  if (!cartHash) {
    const cartResult = generateCartMandate({
      intentHash: issue.intentHash as Hex,
      mergeSha: payout.mergeSha,
      prNumber,
      recipient: payout.recipient as Address,
      amountRaw: BigInt(payout.amountRaw || '0'),
      escrowAddress: issue.escrowAddress as Address,
    });
    cartHash = cartResult.cartHash;
    updatePayout(repoKey, prNumber, { cartHash });
  }

  let built;
  try {
    built = await buildReleaseForPayout({
      issue,
      payout,
      recipient: payout.recipient as Address,
    });
  } catch (err) {
    updatePayout(repoKey, prNumber, { status: 'FAILED' });
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to build release mandates', details: msg });
    return;
  }

  updatePayout(repoKey, prNumber, {
    cartHash: built.cartHash,
    intentHash: built.intentHash,
  });

  const releaseResult = await releaseEscrow({
    escrowAddress: issue.escrowAddress as Address,
    intent: built.intent,
    intentSig: built.intentSig,
    cart: built.cart,
    cartSig: built.cartSig,
    chainId: issue.chainId,
  });

  if (!releaseResult.success) {
    updatePayout(repoKey, prNumber, { status: 'FAILED' });
    res.status(500).json({ error: 'Escrow release failed', details: releaseResult.error });
    return;
  }

  // Mark payout as DONE
  updatePayout(repoKey, prNumber, {
    status: 'DONE',
    txHash: releaseResult.txHash,
  });

  // Mark issue as PAID
  updateIssueStatus(repoKey, payout.issueNumber, { status: 'PAID' });

  // Post paid comment on PR
  const comment = paidComment({
    amountUsd: payout.amountUsd,
    recipient: payout.recipient,
    txHash: releaseResult.txHash!,
    cartHash: built.cartHash,
    intentHash: built.intentHash,
    mergeSha: payout.mergeSha,
  });
  await postIssueComment(repoKey, prNumber, comment);

  console.log(`[payout] Executed: ${repoKey}#PR${prNumber} → $${payout.amountUsd} tx=${releaseResult.txHash}`);

  res.json({
    success: true,
    payout: {
      amountUsd: payout.amountUsd,
      recipient: payout.recipient,
      txHash: releaseResult.txHash,
      cartHash,
      intentHash: issue.intentHash,
    },
  });

  } finally {
    releasePayoutLock(repoKey, prNumber);
  }
});

export default router;
