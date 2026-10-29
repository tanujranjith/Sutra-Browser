import { expect, test } from '@playwright/test';

// Route-paused script loads must reach Playwright rather than an installed SW.
test.use({ serviceWorkers: 'block' });

test('the shell stays concealed until canonical hydration and its first render finish', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sutra_intro_played', '1'));
  let releaseAppScript;
  let markScriptRequested;
  const scriptRequested = new Promise(resolve => { markScriptRequested = resolve; });
  const appScriptReleased = new Promise(resolve => { releaseAppScript = resolve; });
  await page.route('**/src/core/app.js?*', async route => {
    markScriptRequested();
    await appScriptReleased;
    await route.continue();
  });

  const navigation = page.goto('/Sutra.html');
  await scriptRequested;
  await expect(page.locator('#sutraWorkspaceStartup')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'loading');
  await expect(page.locator('.app-container')).toBeHidden();
  await expect(page.locator('.app-container')).toHaveAttribute('inert', '');
  await expect(page.locator('#todayLabel')).toHaveText('Tuesday, Jan 2');

  releaseAppScript();
  await navigation;
  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'ready');
  await expect(page.locator('#sutraWorkspaceStartup')).toBeHidden();
  await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
  await expect(page.locator('#todayLabel')).not.toHaveText('Tuesday, Jan 2');
});

test('a returning workspace never shows zero deadlines while its saved tasks load', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sutra_intro_played', '1'));
  await page.goto('/Sutra.html');
  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'ready');
  await page.evaluate(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    window.flowAtelier.tasks.push({
      id: 'startup-gate-overdue', title: 'Saved overdue assignment', dueDate,
      priority: 'high', completed: false, isActive: true, scheduleType: 'once'
    });
    await window.flowAtelier.flushAppSaveNow('startup-gate-fixture');
  });

  let releaseAppScript;
  let markScriptRequested;
  const scriptRequested = new Promise(resolve => { markScriptRequested = resolve; });
  const appScriptReleased = new Promise(resolve => { releaseAppScript = resolve; });
  await page.route('**/src/core/app.js?*', async route => {
    markScriptRequested();
    await appScriptReleased;
    await route.continue();
  });

  const navigation = page.reload();
  await scriptRequested;
  await expect(page.locator('.app-container')).toBeHidden();
  await expect(page.locator('#tccOverdueCount')).toHaveText('0');
  releaseAppScript();
  await navigation;
  await expect(page.locator('body')).toHaveAttribute('data-sutra-workspace-boot', 'ready');
  await expect(page.locator('#tccOverdueCount')).toHaveText('1');
});
