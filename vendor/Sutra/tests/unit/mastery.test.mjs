import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const mastery = require('../../src/domain/mastery.js');

test('recordObservation creates a new mastery record and confidence observation, keyed case/whitespace-insensitively', () => {
  const first = mastery.recordObservation({}, { key: '  Chem:Atoms ', correct: true, confidence: 0.9, courseId: 'chem', sourceId: 'q1' }, { now: '2026-07-10T10:00:00Z' });
  assert.equal(first.workspace.masteryRecords.length, 1);
  assert.equal(first.workspace.masteryRecords[0].key, 'chem:atoms');
  assert.equal(first.workspace.masteryRecords[0].attempts, 1);
  assert.equal(first.workspace.confidenceObservations.length, 1);
  assert.equal(first.workspace.confidenceObservations[0].courseId, 'chem');

  const second = mastery.recordObservation(first.workspace, { key: 'CHEM:ATOMS', correct: true, confidence: 0.8, courseId: 'chem' }, { now: '2026-07-11T10:00:00Z' });
  assert.equal(second.workspace.masteryRecords.length, 1, 'same topic key (case/whitespace-insensitive) updates the existing record');
  assert.equal(second.workspace.masteryRecords[0].attempts, 2);
});

test('recordObservation requires a topic key', () => {
  assert.throws(() => mastery.recordObservation({}, { correct: true }), /topic key/);
});

test('getTopicState classifies mastery by score and recency decay, defaulting unseen topics to unstudied', () => {
  const unseen = mastery.getTopicState({}, 'chem:atoms');
  assert.equal(unseen.state, 'unstudied');
  assert.equal(unseen.attempts, 0);

  let workspace = {};
  for (let i = 0; i < 3; i += 1) {
    workspace = mastery.recordObservation(workspace, { key: 'chem:atoms', correct: true, confidence: 0.9 }, { now: '2026-07-10T10:00:00Z' }).workspace;
  }
  const mastered = mastery.getTopicState(workspace, 'chem:atoms', { now: '2026-07-10T10:00:00Z' });
  assert.equal(mastered.state, 'mastered');

  const stale = mastery.getTopicState(workspace, 'chem:atoms', { now: '2026-10-18T10:00:00Z' });
  assert.equal(stale.state, 'forgotten', 'a mastered topic decays to forgotten after long inactivity');
});

test('getMemoryMap ranks topics weakest-first', () => {
  let workspace = mastery.recordObservation({}, { key: 'weak', correct: false, confidence: 0.9 }, { now: '2026-07-10T10:00:00Z' }).workspace;
  workspace = mastery.recordObservation(workspace, { key: 'strong', correct: true, confidence: 0.9 }, { now: '2026-07-10T10:00:00Z' }).workspace;
  const map = mastery.getMemoryMap(workspace, { now: '2026-07-10T10:00:00Z' });
  assert.deepEqual(map.map((item) => item.key), ['weak', 'strong']);
});
