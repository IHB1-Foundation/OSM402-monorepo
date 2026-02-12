/**
 * GitPay bot comment templates for GitHub issues and PRs.
 * All comments include hashes, tx links, and amounts.
 */

const EXPLORER_BASE = 'https://sepolia.basescan.org';

function txLink(txHash: string): string {
  return `[${txHash.slice(0, 10)}...](${EXPLORER_BASE}/tx/${txHash})`;
}

function addressLink(address: string): string {
  return `[${address.slice(0, 10)}...](${EXPLORER_BASE}/address/${address})`;
}

/**
 * Comment posted when a bounty label is detected (issue created, funding pending)
 */
export function fundingPendingComment(params: {
  amountUsd: number;
  escrowAddress: string;
  chainId: number;
}): string {
  return [
    `### GitPay — Bounty Detected`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Amount | $${params.amountUsd} USDC |`,
    `| Escrow | ${addressLink(params.escrowAddress)} |`,
    `| Chain | Base Sepolia (${params.chainId}) |`,
    `| Status | Funding pending |`,
    '',
    `> Fund this bounty by sending an x402 payment to \`POST /api/fund\`.`,
  ].join('\n');
}

/**
 * Comment posted when escrow is funded via x402 payment
 */
export function fundedComment(params: {
  amountUsd: number;
  escrowAddress: string;
  intentHash: string;
  depositTxHash?: string;
  chainId: number;
}): string {
  const txLine = params.depositTxHash
    ? `| Deposit TX | ${txLink(params.depositTxHash)} |`
    : `| Deposit TX | pending |`;

  return [
    `### GitPay — Funded`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Cap | $${params.amountUsd} USDC |`,
    `| Escrow | ${addressLink(params.escrowAddress)} |`,
    `| Intent Hash | \`${params.intentHash.slice(0, 18)}...\` |`,
    txLine,
    `| Chain | Base Sepolia (${params.chainId}) |`,
    '',
    `> Escrow is funded. Submit a PR referencing this issue to claim the bounty.`,
  ].join('\n');
}

/**
 * Comment posted when payout is executed successfully
 */
export function paidComment(params: {
  amountUsd: number;
  recipient: string;
  txHash: string;
  cartHash: string;
  intentHash: string;
  mergeSha: string;
}): string {
  return [
    `### GitPay — Paid`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Amount | $${params.amountUsd} USDC |`,
    `| Recipient | ${addressLink(params.recipient)} |`,
    `| TX | ${txLink(params.txHash)} |`,
    `| Cart Hash | \`${params.cartHash.slice(0, 18)}...\` |`,
    `| Intent Hash | \`${params.intentHash.slice(0, 18)}...\` |`,
    `| Merge SHA | \`${params.mergeSha.slice(0, 12)}\` |`,
  ].join('\n');
}

/**
 * Comment posted when payout is held for manual review
 */
export function holdComment(params: {
  amountUsd: number;
  reasons: string[];
  mergeSha: string;
}): string {
  const reasonList = params.reasons.map((r) => `- ${r}`).join('\n');

  return [
    `### GitPay — HOLD`,
    '',
    `**Manual review required.**`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Computed Amount | $${params.amountUsd} USDC |`,
    `| Merge SHA | \`${params.mergeSha.slice(0, 12)}\` |`,
    '',
    `**Hold Reasons:**`,
    reasonList,
    '',
    `> A maintainer can override by adding the \`gitpay:override\` label.`,
  ].join('\n');
}
