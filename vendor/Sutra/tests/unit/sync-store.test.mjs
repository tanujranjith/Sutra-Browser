import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { create, STORES } = require('../../src/sync/sync-store.js');

// Fake IndexedDB factory with multiple object stores, multi-store
// transactions, clear/delete/getAll — enough surface for SutraSyncStore.
function makeFakeIndexedDb() {
  const stores = new Map(); // storeName -> Map(key -> value)
  const state = { openCalls: 0, closeCalls: 0, upgraded: [] };

  function storeFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  const factory = {
    open() {
      state.openCalls += 1;
      const request = {};
      const db = {
        objectStoreNames: {
          contains: (name) => stores.has(name)
        },
        createObjectStore(name) {
          state.upgraded.push(name);
          storeFor(name);
        },
        close() { state.closeCalls += 1; },
        transaction(names) {
          const involved = Array.isArray(names) ? names : [names];
          const pending = [];
          const tx = { error: null };
          const finish = () => {
            queueMicrotask(() => {
              Promise.all(pending).then(() => tx.oncomplete?.());
            });
          };
          tx.objectStore = (name) => {
            assert.ok(involved.includes(name), `store ${name} not in transaction scope`);
            const rows = storeFor(name);
            return {
              get(key) {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  req.result = rows.get(key);
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              },
              getAllKeys() {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  req.result = [...rows.keys()];
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              },
              getAll() {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  req.result = [...rows.values()];
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              },
              put(value, key) {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  rows.set(key, value);
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              },
              delete(key) {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  rows.delete(key);
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              },
              clear() {
                const req = {};
                pending.push(new Promise((resolve) => queueMicrotask(() => {
                  rows.clear();
                  req.onsuccess?.();
                  resolve();
                })));
                return req;
              }
            };
          };
          finish();
          return tx;
        }
      };
      queueMicrotask(() => {
        request.result = db;
        request.onupgradeneeded?.({ target: request });
        request.onsuccess?.();
      });
      return request;
    }
  };

  return { factory, state, stores };
}

function op(recordKey, lamport = 1, deviceId = 'dev-a') {
  return {
    opId: `${deviceId}:${lamport}`, deviceId, lamport,
    recordKey, kind: 'upsert', baseHash: null, hash: 'h'.repeat(64),
    payload: { id: recordKey }, schemaVersion: 5, protocolVersion: 1,
    clientTime: '2026-07-15T00:00:00.000Z'
  };
}

test('creates all six object stores on upgrade', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });
  await store.open();
  for (const name of STORES) {
    assert.ok(fake.stores.has(name), `missing store ${name}`);
  }
  assert.equal(STORES.length, 6);
});

test('meta, baseline, tombstones, and conflicts persist and reload', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });

  await store.setMeta('deviceId', 'device-123');
  await store.setMeta('lamport', 42);
  assert.equal(await store.getMeta('deviceId'), 'device-123');
  assert.equal(await store.getMeta('lamport'), 42);
  assert.equal(await store.getMeta('missing'), null);

  const baseline = { cursor: 7, records: { 'c/pages/p1': { id: 'p1' } }, hashes: { 'c/pages/p1': 'x' } };
  await store.setBaseline(baseline);
  assert.deepEqual(await store.getBaseline(), baseline);

  await store.setTombstones({ 'c/pages/gone': { deletedAt: 1, opId: 'a:1' } });
  assert.deepEqual(await store.getTombstones(), { 'c/pages/gone': { deletedAt: 1, opId: 'a:1' } });

  await store.putConflict({ id: 'k1', recordKey: 'c/pages/p1', type: 'page-content-conflict' });
  assert.equal((await store.listConflicts()).length, 1);
  await store.resolveConflict('k1', 'keep-merged');
  assert.equal((await store.listConflicts()).length, 0);
  assert.equal((await store.listConflicts({ includeResolved: true })).length, 1);
  await store.putConflict({ id: 'k1', recordKey: 'c/pages/p1', type: 'page-content-conflict' });
  assert.equal((await store.listConflicts()).length, 0, 'replay must not resurrect a resolved conflict');
  await store.removeConflict('k1');
  assert.equal((await store.listConflicts({ includeResolved: true })).length, 0);

  // Reopen against the same factory: data survives.
  store.close();
  const reopened = create({ indexedDB: fake.factory });
  assert.equal(await reopened.getMeta('deviceId'), 'device-123');
  assert.deepEqual(await reopened.getBaseline(), baseline);
});

test('getOrCreateMeta preserves the first durable device identity', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory, scope: 'account:a' });
  let factoryCalls = 0;
  const first = await store.getOrCreateMeta('deviceId', () => {
    factoryCalls += 1;
    return 'device-first';
  });
  const second = await store.getOrCreateMeta('deviceId', () => {
    factoryCalls += 1;
    return 'device-second';
  });
  assert.equal(first, 'device-first');
  assert.equal(second, 'device-first');
  assert.equal(factoryCalls, 1);
  assert.equal(await store.getMeta('deviceId'), 'device-first');
});

test('outbox replace keeps one op per record key and returns sorted ops', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });
  await store.replaceOutbox([op('c/tasks/t2', 2), op('c/pages/p1', 1)]);
  let ops = await store.getOutbox();
  assert.deepEqual(ops.map(o => o.recordKey), ['c/pages/p1', 'c/tasks/t2']);

  // Replace wholesale: dropped ops disappear, same-key op overwrites.
  await store.replaceOutbox([op('c/pages/p1', 9)]);
  ops = await store.getOutbox();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].lamport, 9);
});

