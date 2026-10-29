import { expect, test } from '@playwright/test';
import { waitForAppHydrated } from './helpers/app-ready.mjs';

test.use({ serviceWorkers: 'block' });

for (const width of [1280, 390]) {
  test(`Cloud hub is local-only, accessible and unified at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      sessionStorage.setItem('sutra_intro_played', '1');
      localStorage.setItem('sutra:supabaseCloud:v1', JSON.stringify({
        deviceId: 'legacy-device', autoBackup: { enabled: false, frequency: 'close' }, futureField: 'preserved'
      }));
    });
    const requests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/supabase\.co/.test(request.url())) requests.push(request.url()); });
    await page.goto('/Sutra.html');
    await waitForAppHydrated(page);
    await page.evaluate(() => {
      window.markStudentOnboardingCompleted(true);
      const overlay = document.getElementById('studentOnboardingOverlay');
      if (overlay) { overlay.hidden = true; overlay.classList.remove('active'); }
    });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.locator('#storageOptions').hover();
    await page.locator('#sutraCloudOpenBtn').click();
    await expect(page.getByRole('dialog', { name: 'Sutra Cloud', exact: true })).toBeVisible();
    await expect(page.locator('#sutraCloudSummary')).toContainText('Saved locally');
    await expect(page.locator('#sutraCloudSummary')).toContainText('Backed up');
    await expect(page.locator('#sutraSyncSetup')).toBeVisible();
    if (process.env.CLOUD_QA_SCREENSHOT_DIR) {
      await page.screenshot({ path: process.env.CLOUD_QA_SCREENSHOT_DIR + '/cloud-' + width + '.png' });
    }
    await expect(page.locator('#sutraSyncOpenBtn')).toHaveCount(0);
    await page.locator('#sutraCloudBackupsTab').click();
    await expect(page.locator('#sutraCloudBackupsPanel')).toBeVisible();
    await expect(page.locator('#sutraSyncSetup')).not.toBeVisible();
    await page.evaluate(() => window.SutraSync.open());
    await expect(page.locator('#sutraSyncSetup')).toBeVisible();
    expect(await page.locator('.modal.active').count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sutraCloudModal')).not.toHaveClass(/active/);
    await expect(page.locator('#sutraCloudOpenBtn')).toBeFocused();
    const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('sutra:supabaseCloud:v1')));
    expect(meta).toMatchObject({ schemaVersion: 2, deviceId: 'legacy-device', futureField: 'preserved',
      autoBackup: { enabled: false, frequency: 'close' } });
    const databases = await page.evaluate(() => indexedDB.databases());
    expect(databases.map(db => db.name)).not.toContain('sutra_sync_db');
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
