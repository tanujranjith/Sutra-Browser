#!/usr/bin/env node
/*
 * sutra-guardrails-check.mjs — static architecture guardrails.
 *
 * Fails CI when a future change reintroduces a dangerous pattern:
 *   1. New unsafe DOM sink   (innerHTML =, outerHTML =, insertAdjacentHTML,
 *                             document.write) beyond the per-file baseline.
 *   2. New direct storage write (localStorage.setItem / sessionStorage.setItem)
 *      that does not route through SutraSafeStorage and is not allowlisted.
 *   3. A new, unregistered window.* global.
 *   4. A new/moved top-level workspace field missing from
 *      docs/architecture/persistence-inventory.json.
 *
 * Escape hatches (use sparingly, always with a reason):
 *   - Per-line inline marker for a reviewed exception:
 *       el.innerHTML = STATIC_TEMPLATE; // sutra-allow-html: developer markup
 *       localStorage.setItem(k, v);      // sutra-allow-storage: <why>
 *   - Or raise the baseline deliberately:  node scripts/sutra-guardrails-check.mjs --update
 *     (review the diff — the budget should normally only go DOWN over time).
 *
 * The detection logic lives in scripts/lib/guardrail-scan.mjs and is unit-tested
 * by scripts/sutra-guardrails.selftest.mjs against hostile fixtures.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanSinks,
  scanStorage,
  scanWindowGlobals,
  extractWorkspaceFields
} from './lib/guardrail-scan.mjs';
import { discoverRuntimeSources } from './lib/runtime-source-discovery.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = resolve(repoRoot, 'scripts/guardrail-baseline.json');

// New first-party runtime files enter the ratchet automatically. Generated,
// fixture, vendor, legacy, test-output, and deploy trees are deliberately
// excluded with reasons in the shared discovery module.
const discovery = discoverRuntimeSources(repoRoot);
const SCAN_FILES = discovery.files;

if (!SCAN_FILES.length) {
  console.error('FAIL no first-party runtime files were discovered for guardrail scanning.');
  process.exit(1);
}

// Fields that legitimately appear in persist/export but are not user-data
// workspace fields tracked by the persistence inventory (version markers, etc.).
const INVENTORY_FIELD_IGNORE = new Set(['version', 'exportedAt', 'exportDiagnostics']);

function read(file) {
  const p = resolve(repoRoot, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function buildState() {
  const sinks = {};
  const storage = {};
  const sinkFindings = {};
  const storageFindings = {};
  const globals = new Set();
  for (const file of SCAN_FILES) {
    const text = read(file);
    if (text == null) continue;
    const sinkScan = scanSinks(text);
    const storageScan = scanStorage(text);
    sinks[file] = sinkScan.total;
    storage[file] = storageScan.total;
    sinkFindings[file] = sinkScan.hits.map(hit => hit.fingerprint).sort();
    storageFindings[file] = storageScan.hits.map(hit => hit.fingerprint).sort();
    scanWindowGlobals(text).forEach(name => globals.add(name));
  }
  return { sinks, storage, sinkFindings, storageFindings, globals: Array.from(globals).sort() };
}

const args = process.argv.slice(2);

if (args.includes('--update')) {
  const state = buildState();
  const baseline = {
    note: 'Architecture guardrail baseline. Budgets are ceilings; new unsafe '
      + 'patterns beyond these fail scripts/sutra-guardrails-check.mjs. Lower '
      + 'them as raw sinks are migrated to SutraDOMSafety/SutraSafeStorage. '
      + 'Regenerate intentionally with --update and review the diff.',
    sinkBudgets: state.sinks,
    storageBudgets: state.storage,
    sinkFindings: state.sinkFindings,
    storageFindings: state.storageFindings,
    knownGlobals: state.globals,
    inventoryParityIgnore: []
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`Guardrail baseline written to ${BASELINE_PATH}`);
  console.log(`  files scanned:  ${SCAN_FILES.length}`);
  console.log(`  total sinks:    ${Object.values(state.sinks).reduce((a, b) => a + b, 0)}`);
  console.log(`  total storage:  ${Object.values(state.storage).reduce((a, b) => a + b, 0)}`);
  console.log(`  known globals:  ${state.globals.length}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error('FAIL no guardrail baseline found. Generate it once with:');
  console.error('  node scripts/sutra-guardrails-check.mjs --update');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const failures = [];
const notes = [];

function addedFindings(current, approved) {
  const remaining = new Map();
  (approved || []).forEach(value => remaining.set(value, (remaining.get(value) || 0) + 1));
  return (current || []).filter(value => {
    const count = remaining.get(value) || 0;
    if (count > 0) { remaining.set(value, count - 1); return false; }
    return true;
  });
}

// ---- 1 + 2) Sink and storage ratchets ---------------------------------------

for (const file of SCAN_FILES) {
  const text = read(file);
  if (text == null) continue;

  const sinkBudget = baseline.sinkBudgets[file] ?? 0;
  const sinkScan = scanSinks(text);
  const approvedSinkFindings = baseline.sinkFindings && baseline.sinkFindings[file];
  const newSinkFindings = approvedSinkFindings
    ? addedFindings(sinkScan.hits.map(hit => hit.fingerprint), approvedSinkFindings) : [];
  if (sinkScan.total > sinkBudget) {
    const extra = sinkScan.total - sinkBudget;
    const likely = sinkScan.hits.slice(-extra).map(h => `        L${h.line} ${h.key}: ${h.text}`);
    failures.push(
      `${file}: ${extra} new unsafe DOM sink(s) (${sinkScan.total} > baseline ${sinkBudget}).\n`
      + `      Route through SutraDOMSafety.setText/setUserHTML/setTrustedHTML, or add a\n`
      + `      "// sutra-allow-html: <reason>" marker on the line if it is reviewed-safe.\n`
      + likely.join('\n')
    );
  } else if (sinkScan.total < sinkBudget) {
    notes.push(`${file}: sink budget can be lowered to ${sinkScan.total} (was ${sinkBudget}).`);
  }
  if (newSinkFindings.length) {
    const hits = sinkScan.hits.filter(hit => newSinkFindings.includes(hit.fingerprint));
    failures.push(`${file}: new unsafe sink fingerprint(s) detected even though the aggregate budget may be flat.\n`
      + hits.map(hit => `        L${hit.line} ${hit.fingerprint} ${hit.text}`).join('\n'));
  }

  const storageBudget = baseline.storageBudgets[file] ?? 0;
  const storageScan = scanStorage(text);
  const approvedStorageFindings = baseline.storageFindings && baseline.storageFindings[file];
  const newStorageFindings = approvedStorageFindings
    ? addedFindings(storageScan.hits.map(hit => hit.fingerprint), approvedStorageFindings) : [];
  if (storageScan.total > storageBudget) {
    const extra = storageScan.total - storageBudget;
    const likely = storageScan.hits.slice(-extra).map(h => `        L${h.line} ${h.key}: ${h.text}`);
    failures.push(
      `${file}: ${extra} new direct storage write(s) (${storageScan.total} > baseline ${storageBudget}).\n`
      + `      Route through window.SutraSafeStorage.set/session, or add a\n`
      + `      "// sutra-allow-storage: <reason>" marker if it is intentional.\n`
      + likely.join('\n')
    );
  } else if (storageScan.total < storageBudget) {
    notes.push(`${file}: storage budget can be lowered to ${storageScan.total} (was ${storageBudget}).`);
  }
  if (newStorageFindings.length) {
    const hits = storageScan.hits.filter(hit => newStorageFindings.includes(hit.fingerprint));
    failures.push(`${file}: new direct-storage fingerprint(s) detected even though the aggregate budget may be flat.\n`
      + hits.map(hit => `        L${hit.line} ${hit.fingerprint} ${hit.text}`).join('\n'));
  }
}

// ---- 3) Unregistered window.* globals ---------------------------------------

const known = new Set(baseline.knownGlobals || []);
const liveGlobals = new Set();
for (const file of SCAN_FILES) {
  const text = read(file);
  if (text == null) continue;
  scanWindowGlobals(text).forEach(name => liveGlobals.add(name));
}
const newGlobals = Array.from(liveGlobals).filter(name => !known.has(name)).sort();
if (newGlobals.length) {
  failures.push(
    `Unregistered window.* global(s): ${newGlobals.join(', ')}.\n`
    + `      Every intentional global must be registered. If this is deliberate,\n`
    + `      re-run with --update to register it (and confirm it is namespaced).`
  );
}

// ---- 4) Persistence-inventory parity ----------------------------------------

const appJs = read('src/core/app.js');
const inventory = JSON.parse(read('docs/architecture/persistence-inventory.json'));
const topLevel = new Set(inventory.workspaceTopLevelFields || []);
const ignore = new Set([...(baseline.inventoryParityIgnore || []), ...INVENTORY_FIELD_IGNORE]);

if (appJs) {
  const { persistFields, exportFields } = extractWorkspaceFields(appJs);
  const seen = new Set();
  [...persistFields, ...exportFields].forEach(field => {
    if (seen.has(field) || ignore.has(field)) return;
    seen.add(field);
    if (!topLevel.has(field)) {
      failures.push(
        `Top-level workspace field "${field}" is persisted/exported but not listed in\n`
        + `      docs/architecture/persistence-inventory.json (workspaceTopLevelFields). Add it there so\n`
        + `      round-trip/import/export coverage stays complete.`
      );
    }
  });
}

// ---- Report -----------------------------------------------------------------

console.log('Sutra architecture guardrails');
console.log('-----------------------------');
console.log(`  files scanned:  ${SCAN_FILES.length}`);
console.log(`  excluded paths: ${discovery.excluded.length}`);
console.log(`  known globals:  ${known.size}`);
console.log('');

if (notes.length) {
  console.log('Notes (non-fatal):');
  notes.forEach(n => console.log(' - ' + n));
  console.log('');
}

if (failures.length) {
  console.error(`FAILED (${failures.length} guardrail violation${failures.length === 1 ? '' : 's'}):`);
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}

console.log('Architecture guardrails passed.');
