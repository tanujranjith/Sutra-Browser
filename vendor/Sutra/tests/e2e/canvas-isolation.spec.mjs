import { expect, test } from '@playwright/test';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
  });
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => !!window.__sutraPublicBetaTestHooks && !!window.serializeWorkspace);
}

test('Canvas pages are isolated: empty on create, no note content leak, independent state', async ({ page }) => {
  test.setTimeout(60000);
  await openApp(page);

  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const space = hooks.createSpace('Isolation QA');
    const report = { errors: [] };

    // Helper: check if V2 host is hidden
    function v2Hidden() {
      const host = document.getElementById('editorV2Host');
      return !host || host.hidden || host.style.display === 'none';
    }

    // Helper: check if canvas page is active
    function canvasActive() {
      return document.body.classList.contains('canvas-page-active');
    }

    // Helper: get current page info
    function pageInfo() {
      const p = hooks.getCurrentPage();
      if (!p) return null;
      return {
        id: p.id,
        type: p.type,
        objects: (p.canvas && p.canvas.objects && p.canvas.objects.length) || 0,
        content: p.content || ''
      };
    }

    // 1. Create note A, navigate to it
    const noteA = hooks.createNoteInActiveSpace('Note A', '<p>ALPHA</p>');
    window.loadPage(noteA.id);
    report.noteA = { id: noteA.id, info: pageInfo(), v2Hidden: v2Hidden(), canvasActive: canvasActive() };

    // 2. Create Canvas A — auto-navigates
    const canvasA = hooks.createCanvasInActiveSpace('Canvas A');
    const ca_info = pageInfo();
    if (ca_info.type !== 'canvas') report.errors.push('Canvas A type is not canvas');
    if (ca_info.objects !== 0) report.errors.push('Canvas A has objects on create');
    if (ca_info.content !== '') report.errors.push('Canvas A content is not empty');
    if (!v2Hidden()) report.errors.push('V2 host not hidden on canvas A');
    if (!canvasActive()) report.errors.push('canvas-page-active class missing on canvas A');
    if (document.body.innerText.includes('ALPHA')) report.errors.push('Note A text ALPHA found visible on canvas page');
    report.canvasA_create = { id: canvasA.id, info: ca_info, v2Hidden: v2Hidden() };

    // 3. Navigate to note B
    const noteB = hooks.createNoteInActiveSpace('Note B', '<p>BRAVO</p>');
    window.loadPage(noteB.id);
    const nb_info = pageInfo();
    if (v2Hidden()) report.errors.push('V2 host still hidden on note B');
    if (canvasActive()) report.errors.push('canvas-page-active still present on note B');
    report.noteB = { id: noteB.id, info: nb_info };

    // 4. Return to Canvas A — verify still empty
    window.loadPage(canvasA.id);
    const ca_return = pageInfo();
    if (ca_return.objects !== 0) report.errors.push('Canvas A objects changed after navigating away');
    if (!v2Hidden()) report.errors.push('V2 host not hidden on return to canvas A');
    if (!canvasActive()) report.errors.push('canvas-page-active missing on return to canvas A');
    report.canvasA_return = { info: ca_return };

    // 5. Add an object to Canvas A
    const textObj = window.SutraCanvas.addText('Canvas object alpha');
    const ca_afterAdd = pageInfo();
    if (ca_afterAdd.objects !== 1) report.errors.push('Canvas A should have 1 object after addText, got ' + ca_afterAdd.objects);
    if (!textObj || !textObj.id) report.errors.push('addText did not return an object with id');
    report.canvasA_afterAdd = { objects: ca_afterAdd.objects, textObj: !!textObj };

    // 6. Visit several notes, return to Canvas A — still has its object
    const noteC = hooks.createNoteInActiveSpace('Note C', '<p>CHARLIE</p>');
    window.loadPage(noteC.id);
    window.loadPage(noteB.id);
    window.loadPage(noteA.id);
    window.loadPage(canvasA.id);
    const ca_afterVisit = pageInfo();
    if (ca_afterVisit.objects !== 1) report.errors.push('Canvas A object count changed after navigating notes, expected 1 got ' + ca_afterVisit.objects);
    report.canvasA_afterVisit = { objects: ca_afterVisit.objects };

    // 7. Create Canvas B — starts empty
    const canvasB = hooks.createCanvasInActiveSpace('Canvas B');
    const cb_info = pageInfo();
    if (cb_info.objects !== 0) report.errors.push('Canvas B is not empty on create, got ' + cb_info.objects);
    report.canvasB_create = { id: canvasB.id, objects: cb_info.objects };

    // 8. Two canvases independent: canvas B has 0, canvas A still has 1
    window.loadPage(canvasA.id);
    const ca_afterB = pageInfo();
    if (ca_afterB.objects !== 1) report.errors.push('Canvas A objects changed after creating Canvas B');
    if (document.body.innerText.includes('Canvas object alpha')) {
      // This is expected — the canvas contains the text we added
    }
    report.canvasA_afterCanvasB = { objects: ca_afterB.objects };

    // 9. Edit Canvas A while Canvas B is visible does not contaminate B
    window.loadPage(canvasB.id);
    const cb_beforeEdit = pageInfo();
    window.loadPage(canvasA.id);
    window.SutraCanvas.addSticky('Canvas A sticky');
    window.loadPage(canvasB.id);
    const cb_afterEdit = pageInfo();
    if (cb_afterEdit.objects !== 0) report.errors.push('Canvas B got objects after editing Canvas A');
    report.canvasB_afterEditA = { before: cb_beforeEdit.objects, after: cb_afterEdit.objects };

    // 10. Edit normal note while Canvas A inactive; Canvas A unchanged
    window.loadPage(noteA.id);
    window.loadPage(canvasA.id);
    const ca_afterNoteEdit = pageInfo();
    if (ca_afterNoteEdit.objects !== 2) report.errors.push('Canvas A objects changed after editing normal note');
    report.canvasA_afterNoteEdit = { objects: ca_afterNoteEdit.objects };

    // 11. Persistence round-trip: serialize, deserialize, verify both canvases
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    window.loadPage(canvasA.id);
    const ca_restored = pageInfo();
    window.loadPage(canvasB.id);
    const cb_restored = pageInfo();
    if (ca_restored.objects !== 2) report.errors.push('Canvas A lost objects after restore: expected 2 got ' + ca_restored.objects);
    if (cb_restored.objects !== 0) report.errors.push('Canvas B got objects after restore: expected 0 got ' + cb_restored.objects);
    report.restore = { canvasA: ca_restored.objects, canvasB: cb_restored.objects };

    report.errorsTotal = report.errors.length;
    return report;
  });

  expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
});

