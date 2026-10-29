#!/usr/bin/env node
/**
 * sutra-deploy-artifact-check.mjs
 *
 * Verifies the staged GitHub Pages artifact in .deploy/ is correct and clean.
 * Run AFTER `npm run build:deploy`.
 *
 * Checks:
 *  1. All required app entry points exist in .deploy/.
 *  2. Every local asset referenced by the runtime HTML (<link>/<script>/<img>/
 *     <a>/url(...)) and by manifest.webmanifest resolves inside the artifact.
 *  3. No dev-only content leaked in (.github, scripts, tests, docs, examples,
 *     node_modules, package metadata, *.spec.mjs).
 *  4. No stale NoteFlow public pages/links leaked into production.
 *  5. manifest.webmanifest parses and its icons + start_url resolve.
 *  6. Favicon and social-preview images resolve.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const outDir = join(repoRoot, '.deploy');

let failures = 0;
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  failures += 1;
};

if (!existsSync(outDir)) {
  console.error('check:deploy FAILED — .deploy/ does not exist. Run `npm run build:deploy` first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Required entry points.
// ---------------------------------------------------------------------------
const REQUIRED = [
  'index.html',
  'HomePage.html',
  'Sutra.html',
  '404.html',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'LICENSE',
  'src/core/app.js',
  'src/persistence/revocation-wipe.js',
  'src/sync/sync-protocol.js',
  'src/sync/sync-crypto.js',
  'src/sync/sync-projection.js',
  'src/sync/sync-diff.js',
  'src/sync/sync-merge.js',
  'src/sync/sync-store.js',
  'src/sync/sync-transport.js',
  'src/sync/sync-engine.js',
  'src/features/assistant/flow-assistant.js',
  'src/features/workspace/sheets-engine.js',
  'src/features/workspace/sheets.js',
  'src/features/workspace/slides.js',
  'src/config/asset-manifest.generated.js',
  'src/config/asset-manifest.generated.json',
  'styles/base/styles.css',
  'styles/features/slides.css',
  'styles/features/sheets.css',
  'assets/brand/sutra/generated/favicon.ico',
  'assets/brand/sutra/generated/social-preview.png',
  'assets/vendor/jszip/jszip.min.js'
];
for (const p of REQUIRED) {
  if (!existsSync(join(outDir, p))) fail(`required artifact file missing: ${p}`);
}

// ---------------------------------------------------------------------------
// 2. Referenced local assets must resolve inside the artifact.
// ---------------------------------------------------------------------------
const HTML_ENTRY = ['index.html', 'HomePage.html', 'Sutra.html', '404.html'];

function isExternalOrInline(ref) {
  return (
    !ref ||
    ref.startsWith('http:') ||
    ref.startsWith('https:') ||
    ref.startsWith('//') ||
    ref.startsWith('data:') ||
    ref.startsWith('blob:') ||
    ref.startsWith('mailto:') ||
    ref.startsWith('tel:') ||
    ref.startsWith('javascript:') ||
    ref.startsWith('#') ||
    ref.startsWith('{') || // template/JS-built path
    ref.includes('${')
  );
}

function cleanRef(ref) {
  // Strip query string and hash, decode percent-encoding.
  let r = ref.split('#')[0].split('?')[0].trim();
  try {
    r = decodeURIComponent(r);
  } catch {
    /* leave as-is */
  }
  return r;
}

function collectHtmlRefs(rawHtml) {
  const refs = new Set();
  // Strip inline <script> BODIES (keep the opening <script src=...> tag) so JS
  // assignments like `a.href = rawUrl` are not mistaken for asset references.
  const html = rawHtml.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
  // <link>/<script>/<img>/<a>/<source>/<iframe>/<use> src|href|xlink:href
  const tagRe =
    /<(?:link|script|img|a|source|iframe|use|image)\b[^>]*?\s(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) refs.add(m[1]);
  // url(...) in inline styles / <style> blocks
  const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((m = urlRe.exec(html)) !== null) refs.add(m[1]);
  return refs;
}

