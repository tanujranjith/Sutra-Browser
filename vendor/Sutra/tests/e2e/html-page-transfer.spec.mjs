import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

const PASS = 'correct horse battery staple';

async function openApp(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch (error) {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.flowAtelier && !!window.SutraHTMLPages && !!window.SutraEncryptedBackups);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await waitForAppReady(page);
}

async function encryptedBackup(page) {
  const bytes = await page.evaluate(async ({ pass }) => {
    const created = await window.SutraEncryptedBackups.createBackupBlob(pass);
    return Array.from(new Uint8Array(await created.blob.arrayBuffer()));
  }, { pass: PASS });
  return Buffer.from(bytes);
}

async function acceptOptionalRestorePrompt(page) {
  const restoreButton = page.locator('.sutra-modal-overlay button', { hasText: 'Restore backup' });
  if (await restoreButton.count()) await restoreButton.click();
}

async function completeOptionalSafetySnapshot(page) {
  const modal = page.locator('#sutraBackupPasswordModal');
  if (await modal.count() && await modal.isVisible()) {
    await modal.locator('#sutraBackupPassphraseInput').fill(PASS);
    await modal.locator('#sutraBackupPassphraseConfirmInput').fill(PASS);
    await modal.locator('#sutraBackupPasswordSubmitBtn').click();
    await expect(modal).not.toHaveClass(/active/, { timeout: 60_000 });
  }
}

test('encrypted workspace transfer preserves HTML Pages and repairs legacy page records', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await openApp(page);
  const marker = 'HTML transfer survives';
  const pageId = await page.evaluate((marker) => window.SutraHTMLPages.createPage('Transfer demo', {
    source: `<main><h1>${marker}</h1></main>`
  }).id, marker);
  await expect(page.locator('#htmlPageEditor')).toBeVisible();

  const backup = await encryptedBackup(page);
  const targetContext = await browser.newContext();
  const target = await targetContext.newPage();
  try {
    await openApp(target);
    await target.setInputFiles('#fileInput', {
      name: 'html-transfer.sutra',
      mimeType: 'application/octet-stream',
      buffer: backup
    });
    await expect(target.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
    await target.locator('#sutraImportPassphraseInput').fill(PASS);
    await target.locator('#sutraImportPasswordSubmitBtn').click();
    await expect(target.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
    await acceptOptionalRestorePrompt(target);
    await completeOptionalSafetySnapshot(target);

    await expect.poll(() => target.evaluate((title) => {
      const restored = window.flowAtelier.pages.find((item) => item.title === title);
      return restored?.htmlDocument?.source || '';
    }, 'Transfer demo'), { timeout: 60_000 }).toContain(marker);
    const restoredIdentity = await target.evaluate((title) => {
      const restored = window.flowAtelier.pages.find((item) => item.title === title);
      return { id: restored?.id || '', source: restored?.htmlDocument?.source || '' };
    }, 'Transfer demo');
    expect(restoredIdentity.id).toBe(pageId);
    expect(restoredIdentity.source).toContain(marker);
    await target.evaluate((id) => {
      window.setActiveView('notes');
      window.loadPage(id);
    }, pageId);
    await expect(target.locator('#htmlPageEditor')).toBeVisible();
    await expect(target.frameLocator('#htmlPageEditor [data-html-preview] iframe').locator('h1')).toHaveText(marker);

    const legacyResult = await target.evaluate(() => {
      const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      window.deserializeWorkspace({
        ...base,
        pages: [{
          id: 'legacy-transfer-html',
          title: 'Recovered legacy HTML',
          type: 'html',
          content: '<h2 id="legacy-marker">Recovered source</h2>'
        }]
      });
      const restored = window.flowAtelier.pages.find((item) => item.id === 'legacy-transfer-html');
      return {
        content: restored?.content,
        source: restored?.htmlDocument?.source,
        active: window.flowAtelier.currentPageId
      };
    });
    expect(legacyResult).toEqual({
      content: '',
      source: '<h2 id="legacy-marker">Recovered source</h2>',
      active: 'legacy-transfer-html'
    });
    await expect(target.frameLocator('#htmlPageEditor [data-html-preview] iframe').locator('#legacy-marker')).toHaveText('Recovered source');
  } finally {
    await targetContext.close();
  }
});
