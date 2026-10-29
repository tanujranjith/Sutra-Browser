import { expect, test } from '@playwright/test';

// Phase 5 — defensive browser-storage writes.
// Verifies window.SutraSafeStorage classification + warning model, and that the
// Homework feature (user-authored data on localStorage) survives a storage
// failure without losing the in-memory change or firing the catastrophic core
// IndexedDB save-failure banner. Driven through public surfaces / real UI only.

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

async function waitForCanonicalHydration(page) {
  // Static shell controls attach before IndexedDB hydration finishes. Tests
  // that inspect canonical attachment metadata must wait for initApp's
  // post-hydration binding, not merely for shell markup.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForCanonicalHydration(page);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

// --- window.SutraSafeStorage unit behavior ---------------------------------

test('SafeStorage: an important write failure shows a durable warning, never the core banner', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      const e = new Error('full');
      e.name = 'QuotaExceededError';
      throw e;
    };
    const r = window.SutraSafeStorage.set('test:important', 'value', { importance: 'important', label: 'Test data' });
    Storage.prototype.setItem = real;
    return { ok: r.ok, classification: r.classification, degraded: window.SutraSafeStorage.isDegraded() };
  });
  expect(res.ok).toBe(false);
  expect(res.classification).toBe('quota');
  expect(res.degraded).toBe(true);
  await expect(page.locator('#sutraStorageWarningBanner')).toBeVisible();
  // The catastrophic core IndexedDB banner must NOT appear for a localStorage write.
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('SafeStorage: an optional write failure stays silent and never claims workspace data loss', async ({ page }) => {
  await openApp(page);
  const ok = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      const e = new Error('full');
      e.name = 'QuotaExceededError';
      throw e;
    };
    const r = window.SutraSafeStorage.set('test:optional', 'value', { importance: 'optional' });
    Storage.prototype.setItem = real;
    return r.ok;
  });
  expect(ok).toBe(false);
  await expect(page.locator('#sutraStorageWarningBanner')).toBeHidden();
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('SafeStorage: a successful write after a failure clears the warning (retry path)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'test:retry') {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return window.__realSetItem.call(this, k, v);
    };
    window.SutraSafeStorage.set('test:retry', '1', { importance: 'important', label: 'Retry data' });
  });
  await expect(page.locator('#sutraStorageWarningBanner')).toBeVisible();
  const ok = await page.evaluate(() => {
    Storage.prototype.setItem = window.__realSetItem; // storage available again
    const r = window.SutraSafeStorage.set('test:retry', '2', { importance: 'important', label: 'Retry data' });
    return r.ok;
  });
  expect(ok).toBe(true);
  await expect(page.locator('#sutraStorageWarningBanner')).toBeHidden();
});

test('SafeStorage: a non-serializable value is classified as a serialize failure (not a crash)', async ({ page }) => {
  await openApp(page);
  const classification = await page.evaluate(() => {
    const circular = {};
    circular.self = circular;
    const r = window.SutraSafeStorage.set('test:circular', circular, { importance: 'optional' });
    return r.classification;
  });
  expect(classification).toBe('serialize');
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();
});

test('Attachments: a transient IndexedDB open failure can recover without reloading', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const realIndexedDb = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open() { throw new DOMException('Transient attachment open failure', 'InvalidStateError'); } }
    });
    let firstFailed = false;
    try {
      await window.SutraAttachments.addFiles([
        new File(['first attempt'], 'first-attempt.txt', { type: 'text/plain' })
      ], { source: 'storage-retry-test' });
    } catch (error) {
      firstFailed = true;
    }

    Object.defineProperty(window, 'indexedDB', { configurable: true, value: realIndexedDb });
    const added = await window.SutraAttachments.addFiles([
      new File(['durable retry'], 'durable-retry.txt', { type: 'text/plain' })
    ], { source: 'storage-retry-test' });
    await window.saveWorkspaceLocally();
    const file = added[0] || null;
    return {
      firstFailed,
      fileId: file && file.id,
      dataUrl: file ? await window.SutraAttachments.readDataUrl(file.id) : null
    };
  });

  expect(result.firstFailed).toBe(true);
  expect(result.fileId).toBeTruthy();
  expect(result.dataUrl).toContain('data:text/plain;base64,');
  await expect(page.locator('#sutraSaveFailureBanner')).toBeHidden();

  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForCanonicalHydration(page);
  await completeOnboarding(page);
  const restored = await page.evaluate(fileId => window.SutraAttachments.readDataUrl(fileId), result.fileId);
  expect(restored).toBe(result.dataUrl);
});

// --- Homework integration --------------------------------------------------

async function gotoHomework(page) {
  await page.evaluate(() => {
    try { window.setActiveView && window.setActiveView('homework'); } catch (e) {}
    const overlay = document.getElementById('hwSetupOverlay');
    if (overlay) overlay.style.setProperty('display', 'none', 'important');
  });
  await page.waitForSelector('[data-course-add]', { state: 'visible', timeout: 15000 });
}

