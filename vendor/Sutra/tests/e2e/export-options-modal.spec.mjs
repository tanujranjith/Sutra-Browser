import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => !!window.__hwDueDateDelegateBound
    && !!window.__sutraPublicBetaTestHooks
    && !!window.SutraModalManager
    && !!window.flowAtelier);
  await page.evaluate(() => {
    if (typeof window.markStudentOnboardingCompleted === 'function') {
      window.markStudentOnboardingCompleted(true);
    }
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
    window.flowAtelier.flushAppSaveNow('export-options-test-ready');
  });
}

test('selecting export formats keeps the Export Options modal open', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.openExportOptionsModal());
  const modal = page.locator('#exportOptionsModal');
  await expect(modal).toHaveClass(/active/);

  const trigger = page.locator('#exportModalFormatSelect + .nf-select-trigger');
  await expect(trigger).toBeVisible();

  const menu = page.locator('#exportModalFormatSelect-menu');
  const formats = [
    ['atelier', 'Encrypted Sutra Workspace (.sutra)'],
    ['json', 'Workspace JSON - unencrypted (.json)'],
    ['docx', 'Word (.docx)'],
    ['pdf', 'PDF (.pdf)'],
    ['html', 'HTML (.html)'],
    ['md', 'Markdown (.md)'],
    ['txt', 'Plain Text (.txt)'],
    ['rtf', 'Rich Text (.rtf)'],
    ['doc', 'Word 97-2003 (.doc)']
  ];

  for (const [value, label] of formats) {
    await trigger.click();
    await expect(menu).toHaveClass(/is-open/);
    await menu.locator('.nf-select-option').filter({ hasText: label }).click();
    await expect(modal).toHaveClass(/active/);
    await expect(page.locator('#exportModalFormatSelect')).toHaveValue(value);
    await expect(trigger).toContainText(label);
  }

  await trigger.click();
  await expect(menu).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveClass(/is-open/);
  await expect(modal).toHaveClass(/active/);
});
