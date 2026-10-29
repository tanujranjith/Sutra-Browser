import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const canonical = require('../../src/domain/homework-store.js');
const legacyReader = require('../../src/compat/legacy-homework.js');
const NOW = '2026-07-09T12:00:00.000Z';

function memoryStorage(values = {}) {
  return { getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; } };
}

test('legacy-only homework migrates with IDs, metadata, and relationships intact', () => {
  const legacy = legacyReader.readSnapshot(memoryStorage({
    'homeworkCourses:v1': JSON.stringify([{ id: 'chem', name: 'Chemistry', type: 'class', color: '#abc' }]),
    'homeworkTasks:v1': JSON.stringify([{ id: 'lab-1', title: 'Lab report', courseId: 'chem', dueDate: '2026-07-12', done: true, recurrence: 'weekly', notes: 'Keep', sourceUrl: 'https://school.example/lab', custom: { rubric: 5 } }])
  }));
  const migrated = canonical.mergeLegacy({}, legacy, { now: NOW });
  assert.equal(migrated.courses[0].id, 'chem');
  assert.equal(migrated.courses[0].color, '#abc');
  assert.equal(migrated.tasks[0].id, 'lab-1');
  assert.equal(migrated.tasks[0].courseId, 'chem');
  assert.equal(migrated.tasks[0].done, true);
  assert.equal(migrated.tasks[0].recurrence, 'weekly');
  assert.deepEqual(migrated.tasks[0].custom, { rubric: 5 });
  assert.equal(migrated.migrations.legacyHomework.status, 'complete');
});

test('workspace-only homework is normalized without needing legacy input', () => {
  const migrated = canonical.mergeLegacy({
    revision: 7,
    courses: [{ id: 'math', name: 'Math' }],
    tasks: [{ id: 'p1', title: 'Problems', courseId: 'math', dueDate: '2026-07-15' }]
  }, {}, { now: NOW });
  assert.equal(migrated.courses.length, 1);
  assert.equal(migrated.tasks.length, 1);
  assert.equal(migrated.tasks[0].courseId, 'math');
});

test('overlapping stores deduplicate stable IDs while preserving canonical IDs', () => {
  const primary = {
    courses: [{ id: 'canonical-course', name: 'Biology', updatedAt: '2026-07-01T00:00:00Z' }],
    tasks: [{ id: 'canonical-task', title: 'Read chapter 4', courseId: 'canonical-course', dueDate: '2026-07-20', notes: 'primary', updatedAt: '2026-07-01T00:00:00Z' }]
  };
  const legacy = {
    courses: [{ id: 'canonical-course', name: 'Biology', updatedAt: '2026-07-02T00:00:00Z' }],
    tasks: [{ id: 'canonical-task', title: 'Read chapter 4', courseId: 'canonical-course', dueDate: '2026-07-20', notes: 'newer legacy detail', updatedAt: '2026-07-02T00:00:00Z' }]
  };
  const merged = canonical.mergeLegacy(primary, legacy, { now: NOW });
  assert.equal(merged.courses.length, 1);
  assert.equal(merged.courses[0].id, 'canonical-course');
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].id, 'canonical-task');
  assert.equal(merged.tasks[0].courseId, 'canonical-course');
  assert.equal(merged.tasks[0].notes, 'newer legacy detail');
});

test('same-looking courses and tasks with different IDs remain distinct', () => {
  const normalized = canonical.normalizeWorkspace({
    courses: [
      { id: 'bio-fall', name: 'Biology' },
      { id: 'bio-spring', name: 'Biology' }
    ],
    tasks: [
      { id: 'worksheet-a', title: 'Chapter questions', courseId: 'bio-fall', dueDate: '2026-07-20' },
      { id: 'worksheet-b', title: 'Chapter questions', courseId: 'bio-fall', dueDate: '2026-07-20' }
    ]
  }, { now: NOW });
  assert.deepEqual(normalized.courses.map((item) => item.id), ['bio-fall', 'bio-spring']);
  assert.deepEqual(normalized.tasks.map((item) => item.id), ['worksheet-a', 'worksheet-b']);

  const ambiguous = canonical.normalizeWorkspace({
    courses: normalized.courses,
    tasks: [{ id: 'unassigned', title: 'Lab', courseName: 'Biology' }]
  }, { now: NOW });
  assert.equal(ambiguous.tasks[0].courseId, '');
});

