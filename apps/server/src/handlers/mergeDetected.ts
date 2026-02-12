/**
 * Handler for pull_request.closed (merged) webhook event.
 * Verifies merge, checks required checks, evaluates HOLD, starts payout pipeline.
 */

import { getPr, updatePr } from '../store/prs.js';
import { getIssue } from '../store/issues.js';
import { upsertPayout, getPayout } from '../store/payouts.js';
import { postIssueComment } from '../services/github.js';
import { holdComment } from '../services/comments.js';
import type { DiffSummary, PayoutResult } from '@gitpay/policy';

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

  // Create payout record
  const payoutStatus = holdResult.shouldHold ? 'HOLD' : 'PENDING';
  upsertPayout({
    id: `payout-${repoKey}#PR${prNumber}`,
    issueKey: `${repoKey}#${linkedIssue}`,
    prKey: `${repoKey}#PR${prNumber}`,
    repoKey,
    issueNumber: linkedIssue,
    prNumber,
    mergeSha,
    recipient: prRecord?.contributorAddress,
    amountUsd: cappedAmount,
    amountRaw: BigInt(Math.round(cappedAmount * 1_000_000)).toString(),
    tier: payoutResult.tier ?? undefined,
    intentHash: issue.intentHash,
    holdReasons: holdResult.shouldHold ? holdResult.reasons : undefined,
    status: payoutStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

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
  }

  return {
    handled: true,
    merged: true,
    payoutStatus,
    holdReasons: holdResult.shouldHold ? holdResult.reasons : undefined,
    amountUsd: cappedAmount,
    tier: payoutResult.tier ?? undefined,
  };
}
