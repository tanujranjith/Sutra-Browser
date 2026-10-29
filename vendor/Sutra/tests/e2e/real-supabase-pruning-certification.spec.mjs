import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Opt-in live certification for the durable-ack/pruning migration. It uses
// opaque synthetic envelopes in a disposable staging account and deletes that
// account's Sync vault in finally. No token or password is logged.
const RUN_REAL = process.env.SUTRA_REAL_PRUNING_CERTIFY === '1';
const BASE_URL = process.env.SUTRA_REAL_BASE_URL || 'http://127.0.0.1:5173/Sutra.html';
const PRODUCTION_PROJECT_URL = 'https://blfsmdyvdlhabltiicgx.supabase.co';
const PROJECT_URL = String(process.env.SUTRA_REAL_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const PROJECT_ANON_KEY = String(process.env.SUTRA_REAL_SUPABASE_ANON_KEY || '').trim();
const ACCOUNT_EMAIL = String(process.env.SUTRA_REAL_ACCOUNT_B_EMAIL || '').trim();
const ACCOUNT_PASSWORD = String(process.env.SUTRA_REAL_ACCOUNT_B_PASSWORD || '');
const MIGRATIONS_SOURCE = readFileSync(new URL('../../src/core/migrations.js', import.meta.url), 'utf8');
const WORKSPACE_SCHEMA = Number((MIGRATIONS_SOURCE.match(/\bCURRENT_VERSION\s*=\s*(\d+)/) || [])[1]);

test.skip(!RUN_REAL, 'Set SUTRA_REAL_PRUNING_CERTIFY=1 for real staging pruning certification.');

if (RUN_REAL) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(PROJECT_URL)) {
    throw new Error('SUTRA_REAL_SUPABASE_URL must name the disposable staging Supabase project.');
  }
  if (!PROJECT_ANON_KEY || !ACCOUNT_EMAIL || !ACCOUNT_PASSWORD) {
    throw new Error('The staging publishable key and Account B password credentials are required.');
  }
  if (!Number.isInteger(WORKSPACE_SCHEMA) || WORKSPACE_SCHEMA < 1) {
    throw new Error('Could not resolve the current workspace schema version.');
  }
  if (PROJECT_URL.toLowerCase() === PRODUCTION_PROJECT_URL.toLowerCase()) {
    throw new Error('Live pruning certification refuses to target production.');
  }
}

