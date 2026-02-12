/**
 * Handler for issues.labeled webhook event.
 * Parses bounty label, creates issue record, posts GitHub comment.
 */

import { keccak256, toHex, type Address } from 'viem';
import { getIssue, upsertIssue } from '../store/issues.js';
import { createEscrow } from '../services/escrow.js';
import { postIssueComment } from '../services/github.js';

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_SEPOLIA_CHAIN_ID = 84532;

interface IssueLabeledPayload {
  action: 'labeled';
  label: { name: string };
  issue: { number: number };
  repository: { full_name: string };
}

/**
 * Parse bounty label: "bounty:$10" → 10
 */
function parseBountyLabel(label: string): number | null {
  const match = label.match(/^bounty:\$(\d+(?:\.\d+)?)$/);
  return match ? parseFloat(match[1]!) : null;
}

export async function handleIssueLabeled(payload: IssueLabeledPayload): Promise<{
  handled: boolean;
  issueKey?: string;
  bountyCapUsd?: number;
  status?: string;
}> {
  const labelName = payload.label.name;
  const bountyCapUsd = parseBountyLabel(labelName);

  if (bountyCapUsd === null) {
    return { handled: false };
  }

  const repoKey = payload.repository.full_name;
  const issueNumber = payload.issue.number;
  const issueKey = `${repoKey}#${issueNumber}`;

  console.log(`[issue-labeled] Bounty detected: ${issueKey} → $${bountyCapUsd}`);

  // Check if already funded
  const existing = getIssue(repoKey, issueNumber);
  if (existing?.status === 'FUNDED') {
    console.log(`[issue-labeled] ${issueKey} already funded, skipping`);
    return { handled: true, issueKey, bountyCapUsd, status: 'already_funded' };
  }

  // Convert USD to USDC units (6 decimals)
  const bountyAmount = BigInt(Math.round(bountyCapUsd * 1_000_000));
  const policyHash = keccak256(toHex('default-policy'));

  // Create PENDING issue record
  upsertIssue({
    id: issueKey,
    repoKey,
    issueNumber,
    bountyCap: bountyAmount.toString(),
    asset: BASE_SEPOLIA_USDC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    policyHash,
    status: 'PENDING',
    createdAt: new Date(),
  });

  // Compute deterministic escrow address
  const repoKeyHash = keccak256(toHex(repoKey));
  const { escrowAddress } = await createEscrow({
    repoKeyHash,
    issueNumber: BigInt(issueNumber),
    policyHash: policyHash as `0x${string}`,
    asset: BASE_SEPOLIA_USDC as Address,
    cap: bountyAmount,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
    chainId: BASE_SEPOLIA_CHAIN_ID,
  });

  // Post comment on GitHub issue
  const comment = [
    `**GitPay** — Bounty Detected`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Amount | $${bountyCapUsd} USDC |`,
    `| Escrow | \`${escrowAddress}\` |`,
    `| Chain | Base Sepolia (84532) |`,
    `| Status | Funding pending — awaiting x402 payment |`,
    '',
    `> Fund this bounty by sending an x402 payment to \`POST /api/fund\`.`,
  ].join('\n');

  await postIssueComment(repoKey, issueNumber, comment);

  console.log(`[issue-labeled] ${issueKey} recorded as PENDING, escrow=${escrowAddress}`);

  return {
    handled: true,
    issueKey,
    bountyCapUsd,
    status: 'pending_funding',
  };
}
