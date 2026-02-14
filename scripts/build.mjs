#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

// Wrapper to avoid passing extra args (e.g. "-r") down to package build scripts.
const result = spawnSync(
  'pnpm',
  ['-r', 'build'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

process.exit(result.status ?? 1);
