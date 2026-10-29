import { expect, test } from '@playwright/test';
import { waitForAppHydrated } from './helpers/app-ready.mjs';

const PIN = '2468';

for (const leaveImmediately of [false, true]) {
  test(`locked note user edits survive automatic saving and reload (immediate navigation: ${leaveImmediately})`, async ({ page }) => {
    await openApp(page);
    const id = 'locked-note-autosave-reload';
    const otherId = 'locked-note-autosave-other';
    const text = 'Pasted private text must survive without a manual save.';
    await page.evaluate(async ({ id, otherId }) => {
      const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      payload.pages.push(
        { id, title: 'Private autosave note', content: '<p>Original text</p>', blocks: [] },
        { id: otherId, title: 'Other autosave note', content: '<p>Other note</p>', blocks: [] }
      );
      await window.deserializeWorkspace(payload);
      await window.__sutraPublicBetaTestHooks.lockPageWithPin(id, '2468');
      window.loadPage(id);
    }, { id, otherId });
    await page.locator('#lockScreenPinInput').fill(PIN);
    await page.locator('#lockScreenForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('#lockedPageScreen')).toBeHidden();
    const editor = page.locator('#editorV2Host .ProseMirror');
    await expect(editor).toBeVisible();
    await editor.evaluate((target, { text, leaveImmediately, otherId }) => {
      target.focus();
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', text);
      clipboard.setData('text/html', `<p>${text}</p>`);
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: clipboard });
      target.dispatchEvent(paste);
      // Navigate in the same task, before either editor debounce can fire.
      if (leaveImmediately) window.loadPage(otherId);
    }, { text, leaveImmediately, otherId });
    // Poll IndexedDB directly: invoking a serializer or explicit flush here
    // could hide a broken automatic-save path.
    await expect.poll(() => page.evaluate(async id => {
      const workspace = await window.loadWorkspaceLocally();
      return workspace?.pages?.find(note => note.id === id)?.content || '';
    }, id)).toContain(text);
    if (!leaveImmediately) await page.evaluate(id => window.loadPage(id), otherId);
    await page.reload();
    await waitForAppHydrated(page);
    await page.waitForFunction(id => window.flowAtelier.pages.some(note => note.id === id), id);
    await page.locator('.top-nav .view-tabs > [data-view="notes"]').click();
    await page.locator(`.page-item[data-page-id="${id}"] .page-title-text`).click();
    await expect(page.locator('#lockedPageScreen')).toBeVisible();
    await page.locator('#lockScreenPinInput').fill(PIN);
    await page.locator('#lockScreenForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('#lockedPageScreen')).toBeHidden();
    await expect(editor).toContainText(text);
  });
}

async function openApp(page, { persistReady = true } = {}) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.__sutraPublicBetaTestHooks);
  await waitForAppHydrated(page);
  if (!persistReady) return;
  // Production keeps the startup overlay above the app until canonical
  // hydration is ready. Establish that baseline before touching onboarding.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-app-ready'));
  const completedOnboarding = await page.evaluate(() => {
    const overlay = document.getElementById('studentOnboardingOverlay');
    const visible = !!overlay && !overlay.hidden && getComputedStyle(overlay).display !== 'none';
    if (visible) {
      try { window.markStudentOnboardingCompleted?.(true); } catch (error) {}
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
    return visible;
  });
  if (completedOnboarding) {
    await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-onboarding-ready'));
  }
  // Some startup bridges intentionally request the ordinary 250 ms autosave.
  // Let that debounce become visible, then drain it before this test treats the
  // tab's canonical hash as a deliberate cross-tab baseline.
  await page.waitForTimeout(350);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-startup-settled'));
}

