/*
 * Sutra Sync diff — hash-based comparison of the acknowledged baseline
 * against the current projection, producing the outgoing op queue. Pure
 * module. Spec: docs/architecture/SYNC_PROTOCOL.md §4.
 *
 * The outbox is *recomputed* from (baseline, current) every cycle rather
 * than appended to:
 *  - an unchanged pending edit reuses its existing op (stable opId, so a
 *    retried push dedupes server-side),
 *  - a further edit to the same record replaces the op but keeps the
 *    ORIGINAL baseHash (coalescing preserves what the edit was based on),
 *  - an edit that reverts to the baseline value simply disappears.
 */
(function (global) {
  'use strict';

  var protocolApi = (typeof module !== 'undefined' && module.exports)
    ? require('./sync-protocol.js')
    : global.SutraSyncProtocol;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // Raw changes between two hash maps, deterministic order (sorted keys).
  function computeChanges(baseHashes, currentRecords, currentHashes) {
    var base = baseHashes || {};
    var records = currentRecords || {};
    var hashes = currentHashes || {};
    var changes = [];
    var keys = Object.keys(hashes).sort();
    var i;
    for (i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var baseHash = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : null;
      if (baseHash === hashes[key]) continue;
      changes.push({
        recordKey: key,
        kind: 'upsert',
        baseHash: baseHash,
        hash: hashes[key],
        payload: clone(records[key])
      });
    }
    var baseKeys = Object.keys(base).sort();
    for (i = 0; i < baseKeys.length; i += 1) {
      var missing = baseKeys[i];
      if (Object.prototype.hasOwnProperty.call(hashes, missing)) continue;
      changes.push({
        recordKey: missing,
        kind: 'delete',
        baseHash: base[missing],
        hash: null,
        payload: null
      });
    }
    return changes;
  }

  // identity: { deviceId, schemaVersion, clientTime, nextLamport() }
  function computeOutbox(options) {
    var config = options || {};
    var identity = config.identity || {};
    if (typeof identity.nextLamport !== 'function') throw new Error('identity.nextLamport() is required');
    if (!identity.deviceId) throw new Error('identity.deviceId is required');

    var previousByKey = {};
    var previous = Array.isArray(config.previousOutbox) ? config.previousOutbox : [];
    var i;
    for (i = 0; i < previous.length; i += 1) {
      if (previous[i] && previous[i].recordKey) previousByKey[previous[i].recordKey] = previous[i];
    }

    var changes = computeChanges(config.baseHashes, config.currentRecords, config.currentHashes);
    var ops = [];
    for (i = 0; i < changes.length; i += 1) {
      var change = changes[i];
      var prior = previousByKey[change.recordKey] || null;
      if (prior && prior.kind === change.kind && prior.hash === change.hash) {
        ops.push(clone(prior)); // unchanged pending edit: stable opId
        continue;
      }
      var lamport = identity.nextLamport();
      var op = {
        opId: protocolApi.makeOpId(identity.deviceId, lamport),
        deviceId: String(identity.deviceId),
        lamport: lamport,
        recordKey: change.recordKey,
        kind: change.kind,
        // Coalescing: a re-edited record keeps the base it was originally
        // edited from, so the merge still sees the true three-way base.
        baseHash: prior ? prior.baseHash : change.baseHash,
        hash: change.hash,
        payload: change.payload,
        schemaVersion: Number(identity.schemaVersion) || 0,
        protocolVersion: protocolApi.PROTOCOL_VERSION,
        clientTime: String(identity.clientTime || '')
      };
      var errors = protocolApi.validateOp(op);
      if (errors.length) throw new Error('Diff produced an invalid op for ' + change.recordKey + ': ' + errors.join('; '));
      ops.push(op);
    }
    return { ops: ops };
  }

  var api = {
    computeChanges: computeChanges,
    computeOutbox: computeOutbox
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncDiff = api;
}(typeof window !== 'undefined' ? window : globalThis));
