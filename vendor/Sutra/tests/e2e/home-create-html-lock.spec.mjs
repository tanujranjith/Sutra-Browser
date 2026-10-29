import { expect, test } from '@playwright/test';
import { waitForAppHydrated, waitForAppReady } from './helpers/app-ready.mjs';

async function openApp(page, { durable = true } = {}) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch (error) {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!window.flowAtelier && !!window.SutraHTMLPages && !!window.SutraWorkspaceLock);
  // Notes layout is owned by the hydrated shell. This prevents the fixture
  // from measuring a pre-hydration layout that can be replaced a moment later.
  if (durable) {
    await waitForAppReady(page);
  } else {
    await waitForAppHydrated(page);
  }
}

test('Home/Create labels and Home quick task use the canonical task path', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.top-nav .view-tabs > [data-view="today"]')).toContainText('Home');
  await expect(page.locator('.top-nav .view-tabs > [data-view="notes"]')).toContainText('Create');

  await page.locator('.top-nav .view-tabs > [data-view="today"]').click();
  const input = page.locator('#homeQuickTaskInput');
  await input.fill('Read chapter seven');
  await input.press('Enter');
  await expect(page.locator('#homeQuickTaskStatus')).toContainText('Added Read chapter seven', { timeout: 15_000 });
  await expect(input).toHaveValue('');

  const task = await page.evaluate(() => window.flowAtelier.tasks.find((item) => item.title === 'Read chapter seven'));
  expect(task).toMatchObject({ scheduleType: 'once', priority: 'medium', difficulty: 'medium', isActive: true });
  expect(task.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('HTML Pages import, execute locally, persist source, and clear locked content', async ({ page }) => {
  await openApp(page);
  const pageId = await page.evaluate(() => window.SutraHTMLPages.createPage('Lab demo', {
    source: '<h1 id="sandbox-result">Sandbox works</h1><img src="https://example.com/blocked.png"><script>document.body.dataset.ran="yes"</script>'
  }).id);

  await expect(page.locator('#htmlPageEditor')).toBeVisible();
  await expect(page.locator('#htmlPageEditor .html-page-preview')).toBeVisible();
  await expect(page.locator('#htmlPageEditor .html-page-code')).toBeHidden();
  await expect(page.locator('[data-html-edit-source]')).toHaveText('Edit source');
  const frame = page.frameLocator('#htmlPageEditor [data-html-preview] iframe');
  await expect(frame.locator('#sandbox-result')).toHaveText('Sandbox works');
  await expect(frame.locator('body')).toHaveAttribute('data-ran', 'yes');
  await expect(page.locator('[data-html-asset-warning]')).toBeVisible();

  await page.locator('[data-html-edit-source]').click();
  await expect(page.locator('#htmlPageEditor .html-page-code')).toBeVisible();
  await expect(page.locator('[data-html-source]')).toBeFocused();
  await expect(page.locator('[data-html-edit-source]')).toHaveText('Close source');
  await page.locator('[data-html-edit-source]').click();
  await expect(page.locator('#htmlPageEditor .html-page-code')).toBeHidden();

  const policy = await page.locator('#htmlPageEditor [data-html-preview] iframe').evaluate((node) => ({
    sandbox: node.getAttribute('sandbox'),
    srcdoc: node.getAttribute('srcdoc')
  }));
  expect(policy.sandbox).toBe('allow-scripts');
  expect(policy.srcdoc).toContain("connect-src 'none'");
  expect(policy.srcdoc).toContain("form-action 'none'");
  expect(policy.srcdoc).toContain("navigate-to 'none'");

  await page.locator('[data-html-import]').setInputFiles({
    name: 'lesson.htm',
    mimeType: 'text/html',
    buffer: Buffer.from('<main><h2>Imported lesson</h2></main><script>document.body.dataset.imported="true"</script>')
  });
  await expect(page.locator('[data-html-source]')).toHaveValue(/Imported lesson/);
  await expect(frame.locator('h2')).toHaveText('Imported lesson');
  await expect(page.locator('[data-html-save-status]')).toContainText('Saved locally', { timeout: 15_000 });

  const roundTrip = await page.evaluate((id) => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const stored = payload.pages.find((item) => item.id === id);
    return { document: stored.htmlDocument, keys: Object.keys(stored.htmlDocument || {}) };
  }, pageId);
  expect(roundTrip.document.version).toBe(1);
  expect(roundTrip.document.source).toContain('Imported lesson');
  expect(roundTrip.keys.sort()).toEqual(['createdAt', 'source', 'updatedAt', 'version']);

  await page.evaluate(async ({ id }) => {
    await window.__sutraPublicBetaTestHooks.lockPageWithPin(id, '2468');
    window.loadPage(id);
  }, { id: pageId });
  await expect(page.locator('#htmlPageEditor')).toBeHidden();
  await expect(page.locator('[data-html-source]')).toHaveValue('');
  await expect(page.locator('#htmlPageEditor [data-html-preview] iframe')).toHaveCount(0);
});

test('HTML Pages keep Preview first and switch Code/Preview on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.setActiveView('notes'));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'notes');
  await page.evaluate(() => window.SutraHTMLPages.createPage('Mobile HTML', { source: '<h1>Mobile preview</h1>' }));

  const editor = page.locator('#htmlPageEditor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.html-page-mobile-tabs')).toBeVisible();
  await expect(editor.locator('.html-page-code')).toBeHidden();
  await expect(editor.locator('.html-page-preview')).toBeVisible();

  await editor.locator('[data-html-panel="code"]').click();
  await expect(editor.locator('.html-page-code')).toBeVisible();
  await expect(editor.locator('.html-page-preview')).toBeHidden();
  await editor.locator('[data-html-panel="preview"]').click();
  await expect(editor.locator('.html-page-code')).toBeHidden();
  await expect(editor.locator('.html-page-preview')).toBeVisible();
});

