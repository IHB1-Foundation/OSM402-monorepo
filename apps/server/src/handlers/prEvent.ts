/**
 * Handler for pull_request.opened and pull_request.synchronize webhook events.
 * Stores PR metadata and diff summary.
 */

import { getPr, upsertPr, updatePr, getPrKey, type DiffSummary } from '../store/prs.js';
import { runReview, getReviewerStatus, buildPolicyContext } from '../services/reviewer.js';
import { postIssueComment } from '../services/github.js';
import { fetchPrFiles, fetchRepoFile } from '../services/github.js';
import { reviewComment } from '../services/comments.js';
import { extractAddressFromPrBody } from './addressClaim.js';

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
    changed_files_list?: string[];
    additions?: number;
    deletions?: number;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
}

function normalizeChangedFilesList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

async function loadPolicyContext(repoKey: string, ref: string) {
  const { parsePolicySafe } = await import('@osm402/policy');
  const policyYaml = await fetchRepoFile(repoKey, '.osm402.yml', ref);
  if (!policyYaml) return undefined;
  const parsed = parsePolicySafe(policyYaml);
  if (!parsed) return undefined;
  return buildPolicyContext(parsed);
}

async function postCommentOrThrow(repoKey: string, prNumber: number, body: string): Promise<void> {
  const posted = await postIssueComment(repoKey, prNumber, body);
  if (!posted) {
    throw new Error(`Mandatory PR comment failed for ${repoKey}#PR${prNumber}`);
  }
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
  const changedFilesFromApi = await fetchPrFiles(repoKey, prNumber);
  const changedFilesFromPayload = normalizeChangedFilesList(pr.changed_files_list);
  const changedFiles = changedFilesFromApi.length > 0 ? changedFilesFromApi : changedFilesFromPayload;

  const diff: DiffSummary = {
    filesChanged: pr.changed_files ?? changedFiles.length,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles,
  };

  const contributorAddress = extractAddressFromPrBody(pr.body) ?? undefined;

  upsertPr({
    id: prKey,
    prKey,
    repoKey,
    prNumber,
    issueNumber: linkedIssue,
    contributorGithub: pr.user.login,
    contributorAddress,
    diff,
    status: 'OPEN',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[pr-event] PR ${prKey} opened by ${pr.user.login}, linked issue: ${linkedIssue ?? 'none'}, address: ${contributorAddress ?? 'none'}`);

  // Run mandatory AI review and post result comment.
  const prRecord = getPr(repoKey, prNumber);
  if (prRecord) {
    try {
      const policyContext = await loadPolicyContext(repoKey, pr.head.sha);
      const review = await runReview(prRecord, undefined, {
        prTitle: pr.title,
        prBody: pr.body,
        policyContext,
      });
      const reviewer = getReviewerStatus();
      const comment = reviewComment({
        ...review.output,
        aiProvider: reviewer.provider,
        aiModel: reviewer.model,
        aiSource: review.source,
      });
      await postCommentOrThrow(repoKey, prNumber, comment);
      console.log(`[pr-event] AI review posted on ${prKey} (source=${review.source})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[pr-event] Mandatory AI review failed on ${prKey}: ${message}`);
      await postCommentOrThrow(
        repoKey,
        prNumber,
        `**OSM402** AI review failed and must be resolved before payout.\n\nReason: \`${message}\``
      );
      throw error;
    }
  }

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
  const changedFilesFromApi = await fetchPrFiles(repoKey, prNumber);
  const changedFilesFromPayload = normalizeChangedFilesList(pr.changed_files_list);
  const changedFiles = changedFilesFromApi.length > 0 ? changedFilesFromApi : changedFilesFromPayload;

  const existing = getPr(repoKey, prNumber);

  const diff: DiffSummary = {
    filesChanged: pr.changed_files ?? changedFiles.length,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles,
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
