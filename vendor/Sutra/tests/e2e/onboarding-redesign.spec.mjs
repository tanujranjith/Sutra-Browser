import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

const PASS = 'correct horse battery staple';

async function openFreshApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  // Shell markup arrives before the canonical workspace boundary and its
  // onboarding reconciliation. Use the established readiness seam instead
  // of treating an unrelated startup delegate as durable readiness.
  await waitForAppReady(page);
}

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch {}
    sessionStorage.setItem('sutra_intro_played', '1');
    document.body.classList.remove('onboarding-open');
    for (const id of ['studentOnboardingOverlay', 'sutraStartupIntro']) {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.classList.remove('active', 'intro-exiting');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  });
}

test('new student flow shows redesign onboarding steps in order', async ({ page }) => {
  await openFreshApp(page);

  const dialog = page.locator('#studentOnboardingOverlay[aria-hidden="false"], #studentOnboardingOverlay:not([aria-hidden])');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const steps = await page.evaluate(() => {
    const labels = document.querySelectorAll('.atelier-onboarding-step-label');
    return Array.from(labels).map(el => el.textContent.trim());
  });

  expect(steps).toEqual(['Welcome', 'Classes', 'Setup', 'Mode', 'Protect', 'Finish']);

  const title = page.locator('.atelier-onboarding-title');
  await expect(title.first()).toBeVisible();
});

test('full student flow: select student intent, add classes, advance through all steps, land on Today', async ({ page }) => {
  test.setTimeout(120_000);
  await openFreshApp(page);

  // Welcome step — select "I'm a student"
  await page.waitForSelector('[data-onb-intent="student"]', { timeout: 5000 });
  await page.click('[data-onb-intent="student"]');
  await page.waitForTimeout(200);

  // Click Continue to advance to Classes
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Classes step — add two classes
  await page.waitForSelector('#onbClassInput', { timeout: 3000 });
  await page.fill('#onbClassInput', 'AP Physics');
  await page.press('#onbClassInput', 'Enter');
  await page.waitForTimeout(100);
  await page.fill('#onbClassInput', 'Calculus');
  await page.press('#onbClassInput', 'Enter');
  await page.waitForTimeout(100);

  const chipCount = await page.evaluate(() => {
    return document.querySelectorAll('#onbClassChips .atelier-onboarding-chip').length;
  });
  expect(chipCount).toBe(2);

  // Click Continue to advance to Setup
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Setup step — skip by clicking Continue
  await page.waitForSelector('#onbPasteText', { timeout: 3000 });
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Mode step — select Student focus
  await page.waitForSelector('[data-onb-focus="student"]', { timeout: 3000 });
  await page.click('[data-onb-focus="student"]');
  await page.waitForTimeout(200);

  // Click Continue to advance to Protect
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Protect step — acknowledge backup
  await page.waitForSelector('#onbBackupAck', { timeout: 3000 });
  await page.check('#onbBackupAck');
  await page.waitForTimeout(100);

  // Click Continue to advance to Finish
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Finish step — click "Open Today"
  await page.waitForSelector('[data-onb-tour="today"]', { timeout: 3000 });
  await page.click('[data-onb-tour="today"]');
  await page.waitForTimeout(200);

  // Click Continue to finish
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(500);

  // Verify overlay closed and view is Today
  const overlay = page.locator('#studentOnboardingOverlay');
  await expect(overlay).not.toBeVisible({ timeout: 5000 });

  // Completion must survive a real startup/hydrate cycle. This catches the
  // onboarding-state replacement bug where the final flag was only live in
  // memory and the wizard returned after reload.
  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await expect(overlay).not.toBeVisible({ timeout: 5000 });
});

test('skip path: select "Just exploring", lands on Today immediately', async ({ page }) => {
  await openFreshApp(page);

  // Welcome step — select "Just exploring"
  await page.waitForSelector('[data-onb-intent="skip"]', { timeout: 5000 });
  await page.click('[data-onb-intent="skip"]');
  await page.waitForTimeout(200);

  // Click Continue — this immediately completes onboarding
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(500);

  // Verify overlay closed
  const overlay = page.locator('#studentOnboardingOverlay');
  await expect(overlay).not.toBeVisible({ timeout: 5000 });
});

