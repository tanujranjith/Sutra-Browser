/*
 * Sutra Sync transport — the transport interface contract, an in-memory
 * reference server (reused by unit tests AND the e2e mock HTTP layer), a
 * direct memory transport, and a REST transport that speaks the Supabase
 * RPC surface (`/rest/v1/rpc/sync_*`). Pure module: fetch is injected.
 * Spec: docs/architecture/SYNC_PROTOCOL.md §7.
 */
(function (global) {
  'use strict';

  var protocolApi = (typeof module !== 'undefined' && module.exports)
    ? require('./sync-protocol.js')
    : global.SutraSyncProtocol;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  var DEVICE_STATUS_CONTRACT = 'sutra-device-status-v1';

  function normalizeProjectUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  function requireOpaqueAssetHash(value) {
    var hash = String(value || '');
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error('Sutra Sync asset references must use a SHA-256 content hash.');
    }
    return hash;
  }

  function requireEncryptedAssetEnvelope(envelope, expectedHash) {
    var value = envelope || {};
    var iv = String(value.iv || '');
    var ciphertext = String(value.ct || '');
    var isBase64 = function (text) {
      return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
    };
    if (value.v !== 1 || value.alg !== 'A256GCM'
      || iv.length !== 16 || !isBase64(iv)
      || ciphertext.length < 24 || !isBase64(ciphertext)
      || String(value.hash || '') !== expectedHash) {
      throw new Error('Sutra Sync refuses to upload a malformed or unencrypted asset envelope.');
    }
    return value;
  }

  // A wipe instruction is accepted only from the dedicated authenticated
  // status RPC, for this exact user/device and configured Supabase project.
  // Generic 401/403/revoked errors are intentionally insufficient.
  function validateVerifiedWipeInstruction(result, expected) {
    var data = result || {};
    var binding = expected || {};
    return data.ok === false
      && data.contract === DEVICE_STATUS_CONTRACT
      && data.code === 'DEVICE_REVOKED'
      && data.wipeRequired === true
      && String(data.userId || '') === String(binding.userId || '')
      && String(data.deviceId || '') === String(binding.deviceId || '')
      && normalizeProjectUrl(binding.actualProjectUrl) !== ''
      && normalizeProjectUrl(binding.actualProjectUrl) === normalizeProjectUrl(binding.expectedProjectUrl);
  }

  // ------------------------------------------------------------------
  // Reference server: authoritative op log + cursor + opId dedupe +
  // wrapped vault key + snapshot + assets + device registry. This is the
  // semantic model the real Supabase schema/RPCs implement.
  // ------------------------------------------------------------------
  function createMemoryServer(options) {
    var config = options || {};
    var maxPullRows = Number(config.maxPullRows) > 0 ? Number(config.maxPullRows) : 500;
    var state = {
      ops: [],            // [{ seq, envelope }]
      seenOpIds: {},      // opId -> seq
      head: 0,
      vaultKey: null,     // wrapped blob
      snapshot: null,     // { envelope, cursor }
      assets: {},         // hash -> asset envelope
      pushedSequences: {}, // deviceId -> greatest accepted Lamport, retained across pruning
      devices: {},        // deviceId -> { deviceId, label, lastSeenCursor, revokedAt, wipeRequired, wipeAcknowledgedAt }
      userId: String(config.userId || 'memory-user')
    };
    var stats = { pullCalls: 0, pushCalls: 0, rejectedStaleCursor: 0, dedupedOps: 0 };

    function deviceRevoked(deviceId) {
      var device = deviceId ? state.devices[deviceId] : null;
      return !!(device && device.revokedAt);
    }

    function touchDevice(input) {
      var body = input || {};
      if (!body.deviceId) return { ok: false, code: 'bad-request' };
      var existing = state.devices[body.deviceId] || {
        deviceId: String(body.deviceId), label: '', lastSeenCursor: 0,
        revokedAt: null, revokedBy: null, wipeRequired: false, wipeAcknowledgedAt: null
      };
      if (existing.revokedAt) return { ok: false, code: 'revoked' };
      if (body.label !== undefined) existing.label = String(body.label);
      if (body.cursor !== undefined) {
        var cursor = Number(body.cursor);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.head) {
          return { ok: false, code: 'bad-cursor' };
        }
        existing.lastSeenCursor = Math.max(Number(existing.lastSeenCursor) || 0, cursor);
      }
      state.devices[body.deviceId] = existing;
      return { ok: true, device: clone(existing) };
    }

    function pull(input) {
      stats.pullCalls += 1;
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      var after = Number(body.cursor) || 0;
      var out = [];
      for (var i = 0; i < state.ops.length && out.length < maxPullRows; i += 1) {
        if (state.ops[i].seq > after) out.push(clone(state.ops[i].envelope));
      }
      var cursor = out.length
        ? state.seenOpIds[out[out.length - 1].meta.opId]
        : Math.min(after, state.head) || after;
      return { ok: true, ops: out, cursor: out.length ? cursor : after };
    }

    function push(input) {
      stats.pushCalls += 1;
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      var expected = Number(body.cursor) || 0;
      var envelopes = Array.isArray(body.ops) ? body.ops : [];
      var fresh = [];
      for (var i = 0; i < envelopes.length; i += 1) {
        var envelope = envelopes[i];
        var errors = protocolApi.validateEnvelope(envelope);
        if (errors.length) return { ok: false, code: 'invalid-envelope', detail: errors.join('; ') };
        if (Object.prototype.hasOwnProperty.call(state.seenOpIds, envelope.meta.opId)) {
          var existingSeq = state.seenOpIds[envelope.meta.opId];
          var existingOp = state.ops.find(function (entry) { return entry.seq === existingSeq; });
          if (!existingOp || protocolApi.stableStringify(existingOp.envelope) !== protocolApi.stableStringify(envelope)) {
            return { ok: false, code: 'op-id-collision' };
          }
          stats.dedupedOps += 1;
          continue;
        }
        var hasDeviceFloor = Object.prototype.hasOwnProperty.call(state.pushedSequences, envelope.meta.deviceId);
        var deviceFloor = hasDeviceFloor ? Number(state.pushedSequences[envelope.meta.deviceId]) : -1;
        if (Number(envelope.meta.lamport) <= deviceFloor) {
          return { ok: false, code: 'device-sequence-collision' };
        }
        fresh.push(envelope);
      }
      // Idempotent retry: a push whose every op is already stored succeeds
      // without a cursor check (the ack was lost, nothing new to append).
      // The ack cursor is the max sequence AMONG THE ACKED OPS — acking the
      // vault head could silently skip other devices' unpulled ops.
      if (fresh.length === 0) {
        var ackedMax = Number(body.cursor) || 0;
        for (var a = 0; a < envelopes.length; a += 1) {
          var seq = state.seenOpIds[envelopes[a].meta.opId];
          if (Number(seq) > ackedMax) ackedMax = Number(seq);
        }
        return { ok: true, cursor: ackedMax };
      }
      if (expected !== state.head) {
        stats.rejectedStaleCursor += 1;
        return { ok: false, code: 'stale-cursor', cursor: state.head };
      }
      for (var f = 0; f < fresh.length; f += 1) {
        state.head += 1;
        state.ops.push({ seq: state.head, envelope: clone(fresh[f]) });
        state.seenOpIds[fresh[f].meta.opId] = state.head;
        state.pushedSequences[fresh[f].meta.deviceId] = Math.max(
          Number(state.pushedSequences[fresh[f].meta.deviceId]) || 0,
          Number(fresh[f].meta.lamport) || 0
        );
      }
      return { ok: true, cursor: state.head };
    }

    function ping(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      return { ok: true };
    }

    function getVaultKey(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      return state.vaultKey ? { ok: true, wrapped: clone(state.vaultKey) } : { ok: true, wrapped: null };
    }
    function putVaultKey(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      if (!body.wrapped || typeof body.wrapped !== 'object') return { ok: false, code: 'bad-request' };
      if (state.vaultKey) {
        if (protocolApi.stableStringify(state.vaultKey) === protocolApi.stableStringify(body.wrapped)) return { ok: true };
        var expectedMatches = body.expectedWrapped
          && protocolApi.stableStringify(state.vaultKey) === protocolApi.stableStringify(body.expectedWrapped);
        var sameKeyId = state.vaultKey.keyId && state.vaultKey.keyId === body.wrapped.keyId;
        if (!expectedMatches || !sameKeyId) return { ok: false, code: 'key-conflict' };
      } else if (body.expectedWrapped) {
        return { ok: false, code: 'key-conflict' };
      }
      state.vaultKey = clone(body.wrapped);
      return { ok: true };
    }

    function getSnapshot(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      return state.snapshot
        ? { ok: true, snapshot: clone(state.snapshot.envelope), cursor: state.snapshot.cursor }
        : { ok: true, snapshot: null, cursor: 0 };
    }
    function putSnapshot(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      if (!body.snapshot) return { ok: false, code: 'bad-request' };
      if (Number(body.cursor) > state.head || Number(body.snapshot.meta && body.snapshot.meta.cursor) !== Number(body.cursor)) {
        return { ok: false, code: 'invalid-snapshot-cursor' };
      }
      state.snapshot = { envelope: clone(body.snapshot), cursor: Number(body.cursor) || 0 };
      return { ok: true };
    }

    function pruneOps(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      if (!state.snapshot) return { ok: true, pruned: 0, reason: 'no-snapshot' };
      var activeDevices = Object.keys(state.devices)
        .map(function (id) { return state.devices[id]; })
        .filter(function (device) { return device && !device.revokedAt; });
      if (!activeDevices.length) return { ok: true, pruned: 0, reason: 'no-floor' };
      var minDeviceCursor = Math.min.apply(null, activeDevices.map(function (device) {
        return Number(device.lastSeenCursor) || 0;
      }));
      var floor = Math.min(Number(state.snapshot.cursor) || 0, minDeviceCursor);
      if (floor <= 0) return { ok: true, pruned: 0, reason: 'no-floor' };
      var retained = [];
      var pruned = 0;
      for (var i = 0; i < state.ops.length; i += 1) {
        if (state.ops[i].seq <= floor) {
          delete state.seenOpIds[state.ops[i].envelope.meta.opId];
          pruned += 1;
        } else {
          retained.push(state.ops[i]);
        }
      }
      state.ops = retained;
      return { ok: true, pruned: pruned, floor: floor };
    }

    function putAsset(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      if (!body.hash || !body.envelope) return { ok: false, code: 'bad-request' };
      state.assets[String(body.hash)] = clone(body.envelope); // idempotent by content hash
      return { ok: true };
    }
    function getAsset(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      var hash = String(body.hash || '');
      return Object.prototype.hasOwnProperty.call(state.assets, hash)
        ? { ok: true, envelope: clone(state.assets[hash]) }
        : { ok: true, envelope: null };
    }
    function hasAsset(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      var hash = String(body.hash || '');
      return { ok: true, present: Object.prototype.hasOwnProperty.call(state.assets, hash) };
    }

    function listAssets(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      return { ok: true, hashes: Object.keys(state.assets).sort() };
    }

    function listDevices(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      return { ok: true, devices: Object.keys(state.devices).sort().map(function (id) { return clone(state.devices[id]); }) };
    }
    function deleteVault(input) {
      if (deviceRevoked((input || {}).deviceId)) return { ok: false, code: 'revoked' };
      state.ops = [];
      state.seenOpIds = {};
      state.head = 0;
      state.vaultKey = null;
      state.snapshot = null;
      state.assets = {};
      state.pushedSequences = {};
      state.devices = {};
      return { ok: true };
    }
    // Takes targetDeviceId (NOT deviceId — transports inject the CALLER's
    // deviceId into every body, which must never masquerade as the target).
    function revokeDevice(input) {
      var body = input || {};
      if (deviceRevoked(body.deviceId)) return { ok: false, code: 'revoked' };
      var device = state.devices[String(body.targetDeviceId || '')];
      if (!device) return { ok: false, code: 'not-found' };
      device.revokedAt = String(body.at || 'revoked');
      device.revokedBy = state.userId;
      device.wipeRequired = true;
      device.wipeAcknowledgedAt = null;
      return { ok: true, wipeRequired: true };
    }

    function getDeviceStatus(input) {
      var body = input || {};
      var device = state.devices[String(body.deviceId || '')];
      if (!device) return { ok: false, code: 'DEVICE_UNKNOWN', contract: DEVICE_STATUS_CONTRACT };
      if (device.revokedAt) {
        return {
          ok: false,
          code: 'DEVICE_REVOKED',
          contract: DEVICE_STATUS_CONTRACT,
          userId: state.userId,
          deviceId: device.deviceId,
          wipeRequired: device.wipeRequired === true,
          revokedAt: device.revokedAt,
          wipeAcknowledgedAt: device.wipeAcknowledgedAt || null
        };
      }
      return {
        ok: true,
        contract: DEVICE_STATUS_CONTRACT,
        userId: state.userId,
        deviceId: device.deviceId,
        wipeRequired: false,
        state: 'active'
      };
    }

    function acknowledgeDeviceWipe(input) {
      var body = input || {};
      var device = state.devices[String(body.deviceId || '')];
      if (!device || !device.revokedAt || device.wipeRequired !== true) {
        return { ok: false, code: 'not-found' };
      }
      device.wipeAcknowledgedAt = String(body.at || new Date().toISOString());
      return { ok: true, acknowledgedAt: device.wipeAcknowledgedAt };
    }

    // The RPC dispatch used by the e2e HTTP mock: one name → one handler.
    var rpc = {
      sync_ping: ping,
      sync_pull: pull,
      sync_push: push,
      sync_get_vault_key: getVaultKey,
      sync_put_vault_key: putVaultKey,
      sync_get_snapshot: getSnapshot,
      sync_put_snapshot: putSnapshot,
      sync_prune_ops: pruneOps,
      sync_put_asset: putAsset,
      sync_get_asset: getAsset,
      sync_has_asset: hasAsset,
      sync_list_assets: listAssets,
      sync_list_devices: listDevices,
      sync_touch_device: touchDevice,
      sync_revoke_device: revokeDevice,
      sync_get_device_status: getDeviceStatus,
      sync_acknowledge_device_wipe: acknowledgeDeviceWipe,
      sync_delete_vault: deleteVault
    };

    function handleRpc(name, body) {
      var handler = rpc[String(name)];
      if (!handler) return { status: 404, body: { ok: false, code: 'unknown-rpc' } };
      var result = handler(body || {});
      return { status: result && result.ok === false ? 409 : 200, body: result };
    }

    return {
      state: state,
      stats: stats,
      pull: pull,
      push: push,
      ping: ping,
      getVaultKey: getVaultKey,
      putVaultKey: putVaultKey,
      getSnapshot: getSnapshot,
      putSnapshot: putSnapshot,
      pruneOps: pruneOps,
      putAsset: putAsset,
      getAsset: getAsset,
      hasAsset: hasAsset,
      listAssets: listAssets,
      listDevices: listDevices,
      touchDevice: touchDevice,
      revokeDevice: revokeDevice,
      getDeviceStatus: getDeviceStatus,
      acknowledgeDeviceWipe: acknowledgeDeviceWipe,
      deleteVault: deleteVault,
      handleRpc: handleRpc
    };
  }

  // ------------------------------------------------------------------
  // Direct in-process transport over a memory server (unit tests, and the
  // engine's dependency-injection seam).
  // ------------------------------------------------------------------
  function createMemoryTransport(server, options) {
    var config = options || {};
    var deviceId = config.deviceId ? String(config.deviceId) : null;

    function call(fn, body) {
      var result = fn(Object.assign({}, body || {}, deviceId ? { deviceId: deviceId } : {}));
      if (result && result.ok === false) {
        return Promise.resolve(result);
      }
      return Promise.resolve(result);
    }

    return {
      kind: 'memory',
      pull: function (input) { return call(server.pull, input); },
      push: function (input) { return call(server.push, input); },
      ping: function () { return call(server.ping, {}); },
      getVaultKey: function () { return call(server.getVaultKey, {}); },
      putVaultKey: function (input) { return call(server.putVaultKey, input); },
      getSnapshot: function () { return call(server.getSnapshot, {}); },
      putSnapshot: function (input) { return call(server.putSnapshot, input); },
      pruneOps: function () { return call(server.pruneOps, {}); },
      putAsset: function (input) { return call(server.putAsset, input); },
      getAsset: function (input) { return call(server.getAsset, input); },
      hasAsset: function (input) { return call(server.hasAsset, input); },
      listAssets: function () { return call(server.listAssets, {}); },
      listDevices: function () { return call(server.listDevices, {}); },
      touchDevice: function (input) { return call(server.touchDevice, input); },
      revokeDevice: function (input) { return call(server.revokeDevice, input); },
      getDeviceStatus: function () { return call(server.getDeviceStatus, {}); },
      acknowledgeDeviceWipe: function (input) { return call(server.acknowledgeDeviceWipe, input); },
      deleteVault: function () { return call(server.deleteVault, {}); }
    };
  }

  // ------------------------------------------------------------------
  // REST transport speaking the Supabase RPC surface. Works against the
  // e2e mock (context.route) today and a real Supabase project in Phase B
  // (same URL shapes, auth headers injected by the caller).
  // ------------------------------------------------------------------
  function createRestTransport(options) {
    var config = options || {};
    var baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('createRestTransport requires a baseUrl.');
    var fetchImpl = config.fetchImpl || (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);
    if (!fetchImpl) throw new Error('createRestTransport requires a fetch implementation.');
    var getAuthHeaders = typeof config.getAuthHeaders === 'function'
      ? config.getAuthHeaders
      : function () { return {}; };
    var deviceId = config.deviceId ? String(config.deviceId) : null;

    async function rpc(name, body) {
      var headers = Object.assign(
        { 'Content-Type': 'application/json' },
        await getAuthHeaders()
      );
      // Sync RPC ownership is server-derived from auth.uid(). Strip legacy or
      // forged ownership hints before they reach PostgREST so no caller can
      // accidentally create a misleading alternate contract around user ids.
      var input = Object.assign({}, body || {});
      delete input.userId;
      delete input.user_id;
      delete input.ownerId;
      delete input.owner_id;
      var payload = Object.assign({}, input, deviceId ? { deviceId: deviceId } : {});
      var response = await fetchImpl(baseUrl + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
      var data = null;
      try { data = await response.json(); } catch (error) { data = null; }
      if (!response.ok && (!data || data.ok === undefined)) {
        var httpError = new Error('Sync transport HTTP ' + response.status + ' on ' + name);
        httpError.status = response.status;
        if (response.status === 401 || response.status === 403) httpError.code = 'auth-expired';
        else if (response.status === 413 || response.status === 507) httpError.code = 'quota-exceeded';
        else if (response.status === 404) httpError.code = 'schema-mismatch';
        throw httpError;
      }
      return data;
    }

    return {
      kind: 'rest',
      projectUrl: baseUrl,
      pull: function (input) { return rpc('sync_pull', input); },
      push: function (input) { return rpc('sync_push', input); },
      ping: function () { return rpc('sync_ping', {}); },
      getVaultKey: function () { return rpc('sync_get_vault_key', {}); },
      putVaultKey: function (input) { return rpc('sync_put_vault_key', input); },
      getSnapshot: function () { return rpc('sync_get_snapshot', {}); },
      putSnapshot: function (input) { return rpc('sync_put_snapshot', input); },
      pruneOps: function () { return rpc('sync_prune_ops', {}); },
      putAsset: function (input) { return rpc('sync_put_asset', input); },
      getAsset: function (input) { return rpc('sync_get_asset', input); },
      hasAsset: function (input) { return rpc('sync_has_asset', input); },
      listAssets: function () { return rpc('sync_list_assets', {}); },
      listDevices: function () { return rpc('sync_list_devices', {}); },
      touchDevice: function (input) { return rpc('sync_touch_device', input); },
      revokeDevice: function (input) { return rpc('sync_revoke_device', input); },
      getDeviceStatus: function () { return rpc('sync_get_device_status', {}); },
      acknowledgeDeviceWipe: function (input) { return rpc('sync_acknowledge_device_wipe', input); },
      deleteVault: function () { return rpc('sync_delete_vault', {}); }
    };
  }

  // Real Supabase project transport: the sync RPCs (supabase/sync-schema.sql)
  // return the exact same JSON shapes as the mock, so this is the REST
  // transport plus Supabase auth headers (public anon key + user bearer).
  function createSupabaseTransport(options) {
    var config = options || {};
    var anonKey = String(config.anonKey || '');
    if (!anonKey) throw new Error('createSupabaseTransport requires the public anon key.');
    var getAccessToken = typeof config.getAccessToken === 'function'
      ? config.getAccessToken
      : function () { return null; };
    var getUserId = typeof config.getUserId === 'function' ? config.getUserId : function () { return null; };
    var baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    var fetchImpl = config.fetchImpl || (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);

    async function authHeaders() {
      var token = await getAccessToken();
      if (!token) {
        var authError = new Error('Sutra Sync is signed out. Sign in to your Sutra Cloud account to keep syncing.');
        authError.code = 'auth-expired';
        throw authError;
      }
      return { apikey: anonKey, Authorization: 'Bearer ' + token };
    }

    var rest = createRestTransport({
      baseUrl: baseUrl,
      deviceId: config.deviceId,
      fetchImpl: fetchImpl,
      getAuthHeaders: authHeaders
    });
    var putAssetIndex = rest.putAsset;
    var deleteVaultIndex = rest.deleteVault;

    // Asset blobs use the dedicated private sync-assets bucket at <uid>/<hash>.
    // Its RLS also checks the JWT session bound to an active sync device, so a
    // revoked device cannot bypass the guarded RPCs through Storage directly.
    async function assetPath(hash) {
      var uid = await getUserId();
      if (!uid) throw new Error('Sutra Sync asset transfer needs the signed-in user id.');
      return encodeURIComponent(String(uid)) + '/' + requireOpaqueAssetHash(hash);
    }

    rest.putAsset = async function (input) {
      var body = input || {};
      var headers = Object.assign({ 'Content-Type': 'application/json', 'x-upsert': 'true' }, await authHeaders());
      var hash = requireOpaqueAssetHash(body.hash);
      var envelope = requireEncryptedAssetEnvelope(body.envelope, hash);
      var path = await assetPath(hash);
      var response = await fetchImpl(baseUrl + '/storage/v1/object/sync-assets/' + path, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(envelope)
      });
      if (!response.ok) {
        var uploadError = new Error('Sync asset upload failed (HTTP ' + response.status + ').');
        uploadError.status = response.status;
        throw uploadError;
      }
      // Index row is required: other devices use it to discover the blob.
      // A failed index write leaves only an encrypted orphan; a retry safely
      // overwrites it and completes the index.
      var indexed = await putAssetIndex({ hash: hash, size_bytes: Number(body.size_bytes) || 0 });
      if (!indexed || indexed.ok === false) {
        var indexError = new Error('Sync asset index update failed.');
        indexError.code = indexed && indexed.code ? indexed.code : 'asset-index';
        throw indexError;
      }
      return { ok: true };
    };

    rest.getAsset = async function (input) {
      var body = input || {};
      var headers = await authHeaders();
      var path = await assetPath(body.hash);
      var response = await fetchImpl(baseUrl + '/storage/v1/object/authenticated/sync-assets/' + path, {
        method: 'GET',
        headers: headers
      });
      if (response.status === 404) return { ok: true, envelope: null };
      if (!response.ok) {
        var downloadError = new Error('Sync asset download failed (HTTP ' + response.status + ').');
        downloadError.status = response.status;
        throw downloadError;
      }
      return { ok: true, envelope: await response.json() };
    };

    rest.deleteVault = async function () {
      var listed = await rest.listAssets();
      if (!listed || listed.ok === false) return listed || { ok: false, code: 'asset-list' };
      var hashes = Array.isArray(listed.hashes) ? listed.hashes : [];
      if (hashes.length) {
        var prefixes = [];
        for (var i = 0; i < hashes.length; i += 1) prefixes.push(await assetPath(hashes[i]));
        var removeResponse = await fetchImpl(baseUrl + '/storage/v1/object/sync-assets', {
          method: 'DELETE',
          headers: Object.assign({ 'Content-Type': 'application/json' }, await authHeaders()),
          body: JSON.stringify({ prefixes: prefixes })
        });
        if (!removeResponse.ok && removeResponse.status !== 404) {
          var removeError = new Error('Sync asset cleanup failed (HTTP ' + removeResponse.status + ').');
          removeError.status = removeResponse.status;
          throw removeError;
        }
      }
      return deleteVaultIndex();
    };

    return rest;
  }

  var api = {
    DEVICE_STATUS_CONTRACT: DEVICE_STATUS_CONTRACT,
    validateVerifiedWipeInstruction: validateVerifiedWipeInstruction,
    createMemoryServer: createMemoryServer,
    createMemoryTransport: createMemoryTransport,
    createRestTransport: createRestTransport,
    createSupabaseTransport: createSupabaseTransport
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncTransport = api;
}(typeof window !== 'undefined' ? window : globalThis));
