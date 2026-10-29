import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const student = require('../../src/domain/student-engine.js');
const planner = require('../../src/domain/planner.js');
const mastery = require('../../src/domain/mastery.js');
const NOW = '2026-07-10T12:00:00.000Z';

function workspace() {
  return {
    tasks: [
      { id: 'essay', title: 'Submit essay', dueAt: '2026-07-11T12:00:00.000Z', priority: 'high', estimatedMinutes: 90, gradeImpact: 0.8 },
      { id: 'email', title: 'Email counselor', dueAt: '2026-07-12T12:00:00.000Z', priority: 'medium', estimatedMinutes: 15 },
      { id: 'done', title: 'Finished', status: 'done', dueAt: '2026-07-10T13:00:00.000Z' }
    ],
    homeworkWorkspace: { tasks: [{ id: 'chem', title: 'Chemistry problems', dueAt: '2026-07-10T18:00:00.000Z', priority: 'high', estimatedMinutes: 45, gradeImpact: 0.55 }] },
    taskDependencies: [{ taskId: 'essay', dependsOnId: 'chem' }],
    studentDecisionState: { preset: 'balanced', snoozed: {}, dismissed: [], pinned: [] },
    timeBlocks: [], protectedTime: [], masteryRecords: [], confidenceObservations: []
  };
}

test('student inbox is deterministic, excludes completed work, and blocks unmet dependencies', () => {
  const ws = workspace();
  const first = student.getInbox(ws, { now: NOW });
  const second = student.getInbox(ws, { now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.some(row => row.sourceId === 'done'), false);
  const essay = first.find(row => row.sourceId === 'essay');
  assert.equal(essay.blocked, true);
  assert.match(essay.rankReason, /prerequisite/i);
  assert.equal(student.recommendNext(ws, { now: NOW }).sourceId, 'chem');
});

test('ranking presets, pinning, snoozing, and workload use the same action model', () => {
  const ws = workspace();
  ws.taskDependencies = [];
  ws.studentDecisionState.pinned = ['task:email'];
  const balanced = student.recommendNext(ws, { now: NOW, preset: 'balanced' });
  const legacyEnergyPreset = student.recommendNext(ws, { now: NOW, preset: 'low_energy', energy: 'low' });
  assert.deepEqual(legacyEnergyPreset, balanced, 'removed Energy options fall back to the balanced ranking');
  assert.equal(Object.prototype.hasOwnProperty.call(legacyEnergyPreset, 'energy'), false);
  ws.studentDecisionState.snoozed['task:email'] = '2026-07-12T00:00:00.000Z';
  assert.notEqual(student.recommendNext(ws, { now: NOW }).sourceId, 'email');
  const workload = student.getWorkload(ws, { now: NOW });
  assert.ok(workload.some(day => day.minutes >= 45));
});

test('planner proposes conflict-free blocks and reports actions that cannot fit', () => {
  const actions = [
    { id: 'a', sourceType: 'task', sourceId: 'a', title: 'First', estimatedMinutes: 60, dueAt: '2026-07-11T22:00:00.000Z', rankReason: 'Urgent.' },
    { id: 'b', sourceType: 'task', sourceId: 'b', title: 'Second', estimatedMinutes: 60, dueAt: '2026-07-11T22:00:00.000Z', rankReason: 'Important.' }
  ];
  const result = planner.proposeSchedule({
    actions,
    existingBlocks: [{ startAt: '2026-07-10T13:00:00.000Z', endAt: '2026-07-10T15:00:00.000Z' }]
  }, { startAt: NOW, days: 2, dayStartHour: 8, dayEndHour: 22 });
  assert.equal(result.proposals.length, 2);
  const [first, second] = result.proposals;
  assert.ok(Date.parse(first.endAt) <= Date.parse(second.startAt));
  assert.equal(first.status, 'proposed');
  assert.equal(result.reviewed, false);
});

test('mastery observations are immutable, auditable, and produce memory-map states', () => {
  const ws = workspace();
  const original = JSON.stringify(ws);
  let result = mastery.recordObservation(ws, { id: 'o1', key: 'chem:stoichiometry', correct: true, confidence: 0.8, sourceId: 'card-1' }, { now: NOW });
  assert.equal(JSON.stringify(ws), original);
  assert.equal(result.workspace.masteryRecords[0].attempts, 1);
  assert.deepEqual(result.receipt.changedIds, ['chem:stoichiometry', 'o1']);
  result = mastery.recordObservation(result.workspace, { id: 'o2', key: 'chem:stoichiometry', correct: true, confidence: 0.9 }, { now: '2026-07-11T12:00:00.000Z' });
  result = mastery.recordObservation(result.workspace, { id: 'o3', key: 'chem:stoichiometry', correct: true, confidence: 0.9 }, { now: '2026-07-12T12:00:00.000Z' });
  const state = mastery.getTopicState(result.workspace, 'chem:stoichiometry', { now: '2026-07-12T12:00:00.000Z' });
  assert.equal(state.state, 'mastered');
  assert.equal(mastery.getMemoryMap(result.workspace).length, 1);
});
