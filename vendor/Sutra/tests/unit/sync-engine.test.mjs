import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engineApi = require('../../src/sync/sync-engine.js');
const transportApi = require('../../src/sync/sync-transport.js');
const syncCrypto = require('../../src/sync/sync-crypto.js');
const projectionApi = require('../../src/sync/sync-projection.js');

// In-memory stand-in for SutraSyncStore (same API surface the engine uses).
function makeMemoryStore() {
  const state = { meta: new Map(), baseline: null, outbox: new Map(), tombstones: {}, conflicts: new Map() };
  return {
    state,
    async getMeta(key) { return state.meta.has(key) ? state.meta.get(key) : null; },
    async setMeta(key, value) { state.meta.set(key, value); },
    async getBaseline() { return state.baseline; },
    async setBaseline(b) { state.baseline = b; },
    async getOutbox() { return [...state.outbox.values()].sort((a, b) => a.recordKey < b.recordKey ? -1 : 1); },
    async replaceOutbox(ops) {
      state.outbox.clear();
      for (const op of ops) state.outbox.set(op.recordKey, op);
    },
    async getTombstones() { return state.tombstones; },
    async setTombstones(map) { state.tombstones = map || {}; },
    async listConflicts(options = {}) {
      const rows = [...state.conflicts.values()];
      return options.includeResolved ? rows : rows.filter(row => !row.resolvedAt);
    },
    async putConflict(c) {
      const prior = state.conflicts.get(c.id);
      if (prior?.resolvedAt) return;
      state.conflicts.set(c.id, c);
    },
    async resolveConflict(id, resolution) {
      const prior = state.conflicts.get(id);
      if (prior) state.conflicts.set(id, { ...prior, resolvedAt: 1, resolution });
    },
    async removeConflict(id) { state.conflicts.delete(id); },
    async getAssetState(hash) { return state.meta.get(`asset:${hash}`) || null; },
    async setAssetState(hash, value) { state.meta.set(`asset:${hash}`, value); },
    async commitCycleState(commit) {
      if (commit.baseline !== undefined) state.baseline = commit.baseline;
      if (commit.outboxOps !== undefined) {
        state.outbox.clear();
        for (const op of commit.outboxOps) state.outbox.set(op.recordKey, op);
      }
      if (commit.tombstones !== undefined) state.tombstones = commit.tombstones;
      if (commit.meta) for (const [k, v] of Object.entries(commit.meta)) state.meta.set(k, v);
    }
  };
}

function makeBridge(initialWorkspace) {
  const holder = { workspace: JSON.parse(JSON.stringify(initialWorkspace)), applies: 0, saveIdle: true };
  return {
    holder,
    getWorkspaceSnapshot: async () => JSON.parse(JSON.stringify(holder.workspace)),
    applyMergedWorkspace: async (merged) => { holder.workspace = JSON.parse(JSON.stringify(merged)); holder.applies += 1; },
    isSaveIdle: () => holder.saveIdle
  };
}

function starterWorkspace() {
  return {
    version: 5,
    pages: [{ id: 'p1', title: 'Shared note', body: 'start' }],
    tasks: [{ id: 't1', text: 'existing task', done: false }],
    taskOrder: ['t1'],
    settings: { theme: 'dark', preferences: {} }
  };
}

async function makeDevice(server, deviceId, vaultKeyBytes, workspace = starterWorkspace()) {
  const store = makeMemoryStore();
  const bridge = makeBridge(workspace);
  const vaultKey = await syncCrypto.importVaultKey(vaultKeyBytes);
  const engine = engineApi.create({
    store,
    transport: transportApi.createMemoryTransport(server, { deviceId }),
    bridge,
    identity: { deviceId, schemaVersion: 5 },
    vaultKey,
    debounceMs: 0,
    timers: { now: () => 1800000000000 }
  });
  return { store, bridge, engine, deviceId };
}

function pagesOf(device) {
  return device.bridge.holder.workspace.pages;
}

test('happy path: edit on A propagates to B through the server', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);

  // Both devices do an initial sync from identical state.
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'edited on A';
  const pushOutcome = await A.engine.syncNow();
  assert.ok(pushOutcome.pushed > 0);

  const pullOutcome = await B.engine.syncNow();
  assert.equal(pullOutcome.applied, true);
  assert.equal(pagesOf(B)[0].body, 'edited on A');
  assert.equal(A.engine.getStatus().state, 'idle');
  assert.equal(B.engine.getStatus().state, 'idle');
});

