import { Router } from 'express';
import { z } from 'zod';
import { keccak256, toHex } from 'viem';
import { requirePayment, type X402Request } from '../middleware/x402.js';
import {
  getIssue,
  upsertIssue,
  markIssueFunded,
  type IssueRecord,
} from '../store/issues.js';

const router = Router();

// Base Sepolia USDC address
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Request body schema for /api/fund
 */
const FundRequestSchema = z.object({
  repoKey: z.string().regex(/^[^/]+\/[^/]+$/), // owner/repo
  issueNumber: z.number().int().positive(),
  bountyCapUsd: z.number().positive(),
  policyYaml: z.string().optional(), // Raw YAML content for computing policyHash
});

type FundRequest = z.infer<typeof FundRequestSchema>;

/**
 * Parse bounty amount from label (e.g., "bounty:$10" -> 10_000_000 USDC units)
 */
function parseBountyLabel(bountyCapUsd: number): bigint {
  // Convert USD to USDC smallest unit (6 decimals)
  return BigInt(Math.round(bountyCapUsd * 1_000_000));
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
 * Compute deterministic escrow address (placeholder)
 * In production, this would call the factory contract
 */
function computeEscrowAddress(repoKey: string, issueNumber: number, policyHash: string): string {
  const salt = keccak256(
    toHex(`${repoKey}#${issueNumber}#${policyHash}`)
  );
  // Placeholder address - would be computed by factory in production
  return `0x${salt.slice(26)}`; // Take last 40 chars as mock address
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
        asset: BASE_SEPOLIA_USDC,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        policyHash,
        status: 'PENDING',
        createdAt: new Date(),
      });
    }

    // Store issue data in request for use after payment
    (req as X402Request & { issueData: IssueRecord }).issueData = issue;

    // Apply x402 middleware
    const paymentMiddleware = requirePayment({
      amount: bountyAmount,
      asset: BASE_SEPOLIA_USDC,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      recipient: computeEscrowAddress(repoKey, issueNumber, policyHash),
      description: `Fund bounty for ${repoKey}#${issueNumber}`,
    });

    paymentMiddleware(req as X402Request, res, next);
  },
  // After payment verified
  (req: X402Request & { issueData?: IssueRecord }, res) => {
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

    // Compute escrow address and intent hash
    const escrowAddress = computeEscrowAddress(
      issue.repoKey,
      issue.issueNumber,
      issue.policyHash
    );
    const intentHash = keccak256(
      toHex(`intent:${issue.repoKey}#${issue.issueNumber}:${receipt.paymentHash}`)
    );

    // Mark issue as funded
    const fundedIssue = markIssueFunded(
      issue.repoKey,
      issue.issueNumber,
      escrowAddress,
      intentHash,
      receipt.txHash
    );

    res.json({
      success: true,
      message: 'Issue funded successfully',
      issue: fundedIssue,
      receipt: {
        paymentHash: receipt.paymentHash,
        amount: receipt.amount,
        txHash: receipt.txHash,
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
