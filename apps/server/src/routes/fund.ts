import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { keccak256, toHex, type Address, parseUnits } from 'viem';
import { createIntent, hashIntent } from '@gitpay/mandates';
import { requirePayment, type X402Request } from '../middleware/x402.js';
import {
  getIssue,
  upsertIssue,
  markIssueFunded,
  type IssueRecord,
} from '../store/issues.js';
import {
  depositToEscrow,
  createEscrow,
  predictEscrowAddress,
  verifyEscrowBalance,
} from '../services/escrow.js';
import { activeChain } from '../config/chains.js';

const router: ExpressRouter = Router();

/**
 * Request body schema for /api/fund
 */
const FundRequestSchema = z.object({
  repoKey: z.string().regex(/^[^/]+\/[^/]+$/), // owner/repo
  issueNumber: z.number().int().positive(),
  bountyCapUsd: z.number().positive(),
  policyYaml: z.string().optional(), // Raw YAML content for computing policyHash
});

/**
 * Parse bounty amount from label (e.g., "bounty:$10" -> base units for active asset)
 */
function parseBountyLabel(bountyCapUsd: number): bigint {
  // For demo: interpret "$X" as "X <asset>" and convert to base units using configured decimals.
  return parseUnits(String(bountyCapUsd), activeChain.assetDecimals);
}

/**
 * Compute policy hash from YAML content
 */
function computePolicyHash(policyYaml?: string): string {
  if (!policyYaml) {
    // Default policy hash for MVP
    return keccak256(toHex('default-policy'));
  }
  // Normalize and hash
  const normalized = policyYaml.trim();
  const bytes = new TextEncoder().encode(normalized);
  return keccak256(toHex(bytes));
}

/**
 * POST /api/fund
 *
 * 1. If issue not in store, create PENDING record
 * 2. Return 402 Payment Required
 * 3. On retry with valid payment, mark as FUNDED
 */