test('server only ever sees ciphertext', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  A.bridge.holder.workspace.pages[0].body = 'very secret plaintext';
  await A.engine.syncNow();
  const serverText = JSON.stringify(server.state);
  assert.ok(!serverText.includes('very secret plaintext'));
  assert.ok(!serverText.includes('Shared note'));
});

test('offline: ops queue locally and drain on reconnect', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  await A.engine.syncNow();

  // Sever the network: wrap pull to fail.
  const realPull = server.pull;
  server.pull = () => { throw new Error('network down'); };
  A.bridge.holder.workspace.pages[0].body = 'offline edit';
  const failed = await A.engine.syncNow();
  assert.ok(failed.error);
  assert.equal(A.engine.getStatus().state, 'offline');
  const queued = await A.store.getOutbox();
  assert.ok(queued.length > 0, 'offline edits must be durably queued before the failed pull');
  const queuedIds = queued.map(op => op.opId);

  server.pull = realPull;
  A.engine.resume(); // clears backoff/paused bookkeeping
  const recovered = await A.engine.syncNow();
  assert.ok(recovered.pushed > 0);
  assert.ok(server.state.ops.some(row => queuedIds.includes(row.envelope.meta.opId)), 'retry must reuse the queued idempotency keys');

  const B = await makeDevice(server, 'device-b', keyBytes);
  await B.engine.syncNow();
  assert.equal(pagesOf(B)[0].body, 'offline edit');
});

test('double sync is idempotent: second cycle pushes nothing new', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  A.bridge.holder.workspace.pages[0].body = 'one edit';
  await A.engine.syncNow();
  const opsAfterFirst = server.state.ops.length;
  const second = await A.engine.syncNow();
  assert.equal(server.state.ops.length, opsAfterFirst, 'no new server ops');
  assert.equal(second.pushed, 0);
  assert.equal(second.applied, false, 'no echo re-apply');
});

test('server pruning cursor advances only after the local cycle commit is durable', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const realCommit = A.store.commitCycleState;
  A.store.commitCycleState = async () => { throw new Error('cycle commit failed'); };

  const failed = await A.engine.syncNow();
  assert.match(failed.error?.message || '', /cycle commit failed/);
  assert.equal(server.state.devices['device-a'], undefined,
    'pull/push delivery must not acknowledge a cursor before durable local commit');

  A.store.commitCycleState = realCommit;
  A.engine.resume();
  const recovered = await A.engine.syncNow();
  assert.ok(recovered.cursor > 0);
  assert.equal(server.state.devices['device-a'].lastSeenCursor, recovered.cursor,
    'the explicit post-commit acknowledgement advances the pruning cursor');
});

test('compaction pruning preserves the logical head and accepts later pushes', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();
  const headBeforePrune = server.state.head;
  assert.ok(headBeforePrune > 0);

  const compacted = await A.engine.compactNow();
  assert.equal(compacted.ok, true);
  assert.equal(server.state.ops.length, 0, 'all snapshot-covered acknowledged ops may be pruned');
  assert.equal(server.state.head, headBeforePrune, 'pruning must not collapse the logical cursor head');

  A.bridge.holder.workspace.pages[0].body = 'edit after prune';
  const pushed = await A.engine.syncNow();
  assert.ok(pushed.pushed > 0, 'a baseline at the snapshot cursor remains a valid push base');
  assert.ok(server.state.head > headBeforePrune);
  await B.engine.syncNow();
  assert.equal(pagesOf(B)[0].body, 'edit after prune');
});

test('remote apply does not echo back as new ops', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'from A';
  await A.engine.syncNow();
  await B.engine.syncNow(); // B applies A's edit
  const opsBefore = server.state.ops.length;
  const echo = await B.engine.syncNow();
  assert.equal(server.state.ops.length, opsBefore, 'apply must not re-broadcast');
  assert.equal(echo.pushed, 0);
});

