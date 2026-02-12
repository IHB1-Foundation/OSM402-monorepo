/**
 * Handler for pull_request.closed (merged) webhook event.
 * Verifies merge, checks required checks, evaluates HOLD, starts payout pipeline.
 */

import { getPr, updatePr } from '../store/prs.js';
import { getIssue } from '../store/issues.js';
import { createPayout, getPayout, updatePayout, acquirePayoutLock, releasePayoutLock } from '../store/payouts.js';
// updateIssueStatus is used in payout route; kept import path visible for reference
import { postIssueComment } from '../services/github.js';
import { holdComment, paidComment } from '../services/comments.js';
import { generateCartMandate } from '../services/mandate.js';
import { releaseEscrow } from '../services/escrow.js';
import type { DiffSummary, PayoutResult } from '@gitpay/policy';
import type { Address, Hex } from 'viem';

interface PrClosedPayload {
  action: 'closed';
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    merged: boolean;
    merge_commit_sha: string | null;
    user: { login: string };
    head: { sha: string };
    base: { ref: string };
    changed_files?: number;
    additions?: number;
    deletions?: number;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
}

export interface MergeResult {
  handled: boolean;
  merged: boolean;
  reason?: string;
  payoutStatus?: string;
  holdReasons?: string[];
  amountUsd?: number;
  tier?: string;
  cartHash?: string;
}

/**
 * Extract linked issue number from PR body
 */
function extractLinkedIssue(body: string | null): number | undefined {
  if (!body) return undefined;
  const match = body.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  return match ? parseInt(match[1]!, 10) : undefined;
}

/**
 * Check required checks pass (MVP: always pass unless configured)
 * In production, this would query the GitHub API for check suite statuses
 */
async function verifyRequiredChecks(
  _repoKey: string,
  _sha: string,
  _requiredChecks: string[],
): Promise<{ passed: boolean; missing: string[] }> {
  // MVP: skip check verification (no GitHub API token configured yet)
  // In production, query: GET /repos/{owner}/{repo}/commits/{ref}/check-runs
  console.log('[merge] Required checks verification skipped (MVP mode)');
  return { passed: true, missing: [] };
}

