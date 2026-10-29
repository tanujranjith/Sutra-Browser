import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mergeApi = require('../../src/sync/sync-merge.js');
const diffApi = require('../../src/sync/sync-diff.js');
const projectionApi = require('../../src/sync/sync-projection.js');
const protocol = require('../../src/sync/sync-protocol.js');

const NOW = 1800000000000;

async function projectionOf(workspace) {
  const projection = projectionApi.buildProjection(workspace);
  const hashes = await projectionApi.hashProjection(projection);
  return { records: projection.records, hashes };
}

function baseWorkspace() {
  return {
    pages: [
      { id: 'p1', title: 'Bio notes', body: 'chapter one' },
      { id: 'p2', title: 'History', body: 'rome' }
    ],
    tasks: [
      { id: 't1', text: 'read', done: false },
      { id: 't2', text: 'write', done: false }
    ],
    taskOrder: ['t1', 't2'],
    settings: { theme: 'dark', preferences: {} }
  };
}

function identityFor(deviceId, start = 1) {
  let lamport = start - 1;
  return {
    deviceId,
    schemaVersion: 5,
    clientTime: '2026-07-15T12:00:00.000Z',
    nextLamport: () => { lamport += 1; return lamport; }
  };
}

async function outboxFor(base, currentWorkspace, deviceId, lamportStart = 1) {
  const current = await projectionOf(currentWorkspace);
  const { ops } = diffApi.computeOutbox({
    baseHashes: base.hashes,
    currentRecords: current.records,
    currentHashes: current.hashes,
    previousOutbox: [],
    identity: identityFor(deviceId, lamportStart)
  });
  return { current, ops };
}

// Simulates one device's merge: its local workspace vs the other's ops.
async function mergeOn(base, local, localOps, remoteOps) {
  return mergeApi.merge({
    baseRecords: base.records,
    baseHashes: base.hashes,
    localRecords: local.records,
    localHashes: local.hashes,
    remoteOps,
    localOps,
    tombstones: {},
    now: NOW
  });
}

test('independent edits on different records merge automatically', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace();
  wsA.tasks[0].done = true;                          // A edits t1
  const wsB = baseWorkspace();
  wsB.pages[1].body = 'rome and carthage';           // B edits p2

  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');

  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);

  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.mergedRecords['c/tasks/t1'].done, true);
  assert.equal(onA.mergedRecords['c/pages/p2'].body, 'rome and carthage');
  assert.equal(onA.conflicts.length, 0);
});

test('identical concurrent changes converge without conflict', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace(); wsA.tasks[0].done = true;
  const wsB = baseWorkspace(); wsB.tasks[0].done = true;
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  assert.equal(onA.conflicts.length, 0);
  assert.equal(onA.stats.converged > 0, true);
  assert.equal(onA.mergedRecords['c/tasks/t1'].done, true);
});

test('non-overlapping fields changed on the same record merge without conflict', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace();
  wsA.tasks[0].done = true;
  const wsB = baseWorkspace();
  wsB.tasks[0].text = 'read chapter two';
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);
  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.mergedRecords['c/tasks/t1'].done, true);
  assert.equal(onA.mergedRecords['c/tasks/t1'].text, 'read chapter two');
  assert.equal(onA.conflicts.length, 0);
});