async function addCourse(page, name) {
  await page.locator('[data-course-add]').first().click();
  await page.fill('[data-course-quick-input]', name);
  await page.locator('[data-course-quick-add]').click();
}

test('Homework: a course add survives a workspace save failure and is recovered on the next successful save', async ({ page }) => {
  // Homework now persists through window.SutraHomeworkStore into the main workspace
  // (IndexedDB), not a standalone hwCourses:v2 localStorage key. The seed is imported
  // into the store at boot so the board renders (not the empty-state capture).
  await page.addInitScript(() => {
    localStorage.setItem('hwCourses:v2', JSON.stringify([{ id: 'c-seed', name: 'Biology', type: 'class' }]));
    localStorage.setItem('hwTasks:v2', JSON.stringify([]));
    localStorage.setItem('hwSchemaVersion', '3');
  });
  await openApp(page);
  await gotoHomework(page);
  await expect.poll(() => page.evaluate(() => window.SutraHomework.getCourses().map((c) => c.name)))
    .toContain('Biology');

  // Make every workspace IndexedDB save fail. The store's commit() rolls its own
  // in-memory state back on a persist failure and re-throws, but the homework module
  // keeps the new course in module memory and re-renders — so the change is never
  // lost from the user's screen even though it did not reach storage.
  await page.evaluate(() => {
    window.__realIndexedDB = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open() { throw new DOMException('Simulated save failure', 'InvalidStateError'); } }
    });
  });

  await addCourse(page, 'Chemistry');

  // The in-memory homework state must still contain Chemistry (preserved through the
  // failed save), even though the store's canonical snapshot was rolled back.
  await expect.poll(() => page.evaluate(() => window.SutraHomework.getCourses().map((c) => c.name)))
    .toContain('Chemistry');

  // Storage recovers; the next successful add persists the CURRENT in-memory state —
  // proving Chemistry was preserved and is now durably saved alongside Physics.
  await page.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: window.__realIndexedDB });
  });
  await addCourse(page, 'Physics');

  await expect.poll(async () =>
    page.evaluate(() => window.SutraHomeworkStore.getSnapshot().courses.map((c) => c.name))
  ).toEqual(expect.arrayContaining(['Biology', 'Chemistry', 'Physics']));
});

test('Homework: corrupted stored JSON recovers gracefully (no crash, view usable)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hwCourses:v2', '{ this is not valid json');
    localStorage.setItem('hwTasks:v2', 'also-not-json');
    localStorage.setItem('hwSchemaVersion', '3');
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openApp(page); // boots (brand mark visible) despite corrupt legacy homework data
  // The store must recover corrupt legacy data to a clean, empty snapshot rather than
  // crashing or throwing a JSON parse error into the page.
  const recovered = await page.evaluate(() => window.SutraHomeworkStore.getSnapshot());
  expect(Array.isArray(recovered.courses)).toBe(true);
  expect(recovered.courses.length).toBe(0);
  expect(Array.isArray(recovered.tasks)).toBe(true);

  // Recovery to empty state means a fresh course can still be created + persisted
  // through the canonical cross-feature path, and it durably reaches the store.
  await page.evaluate(() => window.SutraHomework.addCourse('Calculus'));
  await expect.poll(async () =>
    page.evaluate(() => window.SutraHomeworkStore.getSnapshot().courses.map((c) => c.name))
  ).toContain('Calculus');
  expect(errors.join('\n')).not.toMatch(/JSON|is not valid|unexpected token/i);
});

// --- API-key boundary ------------------------------------------------------

test('API keys stay session-only and never enter localStorage or exports', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const SECRET = 'sk-test-SUTRA-SECRET-9001';
    // Drive the real provider key input + its handler (input/change/blur).
    const input = document.getElementById('groqApiKeyInput');
    if (input) {
      input.value = SECRET;
      ['input', 'change', 'blur'].forEach((type) =>
        input.dispatchEvent(new Event(type, { bubbles: true }))
      );
    }
    const exportJson = JSON.stringify(window.serializeWorkspace ? window.serializeWorkspace() : {});
    const localStorageKeys = Object.keys(localStorage);
    return {
      inLocalStorageKey: localStorageKeys.some((k) => /api_key/i.test(k)),
      secretInLocalStorage: localStorageKeys.some((k) => String(localStorage.getItem(k) || '').includes(SECRET)),
      secretInExport: exportJson.includes(SECRET),
      secretValue: SECRET
    };
  });
  // Boundary: keys never sit in localStorage and never appear in a workspace export.
  expect(result.inLocalStorageKey).toBe(false);
  expect(result.secretInLocalStorage).toBe(false);
  expect(result.secretInExport).toBe(false);
});
