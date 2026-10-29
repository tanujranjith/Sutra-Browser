#!/usr/bin/env node
/*
 * check-links.mjs — repository-wide broken-link / stale-path audit.
 *
 * Sutra is a static, no-build app whose correctness depends on a web of
 * relative path references: HTML <script src>/<link href>/<img src>, CSS
 * url(...), the web manifest icon list, the service-worker precache list,
 * markdown doc cross-links, and the npm script paths in package.json. A single
 * stale path silently breaks the runtime or the release gate.
 *
 * This check resolves every *local* reference and fails if the target file is
 * missing. It deliberately ignores external/remote/data references (http(s):,
 * //, data:, blob:, mailto:, tel:, javascript:, pure #anchors) and well-known
 * non-file tokens.
 *
 * Run: node scripts/check-links.mjs   (npm run check:links)
 *
 * Scope of what is validated:
 *   - HTML:     src=, href=, poster= attributes (query/hash stripped)
 *   - CSS:      url(...) (in .css files and inline <style> blocks in HTML)
 *   - Manifest: icons[].src, start_url (file part)
 *   - SW:       quoted './...'/'...'/'/...'  precache-style asset strings
 *   - Markdown: [text](path) links + ![alt](path) images (local, anchor-stripped)
 *   - package.json + playwright configs: `node <path>` / scripts/<file> tokens
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.deploy', '.tmp', 'coverage', 'dist', 'build',
  'test-results', 'playwright-report', 'noteflow-classic'
]);

const problems = [];
let refsChecked = 0;

function rel(p) {
  return relative(repoRoot, p).split('\\').join('/');
}

/** True for references that are not local repository files. */
function isExternal(ref) {
  if (!ref) return true;
  const r = ref.trim();
  if (r === '' || r === '.' || r === '#') return true;
  return (
    r.startsWith('#') ||
    r.startsWith('//') ||
    r.startsWith('data:') ||
    r.startsWith('blob:') ||
    r.startsWith('mailto:') ||
    r.startsWith('tel:') ||
    r.startsWith('javascript:') ||
    r.startsWith('{{') || // template placeholders
    // Any scheme:// URL (http, https, ftp, …). Relative ./ ../ are NOT schemes.
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(r)
  );
}

/** Decode, then strip #hash and ?query. Returns null if nothing local is left. */
function cleanRef(ref) {
  let r = ref.trim();
  try { r = decodeURIComponent(r); } catch { /* leave as-is */ }
  r = r.split('#')[0].split('?')[0].trim();
  if (!r) return null;
  return r;
}

/**
 * Resolve a reference relative to the file it appears in and assert it exists.
 * Absolute "/x" refs resolve from repoRoot (production is served from a subpath
 * on GitHub Pages, but locally `/` maps to repoRoot — most refs here are
 * relative, and the few root-absolute ones are validated leniently).
 */
function checkRef(ref, sourceFile, line, kind) {
  if (isExternal(ref)) return;
  const cleaned = cleanRef(ref);
  if (cleaned === null) return;
  // After decoding, a leading '#' means an in-document/SVG fragment (e.g.
  // url(%23noiseFilter) -> url(#noiseFilter)), never a file.
  if (cleaned.startsWith('#')) return;
  refsChecked += 1;
  let target;
  if (cleaned.startsWith('/')) {
    target = join(repoRoot, cleaned.slice(1));
  } else {
    target = resolve(dirname(sourceFile), cleaned);
  }
  if (!existsSync(target)) {
    problems.push({
      file: rel(sourceFile),
      line,
      kind,
      ref,
      resolved: rel(target)
    });
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r\n|\r|\n/).length;
}

// --------------------------------------------------------------------------
// HTML: attribute references + inline <style> url() blocks
// --------------------------------------------------------------------------
function checkHtml(file) {
  const text = readFileSync(file, 'utf8');
  const attrRe = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(text))) {
    checkRef(m[1], file, lineOf(text, m.index), 'html-attr');
  }
  // url(...) ONLY inside inline <style> blocks — never inside <script> (JS code
  // legitimately contains url(...) / new URL(...) calls that are not paths).
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let s;
  while ((s = styleRe.exec(text))) {
    const block = s[1];
    const blockStart = s.index + s[0].indexOf(block);
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let u;
    while ((u = urlRe.exec(block))) {
      checkRef(u[1], file, lineOf(text, blockStart + u.index), 'html-css-url');
    }
  }
}

