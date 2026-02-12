/**
 * PR review service that orchestrates Gemini AI review.
 * Builds review input from PR metadata, calls Gemini, returns structured output.
 * Runs under timeouts and never blocks payout pipeline indefinitely.
 */

import type { ReviewInput, ReviewOutput } from '@gitpay/ai';
import type { PrRecord } from '../store/prs.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const REVIEW_TIMEOUT_MS = 30_000;

/**
 * Build ReviewInput from PR record and optional patch content
 */
export function buildReviewInput(pr: PrRecord, patches?: string): ReviewInput {
  return {
    prTitle: pr.prKey, // MVP: use prKey as title
    prBody: null,
    diffSummary: {
      filesChanged: pr.diff?.changedFiles ?? [],
      additions: pr.diff?.additions ?? 0,
      deletions: pr.diff?.deletions ?? 0,
    },
    patches: patches ? truncatePatch(patches) : undefined,
  };
}

/**
 * Truncate patch content to stay within token limits
 */
function truncatePatch(patch: string, maxChars = 4000): string {
  if (patch.length <= maxChars) return patch;
  return patch.slice(0, maxChars) + '\n... (truncated)';
}

/**
 * Run AI review on a PR. Returns null if unavailable or timed out.
 */
export async function runReview(pr: PrRecord, patches?: string): Promise<ReviewOutput | null> {
  if (!GEMINI_API_KEY) {
    console.log('[reviewer] No GEMINI_API_KEY configured, skipping AI review');
    return null;
  }

  try {
    // Dynamic import to avoid requiring @gitpay/ai when not configured
    const { reviewPR, fallbackReview } = await import('@gitpay/ai');
    const input = buildReviewInput(pr, patches);

    const result = await reviewPR(input, {
      apiKey: GEMINI_API_KEY,
      timeoutMs: REVIEW_TIMEOUT_MS,
    });

    return result ?? fallbackReview();
  } catch (error) {
    console.error('[reviewer] Review failed:', error);
    return null;
  }
}