test('HTML Pages fill Create, isolate preview scrolling, and restore the Notes toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const shortPageId = await page.evaluate(() => window.SutraHTMLPages.createPage('Geometry HTML', { source: '<h1>Short HTML</h1>' }).id);
  const editor = page.locator('#htmlPageEditor');
  const frameElement = editor.locator('[data-html-preview] iframe');
  await expect(editor).toBeVisible();
  await expect(frameElement).toBeVisible();

  const shortMetrics = await page.evaluate(() => {
    const getRect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const view = getRect('#view-notes');
    const html = getRect('#htmlPageEditor');
    const host = getRect('#htmlPageEditor [data-html-preview]');
    const iframe = getRect('#htmlPageEditor [data-html-preview] iframe');
    return {
      view,
      html,
      host,
      iframe,
      toolbarDisplay: getComputedStyle(document.querySelector('#view-notes .toolbar-wrapper')).display
    };
  });
  expect(shortMetrics.toolbarDisplay).toBe('none');
  expect(shortMetrics.html.top).toBeGreaterThanOrEqual(shortMetrics.view.top + 70);
  expect(shortMetrics.html.bottom).toBeGreaterThanOrEqual(shortMetrics.view.bottom - 2);
  expect(shortMetrics.html.height).toBeGreaterThan(800);
  expect(Math.abs(shortMetrics.iframe.width - shortMetrics.host.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(shortMetrics.iframe.bottom - shortMetrics.host.bottom)).toBeLessThanOrEqual(1);

  const source = '<!doctype html><html><head><style>body{margin:0}main{height:1800px}</style></head><body><main>Long HTML</main></body></html>';
  await editor.locator('[data-html-edit-source]').click();
  await editor.locator('[data-html-source]').fill(source);
  await editor.locator('[data-html-edit-source]').click();
  await expect(frameElement).toBeVisible();
  const previewFrame = page.frameLocator('#htmlPageEditor [data-html-preview] iframe');
  await expect(previewFrame.locator('main')).toHaveText('Long HTML');
  const longMetrics = {
    frameHeight: await frameElement.evaluate((node) => node.clientHeight),
    bodyHeight: await previewFrame.locator('html').evaluate((node) => node.scrollHeight)
  };
  expect(longMetrics.bodyHeight).toBeGreaterThan(longMetrics.frameHeight);

  await page.evaluate((id) => {
    const normalPage = window.flowAtelier.pages.find((item) => item.id !== id && !item.htmlDocument);
    window.loadPage(normalPage.id);
  }, shortPageId);
  await expect(editor).toBeHidden();
  await expect(page.locator('#view-notes .toolbar-wrapper')).toBeVisible();
  await page.evaluate((id) => window.loadPage(id), shortPageId);
  await expect(editor).toBeVisible();
  await expect(page.locator('#view-notes .toolbar-wrapper')).toBeHidden();
});

