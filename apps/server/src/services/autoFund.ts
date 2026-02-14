import { keccak256, toHex, type Address, formatUnits, type Hex } from 'viem';
import { createIntent, hashIntent } from '@osm402/mandates';
import { activeChain } from '../config/chains.js';
import { getIssue, markIssueFunded, updateIssueStatus } from '../store/issues.js';
import { createEscrow, depositToEscrow, verifyEscrowBalance } from './escrow.js';
import { fundedComment } from './comments.js';
import { postIssueComment } from './github.js';

const DEFAULT_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

export async function autoFundIssue(repoKey: string, issueNumber: number): Promise<{
  success: boolean;
  reason: string;
  escrowAddress?: string;
  intentHash?: string;
  fundingTxHash?: string;
}> {
  const issue = getIssue(repoKey, issueNumber);
  if (!issue) {
    return { success: false, reason: 'issue_not_found' };
  }

  if (issue.status === 'FUNDED') {
    return {
      success: true,
      reason: 'already_funded',
      escrowAddress: issue.escrowAddress,
      intentHash: issue.intentHash,
      fundingTxHash: issue.fundingTxHash,
    };
  }

  const expiry =
    issue.expiry ?? Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS;

  if (!issue.expiry) {
    updateIssueStatus(repoKey, issueNumber, { expiry });
  }

  const repoKeyHash = keccak256(toHex(repoKey)) as Hex;
  const policyHash = issue.policyHash as Hex;
  const cap = BigInt(issue.bountyCap);
  const asset = issue.asset as Address;

  const { escrowAddress } = await createEscrow({
    repoKeyHash,
    issueNumber: BigInt(issue.issueNumber),
    policyHash,
    asset,
    cap,
    expiry: BigInt(expiry),
    chainId: issue.chainId,
  });

  // If escrow is already funded (e.g. via x402 transfer), do not double-deposit.
  let fundingTxHash: string | undefined;
  const escrowMockMode = process.env.ESCROW_MOCK_MODE !== 'false';
  if (!escrowMockMode) {
    const balance = await verifyEscrowBalance(
      escrowAddress,
      asset,
      issue.chainId,
    );
    if (balance < cap) {
      const deposit = await depositToEscrow({
        escrowAddress,
        asset,
        amount: cap,
        chainId: issue.chainId,
      });

      if (!deposit.success) {
        return {
          success: false,
          reason: `deposit_failed:${deposit.error ?? 'unknown'}`,
          escrowAddress,
        };
      }

      fundingTxHash = deposit.txHash;
    }
  } else {
    const deposit = await depositToEscrow({
      escrowAddress,
      asset,
      amount: cap,
      chainId: issue.chainId,
    });

    if (!deposit.success) {
      return {
        success: false,
        reason: `deposit_failed:${deposit.error ?? 'unknown'}`,
        escrowAddress,
      };
    }

    fundingTxHash = deposit.txHash;
  }

  const intent = createIntent({
    chainId: BigInt(issue.chainId),
    repoKeyHash,
    issueNumber: BigInt(issue.issueNumber),
    asset,
    cap,
    expiry: BigInt(expiry),
    policyHash,
    nonce: 0n,
  });

  const intentHash = hashIntent(intent, escrowAddress as Address, BigInt(issue.chainId));

  const funded = markIssueFunded(
    repoKey,
    issueNumber,
    escrowAddress,
    intentHash,
    fundingTxHash,
  );

  // Best-effort GitHub comment
  try {
    const amountUsd = parseFloat(formatUnits(cap, activeChain.assetDecimals));
    const comment = fundedComment({
      amountUsd,
      escrowAddress,
      intentHash,
      depositTxHash: fundingTxHash,
      chainId: issue.chainId,
    });
    await postIssueComment(repoKey, issueNumber, comment);
  } catch {
    // ignore comment failures
  }

  return {
    success: true,
    reason: funded ? 'funded' : 'funded_record_missing',
    escrowAddress,
    intentHash,
    fundingTxHash,
  };
}

