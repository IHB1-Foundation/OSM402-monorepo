import { keccak256, toHex, type Hex, type Address } from 'viem';

/**
 * Escrow deposit configuration
 */
export interface DepositConfig {
  escrowAddress: Address;
  asset: Address;
  amount: bigint;
  chainId: number;
}

/**
 * Escrow deposit result
 */
export interface DepositResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
  blockNumber?: number;
}

/**
 * Mock mode flag - uses simulated transactions in development
 */
const MOCK_MODE = process.env.ESCROW_MOCK_MODE !== 'false';

/**
 * Mock deposit - generates fake txHash for development
 */
async function mockDeposit(config: DepositConfig): Promise<DepositResult> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Generate deterministic mock txHash
  const txHash = keccak256(
    toHex(`mock-deposit:${config.escrowAddress}:${config.amount}:${Date.now()}`)
  );

  return {
    success: true,
    txHash,
    blockNumber: Math.floor(Date.now() / 1000), // Mock block number
  };
}

/**
 * Real deposit - calls onchain ERC20 transfer
 * TODO: Implement actual onchain deposit
 */
async function realDeposit(_config: DepositConfig): Promise<DepositResult> {
  // This would use viem to:
  // 1. Create a wallet client with the server's private key
  // 2. Call ERC20 transfer to the escrow address
  // 3. Wait for confirmation
  // 4. Return txHash

  // For MVP, this is a placeholder
  return {
    success: false,
    error: 'Real deposit not implemented - use ESCROW_MOCK_MODE=true',
  };
}

/**
 * Deposit funds into escrow
 * Uses mock mode in development, real mode in production
 */
export async function depositToEscrow(config: DepositConfig): Promise<DepositResult> {
  if (MOCK_MODE) {
    return mockDeposit(config);
  }
  return realDeposit(config);
}

/**
 * Verify escrow balance (mock for MVP)
 */
export async function verifyEscrowBalance(
  escrowAddress: Address,
  _asset: Address,
  _chainId: number
): Promise<bigint> {
  if (MOCK_MODE) {
    // Return a mock balance
    return 0n;
  }

  // TODO: Use viem to query ERC20 balance
  return 0n;
}

/**
 * Create escrow via factory (mock for MVP)
 */
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
    // Generate deterministic mock escrow address
    const escrowAddress = `0x${keccak256(
      toHex(`escrow:${params.repoKeyHash}:${params.issueNumber}:${params.policyHash}`)
    ).slice(26)}` as Address;

    const txHash = keccak256(
      toHex(`create-escrow:${escrowAddress}:${Date.now()}`)
    );

    return { escrowAddress, txHash };
  }

  // TODO: Call IssueEscrowFactory.createEscrow via viem
  throw new Error('Real escrow creation not implemented');
}
