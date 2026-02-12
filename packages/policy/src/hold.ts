import type { Policy, HoldRule } from './types.js';
import { minimatch } from 'minimatch';

/**
 * PR metadata for HOLD evaluation
 */
export interface PRMetadata {
  filesChanged: string[];
  newDependencies?: string[];
  coverageChange?: number; // Negative means drop
  riskFlags?: string[]; // From AI analysis
}

/**
 * HOLD evaluation result
 */
export interface HoldResult {
  shouldHold: boolean;
  reasons: string[];
}

/**
 * Evaluate HOLD rules against PR metadata
 * @param policy Parsed policy with holdIf rules
 * @param pr PR metadata
 * @returns HOLD result with reasons list
 */
export function evaluateHold(policy: Policy, pr: PRMetadata): HoldResult {
  const reasons: string[] = [];

  if (!policy.holdIf || policy.holdIf.length === 0) {
    return { shouldHold: false, reasons: [] };
  }

  for (const rule of policy.holdIf) {
    const ruleResult = evaluateRule(rule, pr);
    if (ruleResult) {
      reasons.push(ruleResult);
    }
  }

  return {
    shouldHold: reasons.length > 0,
    reasons,
  };
}

/**
 * Evaluate a single HOLD rule
 * @returns Reason string if rule triggered, null otherwise
 */
function evaluateRule(rule: HoldRule, pr: PRMetadata): string | null {
  switch (rule.rule) {
    case 'touchesPaths':
      return evaluateTouchesPaths(rule, pr);
    case 'newDependencies':
      return evaluateNewDependencies(pr);
    case 'coverageDrop':
      return evaluateCoverageDrop(rule, pr);
    default:
      return null;
  }
}

/**
 * Check if PR touches any of the specified paths
 */
function evaluateTouchesPaths(rule: HoldRule, pr: PRMetadata): string | null {
  if (!rule.any || rule.any.length === 0) {
    return null;
  }

  const matchedPaths: string[] = [];

  for (const file of pr.filesChanged) {
    for (const pattern of rule.any) {
      if (minimatch(file, pattern)) {
        matchedPaths.push(file);
        break;
      }
    }
  }

  if (matchedPaths.length > 0) {
    return `Touches sensitive paths: ${matchedPaths.join(', ')}`;
  }

  return null;
}

/**
 * Check if PR adds new dependencies
 */
function evaluateNewDependencies(pr: PRMetadata): string | null {
  if (pr.newDependencies && pr.newDependencies.length > 0) {
    return `New dependencies added: ${pr.newDependencies.join(', ')}`;
  }
  return null;
}

/**
 * Check if coverage dropped beyond threshold
 */
function evaluateCoverageDrop(rule: HoldRule, pr: PRMetadata): string | null {
  if (pr.coverageChange === undefined || rule.gtPercent === undefined) {
    return null;
  }

  // Negative coverageChange means drop
  const drop = -pr.coverageChange;

  if (drop > rule.gtPercent) {
    return `Coverage dropped by ${drop.toFixed(1)}% (threshold: ${rule.gtPercent}%)`;
  }

  return null;
}

/**
 * Evaluate AI risk flags (for future AI integration)
 * @param riskFlags Flags from AI analysis
 * @param policy Policy with AI risk mappings (future)
 * @returns HOLD reasons from risk flags
 */
export function evaluateRiskFlags(riskFlags: string[]): string[] {
  // In MVP, just pass through risk flags as HOLD reasons
  // Future: Map risk flags to policy-defined HOLD conditions
  if (riskFlags.length === 0) {
    return [];
  }
  return riskFlags.map((flag) => `AI risk flag: ${flag}`);
}

/**
 * Combined HOLD evaluation with AI risk flags
 */
export function evaluateHoldWithRiskFlags(
  policy: Policy,
  pr: PRMetadata,
  riskFlags: string[] = []
): HoldResult {
  const policyResult = evaluateHold(policy, pr);
  const riskReasons = evaluateRiskFlags(riskFlags);

  return {
    shouldHold: policyResult.shouldHold || riskReasons.length > 0,
    reasons: [...policyResult.reasons, ...riskReasons],
  };
}
