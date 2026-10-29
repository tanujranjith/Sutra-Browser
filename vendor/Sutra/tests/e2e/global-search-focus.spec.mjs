import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

test('global search opens ready for typing without an automatic focus ring', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('.app-container', { state: 'visible' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.style.setProperty('display', 'none', 'important');
    }
    document.body.classList.remove('onboarding-open');
    window.SutraGlobalSearchModal.open('');
  });

  await expect(page.locator('#globalSearchPanel.active')).toBeVisible();
  await expect(page.locator('#globalSearchInput')).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const panel = document.getElementById('globalSearchPanel');
    const row = panel?.querySelector('.global-search-inputrow');
    return {
      automatic: panel?.classList.contains('is-auto-focused'),
      boxShadow: row ? getComputedStyle(row).boxShadow : ''
    };
  })).toEqual({ automatic: true, boxShadow: 'none' });

  await page.locator('#globalSearchInput').pressSequentially('p');
  await expect.poll(() => page.evaluate(() => document.getElementById('globalSearchPanel')?.classList.contains('is-auto-focused'))).toBe(false);
  await expect(page.locator('#globalSearchInput')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchPanel')).toBeHidden();
});
