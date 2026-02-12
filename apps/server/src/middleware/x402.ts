import type { Request, Response, NextFunction, RequestHandler } from 'express';
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
  mockMode: boolean; // Use mock verification for local dev
  verifyPayment?: (paymentHeader: string) => Promise<PaymentReceipt | null>;
}

const DEFAULT_CONFIG: X402Config = {
  mockMode: process.env.X402_MOCK_MODE === 'true',
};

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
        format: 'base64-encoded payment proof',
      },
    },
  };
}

/**
 * Mock payment verification (for local development)
 */
async function mockVerifyPayment(paymentHeader: string): Promise<PaymentReceipt | null> {
  // In mock mode, accept any payment header as valid
  try {
    // Try to parse as JSON
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
    // If parsing fails, generate a mock receipt
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
      // No payment provided - return 402
      res.status(402).json(buildPaymentRequiredPayload(requirement));
      return;
    }

    try {
      // Verify payment
      let receipt: PaymentReceipt | null = null;

      if (cfg.mockMode) {
        receipt = await mockVerifyPayment(paymentHeader);
      } else if (cfg.verifyPayment) {
        receipt = await cfg.verifyPayment(paymentHeader);
      } else {
        // No verifier configured - fall back to mock in dev
        if (process.env.NODE_ENV !== 'production') {
          receipt = await mockVerifyPayment(paymentHeader);
        }
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

      // Attach receipt to request
      req.x402 = {
        paid: true,
        receipt,
      };

      next();
    } catch (error) {
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
