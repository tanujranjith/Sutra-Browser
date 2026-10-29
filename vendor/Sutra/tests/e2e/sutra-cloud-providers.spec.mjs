import { expect, test } from '@playwright/test';
import { waitForAppHydrated, waitForAppReady } from './helpers/app-ready.mjs';
import { installInspectableBlobRequests } from './helpers/inspectable-blob-requests.mjs';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });
import { readFileSync } from 'node:fs';

// Sutra Cloud — provider-agnostic encrypted backup. These tests mock the Supabase
// provider's REST surface (its origin is the one pinned in the CSP, so it's the
// only network provider testable in the hosted build). WebDAV/Custom HTTP/S3 are
// custom-origin providers blocked by CSP in the hosted build — we assert that
// blocking + their no-network behaviors instead.

const PASS = 'correct horse battery staple';
const EMAIL = 'student@example.com';
const USER_ID = 'user-1';

// Supabase origin must equal the one pinned in Sutra.html's CSP.
function detectSupabaseOrigin() {
  try {
    const m = readFileSync('Sutra.html', 'utf8').match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
    if (m) return m[0];
  } catch (e) {}
  return 'https://YOUR-PROJECT-REF.supabase.co';
}
const SUPA_URL = detectSupabaseOrigin();

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
}

function configureSupabase(page) {
  return page.addInitScript(({ url }) => { window.SUTRA_CONFIG = { supabaseUrl: url, supabaseAnonKey: 'test-anon-key' }; }, { url: SUPA_URL });
}

async function installSupabaseMock(page, sharedState) {
  const state = sharedState || {
    objects: new Map(),
    index: [],
    uploads: [],
    uploadAttempts: [],
    indexAttempts: [],
    deletes: [],
    nextId: 1,
    nextVer: 1,
    settingsHits: 0,
    failNextUpload: false,
    failNextIndex: false,
    failNextLogout: false,
    deleteFailureStatus: 0,
    deleteNotFound: false
  };
  await page.route(`${SUPA_URL}/**`, async route => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname;
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/auth/v1/otp' && method === 'POST') return json(200, {});
    if (path === '/auth/v1/verify' && method === 'POST') { const b = JSON.parse(req.postData() || '{}'); return json(200, { access_token: 'a1', token_type: 'bearer', expires_in: 3600, refresh_token: 'r1', user: { id: USER_ID, email: b.email || EMAIL } }); }
    if (path === '/auth/v1/token' && method === 'POST') return json(200, { access_token: 'a2', expires_in: 3600, refresh_token: 'r1', user: { id: USER_ID, email: EMAIL } });
    if (path === '/auth/v1/settings') { state.settingsHits += 1; return json(200, {}); }
    if (path === '/auth/v1/logout') {
      if (state.failNextLogout) {
        state.failNextLogout = false;
        return route.abort('failed');
      }
      return route.fulfill({ status: 204, body: '' });
    }
    if (path.startsWith('/storage/v1/object/authenticated/backups/') && method === 'GET') {
      const key = decodeURIComponent(path.replace('/storage/v1/object/authenticated/backups/', ''));
      const bytes = state.objects.get(key);
      return bytes ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes }) : route.fulfill({ status: 404, body: 'x' });
    }
    if (path.startsWith('/storage/v1/object/backups/') && method === 'POST') {
      const key = decodeURIComponent(path.replace('/storage/v1/object/backups/', ''));
      state.uploadAttempts.push({ key, upsert: req.headers()['x-upsert'] || '' });
      if (state.failNextUpload) {
        state.failNextUpload = false;
        return json(503, { message: 'storage unavailable' });
      }
      const bytes = req.postDataBuffer() || Buffer.alloc(0);
      state.objects.set(key, bytes); state.uploads.push({ key, bytes, upsert: req.headers()['x-upsert'] || '' });
      return json(200, { Key: `backups/${key}` });
    }
    if (path.startsWith('/storage/v1/object/backups/') && method === 'DELETE') {
      const key = decodeURIComponent(path.replace('/storage/v1/object/backups/', ''));
      state.deletes.push({ bucket: 'backups', key });
      if (state.deleteFailureStatus) return json(state.deleteFailureStatus, { message: 'cleanup unavailable' });
      if (state.deleteNotFound) {
        state.deleteNotFound = false;
        state.objects.delete(key);
        return json(404, { message: 'not found' });
      }
      state.objects.delete(key);
      return json(200, {});
    }
    if (path === '/rest/v1/backup_index' && method === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      state.indexAttempts.push(b);
      if (state.failNextIndex) { state.failNextIndex = false; return json(500, { message: 'index unavailable' }); }
      state.index.push({ id: `i${state.nextId++}`, path: b.path, label: b.label || 'Backup', size_bytes: b.size_bytes || 0, device_id: b.device_id || '', created_at: new Date(Date.UTC(2026, 5, 18, 12, state.nextVer++, 0)).toISOString() }); return route.fulfill({ status: 201, body: '' });
    }
    if (path === '/rest/v1/backup_index' && method === 'GET') return json(200, [...state.index].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
    if (path === '/rest/v1/backup_index' && method === 'DELETE') { const id = (url.searchParams.get('id') || '').replace('eq.', ''); state.index = state.index.filter(r => r.id !== id); return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 500, body: `Unhandled: ${method} ${url.href}` });
  });
  return state;
}

async function openApp(page, { withConfig = true, persistReady = true } = {}) {
  await installInspectableBlobRequests(page, [
    `${SUPA_URL}/`, 'https://www.googleapis.com/',
    'https://graph.microsoft.com/', 'https://content.dropboxapi.com/'
  ]);
  if (withConfig) await configureSupabase(page);
  const supa = await installSupabaseMock(page);
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  if (persistReady) await waitForAppReady(page);
  else await waitForAppHydrated(page);
  if (persistReady) {
    await completeOnboarding(page);
    await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
  }
  return supa;
}

