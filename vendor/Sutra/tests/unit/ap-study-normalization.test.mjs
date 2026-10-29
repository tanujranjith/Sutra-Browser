import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadNormalizer() {
  const source = readFileSync(new URL('../../src/features/study/ap-study.js', import.meta.url), 'utf8');
  const context = { window: {}, console, Date, Math, Set, Map };
  vm.runInNewContext(source, context, { filename: 'ap-study.js' });
  return context.window.normalizeApStudyWorkspace;
}

test('AP Study preserves explicitly unassigned topics', () => {
  const normalize = loadNormalizer();
  const workspace = normalize({
    subjects: [{ id: 'bio', name: 'AP Biology' }],
    units: [],
    topics: [{ id: 'cell-signals', subjectId: 'bio', unitId: null, title: 'Cell signaling', confidenceLevel: 2 }],
    sessions: [], practiceLogs: [], activity: []
  });
  assert.equal(workspace.topics.length, 1);
  assert.equal(workspace.topics[0].subjectId, 'bio');
  assert.equal(workspace.topics[0].unitId, null);
  assert.equal(workspace.topics[0].title, 'Cell signaling');
});

test('AP Study still rejects topics whose subject and unit are both missing', () => {
  const normalize = loadNormalizer();
  const workspace = normalize({
    subjects: [{ id: 'bio', name: 'AP Biology' }],
    units: [],
    topics: [{ id: 'orphan', subjectId: 'missing', unitId: null, title: 'Orphan' }]
  });
  assert.equal(workspace.topics.length, 0);
});
