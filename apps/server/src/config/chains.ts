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
  asset: Address;      // ERC20 asset address (e.g. SKLA)
  assetSymbol: string; // Display symbol (e.g. SKLA)
  assetDecimals: number; // ERC20 decimals
  factoryAddress: Address;
  isGasless: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envAssetAddress(fallback: Address): Address {
  // Back-compat: many places still use USDC_ADDRESS name.
  return (process.env.ASSET_ADDRESS || process.env.USDC_ADDRESS || fallback) as Address;
}

const CHAINS: Record<string, ChainConfig> = {
  'base-sepolia': {
    name: 'base-sepolia',
    chainId: 84532,
    rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    asset: envAssetAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'USDC',
    assetDecimals: envInt('ASSET_DECIMALS', 6),
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: false,
  },
  // SKALE "Base Sepolia" testnet (x402 facilitator-supported: skale-base-spolia)
  // Docs: https://docs.skale.space/chain-info/schain/base-sepolia
  'skale-base-sepolia': {
    name: 'skale-base-sepolia',
    chainId: 324705682,
    rpcUrl:
      process.env.RPC_URL ||
      'https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha',
    explorerUrl: 'https://base-sepolia-testnet-explorer.skalenodes.com',
    asset: envAssetAddress('0x0000000000000000000000000000000000000000' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'SKLA',
    assetDecimals: envInt('ASSET_DECIMALS', 18),
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: true,
  },
  // Alias used by some x402 facilitator implementations
  'skale-base-spolia': {
    name: 'skale-base-spolia',
    chainId: 324705682,
    rpcUrl:
      process.env.RPC_URL ||
      'https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha',
    explorerUrl: 'https://base-sepolia-testnet-explorer.skalenodes.com',
    asset: envAssetAddress('0x0000000000000000000000000000000000000000' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'SKLA',
    assetDecimals: envInt('ASSET_DECIMALS', 18),
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: true,
  },
  // Hackathon chain: BITE V2 Sandbox 2 (SKALE)
  // Docs: https://docs.skale.space/get-started/hackathon/info#bite-v2-sandbox-2
  // Note: Explorer uses a custom port (Blockscout).
  'bite-v2-sandbox-2': {
    name: 'bite-v2-sandbox-2',
    chainId: 103_698_795,
    rpcUrl: process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2',
    explorerUrl: process.env.EXPLORER_URL || 'https://base-sepolia-testnet-explorer.skalenodes.com:10032',
    asset: envAssetAddress('0x0000000000000000000000000000000000000000' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'SKLA',
    assetDecimals: envInt('ASSET_DECIMALS', 18),
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: true,
  },
  // Alias (some SKALE RPCs also accept /v1/bite-v2-sandbox)
  'bite-v2-sandbox': {
    name: 'bite-v2-sandbox',
    chainId: 103_698_795,
    rpcUrl: process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox',
    explorerUrl: process.env.EXPLORER_URL || 'https://base-sepolia-testnet-explorer.skalenodes.com:10032',
    asset: envAssetAddress('0x0000000000000000000000000000000000000000' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'SKLA',
    assetDecimals: envInt('ASSET_DECIMALS', 18),
    factoryAddress: (process.env.ESCROW_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    isGasless: true,
  },
  'skale': {
    name: 'skale',
    chainId: Number(process.env.CHAIN_ID || 0),
    rpcUrl: process.env.RPC_URL || '',
    explorerUrl: process.env.EXPLORER_URL || '',
    asset: envAssetAddress('0x0000000000000000000000000000000000000000' as Address),
    assetSymbol: process.env.ASSET_SYMBOL || 'SKLA',
    assetDecimals: envInt('ASSET_DECIMALS', 18),
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
  if (process.env.ASSET_ADDRESS || process.env.USDC_ADDRESS) chain.asset = envAssetAddress(chain.asset);
  if (process.env.ASSET_SYMBOL) chain.assetSymbol = process.env.ASSET_SYMBOL;
  if (process.env.ASSET_DECIMALS) chain.assetDecimals = envInt('ASSET_DECIMALS', chain.assetDecimals);
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
