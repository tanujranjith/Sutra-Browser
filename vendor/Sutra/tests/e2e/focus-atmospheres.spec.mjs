import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

async function openFocusSession(page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const onboarding = document.getElementById('studentOnboardingOverlay');
    if (onboarding) {
      onboarding.classList.remove('active');
      onboarding.hidden = true;
      onboarding.style.setProperty('display', 'none', 'important');
    }
    window.startFocusSession(null, {
      title: 'Read Chapter 7',
      note: 'Biology - Cell respiration',
      plannedDurationSeconds: 25 * 60
    });
  });
  await page.locator('#focusSessionOverlay').waitFor({ state: 'visible' });
}

test('Focus atmospheres are distinct glass surfaces without disrupting the timer', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openFocusSession(page);

  const overlay = page.locator('#focusSessionOverlay');
  const stage = page.locator('.fs-content');
  const timer = page.locator('#fsTimerDisplay');
  const presentation = await overlay.evaluate((node) => {
    const overlayStyle = getComputedStyle(node);
    const stageStyle = getComputedStyle(node.querySelector('.fs-content'));
    const rect = node.querySelector('.fs-content').getBoundingClientRect();
    return {
      overlayBackground: overlayStyle.backgroundColor,
      overlayBackdrop: overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter,
      stageBackdrop: stageStyle.backdropFilter || stageStyle.webkitBackdropFilter,
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
    };
  });

  expect(presentation.overlayBackground).toMatch(/^rgba\(/);
  expect(presentation.overlayBackdrop).toContain('blur(');
  expect(presentation.stageBackdrop).toContain('blur(');
  expect(presentation.rect.top).toBeGreaterThanOrEqual(0);
  expect(presentation.rect.left).toBeGreaterThanOrEqual(0);
  expect(presentation.rect.right).toBeLessThanOrEqual(1440);
  expect(presentation.rect.bottom).toBeLessThanOrEqual(900);

  const visualTokens = [];
  for (const preset of ['gradient', 'fireplace', 'nightsky', 'rain', 'library']) {
    const chip = page.locator(`.fs-ambient-chip[data-ambient="${preset}"]`);
    await chip.click();
    await expect(overlay).toHaveAttribute('data-ambient', preset);
    await expect(page.locator('#fsAmbientBg')).toHaveAttribute('data-ambient', preset);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(timer).toHaveText('25:00');
    visualTokens.push(await overlay.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.getPropertyValue('--fs-accent-rgb')}|${style.getPropertyValue('--fs-stage')}`;
    }));
  }
  expect(new Set(visualTokens).size).toBe(5);

  await page.locator('#fsPlayBtn').click();
  await expect(page.locator('#fsStatusPill')).toContainText('Focusing');
  await page.waitForTimeout(1_150);
  await expect(timer).not.toHaveText('25:00');
  await page.locator('#fsPlayBtn').click();
  await expect(page.locator('#fsStatusPill')).toContainText('Paused');

  await page.locator('#fsNotesBtn').click();
  await expect(page.locator('#fsNotesPanel')).toBeVisible();
  await page.locator('#fsNotesTextarea').fill('Remember the Krebs cycle diagram.');
  await page.getByRole('button', { name: 'Close notes panel' }).click();
  await expect(page.locator('#fsNotesPanel')).toBeHidden();
  await expect(stage).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Focus atmosphere controls remain reachable and contained on a phone', async ({ page }) => {
  await openFocusSession(page, { width: 390, height: 844 });

  const measurements = await page.locator('#focusSessionOverlay').evaluate((overlay) => {
    const stage = overlay.querySelector('.fs-content').getBoundingClientRect();
    const bar = overlay.querySelector('.fs-ambient-bar').getBoundingClientRect();
    const touchTargets = [
      ...overlay.querySelectorAll('.fs-topbar .fs-icon-btn, .fs-actions .fs-action-btn:not([hidden]), .fs-ambient-chip')
    ].filter((node) => node.offsetParent !== null).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        name: node.getAttribute('aria-label') || node.textContent.trim(),
        width: rect.width,
        height: rect.height
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: { top: stage.top, left: stage.left, right: stage.right, bottom: stage.bottom },
      bar: { left: bar.left, right: bar.right, scrollWidth: overlay.querySelector('.fs-ambient-bar').scrollWidth },
      touchTargets,
      documentWidth: document.documentElement.scrollWidth
    };
  });

  expect(measurements.stage.top).toBeGreaterThanOrEqual(0);
  expect(measurements.stage.left).toBeGreaterThanOrEqual(0);
  expect(measurements.stage.right).toBeLessThanOrEqual(measurements.viewport.width);
  expect(measurements.stage.bottom).toBeLessThanOrEqual(measurements.viewport.height);
  expect(measurements.bar.left).toBeGreaterThanOrEqual(measurements.stage.left);
  expect(measurements.bar.right).toBeLessThanOrEqual(measurements.stage.right);
  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewport.width);
  for (const target of measurements.touchTargets) {
    expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
  }

  for (const preset of ['gradient', 'fireplace', 'nightsky', 'rain', 'library']) {
    const chip = page.locator(`.fs-ambient-chip[data-ambient="${preset}"]`);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect(page.locator('#focusSessionOverlay')).toHaveAttribute('data-ambient', preset);
  }
});

test('Focus atmosphere motion respects reduced-motion preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFocusSession(page);
  const animations = await page.locator('#fsAmbientBg').evaluate((node) => ({
    node: getComputedStyle(node).animationName,
    before: getComputedStyle(node, '::before').animationName,
    after: getComputedStyle(node, '::after').animationName
  }));
  expect(animations).toEqual({ node: 'none', before: 'none', after: 'none' });
});
