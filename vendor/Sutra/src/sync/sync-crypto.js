/*
 * Sutra Sync vault crypto — vault master key generation, passphrase
 * wrapping (PBKDF2-HMAC-SHA-256, 600k iterations), and AES-GCM-256
 * envelopes for ops, snapshots, and asset bytes with AAD-bound routing
 * metadata. This is a NEW pure WebCrypto module — deliberately not an
 * extraction of the `.sutra` backup crypto that lives inside app.js.
 * Spec: docs/architecture/SYNC_PROTOCOL.md §5.
 */
(function (global) {
  'use strict';

  var protocolApi = (typeof module !== 'undefined' && module.exports)
    ? require('./sync-protocol.js')
    : global.SutraSyncProtocol;

  var VAULT_KEY_BYTES = 32;
  var KDF_ITERATIONS = 600000;
  var KDF_MIN_ITERATIONS = 1000;
  var KDF_MAX_ITERATIONS = 2000000;
  var KDF_SALT_BYTES = 16;
  var GCM_IV_BYTES = 12;
  var GCM_TAG_BITS = 128;
  var VAULT_WRAP_AAD = 'sutra-sync-vault:v1';
  var SNAPSHOT_AAD_PREFIX = 'sutra-sync-snapshot:v1';
  var ASSET_AAD_PREFIX = 'sutra-sync-asset:v1:';

  function SyncVaultUnlockError(message, code) {
    var error = new Error(message || 'Could not unlock the sync vault. The passphrase is wrong or the key data is damaged.');
    error.name = 'SyncVaultUnlockError';
    error.code = code || 'vault-unlock-failed';
    return error;
  }

  function getCrypto() {
    var cryptoObj = (global && global.crypto) || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('WebCrypto (crypto.subtle) is unavailable.');
    return cryptoObj;
  }

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    getCrypto().getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(view).toString('base64');
    }
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(base64) {
    var text = String(base64 || '');
    if (!text || text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
      throw new Error('Invalid base64 encoding.');
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return new Uint8Array(Buffer.from(text, 'base64'));
    }
    var binary = global.atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToHex(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = '';
    for (var i = 0; i < view.length; i += 1) out += view[i].toString(16).padStart(2, '0');
    return out;
  }

  async function vaultKeyId(vaultKeyBytes) {
    var digest = await getCrypto().subtle.digest('SHA-256', vaultKeyBytes);
    return bytesToHex(new Uint8Array(digest));
  }

  function requireByteLength(label, encoded, expected) {
    var bytes = base64ToBytes(encoded);
    if (bytes.length !== expected) throw new Error(label + ' must decode to ' + expected + ' bytes.');
    return bytes;
  }

  function requireCiphertext(encoded, minimumBytes) {
    var bytes = base64ToBytes(encoded);
    if (bytes.length < minimumBytes) throw new Error('Ciphertext is too short.');
    return bytes;
  }

  function encodeText(text) {
    return new TextEncoder().encode(String(text));
  }

  function generateVaultKeyBytes() {
    return randomBytes(VAULT_KEY_BYTES);
  }

  async function importVaultKey(vaultKeyBytes) {
    if (!(vaultKeyBytes instanceof Uint8Array) || vaultKeyBytes.length !== VAULT_KEY_BYTES) {
      throw new Error('Vault key must be ' + VAULT_KEY_BYTES + ' random bytes.');
    }
    return getCrypto().subtle.importKey(
      'raw', vaultKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
  }

  async function deriveWrappingKey(passphrase, saltBytes, iterations) {
    var subtle = getCrypto().subtle;
    var material = await subtle.importKey('raw', encodeText(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Wrap the raw vault key under a passphrase-derived key. Only the wrapped
  // blob + public KDF params ever persist (locally and, later, server-side
  // for new-device bootstrap).
  async function wrapVaultKey(vaultKeyBytes, passphrase, options) {
    if (typeof passphrase !== 'string' || passphrase.length < 1) {
      throw new Error('A sync passphrase is required.');
    }
    var config = options || {};
    var iterations = Number.isInteger(config.iterations) ? config.iterations : KDF_ITERATIONS;
    if (iterations < KDF_MIN_ITERATIONS || iterations > KDF_MAX_ITERATIONS) {
      throw new Error('KDF iteration count is outside the supported range.');
    }
    var salt = randomBytes(KDF_SALT_BYTES);
    var iv = randomBytes(GCM_IV_BYTES);
    var keyId = await vaultKeyId(vaultKeyBytes);
    var wrappingKey = await deriveWrappingKey(passphrase, salt, iterations);
    var wrapped = await getCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: encodeText(VAULT_WRAP_AAD + ':' + keyId), tagLength: GCM_TAG_BITS },
      wrappingKey,
      vaultKeyBytes
    );
    return {
      v: 1,
      keyId: keyId,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: iterations,
        salt: bytesToBase64(salt)
      },
      iv: bytesToBase64(iv),
      wrapped: bytesToBase64(new Uint8Array(wrapped))
    };
  }

  // Returns the raw vault key bytes (needed for passphrase rewrap), or
  // throws SyncVaultUnlockError. GCM auth failure cannot distinguish a wrong
  // passphrase from tampered data.
  async function unwrapVaultKeyBytes(blob, passphrase) {
    if (!blob || typeof blob !== 'object' || blob.v !== 1 || !blob.kdf
      || blob.kdf.name !== 'PBKDF2' || blob.kdf.hash !== 'SHA-256'
      || !/^[0-9a-f]{64}$/.test(String(blob.keyId || ''))) {
      throw new Error('Unrecognized wrapped vault key format.');
    }
    var iterations = Number(blob.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < KDF_MIN_ITERATIONS || iterations > KDF_MAX_ITERATIONS) {
      throw new Error('Invalid KDF iteration count.');
    }
    var salt = requireByteLength('KDF salt', blob.kdf.salt, KDF_SALT_BYTES);
    var iv = requireByteLength('Wrapped-key IV', blob.iv, GCM_IV_BYTES);
    var ciphertext = requireByteLength('Wrapped vault key', blob.wrapped, VAULT_KEY_BYTES + (GCM_TAG_BITS / 8));
    var wrappingKey = await deriveWrappingKey(passphrase, salt, iterations);
    var vaultKeyBytes;
    try {
      vaultKeyBytes = await getCrypto().subtle.decrypt(
        { name: 'AES-GCM', iv: iv, additionalData: encodeText(VAULT_WRAP_AAD + ':' + blob.keyId), tagLength: GCM_TAG_BITS },
        wrappingKey,
        ciphertext
      );
    } catch (error) {
      throw SyncVaultUnlockError();
    }
    var raw = new Uint8Array(vaultKeyBytes);
    if (raw.length !== VAULT_KEY_BYTES || await vaultKeyId(raw) !== blob.keyId) throw SyncVaultUnlockError();
    return raw;
  }

  // Returns a non-extractable AES-GCM CryptoKey for session use.
  async function unwrapVaultKey(blob, passphrase) {
    return importVaultKey(await unwrapVaultKeyBytes(blob, passphrase));
  }

  async function encryptWithAad(vaultKey, plaintextBytes, aadText) {
    var iv = randomBytes(GCM_IV_BYTES);
    var ct = await getCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: encodeText(aadText), tagLength: GCM_TAG_BITS },
      vaultKey,
      plaintextBytes
    );
    return { iv: iv, ct: new Uint8Array(ct) };
  }

  async function decryptWithAad(vaultKey, ivBase64, ctBase64, aadText) {
    try {
      var iv = requireByteLength('AES-GCM IV', ivBase64, GCM_IV_BYTES);
      var ciphertext = requireCiphertext(ctBase64, GCM_TAG_BITS / 8);
      var plain = await getCrypto().subtle.decrypt(
        { name: 'AES-GCM', iv: iv, additionalData: encodeText(aadText), tagLength: GCM_TAG_BITS },
        vaultKey,
        ciphertext
      );
      return new Uint8Array(plain);
    } catch (error) {
      throw SyncVaultUnlockError('Could not decrypt sync data. It was created with a different key or has been tampered with.', 'encryption-error');
    }
  }

  // Op envelope: the clear `meta` routing fields the server sees are bound
  // as AAD, so relabeled/rerouted envelopes fail decryption.
  async function encryptOpEnvelope(vaultKey, op) {
    var opErrors = protocolApi.validateOp(op);
    if (opErrors.length) throw new Error('Refusing to encrypt malformed op: ' + opErrors.join('; '));
    var meta = protocolApi.envelopeMeta(op);
    var aad = protocolApi.stableStringify(meta);
    var sealed = await encryptWithAad(vaultKey, encodeText(protocolApi.stableStringify(op)), aad);
    return {
      v: 1,
      alg: 'A256GCM',
      iv: bytesToBase64(sealed.iv),
      ct: bytesToBase64(sealed.ct),
      meta: meta
    };
  }

  async function decryptOpEnvelope(vaultKey, envelope) {
    var envelopeErrors = protocolApi.validateEnvelope(envelope);
    if (envelopeErrors.length) throw new Error('Malformed sync envelope: ' + envelopeErrors.join('; '));
    var aad = protocolApi.stableStringify(envelope.meta);
    var plainBytes = await decryptWithAad(vaultKey, envelope.iv, envelope.ct, aad);
    var op = JSON.parse(new TextDecoder().decode(plainBytes));
    if (op.opId !== envelope.meta.opId || op.deviceId !== envelope.meta.deviceId
      || op.lamport !== envelope.meta.lamport || op.recordKey !== envelope.meta.recordKey
      || op.kind !== envelope.meta.kind || op.protocolVersion !== envelope.meta.protocolVersion
      || op.schemaVersion !== envelope.meta.schemaVersion) {
      throw SyncVaultUnlockError('Sync envelope metadata does not match its contents.', 'encryption-error');
    }
    var opErrors = protocolApi.validateOp(op);
    if (opErrors.length) throw new Error('Decrypted op failed validation: ' + opErrors.join('; '));
    return op;
  }

  // Snapshot envelope: whole-projection compaction payloads (§10).
  async function encryptSnapshotEnvelope(vaultKey, snapshotValue, meta) {
    var cleanMeta = {
      type: 'snapshot',
      cursor: Number(meta && meta.cursor) || 0,
      protocolVersion: protocolApi.PROTOCOL_VERSION,
      schemaVersion: Number(meta && meta.schemaVersion) || 0
    };
    var aad = SNAPSHOT_AAD_PREFIX + ':' + protocolApi.stableStringify(cleanMeta);
    var sealed = await encryptWithAad(vaultKey, encodeText(protocolApi.stableStringify(snapshotValue)), aad);
    return { v: 1, alg: 'A256GCM', iv: bytesToBase64(sealed.iv), ct: bytesToBase64(sealed.ct), meta: cleanMeta };
  }

  async function decryptSnapshotEnvelope(vaultKey, envelope) {
    if (!envelope || envelope.v !== 1 || envelope.alg !== 'A256GCM'
      || !envelope.meta || envelope.meta.type !== 'snapshot'
      || envelope.meta.protocolVersion !== protocolApi.PROTOCOL_VERSION
      || !Number.isInteger(envelope.meta.schemaVersion) || envelope.meta.schemaVersion < 1
      || !Number.isInteger(envelope.meta.cursor) || envelope.meta.cursor < 0) {
      throw new Error('Malformed snapshot envelope.');
    }
    var aad = SNAPSHOT_AAD_PREFIX + ':' + protocolApi.stableStringify(envelope.meta);
    var plainBytes = await decryptWithAad(vaultKey, envelope.iv, envelope.ct, aad);
    return JSON.parse(new TextDecoder().decode(plainBytes));
  }

  // Asset envelope: raw bytes, AAD-bound to the plaintext content hash so a
  // swapped blob fails decryption (§ Phase C).
  async function encryptAssetBytes(vaultKey, bytes, contentHash) {
    if (!(bytes instanceof Uint8Array)) throw new Error('Asset bytes must be a Uint8Array.');
    if (!/^[0-9a-f]{64}$/.test(String(contentHash || ''))) throw new Error('Asset content hash is malformed.');
    var sealed = await encryptWithAad(vaultKey, bytes, ASSET_AAD_PREFIX + String(contentHash));
    return { v: 1, alg: 'A256GCM', iv: bytesToBase64(sealed.iv), ct: bytesToBase64(sealed.ct), hash: String(contentHash) };
  }

  async function decryptAssetBytes(vaultKey, envelope) {
    if (!envelope || envelope.v !== 1 || envelope.alg !== 'A256GCM'
      || !/^[0-9a-f]{64}$/.test(String(envelope.hash || ''))) throw new Error('Malformed asset envelope.');
    return decryptWithAad(vaultKey, envelope.iv, envelope.ct, ASSET_AAD_PREFIX + String(envelope.hash));
  }

  function buildRecoveryKitText(wrappedBlob, context) {
    var info = context || {};
    return [
      'SUTRA SYNC RECOVERY KIT',
      '=======================',
      '',
      'Created: ' + (info.createdAt || '(unknown)'),
      'Account: ' + (info.accountLabel || '(not recorded)'),
      '',
      'This file plus your sync passphrase can unlock your encrypted sync',
      'vault on a new device. Without your passphrase OR this kit, nobody —',
      'including Sutra — can recover your synced data. Store it somewhere',
      'safe (password manager, printed copy).',
      '',
      'Wrapped vault key (JSON):',
      JSON.stringify(wrappedBlob),
      ''
    ].join('\n');
  }

  function parseRecoveryKitText(text) {
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (line.indexOf('{') === 0) {
        try {
          var parsed = JSON.parse(line);
          if (parsed && parsed.v === 1 && parsed.kdf && parsed.wrapped) return parsed;
        } catch (error) { /* keep scanning */ }
      }
    }
    return null;
  }

  var api = {
    VAULT_KEY_BYTES: VAULT_KEY_BYTES,
    KDF_ITERATIONS: KDF_ITERATIONS,
    KDF_MIN_ITERATIONS: KDF_MIN_ITERATIONS,
    KDF_MAX_ITERATIONS: KDF_MAX_ITERATIONS,
    SyncVaultUnlockError: SyncVaultUnlockError,
    generateVaultKeyBytes: generateVaultKeyBytes,
    importVaultKey: importVaultKey,
    wrapVaultKey: wrapVaultKey,
    unwrapVaultKey: unwrapVaultKey,
    unwrapVaultKeyBytes: unwrapVaultKeyBytes,
    encryptOpEnvelope: encryptOpEnvelope,
    decryptOpEnvelope: decryptOpEnvelope,
    encryptSnapshotEnvelope: encryptSnapshotEnvelope,
    decryptSnapshotEnvelope: decryptSnapshotEnvelope,
    encryptAssetBytes: encryptAssetBytes,
    decryptAssetBytes: decryptAssetBytes,
    buildRecoveryKitText: buildRecoveryKitText,
    parseRecoveryKitText: parseRecoveryKitText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncCrypto = api;
}(typeof window !== 'undefined' ? window : globalThis));
