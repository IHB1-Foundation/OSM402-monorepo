import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getInstallationTokenForRepo } from '../services/githubAppAuth.js';

const GITHUB_API = 'https://api.github.com';

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) external returns (bool)',
]);

type Args = Record<string, string | undefined>;

function readArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (!raw.startsWith('--')) continue;
    const [key, maybeValue] = raw.slice(2).split('=', 2);
    if (!key) continue;
    if (maybeValue !== undefined) {
      args[key] = maybeValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function requireArg(args: Args, name: string, envName?: string): string {
  const envKey = envName ?? name.toUpperCase();
  const value = args[name] ?? process.env[envKey];
  if (!value) throw new Error(`Missing --${name} (or env ${envKey})`);
  return value;
}

function buildPaymentHeader(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function parseBountyLabel(label: string): number | null {
  const match = label.match(/^bounty:\$(\d+(?:\.\d+)?)$/);
  return match ? parseFloat(match[1]!) : null;
}

async function githubToken(repoKey: string): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GITHUB_APP_TOKEN) return process.env.GITHUB_APP_TOKEN;
  return getInstallationTokenForRepo(repoKey);
}

async function githubHeaders(repoKey: string): Promise<Record<string, string>> {
  const token = await githubToken(repoKey);
  if (!token) throw new Error('No GitHub token available (set GITHUB_TOKEN or GitHub App env vars)');
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  };
}

type IssueItem = {
  number: number;
  title: string;
  labels: Array<{ name: string } | string>;
  pull_request?: unknown;
};

async function listOpenIssues(repoKey: string): Promise<IssueItem[]> {
  const headers = await githubHeaders(repoKey);
  const res = await fetch(`${GITHUB_API}/repos/${repoKey}/issues?state=open&per_page=100`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list issues: ${res.status} ${text}`);
  }
  const items = (await res.json()) as IssueItem[];
  return items.filter((it) => !it.pull_request);
}

async function fundOne(params: {
  baseUrl: string;
  secret: string;
  rpcUrl: string;
  payerKey: Hex;
  repoKey: string;
  issueNumber: number;
  bountyCapUsd: number;
}): Promise<void> {
  const { baseUrl, secret, rpcUrl, payerKey, repoKey, issueNumber, bountyCapUsd } = params;

  const fundBody = { repoKey, issueNumber, bountyCapUsd };
  const first = await fetch(`${baseUrl}/api/fund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OSM402-Secret': secret,
    },
    body: JSON.stringify(fundBody),
  });

  if (first.ok) {
    console.log(`[agent] ${repoKey}#${issueNumber}: already funded (or no 402)`);
    return;
  }

  if (first.status !== 402) {
    const text = await first.text().catch(() => '');
    throw new Error(`[agent] ${repoKey}#${issueNumber}: unexpected /api/fund status=${first.status} ${text}`);
  }

  const challenge = (await first.json()) as {
    x402: {
      requirement: {
        amount: string;
        asset: string;
        chainId: number;
        recipient: string;
      };
    };
  };

  const req = challenge.x402.requirement;
  const amount = BigInt(req.amount);

  const account = privateKeyToAccount(payerKey);
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const pub = createPublicClient({ transport: http(rpcUrl) });

  console.log(`[agent] funding ${repoKey}#${issueNumber}: transfer ${req.amount} to ${req.recipient}`);

  const txHash = await wallet.writeContract({
    address: req.asset as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [req.recipient as `0x${string}`, amount],
    chain: null,
  });

  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`[agent] transfer reverted: ${txHash}`);
  }

  const paymentHeader = buildPaymentHeader({
    txHash,
    chainId: req.chainId,
    asset: req.asset,
    amount: req.amount,
    payer: account.address,
  });

  const second = await fetch(`${baseUrl}/api/fund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OSM402-Secret': secret,
      'X-Payment': paymentHeader,
    },
    body: JSON.stringify(fundBody),
  });

  const secondText = await second.text();
  if (!second.ok) {
    throw new Error(`[agent] fund retry failed: status=${second.status} body=${secondText}`);
  }

  console.log(`[agent] ${repoKey}#${issueNumber}: funded ✅ tx=${txHash}`);
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));

  const baseUrl =
    args['base-url'] ||
    process.env.OSM402_BASE_URL ||
    process.env.OSM402_API_URL ||
    'http://localhost:3000';
  const secret =
    args.secret ||
    process.env.OSM402_ACTION_SHARED_SECRET ||
    (() => { throw new Error('Missing --secret (or env OSM402_ACTION_SHARED_SECRET)'); })();
  const repoKey = requireArg(args, 'repo');
  const rpcUrl = args['rpc-url'] || process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';
  const payerKey = (requireArg(args, 'private-key', 'X402_PAYER_PRIVATE_KEY') as Hex);

  const dryRun = args['dry-run'] === 'true' || args['dry-run'] === '1';

  const issues = await listOpenIssues(repoKey);
  const candidates = issues
    .map((it) => {
      const labelNames = it.labels.map((l) => (typeof l === 'string' ? l : l.name));
      const bountyLabel = labelNames.find((n) => /^bounty:\$/.test(n));
      const bounty = bountyLabel ? parseBountyLabel(bountyLabel) : null;
      return bounty ? { issueNumber: it.number, title: it.title, bountyCapUsd: bounty } : null;
    })
    .filter((x): x is { issueNumber: number; title: string; bountyCapUsd: number } => Boolean(x));

  if (candidates.length === 0) {
    console.log('[agent] No open bounty issues found');
    return;
  }

  console.log(`[agent] Found ${candidates.length} open bounty issue(s) in ${repoKey}`);

  for (const c of candidates) {
    console.log(`[agent] -> #${c.issueNumber} $${c.bountyCapUsd}: ${c.title}`);
    if (dryRun) continue;
    await fundOne({
      baseUrl,
      secret,
      rpcUrl,
      payerKey,
      repoKey,
      issueNumber: c.issueNumber,
      bountyCapUsd: c.bountyCapUsd,
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
