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
const GEMINI_MAX_RETRIES = config.GEMINI_MAX_RETRIES;
const GEMINI_RETRY_BASE_DELAY_MS = config.GEMINI_RETRY_BASE_DELAY_MS;
const GEMINI_RETRY_MAX_DELAY_MS = config.GEMINI_RETRY_MAX_DELAY_MS;
const GEMINI_MAX_CONCURRENCY = config.GEMINI_MAX_CONCURRENCY;
const GEMINI_MOCK_MODE = config.GEMINI_MOCK_MODE;
const GEMINI_REVIEW_MAX_ATTEMPTS = config.GEMINI_REVIEW_MAX_ATTEMPTS;
const GEMINI_REVIEW_RETRY_BASE_DELAY_MS = config.GEMINI_REVIEW_RETRY_BASE_DELAY_MS;
const GEMINI_REVIEW_RETRY_MAX_DELAY_MS = config.GEMINI_REVIEW_RETRY_MAX_DELAY_MS;

export interface ReviewerStatus {
  provider: 'gemini';
  configured: boolean;
  model: string;
}

export interface ReviewRunResult {
  output: ReviewOutput;
  source: 'gemini' | 'mock';
}

export class GeminiReviewError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'GeminiReviewError';
    this.retryable = retryable;
  }
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

class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.available = Math.max(1, max);
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.available -= 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const reviewSemaphore = new Semaphore(GEMINI_MAX_CONCURRENCY);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const raw = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(raw, maxMs);
  const jitter = Math.floor(capped * 0.2 * Math.random());
  return capped + jitter;
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

function buildMockReview(pr: PrRecord, overrides?: ReviewOverrides): ReviewOutput {
  const title = overrides?.prTitle ?? pr.prKey;
  const files = pr.diff?.changedFiles ?? [];
  const summary: string[] = [
    'Mock review generated (Gemini disabled)',
    `PR: ${title}`,
    `Files changed: ${files.length}`,
  ];

  return {
    summary,
    riskFlags: [],
    testObservations: [],
    confidence: 0.5,
  };
}

/**
 * Run mandatory AI review on a PR.
 * Throws when Gemini is unavailable, times out, or returns invalid output.
 */
export async function runReview(pr: PrRecord, patches?: string, overrides?: ReviewOverrides): Promise<ReviewRunResult> {
  if (GEMINI_MOCK_MODE) {
    return { output: buildMockReview(pr, overrides), source: 'mock' };
  }

  const { reviewPR } = await import('@osm402/ai');
  const base = buildReviewInput(pr, patches);
  const input: ReviewInput = {
    ...base,
    prTitle: overrides?.prTitle ?? base.prTitle,
    prBody: overrides?.prBody ?? base.prBody,
    policyContext: overrides?.policyContext ?? base.policyContext,
  };

  for (let attempt = 1; attempt <= GEMINI_REVIEW_MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[reviewer] Gemini review start: pr=${pr.prKey}, model=${GEMINI_MODEL}, attempt=${attempt}/${GEMINI_REVIEW_MAX_ATTEMPTS}`
      );

      const release = await reviewSemaphore.acquire();
      const result = await (async () => {
        try {
          return await reviewPR(input, {
            apiKey: GEMINI_API_KEY,
            model: GEMINI_MODEL,
            timeoutMs: REVIEW_TIMEOUT_MS,
            maxRetries: GEMINI_MAX_RETRIES,
            retryBaseDelayMs: GEMINI_RETRY_BASE_DELAY_MS,
            retryMaxDelayMs: GEMINI_RETRY_MAX_DELAY_MS,
          });
        } finally {
          release();
        }
      })();

      if (result) {
        console.log(
          `[reviewer] Gemini review done: pr=${pr.prKey}, source=gemini, riskFlags=${result.riskFlags.length}, confidence=${result.confidence.toFixed(2)}`
        );
        return { output: result, source: 'gemini' };
      }

      throw new GeminiReviewError('Gemini returned no valid review output', true);
    } catch (error) {
      const retryable = error instanceof GeminiReviewError ? error.retryable : false;
      console.error('[reviewer] Review failed:', error);

      if (retryable && attempt < GEMINI_REVIEW_MAX_ATTEMPTS) {
        const delay = calcBackoffMs(attempt, GEMINI_REVIEW_RETRY_BASE_DELAY_MS, GEMINI_REVIEW_RETRY_MAX_DELAY_MS);
        console.warn(`[reviewer] Retrying after ${delay}ms (attempt ${attempt + 1}/${GEMINI_REVIEW_MAX_ATTEMPTS})`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw new GeminiReviewError('Gemini review failed after max attempts', false);
}
