import type { Address, Hex } from 'viem';

/**
 * Intent mandate - maintainer-authorized spending limit
 */
export interface Intent {
  chainId: bigint;
  repoKeyHash: Hex;
  issueNumber: bigint;
  asset: Address;
  cap: bigint;
  expiry: bigint;
  policyHash: Hex;
  nonce: bigint;
}

/**
 * Cart mandate - agent-authorized specific payment
 */
export interface Cart {
  intentHash: Hex;
  mergeSha: Hex;
  prNumber: bigint;
  recipient: Address;
  amount: bigint;
  nonce: bigint;
}

/**
 * EIP-712 domain configuration
 */
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: Address;
}

/**
 * EIP-712 typed data structure
 */
export interface TypedData<T> {
  domain: EIP712Domain;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: T;
}

/**
 * Intent type definition for EIP-712
 */
export const INTENT_TYPES = {
  Intent: [
    { name: 'chainId', type: 'uint256' },
    { name: 'repoKeyHash', type: 'bytes32' },
    { name: 'issueNumber', type: 'uint256' },
    { name: 'asset', type: 'address' },
    { name: 'cap', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/**
 * Cart type definition for EIP-712
 */
export const CART_TYPES = {
  Cart: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'mergeSha', type: 'bytes32' },
    { name: 'prNumber', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/**
 * OSM402 EIP-712 domain name
 */
export const DOMAIN_NAME = 'OSM402';

/**
 * OSM402 EIP-712 domain version
 */
export const DOMAIN_VERSION = '1';
