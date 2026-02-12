/**
 * In-memory payout store for MVP
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

function payoutKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#PR${prNumber}`;
}

export function getPayout(repoKey: string, prNumber: number): PayoutRecord | undefined {
  return payouts.get(payoutKey(repoKey, prNumber));
}

export function upsertPayout(payout: PayoutRecord): PayoutRecord {
  payouts.set(payoutKey(payout.repoKey, payout.prNumber), payout);
  return payout;
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
