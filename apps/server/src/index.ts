import express from 'express';
import { config } from './config.js';

const app = express();

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

app.listen(config.PORT, () => {
  console.log(`GitPay server running on port ${config.PORT}`);
  console.log(`Health check: http://localhost:${config.PORT}/api/health`);
});