router.post(
  '/',
  async (req, res, next) => {
    // Validate request body first
    const parseResult = FundRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.format(),
      });
      return;
    }

    const { repoKey, issueNumber, bountyCapUsd, policyYaml } = parseResult.data;
    const bountyAmount = parseBountyLabel(bountyCapUsd);
    const policyHash = computePolicyHash(policyYaml);
    const defaultExpiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

    // Check if issue already exists
    let issue = getIssue(repoKey, issueNumber);

    if (issue?.status === 'FUNDED') {
      // Already funded
      res.json({
        success: true,
        message: 'Issue already funded',
        issue: {
          ...issue,
          bountyCap: issue.bountyCap,
        },
      });
      return;
    }

    // Create or get pending issue
    if (!issue) {
      issue = upsertIssue({
        id: `${repoKey}#${issueNumber}`,
        repoKey,
        issueNumber,
        bountyCap: bountyAmount.toString(),
        asset: activeChain.asset,
        chainId: activeChain.chainId,
        policyHash,
        expiry: defaultExpiry,
        status: 'PENDING',
        createdAt: new Date(),
      });
    } else if (!issue.expiry) {
      issue = upsertIssue({
        ...issue,
        expiry: defaultExpiry,
      });
    }

    // Store issue data in request for use after payment
    (req as X402Request & { issueData: IssueRecord }).issueData = issue;

    const repoKeyHash = keccak256(toHex(repoKey));
    const predictedEscrow = await predictEscrowAddress({
      repoKeyHash,
      issueNumber: BigInt(issueNumber),
      policyHash: policyHash as `0x${string}`,
      asset: issue.asset as Address,
      cap: BigInt(issue.bountyCap),
      expiry: BigInt(issue.expiry ?? defaultExpiry),
      chainId: issue.chainId,
    });

    if (!issue.escrowAddress) {
      issue = upsertIssue({
        ...issue,
        escrowAddress: predictedEscrow,
      });
      (req as X402Request & { issueData: IssueRecord }).issueData = issue;
    }

    // Apply x402 middleware
    const paymentMiddleware = requirePayment({
      amount: bountyAmount,
      asset: issue.asset,
      chainId: issue.chainId,
      recipient: predictedEscrow,
      description: `Fund bounty for ${repoKey}#${issueNumber}`,
    });

    paymentMiddleware(req as X402Request, res, next);
  },
  // After payment verified
  async (req: X402Request & { issueData?: IssueRecord }, res) => {
    const issue = req.issueData;
    if (!issue) {
      res.status(500).json({ error: 'Issue data not found' });
      return;
    }

    const receipt = req.x402?.receipt;
    if (!receipt) {
      res.status(500).json({ error: 'Payment receipt not found' });
      return;
    }

    const x402MockMode = process.env.X402_MOCK_MODE === 'true';
    const escrowMockMode = process.env.ESCROW_MOCK_MODE !== 'false';
    if (!x402MockMode && escrowMockMode) {
      res.status(500).json({
        error: 'Configuration mismatch',
        details: 'X402_MOCK_MODE=false requires ESCROW_MOCK_MODE=false for deterministic onchain escrow funding',
      });
      return;
    }

    // Compute repo key hash for escrow creation
    const repoKeyHash = keccak256(toHex(issue.repoKey));
    const policyHashHex = issue.policyHash as `0x${string}`;

    const expiry = BigInt(issue.expiry ?? (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60));

    // Create escrow via factory (or get deterministic address)
    const { escrowAddress, txHash: createTxHash } = await createEscrow({
      repoKeyHash,
      issueNumber: BigInt(issue.issueNumber),
      policyHash: policyHashHex,
      asset: issue.asset as Address,
      cap: BigInt(issue.bountyCap),
      expiry,
      chainId: issue.chainId,
    });

    let fundingTxHash: string | undefined;
    if (x402MockMode) {
      // Local dev: simulate escrow deposit (since the x402 receipt is not backed by an onchain transfer)
      const depositResult = await depositToEscrow({
        escrowAddress,
        asset: issue.asset as Address,
        amount: BigInt(issue.bountyCap),
        chainId: issue.chainId,
      });

      if (!depositResult.success) {
        res.status(500).json({
          error: 'Escrow deposit failed',
          details: depositResult.error,
        });
        return;
      }

      fundingTxHash = depositResult.txHash;
    } else {
      // Testnet: x402 proof is the onchain transfer to the predicted escrow address.
      // Do not double-deposit from the agent wallet.
      fundingTxHash = receipt.txHash || receipt.paymentHash;

      const balance = await verifyEscrowBalance(
        escrowAddress,
        issue.asset as Address,
        issue.chainId,
      );

      if (balance < BigInt(issue.bountyCap)) {
        res.status(402).json({
          error: 'Escrow not funded onchain',
          details: `Escrow balance ${balance.toString()} < required ${issue.bountyCap}`,
        });
        return;
      }
    }

    // Compute EIP-712 intent hash (must match onchain)
    const intent = createIntent({
      chainId: BigInt(issue.chainId),
      repoKeyHash: repoKeyHash as `0x${string}`,
      issueNumber: BigInt(issue.issueNumber),
      asset: issue.asset as Address,
      cap: BigInt(issue.bountyCap),
      expiry,
      policyHash: policyHashHex,
      nonce: 0n,
    });

    const intentHash = hashIntent(intent, escrowAddress, BigInt(issue.chainId));

    // Mark issue as funded with the onchain funding tx (or mock deposit tx)
    const fundedIssue = markIssueFunded(
      issue.repoKey,
      issue.issueNumber,
      escrowAddress,
      intentHash,
      fundingTxHash
    );

    res.json({
      success: true,
      message: x402MockMode
        ? 'Issue funded and deposited to escrow (mock)'
        : 'Issue funded via onchain transfer to escrow',
      issue: fundedIssue,
      escrow: {
        address: escrowAddress,
        createTxHash,
        depositTxHash: fundingTxHash,
      },
      receipt: {
        paymentHash: receipt.paymentHash,
        amount: receipt.amount,
      },
    });
  }
);

/**
 * GET /api/fund/:repoKey/:issueNumber
 * Get funding status for an issue
 */
router.get('/:owner/:repo/:issueNumber', (req, res) => {
  const { owner, repo, issueNumber } = req.params;
  const repoKey = `${owner}/${repo}`;
  const issueNum = parseInt(issueNumber, 10);

  if (isNaN(issueNum)) {
    res.status(400).json({ error: 'Invalid issue number' });
    return;
  }

  const issue = getIssue(repoKey, issueNum);

  if (!issue) {
    res.status(404).json({ error: 'Issue not found' });
    return;
  }

  res.json({ issue });
});

export default router;
