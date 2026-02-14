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

export interface ReviewOverrides {
  prTitle?: string;
  prBody?: string | null;
  policyContext?: ReviewInput['policyContext'];
}

interface HoldRuleLike {
  rule: string;
  any?: string[];
  gtPercent?: number;
}

interface PolicyLike {
  requiredChecks?: string[];
  holdIf?: HoldRuleLike[];
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

export function buildPolicyContext(policy: PolicyLike): NonNullable<ReviewInput['policyContext']> {
  const requiredChecks = policy.requiredChecks ?? [];
  const holdRules: string[] = [];
  const sensitivePathPatterns: string[] = [];

  for (const rule of policy.holdIf ?? []) {
    if (rule.rule === 'touchesPaths') {
      const paths = rule.any ?? [];
      if (paths.length > 0) {
        holdRules.push(`touchesPaths(${paths.join(', ')})`);
        sensitivePathPatterns.push(...paths);
      } else {
        holdRules.push('touchesPaths');
      }
      continue;
    }
    if (rule.rule === 'coverageDrop') {
      holdRules.push(`coverageDrop(gtPercent=${rule.gtPercent ?? 'n/a'})`);
      continue;
    }
    holdRules.push(rule.rule);
  }

  return {
    requiredChecks,
    holdRules,
    sensitivePathPatterns: Array.from(new Set(sensitivePathPatterns)),
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
export async function runReview(pr: PrRecord, patches?: string, overrides?: ReviewOverrides): Promise<ReviewRunResult> {
  try {
    const { reviewPR } = await import('@osm402/ai');
    const base = buildReviewInput(pr, patches);
    const input: ReviewInput = {
      ...base,
      prTitle: overrides?.prTitle ?? base.prTitle,
      prBody: overrides?.prBody ?? base.prBody,
      policyContext: overrides?.policyContext ?? base.policyContext,
    };
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
