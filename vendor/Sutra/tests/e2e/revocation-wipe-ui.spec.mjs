import { test, expect } from '@playwright/test';

const GUARD_KEY = 'sutra:revocationWipeGuard:v1';

async function openWithGuard(page, status) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, status: value, updatedAt: new Date().toISOString() }));
  }, { key: GUARD_KEY, value: status });
  await page.goto('/Sutra.html');
  await expect(page.locator('#sutraRevokedDeviceScreen')).toBeVisible();
}

async function expectWorkspaceConcealed(page) {
  const exposure = await page.evaluate(async () => ({
    visibleText: document.body?.innerText || '',
    databases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(row => row.name).filter(Boolean)
      : [],
    exposedChildren: Array.from(document.body?.children || [])
      .filter(node => node.id !== 'sutraRevokedDeviceScreen')
      .filter(node => getComputedStyle(node).display !== 'none')
      .map(node => node.id || node.tagName)
  }));
  expect(exposure.visibleText).not.toContain('Sutra workspace');
  expect(exposure.exposedChildren).toEqual([]);
  expect(exposure.databases).not.toContain('noteflow_atelier_db');
  expect(exposure.databases).not.toContain('sutra_credentials_db');
}

test('an enumeration-unverified wipe remains fail-closed until browser site data is cleared', async ({ page }) => {
  await openWithGuard(page, 'complete-unverified');
  await expect(page.locator('#sutraRevokedDeviceReuse')).toBeHidden();
  await expect(page.locator('#sutraRevokedDeviceMessage')).toContainText('cannot verify');
  await expect(page.locator('#sutraRevokedDeviceMessage')).toContainText('Clear all site data');
  await expectWorkspaceConcealed(page);
});

test('an unreadable revocation guard keeps startup fail-closed', async ({ page }) => {
  await page.addInitScript(key => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (String(name) === key) throw new DOMException('Revocation guard is unavailable', 'SecurityError');
      return originalGetItem.call(this, name);
    };
  }, GUARD_KEY);
  await page.goto('/Sutra.html');
  await expect(page.locator('#sutraRevokedDeviceScreen')).toBeVisible();
  await expect(page.locator('#sutraRevokedDeviceReuse')).toBeHidden();
  await expect(page.locator('#sutraRevokedDeviceMessage')).toContainText('Sutra is locked');
  await expectWorkspaceConcealed(page);
});

test('a fully verified wipe permits an explicit empty-workspace restart', async ({ page }) => {
  await openWithGuard(page, 'complete');
  await expect(page.locator('#sutraRevokedDeviceReuse')).toBeVisible();
  await expectWorkspaceConcealed(page);
});
