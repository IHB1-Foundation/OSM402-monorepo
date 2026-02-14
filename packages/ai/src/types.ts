import { z } from 'zod';

/**
 * Gemini review output schema (strict JSON)
 * AI never sets payout amount. AI is only for explanation + HOLD signals.
 */
export const ReviewOutputSchema = z.object({
  summary: z.array(z.string()).min(1).max(10),
  riskFlags: z.array(z.string()),
  testObservations: z.array(z.string()),
  suggestedTier: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/**
 * Input for the AI reviewer
 */
export interface ReviewInput {
  prTitle: string;
  prBody: string | null;
  diffSummary: {
    filesChanged: string[];
    additions: number;
    deletions: number;
  };
  patches?: string; // Truncated patch content
  testResults?: string;
  policyContext?: {
    requiredChecks: string[];
    holdRules: string[];
    sensitivePathPatterns?: string[];
  };
}

/**
 * Gemini client configuration
 */
export interface GeminiConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}