test('observed remote Lamport advances the next local operation high-water', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  await B.store.setMeta('lamport', 500);
  B.bridge.holder.workspace.pages[0].title = 'high clock title';
  await B.engine.syncNow();
  const remoteLamport = Math.max(...server.state.ops
    .filter(row => row.envelope.meta.deviceId === 'device-b')
    .map(row => row.envelope.meta.lamport));
  assert.ok(remoteLamport > 500);

  await A.engine.syncNow();
  assert.ok(Number(await A.store.getMeta('lamport')) >= remoteLamport, 'pull must raise the stored high-water');
  A.bridge.holder.workspace.pages[0].body = 'local write after observing B';
  await A.engine.syncNow();
  const localLamport = Math.max(...server.state.ops
    .filter(row => row.envelope.meta.deviceId === 'device-a')
    .map(row => row.envelope.meta.lamport));
  assert.ok(localLamport > remoteLamport, 'the next local op must follow the observed remote clock');
});

test('concurrent same-page edits converge with one review record and no workspace copy', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'A version';
  B.bridge.holder.workspace.pages[0].body = 'B version';

  await A.engine.syncNow();          // A pushes
  const bOutcome = await B.engine.syncNow(); // B pulls, records conflict, pushes deterministic winner
  assert.ok(bOutcome.conflicts > 0);
  await A.engine.syncNow();          // A pulls B's resolution

  const projA = projectionApi.buildProjection(A.bridge.holder.workspace);
  const projB = projectionApi.buildProjection(B.bridge.holder.workspace);
  assert.deepEqual(
    await projectionApi.hashProjection(projA),
    await projectionApi.hashProjection(projB),
    'devices must converge'
  );
  assert.equal(pagesOf(A).length, 1, 'conflict must not become a sidebar page');
  const conflicts = await B.store.listConflicts();
  assert.equal(conflicts.length, 1, 'one conflict recorded for review');
  assert.equal(conflicts[0].type, 'page-content-conflict');
  const bodies = [conflicts[0].localValue.body, conflicts[0].remoteValue.body].sort();
  assert.deepEqual(bodies, ['A version', 'B version'], 'review record preserves both versions');
  await B.store.putConflict(conflicts[0]);
  assert.equal((await B.store.listConflicts()).length, 1, 'replay deduplicates by stable conflict id');

  const resolutionId = `sync-resolution-${conflicts[0].id}-keep-merged`;
  B.bridge.holder.workspace.syncAuditLog = [{
    id: resolutionId,
    kind: 'sync_conflict_resolution',
    conflictId: conflicts[0].id,
    recordKey: conflicts[0].recordKey,
    resolution: 'keep-merged'
  }];
  await B.engine.syncNow();
  assert.equal((await B.store.listConflicts()).length, 0, 'local marker resolves the review record');

  // Simulate another device that had independently retained the same review
  // item. Pulling the encrypted marker resolves it there too, and replay is
  // quiescent rather than manufacturing the conflict again.
  await A.store.putConflict(conflicts[0]);
  await A.engine.syncNow();
  assert.equal((await A.store.listConflicts()).length, 0, 'resolution propagates to every device');
  const settledOps = server.state.ops.length;
  const settled = await A.engine.syncNow();
  assert.equal(settled.pushed, 0);
  assert.equal(server.state.ops.length, settledOps);
});

test('conflict-store failure aborts before apply, push, or baseline advance', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'A branch';
  B.bridge.holder.workspace.pages[0].body = 'B branch';
  await A.engine.syncNow();

  const baselineBefore = await B.store.getBaseline();
  const appliesBefore = B.bridge.holder.applies;
  const serverOpsBefore = server.state.ops.length;
  const realPutConflict = B.store.putConflict;
  B.store.putConflict = async () => { throw new Error('conflict store unavailable'); };

  const failed = await B.engine.syncNow();
  assert.match(failed.error?.message || '', /conflict store unavailable/);
  assert.equal(B.bridge.holder.workspace.pages[0].body, 'B branch', 'local branch remains displayed');
  assert.equal(B.bridge.holder.applies, appliesBefore, 'remote winner is not applied without durable review');
  assert.equal(server.state.ops.length, serverOpsBefore, 'no merged winner is pushed');
  assert.equal((await B.store.getBaseline()).cursor, baselineBefore.cursor, 'cursor does not advance');
  assert.ok((await B.store.getOutbox()).length > 0, 'local branch remains in the durable outbox');

  B.store.putConflict = realPutConflict;
  B.engine.resume();
  const recovered = await B.engine.syncNow();
  assert.ok(recovered.conflicts > 0, 'retry records the review item after storage recovers');
  assert.equal((await B.store.listConflicts()).length, 1);
});

