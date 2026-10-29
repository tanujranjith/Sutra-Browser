import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const system = require('../../src/features/assistant/action-system.js');
let seq = 0;

function register(overrides = {}) {
  const type = overrides.type || `unit_action_${++seq}`;
  return system.register({
    type,
    description: 'Unit action',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'title'],
      properties: {
        type: { type: 'string', enum: [type] },
        title: { type: 'string', minLength: 1, maxLength: 40, format: 'safe-content' },
        url: { type: 'string', format: 'url', maxLength: 2048 },
        rows: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 20 } } } }
      }
    },
    permissions: ['workspace.write'],
    affectedEntities: ['tasks'],
    confirmation: 'writes',
    persistence: { required: true, strategy: 'workspace' },
    prepare: (action) => ({ action, before: 'snapshot' }),
    commit: (prepared, context) => context.commit(prepared.action),
    rollback: (receipt, context) => context.rollback(receipt),
    undo: (receipt, context) => context.undo(receipt),
    audit: (action) => ({ type: action.type, title: action.title }),
    ...overrides
  });
}

test('typed validation accepts valid payloads and rejects unknown actions and fields', () => {
  const def = register();
  assert.equal(system.validate({ type: def.type, title: 'Do work', rows: [{ name: 'one' }] }).ok, true);
  assert.match(system.validate({ type: 'unknown', title: 'x' }).error, /Unknown action/);
  assert.match(system.validate({ type: def.type, title: 'x', surprise: true }).error, /unknown field/);
});

test('schemas reject malformed nested data, duplicate-scale arrays, malicious URLs/HTML, and oversized payloads', () => {
  const def = register();
  assert.equal(system.validate({ type: def.type, title: 'x', rows: [{ wrong: 'x' }] }).ok, false);
  assert.equal(system.validate({ type: def.type, title: 'x', rows: [{ name: '1' }, { name: '2' }, { name: '3' }, { name: '4' }] }).ok, false);
  assert.equal(system.validate({ type: def.type, title: 'x', url: 'javascript:alert(1)' }).ok, false);
  assert.equal(system.validate({ type: def.type, title: '<img onerror=alert(1)>' }).ok, false);
  assert.match(system.validate({ type: def.type, title: 'x'.repeat(300000) }).error, /too large/);
});

test('permissions and destructive confirmation are mandatory', () => {
  const def = register({ destructive: true, confirmation: 'destructive', permissions: ['workspace.delete'] });
  const action = { type: def.type, title: 'Delete' };
  assert.equal(system.validate(action, { permissions: [] }).ok, false);
  const denied = system.executeSync(action, { permissions: ['workspace.delete'], commit: () => ({ ok: true }) });
  assert.equal(denied.code, 'confirmation_required');
  const allowed = system.executeSync(action, { confirmed: true, permissions: ['workspace.delete'], commit: () => ({ ok: true }), persist: () => {} });
  assert.equal(allowed.ok, true);
});

