#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkCoreRuntime, checkCoreRuntimeSource } from './lib/core-runtime-integrity.mjs';

const sourcePath = resolve('src/core/app.js');
const source = readFileSync(sourcePath, 'utf8');
const tempRoot = mkdtempSync(join(tmpdir(), 'sutra-runtime-check-'));
const failures = [];

function expectRejected(name, mutate, expectedFailure) {
  const path = join(tempRoot, `${name}.js`);
  const mutated = mutate(source);
  if (mutated === source) {
    failures.push(`${name}: mutation did not change the fixture`);
    return;
  }
  writeFileSync(path, mutated, 'utf8');
  const result = checkCoreRuntime({ appPath: path });
  if (result.ok) failures.push(`${name}: corrupted fixture was accepted`);
  if (!result.failures.some((item) => expectedFailure.test(item))) {
    failures.push(`${name}: expected failure ${expectedFailure}, got ${result.failures.join(' | ')}`);
  }
}

try {
  const baseline = checkCoreRuntime({ appPath: sourcePath });
  if (!baseline.ok) failures.push(`baseline failed: ${baseline.failures.join(' | ')}`);

  expectRejected(
    'syntax-corruption',
    (text) => text.replace('const orderedTopLevelPages = [', 'const orderedTopLevelPages = [)'),
    /parser rejected/
  );
  expectRejected(
    'cross-section-splice',
    (text) => text.replace(
      "if (page.theme && page.theme !== 'default') {",
      "if (page.theme && page.theme !== 'default') {\n             \"g readable from script. Opt-in only"
    ),
    /parser rejected/
  );
  expectRejected(
    'truncation',
    (text) => text.slice(0, Math.floor(text.length * 0.7)),
    /parser rejected|is missing/
  );
  expectRejected(
    'missing-persistence',
    (text) => text.replace('function serializeWorkspace(', 'function serializeWorkspaceRemoved('),
    /workspace serializer is missing/
  );
  expectRejected(
    'missing-sync-bridge',
    (text) => text.replace('window.SutraSync = {', 'window.SutraSyncRemoved = {'),
    /Sync public bridge is missing/
  );
  expectRejected(
    'comment-cannot-spoof-contract',
    (text) => text.replace(
      'function serializeWorkspace(',
      '// function serializeWorkspace(\n        function serializeWorkspaceRemoved('
    ),
    /workspace serializer is missing/
  );

  // Budget ratchet: growth past the blessed budget must fail even when the
  // source stays syntactically valid and every fragment remains present.
  try {
    const baseline = checkCoreRuntime({ appPath: sourcePath });
    if (!baseline.ok) throw new Error('baseline unexpectedly failing');
    const bloated = `${source}\n// padding line to exceed the blessed budget\n`;
    const grown = checkCoreRuntimeSource(bloated, {
      bytes: baseline.bytes + 64,
      budget: { ok: true, maxBytes: baseline.bytes, maxLines: baseline.lines }
    });
    if (grown.ok) failures.push('budget-growth: growth past the blessed budget was accepted');
    if (!grown.failures.some((item) => /grew past the blessed/.test(item))) {
      failures.push(`budget-growth: expected budget failure, got ${grown.failures.join(' | ')}`);
    }
    // Decomposition (shrink) must be rewarded with a pass, never punished.
    const shrunk = checkCoreRuntimeSource(source, {
      bytes: Math.max(1, baseline.bytes - 1024),
      lines: Math.max(1, baseline.lines - 10),
      budget: { ok: true, maxBytes: baseline.bytes, maxLines: baseline.lines },
      readLabel: 'read shrunk fixture'
    });
    if (!shrunk.ok) failures.push(`budget-shrink: decomposition-sized runtime failed: ${shrunk.failures.join(' | ')}`);

    const unexplainedBudgetPath = join(tempRoot, 'unexplained-budget.json');
    writeFileSync(unexplainedBudgetPath, JSON.stringify({ maxBytes: baseline.bytes, maxLines: baseline.lines }), 'utf8');
    const unexplained = checkCoreRuntimeSource(source, {
      repoRoot: tempRoot,
      budgetPath: 'unexplained-budget.json',
      bytes: baseline.bytes
    });
    if (!unexplained.failures.some((item) => /non-empty reviewedReason/.test(item))) {
      failures.push(`budget-evidence: unexplained ceiling was accepted: ${unexplained.failures.join(' | ')}`);
    }
  } catch (error) {
    failures.push(`budget ratchet self-test error: ${error.message}`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (failures.length) {
  failures.forEach((failure) => console.error(`  FAIL ${failure}`));
  console.error(`Core runtime integrity self-test FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}

console.log('Core runtime integrity self-test passed — syntax, persistence, and Sync corruption were rejected.');
