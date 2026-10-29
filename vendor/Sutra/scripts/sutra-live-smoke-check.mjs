#!/usr/bin/env node
/**
 * sutra-live-smoke-check.mjs
 *
 * Post-deploy verification against a LIVE Sutra deployment.
 * Usage:
 *   SUTRA_BASE_URL=https://tanujranjith.github.io/Sutra/ npm run check:live
 *
 * Two phases:
 *   A. HTTP checks (Node global fetch) — routes resolve, assets resolve, dev
 *      paths are NOT exposed, branding is present, no stale NoteFlow labels.
 *   B. Headless-browser checks (Playwright chromium, if installed) — the app
 *      shell boots with no uncaught console errors and makes no unexpected
 *      third-party network requests on startup.
 *
 * Phase B is skipped (non-fatal) when Playwright is unavailable so the script
 * stays runnable locally; CI installs Playwright so the gate is enforced there.
 */

const rawBase = process.env.SUTRA_BASE_URL || process.argv[2] || '';
if (!rawBase) {
  console.error(
    'check:live FAILED — set SUTRA_BASE_URL, e.g.\n' +
      '  SUTRA_BASE_URL=https://tanujranjith.github.io/Sutra/ npm run check:live'
  );
  process.exit(2);
}
const BASE = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
const baseOrigin = new URL(BASE).origin;

let failures = 0;
const results = [];
function record(ok, label, detail = '') {
  results.push({ ok, label, detail });
  if (!ok) failures += 1;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function fetchText(path, { expectOk = true } = {}) {
  const url = new URL(path, BASE).href;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const text = res.ok ? await res.text() : '';
    return { url, status: res.status, ok: res.ok, text, headers: res.headers };
  } catch (err) {
    return { url, status: 0, ok: false, text: '', error: err };
  }
}

async function checkResolves(path, label) {
  const res = await fetchText(path);
  record(res.ok, label, `${res.url} -> ${res.status || res.error?.message || 'no response'}`);
  return res;
}

async function checkNotExposed(path, label) {
  const res = await fetchText(path, { expectOk: false });
  // A clean artifact returns 404 (or any non-2xx) for dev paths.
  const hidden = !res.ok;
  record(hidden, label, `${res.url} -> ${res.status}`);
}

console.log(`Sutra live smoke check against ${BASE}`);
console.log('— Phase A: HTTP —');

// 1. Core routes resolve.
const root = await checkResolves('', 'root route responds');
const home = await checkResolves('HomePage.html', 'landing page responds');
const app = await checkResolves('Sutra.html', 'app shell responds');
const manifestRes = await checkResolves('manifest.webmanifest', 'manifest responds');

// 2. Key assets resolve.
await checkResolves('assets/brand/sutra/generated/favicon.ico', 'favicon.ico resolves');
await checkResolves('assets/brand/sutra/generated/sutra-icon-32.png', 'favicon-32 resolves');
await checkResolves('assets/brand/sutra/generated/social-preview.png', 'social-preview.png resolves');

// 3. Branding present.
record(/sutra/i.test(home.text), 'landing page has Sutra branding');
record(
  /<title>[^<]*sutra/i.test(app.text) || /og:title"[^>]*sutra/i.test(app.text),
  'app shell has Sutra branding'
);

// 4. No stale NoteFlow public-facing labels.
record(!/noteflow-classic/i.test(home.text), 'no "noteflow-classic" link on landing');
record(!/NoteFlow Atelier/i.test(home.text), 'no "NoteFlow Atelier" brand on landing');
record(!/<title>[^<]*NoteFlow/i.test(app.text), 'app <title> is not NoteFlow-branded');

// 5. Manifest is valid JSON and its start_url + first icon resolve.
let manifest = null;
try {
  manifest = JSON.parse(manifestRes.text);
  record(true, 'manifest parses as JSON');
} catch (e) {
  record(false, 'manifest parses as JSON', e.message);
}
if (manifest) {
  if (manifest.start_url) await checkResolves(manifest.start_url, 'manifest start_url resolves');
  const firstIcon = (manifest.icons || [])[0];
  if (firstIcon?.src) await checkResolves(firstIcon.src, 'manifest first icon resolves');
}

// 6. Referenced CSS/JS/icons from the entry HTML resolve (no missing assets).
function extractAssetRefs(html) {
  const refs = new Set();
  const noScriptBodies = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
  const re = /<(?:link|script|img)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(noScriptBodies)) !== null) {
    const ref = m[1].split('#')[0];
    if (
      ref &&
      !/^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(ref) &&
      !ref.includes('${')
    ) {
      refs.add(ref);
    }
  }
  return [...refs];
}
const appRefs = extractAssetRefs(app.text).slice(0, 40);
let missingRefs = 0;
for (const ref of appRefs) {
  const res = await fetchText(ref);
  if (!res.ok) {
    missingRefs += 1;
    record(false, `app references resolvable asset`, `${ref} -> ${res.status}`);
  }
}
record(missingRefs === 0, 'all sampled app shell asset references resolve', `${appRefs.length} checked`);

// 7. Dev paths must NOT be exposed.
await checkNotExposed('tests/e2e/persistence-and-folder.spec.mjs', '/tests/ not exposed');
await checkNotExposed('scripts/build-deploy-artifact.mjs', '/scripts/ not exposed');
await checkNotExposed('package.json', 'package.json not exposed');
await checkNotExposed('.github/workflows/deploy.yml', '.github not exposed');

void root; // root presence already asserted via checkResolves

// --- Phase B: headless browser boot + third-party request audit ---
console.log('— Phase B: headless browser —');
let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    chromium = null;
  }
}

if (!chromium) {
  console.log('  SKIP  Playwright not installed — boot/console/network audit skipped (run in CI to enforce).');
} else {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const thirdParty = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('request', (req) => {
      try {
        const origin = new URL(req.url()).origin;
        if (origin !== baseOrigin && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) {
          thirdParty.push(req.url());
        }
      } catch {
        /* ignore */
      }
    });
    await page.goto(new URL('Sutra.html', BASE).href, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Filter benign console noise (e.g. favicon 404 on some hosts) — none expected.
    const realErrors = consoleErrors.filter((e) => e && !/favicon\.ico/i.test(e));
    record(realErrors.length === 0, 'app boots with no uncaught console errors',
      realErrors.slice(0, 3).join(' | ') || 'clean');
    record(thirdParty.length === 0, 'no unexpected third-party requests on startup',
      thirdParty.slice(0, 5).join(' | ') || 'none');
    await browser.close();
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    record(false, 'headless browser boot', err.message);
  }
}

console.log('');
if (failures) {
  console.error(`Live smoke check FAILED (${failures} issue${failures === 1 ? '' : 's'}) against ${BASE}`);
  process.exit(1);
}
console.log(`Live smoke check PASSED against ${BASE}`);