async function seedWorkspace(page, marker) {
  await page.evaluate(async ({ marker }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const now = new Date().toISOString();
    window.deserializeWorkspace({ ...base, pages: [{ id: `p-${marker}`, title: `Sentinel ${marker}`, content: `<p>Body ${marker}</p>`, blocks: [], icon: 'doc', collapsed: false, createdAt: now, updatedAt: now }], tasks: [{ id: `t-${marker}`, title: `Task ${marker}`, status: 'todo', priority: 'high' }] });
    sessionStorage.setItem('openai_api_key', `sk-secret-${marker}`);
    await window.saveWorkspaceLocally();
  }, { marker });
}

async function useSupabaseSignedIn(page) {
  await page.evaluate(async ({ email }) => {
    await window.SutraCloudSync.switchProvider('supabase');
    await window.SutraCloudSync.verifyCode(email, '123456');
  }, { email: EMAIL });
  expect(await page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);
}

async function fillCloudPassword(page, pass = PASS, confirm = true) {
  await expect(page.locator('#sutraCloudSyncPasswordModal')).toHaveClass(/active/, { timeout: 20_000 });
  await page.fill('#sutraCloudSyncPassphraseInput', pass);
  if (confirm) await page.fill('#sutraCloudSyncPassphraseConfirmInput', pass);
  await page.locator('#sutraCloudSyncPasswordSubmitBtn').click();
}

async function completeSafetySnapshotDialog(page, pass = PASS) {
  const modal = page.locator('#sutraBackupPasswordModal');
  await modal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', pass);
  await page.fill('#sutraBackupPassphraseConfirmInput', pass);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  await expect(modal).not.toHaveClass(/active/, { timeout: 60_000 });
}

function parseEnvelopeHeader(buffer) { return JSON.parse(buffer.slice(13, 13 + buffer.readUInt32BE(9)).toString('utf8')); }

// ---------------------------------------------------------------------------

test('fresh boot + provider registry make zero cloud requests; registry loads', async ({ page }) => {
  let reqs = 0;
  page.on('request', r => { if (r.url().startsWith(SUPA_URL)) reqs += 1; });
  await openApp(page);
  const providers = await page.evaluate(() => window.SutraCloudSync.listProviders());
  expect(providers.length).toBeGreaterThanOrEqual(8);
  const ids = providers.map(p => p.id);
  expect(ids).toEqual(expect.arrayContaining(['googledrive', 'onedrive', 'dropbox', 'webdav', 's3', 'supabase', 'customhttp', 'manual']));
  expect(providers.find(p => p.id === 'googledrive').category).toBe('recommended');
  expect(providers.find(p => p.id === 'webdav').category).toBe('advanced');
  expect(reqs).toBe(0); // consent-first: nothing contacted the cloud on boot or registry read
});

test('panel shows recommended cards, hides advanced by default, manual always available', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.SutraCloudSync.open());
  await expect(page.locator('#sutraCloudCardsRecommended')).toContainText('Google Drive');
  // Google Drive is the single recommended student option; OneDrive and Dropbox
  // (OAuth-client-ID paste) are now grouped under Advanced.
  await expect(page.locator('#sutraCloudCardsAdvanced')).toContainText('Dropbox');
  await expect(page.locator('#sutraCloudCardsManual')).toContainText('Manual encrypted file');
  expect(await page.locator('#sutraCloudAdvanced').evaluate(el => el.open)).toBe(false); // advanced hidden by default
});

test('selecting a provider shows only that provider’s setup form', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.SutraCloudSync.open());
  await page.evaluate(() => window.SutraCloudSync.switchProvider('webdav'));
  await expect(page.locator('#sutraCloudSetupArea')).toContainText('WebDAV server URL');
  await expect(page.locator('#sutraCloudSetupArea')).not.toContainText('Enter the code from your email');
});

test('saving provider config stores via SafeStorage and makes zero requests', async ({ page }) => {
  let reqs = 0;
  page.on('request', r => { if (r.url().startsWith('https://') && !r.url().includes('127.0.0.1') && !r.url().includes('localhost')) { /* external only */ } });
  let webdavReqs = 0;
  page.on('request', r => { if (r.url().includes('cloud.example.com')) webdavReqs += 1; });
  await openApp(page);
  const out = await page.evaluate(() => {
    window.SutraCloudSync.saveProviderConfig('webdav', { url: 'https://cloud.example.com/dav/', username: 'me', password: 'app-pw', folder: 'sutra' });
    return { cfg: window.SutraCloudSync.getProviderConfig('webdav'), stored: localStorage.getItem('sutra:cloudProvider:webdav:v1') };
  });
  expect(out.cfg.username).toBe('me');
  expect(out.stored).toContain('cloud.example.com');
  expect(webdavReqs).toBe(0); // saving config uploads/contacts nothing
});

test('custom provider with non-allowlisted origin reports the CSP limitation (no request)', async ({ page }) => {
  let webdavReqs = 0;
  page.on('request', r => { if (r.url().includes('cloud.example.com')) webdavReqs += 1; });
  await openApp(page);
  const res = await page.evaluate(async () => {
    window.SutraCloudSync.saveProviderConfig('webdav', { url: 'https://cloud.example.com/dav/', username: 'me', password: 'app-pw' });
    const status = window.SutraCloudSync.getProviderConfig('webdav');
    const test = await window.SutraCloudSync.testProvider('webdav', { url: 'https://cloud.example.com/dav/', username: 'me', password: 'app-pw' });
    return { test };
  });
  expect(res.test.ok).toBe(false);
  expect(res.test.status).toBe('csp-blocked');
  expect(res.test.message).toMatch(/security policy|self-hosted|CSP/i);
  expect(webdavReqs).toBe(0); // CSP-blocked origin is never fetched
});

test('invalid URLs and dangerous secrets are rejected', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => ({
    badUrl: window.SutraCloudSync.isValidHttpsUrl('http://not-https.example'),
    goodUrl: window.SutraCloudSync.isValidHttpsUrl('https://cloud.example.com'),
    svcJwt: window.SutraCloudSync.looksLikeDangerousSecret(`h.${btoa(JSON.stringify({ role: 'service_role' }))}.s`),
    svcSecret: window.SutraCloudSync.looksLikeDangerousSecret('sb_secret_abc'),
    anonOk: window.SutraCloudSync.looksLikeDangerousSecret('sb_publishable_abc')
  }));
  expect(out.badUrl).toBe(false);
  expect(out.goodUrl).toBe(true);
  expect(out.svcJwt).toBe(true);
  expect(out.svcSecret).toBe(true);
  expect(out.anonOk).toBe(false);
});

