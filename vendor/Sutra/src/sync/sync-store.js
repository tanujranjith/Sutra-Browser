/*
 * Sutra Sync store — the dedicated `sutra_sync_db` IndexedDB database
 * holding device identity, the acknowledged baseline, the outgoing op
 * queue, tombstones, asset transfer state, and conflict records. Entirely
 * separate from the workspace DB; none of this travels in backups.
 * Mirrors the injectable-factory seam of src/persistence/workspace-db.js.
 * Spec: docs/architecture/SYNC_PROTOCOL.md §8.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'sutra_sync_db';
  var DB_VERSION = 1;
  var STORES = ['meta', 'baseline', 'outbox', 'tombstones', 'assets', 'conflicts'];
  var BASELINE_KEY = 'current';
  var TOMBSTONES_KEY = 'current';

  function create(options) {
    var config = options || {};
    var pinnedIndexedDb = config.indexedDB || null;
    var dbName = String(config.dbName || DB_NAME);
    // Every authenticated Supabase account gets a distinct logical namespace
    // inside this device-local database. The database name stays stable so the
    // revoke-and-wipe routine can delete it atomically, but account A's queue,
    // device identity, baseline, wrapped key, and refresh token can never be
    // read through account B's store instance. `scope` is deliberately an
    // opaque local identifier, never a workspace/export field.
    var scope = config.scope === undefined || config.scope === null || config.scope === ''
      ? ''
      : String(config.scope);
    var scopePrefix = scope ? ('scope:' + encodeURIComponent(scope) + ':') : '';
    var liveDb = null;
    var liveFactory = null;
    var opening = null;

    function forget(db) {
      if (!db || liveDb === db) {
        liveDb = null;
        liveFactory = null;
      }
      opening = null;
    }

    function open() {
      var indexedDb = pinnedIndexedDb || global.indexedDB;
      if (liveDb) {
        if (pinnedIndexedDb || indexedDb === liveFactory) return Promise.resolve(liveDb);
        close();
      }
      if (opening) return opening;
      if (!indexedDb) return Promise.reject(new Error('IndexedDB unavailable'));
      var request;
      try { request = indexedDb.open(dbName, DB_VERSION); }
      catch (error) { return Promise.reject(error); }
      opening = new Promise(function (resolve, reject) {
        var settled = false;
        function fail(error) {
          if (settled) return;
          settled = true;
          forget();
          reject(error || new Error('Sync DB open failed'));
        }
        request.onupgradeneeded = function () {
          var db = request.result;
          for (var i = 0; i < STORES.length; i += 1) {
            if (!db.objectStoreNames.contains(STORES[i])) db.createObjectStore(STORES[i]);
          }
        };
        request.onblocked = function () { fail(new Error('Sync DB upgrade is blocked by another open Sutra tab.')); };
        request.onsuccess = function () {
          var db = request.result;
          if (settled) { try { db.close(); } catch (error) {} return; }
          settled = true;
          liveDb = db;
          liveFactory = indexedDb;
          opening = null;
          db.onversionchange = function () {
            try { db.close(); } catch (error) {}
            forget(db);
          };
          resolve(db);
        };
        request.onerror = function () { fail(request.error); };
      });
      return opening;
    }

    function requestToPromise(request, tx) {
      return new Promise(function (resolve, reject) {
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || (tx && tx.error) || new Error('Sync DB request failed')); };
      });
    }

    function txDone(tx) {
      return new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('Sync DB transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Sync DB transaction aborted')); };
      });
    }

    function storageKey(key) {
      return scopePrefix + String(key);
    }

    function isOwnedKey(key) {
      var text = String(key);
      return scopePrefix ? text.indexOf(scopePrefix) === 0 : text.indexOf('scope:') !== 0;
    }

    function publicKey(key) {
      var text = String(key);
      return scopePrefix ? text.slice(scopePrefix.length) : text;
    }

    async function getValue(storeName, key) {
      var db = await open();
      var tx = db.transaction(storeName, 'readonly');
      var value = await requestToPromise(tx.objectStore(storeName).get(storageKey(key)), tx);
      return value === undefined ? null : value;
    }

    async function putValue(storeName, key, value) {
      var db = await open();
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, storageKey(key));
      return txDone(tx);
    }

    async function deleteValue(storeName, key) {
      var db = await open();
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(storageKey(key));
      return txDone(tx);
    }

    async function getAllEntries(storeName) {
      var db = await open();
      var tx = db.transaction(storeName, 'readonly');
      var store = tx.objectStore(storeName);
      var keys = await requestToPromise(store.getAllKeys(), tx);
      var values = await requestToPromise(store.getAll(), tx);
      var entries = [];
      for (var i = 0; i < keys.length; i += 1) {
        if (isOwnedKey(keys[i])) entries.push({ key: publicKey(keys[i]), value: values[i] });
      }
      return entries;
    }

    async function clearOwnedEntries(store) {
      if (!scopePrefix) {
        store.clear();
        return;
      }
      var keys = await requestToPromise(store.getAllKeys());
      for (var i = 0; i < keys.length; i += 1) {
        if (isOwnedKey(keys[i])) store.delete(keys[i]);
      }
    }

    // ---- meta ----
    function getMeta(key) { return getValue('meta', key); }
    function setMeta(key, value) { return putValue('meta', key, value); }
    function deleteMeta(key) { return deleteValue('meta', key); }

    // Device identity is shared by every tab in one browser profile. Creating
    // it with a separate get + put lets two fresh tabs persist different ids,
    // after which the backend correctly rejects the second id for the same
    // authenticated session. Keep the read and conditional write in one
    // IndexedDB readwrite transaction so exactly one value wins.
    async function getOrCreateMeta(key, createValue) {
      var db = await open();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readwrite');
        var store = tx.objectStore('meta');
        var resolvedValue = null;
        var settled = false;
        var request = store.get(storageKey(key));
        function fail(error) {
          if (settled) return;
          settled = true;
          reject(error);
        }
        request.onsuccess = function () {
          if (request.result !== undefined && request.result !== null) {
            resolvedValue = request.result;
            return;
          }
          try {
            resolvedValue = typeof createValue === 'function' ? createValue() : createValue;
            if (resolvedValue === undefined || resolvedValue === null) {
              throw new Error('Sync metadata factory returned no value.');
            }
            store.put(resolvedValue, storageKey(key));
          } catch (error) {
            try { tx.abort(); } catch (abortError) {}
            fail(error);
          }
        };
        request.onerror = function () { fail(request.error || new Error('Sync metadata read failed')); };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(resolvedValue);
        };
        tx.onerror = function () { fail(tx.error || new Error('Sync metadata transaction failed')); };
        tx.onabort = function () { fail(tx.error || new Error('Sync metadata transaction aborted')); };
      });
    }

    // Cross-tab fallback lease used only when Web Locks is unavailable.
    // The read+conditional-write happens in one IndexedDB readwrite
    // transaction, so two tabs cannot both acquire the same live lease.
    async function acquireLease(key, ownerId, now, ttlMs) {
      var db = await open();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readwrite');
        var store = tx.objectStore('meta');
        var acquired = false;
        var request = store.get(storageKey(key));
        request.onsuccess = function () {
          var current = request.result;
          var expired = !current || Number(current.expiresAt) <= Number(now);
          var sameOwner = current && current.ownerId === String(ownerId);
          if (expired || sameOwner) {
            acquired = true;
            store.put({
              ownerId: String(ownerId),
              expiresAt: Number(now) + Math.max(1000, Number(ttlMs) || 0)
            }, storageKey(key));
          }
        };
        request.onerror = function () { reject(request.error || new Error('Sync lease read failed')); };
        tx.oncomplete = function () { resolve(acquired); };
        tx.onerror = function () { reject(tx.error || new Error('Sync lease transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Sync lease transaction aborted')); };
      });
    }

    async function releaseLease(key, ownerId) {
      var db = await open();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readwrite');
        var store = tx.objectStore('meta');
        var released = false;
        var request = store.get(storageKey(key));
        request.onsuccess = function () {
          var current = request.result;
          if (current && current.ownerId === String(ownerId)) {
            released = true;
            store.delete(storageKey(key));
          }
        };
        request.onerror = function () { reject(request.error || new Error('Sync lease read failed')); };
        tx.oncomplete = function () { resolve(released); };
        tx.onerror = function () { reject(tx.error || new Error('Sync lease transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Sync lease transaction aborted')); };
      });
    }

    // ---- baseline (single doc: { cursor, records, hashes }) ----
    function getBaseline() { return getValue('baseline', BASELINE_KEY); }
    function setBaseline(baseline) { return putValue('baseline', BASELINE_KEY, baseline); }

    // ---- outbox (one op per recordKey) ----
    async function getOutbox() {
      var entries = await getAllEntries('outbox');
      var ops = entries.map(function (entry) { return entry.value; });
      ops.sort(function (a, b) {
        var ka = String(a && a.recordKey);
        var kb = String(b && b.recordKey);
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
      return ops;
    }

    async function replaceOutbox(ops) {
      var db = await open();
      var tx = db.transaction('outbox', 'readwrite');
      var store = tx.objectStore('outbox');
      await clearOwnedEntries(store);
      var list = Array.isArray(ops) ? ops : [];
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].recordKey) store.put(list[i], storageKey(list[i].recordKey));
      }
      return txDone(tx);
    }

    // ---- tombstones (single doc map) ----
    async function getTombstones() {
      var value = await getValue('tombstones', TOMBSTONES_KEY);
      return value && typeof value === 'object' ? value : {};
    }
    function setTombstones(map) { return putValue('tombstones', TOMBSTONES_KEY, map || {}); }

    // ---- conflicts ----
    async function listConflicts(options) {
      var entries = await getAllEntries('conflicts');
      var includeResolved = options && options.includeResolved === true;
      return entries.map(function (entry) { return entry.value; }).filter(function (entry) {
        return includeResolved || !(entry && entry.resolvedAt);
      });
    }
    async function putConflict(conflict) {
      var id = conflict && conflict.id ? String(conflict.id) : null;
      if (!id) return Promise.reject(new Error('Conflict records need an id.'));
      var existing = await getValue('conflicts', id);
      // A replay of the same operation pair must not resurrect a conflict the
      // user already resolved. Stable conflict ids make this idempotent.
      if (existing && existing.resolvedAt) return false;
      await putValue('conflicts', id, conflict);
      return true;
    }
    function removeConflict(id) { return deleteValue('conflicts', String(id)); }
    async function resolveConflict(id, resolution) {
      var key = String(id || '');
      var existing = await getValue('conflicts', key);
      if (!existing) return false;
      existing.resolvedAt = Date.now();
      existing.resolution = String(resolution || 'dismissed');
      await putValue('conflicts', key, existing);
      return true;
    }

    // ---- assets ----
    function getAssetState(hash) { return getValue('assets', String(hash)); }
    function setAssetState(hash, state) { return putValue('assets', String(hash), state); }
    function deleteAssetState(hash) { return deleteValue('assets', String(hash)); }
    async function listAssetStates() {
      var entries = await getAllEntries('assets');
      return entries.map(function (entry) { return entry.value; });
    }

    // Atomic end-of-cycle commit: the new baseline, the surviving outbox,
    // tombstones, and cursor/lamport meta land in ONE transaction so a crash
    // can never leave a half-advanced sync state.
    async function commitCycleState(state) {
      var config = state || {};
      var db = await open();
      var tx = db.transaction(['baseline', 'outbox', 'tombstones', 'meta'], 'readwrite');
      if (config.baseline !== undefined) tx.objectStore('baseline').put(config.baseline, storageKey(BASELINE_KEY));
      if (config.outboxOps !== undefined) {
        var outboxStore = tx.objectStore('outbox');
        await clearOwnedEntries(outboxStore);
        var ops = Array.isArray(config.outboxOps) ? config.outboxOps : [];
        for (var i = 0; i < ops.length; i += 1) {
          if (ops[i] && ops[i].recordKey) outboxStore.put(ops[i], storageKey(ops[i].recordKey));
        }
      }
      if (config.tombstones !== undefined) tx.objectStore('tombstones').put(config.tombstones || {}, storageKey(TOMBSTONES_KEY));
      if (config.meta && typeof config.meta === 'object') {
        var metaStore = tx.objectStore('meta');
        var metaKeys = Object.keys(config.meta);
        for (var m = 0; m < metaKeys.length; m += 1) {
          metaStore.put(config.meta[metaKeys[m]], storageKey(metaKeys[m]));
        }
      }
      return txDone(tx);
    }

    async function clearAll() {
      // Keep the legacy/unscoped fast path synchronous within one transaction.
      // Awaiting between object stores lets a browser legitimately commit the
      // transaction before the next store is touched.
      if (!scopePrefix) {
        var rawDb = await open();
        var rawTx = rawDb.transaction(STORES, 'readwrite');
        for (var r = 0; r < STORES.length; r += 1) rawTx.objectStore(STORES[r]).clear();
        return txDone(rawTx);
      }
      // Scoped data must preserve other account namespaces. Use a fresh
      // transaction per store so no async key scan can leave a multi-store
      // transaction half-open or accidentally clear a neighbour's state.
      for (var s = 0; s < STORES.length; s += 1) {
        var db = await open();
        var tx = db.transaction(STORES[s], 'readwrite');
        await clearOwnedEntries(tx.objectStore(STORES[s]));
        await txDone(tx);
      }
    }

    function close() {
      var db = liveDb;
      forget(db);
      if (db) { try { db.close(); } catch (error) {} }
    }

    return {
      scope: scope,
      open: open,
      getMeta: getMeta,
      setMeta: setMeta,
      deleteMeta: deleteMeta,
      getOrCreateMeta: getOrCreateMeta,
      acquireLease: acquireLease,
      releaseLease: releaseLease,
      getBaseline: getBaseline,
      setBaseline: setBaseline,
      getOutbox: getOutbox,
      replaceOutbox: replaceOutbox,
      getTombstones: getTombstones,
      setTombstones: setTombstones,
      listConflicts: listConflicts,
      putConflict: putConflict,
      removeConflict: removeConflict,
      resolveConflict: resolveConflict,
      getAssetState: getAssetState,
      setAssetState: setAssetState,
      deleteAssetState: deleteAssetState,
      listAssetStates: listAssetStates,
      commitCycleState: commitCycleState,
      clearAll: clearAll,
      close: close
    };
  }

  var api = { create: create, DB_NAME: DB_NAME, STORES: STORES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncStore = api;
}(typeof window !== 'undefined' ? window : globalThis));
