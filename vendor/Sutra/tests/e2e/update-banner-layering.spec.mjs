import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

test('update advice waits behind onboarding and Radar, then remains dismissible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: null,
        register: async () => ({ waiting: { postMessage() {} }, addEventListener() {} }),
        addEventListener() {}
      }
    });
  });
  await page.goto('/Sutra.html');
  await waitForAppReady(page);
  const banner = page.locator('#sutraUpdateBanner');
  await expect(banner).toBeAttached();
  await expect(page.getByRole('button', { name: 'Skip setup', exact: true })).toBeVisible();
  await expect(banner).toBeHidden();
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await expect(banner).toBeVisible();
  await page.evaluate(() => window.openDeadlineRadar());
  await expect(page.locator('#deadlineRadarModal')).toBeVisible();
  await expect(banner).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#deadlineRadarModal')).toBeHidden();
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(banner).toBeHidden();
});
