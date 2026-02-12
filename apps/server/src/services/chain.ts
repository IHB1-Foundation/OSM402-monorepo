/**
 * Chain adapter interface and implementations.
 * Abstracts chain-specific details for escrow operations.
 * Configuration is driven by config/chains.ts.
 */

import type { Address, Hex } from 'viem';
import { activeChain, type ChainConfig } from '../config/chains.js';

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

function buildAdapter(cfg: ChainConfig): ChainAdapter {
  return {
    name: cfg.name,
    chainId: cfg.chainId,
    rpcUrl: cfg.rpcUrl,
    usdcAddress: cfg.asset,
    isGasless: cfg.isGasless,

    async createEscrow() {
      throw new Error('Use escrow service directly');
    },
    async deposit() {
      throw new Error('Use escrow service directly');
    },
    async release() {
      throw new Error('Use escrow service directly');
    },
  };
}

/** Get chain adapter for the active chain */
export function getChainAdapter(): ChainAdapter {
  return buildAdapter(activeChain);
}
