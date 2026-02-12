/**
 * Handler for issues.labeled webhook event.
 * Parses bounty label, creates issue record, posts GitHub comment.
 */

import { keccak256, toHex, type Address } from 'viem';
import { getIssue, upsertIssue } from '../store/issues.js';
import { predictEscrowAddress } from '../services/escrow.js';
import { postIssueComment } from '../services/github.js';
import { fundingPendingComment } from '../services/comments.js';
import { activeChain } from '../config/chains.js';

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
  const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const createdAt = new Date();

  // Create PENDING issue record
  upsertIssue({
    id: issueKey,
    repoKey,
    issueNumber,
    bountyCap: bountyAmount.toString(),
    asset: activeChain.asset,
    chainId: activeChain.chainId,
    policyHash,
    expiry,
    status: 'PENDING',
    createdAt,
  });

  // Predict escrow address (no transaction)
  const repoKeyHash = keccak256(toHex(repoKey));
  const escrowAddress = await predictEscrowAddress({
    repoKeyHash,
    issueNumber: BigInt(issueNumber),
    policyHash: policyHash as `0x${string}`,
    asset: activeChain.asset as Address,
    cap: bountyAmount,
    expiry: BigInt(expiry),
    chainId: activeChain.chainId,
  });
  upsertIssue({
    id: issueKey,
    repoKey,
    issueNumber,
    bountyCap: bountyAmount.toString(),
    asset: activeChain.asset,
    chainId: activeChain.chainId,
    policyHash,
    expiry,
    escrowAddress,
    status: 'PENDING',
    createdAt,
  });

  // Post comment on GitHub issue
  const comment = fundingPendingComment({
    amountUsd: bountyCapUsd,
    escrowAddress,
    chainId: activeChain.chainId,
  });
  await postIssueComment(repoKey, issueNumber, comment);

  console.log(`[issue-labeled] ${issueKey} recorded as PENDING, escrow=${escrowAddress}`);

  return {
    handled: true,
    issueKey,
    bountyCapUsd,
    status: 'pending_funding',
  };
}
