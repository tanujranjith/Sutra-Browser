import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wipeApi = require('../../src/persistence/revocation-wipe.js');
const wipeSource = fs.readFileSync(new URL('../../src/persistence/revocation-wipe.js', import.meta.url), 'utf8');
const migrationSource = fs.readFileSync(new URL('../../src/boot/legacy-workspace-migration.js', import.meta.url), 'utf8');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    entries() { return [...values.entries()]; }
  };
}

function fakeIndexedDb(options = {}) {
  const existing = new Set(wipeApi.DATABASES);
  const deleted = [];
  const factory = {
    deleted,
    deleteDatabase(name) {
      const request = {};
      queueMicrotask(() => {
        if (options.failName === name) {
          request.error = new Error(`cannot delete ${name}`);
          request.onerror?.();
          return;
        }
        existing.delete(name);
        deleted.push(name);
        request.onsuccess?.();
      });
      return request;
    }
  };
  if (!options.noEnumerate) {
    factory.databases = async () => [...existing].map(name => ({ name }));
  }
  return factory;
}

function isolatedWipeRuntime(storageMode) {
  let createCalls = 0;
  const adapter = {
    read: async () => null,
    write: async () => true,
    writeIf: async () => true,
    close() {}
  };
  const context = {
    console,
    Promise,
    Date,
    Set,
    module: { exports: {} },
    SutraWorkspaceDB: {
      create() {
        createCalls += 1;
        return adapter;
      }
    }
  };
  if (storageMode === 'absent-key') context.localStorage = memoryStorage();
  if (storageMode === 'throwing-get') {
    context.localStorage = { getItem() { throw new Error('SecurityError: localStorage unavailable'); } };
  }
  if (storageMode === 'throwing-getter') {
    Object.defineProperty(context, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: localStorage getter unavailable'); }
    });
  }
  context.window = context;
  context.globalThis = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(wipeSource, sandbox, { filename: 'src/persistence/revocation-wipe.js' });
  return {
    api: context.module.exports,
    runMigration() {
      vm.runInContext(migrationSource, sandbox, { filename: 'src/boot/legacy-workspace-migration.js' });
    },
    get createCalls() { return createCalls; }
  };
}

test('guard read failures stay locked while a confirmed missing key remains unlocked', () => {
  assert.equal(wipeApi.readGuard(memoryStorage()), null, 'a successful missing-key read permits normal startup');

  const throwingStorage = {
    getItem() { throw new Error('SecurityError: localStorage unavailable'); }
  };
  assert.equal(wipeApi.readGuard(throwingStorage).status, 'guard-read-error');

  const unavailable = isolatedWipeRuntime('unavailable');
  assert.equal(unavailable.api.readGuard().status, 'guard-read-error');

  const throwingGetter = isolatedWipeRuntime('throwing-getter');
  assert.equal(throwingGetter.api.readGuard().status, 'guard-read-error');
});

test('legacy workspace migration stays closed on guard read failure and runs after a confirmed missing key', () => {
  const unreadable = isolatedWipeRuntime('throwing-get');
  unreadable.runMigration();
  assert.equal(unreadable.createCalls, 0, 'unreadable revocation state must not initialize IndexedDB');

  const unlocked = isolatedWipeRuntime('absent-key');
  unlocked.runMigration();
  assert.equal(unlocked.createCalls, 1, 'a successful missing-key read preserves normal startup');
});

test('verified wipe deletes every Sutra database, preserves session until acknowledgement, then finalizes', async () => {
  const local = memoryStorage({ workspaceMirror: 'private', homework: 'private' });
  const session = memoryStorage({ accessToken: 'private', providerKey: 'private' });
  const indexedDB = fakeIndexedDb();
  const result = await wipeApi.wipe({ localStorage: local, sessionStorage: session, indexedDB, preserveSessionUntilAcknowledged: true });
  assert.equal(result.status, 'local-verified');
  assert.deepEqual(indexedDB.deleted.sort(), [...wipeApi.DATABASES].sort());
  assert.deepEqual(local.entries().map(([key]) => key), [wipeApi.GUARD_KEY]);
  assert.equal(session.length, 2, 'auth session remains only until the server acknowledgement succeeds');
  const complete = wipeApi.finalize({ localStorage: local, sessionStorage: session });
  assert.equal(complete.status, 'complete');
  assert.equal(session.length, 0);
});