test('commitCycleState lands baseline, outbox, tombstones, and meta together', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });
  await store.replaceOutbox([op('c/pages/stale', 1)]);
  await store.commitCycleState({
    baseline: { cursor: 12, records: {}, hashes: {} },
    outboxOps: [op('c/pages/fresh', 3)],
    tombstones: { 'c/pages/dead': { deletedAt: 5, opId: 'a:2' } },
    meta: { lastServerCursor: 12, lamport: 3 }
  });
  assert.equal((await store.getBaseline()).cursor, 12);
  assert.deepEqual((await store.getOutbox()).map(o => o.recordKey), ['c/pages/fresh']);
  assert.deepEqual(Object.keys(await store.getTombstones()), ['c/pages/dead']);
  assert.equal(await store.getMeta('lastServerCursor'), 12);
  assert.equal(await store.getMeta('lamport'), 3);
});

test('asset states store, list, and delete by hash', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });
  await store.setAssetState('abc', { hash: 'abc', status: 'pending-upload' });
  await store.setAssetState('def', { hash: 'def', status: 'uploaded' });
  assert.equal((await store.getAssetState('abc')).status, 'pending-upload');
  assert.equal((await store.listAssetStates()).length, 2);
  await store.deleteAssetState('abc');
  assert.equal(await store.getAssetState('abc'), null);
});

test('account scopes isolate device identity, baselines, queues, assets, and conflicts in one browser database', async () => {
  const fake = makeFakeIndexedDb();
  const accountA = create({ indexedDB: fake.factory, scope: 'account:a' });
  const accountB = create({ indexedDB: fake.factory, scope: 'account:b' });

  await accountA.setMeta('deviceId', 'device-a');
  await accountA.setBaseline({ cursor: 7, records: { 'c/pages/a': { id: 'a' } }, hashes: {} });
  await accountA.replaceOutbox([op('c/pages/a', 1, 'device-a')]);
  await accountA.setAssetState('a'.repeat(64), { hash: 'a'.repeat(64), status: 'uploaded' });
  await accountA.putConflict({ id: 'conflict-a', recordKey: 'c/pages/a' });

  assert.equal(accountB.scope, 'account:b');
  assert.equal(await accountB.getMeta('deviceId'), null);
  assert.equal(await accountB.getBaseline(), null);
  assert.deepEqual(await accountB.getOutbox(), []);
  assert.equal(await accountB.getAssetState('a'.repeat(64)), null);
  assert.deepEqual(await accountB.listConflicts(), []);

  await accountB.setMeta('deviceId', 'device-b');
  await accountB.commitCycleState({
    baseline: { cursor: 9, records: { 'c/pages/b': { id: 'b' } }, hashes: {} },
    outboxOps: [op('c/pages/b', 1, 'device-b')],
    tombstones: { 'c/pages/removed-b': { deletedAt: 9, opId: 'device-b:1' } },
    meta: { lastServerCursor: 9 }
  });
  assert.equal((await accountB.getBaseline()).cursor, 9);
  assert.equal(await accountB.getMeta('lastServerCursor'), 9);
  await accountB.clearAll();

  assert.equal(await accountA.getMeta('deviceId'), 'device-a', 'clearing B cannot clear A identity');
  assert.deepEqual((await accountA.getOutbox()).map(item => item.recordKey), ['c/pages/a']);
  assert.equal((await accountA.listConflicts()).length, 1);
  assert.equal(await accountB.getMeta('deviceId'), null);
  assert.deepEqual(await accountB.getOutbox(), []);
});

test('fallback cycle lease has one owner, releases, and expires after a crash', async () => {
  const fake = makeFakeIndexedDb();
  const A = create({ indexedDB: fake.factory });
  const B = create({ indexedDB: fake.factory });
  assert.equal(await A.acquireLease('cycle', 'tab-a', 1000, 5000), true);
  assert.equal(await B.acquireLease('cycle', 'tab-b', 1001, 5000), false);
  assert.equal(await B.releaseLease('cycle', 'tab-b'), false, 'a follower cannot release the leader lease');
  assert.equal(await A.releaseLease('cycle', 'tab-a'), true);
  assert.equal(await B.acquireLease('cycle', 'tab-b', 1002, 5000), true);
  assert.equal(await A.acquireLease('cycle', 'tab-a', 7003, 5000), true, 'expired lease is taken over');
});

test('clearAll wipes every store (vault delete / disable)', async () => {
  const fake = makeFakeIndexedDb();
  const store = create({ indexedDB: fake.factory });
  await store.setMeta('deviceId', 'x');
  await store.setBaseline({ cursor: 1, records: {}, hashes: {} });
  await store.replaceOutbox([op('c/pages/p1', 1)]);
  await store.clearAll();
  assert.equal(await store.getMeta('deviceId'), null);
  assert.equal(await store.getBaseline(), null);
  assert.deepEqual(await store.getOutbox(), []);
});

test('a failing factory surfaces the error instead of hanging', async () => {
  const boom = new Error('factory exploded');
  const store = create({ indexedDB: { open() { throw boom; } } });
  await assert.rejects(store.open(), (e) => e === boom);
});
