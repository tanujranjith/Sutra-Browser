import { expect, test } from '@playwright/test';

// A wide desktop viewport so the responsive tab-overflow system does not collapse
// core tabs into the "More" menu — this test is about which views Recovery Mode
// keeps available, not about narrow-viewport overflow layout.
test.use({ viewport: { width: 1600, height: 900 } });

test('Recovery Mode keeps workspace, backup, and diagnostics while pausing optional packs', async ({ page }) => {
  await page.goto('/Sutra.html?sutraRecoveryMode=1');
  await page.waitForFunction(() => window.SutraRecoveryMode && window.SutraRecoveryMode.isActive());
  await expect(page.locator('#sutraRecoveryModeBanner')).toBeVisible();
  // Scope to the primary tab bar; an identical entry also lives in the hidden
  // overflow menu (.view-more-item), which would trip Playwright strict mode.
  await expect(page.locator('.view-tab[data-view="notes"]:not(.view-more-item)')).toBeVisible();
  await expect(page.locator('.view-tab[data-view="settings"]:not(.view-more-item)')).toBeVisible();
  await expect(page.locator('.view-tab[data-view="assistantview"]:not(.view-more-item)')).toBeHidden();

  const state = await page.evaluate(async () => {
    const optional = await window.SutraFeatureRegistry.enable('assistant');
    return {
      optional,
      canSerialize: typeof window.serializeWorkspace === 'function',
      canEmergencyExport: !!(window.SutraPersistenceHealth && typeof window.SutraPersistenceHealth.exportEmergencyBackup === 'function'),
      canDownloadDiagnostics: !!(window.SutraDiagnostics && typeof window.SutraDiagnostics.download === 'function'),
      activeView: document.querySelector('.view.active')?.id || ''
    };
  });
  expect(state.optional.loaded).toBe(false);
  expect(state.optional.error).toMatch(/Recovery Mode/);
  expect(state.canSerialize).toBe(true);
  expect(state.canEmergencyExport).toBe(true);
  expect(state.canDownloadDiagnostics).toBe(true);
  expect(state.activeView).toBe('view-notes');
});
