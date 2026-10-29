import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const diffApi = require('../../src/sync/sync-diff.js');
const projectionApi = require('../../src/sync/sync-projection.js');

async function projectionOf(workspace) {
  const projection = projectionApi.buildProjection(workspace);
  const hashes = await projectionApi.hashProjection(projection);
  return { records: projection.records, hashes };
}

function makeIdentity(startLamport = 1) {
  let lamport = startLamport - 1;
  return {
    deviceId: 'device-a',
    schemaVersion: 5,
    clientTime: '2026-07-15T12:00:00.000Z',
    nextLamport: () => { lamport += 1; return lamport; }
  };
}

const baseWorkspace = () => ({
  pages: [{ id: 'p1', title: 'A', body: 'one' }, { id: 'p2', title: 'B', body: 'two' }],
  tasks: [{ id: 't1', text: 'task', done: false }],
  taskOrder: ['t1']
});

test('identical projections produce zero ops', async () => {
  const base = await projectionOf(baseWorkspace());
  const current = await projectionOf(baseWorkspace());
  const { ops } = diffApi.computeOutbox({
    baseHashes: base.hashes,
    currentRecords: current.records,
    currentHashes: current.hashes,
    previousOutbox: [],
    identity: makeIdentity()
  });
  assert.deepEqual(ops, []);
});

test('create, edit, and delete each emit the right op with correct baseHash', async () => {
  const base = await projectionOf(baseWorkspace());
  const changed = baseWorkspace();
  changed.pages[0].body = 'edited';                 // edit p1
  changed.pages.splice(1, 1);                        // delete p2
  changed.pages.push({ id: 'p3', title: 'C' });      // create p3
  const current = await projectionOf(changed);

  const { ops } = diffApi.computeOutbox({
    baseHashes: base.hashes,
    currentRecords: current.records,
    currentHashes: current.hashes,
    previousOutbox: [],
    identity: makeIdentity()
  });

  const byKey = Object.fromEntries(ops.map(op => [op.recordKey, op]));
  assert.equal(byKey['c/pages/p1'].kind, 'upsert');
  assert.equal(byKey['c/pages/p1'].baseHash, base.hashes['c/pages/p1']);
  assert.equal(byKey['c/pages/p3'].kind, 'upsert');
  assert.equal(byKey['c/pages/p3'].baseHash, null);
  assert.equal(byKey['c/pages/p2'].kind, 'delete');
  assert.equal(byKey['c/pages/p2'].payload, null);
  assert.equal(byKey['c/pages/p2'].baseHash, base.hashes['c/pages/p2']);
  // Ordering doc changed too (p2 removed, p3 appended).
  assert.equal(byKey['o/pages'].kind, 'upsert');
  assert.deepEqual(byKey['o/pages'].payload, ['p1', 'p3']);
  // Untouched records emit nothing.
  assert.equal(byKey['c/tasks/t1'], undefined);
});

test('re-diff with unchanged pending edits reuses ops (stable opIds)', async () => {
  const base = await projectionOf(baseWorkspace());
  const changed = baseWorkspace();
  changed.pages[0].body = 'edited';
  const current = await projectionOf(changed);
  const identity = makeIdentity();

  const first = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current.records, currentHashes: current.hashes,
    previousOutbox: [], identity
  });
  const second = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current.records, currentHashes: current.hashes,
    previousOutbox: first.ops, identity
  });
  assert.deepEqual(second.ops, first.ops);
});

test('coalescing keeps the ORIGINAL baseHash but takes a fresh opId', async () => {
  const base = await projectionOf(baseWorkspace());
  const edit1 = baseWorkspace();
  edit1.pages[0].body = 'first edit';
  const current1 = await projectionOf(edit1);
  const identity = makeIdentity();

  const outbox1 = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current1.records, currentHashes: current1.hashes,
    previousOutbox: [], identity
  });
  const op1 = outbox1.ops.find(op => op.recordKey === 'c/pages/p1');

  const edit2 = baseWorkspace();
  edit2.pages[0].body = 'second edit';
  const current2 = await projectionOf(edit2);
  const outbox2 = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current2.records, currentHashes: current2.hashes,
    previousOutbox: outbox1.ops, identity
  });
  const op2 = outbox2.ops.find(op => op.recordKey === 'c/pages/p1');

  assert.notEqual(op2.opId, op1.opId);
  assert.equal(op2.baseHash, op1.baseHash, 'coalesced op must keep the original base');
  assert.notEqual(op2.hash, op1.hash);
  // Exactly one op per record key.
  assert.equal(outbox2.ops.filter(op => op.recordKey === 'c/pages/p1').length, 1);
});

test('an edit reverted to the baseline value drops its pending op', async () => {
  const base = await projectionOf(baseWorkspace());
  const edited = baseWorkspace();
  edited.pages[0].body = 'temporary';
  const current1 = await projectionOf(edited);
  const identity = makeIdentity();
  const outbox1 = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current1.records, currentHashes: current1.hashes,
    previousOutbox: [], identity
  });
  assert.ok(outbox1.ops.length > 0);

  const reverted = await projectionOf(baseWorkspace());
  const outbox2 = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: reverted.records, currentHashes: reverted.hashes,
    previousOutbox: outbox1.ops, identity
  });
  assert.deepEqual(outbox2.ops, []);
});

test('ops come out in deterministic sorted order and validate', async () => {
  const base = await projectionOf(baseWorkspace());
  const changed = baseWorkspace();
  changed.tasks.push({ id: 't2', text: 'new', done: false });
  changed.pages[0].title = 'renamed';
  const current = await projectionOf(changed);
  const { ops } = diffApi.computeOutbox({
    baseHashes: base.hashes, currentRecords: current.records, currentHashes: current.hashes,
    previousOutbox: [], identity: makeIdentity()
  });
  const upsertKeys = ops.filter(o => o.kind === 'upsert').map(o => o.recordKey);
  assert.deepEqual(upsertKeys, [...upsertKeys].sort());
});