test('conflict storm circuit breaker pauses before apply or push and preserves the outbox', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const workspace = starterWorkspace();
  workspace.pages = Array.from({ length: 8 }, (_, index) => ({
    id: `storm-${index}`, title: `Storm ${index}`, body: 'base'
  }));
  const A = await makeDevice(server, 'device-a', keyBytes, workspace);
  const B = await makeDevice(server, 'device-b', keyBytes, workspace);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages.forEach(page => { page.body = `A ${page.id}`; });
  B.bridge.holder.workspace.pages.forEach(page => { page.body = `B ${page.id}`; });
  await A.engine.syncNow();
  const serverOpsBeforeBreaker = server.state.ops.length;
  const baselineBeforeBreaker = await B.store.getBaseline();

  const outcome = await B.engine.syncNow();
  assert.equal(outcome.error?.code, 'conflict-storm');
  assert.equal(B.engine.getStatus().state, 'conflict-storm');
  assert.equal(server.state.ops.length, serverOpsBeforeBreaker, 'breaker must not push conflict-loop output');
  assert.equal((await B.store.getBaseline()).cursor, baselineBeforeBreaker.cursor, 'breaker must not advance the cursor');
  assert.equal((await B.store.getOutbox()).length, 8, 'local edits remain durably queued');
  assert.ok(B.bridge.holder.workspace.pages.every(page => page.body.startsWith('B ')), 'remote state is not applied after the breaker trips');
});

test('delete on A vs edit on B: the edit survives everywhere', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages = [];
  B.bridge.holder.workspace.pages[0].body = 'edited while deleted elsewhere';

  await A.engine.syncNow();
  await B.engine.syncNow();
  await A.engine.syncNow();

  assert.equal(pagesOf(A).length, 1, 'record resurrected on A');
  assert.equal(pagesOf(A)[0].body, 'edited while deleted elsewhere');
  assert.equal(pagesOf(B)[0].body, 'edited while deleted elsewhere');
  assert.equal((await B.store.listConflicts()).filter(c => c.type === 'delete-edit-conflict').length, 1);
});

test('stale cursor race: A re-pulls and re-pushes within one syncNow call', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.tasks[0].done = true;
  B.bridge.holder.workspace.pages[0].body = 'B slips in first';

  // B pushes between A's pull and push: hook the server's push so B's
  // content lands the moment A first attempts to push.
  const realPush = server.push;
  let interposed = false;
  server.push = (input) => {
    if (!interposed && input.deviceId === 'device-a') {
      interposed = true;
      // B syncs synchronously from the server's perspective.
      return (async () => {
        await B.engine.syncNow();
        return realPush(input); // now A's cursor is stale
      })();
    }
    return realPush(input);
  };

  const outcome = await A.engine.syncNow();
  server.push = realPush;
  assert.ok(!outcome.error, `cycle should survive the race: ${outcome.error}`);

  await B.engine.syncNow();
  assert.equal(pagesOf(A)[0].body, 'B slips in first');
  assert.equal(A.bridge.holder.workspace.tasks[0].done, true);
  assert.equal(B.bridge.holder.workspace.tasks[0].done, true);
});

test('busy save defers the apply without corrupting anything', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();
  await B.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'incoming';
  await A.engine.syncNow();

  B.bridge.holder.saveIdle = false;
  const deferred = await B.engine.syncNow();
  assert.equal(deferred.applied, false);
  assert.equal(pagesOf(B)[0].body, 'start', 'no mutation while save is busy');

  B.bridge.holder.saveIdle = true;
  await B.engine.syncNow();
  assert.equal(pagesOf(B)[0].body, 'incoming');
});

test('ops from a future schema pause the engine without mutating state', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  await A.engine.syncNow();

  // A "newer" device pushes a schemaVersion 99 op.
  const vaultKey = await syncCrypto.importVaultKey(keyBytes);
  const futureOp = {
    opId: 'device-z:1', deviceId: 'device-z', lamport: 1,
    recordKey: 'c/pages/pfuture', kind: 'upsert', baseHash: null,
    hash: 'a'.repeat(64), payload: { id: 'pfuture' },
    schemaVersion: 99, protocolVersion: 1, clientTime: '2026-07-15T00:00:00.000Z'
  };
  server.push({ ops: [await syncCrypto.encryptOpEnvelope(vaultKey, futureOp)], cursor: server.state.head, deviceId: 'device-z' });

  const before = JSON.stringify(A.bridge.holder.workspace);
  const outcome = await A.engine.syncNow();
  assert.ok(outcome.error);
  assert.equal(A.engine.getStatus().state, 'update-required');
  assert.equal(JSON.stringify(A.bridge.holder.workspace), before, 'workspace untouched');
});

