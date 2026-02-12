import { hashTypedData } from 'viem';
import type { Address, Hex } from 'viem';
import {
  type Cart,
  type EIP712Domain,
  type TypedData,
  CART_TYPES,
  DOMAIN_NAME,
  DOMAIN_VERSION,
} from './types.js';

/**
 * Build EIP-712 typed data for a Cart mandate
 */
export function buildCartTypedData(
  cart: Cart,
  verifyingContract: Address,
  chainId: bigint
): TypedData<Cart> {
  const domain: EIP712Domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };

  return {
    domain,
    types: CART_TYPES,
    primaryType: 'Cart',
    message: cart,
  };
}

/**
 * Hash a Cart mandate using EIP-712
 */
export function hashCart(cart: Cart, verifyingContract: Address, chainId: bigint): Hex {
  const typedData = buildCartTypedData(cart, verifyingContract, chainId);

  return hashTypedData({
    domain: {
      name: typedData.domain.name,
      version: typedData.domain.version,
      chainId: typedData.domain.chainId,
      verifyingContract: typedData.domain.verifyingContract,
    },
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: {
      intentHash: cart.intentHash,
      mergeSha: cart.mergeSha,
      prNumber: cart.prNumber,
      recipient: cart.recipient,
      amount: cart.amount,
      nonce: cart.nonce,
    },
  });
}

/**
 * Create a Cart from input parameters
 */
export function createCart(params: {
  intentHash: Hex;
  mergeSha: Hex;
  prNumber: bigint | number;
  recipient: Address;
  amount: bigint | number;
  nonce: bigint | number;
}): Cart {
  return {
    intentHash: params.intentHash,
    mergeSha: params.mergeSha,
    prNumber: BigInt(params.prNumber),
    recipient: params.recipient,
    amount: BigInt(params.amount),
    nonce: BigInt(params.nonce),
  };
}
