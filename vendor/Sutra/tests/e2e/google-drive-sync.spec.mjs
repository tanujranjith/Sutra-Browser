import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';
import { installInspectableBlobRequests } from './helpers/inspectable-blob-requests.mjs';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });

const PASS = 'correct horse battery staple';
const CLIENT_ID = 'mock-client-id.apps.googleusercontent.com';

async function completeOnboarding(page) {
  await page.evaluate(async () => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
    await window.flowAtelier.flushAppSaveNow('e2e-drive-onboarding-complete');
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function completeSafetySnapshotDialog(page, passphrase = PASS) {
  const modal = page.locator('#sutraBackupPasswordModal');
  await modal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', passphrase);
  await page.fill('#sutraBackupPassphraseConfirmInput', passphrase);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  await expect(modal).not.toHaveClass(/active/, { timeout: 60_000 });
}

function installGoogleIdentityMock(page) {
  return page.addInitScript(({ clientId }) => {
    window.SUTRA_CONFIG = { googleDriveClientId: clientId };
    window.__sutraRequestedScopes = [];
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient(config) {
            window.__sutraRequestedScopes.push(config.scope);
            return {
              requestAccessToken() {
                setTimeout(() => {
                  config.callback({ access_token: 'mock-access-token', expires_in: 3600 });
                }, 0);
              }
            };
          }
        }
      }
    };
  }, { clientId: CLIENT_ID });
}

function extractMultipartJson(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 8192));
  const match = text.match(/\r\n\r\n({[\s\S]*?})\r\n--/);
  return match ? JSON.parse(match[1]) : null;
}

function extractEncryptedPayload(buffer) {
  const magic = Buffer.from('SUTRAENC', 'utf8');
  const start = buffer.indexOf(magic);
  if (start < 0) return Buffer.alloc(0);
  const boundary = buffer.indexOf(Buffer.from('\r\n--', 'utf8'), start);
  return boundary > start ? buffer.slice(start, boundary) : buffer.slice(start);
}

function publicDriveFile(file) {
  const { bytes, ...meta } = file;
  return meta;
}