test('tampered remote envelopes abort the cycle without mutating state', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  const B = await makeDevice(server, 'device-b', keyBytes);
  await A.engine.syncNow();

  A.bridge.holder.workspace.pages[0].body = 'legit edit';
  await A.engine.syncNow();

  // Corrupt the stored ciphertext server-side.
  server.state.ops[0].envelope.ct = server.state.ops[0].envelope.ct.slice(0, -4) + 'AAAA';

  const before = JSON.stringify(B.bridge.holder.workspace);
  const outcome = await B.engine.syncNow();
  assert.ok(outcome.error);
  assert.equal(JSON.stringify(B.bridge.holder.workspace), before, 'workspace untouched by tampered data');
});

test('a revoked device pauses instead of retrying forever', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  let verificationRequests = 0;
  A.bridge.onDeviceRevoked = async () => { verificationRequests += 1; };
  await A.engine.syncNow();
  server.revokeDevice({ targetDeviceId: 'device-a', at: 'now' });
  A.bridge.holder.workspace.pages[0].body = 'after revocation';
  const outcome = await A.engine.syncNow();
  assert.ok(outcome.error);
  assert.equal(A.engine.getStatus().state, 'revoked');
  assert.equal(verificationRequests, 1, 'revocation asks the app to perform the dedicated verification step once');
});

test('auth expiry and quota failures enter explicit paused states', async () => {
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  for (const [code, expected] of [['auth-expired', 'auth-expired'], ['quota-exceeded', 'quota-exceeded']]) {
    const store = makeMemoryStore();
    const bridge = makeBridge(starterWorkspace());
    let revocationChecks = 0;
    bridge.onDeviceRevoked = async () => { revocationChecks += 1; };
    const engine = engineApi.create({
      store,
      transport: {
        async getSnapshot() { return { ok: true, snapshot: null }; },
        async pull() { const error = new Error(code); error.code = code; throw error; }
      },
      bridge,
      identity: { deviceId: `device-${code}`, schemaVersion: 5 },
      vaultKey: await syncCrypto.importVaultKey(keyBytes),
      debounceMs: 0
    });
    const outcome = await engine.syncNow();
    assert.ok(outcome.error);
    assert.equal(engine.getStatus().state, expected);
    assert.equal(revocationChecks, 0, `${code} must not be interpreted as a wipe signal`);
    assert.equal((await engine.syncNow()).skipped, true, 'paused terminal state must not request-storm');
  }
});

test('a deliberate pause wins over an auth error from an already in-flight cycle', async () => {
  let releasePull;
  let markPullStarted;
  const pullStarted = new Promise(resolve => { markPullStarted = resolve; });
  const pullGate = new Promise(resolve => { releasePull = resolve; });
  const engine = engineApi.create({
    store: makeMemoryStore(),
    transport: {
      async getSnapshot() { return { ok: true, snapshot: null }; },
      async pull() {
        markPullStarted();
        await pullGate;
        const error = new Error('signed out while request was in flight');
        error.code = 'auth-expired';
        throw error;
      }
    },
    bridge: makeBridge(starterWorkspace()),
    identity: { deviceId: 'device-manual-pause', schemaVersion: 5 },
    vaultKey: await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes()),
    debounceMs: 0
  });

  const cycle = engine.syncNow();
  await pullStarted;
  engine.pause();
  releasePull();
  const outcome = await cycle;

  assert.ok(outcome.error, 'the abandoned request remains observable to its caller');
  assert.equal(engine.getStatus().state, 'paused', 'ordinary sign-out remains an intentional pause');
  assert.equal((await engine.syncNow()).skipped, true, 'the paused engine makes no follow-up request');
});

test('retry backoff includes deterministic jitter through the injected timer seam', async () => {
  const delays = [];
  const store = makeMemoryStore();
  const bridge = makeBridge(starterWorkspace());
  const engine = engineApi.create({
    store,
    transport: {
      async getSnapshot() { return { ok: true, snapshot: null }; },
      async pull() { throw new Error('offline'); }
    },
    bridge,
    identity: { deviceId: 'device-jitter', schemaVersion: 5 },
    vaultKey: await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes()),
    debounceMs: 0,
    timers: {
      now: () => 1800000000000,
      random: () => 0,
      setTimeout: (_fn, ms) => { delays.push(ms); return delays.length; },
      clearTimeout: () => {}
    }
  });
  await engine.syncNow();
  assert.deepEqual(delays, [4000], 'first 5s retry receives -20% jitter');
  engine.stop();
});

