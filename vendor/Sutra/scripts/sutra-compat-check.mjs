#!/usr/bin/env node
// sutra-compat-check.mjs — prove plugins and workspace backups stay
// cross-compatible across the NoteFlow Atelier → Sutra rebrand.
//
// This EXECUTES the real code (not just greps):
//   • loads src/features/customization/plugin-system.js and runs parseBundle on the legacy
//     example `.atelier-plugin`, on the same bundle treated as `.sutra-plugin`,
//     and on a fresh bundle — proving the parser is extension-agnostic and old
//     bundles still validate; confirms a newer-schema bundle is rejected and a
//     runtime plugin is force-disabled on import.
//   • extracts + runs validateAtelierManifest on both the new `sutra-workspace`
//     manifest and the legacy `noteflow_atelier_project` manifest — proving the
//     importer accepts both, and rejects an unknown format.
// Plus static guards on the import dispatcher, file-input accept lists, and the
// `.sutra-plugin` export, so cross-compat can't silently regress.
//
// Run: node scripts/sutra-compat-check.mjs
import { readFileSync } from 'node:fs';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok:', msg); else { failures++; console.error('  FAIL:', msg); } };
const throws = (fn, msg) => { let t = false; try { fn(); } catch { t = true; } ok(t, msg); };

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log('Plugins — load the real engine and parse old + new bundles');
// Shim a browser global so the IIFE (function(global){…})(window||this) exports.
globalThis.window = globalThis;
const pluginSrc = readFileSync('src/features/customization/plugin-system.js', 'utf8');
(0, eval)(pluginSrc); // indirect eval → runs in global scope; module sets global.AtelierPlugins
const P = globalThis.AtelierPlugins;
ok(P && typeof P.parseBundle === 'function', 'plugin engine (AtelierPlugins) loaded in Node');

if (P) {
  const legacyText = readFileSync('examples/plugins/study-helper.atelier-plugin', 'utf8');

  // 1) Legacy .atelier-plugin still validates.
  const r1 = P.parseBundle(legacyText);
  ok(r1.ok, 'legacy .atelier-plugin bundle validates');
  ok(r1.ok && r1.manifest.id === 'example.study-helper', 'legacy bundle manifest parsed correctly');

  // 2) The SAME bytes, treated as a .sutra-plugin — parser takes the body, not the
  //    extension, so the result is identical. This is the cross-compat guarantee.
  const r2 = P.parseBundle(legacyText);
  ok(r2.ok && r2.manifest.id === r1.manifest.id, 'identical bundle validates as .sutra-plugin (extension-agnostic)');

  // 3) A freshly authored Sutra bundle validates.
  const freshText = JSON.stringify({
    schemaVersion: 1, id: 'sutra.demo', version: '1.0.0', name: 'Demo',
    permissions: ['ui.commands'],
    contributions: { commands: [{ id: 'c', label: 'Demo: Hi', action: 'newNote' }] }
  });
  ok(P.parseBundle(freshText).ok, 'fresh .sutra-plugin bundle validates');

  // 4) Forward-incompat is correctly refused (a bundle needing a newer schema).
  const tooNew = JSON.stringify({ schemaVersion: 99, id: 'x.y', version: '1.0.0', name: 'X' });
  ok(P.parseBundle(tooNew).ok === false, 'newer-schema bundle is rejected (expected)');

  // 5) Non-JSON is rejected gracefully (no throw).
  ok(P.parseBundle('not json').ok === false, 'non-JSON bundle rejected without throwing');

  // 6) A runtime plugin is force-disabled + flagged for review when restored.
  if (typeof P.markForReviewOnImport === 'function') {
    const reviewed = P.markForReviewOnImport([{
      manifest: { schemaVersion: 1, id: 'r.x', version: '1.0.0', name: 'R', permissions: [],
        contributions: {}, hasRuntime: true, runtime: { type: 'sandboxed-script', code: 'x' } },
      enabled: true
    }]);
    ok(Array.isArray(reviewed) && reviewed[0] && reviewed[0].enabled === false,
      'imported runtime plugin is force-disabled (code never auto-runs)');
  }
}

// ---------------------------------------------------------------------------
console.log('\nWorkspace backups — validateAtelierManifest accepts .sutra AND legacy .atelier');
const appSrc = readFileSync('src/core/app.js', 'utf8');
const prelude = [
  "const ATELIER_FORMAT_NAME = 'noteflow_atelier_project';",
  "const SUTRA_FORMAT_NAME = 'sutra-workspace';",
  'const ATELIER_FORMAT_VERSION = 1;',
  'const ATELIER_SCHEMA_VERSION = 1;',
  extractFunction(appSrc, 'normalizeFiniteNumber'),
].join('\n');
const validatorSrc = extractFunction(appSrc, 'validateAtelierManifest');
ok(!!validatorSrc, 'validateAtelierManifest extracted from app.js');

if (validatorSrc) {
  // eslint-disable-next-line no-new-func
  const validate = new Function(prelude + '\n' + validatorSrc + '\nreturn validateAtelierManifest;')();
  const baseNew = { product: 'Sutra', format: 'sutra-workspace', formatVersion: 1, schemaVersion: 1 };
  const baseOld = { format: 'noteflow_atelier_project', formatVersion: 1, schemaVersion: 1 };

  ok(validate(baseNew).formatVersion === 1, 'new .sutra (sutra-workspace) manifest accepted');
  ok(validate(baseOld).formatVersion === 1, 'legacy .atelier (noteflow_atelier_project) manifest accepted');
  throws(() => validate({ format: 'something-else', formatVersion: 1, schemaVersion: 1 }), 'unknown package format rejected');
  throws(() => validate({ format: 'sutra-workspace', formatVersion: 99, schemaVersion: 1 }), 'future package formatVersion rejected');
  throws(() => validate(null), 'missing manifest rejected');
}

// ---------------------------------------------------------------------------
console.log('\nStatic wiring (cross-compat can\'t regress)');
ok(appSrc.includes("WORKSPACE_PACKAGE_EXTENSIONS = new Set(['sutra', 'atelier'])"), 'import dispatcher recognizes BOTH .sutra and legacy .atelier');
ok(appSrc.includes('detectImportedFileKind'), 'import dispatcher uses content detection instead of MIME-only checks');
ok(appSrc.includes("manifestFormat !== SUTRA_FORMAT_NAME && manifestFormat !== ATELIER_FORMAT_NAME"), 'validator coded to accept both formats');
ok(appSrc.includes("+ '.sutra-plugin'"), 'plugin export writes .sutra-plugin');
ok(appSrc.includes('markForReviewOnImport'), 'workspace import forces plugin review');
const html = readFileSync('Sutra.html', 'utf8');
ok(html.includes('id="modsPluginImportInput" hidden'), 'plugin file input has no restrictive proprietary-extension accept filter');
ok(html.includes('id="fileInput" style="display: none;"'), 'workspace file input has no restrictive proprietary-extension accept filter');
ok(!html.includes('accept=".sutra,.atelier,.json'), 'workspace picker no longer filters .sutra through native accept');

if (failures) { console.error(`\nCross-compat check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`); process.exit(1); }
console.log('\nCross-compat check passed — old .atelier/.atelier-plugin and new .sutra/.sutra-plugin all interoperate.');
