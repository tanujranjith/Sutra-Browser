import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scanWindowGlobals } from '../../scripts/lib/guardrail-scan.mjs';

const baseline = JSON.parse(readFileSync(new URL('../../scripts/guardrail-baseline.json', import.meta.url), 'utf8'));
const workbench = readFileSync(new URL('../../src/features/workspace/canvas-workbench.js', import.meta.url), 'utf8');

test('SutraCanvasWorkbench is registered through a form the guardrail inventory can see', () => {
  assert.ok(
    workbench.includes('globalThis.SutraCanvasWorkbench = api;'),
    'registration uses the supported globalThis alias form'
  );
  const collected = scanWindowGlobals(workbench);
  assert.ok(collected.has('SutraCanvasWorkbench'), 'the guardrail scan collects the global from the source');
});

test('SutraCanvasWorkbench is ratcheted into the guardrail baseline', () => {
  const known = baseline.knownGlobals || [];
  assert.ok(known.includes('SutraCanvasWorkbench'), 'baseline knownGlobals registers the global');
});

test('canvas-workbench.js is inventoried for sink and storage budgets, not scanned blindly', () => {
  assert.equal(baseline.sinkBudgets['src/features/workspace/canvas-workbench.js'], 0);
  assert.equal(baseline.storageBudgets['src/features/workspace/canvas-workbench.js'], 0);
  assert.ok(Array.isArray(baseline.sinkFindings['src/features/workspace/canvas-workbench.js']));
  assert.ok(Array.isArray(baseline.storageFindings['src/features/workspace/canvas-workbench.js']));
});
