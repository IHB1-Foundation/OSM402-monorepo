#!/usr/bin/env node

import { spawn } from 'node:child_process';

const extraArgs = process.argv.slice(2);
const pnpmArgs = extraArgs.length > 0 ? [...extraArgs, 'dev'] : ['-r', '--parallel', 'dev'];

const child = spawn('pnpm', pnpmArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

