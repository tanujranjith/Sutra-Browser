import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
globalThis.SutraMastery = require('../../src/domain/mastery.js');
const learning = require('../../src/domain/learning-engine.js');

test('confidence checks separate prediction from reveal and compute calibration', () => {
  const started = learning.startConfidenceCheck({ masteryRecords: [], confidenceObservations: [] }, { id: 'p1', key: 'chem:atoms', confidence: 0.9 }, { now: '2026-07-10T10:00:00Z' });
  assert.equal(started.observation.correctness, null);
  const resolved = learning.resolveConfidenceCheck(started.workspace, 'p1', { correct: false }, { now: '2026-07-10T10:01:00Z' });
  assert.equal(resolved.observation.correctness, 0);
  assert.equal(resolved.workspace.masteryRecords.length, 1);
  const calibration = learning.getCalibration(resolved.workspace);
  assert.equal(calibration.samples, 1);
  assert.equal(calibration.tendency, 'overconfident');
  assert.equal(calibration.brierScore, 0.81);
});

test('reviewed mistakes create a cited correction card and follow-up task once', () => {
  const workspace = { reviewWorkspace: { decks: [], items: [], sessions: [], settings: {} }, tasks: [], taskDependencies: [] };
  const first = learning.createCorrectionFromMistake(workspace, { id: 'm1', courseName: 'Biology', question: 'What powers the cell?', correctAnswer: 'ATP', category: 'Content gap' }, { now: '2026-07-10T10:00:00Z' });
  assert.equal(first.card.sourceCitation.id, 'm1');
  assert.equal(first.workspace.reviewWorkspace.decks.length, 1);
  assert.equal(first.workspace.tasks.length, 1);
  const duplicate = learning.createCorrectionFromMistake(first.workspace, { id: 'm1', question: 'Same', correctAnswer: 'ATP' });
  assert.equal(duplicate.receipt.changedIds.length, 0);
  assert.match(duplicate.receipt.warnings[0], /already exists/);
});

test('readiness is transparent and final-72 plan protects sleep', () => {
  const workspace = {
    masteryRecords: [{ key: 'bio:cells', score: 0.5, attempts: 2, lastObservedAt: '2026-07-09T10:00:00Z' }],
    testingHub: { mistakes: [] }
  };
  const exam = { id: 'bio', courseId: 'bio', examDate: '2026-07-12T09:00:00Z', practiceTests: [{ percent: 70, completedAt: '2026-07-09T12:00:00Z' }], mistakes: [{ id: 'm1', examId: 'bio', title: 'Cell membrane', resolved: false }] };
  const readiness = learning.computeReadiness(workspace, exam, { now: '2026-07-10T09:00:00Z' });
  assert.equal(readiness.daysUntil, 2);
  assert.ok(readiness.components.mastery >= 0);
  assert.equal(readiness.unresolvedMistakes.length, 1);
  const plan = learning.buildFinal72Plan(workspace, exam, { now: '2026-07-10T09:00:00Z', protectedSleepHours: 8 });
  assert.equal(plan.eligible, true);
  assert.equal(plan.reviewRequired, true);
  assert.equal(plan.protectedSleepHours, 8);
  assert.ok(plan.blocks.some((block) => block.kind === 'mistake_review'));
});
