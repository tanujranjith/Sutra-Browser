import { expect, test } from '@playwright/test';
import { SYNC_MOCK_ORIGIN, createSyncMockServer, routeSyncServer } from './helpers/mock-sync-server.mjs';
import {
  createEverythingWorkspace,
  createReverseDirectionWorkspace,
  EVERYTHING_ASSISTANT_HISTORY,
  EVERYTHING_ATTACHMENT,
  EVERYTHING_LOCAL_STATE
} from '../fixtures/everything-workspace.mjs';
import { comparePortableWorkspaces } from '../helpers/sync-parity.mjs';

// Sutra Sync — incremental E2E-encrypted multi-device sync (Phase A: mocked
// Supabase-shaped backend). Two isolated browser contexts = two devices with
// separate IndexedDB, sharing one Node-side mock server through routing.
//
// Run alone (Windows port-exhaustion constraint):
//   npx playwright test --project=chromium --workers=1 cloud-sync

const PASSPHRASE = 'convergence is a feature';
const BASE_STAMP = '2026-07-01T00:00:00.000Z';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
}

async function waitForCanonicalHydration(page) {
  // Shell markup and globals arrive before canonical IndexedDB hydration.
  // This binding is installed by initApp only after the workspace has loaded;
  // fixture writes before it can be overwritten by a late hydrate.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
}

async function openDevice(browser, server, label) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => { sessionStorage.setItem('sutra_intro_played', '1'); });
  const net = { down: false };
  await routeSyncServer(context, server, net);
  const page = await context.newPage();
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForCanonicalHydration(page);
  await completeOnboarding(page);
  return { context, page, net, label };
}

async function openAuthedDevice(browser, server, label) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => { sessionStorage.setItem('sutra_intro_played', '1'); });
  const net = { down: false };
  await routeSyncServer(context, server, net);
  await context.addInitScript(({ url }) => {
    window.SUTRA_CONFIG = { supabaseUrl: url, supabaseAnonKey: 'mock-anon-key' };
  }, { url: SYNC_MOCK_ORIGIN });
  const page = await context.newPage();
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForCanonicalHydration(page);
  await completeOnboarding(page);
  await page.evaluate(async () => {
    await window.SutraCloudSync.switchProvider('supabase');
    await window.SutraCloudSync.verifyCode('student@example.com', '123456');
  });
  return { context, page, net, label };
}

// Both devices seed the IDENTICAL baseline (fixed ids + timestamps) so the
// initial enable converges instead of unioning two different default
// workspaces. Real second-device bootstrap lands in Phase B.
async function seedBaseline(page) {
  await page.evaluate(({ now }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace({
      ...base,
      pages: [
        { id: 'page-shared', title: 'Shared note', content: '<p>base body</p>', blocks: [], icon: 'doc', collapsed: false, createdAt: now, updatedAt: now },
        { id: 'page-second', title: 'Second note', content: '<p>second</p>', blocks: [], icon: 'doc', collapsed: false, createdAt: now, updatedAt: now }
      ],
      tasks: [{ id: 'task-shared', title: 'Shared task', status: 'todo', priority: 'high' }],
      taskOrder: ['task-shared']
    });
  }, { now: BASE_STAMP });
  // Let the direct fixture import finish its browser task before requesting
  // a durable save. The user-facing restore path uses the same ordering.
  await page.evaluate(() => window.saveWorkspaceLocally());
}

async function enableSync(page) {
  const result = await page.evaluate(async ({ endpoint, passphrase }) => {
    const outcome = await window.SutraSync.enable({ passphrase, endpoint });
    return { state: outcome.status.state, error: outcome.outcome && outcome.outcome.error ? String(outcome.outcome.error) : null };
  }, { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE });
  expect(result.error).toBeNull();
  expect(result.state).toBe('idle');
}

async function syncNow(page) {
  return page.evaluate(async () => {
    const outcome = await window.SutraSync.syncNow();
    return {
      applied: outcome.applied === true,
      pushed: Number(outcome.pushed) || 0,
      pulled: Number(outcome.pulled) || 0,
      conflicts: Number(outcome.conflicts) || 0,
      error: outcome.error ? String(outcome.error) : null,
      skipped: outcome.skipped === true
    };
  });
}

test('Cloud automatically sends saved edits, resumes offline work, and honors pause and lock', async ({ browser }) => {
  test.setTimeout(180000);
  const server = createSyncMockServer();
  const A = await openDevice(browser, server, 'A');
  const B = await openDevice(browser, server, 'B');
  const rename = (page, title) => page.evaluate(async next => {
    const workspace = window.serializeWorkspace();
    workspace.pages.find(p => p.id === 'page-shared').title = next;
    window.deserializeWorkspace(workspace);
    await window.saveWorkspaceLocally();
  }, title);
  const titleOn = page => page.evaluate(() => window.serializeWorkspace().pages.find(p => p.id === 'page-shared').title);
  const foreground = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  try {
    await seedBaseline(A.page);
    await seedBaseline(B.page);
    await enableSync(A.page);
    await enableSync(B.page);
    await rename(A.page, 'Automatically saved');
    await expect.poll(() => A.page.evaluate(() => window.SutraCloud.getStatus().sync.state), { timeout: 15000 }).toBe('idle');
    await expect.poll(async () => { await foreground(B.page); return titleOn(B.page); }, { timeout: 30000, intervals: [3500] }).toBe('Automatically saved');
    A.net.down = true;
    await rename(A.page, 'Saved offline');
    await expect.poll(() => A.page.evaluate(() => window.SutraCloud.getStatus().sync.state), { timeout: 15000 }).toBe('offline');
    A.net.down = false;
    await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(async () => { await foreground(B.page); return titleOn(B.page); }, { timeout: 30000, intervals: [3500] }).toBe('Saved offline');
    await A.page.evaluate(() => window.SutraCloud.pauseSync());
    await rename(A.page, 'Paused edit');
    const count = server.state.ops.length;
    await A.page.waitForTimeout(3500);
    expect(server.state.ops.length).toBe(count);
    await A.page.evaluate(() => window.SutraCloud.resumeSync());
    await expect.poll(async () => { await foreground(B.page); return titleOn(B.page); }, { timeout: 30000, intervals: [3500] }).toBe('Paused edit');
    await A.page.evaluate(() => window.SutraSync.lock());
    await rename(A.page, 'Locked edit');
    const lockedCount = server.state.ops.length;
    await A.page.waitForTimeout(3500);
    expect(server.state.ops.length).toBe(lockedCount);
    expect(await A.page.evaluate(() => window.SutraCloud.getStatus().sync.state)).toBe('locked');
  } finally {
    await A.context.close();
    await B.context.close();
  }
});

test.describe('Sutra Sync Beta opt-in boundaries', () => {
  test.describe.configure({ timeout: 180_000 });

  test('fresh workspaces discover the beta without enabling it, and dismissal is durable', async ({ browser }) => {
    const server = createSyncMockServer();
    const device = await openDevice(browser, server, 'beta-discovery');

    await device.page.waitForFunction(() => window.SutraNotifications
      && window.SutraNotifications.getNotifications().some(item => item.source === 'syncBeta'));
    const initial = await device.page.evaluate(() => ({
      status: window.SutraSync.status(),
      notice: window.SutraNotifications.getNotifications().find(item => item.source === 'syncBeta')
    }));
    expect(initial.status.enabled).toBe(false);
    expect(initial.notice).toMatchObject({
      title: 'Sutra Sync Beta is available',
      relativeTime: 'optional · currently off'
    });
    expect(device.net.seenAuthHeaders).toHaveLength(0);

    await device.page.evaluate(() => {
      // The notification module intentionally auto-initializes after a short
      // startup delay. Its derived data can be available before its panel
      // listeners are ready, so synchronize with the public idempotent init.
      window.SutraNotifications.init();
      window.SutraNotifications.openPanel();
    });
    const noticeRow = device.page.getByRole('article', { name: /Sutra Sync Beta is available/i });
    await expect(noticeRow).toBeVisible();
    await noticeRow.press('Enter');
    await expect(device.page.getByRole('dialog', { name: 'Sutra Cloud', exact: true })).toBeVisible();
    await expect(device.page.locator('#sutraSyncSetup')).toContainText('Optional and currently off');
    await expect(device.page.locator('#sutraSyncSetup')).toContainText('recent encrypted .sutra backup');
    expect((await device.page.evaluate(() => window.SutraSync.status())).enabled).toBe(false);
    await device.page.locator('#sutraCloudModal [data-modal-close]').click();

    // Use a second fresh profile to exercise the explicit Not now/dismiss path,
    // since opening the first notice intentionally acknowledges it as read.
    const dismissed = await openDevice(browser, server, 'beta-dismissal');
    await dismissed.page.waitForFunction(() => window.SutraNotifications
      && window.SutraNotifications.getNotifications().some(item => item.source === 'syncBeta'));
    await dismissed.page.evaluate(() => window.SutraNotifications.openPanel());
    await dismissed.page.getByRole('button', { name: /Dismiss Sutra Sync Beta is available/i }).click();
    expect((await dismissed.page.evaluate(() => window.SutraSync.status())).enabled).toBe(false);

    await dismissed.page.reload();
    await dismissed.page.waitForSelector('#fileInput', { state: 'attached' });
    await waitForCanonicalHydration(dismissed.page);
    await completeOnboarding(dismissed.page);
    await dismissed.page.waitForFunction(() => !!window.SutraNotifications && !!window.SutraSync);
    await dismissed.page.waitForTimeout(300);
    expect(await dismissed.page.evaluate(() => window.SutraNotifications
      .getNotifications().some(item => item.source === 'syncBeta'))).toBe(false);
    expect((await dismissed.page.evaluate(() => window.SutraSync.status())).enabled).toBe(false);
    await expect(dismissed.page.locator('#sutraCloudOpenBtn')).toBeAttached();

    // A restore containing another device's opt-in cannot override this
    // device's explicit local off state.
    const afterImport = await dismissed.page.evaluate(() => {
      const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      payload.settings.preferences.sync = { enabled: true, endpoint: 'https://should-not-enable.invalid' };
      window.deserializeWorkspace(payload);
      return window.SutraSync.status();
    });
    expect(afterImport.enabled).toBe(false);

    await device.context.close();
    await dismissed.context.close();
  });

  test('sign-in stays off and switching accounts clears opt-in while quarantining prior state', async ({ browser }) => {
    const server = createSyncMockServer();
    const device = await openAuthedDevice(browser, server, 'account-opt-in');
    expect((await device.page.evaluate(() => window.SutraSync.status())).enabled).toBe(false);
    expect(device.net.seenAuthHeaders).toHaveLength(0);

    await seedBaseline(device.page);
    await enableSync(device.page);
    expect((await device.page.evaluate(() => window.SutraSync.status())).enabled).toBe(true);
    const beforeSwitchRpcCount = device.net.seenAuthHeaders.length;
    const pageTitle = await device.page.evaluate(() => window.serializeWorkspace().pages[0].title);

    await device.page.evaluate(async () => {
      await window.SutraCloudSync.signOut();
      await window.SutraCloudSync.verifyCode('account-b@example.com', '123456');
    });
    const switched = await device.page.evaluate(async ({ endpoint, passphrase }) => {
      let enableError = '';
      try { await window.SutraSync.enable({ endpoint, passphrase }); }
      catch (error) { enableError = String(error && error.message || error); }
      return {
        status: window.SutraSync.status(),
        identity: window.SutraCloudSync.getActiveProvider().identity,
        pageTitle: window.serializeWorkspace().pages[0].title,
        enableError
      };
    }, { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE });
    expect(switched.identity).toBe('account-b@example.com');
    expect(switched.status.enabled).toBe(false);
    expect(switched.status.state).toBe('account-switch-blocked');
    expect(switched.enableError).toMatch(/changed to a different account/i);
    expect(switched.pageTitle).toBe(pageTitle);
    expect(device.net.seenAuthHeaders).toHaveLength(beforeSwitchRpcCount);
    await device.context.close();
  });

  test('explicit enablement and disablement remain durable', async ({ browser }) => {
    const server = createSyncMockServer();
    const device = await openAuthedDevice(browser, server, 'durable-opt-in');
    await seedBaseline(device.page);
    await enableSync(device.page);
    await device.page.reload();
    await device.page.waitForSelector('#fileInput', { state: 'attached' });
    await waitForCanonicalHydration(device.page);
    await completeOnboarding(device.page);
    await device.page.waitForFunction(() => !!window.SutraSync);
    expect((await device.page.evaluate(() => window.SutraSync.status())).enabled).toBe(true);

    await device.page.evaluate(() => window.SutraSync.disable());
    await device.page.reload();
    await device.page.waitForSelector('#fileInput', { state: 'attached' });
    await waitForCanonicalHydration(device.page);
    await completeOnboarding(device.page);
    await device.page.waitForFunction(() => !!window.SutraSync);
    expect((await device.page.evaluate(() => window.SutraSync.status())).enabled).toBe(false);
    await device.context.close();
  });
});

