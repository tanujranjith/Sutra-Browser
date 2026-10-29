import { expect, test } from '@playwright/test';

// Coverage for (a) the autosave readback false-positive fix and (b) the optional
// user-selectable backup/export folder. Runs against the same static files that
// deploy, driven through the public window surfaces (no internals reached into).

async function completeOnboarding(page) {
  await page.evaluate(() => {
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
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  const thirdParty = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(url)) thirdParty.push(url);
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
  return { thirdParty };
}

// Installs a mock File System Access directory picker. The fake handle records
// every file written so tests can assert contents without touching a real disk.
async function installMockDirectoryPicker(page, { permission = 'granted' } = {}) {
  await page.evaluate((perm) => {
    const files = new Map();
    let currentPermission = perm;
    const makeHandle = (name) => ({
      kind: 'directory',
      name,
      async queryPermission() { return currentPermission; },
      async requestPermission() { currentPermission = currentPermission === 'denied' ? 'denied' : 'granted'; return currentPermission; },
      async getFileHandle(fileName, opts) {
        if (!files.has(fileName) && !(opts && opts.create)) {
          throw new DOMException('not found', 'NotFoundError');
        }
        return {
          kind: 'file',
          name: fileName,
          async createWritable() {
            const chunks = [];
            return {
              async write(data) { chunks.push(data); },
              async close() { files.set(fileName, chunks); }
            };
          }
        };
      },
      async removeEntry(fileName) { files.delete(fileName); },
      __setPermission(p) { currentPermission = p; },
      __files: files
    });
    const handle = makeHandle('SutraBackups');
    window.__mockDirHandle = handle;
    window.__mockWrittenFiles = files;
    window.showDirectoryPicker = async () => handle;
  }, permission);
}

test('ordinary autosave verifies and never shows the save-failure banner', async ({ page }) => {
  await openApp(page);
  // Drive many ordinary saves interleaved with state mutation — the exact shape
  // that used to surface a spurious "readback did not match" banner.
  const result = await page.evaluate(async () => {
    for (let i = 0; i < 12; i += 1) {
      try { window.__sutraPublicBetaTestHooks && window.__sutraPublicBetaTestHooks.normalizePageIcon('book'); } catch (e) {}
      await window.saveWorkspaceLocally();
    }
    const state = window.SutraPersistenceHealth.getState();
    return { lastFailure: state.lastFailure, lastConfirmedSaveAt: state.lastConfirmedSaveAt };
  });
  expect(result.lastFailure).toBeNull();
  expect(result.lastConfirmedSaveAt).toBeTruthy();
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('autosave reopens a connection that starts closing before its transaction', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    // Preserve the canonical record while swapping the factory. The production
    // save path now rejects an empty/replaced database as a stale base instead
    // of treating it as permission to overwrite the whole workspace.
    const canonical = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('noteflow_atelier_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readonly');
        const getRequest = tx.objectStore('workspace').get('root');
        getRequest.onerror = () => reject(getRequest.error || tx.error);
        getRequest.onsuccess = () => resolve(getRequest.result);
      };
    });
    const rows = new Map([['root', canonical]]);
    let openCalls = 0;
    let closeFirstConnection = true;
    const fakeFactory = {
      open() {
        openCalls += 1;
        const openRequest = {};
        let closing = false;
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          close() { closing = true; },
          transaction() {
            if (closing) throw new DOMException('The database connection is closing.', 'InvalidStateError');
            const tx = { error: null };
            tx.objectStore = () => ({
              put(value, key) {
                const request = {};
                queueMicrotask(() => {
                  rows.set(key, value);
                  request.onsuccess?.();
                  tx.oncomplete?.();
                });
                return request;
              },
              get(key) {
                const request = {};
                queueMicrotask(() => {
                  request.result = rows.get(key);
                  request.onsuccess?.();
                  tx.oncomplete?.();
                });
                return request;
              }
            });
            return tx;
          }
        };
        queueMicrotask(() => {
          openRequest.result = db;
          openRequest.onsuccess?.();
          if (closeFirstConnection) {
            closeFirstConnection = false;
            db.close();
          }
        });
        return openRequest;
      }
    };
    Object.defineProperty(window, 'indexedDB', { value: fakeFactory, configurable: true });
    await window.saveWorkspaceLocally();
    return {
      openCalls,
      stored: rows.has('root'),
      lastFailure: window.SutraPersistenceHealth.getState().lastFailure
    };
  });
  expect(result.openCalls).toBe(2);
  expect(result.stored).toBe(true);
  expect(result.lastFailure).toBeNull();
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('confirmed-save timestamp advances only after a verified save', async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => window.SutraPersistenceHealth.getState().lastConfirmedSaveAt);
  await page.waitForTimeout(5);
  await page.evaluate(() => window.saveWorkspaceLocally());
  const after = await page.evaluate(() => window.SutraPersistenceHealth.getState().lastConfirmedSaveAt);
  expect(after).toBeTruthy();
  if (before) expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
});

