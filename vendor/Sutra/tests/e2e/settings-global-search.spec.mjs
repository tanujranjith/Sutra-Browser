import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openSettings(page) {
  await page.addInitScript(() => { sessionStorage.setItem('sutra_intro_played', '1'); });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    document.body.classList.remove('onboarding-open');
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
    window.setActiveView('settings');
  });
  await expect(page.locator('#view-settings')).toBeVisible();
}

test('Settings hierarchy keeps everyday controls visible and advanced packs disclosed on demand', async ({ page }) => {
  await openSettings(page);

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('[data-settings-nav]')).toHaveCount(16);
  await expect(page.locator('.cc-sidebar-group-label')).toHaveText([
    'Essentials',
    'Planning & learning',
    'Services & safety'
  ]);
  await expect(page.locator('#settingsAdvancedGroup')).not.toHaveAttribute('open', '');
  await expect(page.locator('.cc-preview-rail')).toBeVisible();

  await page.locator('#settingsAdvancedGroup summary').click();
  await expect(page.locator('[data-settings-nav="business"]')).toBeVisible();
  await page.locator('[data-settings-nav="business"]').click();
  await expect(page.locator('#settingsAdvancedGroup')).toHaveAttribute('open', '');
  await expect(page.locator('[data-settings-section="business"]')).toBeVisible();
  await expect(page.locator('.cc-preview-rail')).toBeHidden();
  await expect(page.locator('.cc-body')).toHaveAttribute('data-preview', 'false');
});

test('Settings search supports results, recovery, clear, and keyboard focus', async ({ page }) => {
  await openSettings(page);

  await page.fill('#settingsSearchInput', 'focus');
  const searchState = await page.evaluate(() => ({
    hint: document.getElementById('settingsSearchHint').textContent,
    visibleSections: [...document.querySelectorAll('#view-settings [data-settings-section]')]
      .filter(section => getComputedStyle(section).display !== 'none')
      .map(section => section.getAttribute('data-settings-section'))
  }));
  expect(searchState.hint).toMatch(/across/i);
  expect(searchState.visibleSections.length).toBeGreaterThan(1);
  await expect(page.locator('#settingsSearchClearBtn')).toBeVisible();
  await expect(page.locator('#settingsSearchShortcut')).toBeHidden();

  await page.fill('#settingsSearchInput', 'zzzz-no-setting');
  await expect(page.locator('#settingsSearchEmpty')).toBeVisible();
  await expect(page.locator('#settingsSearchHint')).toHaveText('0 matches across 0 categories.');
  await page.locator('#settingsSearchEmptyClearBtn').click();

  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('#view-settings [data-settings-section]')]
      .filter(section => getComputedStyle(section).display !== 'none').length
  )).toBe(1);
  await expect(page.locator('#settingsSearchInput')).toBeFocused();

  await page.getByRole('heading', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('/');
  await expect(page.locator('#settingsSearchInput')).toBeFocused();
  await page.fill('#settingsSearchInput', 'calendar');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settingsSearchInput')).toHaveValue('');
  await expect(page.locator('#settingsSearchInput')).toBeFocused();
});

test('Settings mobile hierarchy stays contained and keeps the canonical Save and Revert bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);

  await expect(page.locator('#settingsCategorySelect')).toBeVisible();
  await expect(page.locator('.cc-sidebar')).toBeHidden();
  await expect(page.locator('.cc-page-header-actions')).toBeHidden();
  const mobileLayout = await page.evaluate(() => {
    const discovery = document.querySelector('#view-settings .cc-discovery');
    const body = document.querySelector('#view-settings .cc-body');
    const section = document.querySelector('[data-settings-section="appearance"]');
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      searchBeforeBody: !!discovery && !!body && (discovery.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      firstSectionTop: section?.getBoundingClientRect().top ?? Infinity,
      optionGroups: [...document.querySelectorAll('#settingsCategorySelect optgroup')].map(group => group.label)
    };
  });
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.searchBeforeBody).toBe(true);
  expect(mobileLayout.firstSectionTop).toBeLessThan(380);
  expect(mobileLayout.optionGroups).toEqual([
    'Essentials',
    'Planning & learning',
    'Services & safety',
    'Advanced & packs'
  ]);

  await page.locator('[data-pref-path="appearance.density"] [data-value="compact"]').click();
  await expect(page.locator('#settingsActionBar')).toHaveAttribute('data-pending', 'true');
  await expect(page.locator('#settingsApplyBtn')).toBeEnabled();
  await page.locator('#settingsRevertBtn').click();
  await expect(page.locator('#settingsActionBar')).toHaveAttribute('data-pending', 'false');

  await page.locator('#settingsCategorySelect').selectOption('data');
  await expect(page.locator('[data-settings-section="data"]')).toBeVisible();
});
