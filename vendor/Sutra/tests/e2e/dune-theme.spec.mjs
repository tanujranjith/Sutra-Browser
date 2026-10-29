import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

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
  await page.waitForFunction(() => !!window.flowAtelier && typeof window.applyPresetTheme === 'function');
  // The Dune selection is a persisted workspace preference. Do not race its
  // write with the initial workspace hydrate that can replace appSettings.
  await waitForAppReady(page);
}

test('Dune is an authored, accessible, persistent desktop and mobile theme', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      const location = message.location();
      browserErrors.push(`${message.text()} (${location.url}:${location.lineNumber})`);
    }
  });

  await openApp(page);
  await page.evaluate(async () => {
    window.setApplyMode('all');
    await window.applyPresetTheme('dune');
    await window.flowAtelier.flushAppSaveNow('dune-theme-e2e');
  });
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dune');
  await expect(page.locator('body')).toHaveAttribute('data-theme-key', 'dune');

  const desktop = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const before = getComputedStyle(document.body, '::before');
    const after = getComputedStyle(document.body, '::after');
    const sidebar = getComputedStyle(document.querySelector('.sidebar'));
    const topNav = getComputedStyle(document.querySelector('.top-nav'));
    const activeTab = getComputedStyle(document.querySelector('.view-tab.active'));

    const parse = value => {
      const match = String(value).match(/[\d.]+/g);
      return match ? match.slice(0, 3).map(Number) : [0, 0, 0];
    };
    const luminance = rgb => rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a, b) => {
      const first = luminance(parse(a));
      const second = luminance(parse(b));
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const resolveColor = variable => {
      const probe = document.createElement('span');
      probe.style.color = `var(${variable})`;
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };

    const text = resolveColor('--text-primary');
    const secondary = resolveColor('--text-secondary');
    const background = resolveColor('--bg-primary');
    return {
      themeStylesheet: Array.from(document.styleSheets).some(sheet => /styles\/themes\/dune\.css/.test(sheet.href || '')),
      textContrast: contrast(text, background),
      secondaryContrast: contrast(secondary, background),
      beforeContent: before.content,
      beforePosition: before.position,
      beforePointerEvents: before.pointerEvents,
      beforeBackground: before.backgroundImage,
      afterBackground: after.backgroundImage,
      sidebarBackground: sidebar.backgroundImage,
      topNavBackdrop: topNav.backdropFilter || topNav.webkitBackdropFilter,
      activeTabBackground: activeTab.backgroundImage,
      externalAtmosphere: /url\(/i.test(before.backgroundImage + after.backgroundImage)
    };
  });
  expect(desktop.themeStylesheet).toBe(true);
  expect(desktop.textContrast).toBeGreaterThanOrEqual(7);
  expect(desktop.secondaryContrast).toBeGreaterThanOrEqual(4.5);
  expect(desktop.beforeContent).not.toBe('none');
  expect(desktop.beforePosition).toBe('fixed');
  expect(desktop.beforePointerEvents).toBe('none');
  expect(desktop.beforeBackground).toContain('radial-gradient');
  expect(desktop.afterBackground).toContain('radial-gradient');
  expect(desktop.sidebarBackground).toContain('linear-gradient');
  expect(desktop.topNavBackdrop).not.toBe('none');
  expect(desktop.activeTabBackground).toContain('linear-gradient');
  expect(desktop.externalAtmosphere).toBe(false);
  await testInfo.attach('dune-desktop', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    beforePosition: getComputedStyle(document.body, '::before').position,
    contentLength: document.body.innerText.trim().length
  }));
  expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  expect(mobile.beforePosition).toBe('fixed');
  expect(mobile.contentLength).toBeGreaterThan(100);
  await testInfo.attach('dune-mobile', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').animationName)).toBe('none');

  await page.reload();
  await page.waitForFunction(() => !!window.flowAtelier);
  await waitForAppReady(page);
  await expect(page.locator('body')).toHaveAttribute('data-theme-key', 'dune');
  expect(browserErrors).toEqual([]);
});