export async function handleMergeDetected(payload: PrClosedPayload): Promise<MergeResult> {
  const pr = payload.pull_request;
  const repoKey = payload.repository.full_name;
  const prNumber = pr.number;
  const defaultBranch = payload.repository.default_branch;

  // Check 1: Was it actually merged?
  if (!pr.merged || !pr.merge_commit_sha) {
    console.log(`[merge] PR ${repoKey}#PR${prNumber} was closed without merging`);
    return { handled: true, merged: false, reason: 'closed_without_merge' };
  }

  // Check 2: Was it merged to default branch?
  if (pr.base.ref !== defaultBranch) {
    console.log(`[merge] PR ${repoKey}#PR${prNumber} merged to ${pr.base.ref}, not ${defaultBranch}`);
    return { handled: true, merged: false, reason: 'not_default_branch' };
  }

  const mergeSha = pr.merge_commit_sha;
  console.log(`[merge] PR ${repoKey}#PR${prNumber} merged to ${defaultBranch}, sha=${mergeSha}`);

  // Update PR record
  updatePr(repoKey, prNumber, {
    status: 'MERGED',
    mergeSha,
  });

  // Find linked issue
  const prRecord = getPr(repoKey, prNumber);
  const linkedIssue = prRecord?.issueNumber ?? extractLinkedIssue(pr.body);

  if (!linkedIssue) {
    console.log(`[merge] No linked issue found for PR ${repoKey}#PR${prNumber}`);
    return { handled: true, merged: true, reason: 'no_linked_issue' };
  }

  // Check if issue is funded
  const issue = getIssue(repoKey, linkedIssue);
  if (!issue || issue.status !== 'FUNDED') {
    console.log(`[merge] Issue ${repoKey}#${linkedIssue} not funded (status: ${issue?.status ?? 'not found'})`);
    return { handled: true, merged: true, reason: 'issue_not_funded' };
  }

  // Check for duplicate payout
  const existingPayout = getPayout(repoKey, prNumber);
  if (existingPayout && existingPayout.status !== 'FAILED') {
    console.log(`[merge] Payout already exists for ${repoKey}#PR${prNumber} (status: ${existingPayout.status})`);
    return { handled: true, merged: true, reason: 'payout_already_exists', payoutStatus: existingPayout.status };
  }

  // Build diff summary for policy evaluation
  const diff: DiffSummary = {
    filesChanged: prRecord?.diff?.changedFiles ?? [],
    additions: pr.additions ?? prRecord?.diff?.additions ?? 0,
    deletions: pr.deletions ?? prRecord?.diff?.deletions ?? 0,
  };

  // Evaluate payout and HOLD using policy engine
  // MVP: use default policy since we don't have the policy file from the repo
  const { calculatePayout, evaluateHold } = await import('@gitpay/policy');
  const defaultPolicy = {
    version: 1,
    payout: {
      mode: 'fixed' as const,
      fixedAmountUsd: parseFloat(issue.bountyCap) / 1_000_000,
    },
    holdIf: [
      {
        rule: 'touchesPaths' as const,
        any: ['.github/workflows/**', 'pnpm-lock.yaml', 'package-lock.json'],
      },
    ],
  };

  const payoutResult: PayoutResult = calculatePayout(defaultPolicy, diff);
  const holdResult = evaluateHold(defaultPolicy, {
    filesChanged: diff.filesChanged,
  });

  // Check required checks (MVP: pass-through)
  // In production, requiredChecks would come from the parsed policy
  const requiredChecks: string[] = [];
  if (requiredChecks.length > 0) {
    const checkResult = await verifyRequiredChecks(repoKey, mergeSha, requiredChecks);
    if (!checkResult.passed) {
      holdResult.shouldHold = true;
      holdResult.reasons.push(`Missing required checks: ${checkResult.missing.join(', ')}`);
    }
  }

  // Cap payout at issue bounty cap
  const cappedAmount = Math.min(payoutResult.amountUsd, parseFloat(issue.bountyCap) / 1_000_000);

  // Generate Cart mandate if not held
  let cartHash: string | undefined;
  const amountRaw = BigInt(Math.round(cappedAmount * 1_000_000));

  if (!holdResult.shouldHold && issue.intentHash && prRecord?.contributorAddress) {
    const cartResult = generateCartMandate({
      intentHash: issue.intentHash as Hex,
      mergeSha,
      prNumber,
      recipient: prRecord.contributorAddress as Address,
      amountRaw,
      escrowAddress: issue.escrowAddress as Address | undefined,
    });
    cartHash = cartResult.cartHash;
    console.log(`[merge] Cart mandate generated: cartHash=${cartHash}`);
  }

  // Create payout record (enforces uniqueness per issue)
  const payoutStatus = holdResult.shouldHold ? 'HOLD' : 'PENDING';
  const payoutRecord = createPayout({
    id: `payout-${repoKey}#PR${prNumber}`,
    issueKey: `${repoKey}#${linkedIssue}`,
    prKey: `${repoKey}#PR${prNumber}`,
    repoKey,
    issueNumber: linkedIssue,
    prNumber,
    mergeSha,
    recipient: prRecord?.contributorAddress,
    amountUsd: cappedAmount,
    amountRaw: amountRaw.toString(),
    tier: payoutResult.tier ?? undefined,
    cartHash,
    intentHash: issue.intentHash,
    holdReasons: holdResult.shouldHold ? holdResult.reasons : undefined,
    status: payoutStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (!payoutRecord) {
    console.log(`[merge] Duplicate payout rejected for ${repoKey}#PR${prNumber}`);
    return { handled: true, merged: true, reason: 'payout_already_exists', payoutStatus: 'duplicate' };
  }

  console.log(`[merge] Payout created for ${repoKey}#PR${prNumber}: $${cappedAmount} (${payoutStatus})`);

  // Post comment on PR
  if (holdResult.shouldHold) {
    console.log(`[merge] HOLD reasons: ${holdResult.reasons.join('; ')}`);
    const comment = holdComment({
      amountUsd: cappedAmount,
      reasons: holdResult.reasons,
      mergeSha,
    });
    await postIssueComment(repoKey, prNumber, comment);
  } else if (prRecord?.contributorAddress && cartHash) {
    // Auto-execute payout if not held and recipient is known
    const txHash = await executePayoutInline(repoKey, prNumber, prRecord.contributorAddress, cappedAmount, mergeSha, cartHash, issue.intentHash!, issue.escrowAddress!);
    if (txHash) {
      return {
        handled: true,
        merged: true,
        payoutStatus: 'DONE',
        amountUsd: cappedAmount,
        tier: payoutResult.tier ?? undefined,
        cartHash,
      };
    }
  }

  return {
    handled: true,
    merged: true,
    payoutStatus,
    holdReasons: holdResult.shouldHold ? holdResult.reasons : undefined,
    amountUsd: cappedAmount,
    tier: payoutResult.tier ?? undefined,
    cartHash,
  };
}

/**
 * Execute payout inline during merge handling.
 * Posts "Paid" comment on PR after successful release.
 */
async function executePayoutInline(
  repoKey: string,
  prNumber: number,
  recipient: string,
  amountUsd: number,
  mergeSha: string,
  cartHash: string,
  intentHash: string,
  escrowAddress: string,
): Promise<string | null> {
  if (!acquirePayoutLock(repoKey, prNumber)) {
    console.log(`[merge] Could not acquire lock for ${repoKey}#PR${prNumber}`);
    return null;
  }

  try {
    updatePayout(repoKey, prNumber, { status: 'EXECUTING' });

    const mockSig = ('0x' + '00'.repeat(65)) as Hex;
    const releaseResult = await releaseEscrow({
      escrowAddress: escrowAddress as Address,
      intent: {
        chainId: 84532n,
        repoKeyHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        issueNumber: 0n,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
        cap: 0n,
        expiry: 0n,
        policyHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        nonce: 0n,
      },
      intentSig: mockSig,
      cart: {
        intentHash: intentHash as Hex,
        mergeSha: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        prNumber: BigInt(prNumber),
        recipient: recipient as Address,
        amount: BigInt(Math.round(amountUsd * 1_000_000)),
        nonce: 0n,
      },
      cartSig: mockSig,
      chainId: 84532,
    });

    if (!releaseResult.success) {
      updatePayout(repoKey, prNumber, { status: 'FAILED' });
      console.log(`[merge] Inline payout failed: ${releaseResult.error}`);
      return null;
    }

    updatePayout(repoKey, prNumber, { status: 'DONE', txHash: releaseResult.txHash });

    // Post Paid comment
    const comment = paidComment({
      amountUsd,
      recipient,
      txHash: releaseResult.txHash!,
      cartHash,
      intentHash,
      mergeSha,
    });
    await postIssueComment(repoKey, prNumber, comment);

    console.log(`[merge] Inline payout executed: ${repoKey}#PR${prNumber} → $${amountUsd} tx=${releaseResult.txHash}`);
    return releaseResult.txHash!;
  } finally {
    releasePayoutLock(repoKey, prNumber);
  }
}