test('device-session mismatch fails closed, leaves no generated key, and safely requires reauthentication', async ({ browser }) => {
  const server = createSyncMockServer();
  const device = await openAuthedDevice(browser, server, 'mismatch-device');
  device.net.rpcOverride = ({ rpcName }) => rpcName === 'sync_get_vault_key'
    ? { status: 200, body: { ok: false, code: 'device-session-mismatch' } }
    : null;

  const result = await device.page.evaluate(async ({ endpoint, passphrase }) => {
    let caught = null;
    try {
      await window.SutraSync.enable({ passphrase, endpoint });
    } catch (error) {
      caught = { message: String(error && error.message || error), code: error && error.code };
    }
    const sensitiveMetaKeys = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sutra_sync_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('meta', 'readonly');
        const keys = tx.objectStore('meta').getAllKeys();
        keys.onerror = () => reject(keys.error);
        keys.onsuccess = () => resolve(keys.result.filter(key => /:(wrappedVaultKey|supabaseRefreshToken)$/.test(String(key)) || /^(wrappedVaultKey|supabaseRefreshToken)$/.test(String(key))));
      };
    });
    return {
      caught,
      signedIn: window.SutraCloudSync.isSignedIn(),
      enabled: window.SutraSync.status().enabled,
      sensitiveMetaKeys
    };
  }, { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE });

  expect(result.caught.code).toBe('auth-expired');
  expect(result.caught.message).toContain('safely signed this browser out');
  expect(result.signedIn).toBe(false);
  expect(result.enabled).toBe(false);
  expect(result.sensitiveMetaKeys).toEqual([]);
  expect(device.net.logoutCalls).toBe(1);
  expect(device.net.seenAuthHeaders.map(call => call.rpc)).toEqual(['sync_get_vault_key']);
  await device.context.close();
});

test('vault creation rejection never persists an unconfirmed local key', async ({ browser }) => {
  const server = createSyncMockServer();
  const device = await openAuthedDevice(browser, server, 'create-rejected-device');
  device.net.rpcOverride = ({ rpcName }) => rpcName === 'sync_put_vault_key'
    ? { status: 200, body: { ok: false, code: 'device-session-mismatch' } }
    : null;

  const result = await device.page.evaluate(async ({ endpoint, passphrase }) => {
    let caught = null;
    try {
      await window.SutraSync.enable({ passphrase, endpoint });
    } catch (error) {
      caught = { message: String(error && error.message || error), code: error && error.code };
    }
    const metaKeys = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sutra_sync_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('meta', 'readonly');
        const keys = tx.objectStore('meta').getAllKeys();
        keys.onerror = () => reject(keys.error);
        keys.onsuccess = () => resolve(keys.result.map(String));
      };
    });
    return { caught, signedIn: window.SutraCloudSync.isSignedIn(), metaKeys };
  }, { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE });

  expect(result.caught.code).toBe('auth-expired');
  expect(result.signedIn).toBe(false);
  expect(result.metaKeys.some(key => key.endsWith(':wrappedVaultKey') || key === 'wrappedVaultKey')).toBe(false);
  expect(result.metaKeys.some(key => key.endsWith(':supabaseRefreshToken') || key === 'supabaseRefreshToken')).toBe(false);
  expect(device.net.seenAuthHeaders.map(call => call.rpc)).toEqual(['sync_get_vault_key', 'sync_put_vault_key']);
  expect(device.net.logoutCalls).toBe(1);
  await device.context.close();
});

test('two fresh tabs atomically choose one shared device identity', async ({ browser }) => {
  const server = createSyncMockServer();
  const device = await openDevice(browser, server, 'identity-tab-a');
  const secondPage = await device.context.newPage();
  await secondPage.goto('/Sutra.html');
  await secondPage.waitForSelector('#fileInput', { state: 'attached' });
  await waitForCanonicalHydration(secondPage);
  await completeOnboarding(secondPage);

  for (const page of [device.page, secondPage]) {
    await page.evaluate(() => {
      window.SutraSync._setTransportFactory(({ deviceId }) => {
        window.__capturedSyncDeviceId = deviceId;
        return {
          getVaultKey: async () => ({ ok: false, code: 'intentional-stop' })
        };
      });
    });
  }

  await Promise.all([
    device.page.evaluate(({ endpoint, passphrase }) => window.SutraSync.enable({ endpoint, passphrase }).catch(() => null), { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE }),
    secondPage.evaluate(({ endpoint, passphrase }) => window.SutraSync.enable({ endpoint, passphrase }).catch(() => null), { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE })
  ]);
  const ids = await Promise.all([
    device.page.evaluate(() => window.__capturedSyncDeviceId),
    secondPage.evaluate(() => window.__capturedSyncDeviceId)
  ]);
  expect(ids[0]).toBeTruthy();
  expect(ids[1]).toBe(ids[0]);
  await device.context.close();
});

async function editPage(page, pageId, newBody) {
  await page.evaluate(async ({ pageId, newBody }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const pages = base.pages.map(p => (p.id === pageId ? { ...p, content: newBody, updatedAt: new Date().toISOString() } : p));
    window.deserializeWorkspace({ ...base, pages });
    await window.saveWorkspaceLocally();
  }, { pageId, newBody });
}

async function typeNoteBodyThroughEditor(page, paragraphs) {
  // Editor-v2 enablement is a supported per-device preference, so two sync
  // peers may legitimately use different editor generations. Drive whichever
  // actual editor is visible instead of assuming the creating device's v2
  // preference crossed to the fresh profile.
  let editor;
  try {
    const handle = await page.waitForFunction(() => {
      const v2 = document.querySelector('#editorV2Host .ProseMirror');
      const classic = document.getElementById('editor');
      const visible = node => !!node && getComputedStyle(node).display !== 'none'
        && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length > 0;
      if (visible(v2) && v2.isContentEditable) return v2;
      if (visible(classic) && classic.isContentEditable) return classic;
      return null;
    }, null, { timeout: 10000 });
    editor = handle.asElement();
  } catch (error) {
    const state = await page.evaluate(() => {
      const describe = node => node ? {
        id: node.id || null,
        className: node.className || null,
        contentEditable: node.contentEditable,
        isContentEditable: node.isContentEditable,
        display: getComputedStyle(node).display,
        visibility: getComputedStyle(node).visibility,
        rects: node.getClientRects().length,
        parentDisplay: node.parentElement ? getComputedStyle(node.parentElement).display : null
      } : null;
      return {
        pageId: window.flowAtelier && window.flowAtelier.currentPageId,
        activeView: document.querySelector('.view.active')?.id || null,
        notesViewClass: document.getElementById('view-notes')?.className || null,
        v2: describe(document.querySelector('#editorV2Host .ProseMirror')),
        v2Host: describe(document.getElementById('editorV2Host')),
        classic: describe(document.getElementById('editor'))
      };
    });
    throw new Error(`No visible Notes editor: ${JSON.stringify(state)} (${error.message})`);
  }
  if (!editor || !(await editor.isEditable())) {
    const state = await page.evaluate(() => {
      const describe = node => node ? {
        id: node.id || null,
        className: node.className || null,
        contentEditable: node.contentEditable,
        isContentEditable: node.isContentEditable,
        display: getComputedStyle(node).display,
        visibility: getComputedStyle(node).visibility,
        rects: node.getClientRects().length
      } : null;
      return {
        pageId: window.flowAtelier && window.flowAtelier.currentPageId,
        v2: describe(document.querySelector('#editorV2Host .ProseMirror')),
        classic: describe(document.getElementById('editor'))
      };
    });
    throw new Error(`Visible Notes editor is not editable: ${JSON.stringify(state)}`);
  }
  // Focusing the exact element returned by the visibility probe avoids a
  // locator re-resolution race while editor-v2 is finishing its mount.
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.insertText(paragraphs[index]);
  }
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-real-editor-save'));
}

