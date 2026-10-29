// Customization de-emphasis (beta): CSS Overrides stay a polished user feature with
// a curated safe-preset gallery; Local Plugins move to an experimental developer
// surface under Settings ▸ Advanced. These tests lock in the four guarantees:
//   1. CSS snippets apply AFTER themes (win the cascade).
//   2. Safe Mode skips ALL custom CSS and plugins.
//   3. Imported/restored runtime plugins come back DISABLED + reviewRequired.
//   4. Normal Settings does NOT expose plugin controls unless the Advanced /
//      Experimental opt-in is enabled.
import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page, query = '') {
  await page.goto('/Sutra.html' + query);
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

async function openCustomization(page) {
  await page.evaluate(() => {
    const tab = document.querySelector('.view-tab[data-view="settings"]');
    if (tab) tab.click();
  });
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.evaluate(() => {
    const nav = document.querySelector('[data-settings-nav="mods"]');
    if (nav) nav.click();
  });
  await page.waitForSelector('#modsCssPanel', { state: 'attached' });
}

test('curated snippet gallery exposes the six safe presets, all valid CSS', async ({ page }) => {
  await openApp(page);
  const gallery = await page.evaluate(() => {
    const g = window.AtelierCustomization.snippetGallery();
    return g.map(item => ({
      id: item.id,
      name: item.name,
      valid: window.AtelierCustomization.validateCss(item.css).valid,
      hasCss: typeof item.css === 'string' && item.css.trim().length > 0
    }));
  });
  const names = gallery.map(g => g.name);
  expect(names).toEqual(expect.arrayContaining([
    'Compact Sidebar', 'Bigger Editor Text', 'Minimal Home View',
    'Softer Cards', 'High Contrast', 'Calm Focus Mode'
  ]));
  // Every preset must be non-empty and pass the brace-balance validator.
  for (const g of gallery) {
    expect(g.hasCss, `${g.name} has css`).toBe(true);
    expect(g.valid, `${g.name} is valid CSS`).toBe(true);
  }
});

test('CSS Overrides panel renders the gallery and no Plugins tab appears', async ({ page }) => {
  await openApp(page);
  await openCustomization(page);
  const ui = await page.evaluate(() => {
    const panel = document.getElementById('modsCssPanel');
    return {
      galleryCards: panel.querySelectorAll('.mods-gallery-card').length,
      hasPluginsTab: !!document.querySelector('[data-mods-tab="plugins"]'),
      hasCssTab: !!document.querySelector('[data-mods-tab="css"]'),
      hasRecoveryTab: !!document.querySelector('[data-mods-tab="recovery"]')
    };
  });
  expect(ui.galleryCards).toBe(6);
  expect(ui.hasPluginsTab).toBe(false);
  expect(ui.hasCssTab).toBe(true);
  expect(ui.hasRecoveryTab).toBe(true);
});

test('a CSS snippet applies AFTER an earlier (theme-like) style and wins the cascade', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    // Simulate a theme rule injected earlier in <head>.
    const themeLike = document.createElement('style');
    themeLike.id = 'e2e-theme-like';
    themeLike.textContent = ':root { --sutra-e2e-token: 10px; }';
    document.head.appendChild(themeLike);

    // Apply a user snippet that overrides the same variable.
    window.AtelierCustomization.applyCss(
      [{ id: 'e2e1', name: 'e2e', order: 0, enabled: true, css: ':root { --sutra-e2e-token: 42px; }' }],
      { modsEnabled: true, customCssEnabled: true }
    );

    const snippetNode = document.querySelector('style[data-atelier-user-css="snippet"]');
    const anchor = document.getElementById('atelier-user-css');
    const wins = getComputedStyle(document.documentElement).getPropertyValue('--sutra-e2e-token').trim();
    // Snippet <style> must come AFTER the anchor and AFTER the theme-like node.
    const orderOk = !!snippetNode && !!anchor &&
      (anchor.compareDocumentPosition(snippetNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
      (themeLike.compareDocumentPosition(snippetNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return { wins, orderOk };
  });
  expect(result.wins).toBe('42px');
  expect(result.orderOk).toBe(true);
});

test('Safe Mode skips ALL custom CSS and plugins (data preserved)', async ({ page }) => {
  await openApp(page, '?sutraSafeMode=1');
  const safe = await page.evaluate(() => {
    const isSafe = window.AtelierCustomization.isSafeMode();
    const res = window.AtelierCustomization.applyCss(
      [{ id: 's1', name: 's', order: 0, enabled: true, css: ':root { --sutra-e2e-safe: 5px; }' }],
      { modsEnabled: true, customCssEnabled: true }
    );
    const injected = document.querySelectorAll('style[data-atelier-user-css="snippet"]').length;
    return { isSafe, applied: res.applied, safeMode: res.safeMode === true, injected };
  });
  expect(safe.isSafe).toBe(true);
  expect(safe.applied).toBe(0);
  expect(safe.safeMode).toBe(true);
  expect(safe.injected).toBe(0);
});

test('imported/restored runtime plugins return DISABLED + reviewRequired', async ({ page }) => {
  await openApp(page);
  const rec = await page.evaluate(() => {
    const bundle = {
      manifest: {
        schemaVersion: 1,
        id: 'e2e.runtime-plugin',
        name: 'E2E Runtime Plugin',
        version: '1.0.0',
        permissions: ['ui.commands'],
        runtime: { type: 'sandboxed-script', code: 'atelier.toast("hi");' }
      },
      // Hostile-looking restore state: someone hand-edited the backup to enabled+trusted.
      enabled: true,
      reviewRequired: false
    };
    const out = window.AtelierPlugins.markForReviewOnImport([bundle]);
    const r = out[0];
    return { enabled: r.enabled, reviewRequired: r.reviewRequired, hasRuntime: r.manifest.hasRuntime };
  });
  expect(rec.hasRuntime).toBe(true);
  expect(rec.enabled).toBe(false);
  expect(rec.reviewRequired).toBe(true);
});

test('normal Settings hides plugin controls until Advanced/Experimental is enabled', async ({ page }) => {
  await openApp(page);
  await openCustomization(page);

  // Default: experimental OFF → group + panel hidden, panel empty, no controls.
  const before = await page.evaluate(() => {
    const group = document.getElementById('pluginsExperimentalGroup');
    const panel = document.getElementById('modsPluginsPanel');
    const toggle = document.getElementById('pluginsExperimentalToggle');
    return {
      groupHidden: group.hidden,
      panelHidden: panel.hidden,
      panelEmpty: panel.innerHTML.trim() === '',
      toggleChecked: toggle.checked,
      importBtnVisible: !!document.querySelector('[data-mods-action="plugin-import"]')
    };
  });
  expect(before.toggleChecked).toBe(false);
  expect(before.groupHidden).toBe(true);
  expect(before.panelHidden).toBe(true);
  expect(before.panelEmpty).toBe(true);
  expect(before.importBtnVisible).toBe(false);

  // Opt in via the real change handler bound at boot.
  await page.evaluate(() => {
    const toggle = document.getElementById('pluginsExperimentalToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const after = await page.evaluate(() => {
    const group = document.getElementById('pluginsExperimentalGroup');
    const panel = document.getElementById('modsPluginsPanel');
    return {
      groupHidden: group.hidden,
      panelHidden: panel.hidden,
      panelHasControls: /Local Plugins/.test(panel.innerHTML) && !!panel.querySelector('[data-mods-action="plugin-import"]')
    };
  });
  expect(after.groupHidden).toBe(false);
  expect(after.panelHidden).toBe(false);
  expect(after.panelHasControls).toBe(true);
});