test('task normalization preserves unknown cross-feature fields', () => {
  const custom = { plugin: 'future', nested: { rubric: 5 }, flags: ['keep'] };
  const normalized = canonical.normalizeWorkspace({
    courses: [{ id: 'chem', name: 'Chemistry' }],
    tasks: [{ id: 'lab', title: 'Lab', courseId: 'chem', custom }]
  }, { now: NOW });
  assert.deepEqual(normalized.tasks[0].custom, custom);
});

test('malformed legacy JSON is quarantined instead of silently discarded', () => {
  const snapshot = legacyReader.readSnapshot(memoryStorage({
    'hwCourses:v2': '{broken',
    'hwTasks:v2': JSON.stringify({ not: 'an array' })
  }));
  assert.equal(snapshot.courses.length, 0);
  assert.equal(snapshot.tasks.length, 0);
  assert.deepEqual(snapshot.quarantine.map((item) => item.reason).sort(), ['expected-array', 'malformed-json']);
});

test('interrupted and repeated migrations are idempotent', () => {
  const interrupted = { courses: [{ id: 'a', name: 'Algebra' }], tasks: [], migrations: { legacyHomework: { status: 'started' } } };
  const legacy = { courses: [{ id: 'a', name: 'Algebra' }], tasks: [{ id: 'x', title: 'Worksheet', courseId: 'a' }] };
  const completed = canonical.mergeLegacy(interrupted, legacy, { now: NOW });
  const repeated = canonical.mergeLegacy(completed, { courses: [{ id: 'new', name: 'Should not reimport' }], tasks: [] }, { now: '2026-07-10T00:00:00.000Z' });
  assert.equal(completed.courses.length, 1);
  assert.equal(completed.tasks.length, 1);
  assert.deepEqual(repeated, completed);
});

test('course and assignments commit as one transaction and rollback on persistence failure', () => {
  const store = canonical.createStore({});
  let persisted = { courses: [], tasks: [] };
  let fail = false;
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: (reason) => { if (fail && reason !== 'homework-migration') throw new Error('disk full'); }
  });
  store.transact((workspace) => {
    workspace.courses.push({ id: 'c', name: 'Calculus' });
    workspace.tasks.push({ id: 't', title: 'Limits', courseId: 'c' });
  }, { reason: 'batch' });
  assert.equal(persisted.courses.length, 1);
  assert.equal(persisted.tasks[0].courseId, 'c');
  const before = store.getSnapshot();
  fail = true;
  assert.throws(() => store.transact((workspace) => workspace.tasks.push({ id: 'bad', title: 'Lost' }), { reason: 'fail' }), /disk full/);
  assert.deepEqual(store.getSnapshot(), before);
  assert.deepEqual(persisted, before);
});

test('removeCourse atomically removes its lane and returns recoverable assignments', () => {
  const store = canonical.createStore({
    courses: [{ id: 'remove-me', name: 'Biology' }, { id: 'keep-me', name: 'History' }],
    tasks: [
      { id: 'bio-task', title: 'Lab report', courseId: 'remove-me' },
      { id: 'history-task', title: 'Reading', courseId: 'keep-me' }
    ]
  });
  let persisted = store.getSnapshot();
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: () => undefined
  });

  const receipt = store.removeCourse('remove-me', { reason: 'homework-course-remove' });
  assert.equal(receipt.result.removed, true);
  assert.equal(receipt.result.course.id, 'remove-me');
  assert.deepEqual(receipt.result.tasks.map((task) => task.id), ['bio-task']);
  assert.deepEqual(store.getSnapshot().courses.map((course) => course.id), ['keep-me']);
  assert.deepEqual(store.getSnapshot().tasks.map((task) => task.id), ['history-task']);
  assert.deepEqual(persisted.tasks.map((task) => task.id), ['history-task']);

  const missing = store.removeCourse('missing-course');
  assert.equal(missing.result.removed, false);
  assert.deepEqual(store.getSnapshot().courses.map((course) => course.id), ['keep-me']);
});

test('durable Homework mutations await the real persistence promise', async () => {
  const store = canonical.createStore({ courses: [{ id: 'c', name: 'Calculus' }], tasks: [] });
  let release;
  let persisted = store.getSnapshot();
  let completed = false;
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: (reason) => reason === 'homework-migration' ? undefined : new Promise((resolve) => { release = resolve; })
  });
  const pending = store.transactDurably((workspace) => {
    workspace.tasks.push({ id: 'limits', title: 'Limits', courseId: 'c' });
    return 'created';
  }, { reason: 'create-task' }).then((receipt) => { completed = true; return receipt; });

  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(typeof release, 'function');
  release();
  const receipt = await pending;
  assert.equal(receipt.result, 'created');
  assert.equal(receipt.workspace.tasks[0].id, 'limits');
  assert.equal(completed, true);
});

