/**
 * PR store backed by SQLite.
 */

import { getDb } from './db.js';

export type PrStatus = 'OPEN' | 'MERGED' | 'CLOSED' | 'PAID';

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  changedFiles: string[];
}

export interface PrRecord {
  id: string;
  prKey: string;
  repoKey: string;
  prNumber: number;
  issueNumber?: number;
  mergeSha?: string;
  contributorGithub: string;
  contributorAddress?: string;
  diff?: DiffSummary;
  status: PrStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Record<string, unknown>): PrRecord {
  return {
    id: row.id as string,
    prKey: row.prKey as string,
    repoKey: row.repoKey as string,
    prNumber: row.prNumber as number,
    issueNumber: row.issueNumber as number | undefined,
    mergeSha: row.mergeSha as string | undefined,
    contributorGithub: row.contributorGithub as string,
    contributorAddress: row.contributorAddress as string | undefined,
    diff: {
      filesChanged: row.filesChanged as number,
      additions: row.additions as number,
      deletions: row.deletions as number,
      changedFiles: JSON.parse((row.changedFiles as string) || '[]'),
    },
    status: row.status as PrStatus,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

export function getPrKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#PR${prNumber}`;
}

export function getPr(repoKey: string, prNumber: number): PrRecord | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM prs WHERE repoKey = ? AND prNumber = ?').get(repoKey, prNumber) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : undefined;
}

export function upsertPr(pr: PrRecord): PrRecord {
  const db = getDb();
  db.prepare(`
    INSERT INTO prs (id, prKey, repoKey, prNumber, issueNumber, mergeSha, contributorGithub, contributorAddress, filesChanged, additions, deletions, changedFiles, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repoKey, prNumber) DO UPDATE SET
      issueNumber = COALESCE(excluded.issueNumber, prs.issueNumber),
      mergeSha = COALESCE(excluded.mergeSha, prs.mergeSha),
      contributorGithub = excluded.contributorGithub,
      contributorAddress = COALESCE(excluded.contributorAddress, prs.contributorAddress),
      filesChanged = excluded.filesChanged,
      additions = excluded.additions,
      deletions = excluded.deletions,
      changedFiles = excluded.changedFiles,
      status = excluded.status,
      updatedAt = excluded.updatedAt
  `).run(
    pr.id, pr.prKey, pr.repoKey, pr.prNumber,
    pr.issueNumber ?? null, pr.mergeSha ?? null,
    pr.contributorGithub, pr.contributorAddress ?? null,
    pr.diff?.filesChanged ?? 0, pr.diff?.additions ?? 0,
    pr.diff?.deletions ?? 0,
    JSON.stringify(pr.diff?.changedFiles ?? []),
    pr.status,
    pr.createdAt.toISOString(), pr.updatedAt.toISOString(),
  );
  return pr;
}

export function updatePr(
  repoKey: string,
  prNumber: number,
  update: Partial<PrRecord>,
): PrRecord | undefined {
  const existing = getPr(repoKey, prNumber);
  if (!existing) return undefined;
  const merged = {
    ...existing,
    ...update,
    diff: update.diff ? { ...existing.diff, ...update.diff } as DiffSummary : existing.diff,
    updatedAt: new Date(),
  };
  return upsertPr(merged);
}

export function getAllPrs(): PrRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM prs').all() as Record<string, unknown>[];
  return rows.map(toRecord);
}