test('locked engine refuses to run until a vault key is provided', async () => {
  const server = transportApi.createMemoryServer();
  const store = makeMemoryStore();
  const bridge = makeBridge(starterWorkspace());
  const engine = engineApi.create({
    store,
    transport: transportApi.createMemoryTransport(server, { deviceId: 'device-l' }),
    bridge,
    identity: { deviceId: 'device-l', schemaVersion: 5 },
    vaultKey: null,
    debounceMs: 0
  });
  const outcome = await engine.syncNow();
  assert.equal(outcome.skipped, true);
  assert.equal(engine.getStatus().state, 'locked');
  engine.setVaultKey(await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes()));
  assert.equal(engine.getStatus().state, 'idle');
});

test('new-device bootstrap: snapshot + tail ops union with local state, never diff-delete', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();

  // Device A builds the vault and uploads a compaction snapshot.
  const A = await makeDevice(server, 'device-a', keyBytes);
  A.bridge.holder.workspace.pages.push({ id: 'pa-vault', title: 'Vault page', body: 'from the vault' });
  await A.engine.syncNow();
  const compact = await A.engine.compactNow();
  assert.equal(compact.ok, true);
  // Simulate server-side pruning of everything the snapshot contains.
  const snapshotCursor = server.getSnapshot().cursor;
  server.state.ops = server.state.ops.filter(o => o.seq > snapshotCursor);
  // A pushes one more op AFTER the snapshot.
  A.bridge.holder.workspace.tasks.push({ id: 'ta-tail', text: 'after snapshot', done: false });
  await A.engine.syncNow();

  // A brand-new device with its OWN local page joins the vault.
  const B = await makeDevice(server, 'device-b', keyBytes, {
    version: 5,
    pages: [{ id: 'pb-local', title: 'Local-only page', body: 'existed before joining' }],
    tasks: [], taskOrder: [], settings: { preferences: {} }
  });
  const boot = await B.engine.syncNow();
  assert.ok(!boot.error, `bootstrap failed: ${boot.error}`);

  const bPages = pagesOf(B).map(p => p.id);
  assert.ok(bPages.includes('pa-vault'), 'vault snapshot content must arrive');
  assert.ok(bPages.includes('pb-local'), 'local pre-join content must survive');
  assert.ok(B.bridge.holder.workspace.tasks.some(t => t.id === 'ta-tail'), 'post-snapshot tail ops must replay');

  // And B's local page must reach A (pushed during bootstrap).
  await A.engine.syncNow();
  assert.ok(pagesOf(A).some(p => p.id === 'pb-local'), 'joining device content must flow back');
});

test('auto-compaction uploads a snapshot once enough ops accumulate', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const A = await makeDevice(server, 'device-a', keyBytes);
  await A.engine.syncNow();
  assert.equal(server.getSnapshot().snapshot, null, 'no snapshot below the threshold');

  // Cross the 500-op threshold with many task creates.
  for (let batch = 0; batch < 6; batch += 1) {
    for (let i = 0; i < 100; i += 1) {
      A.bridge.holder.workspace.tasks.push({ id: `bulk-${batch}-${i}`, text: 'x', done: false });
    }
    await A.engine.syncNow();
  }
  const snap = server.getSnapshot();
  assert.ok(snap.snapshot, 'snapshot must exist after crossing the threshold');
  assert.ok(snap.cursor > 500);
  // The snapshot decrypts to the acknowledged projection.
  const vaultKey = await syncCrypto.importVaultKey(keyBytes);
  const decrypted = await syncCrypto.decryptSnapshotEnvelope(vaultKey, snap.snapshot);
  assert.ok(Object.keys(decrypted.records).length > 500);
});

