import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const transportApi = require('../../src/sync/sync-transport.js');
const syncCrypto = require('../../src/sync/sync-crypto.js');
const protocol = require('../../src/sync/sync-protocol.js');

async function makeEnvelope(key, opId, lamport, deviceId = 'dev-a', body = 'content') {
  const op = {
    opId, deviceId, lamport,
    recordKey: `c/pages/${opId.replace(':', '-')}`,
    kind: 'upsert', baseHash: null,
    hash: await protocol.hashValue({ body }),
    payload: { id: opId, body },
    schemaVersion: 5, protocolVersion: 1, clientTime: '2026-07-15T00:00:00.000Z'
  };
  return syncCrypto.encryptOpEnvelope(key, op);
}

test('memory server: push appends, pull pages, cursor advances, opId dedupes', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const server = transportApi.createMemoryServer();

  const env1 = await makeEnvelope(key, 'dev-a:1', 1);
  const env2 = await makeEnvelope(key, 'dev-a:2', 2);

  let result = server.push({ ops: [env1, env2], cursor: 0, deviceId: 'dev-a' });
  assert.equal(result.ok, true);
  assert.equal(result.cursor, 2);

  // Exact duplicate push (lost ack retry): succeeds without appending.
  result = server.push({ ops: [env1, env2], cursor: 0, deviceId: 'dev-a' });
  assert.equal(result.ok, true);
  assert.equal(result.cursor, 2);
  assert.equal(server.state.ops.length, 2);
  assert.equal(server.stats.dedupedOps, 2);

  // Stale cursor with fresh content is rejected.
  const env3 = await makeEnvelope(key, 'dev-b:1', 1, 'dev-b');
  result = server.push({ ops: [env3], cursor: 0, deviceId: 'dev-b' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stale-cursor');

  result = server.push({ ops: [env3], cursor: 2, deviceId: 'dev-b' });
  assert.equal(result.ok, true);
  assert.equal(result.cursor, 3);

  const pulled = server.pull({ cursor: 0, deviceId: 'dev-c' });
  assert.equal(pulled.ops.length, 3);
  assert.equal(pulled.cursor, 3);
  const partial = server.pull({ cursor: 2, deviceId: 'dev-c' });
  assert.deepEqual(partial.ops.map(e => e.meta.opId), ['dev-b:1']);
});

test('memory server rejects malformed envelopes wholesale', async () => {
  const server = transportApi.createMemoryServer();
  const result = server.push({ ops: [{ v: 1, alg: 'A256GCM', iv: 'x', ct: 'y', meta: {} }], cursor: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-envelope');
  assert.equal(server.state.ops.length, 0);
});

test('pruning retains the device sequence replay barrier', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const server = transportApi.createMemoryServer();
  const covered = await makeEnvelope(key, 'dev-a:1', 1);

  assert.equal(server.push({ ops: [covered], cursor: 0, deviceId: 'dev-a' }).ok, true);
  assert.equal(server.touchDevice({ deviceId: 'dev-a', cursor: 1 }).ok, true);
  assert.equal(server.putSnapshot({
    snapshot: { v: 1, meta: { type: 'snapshot', cursor: 1 } },
    cursor: 1,
    deviceId: 'dev-a'
  }).ok, true);
  assert.equal(server.pruneOps({ deviceId: 'dev-a' }).pruned, 1);
  assert.equal(server.state.ops.length, 0);

  const replay = server.push({ ops: [covered], cursor: 1, deviceId: 'dev-a' });
  assert.deepEqual(replay, { ok: false, code: 'device-sequence-collision' });
  assert.equal(server.state.ops.length, 0, 'a covered operation must not be resurrected after pruning');

  const fresh = await makeEnvelope(key, 'dev-a:2', 2);
  assert.equal(server.push({ ops: [fresh], cursor: 1, deviceId: 'dev-a' }).ok, true);
  assert.equal(server.state.ops.length, 1);
});

test('vault key, snapshot, and asset storage round-trip on the server', async () => {
  const server = transportApi.createMemoryServer();
  assert.equal(server.getVaultKey().wrapped, null);
  server.putVaultKey({ wrapped: { v: 1, kdf: {}, wrapped: 'blob' } });
  assert.equal(server.getVaultKey().wrapped.wrapped, 'blob');

  server.putSnapshot({ snapshot: { v: 1, meta: { type: 'snapshot', cursor: 0 } }, cursor: 0 });
  assert.equal(server.getSnapshot().cursor, 0);

  server.putAsset({ hash: 'abc', envelope: { v: 1, hash: 'abc', ct: 'x' } });
  assert.equal(server.hasAsset({ hash: 'abc' }).present, true);
  assert.equal(server.hasAsset({ hash: 'zzz' }).present, false);
  assert.equal(server.getAsset({ hash: 'abc' }).envelope.ct, 'x');
});

test('device registry: touch, list, revoke; revoked devices cannot pull or push', async () => {
  const server = transportApi.createMemoryServer();
  server.touchDevice({ deviceId: 'dev-a', label: 'Laptop' });
  server.touchDevice({ deviceId: 'dev-b', label: 'Desktop' });
  assert.equal(server.listDevices().devices.length, 2);

  server.revokeDevice({ targetDeviceId: 'dev-b', at: '2026-07-15' });
  assert.equal(server.pull({ cursor: 0, deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.push({ ops: [], cursor: 0, deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.getVaultKey({ deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.getSnapshot({ deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.hasAsset({ hash: 'abc', deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.getAsset({ hash: 'abc', deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.putAsset({ hash: 'abc', envelope: { ct: 'cipher' }, deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.listAssets({ deviceId: 'dev-b' }).code, 'revoked');
  assert.equal(server.pull({ cursor: 0, deviceId: 'dev-a' }).ok, true);
});

test('vault-key writes are create-only or compare-and-swap rewraps with the same keyId', async () => {
  const server = transportApi.createMemoryServer();
  const bytes = syncCrypto.generateVaultKeyBytes();
  const first = await syncCrypto.wrapVaultKey(bytes, 'first passphrase', { iterations: 1000 });
  const rewrapped = await syncCrypto.wrapVaultKey(bytes, 'second passphrase', { iterations: 1000 });
  const different = await syncCrypto.wrapVaultKey(syncCrypto.generateVaultKeyBytes(), 'other', { iterations: 1000 });
  assert.equal(server.putVaultKey({ wrapped: first }).ok, true);
  assert.equal(server.putVaultKey({ wrapped: different }).code, 'key-conflict');
  assert.equal(server.putVaultKey({ wrapped: rewrapped, expectedWrapped: different }).code, 'key-conflict');
  assert.equal(server.putVaultKey({ wrapped: rewrapped, expectedWrapped: first }).ok, true);
  assert.equal(server.getVaultKey().wrapped.keyId, first.keyId);
});

test('memory transport binds a deviceId and registers only through explicit touch', async () => {
  const server = transportApi.createMemoryServer();
  const transport = transportApi.createMemoryTransport(server, { deviceId: 'dev-x' });
  await transport.ping();
  await transport.pull({ cursor: 0 });
  assert.equal(server.state.devices['dev-x'], undefined, 'delivery alone is not a durable acknowledgement');
  await transport.touchDevice({ cursor: 0 });
  assert.ok(server.state.devices['dev-x'], 'explicit touch binds and registers the device');
});

test('REST transport speaks the Supabase RPC surface via injected fetch', async () => {
  const server = transportApi.createMemoryServer();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const name = url.split('/rest/v1/rpc/')[1];
    const { status, body } = server.handleRpc(name, JSON.parse(init.body));
    return {
      ok: status === 200,
      status,
      json: async () => body
    };
  };
  const transport = transportApi.createRestTransport({
    baseUrl: 'https://mock.supabase.co/',
    fetchImpl,
    deviceId: 'dev-rest',
    getAuthHeaders: () => ({ Authorization: 'Bearer test-token', apikey: 'anon' })
  });

  assert.deepEqual(await transport.ping(), { ok: true });
  const pulled = await transport.pull({ cursor: 0, userId: 'forged-account-a', user_id: 'forged-account-b' });
  assert.equal(pulled.ok, true);
  assert.deepEqual(pulled.ops, []);

  // URL shape + auth headers + deviceId injection all correct.
  assert.ok(calls[0].url.startsWith('https://mock.supabase.co/rest/v1/rpc/sync_ping'));
  assert.equal(calls[1].init.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(calls[1].init.body).deviceId, 'dev-rest');
  assert.equal(Object.hasOwn(JSON.parse(calls[1].init.body), 'userId'), false, 'transport must not send caller ownership hints');
  assert.equal(Object.hasOwn(JSON.parse(calls[1].init.body), 'user_id'), false, 'transport must not send caller ownership hints');

  // Error codes surface as structured results, not thrown JSON.
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const env = await makeEnvelope(key, 'dev-rest:1', 1, 'dev-rest');
  await transport.push({ ops: [env], cursor: 0 });
  const stale = await transport.push({ ops: [await makeEnvelope(key, 'dev-rest:2', 2, 'dev-rest')], cursor: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'stale-cursor');
});

test('revoke through a transport targets the named device, not the caller', async () => {
  const server = transportApi.createMemoryServer();
  server.touchDevice({ deviceId: 'dev-caller', label: 'caller' });
  server.touchDevice({ deviceId: 'dev-old-laptop', label: 'old laptop' });
  const transport = transportApi.createMemoryTransport(server, { deviceId: 'dev-caller' });
  await transport.revokeDevice({ targetDeviceId: 'dev-old-laptop' });
  const devices = (await transport.listDevices()).devices;
  assert.equal(devices.find(d => d.deviceId === 'dev-old-laptop').revokedAt !== null, true);
  assert.equal(devices.find(d => d.deviceId === 'dev-old-laptop').wipeRequired, true);
  assert.equal(devices.find(d => d.deviceId === 'dev-caller').revokedAt, null, 'caller must not revoke itself');
});

test('revoked-device wipe instruction is status-only, identity-bound, project-bound, and acknowledged after cleanup', async () => {
  const server = transportApi.createMemoryServer({ userId: 'account-a' });
  server.touchDevice({ deviceId: 'device-target' });
  server.touchDevice({ deviceId: 'device-controller' });
  server.revokeDevice({ deviceId: 'device-controller', targetDeviceId: 'device-target', at: '2026-07-16T12:00:00.000Z' });
  const target = transportApi.createMemoryTransport(server, { deviceId: 'device-target' });
  const status = await target.getDeviceStatus();
  assert.equal(status.code, 'DEVICE_REVOKED');
  assert.equal(transportApi.validateVerifiedWipeInstruction(status, {
    userId: 'account-a', deviceId: 'device-target',
    actualProjectUrl: 'https://project.supabase.co/', expectedProjectUrl: 'https://project.supabase.co'
  }), true);
  for (const invalid of [
    // A generic HTTP-ish failure, a transport failure, and malformed data are
    // never instructions to delete local user data.
    { ok: false, status: 401, code: 'auth-expired' },
    { ok: false, code: 'network-error' },
    { ok: false, code: 'timeout' },
    { ok: false, code: 'DEVICE_REVOKED', contract: 'not-sutra-device-status-v1' },
    { ok: true, code: 'DEVICE_REVOKED', contract: 'sutra-device-status-v1' },
    { ...status, deviceId: 'forged-device-id' },
    { ...status, code: 'revoked' },
    { ...status, userId: 'account-b' },
    { ...status, deviceId: 'device-other' },
    { ...status, wipeRequired: false },
    null
  ]) {
    assert.equal(transportApi.validateVerifiedWipeInstruction(invalid, {
      userId: 'account-a', deviceId: 'device-target',
      actualProjectUrl: 'https://project.supabase.co', expectedProjectUrl: 'https://project.supabase.co'
    }), false);
  }
  assert.equal(transportApi.validateVerifiedWipeInstruction(status, {
    userId: 'account-a', deviceId: 'device-target',
    actualProjectUrl: 'https://forged.example', expectedProjectUrl: 'https://project.supabase.co'
  }), false);
  const ack = await target.acknowledgeDeviceWipe({ at: '2026-07-16T12:01:00.000Z' });
  assert.equal(ack.ok, true);
  assert.equal((await target.getDeviceStatus()).wipeAcknowledgedAt, '2026-07-16T12:01:00.000Z');
});

test('deleteVault wipes ops, keys, snapshot, devices, and assets', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const server = transportApi.createMemoryServer();
  server.push({ ops: [await makeEnvelope(key, 'dev-a:1', 1)], cursor: 0, deviceId: 'dev-a' });
  server.putVaultKey({ wrapped: { v: 1, kdf: {}, wrapped: 'x' } });
  server.putSnapshot({ snapshot: { v: 1, meta: { type: 'snapshot', cursor: 1 } }, cursor: 1 });
  server.putAsset({ hash: 'h1', envelope: { v: 1, hash: 'h1', ct: 'c' } });
  const result = server.deleteVault();
  assert.equal(result.ok, true);
  assert.equal(server.state.ops.length, 0);
  assert.equal(server.getVaultKey().wrapped, null);
  assert.equal(server.getSnapshot().snapshot, null);
  assert.equal(server.hasAsset({ hash: 'h1' }).present, false);
  assert.equal(server.listDevices().devices.length, 0);
});

test('Supabase transport injects anon key + bearer token, and fails typed when signed out', async () => {
  const server = transportApi.createMemoryServer();
  const seenHeaders = [];
  const fetchImpl = async (url, init) => {
    seenHeaders.push(init.headers);
    const name = url.split('/rest/v1/rpc/')[1];
    const { status, body } = server.handleRpc(name, JSON.parse(init.body));
    return { ok: status === 200, status, json: async () => body };
  };
  let token = 'live-access-token';
  const transport = transportApi.createSupabaseTransport({
    baseUrl: 'https://real-project.supabase.co',
    anonKey: 'public-anon-key',
    deviceId: 'dev-sb',
    fetchImpl,
    getAccessToken: () => token
  });
  await transport.ping();
  assert.equal(seenHeaders[0].apikey, 'public-anon-key');
  assert.equal(seenHeaders[0].Authorization, 'Bearer live-access-token');

  token = null; // signed out → typed auth error BEFORE any network call
  await assert.rejects(() => transport.pull({ cursor: 0 }), (e) => e.code === 'auth-expired');
});

test('Supabase asset upload requires its index and vault deletion removes encrypted objects first', async () => {
  const calls = [];
  let failIndex = true;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/storage/v1/object/sync-assets/') && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.endsWith('/rest/v1/rpc/sync_put_asset')) {
      return { ok: true, status: 200, json: async () => failIndex ? { ok: false, code: 'index-down' } : { ok: true } };
    }
    if (url.endsWith('/rest/v1/rpc/sync_list_assets')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, hashes: ['a'.repeat(64)] }) };
    }
    if (url.endsWith('/storage/v1/object/sync-assets') && init.method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.endsWith('/rest/v1/rpc/sync_delete_vault')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  const transport = transportApi.createSupabaseTransport({
    baseUrl: 'https://real-project.supabase.co',
    anonKey: 'public-key',
    deviceId: 'dev-assets',
    fetchImpl,
    getAccessToken: () => 'access-token',
    getUserId: () => 'user-1'
  });
  const hash = 'a'.repeat(64);
  const assetEnvelope = { v: 1, alg: 'A256GCM', iv: 'a'.repeat(16), ct: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ==', hash };
  await assert.rejects(
    () => transport.putAsset({ hash, envelope: assetEnvelope, size_bytes: 10 }),
    (e) => e.code === 'index-down'
  );
  failIndex = false;
  assert.equal((await transport.putAsset({ hash, envelope: assetEnvelope, size_bytes: 10 })).ok, true);
  assert.equal((await transport.deleteVault()).ok, true);
  const remove = calls.find(call => call.url.endsWith('/storage/v1/object/sync-assets') && call.init.method === 'DELETE');
  assert.deepEqual(JSON.parse(remove.init.body).prefixes, [`user-1/${hash}`]);
});

test('Supabase asset transport rejects crafted paths and plaintext-shaped bodies before any request', async () => {
  const calls = [];
  const transport = transportApi.createSupabaseTransport({
    baseUrl: 'https://real-project.supabase.co',
    anonKey: 'public-key',
    deviceId: 'dev-assets',
    fetchImpl: async (url) => { calls.push(url); throw new Error('must not request'); },
    getAccessToken: () => 'access-token',
    getUserId: () => 'user-1'
  });
  await assert.rejects(
    () => transport.putAsset({ hash: 'user-a/secret-name.txt', envelope: { plaintext: 'nope' } }),
    /SHA-256 content hash/
  );
  for (const invalidHash of [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    `${'a'.repeat(64)}.txt`,
    `${'a'.repeat(64)}.sutra`,
    `extra/${'a'.repeat(64)}`,
    `${'a'.repeat(64)}/`,
    `${'a'.repeat(64)}?download=1`,
    `%2e%2e%2f${'a'.repeat(64)}`,
    ` ${'a'.repeat(64)}`
  ]) {
    await assert.rejects(() => transport.getAsset({ hash: invalidHash }), /SHA-256 content hash/);
  }
  const hash = 'b'.repeat(64);
  await assert.rejects(
    () => transport.putAsset({ hash, envelope: { v: 1, alg: 'A256GCM', iv: 'a'.repeat(16), ct: 'visible plaintext', hash } }),
    /malformed or unencrypted asset envelope/
  );
  await assert.rejects(() => transport.getAsset({ hash: '../account-a/object' }), /SHA-256 content hash/);
  assert.deepEqual(calls, [], 'invalid asset inputs must not reach Storage');
});

test('Supabase asset upload, download, retry, and delete reconstruct one account-scoped canonical path', async () => {
  const accountA = '11111111-1111-4111-8111-111111111111';
  const accountB = '22222222-2222-4222-8222-222222222222';
  const hash = 'c'.repeat(64);
  const envelope = {
    v: 1,
    alg: 'A256GCM',
    iv: 'a'.repeat(16),
    ct: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ==',
    hash
  };
  let currentUser = accountA;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/rest/v1/rpc/sync_put_asset')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/rest/v1/rpc/sync_list_assets')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, hashes: [hash] }) };
    }
    if (url.endsWith('/rest/v1/rpc/sync_delete_vault')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/storage/v1/object/sync-assets')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.includes('/storage/v1/object/authenticated/sync-assets/')) {
      return { ok: true, status: 200, json: async () => envelope };
    }
    if (url.includes('/storage/v1/object/sync-assets/')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  const transport = transportApi.createSupabaseTransport({
    baseUrl: 'https://real-project.supabase.co',
    anonKey: 'public-key',
    deviceId: 'device-label-must-not-enter-path',
    fetchImpl,
    getAccessToken: () => 'access-token',
    getUserId: () => currentUser
  });

  await transport.putAsset({ hash, envelope, size_bytes: 10, path: `${accountB}/${hash}`, filename: 'private.pdf' });
  await transport.putAsset({ hash, envelope, size_bytes: 10, label: 'mutable label' });
  await transport.getAsset({ hash, path: `${accountB}/${hash}` });
  await transport.deleteVault();
  currentUser = accountB;
  await transport.getAsset({ hash });

  const storageCalls = calls.filter(call => call.url.includes('/storage/v1/object/'));
  const uploads = storageCalls.filter(call => call.init.method === 'POST');
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].url, `https://real-project.supabase.co/storage/v1/object/sync-assets/${accountA}/${hash}`);
  assert.equal(uploads[1].url, uploads[0].url, 'retry must be idempotent by content hash');
  assert.equal(uploads[0].init.headers['x-upsert'], 'true', 'duplicate hashes use the same upsert path');
  const downloads = storageCalls.filter(call => call.init.method === 'GET');
  assert.deepEqual(downloads.map(call => call.url), [
    `https://real-project.supabase.co/storage/v1/object/authenticated/sync-assets/${accountA}/${hash}`,
    `https://real-project.supabase.co/storage/v1/object/authenticated/sync-assets/${accountB}/${hash}`
  ]);
  const removal = storageCalls.find(call => call.init.method === 'DELETE');
  assert.deepEqual(JSON.parse(removal.init.body), { prefixes: [`${accountA}/${hash}`] });
  const storageWire = JSON.stringify(storageCalls);
  assert.doesNotMatch(storageWire, /private\.pdf|mutable label|device-label-must-not-enter-path/);
  assert.doesNotMatch(storageWire, new RegExp(`${accountA}/${accountB}|${accountB}/${accountA}`));
});

test('REST transport throws a typed error on non-JSON HTTP failure', async () => {
  const transport = transportApi.createRestTransport({
    baseUrl: 'https://mock.supabase.co',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => { throw new Error('no body'); } })
  });
  await assert.rejects(() => transport.ping(), (e) => e.status === 503);
});

test('REST transport classifies auth, quota, and missing-schema failures', async () => {
  for (const [status, code] of [[401, 'auth-expired'], [413, 'quota-exceeded'], [404, 'schema-mismatch']]) {
    const transport = transportApi.createRestTransport({
      baseUrl: 'https://mock.supabase.co',
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'failed' }) })
    });
    await assert.rejects(() => transport.ping(), (e) => e.code === code);
  }
});

test('memory transport separates delivery from durable cursor acknowledgement', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const server = transportApi.createMemoryServer();
  const deviceA = transportApi.createMemoryTransport(server, { deviceId: 'device-a' });
  const deviceB = transportApi.createMemoryTransport(server, { deviceId: 'device-b' });
  await deviceA.touchDevice({ cursor: 0 });
  await deviceB.touchDevice({ cursor: 0 });
  const pushed = await deviceA.push({ ops: [await makeEnvelope(key, 'device-a:1', 1, 'device-a')], cursor: 0 });
  assert.equal(pushed.ok, true);
  assert.equal(server.state.devices['device-a'].lastSeenCursor, 0, 'push response is not a durable local ack');
  const pulled = await deviceB.pull({ cursor: 0 });
  assert.equal(pulled.cursor, 1);
  assert.equal(server.state.devices['device-b'].lastSeenCursor, 0, 'pull response is not a durable local ack');
  assert.equal((await deviceB.touchDevice({ cursor: pulled.cursor })).ok, true);
  assert.equal(server.state.devices['device-b'].lastSeenCursor, 1);
  assert.equal((await deviceB.touchDevice({ cursor: 2 })).code, 'bad-cursor', 'a client cannot acknowledge beyond the server head');
});
