import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dotenvCandidates = [
  process.env.DOTENV_CONFIG_PATH,
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
].filter((candidate): candidate is string => Boolean(candidate));

const dotenvPath = dotenvCandidates.find((candidate) => existsSync(candidate));
dotenvConfig(dotenvPath ? { path: dotenvPath } : undefined);

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  X402_MOCK_MODE: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),
  OSM402_AUTO_FUND_ON_LABEL: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  OSM402_AUTO_MERGE: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  OSM402_AUTO_MERGE_METHOD: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  OSM402_AUTO_MERGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),
  OSM402_ACTION_SHARED_SECRET: z.string().default(''),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  GEMINI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  GEMINI_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(100).max(120_000).default(8000),
  GEMINI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  GEMINI_REVIEW_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  GEMINI_REVIEW_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(500).max(120_000).default(5000),
  GEMINI_REVIEW_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).max(300_000).default(20000),
  GEMINI_MOCK_MODE: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
