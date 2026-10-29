import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TZ = 'America/New_York';

async function loadModule() {
  if (globalThis.SutraSmartReschedule) return globalThis.SutraSmartReschedule;
  const path = new URL('../../src/features/workspace/smart-reschedule.js', import.meta.url);
  await import(path.href);
  return globalThis.SutraSmartReschedule;
}

test('group apply persists once, updates linked blocks, creates new blocks, and undoes as one operation', async () => {
  globalThis.timeBlocks = [{ id: 'linked', date: '2026-07-13', start: '08:00', end: '09:00', sourceType: 'task', sourceId: 'a' }];
  let saves = 0;
  globalThis.flushAppSaveNow = async () => { saves += 1; };
  const api = await loadModule();
  const receipt = await api.applyProposals([
    { status: 'proposed', actionId: 'task:a', sourceType: 'task', sourceId: 'a', sourceKey: 'task:a', title: 'A', startAt: '2026-07-13T14:00:00.000Z', endAt: '2026-07-13T15:00:00.000Z', operation: 'update', linkedBlockId: 'linked' },
    { status: 'proposed', actionId: 'task:b', sourceType: 'task', sourceId: 'b', sourceKey: 'task:b', title: 'B', startAt: '2026-07-13T15:00:00.000Z', endAt: '2026-07-13T16:00:00.000Z', operation: 'create' }
  ]);
  assert.equal(receipt.ok, true);
  assert.equal(globalThis.timeBlocks.length, 2);
  assert.equal(globalThis.timeBlocks.find(row => row.id === 'linked').start, '10:00');
  assert.equal(saves, 1);
  const undo = await api.undoLastApply();
  assert.equal(undo.ok, true);
  assert.equal(globalThis.timeBlocks.length, 1);
  assert.equal(globalThis.timeBlocks[0].start, '08:00');
  assert.equal(saves, 2);
});

test('persistence failure restores the exact pre-apply schedule', async () => {
  globalThis.timeBlocks = [{ id: 'kept', date: '2026-07-13', start: '08:00', end: '09:00' }];
  globalThis.flushAppSaveNow = async () => { throw new Error('disk full'); };
  const api = await loadModule();
  const before = structuredClone(globalThis.timeBlocks);
  const receipt = await api.applyProposals([
    { status: 'proposed', actionId: 'task:b', sourceType: 'task', sourceId: 'b', title: 'B', startAt: '2026-07-13T15:00:00.000Z', endAt: '2026-07-13T16:00:00.000Z', operation: 'create' }
  ]);
  assert.equal(receipt.code, 'persistence_failed');
  assert.deepEqual(globalThis.timeBlocks, before);
});