test('Supabase provider: backup uploads encrypted bytes only (no plaintext)', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'UP');
  await useSupabaseSignedIn(page);
  const r = page.evaluate(() => window.SutraCloudSync.backupNow().then(x => (x && x.uploaded ? 'ok' : 'no')));
  await fillCloudPassword(page);
  expect(await r).toBe('ok');
  expect(supa.uploads).toHaveLength(1);
  expect(supa.uploads[0].bytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC');
  const header = parseEnvelopeHeader(supa.uploads[0].bytes);
  expect(header.kdf).toMatchObject({ name: 'PBKDF2', iterations: 600000 });
  const txt = supa.uploads[0].bytes.toString('utf8');
  expect(txt).not.toContain('Sentinel UP');
  expect(txt).not.toContain('sk-secret-UP');
  const ls = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(ls).not.toContain(PASS);
  expect(supa.uploads[0].upsert).toBe('false');
  expect(supa.indexAttempts).toHaveLength(1);
  expect(supa.index).toHaveLength(1);
  expect(supa.deletes).toHaveLength(0);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta())).toMatchObject({
    lastError: ''
  });
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta().lastBackupAt)).toBeTruthy();
});

test('Supabase session credentials are tab-session only and legacy durable tokens are removed', async ({ page }) => {
  await openApp(page);
  await useSupabaseSignedIn(page);
  const storage = await page.evaluate(() => ({
    local: localStorage.getItem('sutra:supabaseSession:v1'),
    session: sessionStorage.getItem('sutra:supabaseSession:v1')
  }));
  expect(storage.local).toBeNull();
  expect(storage.session).toContain('"refreshToken":"r1"');
  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.SutraCloudSync);
  // Session restoration refreshes the token asynchronously after the shell and
  // cloud runtime are exposed, so assert the eventual authenticated state.
  await expect.poll(() => page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('sutra:supabaseSession:v1'))).toBeNull();
});

test('remembered Supabase session survives a new page in the same browser profile', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await window.SutraCloudSync.switchProvider('supabase'); });
  await page.locator('#storageOptions').hover();
  await page.locator('#sutraCloudOpenBtn').click();
  await expect(page.locator('#sutraCloudRememberSessionInput')).toBeVisible();
  await page.check('#sutraCloudRememberSessionInput');
  await page.evaluate(async ({ email }) => {
    await window.SutraCloudSync.verifyCode(email, '123456');
  }, { email: EMAIL });
  expect(await page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);

  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await openApp(reopened);
  await reopened.evaluate(() => window.SutraCloudSync.open());
  expect(await reopened.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);
  expect(await reopened.evaluate(() => localStorage.getItem('sutra:supabaseSession:v1'))).toBeNull();
  expect(await reopened.evaluate(() => sessionStorage.getItem('sutra:supabaseSession:v1'))).toContain('"refreshToken":"r1"');
  await context.close();
});

test('visible Cloud sign-out removes the remembered session even when remote logout fails', async ({ page }) => {
  const supa = await openApp(page);
  await page.evaluate(async () => { await window.SutraCloudSync.switchProvider('supabase'); });
  await page.locator('#storageOptions').hover();
  await page.locator('#sutraCloudOpenBtn').click();
  await expect(page.locator('#sutraCloudRememberSessionInput')).toBeVisible();
  await page.check('#sutraCloudRememberSessionInput');
  await page.evaluate(async ({ email }) => {
    await window.SutraCloudSync.verifyCode(email, '123456');
    await window.SutraCloudSync.open();
  }, { email: EMAIL });

  await expect.poll(() => page.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).not.toBeNull();
  supa.failNextLogout = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).toBeNull();

  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await openApp(reopened);
  await reopened.evaluate(() => window.SutraCloudSync.open());
  expect(await reopened.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(false);
  expect(await reopened.evaluate(() => sessionStorage.getItem('sutra:supabaseSession:v1'))).toBeNull();
  await context.close();
});

test('Cloud sign-out wins over an already in-flight remembered-session write', async ({ page }) => {
  const supa = await openApp(page);
  await page.evaluate(async () => { await window.SutraCloudSync.switchProvider('supabase'); });
  await page.locator('#storageOptions').hover();
  await page.locator('#sutraCloudOpenBtn').click();
  await expect(page.locator('#sutraCloudRememberSessionInput')).toBeVisible();
  await page.check('#sutraCloudRememberSessionInput');

  await page.evaluate(({ email }) => {
    const originalSetGuarded = window.SutraCredentialVault.setGuarded;
    let releaseWrite;
    let markWriteStarted;
    let delayed = false;
    window.__sutraVaultWriteStarted = new Promise(resolve => { markWriteStarted = resolve; });
    window.__sutraReleaseVaultWrite = () => releaseWrite();
    const release = new Promise(resolve => { releaseWrite = resolve; });
    window.SutraCredentialVault.setGuarded = function (name, value, generation) {
      if (name === 'cloud:supabaseSession:v1' && !delayed) {
        delayed = true;
        markWriteStarted();
        return release.then(() => originalSetGuarded.call(this, name, value, generation));
      }
      return originalSetGuarded.call(this, name, value, generation);
    };
    window.__sutraPendingVerify = window.SutraCloudSync.verifyCode(email, '123456');
  }, { email: EMAIL });

  await page.evaluate(() => window.__sutraVaultWriteStarted);
  supa.failNextLogout = true;
  await page.evaluate(() => window.SutraCloudSync.signOut());
  await page.evaluate(async () => {
    window.__sutraReleaseVaultWrite();
    await window.__sutraPendingVerify;
  });

  await expect.poll(() => page.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).toBeNull();
});

