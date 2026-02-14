#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';

function readEnvValue(name, envText) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match) return '';
  return match[1].replace(/^"|"$/g, '').trim();
}

function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 30,
    exp: now + 9 * 60,
    iss: appId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(sig)}`;
}

async function main() {
  const envText = fs.readFileSync('.env', 'utf8');
  const appId = readEnvValue('GITHUB_APP_ID', envText);
  const repoKey = readEnvValue('DEMO_REPO', envText);
  const privateKeyRaw = readEnvValue('GITHUB_PRIVATE_KEY_PEM', envText);
  const privateKeyPem = privateKeyRaw.includes('\\n') ? privateKeyRaw.replace(/\\n/g, '\n') : privateKeyRaw;

  if (!appId || !repoKey || !privateKeyPem) {
    console.error('Missing required .env values: GITHUB_APP_ID / GITHUB_PRIVATE_KEY_PEM / DEMO_REPO');
    process.exit(1);
  }

  const jwt = buildAppJwt(appId, privateKeyPem);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${jwt}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const installRes = await fetch(`https://api.github.com/repos/${repoKey}/installation`, {
    method: 'GET',
    headers,
  });
  const installText = await installRes.text();

  console.log(`repo=${repoKey}`);
  console.log(`installation_lookup_status=${installRes.status}`);

  if (!installRes.ok) {
    console.log(`installation_lookup_body=${installText.slice(0, 300)}`);
    process.exit(2);
  }

  const install = JSON.parse(installText);
  console.log(`installation_id=${install.id}`);
  console.log(`account=${install.account?.login ?? ''}`);

  const tokenRes = await fetch(`https://api.github.com/app/installations/${install.id}/access_tokens`, {
    method: 'POST',
    headers,
  });
  const tokenText = await tokenRes.text();
  console.log(`installation_token_status=${tokenRes.status}`);
  if (!tokenRes.ok) {
    console.log(`installation_token_body=${tokenText.slice(0, 300)}`);
    process.exit(3);
  }

  const tokenData = JSON.parse(tokenText);
  console.log(`token_expires_at=${tokenData.expires_at}`);
  console.log('ok=true');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
