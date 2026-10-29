import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { create } = require('../../src/persistence/workspace-db.js');

function makeIndexedDb() {
  const rows = new Map();
  const state = { openCalls: 0, closeCalls: 0, closeAfterOpenSuccess: 0, dbs: [] };
  const factory = {
    open() {
      state.openCalls += 1;
      const request = {};
      let closing = false;
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        close() { closing = true; state.closeCalls += 1; },
        transaction(_name, mode) {
          if (closing) throw new DOMException('The database connection is closing.', 'InvalidStateError');
          const tx = { error: null };
          let pending = 0;
          const request = (work) => {
            const req = {};
            pending += 1;
            queueMicrotask(() => {
              work(req);
              pending -= 1;
              if (pending === 0) queueMicrotask(() => { if (pending === 0) tx.oncomplete?.(); });
            });
            return req;
          };
          tx.objectStore = () => ({
            get(key) {
              return request((req) => {
                req.result = rows.get(key);
                req.onsuccess?.();
              });
            },
            put(value, key) {
              return request((req) => {
                rows.set(key, value);
                req.onsuccess?.();
              });
            }
          });
          assert.ok(mode === 'readonly' || mode === 'readwrite');
          return tx;
        }
      };
      state.dbs.push(db);
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
        if (state.closeAfterOpenSuccess > 0) {
          state.closeAfterOpenSuccess -= 1;
          db.close();
        }
      });
      return request;
    }
  };

  return { factory, state };
}

test('an unpinned adapter observes a replaced platform IndexedDB factory', async () => {
  const original = globalThis.indexedDB;
  const first = makeIndexedDb();
  const replacementError = new DOMException('Simulated quota exhaustion', 'QuotaExceededError');
  try {
    globalThis.indexedDB = first.factory;
    const db = create({ dbName: 'qa', storeName: 'workspace' });
    await db.write('root', { title: 'safe' });
    assert.equal(first.state.openCalls, 1);

    globalThis.indexedDB = { open() { throw replacementError; } };
    await assert.rejects(db.write('root', { title: 'new' }), error => error === replacementError);
    assert.equal(first.state.closeCalls, 1);
  } finally {
    if (original === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = original;
  }
});

test('workspace DB reuses one connection and resolves reads on transaction completion', async () => {
  const fake = makeIndexedDb();
  const db = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  await db.write('root', { title: 'safe' });
  assert.deepEqual(await db.read('root'), { title: 'safe' });
  assert.equal(fake.state.openCalls, 1);
  db.close();
  assert.equal(fake.state.closeCalls, 1);
});

test('conditional writes atomically reject a stale workspace base', async () => {
  const fake = makeIndexedDb();
  const first = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  const stale = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  await first.write('root', { title: 'base' });

  const accepted = await first.writeIf('root', { title: 'newer' }, current => current?.title === 'base');
  assert.equal(accepted.written, true);

  const rejected = await stale.writeIf('root', { title: 'stale overwrite' }, current => current?.title === 'base');
  assert.equal(rejected.written, false);
  assert.deepEqual(rejected.current, { title: 'newer' });
  assert.deepEqual(await first.read('root'), { title: 'newer' });
});

test('conditional writes journal the last accepted meaningful record atomically', async () => {
  const fake = makeIndexedDb();
  const db = create({
    indexedDB: fake.factory,
    dbName: 'qa',
    storeName: 'workspace',
    backupKey: 'workspace-last-meaningful',
    shouldBackup: current => Array.isArray(current?.pages) && current.pages.length > 0
  });
  const meaningful = { pages: [{ id: 'keep-me' }], tasks: [] };
  await db.write('root', meaningful);

  const emptied = await db.writeIf('root', { pages: [], tasks: [] }, current => current === meaningful);
  assert.equal(emptied.written, true);
  assert.deepEqual(await db.read('workspace-last-meaningful'), meaningful);
  assert.deepEqual(await db.read('root'), { pages: [], tasks: [] });

  const restored = await db.writeIf('root', { pages: [{ id: 'restored' }], tasks: [] }, current => current?.pages?.length === 0);
  assert.equal(restored.written, true);
  assert.deepEqual(await db.read('workspace-last-meaningful'), meaningful, 'an empty current root must not erase the recovery journal');
});

test('conditional writes persist a compact confirmation marker with the replacement', async () => {
  const fake = makeIndexedDb();
  const db = create({
    indexedDB: fake.factory,
    dbName: 'qa',
    storeName: 'workspace',
    commitKey: 'workspace-confirmed-root',
    buildCommit: (_current, next, key) => ({ key, empty: next.pages.length === 0 })
  });
  await db.write('root', { pages: [{ id: 'before' }] });

  const result = await db.writeIf('root', { pages: [] }, () => true);
  assert.equal(result.written, true);
  assert.deepEqual(await db.read('root'), { pages: [] });
  assert.deepEqual(await db.read('workspace-confirmed-root'), { key: 'root', empty: true });
});

test('versionchange closes the stale connection and the next operation reopens', async () => {
  const fake = makeIndexedDb();
  const db = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  await db.open();
  fake.state.dbs[0].onversionchange();
  assert.equal(fake.state.closeCalls, 1);
  await db.open();
  assert.equal(fake.state.openCalls, 2);
});

test('a close-pending connection is reopened once before starting read or write transactions', async () => {
  const fake = makeIndexedDb();
  fake.state.closeAfterOpenSuccess = 1;
  const db = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  await db.write('root', { title: 'recovered' });
  fake.state.dbs[1].close();
  assert.deepEqual(await db.read('root'), { title: 'recovered' });
  assert.equal(fake.state.openCalls, 3);
  assert.equal(fake.state.closeCalls, 2);
});

test('close-pending recovery is bounded to one retry', async () => {
  const fake = makeIndexedDb();
  fake.state.closeAfterOpenSuccess = 2;
  const db = create({ indexedDB: fake.factory, dbName: 'qa', storeName: 'workspace' });
  await assert.rejects(
    db.write('root', { title: 'not-written' }),
    error => error && error.name === 'InvalidStateError'
  );
  assert.equal(fake.state.openCalls, 2);
});

test('blocked upgrades reject instead of hanging indefinitely', async () => {
  const factory = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    }
  };
  const db = create({ indexedDB: factory, dbName: 'qa', storeName: 'workspace' });
  await assert.rejects(db.open(), /blocked by another open Sutra tab/i);
});
