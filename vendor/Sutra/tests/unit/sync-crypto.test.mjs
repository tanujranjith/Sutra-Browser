import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const syncCrypto = require('../../src/sync/sync-crypto.js');
const protocol = require('../../src/sync/sync-protocol.js');

function sampleOp(overrides = {}) {
  return {
    opId: 'device-a:7',
    deviceId: 'device-a',
    lamport: 7,
    recordKey: protocol.collectionKey('pages', 'page-1'),
    kind: 'upsert',
    baseHash: null,
    hash: 'ab'.repeat(32),
    payload: { id: 'page-1', title: 'Biology notes', body: 'mitochondria' },
    schemaVersion: 5,
    protocolVersion: protocol.PROTOCOL_VERSION,
    clientTime: '2026-07-15T12:00:00.000Z',
    ...overrides
  };
}

test('vault key wrap/unwrap round-trips and honors KDF params', async () => {
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  assert.equal(keyBytes.length, 32);
  const wrapped = await syncCrypto.wrapVaultKey(keyBytes, 'correct horse battery', { iterations: 1000 });
  assert.equal(wrapped.v, 1);
  assert.match(wrapped.keyId, /^[0-9a-f]{64}$/);
  assert.equal(wrapped.kdf.name, 'PBKDF2');
  assert.equal(wrapped.kdf.iterations, 1000);
  assert.ok(wrapped.kdf.salt.length > 0);
  assert.ok(wrapped.iv.length > 0);
  const unlocked = await syncCrypto.unwrapVaultKey(wrapped, 'correct horse battery');
  // Round-trip proof: encrypt with the freshly imported key, decrypt with the unwrapped one.
  const original = await syncCrypto.importVaultKey(keyBytes);
  const op = sampleOp();
  const envelope = await syncCrypto.encryptOpEnvelope(original, op);
  const decrypted = await syncCrypto.decryptOpEnvelope(unlocked, envelope);
  assert.deepEqual(decrypted, op);
});

test('default wrap iteration count matches the repo convention (600k)', async () => {
  assert.equal(syncCrypto.KDF_ITERATIONS, 600000);
  const wrapped = await syncCrypto.wrapVaultKey(syncCrypto.generateVaultKeyBytes(), 'pw');
  assert.equal(wrapped.kdf.iterations, 600000);
});

test('wrong passphrase throws typed SyncVaultUnlockError and never returns a key', async () => {
  const wrapped = await syncCrypto.wrapVaultKey(syncCrypto.generateVaultKeyBytes(), 'right', { iterations: 1000 });
  await assert.rejects(
    () => syncCrypto.unwrapVaultKey(wrapped, 'wrong'),
    (error) => error.name === 'SyncVaultUnlockError' && error.code === 'vault-unlock-failed'
  );
});

test('tampered wrapped blob fails unlock', async () => {
  const wrapped = await syncCrypto.wrapVaultKey(syncCrypto.generateVaultKeyBytes(), 'pw', { iterations: 1000 });
  const tampered = { ...wrapped, wrapped: wrapped.wrapped.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => syncCrypto.unwrapVaultKey(tampered, 'pw'), (e) => e.name === 'SyncVaultUnlockError');
});

test('wrapped-key KDF and encoding parameters are bounded and validated before use', async () => {
  const key = syncCrypto.generateVaultKeyBytes();
  await assert.rejects(() => syncCrypto.wrapVaultKey(key, 'pw', { iterations: 999 }), /supported range/);
  await assert.rejects(() => syncCrypto.wrapVaultKey(key, 'pw', { iterations: 2000001 }), /supported range/);
  const wrapped = await syncCrypto.wrapVaultKey(key, 'pw', { iterations: 1000 });
  await assert.rejects(() => syncCrypto.unwrapVaultKey({ ...wrapped, kdf: { ...wrapped.kdf, iterations: 999 } }, 'pw'), /iteration/);
  await assert.rejects(() => syncCrypto.unwrapVaultKey({ ...wrapped, kdf: { ...wrapped.kdf, salt: 'AAAA' } }, 'pw'), /salt/);
  await assert.rejects(() => syncCrypto.unwrapVaultKey({ ...wrapped, iv: 'AAAA' }, 'pw'), /IV/);
  await assert.rejects(() => syncCrypto.unwrapVaultKey({ ...wrapped, keyId: '0'.repeat(64) }, 'pw'), (e) => e.name === 'SyncVaultUnlockError');
});