test('edits made in a locked note survive navigation auto-lock', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async ({ pin }) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const lockedId = 'locked-note-persistence-qa';
    const otherId = 'other-note-persistence-qa';
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    payload.pages = [
      ...payload.pages,
      { id: lockedId, title: 'Locked persistence QA', content: '<p>before</p>', blocks: [] },
      { id: otherId, title: 'Other persistence QA', content: '<p>other</p>', blocks: [] }
    ];
    window.deserializeWorkspace(payload);
    await hooks.lockPageWithPin(lockedId, pin);
    window.loadPage(lockedId);

    const input = document.getElementById('lockScreenPinInput');
    input.value = pin;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('lockScreenForm').requestSubmit();
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const waitForUnlock = () => {
        if (document.getElementById('lockedPageScreen')?.hidden) return resolve();
        if (Date.now() - startedAt > 5000) return reject(new Error('Timed out waiting for note unlock.'));
        setTimeout(waitForUnlock, 25);
      };
      waitForUnlock();
    });

    if (window.SutraNotesEditorV2?.isMounted()) {
      window.SutraNotesEditorV2.setContent('<p>edited immediately before leaving</p>');
    } else {
      const editor = document.getElementById('editor');
      editor.innerHTML = '<p>edited immediately before leaving</p>';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
    }

    // The default lock policy is "When leaving page". This used to revoke the
    // session marker before savePage(), causing the privacy guard to skip the
    // editor snapshot entirely.
    window.loadPage(otherId);
    const livePage = window.flowAtelier.pages.find(entry => entry.id === lockedId);
    const serialized = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const storedPage = serialized.pages.find(entry => entry.id === lockedId);
    await window.flowAtelier.flushAppSaveNow('locked-note-persistence-test');
    const durableWorkspace = await window.loadWorkspaceLocally();
    const durablePage = durableWorkspace?.pages?.find(entry => entry.id === lockedId);
    return {
      liveContent: livePage?.content || '',
      serializedContent: storedPage?.content || '',
      durableContent: durablePage?.content || '',
      lockState: hooks.getPageLockState(lockedId)
    };
  }, { pin: PIN });

  expect(result.liveContent).toContain('edited immediately before leaving');
  expect(result.serializedContent).toContain('edited immediately before leaving');
  expect(result.durableContent).toContain('edited immediately before leaving');
  expect(result.lockState).toMatchObject({ isLocked: true, sessionUnlocked: false });
});

test('lifecycle recovery never copies unlocked PIN-note plaintext into session storage', async ({ page }) => {
  await openApp(page);

  const journal = await page.evaluate(async ({ pin }) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const lockedId = 'locked-note-journal-privacy-qa';
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    payload.pages = [
      ...payload.pages,
      { id: lockedId, title: 'Locked journal privacy QA', content: '<p>before</p>', blocks: [] }
    ];
    window.deserializeWorkspace(payload);
    await hooks.lockPageWithPin(lockedId, pin);
    window.loadPage(lockedId);

    const input = document.getElementById('lockScreenPinInput');
    input.value = pin;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('lockScreenForm').requestSubmit();
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const waitForUnlock = () => {
        if (document.getElementById('lockedPageScreen')?.hidden) return resolve();
        if (Date.now() - startedAt > 5000) return reject(new Error('Timed out waiting for note unlock.'));
        setTimeout(waitForUnlock, 25);
      };
      waitForUnlock();
    });

    const sentinel = 'PIN note plaintext must never enter the lifecycle journal.';
    const editor = document.getElementById('editor');
    editor.innerHTML = `<p>${sentinel}</p>`;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
    window.dispatchEvent(new Event('pagehide'));
    await new Promise(resolve => setTimeout(resolve, 0));
    return sessionStorage.getItem('sutra:lifecycle-note-journal:v1');
  }, { pin: PIN });

  expect(journal).toBeNull();
});

