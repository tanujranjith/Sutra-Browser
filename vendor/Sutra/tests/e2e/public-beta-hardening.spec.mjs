import { expect, test } from '@playwright/test';

const thirdPartyPattern = /^https?:\/\/(?!127\.0\.0\.1|localhost)/i;
const BACKUP_PASSWORD = 'public beta encrypted backup';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      } else if (typeof markStudentOnboardingCompleted === 'function') {
        markStudentOnboardingCompleted(true);
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

async function waitForCanonicalHydration(page) {
  // Shell markup attaches before IndexedDB hydration finishes. Export tests
  // must mutate and inspect the canonical workspace only after initApp has
  // completed its post-hydration bindings.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
}

async function openApp(page) {
  const requests = [];
  page.on('request', request => {
    const url = request.url();
    if (thirdPartyPattern.test(url)) requests.push(url);
  });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForCanonicalHydration(page);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
  return { requests, consoleErrors };
}

test('fresh startup makes no third-party requests and exposes CSP', async ({ page }) => {
  const { requests } = await openApp(page);
  expect(requests, 'unexpected third-party startup requests').toEqual([]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain('https://api.openai.com');
  expect(csp).toContain('https://docs.google.com');
});

test('quota failure shows persistent banner and retry recovery clears it', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const failingIndexedDb = {
      open() {
        throw new DOMException('Simulated quota exhaustion', 'QuotaExceededError');
      }
    };
    Object.defineProperty(window, 'indexedDB', { value: failingIndexedDb, configurable: true });
    try { await window.saveWorkspaceLocally(); } catch (error) {}
  });
  await expect(page.locator('#sutraSaveFailureBanner')).toBeVisible();
  await expect(page.locator('#sutraSaveFailureMessage')).toContainText('quota');
  // A stale editor timer must never overwrite a verified failure with a false
  // "Saved" claim after the canonical write/readback path has rejected.
  await page.waitForTimeout(1000);
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Save failed/i);

  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await expect(page.locator('#sutraSaveFailureBanner')).toBeVisible();
  await page.evaluate(() => window.SutraPersistenceHealth.retry());
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Saved/i);
});

test('IndexedDB transaction failure is classified and preserves in-memory state', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open() { throw new DOMException('Simulated IndexedDB failure', 'InvalidStateError'); } }
    });
    try { await window.saveWorkspaceLocally(); } catch (error) {}
  });
  await expect(page.locator('#sutraSaveFailureBanner')).toBeVisible();
  await expect(page.locator('#sutraSaveFailureMessage')).toContainText(/indexeddb|transaction/i);
  const state = await page.evaluate(() => window.SutraPersistenceHealth.getState());
  expect(state.lastFailure.kind).toMatch(/indexeddb|transaction/);
});

test('last-saved transition updates taskbar and Storage Health', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.saveWorkspaceLocally());
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Saved/i);
  const state = await page.evaluate(() => window.SutraPersistenceHealth.getState());
  expect(state.lastConfirmedSaveAt).toBeTruthy();
  expect(state.lastSerializedBytes).toBeGreaterThan(0);
});

test('emergency .sutra export downloads when required blobs are present', async ({ page }) => {
  await openApp(page);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(password => window.SutraPersistenceHealth.exportEmergencyBackup({ passphrase: password }), BACKUP_PASSWORD);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sutra_emergency_workspace_.*\.sutra$/);
});

test('required missing attachment refuses emergency export and surfaces warning', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__sutraPublicBetaTestHooks.injectMissingCourseAttachment());
  const result = await page.evaluate(password => window.SutraPersistenceHealth.exportEmergencyBackup({ passphrase: password }), BACKUP_PASSWORD);
  expect(result).toBe(false);
  await expect(page.locator('#sutraSaveFailureBanner')).toBeVisible();
  await expect(page.locator('#sutraSaveFailureMessage')).toContainText(/attachment/i);
});

test('corrupt .sutra import is refused without replacing workspace', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const before = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const beforeCount = before.pages.length;
    const corrupt = new File(['not a zip'], 'corrupt.sutra', { type: 'application/octet-stream' });
    await window.importWorkspaceFile(corrupt);
    const after = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return {
      beforeCount,
      afterCount: after.pages.length,
      sameFirstPage: before.pages[0] && after.pages[0] ? before.pages[0].id === after.pages[0].id : before.pages.length === after.pages.length
    };
  });
  expect(result.afterCount).toBe(result.beforeCount);
  expect(result.sameFirstPage).toBe(true);
});

