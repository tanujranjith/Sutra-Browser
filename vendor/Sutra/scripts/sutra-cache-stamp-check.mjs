#!/usr/bin/env node
/* ==========================================================================
   Cache-stamp freshness guard  —  part of `npm run check:all`
   ==========================================================================
   Sutra has no bundler: every JS/CSS asset is cache-busted by a hand-written
   ?v= query string on its <script>/<link> tag (or in the feature manifest).
   The cache-first service worker keys by the FULL URL including that query, so
   the ?v= stamp is the ONLY signal that a file changed. If a file's content
   changes but its stamp does not, every cache layer keeps serving the stale
   bytes — which is exactly how a stale migrations.js (missing a v4->v5 step)
   shipped against a newer app.js and faked a "could not save" failure.

   Invariant enforced here: the ?v= stamp of every stamped asset must be UNIQUE
   to that asset's current content. We record (stamp, contentHash) per asset in
   scripts/cache-stamp-lock.json. If a file's content changes, its stamp MUST
   change before the lock can be re-blessed — so "edited the file, forgot to
   bump the stamp" fails the build instead of reaching production.

   Usage:
     node scripts/sutra-cache-stamp-check.mjs            # verify (CI / check:all)
     node scripts/sutra-cache-stamp-check.mjs --update   # re-bless after a bump
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assertCoreRuntimeIntegrity } from './lib/core-runtime-integrity.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_REL = 'scripts/cache-stamp-lock.json';
const LOCK_PATH = resolve(repoRoot, LOCK_REL);
const UPDATE = process.argv.includes('--update');

if (UPDATE) {
  try {
    assertCoreRuntimeIntegrity({ appPath: resolve(repoRoot, 'src/core/app.js') });
  } catch (error) {
    console.error(error.message);
    console.error('Cache-stamp lock not updated — a broken core runtime must never receive a blessed cache stamp.');
    process.exit(1);
  }
}

// Hand-authored sources of ?v= stamps. The generated asset manifest COPIES
// these stamps (and is verified separately by assets:check), so scanning it
// here would only double-count.
const STAMP_SOURCES = ['Sutra.html', 'src/config/feature-manifest.js'];
const STAMP_PATTERN = /([A-Za-z0-9._/-]+\.(?:js|css))\?v=([A-Za-z0-9._-]+)/g;

function read(relPath) { return readFileSync(resolve(repoRoot, relPath), 'utf8'); }
function normalizePath(raw) { return String(raw).replace(/^\.?\//, ''); }
function hashContent(text) {
  // Normalize line endings so a CRLF/LF checkout difference is not mistaken
  // for a content change across machines.
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

// Collect { path -> { stamps:Set, sources:Set } } for every stamped local asset
// that actually exists on disk (cross-origin/CDN refs and dead links are skipped).
function collectStampedAssets() {
  const assets = new Map();
  for (const source of STAMP_SOURCES) {
    if (!existsSync(resolve(repoRoot, source))) continue;
    const text = read(source);
    let match;
    while ((match = STAMP_PATTERN.exec(text))) {
      const path = normalizePath(match[1]);
      const stamp = match[2];
      if (!existsSync(resolve(repoRoot, path))) continue;
      if (!assets.has(path)) assets.set(path, { stamps: new Set(), sources: new Set() });
      const entry = assets.get(path);
      entry.stamps.add(stamp);
      entry.sources.add(source);
    }
  }
  return assets;
}

function buildCurrent() {
  const assets = collectStampedAssets();
  const map = {};
  const conflicts = [];
  for (const path of [...assets.keys()].sort()) {
    const entry = assets.get(path);
    if (entry.stamps.size > 1) {
      conflicts.push({ path, stamps: [...entry.stamps], sources: [...entry.sources] });
      continue;
    }
    map[path] = { stamp: [...entry.stamps][0], hash: hashContent(read(path)) };
  }
  return { map, conflicts };
}

console.log('Cache-stamp freshness check');
console.log('---------------------------');

const { map: current, conflicts } = buildCurrent();

// A single asset referenced with two different stamps splits the cache and is
// always wrong — fail regardless of mode.
if (conflicts.length) {
  conflicts.forEach((c) => {
    console.error(`  FAIL ${c.path} is stamped with conflicting ?v= values: ${c.stamps.join(', ')} (in ${c.sources.join(', ')})`);
  });
  console.error('\nCache-stamp check FAILED — resolve conflicting stamps before continuing.');
  process.exit(1);
}

if (UPDATE) {
  const oldLock = existsSync(LOCK_PATH) ? JSON.parse(read(LOCK_REL)) : {};
  // Refuse to bless a content change that kept its stamp — that is the exact
  // footgun this guard exists to stop, so --update must not launder it.
  const unbumped = [];
  for (const [path, cur] of Object.entries(current)) {
    const prev = oldLock[path];
    if (prev && prev.hash !== cur.hash && prev.stamp === cur.stamp) unbumped.push({ path, stamp: cur.stamp });
  }
  if (unbumped.length) {
    console.error('Refusing to update the lock — these assets changed content but kept their ?v= stamp:');
    unbumped.forEach((v) => console.error(`  - ${v.path} is still stamped ?v=${v.stamp}`));
    console.error('\nBump each stamp in Sutra.html / feature-manifest.js (then rerun npm run assets:generate), and --update again.');
    process.exit(1);
  }
  writeFileSync(LOCK_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Cache-stamp lock updated: ${Object.keys(current).length} stamped assets recorded.`);
  process.exit(0);
}

if (!existsSync(LOCK_PATH)) {
  console.error(`Missing ${LOCK_REL}. Create it with: node scripts/sutra-cache-stamp-check.mjs --update`);
  process.exit(1);
}

const lock = JSON.parse(read(LOCK_REL));
let failures = 0;

for (const [path, cur] of Object.entries(current)) {
  const prev = lock[path];
  if (!prev) {
    console.error(`  FAIL ${path} is stamped but absent from the lock. Run --update to bless it.`);
    failures++;
    continue;
  }
  if (prev.hash !== cur.hash && prev.stamp === cur.stamp) {
    // THE bug this guard prevents.
    console.error(`  FAIL ${path} content changed but its ?v= stamp is unchanged (still ${cur.stamp}). Bump the stamp so caches refetch it.`);
    failures++;
  } else if (prev.hash !== cur.hash || prev.stamp !== cur.stamp) {
    console.error(`  FAIL ${path} stamp/content moved (lock ${prev.stamp} -> now ${cur.stamp}); lock is stale. Run --update to bless it.`);
    failures++;
  }
}
for (const path of Object.keys(lock)) {
  if (!current[path]) {
    console.error(`  FAIL lock records ${path}, which is no longer a stamped asset. Run --update.`);
    failures++;
  }
}

if (failures) {
  console.error(`\nCache-stamp check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`Cache-stamp check passed — ${Object.keys(current).length} stamped assets, each ?v= stamp unique to its content.`);
