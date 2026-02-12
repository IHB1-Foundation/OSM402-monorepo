/**
 * Cart mandate generation service.
 * Builds and hashes Cart mandates for merge-time payout authorization.
 */

import { createCart, hashCart, type Cart } from '@gitpay/mandates';
import { computeMergeShaHash } from '@gitpay/policy';
import type { Address, Hex } from 'viem';
import { activeChain } from '../config/chains.js';

export interface CartMandateParams {
  intentHash: Hex;
  mergeSha: string; // raw git SHA (40 hex chars)
  prNumber: number;
  recipient: Address;
  amountRaw: bigint; // asset base units
  escrowAddress: Address;
  nonce?: bigint;
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

  const cart = createCart({
    intentHash: params.intentHash,
    mergeSha: mergeShaHash as Hex,
    prNumber: params.prNumber,
    recipient: params.recipient,
    amount: params.amountRaw,
    nonce: params.nonce ?? 0n,
  });

  const verifyingContract = params.escrowAddress;
  const chainId = BigInt(activeChain.chainId);
  const cartHash = hashCart(cart, verifyingContract, chainId);

  return {
    cart,
    cartHash,
    chainId,
  };
}
