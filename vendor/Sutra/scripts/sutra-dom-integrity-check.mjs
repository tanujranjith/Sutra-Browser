#!/usr/bin/env node
/*
 * sutra-dom-integrity-check.mjs — static DOM integrity guard for the HTML
 * entry points.
 *
 * Two classes of bug this catches before they ship:
 *   1. DUPLICATE element ids. `document.getElementById` returns only the first
 *      match, so a duplicated id silently wires events/queries to the wrong node
 *      (or none). Sutra leans heavily on getElementById, so a dup is a real,
 *      hard-to-spot runtime bug — and an accessibility violation.
 *   2. DUPLICATE <script src> includes. The same module loaded twice re-runs its
 *      top-level code (double listeners, double init, clobbered singletons).
 *
 * Script/style/comment regions are stripped before scanning so JS string
 * literals (`el.id = "x"`) and commented-out markup don't cause false positives.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rel = (p) => resolve(repoRoot, p);

const FILES = ['Sutra.html', 'HomePage.html', 'index.html', '404.html'];

const failures = [];
let idsScanned = 0;
let scriptsScanned = 0;

function stripNonMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

function collectIds(markup) {
  const ids = [];
  const re = /\sid\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(markup)) !== null) {
    const value = (m[2] != null ? m[2] : m[3]).trim();
    if (value) ids.push(value);
  }
  return ids;
}

function collectScriptSrcs(html) {
  const srcs = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[2] != null ? m[2] : m[3]).trim();
    if (!raw) continue;
    // Compare by path without the ?v= cache-bust so two versions of the same
    // file still count as a duplicate include.
    srcs.push(raw.split('?')[0]);
  }
  return srcs;
}

function duplicates(list) {
  const seen = new Map();
  for (const v of list) seen.set(v, (seen.get(v) || 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1);
}

for (const file of FILES) {
  let html;
  try { html = readFileSync(rel(file), 'utf8'); } catch (err) {
    if (file === 'Sutra.html') failures.push(`${file}: required entry point is unreadable (${err.message})`);
    continue; // 404.html / others are optional
  }

  const ids = collectIds(stripNonMarkup(html));
  idsScanned += ids.length;
  const dupIds = duplicates(ids);
  if (dupIds.length) {
    for (const [id, n] of dupIds) failures.push(`${file}: duplicate element id "${id}" appears ${n} times`);
  }

  const srcs = collectScriptSrcs(html);
  scriptsScanned += srcs.length;
  const dupSrcs = duplicates(srcs);
  if (dupSrcs.length) {
    for (const [src, n] of dupSrcs) failures.push(`${file}: <script src="${basename(src)}"> included ${n} times`);
  }
}

console.log('DOM integrity check (entry points)');
console.log('----------------------------------');
console.log(`  element ids scanned: ${idsScanned}`);
console.log(`  script srcs scanned: ${scriptsScanned}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`\nDOM integrity check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('\nDOM integrity check passed — no duplicate ids or duplicate script includes.');
