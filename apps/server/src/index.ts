import express from 'express';
import { config } from './config.js';
import { requirePayment, type X402Request } from './middleware/x402.js';
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

// Fund endpoint
app.use('/api/fund', fundRouter);

// GitHub webhook endpoint
app.use('/api/webhooks/github', webhooksRouter);

// Payout execution endpoint
app.use('/api/payout', payoutRouter);

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
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia USDC
    chainId: 84532,
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
  console.log(`Health check: http://localhost:${config.PORT}/api/health`);
});
