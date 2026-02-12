import { hashTypedData } from 'viem';
import type { Address, Hex } from 'viem';
import {
  type Intent,
  type EIP712Domain,
  type TypedData,
  INTENT_TYPES,
  DOMAIN_NAME,
  DOMAIN_VERSION,
} from './types.js';

/**
 * Build EIP-712 typed data for an Intent mandate
 */
export function buildIntentTypedData(
  intent: Intent,
  verifyingContract: Address,
  chainId?: bigint
): TypedData<Intent> {
  const domain: EIP712Domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: chainId ?? intent.chainId,
    verifyingContract,
  };

  return {
    domain,
    types: INTENT_TYPES,
    primaryType: 'Intent',
    message: intent,
  };
}

/**
 * Hash an Intent mandate using EIP-712
 */
export function hashIntent(intent: Intent, verifyingContract: Address, chainId?: bigint): Hex {
  const typedData = buildIntentTypedData(intent, verifyingContract, chainId);

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
      chainId: intent.chainId,
      repoKeyHash: intent.repoKeyHash,
      issueNumber: intent.issueNumber,
      asset: intent.asset,
      cap: intent.cap,
      expiry: intent.expiry,
      policyHash: intent.policyHash,
      nonce: intent.nonce,
    },
  });
}

/**
 * Create an Intent from input parameters
 */
export function createIntent(params: {
  chainId: bigint | number;
  repoKeyHash: Hex;
  issueNumber: bigint | number;
  asset: Address;
  cap: bigint | number;
  expiry: bigint | number;
  policyHash: Hex;
  nonce: bigint | number;
}): Intent {
  return {
    chainId: BigInt(params.chainId),
    repoKeyHash: params.repoKeyHash,
    issueNumber: BigInt(params.issueNumber),
    asset: params.asset,
    cap: BigInt(params.cap),
    expiry: BigInt(params.expiry),
    policyHash: params.policyHash,
    nonce: BigInt(params.nonce),
  };
}
