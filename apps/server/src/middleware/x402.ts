import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  createPublicClient,
  http,
  parseAbi,
  decodeEventLog,
  type Hex,
} from 'viem';
import { activeChain } from '../config/chains.js';

/**
 * x402 payment requirement configuration
 */
export interface PaymentRequirement {
  amount: bigint;
  asset: string; // ERC20 address
  chainId: number;
  recipient: string;
  description?: string;
}

/**
 * x402 payment receipt
 */
export interface PaymentReceipt {
  paymentHash: string;
  amount: string; // String for JSON serialization
  asset: string;
  chainId: number;
  payer: string;
  txHash?: string;
}

/**
 * Extended Request with payment info
 */
export interface X402Request extends Request {
  x402?: {
    paid: boolean;
    receipt?: PaymentReceipt;
  };
}

/**
 * x402 middleware configuration
 */
export interface X402Config {
  mockMode: boolean;
  verifyPayment?: (paymentHeader: string) => Promise<PaymentReceipt | null>;
}

const DEFAULT_CONFIG: X402Config = {
  mockMode: process.env.X402_MOCK_MODE === 'true',
};

const ERC20_TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/**
 * Build 402 Payment Required response payload
 */
function buildPaymentRequiredPayload(req: PaymentRequirement) {
  return {
    status: 402,
    message: 'Payment Required',
    x402: {
      version: '1',
      requirement: {
        amount: req.amount.toString(),
        asset: req.asset,
        chainId: req.chainId,
        recipient: req.recipient,
        description: req.description || 'Payment required to proceed',
      },
      instructions: {
        type: 'x402',
        header: 'X-Payment',
        format: 'base64 JSON: { txHash, chainId, asset, amount, payer }',
      },
    },
  };
}

/**
 * Mock payment verification (for local development)
 */
async function mockVerifyPayment(paymentHeader: string): Promise<PaymentReceipt | null> {
  try {
    const data = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    return {
      paymentHash: data.paymentHash || `mock-${Date.now()}`,
      amount: String(data.amount || '0'),
      asset: data.asset || '0x0000000000000000000000000000000000000000',
      chainId: data.chainId || activeChain.chainId,
      payer: data.payer || '0x0000000000000000000000000000000000000000',
      txHash: data.txHash,
    };
  } catch {
    return {
      paymentHash: `mock-${Date.now()}`,
      amount: '0',
      asset: '0x0000000000000000000000000000000000000000',
      chainId: activeChain.chainId,
      payer: '0x0000000000000000000000000000000000000000',
    };
  }
}

/**
 * Real x402 verification: fetch onchain tx receipt and confirm
 * that an ERC20 Transfer event matches the required payment.
 */
async function onchainVerifyPayment(
  paymentHeader: string,
  requirement: PaymentRequirement,
): Promise<PaymentReceipt | null> {
  let data: { txHash?: string; chainId?: number; asset?: string; amount?: string; payer?: string };
  try {
    data = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
  } catch {
    console.error('[x402] Failed to decode X-Payment header');
    return null;
  }

  if (!data.txHash) {
    console.error('[x402] X-Payment missing txHash');
    return null;
  }

  // Verify chainId
  if (data.chainId && data.chainId !== activeChain.chainId) {
    console.error(`[x402] Chain mismatch: expected ${activeChain.chainId}, got ${data.chainId}`);
    return null;
  }

  const pub = createPublicClient({ transport: http(activeChain.rpcUrl) });

  try {
    const receipt = await pub.getTransactionReceipt({ hash: data.txHash as Hex });

    if (receipt.status !== 'success') {
      console.error('[x402] Transaction reverted');
      return null;
    }

    // Find ERC20 Transfer event to the recipient
    let matchedAmount = 0n;
    let payer = '';

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: ERC20_TRANSFER_ABI,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName !== 'Transfer') continue;
        const args = decoded.args as { from: string; to: string; value: bigint };

        // Check asset address matches
        const logAsset = log.address.toLowerCase();
        if (logAsset !== requirement.asset.toLowerCase()) continue;

        // Check recipient matches
        if (args.to.toLowerCase() !== requirement.recipient.toLowerCase()) continue;

        matchedAmount += args.value;
        payer = args.from;
      } catch {
        // Not a Transfer event — skip
      }
    }

    if (matchedAmount === 0n) {
      console.error('[x402] No matching ERC20 Transfer found in tx receipt');
      return null;
    }

    console.log(`[x402] Verified onchain payment: tx=${data.txHash} amount=${matchedAmount} payer=${payer}`);

    return {
      paymentHash: data.txHash,
      amount: matchedAmount.toString(),
      asset: requirement.asset,
      chainId: activeChain.chainId,
      payer,
      txHash: data.txHash,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x402] Onchain verification failed: ${msg}`);
    return null;
  }
}

/**
 * Create x402 payment middleware
 * Returns 402 if payment not provided or invalid
 * Otherwise attaches receipt to request and proceeds
 */
export function requirePayment(
  requirement: PaymentRequirement,
  config: Partial<X402Config> = {}
): RequestHandler {
  const cfg: X402Config = { ...DEFAULT_CONFIG, ...config };

  return async (req: X402Request, res: Response, next: NextFunction): Promise<void> => {
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      res.status(402).json(buildPaymentRequiredPayload(requirement));
      return;
    }

    try {
      let receipt: PaymentReceipt | null = null;

      if (cfg.mockMode) {
        receipt = await mockVerifyPayment(paymentHeader);
      } else if (cfg.verifyPayment) {
        receipt = await cfg.verifyPayment(paymentHeader);
      } else {
        // Default: real onchain verification
        receipt = await onchainVerifyPayment(paymentHeader, requirement);
      }

      if (!receipt) {
        res.status(402).json({
          ...buildPaymentRequiredPayload(requirement),
          error: 'Invalid payment proof',
        });
        return;
      }

      // Validate amount
      const receiptAmount = BigInt(receipt.amount);
      if (receiptAmount < requirement.amount) {
        res.status(402).json({
          ...buildPaymentRequiredPayload(requirement),
          error: `Insufficient payment: required ${requirement.amount}, received ${receipt.amount}`,
        });
        return;
      }

      req.x402 = { paid: true, receipt };
      next();
    } catch {
      res.status(402).json({
        ...buildPaymentRequiredPayload(requirement),
        error: 'Payment verification failed',
      });
    }
  };
}

/**
 * Helper to create mock payment header for testing
 */
export function createMockPaymentHeader(receipt: Partial<PaymentReceipt>): string {
  return Buffer.from(
    JSON.stringify({
      paymentHash: receipt.paymentHash || `mock-${Date.now()}`,
      amount: receipt.amount || '0',
      asset: receipt.asset || '0x0000000000000000000000000000000000000000',
      chainId: receipt.chainId || activeChain.chainId,
      payer: receipt.payer || '0x0000000000000000000000000000000000000000',
      txHash: receipt.txHash,
    })
  ).toString('base64');
}