test('a committed save remains the local base when only its verification read fails', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const note = hooks.createNoteInActiveSpace('Readback recovery baseline', '<p>durable</p>');
    await window.flowAtelier.flushAppSaveNow('readback-recovery-baseline');

    const originalTransaction = IDBDatabase.prototype.transaction;
    let rootWriteStarted = false;
    IDBDatabase.prototype.transaction = function (...args) {
      const mode = String(args[1] || 'readonly');
      if (mode === 'readwrite') rootWriteStarted = true;
      if (rootWriteStarted && mode === 'readonly') {
        rootWriteStarted = false;
        throw new DOMException('Injected verification read failure', 'UnknownError');
      }
      return originalTransaction.apply(this, args);
    };

    hooks.renamePage(note.id, 'Committed despite verification failure');
    let firstError = null;
    try {
      await window.flowAtelier.flushAppSaveNow('readback-recovery-injected-failure');
    } catch (error) {
      firstError = { name: error?.name || '', message: error?.message || String(error) };
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }

    let retryError = null;
    try {
      await window.flowAtelier.flushAppSaveNow('retry');
    } catch (error) {
      retryError = { name: error?.name || '', message: error?.message || String(error) };
    }
    const durable = await window.loadWorkspaceLocally();
    return {
      firstError,
      retryError,
      durableTitle: durable?.pages?.find(entry => entry.id === note.id)?.title || '',
      failureBannerHidden: document.getElementById('sutraSaveFailureBanner')?.hidden === true
    };
  });

  expect(result.firstError).toMatchObject({ name: 'UnknownError' });
  expect(result.retryError).toBeNull();
  expect(result.durableTitle).toBe('Committed despite verification failure');
  expect(result.failureBannerHidden).toBe(true);
});

test('a visibility-change save recreates a missing canonical root from its confirmed checkpoint', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const note = hooks.createNoteInActiveSpace('Missing root recovery baseline', '<p>safe baseline</p>');
    await window.flowAtelier.flushAppSaveNow('missing-root-recovery-baseline');

    const checkpointBefore = JSON.parse(localStorage.getItem('sutra:persistenceHealth:v1') || '{}')
      .lastConfirmedWorkspaceHash || null;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_atelier_db', 8);
      request.onerror = () => reject(request.error || new Error('Could not open workspace DB'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').delete('root');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error || new Error('Could not delete root'));
        tx.onabort = () => reject(tx.error || new Error('Root deletion aborted'));
      };
    });

    hooks.renamePage(note.id, 'Recovered during visibility change');
    let saveError = null;
    try {
      await window.flowAtelier.flushAppSaveNow('visibilitychange');
    } catch (error) {
      saveError = { name: error?.name || '', message: error?.message || String(error) };
    }
    const durable = await window.loadWorkspaceLocally();
    const health = window.SutraPersistenceHealth.getState();
    return {
      checkpointBefore,
      checkpointAfter: JSON.parse(localStorage.getItem('sutra:persistenceHealth:v1') || '{}')
        .lastConfirmedWorkspaceHash || null,
      saveError,
      durableTitle: durable?.pages?.find(entry => entry.id === note.id)?.title || '',
      failure: health.lastFailure,
      bannerHidden: document.getElementById('sutraSaveFailureBanner')?.hidden === true
    };
  });

  expect(result.checkpointBefore).toMatch(/^[0-9a-f]{8}$/);
  expect(result.checkpointAfter).toMatch(/^[0-9a-f]{8}$/);
  expect(result.saveError).toBeNull();
  expect(result.durableTitle).toBe('Recovered during visibility change');
  expect(result.failure).toBeNull();
  expect(result.bannerHidden).toBe(true);
});

test('a superseded same-tab lifecycle save is declined without raising a conflict', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const note = hooks.createNoteInActiveSpace('Lifecycle predecessor baseline', '<p>safe baseline</p>');
    await window.flowAtelier.flushAppSaveNow('lifecycle-predecessor-baseline');

    // Model the previous document in this SAME browser tab. The replacement
    // document supersedes its session-scoped barrier before the delayed
    // lifecycle transaction reaches the conditional root write.
    hooks.renamePage(note.id, 'Late predecessor must not overwrite');
    const token = hooks.persistenceLifecycle.beginBarrier('pagehide');
    hooks.persistenceLifecycle.clearBarrier(token);
    await hooks.persistenceLifecycle.flushWithBarrier('pagehide', token);
    const afterSuperseded = await window.loadWorkspaceLocally();
    const failureAfterSuperseded = window.SutraPersistenceHealth.getState().lastFailure;

    await window.flowAtelier.flushAppSaveNow('retry');
    const afterRetry = await window.loadWorkspaceLocally();
    return {
      titleAfterSuperseded: afterSuperseded?.pages?.find(entry => entry.id === note.id)?.title || '',
      titleAfterRetry: afterRetry?.pages?.find(entry => entry.id === note.id)?.title || '',
      failureAfterSuperseded,
      bannerHidden: document.getElementById('sutraSaveFailureBanner')?.hidden === true
    };
  });

  expect(result.titleAfterSuperseded).toBe('Lifecycle predecessor baseline');
  expect(result.titleAfterRetry).toBe('Late predecessor must not overwrite');
  expect(result.failureAfterSuperseded).toBeNull();
  expect(result.bannerHidden).toBe(true);
});