for (const entry of HTML_ENTRY) {
  const file = join(outDir, entry);
  if (!existsSync(file)) continue; // already reported above
  const html = readFileSync(file, 'utf8');
  for (const raw of collectHtmlRefs(html)) {
    if (isExternalOrInline(raw)) continue;
    const ref = cleanRef(raw);
    if (!ref || isExternalOrInline(ref)) continue;
    // Resolve relative to the entry file's directory (entries are at root).
    const target = join(outDir, ref);
    if (!existsSync(target)) {
      fail(`${entry} references missing local asset: "${raw}" -> ${ref}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. manifest.webmanifest parses; icons + start_url resolve.
// ---------------------------------------------------------------------------
const manifestPath = join(outDir, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`manifest.webmanifest is not valid JSON: ${e.message}`);
  }
  if (manifest) {
    for (const icon of manifest.icons || []) {
      const ref = cleanRef(icon.src || '');
      if (isExternalOrInline(ref)) continue;
      if (!existsSync(join(outDir, ref))) fail(`manifest icon missing in artifact: ${ref}`);
    }
    const startUrl = cleanRef(manifest.start_url || '');
    if (startUrl && !isExternalOrInline(startUrl) && !existsSync(join(outDir, startUrl))) {
      fail(`manifest start_url target missing in artifact: ${startUrl}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. No dev-only content leaked in.
// ---------------------------------------------------------------------------
const FORBIDDEN_TOP = [
  '.git',
  '.github',
  'node_modules',
  'tests',
  'scripts',
  'docs',
  'examples',
  'test-results',
  '.tmp',
  'package.json',
  'package-lock.json',
  'playwright.config.mjs',
  'README.md',
  'noteflow-classic'
];
const present = new Set(readdirSync(outDir));
for (const name of FORBIDDEN_TOP) {
  if (present.has(name)) fail(`dev-only content leaked into artifact: ${name}`);
}

// The release must ship the exact runtime bytes that were checked. These files
// cover account scoping, asset path construction, conflict/crypto behavior,
// revoke-and-wipe, backup rollback, Assistant, Canvas/page integration, Slides,
// attachment sync, generated manifests, and the service worker.
const CURRENT_RUNTIME_FILES = [
  'src/core/app.js',
  'src/persistence/revocation-wipe.js',
  'src/sync/sync-protocol.js',
  'src/sync/sync-crypto.js',
  'src/sync/sync-projection.js',
  'src/sync/sync-diff.js',
  'src/sync/sync-merge.js',
  'src/sync/sync-store.js',
  'src/sync/sync-transport.js',
  'src/sync/sync-engine.js',
  'src/features/assistant/flow-assistant.js',
  'src/features/workspace/sheets-engine.js',
  'src/features/workspace/sheets.js',
  'src/features/workspace/slides.js',
  'src/config/asset-manifest.generated.js',
  'src/config/asset-manifest.generated.json',
  'sw.js'
];
for (const relPath of CURRENT_RUNTIME_FILES) {
  const sourcePath = join(repoRoot, relPath);
  const artifactPath = join(outDir, relPath);
  if (!existsSync(sourcePath) || !existsSync(artifactPath)) continue; // required-file checks report absence
  if (!readFileSync(sourcePath).equals(readFileSync(artifactPath))) {
    fail(`artifact runtime is stale or differs from source: ${relPath}`);
  }
}

// Recursive scan for stray test/package files anywhere in the tree.
const plaintextSentinels = [
  'mock-user-',
  'REMOTE_BOUNDARY_NOTE_TITLE_730',
  'REMOTE_BOUNDARY_NOTE_BODY_730',
  'REMOTE_BOUNDARY_PRIVATE_FILENAME_730.txt',
  'REMOTE_BOUNDARY_ATTACHMENT_BYTES_730',
  'REMOTE_BOUNDARY_PASSPHRASE_730',
  'REMOTE_BOUNDARY_RECOVERY_KEY_730'
];
const realSupabaseProjects = new Set();
const publishableKeys = new Set();
const textExtension = /\.(?:css|html?|js|json|txt|webmanifest|xml)$/i;
function walk(dir, rel = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const relPath = rel ? posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walk(abs, relPath);
    } else {
      if (entry.name.endsWith('.spec.mjs') || entry.name.endsWith('.spec.js')) {
        fail(`test spec leaked into artifact: ${relPath}`);
      }
      if (entry.name === 'package.json' || entry.name === 'package-lock.json') {
        fail(`package metadata leaked into artifact: ${relPath}`);
      }
      if (/\.(?:sql|map)$/i.test(entry.name)) {
        fail(`non-runtime SQL/source-map file leaked into artifact: ${relPath}`);
      }
      if (/^README\.md$/i.test(entry.name)) {
        fail(`development README leaked into artifact: ${relPath}`);
      }
      if (/(?:^|[-_.])(?:fixture|fixtures)(?:[-_.]|$)/i.test(entry.name)) {
        fail(`test fixture leaked into artifact: ${relPath}`);
      }
      if (textExtension.test(entry.name)) {
        const text = readFileSync(abs, 'utf8');
        for (const sentinel of plaintextSentinels) {
          if (text.includes(sentinel)) fail(`synthetic private plaintext leaked into artifact: ${relPath}`);
        }
        if (/sb_secret_[A-Za-z0-9._-]{16,}/i.test(text)) {
          fail(`secret-shaped Supabase credential leaked into artifact: ${relPath}`);
        }
        for (const match of text.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/gi)) {
          realSupabaseProjects.add(match[0].toLowerCase());
        }
        for (const match of text.matchAll(/sb_publishable_[A-Za-z0-9_-]{16,}/g)) {
          publishableKeys.add(match[0]);
        }
      }
    }
  }
}
walk(outDir);

if (realSupabaseProjects.size !== 1
  || !realSupabaseProjects.has('https://blfsmdyvdlhabltiicgx.supabase.co')) {
  fail(`artifact contains an unexpected concrete Supabase project URL (${realSupabaseProjects.size} found)`);
}
if (publishableKeys.size !== 1
  || !publishableKeys.has('sb_publishable_wC7rjhwQvGA_Li07vK_Skg_ovfMG_Z_')) {
  fail(`artifact contains an unexpected Supabase publishable key (${publishableKeys.size} found)`);
}

// Public URL/publishable-key configuration is intended to ship. Secret-shaped
// Supabase credentials are not.
const runtimeConfigPath = join(outDir, 'src', 'config', 'sutra-runtime-config.js');
if (existsSync(runtimeConfigPath)) {
  const runtimeConfig = readFileSync(runtimeConfigPath, 'utf8');
  if (!runtimeConfig.includes('https://blfsmdyvdlhabltiicgx.supabase.co')) {
    fail('intended public Supabase project URL is missing from runtime config');
  }
  if (!runtimeConfig.includes('sb_publishable_wC7rjhwQvGA_Li07vK_Skg_ovfMG_Z_')) {
    fail('intended Supabase publishable key is missing from runtime config');
  }
  if (/(?:sb_secret_|service_role["'\s:=_-]+)[A-Za-z0-9._-]{16,}/i.test(runtimeConfig)) {
    fail('secret-shaped Supabase credential leaked into runtime config');
  }
}

// ---------------------------------------------------------------------------
// 5. No stale NoteFlow public pages or links in shipped HTML.
// ---------------------------------------------------------------------------
for (const entry of HTML_ENTRY) {
  const file = join(outDir, entry);
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  if (/noteflow-classic/i.test(html)) {
    fail(`${entry} still links to the legacy "noteflow-classic" page`);
  }
  if (/href\s*=\s*["'][^"']*\/tests\//i.test(html) || /href\s*=\s*["'][^"']*\/scripts\//i.test(html)) {
    fail(`${entry} references a dev path (/tests/ or /scripts/)`);
  }
}

// ---------------------------------------------------------------------------
// Result.
// ---------------------------------------------------------------------------
if (failures) {
  console.error(`Deploy-artifact check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('Deploy-artifact check passed — .deploy/ contains a clean, self-consistent runtime surface.');