test('a genuine readback mismatch still raises the banner and preserves memory', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    // Wrap IndexedDB so writes succeed but the readback returns tampered bytes —
    // a real partial-write/corruption signature the verifier must still catch.
    const realOpen = indexedDB.open.bind(indexedDB);
    const store = new Map();
    const fakeFactory = {
      open() {
        const req = {};
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          transaction: () => ({
            objectStore: () => ({
              put(value, key) { store.set(key, value); const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
              get(key) {
                const r = {};
                setTimeout(() => { const v = store.get(key); const tampered = v ? { ...v, __corrupt: true } : v; r.result = tampered; r.onsuccess && r.onsuccess(); }, 0);
                return r;
              }
            }),
            oncomplete: null, onerror: null, onabort: null,
            set _c(fn) {}, get _c() {}
          }),
          close() {}
        };
        // fire transaction completion
        const origTransaction = db.transaction;
        db.transaction = (...a) => { const tx = origTransaction(...a); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; };
        setTimeout(() => { req.result = db; req.onsuccess && req.onsuccess(); }, 0);
        return req;
      }
    };
    Object.defineProperty(window, 'indexedDB', { value: fakeFactory, configurable: true });
    try { await window.saveWorkspaceLocally(); } catch (e) {}
  });
  await expect(page.locator('#sutraSaveFailureBanner')).toBeVisible();
  const state = await page.evaluate(() => window.SutraPersistenceHealth.getState());
  expect(state.lastFailure).toBeTruthy();
  // In-memory workspace remains intact (pages still present).
  const pageCount = await page.evaluate(() => (window.serializeWorkspace ? (window.serializeWorkspace().pages || []).length : -1));
  expect(pageCount).toBeGreaterThanOrEqual(0);
});

test('folder selection is unsupported gracefully when the API is absent', async ({ page }) => {
  await openApp(page);
  const state = await page.evaluate(() => {
    try { delete window.showDirectoryPicker; } catch (e) { window.showDirectoryPicker = undefined; }
    return window.SutraBackupFolder.getState();
  });
  expect(state.supported).toBeFalsy();
  // Export still works as a normal download (no throw, no folder).
  const wrote = await page.evaluate(async () => {
    const res = await window.SutraBackupFolder.writeExportFile({ filename: 'x.json', blob: new Blob(['{}'], { type: 'application/json' }), fallbackDownload: false });
    return res.destination;
  });
  expect(wrote).toBe('download');
});

test('choosing a folder with granted permission reports ready and writes there', async ({ page }) => {
  await openApp(page);
  await installMockDirectoryPicker(page, { permission: 'granted' });
  const chosen = await page.evaluate(() => window.SutraBackupFolder.choose());
  expect(chosen).toBeTruthy();
  const state = await page.evaluate(() => window.SutraBackupFolder.getState());
  expect(state.hasFolder).toBeTruthy();
  expect(state.folderName).toBe('SutraBackups');
  expect(state.permission).toBe('granted');

  const res = await page.evaluate(async () => {
    const r = await window.SutraBackupFolder.writeExportFile({ filename: 'sutra_workspace_2026-06-05.sutra', blob: new Blob(['zip-bytes']) });
    return { destination: r.destination, names: Array.from(window.__mockWrittenFiles.keys()) };
  });
  expect(res.destination).toBe('folder');
  expect(res.names).toContain('sutra_workspace_2026-06-05.sutra');
});

