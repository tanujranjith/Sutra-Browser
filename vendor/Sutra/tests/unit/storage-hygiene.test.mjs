import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const hygiene = require('../../src/persistence/storage-hygiene.js');

test('attachment scan distinguishes missing references from orphaned blobs', async () => {
  const report = await hygiene.scanAttachments({ listReferencedKeys: () => ['used', 'missing'], listStoredKeys: () => ['used', 'orphan'] });
  assert.deepEqual(report.orphanKeys, ['orphan']);
  assert.deepEqual(report.missingKeys, ['missing']);
  assert.equal((await hygiene.cleanupAttachments(report, {}, {})).code, 'review_required');
});

test('reviewed attachment cleanup deletes only unreferenced keys', async () => {
  const deleted = [];
  const adapter = { listReferencedKeys: () => ['used'], listStoredKeys: () => ['used', 'orphan'], deleteStoredKey: (key) => deleted.push(key) };
  const report = await hygiene.scanAttachments(adapter);
  const receipt = await hygiene.cleanupAttachments(report, { reviewed: true }, adapter);
  assert.equal(receipt.ok, true);
  assert.deepEqual(deleted, ['orphan']);
  assert.equal(receipt.undo.available, false);
});

test('attachment cleanup refuses stale scans and rescans before deleting', async () => {
  const deleted = [];
  let referenced = [];
  const adapter = {
    listReferencedKeys: () => referenced,
    listStoredKeys: () => ['candidate'],
    deleteStoredKey: (key) => deleted.push(key)
  };
  const report = await hygiene.scanAttachments(adapter);
  referenced = ['candidate'];
  const changed = await hygiene.cleanupAttachments(report, { reviewed: true }, adapter);
  assert.equal(changed.code, 'state_changed');
  assert.deepEqual(deleted, []);

  const stale = { ...report, scannedAt: '2000-01-01T00:00:00.000Z' };
  const staleReceipt = await hygiene.cleanupAttachments(stale, { reviewed: true }, adapter);
  assert.equal(staleReceipt.code, 'stale_scan');
  assert.deepEqual(deleted, []);
});

test('cloud scan and cleanup reconcile objects and metadata independently', async () => {
  const deleted = [];
  const adapter = {
    listObjects: () => [{ path: 'kept' }, { path: 'object-only' }],
    listMetadata: () => [{ id: 'm1', path: 'kept' }, { id: 'm2', path: 'metadata-only' }],
    deleteObject: (path) => deleted.push(`object:${path}`),
    deleteMetadata: (row) => deleted.push(`metadata:${row.id}`)
  };
  const report = await hygiene.scanCloud(adapter);
  assert.deepEqual(report.orphanObjectPaths, ['object-only']);
  assert.deepEqual(report.orphanMetadataRows, [{ id: 'm2', path: 'metadata-only' }]);
  const receipt = await hygiene.cleanupCloud(report, { reviewed: true }, adapter);
  assert.equal(receipt.ok, true);
  assert.deepEqual(deleted, ['object:object-only', 'metadata:m2']);
});

test('cloud cleanup refuses when an object gains metadata after review', async () => {
  const deleted = [];
  let metadata = [];
  const adapter = {
    listObjects: () => [{ path: 'candidate' }],
    listMetadata: () => metadata,
    deleteObject: (path) => deleted.push(path),
    deleteMetadata() {}
  };
  const report = await hygiene.scanCloud(adapter);
  metadata = [{ id: 'now-linked', path: 'candidate' }];
  const receipt = await hygiene.cleanupCloud(report, { reviewed: true }, adapter);
  assert.equal(receipt.code, 'state_changed');
  assert.deepEqual(deleted, []);
});