async function installDriveMock(page, options = {}) {
  await installInspectableBlobRequests(page, ['https://www.googleapis.com/']);
  const mediaWaiters = [];
  const state = {
    files: (options.files || []).map(file => ({ ...file })),
    uploads: [],
    deletes: [],
    lists: [],
    mediaGets: 0,
    resumableInits: [],
    nextId: 1,
    nextVersion: 1,
    nextListMutation: null,
    mutateOnNextList(mutator) {
      state.nextListMutation = typeof mutator === 'function' ? mutator : null;
    },
    waitForNextMediaGet() {
      return new Promise(resolve => mediaWaiters.push(resolve));
    }
  };

  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      if (state.nextListMutation) {
        const mutate = state.nextListMutation;
        state.nextListMutation = null;
        mutate(state);
      }
      state.lists.push({
        spaces: url.searchParams.get('spaces'),
        q: url.searchParams.get('q'),
        fields: url.searchParams.get('fields')
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: state.files.map(({ bytes, ...meta }) => meta)
        })
      });
      return;
    }

    if (url.pathname.startsWith('/drive/v3/files/') && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const file = state.files.find(item => item.id === id);
      state.mediaGets += 1;
      mediaWaiters.splice(0).forEach(resolve => resolve(state.mediaGets));
      if (options.mediaDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.mediaDelayMs));
      }
      await route.fulfill({
        status: file ? 200 : 404,
        contentType: 'application/octet-stream',
        body: file ? file.bytes : 'missing'
      });
      return;
    }

    if (url.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      state.deletes.push(id);
      state.files = state.files.filter(item => item.id !== id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (url.pathname.startsWith('/upload/drive/v3/files') && url.searchParams.get('uploadType') === 'multipart') {
      const raw = await request.postDataBuffer();
      const metadata = extractMultipartJson(raw);
      const encryptedBytes = extractEncryptedPayload(raw);
      const match = url.pathname.match(/\/files\/([^/]+)$/);
      const existingId = match ? decodeURIComponent(match[1]) : '';
      const now = new Date(Date.UTC(2026, 5, 6, 12, state.nextVersion, 0)).toISOString();
      let file = existingId ? state.files.find(item => item.id === existingId) : null;
      if (!file) {
        file = {
          id: existingId || `drive-file-${state.nextId++}`,
          name: metadata.name,
          appProperties: metadata.appProperties,
          size: String(encryptedBytes.length),
          bytes: encryptedBytes
        };
        state.files.push(file);
      }
      file.name = metadata.name;
      file.appProperties = metadata.appProperties;
      file.version = String(state.nextVersion++);
      file.modifiedTime = now;
      file.headRevisionId = `rev-${file.version}`;
      file.size = String(encryptedBytes.length);
      file.bytes = encryptedBytes;
      state.uploads.push({ type: 'multipart', metadata, encryptedBytes, body: raw, file: { ...file, bytes: undefined } });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicDriveFile(file))
      });
      return;
    }

    if (url.pathname.startsWith('/upload/drive/v3/files') && url.searchParams.get('uploadType') === 'resumable' && method !== 'PUT') {
      state.resumableInits.push({
        method,
        metadata: JSON.parse(request.postData() || '{}'),
        contentType: request.headers()['x-upload-content-type'],
        length: request.headers()['x-upload-content-length']
      });
      await route.fulfill({
        status: 200,
        headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-session' },
        body: ''
      });
      return;
    }

    if (url.pathname.startsWith('/upload/drive/v3/files') && url.searchParams.get('upload_id') === 'mock-session' && method === 'PUT') {
      const encryptedBytes = await request.postDataBuffer();
      const metadata = state.resumableInits[state.resumableInits.length - 1].metadata;
      const now = new Date(Date.UTC(2026, 5, 6, 13, state.nextVersion, 0)).toISOString();
      const file = {
        id: `drive-file-${state.nextId++}`,
        name: metadata.name,
        appProperties: metadata.appProperties,
        version: String(state.nextVersion++),
        modifiedTime: now,
        headRevisionId: `rev-${state.nextVersion}`,
        size: String(encryptedBytes.length),
        bytes: encryptedBytes
      };
      state.files.push(file);
      state.uploads.push({ type: 'resumable', metadata, encryptedBytes, body: encryptedBytes, file: { ...file, bytes: undefined } });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicDriveFile(file))
      });
      return;
    }

    await route.fulfill({ status: 500, body: `Unhandled Drive mock route: ${method} ${url.href}` });
  });

  return state;
}

async function openApp(page, options = {}) {
  await installGoogleIdentityMock(page);
  const drive = await installDriveMock(page, options);
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  // The static shell appears before canonical startup settles. Do not seed the
  // Drive fixture or open its shared password dialog while hydration can still
  // reset the form fields beneath the test.
  await waitForAppReady(page);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
  await page.evaluate(() => window.SutraDriveSync._resetForTests());
  return drive;
}

async function seedWorkspace(page, marker) {
  await page.evaluate(async ({ marker }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const now = new Date().toISOString();
    window.deserializeWorkspace({
      ...base,
      pages: [{
        id: `drive-page-${marker}`,
        title: `Drive Sentinel ${marker}`,
        content: `<h1>Drive Sentinel ${marker}</h1><p>Cloud sync body ${marker}</p>`,
        blocks: [],
        icon: 'doc',
        collapsed: false,
        createdAt: now,
        updatedAt: now,
        theme: 'dark'
      }],
      tasks: [{ id: `drive-task-${marker}`, title: `Drive Task ${marker}`, status: 'todo', priority: 'high' }],
      settings: {
        ...base.settings,
        theme: 'dark',
        recentSearches: [{ query: `Drive Setting ${marker}`, at: now }]
      },
      courseWorkspace: {
        courses: [{ id: `drive-course-${marker}`, name: `Drive Course ${marker}` }],
        files: [],
        resources: [],
        assignments: []
      }
    });
    sessionStorage.setItem('openai_api_key', `sk-drive-secret-${marker}`);
    await window.saveWorkspaceLocally();
  }, { marker });
}

