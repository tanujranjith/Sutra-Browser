import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const homework = require('../../src/domain/homework-store.js');
const migrations = require('../../src/core/migrations.js');
const actions = require('../../src/features/assistant/action-system.js');

function random(seed = 0x51a7cafe) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = (rng, values) => values[Math.floor(rng() * values.length)];

test('deterministic malformed partial workspaces normalize without data-loss exceptions', () => {
  const rng = random();
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const value = pick(rng, [null, false, 0, '', {}, [], { nested: true }]);
    const source = {
      revision: Math.floor(rng() * 100),
      courses: pick(rng, [value, [{ id: `c${iteration % 7}`, name: `Course ${iteration % 11}`, future: { keep: iteration } }]]),
      tasks: pick(rng, [value, [{
        id: `t${iteration % 13}`,
        title: `Task ${iteration % 17}`,
        courseId: `c${iteration % 7}`,
        dueDate: pick(rng, ['2026-02-29', '9999-12-31', '-0001-01-01', {}, null]),
        recurrence: pick(rng, ['weekly', 'not-a-rule', null, { recursive: false }]),
        sourceUrl: pick(rng, ['https://school.example/a', 'javascript:alert(1)', 'data:text/html,boom', 'file:///secret'])
      }]])
    };
    const normalized = homework.normalizeWorkspace(source, { now: '2026-07-09T00:00:00.000Z' });
    assert.ok(Array.isArray(normalized.courses));
    assert.ok(Array.isArray(normalized.tasks));
    assert.doesNotThrow(() => JSON.stringify(normalized));
    for (const task of normalized.tasks) {
      assert.equal(/^\s*(?:javascript|data|file):/i.test(task.sourceUrl || ''), false);
      assert.equal(typeof task.dueDate, 'string');
    }
  }
});

test('duplicate IDs and semantic duplicates converge deterministically', () => {
  const tasks = Array.from({ length: 500 }, (_, index) => ({
    id: `task-${index % 5}`,
    title: `Repeated ${index % 3}`,
    courseId: `course-${index % 2}`,
    dueDate: `2026-07-${String(10 + (index % 2)).padStart(2, '0')}`,
    notes: `revision ${index}`
  }));
  const input = { courses: [{ id: 'course-0', name: 'A' }, { id: 'course-1', name: 'B' }], tasks };
  const first = homework.normalizeWorkspace(input, { now: '2026-07-09T00:00:00.000Z' });
  const second = homework.normalizeWorkspace(first, { now: '2026-07-09T00:00:00.000Z' });
  assert.deepEqual(second, first);
  assert.equal(new Set(first.tasks.map((item) => item.id)).size, first.tasks.length);
});

test('migration validation is bounded for recursive, unknown, and malformed inputs', () => {
  const recursive = { version: 1, pages: [] };
  recursive.pages.push(recursive);
  assert.throws(() => migrations.migrateWorkspace(recursive), /pre-migration validation/);

  const unknown = { version: 1, futurePlugin: { opaque: ['preserve', 7] }, pages: null, tasks: 'bad' };
  const migrated = migrations.migrateWorkspace(unknown, { now: '2026-07-09T00:00:00.000Z' }).workspace;
  assert.deepEqual(migrated.futurePlugin, unknown.futurePlugin);
  assert.equal(migrated.version, migrations.CURRENT_VERSION);
});

test('typed actions reject a deterministic corpus of malicious URLs and active content', () => {
  const type = 'property_safe_action';
  if (!actions.get(type)) actions.register({
    type,
    description: 'Property validation action',
    schema: {
      type: 'object', additionalProperties: false, required: ['type', 'title'],
      properties: {
        type: { type: 'string', enum: [type] },
        title: { type: 'string', minLength: 1, maxLength: 80, format: 'safe-content' },
        url: { type: 'string', format: 'url', maxLength: 2048 }
      }
    },
    permissions: [], affectedEntities: [], confirmation: 'never', persistence: { required: false },
    prepare: (action) => action, commit: () => ({ ok: true }), rollback: () => true, undo: () => true
  });
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', 'vbscript:msgbox(1)', '//evil.example/x']) {
    assert.equal(actions.validate({ type, title: 'safe', url }).ok, false, url);
  }
  for (const title of ['<script>alert(1)</script>', '<svg onload=alert(1)>', '<img src=x onerror=alert(1)>', 'expression(alert(1))']) {
    assert.equal(actions.validate({ type, title }).ok, false, title);
  }
  assert.equal(actions.validate({ type, title: 'safe', url: 'https://school.example/a' }).ok, true);
});

test('oversized and deeply nested payloads fail closed', () => {
  const tooDeep = { type: 'unknown' };
  let cursor = tooDeep;
  for (let depth = 0; depth < 100; depth += 1) cursor = cursor.child = {};
  assert.equal(actions.validate(tooDeep).ok, false);
  const huge = { type: 'property_safe_action', title: 'x'.repeat(300_000) };
  assert.equal(actions.validate(huge).ok, false);
});