test('Cloud sign-out blocks a stale tab from re-capturing its old session', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const first = await context.newPage();
  await openApp(first);
  await first.evaluate(async () => { await window.SutraCloudSync.switchProvider('supabase'); });
  await first.locator('#storageOptions').hover();
  await first.locator('#sutraCloudOpenBtn').click();
  await first.check('#sutraCloudRememberSessionInput');
  await first.evaluate(async ({ email }) => window.SutraCloudSync.verifyCode(email, '123456'), { email: EMAIL });
  await expect.poll(() => first.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).not.toBeNull();

  const stale = await context.newPage();
  await openApp(stale, { persistReady: false });
  await stale.evaluate(() => window.SutraCloudSync.open());
  await expect.poll(() => stale.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);

  await first.evaluate(() => window.SutraCloudSync.signOut());
  await expect.poll(() => first.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).toBeNull();
  await stale.evaluate(() => window.SutraCloudSync.listBackups());
  expect(await stale.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);
  await expect.poll(() => stale.evaluate(() => window.SutraCredentialVault.get('cloud:supabaseSession:v1'))).toBeNull();

  await context.close();
});

test('Supabase upload failure skips metadata, rollback, and success state', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'UPLOAD-FAIL');
  await useSupabaseSignedIn(page);
  supa.failNextUpload = true;
  const outcome = await page.evaluate(() => window.SutraCloudSync.backupNow({ passphrase: 'correct horse battery staple' })
    .then(() => ({ ok: true }))
    .catch(error => ({ ok: false, name: error.name, message: error.message })));

  expect(outcome).toMatchObject({ ok: false, name: 'Error' });
  expect(outcome.message).toMatch(/storage unavailable/i);
  expect(supa.uploadAttempts).toHaveLength(1);
  expect(supa.uploads).toHaveLength(0);
  expect(supa.indexAttempts).toHaveLength(0);
  expect(supa.deletes).toHaveLength(0);
  expect(supa.objects.size).toBe(0);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta())).toMatchObject({
    lastBackupAt: '',
    lastError: 'storage unavailable'
  });
});

test('Supabase upload rolls back the exact ciphertext object when metadata indexing fails', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'ROLLBACK');
  await useSupabaseSignedIn(page);
  supa.failNextIndex = true;
  const result = page.evaluate(() => window.SutraCloudSync.backupNow({ passphrase: 'correct horse battery staple' })
    .then(() => ({ ok: true }))
    .catch(error => ({
      ok: false,
      name: error.name,
      message: error.message,
      causeName: error.cause && error.cause.name,
      causeMessage: error.cause && error.cause.message,
      rollback: error.rollback,
      hasPathProperty: Object.prototype.hasOwnProperty.call(error, 'path')
    })));
  const outcome = await result;
  expect(outcome.ok).toBe(false);
  expect(outcome.name).toBe('CloudBackupRolledBackError');
  expect(outcome.message).toMatch(/removed automatically/i);
  expect(outcome.causeName).toBe('Error');
  expect(outcome.causeMessage).toBe('index unavailable');
  expect(outcome.rollback).toEqual({ attempted: true, completed: true, outcome: 'removed', status: 200 });
  expect(outcome.hasPathProperty).toBe(false);
  expect(supa.uploads).toHaveLength(1);
  expect(supa.indexAttempts).toHaveLength(1);
  expect(supa.deletes).toEqual([{ bucket: 'backups', key: supa.uploads[0].key }]);
  expect(supa.objects.size).toBe(0);
  expect(supa.index).toHaveLength(0);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta())).toMatchObject({
    lastBackupAt: '',
    lastError: outcome.message
  });
});

test('Supabase rollback keeps metadata failure primary when cleanup also fails', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'PRIVATE-ROLLBACK-MARKER');
  await useSupabaseSignedIn(page);
  await page.evaluate(() => {
    window.__sutraRollbackReports = [];
    window.SutraReportError = (error, context, severity) => {
      window.__sutraRollbackReports.push({
        name: error && error.name,
        message: error && error.message,
        causeMessage: error && error.cause && error.cause.message,
        rollback: error && error.rollback,
        rollbackError: error && error.rollbackError && error.rollbackError.message,
        ownKeys: error ? Object.getOwnPropertyNames(error) : [],
        context,
        severity
      });
    };
  });
  supa.failNextIndex = true;
  supa.deleteFailureStatus = 503;
  const outcome = await page.evaluate(() => window.SutraCloudSync.backupNow({
    passphrase: 'correct horse battery staple',
    label: 'private-filename-marker'
  }).then(() => ({ ok: true })).catch(error => ({
    ok: false,
    name: error.name,
    message: error.message,
    causeMessage: error.cause && error.cause.message,
    rollback: error.rollback,
    rollbackError: error.rollbackError && error.rollbackError.message
  })));

  expect(outcome).toEqual({
    ok: false,
    name: 'CloudBackupPartialFailureError',
    message: 'Backup metadata could not be saved. Automatic cleanup of the newly uploaded encrypted object also failed.',
    causeMessage: 'index unavailable',
    rollback: { attempted: true, completed: false, outcome: 'failed', status: 503 },
    rollbackError: 'Rollback DELETE failed (503).'
  });
  expect(supa.deletes).toEqual([{ bucket: 'backups', key: supa.uploads[0].key }]);
  expect(supa.objects.has(supa.uploads[0].key)).toBe(true);
  expect(supa.index).toHaveLength(0);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta())).toMatchObject({
    lastBackupAt: '',
    lastError: outcome.message
  });

  const report = await page.evaluate(() => window.__sutraRollbackReports[0]);
  expect(report).toMatchObject({
    name: 'CloudBackupPartialFailureError',
    causeMessage: 'index unavailable',
    rollback: { attempted: true, completed: false, outcome: 'failed', status: 503 },
    rollbackError: 'Rollback DELETE failed (503).',
    context: { where: 'sutraCloud:backupNow', provider: 'supabase', auto: false },
    severity: 'warning'
  });
  expect(report.ownKeys).not.toContain('path');
  const diagnosticText = JSON.stringify(report);
  for (const secret of [PASS, 'PRIVATE-ROLLBACK-MARKER', 'private-filename-marker', 'test-anon-key', 'a1', 'r1']) {
    expect(diagnosticText).not.toContain(secret);
  }
  expect(diagnosticText).not.toMatch(/SUTRAENC/);
  expect(outcome.message).not.toMatch(/removed automatically/i);
});

