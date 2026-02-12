/**
 * Chain adapter interface and implementations.
 * Abstracts chain-specific details for escrow operations.
 */

import type { Address, Hex } from 'viem';

export interface ChainAdapter {
  name: string;
  chainId: number;
  rpcUrl: string;
  usdcAddress: Address;
  isGasless: boolean;

  /** Deploy or get escrow address */
  createEscrow(params: {
    repoKeyHash: Hex;
    issueNumber: bigint;
    policyHash: Hex;
    cap: bigint;
    expiry: bigint;
  }): Promise<{ escrowAddress: Address; txHash: Hex }>;

  /** Deposit funds into escrow */
  deposit(escrow: Address, amount: bigint): Promise<{ txHash: Hex }>;

  /** Release funds from escrow */
  release(escrow: Address, calldata: Hex): Promise<{ txHash: Hex }>;
}

/**
 * Base Sepolia adapter (default)
 */
export const baseSepoliaAdapter: ChainAdapter = {
  name: 'base-sepolia',
  chainId: 84532,
  rpcUrl: 'https://sepolia.base.org',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  isGasless: false,

  async createEscrow() {
    // Delegated to escrow service (mock or real)
    throw new Error('Use escrow service directly');
  },

  async deposit() {
    throw new Error('Use escrow service directly');
  },

  async release() {
    throw new Error('Use escrow service directly');
  },
};

/**
 * SKALE adapter stub (gasless experience)
 */
export const skaleAdapter: ChainAdapter = {
  name: 'skale',
  chainId: 0, // To be configured
  rpcUrl: '', // To be configured
  usdcAddress: '0x0000000000000000000000000000000000000000' as Address,
  isGasless: true,

  async createEscrow() {
    throw new Error('SKALE adapter not implemented');
  },

  async deposit() {
    throw new Error('SKALE adapter not implemented');
  },

  async release() {
    throw new Error('SKALE adapter not implemented');
  },
};

/**
 * Get chain adapter by name
 */
export function getChainAdapter(name: string): ChainAdapter {
  switch (name) {
    case 'base-sepolia':
      return baseSepoliaAdapter;
    case 'skale':
      return skaleAdapter;
    default:
      return baseSepoliaAdapter;
  }
}
