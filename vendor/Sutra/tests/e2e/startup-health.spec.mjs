import { expect, test } from '@playwright/test';

// Runtime startup health layer (src/core/startup-health.js → window.SutraStartupHealth).
// It must: report a healthy boot as ok with NO banner; surface a dismissible
// recovery banner ONLY for a genuine critical-subsystem failure; and never block
// normal use over a mere warning.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
  });
  // The layer is part of the head safety bundle — present before app.js boots.
  await page.waitForFunction(() => !!window.SutraStartupHealth);
}

test('startup intro can be skipped immediately with Escape', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.removeItem('sutra_intro_played'));
  await page.goto('/Sutra.html', { waitUntil: 'commit' });
  const intro = page.locator('#sutraStartupIntro');
  await expect(intro).toBeAttached();
  await page.waitForFunction(() => !!window.SutraStartupIntro
    && sessionStorage.getItem('sutra_intro_played') === '1');
  await page.keyboard.press('Escape');
  await expect(intro).toBeHidden({ timeout: 2_000 });
});

test('startup fallback stops intercepting keys after the normal intro closes', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.removeItem('sutra_intro_played'));
  await page.goto('/Sutra.html');
  const intro = page.locator('#sutraStartupIntro');
  await expect(intro).toBeHidden({ timeout: 10_000 });
  await page.evaluate(() => {
    window.__sutraPostIntroKey = null;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') window.__sutraPostIntroKey = { defaultPrevented: event.defaultPrevented };
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__sutraPostIntroKey)).toEqual({ defaultPrevented: false });
});

test('the health layer exposes a testable surface and the documented checks', async ({ page }) => {
  await openApp(page);
  const api = await page.evaluate(() => Object.keys(window.SutraStartupHealth || {}).sort());
  expect(api).toEqual(['dismissRecovery', 'getReport', 'isRecoveryVisible', 'listChecks', 'renderRecovery', 'run'].sort());

  const checks = await page.evaluate(() => window.SutraStartupHealth.listChecks());
  const names = checks.map(c => c.name);
  // The critical detectors must cover the real data-safety subsystems.
  for (const name of ['app-runtime', 'safe-storage', 'persistence-pipeline', 'app-shell']) {
    expect(names).toContain(name);
    expect(checks.find(c => c.name === name).severity).toBe('critical');
  }
  // Warnings exist and are classified as warnings (never block).
  expect(checks.some(c => c.severity === 'warning')).toBe(true);
});

test('a healthy boot reports ok and shows NO recovery banner', async ({ page }) => {
  await openApp(page);
  const report = await page.evaluate(() => window.SutraStartupHealth.run());
  expect(report.ok).toBe(true);
  expect(report.criticalCount).toBe(0);
  // Every critical check passed in a real boot.
  const failedCritical = report.checks.filter(c => !c.ok && c.severity === 'critical');
  expect(failedCritical).toEqual([]);
  await expect(page.locator('#sutraStartupHealthBanner')).toHaveCount(0);
});

test('the real core runtime boots without parser errors or recovery UI', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await openApp(page);
  await page.waitForFunction(() => (
    typeof window.serializeWorkspace === 'function'
    && typeof window.saveWorkspaceLocally === 'function'
    && !!window.__sutraPublicBetaTestHooks
    && !!window.SutraSync
  ));

  const report = await page.evaluate(() => window.SutraStartupHealth.run());
  expect(report.ok).toBe(true);
  expect(report.criticalCount).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator('#sutraStartupHealthBanner')).toHaveCount(0);
  await expect(page.locator('#sutraIssuePrompt.is-visible')).toHaveCount(0);
});

test('a simulated CRITICAL failure surfaces a dismissible recovery banner with data-safety actions', async ({ page }) => {
  await openApp(page);
  const report = await page.evaluate(() => window.SutraStartupHealth.run({ simulateMissing: ['app-runtime'] }));
  expect(report.ok).toBe(false);
  expect(report.criticalCount).toBeGreaterThanOrEqual(1);

  const banner = page.locator('#sutraStartupHealthBanner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/start/i);
  // Recovery offers the data-safety actions, not "file an issue".
  await expect(banner.locator('button', { hasText: 'Reload' })).toBeVisible();
  await expect(banner.locator('button', { hasText: /safe mode/i })).toBeVisible();
  await expect(banner.locator('button', { hasText: /dismiss/i })).toBeVisible();
  // The message names the failed subsystem so the user understands what broke.
  await expect(banner).toContainText(/runtime/i);

  // It is dismissible — never traps the user.
  await page.evaluate(() => window.SutraStartupHealth.dismissRecovery());
  await expect(page.locator('#sutraStartupHealthBanner')).toHaveCount(0);
});

test('a warning-only state never renders the recovery banner (no false alarm)', async ({ page }) => {
  await openApp(page);
  const report = await page.evaluate(() => window.SutraStartupHealth.run({ simulateMissing: ['migrations'] }));
  expect(report.ok).toBe(true);            // a warning does not make boot "not ok"
  expect(report.criticalCount).toBe(0);
  expect(report.warningCount).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#sutraStartupHealthBanner')).toHaveCount(0);
});

test('rendering recovery twice yields a single banner (idempotent)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const r = window.SutraStartupHealth.run({ simulateMissing: ['app-shell'], silent: true });
    window.SutraStartupHealth.renderRecovery(r);
    window.SutraStartupHealth.renderRecovery(r);
  });
  await expect(page.locator('#sutraStartupHealthBanner')).toHaveCount(1);
  await page.evaluate(() => window.SutraStartupHealth.dismissRecovery());
});