test('Supabase rollback treats an already-missing object as idempotent completion', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'ALREADY-ABSENT');
  await useSupabaseSignedIn(page);
  supa.failNextIndex = true;
  supa.deleteNotFound = true;
  const outcome = await page.evaluate(() => window.SutraCloudSync.backupNow({ passphrase: 'correct horse battery staple' })
    .then(() => ({ ok: true }))
    .catch(error => ({
      ok: false,
      name: error.name,
      message: error.message,
      causeMessage: error.cause && error.cause.message,
      rollback: error.rollback
    })));

  expect(outcome).toEqual({
    ok: false,
    name: 'CloudBackupRolledBackError',
    message: 'Backup metadata could not be saved. The newly uploaded encrypted object was already absent.',
    causeMessage: 'index unavailable',
    rollback: { attempted: true, completed: true, outcome: 'already-absent', status: 404 }
  });
  expect(supa.deletes).toEqual([{ bucket: 'backups', key: supa.uploads[0].key }]);
  expect(supa.objects.size).toBe(0);
  expect(supa.index).toHaveLength(0);
  expect(outcome.message).not.toMatch(/removed automatically/i);
});

test('Supabase rollback cannot delete an earlier indexed backup or collide with a later attempt', async ({ page }) => {
  const supa = await openApp(page);
  await seedWorkspace(page, 'ATTEMPT-IDENTITY');
  await useSupabaseSignedIn(page);

  await page.evaluate(() => window.SutraCloudSync.backupNow({
    passphrase: 'correct horse battery staple',
    label: 'same-label'
  }));
  const validKey = supa.uploads[0].key;
  const validIndex = { ...supa.index[0] };
  const successfulTimestamp = await page.evaluate(() => window.SutraCloudSync.getMeta().lastBackupAt);

  supa.failNextIndex = true;
  const second = await page.evaluate(() => window.SutraCloudSync.backupNow({
    passphrase: 'correct horse battery staple',
    label: 'same-label'
  }).then(() => ({ ok: true })).catch(error => ({
    ok: false,
    name: error.name,
    causeMessage: error.cause && error.cause.message
  })));

  expect(second).toEqual({ ok: false, name: 'CloudBackupRolledBackError', causeMessage: 'index unavailable' });
  expect(supa.uploads).toHaveLength(2);
  expect(supa.uploads[1].key).not.toBe(validKey);
  expect(supa.deletes).toEqual([{ bucket: 'backups', key: supa.uploads[1].key }]);
  expect(supa.objects.has(validKey)).toBe(true);
  expect(supa.objects.has(supa.uploads[1].key)).toBe(false);
  expect(supa.index).toEqual([validIndex]);
  expect(supa.index[0].path).toBe(validKey);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta().lastBackupAt)).toBe(successfulTimestamp);
});

test('Supabase provider: restore reproduces workspace; wrong passphrase is safe', async ({ page }) => {
  // Backup, wrong-password restore, successful restore, and the mandatory
  // encrypted pre-restore safety snapshot each perform 600k-iteration PBKDF2.
  test.setTimeout(240_000);
  await openApp(page);
  await seedWorkspace(page, 'REMOTE');
  await useSupabaseSignedIn(page);
  const b = page.evaluate(() => window.SutraCloudSync.backupNow().then(x => (x && x.uploaded ? 'ok' : 'no')));
  await fillCloudPassword(page);
  expect(await b).toBe('ok');
  await seedWorkspace(page, 'LOCAL');
  // wrong passphrase
  const wrong = page.evaluate(async () => { const rows = await window.SutraCloudSync.listBackups(); return window.SutraCloudSync.restore(rows[0]).then(() => 'ok').catch(e => e.name || 'err'); });
  await fillCloudPassword(page, 'nope nope nope', false);
  expect(await wrong).not.toBe('ok');
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Sentinel LOCAL');
  // correct passphrase. Programmatic restores skip the interactive restore
  // conflict chooser (covered by encrypted-backups.spec.mjs) — it would
  // otherwise block this awaited evaluate forever.
  const ok = page.evaluate(async () => { const rows = await window.SutraCloudSync.listBackups(); return window.SutraCloudSync.restore(rows[0], { skipConflictCheck: true }).then(x => (x && x.restored ? 'ok' : 'no')); });
  await fillCloudPassword(page, PASS, false);
  await completeSafetySnapshotDialog(page);
  expect(await ok).toBe('ok');
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel REMOTE');
});

test('a ready non-Supabase provider lists its backups (provider-agnostic refresh gate)', async ({ page }) => {
  // Regression: refreshSutraCloudBackupList() used to gate on the Supabase-only
  // isSutraCloudSignedIn(), so WebDAV / Custom HTTP (which become ready via saved
  // credentials, with no "session") never rendered their backup list. Custom
  // origins are CSP-blocked in the hosted build, so we host a fake WebDAV server
  // at the CSP-allowlisted Supabase origin to make the provider genuinely ready
  // while isSignedIn() stays false — the exact case the old gate dropped.
  await openApp(page);
  const davDir = `${SUPA_URL}/dav`;
  await page.route(davDir, async route => {
    if (route.request().method() !== 'PROPFIND') return route.fallback();
    const xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">'
      + '<d:response><d:href>/dav/sutra-2026-06-18-backup.sutra</d:href>'
      + '<d:propstat><d:prop><d:getcontentlength>1234</d:getcontentlength>'
      + '<d:getlastmodified>Wed, 18 Jun 2026 12:00:00 GMT</d:getlastmodified>'
      + '</d:prop></d:propstat></d:response></d:multistatus>';
    return route.fulfill({ status: 207, contentType: 'application/xml', body: xml });
  });
  const out = await page.evaluate(async ({ dir }) => {
    await window.SutraCloudSync.switchProvider('webdav');
    window.SutraCloudSync.saveProviderConfig('webdav', { url: dir + '/', username: 'me', password: 'app-pw' });
    await window.SutraCloudSync.refreshBackupList();
    const list = document.getElementById('sutraCloudBackupList');
    return {
      signedIn: window.SutraCloudSync.isSignedIn(),
      ready: window.SutraCloudSync.getActiveProvider().status.ready,
      listText: list ? list.textContent : '(no list element)'
    };
  }, { dir: davDir });
  expect(out.signedIn).toBe(false);   // not a Supabase session — old gate bailed here
  expect(out.ready).toBe(true);       // ready via saved WebDAV credentials + allowlisted origin
  expect(out.listText).toContain('sutra-2026-06-18-backup'); // the row actually rendered
});

