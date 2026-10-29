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
  await page.waitForFunction(() => typeof window.applyPresetTheme === 'function' && typeof window.setActiveView === 'function');
  await page.waitForTimeout(700);
}

async function applyGlass(page) {
  await page.evaluate(async () => {
    window.setApplyMode?.('all');
    await window.applyPresetTheme('glass');
  });
  await page.waitForFunction(() => document.body.dataset.theme === 'glass' && document.body.dataset.themeKey === 'glass');
}

test('Glass keeps the scroll canvas light, surfaces frosted, and controls usable', async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await applyGlass(page);

  const desktop = await page.evaluate(() => {
    const view = document.querySelector('.view.active');
    const card = document.querySelector('.today-nextup-card');
    const nav = document.querySelector('.top-nav');
    const before = getComputedStyle(document.body, '::before');
    const after = getComputedStyle(document.body, '::after');
    const color = value => String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    return {
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewBackdrop: getComputedStyle(view).backdropFilter,
      cardBackdrop: getComputedStyle(card).backdropFilter,
      navBackgroundImage: getComputedStyle(nav).backgroundImage,
      beforePointerEvents: before.pointerEvents,
      afterPointerEvents: after.pointerEvents,
      textColor: color(getComputedStyle(document.body).color),
      backgroundColor: color(getComputedStyle(document.body).backgroundColor)
    };
  });

  expect(desktop.htmlOverflow).toBe('hidden');
  expect(desktop.bodyOverflow).toBe('hidden');
  expect(desktop.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(desktop.viewBackdrop).toBe('none');
  expect(desktop.cardBackdrop).toContain('blur');
  expect(desktop.navBackgroundImage).toContain('linear-gradient');
  expect(desktop.beforePointerEvents).toBe('none');
  expect(desktop.afterPointerEvents).toBe('none');
  expect(desktop.textColor).toHaveLength(3);
  expect(desktop.backgroundColor).toHaveLength(3);

  await page.setViewportSize({ width: 929, height: 965 });
  await page.evaluate(() => window.setActiveView('notes'));
  await page.waitForTimeout(300);
  const medium = await page.evaluate(() => {
    const nav = document.querySelector('.top-nav').getBoundingClientRect();
    const toolbar = document.querySelector('#view-notes .toolbar-wrapper').getBoundingClientRect();
    const title = document.querySelector('#notesEditorContainer .page-title-input').getBoundingClientRect();
    return {
      navBottom: nav.bottom,
      toolbarTop: toolbar.top,
      toolbarBottom: toolbar.bottom,
      titleTop: title.top,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(medium.toolbarTop).toBeGreaterThanOrEqual(medium.navBottom - 1);
  expect(medium.titleTop).toBeGreaterThanOrEqual(medium.toolbarBottom - 1);
  expect(medium.horizontalOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.setActiveView('today');
    document.body.dataset.theme = 'liquidglass';
  });
  await page.waitForTimeout(250);
  const phone = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    viewBackdrop: getComputedStyle(document.querySelector('.view.active')).backdropFilter,
    cardBackdrop: getComputedStyle(document.querySelector('.today-nextup-card')).backdropFilter,
    bodyBefore: getComputedStyle(document.body, '::before').pointerEvents
  }));
  expect(phone.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(phone.viewBackdrop).toBe('none');
  expect(phone.cardBackdrop).toContain('blur');
  expect(phone.bodyBefore).toBe('none');
  expect(browserErrors).toEqual([]);
});