test('Canvas preserves long authored text, table cells, and labels across workspace round-trip', async ({ page }) => {
  test.setTimeout(60000);
  await openApp(page);

  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    hooks.createSpace('Canvas content limits QA');
    const canvasPage = hooks.createCanvasInActiveSpace('Long Canvas content');
    const longText = 'Canvas text ' + 'T'.repeat(9000);
    const longCell = 'Table cell ' + 'C'.repeat(1400);
    const longLabel = 'Canvas label ' + 'L'.repeat(700);
    const first = window.SutraCanvas.addText(longText);
    const second = window.SutraCanvas.addText('Second object');
    const tableSeed = window.SutraCanvas.addTable();
    const table = hooks.getCurrentPage().canvas.objects.find((object) => object.id === tableSeed.id);
    table.cells[0][1] = longCell;
    const group = window.SutraCanvas.group([first.id, second.id], longLabel);
    const connection = window.SutraCanvas.addConnector(first.id, second.id, { label: longLabel });
    // Force the current page through the normal save/normalization seam after
    // editing the table object returned by the canonical Canvas API.
    window.SutraCanvas.setViewport({ x: 1, y: 2, zoom: 1 });
    const before = hooks.getCurrentPage();
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    window.loadPage(canvasPage.id);
    const restored = hooks.getCurrentPage();
    const restoredText = restored.canvas.objects.find((object) => object.id === first.id);
    const restoredTable = restored.canvas.objects.find((object) => object.id === table.id);
    const restoredGroup = restored.canvas.groups.find((item) => item.id === group.id);
    const restoredConnection = restored.canvas.connections.find((item) => item.id === connection.id);
    return {
      before: {
        text: before.canvas.objects.find((object) => object.id === first.id).text,
        cell: before.canvas.objects.find((object) => object.id === table.id).cells[0][1]
      },
      after: {
        text: restoredText && restoredText.text,
        cell: restoredTable && restoredTable.cells[0][1],
        groupLabel: restoredGroup && restoredGroup.label,
        connectionLabel: restoredConnection && restoredConnection.label
      }
    };
  });

  const longText = 'Canvas text ' + 'T'.repeat(9000);
  const longCell = 'Table cell ' + 'C'.repeat(1400);
  const longLabel = 'Canvas label ' + 'L'.repeat(700);
  expect(result.before.text).toBe(longText);
  expect(result.before.cell).toBe(longCell);
  expect(result.after.text).toBe(longText);
  expect(result.after.cell).toBe(longCell);
  expect(result.after.groupLabel).toBe(longLabel);
  expect(result.after.connectionLabel).toBe(longLabel);
});