async function openSession(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const blockedProductionRequests = [];
  await context.route(`${PRODUCTION_PROJECT_URL}/**`, route => {
    blockedProductionRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  const identity = await page.evaluate(async ({ projectUrl, anonKey, email, password }) => {
    const response = await fetch(projectUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token || !json?.user?.id) {
      throw new Error('The staging password session could not be established.');
    }
    sessionStorage.setItem('sutra:pruningCertificationSession:v1', JSON.stringify({
      accessToken: String(json.access_token),
      userId: String(json.user.id)
    }));
    return String(json.user.id);
  }, {
    projectUrl: PROJECT_URL,
    anonKey: PROJECT_ANON_KEY,
    email: ACCOUNT_EMAIL,
    password: ACCOUNT_PASSWORD
  });
  expect(identity).toBeTruthy();
  expect(blockedProductionRequests).toEqual([]);
  return { context, page, label, deviceId: crypto.randomUUID() };
}

async function rpc(session, name, body) {
  return session.page.evaluate(async ({ projectUrl, anonKey, name, body }) => {
    const auth = JSON.parse(sessionStorage.getItem('sutra:pruningCertificationSession:v1') || 'null');
    if (!auth?.accessToken) throw new Error('The staging RPC session is missing.');
    const response = await fetch(projectUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: 'Bearer ' + auth.accessToken,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    return {
      status: response.status,
      json: await response.json().catch(() => null)
    };
  }, { projectUrl: PROJECT_URL, anonKey: PROJECT_ANON_KEY, name, body });
}

function opEnvelope(deviceId, sequence, marker) {
  return {
    v: 1,
    alg: 'A256GCM',
    iv: 'AAAAAAAAAAAAAAAA',
    ct: 'A'.repeat(32),
    meta: {
      opId: `${deviceId}:${sequence}`,
      deviceId,
      lamport: sequence,
      recordKey: `c/pages/prune-${marker}`,
      kind: 'upsert',
      protocolVersion: 1,
      schemaVersion: WORKSPACE_SCHEMA
    }
  };
}

function snapshotEnvelope(cursor) {
  return {
    v: 1,
    alg: 'A256GCM',
    iv: 'BBBBBBBBBBBBBBBB',
    ct: 'B'.repeat(32),
    meta: { type: 'snapshot', protocolVersion: 1, schemaVersion: WORKSPACE_SCHEMA, cursor }
  };
}

async function expectOk(result) {
  expect(result.status, JSON.stringify(result.json)).toBe(200);
  expect(result.json).toEqual(expect.objectContaining({ ok: true }));
  return result.json;
}

test('real staging durable acknowledgements, pruning, replay rejection, and RPC concurrency', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const marker = Date.now().toString(36);
  const A = await openSession(browser, 'prune-device-a');
  const B = await openSession(browser, 'prune-device-b');
  let registeredA = false;
  try {
    await expectOk(await rpc(A, 'sync_touch_device', { deviceId: A.deviceId, label: A.label, cursor: null }));
    registeredA = true;
    // Begin from an account-local clean slate, then re-register the caller
    // because deleting the vault intentionally removes its device row too.
    await expectOk(await rpc(A, 'sync_delete_vault', { deviceId: A.deviceId }));
    await expectOk(await rpc(A, 'sync_touch_device', { deviceId: A.deviceId, label: A.label, cursor: null }));
    await expectOk(await rpc(B, 'sync_touch_device', { deviceId: B.deviceId, label: B.label, cursor: null }));

    const noSnapshot = await expectOk(await rpc(A, 'sync_prune_ops', { deviceId: A.deviceId }));
    expect(noSnapshot).toEqual(expect.objectContaining({ pruned: 0, reason: 'no-snapshot' }));

    const firstEnvelope = opEnvelope(A.deviceId, 1, marker + '-one');
    const firstPush = await expectOk(await rpc(A, 'sync_push', {
      deviceId: A.deviceId,
      cursor: 0,
      ops: [firstEnvelope]
    }));
    const firstHead = Number(firstPush.cursor);
    expect(firstHead).toBeGreaterThan(0);

    const delivered = await expectOk(await rpc(B, 'sync_pull', {
      deviceId: B.deviceId,
      cursor: 0,
      max_rows: 50
    }));
    expect(delivered.ops).toHaveLength(1);
    expect(Number(delivered.cursor)).toBe(firstHead);
    await expectOk(await rpc(A, 'sync_put_snapshot', {
      deviceId: A.deviceId,
      cursor: firstHead,
      snapshot: snapshotEnvelope(firstHead)
    }));

    // Delivery is not durability: neither push nor pull advanced an explicit
    // acknowledgement, so the active-device floor is zero and nothing prunes.
    const zeroFloor = await expectOk(await rpc(A, 'sync_prune_ops', { deviceId: A.deviceId }));
    expect(zeroFloor).toEqual(expect.objectContaining({ pruned: 0, reason: 'no-floor' }));

    await expectOk(await rpc(A, 'sync_touch_device', { deviceId: A.deviceId, cursor: firstHead }));
    const staleDeviceFloor = await expectOk(await rpc(A, 'sync_prune_ops', { deviceId: A.deviceId }));
    expect(staleDeviceFloor).toEqual(expect.objectContaining({ pruned: 0, reason: 'no-floor' }));

    await expectOk(await rpc(B, 'sync_touch_device', { deviceId: B.deviceId, cursor: firstHead }));
    const prunedFirst = await expectOk(await rpc(A, 'sync_prune_ops', { deviceId: A.deviceId }));
    expect(prunedFirst.pruned).toBe(1);
    expect(Number(prunedFirst.floor)).toBe(firstHead);

    const replay = await rpc(A, 'sync_push', {
      deviceId: A.deviceId,
      cursor: firstHead,
      ops: [firstEnvelope]
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(expect.objectContaining({ ok: false, code: 'device-sequence-collision' }));

    const secondEnvelope = opEnvelope(A.deviceId, 2, marker + '-two');
    const secondPush = await expectOk(await rpc(A, 'sync_push', {
      deviceId: A.deviceId,
      cursor: firstHead,
      ops: [secondEnvelope]
    }));
    const secondHead = Number(secondPush.cursor);
    expect(secondHead).toBeGreaterThan(firstHead);
    await expectOk(await rpc(A, 'sync_touch_device', { deviceId: A.deviceId, cursor: secondHead }));
    await expectOk(await rpc(B, 'sync_touch_device', { deviceId: B.deviceId, cursor: secondHead }));
    await expectOk(await rpc(A, 'sync_put_snapshot', {
      deviceId: A.deviceId,
      cursor: secondHead,
      snapshot: snapshotEnvelope(secondHead)
    }));

    const thirdEnvelope = opEnvelope(A.deviceId, 3, marker + '-three');
    const concurrent = await Promise.all([
      rpc(A, 'sync_push', { deviceId: A.deviceId, cursor: secondHead, ops: [thirdEnvelope] }),
      rpc(A, 'sync_pull', { deviceId: A.deviceId, cursor: 0, max_rows: 50 }),
      rpc(A, 'sync_put_snapshot', {
        deviceId: A.deviceId,
        cursor: secondHead,
        snapshot: snapshotEnvelope(secondHead)
      }),
      rpc(A, 'sync_prune_ops', { deviceId: A.deviceId })
    ]);
    for (const result of concurrent) await expectOk(result);

    const finalPull = await expectOk(await rpc(A, 'sync_pull', {
      deviceId: A.deviceId,
      cursor: secondHead,
      max_rows: 50
    }));
    const finalHead = Number(finalPull.cursor);
    expect(finalHead).toBeGreaterThan(secondHead);
    expect(finalPull.ops.some(row => row?.meta?.opId === thirdEnvelope.meta.opId)).toBe(true);
  } finally {
    if (registeredA) await rpc(A, 'sync_delete_vault', { deviceId: A.deviceId }).catch(() => undefined);
    await Promise.allSettled([A.context.close(), B.context.close()]);
  }
});
