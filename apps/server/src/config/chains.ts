/**
 * Centralized chain configuration.
 * All chain-specific constants (chainId, RPC, explorer, asset, factory)
 * are resolved here based on CHAIN_NAME env var.
 */

import type { Address } from 'viem';

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  asset: Address;      // USDC (or demo ERC20) address
  factoryAddress: Address;
  isGasless: boolean;
}

const CHAINS: Record<string, ChainConfig> = {
  'base-sepolia': {
    name: 'base-sepolia',
    chainId: 84532,
    rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    asset: (process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as Address,
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: false,
  },
  'skale': {
    name: 'skale',
    chainId: Number(process.env.CHAIN_ID || 0),
    rpcUrl: process.env.RPC_URL || '',
    explorerUrl: process.env.EXPLORER_URL || '',
    asset: (process.env.USDC_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: true,
  },
};

/**
 * Resolve the active chain from CHAIN_NAME env var.
 * Defaults to 'base-sepolia' if not set.
 */
function resolveChain(): ChainConfig {
  const name = process.env.CHAIN_NAME || 'base-sepolia';
  const chain = CHAINS[name];
  if (!chain) {
    console.error(`[chain] Unknown CHAIN_NAME="${name}", falling back to base-sepolia`);
    return CHAINS['base-sepolia']!;
  }

  // Allow env overrides for any chain
  if (process.env.CHAIN_ID) chain.chainId = Number(process.env.CHAIN_ID);
  if (process.env.RPC_URL) chain.rpcUrl = process.env.RPC_URL;
  if (process.env.EXPLORER_URL) chain.explorerUrl = process.env.EXPLORER_URL;
  if (process.env.USDC_ADDRESS) chain.asset = process.env.USDC_ADDRESS as Address;
  if (process.env.ESCROW_FACTORY_ADDRESS) chain.factoryAddress = process.env.ESCROW_FACTORY_ADDRESS as Address;

  return chain;
}

/** Active chain configuration singleton */
export const activeChain: ChainConfig = resolveChain();

/** Build an explorer link for a transaction */
export function txExplorerUrl(txHash: string): string {
  return `${activeChain.explorerUrl}/tx/${txHash}`;
}

/** Build an explorer link for an address */
export function addressExplorerUrl(address: string): string {
  return `${activeChain.explorerUrl}/address/${address}`;
}
