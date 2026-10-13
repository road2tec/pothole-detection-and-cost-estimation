#!/usr/bin/env node
// Cross-platform launcher for the Python AI service (picks the venv interpreter for this OS).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'ai-service');
const python = process.platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
if (!existsSync(python)) {
  console.error(`Python virtualenv not found at ${python}. See README → Quick start.`);
  process.exit(1);
}
const args = process.argv[2] === 'test' ? ['-m', 'pytest', ...process.argv.slice(3)] : ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'];
const child = spawn(python, args, {
  cwd: dir,
  stdio: 'inherit',
  env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
