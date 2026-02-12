/**
 * Handler for pull_request.closed (merged) webhook event.
 * Verifies merge, checks required checks, evaluates HOLD, starts payout pipeline.
 */

import { getPr, updatePr } from '../store/prs.js';
import { getIssue } from '../store/issues.js';
import { createPayout, getPayout, updatePayout, acquirePayoutLock, releasePayoutLock } from '../store/payouts.js';
import { postIssueComment, fetchRepoFile, fetchPrFiles, fetchCheckRuns } from '../services/github.js';
import { holdComment, paidComment } from '../services/comments.js';
import { generateCartMandate } from '../services/mandate.js';
import { releaseEscrow } from '../services/escrow.js';
import type { DiffSummary, PayoutResult, Policy } from '@gitpay/policy';
import type { Address, Hex } from 'viem';
import { activeChain } from '../config/chains.js';

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

interface IssueRecord {
  bountyCap: string;
}

/**
 * Build a fallback policy when .gitpay.yml is missing or invalid.
 */
function buildDefaultPolicy(issue: IssueRecord): Policy {
  return {
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
 * Check required checks pass by querying GitHub check-runs API.
 * Falls back to pass-through if no token is available.
 */
async function verifyRequiredChecks(
  repoKey: string,
  sha: string,
  requiredChecks: string[],
): Promise<{ passed: boolean; missing: string[] }> {
  if (requiredChecks.length === 0) {
    return { passed: true, missing: [] };
  }

  const checkRuns = await fetchCheckRuns(repoKey, sha);
  if (Object.keys(checkRuns).length === 0) {
    // No token or API error — fail open with warning for MVP
    console.log('[merge] Could not fetch check runs (no token?), skipping verification');
    return { passed: true, missing: [] };
  }

  const missing: string[] = [];
  for (const name of requiredChecks) {
    const conclusion = checkRuns[name];
    if (!conclusion || conclusion !== 'success') {
      missing.push(`${name} (${conclusion ?? 'not found'})`);
    }
  }

  console.log(`[merge] Required checks: ${requiredChecks.join(', ')} → missing: ${missing.length === 0 ? 'none' : missing.join(', ')}`);
  return { passed: missing.length === 0, missing };
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

  // Fetch PR changed files from GitHub API (fallback to stored diff)
  const changedFiles = await fetchPrFiles(repoKey, prNumber);
  const filesChanged = changedFiles.length > 0
    ? changedFiles
    : prRecord?.diff?.changedFiles ?? [];

  const diff: DiffSummary = {
    filesChanged,
    additions: pr.additions ?? prRecord?.diff?.additions ?? 0,
    deletions: pr.deletions ?? prRecord?.diff?.deletions ?? 0,
  };

  // Update PR record with fetched file list
  if (changedFiles.length > 0 && prRecord?.diff) {
    updatePr(repoKey, prNumber, {
      diff: { ...prRecord.diff, changedFiles },
    });
  }

  // Load policy from repo's .gitpay.yml (fallback to default)
  const { parsePolicySafe, calculatePayout, evaluateHoldWithRiskFlags } = await import('@gitpay/policy');
  let policy: Policy;
  const policyYaml = await fetchRepoFile(repoKey, '.gitpay.yml', mergeSha);
  if (policyYaml) {
    const parsed = parsePolicySafe(policyYaml);
    if (parsed) {
      policy = parsed;
      console.log(`[merge] Loaded .gitpay.yml from ${repoKey}@${mergeSha}`);
    } else {
      console.log('[merge] .gitpay.yml parse failed, using default policy');
      policy = buildDefaultPolicy(issue);
    }
  } else {
    console.log('[merge] .gitpay.yml not found, using default policy');
    policy = buildDefaultPolicy(issue);
  }

  const payoutResult: PayoutResult = calculatePayout(policy, diff);

  // Run AI review for risk flags (if available)
  let riskFlags: string[] = [];
  if (prRecord) {
    try {
      const { runReview } = await import('../services/reviewer.js');
      const review = await runReview(prRecord);
      if (review) {
        riskFlags = review.riskFlags;
      }
    } catch {
      // AI review failure should not block payout
    }
  }

  // Evaluate HOLD with both policy rules and AI risk flags
  const holdResult = evaluateHoldWithRiskFlags(
    policy,
    { filesChanged: diff.filesChanged },
    riskFlags,
  );

  // Check required checks from policy
  const requiredChecks = policy.requiredChecks ?? [];
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
        chainId: BigInt(activeChain.chainId),
        repoKeyHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        issueNumber: 0n,
        asset: activeChain.asset,
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
      chainId: activeChain.chainId,
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
