import express from 'express';
import { config } from './config.js';
import { requirePayment, type X402Request } from './middleware/x402.js';
import { requireSecret } from './middleware/authSecret.js';
import { activeChain } from './config/chains.js';
import fundRouter from './routes/fund.js';
import webhooksRouter from './routes/webhooks.js';
import payoutRouter from './routes/payout.js';

const app = express();

app.use(express.json({
  verify: (req: express.Request, _res, buf) => {
    // Preserve raw body buffer for webhook signature verification
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

// Fund endpoint (protected by shared secret)
app.use('/api/fund', requireSecret, fundRouter);

// GitHub webhook endpoint (protected by its own HMAC signature verification)
app.use('/api/webhooks/github', webhooksRouter);

// Payout execution endpoint (protected by shared secret)
app.use('/api/payout', requireSecret, payoutRouter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

// Example x402-protected endpoint for testing
app.post(
  '/api/x402-test',
  requirePayment({
    amount: 1000000n, // 1 USDC (6 decimals)
    asset: activeChain.asset,
    chainId: activeChain.chainId,
    recipient: '0x0000000000000000000000000000000000000000', // Placeholder
    description: 'Test payment',
  }),
  (req: X402Request, res) => {
    res.json({
      success: true,
      message: 'Payment received!',
      receipt: req.x402?.receipt,
    });
  }
);

app.listen(config.PORT, () => {
  console.log(`GitPay server running on port ${config.PORT}`);
  console.log(`Chain: ${activeChain.name} (${activeChain.chainId})`);
  console.log(`Health check: http://localhost:${config.PORT}/api/health`);
});