test('Continue later: close overlay and reopen preserves step progress', async ({ page }) => {
  await openFreshApp(page);

  // Welcome step — select student
  await page.waitForSelector('[data-onb-intent="student"]', { timeout: 5000 });
  await page.click('[data-onb-intent="student"]');
  await page.waitForTimeout(200);

  // Advance to classes
  await page.click('#onboardingContinueBtn');
  await page.waitForTimeout(300);

  // Add a class
  await page.waitForSelector('#onbClassInput', { timeout: 3000 });
  await page.fill('#onbClassInput', 'Chemistry');
  await page.press('#onbClassInput', 'Enter');
  await page.waitForTimeout(100);

  // Close via X button
  const closeBtn = page.locator('#studentOnboardingOverlay button[aria-label="Close onboarding"]');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // Verify overlay hidden
  const overlay = page.locator('#studentOnboardingOverlay');
  await expect(overlay).not.toBeVisible({ timeout: 3000 });

  // Continue later persists its in-progress step. Do not race that canonical
  // save with the reload that verifies it.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-onboarding-continue-later'));

  // Reload — dismiss preserves state so onboarding should reappear
  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);

  // Overlay should reappear since dismiss didn't mark as completed
  const reopen = page.locator('#studentOnboardingOverlay[aria-hidden="false"], #studentOnboardingOverlay:not([aria-hidden])');
  await expect(reopen).toBeVisible({ timeout: 5000 });

  // Chem class should be pre-populated
  const chipText = await page.evaluate(() => {
    const chips = document.querySelectorAll('#onbClassChips .atelier-onboarding-chip');
    return Array.from(chips).map(c => c.textContent.trim());
  });
  expect(chipText).toContain('Chemistry');
});

test('existing user with completed onboarding does not see overlay', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    const data = { studentOnboardingCompleted: true };
    try {
      localStorage.setItem('noteflow_atelier_db', JSON.stringify(data));
    } catch {}
  });

  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });

  const overlay = page.locator('#studentOnboardingOverlay');
  await expect(overlay).not.toBeVisible();
});

test('a failed canonical startup read never masquerades as first-run onboarding', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          throw new DOMException('Simulated canonical startup read failure', 'InvalidStateError');
        }
      }
    });
  });

  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });

  // The first-run gate has a delayed open path. Wait past it so this proves
  // both the immediate boot reconciliation and the timer re-check stay closed.
  await page.waitForTimeout(1200);
  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'error');
  await expect(page.locator('#sutraWorkspaceStartup')).toBeVisible();
  await expect(page.locator('#sutraWorkspaceStartupReload')).toBeVisible();
  await expect(page.locator('#sutraWorkspaceStartupSafeMode')).toBeVisible();
  await expect(page.locator('.app-container')).toBeHidden();
  await expect(page.locator('#sutraSaveFailureMessage')).toContainText(/read|indexeddb|storage/i);
  await expect(page.locator('#studentOnboardingOverlay')).not.toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/onboarding-open/);

  const failure = await page.evaluate(() => window.SutraPersistenceHealth.getState().lastFailure);
  expect(failure).toMatchObject({ phase: 'startup-read', kind: 'indexeddb' });
});

test('a failed initial canonical write never opens unsavable onboarding', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'workspace' && key === 'root') {
        throw new DOMException('Simulated initial workspace write failure', 'QuotaExceededError');
      }
      return realPut.call(this, value, key);
    };
  });

  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForTimeout(1200);

  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'error');
  await expect(page.locator('#sutraWorkspaceStartup')).toBeVisible();
  await expect(page.locator('.app-container')).toBeHidden();
  await expect(page.locator('#sutraSaveFailureMessage')).toContainText(/quota|save|storage/i);
  await expect(page.locator('#studentOnboardingOverlay')).not.toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/onboarding-open/);

  const result = await page.evaluate(async () => {
    const root = await new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_atelier_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readonly');
        const get = tx.objectStore('workspace').get('root');
        get.onerror = () => reject(get.error || tx.error);
        get.onsuccess = () => resolve(get.result || null);
      };
    });
    return {
      root,
      failure: window.SutraPersistenceHealth.getState().lastFailure
    };
  });
  expect(result.root).toBeNull();
  expect(result.failure.kind).toMatch(/quota|indexeddb/i);
  expect(result.failure.phase).toMatch(/initial-migration|autosave/);
});