test('retention keeps the latest 10 backups', async ({ page }) => {
  await openApp(page);
  await seedWorkspace(page, 'R');
  await useSupabaseSignedIn(page);
  for (let i = 0; i < 12; i++) {
    const r = page.evaluate(() => window.SutraCloudSync.backupNow({ passphrase: 'correct horse battery staple', label: 'b' }).then(x => x && x.uploaded));
    await r;
  }
  const count = await page.evaluate(async () => (await window.SutraCloudSync.listBackups()).length);
  expect(count).toBe(10);
});

test('switching destination signs out the old provider and keeps the local workspace', async ({ page }) => {
  await openApp(page);
  await seedWorkspace(page, 'KEEP');
  await useSupabaseSignedIn(page);
  await page.evaluate(() => window.SutraCloudSync.switchProvider('webdav'));
  const after = await page.evaluate(() => ({ signedIn: window.SutraCloudSync.isSignedIn(), active: window.SutraCloudSync.getActiveProviderId(), title: window.serializeWorkspace().pages[0].title, auto: window.SutraCloudSync.getMeta().autoBackup.enabled }));
  expect(after.signedIn).toBe(false);     // old (supabase) session ended
  expect(after.active).toBe('webdav');
  expect(after.title).toBe('Sentinel KEEP'); // local workspace untouched
  expect(after.auto).toBe(false);          // auto re-opt-in per destination
});

test('scheduled backups upload ciphertext once across two tabs and stop when disabled', async ({ page, context }) => {
  test.setTimeout(90000);
  const supa = await openApp(page);
  await seedWorkspace(page, 'automatic-backup');
  await useSupabaseSignedIn(page);
  await page.evaluate(passphrase => window.SutraCloud.backupNow({ passphrase }), PASS);
  const second = await context.newPage();
  await configureSupabase(second);
  await installInspectableBlobRequests(second, [`${SUPA_URL}/`]);
  await installSupabaseMock(second, supa);
  await second.goto('/Sutra.html');
  // Opening a second tab can receive a newer commit from the first tab while
  // this page hydrates. Keep setup read-only; an eager fixture save would
  // correctly trip the cross-tab stale-workspace guard before this test starts.
  await waitForAppHydrated(second);
  await second.evaluate(({ email }) => window.SutraCloudSync.verifyCode(email, '123456'), { email: EMAIL });
  await second.evaluate(passphrase => window.SutraCloud.backupNow({ passphrase }), PASS);
  await second.evaluate(() => window.SutraCloud.setAutoBackup({ enabled: true, frequency: 'close' }));
  const before = supa.uploads.length;
  const hide = tab => tab.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await Promise.all([hide(page), hide(second)]);
  await expect.poll(() => supa.uploads.length).toBe(before + 1);
  await expect.poll(() => second.evaluate(() => window.SutraCloud.getStatus().backups.lastAutoBackupAt)).toBeTruthy();
  await Promise.all([hide(page), hide(second)]);
  await second.waitForTimeout(1000);
  expect(supa.uploads.length).toBe(before + 1);
  expect(supa.uploads.at(-1).bytes.subarray(0, 8).toString()).toBe('SUTRAENC');
  expect(supa.uploads.at(-1).bytes.toString()).not.toContain('Body automatic-backup');
  await second.evaluate(() => window.SutraCloud.setAutoBackup({ enabled: false, frequency: 'close' }));
  await Promise.all([hide(page), hide(second)]);
  await second.waitForTimeout(1000);
  expect(supa.uploads.length).toBe(before + 1);
  await second.close();
});

test('auto-backup is off by default and manual is always ready', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => window.SutraCloudSync.getMeta().autoBackup.enabled)).toBe(false);
  const manual = await page.evaluate(async () => { await window.SutraCloudSync.switchProvider('manual'); return window.SutraCloudSync.getActiveProvider(); });
  expect(manual.id).toBe('manual');
  expect(manual.status.ready).toBe(true); // manual works with no account
});

test('in-app Help & Docs includes a Sutra Cloud section with the key warnings', async ({ page }) => {
  await openApp(page);
  const help = await page.evaluate(() => (typeof window.buildHelpPageContentV2 === 'function' ? window.buildHelpPageContentV2() : ''));
  expect(help).toContain('Sutra Cloud');
  expect(help).toMatch(/lose the passphrase[\s\S]*cannot be recovered/i);
  expect(help).toMatch(/Restore replaces your current workspace/i);
  expect(help).toMatch(/Google Drive|OneDrive|Dropbox/);
  expect(help).toMatch(/self-hosted|browser security policy|CSP/i);
});

// ===========================================================================
// OAuth destinations — Google Drive (GIS), OneDrive (MS Graph), Dropbox (PKCE).
// Each encrypts locally first; the adapter only ever moves ciphertext. We mock
// the provider APIs and drive everything through window.SutraCloudSync.
// ===========================================================================

// Google Identity Services stub: initTokenClient(...).requestAccessToken()
// synchronously hands back a fake access token, exactly like a granted consent.
function stubGoogleIdentity(page) {
  return page.addInitScript(() => {
    window.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({
      requestAccessToken: () => { try { cfg.callback({ access_token: 'gd-access-token', expires_in: 3600 }); } catch (e) {} }
    }) } } };
  });
}

// Echo the OAuth popup: read `state` from the authorize URL and post a fake code
// back to the opener, the way oauth-callback.html would after a real sign-in.
function stubOAuthPopup(page) {
  return page.addInitScript(() => {
    window.open = (url) => {
      try { const u = new URL(url); const state = u.searchParams.get('state');
        setTimeout(() => { try { window.postMessage({ source: 'sutra-oauth', code: 'test-auth-code', state }, location.origin); } catch (e) {} }, 5);
      } catch (e) {}
      return { closed: false, close() {}, focus() {} };
    };
  });
}

