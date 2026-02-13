import type { Address, Hex } from 'viem';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildCartTypedData,
  buildIntentTypedData,
  createCart,
  createIntent,
  hashCart,
  hashIntent,
  type Cart,
  type Intent,
} from '@osm402/mandates';
import { computeMergeShaHash } from '@osm402/policy';
import { activeChain } from '../config/chains.js';
import type { IssueRecord } from '../store/issues.js';
import type { PayoutRecord } from '../store/payouts.js';

type Account = ReturnType<typeof privateKeyToAccount>;
type SignTypedDataParams = Parameters<Account['signTypedData']>[0];

function isMockEscrow(): boolean {
  return process.env.ESCROW_MOCK_MODE !== 'false';
}

function getMaintainerAccount() {
  const pk = process.env.OSM402_MAINTAINER_PRIVATE_KEY;
  if (!pk) throw new Error('OSM402_MAINTAINER_PRIVATE_KEY not set');
  return privateKeyToAccount(pk as Hex);
}

function getAgentAccount() {
  const pk = process.env.OSM402_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('OSM402_AGENT_PRIVATE_KEY not set');
  return privateKeyToAccount(pk as Hex);
}

export interface BuiltRelease {
  intent: Intent;
  intentHash: Hex;
  intentSig: Hex;
  cart: Cart;
  cartHash: Hex;
  cartSig: Hex;
  repoKeyHash: Hex;
  mergeShaHash: Hex;
}

/**
 * Build Intent/Cart mandates and signatures for an onchain IssueEscrow.release(...) call.
 *
 * Notes:
 * - Uses deterministic nonces (0) for MVP demo stability.
 * - Uses escrow address as EIP-712 verifyingContract (must match contract DOMAIN_SEPARATOR).
 */
export async function buildReleaseForPayout(params: {
  issue: IssueRecord;
  payout: PayoutRecord;
  recipient: Address;
}): Promise<BuiltRelease> {
  const { issue, payout, recipient } = params;

  if (!issue.escrowAddress) throw new Error('Issue escrowAddress missing');
  if (!issue.expiry) throw new Error('Issue expiry missing');

  if (issue.chainId !== activeChain.chainId) {
    throw new Error(`Chain mismatch: issue.chainId=${issue.chainId} activeChain.chainId=${activeChain.chainId}`);
  }

  const escrowAddress = issue.escrowAddress as Address;
  const chainId = BigInt(issue.chainId);
  const repoKeyHash = keccak256(toHex(issue.repoKey));
  const policyHash = issue.policyHash as Hex;

  const intent = createIntent({
    chainId,
    repoKeyHash,
    issueNumber: BigInt(issue.issueNumber),
    asset: issue.asset as Address,
    cap: BigInt(issue.bountyCap),
    expiry: BigInt(issue.expiry),
    policyHash,
    nonce: 0n,
  });

  const intentHash = hashIntent(intent, escrowAddress, chainId);
  const mergeShaHash = computeMergeShaHash(payout.mergeSha) as Hex;

  const cart = createCart({
    intentHash,
    mergeSha: mergeShaHash,
    prNumber: BigInt(payout.prNumber),
    recipient,
    amount: BigInt(payout.amountRaw || '0'),
    nonce: 0n,
  });

  const cartHash = hashCart(cart, escrowAddress, chainId);

  const zeroSig = ('0x' + '00'.repeat(65)) as Hex;
  if (isMockEscrow()) {
    return {
      intent,
      intentHash,
      intentSig: zeroSig,
      cart,
      cartHash,
      cartSig: zeroSig,
      repoKeyHash,
      mergeShaHash,
    };
  }

  const maintainer = getMaintainerAccount();
  const agent = getAgentAccount();

  const intentSig = await maintainer.signTypedData(
    buildIntentTypedData(intent, escrowAddress, chainId) as unknown as SignTypedDataParams,
  );

  const cartSig = await agent.signTypedData(
    buildCartTypedData(cart, escrowAddress, chainId) as unknown as SignTypedDataParams,
  );

  return {
    intent,
    intentHash,
    intentSig: intentSig as Hex,
    cart,
    cartHash,
    cartSig: cartSig as Hex,
    repoKeyHash,
    mergeShaHash,
  };
}
