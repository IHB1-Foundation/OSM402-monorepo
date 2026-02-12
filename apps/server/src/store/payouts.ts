/**
 * In-memory payout store for MVP
 * Includes locking and idempotency guarantees.
 */

export type PayoutStatus = 'PENDING' | 'HOLD' | 'EXECUTING' | 'DONE' | 'FAILED';

export interface PayoutRecord {
  id: string;
  issueKey: string;
  prKey: string;
  repoKey: string;
  issueNumber: number;
  prNumber: number;
  mergeSha: string;
  recipient?: string;
  amountUsd: number;
  amountRaw?: string; // USDC units
  tier?: string;
  cartHash?: string;
  intentHash?: string;
  txHash?: string;
  holdReasons?: string[];
  status: PayoutStatus;
  createdAt: Date;
  updatedAt: Date;
}

const payouts = new Map<string, PayoutRecord>();

// Unique constraint: one payout per issue (prevents double payout for same issue)
const issuePayoutIndex = new Map<string, string>(); // issueKey → payoutKey

// Lock set: prevents concurrent execution of the same payout
const executionLocks = new Set<string>();

function payoutKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#PR${prNumber}`;
}

export function getPayout(repoKey: string, prNumber: number): PayoutRecord | undefined {
  return payouts.get(payoutKey(repoKey, prNumber));
}

/**
 * Check if an issue already has a non-failed payout
 */
export function getPayoutByIssue(issueKey: string): PayoutRecord | undefined {
  const pk = issuePayoutIndex.get(issueKey);
  if (!pk) return undefined;
  const payout = payouts.get(pk);
  if (payout && payout.status !== 'FAILED') return payout;
  return undefined;
}

/**
 * Create a payout record. Enforces uniqueness per issue.
 * Returns null if a non-failed payout already exists for this issue.
 */
export function createPayout(payout: PayoutRecord): PayoutRecord | null {
  // Unique constraint: one active payout per issue
  const existingForIssue = getPayoutByIssue(payout.issueKey);
  if (existingForIssue) {
    console.log(`[payouts] Duplicate payout rejected for ${payout.issueKey} (existing: ${existingForIssue.prKey})`);
    return null;
  }

  const key = payoutKey(payout.repoKey, payout.prNumber);

  // Unique constraint: one payout per PR
  if (payouts.has(key)) {
    const existing = payouts.get(key)!;
    if (existing.status !== 'FAILED') {
      console.log(`[payouts] Duplicate payout rejected for ${key} (status: ${existing.status})`);
      return null;
    }
  }

  payouts.set(key, payout);
  issuePayoutIndex.set(payout.issueKey, key);
  return payout;
}

/**
 * Acquire execution lock for a payout.
 * Returns false if lock already held (concurrent execution).
 */
export function acquirePayoutLock(repoKey: string, prNumber: number): boolean {
  const key = payoutKey(repoKey, prNumber);
  if (executionLocks.has(key)) return false;
  executionLocks.add(key);
  return true;
}

/**
 * Release execution lock for a payout.
 */
export function releasePayoutLock(repoKey: string, prNumber: number): void {
  executionLocks.delete(payoutKey(repoKey, prNumber));
}

export function updatePayout(
  repoKey: string,
  prNumber: number,
  update: Partial<PayoutRecord>,
): PayoutRecord | undefined {
  const key = payoutKey(repoKey, prNumber);
  const existing = payouts.get(key);
  if (!existing) return undefined;
  const updated = { ...existing, ...update, updatedAt: new Date() };
  payouts.set(key, updated);
  return updated;
}

export function getAllPayouts(): PayoutRecord[] {
  return Array.from(payouts.values());
}
