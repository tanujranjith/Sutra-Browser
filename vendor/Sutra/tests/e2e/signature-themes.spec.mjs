import { expect, test } from '@playwright/test';

function contrastRatio(first, second) {
  const parse = value => (String(value).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = value => parse(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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
  // Canonical workspace hydration can finish after the global API is exposed.
  // Let it settle so it cannot restore a saved theme over the first preset.
  await page.waitForTimeout(1200);
}

async function applyTheme(page, theme) {
  await page.evaluate(async key => {
    window.setApplyMode('all');
    await window.applyPresetTheme(key);
  }, theme);
  await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('body')).toHaveAttribute('data-theme-key', theme);
  // The appearance update and shell transition can finish after persistence.
  // Wait for a signature primary surface, then sample the settled visual state.
  await page.waitForFunction(key => {
    return document.body.dataset.theme === key
      && document.body.dataset.themeKey === key
      && getComputedStyle(document.body, '::before').backgroundImage !== 'none';
  }, theme);
  await page.waitForTimeout(900);
  await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('body')).toHaveAttribute('data-theme-key', theme);
}

test('Blueprint, Paper, and Arcade are distinct accessible responsive presets', async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await openApp(page);

  const cards = page.locator('.preset-card[data-theme="blueprint"], .preset-card[data-theme="paper"], .preset-card[data-theme="arcade"]');
  await expect(cards).toHaveCount(3);

  const snapshots = {};
  for (const theme of ['blueprint', 'paper', 'arcade']) {
    await applyTheme(page, theme);
    snapshots[theme] = await page.evaluate(() => {
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
      const body = getComputedStyle(document.body);
      const before = getComputedStyle(document.body, '::before');
      const after = getComputedStyle(document.body, '::after');
      const sidebar = getComputedStyle(document.querySelector('.sidebar'));
      const card = getComputedStyle(document.querySelector('.today-nextup-card'));
      const heading = getComputedStyle(document.querySelector('.today-greeting h1, .today-hero-date h2'));
      const visibleStyle = selector => {
        const matches = Array.from(document.querySelectorAll(selector));
        const element = matches.find(node => node.getClientRects().length) || matches[0];
        return getComputedStyle(element);
      };
      const inactiveTab = visibleStyle('.view-tab:not(.active)');
      const radarFilter = getComputedStyle(document.querySelector('.radar-filter'));
      const primaryAction = getComputedStyle(document.querySelector('.today-hero-primary'));
      const newPage = visibleStyle('.new-page-btn');
      const text = resolveColor('--text-primary');
      const secondary = resolveColor('--text-secondary');
      const background = resolveColor('--bg-primary');
      return {
        colorScheme: body.colorScheme,
        textContrast: contrast(text, background),
        secondaryContrast: contrast(secondary, background),
        beforeBackground: before.backgroundImage,
        afterBackground: after.backgroundImage,
        beforePointerEvents: before.pointerEvents,
        afterTransform: after.transform,
        sidebarRadius: sidebar.borderRadius,
        sidebarBackdrop: sidebar.backdropFilter || sidebar.webkitBackdropFilter,
        cardRadius: card.borderRadius,
        cardShadow: card.boxShadow,
        headingFont: heading.fontFamily,
        inactiveTabContrast: contrast(inactiveTab.color, inactiveTab.backgroundColor),
        radarFilterContrast: contrast(radarFilter.color, radarFilter.backgroundColor),
        primaryActionColor: primaryAction.color,
        primaryActionBackground: primaryAction.backgroundImage,
        newPageContrast: contrast(newPage.color, newPage.backgroundColor),
        externalArtwork: /url\(/i.test(before.backgroundImage + after.backgroundImage)
      };
    });
    expect(snapshots[theme].textContrast).toBeGreaterThanOrEqual(7);
    expect(snapshots[theme].secondaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(snapshots[theme].beforePointerEvents).toBe('none');
    expect(snapshots[theme].externalArtwork).toBe(false);
    expect(snapshots[theme].radarFilterContrast).toBeGreaterThanOrEqual(4.5);
    expect(snapshots[theme].newPageContrast).toBeGreaterThanOrEqual(4.5);
  }

  expect(snapshots.blueprint.beforeBackground).toContain('linear-gradient');
  expect(snapshots.blueprint.headingFont).toMatch(/Mono|Consolas/i);
  expect(snapshots.blueprint.sidebarRadius).toBe('3px');
  expect(snapshots.blueprint.inactiveTabContrast).toBeGreaterThanOrEqual(4.5);
  expect(snapshots.blueprint.primaryActionColor).toBe('rgb(3, 21, 31)');
  expect(snapshots.blueprint.primaryActionBackground).toContain('linear-gradient');
  expect(snapshots.paper.colorScheme).toBe('light');
  expect(snapshots.paper.sidebarBackdrop).toBe('none');
  expect(snapshots.paper.headingFont).toMatch(/Playfair|Georgia/i);
  expect(snapshots.paper.cardRadius).toBe('7px');
  expect(snapshots.paper.newPageContrast).toBeGreaterThanOrEqual(7);
  expect(snapshots.paper.primaryActionColor).toBe('rgb(255, 250, 241)');
  expect(snapshots.paper.primaryActionBackground).toContain('linear-gradient');
  expect(snapshots.arcade.colorScheme).toBe('dark');
  expect(snapshots.arcade.afterTransform).not.toBe('none');
  expect(snapshots.arcade.cardRadius).toBe('20px');
  expect(snapshots.arcade.beforeBackground).not.toBe(snapshots.blueprint.beforeBackground);
  expect(snapshots.arcade.inactiveTabContrast).toBeGreaterThanOrEqual(4.5);
  expect(snapshots.arcade.primaryActionColor).toBe('rgb(27, 8, 39)');
  expect(snapshots.arcade.primaryActionBackground).toContain('linear-gradient');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['blueprint', 'paper', 'arcade']) {
    await applyTheme(page, theme);
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      content: document.body.innerText.trim().length
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    expect(width.content).toBeGreaterThan(100);
    const mobileCta = await page.locator('.today-mobile-focus-cta').evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrastRatio(mobileCta.color, mobileCta.background)).toBeGreaterThanOrEqual(4.5);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => getComputedStyle(document.body, '::after').animationName)).toBe('none');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('signature-themes-e2e'));
  await page.reload();
  await page.waitForFunction(() => !!window.flowAtelier);
  await expect(page.locator('body')).toHaveAttribute('data-theme-key', 'arcade');
  expect(browserErrors).toEqual([]);
});