async function createPageThroughUi(page, title, paragraphs) {
  const notesIsActive = await page.evaluate(() => document.getElementById('view-notes')?.classList.contains('active'));
  if (!notesIsActive) {
    await page.locator('button.view-tab[data-view="notes"]:visible').first().click();
    await page.waitForFunction(() => document.getElementById('view-notes')?.classList.contains('active'));
  }
  await page.click('button.new-page-btn');
  await page.fill('#newPageName', title);
  await page.click('#newPageModal button.btn-primary');
  await page.waitForFunction(expected => document.querySelector('#pageTitle')?.value === expected, title);
  await typeNoteBodyThroughEditor(page, paragraphs);
  return page.evaluate(() => window.flowAtelier.currentPageId);
}

async function editPageThroughUi(page, pageId, options = {}) {
  // A pulled page can already be current while the fresh device is still on
  // Today. Open Notes through the public navigation before driving its editor.
  const notesIsActive = await page.evaluate(() => document.getElementById('view-notes')?.classList.contains('active'));
  if (!notesIsActive) {
    await page.locator('button.view-tab[data-view="notes"]:visible').first().click();
    await page.waitForFunction(() => document.getElementById('view-notes')?.classList.contains('active'));
  }
  const currentPageId = await page.evaluate(() => window.flowAtelier.currentPageId);
  if (currentPageId !== pageId) {
    // Click the title rather than the row's geometric center. Desktop hover
    // actions can cover that center and accidentally open (for example) the
    // temporary-page confirmation instead of selecting the note.
    await page.locator(`.page-item[data-page-id="${pageId}"] .page-title-text`).click();
    await page.waitForFunction(expected => window.flowAtelier.currentPageId === expected, pageId, { timeout: 10000 });
  }
  if (options.title !== undefined) {
    await page.fill('#pageTitle', options.title);
    await page.locator('#pageTitle').dispatchEvent('input');
  }
  if (Array.isArray(options.paragraphs)) await typeNoteBodyThroughEditor(page, options.paragraphs);
  else {
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-real-title-save'));
  }
}

async function readPages(page) {
  return page.evaluate(() => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return base.pages.map(p => ({
      id: p.id,
      title: p.title,
      content: p.content,
      isSystemPage: p.isSystemPage === true,
      builtInId: p.builtInId || '',
      systemRole: p.systemRole || ''
    }));
  });
}

async function readTasks(page) {
  return page.evaluate(() => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return (base.tasks || []).map(t => ({ id: t.id, title: t.title }));
  });
}

async function seedEverythingWorkspace(page) {
  const base = await page.evaluate(() =>
    window.__sutraPublicBetaTestHooks.syncParity.getPortableSnapshot());
  const fixture = createEverythingWorkspace(base);
  return page.evaluate(async ({ fixture, assistant, localState, attachment }) => {
    // Exercise the normal import/normalization path, then use the sync-specific
    // Assistant restore boundary so an intentionally empty thread remains
    // durable and no backup-only marker is introduced.
    window.deserializeWorkspace(fixture);
    const hooks = window.__sutraPublicBetaTestHooks;
    hooks.syncParity.setAssistantChatHistory(assistant);
    hooks.syncParity.setPortableLocalState(localState);
    await hooks.seedCourseAttachmentBlob('blob-parity', attachment);
    await window.saveWorkspaceLocally();
    return {
      snapshot: await hooks.syncParity.getPortableSnapshot(),
      assistantRuntime: hooks.syncParity.getAssistantRuntimeState(),
      localState: hooks.syncParity.getPortableLocalState()
    };
  }, {
    fixture,
    assistant: EVERYTHING_ASSISTANT_HISTORY,
    localState: EVERYTHING_LOCAL_STATE,
    attachment: EVERYTHING_ATTACHMENT
  });
}

async function readEverythingState(page) {
  return page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const full = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
    const file = (full.courseWorkspace && full.courseWorkspace.files || [])
      .find(row => row.id === 'file-parity');
    // Attachment cache warming is intentionally non-blocking at startup.
    // Read the durable attachment store directly instead of assuming that
    // shell/canonical hydration also means the export cache has warmed.
    const durableAttachment = file?.blobKey
      ? await hooks.readCourseAttachmentBlob(file.blobKey)
      : null;
    return {
      snapshot: await hooks.syncParity.getPortableSnapshot(),
      assistantRuntime: hooks.syncParity.getAssistantRuntimeState(),
      localState: hooks.syncParity.getPortableLocalState(),
      attachment: durableAttachment || (file ? file._exportBlob || null : null),
      missingAttachment: file ? file.missingBlob === true : null
    };
  });
}

