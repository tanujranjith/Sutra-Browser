#!/usr/bin/env node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = resolve('.');
const sourceRuntime = join(repoRoot, 'src/core/app.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'sutra-runtime-server-'));
const runtimePath = join(tempRoot, 'src/core/app.js');
let child;

function fail(message) {
  throw new Error(`Static-server runtime guard self-test failed: ${message}`);
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/src/core/app.js`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  fail(`server did not start${lastError ? `: ${lastError.message}` : ''}`);
}

try {
  mkdirSync(join(tempRoot, 'src/core'), { recursive: true });
  copyFileSync(sourceRuntime, runtimePath);
  const original = readFileSync(runtimePath, 'utf8');
  const port = await reservePort();
  child = spawn(process.execPath, [join(repoRoot, 'scripts/serve-static.mjs'), String(port)], {
    cwd: repoRoot,
    env: { ...process.env, SUTRA_SERVE_ROOT: tempRoot, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const startupErrors = [];
  child.stderr.on('data', (chunk) => startupErrors.push(String(chunk)));

  const initial = await waitForServer(port);
  if (initial.headers.get('x-sutra-core-runtime') !== 'verified') fail('initial runtime was not marked verified');

  writeFileSync(runtimePath, original.replace('function renderPagesList()', 'function renderPagesList('), 'utf8');
  const fallback = await fetch(`http://127.0.0.1:${port}/src/core/app.js`);
  if (fallback.headers.get('x-sutra-core-runtime') !== 'fallback-last-verified') fail('invalid runtime was not served from fallback');
  if (await fallback.text() !== original) fail('fallback bytes do not match the last verified runtime');

  writeFileSync(runtimePath, original, 'utf8');
  const restored = await fetch(`http://127.0.0.1:${port}/src/core/app.js`);
  if (restored.headers.get('x-sutra-core-runtime') !== 'verified') fail('restored runtime was not revalidated');
  if (startupErrors.some((line) => /Static server not started/.test(line))) fail('server exited during the guard test');
  console.log('Static-server runtime guard self-test passed — malformed changes fall back to the last verified core runtime.');
} finally {
  if (child && !child.killed) child.kill();
  rmSync(tempRoot, { recursive: true, force: true });
}
