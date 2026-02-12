/**
 * POST /api/payout/execute
 * Internal endpoint to trigger payout for a given issue and PR.
 * Calls escrow.release() and records the transaction.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { getPayout, updatePayout } from '../store/payouts.js';
import { getIssue, updateIssueStatus } from '../store/issues.js';
import { releaseEscrow } from '../services/escrow.js';
import { generateCartMandate } from '../services/mandate.js';
import { postIssueComment } from '../services/github.js';
import { paidComment } from '../services/comments.js';

const router = Router();

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

  // Call escrow.release()
  // In mock mode, intentSig and cartSig are placeholders
  const mockSig = '0x' + '00'.repeat(65) as Hex;

  const releaseResult = await releaseEscrow({
    escrowAddress: issue.escrowAddress as Address,
    intent: {
      chainId: BigInt(issue.chainId),
      repoKeyHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      issueNumber: BigInt(issue.issueNumber),
      asset: issue.asset as Address,
      cap: BigInt(issue.bountyCap),
      expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
      policyHash: issue.policyHash as Hex,
      nonce: 0n,
    },
    intentSig: mockSig,
    cart: {
      intentHash: issue.intentHash as Hex,
      mergeSha: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      prNumber: BigInt(prNumber),
      recipient: payout.recipient as Address,
      amount: BigInt(payout.amountRaw || '0'),
      nonce: 0n,
    },
    cartSig: mockSig,
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
    cartHash: cartHash!,
    intentHash: issue.intentHash,
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
});

export default router;
