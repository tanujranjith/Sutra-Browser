/* Canonical browser-origin cleanup used only after a verified device-revocation RPC. */
(function (global) {
  'use strict';

  var GUARD_KEY = 'sutra:revocationWipeGuard:v1';
  var DATABASES = Object.freeze([
    'noteflow_atelier_db',
    'noteflow_attachments_db',
    'sutra_credentials_db',
    'sutra_sync_db',
    'sutra-drive-sync-keys',
    'sutra-fs-config',
    'sutra_share_target_db'
  ]);

  function guardReadError() {
    return {
      version: 1,
      status: 'guard-read-error',
      detail: 'The revocation guard could not be read. Sutra remains locked.'
    };
  }

  function readGuard(storage) {
    var raw;
    try {
      // Resolve localStorage inside the protected boundary too: some browser
      // policies throw from the property getter before getItem() is reached.
      var target = storage || global.localStorage;
      if (!target || typeof target.getItem !== 'function') return guardReadError();
      raw = target.getItem(GUARD_KEY);
    } catch (error) {
      return guardReadError();
    }
    // Only a successful missing-key read proves that this browser is unlocked.
    // Empty, malformed, inaccessible, and unavailable state stays fail-closed.
    if (raw === null) return null;
    try {
      var value = JSON.parse(raw);
      return value && Number(value.version) === 1 ? value : { version: 1, status: 'locked' };
    } catch (error) {
      return { version: 1, status: 'locked' };
    }
  }

  function writeGuard(storage, status, detail) {
    var target = storage || global.localStorage;
    var value = {
      version: 1,
      status: String(status || 'locked'),
      updatedAt: new Date().toISOString(),
      detail: detail ? String(detail).slice(0, 160) : ''
    };
    target.setItem(GUARD_KEY, JSON.stringify(value)); // sutra-allow-storage: emergency fail-closed revocation sentinel
    return value;
  }

  function deleteDatabase(factory, name, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var request;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('Timed out deleting ' + name + '; another Sutra tab may still be open.'));
      }, Math.max(1000, Number(timeoutMs) || 8000));
      function finish(error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(true);
      }
      try { request = factory.deleteDatabase(name); }
      catch (error) { finish(error); return; }
      request.onsuccess = function () { finish(); };
      request.onerror = function () { finish(request.error || new Error('Failed to delete ' + name)); };
      // Do not treat `blocked` as success. Other tabs receive the broadcast and
      // close their handles; the request can then complete before the timeout.
      request.onblocked = function () {};
    });
  }

  async function verifyDatabasesGone(factory, names) {
    // Truthful verification (audit remediation): when this browser cannot
    // enumerate IndexedDB databases (Firefox/Safari do not implement
    // factory.databases()), deletion of every KNOWN database is still
    // confirmed one-by-one by deleteDatabase() success, but the absence of
    // any other origin database cannot be proven. Report that distinction
    // instead of silently claiming full verification.
    if (!factory || typeof factory.databases !== 'function') {
      return { verified: false, reason: 'enumeration-unsupported' };
    }
    var rows = await factory.databases();
    var remaining = new Set((rows || []).map(function (row) { return String(row && row.name || ''); }));
    var found = names.filter(function (name) { return remaining.has(name); });
    if (found.length) throw new Error('Local cleanup verification found remaining database(s): ' + found.join(', '));
    return { verified: true, reason: '' };
  }

  function verifyStorageEmpty(storage, allowedKeys) {
    if (!storage) return true;
    var allowed = new Set(allowedKeys || []);
    for (var i = 0; i < storage.length; i += 1) {
      var key = storage.key(i);
      if (key && !allowed.has(key)) throw new Error('Local cleanup verification found remaining browser storage.');
    }
    return true;
  }

  async function wipe(options) {
    var config = options || {};
    var local = config.localStorage || global.localStorage;
    var session = config.sessionStorage || global.sessionStorage;
    var factory = config.indexedDB || global.indexedDB;
    if (!local || !session || !factory) throw new Error('Required browser storage is unavailable.');
    writeGuard(local, 'cleaning');
    var databaseVerification = null;
    try {
      local.clear(); // sutra-allow-storage: verified revocation deletes only this Sutra origin
      writeGuard(local, 'cleaning');
      var names = Array.isArray(config.databaseNames) ? config.databaseNames.slice() : DATABASES.slice();
      for (var i = 0; i < names.length; i += 1) {
        await deleteDatabase(factory, names[i], config.timeoutMs);
      }
      await verifyDatabasesGone(factory, names).then(function (verification) { databaseVerification = verification; });
      verifyStorageEmpty(local, [GUARD_KEY]);
      var verified = !!(databaseVerification && databaseVerification.verified);
      var unverifiedDetail = 'This browser cannot enumerate IndexedDB databases; every known Sutra database was deleted but completeness could not be verified.';
      if (config.preserveSessionUntilAcknowledged === true) {
        return writeGuard(local, verified ? 'local-verified' : 'local-unverified', verified ? '' : unverifiedDetail);
      }
      session.clear(); // sutra-allow-storage: verified revocation clears auth/provider session material
      verifyStorageEmpty(session, []);
      return writeGuard(local, verified ? 'complete' : 'complete-unverified', verified ? '' : unverifiedDetail);
    } catch (error) {
      try { writeGuard(local, 'cleanup-error', error && error.message ? error.message : 'Cleanup failed.'); } catch (guardError) {}
      throw error;
    }
  }

  function finalize(options) {
    var config = options || {};
    var local = config.localStorage || global.localStorage;
    var session = config.sessionStorage || global.sessionStorage;
    var current = readGuard(local);
    var currentStatus = current && current.status;
    // Server acknowledgement may only terminalize a locally completed wipe.
    // Accept terminal states idempotently for follower tabs that observe the
    // leader's shared localStorage guard after its acknowledgement. Every
    // other or future state remains fail-closed and keeps the auth session so
    // the verified cleanup can be retried.
    if (currentStatus !== 'local-verified' && currentStatus !== 'local-unverified'
      && currentStatus !== 'complete' && currentStatus !== 'complete-unverified') {
      throw new Error('Cannot finalize revocation cleanup from state: ' + String(currentStatus || 'missing'));
    }
    session.clear(); // sutra-allow-storage: server acknowledgement completed; remove auth/provider session material
    verifyStorageEmpty(session, []);
    verifyStorageEmpty(local, [GUARD_KEY]);
    // Preserve the honesty of the underlying cleanup: if this browser could
    // not enumerate databases, the acknowledged terminal state must keep
    // saying so instead of upgrading to an unqualified "complete".
    if (currentStatus === 'complete' || currentStatus === 'complete-unverified') return current;
    var status = currentStatus === 'local-unverified' ? 'complete-unverified' : 'complete';
    return writeGuard(local, status);
  }

  function clearGuard(storage) {
    (storage || global.localStorage).removeItem(GUARD_KEY); // sutra-allow-storage: explicit reuse after verified cleanup
  }

  var api = {
    GUARD_KEY: GUARD_KEY,
    DATABASES: DATABASES,
    readGuard: readGuard,
    writeGuard: writeGuard,
    wipe: wipe,
    finalize: finalize,
    clearGuard: clearGuard,
    _deleteDatabase: deleteDatabase,
    _verifyStorageEmpty: verifyStorageEmpty
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraRevocationWipe = api;
}(typeof window !== 'undefined' ? window : globalThis));
