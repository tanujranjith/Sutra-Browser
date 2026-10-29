#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(repoRoot, 'Sutra.html'), 'utf8');
const largeBlockThreshold = 40;
const legacyBudgets = {
  'app-shell-base': 125,
  'workspace-overrides': 1180,
  'mobile-global': 561,
  'ui-refresh': 740,
  refinement: 59,
  'responsive-hardening': 240
};
const failures = [];
const notes = [];
const styleRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/g;
let match;
let count = 0;

while ((match = styleRe.exec(html)) !== null) {
  count += 1;
  const attrs = match[1] || '';
  const lineCount = match[2].split(/\r?\n/).length;
  const marker = attrs.match(/data-sutra-inline-style-legacy=["']([^"']+)["']/);
  if (lineCount <= largeBlockThreshold) continue;
  if (!marker) {
    failures.push(`large inline <style> block (${lineCount} lines) is not an approved legacy block`);
    continue;
  }
  const name = marker[1];
  if (!Object.prototype.hasOwnProperty.call(legacyBudgets, name)) {
    failures.push(`unknown inline-style legacy marker: ${name}`);
    continue;
  }
  if (lineCount > legacyBudgets[name]) failures.push(`${name} grew to ${lineCount} lines (budget ${legacyBudgets[name]})`);
  else if (lineCount < legacyBudgets[name]) notes.push(`${name} budget can be lowered to ${lineCount}`);
}

if (/id=["']focus-session-styles["']/.test(html)) failures.push('focus-session styles must stay extracted from Sutra.html');
if (!html.includes('styles/views/focus-session.css')) failures.push('focus-session.css link missing from Sutra.html');
if (!html.includes('class="skip-link" href="#mainContent"')) failures.push('app shell skip link missing');
if (!html.includes('id="mainContent" role="main"')) failures.push('main workspace landmark missing');
if (!html.includes('id="appWorkspaceTitle" class="sr-only"')) failures.push('app-level workspace heading missing');
if (!html.includes('role="navigation" aria-label="Primary workspace views"')) failures.push('primary navigation landmark missing');
if (!html.includes('id="toast" role="status" aria-live="polite"')) failures.push('main toast must be an aria-live status');
if (!html.includes('id="toastDismissBtn"')) failures.push('main toast dismiss button missing');

console.log(`App shell check - ${count} inline style block(s) inspected.`);
notes.forEach((note) => console.log(' - ' + note));
if (failures.length) {
  console.error('APP SHELL CHECK FAILED:');
  failures.forEach((failure) => console.error(' - ' + failure));
  process.exit(1);
}
console.log('App shell check passed. New large inline style blocks are blocked.');