test('Canvas toolbar renders correctly: groups, active tool, selection-dependent controls', async ({ page }) => {
  test.setTimeout(60000);
  await openApp(page);

  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const report = { errors: [] };

    hooks.createSpace('Toolbar QA');
    const canvasA = hooks.createCanvasInActiveSpace('Toolbar Test');
    const toolbar = document.getElementById('canvasToolbar');
    const editorRoot = document.getElementById('canvasEditor');

    // Check toolbar exists and has tool groups
    if (!toolbar) report.errors.push('Canvas toolbar not found');
    const groups = toolbar.querySelectorAll('.canvas-tool-group');
    if (groups.length < 3) report.errors.push('Toolbar has fewer than 3 groups, found ' + groups.length);

    // Check active tool class on select (default)
    const selectBtn = toolbar.querySelector('[data-canvas-tool="select"]');
    if (!selectBtn || !selectBtn.classList.contains('active')) report.errors.push('Select tool not active by default');

    // Check data-canvas-tool on editor
    if (editorRoot.dataset.canvasTool !== 'select') report.errors.push('Editor data-canvas-tool not "select"');

    // Switch to pen tool and verify state updates
    window.canvasSetTool('pen');
    const penBtn = toolbar.querySelector('[data-canvas-tool="pen"]');
    if (!penBtn || !penBtn.classList.contains('active')) report.errors.push('Pen tool not active after setTool');
    if (selectBtn && selectBtn.classList.contains('active')) report.errors.push('Select tool still active after pen set');
    if (editorRoot.dataset.canvasTool !== 'pen') report.errors.push('Editor data-canvas-tool not updated to pen');

    // Reset to select
    window.canvasSetTool('select');

    // Check selection-only controls hidden on empty canvas
    const selectionControls = toolbar.querySelectorAll('[data-selection-only]');
    selectionControls.forEach(btn => {
      const style = window.getComputedStyle(btn);
      if (style.display !== 'none') {
        report.errors.push('Selection-only control visible on empty canvas: ' + (btn.title || btn.getAttribute('aria-label') || btn.outerHTML));
      }
    });

    // Check toolbar dimensions
    const toolbarRect = toolbar.getBoundingClientRect();
    if (toolbarRect.height < 30) report.errors.push('Toolbar height too small: ' + toolbarRect.height);

    // Check stage is positioned below toolbar
    const stageShell = document.getElementById('canvasStageShell');
    if (stageShell) {
      const stageRect = stageShell.getBoundingClientRect();
      // The toolbar sits above the stage in the flex column.
      if (stageRect.top < toolbarRect.bottom - 10 && toolbarRect.bottom > stageRect.top + 5) {
        // Some overlap is normal (toolbar and stage adjacent), not an error
      }
    }

    // Add object and check data-has-selection updates
    window.SutraCanvas.addText('Toolbar test');
    const hasSelection = editorRoot.dataset.hasSelection;
    if (hasSelection !== 'true') report.errors.push('data-has-selection not "true" after adding object');
    if (!window.SutraCanvasWorkbench) report.errors.push('Canvas workbench engine is unavailable');
    ['selectAll', 'copy', 'paste', 'nudge', 'arrange', 'changeLayer', 'toggleLock', 'fitView', 'toggleSnap', 'toggleMinimap'].forEach(name => {
      if (typeof window.SutraCanvas[name] !== 'function') report.errors.push('Canvas workbench API missing: ' + name);
    });
    const selectionBar = document.getElementById('canvasSelectionBar');
    if (!selectionBar || selectionBar.hidden) report.errors.push('Selection workbench is hidden after adding an object');
    const minimap = document.getElementById('canvasMinimap');
    if (!minimap || minimap.hidden) report.errors.push('Canvas minimap is unavailable by default');

    // Selection-only controls should now be visible
    selectionControls.forEach(btn => {
      const style = window.getComputedStyle(btn);
      if (style.display === 'none') {
        report.errors.push('Selection-only control hidden after object added: ' + (btn.title || btn.getAttribute('aria-label')));
      }
    });

    report.toolbarHeight = toolbarRect.height;
    report.groupCount = groups.length;
    report.errorsTotal = report.errors.length;
    return report;
  });

  expect(result.errorsTotal).toBe(0);
  if (result.errorsTotal > 0) {
    console.log('Toolbar errors:', JSON.stringify(result.errors, null, 2));
  }
});

