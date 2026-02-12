/**
 * In-memory PR store for MVP
 */

export type PrStatus = 'OPEN' | 'MERGED' | 'CLOSED' | 'PAID';

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  changedFiles: string[];
}

export interface PrRecord {
  id: string;
  prKey: string; // owner/repo#PR123
  repoKey: string;
  prNumber: number;
  issueNumber?: number; // Linked issue
  mergeSha?: string;
  contributorGithub: string;
  contributorAddress?: string;
  diff?: DiffSummary;
  status: PrStatus;
  createdAt: Date;
  updatedAt: Date;
}

const prs = new Map<string, PrRecord>();

export function getPrKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#PR${prNumber}`;
}

export function getPr(repoKey: string, prNumber: number): PrRecord | undefined {
  return prs.get(getPrKey(repoKey, prNumber));
}

export function upsertPr(pr: PrRecord): PrRecord {
  prs.set(pr.prKey, pr);
  return pr;
}

export function updatePr(
  repoKey: string,
  prNumber: number,
  update: Partial<PrRecord>,
): PrRecord | undefined {
  const key = getPrKey(repoKey, prNumber);
  const existing = prs.get(key);
  if (!existing) return undefined;
  const updated = { ...existing, ...update, updatedAt: new Date() };
  prs.set(key, updated);
  return updated;
}

export function getAllPrs(): PrRecord[] {
  return Array.from(prs.values());
}