test('attachments: encrypted blobs flow device-to-device by content hash', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const protocol = require('../../src/sync/sync-protocol.js');

  const fileDataUrl = 'data:application/pdf;base64,SlVTVCBBIFRFU1QgUERG';
  const fileHash = await protocol.hashText(fileDataUrl);

  // Device-local blob stores keyed by blobKey.
  const blobsA = new Map([['blob-1', fileDataUrl]]);
  const blobsB = new Map();

  function assetBridge(baseBridge, blobs) {
    return {
      ...baseBridge,
      getSyncAssetInventory: async () => {
        const ws = baseBridge.holder.workspace;
        const files = (ws.courseWorkspace && ws.courseWorkspace.files) || [];
        return files
          .filter(f => f.blobKey && f.syncContentHash)
          .map(f => ({ hash: f.syncContentHash, blobKey: f.blobKey, present: blobs.has(f.blobKey) }));
      },
      readSyncAssetDataUrl: async (hash) => {
        const ws = baseBridge.holder.workspace;
        const files = (ws.courseWorkspace && ws.courseWorkspace.files) || [];
        const entry = files.find(f => f.syncContentHash === hash);
        return entry && blobs.has(entry.blobKey) ? blobs.get(entry.blobKey) : null;
      },
      storeSyncAssetDataUrl: async (blobKey, dataUrl) => { blobs.set(blobKey, dataUrl); return true; }
    };
  }

  const workspaceWithFile = {
    ...starterWorkspace(),
    courseWorkspace: {
      courses: [{ id: 'course-1', name: 'Bio' }],
      files: [{ id: 'file-1', courseId: 'course-1', name: 'lab.pdf', kind: 'file', storageType: 'indexeddb', blobKey: 'blob-1', syncContentHash: fileHash }],
      resourceLinks: [], relationships: [], settings: {}
    }
  };

  const A = await makeDevice(server, 'device-a', keyBytes, workspaceWithFile);
  A.engine.stop();
  const engineA = engineApi.create({
    store: A.store,
    transport: transportApi.createMemoryTransport(server, { deviceId: 'device-a' }),
    bridge: assetBridge(A.bridge, blobsA),
    identity: { deviceId: 'device-a', schemaVersion: 5 },
    vaultKey: await syncCrypto.importVaultKey(keyBytes),
    debounceMs: 0,
    timers: { now: () => 1800000000000 }
  });
  const pushOutcome = await engineA.syncNow();
  assert.ok(!pushOutcome.error, String(pushOutcome.error));
  assert.equal(server.hasAsset({ hash: fileHash }).present, true, 'blob uploaded before the record pushed');
  assert.ok(!JSON.stringify(server.state.assets).includes('SlVTVCBBIFRFU1Q'), 'server must hold ciphertext only');

  const B = await makeDevice(server, 'device-b', keyBytes);
  B.engine.stop();
  const engineB = engineApi.create({
    store: B.store,
    transport: transportApi.createMemoryTransport(server, { deviceId: 'device-b' }),
    bridge: assetBridge(B.bridge, blobsB),
    identity: { deviceId: 'device-b', schemaVersion: 5 },
    vaultKey: await syncCrypto.importVaultKey(keyBytes),
    debounceMs: 0,
    timers: { now: () => 1800000000000 }
  });
  const pullOutcome = await engineB.syncNow();
  assert.ok(!pullOutcome.error, String(pullOutcome.error));
  assert.equal(blobsB.get('blob-1'), fileDataUrl, 'blob downloaded, decrypted, and stored under the record blobKey');
  assert.ok(B.bridge.holder.workspace.courseWorkspace.files.some(f => f.id === 'file-1'));
  assert.equal(engineB.getStatus().assetsPending, 0);
});

test('compaction refuses to publish a complete snapshot while a required asset is missing', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const store = makeMemoryStore();
  const baseBridge = makeBridge(starterWorkspace());
  const missingHash = 'a'.repeat(64);
  const bridge = {
    ...baseBridge,
    getSyncAssetInventory: async () => [{ hash: missingHash, blobKey: 'missing-blob', present: false }],
    readSyncAssetDataUrl: async () => null,
    storeSyncAssetDataUrl: async () => true
  };
  const engine = engineApi.create({
    store,
    transport: transportApi.createMemoryTransport(server, { deviceId: 'device-missing-asset' }),
    bridge,
    identity: { deviceId: 'device-missing-asset', schemaVersion: 5 },
    vaultKey: await syncCrypto.importVaultKey(keyBytes),
    debounceMs: 0,
    timers: { now: () => 1800000000000 }
  });
  await engine.syncNow();
  const compact = await engine.compactNow();
  assert.equal(compact.ok, false);
  assert.equal(compact.reason, 'assets-pending');
  assert.equal(server.getSnapshot().snapshot, null);
});