test('page duress verifier synchronizes as opaque lock metadata without exposing a credential field', async () => {
  const baseWs = baseWorkspace();
  baseWs.pages[0] = {
    id: 'p1', title: 'Protected', content: '<p>base</p>', isLocked: true,
    lockHash: 'normal-hash', lockSalt: 'normal-salt', lockDuressVerifier: null
  };
  const base = await projectionOf(baseWs);
  const wsA = structuredClone(baseWs);
  wsA.pages[0].title = 'Protected notes';
  const wsB = structuredClone(baseWs);
  wsB.pages[0].lockDuressVerifier = `v1$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);

  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.conflicts.length, 0);
  assert.equal(onA.mergedRecords['c/pages/p1'].title, 'Protected notes');
  assert.equal(onA.mergedRecords['c/pages/p1'].lockDuressVerifier, wsB.pages[0].lockDuressVerifier);
  assert.equal(Object.hasOwn(onA.mergedRecords['c/pages/p1'], 'lockDuressPin'), false);
});

test('overlapping non-page fields choose deterministically and retain both values for review', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace(); wsA.tasks[0].text = 'A wording';
  const wsB = baseWorkspace(); wsB.tasks[0].text = 'B wording';
  const A = await outboxFor(base, wsA, 'device-a', 10);
  const B = await outboxFor(base, wsB, 'device-b', 10);
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);
  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.conflicts.length, 1);
  assert.equal(onA.conflicts[0].type, 'field-conflict');
  assert.equal(onA.conflicts[0].localValue.text, 'A wording');
  assert.equal(onA.conflicts[0].remoteValue.text, 'B wording');
  assert.deepEqual(onA.conflicts[0].fieldConflicts.map(c => c.path), ['$.text']);
});

test('overlapping page edits create one deterministic review record and never a sidebar page', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace(); wsA.pages[0].body = 'edited on A';
  const wsB = baseWorkspace(); wsB.pages[0].body = 'edited on B';
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');

  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);

  assert.deepEqual(onA.mergedRecords, onB.mergedRecords, 'both devices must converge');
  assert.ok(!Object.keys(onA.mergedRecords).some(k => k.startsWith('c/pages/conflict-')));
  assert.deepEqual(onA.mergedRecords['o/pages'], ['p1', 'p2'], 'ordering must not gain an artifact');
  assert.equal(onA.conflicts.length, 1);
  assert.equal(onA.conflicts[0].type, 'page-content-conflict');
  assert.equal(onA.conflicts[0].id, onB.conflicts[0].id, 'conflict id is direction-independent');
  assert.deepEqual(onA.conflicts[0].fieldConflicts.map(c => c.path), ['$.body']);
  const bodies = [onA.conflicts[0].localValue.body, onA.conflicts[0].remoteValue.body].sort();
  assert.deepEqual(bodies, ['edited on A', 'edited on B'], 'review record retains both versions');
});

test('production version-history churn does not turn title versus body into a conflict', async () => {
  const baseWs = baseWorkspace();
  baseWs.pages[0] = {
    id: 'p1', title: 'Base title', content: '<p>one</p><p>two</p><p>three</p>',
    blocks: [], versions: [], updatedAt: '2026-07-01T00:00:00.000Z'
  };
  const base = await projectionOf(baseWs);
  const wsA = structuredClone(baseWs);
  wsA.pages[0].title = 'Renamed on A';
  wsA.pages[0].versions = [{ id: 'random-a', savedAt: '2026-07-17T01:00:00Z', label: 'Auto-saved', state: { title: 'Base title', content: baseWs.pages[0].content, blocks: [] } }];
  const wsB = structuredClone(baseWs);
  wsB.pages[0].content = '<p>one</p><p>two changed on B</p><p>three</p>';
  wsB.pages[0].versions = [{ id: 'random-b', savedAt: '2026-07-17T01:00:01Z', label: 'Auto-saved', state: { title: 'Base title', content: baseWs.pages[0].content, blocks: [] } }];
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);
  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.conflicts.length, 0);
  assert.equal(onA.mergedRecords['c/pages/p1'].title, 'Renamed on A');
  assert.match(onA.mergedRecords['c/pages/p1'].content, /changed on B/);
  assert.equal(onA.mergedRecords['c/pages/p1'].versions.length, 1, 'equivalent random checkpoints dedupe');
});

test('different rich-text blocks merge and overlapping blocks yield one conflict', async () => {
  const baseWs = baseWorkspace();
  baseWs.pages[0] = { id: 'p1', title: 'Blocks', content: '<p>one</p><p>two</p><p>three</p>', blocks: [], versions: [] };
  const base = await projectionOf(baseWs);

  const wsA = structuredClone(baseWs); wsA.pages[0].content = '<p>one A</p><p>two</p><p>three</p>';
  const wsB = structuredClone(baseWs); wsB.pages[0].content = '<p>one</p><p>two</p><p>three B</p>';
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const merged = await mergeOn(base, A.current, A.ops, B.ops);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.mergedRecords['c/pages/p1'].content, '<p>one A</p><p>two</p><p>three B</p>');

  const wsC = structuredClone(baseWs); wsC.pages[0].content = '<p>one</p><p>two C</p><p>three</p>';
  const wsD = structuredClone(baseWs); wsD.pages[0].content = '<p>one</p><p>two D</p><p>three</p>';
  const C = await outboxFor(base, wsC, 'device-c');
  const D = await outboxFor(base, wsD, 'device-d');
  const overlap = await mergeOn(base, C.current, C.ops, D.ops);
  assert.equal(overlap.conflicts.length, 1);
  assert.deepEqual(overlap.conflicts[0].fieldConflicts.map(c => c.reason), ['overlapping-rich-text']);
  assert.ok(!Object.keys(overlap.mergedRecords).some(k => k.includes('conflict-')));
});

test('equivalent HTML, move versus edit, and reorder versus edit converge silently', async () => {
  const baseWs = baseWorkspace();
  baseWs.pages[0] = { id: 'p1', title: 'Semantic', content: '<p class="b a" data-z="2">text</p>', spaceId: 'default', blocks: [], versions: [] };
  const base = await projectionOf(baseWs);

  const wsA = structuredClone(baseWs); wsA.pages[0].content = '<p data-z="2" class="a b">text</p>';
  const wsB = structuredClone(baseWs); wsB.pages[0].title = 'Semantic title';
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const semantic = await mergeOn(base, A.current, A.ops, B.ops);
  assert.equal(semantic.conflicts.length, 0);
  assert.equal(semantic.mergedRecords['c/pages/p1'].title, 'Semantic title');

  const wsC = structuredClone(baseWs); wsC.pages[0].spaceId = 'school'; wsC.pages.reverse();
  const wsD = structuredClone(baseWs); wsD.pages[0].content = '<p class="b a" data-z="2">edited</p>';
  const C = await outboxFor(base, wsC, 'device-c');
  const D = await outboxFor(base, wsD, 'device-d');
  const moved = await mergeOn(base, C.current, C.ops, D.ops);
  assert.equal(moved.conflicts.length, 0);
  assert.equal(moved.mergedRecords['c/pages/p1'].spaceId, 'school');
  assert.match(moved.mergedRecords['c/pages/p1'].content, /edited/);
  assert.deepEqual(moved.mergedRecords['o/pages'], ['p2', 'p1']);
});

test('delete vs edit: the edit wins in both directions', async () => {
  const base = await projectionOf(baseWorkspace());

  // A deletes p1 while B edits it.
  const wsA = baseWorkspace(); wsA.pages = wsA.pages.filter(p => p.id !== 'p1');
  const wsB = baseWorkspace(); wsB.pages[0].body = 'still being edited';
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');

  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);
  assert.deepEqual(onA.mergedRecords, onB.mergedRecords);
  assert.equal(onA.mergedRecords['c/pages/p1'].body, 'still being edited', 'edit must survive the delete');
  assert.equal(onA.stats.resurrected, onB.stats.resurrected);
  assert.equal(onA.conflicts.length, 1, 'delete versus edit remains reviewable');
  assert.equal(onA.conflicts[0].type, 'delete-edit-conflict');
  assert.equal(onA.conflicts[0].id, onB.conflicts[0].id);
});

test('delete vs delete leaves one tombstone and no record', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace(); wsA.tasks = wsA.tasks.filter(t => t.id !== 't2');
  const wsB = baseWorkspace(); wsB.tasks = wsB.tasks.filter(t => t.id !== 't2');
  const A = await outboxFor(base, wsA, 'device-a');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  assert.ok(!('c/tasks/t2' in onA.mergedRecords));
  assert.ok(onA.tombstones['c/tasks/t2']);
});

test('remote-only delete removes the record and records a tombstone', async () => {
  const base = await projectionOf(baseWorkspace());
  const local = await projectionOf(baseWorkspace()); // unchanged locally
  const wsB = baseWorkspace(); wsB.pages = wsB.pages.filter(p => p.id !== 'p2');
  const B = await outboxFor(base, wsB, 'device-b');
  const onA = await mergeOn(base, local, [], B.ops);
  assert.ok(!('c/pages/p2' in onA.mergedRecords));
  assert.ok(onA.tombstones['c/pages/p2']);
});

test('tombstones expire after the retention window', async () => {
  const base = await projectionOf(baseWorkspace());
  const local = await projectionOf(baseWorkspace());
  const old = NOW - protocol.TOMBSTONE_RETENTION_MS - 1000;
  const fresh = NOW - 1000;
  const result = await mergeApi.merge({
    baseRecords: base.records, baseHashes: base.hashes,
    localRecords: local.records, localHashes: local.hashes,
    remoteOps: [], localOps: [],
    tombstones: {
      'c/pages/ancient': { deletedAt: old, opId: 'x:1' },
      'c/pages/recent': { deletedAt: fresh, opId: 'x:2' }
    },
    now: NOW
  });
  assert.ok(!result.tombstones['c/pages/ancient'], 'expired tombstone must be pruned');
  assert.ok(result.tombstones['c/pages/recent']);
});

test('remoteRecords/remoteHashes reflect the server head for baseline advance', async () => {
  const base = await projectionOf(baseWorkspace());
  const local = await projectionOf(baseWorkspace());
  const wsB = baseWorkspace(); wsB.tasks[1].done = true;
  const B = await outboxFor(base, wsB, 'device-b');
  const result = await mergeOn(base, local, [], B.ops);
  assert.equal(result.remoteRecords['c/tasks/t2'].done, true);
  assert.equal(result.remoteHashes['c/tasks/t2'], await protocol.hashValue(result.remoteRecords['c/tasks/t2']));
  // Untouched records reuse the baseline hash.
  assert.equal(result.remoteHashes['c/pages/p1'], base.hashes['c/pages/p1']);
});

test('pulled-back own ops never conflict with newer local edits (lost-ack retry)', async () => {
  const base = await projectionOf(baseWorkspace());
  // Device A edited p1 to v1, pushed it, the ack was lost, then edited to v2.
  const wsV1 = baseWorkspace(); wsV1.pages[0].body = 'version one';
  const v1 = await outboxFor(base, wsV1, 'device-a', 1);
  const wsV2 = baseWorkspace(); wsV2.pages[0].body = 'version two';
  const current2 = await projectionOf(wsV2);
  const { ops: v2ops } = require('../../src/sync/sync-diff.js').computeOutbox({
    baseHashes: base.hashes, currentRecords: current2.records, currentHashes: current2.hashes,
    previousOutbox: v1.ops, identity: identityFor('device-a', 50)
  });

  // Pull returns A's own v1 ops from the server.
  const result = await mergeApi.merge({
    baseRecords: base.records, baseHashes: base.hashes,
    localRecords: current2.records, localHashes: current2.hashes,
    remoteOps: v1.ops, localOps: v2ops,
    tombstones: {}, ownDeviceId: 'device-a', now: NOW
  });

  assert.equal(result.mergedRecords['c/pages/p1'].body, 'version two', 'newer local edit must win');
  assert.equal(result.conflicts.length, 0, 'own echo must not create conflicts');
  assert.ok(!Object.keys(result.mergedRecords).some(k => k.includes('conflict-')), 'no conflict copy from own echo');
  // The baseline still advances to the server head (v1) so the v2 op pushes.
  assert.equal(result.remoteRecords['c/pages/p1'].body, 'version one');
});

test('server-reordered same-key ops cannot pick the winner (authenticated order rules)', async () => {
  const base = await projectionOf(baseWorkspace());
  const older = {
    opId: 'device-b:5', deviceId: 'device-b', lamport: 5,
    recordKey: 'c/tasks/t1', kind: 'upsert', baseHash: base.hashes['c/tasks/t1'],
    hash: 'a'.repeat(64), payload: { id: 't1', text: 'older write', done: false },
    schemaVersion: 5, protocolVersion: protocol.PROTOCOL_VERSION, clientTime: ''
  };
  const newer = { ...older, opId: 'device-b:9', lamport: 9, hash: 'b'.repeat(64), payload: { id: 't1', text: 'newer write', done: true } };
  // Server delivers them REORDERED (newer first) — the newer op must still win.
  const applied = mergeApi.applyOpsToRecords(base.records, [newer, older]);
  assert.equal(applied.records['c/tasks/t1'].text, 'newer write');
  assert.equal(applied.lastOpByKey['c/tasks/t1'].opId, 'device-b:9');
});

test('causal baseHash edge beats a stale lower Lamport in either delivery order', async () => {
  const base = await projectionOf(baseWorkspace());
  const firstPayload = { id: 't1', text: 'first observed write', done: false };
  const firstHash = await protocol.hashValue(firstPayload);
  const laterPayload = { id: 't1', text: 'causal successor', done: true };
  const laterHash = await protocol.hashValue(laterPayload);
  const first = {
    opId: 'device-a:500', deviceId: 'device-a', lamport: 500,
    recordKey: 'c/tasks/t1', kind: 'upsert', baseHash: base.hashes['c/tasks/t1'],
    hash: firstHash, payload: firstPayload,
    schemaVersion: 5, protocolVersion: protocol.PROTOCOL_VERSION, clientTime: ''
  };
  // Simulates an older client that observed `first` but failed to raise its
  // Lamport high-water before emitting the successor.
  const later = {
    ...first, opId: 'device-b:2', deviceId: 'device-b', lamport: 2,
    baseHash: firstHash, hash: laterHash, payload: laterPayload
  };
  for (const order of [[first, later], [later, first]]) {
    const applied = mergeApi.applyOpsToRecords(base.records, order);
    assert.equal(applied.records['c/tasks/t1'].text, 'causal successor');
    assert.equal(applied.lastOpByKey['c/tasks/t1'].opId, 'device-b:2');
  }
});

test('bootstrap join: vault atomic sections beat the joining device boot defaults; collections still union', async () => {
  const emptyBase = { records: {}, hashes: {} };
  // The vault (device A pushed earlier) has a courseWorkspace with a file.
  const vaultWs = { ...baseWorkspace(), courseWorkspace: { courses: [{ id: 'c1', name: 'Bio' }], files: [{ id: 'f1', name: 'lab.pdf' }] } };
  const A = await outboxFor(await projectionOf({ pages: [], tasks: [], taskOrder: [] }), vaultWs, 'device-a', 1);
  // Device B joins with unedited boot defaults (empty courseWorkspace) but a
  // real local-only page that must survive the union.
  const joiningWs = {
    ...baseWorkspace(),
    pages: [...baseWorkspace().pages, { id: 'pb-local', title: 'B only', body: 'local' }],
    courseWorkspace: { courses: [], files: [] }
  };
  const local = await projectionOf(joiningWs);
  const { ops: localOps } = diffApi.computeOutbox({
    baseHashes: emptyBase.hashes, currentRecords: local.records, currentHashes: local.hashes,
    previousOutbox: [], identity: identityFor('device-b', 500) // HIGH lamports: would win plain LWW
  });
  const result = await mergeApi.merge({
    baseRecords: emptyBase.records, baseHashes: emptyBase.hashes,
    localRecords: local.records, localHashes: local.hashes,
    remoteOps: A.ops, localOps, tombstones: {}, ownDeviceId: 'device-b', now: NOW
  });
  assert.deepEqual(result.mergedRecords['a/courseWorkspace'].files, [{ id: 'f1', name: 'lab.pdf' }], 'vault atomic must win the join despite higher local lamports');
  assert.ok('c/pages/pb-local' in result.mergedRecords, 'joining device collection records still union in');
  assert.ok('c/pages/p1' in result.mergedRecords, 'vault collection records arrive');
});

test('bootstrap: a locally-tombstoned record is not resurrected from the snapshot base', async () => {
  const base = { records: {}, hashes: {} }; // fresh acknowledged baseline
  const local = await projectionOf({ ...baseWorkspace(), pages: baseWorkspace().pages.filter(p => p.id !== 'p2') });
  const snapshotBase = (await projectionOf(baseWorkspace())).records; // vault snapshot still has p2
  const result = await mergeApi.merge({
    baseRecords: base.records, baseHashes: base.hashes,
    localRecords: local.records, localHashes: local.hashes,
    remoteOps: [], remoteBaseRecords: snapshotBase, localOps: [],
    tombstones: { 'c/pages/p2': { deletedAt: NOW - 1000, opId: 'device-a:3' } },
    ownDeviceId: 'device-a', now: NOW
  });
  assert.ok(!('c/pages/p2' in result.mergedRecords), 'tombstoned record must stay deleted');
  assert.ok('c/pages/p1' in result.mergedRecords, 'other snapshot records still arrive');
});

test('legacy conflict cleanup removes only exact duplicates and preserves unique or nested content', () => {
  const workspace = {
    pages: [
      { id: 'p1', title: 'Plan', content: '<p class="a b">same</p>', spaceId: 'default', versions: [{ id: 'original-only', label: 'Auto-saved', savedAt: '2026-07-17T00:00:00.000Z', state: { content: '<p class="a b">same</p>' } }] },
      { id: 'conflict-p1-a1', title: 'Plan (conflict copy — device-a, 2026-07-17)', content: '<p class="b a">same</p>', spaceId: 'default', versions: [] },
      { id: 'conflict-p1-b2', title: 'Plan (conflict copy — device-b, 2026-07-17)', content: '<p>unique edit</p>', spaceId: 'default', versions: [] },
      { id: 'conflict-p1-history', title: 'Plan (conflict copy — device-d, 2026-07-17)', content: '<p class="a b">same</p>', spaceId: 'default', versions: [{ id: 'copy-only', label: 'Auto-saved', savedAt: '2026-07-16T00:00:00.000Z', state: { content: '<p>unique old history</p>' } }] },
      { id: 'conflict-folder-c3', title: 'Folder (conflict copy — device-c, 2026-07-17)', content: '<p>folder</p>', spaceId: 'default', versions: [] },
      { id: 'child', title: 'Folder (conflict copy — device-c, 2026-07-17)::Child', content: '<p>child</p>', spaceId: 'default', versions: [] }
    ]
  };
  const rows = [
    { id: 'old-a', copyId: 'conflict-p1-a1', recordKey: 'c/pages/p1' },
    { id: 'old-b', copyId: 'conflict-p1-b2', recordKey: 'c/pages/p1' },
    { id: 'old-history', copyId: 'conflict-p1-history', recordKey: 'c/pages/p1' }
  ];
  const analysis = mergeApi.analyzeLegacyConflictCopies(workspace, rows);
  assert.equal(analysis.counts.safe, 1);
  assert.equal(analysis.counts.review, 2);
  assert.equal(analysis.items.find(item => item.copyId === 'conflict-p1-b2').classification, 'unique');
  assert.equal(analysis.items.find(item => item.copyId === 'conflict-p1-b2').reviewEligible, true);
  assert.equal(analysis.items.find(item => item.copyId === 'conflict-folder-c3').hasChildren, true);
  assert.equal(analysis.items.find(item => item.copyId === 'conflict-folder-c3').reviewEligible, false);
  assert.equal(analysis.items.find(item => item.copyId === 'conflict-p1-history').safeToConsolidate, false, 'copy-only history is never deleted as exact');
  const cleaned = mergeApi.consolidateExactLegacyConflictCopies(workspace, analysis);
  assert.deepEqual(cleaned.removedIds, ['conflict-p1-a1']);
  assert.ok(cleaned.workspace.pages.some(page => page.id === 'conflict-p1-b2'), 'unique edit survives');
  assert.ok(cleaned.workspace.pages.some(page => page.id === 'conflict-p1-history'), 'copy-only version history survives');
  assert.ok(cleaned.workspace.pages.some(page => page.id === 'conflict-folder-c3'), 'parent with children survives');
  assert.ok(cleaned.workspace.pages.some(page => page.id === 'child'), 'child is never orphaned');
});

// ---------------------------------------------------------------------
// Seeded randomized convergence property test:
//   merge on device A (local=A, remote=B) == merge on device B (local=B, remote=A)
// including overlapping edits, deletes, and page conflicts.
// ---------------------------------------------------------------------

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMutation(rng, workspace, label) {
  const roll = rng();
  if (roll < 0.25 && workspace.pages.length > 0) {
    const page = workspace.pages[Math.floor(rng() * workspace.pages.length)];
    page.body = `${label}-body-${Math.floor(rng() * 1e6)}`;
  } else if (roll < 0.45 && workspace.tasks.length > 0) {
    const task = workspace.tasks[Math.floor(rng() * workspace.tasks.length)];
    task.done = rng() < 0.5;
    task.text = `${label}-text-${Math.floor(rng() * 1e6)}`;
  } else if (roll < 0.6) {
    const id = `${label}-new-${Math.floor(rng() * 1e6)}`;
    workspace.pages.push({ id, title: `${label} page`, body: 'fresh' });
  } else if (roll < 0.75 && workspace.pages.length > 1) {
    workspace.pages.splice(Math.floor(rng() * workspace.pages.length), 1);
  } else if (roll < 0.9 && workspace.tasks.length > 1) {
    workspace.tasks.splice(Math.floor(rng() * workspace.tasks.length), 1);
  } else {
    workspace.settings = { ...workspace.settings, theme: rng() < 0.5 ? 'dark' : 'light' };
  }
}

test('seeded property: two devices always converge regardless of merge direction', async () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const rng = mulberry32(seed * 7919);
    const base = await projectionOf(baseWorkspace());

    const wsA = baseWorkspace();
    const wsB = baseWorkspace();
    const mutationsA = 1 + Math.floor(rng() * 4);
    const mutationsB = 1 + Math.floor(rng() * 4);
    for (let m = 0; m < mutationsA; m += 1) randomMutation(rng, wsA, 'A');
    for (let m = 0; m < mutationsB; m += 1) randomMutation(rng, wsB, 'B');

    const A = await outboxFor(base, wsA, 'device-a', 100);
    const B = await outboxFor(base, wsB, 'device-b', 100);

    const onA = await mergeOn(base, A.current, A.ops, B.ops);
    const onB = await mergeOn(base, B.current, B.ops, A.ops);

    assert.deepEqual(
      onA.mergedRecords,
      onB.mergedRecords,
      `seed ${seed}: devices diverged (A ops ${A.ops.length}, B ops ${B.ops.length})`
    );
  }
});

test('conflict audit references are opaque, deterministic, and never embed the device id', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace(); wsA.tasks[0].text = 'A wording';
  const wsB = baseWorkspace(); wsB.tasks[0].text = 'B wording';
  const A = await outboxFor(base, wsA, 'device-private-a');
  const B = await outboxFor(base, wsB, 'device-private-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);
  const onB = await mergeOn(base, B.current, B.ops, A.ops);

  assert.equal(onA.conflicts.length, 1);
  const conflict = onA.conflicts[0];
  assert.equal(conflict.winnerAuditId.length, 64, 'audit ref is a sha256 hex digest');
  assert.match(conflict.winnerAuditId, /^[0-9a-f]{64}$/);
  assert.equal(conflict.loserAuditId.length, 64);
  assert.ok(!conflict.winnerAuditId.includes('device-private-a'), 'winner audit ref must not leak the device id');
  assert.ok(!conflict.winnerAuditId.includes('device-private-b'), 'winner audit ref must not leak the losing device id');
  assert.ok(!conflict.loserAuditId.includes('device-private-a'), 'loser audit ref must not leak the device id');
  assert.ok(!conflict.loserAuditId.includes('device-private-b'), 'loser audit ref must not leak the losing device id');
  assert.notEqual(conflict.winnerAuditId, conflict.loserAuditId, 'winner and loser refs stay distinguishable');
  // Direction independence: both devices see the same opaque refs.
  assert.equal(onB.conflicts[0].winnerAuditId, conflict.winnerAuditId);
  assert.equal(onB.conflicts[0].loserAuditId, conflict.loserAuditId);
  // Determinism: re-merging identical inputs reproduces the refs.
  const again = await mergeOn(base, A.current, A.ops, B.ops);
  assert.equal(again.conflicts[0].winnerAuditId, conflict.winnerAuditId);
  assert.equal(again.conflicts[0].loserAuditId, conflict.loserAuditId);
});

test('delete-versus-edit conflicts carry opaque audit references for both sides', async () => {
  const base = await projectionOf(baseWorkspace());
  const wsA = baseWorkspace();
  wsA.tasks.splice(0, 1);                       // A deletes t1
  const wsB = baseWorkspace();
  wsB.tasks[0].text = 'edit wins';              // B edits t1
  const A = await outboxFor(base, wsA, 'device-delta-a');
  const B = await outboxFor(base, wsB, 'device-delta-b');
  const onA = await mergeOn(base, A.current, A.ops, B.ops);

  const conflict = onA.conflicts.find(c => c.type === 'delete-edit-conflict');
  assert.ok(conflict, 'delete-versus-edit conflict exists');
  assert.match(conflict.winnerAuditId, /^[0-9a-f]{64}$/);
  assert.match(conflict.loserAuditId, /^[0-9a-f]{64}$/);
  assert.ok(!conflict.winnerAuditId.includes('device-delta-a'), 'winner audit ref must not leak the device id');
  assert.ok(!conflict.winnerAuditId.includes('device-delta-b'), 'winner audit ref must not leak the losing device id');
  assert.ok(!conflict.loserAuditId.includes('device-delta-a'), 'loser audit ref must not leak the device id');
  assert.ok(!conflict.loserAuditId.includes('device-delta-b'), 'loser audit ref must not leak the losing device id');
  assert.notEqual(conflict.winnerAuditId, conflict.loserAuditId);
});