async function fillCloudPassword(page, pass = PASS, confirm = true) {
  await expect(page.locator('#sutraCloudSyncPasswordModal')).toHaveClass(/active/, { timeout: 20_000 });
  await page.fill('#sutraCloudSyncPassphraseInput', pass);
  if (confirm) await page.fill('#sutraCloudSyncPassphraseConfirmInput', pass);
  await page.locator('#sutraCloudSyncPasswordSubmitBtn').click();
}

function parseEnvelopeHeader(buffer) {
  const headerLength = buffer.readUInt32BE(9);
  return JSON.parse(buffer.slice(13, 13 + headerLength).toString('utf8'));
}

test('Drive sync is disabled by default and requests only drive.appdata when connected', async ({ page }) => {
  await openApp(page);
  const initial = await page.evaluate(() => ({
    status: window.SutraDriveSync.getStatus(),
    constants: window.SutraDriveSync.constants()
  }));
  expect(initial.status.state).toBe('disabled');
  expect(initial.constants.scope).toBe('https://www.googleapis.com/auth/drive.appdata');
  expect(initial.constants.scope).not.toBe('https://www.googleapis.com/auth/drive');
  expect(initial.constants.scope).not.toBe('https://www.googleapis.com/auth/drive.readonly');
});

test('first Drive connect uploads only encrypted appDataFolder bytes and stores no secrets', async ({ page }) => {
  const drive = await openApp(page);
  await seedWorkspace(page, 'UPLOAD');

  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;

  expect(drive.lists[0]).toMatchObject({ spaces: 'appDataFolder' });
  expect(drive.lists[0].fields).toContain('id,name,version,modifiedTime,headRevisionId,size,appProperties');
  expect(drive.uploads).toHaveLength(1);
  const upload = drive.uploads[0];
  expect(upload.metadata.parents).toEqual(['appDataFolder']);
  expect(upload.metadata.appProperties).toEqual({ sutraRole: 'sync-current', sutraSyncFormat: '1' });
  expect(upload.encryptedBytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC');
  const header = parseEnvelopeHeader(upload.encryptedBytes);
  expect(header.purpose).toBe('google-drive-sync');
  expect(header.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
  expect(header.cipher).toMatchObject({ name: 'AES-GCM', keyLength: 256, tagLength: 128 });
  const uploadText = upload.body.toString('utf8');
  expect(uploadText).not.toContain('Drive Sentinel UPLOAD');
  expect(uploadText).not.toContain('Drive Setting UPLOAD');
  expect(uploadText).not.toContain('sk-drive-secret-UPLOAD');
  const storageText = await page.evaluate(() => JSON.stringify({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } }));
  expect(storageText).not.toContain(PASS);
  expect(storageText).not.toContain('mock-access-token');
  expect(await page.evaluate(() => window.__sutraRequestedScopes)).toEqual(['https://www.googleapis.com/auth/drive.appdata']);
});

test('Drive restore rejects wrong password without mutating, then restores with correct password', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await seedWorkspace(page, 'REMOTE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;

  await seedWorkspace(page, 'LOCAL');
  await page.evaluate(() => window.SutraDriveSync.lock());
  const wrongPromise = page.evaluate(() => window.SutraDriveSync.restoreFromDrive({ skipConfirm: true }).then(() => 'ok').catch(error => error.name || error.message));
  await fillCloudPassword(page, 'wrong password', false);
  const wrong = await wrongPromise;
  expect(wrong).not.toBe('ok');
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Drive Sentinel LOCAL');

  const restorePromise = page.evaluate(() => window.SutraDriveSync.restoreFromDrive({ skipConfirm: true }).then(() => 'ok'));
  await fillCloudPassword(page, PASS, false);
  await completeSafetySnapshotDialog(page);
  await expect(restorePromise).resolves.toBe('ok');
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Drive Sentinel REMOTE');
});

test('a clean background Drive pull uses the recovery journal without prompting for a download', async ({ page }) => {
  test.setTimeout(120_000);
  const drive = await openApp(page);
  await seedWorkspace(page, 'BASE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;

  // This fixture deliberately creates a locally persisted, already-clean copy
  // so it can exercise the background pull path.  Disable the test metadata
  // only while making that setup save: otherwise the real autosync debounce
  // may independently see the mock change below on a slow worker and put the
  // fixture into a conflict before its explicit pull owns the decision.
  await page.evaluate(() => window.SutraDriveSync._setMetadataForTests({ enabled: false }));
  await seedWorkspace(page, 'LOCAL-TO-REPLACE');
  await page.evaluate(() => window.SutraDriveSync._setMetadataForTests({ enabled: true, localDirty: false }));
  drive.files[0].version = '99';
  drive.files[0].modifiedTime = new Date(Date.UTC(2026, 5, 6, 15, 0, 0)).toISOString();
  const result = await page.evaluate(() => window.SutraDriveSync.syncNow());

  expect(result).toEqual({ restored: true });
  await expect(page.locator('#sutraBackupPasswordModal')).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Drive Sentinel BASE');
});

test('Drive sync enters conflict instead of overwriting local dirty and remote changed copies', async ({ page }) => {
  const drive = await openApp(page);
  await seedWorkspace(page, 'BASE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;
  expect(drive.uploads).toHaveLength(1);

  drive.files[0].version = '99';
  drive.files[0].modifiedTime = new Date(Date.UTC(2026, 5, 6, 15, 0, 0)).toISOString();
  await seedWorkspace(page, 'LOCAL-CONFLICT');
  const result = await page.evaluate(() => window.SutraDriveSync.syncNow().then(value => value));
  expect(result).toEqual({ conflict: true });
  await expect(page.locator('#sutraDriveConflictModal')).toHaveClass(/active/);
  const status = await page.evaluate(() => window.SutraDriveSync.getStatus());
  expect(status.state).toBe('conflict');
  expect(drive.uploads).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Drive Sentinel LOCAL-CONFLICT');
});

test('a local save during a clean remote pull becomes a conflict instead of being overwritten', async ({ page }) => {
  test.setTimeout(120_000);
  const drive = await openApp(page, { mediaDelayMs: 700 });
  await seedWorkspace(page, 'BASE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
  });
  // Drain any post-connect single-flight cycle before changing the mock
  // remote. The pull below must own a fresh cycle rather than join a clean
  // cycle that began before the remote version changed.
  await page.evaluate(() => window.SutraDriveSync.syncNow());
  await page.evaluate(() => window.SutraDriveSync._setMetadataForTests({ localDirty: false }));
  const uploadsBeforePull = drive.uploads.length;
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  });

  // A save debounce can still own the first manual call. Make the mocked
  // remote newer for every attempt so a just-finished stale cycle cannot
  // consume the only changed version and turn the asserted pull into a clean
  // no-op.
  let pullPromise;
  let pullStarted = false;
  for (let attempt = 0; attempt < 3 && !pullStarted; attempt += 1) {
    drive.files[0].version = String(99 + attempt);
    drive.files[0].modifiedTime = new Date(Date.UTC(2026, 5, 6, 15, attempt, 0)).toISOString();
    const mediaStarted = drive.waitForNextMediaGet();
    pullPromise = page.evaluate(() => {
      // A delayed clean cycle can update the remembered remote version without
      // downloading. Force this explicit cycle to see the mocked remote as
      // changed, so the test owns the download window where its local save is
      // made.
      window.SutraDriveSync._setMetadataForTests({
        localDirty: false,
        lastKnownDriveVersion: `fixture-baseline-${Date.now()}`
      });
      return window.SutraDriveSync.syncNow();
    });
    const first = await Promise.race([
      mediaStarted.then(() => 'media'),
      pullPromise.then(() => 'cycle')
    ]);
    pullStarted = first === 'media';
    if (!pullStarted) await pullPromise;
  }
  expect(pullStarted).toBe(true);
  await seedWorkspace(page, 'MID-PULL-LOCAL');

  await expect(pullPromise).resolves.toEqual({ conflict: true });
  await expect(page.locator('#sutraDriveConflictModal')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title))
    .toBe('Drive Sentinel MID-PULL-LOCAL');
  expect(drive.uploads).toHaveLength(uploadsBeforePull);
});