test('HTML Pages keep a bounded preview at the compact desktop breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);
  await page.evaluate(() => window.SutraHTMLPages.createPage('Compact HTML', { source: '<h1>Compact preview</h1>' }));
  const editor = page.locator('#htmlPageEditor');
  const frame = editor.locator('[data-html-preview] iframe');
  await expect(editor).toBeVisible();
  await expect(frame).toBeVisible();
  const metrics = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    return { view: rect('#view-notes'), html: rect('#htmlPageEditor'), iframe: rect('#htmlPageEditor [data-html-preview] iframe'), toolbar: getComputedStyle(document.querySelector('#view-notes .toolbar-wrapper')).display, documentWidth: document.documentElement.scrollWidth };
  });
  expect(metrics.toolbar).toBe('none');
  expect(metrics.html.height).toBeGreaterThan(metrics.view.height * 0.75);
  expect(metrics.iframe.bottom).toBeLessThanOrEqual(metrics.html.bottom + 1);
  expect(metrics.documentWidth).toBeLessThanOrEqual(1024);
});

test('Create notes scroll underneath the frosted desktop tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const layout = await page.evaluate(async () => {
    window.setActiveView('notes');
    const scroller = document.getElementById('mainContent');
    const view = document.getElementById('view-notes');
    const nav = document.querySelector('.top-nav');
    const marker = document.createElement('div');
    marker.id = 'frosted-nav-scroll-marker';
    marker.textContent = 'Scrolling note text passes behind the tab bar';
    marker.style.cssText = 'height:1600px;padding:8px 28px;font-size:24px;line-height:1.5;';
    view.prepend(marker);
    scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const start = marker.getBoundingClientRect().top;
    scroller.scrollTop = 140;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const navRect = nav.getBoundingClientRect();
    const style = getComputedStyle(nav);
    return {
      mainTop: scroller.getBoundingClientRect().top,
      start,
      after: marker.getBoundingClientRect().top,
      navBottom: navRect.bottom,
      backdrop: style.backdropFilter || style.webkitBackdropFilter,
      background: style.backgroundColor
    };
  });

  expect(layout.mainTop).toBe(0);
  expect(layout.start).toBeGreaterThanOrEqual(layout.navBottom);
  expect(layout.after).toBeLessThan(layout.navBottom);
  expect(layout.backdrop).toMatch(/blur/);
});

test('Create formatting toolbar remains below the tab bar while notes scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const layout = await page.evaluate(async () => {
    window.setActiveView('notes');
    const scroller = document.getElementById('mainContent');
    const view = document.getElementById('view-notes');
    const nav = document.querySelector('.top-nav');
    const toolbar = view.querySelector('.toolbar-wrapper');
    const filler = document.createElement('div');
    filler.id = 'toolbar-scroll-filler';
    filler.style.height = '1800px';
    filler.setAttribute('aria-hidden', 'true');
    view.append(filler);
    scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const start = toolbar.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    scroller.scrollTop = 480;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = toolbar.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    return {
      navBottom: navRect.bottom,
      startTop: start.top,
      afterTop: after.top,
      display: style.display,
      position: style.position
    };
  });

  expect(layout.display).not.toBe('none');
  expect(layout.position).toBe('fixed');
  expect(layout.startTop).toBeCloseTo(layout.navBottom, 0);
  expect(layout.afterTop).toBeCloseTo(layout.navBottom, 0);
});

