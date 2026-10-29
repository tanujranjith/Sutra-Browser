import { expect, test } from '@playwright/test';

async function openApp(page, viewport) {
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
  });
}

async function showLongDevicesPanel(page, count = 18) {
  await page.evaluate((deviceCount) => {
    const underlay = document.createElement('div');
    underlay.id = 'sync-scroll-test-underlay';
    underlay.style.cssText = 'position:fixed;z-index:2;inset:120px 12vw 20px 24vw;overflow:auto;font:16px/2 sans-serif;white-space:pre-wrap;';
    underlay.textContent = Array.from({ length: 60 }, (_, index) => `${index + 1}. Underlying Notes workspace text`).join('\n');
    document.body.appendChild(underlay);
    underlay.scrollTop = 120;

    window.openSutraSyncModal();
    document.getElementById('sutraSyncSetup').hidden = true;
    document.getElementById('sutraSyncLocked').hidden = true;
    document.getElementById('sutraSyncRunning').hidden = false;
    document.getElementById('sutraSyncDevicesPanel').hidden = false;
    const list = document.getElementById('sutraSyncDevicesList');
    list.replaceChildren(...Array.from({ length: deviceCount }, (_, index) => {
      const item = document.createElement('li');
      if (index % 5 === 0) item.className = 'sync-item-revoked';
      const label = document.createElement('span');
      label.textContent = `device-${String(index + 1).padStart(2, '0')}`;
      const meta = document.createElement('span');
      meta.className = 'sync-item-meta';
      meta.textContent = index % 5 === 0 ? 'Revoked · Wipe pending' : 'Active · Last seen today';
      item.append(label, meta);
      return item;
    }));
  }, count);
  await expect(page.locator('#sutraCloudModal')).toHaveClass(/active/);
}

async function dialogLayout(page) {
  return page.locator('.sutra-sync-modal').evaluate((dialog) => {
    const body = dialog.querySelector('.modal-body');
    const style = getComputedStyle(dialog);
    const bodyStyle = getComputedStyle(body);
    const rect = dialog.getBoundingClientRect();
    const color = style.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      backgroundAlpha: color.length === 4 ? color[3] : 1,
      backdropFilter: style.backdropFilter,
      dialogOverflow: style.overflowY,
      bodyOverflow: bodyStyle.overflowY,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
}

test('long desktop Sync content is opaque, viewport-bound, and scroll-contained', async ({ page }) => {
  await openApp(page, { width: 1440, height: 900 });
  await page.evaluate(() => { document.body.dataset.theme = 'luxury'; });
  await showLongDevicesPanel(page);

  const layout = await dialogLayout(page);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.backgroundAlpha).toBe(1);
  expect(layout.backdropFilter).toBe('none');
  expect(layout.dialogOverflow).toBe('hidden');
  expect(layout.bodyOverflow).toBe('auto');
  expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);

  for (const theme of ['dark', 'glass', 'editorial']) {
    await page.evaluate((nextTheme) => { document.body.dataset.theme = nextTheme; }, theme);
    const themed = await dialogLayout(page);
    expect(themed.backgroundAlpha, `${theme} Sync surface must remain opaque`).toBe(1);
    expect(themed.backdropFilter, `${theme} Sync surface must not reveal workspace text`).toBe('none');
  }

  const body = page.locator('.sutra-sync-modal > .modal-body');
  await body.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const underlayBefore = await page.locator('#sync-scroll-test-underlay').evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 5000);
  expect(await page.locator('#sync-scroll-test-underlay').evaluate((node) => node.scrollTop)).toBe(underlayBefore);
  await page.locator('.sutra-sync-advanced').scrollIntoViewIfNeeded();
  await expect(page.locator('.sutra-sync-advanced')).toBeInViewport();
});

test('long phone Sync content stays within the viewport without document overflow', async ({ page }) => {
  await openApp(page, { width: 390, height: 844 });
  await showLongDevicesPanel(page, 12);

  const layout = await dialogLayout(page);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.documentOverflow).toBeLessThanOrEqual(2);
  expect(layout.backgroundAlpha).toBe(1);
  expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);

  const body = page.locator('.sutra-sync-modal > .modal-body');
  await body.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const headerGeometry = await page.evaluate(() => {
    const header = document.querySelector('.sutra-sync-modal > .modal-header');
    const body = document.querySelector('.sutra-sync-modal > .modal-body');
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      headerHeight: headerRect.height,
      headerBottom: headerRect.bottom,
      bodyTop: bodyRect.top
    };
  });
  expect(headerGeometry.headerHeight).toBeGreaterThanOrEqual(40);
  expect(headerGeometry.bodyTop).toBeGreaterThanOrEqual(headerGeometry.headerBottom);
});