test.describe('Sutra Sync — two-device convergence (mocked backend)', () => {
  // WebCrypto + IndexedDB workloads are intentionally serialized and can
  // exceed two minutes on Windows CI/desktop hosts without being stuck.
  // Each encrypted two-device case owns fresh browser/worker state. Reusing a
  // worker across the large parity fixture and earlier crypto/IndexedDB cases
  // can leave the browser stalled during a later syncNow readback on Windows.
  test.describe.configure({ mode: 'parallel', timeout: 300_000 });

  test('create + edit propagate, double-push is idempotent, applies never echo', async ({ browser }) => {
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    const B = await openDevice(browser, server, 'B');
    try {
      await seedBaseline(A.page);
      await seedBaseline(B.page);
      await enableSync(A.page);
      await enableSync(B.page);
      await syncNow(B.page); // B settles against A's initial push

      // --- create on A propagates to B ---
      const opsBeforeCreate = server.state.ops.length;
      await A.page.evaluate(async () => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        window.deserializeWorkspace({
          ...base,
          pages: [...base.pages, { id: 'page-created-on-a', title: 'Created on A', content: '<p>fresh from A</p>', blocks: [], icon: 'doc', collapsed: false, createdAt: now, updatedAt: now }]
        });
        await window.saveWorkspaceLocally();
      });
      const pushA = await syncNow(A.page);
      expect(pushA.error).toBeNull();
      // A confirmed save schedules an automatic debounced cycle. It may win
      // the race with this explicit syncNow(), in which case pushed is already
      // zero or skipped while that cycle is still in flight. Wait for the
      // observable server write instead of treating lock acquisition as completion.
      await expect.poll(() => server.state.ops.length, { timeout: 20000 }).toBeGreaterThan(opsBeforeCreate);

      // B's automatic debounced cycle may apply the op before this explicit
      // call. Assert the observable convergence instead of which cycle won.
      await expect.poll(async () => {
        const pullB = await syncNow(B.page);
        expect(pullB.error).toBeNull();
        const pagesOnB = await readPages(B.page);
        return pagesOnB.some(p => p.id === 'page-created-on-a' && p.content.includes('fresh from A'));
      }, { timeout: 20000 }).toBe(true);

      // --- edit on B propagates back to A ---
      await editPage(B.page, 'page-created-on-a', '<p>B extended this</p>');
      const pushB = await syncNow(B.page);
      expect(pushB.error).toBeNull();
      await expect.poll(async () => {
        await syncNow(B.page);
        await syncNow(A.page);
        const pagesOnA = await readPages(A.page);
        return pagesOnA.find(p => p.id === 'page-created-on-a').content;
      }, { timeout: 20000 }).toContain('B extended this');

      // --- idempotent double push: a second immediate sync adds nothing ---
      const opsBefore = server.state.ops.length;
      const second = await syncNow(A.page);
      expect(second.error).toBeNull();
      expect(second.pushed).toBe(0);
      expect(server.state.ops.length).toBe(opsBefore);

      // --- echo suppression: B's apply of A's state must not re-broadcast ---
      const echo = await syncNow(B.page);
      expect(echo.pushed).toBe(0);
      expect(server.state.ops.length).toBe(opsBefore);

      // --- server stores ciphertext only ---
      const serverText = JSON.stringify(server.state);
      expect(serverText).not.toContain('fresh from A');
      expect(serverText).not.toContain('B extended this');
      expect(serverText).not.toContain('Shared note');
    } finally {
      await A.context.close();
      await B.context.close();
    }
  });

  test('real Notes UI merges version churn, title/body, separate paragraphs, and hides one overlapping conflict', async ({ browser }) => {
    test.setTimeout(300000);
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A-real-editor');
    let B;
    try {
      const pageId = await createPageThroughUi(A.page, 'Real merge note', ['paragraph one', 'paragraph two', 'paragraph three']);
      await enableSync(A.page);
      B = await openDevice(browser, server, 'B-real-editor');
      await enableSync(B.page);
      await syncNow(B.page);

      // The production editor creates auto-version checkpoints on both
      // devices. A title edit and B body edit must merge despite their random
      // checkpoint ids/timestamps.
      A.net.down = true;
      B.net.down = true;
      await editPageThroughUi(A.page, pageId, { title: 'Renamed through real UI' });
      await editPageThroughUi(B.page, pageId, { paragraphs: ['paragraph one', 'paragraph two from B', 'paragraph three'] });
      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page);
      await syncNow(B.page);
      await expect.poll(async () => {
        // A confirmed UI save can race its automatic cycle with these
        // explicit calls. Keep both peers moving until the non-overlapping
        // title/body merge is observably converged on each device.
        await syncNow(A.page);
        await syncNow(B.page);
        const [pagesA, pagesB] = await Promise.all([readPages(A.page), readPages(B.page)]);
        return [pagesA, pagesB].every(pages => {
          const page = pages.find(row => row.id === pageId);
          return page?.title === 'Renamed through real UI'
            && page.content.includes('paragraph two from B');
        });
      }, { timeout: 20000 }).toBe(true);
      const titleBody = await readPages(A.page);
      expect(titleBody.find(row => row.id === pageId)).toMatchObject({ title: 'Renamed through real UI' });
      expect(titleBody.find(row => row.id === pageId).content).toContain('paragraph two from B');
      expect((await B.page.evaluate(() => window.SutraSync.listConflicts())).length).toBe(0);

      // Different top-level blocks merge automatically.
      A.net.down = true;
      B.net.down = true;
      await editPageThroughUi(A.page, pageId, { paragraphs: ['paragraph one from A', 'paragraph two from B', 'paragraph three'] });
      await editPageThroughUi(B.page, pageId, { paragraphs: ['paragraph one', 'paragraph two from B', 'paragraph three from B'] });
      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page);
      await syncNow(B.page);
      const differentBlocks = (await readPages(A.page)).find(row => row.id === pageId).content;
      expect(differentBlocks).toContain('paragraph one from A');
      expect(differentBlocks).toContain('paragraph three from B');
      expect((await B.page.evaluate(() => window.SutraSync.listConflicts())).length).toBe(0);

      // Incompatible edits to the same block create one hidden review item.
      A.net.down = true;
      B.net.down = true;
      await editPageThroughUi(A.page, pageId, { paragraphs: ['paragraph one from A', 'overlap from A', 'paragraph three from B'] });
      await editPageThroughUi(B.page, pageId, { paragraphs: ['paragraph one from A', 'overlap from B', 'paragraph three from B'] });
      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await syncNow(A.page);
        await syncNow(B.page);
      }
      const finalA = await readPages(A.page);
      const finalB = await readPages(B.page);
      expect(finalA.filter(row => row.id === pageId).length).toBe(1);
      expect(finalB.filter(row => row.id === pageId).length).toBe(1);
      expect(finalA.some(row => /conflict copy/i.test(row.title) || String(row.id).startsWith('conflict-'))).toBe(false);
      expect(finalB.some(row => /conflict copy/i.test(row.title) || String(row.id).startsWith('conflict-'))).toBe(false);
      const recordKey = `c/pages/${encodeURIComponent(pageId)}`;
      const [reviewA, reviewB] = await Promise.all([A.page, B.page].map(page =>
        page.evaluate(key => window.SutraSync.listConflicts().then(rows => rows.filter(row => row.recordKey === key)), recordKey)
      ));
      const reviewById = new Map([...reviewA, ...reviewB].map(row => [row.id, row]));
      const review = [...reviewById.values()];
      expect(review.length).toBe(1);
      expect(review[0].type).toBe('page-content-conflict');
      expect(review[0].fieldConflicts.map(entry => entry.path)).toContain('$.content');

      // Resolve through the public Sync API. The stable encrypted audit marker
      // must clear this deterministic review id on every device and keep it
      // cleared through repeated pulls.
      const resolver = reviewB.length ? B : A;
      const follower = resolver === B ? A : B;
      await resolver.page.evaluate(id => window.SutraSync.resolveConflict(id, 'keep-merged'), review[0].id);
      await syncNow(resolver.page);
      await syncNow(follower.page);
      await syncNow(resolver.page);
      expect(await A.page.evaluate(() => window.SutraSync.listConflicts())).toHaveLength(0);
      expect(await B.page.evaluate(() => window.SutraSync.listConflicts())).toHaveLength(0);
      await expect.poll(async () => {
        // A confirmed save schedules an automatic cycle. Explicit syncNow()
        // calls intentionally return { skipped: true } while that cycle owns
        // the single-flight lock, so advance both peers until the encrypted
        // resolution marker is observably durable on each one.
        await syncNow(resolver.page);
        await syncNow(follower.page);
        return Promise.all([A.page, B.page].map(page => page.evaluate(id => {
          const ws = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
          return (ws.syncAuditLog || []).filter(row => row?.kind === 'sync_conflict_resolution' && row.conflictId === id).length;
        }, review[0].id)));
      }, { timeout: 20000 }).toEqual([1, 1]);
      await syncNow(A.page);
      expect(await A.page.evaluate(() => window.SutraSync.listConflicts())).toHaveLength(0);
    } finally {
      if (B) await B.context.close();
      await A.context.close();
    }
  });

  test('legacy conflict cleanup consolidates exact copies and moves unique content into review before removing it from the sidebar', async ({ browser }) => {
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'legacy-cleanup');
    try {
      await A.page.evaluate(async now => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        window.deserializeWorkspace({
          ...base,
          settings: {
            ...(base.settings || {}),
            dataHealth: { ...(base.settings?.dataHealth || {}), lastAtelierExportAt: now }
          },
          pages: [
            { id: 'cleanup-original', title: 'Cleanup note', content: '<p>same</p>', spaceId: 'default', versions: [] },
            { id: 'conflict-cleanup-exact', title: 'Cleanup note (conflict copy — device-a, 2026-07-17)', content: '<p>same</p>', spaceId: 'default', versions: [] },
            { id: 'conflict-cleanup-unique', title: 'Cleanup note (conflict copy — device-b, 2026-07-17)', content: '<p>unique retained branch</p>', spaceId: 'default', versions: [] },
            { id: 'conflict-cleanup-folder', title: 'Cleanup folder (conflict copy — device-c, 2026-07-17)', content: '<p>folder</p>', spaceId: 'default', versions: [] },
            { id: 'cleanup-child', title: 'Cleanup folder (conflict copy — device-c, 2026-07-17)::Child', content: '<p>child</p>', spaceId: 'default', versions: [] }
          ]
        });
        await window.saveWorkspaceLocally();
      }, new Date().toISOString());

      const prepared = await A.page.evaluate(async () => {
        const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const analysis = await window.SutraSync.analyzeLegacyConflictCopies();
        return {
          counts: analysis.counts,
          lastAtelierExportAt: payload.settings?.dataHealth?.lastAtelierExportAt || ''
        };
      });
      expect(prepared.counts).toMatchObject({ total: 3, safe: 1, review: 1, ambiguous: 1, recursive: 0 });
      expect(Date.now() - Date.parse(prepared.lastAtelierExportAt)).toBeLessThan(15 * 60 * 1000);

      const cleanupPromise = A.page.evaluate(() => window.SutraSync.cleanupLegacyConflictCopies());
      // Snapshot/save analysis can outlive the default locator timeout on a
      // busy host; wait for the actual confirmation boundary, not wall time.
      await expect(A.page.locator('#customConfirmModal')).toHaveClass(/active/, { timeout: 30_000 });
      await A.page.locator('#customConfirmAcceptBtn').click();
      const result = await cleanupPromise;
      expect(result.removedIds).toEqual(['conflict-cleanup-exact', 'conflict-cleanup-unique']);
      expect(result.movedToReview).toEqual(['conflict-cleanup-unique']);

      const state = await A.page.evaluate(async () => ({
        pages: window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages,
        conflicts: await window.SutraSync.listConflicts()
      }));
      expect(state.pages.some(row => row.id === 'cleanup-original')).toBe(true);
      expect(state.pages.some(row => row.id === 'conflict-cleanup-exact')).toBe(false);
      expect(state.pages.some(row => row.id === 'conflict-cleanup-unique')).toBe(false);
      expect(state.pages.some(row => row.id === 'conflict-cleanup-folder')).toBe(true);
      expect(state.pages.some(row => row.id === 'cleanup-child')).toBe(true);
      const review = state.conflicts.find(row => row.legacyCopyId === 'conflict-cleanup-unique');
      expect(review).toBeTruthy();
      expect(review.remoteValue.content).toContain('unique retained branch');

      await A.page.evaluate(id => window.SutraSync.resolveConflict(id, 'keep-both'), review.id);
      const recovered = await A.page.evaluate(() =>
        window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages
          .filter(row => /recovered conflict/i.test(String(row.title)))
      );
      expect(recovered).toHaveLength(1);
      expect(recovered[0].content).toContain('unique retained branch');
    } finally {
      await A.context.close();
    }
  });

  test('offline divergence, hidden same-note review conflicts, and delete-vs-edit all converge', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    const B = await openDevice(browser, server, 'B');
    try {
      await seedBaseline(A.page);
      await seedBaseline(B.page);
      await enableSync(A.page);
      await enableSync(B.page);
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page); // settle both to the same cursor

      // --- offline: both devices edit DIFFERENT records while disconnected ---
      const opsBeforeOffline = server.state.ops.length;
      A.net.down = true;
      B.net.down = true;
      await editPage(A.page, 'page-shared', '<p>A offline edit</p>');
      await B.page.evaluate(async () => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const tasks = [...(base.tasks || []), { id: 'task-from-b-offline', title: 'B offline task', status: 'todo', priority: 'low' }];
        window.deserializeWorkspace({ ...base, tasks, taskOrder: [...(base.taskOrder || []), 'task-from-b-offline'] });
        await window.saveWorkspaceLocally();
      });
      const offlineA = await syncNow(A.page);
      // A background cycle may consume the network failure before this manual
      // call, leaving it as a benign skip. Either way, no op can reach the
      // server while both devices are offline; later convergence proves the
      // durable local edits remained queued.
      expect(offlineA.error !== null || offlineA.skipped || offlineA.pushed === 0).toBe(true);
      expect(server.state.ops.length).toBe(opsBeforeOffline);

      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page);

      // Resume can race the explicit cycles with an automatic debounced cycle.
      // Keep both peers moving until B's durable task is observable on A.
      await expect.poll(async () => {
        await syncNow(B.page);
        await syncNow(A.page);
        return (await readTasks(A.page)).some(t => t.id === 'task-from-b-offline');
      }, { timeout: 30_000 }).toBe(true);

      const pagesA = await readPages(A.page);
      const pagesB = await readPages(B.page);
      const tasksA = await readTasks(A.page);
      expect(pagesB.find(p => p.id === 'page-shared').content).toContain('A offline edit');
      expect(tasksA.some(t => t.id === 'task-from-b-offline')).toBe(true);
      expect(pagesA.find(p => p.id === 'page-shared').content).toContain('A offline edit');

      // --- concurrent SAME-note edits → one hidden review record, no sidebar copy ---
      A.net.down = true;
      B.net.down = true;
      await editPage(A.page, 'page-second', '<p>A version of second</p>');
      await editPage(B.page, 'page-second', '<p>B version of second</p>');
      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      const conflictSync = await syncNow(B.page);
      expect(conflictSync.error).toBeNull();
      await syncNow(A.page);
      await syncNow(B.page);

      const finalPagesA = await readPages(A.page);
      const finalPagesB = await readPages(B.page);
      const copiesA = finalPagesA.filter(p => String(p.id).startsWith('conflict-page-second-'));
      const copiesB = finalPagesB.filter(p => String(p.id).startsWith('conflict-page-second-'));
      expect(copiesA.length).toBe(0);
      expect(copiesB.length).toBe(0);
      // Both devices show the identical deterministic winner.
      expect(finalPagesA.find(p => p.id === 'page-second').content)
        .toBe(finalPagesB.find(p => p.id === 'page-second').content);
      // Reconnect/resume may let either device win the single-flight race and
      // perform the three-way merge before the explicit cycle below. Conflict
      // stores are device-local, so assert one deterministic conflict identity
      // across both stores rather than assigning ownership to Device B.
      const [conflictsA, conflictsB] = await Promise.all([
        A.page.evaluate(() => window.SutraSync.listConflicts()),
        B.page.evaluate(() => window.SutraSync.listConflicts())
      ]);
      const pageConflicts = [...conflictsA, ...conflictsB]
        .filter(c => c.recordKey === 'c/pages/page-second');
      const conflictsById = new Map(pageConflicts.map(conflict => [conflict.id, conflict]));
      expect(conflictsById.size).toBe(1);
      const pageConflict = [...conflictsById.values()][0];
      expect(pageConflict.type).toBe('page-content-conflict');
      const bodiesB = [pageConflict.localValue.content, pageConflict.remoteValue.content].sort();
      expect(bodiesB[0]).toContain('A version of second');
      expect(bodiesB[1]).toContain('B version of second');

      // --- delete on A vs edit on B → the edit survives everywhere ---
      A.net.down = true;
      B.net.down = true;
      await A.page.evaluate(async () => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        window.deserializeWorkspace({ ...base, pages: base.pages.filter(p => p.id !== 'page-shared') });
        await window.saveWorkspaceLocally();
      });
      await editPage(B.page, 'page-shared', '<p>edited while A deleted it</p>');
      A.net.down = false;
      B.net.down = false;
      await A.page.evaluate(() => window.SutraSync.resume());
      await B.page.evaluate(() => window.SutraSync.resume());
      await syncNow(A.page);
      await syncNow(B.page);
      await syncNow(A.page);

      await expect.poll(async () => {
        await syncNow(B.page);
        await syncNow(A.page);
        const [pagesOnA, pagesOnB] = await Promise.all([readPages(A.page), readPages(B.page)]);
        return [pagesOnA, pagesOnB].every(rows =>
          rows.find(p => p.id === 'page-shared')?.content.includes('edited while A deleted it')
        );
      }, { timeout: 30_000 }).toBe(true);

      const survivorA = (await readPages(A.page)).find(p => p.id === 'page-shared');
      const survivorB = (await readPages(B.page)).find(p => p.id === 'page-shared');
      expect(survivorA, 'edit must resurrect the record on the deleting device').toBeTruthy();
      expect(survivorA.content).toContain('edited while A deleted it');
      expect(survivorB.content).toContain('edited while A deleted it');
    } finally {
      await A.context.close();
      await B.context.close();
    }
  });

  test('new-device bootstrap: snapshot + ops rebuild the workspace and survive reload', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    try {
      await seedBaseline(A.page);
      await enableSync(A.page);
      // Compact so the new device bootstraps from a snapshot, then push one
      // more op after the snapshot (the replay tail).
      const compacted = await A.page.evaluate(() => window.SutraSync.compactNow());
      expect(compacted.ok).toBe(true);
      await A.page.evaluate(async () => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        window.deserializeWorkspace({
          ...base,
          tasks: [...(base.tasks || []), { id: 'task-after-snapshot', title: 'Post-snapshot task', status: 'todo', priority: 'low' }],
          taskOrder: [...(base.taskOrder || []), 'task-after-snapshot']
        });
        await window.saveWorkspaceLocally();
      });
      await syncNow(A.page);
      // Prune ops covered by the snapshot: the new device MUST use it.
      const snapCursor = server.getSnapshot().cursor;
      server.state.ops = server.state.ops.filter(o => o.seq > snapCursor);

      // Fresh device: default workspace, no seeding — joins the vault.
      const B = await openDevice(browser, server, 'B');
      try {
        const localHelpBeforeBootstrap = (await readPages(B.page)).filter(page =>
          page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs');
        expect(localHelpBeforeBootstrap, 'fresh device starts with one local Help resource').toHaveLength(1);
        await enableSync(B.page);
        await syncNow(B.page);
        const pagesB = await readPages(B.page);
        const tasksB = await readTasks(B.page);
        expect(pagesB.some(p => p.id === 'page-shared'), 'snapshot content must arrive').toBe(true);
        expect(pagesB.some(p => p.id === 'page-second')).toBe(true);
        expect(tasksB.some(t => t.id === 'task-after-snapshot'), 'post-snapshot ops must replay').toBe(true);
        const helpAfterBootstrap = pagesB.filter(page =>
          page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs');
        expect(helpAfterBootstrap, 'remote bootstrap must preserve the local Help resource').toHaveLength(1);
        expect(helpAfterBootstrap[0]).toMatchObject({
          id: 'help_page',
          title: 'Help & Docs',
          isSystemPage: true,
          builtInId: 'help-docs',
          systemRole: 'help-docs'
        });
        const deletionRefused = await B.page.evaluate(() =>
          window.__sutraPublicBetaTestHooks.forceDeletePageById('help_page'));
        expect(deletionRefused, 'built-in Help deletion must not create a local delete/tombstone').toBe(false);

        // Survives a reload: state is durably in IndexedDB, sync stays enabled.
        await B.page.reload();
        await B.page.waitForSelector('#fileInput', { state: 'attached' });
        await waitForCanonicalHydration(B.page);
        const afterReload = await B.page.evaluate(() => {
          const pages = window.serializeWorkspace({ mode: 'json' }).pages;
          return {
            pages: pages.map(p => p.id),
            help: pages.filter(page =>
              page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs'),
            syncState: window.SutraSync.status().state
          };
        });
        expect(afterReload.pages).toContain('page-shared');
        expect(afterReload.help, 'reload must retain exactly one canonical Help resource').toHaveLength(1);
        expect(afterReload.help[0].id).toBe('help_page');
        expect(afterReload.syncState).toBe('locked'); // enabled, awaiting passphrase this session

        // Unlock resumes syncing with the same passphrase.
        const unlocked = await B.page.evaluate(async (passphrase) => (await window.SutraSync.unlock(passphrase)).status.state, PASSPHRASE);
        expect(unlocked).toBe('idle');
        await syncNow(A.page);
        await syncNow(B.page);
        const opsBeforeRepeat = server.state.ops.length;
        for (let cycle = 0; cycle < 3; cycle += 1) {
          await syncNow(A.page);
          await syncNow(B.page);
        }
        const helpAfterRepeatedCycles = (await readPages(B.page)).filter(page =>
          page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs');
        expect(helpAfterRepeatedCycles, 'repeated cycles must not delete or duplicate Help').toHaveLength(1);
        expect(server.state.ops.length, 'generated Help must not create sync operations').toBe(opsBeforeRepeat);
      } finally {
        await B.context.close();
      }
    } finally {
      await A.context.close();
    }
  });

  test('attachments: encrypted course-file blobs propagate and deduplicate', async ({ browser }) => {
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    const B = await openDevice(browser, server, 'B');
    const ATTACHMENT_DATA_URL = 'data:text/plain;base64,U3V0cmEgYXR0YWNobWVudCBwYXlsb2Fk'; // "Sutra attachment payload"
    try {
      await seedBaseline(A.page);
      await seedBaseline(B.page);
      // A adds a course with an attachment (the _exportBlob import path
      // stores the bytes in the attachments IndexedDB, like a restore does).
      await A.page.evaluate(async ({ blob }) => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        window.deserializeWorkspace({
          ...base,
          courseWorkspace: {
            courses: [{ id: 'course-sync', name: 'Synced Course', links: [] }],
            files: [{
              id: 'file-sync', courseId: 'course-sync', name: 'notes.txt', kind: 'file',
              storageType: 'indexeddb', blobKey: 'blob-sync-1', _exportBlob: blob, createdAt: now
            }],
            resourceLinks: [], relationships: [], settings: { activeCourseId: 'course-sync' }
          }
        });
        await window.saveWorkspaceLocally();
      }, { blob: ATTACHMENT_DATA_URL });

      await enableSync(A.page);
      expect(Object.keys(server.state.assets).length).toBe(1);
      // Ciphertext only: the base64 payload never appears server-side.
      expect(JSON.stringify(server.state)).not.toContain('U3V0cmEgYXR0YWNobWVudCBwYXlsb2Fk');

      await enableSync(B.page);
      let onB;
      await expect.poll(async () => {
        await syncNow(B.page);
        onB = await B.page.evaluate(() => {
          const full = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
          const file = (full.courseWorkspace && full.courseWorkspace.files || []).find(f => f.id === 'file-sync');
          return { found: !!file, blob: file ? file._exportBlob || null : null, missing: file ? file.missingBlob === true : null, assetsPending: window.SutraSync.status().assetsPending };
        });
        return onB.blob;
      }, { timeout: 20000 }).toBe(ATTACHMENT_DATA_URL);
      expect(onB.found).toBe(true);
      expect(onB.blob).toBe(ATTACHMENT_DATA_URL);
      expect(onB.assetsPending).toBe(0);

      // Dedupe: a second file with IDENTICAL content syncs without a second
      // server blob, and still materializes under its own blobKey on B.
      await A.page.evaluate(async ({ blob }) => {
        const base = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        const files = [...base.courseWorkspace.files, {
          id: 'file-sync-copy', courseId: 'course-sync', name: 'notes-copy.txt', kind: 'file',
          storageType: 'indexeddb', blobKey: 'blob-sync-2', _exportBlob: blob, createdAt: now
        }];
        window.deserializeWorkspace({ ...base, courseWorkspace: { ...base.courseWorkspace, files } });
        await window.saveWorkspaceLocally();
      }, { blob: ATTACHMENT_DATA_URL });
      await syncNow(A.page);
      expect(Object.keys(server.state.assets).length).toBe(1, 'identical content must deduplicate');

      await expect.poll(async () => {
        await syncNow(B.page);
        return B.page.evaluate(() => {
          const full = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
          const file = (full.courseWorkspace && full.courseWorkspace.files || []).find(f => f.id === 'file-sync-copy');
          return file ? file._exportBlob || null : null;
        });
      }, { timeout: 20000 }).toBe(ATTACHMENT_DATA_URL);
    } finally {
      await A.context.close();
      await B.context.close();
    }
  });

  test('complete portable workspace parity: snapshot bootstrap, Assistant hydration, assets, reverse incrementals, and reload', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    const REPLACEMENT_ATTACHMENT =
      'data:text/plain;base64,U3ludGhldGljIFN1dHJhIHBhcml0eSByZXBsYWNlbWVudC4=';
    try {
      const seededA = await seedEverythingWorkspace(A.page);

      // Credential-shaped values exist only on Device A. The sync serializer
      // must redact them before encryption, while the real vault passphrase
      // also must never occur in server state.
      await A.page.evaluate(() => {
        sessionStorage.setItem('openai_api_key', 'sk-synthetic-device-only');
        sessionStorage.setItem('oauth_access_token', 'synthetic-access-token-device-only');
        sessionStorage.setItem('sync_passphrase', 'synthetic-passphrase-device-only');
      });

      await enableSync(A.page);
      const compacted = await A.page.evaluate(() => window.SutraSync.compactNow());
      expect(compacted.ok).toBe(true);
      const snapshotCursor = server.getSnapshot().cursor;
      server.state.ops = server.state.ops.filter(op => op.seq > snapshotCursor);

      // Fresh IndexedDB/localStorage profile: the vault snapshot is the only
      // source of the canonical workspace.
      const B = await openDevice(browser, server, 'B');
      try {
        await enableSync(B.page);
        await syncNow(B.page);
        const stateB = await readEverythingState(B.page);
        const bootstrapParity = comparePortableWorkspaces(seededA.snapshot, stateB.snapshot);
        expect(bootstrapParity.differences, JSON.stringify(bootstrapParity.differences.slice(0, 25), null, 2)).toEqual([]);
        expect(stateB.localState).toEqual(seededA.localState);
        expect(stateB.attachment).toBe(EVERYTHING_ATTACHMENT);
        expect(stateB.missingAttachment).toBe(false);

        const runtimeMain = stateB.assistantRuntime.conversations
          .find(row => row.id === 'chat-parity-main');
        const runtimeEmpty = stateB.assistantRuntime.conversations
          .find(row => row.id === 'chat-parity-empty');
        expect(runtimeMain.messages.map(message => message.id))
          .toEqual(['msg-parity-user', 'msg-parity-assistant']);
        expect(runtimeMain.messages[1].sources[0].quote).toBe('Unique parity evidence.');
        expect(runtimeMain.messages[1].receipt.schema).toBe('sutra-assistant-receipt/1');
        expect(runtimeMain.messages[1].receipt.status).toBe('completed');
        expect(runtimeMain.messages[1].receipt.deterministicEngines).toEqual(['Sutra Intelligence']);
        expect(runtimeMain.messages[1].receipt.actionsProposed).toEqual(['create_task']);
        expect(runtimeMain.messages[1].memoryUsedIds).toEqual(['memory-parity-1']);
        expect(runtimeEmpty.messages).toEqual([]);
        expect(stateB.assistantRuntime.currentChatId).toBe('chat-parity-main');
        expect(await B.page.evaluate(() => ({
          apiKey: sessionStorage.getItem('openai_api_key'),
          oauthToken: sessionStorage.getItem('oauth_access_token'),
          syncPassphrase: sessionStorage.getItem('sync_passphrase')
        }))).toEqual({ apiKey: null, oauthToken: null, syncPassphrase: null });

        // Inspect the mock's actual stored operation/snapshot/asset bodies:
        // bounded routing metadata is visible, all user content and assets are
        // ciphertext.
        const serverText = JSON.stringify(server.state);
        for (const plaintext of [
          'Parity planning conversation',
          'Unique parity evidence.',
          'Complete synthetic parity audit',
          'Synthetic Course Hub',
          'Unique slide evidence.',
          'Slide note sentinel.',
          'synthetic-notes.txt',
          'U3ludGhldGljIFN1dHJhIHBhcml0eSBhdHRhY2htZW50Lg==',
          'sk-synthetic-device-only',
          'synthetic-access-token-device-only',
          'synthetic-passphrase-device-only',
          PASSPHRASE
        ]) {
          expect(serverText, 'server leaked: ' + plaintext).not.toContain(plaintext);
        }

        // Reverse direction: change representative data across every major
        // category, empty formerly non-empty values, remove a durable thread,
        // append an Assistant message, and replace attachment bytes.
        const reverseInput = createReverseDirectionWorkspace(stateB.snapshot);
        reverseInput.focusSessions = [];
        reverseInput.pages = [reverseInput.pages[1], reverseInput.pages[0]];
        reverseInput.assistantChatHistory.conversations[0].messages.push({
          id: 'msg-reverse', role: 'user',
          content: 'Reverse-direction Assistant sentinel.',
          createdAt: '2026-07-16T15:00:00.000Z'
        });
        reverseInput.assistantChatHistory.conversations =
          reverseInput.assistantChatHistory.conversations
            .filter(row => row.id !== 'chat-parity-empty');
        const reverseLocalState = {
          ...stateB.localState,
          'sutra:activityLog:v1': JSON.stringify([
            { id: 'activity-reverse', type: 'assistant-action', at: '2026-07-16T15:00:00.000Z' }
          ]),
          'sutra:assistantMemory:v1': JSON.stringify({
            version: 1,
            items: [{ id: 'memory-reverse', text: 'Reverse synthetic memory.', enabled: true }]
          })
        };
        const opsBeforeReverse = server.state.ops.length;
        await B.page.evaluate(async ({ workspace, localState, replacement }) => {
          const hooks = window.__sutraPublicBetaTestHooks;
          const full = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
          const files = (workspace.courseWorkspace.files || []).map(file =>
            file.id === 'file-parity'
              ? { ...file, _exportBlob: replacement, dataUrl: replacement }
              : file);
          window.deserializeWorkspace({
            ...workspace,
            courseWorkspace: { ...workspace.courseWorkspace, files }
          });
          hooks.syncParity.setAssistantChatHistory(workspace.assistantChatHistory);
          hooks.syncParity.setPortableLocalState(localState);
          await hooks.seedCourseAttachmentBlob('blob-parity', replacement);
          await window.saveWorkspaceLocally();
        }, { workspace: reverseInput, localState: reverseLocalState, replacement: REPLACEMENT_ATTACHMENT });

        await expect.poll(async () => {
          // The confirmed save can start its automatic debounced cycle before
          // this explicit call. Observe the encrypted server op rather than
          // requiring the explicit call itself to report the push.
          const pushB = await syncNow(B.page);
          expect(pushB.error).toBeNull();
          return server.state.ops.length;
        }, { timeout: 20000 }).toBeGreaterThan(opsBeforeReverse);
        await syncNow(A.page);
        await syncNow(B.page);
        const expectedB = await readEverythingState(B.page);
        const reverseA = await readEverythingState(A.page);
        const reverseParity = comparePortableWorkspaces(expectedB.snapshot, reverseA.snapshot);
        expect(reverseParity.differences, JSON.stringify(reverseParity.differences.slice(0, 25), null, 2)).toEqual([]);
        expect(reverseA.localState).toEqual(reverseLocalState);
        expect(reverseA.attachment).toBe(REPLACEMENT_ATTACHMENT);
        expect(reverseA.assistantRuntime.conversations.some(row => row.id === 'chat-parity-empty')).toBe(false);
        expect(reverseA.assistantRuntime.conversations
          .find(row => row.id === 'chat-parity-main').messages.at(-1).content)
          .toBe('Reverse-direction Assistant sentinel.');

        // Both durable working copies survive reload while the vault is locked.
        await Promise.all([A.page.reload(), B.page.reload()]);
        await Promise.all([
          A.page.waitForSelector('#fileInput', { state: 'attached' }),
          B.page.waitForSelector('#fileInput', { state: 'attached' })
        ]);
        await Promise.all([
          waitForCanonicalHydration(A.page),
          waitForCanonicalHydration(B.page)
        ]);
        const [reloadedA, reloadedB] = await Promise.all([
          readEverythingState(A.page),
          readEverythingState(B.page)
        ]);
        const reloadParity = comparePortableWorkspaces(reloadedB.snapshot, reloadedA.snapshot);
        expect(reloadParity.differences, JSON.stringify(reloadParity.differences.slice(0, 25), null, 2)).toEqual([]);
        expect(reloadedA.attachment).toBe(REPLACEMENT_ATTACHMENT);
        expect(reloadedB.attachment).toBe(REPLACEMENT_ATTACHMENT);
        expect(reloadedA.assistantRuntime.conversations
          .find(row => row.id === 'chat-parity-main').messages.at(-1).id)
          .toBe('msg-reverse');
        expect(await A.page.evaluate(() => window.SutraSync.status().state)).toBe('locked');
        expect(await B.page.evaluate(() => window.SutraSync.status().state)).toBe('locked');
      } finally {
        await B.context.close();
      }
    } finally {
      await A.context.close();
    }
  });

  test('real Assistant composer history syncs incrementally both ways, survives stale legacy storage, and reloads', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    const B = await openDevice(browser, server, 'B');
    const marker = 'canonical assistant heliotrope 716';
    try {
      await seedBaseline(A.page);
      await seedBaseline(B.page);
      await enableSync(A.page);
      await enableSync(B.page);
      await syncNow(B.page);

      await A.page.evaluate(async (marker) => {
        const note = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace(
          'Assistant sync evidence', `<p>${marker} appears in this synthetic note.</p>`
        );
        window.flowAtelier.loadPage(note.id);
        await window.saveWorkspaceLocally();
      }, marker);
      await A.page.locator('#chatbotBtn').click();
      await A.page.locator('#chatInput').fill(`search my notes for ${marker}`);
      await A.page.locator('#chatSendBtn').click();
      await expect(A.page.locator('#chatbotPanel .assistant-sources')).toContainText('Assistant sync evidence');
      await A.page.evaluate(() => window.saveWorkspaceLocally());

      const created = await A.page.evaluate(() => window.SutraAssistantConversationController.getCurrent());
      expect(created.messages.length).toBeGreaterThanOrEqual(2);
      expect(created.messages.every(message => !!message.id && !!message.createdAt)).toBe(true);
      expect(created.messages.at(-1).sources.length).toBeGreaterThan(0);
      expect(created.messages.at(-1).receipt.schema).toBe('sutra-assistant-receipt/1');

      await syncNow(A.page);
      await syncNow(B.page);
      await B.page.locator('#chatbotBtn').click();
      await expect(B.page.locator('#chatbotPanel')).toContainText(marker);
      const onB = await B.page.evaluate(() => window.SutraAssistantConversationController.getCurrent());
      expect(onB.messages.map(message => message.id)).toEqual(created.messages.map(message => message.id));
      expect(onB.messages.at(-1).sources).toEqual(created.messages.at(-1).sources);
      expect(onB.messages.at(-1).receipt).toEqual(created.messages.at(-1).receipt);

      await B.page.locator('#chatInput').fill(`search my notes for ${marker}`);
      await B.page.locator('#chatSendBtn').click();
      await expect.poll(
        () => B.page.evaluate((initialLength) => {
          const messages = window.SutraAssistantConversationController.getCurrent().messages;
          const latest = messages.at(-1);
          return messages.length > initialLength && latest && latest.role === 'assistant';
        }, created.messages.length)
      ).toBe(true);
      await B.page.evaluate(() => window.saveWorkspaceLocally());
      await expect.poll(async () => {
        // A confirmed save may already have started the automatic debounced
        // cycle. Retry both peers until that legitimate single-flight cycle
        // settles instead of treating one skipped explicit call as data loss.
        await syncNow(B.page);
        await syncNow(A.page);
        return A.page.evaluate(() =>
          window.SutraAssistantConversationController.getCurrent().messages.length);
      }, { timeout: 20000 }).toBeGreaterThan(created.messages.length);

      // A stale/empty legacy mirror must never become authoritative again.
      await B.page.evaluate(() => {
        localStorage.setItem('sutra:assistantChats:v1', JSON.stringify({ version: 1, currentChatId: '', conversations: [] }));
        localStorage.removeItem('sutra:assistantCurrentChatId:v1');
      });
      await Promise.all([A.page.reload(), B.page.reload()]);
      await Promise.all([
        A.page.waitForSelector('#fileInput', { state: 'attached' }),
        B.page.waitForSelector('#fileInput', { state: 'attached' })
      ]);
      await Promise.all([
        waitForCanonicalHydration(A.page),
        waitForCanonicalHydration(B.page)
      ]);
      const [reloadA, reloadB] = await Promise.all([
        A.page.evaluate(() => window.SutraAssistantConversationController.getCurrent()),
        B.page.evaluate(() => window.SutraAssistantConversationController.getCurrent())
      ]);
      expect(reloadB.messages.map(message => message.id)).toEqual(reloadA.messages.map(message => message.id));
      expect(reloadB.messages.some(message => message.content.includes(marker))).toBe(true);
      expect(JSON.stringify(server.state)).not.toContain(marker);
    } finally {
      await Promise.allSettled([A.context.close(), B.context.close()]);
    }
  });

  test('revoke and wipe blocks immediately, waits while offline, clears all tabs and stores, and survives reload', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer({ userId: 'mock-user-1' });
    const A = await openAuthedDevice(browser, server, 'A');
    const B = await openAuthedDevice(browser, server, 'B');
    const marker = 'revoked-device-private-marker-716';
    try {
      await seedBaseline(A.page);
      await seedBaseline(B.page);
      await enableSync(A.page);
      const aDeviceId = Object.keys(server.state.devices)[0];
      await enableSync(B.page);
      const bDeviceId = Object.keys(server.state.devices).find(id => id !== aDeviceId);
      expect(bDeviceId).toBeTruthy();

      await B.page.evaluate(async ({ marker }) => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        window.deserializeWorkspace({
          ...base,
          pages: [...base.pages, { id: 'revoke-note', title: marker, content: `<p>${marker}</p><p>queued while offline</p>`, blocks: [], createdAt: now, updatedAt: now }]
        });
        window.SutraAssistantConversationController.create({
          id: 'revoke-chat', title: marker,
          messages: [{ id: 'revoke-message', role: 'user', content: marker, createdAt: now }]
        });
        await window.__sutraPublicBetaTestHooks.seedCourseAttachmentBlob('revoke-blob', 'data:text/plain;base64,cmV2b2tlZA==');
        await window.saveWorkspaceLocally();
      }, { marker });

      const secondTab = await B.context.newPage();
      await secondTab.goto('/Sutra.html');
      await secondTab.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(secondTab);
      expect(await secondTab.evaluate(marker => JSON.stringify(window.serializeWorkspace({ mode: 'json' })).includes(marker), marker)).toBe(true);
      await secondTab.evaluate(async (passphrase) => {
        await window.SutraCloudSync.switchProvider('supabase');
        await window.SutraCloudSync.verifyCode('student@example.com', '123456');
        await window.SutraSync.unlock(passphrase);
      }, PASSPHRASE);

      B.net.down = true;
      const revoked = await A.page.evaluate(async (target) => window.SutraSync.revokeDevice(target), bDeviceId);
      expect(revoked).toBe(true);
      expect(server.state.devices[bDeviceId].wipeRequired).toBe(true);
      expect(server.pull({ deviceId: bDeviceId, cursor: 0 }).code).toBe('revoked');

      await syncNow(secondTab);
      await expect(secondTab.locator('#sutraRevokedDeviceScreen')).toHaveCount(0);
      expect(await B.page.evaluate(marker => JSON.stringify(window.serializeWorkspace({ mode: 'json' })).includes(marker), marker)).toBe(true);
      await expect.poll(async () => {
        // The primary tab may currently own the single-flight lease. Drive
        // both tabs so one performs the blocked request and relays `offline`
        // instead of repeatedly observing a legitimate `idle` skip.
        await B.page.evaluate(() => window.SutraSync.syncNow()).catch(() => null);
        await secondTab.evaluate(() => window.SutraSync.syncNow()).catch(() => null);
        const states = await Promise.all([
          B.page.evaluate(() => window.SutraSync.status().state),
          secondTab.evaluate(() => window.SutraSync.status().state)
        ]);
        return states.includes('offline');
      }, { timeout: 15000 }).toBe(true);
      B.net.down = false;
      await secondTab.evaluate(() => window.SutraSync.resume());
      await expect.poll(async () => {
        if (await secondTab.locator('#sutraRevokedDeviceScreen').count()) return true;
        await secondTab.evaluate(() => window.SutraSync.syncNow()).catch(() => null);
        return (await secondTab.locator('#sutraRevokedDeviceScreen').count()) > 0;
      }, { timeout: 20000 }).toBe(true);

      await expect(B.page.locator('#sutraRevokedDeviceScreen')).toBeVisible({ timeout: 15000 });
      await expect(secondTab.locator('#sutraRevokedDeviceScreen')).toBeVisible({ timeout: 15000 });
      await expect(B.page.locator('#sutraRevokedDeviceMessage')).toContainText('removed');
      expect(server.state.devices[bDeviceId].wipeAcknowledgedAt).toBeTruthy();

      const audit = await B.page.evaluate(async () => ({
        localKeys: Object.keys(localStorage),
        sessionKeys: Object.keys(sessionStorage),
        databases: typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).map(row => row.name)
          : []
      }));
      expect(audit.localKeys).toEqual(['sutra:revocationWipeGuard:v1']);
      expect(audit.sessionKeys).toEqual([]);
      for (const name of ['noteflow_atelier_db', 'noteflow_attachments_db', 'sutra_sync_db', 'sutra-drive-sync-keys', 'sutra-fs-config', 'sutra_share_target_db']) {
        expect(audit.databases).not.toContain(name);
      }

      await Promise.all([B.page.reload(), secondTab.reload()]);
      await Promise.all([
        B.page.waitForSelector('#sutraRevokedDeviceScreen'),
        secondTab.waitForSelector('#sutraRevokedDeviceScreen')
      ]);
      await expect(B.page.locator('#sutraRevokedDeviceScreen')).not.toContainText(marker);
      await expect(secondTab.locator('#sutraRevokedDeviceScreen')).not.toContainText(marker);
      await secondTab.close();
    } finally {
      await Promise.allSettled([A.context.close(), B.context.close()]);
    }
  });

  test('changing backup destination preserves the enabled incremental Sync account', async ({ browser }) => {
    const server = createSyncMockServer({ userId: 'mock-user-1' });
    const device = await openAuthedDevice(browser, server, 'separate-backup-provider');
    try {
      await seedBaseline(device.page);
      await enableSync(device.page);
      await device.page.evaluate(() => window.SutraCloudSync.switchProvider('manual'));
      expect(await device.page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(true);
      expect(await device.page.evaluate(() => window.SutraSync.status().state)).toBe('idle');
      expect(await device.page.evaluate(() => window.SutraCloud.getStatus().backups.provider)).toBe('manual');
      await editPage(device.page, 'page-shared', '<p>sync remains independent of backup destination</p>');
      const result = await device.page.evaluate(() => window.SutraCloud.syncNow());
      expect(result.error).toBeFalsy();
      // The save can start the automatic cycle before this explicit request;
      // syncNow then returns skipped while that existing cycle completes.
      await expect.poll(() => device.page.evaluate(() => window.SutraSync.status().state), { timeout: 15000 }).toBe('idle');
    } finally {
      await device.context.close();
    }
  });

  test('ordinary cloud sign-out pauses sync but keeps the complete local workspace', async ({ browser }) => {
    const server = createSyncMockServer({ userId: 'mock-user-1' });
    const device = await openAuthedDevice(browser, server, 'signed-out-device');
    const marker = 'sign-out-keeps-local-workspace-716';
    try {
      await seedBaseline(device.page);
      await enableSync(device.page);
      await device.page.evaluate(async (marker) => {
        const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const now = new Date().toISOString();
        window.deserializeWorkspace({
          ...base,
          pages: [...base.pages, { id: 'signout-note', title: marker, content: `<p>${marker}</p>`, blocks: [], createdAt: now, updatedAt: now }]
        });
        await window.saveWorkspaceLocally();
        await window.SutraCloudSync.signOut();
      }, marker);
      expect(await device.page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(false);
      expect(await device.page.evaluate(() => window.SutraSync.status().state)).toBe('paused');
      expect(await device.page.locator('#sutraRevokedDeviceScreen').count()).toBe(0);
      expect(await device.page.evaluate(marker => JSON.stringify(window.serializeWorkspace({ mode: 'json' })).includes(marker), marker)).toBe(true);
      await device.page.reload();
      await device.page.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(device.page);
      expect(await device.page.evaluate(marker => JSON.stringify(window.serializeWorkspace({ mode: 'json' })).includes(marker), marker)).toBe(true);
      expect(await device.page.locator('#sutraRevokedDeviceScreen').count()).toBe(0);
    } finally {
      await device.context.close();
    }
  });

  test('sync disabled: startup + edits + saves make zero requests to the sync endpoint', async ({ browser }) => {
    const server = createSyncMockServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let syncRequests = 0;
    context.on('request', (request) => {
      if (request.url().startsWith(SYNC_MOCK_ORIGIN)) syncRequests += 1;
    });
    await routeSyncServer(context, server);
    const page = await context.newPage();
    try {
      await page.goto('/Sutra.html');
      await page.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(page);
      await completeOnboarding(page);
      await seedBaseline(page);
      await editPage(page, 'page-shared', '<p>local-only edit</p>');
      const status = await page.evaluate(() => window.SutraSync.status());
      expect(status.state).toBe('disabled');
      expect(syncRequests).toBe(0);
      expect(server.stats.pullCalls + server.stats.pushCalls).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('two tabs of one device: single-flight cycles, no duplicate ops, status relays across tabs', async ({ browser }) => {
    test.setTimeout(360_000);
    const server = createSyncMockServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const net = { down: false };
    await routeSyncServer(context, server, net);
    const tab1 = await context.newPage();
    try {
      await tab1.goto('/Sutra.html');
      await tab1.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(tab1);
      await completeOnboarding(tab1);
      await seedBaseline(tab1);
      await enableSync(tab1);
      const opsAfterEnable = server.state.ops.length;

      // Second tab of the SAME browser profile (same IndexedDB).
      const tab2 = await context.newPage();
      await tab2.goto('/Sutra.html');
      await tab2.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(tab2);
      await completeOnboarding(tab2);

      // Tab 2 sees sync enabled (workspace preference) but locked; unlocking
      // reuses the vault key already wrapped in the shared sync DB.
      const initialState = await tab2.evaluate(() => window.SutraSync.status());
      expect(initialState.enabled).toBe(true);
      expect(initialState.state).toBe('locked');
      const unlocked = await tab2.evaluate(async (passphrase) => (await window.SutraSync.unlock(passphrase)).status.state, PASSPHRASE);
      expect(unlocked).toBe('idle');

      // Status relay: a sync in tab 2 must surface a status event in tab 1.
      const statusRelayed = tab1.evaluate(() => new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 8000);
        const onStatus = (event) => {
          // Tab 1 also emits its own local status events during the racing
          // syncNow below. Keep listening until the first event explicitly
          // relayed by BroadcastChannel instead of consuming the listener on
          // an unrelated local event.
          if (!event.detail || !event.detail.fromTab) return;
          window.removeEventListener('sutra:sync-status', onStatus);
          clearTimeout(timer);
          resolve(true);
        };
        window.addEventListener('sutra:sync-status', onStatus);
      }));

      // Simultaneous cycles from both tabs: the cycle Web Lock single-flights
      // them; whichever skips simply runs on the next call. No duplicates.
      const [r1, r2] = await Promise.all([syncNow(tab1), syncNow(tab2)]);
      expect([r1, r2].some(r => r.error), 'no cycle may fail').toBe(false);
      await syncNow(tab1);
      await syncNow(tab2);
      expect(await statusRelayed, 'status must relay across tabs').toBe(true);

      // Op ids stay unique across racing tabs (server-side dedupe key).
      const opIds = server.state.ops.map(o => o.envelope.meta.opId);
      expect(new Set(opIds).size).toBe(opIds.length, 'op ids must be unique');

      // The stale-tab gate ends any cross-tab ping-pong: after the tabs'
      // states cross once, the tab that saved LAST keeps syncing and reaches
      // quiescence, while the stale one skips instead of re-pushing old state.
      let sawQuiescence = false;
      for (let round = 0; round < 6; round += 1) {
        const r1 = await syncNow(tab1);
        const r2 = await syncNow(tab2);
        const pushes = (r1.pushed || 0) + (r2.pushed || 0);
        if (pushes === 0) { sawQuiescence = true; break; }
      }
      expect(sawQuiescence, 'two tabs must reach quiescence, never ping-pong').toBe(true);

      // Either racing tab may have written the last canonical root. Reload tab
      // 2 from that root before choosing it as the next writer; otherwise the
      // persistence conflict guard correctly rejects a stale local overwrite
      // before this test reaches the Sync stale-tab assertion.
      await tab2.reload();
      await tab2.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(tab2);
      await completeOnboarding(tab2);
      const reunlocked = await tab2.evaluate(async (passphrase) => (await window.SutraSync.unlock(passphrase)).status.state, PASSPHRASE);
      expect(reunlocked).toBe('idle');

      // The fresh edit in tab 2 now deterministically makes tab 1 STALE: its
      // sync must skip instead of pushing outdated records back to the server.
      await editPage(tab2, 'page-shared', '<p>typed in tab two</p>');
      const pushTab2 = await syncNow(tab2);
      expect(pushTab2.error).toBeNull();
      const staleSkip = await tab1.evaluate(() => window.SutraSync.syncNow());
      expect(staleSkip.skipped === true || (staleSkip.pushed || 0) === 0, 'stale tab must not push').toBe(true);

      // Per the app's multi-tab contract the stale tab gets closed (its
      // lifecycle flush writing stale state is pre-existing LWW behavior —
      // which is exactly why the sync gate refuses to PUSH that state).
      await tab1.close();
      await editPage(tab2, 'page-shared', '<p>tab two after closing the stale tab</p>');
      await syncNow(tab2);

      // A fresh tab sees the surviving state and resumes syncing cleanly.
      const tab3 = await context.newPage();
      await tab3.goto('/Sutra.html');
      await tab3.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(tab3);
      await expect.poll(async () => {
        const page = (await readPages(tab3)).find(p => p.id === 'page-shared');
        return page?.content || '';
      }, { timeout: 20_000 }).toContain('tab two after closing the stale tab');
      const resumed = await tab3.evaluate(async (passphrase) => (await window.SutraSync.unlock(passphrase)).status.state, PASSPHRASE);
      expect(resumed).toBe('idle');
      await tab3.close();
      await tab2.close();
    } finally {
      await context.close();
    }
  });

  test('full UI flow on a configured Supabase backend: sign in, enable, authed sync, status card', async ({ browser }) => {
    const server = createSyncMockServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const net = { down: false };
    await routeSyncServer(context, server, net);
    const page = await context.newPage();
    try {
      // Configure the app as if this mock WERE the deployed Supabase project.
      await page.addInitScript(({ url }) => { window.SUTRA_CONFIG = { supabaseUrl: url, supabaseAnonKey: 'mock-anon-key' }; }, { url: SYNC_MOCK_ORIGIN });
      await page.goto('/Sutra.html');
      await page.waitForSelector('#fileInput', { state: 'attached' });
      await waitForCanonicalHydration(page);
      await completeOnboarding(page);
      await seedBaseline(page);

      // Sign in with the same email-OTP session cloud backups use.
      await page.evaluate(async () => {
        await window.SutraCloudSync.switchProvider('supabase');
        await window.SutraCloudSync.verifyCode('student@example.com', '123456');
      });

      // Enable through the ACTUAL panel.
      await page.evaluate(() => window.openSutraSyncModal());
      await expect(page.locator('#sutraCloudModal')).toHaveClass(/active/);
      await expect(page.locator('#sutraSyncSetup')).toBeVisible();
      await expect(page.locator('#sutraSyncStatusCard')).toContainText('Sync is off');
      await page.fill('#sutraSyncPassphraseInput', PASSPHRASE);
      await page.fill('#sutraSyncPassphraseConfirmInput', PASSPHRASE);
      await page.locator('#sutraSyncEnableBtn').click();

      await expect(page.locator('#sutraSyncRunning')).toBeVisible({ timeout: 20000 });
      await expect.poll(
        () => page.evaluate(() => window.SutraSync.status()),
        { timeout: 20000 }
      ).toMatchObject({ state: 'idle', lastError: null, lastSyncAt: expect.any(Number) });
      const enabledStatus = await page.evaluate(() => window.SutraSync.status());
      expect(enabledStatus.lastError).toBeNull();
      expect(enabledStatus.state).toBe('idle');
      expect(enabledStatus.lastSyncAt, JSON.stringify(enabledStatus)).toEqual(expect.any(Number));
      await expect.poll(() => server.state.ops.length, {
        timeout: 10000,
        message: JSON.stringify(enabledStatus)
      }).toBeGreaterThan(0);
      await expect(page.locator('#sutraSyncStatusCard')).toContainText('Synced');

      const portableText = await page.evaluate(() => JSON.stringify(
        window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false })
      ));
      expect(portableText).not.toContain(SYNC_MOCK_ORIGIN);
      expect(portableText).not.toContain('mock-anon-key');

      // Every RPC carried the anon key + user bearer token.
      expect(net.seenAuthHeaders.length).toBeGreaterThan(0);
      for (const seen of net.seenAuthHeaders) {
        expect(seen.apikey).toBe('mock-anon-key');
        expect(String(seen.authorization)).toMatch(/^Bearer mock-access-token/);
      }

      // Sync now via the panel button works.
      await page.locator('#sutraSyncNowBtn').click();
      await expect(page.locator('#sutraSyncStatusCard')).toContainText('Synced');

      // Escape closes the panel (modal contract).
      await page.keyboard.press('Escape');
      await expect(page.locator('#sutraCloudModal')).not.toHaveClass(/active/);
    } finally {
      await context.close();
    }
  });

  test('wrong vault passphrase unlocks nothing and mutates nothing', async ({ browser }) => {
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A');
    try {
      await seedBaseline(A.page);
      await enableSync(A.page);
      // Simulate a fresh session: lock the vault, then try a bad passphrase.
      const result = await A.page.evaluate(async () => {
        window.SutraSync.lock();
        const before = JSON.stringify(window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages);
        let error = null;
        try { await window.SutraSync.unlock('completely wrong passphrase'); } catch (e) { error = e && e.name ? e.name : String(e); }
        const after = JSON.stringify(window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages);
        return { error, unchanged: before === after, state: window.SutraSync.status().state };
      });
      expect(result.error).toBe('SyncVaultUnlockError');
      expect(result.unchanged).toBe(true);
      expect(result.state).toBe('locked');

      // The right passphrase still works afterwards.
      const unlocked = await A.page.evaluate(async (passphrase) => {
        const outcome = await window.SutraSync.unlock(passphrase);
        return outcome.status.state;
      }, PASSPHRASE);
      expect(unlocked).toBe('idle');
    } finally {
      await A.context.close();
    }
  });

  test('cloud decrypt failure never reports Sync as successfully unlocked', async ({ browser }) => {
    const server = createSyncMockServer();
    const A = await openDevice(browser, server, 'A-integrity-source');
    const B = await openDevice(browser, server, 'B-integrity-check');
    try {
      await seedBaseline(A.page);
      await enableSync(A.page);
      expect(server.state.ops.length).toBeGreaterThan(0);

      const envelope = server.state.ops[0].envelope;
      envelope.ct = envelope.ct.slice(0, -4) + (envelope.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');

      const enableResult = await B.page.evaluate(async ({ endpoint, passphrase }) => {
        const result = await window.SutraSync.enable({ endpoint, passphrase });
        return { state: result.status.state, error: result.outcome?.error?.code || '' };
      }, { endpoint: SYNC_MOCK_ORIGIN, passphrase: PASSPHRASE });
      expect(enableResult.state).toBe('encryption-error');
      expect(enableResult.error).toBe('encryption-error');
      // Exercise the exact post-unlock success-toast seam used by the UI.
      await B.page.evaluate(() => window.showToast('Sync unlocked.'));

      const result = await B.page.evaluate(() => ({
        state: window.SutraSync.status().state,
        setupError: document.getElementById('sutraSyncSetupError')?.textContent || '',
        runningError: document.getElementById('sutraSyncRunningError')?.textContent || '',
        recoveryGuidance: document.getElementById('sutraSyncRecoveryGuidance')?.textContent || '',
        toast: document.getElementById('toastMessage')?.textContent || ''
      }));
      expect(result.state).toBe('encryption-error');
      expect(result.setupError + result.runningError).toMatch(/encrypted cloud data could not be verified/i);
      expect(result.recoveryGuidance).toMatch(/Do not create a new vault key/i);
      expect(result.toast).not.toMatch(/Sutra Sync is on|Sync unlocked/i);
    } finally {
      await Promise.allSettled([A.context.close(), B.context.close()]);
    }
  });
});
