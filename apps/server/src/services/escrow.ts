import {
  keccak256,
  toHex,
  type Hex,
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Cart, Intent } from '@gitpay/mandates';
import { activeChain } from '../config/chains.js';

// --- ABI fragments for onchain interactions ---

const FACTORY_ABI = parseAbi([
  'function createEscrow(bytes32 repoKeyHash, uint256 issueNumber, bytes32 policyHash, address asset, uint256 cap, uint256 expiry) external returns (address)',
  'function getEscrow(bytes32 repoKeyHash, uint256 issueNumber) external view returns (address)',
  'function computeEscrowAddress(bytes32 repoKeyHash, uint256 issueNumber, bytes32 policyHash, address asset, uint256 cap, uint256 expiry) external view returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
]);

const ESCROW_ABI = parseAbi([
  'function release((uint256 chainId, bytes32 repoKeyHash, uint256 issueNumber, address asset, uint256 cap, uint256 expiry, bytes32 policyHash, uint256 nonce) intent, bytes intentSig, (bytes32 intentHash, bytes32 mergeSha, uint256 prNumber, address recipient, uint256 amount, uint256 nonce) cart, bytes cartSig) external',
  'event Released(uint256 amount, address recipient, bytes32 cartHash, bytes32 intentHash, bytes32 mergeSha)',
]);

// --- Config ---

const MOCK_MODE = process.env.ESCROW_MOCK_MODE !== 'false';

function getAgentKey(): Hex {
  const key = process.env.GITPAY_AGENT_PRIVATE_KEY;
  if (!key) throw new Error('GITPAY_AGENT_PRIVATE_KEY not set');
  return key as Hex;
}

function getPublicClient() {
  return createPublicClient({
    transport: http(activeChain.rpcUrl),
  });
}

function getWalletClient() {
  const account = privateKeyToAccount(getAgentKey());
  return createWalletClient({
    account,
    transport: http(activeChain.rpcUrl),
  });
}

// --- Deposit ---

export interface DepositConfig {
  escrowAddress: Address;
  asset: Address;
  amount: bigint;
  chainId: number;
}

export interface DepositResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
  blockNumber?: number;
}

async function mockDeposit(config: DepositConfig): Promise<DepositResult> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const txHash = keccak256(
    toHex(`mock-deposit:${config.escrowAddress}:${config.amount}:${Date.now()}`)
  );
  return { success: true, txHash, blockNumber: Math.floor(Date.now() / 1000) };
}

async function realDeposit(config: DepositConfig): Promise<DepositResult> {
  try {
    const wallet = getWalletClient();
    const pub = getPublicClient();

    const txHash = await wallet.writeContract({
      address: config.asset,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [config.escrowAddress, config.amount],
      chain: null,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    console.log(`[escrow] Deposit confirmed: tx=${txHash} block=${receipt.blockNumber}`);

    return {
      success: receipt.status === 'success',
      txHash,
      blockNumber: Number(receipt.blockNumber),
      error: receipt.status !== 'success' ? 'Transaction reverted' : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[escrow] Deposit failed: ${msg}`);
    return { success: false, error: msg };
  }
}

export async function depositToEscrow(config: DepositConfig): Promise<DepositResult> {
  if (MOCK_MODE) return mockDeposit(config);
  return realDeposit(config);
}

// --- Create escrow ---

export async function createEscrow(params: {
  repoKeyHash: Hex;
  issueNumber: bigint;
  policyHash: Hex;
  asset: Address;
  cap: bigint;
  expiry: bigint;
  chainId: number;
}): Promise<{ escrowAddress: Address; txHash: Hex }> {
  if (MOCK_MODE) {
    const escrowAddress = `0x${keccak256(
      toHex(`escrow:${params.repoKeyHash}:${params.issueNumber}:${params.policyHash}`)
    ).slice(26)}` as Address;
    const txHash = keccak256(
      toHex(`create-escrow:${escrowAddress}:${Date.now()}`)
    );
    return { escrowAddress, txHash };
  }

  try {
    const wallet = getWalletClient();
    const pub = getPublicClient();
    const factory = activeChain.factoryAddress;

    // Check if escrow already exists (idempotent)
    const existing = await pub.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'getEscrow',
      args: [params.repoKeyHash, params.issueNumber],
    });

    if (existing && existing !== '0x0000000000000000000000000000000000000000') {
      console.log(`[escrow] Escrow already exists at ${existing}`);
      return {
        escrowAddress: existing as Address,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      };
    }

    const txHash = await wallet.writeContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'createEscrow',
      args: [
        params.repoKeyHash,
        params.issueNumber,
        params.policyHash,
        params.asset,
        params.cap,
        params.expiry,
      ],
      chain: null,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    console.log(`[escrow] Create confirmed: tx=${txHash} block=${receipt.blockNumber}`);

    // Read the deployed escrow address
    const escrowAddress = await pub.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'getEscrow',
      args: [params.repoKeyHash, params.issueNumber],
    });

    return { escrowAddress: escrowAddress as Address, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[escrow] Create failed: ${msg}`);
    throw new Error(`Escrow creation failed: ${msg}`);
  }
}

// --- Verify balance ---

export async function verifyEscrowBalance(
  escrowAddress: Address,
  asset: Address,
  _chainId: number
): Promise<bigint> {
  if (MOCK_MODE) return 0n;

  try {
    const pub = getPublicClient();
    return await pub.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [escrowAddress],
    }) as bigint;
  } catch {
    return 0n;
  }
}

// --- Release ---

export interface ReleaseConfig {
  escrowAddress: Address;
  intent: Intent;
  intentSig: Hex;
  cart: Cart;
  cartSig: Hex;
  chainId: number;
}

export interface ReleaseResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
}

async function mockRelease(config: ReleaseConfig): Promise<ReleaseResult> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const txHash = keccak256(
    toHex(`mock-release:${config.escrowAddress}:${config.cart.amount}:${Date.now()}`)
  );
  console.log(`[escrow] Mock release: escrow=${config.escrowAddress}, amount=${config.cart.amount}, recipient=${config.cart.recipient}`);
  return { success: true, txHash };
}

async function realRelease(config: ReleaseConfig): Promise<ReleaseResult> {
  try {
    const wallet = getWalletClient();
    const pub = getPublicClient();

    const intentTuple = {
      chainId: config.intent.chainId,
      repoKeyHash: config.intent.repoKeyHash,
      issueNumber: config.intent.issueNumber,
      asset: config.intent.asset,
      cap: config.intent.cap,
      expiry: config.intent.expiry,
      policyHash: config.intent.policyHash,
      nonce: config.intent.nonce,
    };

    const cartTuple = {
      intentHash: config.cart.intentHash,
      mergeSha: config.cart.mergeSha,
      prNumber: config.cart.prNumber,
      recipient: config.cart.recipient,
      amount: config.cart.amount,
      nonce: config.cart.nonce,
    };

    const txHash = await wallet.writeContract({
      address: config.escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'release',
      args: [intentTuple, config.intentSig, cartTuple, config.cartSig],
      chain: null,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    console.log(`[escrow] Release confirmed: tx=${txHash} block=${receipt.blockNumber}`);

    if (receipt.status !== 'success') {
      return { success: false, txHash, error: 'Release transaction reverted' };
    }

    return { success: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[escrow] Release failed: ${msg}`);
    return { success: false, error: msg };
  }
}

export async function releaseEscrow(config: ReleaseConfig): Promise<ReleaseResult> {
  if (MOCK_MODE) return mockRelease(config);
  return realRelease(config);
}
