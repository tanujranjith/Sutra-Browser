import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

test('Recovery exposes Done for Timeline blocks without offering bulk rescheduling', () => {
  const markDone = extractFunction(appSource, 'recoveryCanMarkDone');
  const reschedule = extractFunction(appSource, 'recoveryCanReschedule');
  const recovery = extractFunction(appSource, 'openOverdueRecovery');

  assert.ok(markDone && reschedule && recovery, 'Recovery completion helpers exist');
  assert.match(markDone.body, /item\.source === 'timeline'/);
  assert.doesNotMatch(reschedule.body, /timeline/);
  assert.match(recovery.body, /const canMarkDone = recoveryCanMarkDone\(i\)/);
  assert.match(recovery.body, /\$\{canMarkDone \? `<button[^`]*data-recover-done=/);
});

test('completed Timeline blocks leave deadline and overdue calculations but remain stored', () => {
  const collector = extractFunction(appSource, 'collectWorkspaceDeadlines');
  const mutate = extractFunction(appSource, 'mutateDeadlineRecord');

  assert.ok(collector && mutate, 'deadline collection and Recovery mutation exist');
  assert.match(collector.body, /if \(block\.completed === true\) return;/);
  assert.match(mutate.body, /item\.source === 'timeline'/);
  assert.match(mutate.body, /row\.completed = true/);
  assert.match(mutate.body, /saveTimeBlocks/);
});
