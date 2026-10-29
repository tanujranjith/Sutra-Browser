import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadStudio(store) {
  const source = readFileSync(new URL('../../src/features/academic/assignment-studio.js', import.meta.url), 'utf8');
  const window = {
    SutraHomeworkStore: store,
    addEventListener() {},
    dispatchEvent() {}
  };
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(source, { window, document, console, Date, Math, CustomEvent: class {} }, { filename: 'assignment-studio.js' });
  return window.SutraAssignmentStudio;
}

test('Assignment Studio mutates the latest canonical task inside one transaction', () => {
  const state = {
    courses: [],
    tasks: [{ id: 'essay', title: 'Essay', reminderState: { snoozedUntil: null } }]
  };
  let transactionCount = 0;
  const store = {
    getSnapshot: () => structuredClone(state),
    transact(mutator) {
      transactionCount += 1;
      // Simulate a concurrent reminder edit becoming canonical immediately
      // before Studio's targeted mutation runs.
      state.tasks[0].reminderState.snoozedUntil = '2026-07-14T15:00:00.000Z';
      mutator(state);
      return { workspace: structuredClone(state) };
    }
  };
  const studio = loadStudio(store);
  const added = studio.addMilestones('essay', [{ title: 'Outline', dueDate: '2026-07-14' }]);

  assert.equal(added, 1);
  assert.equal(transactionCount, 1);
  assert.equal(state.tasks[0].reminderState.snoozedUntil, '2026-07-14T15:00:00.000Z');
  assert.equal(state.tasks[0].studio.milestones[0].title, 'Outline');
});