test('a real same-tab reload hands off its lifecycle save without a false conflict', async ({ page }) => {
  test.slow(); // This regression intentionally performs two complete app boots.
  await openApp(page);

  const noteId = await page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const note = hooks.createNoteInActiveSpace('Reload lifecycle baseline', '<p>before reload</p>');
    window.loadPage(note.id);
    await window.flowAtelier.flushAppSaveNow('reload-lifecycle-baseline');
    return note.id;
  });

  await page.fill('#pageTitle', 'Saved during same-tab reload');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.flowAtelier && !!window.SutraPersistenceHealth);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('reload-lifecycle-verification'));

  const result = await page.evaluate(async (id) => {
    const durable = await window.loadWorkspaceLocally();
    return {
      title: durable?.pages?.find(entry => entry.id === id)?.title || '',
      failure: window.SutraPersistenceHealth.getState().lastFailure,
      bannerHidden: document.getElementById('sutraSaveFailureBanner')?.hidden === true
    };
  }, noteId);

  expect(result.title).toBe('Saved during same-tab reload');
  expect(result.failure).toBeNull();
  expect(result.bannerHidden).toBe(true);
});

test('an unproven root change is not mislabeled as another open Sutra page', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const changed = await window.loadWorkspaceLocally();
    changed.ui = { ...(changed.ui || {}), storageConflictProvenanceQa: Date.now() };
    const db = window.SutraWorkspaceDB.create({
      indexedDB,
      dbName: 'noteflow_atelier_db',
      storeName: 'workspace',
      version: 8
    });
    await db.write('root', changed);
    db.close();

    let saveError = null;
    try {
      await window.flowAtelier.flushAppSaveNow('unknown-root-change-test');
    } catch (error) {
      saveError = { name: error?.name || '', message: error?.message || String(error) };
    }
    return {
      saveError,
      bannerMessage: document.getElementById('sutraSaveFailureMessage')?.textContent || '',
      conflict: window.SutraPersistenceHealth.getState().lastFailure?.conflict || null
    };
  });

  expect(result.saveError).toMatchObject({ name: 'WorkspaceConflictError' });
  expect(result.saveError.message).toContain('No other open Sutra page was detected');
  expect(result.bannerMessage).toContain('No other open Sutra page was detected');
  expect(result.saveError.message).not.toMatch(/another (tab|open Sutra page)|stale tab/i);
  expect(result.conflict).toMatchObject({ source: 'unverified-storage-change' });
  expect(result.conflict.expectedHash).toMatch(/^[0-9a-f]{8}$/);
  expect(result.conflict.actualHash).toMatch(/^[0-9a-f]{8}$/);
  expect(result.conflict.actualHash).not.toBe(result.conflict.expectedHash);
});

