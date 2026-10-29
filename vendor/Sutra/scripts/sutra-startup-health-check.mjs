#!/usr/bin/env node
/*
 * sutra-startup-health-check.mjs — static guard for the runtime startup health
 * layer (src/core/startup-health.js + its wiring).
 *
 * The startup health layer is a SAFETY surface: it must keep the strict
 * properties the rest of the core safety layer holds (no telemetry, no network,
 * no storage writes, no unsafe DOM sink, never blocks normal use) and it must
 * stay WIRED so a future refactor can't silently drop it. This check fails CI if
 * any of those guarantees regress. It runs structural text assertions; the
 * behavior is exercised by tests/e2e/startup-health.spec.mjs.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rel = (p) => resolve(repoRoot, p);

const MODULE = 'src/core/startup-health.js';
const failures = [];
const passes = [];

function read(file) {
  try { return readFileSync(rel(file), 'utf8'); } catch (err) { failures.push(`cannot read ${file}: ${err.message}`); return ''; }
}
function ok(label) { passes.push(label); }
function must(cond, label) { if (cond) ok(label); else failures.push(label); }

const src = read(MODULE);
const html = read('Sutra.html');
const baseline = (() => { try { return JSON.parse(read('scripts/guardrail-baseline.json')); } catch { return {}; } })();

// 1) Public surface present and testable.
must(/window\.SutraStartupHealth\s*=/.test(src), 'exposes window.SutraStartupHealth');
['run', 'renderRecovery', 'dismissRecovery', 'isRecoveryVisible', 'getReport', 'listChecks'].forEach((m) => {
  must(new RegExp('\\b' + m + '\\b\\s*:').test(src), `public API exposes ${m}()`);
});

// 2) It distinguishes critical (recover) from warning (record only).
must(/severity:\s*'critical'/.test(src), 'has critical-severity checks');
must(/severity:\s*'warning'/.test(src), 'has warning-severity checks');
must(/criticalCount/.test(src), 'reports a critical count');

// 3) The critical detectors cover the real boot subsystems.
[
  ['saveWorkspaceLocally', 'detects missing workspace save runtime'],
  ['serializeWorkspace', 'detects missing serialize runtime'],
  ['SutraSafeStorage', 'detects missing safe-storage wrapper'],
  ['SutraPersistenceHealth', 'detects missing persistence pipeline'],
  ['app-container', 'detects missing application shell DOM']
].forEach(([needle, label]) => must(src.includes(needle), label));

// 4) Recovery affordances are the data-safety actions (not "file an issue").
must(/location\.reload/.test(src), 'recovery offers Reload');
must(/sutraSafeMode/.test(src), 'recovery offers Safe Mode');
must(/exportEmergencyBackup|exportWorkspaceAsAtelier/.test(src), 'recovery offers an emergency export path');
must(/Dismiss/.test(src), 'recovery is dismissible (never traps the user)');

// 5) Safety invariants: no telemetry / network / storage / unsafe DOM sink.
must(!/\bfetch\s*\(/.test(src), 'no network: no fetch()');
must(!/XMLHttpRequest|navigator\.sendBeacon|new WebSocket/.test(src), 'no network: no XHR/beacon/WebSocket');
must(!/localStorage\.setItem|sessionStorage\.setItem/.test(src), 'no direct storage writes');
must(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), 'no unsafe DOM sink (createElement/textContent only)');
must(/createElement/.test(src) && /textContent/.test(src), 'builds UI with createElement + textContent');

// 6) False-alarm resistance: a watchdog plus confirmation rechecks.
must(/WATCHDOG_MS/.test(src) && /setTimeout/.test(src), 'arms a boot watchdog (does not fire instantly)');
must(/RECHECK|MAX_RECHECKS|attempt/.test(src), 'confirms a failure with rechecks before alarming');
must(/never throw/i.test(src) || /catch \(e\)/.test(src), 'guards against throwing out of the health layer');

// 7) Wiring: loaded early in Sutra.html (head safety layer, before app.js) with cache-bust.
const healthIdx = html.indexOf('src/core/startup-health.js');
const appIdx = html.indexOf('src/core/app.js');
must(healthIdx !== -1, 'Sutra.html includes startup-health.js');
must(/src\/core\/startup-health\.js\?v=/.test(html), 'startup-health.js carries a ?v= cache-bust');
must(healthIdx !== -1 && appIdx !== -1 && healthIdx < appIdx, 'startup-health.js loads before app.js');

// 8) Registered as a known global so guardrails accept it.
must(Array.isArray(baseline.knownGlobals) && baseline.knownGlobals.includes('SutraStartupHealth'),
  'SutraStartupHealth registered in guardrail known-globals');

// --- report -----------------------------------------------------------------
console.log('Startup health layer check');
console.log('--------------------------');
for (const p of passes) console.log(`  ok   ${p}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`\nStartup health check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`\nStartup health check passed — recovery layer present, safe, and wired (${passes.length} assertions).`);
