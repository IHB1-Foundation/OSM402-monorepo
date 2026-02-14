/**
 * PR review service that orchestrates Gemini AI review.
 * Builds review input from PR metadata, calls Gemini, returns structured output.
 * AI review is mandatory; failures must be handled fail-closed by callers.
 */

import type { ReviewInput, ReviewOutput } from '@osm402/ai';
import type { PrRecord } from '../store/prs.js';
import { config } from '../config.js';

const GEMINI_API_KEY = config.GEMINI_API_KEY;
const GEMINI_MODEL = config.GEMINI_MODEL;
const REVIEW_TIMEOUT_MS = 30_000;

export interface ReviewerStatus {
  provider: 'gemini';
  configured: boolean;
  model: string;
}

export interface ReviewRunResult {
  output: ReviewOutput;
  source: 'gemini';
}

export function getReviewerStatus(): ReviewerStatus {
  return {
    provider: 'gemini',
    configured: true,
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
 * Run mandatory AI review on a PR.
 * Throws when Gemini is unavailable, times out, or returns invalid output.
 */
export async function runReview(pr: PrRecord, patches?: string): Promise<ReviewRunResult> {
  try {
    const { reviewPR } = await import('@osm402/ai');
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

    throw new Error('Gemini returned no valid review output');
  } catch (error) {
    console.error('[reviewer] Review failed:', error);
    throw error;
  }
}
