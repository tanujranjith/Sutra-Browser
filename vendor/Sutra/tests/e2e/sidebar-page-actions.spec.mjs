import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true
    && typeof window.setActiveView === 'function'
    && !!window.flowAtelier);
  await page.evaluate(() => {
    const intro = document.getElementById('sutraStartupIntro');
    if (intro) {
      intro.hidden = true;
      intro.setAttribute('aria-hidden', 'true');
      intro.style.setProperty('display', 'none', 'important');
    }
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace({
      ...base,
      pages: [...base.pages, {
        id: 'sidebar-actions-page',
        title: 'Sidebar actions target',
        type: 'note',
        content: '<p>Safe synthetic sidebar action test.</p>',
        icon: 'doc',
        isSystemPage: false,
        builtInId: '',
        systemRole: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });
    window.setActiveView('notes');
    window.flowAtelier.renderPagesList();
  });
}

test('desktop page rows keep a large open target and expose actions through one overflow menu', async ({ page }) => {
  await openApp(page);
  const row = page.locator('.page-item[data-page-id="sidebar-actions-page"]');
  const title = row.locator('.page-title-text');
  const toggle = row.locator('.page-item-actions-toggle');

  await expect(row.locator('.page-item-icons')).toBeHidden();
  const titleBox = await title.boundingBox();
  expect(titleBox?.width).toBeGreaterThan(100);
  await toggle.focus();
  await expect(toggle).toBeVisible();
  await toggle.dispatchEvent('click');
  const menu = page.locator('#sidebarPageActionsMenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await title.dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => window.flowAtelier.currentPageId)).toBe('sidebar-actions-page');
});
