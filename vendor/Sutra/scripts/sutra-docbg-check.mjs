#!/usr/bin/env node
// sutra-docbg-check.mjs — document-background feature checks.
//
// Two layers:
//   1) EXECUTION: extract normalizeDocumentBackground() from app.js and run it,
//      proving the blur/dim clamps and image validation actually behave.
//   2) STATIC: confirm the render engine, locked-page gating, duplicate copy,
//      and export wiring are present, and that the background rides the existing
//      recursive inline-asset extraction used for .sutra/.atelier/JSON export.
//
// Run: node scripts/sutra-docbg-check.mjs
import { readFileSync } from 'node:fs';

const appPath = 'src/core/app.js';
const src = readFileSync(appPath, 'utf8');
let failures = 0;
const ok = (cond, msg) => { if (cond) { console.log('  ok:', msg); } else { failures++; console.error('  FAIL:', msg); } };

// --- Extract a top-level `function name(...) { ... }` by brace matching ------
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

console.log('Document background — execution checks');
const fnSrc = extractFunction(src, 'normalizeDocumentBackground');
ok(!!fnSrc, 'normalizeDocumentBackground extracted from app.js');

let normalizeDocumentBackground = null;
if (fnSrc) {
  // eslint-disable-next-line no-new-func
  normalizeDocumentBackground = new Function(fnSrc + '\nreturn normalizeDocumentBackground;')();
}

if (normalizeDocumentBackground) {
  const pngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const a = normalizeDocumentBackground({ dataUrl: pngUrl, blurPx: 99, overlayOpacity: 5, enabled: true, name: 'x'.repeat(500) });
  ok(a.blurPx === 32, 'blur clamps to max 32 (got ' + a.blurPx + ')');
  ok(a.overlayOpacity === 0.8, 'dim clamps to max 0.8 (got ' + a.overlayOpacity + ')');
  ok(a.enabled === true && a.dataUrl === pngUrl, 'valid PNG data URL accepted + enabled');
  ok(a.name.length === 200, 'name truncated to 200 chars (got ' + a.name.length + ')');
  ok(a.fit === 'cover' && a.position === 'center', 'fit/position defaults present');

  const b = normalizeDocumentBackground({ dataUrl: pngUrl, blurPx: -10, overlayOpacity: -1 });
  ok(b.blurPx === 0, 'blur clamps to min 0 (got ' + b.blurPx + ')');
  ok(b.overlayOpacity === 0, 'dim clamps to min 0 (got ' + b.overlayOpacity + ')');

  const c = normalizeDocumentBackground({ dataUrl: 'https://evil.example/x.png', enabled: true });
  ok(c.dataUrl === null && c.enabled === false, 'non-data: URL rejected (no remote refs, no enable)');

  const d = normalizeDocumentBackground({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=', enabled: true });
  ok(d.dataUrl === null && d.enabled === false, 'non-image data URL rejected');

  const e = normalizeDocumentBackground(null);
  ok(e.enabled === false && e.dataUrl === null && e.blurPx === 0 && e.overlayOpacity === 0.25, 'empty default: disabled, dim 0.25');

  const f = normalizeDocumentBackground({ dataUrl: pngUrl, enabled: false });
  ok(f.enabled === false && f.dataUrl === pngUrl, 'enabled:false respected while image retained');

  const g = normalizeDocumentBackground({ dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', blurPx: 8.7, overlayOpacity: 0.3, enabled: true });
  ok(g.blurPx === 9, 'blur rounded to integer (got ' + g.blurPx + ')');
}

console.log('\nDocument background — static wiring checks');
ok(/documentBackground:\s*normalizeDocumentBackground\(page\.documentBackground\)/.test(src), 'page model normalizes documentBackground');
ok(src.includes('function applyDocumentBackgroundForEditor'), 'render engine present');
ok(src.includes('applyDocumentBackgroundForEditor(editor, page)'), 'render engine called from loadPageContentIntoEditor');
ok(src.includes('function sutraIsPageLockedNow'), 'locked-page predicate present');
ok(/active\s*=\s*!!\(bg && bg\.enabled && bg\.dataUrl && !sutraIsPageLockedNow\(page\)\)/.test(src), 'background suppressed for locked pages');
ok(src.includes("data-sutra-component', 'document-background-layer'"), 'background layer hook');
ok(src.includes("data-sutra-component', 'document-background-overlay'"), 'dim overlay hook');
ok(/documentBackground:\s*normalizeDocumentBackground\(originalPage\.documentBackground\)/.test(src), 'duplicatePage copies documentBackground');
ok(src.includes('window.openDocumentBackgroundModal'), 'modal opener exposed for inline toolbar handler');

// Background must ride the existing recursive inline-asset extraction on export.
const replacer = extractFunction(src, 'replaceAtelierInlineAssets');
ok(!!replacer, 'replaceAtelierInlineAssets present');
ok(!!replacer && /output\[key\]\s*=\s*replaceAtelierInlineAssets/.test(replacer), 'inline-asset replacer recurses object values (so documentBackground.dataUrl is extracted into the package)');

// Secrets must never be the background source.
ok(!/documentBackground[\s\S]{0,200}sessionStorage/.test(src), 'documentBackground never sourced from sessionStorage secrets');

const html = readFileSync('Sutra.html', 'utf8');
ok(html.includes('id="documentBackgroundModal"'), 'modal markup in Sutra.html');
ok(html.includes('data-sutra-component="document-background-controls"'), 'controls hook in Sutra.html');
ok(html.includes('id="docBgBlur"') && html.includes('max="32"'), 'blur slider 0–32 in Sutra.html');
ok(html.includes('id="docBgDim"') && html.includes('max="80"'), 'dim slider 0–80% in Sutra.html');
ok(html.includes('accept="image/png,image/jpeg,image/webp'), 'upload accepts png/jpeg/webp');
ok(/@media \(max-width:520px\)[\s\S]*doc-bg-btn\{flex:1 1 auto/.test(html), 'mobile: background controls stack/expand under 520px');
ok(html.includes('is-page-locked>.sutra-doc-bg-layer'), 'CSS backstop hides background behind PIN screen');

if (failures) { console.error(`\nDocument-background check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`); process.exit(1); }
console.log('\nDocument-background check passed (execution + static).');