test('workspace privacy gate verifies PINs, refresh-locks, crosses tabs, and refuses failed storage', async ({ page, context, browserName }) => {
  test.setTimeout(90_000);
  await openApp(page);

  const enabled = await page.evaluate(() => window.SutraWorkspaceLock.enable('2468', 5));
  expect(enabled.ok).toBe(true);
  await expect(page.locator('#sutraWorkspaceLockScreen')).toBeVisible();
  await expect(page.locator('.app-container')).toHaveAttribute('inert', '');

  const raw = await page.evaluate(() => localStorage.getItem('sutra:workspaceLock:v1'));
  expect(raw).not.toContain('2468');
  expect(JSON.parse(raw)).toMatchObject({ version: 1, enabled: true, inactivityTimeout: 5, iterations: 120000 });

  await page.locator('#sutraWorkspaceUnlockPin').fill('1111');
  await page.locator('#sutraWorkspaceUnlockForm button').click();
  await expect(page.locator('#sutraWorkspaceUnlockError')).toContainText('incorrect', { timeout: 30_000 });
  await page.locator('#sutraWorkspaceUnlockPin').fill('2468');
  await page.locator('#sutraWorkspaceUnlockForm button').click();
  await expect(page.locator('#sutraWorkspaceLockScreen')).toBeHidden();

  if (browserName !== 'webkit') {
    await page.reload();
    await expect(page.locator('#sutraWorkspaceLockScreen')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-sutra-workspace-locked'))).toBe('true');
    await page.locator('#sutraWorkspaceUnlockPin').fill('2468');
    await page.locator('#sutraWorkspaceUnlockForm button').click();
    await expect(page.locator('#sutraWorkspaceLockScreen')).toBeHidden();
  }

  if (browserName !== 'webkit') {
    const second = await context.newPage();
    // A second tab must hydrate without making a durable write. Its snapshot
    // intentionally predates the primary tab's subsequent lock mutation.
    await openApp(second, { durable: false });
    await expect(second.locator('#sutraWorkspaceLockScreen')).toBeVisible();
    await second.locator('#sutraWorkspaceUnlockPin').fill('2468');
    await second.locator('#sutraWorkspaceUnlockForm button').click();
    await expect(second.locator('#sutraWorkspaceLockScreen')).toBeHidden();

    await page.evaluate(() => window.SutraWorkspaceLock.lock());
    await expect(second.locator('#sutraWorkspaceLockScreen')).toBeVisible();

    const disabled = await page.evaluate(() => window.SutraWorkspaceLock.disable('2468'));
    expect(disabled.ok).toBe(true);
    await expect(second.locator('#sutraWorkspaceLockScreen')).toBeHidden();
  } else {
    await page.evaluate(() => window.SutraWorkspaceLock.lock());
    await expect(page.locator('#sutraWorkspaceLockScreen')).toBeVisible();
    const disabled = await page.evaluate(() => window.SutraWorkspaceLock.disable('2468'));
    expect(disabled.ok).toBe(true);
    await expect(page.locator('#sutraWorkspaceLockScreen')).toBeHidden();
  }

  const failed = await page.evaluate(async () => {
    const original = window.SutraSafeStorage.set;
    window.SutraSafeStorage.set = () => ({ ok: false, classification: 'quota' });
    const result = await window.SutraWorkspaceLock.enable('1357', 5);
    window.SutraSafeStorage.set = original;
    return { result, raw: localStorage.getItem('sutra:workspaceLock:v1') };
  });
  expect(failed.result.ok).toBe(false);
  expect(JSON.parse(failed.raw).enabled).toBe(false);
  expect(failed.raw).not.toContain('1357');
});

test('workspace privacy lock offers expanded presets and a custom duration', async ({ page }) => {
  await openApp(page);
  const options = await page.locator('#sutraWorkspaceLockTimeout option').allTextContents();
  expect(options).toEqual(expect.arrayContaining(['1 minute', '10 minutes', '45 minutes', '2 hours', '12 hours', 'Custom…']));

  await page.evaluate(() => window.SutraWorkspaceLock.enable('2468', 5));
  await page.locator('#sutraWorkspaceUnlockPin').fill('2468');
  await page.locator('#sutraWorkspaceUnlockForm button').click();
  await expect(page.locator('#sutraWorkspaceLockScreen')).toBeHidden();

  await page.evaluate(() => window.setActiveView('settings'));
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.locator('[data-settings-nav="data"]').click();
  await page.locator('#sutraWorkspaceLockTimeout').evaluate((select) => {
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#sutraWorkspaceLockCustomWrap')).toBeVisible();
  await page.locator('#sutraWorkspaceLockCustomMinutes').fill('137');
  await page.locator('#sutraWorkspaceLockCustomApply').click();
  await page.locator('[data-lock-current]').fill('2468');
  await page.locator('[data-lock-submit]').click();
  await expect(page.locator('#sutraWorkspaceLockScreen')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sutra:workspaceLock:v1')).inactivityTimeout)).toBe(137);

  await page.locator('#sutraWorkspaceUnlockPin').fill('2468');
  await page.locator('#sutraWorkspaceUnlockForm button').click();
  await expect(page.locator('#sutraWorkspaceLockScreen')).toBeHidden();
  await page.evaluate(() => window.SutraWorkspaceLock.disable('2468'));
});

test('Sheets V2 reopens its local XLSX package and Slides normalizes V1 decks', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const engine = window.SutraSheetsEngine;
    const workbook = engine.createWorkbook('Science lab');
    const sheet = workbook.sheets[0];
    sheet.name = 'Results';
    engine.setCell(sheet, 0, 0, { value: 'Trial' });
    engine.setCell(sheet, 0, 1, { value: 6 });
    engine.setCell(sheet, 1, 1, { formula: '=B1*3' });
    sheet.merges.push('A3:B3');
    sheet.frozen.rows = 1;
    const blob = await window.SutraOfficeInterop.exportXlsx(workbook);
    const imported = await window.SutraOfficeInterop.importXlsx(blob);
    const importedSheet = imported.workbook.sheets[0];
    const deck = window.SutraSlides.normalizeDeck({
      version: 1,
      futureDeckField: { keep: true },
      slides: [{ id: 'legacy', title: 'Legacy', futureSlideField: 9, elements: [{ id: 'text', type: 'text', text: 'Hello', futureElementField: true }] }]
    }, 'Legacy deck');
    return {
      workbookVersion: imported.workbook.version,
      sheetName: importedSheet.name,
      firstValue: engine.cellAt(importedSheet, 0, 0).value,
      formula: engine.cellAt(importedSheet, 1, 1).formula,
      frozen: importedSheet.frozen.rows,
      merges: importedSheet.merges,
      warnings: imported.report.warnings,
      deckVersion: deck.version,
      futureDeckField: deck.futureDeckField,
      futureSlideField: deck.slides[0].futureSlideField,
      futureElementField: deck.slides[0].elements[0].futureElementField
    };
  });
  expect(result).toMatchObject({
    workbookVersion: 2,
    sheetName: 'Results',
    firstValue: 'Trial',
    formula: '=B1*3',
    frozen: 1,
    merges: ['A3:B3'],
    warnings: [],
    deckVersion: 2,
    futureDeckField: { keep: true },
    futureSlideField: 9,
    futureElementField: true
  });
});

test('Slides and Sheets expose the student productivity V2 controls', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!window.SutraSlides && !!window.SutraSheets);

  await page.evaluate(() => window.SutraSlides.createPage('Class presentation'));
  await expect(page.locator('#slidesEditor')).toBeVisible();
  await expect(page.locator('#slidesEditor [data-import-pptx]')).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('#slidesEditor .slides-element-table')).toBeVisible();
  await page.locator('#slidesEditor [data-slide-background]').evaluate((input) => {
    input.value = '#dbeafe';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#slidesEditor .slides-stage')).toHaveCSS('background-color', 'rgb(219, 234, 254)');

  await page.evaluate(() => window.SutraSheets.createPage('Grade tracker'));
  await expect(page.locator('#sheetsEditor')).toBeVisible();
  const formula = page.locator('#sheetsEditor [data-formula]');
  await page.locator('#sheetsEditor [aria-label="A1"]').click();
  await formula.fill('Assignment');
  await formula.press('Enter');
  await page.locator('#sheetsEditor [aria-label="B1"]').click();
  await formula.fill('Score');
  await formula.press('Enter');
  await page.locator('#sheetsEditor [aria-label="B2"]').click();
  await formula.fill('12');
  await formula.press('Enter');
  await page.locator('#sheetsEditor [aria-label="A1"]').click();
  await page.locator('#sheetsEditor [aria-label="B2"]').click({ modifiers: ['Shift'] });
  await page.locator('#sheetsEditor [data-bold]').click();
  await page.locator('#sheetsEditor [data-align]').selectOption('center');
  await page.locator('#sheetsEditor [data-chart]').click();
  await expect(page.locator('#sheetsEditor [data-chart-panel]')).toBeVisible();

  const state = await page.evaluate(() => {
    const workbook = window.SutraSheets.getWorkbook();
    const sheet = workbook.sheets[0];
    const cell = window.SutraSheetsEngine.cellAt(sheet, 0, 0);
    return { style: workbook.styles[cell.styleId], chartCount: sheet.charts.length };
  });
  expect(state.style).toMatchObject({ fontWeight: '700', textAlign: 'center' });
  expect(state.chartCount).toBe(1);
});

