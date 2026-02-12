/**
 * Handler for pull_request.opened and pull_request.synchronize webhook events.
 * Stores PR metadata and diff summary.
 */

import { getPr, upsertPr, updatePr, getPrKey, type DiffSummary } from '../store/prs.js';

interface PrPayload {
  action: 'opened' | 'synchronize' | 'closed';
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    head: { sha: string };
    base: { ref: string };
    merged?: boolean;
    merge_commit_sha?: string | null;
    changed_files?: number;
    additions?: number;
    deletions?: number;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
}

/**
 * Extract linked issue number from PR body.
 * Looks for patterns like: "Closes #123", "Fixes #42", "Resolves #7"
 */
function extractLinkedIssue(body: string | null): number | undefined {
  if (!body) return undefined;
  const match = body.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  return match ? parseInt(match[1]!, 10) : undefined;
}

export async function handlePrOpened(payload: PrPayload): Promise<{
  handled: boolean;
  prKey?: string;
  linkedIssue?: number;
}> {
  const repoKey = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const prKey = getPrKey(repoKey, prNumber);
  const pr = payload.pull_request;
  const linkedIssue = extractLinkedIssue(pr.body);

  const diff: DiffSummary = {
    filesChanged: pr.changed_files || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changedFiles: [], // Would be populated from a separate API call
  };

  upsertPr({
    id: prKey,
    prKey,
    repoKey,
    prNumber,
    issueNumber: linkedIssue,
    contributorGithub: pr.user.login,
    diff,
    status: 'OPEN',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[pr-event] PR ${prKey} opened by ${pr.user.login}, linked issue: ${linkedIssue ?? 'none'}`);

  return { handled: true, prKey, linkedIssue };
}

export async function handlePrSynchronize(payload: PrPayload): Promise<{
  handled: boolean;
  prKey?: string;
}> {
  const repoKey = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const prKey = getPrKey(repoKey, prNumber);
  const pr = payload.pull_request;

  const existing = getPr(repoKey, prNumber);

  const diff: DiffSummary = {
    filesChanged: pr.changed_files || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changedFiles: [],
  };

  if (existing) {
    updatePr(repoKey, prNumber, { diff });
    console.log(`[pr-event] PR ${prKey} synchronized (updated diff)`);
  } else {
    // PR not in store yet, create it
    const linkedIssue = extractLinkedIssue(pr.body);
    upsertPr({
      id: prKey,
      prKey,
      repoKey,
      prNumber,
      issueNumber: linkedIssue,
      contributorGithub: pr.user.login,
      diff,
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`[pr-event] PR ${prKey} synchronized (created record)`);
  }

  return { handled: true, prKey };
}
