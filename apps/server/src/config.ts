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
  GITHUB_WEBHOOK_SECRET: z.string().default(''),
  OSM402_ACTION_SHARED_SECRET: z.string().default(''),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
