// Startup-chime default + persistence (Section 19).
//
// New workspaces default the chime OFF (bridged to localStorage so startup-intro.js
// can read it before app hydration). A returning user who turns it OFF stays silent
// across reloads. Actual audio is suppressed under automation (navigator.webdriver),
// so these tests assert the preference/bridge contract, not real playback.
import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
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
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  // Settings are hydrated asynchronously from canonical workspace state. Wait
  // for that boundary before changing or reading a persisted preference.
  await waitForAppReady(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

test('a brand-new workspace defaults the startup chime OFF and bridges it for next load', async ({ page }) => {
  await openApp(page);
  // The app.js bridge writes the flag startup-intro.js reads on the next load.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sutra_startup_sound'))).toBe('0');
  await expect(page.locator('[data-pref-path="startup.playSound"]')).not.toBeChecked();
  await expect(page.locator('#testStartupSoundBtn')).toHaveCount(1); // preview chime control present
});

test('turning the chime OFF is preserved across a reload (returning-user choice respected)', async ({ page }) => {
  await openApp(page);
  // Open Settings so the preference controls bind (binding happens for all
  // #view-settings [data-pref-path] controls on first settings mount).
  await page.evaluate(() => {
    const tab = document.querySelector('.view-tab[data-view="settings"]');
    if (tab) tab.click();
  });
  await expect(page.locator('#view-settings')).toBeVisible();
  // The toggle lives in a settings category that may not be the active panel, so
  // wait for it to be ATTACHED (it is manipulated via evaluate, not clicked).
  await page.waitForSelector('#view-settings [data-pref-path="startup.playSound"]', { state: 'attached' });

  // Turn the toggle off through the real change handler, then Save Changes.
  await page.evaluate(() => {
    const cb = document.querySelector('#view-settings [data-pref-path="startup.playSound"]');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const save = document.getElementById('settingsApplyBtn') || document.getElementById('settingsApplyBtnTop');
    if (save) save.click();
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sutra_startup_sound'))).toBe('0');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('startup-chime-opt-out-e2e'));

  // Reload: normalize must preserve the persisted OFF choice (not re-default to ON).
  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await waitForAppReady(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sutra_startup_sound'))).toBe('0');
  await expect(page.locator('[data-pref-path="startup.playSound"]')).not.toBeChecked();
});

test('an explicit startup-chime opt-in is preserved across reload', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    document.querySelector('.view-tab[data-view="settings"]')?.click();
  });
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.waitForSelector('#view-settings [data-pref-path="startup.playSound"]', { state: 'attached' });
  await page.evaluate(() => {
    const checkbox = document.querySelector('#view-settings [data-pref-path="startup.playSound"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    (document.getElementById('settingsApplyBtn') || document.getElementById('settingsApplyBtnTop'))?.click();
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sutra_startup_sound'))).toBe('1');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('startup-chime-opt-in-e2e'));

  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await waitForAppReady(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sutra_startup_sound'))).toBe('1');
  await expect(page.locator('[data-pref-path="startup.playSound"]')).toBeChecked();
});
