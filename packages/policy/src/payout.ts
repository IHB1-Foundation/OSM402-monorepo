import type { Policy, Tier, PathMatch } from './types.js';
import { minimatch } from 'minimatch';

/**
 * PR diff summary for payout calculation
 */
export interface DiffSummary {
  filesChanged: string[];
  additions: number;
  deletions: number;
}

/**
 * Payout calculation result
 */
export interface PayoutResult {
  amountUsd: number;
  tier: string | null;
  reason: string;
}

/**
 * Calculate deterministic payout based on policy and PR diff
 * @param policy Parsed policy
 * @param diff PR diff summary
 * @returns Payout amount and tier info
 */
export function calculatePayout(policy: Policy, diff: DiffSummary): PayoutResult {
  const { payout } = policy;

  if (payout.mode === 'fixed') {
    return {
      amountUsd: payout.fixedAmountUsd ?? 0,
      tier: null,
      reason: 'Fixed payout mode',
    };
  }

  if (payout.mode === 'tiered' && payout.tiers) {
    // Evaluate tiers in order (first match wins for determinism)
    for (const tier of payout.tiers) {
      if (matchesTier(tier, diff)) {
        return {
          amountUsd: tier.amountUsd,
          tier: tier.name,
          reason: `Matched tier: ${tier.name}`,
        };
      }
    }

    // No tier matched - return 0
    return {
      amountUsd: 0,
      tier: null,
      reason: 'No matching tier found',
    };
  }

  return {
    amountUsd: 0,
    tier: null,
    reason: 'Unknown payout mode',
  };
}

/**
 * Check if a diff matches a tier's criteria
 */
function matchesTier(tier: Tier, diff: DiffSummary): boolean {
  if (!tier.match) {
    // No match criteria means always match
    return true;
  }

  return matchesPathCriteria(tier.match, diff);
}

/**
 * Check if diff matches path/size criteria
 */
function matchesPathCriteria(match: PathMatch, diff: DiffSummary): boolean {
  // Check onlyPaths - ALL files must match at least one pattern
  if (match.onlyPaths && match.onlyPaths.length > 0) {
    const allMatch = diff.filesChanged.every((file) =>
      match.onlyPaths!.some((pattern) => minimatch(file, pattern))
    );
    if (!allMatch) {
      return false;
    }
  }

  // Check anyPaths - AT LEAST ONE file must match at least one pattern
  if (match.anyPaths && match.anyPaths.length > 0) {
    const anyMatch = diff.filesChanged.some((file) =>
      match.anyPaths!.some((pattern) => minimatch(file, pattern))
    );
    if (!anyMatch) {
      return false;
    }
  }

  // Check maxFilesChanged
  if (match.maxFilesChanged !== undefined) {
    if (diff.filesChanged.length > match.maxFilesChanged) {
      return false;
    }
  }

  // Check maxAdditions
  if (match.maxAdditions !== undefined) {
    if (diff.additions > match.maxAdditions) {
      return false;
    }
  }

  // Check maxDeletions
  if (match.maxDeletions !== undefined) {
    if (diff.deletions > match.maxDeletions) {
      return false;
    }
  }

  return true;
}

/**
 * Get the maximum possible payout for a policy
 */
export function getMaxPayout(policy: Policy): number {
  const { payout } = policy;

  if (payout.mode === 'fixed') {
    return payout.fixedAmountUsd ?? 0;
  }

  if (payout.mode === 'tiered' && payout.tiers) {
    return Math.max(...payout.tiers.map((t) => t.amountUsd), 0);
  }

  return 0;
}
