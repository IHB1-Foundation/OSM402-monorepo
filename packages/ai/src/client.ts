/**
 * Gemini API client for PR review.
 */

import { ReviewOutputSchema, type ReviewInput, type ReviewOutput, type GeminiConfig } from './types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 8_000;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Build the review prompt from PR data
 */
function buildPrompt(input: ReviewInput): string {
  const lines = [
    'You are a code reviewer for a GitHub bounty system. Analyze the following PR and provide a structured review.',
    '',
    `PR Title: ${input.prTitle}`,
    `PR Body: ${input.prBody || '(no description)'}`,
    '',
    `Files changed (${input.diffSummary.filesChanged.length}):`,
    ...input.diffSummary.filesChanged.map((f) => `  - ${f}`),
    `Additions: ${input.diffSummary.additions}, Deletions: ${input.diffSummary.deletions}`,
  ];

  if (input.patches) {
    lines.push('', 'Patch (truncated):', input.patches.slice(0, 4000));
  }

  if (input.testResults) {
    lines.push('', 'Test results:', input.testResults);
  }

  if (input.policyContext) {
    lines.push('', 'Policy context:');
    lines.push(`  Required checks: ${input.policyContext.requiredChecks.join(', ') || 'none'}`);
    lines.push(`  Hold rules: ${input.policyContext.holdRules.join(', ') || 'none'}`);
    lines.push(`  Sensitive paths: ${(input.policyContext.sensitivePathPatterns || []).join(', ') || 'none'}`);
  }

  lines.push(
    '',
    'Risk flag guidance:',
    '- Use concise flags such as: touches-sensitive-path, new-dependency, coverage-drop, auth-change.',
    '- If changed files match any sensitive path pattern, riskFlags MUST include "touches-sensitive-path".',
    '- If lockfiles are changed, include "new-dependency".',
    '- If no meaningful risk is present, return an empty riskFlags array.',
    '',
    'Respond with ONLY a JSON object matching this schema:',
    '{',
    '  "summary": ["string array of 1-5 bullet points"],',
    '  "riskFlags": ["string array of risk flags like new-dependency, auth-change, etc."],',
    '  "testObservations": ["string array of test-related observations"],',
    '  "suggestedTier": "optional tier name suggestion",',
    '  "confidence": 0.0-1.0',
    '}',
    '',
    'IMPORTANT: If you have no suggestedTier, omit the field (do not set it to null).',
    'IMPORTANT: Return ONLY valid JSON, no markdown, no code fences.',
  );

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true; // network errors from fetch
  return false;
}

function calcBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const raw = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(raw, maxMs);
  const jitter = Math.floor(capped * 0.2 * Math.random());
  return capped + jitter;
}

/**
 * Call Gemini API and parse the review output
 */
export async function reviewPR(
  input: ReviewInput,
  config: GeminiConfig,
): Promise<ReviewOutput | null> {
  const model = config.model || DEFAULT_MODEL;
  const timeout = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryBaseDelayMs = Math.max(0, config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const retryMaxDelayMs = Math.max(retryBaseDelayMs, config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS);
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${config.apiKey}`;

  const prompt = buildPrompt(input);

  const totalAttempts = 1 + maxRetries;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[gemini] API error: ${res.status} ${body.slice(0, 500)}`);
        if (isRetryableStatus(res.status) && attempt < totalAttempts) {
          const delay = calcBackoffMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
          console.warn(`[gemini] Retrying after ${delay}ms (attempt ${attempt + 1}/${totalAttempts})`);
          await sleep(delay);
          continue;
        }
        return null;
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error('[gemini] No text in response');
        if (attempt < totalAttempts) {
          const delay = calcBackoffMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
          console.warn(`[gemini] Retrying after ${delay}ms (attempt ${attempt + 1}/${totalAttempts})`);
          await sleep(delay);
          continue;
        }
        return null;
      }

      // Parse and validate JSON
      const parsed = JSON.parse(text);
      const result = ReviewOutputSchema.safeParse(parsed);

      if (!result.success) {
        console.error('[gemini] Invalid response schema:', result.error.format());
        if (attempt < totalAttempts) {
          const delay = calcBackoffMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
          console.warn(`[gemini] Retrying after ${delay}ms (attempt ${attempt + 1}/${totalAttempts})`);
          await sleep(delay);
          continue;
        }
        return null;
      }

      return result.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[gemini] Request timed out after ${timeout}ms`);
      } else {
        console.error('[gemini] Request failed:', error);
      }
      if (isRetryableError(error) && attempt < totalAttempts) {
        const delay = calcBackoffMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
        console.warn(`[gemini] Retrying after ${delay}ms (attempt ${attempt + 1}/${totalAttempts})`);
        await sleep(delay);
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