test('three devices converge after interleaved edits', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const devices = await Promise.all(['device-a', 'device-b', 'device-c'].map(id => makeDevice(server, id, keyBytes)));
  for (const d of devices) await d.engine.syncNow();

  devices[0].bridge.holder.workspace.pages.push({ id: 'pa', title: 'From A', body: 'a' });
  devices[1].bridge.holder.workspace.tasks.push({ id: 'tb', text: 'From B', done: false });
  devices[2].bridge.holder.workspace.pages[0].body = 'C touched the shared note';

  // Two full rounds of sync propagate everything everywhere.
  for (let round = 0; round < 2; round += 1) {
    for (const d of devices) await d.engine.syncNow();
  }

  const hashes = await Promise.all(devices.map(async (d) =>
    projectionApi.hashProjection(projectionApi.buildProjection(d.bridge.holder.workspace))
  ));
  assert.deepEqual(hashes[0], hashes[1]);
  assert.deepEqual(hashes[1], hashes[2]);
  assert.equal(pagesOf(devices[1]).some(p => p.id === 'pa'), true);
  assert.equal(devices[2].bridge.holder.workspace.tasks.some(t => t.id === 'tb'), true);
});

test('long-running three-device convergence settles with no record, op, or conflict growth', async () => {
  const server = transportApi.createMemoryServer();
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const devices = await Promise.all(['device-a', 'device-b', 'device-c'].map(id => makeDevice(server, id, keyBytes)));
  for (const device of devices) await device.engine.syncNow();

  const expectedPageIds = new Set(pagesOf(devices[0]).map(page => page.id));
  const expectedTaskIds = new Set(devices[0].bridge.holder.workspace.tasks.map(task => task.id));
  for (let round = 0; round < 10; round += 1) {
    devices.forEach((device, index) => {
      const pageId = `long-page-${index}-${round}`;
      const taskId = `long-task-${index}-${round}`;
      device.bridge.holder.workspace.pages.push({ id: pageId, title: `Page ${index}/${round}`, body: `unique-${index}-${round}` });
      device.bridge.holder.workspace.tasks.push({ id: taskId, text: `Task ${index}/${round}`, done: round % 2 === 0 });
      expectedPageIds.add(pageId);
      expectedTaskIds.add(taskId);
    });
    // Rotate push order to exercise stale-cursor recovery and replay order.
    for (let offset = 0; offset < devices.length; offset += 1) {
      await devices[(round + offset) % devices.length].engine.syncNow();
    }
  }

  // One same-record, non-overlapping edit must merge without producing a
  // review record: A changes the title while B changes the body.
  devices[0].bridge.holder.workspace.pages[0].title = 'long-run merged title';
  devices[1].bridge.holder.workspace.pages[0].body = 'long-run merged body';
  for (let settle = 0; settle < 5; settle += 1) {
    for (const device of devices) await device.engine.syncNow();
  }

  const hashes = await Promise.all(devices.map(async device =>
    projectionApi.hashProjection(projectionApi.buildProjection(device.bridge.holder.workspace))
  ));
  assert.deepEqual(hashes[0], hashes[1]);
  assert.deepEqual(hashes[1], hashes[2]);
  for (const device of devices) {
    assert.deepEqual(new Set(pagesOf(device).map(page => page.id)), expectedPageIds, 'every unique page survives');
    assert.deepEqual(new Set(device.bridge.holder.workspace.tasks.map(task => task.id)), expectedTaskIds, 'every unique task survives');
    assert.equal((await device.store.listConflicts()).length, 0, 'non-overlapping work creates no conflicts');
  }

  const stableOpCount = server.state.ops.length;
  const stablePageCounts = devices.map(device => pagesOf(device).length);
  for (let idleRound = 0; idleRound < 5; idleRound += 1) {
    for (const device of devices) {
      const outcome = await device.engine.syncNow();
      assert.equal(outcome.pushed, 0, 'settled device must emit no operation');
      assert.equal(outcome.conflicts, 0, 'settled device must create no conflict');
    }
  }
  assert.equal(server.state.ops.length, stableOpCount, 'idle replay cannot grow the op log');
  assert.deepEqual(devices.map(device => pagesOf(device).length), stablePageCounts, 'idle replay cannot grow records');
});