test('op envelope round-trips; ciphertext and metadata are AAD-bound', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const op = sampleOp();
  const envelope = await syncCrypto.encryptOpEnvelope(key, op);
  assert.deepEqual(protocol.validateEnvelope(envelope), []);
  assert.deepEqual(await syncCrypto.decryptOpEnvelope(key, envelope), op);

  // Tampered ciphertext fails.
  const badCt = { ...envelope, ct: envelope.ct.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => syncCrypto.decryptOpEnvelope(key, badCt), (e) => e.name === 'SyncVaultUnlockError' && e.code === 'encryption-error');

  // Relabelled routing metadata (server-side reroute) fails via AAD.
  const relabelled = { ...envelope, meta: { ...envelope.meta, recordKey: protocol.collectionKey('pages', 'other-page') } };
  await assert.rejects(() => syncCrypto.decryptOpEnvelope(key, relabelled), (e) => e.name === 'SyncVaultUnlockError' && e.code === 'encryption-error');

  const invalidIv = { ...envelope, iv: 'AAAA' };
  await assert.rejects(() => syncCrypto.decryptOpEnvelope(key, invalidIv), (e) => e.name === 'SyncVaultUnlockError' && e.code === 'encryption-error');
  const futureProtocol = { ...envelope, meta: { ...envelope.meta, protocolVersion: 99 } };
  await assert.rejects(() => syncCrypto.decryptOpEnvelope(key, futureProtocol), /Malformed sync envelope/);
});

test('envelope plaintext never leaks into the wire shape', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const envelope = await syncCrypto.encryptOpEnvelope(key, sampleOp());
  const wire = JSON.stringify(envelope);
  assert.ok(!wire.includes('Biology'), 'title leaked');
  assert.ok(!wire.includes('mitochondria'), 'body leaked');
});

test('a different key cannot decrypt an envelope', async () => {
  const keyA = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const keyB = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const envelope = await syncCrypto.encryptOpEnvelope(keyA, sampleOp());
  await assert.rejects(() => syncCrypto.decryptOpEnvelope(keyB, envelope), (e) => e.name === 'SyncVaultUnlockError');
});

test('IVs are unique across many envelopes', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const ivs = new Set();
  for (let i = 0; i < 200; i += 1) {
    const envelope = await syncCrypto.encryptOpEnvelope(key, sampleOp({ opId: `device-a:${i}`, lamport: i }));
    ivs.add(envelope.iv);
  }
  assert.equal(ivs.size, 200);
});

test('snapshot envelope round-trips and binds its cursor metadata', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const snapshot = { records: { 'c/pages/p1': { id: 'p1', title: 'secret title' } } };
  const envelope = await syncCrypto.encryptSnapshotEnvelope(key, snapshot, { cursor: 42, schemaVersion: 5 });
  assert.equal(envelope.meta.cursor, 42);
  assert.ok(!JSON.stringify(envelope).includes('secret title'));
  assert.deepEqual(await syncCrypto.decryptSnapshotEnvelope(key, envelope), snapshot);
  const moved = { ...envelope, meta: { ...envelope.meta, cursor: 43 } };
  await assert.rejects(() => syncCrypto.decryptSnapshotEnvelope(key, moved), (e) => e.name === 'SyncVaultUnlockError' && e.code === 'encryption-error');
  await assert.rejects(
    () => syncCrypto.decryptSnapshotEnvelope(key, { ...envelope, v: 2 }),
    /Malformed snapshot envelope/
  );
  await assert.rejects(
    () => syncCrypto.decryptSnapshotEnvelope(key, { ...envelope, meta: { ...envelope.meta, protocolVersion: 2 } }),
    /Malformed snapshot envelope/
  );
});

test('asset bytes round-trip and are bound to their content hash', async () => {
  const key = await syncCrypto.importVaultKey(syncCrypto.generateVaultKeyBytes());
  const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
  const hash = await protocol.hashText('asset-fixture');
  const envelope = await syncCrypto.encryptAssetBytes(key, bytes, hash);
  assert.deepEqual(Array.from(await syncCrypto.decryptAssetBytes(key, envelope)), Array.from(bytes));
  const swapped = { ...envelope, hash: await protocol.hashText('different') };
  await assert.rejects(() => syncCrypto.decryptAssetBytes(key, swapped), (e) => e.name === 'SyncVaultUnlockError' && e.code === 'encryption-error');
});

