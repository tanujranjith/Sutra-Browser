#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCoreRuntime } from './lib/core-runtime-integrity.mjs';

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
}

try {
  git(['diff', '--cached', '--quiet', '--', 'src/core/app.js']);
  process.exit(0);
} catch (error) {
  if (error.status !== 1) {
    console.error(`Unable to inspect the staged core runtime: ${String(error.stderr || error.message).trim()}`);
    process.exit(1);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'sutra-staged-runtime-'));
const stagedPath = join(tempRoot, 'app.js');
try {
  const stagedSource = git(['show', ':src/core/app.js']);
  writeFileSync(stagedPath, stagedSource, 'utf8');
  const result = checkCoreRuntime({ appPath: stagedPath });
  if (!result.ok) {
    console.error('Commit blocked: staged src/core/app.js failed the core-runtime integrity gate.');
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Staged core runtime passed (${result.passes.length} assertions).`);
} catch (error) {
  console.error(`Commit blocked: unable to validate staged src/core/app.js. ${String(error.stderr || error.message).trim()}`);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
