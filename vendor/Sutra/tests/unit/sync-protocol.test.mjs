import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const protocol = require('../../src/sync/sync-protocol.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inventory = JSON.parse(readFileSync(path.join(repoRoot, 'docs', 'architecture', 'persistence-inventory.json'), 'utf8'));

test('stableStringify is deterministic regardless of key insertion order', () => {
  const a = { z: 1, a: { d: [1, 2, { q: 'x', b: null }], c: 'hi' }, m: true };
  const b = { m: true, a: { c: 'hi', d: [1, 2, { b: null, q: 'x' }] }, z: 1 };
  assert.equal(protocol.stableStringify(a), protocol.stableStringify(b));
});

test('stableStringify handles edge values like JSON.stringify', () => {
  assert.equal(protocol.stableStringify({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(protocol.stableStringify([undefined, NaN, Infinity]), '[null,null,null]');
  assert.equal(protocol.stableStringify(null), 'null');
  assert.equal(protocol.stableStringify('héllo "quoted"'), JSON.stringify('héllo "quoted"'));
  const parsed = JSON.parse(protocol.stableStringify({ z: [1, 'two', { y: false }] }));
  assert.deepEqual(parsed, { z: [1, 'two', { y: false }] });
});

test('hashValue is stable and order-insensitive', async () => {
  const h1 = await protocol.hashValue({ b: 2, a: 1 });
  const h2 = await protocol.hashValue({ a: 1, b: 2 });
  const h3 = await protocol.hashValue({ a: 1, b: 3 });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('record key builders and parser round-trip, including hostile ids', () => {
  const cases = [
    ['plain-id', 'pages'],
    ['id/with/slashes', 'tasks'],
    ['id with spaces & symbols?%', 'reviewItems'],
    ['日本語', 'customTabs']
  ];
  for (const [id, collection] of cases) {
    const key = protocol.collectionKey(collection, id);
    const parsed = protocol.parseRecordKey(key);
    assert.deepEqual(parsed, { type: 'collection', collection, id });
  }
  assert.deepEqual(protocol.parseRecordKey(protocol.atomicKey('settings')), { type: 'atomic', section: 'settings' });
  assert.deepEqual(protocol.parseRecordKey(protocol.atomicKey('homeworkWorkspace.__rest')), { type: 'atomic', section: 'homeworkWorkspace.__rest' });
  assert.deepEqual(protocol.parseRecordKey(protocol.orderingKey('pages')), { type: 'ordering', name: 'pages' });
});

test('parseRecordKey rejects malformed keys', () => {
  for (const bad of ['', 'x/pages/1', 'c/pages', 'c//id', 'c/pages/', 'o/', 'a/', 'o/a/b', 'c/pages/a/b', 'c/pages/%ZZ']) {
    assert.equal(protocol.parseRecordKey(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('classification covers every persistence-inventory field exactly once', () => {
  const classified = protocol.listClassifiedFields();
  const seen = new Set();
  for (const field of classified) {
    assert.ok(!seen.has(field), `field classified twice: ${field}`);
    seen.add(field);
  }
  const inventoryFields = new Set(inventory.workspaceTopLevelFields);
  for (const field of inventoryFields) {
    assert.ok(seen.has(field), `inventory field not classified: ${field}`);
  }
  for (const field of seen) {
    assert.ok(inventoryFields.has(field), `classified field missing from inventory: ${field}`);
  }
});

test('persistence decisions are named, valid, and agree with protocol mechanics', () => {
  const decisions = inventory.workspaceFieldClassifications || {};
  const validCategories = new Set(Object.keys(inventory.classificationCategories || {}));
  const excluded = new Set(protocol.CLASSIFICATION.excluded);
  for (const field of inventory.workspaceTopLevelFields) {
    assert.ok(decisions[field], `missing classification decision: ${field}`);
    assert.ok(validCategories.has(decisions[field].category), `invalid category for ${field}: ${decisions[field].category}`);
    const nonSynced = ['deviceLocal', 'ephemeral', 'reconstructed', 'secret'].includes(decisions[field].category);
    assert.equal(excluded.has(field), nonSynced, `protocol mechanics disagree with inventory decision for ${field}`);
  }
  for (const field of Object.keys(decisions)) {
    assert.ok(inventory.workspaceTopLevelFields.includes(field), `decision is not a persistence field: ${field}`);
  }
});

test('every browser-storage portability contract has one explicit decision', () => {
  const decisions = inventory.localStorageClassifications || {};
  const validCategories = new Set(Object.keys(inventory.classificationCategories || {}));
  for (const key of inventory.localStorageSnapshotKeys || []) {
    assert.ok(decisions[key], `localStorage snapshot key is unclassified: ${key}`);
  }
  for (const [key, decision] of Object.entries(decisions)) {
    assert.ok(validCategories.has(decision.category), `invalid localStorage category for ${key}`);
  }
});

test('Assistant nested persistence contract covers every durable message field', () => {
  const paths = inventory.nestedPersistentContracts || {};
  const fields = new Set(paths['assistantChatHistory.conversations[].messages[]'] || []);
  for (const field of [
    'id', 'role', 'content', 'createdAt', 'claimType', 'sources', 'grounding',
    'contextTags', 'memoryUsedIds', 'receipt', 'providerLabel', 'modelLabel',
    'favorite', 'partial', 'restoredFromBackup'
  ]) {
    assert.ok(fields.has(field), `Assistant message field is absent from the persistence contract: ${field}`);
  }
});

test('validateOp accepts a well-formed upsert and delete', () => {
  const upsert = {
    opId: 'dev-a:4', deviceId: 'dev-a', lamport: 4,
    recordKey: protocol.collectionKey('pages', 'p1'),
    kind: 'upsert', baseHash: null, hash: 'f'.repeat(64),
    payload: { id: 'p1', title: 'hello' },
    schemaVersion: 5, protocolVersion: protocol.PROTOCOL_VERSION,
    clientTime: '2026-07-15T00:00:00.000Z'
  };
  assert.deepEqual(protocol.validateOp(upsert), []);
  const del = { ...upsert, opId: 'dev-a:5', lamport: 5, kind: 'delete', payload: null, hash: null, baseHash: 'a'.repeat(64) };
  assert.deepEqual(protocol.validateOp(del), []);
});

test('validateOp rejects malformed ops', () => {
  const base = {
    opId: 'dev-a:4', deviceId: 'dev-a', lamport: 4,
    recordKey: 'c/pages/p1', kind: 'upsert', baseHash: null,
    hash: 'f'.repeat(64), payload: { id: 'p1' },
    schemaVersion: 5, protocolVersion: protocol.PROTOCOL_VERSION
  };
  assert.ok(protocol.validateOp({ ...base, opId: 'dev-b:4' }).length > 0, 'opId/device mismatch');
  assert.ok(protocol.validateOp({ ...base, recordKey: 'nope' }).length > 0, 'bad record key');
  assert.ok(protocol.validateOp({ ...base, kind: 'replace' }).length > 0, 'bad kind');
  assert.ok(protocol.validateOp({ ...base, payload: undefined }).length > 0, 'upsert with lost payload');
  assert.deepEqual(protocol.validateOp({ ...base, payload: null }), [], 'null is a legal upsert payload (nulled atomic section)');
  assert.ok(protocol.validateOp({ ...base, kind: 'delete' }).length > 0, 'delete with payload');
  assert.ok(protocol.validateOp({ ...base, protocolVersion: 99 }).length > 0, 'future protocol');
  assert.ok(protocol.validateOp({ ...base, lamport: -1, opId: 'dev-a:-1' }).length > 0, 'negative lamport');
  assert.ok(protocol.validateOp(null).length > 0, 'null op');
});

test('validateEnvelope checks structure and meta', () => {
  const good = {
    v: 1, alg: 'A256GCM', iv: 'aXY=', ct: 'Y3Q=',
    meta: { opId: 'd:1', deviceId: 'd', lamport: 1, recordKey: 'c/pages/p1', kind: 'upsert', protocolVersion: 1, schemaVersion: 5 }
  };
  assert.deepEqual(protocol.validateEnvelope(good), []);
  assert.ok(protocol.validateEnvelope({ ...good, v: 2 }).length > 0);
  assert.ok(protocol.validateEnvelope({ ...good, alg: 'A128GCM' }).length > 0);
  assert.ok(protocol.validateEnvelope({ ...good, meta: { ...good.meta, lamport: 2 } }).length > 0);
  assert.ok(protocol.validateEnvelope({ ...good, meta: { ...good.meta, protocolVersion: 99 } }).length > 0);
  assert.ok(protocol.validateEnvelope({ ...good, meta: { ...good.meta, recordKey: 'bad' } }).length > 0);
  assert.ok(protocol.validateEnvelope({}).length > 0);
});

test('compareOps orders by lamport then deviceId, never clientTime', () => {
  const a = { lamport: 2, deviceId: 'zzz', clientTime: '2020-01-01' };
  const b = { lamport: 3, deviceId: 'aaa', clientTime: '2010-01-01' };
  assert.ok(protocol.compareOps(a, b) < 0);
  assert.ok(protocol.compareOps(b, a) > 0);
  assert.equal(protocol.compareOps({ lamport: 1, deviceId: 'x' }, { lamport: 1, deviceId: 'x' }), 0);
  assert.ok(protocol.compareOps({ lamport: 1, deviceId: 'a' }, { lamport: 1, deviceId: 'b' }) < 0);
});