async function installGoogleDriveMock(page) {
  const state = { files: new Map(), nextId: 1, uploads: [] };
  await page.route('https://www.googleapis.com/**', route => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname;
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const buf = req.postDataBuffer() || Buffer.alloc(0);
      const magic = buf.indexOf(Buffer.from('SUTRAENC', 'utf8'));         // ciphertext starts here
      const closing = buf.lastIndexOf(Buffer.from('\r\n--', 'utf8'));      // multipart closing boundary
      const bytes = (magic >= 0 && closing > magic) ? buf.slice(magic, closing) : buf;
      const head = buf.slice(0, magic >= 0 ? magic : 0).toString('utf8');
      let meta = {}; try { meta = JSON.parse(head.slice(head.indexOf('{'), head.lastIndexOf('}') + 1)); } catch (e) {}
      const id = `gd${state.nextId++}`;
      const name = (meta && meta.name) || `sutra-backup-${id}.sutra`;
      const createdTime = new Date(Date.UTC(2026, 5, 18, 12, state.nextId, 0)).toISOString();
      state.files.set(id, { id, name, bytes, appProperties: (meta && meta.appProperties) || {}, createdTime, size: bytes.length });
      state.uploads.push({ name, bytes });
      return json(200, { id, name, size: String(bytes.length), createdTime, appProperties: (meta && meta.appProperties) || {} });
    }
    if (path === '/drive/v3/files' && method === 'GET') {
      const files = [...state.files.values()]
        .map(f => ({ id: f.id, name: f.name, size: String(f.size), createdTime: f.createdTime, modifiedTime: f.createdTime, appProperties: f.appProperties }))
        .sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
      return json(200, { files });
    }
    const m = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = state.files.get(decodeURIComponent(m[1]));
      return f ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: f.bytes }) : route.fulfill({ status: 404, body: 'x' });
    }
    if (m && method === 'DELETE') { state.files.delete(decodeURIComponent(m[1])); return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 500, body: `Unhandled ${method} ${url.href}` });
  });
  return state;
}

async function installOneDriveMock(page) {
  const state = { items: new Map(), nextId: 1, uploads: [] };
  await page.route('https://login.microsoftonline.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: `od-access-${Date.now()}`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'od-refresh-next' }) }));
  await page.route('https://graph.microsoft.com/**', route => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname;
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    let m = path.match(/^\/v1\.0\/me\/drive\/special\/approot:\/(.+):\/content$/);
    if (m && method === 'PUT') {
      const name = decodeURIComponent(m[1]); const bytes = req.postDataBuffer() || Buffer.alloc(0);
      const id = `od${state.nextId++}`; const createdDateTime = new Date(Date.UTC(2026, 5, 18, 12, state.nextId, 0)).toISOString();
      state.items.set(id, { id, name, bytes, size: bytes.length, createdDateTime }); state.uploads.push({ name, bytes });
      return json(201, { id, name, size: bytes.length, createdDateTime });
    }
    if (path === '/v1.0/me/drive/special/approot' && method === 'GET') return json(200, { id: 'approot' });
    if (path === '/v1.0/me/drive/special/approot/children' && method === 'GET') {
      return json(200, { value: [...state.items.values()].map(it => ({ id: it.id, name: it.name, size: it.size, createdDateTime: it.createdDateTime })) });
    }
    m = path.match(/^\/v1\.0\/me\/drive\/items\/([^/]+)$/);
    if (m && method === 'GET') {
      const it = state.items.get(decodeURIComponent(m[1])); if (!it) return json(404, {});
      return json(200, { id: it.id, name: it.name, '@microsoft.graph.downloadUrl': `https://dl.dms.live.net/od/${it.id}` });
    }
    if (m && method === 'DELETE') { state.items.delete(decodeURIComponent(m[1])); return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 500, body: `Unhandled ${method} ${url.href}` });
  });
  // Microsoft's content CDN (host matches the *.dms.live.net CSP wildcard family).
  await page.route('https://dl.dms.live.net/**', route => {
    const id = route.request().url().split('/').pop(); const it = state.items.get(id);
    return it ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: it.bytes }) : route.fulfill({ status: 404, body: 'x' });
  });
  return state;
}

async function installDropboxMock(page) {
  const state = { files: new Map(), nextId: 1, uploads: [] };
  await page.route('https://api.dropboxapi.com/**', route => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname;
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/oauth2/token' && method === 'POST') return json(200, { access_token: 'db-access', token_type: 'bearer', expires_in: 14400, refresh_token: 'db-refresh' });
    if (path === '/2/files/list_folder' && method === 'POST') {
      return json(200, { entries: [...state.files.values()].map(f => ({ '.tag': 'file', id: f.id, name: f.name, path_lower: f.path_lower, path_display: f.path_display, size: f.size, client_modified: f.client_modified, server_modified: f.client_modified })), cursor: 'c', has_more: false });
    }
    if (path === '/2/files/list_folder/continue' && method === 'POST') return json(200, { entries: [], cursor: 'c', has_more: false });
    if (path === '/2/files/delete_v2' && method === 'POST') {
      const b = JSON.parse(req.postData() || '{}'); const key = String(b.path || '').toLowerCase();
      for (const [k, f] of state.files) { if (f.path_lower === key || f.id === b.path) state.files.delete(k); }
      return json(200, { metadata: { '.tag': 'file' } });
    }
    return route.fulfill({ status: 500, body: `Unhandled ${method} ${url.href}` });
  });
  await page.route('https://content.dropboxapi.com/**', route => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method(); const path = url.pathname;
    if (path === '/2/files/upload' && method === 'POST') {
      const arg = JSON.parse(req.headers()['dropbox-api-arg'] || '{}'); const bytes = req.postDataBuffer() || Buffer.alloc(0);
      const id = `id:db${state.nextId++}`; const p = String(arg.path || `/file${state.nextId}.sutra`); const name = p.replace(/^\//, '');
      const client_modified = new Date(Date.UTC(2026, 5, 18, 12, state.nextId, 0)).toISOString();
      state.files.set(id, { id, name, path_lower: p.toLowerCase(), path_display: p, bytes, size: bytes.length, client_modified });
      state.uploads.push({ name, bytes });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, name, path_lower: p.toLowerCase(), path_display: p, size: bytes.length, client_modified }) });
    }
    if (path === '/2/files/download' && method === 'POST') {
      const arg = JSON.parse(req.headers()['dropbox-api-arg'] || '{}'); const key = String(arg.path || '').toLowerCase();
      let found = null; for (const f of state.files.values()) { if (f.path_lower === key || f.id === arg.path) found = f; }
      return found ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: found.bytes }) : route.fulfill({ status: 409, body: 'not_found' });
    }
    return route.fulfill({ status: 500, body: `Unhandled ${method} ${url.href}` });
  });
  return state;
}