test('plans rollback committed actions in reverse order after a partial failure', async () => {
  const events = [];
  const a = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const b = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const c = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const result = await system.executePlan([
    { type: a.type, title: 'a' }, { type: b.type, title: 'b' }, { type: c.type, title: 'c' }
  ], {
    commit(action) { events.push('commit:' + action.title); return action.title === 'c' ? { ok: false, message: 'boom' } : { ok: true, id: action.title }; },
    rollback(receipt) { events.push('rollback:' + receipt.result.id); return true; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'rolled_back');
  assert.deepEqual(events, ['commit:a', 'commit:b', 'commit:c', 'rollback:b', 'rollback:a']);
  assert.deepEqual(result.outcomes.map((row) => row.status), ['rolled_back', 'rolled_back', 'failed']);
});

test('persistence failure rolls back the whole committed plan and reports exact outcomes', async () => {
  const rolledBack = [];
  const def = register({ confirmation: 'never', permissions: [] });
  const result = await system.executePlan([{ type: def.type, title: 'persist me' }], {
    commit: () => ({ ok: true, id: 'saved' }),
    persist: () => { throw new Error('disk full'); },
    rollback: (receipt) => { rolledBack.push(receipt.result.id); return true; }
  });
  assert.equal(result.code, 'rolled_back');
  assert.deepEqual(rolledBack, ['saved']);
  assert.equal(result.outcomes[0].status, 'rolled_back');
});

test('rollback failures are reported as partial outcomes', async () => {
  const def = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const result = await system.executePlan([{ type: def.type, title: 'one' }, { type: def.type, title: 'two' }], {
    commit(action) { return action.title === 'two' ? { ok: false, message: 'fail' } : { ok: true }; },
    rollback() { throw new Error('rollback failed'); }
  });
  assert.equal(result.code, 'partial_rollback');
  assert.equal(result.rollbackFailures.length, 1);
});

test('idempotency prevents repeated execution and undo uses definition metadata', async () => {
  let commits = 0;
  let undos = 0;
  const def = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const context = { idempotencyKey: 'same-request', commit: () => ({ ok: true, id: ++commits }), undo: () => ({ ok: true, count: ++undos }) };
  const first = system.executeSync({ type: def.type, title: 'once' }, context);
  const repeated = system.executeSync({ type: def.type, title: 'once' }, context);
  assert.equal(first.ok, true);
  assert.equal(repeated.repeated, true);
  assert.equal(commits, 1);
  const undone = await system.undo(first, context);
  assert.equal(undone.ok, true);
  assert.equal(undos, 1);
});

test('public plan API requires ordered dependencies and explicit reviewed apply', async () => {
  const events = [];
  const first = register({ confirmation: 'writes', permissions: [], affectedEntities: ['tasks'], preview: (action) => ({ label: `Create ${action.title}` }) });
  const second = register({ confirmation: 'writes', permissions: [], affectedEntities: ['timeBlocks'], preview: (action) => ({ label: `Schedule ${action.title}` }) });
  const invalid = system.previewPlan([
    { id: 'later', action: { type: second.type, title: 'Schedule' }, dependsOn: ['missing'] }
  ]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues[0], /earlier step/);

  const preview = system.previewPlan([
    { id: 'create', action: { type: first.type, title: 'Essay' } },
    { id: 'schedule', action: { type: second.type, title: 'Essay' }, dependsOn: ['create'] }
  ]);
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.affectedEntities, ['tasks', 'timeBlocks']);
  assert.equal((await system.applyPlan(preview, {})).code, 'review_required');

  const receipt = await system.applyPlan(preview, {
    reviewed: true,
    commit(action) { events.push(`commit:${action.title}`); return { ok: true, changedId: `${action.type}-id` }; },
    rollback(row) { events.push(`rollback:${row.result.changedId}`); return true; },
    persist() { events.push('persist'); }
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.changedIds.length, 2);
  assert.equal(receipt.persistence.status, 'persisted');
  const rolledBack = await system.rollbackPlan(receipt, {
    rollback(row) { events.push(`rollback:${row.result.changedId}`); return true; },
    persist() { events.push('persist-rollback'); }
  });
  assert.equal(rolledBack.ok, true);
  assert.deepEqual(rolledBack.outcomes.map((row) => row.status), ['rolled_back', 'rolled_back']);
});

test('reviewed plans are idempotent across retry and can run again only after confirmed rollback', async () => {
  let commits = 0;
  const def = register({ confirmation: 'never', permissions: [], persistence: { required: false } });
  const preview = system.previewPlan([{ id: 'once', action: { type: def.type, title: 'Only once' } }]);
  const context = {
    reviewed: true,
    commit: () => ({ ok: true, changedId: 'created-' + (++commits) }),
    rollback: () => true
  };
  const first = await system.applyPlan(preview, context);
  const retry = await system.applyPlan(preview, context);
  assert.equal(first.ok, true);
  assert.equal(retry.repeated, true);
  assert.equal(commits, 1);
  assert.equal((await system.rollbackPlan(first, context)).ok, true);
  const reapplied = await system.applyPlan(preview, context);
  assert.equal(reapplied.ok, true);
  assert.equal(reapplied.repeated, undefined);
  assert.equal(commits, 2);
});

test('applyPlan rejects a preview mutated after review', async () => {
  const def = register({ confirmation: 'never', permissions: [] });
  const preview = system.previewPlan([{ id: 'one', action: { type: def.type, title: 'Original' } }]);
  preview.steps[0].action.title = 'Changed';
  const result = await system.applyPlan(preview, { reviewed: true, commit: () => ({ ok: true }) });
  assert.equal(result.code, 'stale_preview');
});

test('plans remain reviewable before write permission and fail closed at Apply', async () => {
  const def = register({ confirmation: 'writes', permissions: ['workspace.delete'], destructive: true });
  const preview = system.previewPlan([
    { id: 'remove', action: { type: def.type, title: 'Remove stale block' } }
  ], { permissions: ['workspace.read'] });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.permissions, ['workspace.delete']);
  const result = await system.applyPlan(preview, {
    reviewed: true,
    permissions: ['workspace.read'],
    commit: () => ({ ok: true })
  });
  assert.equal(result.code, 'permission_denied');
});

test('workspace target drift invalidates a reviewed plan before any step commits', async () => {
  let revision = 'revision-1';
  let commits = 0;
  const def = register({ confirmation: 'never', permissions: [] });
  const snapshot = () => ({ revision });
  const preview = system.previewPlan([
    { id: 'edit', action: { type: def.type, title: 'Edit current task' } }
  ], { snapshot });
  assert.equal(preview.ok, true);
  revision = 'revision-2';
  const stale = await system.applyPlan(preview, {
    reviewed: true,
    snapshot,
    commit: () => ({ ok: true, changedId: String(++commits) })
  });
  assert.equal(stale.code, 'stale_preview');
  assert.equal(commits, 0);
});

test('raw provider plan metadata becomes typed dependencies without entering action schemas', () => {
  const first = register({ confirmation: 'never', permissions: [] });
  const second = register({ confirmation: 'never', permissions: [] });
  const preview = system.previewPlan([
    { type: first.type, title: 'Create the note', planActionId: 'note' },
    { type: second.type, title: 'Link the task', planActionId: 'task', dependsOn: ['note'] }
  ]);
  assert.equal(preview.ok, true);
  assert.equal(preview.steps[0].id, 'note');
  assert.deepEqual(preview.steps[1].dependsOn, ['note']);
  assert.equal('planActionId' in preview.steps[0].action, false);
  assert.equal('dependsOn' in preview.steps[1].action, false);
});
