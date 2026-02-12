/**
 * Minimal GitHub API client for posting comments.
 * Uses GITHUB_TOKEN or GITHUB_APP installation token.
 */

const GITHUB_API = 'https://api.github.com';

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
}

/**
 * Post a comment on a GitHub issue or PR
 */
export async function postIssueComment(
  repoKey: string,
  issueNumber: number,
  body: string,
): Promise<boolean> {
  const token = getToken();
  if (!token) {
    console.log(`[github] No token available. Would comment on ${repoKey}#${issueNumber}:`);
    console.log(`[github]   ${body.slice(0, 200)}...`);
    return false;
  }

  const url = `${GITHUB_API}/repos/${repoKey}/issues/${issueNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    console.error(`[github] Failed to post comment: ${res.status} ${await res.text()}`);
    return false;
  }

  return true;
}
