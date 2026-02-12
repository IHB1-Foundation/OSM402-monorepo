/**
 * Issue store backed by SQLite.
 */

import { getDb } from './db.js';

export type IssueStatus = 'PENDING' | 'FUNDED' | 'PAID' | 'EXPIRED';

export interface IssueRecord {
  id: string;
  repoKey: string;
  issueNumber: number;
  bountyCap: string;
  asset: string;
  chainId: number;
  policyHash: string;
  expiry?: number; // unix seconds
  escrowAddress?: string;
  intentHash?: string;
  fundingTxHash?: string;
  status: IssueStatus;
  createdAt: Date;
  fundedAt?: Date;
}

function toRecord(row: Record<string, unknown>): IssueRecord {
  return {
    ...row,
    expiry: row.expiry ? Number(row.expiry) : undefined,
    createdAt: new Date(row.createdAt as string),
    fundedAt: row.fundedAt ? new Date(row.fundedAt as string) : undefined,
  } as IssueRecord;
}

export function getIssueKey(repoKey: string, issueNumber: number): string {
  return `${repoKey}#${issueNumber}`;
}

export function getIssue(repoKey: string, issueNumber: number): IssueRecord | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM issues WHERE repoKey = ? AND issueNumber = ?').get(repoKey, issueNumber) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : undefined;
}

export function upsertIssue(issue: IssueRecord): IssueRecord {
  const db = getDb();
  db.prepare(`
    INSERT INTO issues (id, repoKey, issueNumber, bountyCap, asset, chainId, policyHash, expiry, escrowAddress, intentHash, fundingTxHash, status, createdAt, fundedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repoKey, issueNumber) DO UPDATE SET
      bountyCap = excluded.bountyCap,
      asset = excluded.asset,
      chainId = excluded.chainId,
      policyHash = excluded.policyHash,
      expiry = COALESCE(excluded.expiry, issues.expiry),
      escrowAddress = COALESCE(excluded.escrowAddress, issues.escrowAddress),
      intentHash = COALESCE(excluded.intentHash, issues.intentHash),
      fundingTxHash = COALESCE(excluded.fundingTxHash, issues.fundingTxHash),
      status = excluded.status,
      fundedAt = COALESCE(excluded.fundedAt, issues.fundedAt)
  `).run(
    issue.id, issue.repoKey, issue.issueNumber, issue.bountyCap,
    issue.asset, issue.chainId, issue.policyHash,
    issue.expiry ?? null,
    issue.escrowAddress ?? null, issue.intentHash ?? null,
    issue.fundingTxHash ?? null, issue.status,
    issue.createdAt.toISOString(), issue.fundedAt?.toISOString() ?? null,
  );
  return issue;
}

export function updateIssueStatus(
  repoKey: string,
  issueNumber: number,
  update: Partial<IssueRecord>,
): IssueRecord | undefined {
  const existing = getIssue(repoKey, issueNumber);
  if (!existing) return undefined;
  const merged = { ...existing, ...update };
  return upsertIssue(merged);
}

export function markIssueFunded(
  repoKey: string,
  issueNumber: number,
  escrowAddress: string,
  intentHash: string,
  fundingTxHash?: string,
): IssueRecord | undefined {
  return updateIssueStatus(repoKey, issueNumber, {
    status: 'FUNDED',
    escrowAddress,
    intentHash,
    fundingTxHash,
    fundedAt: new Date(),
  });
}

export function getAllIssues(): IssueRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM issues').all() as Record<string, unknown>[];
  return rows.map(toRecord);
}
