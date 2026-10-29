/* IndexedDB workspace adapter. Domain/state modules never talk to IDB directly. */
(function (global) {
  'use strict';

  function create(options) {
    var config = options || {};
    // Only pin an explicitly-injected factory (used by unit tests). Otherwise the
    // platform factory is resolved fresh on every open() rather than captured once
    // at create() time — so a genuine mid-session IndexedDB failure (quota, blocked
    // upgrade, a swapped/failing implementation) is observed and surfaced instead of
    // being masked by a stale load-time reference.
    var pinnedIndexedDb = config.indexedDB || null;
    var dbName = String(config.dbName || 'sutra_workspace_db');
    var version = Math.max(1, Math.floor(Number(config.version) || 1));
    var storeName = String(config.storeName || 'workspace');
    // Optional one-generation journal for callers that store a complete record
    // under one key. The backup and replacement are written in the SAME
    // transaction, so a crash can never leave a half-updated journal pair.
    var backupKey = config.backupKey === null || config.backupKey === undefined
      ? ''
      : String(config.backupKey);
    var shouldBackup = typeof config.shouldBackup === 'function'
      ? config.shouldBackup
      : function (current) { return current !== null && current !== undefined; };
    // Optional compact marker written in the same transaction as the root.
    // It lets callers distinguish an accepted canonical write from a later
    // out-of-band overwrite without storing a second copy of the new record.
    var commitKey = config.commitKey === null || config.commitKey === undefined
      ? ''
      : String(config.commitKey);
    var buildCommit = typeof config.buildCommit === 'function'
      ? config.buildCommit
      : function () { return undefined; };
    var liveFactory = null;
    var liveDb = null;
    var opening = null;

    function forget(db) {
      var shouldClear = !db || liveDb === db;
      if (shouldClear) {
        liveDb = null;
        liveFactory = null;
      }
      // A stale connection can fail after another caller has already begun
      // opening its replacement. Only open() owns the in-flight promise; do not
      // let that stale connection clear a newer open attempt.
      if (!db) opening = null;
    }

    function isClosingConnectionError(error) {
      // Per IndexedDB, IDBDatabase.transaction() throws InvalidStateError when
      // the connection's close-pending flag is set. Opening a fresh connection
      // is safe because no transaction (and therefore no write) started.
      return !!error && error.name === 'InvalidStateError';
    }

    function open() {
      var indexedDb = pinnedIndexedDb || global.indexedDB;
      if (liveDb) {
        if (pinnedIndexedDb || indexedDb === liveFactory) return Promise.resolve(liveDb);
        // The browser factory was replaced or invalidated after startup. Do not
        // let a cached connection mask the new failure state; normal saves still
        // reuse the live connection while the platform factory is unchanged.
        close();
      }
      if (opening) return opening;
      if (!indexedDb) return Promise.reject(new Error('IndexedDB unavailable'));
      var request;
      try { request = indexedDb.open(dbName, version); }
      catch (error) { return Promise.reject(error); }
      opening = new Promise(function (resolve, reject) {
        var settled = false;
        function fail(error) {
          if (settled) return;
          settled = true;
          forget();
          reject(error || new Error('IndexedDB open failed'));
        }
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onblocked = function () { fail(new Error('IndexedDB upgrade is blocked by another open Sutra tab.')); };
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
    async function read(key, retryCount) {
      var db = await open();
      var tx;
      var request;
      var value = null;
      try {
        tx = db.transaction(storeName, 'readonly');
        request = tx.objectStore(storeName).get(key);
      } catch (error) {
        if (!retryCount && isClosingConnectionError(error)) {
          forget(db);
          return read(key, 1);
        }
        throw error;
      }
      return new Promise(function (resolve, reject) {
        request.onsuccess = function () { value = request.result === undefined ? null : request.result; };
        request.onerror = function () { reject(request.error || tx.error || new Error('IndexedDB read request failed')); };
        tx.oncomplete = function () { resolve(value); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB read transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB read transaction aborted')); };
      });
    }
    async function write(key, value, retryCount) {
      var db = await open();
      var tx;
      var request;
      try {
        tx = db.transaction(storeName, 'readwrite');
        request = tx.objectStore(storeName).put(value, key);
      } catch (error) {
        if (!retryCount && isClosingConnectionError(error)) {
          forget(db);
          return write(key, value, 1);
        }
        throw error;
      }
      return new Promise(function (resolve, reject) {
        request.onerror = function () { reject(request.error || tx.error || new Error('IndexedDB write request failed')); };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
      });
    }

    // Atomically read the current record and write `value` only when the
    // synchronous predicate accepts it. Keeping the comparison and put in one
    // readwrite transaction prevents a stale tab from replacing a newer full-
    // workspace snapshot between a separate read and write.
    async function writeIf(key, value, predicate, retryCount) {
      if (typeof predicate !== 'function') {
        throw new TypeError('IndexedDB conditional write requires a predicate.');
      }
      var db = await open();
      var tx;
      var getRequest;
      var current = null;
      var written = false;
      var predicateError = null;
      try {
        tx = db.transaction(storeName, 'readwrite');
        getRequest = tx.objectStore(storeName).get(key);
      } catch (error) {
        if (!retryCount && isClosingConnectionError(error)) {
          forget(db);
          return writeIf(key, value, predicate, 1);
        }
        throw error;
      }
      return new Promise(function (resolve, reject) {
        var settled = false;
        function fail(error) {
          if (settled) return;
          settled = true;
          reject(error || new Error('IndexedDB conditional write failed'));
        }
        getRequest.onsuccess = function () {
          current = getRequest.result === undefined ? null : getRequest.result;
          var accepted = false;
          try { accepted = predicate(current) === true; }
          catch (error) {
            predicateError = error;
            try { tx.abort(); } catch (abortError) { /* fail below */ }
            fail(error);
            return;
          }
          if (!accepted) return;
          var store = tx.objectStore(storeName);
          if (backupKey && backupKey !== String(key)) {
            var keepCurrent = false;
            try { keepCurrent = shouldBackup(current, value, key) === true; }
            catch (error) {
              predicateError = error;
              try { tx.abort(); } catch (abortError) { /* fail below */ }
              fail(error);
              return;
            }
            if (keepCurrent) {
              var backupRequest;
              try { backupRequest = store.put(current, backupKey); }
              catch (error) { fail(error); return; }
              backupRequest.onerror = function () {
                fail(backupRequest.error || tx.error || new Error('IndexedDB recovery journal write failed'));
              };
            }
          }
          if (commitKey && commitKey !== String(key)) {
            var commitValue;
            try { commitValue = buildCommit(current, value, key); }
            catch (error) {
              predicateError = error;
              try { tx.abort(); } catch (abortError) { /* fail below */ }
              fail(error);
              return;
            }
            if (commitValue !== undefined) {
              var commitRequest;
              try { commitRequest = store.put(commitValue, commitKey); }
              catch (error) { fail(error); return; }
              commitRequest.onerror = function () {
                fail(commitRequest.error || tx.error || new Error('IndexedDB commit marker write failed'));
              };
            }
          }
          var putRequest;
          try { putRequest = store.put(value, key); }
          catch (error) { fail(error); return; }
          written = true;
          putRequest.onerror = function () {
            fail(putRequest.error || tx.error || new Error('IndexedDB conditional write request failed'));
          };
        };
        getRequest.onerror = function () {
          fail(getRequest.error || tx.error || new Error('IndexedDB conditional read request failed'));
        };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve({ written: written, current: current });
        };
        tx.onerror = function () {
          fail(predicateError || tx.error || new Error('IndexedDB conditional write transaction failed'));
        };
        tx.onabort = function () {
          fail(predicateError || tx.error || new Error('IndexedDB conditional write transaction aborted'));
        };
      });
    }
    function close() {
      var db = liveDb;
      forget(db);
      if (db) { try { db.close(); } catch (error) {} }
    }
    return { open: open, read: read, write: write, writeIf: writeIf, close: close };
  }
  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraWorkspaceDB = api;
}(typeof window !== 'undefined' ? window : globalThis));