// --------------------------------------------------------------------------
// CSS: url(...)
// --------------------------------------------------------------------------
function checkCss(file) {
  const text = readFileSync(file, 'utf8');
  const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m;
  while ((m = urlRe.exec(text))) {
    checkRef(m[1], file, lineOf(text, m.index), 'css-url');
  }
}

// --------------------------------------------------------------------------
// Markdown: [text](path) and ![alt](path)
// --------------------------------------------------------------------------
function checkMarkdown(file) {
  const text = readFileSync(file, 'utf8');
  // Inline links/images: ](target)  — target may be wrapped in <> or quoted.
  const linkRe = /\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  let m;
  // Characters that never appear in a real repo path but do appear in regex/
  // glob/template snippets that happen to sit next to a "](" in prose.
  const notAPath = /[{}`*|]/;
  while ((m = linkRe.exec(text))) {
    const ref = m[1];
    if (isExternal(ref) || ref.startsWith('#') || notAPath.test(ref)) continue;
    checkRef(ref, file, lineOf(text, m.index), 'md-link');
  }
  // Reference-style definitions:  [id]: target
  const refDefRe = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;
  while ((m = refDefRe.exec(text))) {
    const ref = m[1];
    if (isExternal(ref) || ref.startsWith('#')) continue;
    checkRef(ref, file, lineOf(text, m.index), 'md-refdef');
  }
}

// --------------------------------------------------------------------------
// manifest.webmanifest
// --------------------------------------------------------------------------
function checkManifest(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  (json.icons || []).forEach((icon, i) => {
    if (icon && icon.src) checkRef(icon.src, file, 0, `manifest-icon[${i}]`);
  });
  if (json.start_url) checkRef(json.start_url, file, 0, 'manifest-start_url');
}

// --------------------------------------------------------------------------
// service worker: quoted asset strings ('./Sutra.html', etc.)
// --------------------------------------------------------------------------
function checkServiceWorker(file) {
  const text = readFileSync(file, 'utf8');
  // Only inspect string literals that look like same-origin asset paths.
  const strRe = /['"](\.\/[^'"]+|\/[^'":]+|[A-Za-z0-9_][\w./-]+\.(?:html|css|js|mjs|json|png|ico|svg|webmanifest))['"]/g;
  let m;
  while ((m = strRe.exec(text))) {
    const ref = m[1];
    // SW caches runtime assets; ignore obvious non-paths.
    if (!/[./]/.test(ref)) continue;
    if (isExternal(ref)) continue;
    // Avoid flagging regex/content-type fragments: require a file extension or ./ prefix.
    if (!ref.startsWith('./') && !ref.startsWith('/') && !/\.[A-Za-z0-9]+$/.test(ref)) continue;
    checkRef(ref, file, lineOf(text, m.index), 'sw-asset');
  }
}

// --------------------------------------------------------------------------
// package.json + playwright configs: node <path> / scripts/<file> tokens
// --------------------------------------------------------------------------
function checkNodeScriptPaths(file) {
  const text = readFileSync(file, 'utf8');
  const tokenRe = /\b(?:node\s+|--config=|command:\s*['"]?node\s+)?((?:scripts|tests|src)\/[\w./-]+\.(?:mjs|cjs|js))\b/g;
  let m;
  while ((m = tokenRe.exec(text))) {
    checkRef(m[1], file, lineOf(text, m.index), 'node-script-path');
  }
}

// --------------------------------------------------------------------------
// Walk + dispatch
// --------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(repoRoot);
for (const file of files) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.html')) checkHtml(file);
  else if (lower.endsWith('.css')) checkCss(file);
  else if (lower.endsWith('.md')) checkMarkdown(file);
  else if (file.endsWith('manifest.webmanifest')) checkManifest(file);
}
// Targeted single-file checks
const swPath = join(repoRoot, 'sw.js');
if (existsSync(swPath)) checkServiceWorker(swPath);
for (const cfg of ['package.json', 'playwright.config.mjs', 'playwright.bench.config.mjs']) {
  const p = join(repoRoot, cfg);
  if (existsSync(p)) checkNodeScriptPaths(p);
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------
console.log('Sutra link / path audit');
console.log('-----------------------');
console.log(`  references checked: ${refsChecked}`);
console.log(`  files scanned:      ${files.length}`);
console.log('');

if (problems.length) {
  console.error(`FAILED — ${problems.length} broken/stale reference(s):`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  [${p.kind}]  ${p.ref}`);
    console.error(`      -> missing: ${p.resolved}`);
  }
  process.exit(1);
}

console.log('Link / path audit passed — all local references resolve.');