test('Google Drive: connect, backup uploads ciphertext only, restore round-trips, retention keeps 10', async ({ page }) => {
  test.setTimeout(240_000);
  await stubGoogleIdentity(page);
  const gd = await installGoogleDriveMock(page);
  await openApp(page);
  await seedWorkspace(page, 'GDRIVE');
  const connected = await page.evaluate(async () => {
    await window.SutraCloudSync.switchProvider('googledrive');
    window.SutraCloudSync.saveProviderConfig('googledrive', { clientId: 'gd-client.apps.googleusercontent.com' });
    return window.SutraCloudSync.connectProvider('googledrive');
  });
  expect(connected).toBe(true);
  const up = await page.evaluate(({ pass }) => window.SutraCloudSync.backupNow({ passphrase: pass, label: 'gd' }).then(x => !!(x && x.uploaded)), { pass: PASS });
  expect(up).toBe(true);
  expect(gd.uploads).toHaveLength(1);
  expect(gd.uploads[0].bytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC'); // ciphertext only
  expect(gd.uploads[0].bytes.toString('utf8')).not.toContain('Sentinel GDRIVE');
  // restore reproduces the workspace
  await seedWorkspace(page, 'GDLOCAL');
  const restorePromise = page.evaluate(({ pass }) => window.SutraCloudSync.listBackups().then(rs => window.SutraCloudSync.restore(rs[0], { passphrase: pass, skipConflictCheck: true })).then(x => !!(x && x.restored)), { pass: PASS });
  await completeSafetySnapshotDialog(page);
  const restored = await restorePromise;
  expect(restored).toBe(true);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel GDRIVE');
  // retention keeps the latest 10
  for (let i = 0; i < 12; i++) await page.evaluate(({ pass }) => window.SutraCloudSync.backupNow({ passphrase: pass, label: 'b' }), { pass: PASS });
  expect(await page.evaluate(() => window.SutraCloudSync.listBackups().then(r => r.length))).toBe(10);
});

test('OneDrive: backup uploads ciphertext, restore round-trips via the content CDN', async ({ page }) => {
  test.setTimeout(120_000);
  const od = await installOneDriveMock(page);
  await openApp(page);
  await seedWorkspace(page, 'ODRIVE');
  await page.evaluate(async () => {
    window.SutraCloudSync.saveProviderConfig('onedrive', { clientId: 'od-client', refreshToken: 'seed-refresh' });
    await window.SutraCloudSync.switchProvider('onedrive');
  });
  const up = await page.evaluate(({ pass }) => window.SutraCloudSync.backupNow({ passphrase: pass, label: 'od' }).then(x => !!(x && x.uploaded)), { pass: PASS });
  expect(up).toBe(true);
  expect(od.uploads).toHaveLength(1);
  expect(od.uploads[0].bytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC');
  expect(await page.evaluate(() => window.SutraCloudSync.listBackups().then(r => r.length))).toBe(1);
  await seedWorkspace(page, 'ODLOCAL');
  const restorePromise = page.evaluate(({ pass }) => window.SutraCloudSync.listBackups().then(rs => window.SutraCloudSync.restore(rs[0], { passphrase: pass, skipConflictCheck: true })).then(x => !!(x && x.restored)), { pass: PASS });
  await completeSafetySnapshotDialog(page);
  const restored = await restorePromise;
  expect(restored).toBe(true);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel ODRIVE');
});

test('Dropbox: backup uploads ciphertext, restore round-trips', async ({ page }) => {
  test.setTimeout(120_000);
  const db = await installDropboxMock(page);
  await openApp(page);
  await seedWorkspace(page, 'DBOX');
  await page.evaluate(async () => {
    window.SutraCloudSync.saveProviderConfig('dropbox', { clientId: 'db-key', refreshToken: 'seed-refresh' });
    await window.SutraCloudSync.switchProvider('dropbox');
  });
  const up = await page.evaluate(({ pass }) => window.SutraCloudSync.backupNow({ passphrase: pass, label: 'db' }).then(x => !!(x && x.uploaded)), { pass: PASS });
  expect(up).toBe(true);
  expect(db.uploads).toHaveLength(1);
  expect(db.uploads[0].bytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC');
  await seedWorkspace(page, 'DBLOCAL');
  const restorePromise = page.evaluate(({ pass }) => window.SutraCloudSync.listBackups().then(rs => window.SutraCloudSync.restore(rs[0], { passphrase: pass, skipConflictCheck: true })).then(x => !!(x && x.restored)), { pass: PASS });
  await completeSafetySnapshotDialog(page);
  const restored = await restorePromise;
  expect(restored).toBe(true);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel DBOX');
});

test('Dropbox: in-app Connect runs the PKCE popup flow and stores a refresh token', async ({ page }) => {
  await stubOAuthPopup(page);
  await installDropboxMock(page);
  await openApp(page);
  const out = await page.evaluate(async () => {
    window.SutraCloudSync.saveProviderConfig('dropbox', { clientId: 'db-key' });
    await window.SutraCloudSync.switchProvider('dropbox');
    const ok = await window.SutraCloudSync.connectProvider('dropbox');
    return { ok, refreshToken: window.SutraCloudSync.getProviderConfig('dropbox').refreshToken, ready: window.SutraCloudSync.getActiveProvider().status.ready };
  });
  expect(out.ok).toBe(true);
  expect(out.refreshToken).toBe('db-refresh');   // exchanged via the mocked token endpoint
  expect(out.ready).toBe(true);
});

test('Box stays an honest scaffold with an accurate reason (no fake working state)', async ({ page }) => {
  await openApp(page);
  const box = await page.evaluate(() => window.SutraCloudSync.listProviders().find(p => p.id === 'box'));
  expect(box.status.scaffolded).toBe(true);
  expect(box.status.ready).not.toBe(true);
  expect(box.status.reason).toMatch(/secret|proxy|self-host/i);
});