test('a stale second tab cannot overwrite a paste saved in a locked note', async ({ page, context }) => {
  test.slow(); // This regression intentionally performs three full app boots across two pages.
  await openApp(page);

  const ids = await page.evaluate(async ({ pin }) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const lockedId = 'locked-note-cross-tab-qa';
    const otherId = 'other-note-cross-tab-qa';
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    payload.pages = [
      ...payload.pages,
      { id: lockedId, title: 'Locked cross-tab QA', content: '<p>before</p>', blocks: [] },
      { id: otherId, title: 'Other cross-tab QA', content: '<p>other</p>', blocks: [] }
    ];
    payload.ui = payload.ui || {};
    payload.ui.lastOpenedPageId = otherId;
    payload.ui.lastOpenedPageBySpace = { ...(payload.ui.lastOpenedPageBySpace || {}), default: otherId };
    window.deserializeWorkspace(payload);
    await hooks.lockPageWithPin(lockedId, pin);
    window.loadPage(otherId);
    await window.flowAtelier.flushAppSaveNow('locked-note-cross-tab-seed');
    return { lockedId, otherId };
  }, { pin: PIN });

  // Stop the seeding tab before the second tab establishes its baseline. Boot
  // normalization/onboarding saves are valid canonical writes; leaving both
  // tabs active here makes the test race before the intentional stale-write
  // step and does not model the scenario under test.
  await page.goto('/HomePage.html');

  // This tab hydrates the pre-paste workspace and deliberately stays stale.
  const stalePage = await context.newPage();
  await openApp(stalePage, { persistReady: false });
  await stalePage.waitForFunction((lockedId) => {
    return window.flowAtelier?.pages?.find(entry => entry.id === lockedId)?.content === '<p>before</p>';
  }, ids.lockedId);

  // Start the editing tab from that exact confirmed base. The second tab now
  // holds the same base in memory but will not hydrate the later paste.
  await openApp(page, { persistReady: false });
  await page.waitForFunction((lockedId) => {
    return window.flowAtelier?.pages?.find(entry => entry.id === lockedId)?.content === '<p>before</p>';
  }, ids.lockedId);

  await page.evaluate(async ({ lockedId, pin }) => {
    window.loadPage(lockedId);
    const input = document.getElementById('lockScreenPinInput');
    input.value = pin;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('lockScreenForm').requestSubmit();
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const waitForUnlock = () => {
        if (document.getElementById('lockedPageScreen')?.hidden) return resolve();
        if (Date.now() - startedAt > 5000) return reject(new Error('Timed out waiting for note unlock.'));
        setTimeout(waitForUnlock, 25);
      };
      waitForUnlock();
    });

    const data = new DataTransfer();
    data.setData('text/html', '<p>paste that must remain durable</p>');
    data.setData('text/plain', 'paste that must remain durable');
    const target = window.SutraNotesEditorV2?.isMounted()
      ? document.querySelector('#editorV2Host .ProseMirror')
      : document.getElementById('editor');
    target.focus();
    const paste = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true
    });
    // Firefox discards constructor-provided synthetic clipboard contents.
    Object.defineProperty(paste, 'clipboardData', { value: data });
    target.dispatchEvent(paste);
    await new Promise(resolve => setTimeout(resolve, 1300));
    await window.flowAtelier.flushAppSaveNow('locked-note-cross-tab-paste');
  }, { lockedId: ids.lockedId, pin: PIN });

  const afterPaste = await page.evaluate(async (lockedId) => {
    const durable = await window.loadWorkspaceLocally();
    return durable.pages.find(entry => entry.id === lockedId)?.content || '';
  }, ids.lockedId);
  expect(afterPaste).toContain('paste that must remain durable');

  // This is the same full-workspace write the stale tab's ordinary autosave
  // performs. It must fail closed instead of replacing the newer workspace.
  const staleSave = await stalePage.evaluate(async () => {
    window.savePage();
    try {
      await window.flowAtelier.flushAppSaveNow('stale-tab-autosave-test');
      return {
        ok: true,
        hasConditionalWrite: typeof window.SutraWorkspaceDB?.create({ indexedDB }).writeIf === 'function'
      };
    } catch (error) {
      return {
        ok: false,
        name: error?.name || '',
        message: error?.message || String(error),
        hasConditionalWrite: typeof window.SutraWorkspaceDB?.create({ indexedDB }).writeIf === 'function'
      };
    }
  });
  expect(staleSave).toMatchObject({ ok: false, name: 'WorkspaceConflictError', hasConditionalWrite: true });
  await expect(stalePage.locator('#sutraSaveFailureBanner')).toBeVisible();
  await expect(stalePage.locator('#sutraSaveFailureMessage')).toContainText(/newer workspace|prevented from overwriting/i);

  const afterStaleSave = await page.evaluate(async (lockedId) => {
    const durable = await window.loadWorkspaceLocally();
    return durable.pages.find(entry => entry.id === lockedId)?.content || '';
  }, ids.lockedId);
  expect(afterStaleSave).toContain('paste that must remain durable');
});
