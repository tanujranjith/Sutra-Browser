#!/usr/bin/env node
// Syntax check: runs `node --check` over every first-party JS/MJS file so a
// stray syntax error in the shipped source (app.js, feature modules, build
// scripts) fails the release gate before any browser test runs.
//
// Run: node scripts/syntax-check.mjs

import { readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.deploy', '.tmp', 'coverage', 'dist', 'build', 'noteflow-classic', 'test-results', 'playwright-report']);
const SOURCE_ROOTS = ['src', 'scripts', 'tests'];
const ROOT_FILES = ['playwright.config.mjs', 'playwright.bench.config.mjs'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SOURCE_ROOTS.flatMap((root) => walk(resolve(repoRoot, root)))
  .concat(ROOT_FILES.map((file) => resolve(repoRoot, file)));
const failures = [];
let checked = 0;

for (const file of files) {
  // `node --check <file>` validates syntax without executing, so browser
  // globals (window/document) in the classic feature scripts are fine.
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked += 1;
  } catch (err) {
    const msg = (err.stderr ? err.stderr.toString() : '') || err.message;
    failures.push(`${relative(repoRoot, file)}\n    ${msg.trim().split('\n').slice(0, 3).join('\n    ')}`);
  }
}

console.log(`Syntax check — ${checked} JS file(s) validated.`);
if (failures.length) {
  console.error('SYNTAX CHECK FAILED:');
  failures.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}
console.log('Syntax check passed.');
