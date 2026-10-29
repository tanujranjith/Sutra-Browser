import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openCustomTab(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
    document.body.classList.remove('onboarding-open');
  });
  await page.waitForFunction(() => !!window.SutraCustomTabsBridge && !!window.SutraCustomTabs);
  await page.evaluate(() => {
    window.SutraCustomTabsBridge.setTabs([{
      id: 'qa-html-widget',
      name: 'HTML Widget QA',
      icon: 'fa-code',
      widgets: []
    }]);
    window.SutraCustomTabs.refresh();
  });
  await page.locator('.view-tab[data-view="custom-qa-html-widget"]').first().click();
  await expect(page.locator('#view-custom-qa-html-widget')).toBeVisible();
}

test('custom HTML widgets are sandboxed, editable, bounded, and portable', async ({ page }) => {
  await openCustomTab(page);
  const section = page.locator('#view-custom-qa-html-widget');

  await section.locator('.ctab-action', { hasText: 'Add widget' }).click();
  await expect(page.locator('.ctab-picker-panel')).toContainText('Custom HTML');
  await page.locator('.ctab-picker-option', { hasText: 'Custom HTML' }).click();

  const editor = page.locator('.ctab-html-editor-overlay');
  await expect(editor).toBeVisible();
  const source = '<section><h2>Study card</h2><p>Local content</p><a href="https://example.com" target="_blank">Docs</a><script>parent.__customHtmlEscaped=1;<\/script></section>';
  await editor.locator('.ctab-html-editor-input').fill(source);
  await expect(editor.locator('.ctab-html-editor-status')).toContainText('Offline mode');
  await expect(editor.locator('.ctab-html-preview-surface iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(editor.locator('.ctab-html-preview-surface iframe')).toHaveAttribute('srcdoc', /connect-src &#39;none&#39;|connect-src 'none'/);
  await editor.locator('.ctab-html-editor-footer .ctab-action', { hasText: 'Add widget' }).click();

  const card = section.locator('.ctab-widget[data-widget-id]').first();
  await expect(card.locator('.ctab-widget-label')).toContainText('Custom HTML');
  await expect(card.locator('.ctab-html-runtime iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const localState = await page.evaluate(() => {
    const tab = window.SutraCustomTabsBridge.getTabs().find((item) => item.id === 'qa-html-widget');
    const widget = tab?.widgets?.[0];
    return {
      source: widget?.config?.source,
      mode: widget?.config?.mode,
      escaped: window.__customHtmlEscaped
    };
  });
  expect(localState.source).toBe(source);
  expect(localState.mode).toBe('active-local');
  expect(localState.escaped).toBeUndefined();

  await section.locator('.ctab-action', { hasText: 'Edit' }).click();
  await card.locator('.ctab-ctrl[title="Edit HTML widget"]').click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('.ctab-html-editor-input')).toHaveValue(source);
  await editor.locator('.ctab-html-editor-input').fill('<section><h2>Remote playlist</h2><iframe src="https://open.spotify.com/embed/track/example"></iframe></section>');
  await editor.locator('.ctab-html-network-choice input').check();
  await expect(editor.locator('.ctab-html-editor-status')).toContainText('Remote capability enabled');
  await expect(editor.locator('.ctab-html-preview-surface iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  await expect(editor.locator('.ctab-html-preview-surface iframe')).toHaveAttribute('srcdoc', /https:\/\/open\.spotify\.com/);
  await editor.locator('.ctab-html-editor-footer .ctab-action', { hasText: 'Save widget' }).click();

  const remoteState = await page.evaluate(() => {
    const tab = window.SutraCustomTabsBridge.getTabs().find((item) => item.id === 'qa-html-widget');
    return tab?.widgets?.[0]?.config || null;
  });
  expect(remoteState.mode).toBe('network-embeds');
  expect(remoteState.source).toContain('open.spotify.com');
  await expect(section.locator('.ctab-html-runtime iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-popups');

  const roundTrip = await page.evaluate(() => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    const tab = window.SutraCustomTabsBridge.getTabs().find((item) => item.id === 'qa-html-widget');
    return tab?.widgets?.[0]?.config || null;
  });
  expect(roundTrip).toEqual(remoteState);

  const oversized = 'x'.repeat(512 * 1024 + 1);
  await page.evaluate((source) => {
    const tabs = window.SutraCustomTabsBridge.getTabs();
    tabs[0].widgets[0].config = { source, mode: 'active-local' };
    window.SutraCustomTabsBridge.setTabs(tabs);
    window.SutraCustomTabs.refresh();
  }, oversized);
  await expect(section.locator('.ctab-empty-msg')).toContainText('512 KB safety limit');
  expect(await section.locator('.ctab-html-runtime iframe').count()).toBe(0);
  expect(await page.evaluate(() => window.SutraCustomTabsBridge.getTabs()[0].widgets[0].config.source.length)).toBe(oversized.length);

  await page.evaluate(() => {
    const tabs = window.SutraCustomTabsBridge.getTabs();
    tabs[0].widgets[0].config = { source: '<p>Imported mode is fail-closed.</p>', mode: 'interactive' };
    window.SutraCustomTabsBridge.setTabs(tabs);
    window.SutraCustomTabs.refresh();
  });
  expect(await page.evaluate(() => window.SutraCustomTabsBridge.getTabs()[0].widgets[0].config.mode)).toBe('active-local');
  await expect(section.locator('.ctab-html-runtime iframe')).toHaveAttribute('sandbox', 'allow-scripts');
});
