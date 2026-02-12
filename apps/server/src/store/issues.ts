/**
 * In-memory issue store for MVP
 * Will be replaced with Prisma in production
 */

export type IssueStatus = 'PENDING' | 'FUNDED' | 'PAID' | 'EXPIRED';

export interface IssueRecord {
  id: string;
  repoKey: string; // owner/repo
  issueNumber: number;
  bountyCap: string; // In smallest unit (e.g., USDC with 6 decimals)
  asset: string; // ERC20 address
  chainId: number;
  policyHash: string;
  escrowAddress?: string;
  intentHash?: string;
  fundingTxHash?: string;
  status: IssueStatus;
  createdAt: Date;
  fundedAt?: Date;
}

// In-memory store
const issues = new Map<string, IssueRecord>();

/**
 * Generate issue key from repo and issue number
 */
export function getIssueKey(repoKey: string, issueNumber: number): string {
  return `${repoKey}#${issueNumber}`;
}

/**
 * Get issue record
 */
export function getIssue(repoKey: string, issueNumber: number): IssueRecord | undefined {
  return issues.get(getIssueKey(repoKey, issueNumber));
}

/**
 * Create or update issue record
 */
export function upsertIssue(issue: IssueRecord): IssueRecord {
  const key = getIssueKey(issue.repoKey, issue.issueNumber);
  issues.set(key, issue);
  return issue;
}

/**
 * Update issue status
 */
export function updateIssueStatus(
  repoKey: string,
  issueNumber: number,
  update: Partial<IssueRecord>
): IssueRecord | undefined {
  const key = getIssueKey(repoKey, issueNumber);
  const existing = issues.get(key);
  if (!existing) return undefined;

  const updated = { ...existing, ...update };
  issues.set(key, updated);
  return updated;
}

/**
 * Mark issue as funded
 */
export function markIssueFunded(
  repoKey: string,
  issueNumber: number,
  escrowAddress: string,
  intentHash: string,
  fundingTxHash?: string
): IssueRecord | undefined {
  return updateIssueStatus(repoKey, issueNumber, {
    status: 'FUNDED',
    escrowAddress,
    intentHash,
    fundingTxHash,
    fundedAt: new Date(),
  });
}

/**
 * Get all issues (for debugging)
 */
export function getAllIssues(): IssueRecord[] {
  return Array.from(issues.values());
}
