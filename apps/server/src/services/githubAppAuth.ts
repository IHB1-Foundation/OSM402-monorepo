import crypto from 'node:crypto';

const GITHUB_API = 'https://api.github.com';

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getAppId(): string | null {
  const id = process.env.GITHUB_APP_ID;
  return id && id.trim().length > 0 ? id.trim() : null;
}

function getPrivateKeyPem(): string | null {
  const raw = process.env.GITHUB_PRIVATE_KEY_PEM;
  if (!raw || raw.trim().length === 0) return null;
  // GitHub App private keys are often stored with literal "\n" in env vars.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function buildAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 30,
    exp: now + 9 * 60, // max 10 minutes; keep a small buffer
    iss: appId,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKeyPem);

  return `${signingInput}.${base64url(sig)}`;
}

type CachedToken = { token: string; expiresAtMs: number };
const installationTokenCache = new Map<string, CachedToken>(); // repoKey -> token

function isValidCachedToken(token: CachedToken): boolean {
  // Refresh a bit early
  return Date.now() + 60_000 < token.expiresAtMs;
}

async function githubFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Get a GitHub App installation token for a repo (owner/repo).
 * Returns null if GitHub App env vars are not configured.
 */
export async function getInstallationTokenForRepo(repoKey: string): Promise<string | null> {
  const cached = installationTokenCache.get(repoKey);
  if (cached && isValidCachedToken(cached)) return cached.token;

  const appId = getAppId();
  const privateKeyPem = getPrivateKeyPem();
  if (!appId || !privateKeyPem) return null;

  const jwt = buildAppJwt(appId, privateKeyPem);

  // 1) Find installation for repo
  const installRes = await githubFetch(`${GITHUB_API}/repos/${repoKey}/installation`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!installRes.ok) {
    const text = await installRes.text().catch(() => '');
    throw new Error(`[github-app] Failed to resolve installation for ${repoKey}: ${installRes.status} ${text}`);
  }

  const install = (await installRes.json()) as { id: number };

  // 2) Create installation access token
  const tokenRes = await githubFetch(`${GITHUB_API}/app/installations/${install.id}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`[github-app] Failed to create installation token: ${tokenRes.status} ${text}`);
  }

  const tokenData = (await tokenRes.json()) as { token: string; expires_at: string };
  const expiresAtMs = Date.parse(tokenData.expires_at);
  installationTokenCache.set(repoKey, { token: tokenData.token, expiresAtMs });
  return tokenData.token;
}

