import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
    document.getElementById('sutraStartupIntro')?.remove();
  });
  await page.waitForFunction(() => !!window.SutraQuote
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  // Shell globals are exposed before IndexedDB hydration completes. Cross the
  // public durability seam before mutating portable quote preferences.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('custom-quotes-ready'));
}

test('custom quotes are manageable, portable, filtered, and responsive', async ({ page }) => {
  // One end-to-end journey covers CRUD, several preference rerenders, desktop
  // and phone dialogs, serialization, and durable reload in slower engines.
  test.slow();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await openApp(page);
  await page.evaluate(() => window.flowAtelier.setActiveView('settings'));
  await page.locator('[data-settings-nav="appearance"]').click();
  const trigger = page.locator('#openQuoteManagerBtn');
  await expect(trigger).toBeVisible();
  await trigger.click();

  let dialog = page.getByRole('dialog', { name: 'Quotes' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Quote', { exact: true }).fill('I can do hard things, one calm step at a time.');
  await dialog.getByLabel('Author or attribution').fill('Me');
  await dialog.getByLabel('Category', { exact: true }).fill('Self Affirmation');
  await dialog.getByRole('button', { name: 'Add quote' }).click();
  await expect(dialog.locator('.daily-quotes-item')).toHaveCount(1);
  await expect(dialog.locator('.daily-quotes-item')).toContainText('I can do hard things');

  await dialog.getByLabel('Quote sources').selectOption('custom');
  await expect.poll(() => page.evaluate(() => window.SutraQuote.getSettings().sourceMode)).toBe('custom');
  await expect.poll(() => page.evaluate(() => window.SutraQuote.getAvailableQuotes({ surface: 'sidebar' }).map(row => row.text))).toEqual([
    'I can do hard things, one calm step at a time.'
  ]);
  const sidebarQuote = page.locator('#daily-lock-in-quote');
  await expect(sidebarQuote).toContainText('I can do hard things');
  await expect(sidebarQuote).toHaveAttribute('data-quote-category', 'self-affirmation');

  const customTabsToggle = dialog.getByRole('checkbox', { name: /Custom Tabs/ });
  await customTabsToggle.uncheck();
  expect(await page.evaluate(() => window.SutraQuote.getAvailableQuotes({ surface: 'custom-tab' }).length)).toBe(0);
  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await dialog.getByRole('checkbox', { name: /Custom Tabs/ }).check();
  expect(await page.evaluate(() => window.SutraQuote.getAvailableQuotes({ surface: 'custom-tab' }).map(row => row.text))).toEqual([
    'I can do hard things, one calm step at a time.'
  ]);

  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await dialog.getByRole('checkbox', { name: /Sidebar/ }).uncheck();
  await expect(sidebarQuote).toBeHidden();
  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await dialog.getByRole('checkbox', { name: /Sidebar/ }).check();
  // Settings owns the full canvas, and the modal manager inerts the background,
  // so the sidebar quote is not visually exposed while this dialog is open.
  // Verify the quote feature itself restored the sidebar state.
  await expect(sidebarQuote).toHaveJSProperty('hidden', false);
  await expect(sidebarQuote).toHaveAttribute('aria-hidden', 'false');

  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await dialog.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByLabel('Quote', { exact: true }).fill('I can do difficult things with patience.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(sidebarQuote).toContainText('with patience');

  const portable = await page.evaluate(() => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const quotes = payload.settings.preferences.quotes;
    return {
      sourceMode: quotes.sourceMode,
      count: quotes.customQuotes.length,
      text: quotes.customQuotes[0].text,
      category: quotes.customQuotes[0].category
    };
  });
  expect(portable).toEqual({
    sourceMode: 'custom',
    count: 1,
    text: 'I can do difficult things with patience.',
    category: 'self-affirmation'
  });

  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await dialog.getByRole('button', { name: 'Close quotes' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('custom-quotes-e2e'));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.SutraQuote.openManager());
  dialog = page.getByRole('dialog', { name: 'Quotes' });
  await expect(dialog).toBeVisible();
  const layout = await page.evaluate(() => {
    const root = document.querySelector('.daily-quotes-modal');
    const card = document.querySelector('.daily-quotes-card');
    const rect = card.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      cardHeight: rect.height,
      viewportHeight: window.innerHeight,
      activeModals: window.SutraModalManager.getActiveCount(),
      bodyLocked: document.body.classList.contains('sutra-modal-lock'),
      rootVisible: !!root && !root.hidden
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.left).toBeGreaterThanOrEqual(-1);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.cardHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.activeModals).toBe(1);
  expect(layout.bodyLocked).toBe(true);
  expect(layout.rootVisible).toBe(true);
  await dialog.getByRole('button', { name: 'Close quotes' }).click();

  await page.reload();
  await page.waitForFunction(() => !!window.SutraQuote
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('custom-quotes-reload-ready'));
  const restored = await page.evaluate(() => {
    const settings = window.SutraQuote.getSettings();
    return { count: settings.customQuotes.length, text: settings.customQuotes[0] && settings.customQuotes[0].text };
  });
  expect(restored).toEqual({ count: 1, text: 'I can do difficult things with patience.' });
  expect(browserErrors).toEqual([]);
});
