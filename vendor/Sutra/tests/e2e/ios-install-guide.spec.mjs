import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
});

test('optional iOS install advice never covers onboarding or the More sheet', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sutra_intro_played', '1'));
  await page.goto('/Sutra.html');
  await waitForAppReady(page);
  const guide = page.locator('#sutraIosInstallGuide');
  await expect(guide).toBeAttached();
  await expect(page.locator('#studentOnboardingOverlay')).toBeVisible();
  await expect(guide).toBeHidden();
  await page.evaluate(() => window.markStudentOnboardingCompleted(true));
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
  await expect(guide).toBeVisible();
  const more = page.locator('#sutraBottomNav [data-bn-view="__more"]');
  await more.click();
  await expect(guide).toBeHidden();
  await page.locator('[data-mobile-more-action="notifications"]').click();
  await expect(page.locator('#notifPanel')).toBeVisible();
  await page.locator('#notifCloseBtn').click();
  await expect(guide).toBeVisible();
  const updateLater = page.locator('#sutraUpdateBanner .sutra-update-dismiss');
  if (await updateLater.isVisible()) await updateLater.click();
  await guide.getByRole('button', { name: 'Dismiss install instructions' }).click();
  await expect(guide).toBeHidden();
});