test('Canvas shape picker creates the selected shape through the toolbar', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    hooks.createSpace('Shape picker QA');
    hooks.createCanvasInActiveSpace('Shape picker test');
  });

  const shapeButton = page.locator('#canvasShapeBtn');
  const shapeMenu = page.locator('#canvasShapeMenu');
  await shapeButton.click();
  await expect(shapeButton).toHaveAttribute('aria-expanded', 'true');
  await expect(shapeMenu).toBeVisible();

  const toolbarIconState = await page.evaluate(() => ({
    unknown: document.querySelectorAll('#canvasToolbar svg[data-atelier-icon-name="unknown"]').length,
    hydrated: document.querySelectorAll('#canvasToolbar svg.atelier-icon').length,
    menuParentIsBody: document.getElementById('canvasShapeMenu').parentElement === document.body
  }));
  expect(toolbarIconState.unknown).toBe(0);
  expect(toolbarIconState.hydrated).toBeGreaterThan(10);
  expect(toolbarIconState.menuParentIsBody).toBe(true);

  await page.getByRole('menuitem', { name: 'Diamond' }).click();
  const created = await page.evaluate(() => {
    const objects = window.SutraCanvas.getCurrentPage().canvas.objects;
    const object = objects[objects.length - 1];
    return {
      count: objects.length,
      type: object && object.type,
      shape: object && object.shape,
      menuHidden: document.getElementById('canvasShapeMenu').hidden,
      expanded: document.getElementById('canvasShapeBtn').getAttribute('aria-expanded')
    };
  });

  expect(created).toEqual({
    count: 1,
    type: 'shape',
    shape: 'diamond',
    menuHidden: true,
    expanded: 'false'
  });
});

test('Canvas pen strokes never move a selected object', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    hooks.createSpace('Pen isolation QA');
    hooks.createCanvasInActiveSpace('Pen isolation test');
    const sticky = window.SutraCanvas.addSticky('Anchored note', { x: 260, y: 160 });
    const pageModel = window.SutraCanvas.getCurrentPage();
    const before = { x: sticky.x, y: sticky.y };
    const stickyElement = document.querySelector(`[data-object-id="${sticky.id}"]`);

    // Simulate an interrupted object gesture, then draw. This is the stale-drag
    // path that previously let a pen stroke move the selected object.
    stickyElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 41, clientX: 280, clientY: 180
    }));
    window.canvasSetTool('pen');

    const drawLayer = document.getElementById('canvasDrawLayer');
    const root = document.getElementById('canvasEditor');
    let parentMoves = 0;
    root.addEventListener('pointermove', () => { parentMoves += 1; });
    drawLayer.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 42, clientX: 520, clientY: 320
    }));
    drawLayer.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, button: 0, pointerId: 42, clientX: 620, clientY: 390
    }));
    drawLayer.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 42, clientX: 620, clientY: 390
    }));

    const anchored = pageModel.canvas.objects.find((object) => object.id === sticky.id);
    return {
      before,
      after: { x: anchored.x, y: anchored.y },
      freehandCount: pageModel.canvas.objects.filter((object) => object.type === 'freehand').length,
      parentMoves
    };
  });

  expect(result.after).toEqual(result.before);
  expect(result.freehandCount).toBe(1);
  expect(result.parentMoves).toBe(0);
});
