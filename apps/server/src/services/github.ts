/**
 * GitHub API client for posting comments and reading repo data.
 * Uses GITHUB_TOKEN or GitHub App installation token.
 */

import { getInstallationTokenForRepo } from './githubAppAuth.js';

const GITHUB_API = 'https://api.github.com';

async function getToken(repoKey: string): Promise<string | undefined> {
  if (process.env.GITHUB_APP_TOKEN) return process.env.GITHUB_APP_TOKEN;

  const appToken = await getInstallationTokenForRepo(repoKey);
  if (appToken) return appToken;

  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return undefined;
}

async function headers(repoKey: string): Promise<Record<string, string>> {
  const token = await getToken(repoKey);
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Post a comment on a GitHub issue or PR
 */
export async function postIssueComment(
  repoKey: string,
  issueNumber: number,
  body: string,
): Promise<boolean> {
  const token = await getToken(repoKey);
  if (!token) {
    console.log(`[github] No token available. Would comment on ${repoKey}#${issueNumber}:`);
    console.log(`[github]   ${body.slice(0, 200)}...`);
    return false;
  }

  const url = `${GITHUB_API}/repos/${repoKey}/issues/${issueNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await headers(repoKey),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    console.error(`[github] Failed to post comment: ${res.status} ${await res.text()}`);
    return false;
  }

  return true;
}

/**
 * Fetch a file's content from a repo (e.g. .osm402.yml).
 * Returns decoded UTF-8 string or null if not found / no token.
 */
export async function fetchRepoFile(
  repoKey: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  if (!(await getToken(repoKey))) {
    console.log(`[github] No token — cannot fetch ${repoKey}/${path}`);
    return null;
  }

  const url = `${GITHUB_API}/repos/${repoKey}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
  const res = await fetch(url, { headers: await headers(repoKey) });

  if (!res.ok) {
    if (res.status === 404) {
      console.log(`[github] File not found: ${repoKey}/${path}`);
    } else {
      console.error(`[github] Failed to fetch file: ${res.status}`);
    }
    return null;
  }

  const data = await res.json() as { content?: string; encoding?: string };
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return null;
}

/**
 * Fetch the list of changed file paths for a PR.
 */
export async function fetchPrFiles(
  repoKey: string,
  prNumber: number,
): Promise<string[]> {
  if (!(await getToken(repoKey))) {
    console.log(`[github] No token — cannot fetch PR files for ${repoKey}#PR${prNumber}`);
    return [];
  }

  const files: string[] = [];
  let page = 1;
  while (true) {
    const url = `${GITHUB_API}/repos/${repoKey}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: await headers(repoKey) });
    if (!res.ok) {
      console.error(`[github] Failed to fetch PR files: ${res.status}`);
      break;
    }
    const items = await res.json() as { filename: string }[];
    if (items.length === 0) break;
    files.push(...items.map(f => f.filename));
    if (items.length < 100) break;
    page++;
  }

  return files;
}

/**
 * Fetch check-run statuses for a commit SHA.
 * Returns a map of check-name → conclusion (e.g. "success", "failure", "neutral").
 */
export async function fetchCheckRuns(
  repoKey: string,
  sha: string,
): Promise<Record<string, string>> {
  if (!(await getToken(repoKey))) {
    console.log(`[github] No token — cannot fetch check runs for ${repoKey}@${sha}`);
    return {};
  }

  const results: Record<string, string> = {};
  let page = 1;
  while (true) {
    const url = `${GITHUB_API}/repos/${repoKey}/commits/${sha}/check-runs?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: await headers(repoKey) });
    if (!res.ok) {
      console.error(`[github] Failed to fetch check runs: ${res.status}`);
      break;
    }
    const data = await res.json() as { check_runs: { name: string; conclusion: string | null }[] };
    for (const cr of data.check_runs) {
      results[cr.name] = cr.conclusion ?? 'pending';
    }
    if (data.check_runs.length < 100) break;
    page++;
  }

  return results;
}

export async function mergePullRequest(
  repoKey: string,
  prNumber: number,
  params?: {
    mergeMethod?: 'merge' | 'squash' | 'rebase';
    sha?: string;
    commitTitle?: string;
    commitMessage?: string;
  }
): Promise<{
  success: boolean;
  merged: boolean;
  mergeSha?: string;
  message?: string;
  status?: number;
  error?: string;
}> {
  const token = await getToken(repoKey);
  if (!token) {
    console.log(`[github] No token — cannot merge ${repoKey}#PR${prNumber}`);
    return { success: false, merged: false, error: 'no_token' };
  }

  const url = `${GITHUB_API}/repos/${repoKey}/pulls/${prNumber}/merge`;
  const body: Record<string, unknown> = {};
  if (params?.mergeMethod) body.merge_method = params.mergeMethod;
  if (params?.sha) body.sha = params.sha;
  if (params?.commitTitle) body.commit_title = params.commitTitle;
  if (params?.commitMessage) body.commit_message = params.commitMessage;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...(await headers(repoKey)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error(`[github] Failed to merge PR: ${res.status} ${text}`);
    return {
      success: false,
      merged: false,
      status: res.status,
      error: typeof data === 'object' ? JSON.stringify(data) : String(data),
    };
  }

  return {
    success: true,
    merged: Boolean(data.merged),
    mergeSha: typeof data.sha === 'string' ? data.sha : undefined,
    message: typeof data.message === 'string' ? data.message : undefined,
    status: res.status,
  };
}