test('Drive sync reports needs-config and refuses connect when no OAuth client ID is configured', async ({ page }) => {
  // Deliberately NOT installing the Google Identity mock, so SUTRA_CONFIG carries
  // no googleDriveClientId (runtime config defaults it to '').
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await page.evaluate(() => window.SutraDriveSync._resetForTests());
  await page.evaluate(() => window.SutraDriveSync._setMetadataForTests({ enabled: true }));

  const status = await page.evaluate(() => window.SutraDriveSync.getStatus());
  expect(status.clientIdConfigured).toBe(false);
  expect(status.state).toBe('needs-config');

  // connect() must refuse before any OAuth/Drive request when no client ID exists.
  const err = await page.evaluate(() => window.SutraDriveSync.connect().then(() => 'ok').catch(e => e.message || String(e)));
  expect(err).toMatch(/OAuth Web Client ID/);
  expect(await page.evaluate(() => window.__sutraRequestedScopes || [])).toEqual([]);
});

test('conflict resolution: Use Drive copy restores the remote workspace without uploading', async ({ page }) => {
  test.setTimeout(120_000);
  const drive = await openApp(page);
  await seedWorkspace(page, 'BASE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;
  expect(drive.uploads).toHaveLength(1);

  drive.files[0].version = '99';
  drive.files[0].modifiedTime = new Date(Date.UTC(2026, 5, 6, 15, 0, 0)).toISOString();
  await seedWorkspace(page, 'LOCAL-CONFLICT');
  expect(await page.evaluate(() => window.SutraDriveSync.syncNow())).toEqual({ conflict: true });
  await expect(page.locator('#sutraDriveConflictModal')).toHaveClass(/active/);

  await page.locator('#sutraDriveConflictUseRemoteBtn').click();
  await completeSafetySnapshotDialog(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Drive Sentinel BASE');
  expect(drive.uploads).toHaveLength(1); // restoring the remote copy must not upload
  await expect.poll(() => page.evaluate(() => window.SutraDriveSync.getStatus().state)).not.toBe('conflict');
  await expect(page.locator('#sutraDriveConflictModal')).not.toHaveClass(/active/);
});

test('conflict resolution: Keep this device re-uploads (forceReplace) without changing local data', async ({ page }) => {
  const drive = await openApp(page);
  await seedWorkspace(page, 'BASE');
  const connectPromise = page.evaluate(() => window.SutraDriveSync.connect().then(() => true));
  await fillCloudPassword(page);
  await connectPromise;
  expect(drive.uploads).toHaveLength(1);

  drive.files[0].version = '99';
  drive.files[0].modifiedTime = new Date(Date.UTC(2026, 5, 6, 15, 0, 0)).toISOString();
  await seedWorkspace(page, 'LOCAL-CONFLICT');
  expect(await page.evaluate(() => window.SutraDriveSync.syncNow())).toEqual({ conflict: true });
  await expect(page.locator('#sutraDriveConflictModal')).toHaveClass(/active/);

  await page.locator('#sutraDriveConflictKeepLocalBtn').click();
  await expect.poll(() => drive.uploads.length, { timeout: 20_000 }).toBe(2);
  const lastUpload = drive.uploads[drive.uploads.length - 1];
  expect(lastUpload.metadata.appProperties).toEqual({ sutraRole: 'sync-current', sutraSyncFormat: '1' });
  expect(lastUpload.encryptedBytes.slice(0, 8).toString('utf8')).toBe('SUTRAENC');
  // Keeping this device must not alter the local workspace.
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Drive Sentinel LOCAL-CONFLICT');
  await expect(page.locator('#sutraDriveConflictModal')).not.toHaveClass(/active/);
});
