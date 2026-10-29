/* Device-local credential vault for explicit "remember on this device" opt-ins. */
(function (global) {
  'use strict';

  var DB_NAME = 'sutra_credentials_db';
  var DB_VERSION = 1;
  var META_STORE = 'meta';
  var CREDENTIAL_STORE = 'credentials';
  var KEY_NAME = 'encryptionKey';
  var GUARD_PREFIX = 'writeGuard:';
  var liveDb = null;
  var liveFactory = null;
  var opening = null;
  var keyPromise = null;

  function revocationLocked() {
    try {
      return !!(global.SutraRevocationWipe
        && typeof global.SutraRevocationWipe.readGuard === 'function'
        && global.SutraRevocationWipe.readGuard());
    } catch (error) {
      return true;
    }
  }

  function assertRevocationUnlocked() {
    if (!revocationLocked()) return;
    close();
    throw new Error('Credential vault is unavailable while this device is revoked.');
  }

  function getCrypto() {
    return global.crypto && global.crypto.subtle ? global.crypto : null;
  }

  function getTextEncoder() {
    return typeof global.TextEncoder === 'function' ? new global.TextEncoder() : null;
  }

  function getTextDecoder() {
    return typeof global.TextDecoder === 'function' ? new global.TextDecoder() : null;
  }

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return global.btoa(binary);
  }

  function base64ToBytes(value) {
    var binary = global.atob(String(value || ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function forget(db) {
    if (!db || liveDb === db) {
      liveDb = null;
      liveFactory = null;
    }
    if (!db) opening = null;
  }

  function open() {
    assertRevocationUnlocked();
    var indexedDb = global.indexedDB;
    if (liveDb) {
      if (indexedDb === liveFactory) return Promise.resolve(liveDb);
      close();
    }
    if (opening) return opening;
    if (!indexedDb) return Promise.reject(new Error('IndexedDB unavailable.'));
    var request;
    try { request = indexedDb.open(DB_NAME, DB_VERSION); }
    catch (error) { return Promise.reject(error); }
    opening = new Promise(function (resolve, reject) {
      var settled = false;
      function fail(error) {
        if (settled) return;
        settled = true;
        forget();
        reject(error || new Error('Credential vault could not open.'));
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        if (!db.objectStoreNames.contains(CREDENTIAL_STORE)) db.createObjectStore(CREDENTIAL_STORE);
      };
      request.onblocked = function () { fail(new Error('Credential vault upgrade is blocked by another Sutra tab.')); };
      request.onerror = function () { fail(request.error); };
      request.onsuccess = function () {
        var db = request.result;
        if (settled) { try { db.close(); } catch (error) {} return; }
        if (revocationLocked()) {
          try { db.close(); } catch (error) {}
          fail(new Error('Credential vault is unavailable while this device is revoked.'));
          return;
        }
        settled = true;
        opening = null;
        liveDb = db;
        liveFactory = indexedDb;
        db.onversionchange = function () {
          try { db.close(); } catch (error) {}
          forget(db);
          keyPromise = null;
        };
        resolve(db);
      };
    });
    return opening;
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Credential vault request failed.')); };
    });
  }

  function transactionDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('Credential vault transaction failed.')); };
      tx.onabort = function () { reject(tx.error || new Error('Credential vault transaction aborted.')); };
    });
  }

  async function read(storeName, key) {
    var db = await open();
    assertRevocationUnlocked();
    var tx = db.transaction(storeName, 'readonly');
    var value = await requestResult(tx.objectStore(storeName).get(key));
    return value === undefined ? null : value;
  }

  async function write(storeName, key, value) {
    var db = await open();
    assertRevocationUnlocked();
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    return transactionDone(tx);
  }

  async function remove(storeName, key) {
    var db = await open();
    assertRevocationUnlocked();
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    return transactionDone(tx);
  }

  async function readOrCreateKey(generated) {
    var db = await open();
    assertRevocationUnlocked();
    return new Promise(function (resolve, reject) {
      var tx;
      var selected = generated;
      var settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error('Credential vault key transaction failed.'));
      }

      try {
        // A single readwrite transaction is serialized with the same operation
        // in every other tab. That makes the first committed key authoritative
        // and prevents two tabs from encrypting records with different keys.
        tx = db.transaction(META_STORE, 'readwrite');
        var store = tx.objectStore(META_STORE);
        var request = store.get(KEY_NAME);
        request.onerror = function () {
          try { tx.abort(); } catch (error) {}
          fail(request.error);
        };
        request.onsuccess = function () {
          if (request.result) {
            selected = request.result;
            return;
          }
          try { store.add(generated, KEY_NAME); }
          catch (error) {
            try { tx.abort(); } catch (ignored) {}
            fail(error);
          }
        };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(selected);
        };
        tx.onerror = function () { fail(tx.error); };
        tx.onabort = function () { fail(tx.error || new Error('Credential vault key transaction aborted.')); };
      } catch (error) {
        fail(error);
      }
    });
  }

  async function ensureKey() {
    var cryptoApi = getCrypto();
    if (!cryptoApi) throw new Error('Web Crypto is unavailable.');
    if (keyPromise) return keyPromise;
    keyPromise = (async function () {
      var generated = await cryptoApi.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      return readOrCreateKey(generated);
    })().catch(function (error) {
      keyPromise = null;
      throw error;
    });
    return keyPromise;
  }

  function normalizeGuard(value) {
    var generation = value && Number(value.generation);
    return {
      generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
      blocked: !!(value && value.blocked)
    };
  }

  function guardKey(name) {
    return GUARD_PREFIX + String(name || '').trim();
  }

  async function encryptValue(name, value) {
    var cryptoApi = getCrypto();
    var encoder = getTextEncoder();
    if (!cryptoApi || !encoder) throw new Error('Web Crypto is unavailable.');
    var keyName = String(name || '').trim();
    if (!keyName) throw new Error('Credential name is required.');
    var key = await ensureKey();
    var iv = new Uint8Array(12);
    cryptoApi.getRandomValues(iv);
    var additionalData = encoder.encode(keyName);
    var plaintext = encoder.encode(JSON.stringify(value));
    var ciphertext = await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: additionalData },
      key,
      plaintext
    );
    return {
      keyName: keyName,
      record: {
        version: 1,
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext))
      }
    };
  }

  async function setValue(name, value) {
    var encrypted = await encryptValue(name, value);
    await write(CREDENTIAL_STORE, encrypted.keyName, encrypted.record);
    return true;
  }

  async function getWriteGuard(name) {
    var keyName = String(name || '').trim();
    if (!keyName) throw new Error('Credential name is required.');
    return normalizeGuard(await read(META_STORE, guardKey(keyName)));
  }

  async function setValueGuarded(name, value, expectedGeneration) {
    var encrypted = await encryptValue(name, value);
    var expected = Number(expectedGeneration);
    if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Credential write generation is invalid.');
    var db = await open();
    assertRevocationUnlocked();
    return new Promise(function (resolve, reject) {
      var tx;
      var written = false;
      var settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error('Credential vault guarded write failed.'));
      }

      try {
        tx = db.transaction([META_STORE, CREDENTIAL_STORE], 'readwrite');
        var request = tx.objectStore(META_STORE).get(guardKey(encrypted.keyName));
        request.onerror = function () {
          try { tx.abort(); } catch (error) {}
          fail(request.error);
        };
        request.onsuccess = function () {
          var current = normalizeGuard(request.result);
          if (current.blocked || current.generation !== expected) return;
          tx.objectStore(CREDENTIAL_STORE).put(encrypted.record, encrypted.keyName);
          written = true;
        };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(written);
        };
        tx.onerror = function () { fail(tx.error); };
        tx.onabort = function () { fail(tx.error || new Error('Credential vault guarded write aborted.')); };
      } catch (error) {
        fail(error);
      }
    });
  }

  async function removeValueGuarded(name, expectedGeneration) {
    var keyName = String(name || '').trim();
    if (!keyName) throw new Error('Credential name is required.');
    var expected = Number(expectedGeneration);
    if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Credential write generation is invalid.');
    var db = await open();
    assertRevocationUnlocked();
    return new Promise(function (resolve, reject) {
      var tx;
      var removed = false;
      var settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error('Credential vault guarded removal failed.'));
      }

      try {
        tx = db.transaction([META_STORE, CREDENTIAL_STORE], 'readwrite');
        var request = tx.objectStore(META_STORE).get(guardKey(keyName));
        request.onerror = function () {
          try { tx.abort(); } catch (error) {}
          fail(request.error);
        };
        request.onsuccess = function () {
          var current = normalizeGuard(request.result);
          if (current.blocked || current.generation !== expected) return;
          tx.objectStore(CREDENTIAL_STORE).delete(keyName);
          removed = true;
        };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(removed);
        };
        tx.onerror = function () { fail(tx.error); };
        tx.onabort = function () { fail(tx.error || new Error('Credential vault guarded removal aborted.')); };
      } catch (error) {
        fail(error);
      }
    });
  }

  async function changeWriteGuard(name, blocked) {
    var keyName = String(name || '').trim();
    if (!keyName) throw new Error('Credential name is required.');
    var db = await open();
    assertRevocationUnlocked();
    return new Promise(function (resolve, reject) {
      var tx;
      var nextGeneration = 0;
      var settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error('Credential vault guard update failed.'));
      }

      try {
        tx = db.transaction([META_STORE, CREDENTIAL_STORE], 'readwrite');
        var meta = tx.objectStore(META_STORE);
        var request = meta.get(guardKey(keyName));
        request.onerror = function () {
          try { tx.abort(); } catch (error) {}
          fail(request.error);
        };
        request.onsuccess = function () {
          var current = normalizeGuard(request.result);
          if (current.generation >= Number.MAX_SAFE_INTEGER) {
            try { tx.abort(); } catch (error) {}
            fail(new Error('Credential vault write generation is exhausted.'));
            return;
          }
          nextGeneration = current.generation + 1;
          meta.put({ generation: nextGeneration, blocked: blocked === true }, guardKey(keyName));
          if (blocked === true) tx.objectStore(CREDENTIAL_STORE).delete(keyName);
        };
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(nextGeneration);
        };
        tx.onerror = function () { fail(tx.error); };
        tx.onabort = function () { fail(tx.error || new Error('Credential vault guard update aborted.')); };
      } catch (error) {
        fail(error);
      }
    });
  }

  function blockValue(name) {
    return changeWriteGuard(name, true);
  }

  function unblockValue(name) {
    return changeWriteGuard(name, false);
  }

  function reportVaultIssue(error, where, detail) {
    // Corruption-class vault issues must be diagnosable (audit remediation):
    // they are surfaced through the standard error funnel without blocking the
    // caller, which still receives null exactly as before.
    try {
      if (global && typeof global.SutraReportError === 'function') {
        global.SutraReportError(error, { where: where, name: detail }, 'warning');
        return;
      }
    } catch (_) { /* fall through to console */ }
    try { (console.warn || console.log).call(console, '[sutra:credential-vault]', where, detail, error); } catch (_) {}
  }

  async function getValue(name) {
    var cryptoApi = getCrypto();
    var encoder = getTextEncoder();
    var decoder = getTextDecoder();
    if (!cryptoApi || !encoder || !decoder) return null;
    var keyName = String(name || '').trim();
    if (!keyName) return null;
    var record = await read(CREDENTIAL_STORE, keyName);
    if (!record) return null;
    if (record.version !== 1 || !record.iv || !record.ciphertext) {
      // A present-but-malformed record is corruption, not "never saved".
      reportVaultIssue(new Error('Stored credential record is malformed.'), 'credential-vault.getValue.malformed', keyName);
      return null;
    }
    try {
      var plaintext = await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(record.iv), additionalData: encoder.encode(keyName) },
        await ensureKey(),
        base64ToBytes(record.ciphertext)
      );
      return JSON.parse(decoder.decode(plaintext));
    } catch (error) {
      // A corrupted or unrecoverable secret must not block the workspace,
      // but the loss must not be indistinguishable from "never saved".
      reportVaultIssue(error, 'credential-vault.getValue.decrypt', keyName);
      return null;
    }
  }

  async function setPreference(name, value) {
    return setValue('preference:' + String(name || ''), value === true);
  }

  async function getPreference(name, fallback) {
    var value = await getValue('preference:' + String(name || ''));
    return value === null || value === undefined ? fallback : value === true;
  }

  async function clearValue(name) {
    var keyName = String(name || '').trim();
    if (!keyName) return false;
    await remove(CREDENTIAL_STORE, keyName);
    return true;
  }

  async function clearAll() {
    var db = await open();
    assertRevocationUnlocked();
    var tx = db.transaction([META_STORE, CREDENTIAL_STORE], 'readwrite');
    tx.objectStore(META_STORE).clear();
    tx.objectStore(CREDENTIAL_STORE).clear();
    await transactionDone(tx);
    keyPromise = null;
    return true;
  }

  function close() {
    if (liveDb) {
      try { liveDb.close(); } catch (error) {}
    }
    liveDb = null;
    liveFactory = null;
    opening = null;
    keyPromise = null;
  }

  var api = {
    set: setValue,
    setGuarded: setValueGuarded,
    removeGuarded: removeValueGuarded,
    get: getValue,
    remove: clearValue,
    getWriteGuard: getWriteGuard,
    block: blockValue,
    unblock: unblockValue,
    clearAll: clearAll,
    setPreference: setPreference,
    getPreference: getPreference,
    close: close,
    DB_NAME: DB_NAME
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraCredentialVault = api;
}(typeof window !== 'undefined' ? window : globalThis));
