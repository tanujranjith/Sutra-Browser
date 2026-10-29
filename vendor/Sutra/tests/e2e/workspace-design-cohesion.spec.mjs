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
  await page.waitForFunction(() => !!window.SutraHomework && typeof window.setActiveView === 'function');
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    window.setApplyMode?.('all');
    await window.applyPresetTheme?.('default');
  });
}

test('default workspace palette keeps supporting text and primary actions readable', async ({ page }) => {
  await openApp(page);

  const design = await page.evaluate(() => {
    const resolveColor = variable => {
      const probe = document.createElement('span');
      probe.style.color = `var(${variable})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const activeTab = document.querySelector('.view-tab.active');
    const primary = document.querySelector('.today-hero-primary');
    const primaryStyle = getComputedStyle(primary);
    const activeStyle = getComputedStyle(activeTab);
    const activeIndicatorStyle = getComputedStyle(activeTab, '::after');
    return {
      background: resolveColor('--bg-primary'),
      muted: resolveColor('--text-muted'),
      accentStrong: resolveColor('--accent-strong'),
      primaryColor: primaryStyle.color,
      primaryBackground: primaryStyle.backgroundColor,
      activeBackground: activeStyle.backgroundColor,
      activeIndicatorOpacity: Number(activeIndicatorStyle.opacity)
    };
  });

  expect(contrastRatio(design.muted, design.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(design.accentStrong, design.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(design.primaryColor, design.primaryBackground)).toBeGreaterThanOrEqual(4.5);
  expect(design.activeBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(design.activeIndicatorOpacity).toBeGreaterThan(0);
});

test('Cancel for now dismisses empty Homework setup for the current session', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.setActiveView('homework'));

  const setup = page.locator('#hwSetupOverlay');
  await expect(setup).toBeVisible();
  await expect(setup).toHaveAttribute('role', 'dialog');
  await expect(setup).toHaveAttribute('aria-modal', 'true');
  await setup.getByRole('button', { name: 'Cancel for now' }).click();
  await expect(setup).toBeHidden();

  await page.evaluate(() => window.setActiveView('today'));
  await page.evaluate(() => window.setActiveView('homework'));
  await expect(setup).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
});