test('phone Slides and Sheets keep a usable editing surface', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.waitForFunction(() => !!window.SutraSlides && !!window.SutraSheets);

  await page.evaluate(() => window.SutraSlides.createPage('Phone presentation'));
  const slidesLayout = await page.evaluate(() => {
    const root = document.getElementById('slidesEditor');
    const workspace = root.querySelector('.slides-workspace');
    const stage = root.querySelector('.slides-stage');
    const thumbnails = root.querySelector('.slides-thumbnails');
    const toolbarButton = root.querySelector('.slides-toolbar-btn');
    return {
      workspaceDisplay: getComputedStyle(workspace).display,
      stageTop: stage.getBoundingClientRect().top,
      thumbnailsTop: thumbnails.getBoundingClientRect().top,
      thumbnailHeight: thumbnails.getBoundingClientRect().height,
      toolbarButtonHeight: toolbarButton.getBoundingClientRect().height
    };
  });
  expect(slidesLayout.workspaceDisplay).toBe('flex');
  expect(slidesLayout.thumbnailsTop).toBeGreaterThan(slidesLayout.stageTop);
  expect(slidesLayout.thumbnailHeight).toBeGreaterThanOrEqual(66);
  expect(slidesLayout.toolbarButtonHeight).toBeGreaterThanOrEqual(44);

  await page.evaluate(() => window.SutraSheets.createPage('Phone grades'));
  const sheetsLayout = await page.evaluate(() => {
    const root = document.getElementById('sheetsEditor');
    const toolbarButton = root.querySelector('.sheets-toolbar button');
    const formula = root.querySelector('.sheets-formula input');
    const grid = root.querySelector('.sheets-grid-wrap');
    return {
      toolbarHeight: root.querySelector('.sheets-toolbar').getBoundingClientRect().height,
      toolbarButtonHeight: toolbarButton.getBoundingClientRect().height,
      formulaHeight: formula.getBoundingClientRect().height,
      gridHeight: grid.getBoundingClientRect().height
    };
  });
  expect(sheetsLayout.toolbarHeight).toBeGreaterThanOrEqual(58);
  expect(sheetsLayout.toolbarButtonHeight).toBeGreaterThanOrEqual(44);
  expect(sheetsLayout.formulaHeight).toBeGreaterThanOrEqual(40);
  expect(sheetsLayout.gridHeight).toBeGreaterThanOrEqual(320);
});