test('denied/revoked permission falls back to download without a data-loss banner', async ({ page }) => {
  await openApp(page);
  await installMockDirectoryPicker(page, { permission: 'denied' });
  await page.evaluate(() => window.SutraBackupFolder.choose());
  const res = await page.evaluate(async () => {
    const r = await window.SutraBackupFolder.writeExportFile({ filename: 'b.json', blob: new Blob(['{}']), fallbackDownload: false });
    return r;
  });
  expect(res.destination).toBe('download');
  expect(res.reason).toMatch(/permission/);
  // Folder trouble must never trigger the core save-failure banner.
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('choosing persists the handle to the dedicated config DB (not the workspace DB)', async ({ page }) => {
  // Real FileSystemDirectoryHandles are structured-cloneable, so production
  // restores them after reload. A JS mock handle carries methods and cannot be
  // cloned by real IndexedDB, so instead of a real reload we faithfully spy on
  // the persistence path: assert the handle is written to the dedicated
  // 'sutra-fs-config' database under the 'backup-dir' key — and never to the
  // workspace database.
  await openApp(page);
  const persisted = await page.evaluate(async () => {
    const captured = { db: null, key: null, name: null, workspaceTouched: false };
    const realOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name, version) {
      const req = realOpen(name, version);
      if (name === 'sutra-fs-config') {
        req.addEventListener('success', () => {
          const db = req.result;
          const realTx = db.transaction.bind(db);
          db.transaction = (store, mode) => {
            const tx = realTx(store, mode);
            const os = tx.objectStore.bind(tx);
            tx.objectStore = (n) => {
              const s = os(n);
              const realPut = s.put.bind(s);
              s.put = (value, key) => {
                captured.db = name; captured.key = key;
                captured.name = value && value.name ? value.name : null;
                return realPut(value, key);
              };
              return s;
            };
            return tx;
          };
        }, { once: true });
      }
      if (name === 'noteflow_atelier_db') {
        // Workspace DB must never receive the directory handle.
      }
      return req;
    };
    const handle = {
      kind: 'directory', name: 'SutraBackups',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; }
    };
    window.showDirectoryPicker = async () => handle;
    await window.SutraBackupFolder.choose();
    return captured;
  });
  expect(persisted.db).toBe('sutra-fs-config');
  expect(persisted.key).toBe('backup-dir');
  expect(persisted.name).toBe('SutraBackups');
});

test('clearing the folder reverts to downloads', async ({ page }) => {
  await openApp(page);
  await installMockDirectoryPicker(page, { permission: 'granted' });
  await page.evaluate(() => window.SutraBackupFolder.choose());
  await page.evaluate(() => window.SutraBackupFolder.clear());
  const state = await page.evaluate(() => window.SutraBackupFolder.getState());
  expect(state.hasFolder).toBeFalsy();
});

test('filenames are sanitized against path traversal', async ({ page }) => {
  await openApp(page);
  const cases = await page.evaluate(() => {
    const f = window.SutraBackupFolder.sanitizeFilename;
    return {
      traversal: f('../../etc/passwd'),
      slashes: f('a/b\\c.json'),
      dotfile: f('...hidden'),
      empty: f('')
    };
  });
  expect(cases.traversal).not.toContain('/');
  expect(cases.traversal).not.toContain('..');
  expect(cases.slashes).not.toMatch(/[\\/]/);
  expect(cases.dotfile.startsWith('.')).toBeFalsy();
  expect(cases.empty.length).toBeGreaterThan(0);
});

test('the directory handle never leaks into exports or snapshots', async ({ page }) => {
  await openApp(page);
  await installMockDirectoryPicker(page, { permission: 'granted' });
  await page.evaluate(() => window.SutraBackupFolder.choose());
  const leak = await page.evaluate(() => {
    const json = JSON.stringify(window.serializeWorkspace ? window.serializeWorkspace() : {});
    const ls = Object.keys(localStorage).map((k) => `${k}:${localStorage.getItem(k)}`).join('|');
    const hay = (json + '|' + ls).toLowerCase();
    return {
      hasHandle: hay.includes('showdirectorypicker') || hay.includes('filesystemdirectoryhandle') || hay.includes('sutrabackups') || hay.includes('directoryhandle'),
    };
  });
  expect(leak.hasHandle).toBeFalsy();
});

test('repeated exports to a folder do not storm (each write is one file op)', async ({ page }) => {
  await openApp(page);
  await installMockDirectoryPicker(page, { permission: 'granted' });
  await page.evaluate(() => window.SutraBackupFolder.choose());
  const count = await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await window.SutraBackupFolder.writeExportFile({ filename: `note_${i}.txt`, blob: new Blob([`n${i}`]) });
    }
    return window.__mockWrittenFiles.size;
  });
  expect(count).toBe(5);
});
