/* Review-first orphan detection and cleanup for local blobs and cloud indexes. */
(function (global) {
  'use strict';

  function hash(value) {
    var text = JSON.stringify(value), out = 2166136261;
    for (var i = 0; i < text.length; i += 1) { out ^= text.charCodeAt(i); out = Math.imul(out, 16777619); }
    return (out >>> 0).toString(36);
  }
  function unique(values) { return Array.from(new Set((values || []).map(String).filter(Boolean))).sort(); }
  function makeReport(kind, details) {
    var body = Object.assign({ kind: kind, scannedAt: new Date().toISOString() }, details);
    body.scanId = kind + '_' + hash(details);
    return body;
  }
  function validReport(report) {
    if (!report || !report.kind || !report.scanId) return false;
    var details = Object.assign({}, report); delete details.scanId; delete details.scannedAt; delete details.kind;
    return report.scanId === report.kind + '_' + hash(details);
  }
  function freshReport(report, options) {
    var opts = options || {};
    var scannedAt = Date.parse(String(report && report.scannedAt || ''));
    var nowMs = typeof opts.now === 'function' ? Number(opts.now()) : Date.now();
    var maxAgeMs = Math.max(1000, Number(opts.maxAgeMs) || 5 * 60 * 1000);
    return Number.isFinite(scannedAt) && Number.isFinite(nowMs)
      && scannedAt <= nowMs + 5000 && nowMs - scannedAt <= maxAgeMs;
  }

  async function scanAttachments(adapter) {
    var source = adapter || {};
    var referenced = unique(await Promise.resolve(typeof source.listReferencedKeys === 'function' ? source.listReferencedKeys() : []));
    var stored = unique(await Promise.resolve(typeof source.listStoredKeys === 'function' ? source.listStoredKeys() : []));
    var referencedSet = new Set(referenced), storedSet = new Set(stored);
    return makeReport('attachments', {
      referencedKeys: referenced,
      storedKeys: stored,
      orphanKeys: stored.filter(function (key) { return !referencedSet.has(key); }),
      missingKeys: referenced.filter(function (key) { return !storedSet.has(key); })
    });
  }
  async function cleanupAttachments(report, options, adapter) {
    var opts = options || {}, source = adapter || {};
    if (!validReport(report)) return { ok: false, code: 'invalid_scan', changedIds: [], warnings: ['Run a fresh storage scan.'], persistence: { status: 'unchanged' } };
    if (opts.reviewed !== true) return { ok: false, code: 'review_required', changedIds: [], warnings: ['Review orphaned blobs before cleanup.'], persistence: { status: 'unchanged' } };
    if (!freshReport(report, opts)) return { ok: false, code: 'stale_scan', changedIds: [], warnings: ['The storage scan is stale. Run and review a fresh scan.'], persistence: { status: 'unchanged' } };
    if (typeof source.deleteStoredKey !== 'function') return { ok: false, code: 'adapter_unavailable', changedIds: [], warnings: [], persistence: { status: 'unchanged' } };
    var current = await scanAttachments(source);
    var currentOrphans = new Set(current.orphanKeys);
    if (report.orphanKeys.some(function (key) { return !currentOrphans.has(key); })) {
      return { ok: false, code: 'state_changed', changedIds: [], warnings: ['Storage references changed after the scan. Nothing was deleted; review a fresh scan.'], persistence: { status: 'unchanged' } };
    }
    var deleted = [], failures = [];
    for (var i = 0; i < report.orphanKeys.length; i += 1) {
      var key = report.orphanKeys[i];
      try { await source.deleteStoredKey(key); deleted.push(key); }
      catch (error) { failures.push({ key: key, message: error.message || String(error) }); }
    }
    return { ok: failures.length === 0, code: failures.length ? 'partial_cleanup' : 'cleaned', changedIds: deleted, warnings: failures.map(function (row) { return row.message; }), undo: { available: false, reason: 'Unreferenced binary data is permanently removed.' }, persistence: { status: failures.length ? 'partial' : 'persisted' } };
  }
  async function scanCloud(adapter) {
    var source = adapter || {};
    var objects = await Promise.resolve(typeof source.listObjects === 'function' ? source.listObjects() : []);
    var metadata = await Promise.resolve(typeof source.listMetadata === 'function' ? source.listMetadata() : []);
    objects = Array.isArray(objects) ? objects : [];
    metadata = Array.isArray(metadata) ? metadata : [];
    var objectPaths = unique(objects.map(function (row) { return row && (row.path || row.name || row.id); }));
    var metadataPaths = unique(metadata.map(function (row) { return row && (row.path || row.name); }));
    var objectSet = new Set(objectPaths), metadataSet = new Set(metadataPaths);
    return makeReport('cloud', {
      objectPaths: objectPaths,
      metadataRows: metadata.map(function (row) { return { id: String(row && row.id || ''), path: String(row && row.path || '') }; }),
      orphanObjectPaths: objectPaths.filter(function (path) { return !metadataSet.has(path); }),
      orphanMetadataRows: metadata.filter(function (row) { return row && row.path && !objectSet.has(String(row.path)); }).map(function (row) { return { id: String(row.id || ''), path: String(row.path) }; })
    });
  }
  async function cleanupCloud(report, options, adapter) {
    var opts = options || {}, source = adapter || {};
    if (!validReport(report)) return { ok: false, code: 'invalid_scan', changedIds: [], warnings: ['Run a fresh cloud scan.'], persistence: { status: 'unchanged' } };
    if (opts.reviewed !== true) return { ok: false, code: 'review_required', changedIds: [], warnings: ['Review orphaned cloud records before cleanup.'], persistence: { status: 'unchanged' } };
    if (!freshReport(report, opts)) return { ok: false, code: 'stale_scan', changedIds: [], warnings: ['The cloud scan is stale. Run and review a fresh scan.'], persistence: { status: 'unchanged' } };
    var current = await scanCloud(source);
    var currentObjects = new Set(current.orphanObjectPaths);
    var currentMetadata = new Set(current.orphanMetadataRows.map(function (row) { return String(row.id || '') + '\n' + String(row.path || ''); }));
    var stateChanged = report.orphanObjectPaths.some(function (path) { return !currentObjects.has(path); })
      || report.orphanMetadataRows.some(function (row) { return !currentMetadata.has(String(row.id || '') + '\n' + String(row.path || '')); });
    if (stateChanged) return { ok: false, code: 'state_changed', changedIds: [], warnings: ['Cloud state changed after the scan. Nothing was deleted; review a fresh scan.'], persistence: { status: 'unchanged' } };
    var changed = [], failures = [];
    for (var i = 0; i < report.orphanObjectPaths.length; i += 1) {
      var path = report.orphanObjectPaths[i];
      try { await source.deleteObject(path); changed.push(path); }
      catch (error) { failures.push({ kind: 'object', id: path, message: error.message || String(error) }); }
    }
    for (var j = 0; j < report.orphanMetadataRows.length; j += 1) {
      var row = report.orphanMetadataRows[j];
      try { await source.deleteMetadata(row); changed.push(row.id || row.path); }
      catch (error) { failures.push({ kind: 'metadata', id: row.id || row.path, message: error.message || String(error) }); }
    }
    return { ok: failures.length === 0, code: failures.length ? 'partial_cleanup' : 'cleaned', changedIds: changed, warnings: failures.map(function (row) { return row.message; }), failures: failures, undo: { available: false, reason: 'Orphan cleanup is permanent.' }, persistence: { status: failures.length ? 'partial' : 'persisted' } };
  }

  var api = { VERSION: '1.0.0', scanAttachments: scanAttachments, cleanupAttachments: cleanupAttachments, scanCloud: scanCloud, cleanupCloud: cleanupCloud };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraStorageHygiene = api;
}(typeof window !== 'undefined' ? window : globalThis));
