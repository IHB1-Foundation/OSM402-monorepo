/**
 * Payout store backed by SQLite.
 * Includes locking and idempotency guarantees.
 */

import { getDb } from './db.js';

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
  amountRaw?: string;
  tier?: string;
  cartHash?: string;
  intentHash?: string;
  txHash?: string;
  holdReasons?: string[];
  status: PayoutStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Record<string, unknown>): PayoutRecord {
  return {
    ...row,
    holdReasons: row.holdReasons ? JSON.parse(row.holdReasons as string) : undefined,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  } as PayoutRecord;
}

function payoutKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#PR${prNumber}`;
}

export function getPayout(repoKey: string, prNumber: number): PayoutRecord | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM payouts WHERE repoKey = ? AND prNumber = ?').get(repoKey, prNumber) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : undefined;
}

export function getPayoutByIssue(issueKey: string): PayoutRecord | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM payouts WHERE issueKey = ? AND status != 'FAILED' LIMIT 1").get(issueKey) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : undefined;
}

export function createPayout(payout: PayoutRecord): PayoutRecord | null {
  // Unique constraint: one active payout per issue
  const existingForIssue = getPayoutByIssue(payout.issueKey);
  if (existingForIssue) {
    console.log(`[payouts] Duplicate payout rejected for ${payout.issueKey} (existing: ${existingForIssue.prKey})`);
    return null;
  }

  const key = payoutKey(payout.repoKey, payout.prNumber);
  const existingForPr = getPayout(payout.repoKey, payout.prNumber);
  if (existingForPr && existingForPr.status !== 'FAILED') {
    console.log(`[payouts] Duplicate payout rejected for ${key} (status: ${existingForPr.status})`);
    return null;
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO payouts (id, issueKey, prKey, repoKey, issueNumber, prNumber, mergeSha, recipient, amountUsd, amountRaw, tier, cartHash, intentHash, txHash, holdReasons, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payout.id, payout.issueKey, payout.prKey, payout.repoKey,
    payout.issueNumber, payout.prNumber, payout.mergeSha,
    payout.recipient ?? null, payout.amountUsd,
    payout.amountRaw ?? null, payout.tier ?? null,
    payout.cartHash ?? null, payout.intentHash ?? null,
    payout.txHash ?? null,
    payout.holdReasons ? JSON.stringify(payout.holdReasons) : null,
    payout.status,
    payout.createdAt.toISOString(), payout.updatedAt.toISOString(),
  );

  return payout;
}

// In-memory execution locks (per-process, not persisted)
const executionLocks = new Set<string>();

export function acquirePayoutLock(repoKey: string, prNumber: number): boolean {
  const key = payoutKey(repoKey, prNumber);
  if (executionLocks.has(key)) return false;
  executionLocks.add(key);
  return true;
}

export function releasePayoutLock(repoKey: string, prNumber: number): void {
  executionLocks.delete(payoutKey(repoKey, prNumber));
}

export function updatePayout(
  repoKey: string,
  prNumber: number,
  update: Partial<PayoutRecord>,
): PayoutRecord | undefined {
  const existing = getPayout(repoKey, prNumber);
  if (!existing) return undefined;

  const merged = { ...existing, ...update, updatedAt: new Date() };
  const db = getDb();
  db.prepare(`
    UPDATE payouts SET
      recipient = ?, amountUsd = ?, amountRaw = ?, tier = ?,
      cartHash = ?, intentHash = ?, txHash = ?,
      holdReasons = ?, status = ?, updatedAt = ?
    WHERE repoKey = ? AND prNumber = ?
  `).run(
    merged.recipient ?? null, merged.amountUsd,
    merged.amountRaw ?? null, merged.tier ?? null,
    merged.cartHash ?? null, merged.intentHash ?? null,
    merged.txHash ?? null,
    merged.holdReasons ? JSON.stringify(merged.holdReasons) : null,
    merged.status, merged.updatedAt.toISOString(),
    repoKey, prNumber,
  );

  return merged;
}

export function getAllPayouts(): PayoutRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM payouts').all() as Record<string, unknown>[];
  return rows.map(toRecord);
}