test('remote envelopes expose bounded routing metadata but no synthetic workspace, conflict, filename, key, or passphrase plaintext', async () => {
  const sentinels = {
    noteTitle: 'REMOTE_BOUNDARY_NOTE_TITLE_730',
    noteBody: 'REMOTE_BOUNDARY_NOTE_BODY_730',
    folder: 'REMOTE_BOUNDARY_FOLDER_730',
    task: 'REMOTE_BOUNDARY_TASK_730',
    course: 'REMOTE_BOUNDARY_COURSE_730',
    assistant: 'REMOTE_BOUNDARY_ASSISTANT_730',
    canvas: 'REMOTE_BOUNDARY_CANVAS_730',
    slides: 'REMOTE_BOUNDARY_SLIDES_730',
    filename: 'REMOTE_BOUNDARY_PRIVATE_FILENAME_730.txt',
    attachment: 'REMOTE_BOUNDARY_ATTACHMENT_BYTES_730',
    conflict: 'REMOTE_BOUNDARY_CONFLICT_BRANCH_730',
    passphrase: 'REMOTE_BOUNDARY_PASSPHRASE_730',
    recovery: 'REMOTE_BOUNDARY_RECOVERY_KEY_730'
  };
  const keyBytes = syncCrypto.generateVaultKeyBytes();
  const key = await syncCrypto.importVaultKey(keyBytes);
  const payload = {
    id: 'opaque-page-id',
    title: sentinels.noteTitle,
    content: sentinels.noteBody,
    folderName: sentinels.folder,
    task: sentinels.task,
    course: sentinels.course,
    assistantMessage: sentinels.assistant,
    canvas: { text: sentinels.canvas },
    slides: { text: sentinels.slides },
    attachment: { originalName: sentinels.filename },
    conflictAlternate: sentinels.conflict,
    recoveryKey: sentinels.recovery
  };
  const operation = sampleOp({
    recordKey: protocol.collectionKey('pages', 'opaque-page-id'),
    payload,
    hash: await protocol.hashValue(payload)
  });
  const opEnvelope = await syncCrypto.encryptOpEnvelope(key, operation);
  const snapshotEnvelope = await syncCrypto.encryptSnapshotEnvelope(
    key,
    { records: { [operation.recordKey]: payload } },
    { cursor: 7, schemaVersion: 5 }
  );
  const assetHash = await protocol.hashText(sentinels.attachment);
  const assetEnvelope = await syncCrypto.encryptAssetBytes(
    key,
    new TextEncoder().encode(sentinels.attachment),
    assetHash
  );
  const wrapped = await syncCrypto.wrapVaultKey(keyBytes, sentinels.passphrase, { iterations: 1000 });
  const remoteWire = JSON.stringify({ opEnvelope, snapshotEnvelope, assetEnvelope, wrapped });

  for (const [classification, sentinel] of Object.entries(sentinels)) {
    assert.equal(remoteWire.includes(sentinel), false, `${classification} leaked into remote wire`);
  }
  assert.equal(remoteWire.includes(Buffer.from(keyBytes).toString('base64')), false, 'unwrapped vault key leaked');
  assert.deepEqual(Object.keys(opEnvelope.meta).sort(), [
    'deviceId', 'kind', 'lamport', 'opId', 'protocolVersion', 'recordKey', 'schemaVersion'
  ]);
  assert.deepEqual(Object.keys(snapshotEnvelope.meta).sort(), [
    'cursor', 'protocolVersion', 'schemaVersion', 'type'
  ]);
  assert.deepEqual(Object.keys(assetEnvelope).sort(), ['alg', 'ct', 'hash', 'iv', 'v']);
  assert.match(assetEnvelope.hash, /^[0-9a-f]{64}$/);
});

test('recovery kit text embeds and re-parses the wrapped blob', async () => {
  const wrapped = await syncCrypto.wrapVaultKey(syncCrypto.generateVaultKeyBytes(), 'pw', { iterations: 1000 });
  const text = syncCrypto.buildRecoveryKitText(wrapped, { createdAt: '2026-07-15', accountLabel: 'student@example.com' });
  assert.ok(text.includes('SUTRA SYNC RECOVERY KIT'));
  const parsed = syncCrypto.parseRecoveryKitText(text);
  assert.deepEqual(parsed, wrapped);
  assert.equal(syncCrypto.parseRecoveryKitText('not a kit'), null);
});