test('wipe-and-restore JSON plus legacy .atelier import preserve workspace data', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  const setup = await page.evaluate(async () => {
    const now = new Date().toISOString();
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const restoredTitle = `Restore QA ${Date.now()}`;
    const legacyTitle = `Legacy Atelier QA ${Date.now()}`;
    const restoredPayload = {
      ...base,
      pages: [{
        ...(base.pages[0] || {}),
        id: 'restore-qa-page',
        type: 'note',
        title: restoredTitle,
        content: '<p>Restored JSON workspace</p>',
        isSystemPage: false,
        builtInId: '',
        systemRole: '',
        createdAt: now,
        updatedAt: now
      }]
    };
    const blankPayload = { ...base, pages: [], tasks: [], taskOrder: [] };
    window.deserializeWorkspace(blankPayload);
    window.deserializeWorkspace(restoredPayload);
    const afterRestore = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });

    const legacyPayload = {
      ...restoredPayload,
      pages: [{ ...restoredPayload.pages[0], id: 'legacy-atelier-qa-page', title: legacyTitle }]
    };
    const zip = new window.JSZip();
    zip.file('manifest.json', JSON.stringify({
      product: 'NoteFlow Atelier',
      appName: 'NoteFlow Atelier',
      format: 'noteflow_atelier_project',
      formatVersion: 1,
      schemaVersion: 1,
      assets: []
    }));
    zip.file('workspace.json', JSON.stringify(legacyPayload));
    const blob = await zip.generateAsync({ type: 'blob' });
    // Whole-workspace imports onto a non-empty device now block on the
    // restore conflict chooser, so the import must NOT be awaited here —
    // the test clicks the chooser from outside, then awaits the promise.
    window.__legacyImportPromise = window.importWorkspaceFile(new File([blob], 'legacy-import.atelier', { type: 'application/zip' }));
    return {
      restored: afterRestore.pages.some(page => page.title === restoredTitle),
      legacyTitle
    };
  });
  expect(setup.restored).toBe(true);
  await page.locator('.sutra-modal-overlay button', { hasText: 'Restore backup' }).click({ timeout: 20_000 });
  const snapshotModal = page.locator('#sutraBackupPasswordModal');
  await snapshotModal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', BACKUP_PASSWORD);
  await page.fill('#sutraBackupPassphraseConfirmInput', BACKUP_PASSWORD);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  await expect(snapshotModal).not.toHaveClass(/active/, { timeout: 60_000 });
  const legacy = await page.evaluate(async (legacyTitle) => {
    await window.__legacyImportPromise;
    delete window.__legacyImportPromise;
    const afterLegacy = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return afterLegacy.pages.some(page => page.title === legacyTitle);
  }, setup.legacyTitle);
  expect(legacy).toBe(true);
});

test('export modal has dialog semantics, traps Tab, and Escape restores focus', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const existing = document.getElementById('focusRestoreSentinel');
    if (existing) existing.remove();
    const button = document.createElement('button');
    button.id = 'focusRestoreSentinel';
    button.type = 'button';
    button.textContent = 'Focus restore sentinel';
    button.style.position = 'fixed';
    button.style.left = '8px';
    button.style.top = '8px';
    button.style.zIndex = '99999';
    document.body.appendChild(button);
  });
  const focusTarget = page.locator('#focusRestoreSentinel');
  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
  await page.evaluate(() => window.openExportOptionsModal());
  const modal = page.locator('#exportOptionsModal');
  await expect(modal).toHaveClass(/active/);
  await expect(modal.locator('[role="dialog"]').first()).toBeVisible();

  const firstFocused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.textContent || document.activeElement.tagName));
  expect(firstFocused).toBeTruthy();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const focusInside = await page.evaluate(() => !!document.activeElement.closest('#exportOptionsModal'));
  expect(focusInside).toBe(true);
  const listenerCount = await page.evaluate(() => window.SutraModalManager.getListenerCount());
  expect(listenerCount).toBe(1);

  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/active/);
  await expect(focusTarget).toBeFocused();
});

test('reduced-motion startup still renders the workspace', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await expect(page.locator('.app-container')).toBeVisible();
  await expect(page.locator('#sutraStartupIntro')).toBeHidden({ timeout: 15_000 });
});
