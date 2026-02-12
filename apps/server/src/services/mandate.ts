/**
 * Cart mandate generation service.
 * Builds and hashes Cart mandates for merge-time payout authorization.
 */

import { createCart, hashCart, type Cart } from '@gitpay/mandates';
import { computeMergeShaHash } from '@gitpay/policy';
import type { Address, Hex } from 'viem';

const BASE_SEPOLIA_CHAIN_ID = 84532n;

// Placeholder escrow factory address (filled after deployment)
const DEFAULT_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000000' as Address;

// Global nonce counter (in production, use DB-backed nonce)
let cartNonce = 0n;

function nextNonce(): bigint {
  return cartNonce++;
}

export interface CartMandateParams {
  intentHash: Hex;
  mergeSha: string; // raw git SHA (40 hex chars)
  prNumber: number;
  recipient: Address;
  amountRaw: bigint; // USDC units (6 decimals)
  escrowAddress?: Address;
}

export interface CartMandateResult {
  cart: Cart;
  cartHash: Hex;
  chainId: bigint;
}

/**
 * Generate a Cart mandate for a merge payout.
 * The Cart binds the specific payment details to the intent mandate.
 */
export function generateCartMandate(params: CartMandateParams): CartMandateResult {
  const mergeShaHash = computeMergeShaHash(params.mergeSha);
  const verifyingContract = params.escrowAddress || DEFAULT_VERIFYING_CONTRACT;

  const cart = createCart({
    intentHash: params.intentHash,
    mergeSha: mergeShaHash as Hex,
    prNumber: params.prNumber,
    recipient: params.recipient,
    amount: params.amountRaw,
    nonce: nextNonce(),
  });

  const cartHash = hashCart(cart, verifyingContract, BASE_SEPOLIA_CHAIN_ID);

  return {
    cart,
    cartHash,
    chainId: BASE_SEPOLIA_CHAIN_ID,
  };
}