test('wipe is idempotent and a partial deletion remains fail-closed', async () => {
  const local = memoryStorage({ private: 'data' });
  const session = memoryStorage({ token: 'data' });
  const indexedDB = fakeIndexedDb({ failName: 'noteflow_attachments_db' });
  await assert.rejects(() => wipeApi.wipe({ localStorage: local, sessionStorage: session, indexedDB }), /cannot delete/);
  assert.equal(wipeApi.readGuard(local).status, 'cleanup-error');
  assert.equal(session.getItem('token'), 'data', 'session is retained so a verified cleanup can be retried and acknowledged');

  const retryDb = fakeIndexedDb();
  await wipeApi.wipe({ localStorage: local, sessionStorage: session, indexedDB: retryDb });
  assert.equal(wipeApi.readGuard(local).status, 'complete');
  assert.equal(session.length, 0);
});

test('browsers without database enumeration report unverified cleanup instead of claiming completeness', async () => {
  // Firefox/Safari path: no indexedDB.databases(). Every known database is
  // still deleted and confirmed per-name, but the guard must say the
  // completeness check could not run — never a plain "complete".
  const local = memoryStorage({ workspaceMirror: 'private' });
  const session = memoryStorage({ accessToken: 'private' });
  const indexedDB = fakeIndexedDb({ noEnumerate: true });
  const result = await wipeApi.wipe({ localStorage: local, sessionStorage: session, indexedDB, preserveSessionUntilAcknowledged: true });
  assert.equal(result.status, 'local-unverified');
  assert.ok(result.detail.includes('cannot enumerate'), 'guard detail discloses why verification was impossible');
  assert.deepEqual(indexedDB.deleted.sort(), [...wipeApi.DATABASES].sort(), 'deletion of every known database was still attempted and confirmed');

  const acknowledged = wipeApi.finalize({ localStorage: local, sessionStorage: session });
  assert.equal(acknowledged.status, 'complete-unverified', 'server acknowledgement must not upgrade an unverifiable cleanup to complete');
});

test('immediate (non-deferred) wipe on enumeration-less browsers ends at complete-unverified', async () => {
  const local = memoryStorage({});
  const session = memoryStorage({ token: 'x' });
  const indexedDB = fakeIndexedDb({ noEnumerate: true });
  const result = await wipeApi.wipe({ localStorage: local, sessionStorage: session, indexedDB });
  assert.equal(result.status, 'complete-unverified');
  assert.equal(session.length, 0);
});

test('finalize refuses incomplete, malformed, and missing guards without clearing the session', () => {
  for (const status of ['cleaning', 'cleanup-error', 'locked', 'future-state']) {
    const local = memoryStorage();
    const session = memoryStorage({ token: 'preserve-me' });
    wipeApi.writeGuard(local, status);
    assert.throws(
      () => wipeApi.finalize({ localStorage: local, sessionStorage: session }),
      /Cannot finalize revocation cleanup/
    );
    assert.equal(session.getItem('token'), 'preserve-me');
    assert.equal(wipeApi.readGuard(local).status, status);
  }

  const local = memoryStorage();
  const session = memoryStorage({ token: 'preserve-me' });
  assert.throws(
    () => wipeApi.finalize({ localStorage: local, sessionStorage: session }),
    /state: missing/
  );
  assert.equal(session.getItem('token'), 'preserve-me');
});

test('finalize is idempotent for follower tabs after a terminal shared guard', () => {
  for (const status of ['complete', 'complete-unverified']) {
    const local = memoryStorage();
    const session = memoryStorage({ token: 'remove-after-leader-ack' });
    wipeApi.writeGuard(local, status, status === 'complete-unverified' ? 'unverified' : '');
    const result = wipeApi.finalize({ localStorage: local, sessionStorage: session });
    assert.equal(result.status, status);
    assert.equal(session.length, 0);
    assert.equal(wipeApi.readGuard(local).status, status);
  }
});