test('async persistence failure rolls back before the next queued mutation', async () => {
  const store = canonical.createStore({ courses: [{ id: 'c', name: 'Calculus' }], tasks: [] });
  let persisted = store.getSnapshot();
  let failNext = true;
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: (reason) => {
      if (reason === 'homework-migration') return undefined;
      if (failNext) { failNext = false; return Promise.reject(new Error('async disk full')); }
      return Promise.resolve();
    }
  });
  const failed = store.transactDurably((workspace) => {
    workspace.tasks.push({ id: 'lost', title: 'Must roll back', courseId: 'c' });
  }, { reason: 'first' });
  const succeeded = store.transactDurably((workspace) => {
    workspace.tasks.push({ id: 'kept', title: 'Keep me', courseId: 'c' });
  }, { reason: 'second' });

  await assert.rejects(failed, /async disk full/);
  await succeeded;
  assert.deepEqual(store.getSnapshot().tasks.map((task) => task.id), ['kept']);
  assert.deepEqual(persisted.tasks.map((task) => task.id), ['kept']);
});

test('a failed durable save never rolls back a newer scheduled mutation', async () => {
  const store = canonical.createStore({ courses: [{ id: 'c', name: 'Calculus' }], tasks: [] });
  let persisted = store.getSnapshot();
  let rejectDurable;
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: (reason) => {
      if (reason === 'durable-first') return new Promise((resolve, reject) => { rejectDurable = reject; });
      return Promise.resolve();
    }
  });

  const failed = store.transactDurably((workspace) => {
    workspace.tasks.push({ id: 'first', title: 'Durable first', courseId: 'c' });
  }, { reason: 'durable-first' });
  await Promise.resolve();
  assert.equal(typeof rejectDurable, 'function');

  store.transact((workspace) => {
    workspace.tasks.push({ id: 'later', title: 'Later UI change', courseId: 'c' });
  }, { reason: 'scheduled-later' });
  rejectDurable(new Error('first save failed'));
  await assert.rejects(failed, /first save failed/);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(store.getSnapshot().tasks.map((task) => task.id), ['first', 'later']);
  assert.deepEqual(persisted.tasks.map((task) => task.id), ['first', 'later']);
});

test('scheduled persistence observes adapter rejections without rolling back accepted mutations', async () => {
  const store = canonical.createStore({ courses: [], tasks: [] });
  let persisted = store.getSnapshot();
  let sawPromise = false;
  store.configure({
    getWorkspace: () => persisted,
    setWorkspace: (next) => { persisted = next; },
    readLegacy: () => ({ courses: [], tasks: [] }),
    persist: () => {
      sawPromise = true;
      // A durable-contract adapter returns a real promise even for scheduled
      // callers; the store must observe rejection instead of letting it become
      // an unhandled rejection (failures stay visible through persistence
      // health), while the already-accepted mutation stays committed.
      return Promise.reject(new Error('async disk full'));
    }
  });
  assert.equal(sawPromise, true);
  // configure() schedules its own migration persist through the same path.
  await new Promise((resolve) => setImmediate(resolve));
  store.transact((workspace) => {
    workspace.tasks.push({ id: 'kept', title: 'Scheduled', courseId: '' });
  }, { reason: 'batch' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().tasks[0].id, 'kept');
  assert.equal(persisted.tasks[0].id, 'kept');
});

test('normalization rejects unsafe URLs, repairs duplicate IDs, and records orphans', () => {
  const workspace = canonical.normalizeWorkspace({
    courses: [{ id: 'same', name: 'A' }, { id: 'same', name: 'A duplicate' }],
    tasks: [
      { id: 'dup', title: 'One', courseId: 'missing', sourceUrl: 'javascript:alert(1)' },
      { id: 'dup', title: 'Two', courseId: 'same' }
    ]
  }, { now: NOW });
  assert.equal(new Set(workspace.tasks.map((item) => item.id)).size, workspace.tasks.length);
  assert.equal(workspace.tasks[0].sourceUrl, '');
  assert.equal(workspace.tasks[0].orphanedCourseId, 'missing');
});
