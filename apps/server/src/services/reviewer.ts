/**
 * PR review service that orchestrates Gemini AI review.
 * Builds review input from PR metadata, calls Gemini, returns structured output.
 * Runs under timeouts and never blocks payout pipeline indefinitely.
 */

import type { ReviewInput, ReviewOutput } from '@osm402/ai';
import type { PrRecord } from '../store/prs.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const REVIEW_TIMEOUT_MS = 30_000;

export interface ReviewerStatus {
  provider: 'gemini';
  configured: boolean;
  model: string;
}

export interface ReviewRunResult {
  output: ReviewOutput;
  source: 'gemini' | 'fallback';
}

export function getReviewerStatus(): ReviewerStatus {
  return {
    provider: 'gemini',
    configured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
  };
}

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
export async function runReview(pr: PrRecord, patches?: string): Promise<ReviewRunResult | null> {
  if (!GEMINI_API_KEY) {
    console.log('[reviewer] No GEMINI_API_KEY configured, skipping AI review');
    return null;
  }

  try {
    // Dynamic import to avoid requiring @osm402/ai when not configured
    const { reviewPR, fallbackReview } = await import('@osm402/ai');
    const input = buildReviewInput(pr, patches);
    console.log(`[reviewer] Gemini review start: pr=${pr.prKey}, model=${GEMINI_MODEL}`);

    const result = await reviewPR(input, {
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
      timeoutMs: REVIEW_TIMEOUT_MS,
    });

    if (result) {
      console.log(
        `[reviewer] Gemini review done: pr=${pr.prKey}, source=gemini, riskFlags=${result.riskFlags.length}, confidence=${result.confidence.toFixed(2)}`
      );
      return { output: result, source: 'gemini' };
    }

    const fallback = fallbackReview();
    console.log(`[reviewer] Gemini unavailable: pr=${pr.prKey}, source=fallback`);
    return { output: fallback, source: 'fallback' };
  } catch (error) {
    console.error('[reviewer] Review failed:', error);
    return null;
  }
}