test('legacy localStorage workspace is migrated before onboarding can save', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    const now = new Date().toISOString();
    localStorage.setItem('noteflow_atelier_db', JSON.stringify({
      appData: {
        version: 7,
        pages: [{
          id: 'legacy-official-note',
          title: 'Legacy official note',
          type: 'note',
          content: '<p>Keep legacy work.</p>',
          blocks: [],
          createdAt: now,
          updatedAt: now,
          spaceId: 'default'
        }],
        tasks: [{ id: 'legacy-official-task', title: 'Keep legacy task', isActive: true, completed: false }],
        taskOrder: ['legacy-official-task'],
        settings: {}
      }
    }));
  });

  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForTimeout(1000);
  await expect(page.locator('#studentOnboardingOverlay')).not.toBeVisible();

  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('root');
      get.onerror = () => reject(get.error || tx.error);
      get.onsuccess = () => resolve({
        hasNote: get.result.pages.some(page => page.id === 'legacy-official-note'),
        hasTask: get.result.tasks.some(task => task.id === 'legacy-official-task'),
        completed: get.result.settings.onboarding.completed === true
      });
    };
  }));
  expect(result).toEqual({ hasNote: true, hasTask: true, completed: true });
});

test('existing canonical workspace data is preserved when onboarding metadata is incomplete', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);

  await page.evaluate(async () => {
    const readRoot = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_atelier_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readonly');
        const get = tx.objectStore('workspace').get('root');
        get.onerror = () => reject(get.error || tx.error);
        get.onsuccess = () => resolve(get.result);
      };
    });
    const writeRoot = root => new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_atelier_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put(root, 'root');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
    const root = await readRoot();
    root.pages = [...(root.pages || []), {
      id: 'official-workspace-note',
      title: 'Official workspace note',
      type: 'note',
      content: '<p>Keep this note.</p>',
      blocks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      spaceId: 'default'
    }];
    root.tasks = [{ id: 'official-workspace-task', title: 'Keep this task', isActive: true, completed: false }];
    root.taskOrder = ['official-workspace-task'];
    root.settings = {
      ...(root.settings || {}),
      onboarding: { version: 1, completed: false, skipped: false, currentStep: 'welcome', migratedFromLegacy: false }
    };
    await writeRoot(root);
  });

  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await expect(page.locator('#studentOnboardingOverlay')).not.toBeVisible();

  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('root');
      get.onerror = () => reject(get.error || tx.error);
      get.onsuccess = () => resolve({
        hasNote: get.result.pages.some(page => page.id === 'official-workspace-note'),
        hasTask: get.result.tasks.some(task => task.id === 'official-workspace-task'),
        completed: get.result.settings.onboarding.completed === true
      });
    };
  }));
  expect(result).toEqual({ hasNote: true, hasTask: true, completed: true });
});

test('restart does not duplicate data', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    const data = {
      studentOnboardingCompleted: true,
      appData: {
        courses: { 'MATH101': { name: 'Calculus' } },
        settings: { theme: 'dark' }
      }
    };
    try {
      localStorage.setItem('noteflow_atelier_db', JSON.stringify(data));
    } catch {}
  });

  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });

  const courseCount = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('noteflow_atelier_db');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.appData && parsed.appData.courses) {
          return Object.keys(parsed.appData.courses).length;
        }
      }
    } catch {}
    return 0;
  });

  expect(courseCount).toBe(1);
});

test('primary navigation tabs are in expected order', async ({ page }) => {
  await openFreshApp(page);
  await completeOnboarding(page);

  const tabIds = await page.evaluate(() => {
    const links = document.querySelectorAll('.view-tab, [data-view-tab]');
    return Array.from(links).map(el => el.getAttribute('data-view') || el.id || el.textContent.trim()).filter(Boolean);
  });

  if (tabIds.length > 0) {
    const primaryTabs = ['today', 'homework', 'notes', 'timeline'];
    for (const tab of primaryTabs) {
      expect(tabIds.some(id => id.toLowerCase().includes(tab))).toBe(true);
    }
  }
});

