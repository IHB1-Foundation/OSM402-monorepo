import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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

function requireArg(args: Args, name: string): string {
  const value = args[name] ?? process.env[name.toUpperCase()];
  if (!value) throw new Error(`Missing --${name} (or env ${name.toUpperCase()})`);
  return value;
}

function buildPaymentHeader(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
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
    requireArg(args, 'secret');
  const rpcUrl =
    args['rpc-url'] ||
    process.env.RPC_URL ||
    'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';

  const repoKey = requireArg(args, 'repo');
  const issueNumber = Number(requireArg(args, 'issue'));
  const bountyCapUsd = Number(requireArg(args, 'bounty'));

  const privateKey = requireArg(args, 'private-key') as Hex;
  const account = privateKeyToAccount(privateKey);

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
    const data = (await first.json()) as unknown;
    console.log(JSON.stringify({ ok: true, alreadyFundedOrNo402: true, data }, null, 2));
    return;
  }

  if (first.status !== 402) {
    const err = await first.text();
    throw new Error(`Unexpected /api/fund response: ${first.status} ${err}`);
  }

  const challenge = (await first.json()) as {
    x402: {
      requirement: {
        amount: string;
        asset: string;
        chainId: number;
        recipient: string;
        description?: string;
      };
    };
  };

  const req = challenge.x402.requirement;
  const amount = BigInt(req.amount);

  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const pub = createPublicClient({ transport: http(rpcUrl) });

  console.log(
    JSON.stringify(
      {
        step: 'transfer',
        chainId: req.chainId,
        asset: req.asset,
        recipient: req.recipient,
        amount: req.amount,
        payer: account.address,
      },
      null,
      2
    )
  );

  const txHash = await wallet.writeContract({
    address: req.asset as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [req.recipient as `0x${string}`, amount],
    chain: null,
  });

  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Transfer reverted: ${txHash}`);
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
  const maybeJson = (() => {
    try {
      return JSON.parse(secondText) as unknown;
    } catch {
      return secondText;
    }
  })();

  console.log(JSON.stringify({ ok: second.ok, status: second.status, txHash, result: maybeJson }, null, 2));

  if (!second.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