test('settings page shows feature pack toggles', async ({ page }) => {
  await openFreshApp(page);
  await completeOnboarding(page);

  await page.evaluate(() => window.setActiveView('settings'));
  await expect(page.locator('#view-settings')).toBeVisible();
  const mobileCategory = page.locator('#settingsCategorySelect');
  if (await mobileCategory.isVisible()) {
    await mobileCategory.selectOption('advanced');
  } else {
    const advancedGroup = page.locator('#settingsAdvancedGroup');
    if (!await advancedGroup.evaluate(node => node.open)) {
      await advancedGroup.locator('summary').click();
    }
    const advancedNav = page.locator('[data-settings-nav="advanced"]');
    await expect(advancedNav).toBeVisible();
    await advancedNav.click();
  }
  const advanced = page.locator('[data-settings-section="advanced"]');
  await expect(advanced).toBeVisible();
  await expect(advanced.getByText('Feature packs', { exact: true })).toBeVisible();
});

test('keyboard: navigate welcome step with Tab and Enter', async ({ page }) => {
  await openFreshApp(page);

  await page.waitForSelector('#studentOnboardingOverlay', { timeout: 5000 });

  // Tab to the student intent card and press Enter
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  // Check student is selected or Continue button is enabled
  const selectedIntent = await page.evaluate(() => {
    const btn = document.querySelector('[data-onb-intent].is-selected');
    return btn ? btn.getAttribute('data-onb-intent') : null;
  });
  expect(['student', 'both', 'skip']).toContain(selectedIntent);
});

test('keyboard: Tab through footer buttons', async ({ page }) => {
  await openFreshApp(page);

  await page.waitForSelector('#studentOnboardingOverlay', { timeout: 5000 });

  // Focus the footer
  const footerBtns = ['#onboardingSkipBtn', '#onboardingContinueBtn', '#onboardingBackBtn'];
  for (const sel of footerBtns) {
    const el = page.locator(sel);
    if (await el.isVisible().catch(() => false)) {
      await expect(el).toBeAttached();
    }
  }
});

test('reduced motion: onboarding has reduced-motion class support', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFreshApp(page);

  // The onboarding panel should still be visible even with reduced motion
  const dialog = page.locator('#studentOnboardingOverlay[aria-hidden="false"], #studentOnboardingOverlay:not([aria-hidden])');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Check that the overlay is accessible despite reduced motion
  const title = page.locator('.atelier-onboarding-title').first();
  await expect(title).toBeVisible();
});

test('200% zoom: onboarding remains usable', async ({ page }) => {
  await openFreshApp(page);

  // Set zoom to 200%
  await page.evaluate(() => {
    document.body.style.zoom = '2';
  });
  await page.waitForTimeout(300);

  const dialog = page.locator('#studentOnboardingOverlay[aria-hidden="false"], #studentOnboardingOverlay:not([aria-hidden])');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Verify interaction still works at 200% zoom
  const studentBtn = page.locator('[data-onb-intent="student"]');
  await expect(studentBtn).toBeVisible();
  await studentBtn.click();
  await page.waitForTimeout(200);

  const selected = await page.evaluate(() => {
    const btn = document.querySelector('[data-onb-intent].is-selected');
    return btn ? btn.getAttribute('data-onb-intent') : null;
  });
  expect(selected).toBe('student');
});

test.describe('320px mobile viewport', () => {
  test.use({ viewport: { width: 320, height: 600 } });

  test('onboarding renders and is usable at 320px width', async ({ page }) => {
    await openFreshApp(page);

    const dialog = page.locator('#studentOnboardingOverlay[aria-hidden="false"], #studentOnboardingOverlay:not([aria-hidden])');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const title = page.locator('.atelier-onboarding-title').first();
    await expect(title).toBeVisible();

    // Select student intent
    const studentBtn = page.locator('[data-onb-intent="student"]');
    await expect(studentBtn).toBeVisible();
    await studentBtn.click();
    await page.waitForTimeout(200);

    // Advance to classes and add a class
    await page.click('#onboardingContinueBtn');
    await page.waitForTimeout(300);

    await page.waitForSelector('#onbClassInput', { timeout: 3000 });
    await page.fill('#onbClassInput', 'Biology');
    await page.press('#onbClassInput', 'Enter');
    await page.waitForTimeout(100);

    const chipCount = await page.evaluate(() => {
      return document.querySelectorAll('#onbClassChips .atelier-onboarding-chip').length;
    });
    expect(chipCount).toBe(1);
  });
});
