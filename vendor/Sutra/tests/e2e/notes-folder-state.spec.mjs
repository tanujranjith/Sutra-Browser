import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => !!window.__sutraPublicBetaTestHooks
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => {
    if (typeof window.markStudentOnboardingCompleted === 'function') {
      window.markStudentOnboardingCompleted(true);
    }
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
    window.flowAtelier.flushAppSaveNow('notes-folder-state-ready');
  });
  await page.locator('.view-tabs > .view-tab[data-view="notes"]').click();
}

async function createFolder(page, name) {
  await page.locator('.new-folder-btn').click();
  await expect(page.locator('#newPageModal')).toHaveClass(/active/);
  await page.locator('#newPageName').fill(name);
  await page.locator('#newPageConfirmBtn').click();
  await expect(page.locator('#newPageModal')).not.toHaveClass(/active/);
  return page.evaluate((folderName) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const folder = hooks.getPagesForSpace(hooks.getActiveSpaceId()).find(item => item.title === folderName);
    return folder && folder.id;
  }, name);
}

test('Page Setup keeps all six types visible through narrow widths and zoom', async ({ page }) => {
  await openApp(page);
  await page.locator('.new-page-btn').click();
  const toggle = page.locator('#newPageTypeToggle');
  await expect(toggle.locator('button')).toHaveCount(6);
  for (const width of [1280, 1024, 870, 840, 600, 375]) {
    await page.setViewportSize({ width, height: 850 });
    for (const zoom of ['100%', '150%', '200%']) {
      await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
      await expect.poll(() => page.evaluate(() => {
        const group = document.getElementById('newPageTypeToggle');
        const column = group.closest('.new-page-setup-column');
        const bounds = column.getBoundingClientRect();
        return Array.from(group.querySelectorAll('button')).every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        });
      })).toBe(true);
    }
  }
  await page.evaluate(() => { document.body.style.zoom = ''; });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.locator('#newPageTypeBtn_folder').click();
  await expect(page.locator('#newPageTypeBtn_folder')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#newPageName').fill('QA Selector Folder');
  await page.locator('#newPageConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sutraPublicBetaTestHooks
    .getPagesForSpace(window.__sutraPublicBetaTestHooks.getActiveSpaceId())
    .some(item => item.title === 'QA Selector Folder' && item.type === 'folder'))).toBe(true);
});

async function captureFolderState(page, folderIds, childIds) {
  return page.evaluate(({ folderIds: ids, childIds: children }) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const pages = hooks.getPagesForSpace(hooks.getActiveSpaceId());
    return ids.map((id) => {
      const model = pages.find(item => item.id === id);
      const row = document.querySelector(`#pagesList .page-item[data-page-id="${id}"]`);
      const childVisible = (children[id] || []).every(childId => !!document.querySelector(
        `#pagesList .page-item[data-page-id="${childId}"]`
      ));
      const chevron = row && row.querySelector('i.fa-chevron-right, i.fa-chevron-down');
      return {
        id,
        collapsed: model && model.collapsed === true,
        chevron: chevron ? (chevron.classList.contains('fa-chevron-right') ? 'right' : 'down') : null,
        childVisible
      };
    });
  }, { folderIds, childIds });
}

async function expectFolderState(page, expected, folderIds, childIds) {
  await expect.poll(() => captureFolderState(page, folderIds, childIds)).toEqual(expected);
}

test('page creation and unrelated page mutations preserve independent folder state', async ({ page }) => {
  await openApp(page);
  const folderA = await createFolder(page, 'QA State Folder A');
  const folderB = await createFolder(page, 'QA State Folder B');
  const ids = await page.evaluate(({ folderAId, folderBId }) => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const first = hooks.createNoteInActiveSpace('QA State Folder A::Child', '<p>Child A</p>');
    const second = hooks.createNoteInActiveSpace('QA State Folder B::Child', '<p>Child B</p>');
    return {
      folderA: folderAId,
      folderB: folderBId,
      childA: first.id,
      childB: second.id
    };
  }, { folderAId: folderA, folderBId: folderB });

  const folderRow = page.locator(`#pagesList .page-item[data-page-id="${ids.folderA}"]`);
  await folderRow.click();
  const folderIds = [ids.folderA, ids.folderB];
  const childIds = { [ids.folderA]: [ids.childA], [ids.folderB]: [ids.childB] };
  const expected = [
    { id: ids.folderA, collapsed: true, chevron: 'right', childVisible: false },
    { id: ids.folderB, collapsed: false, chevron: 'down', childVisible: true }
  ];
  await expectFolderState(page, expected, folderIds, childIds);

  await page.locator('.new-page-btn').click();
  await page.locator('#newPageName').fill('QA Normal Page');
  await page.locator('#newPageConfirmBtn').click();
  await expectFolderState(page, expected, folderIds, childIds);

  await page.locator('.quick-new-page-btn').click();
  await expectFolderState(page, expected, folderIds, childIds);

  await page.locator('.new-page-btn').click();
  await page.locator('#newPageTypeBtn_canvas').click();
  await page.locator('#newPageName').fill('QA Canvas Page');
  await page.locator('#newPageConfirmBtn').click();
  await expectFolderState(page, expected, folderIds, childIds);

  const mutationIds = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const pages = hooks.getPagesForSpace(hooks.getActiveSpaceId());
    const normal = pages.find(item => item.title === 'QA Normal Page');
    const quick = pages.find(item => item.title.startsWith('Untitled'));
    hooks.renamePage(normal.id, 'QA Renamed Page');
    hooks.duplicatePageById(normal.id);
    hooks.forceDeletePageById(quick.id);
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    return { normalId: normal.id, quickId: quick.id };
  });
  await expectFolderState(page, expected, folderIds, childIds);
  expect(mutationIds.normalId).toBeTruthy();
  expect(mutationIds.quickId).toBeTruthy();
});

test('deleting the current last document does not expand a collapsed folder fallback', async ({ page }) => {
  await openApp(page);
  const folderId = await createFolder(page, 'QA Fallback Folder');
  const childId = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    return hooks.createNoteInActiveSpace('QA Fallback Folder::Only child', '<p>Only child</p>').id;
  });

  await page.locator(`#pagesList .page-item[data-page-id="${folderId}"]`).click();
  const before = await captureFolderState(page, [folderId], { [folderId]: [childId] });
  expect(before).toEqual([{ id: folderId, collapsed: true, chevron: 'right', childVisible: false }]);

  await page.evaluate((id) => window.loadPage(id), childId);
  const deleted = await page.evaluate((id) => window.__sutraPublicBetaTestHooks.forceDeletePageById(id), childId);
  expect(deleted).toBe(true);

  const after = await captureFolderState(page, [folderId], { [folderId]: [childId] });
  expect(after).toEqual([{ id: folderId, collapsed: true, chevron: null, childVisible: false }]);
  const restored = await page.evaluate((id) => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    const pageModel = window.__sutraPublicBetaTestHooks.getPagesForSpace(
      window.__sutraPublicBetaTestHooks.getActiveSpaceId()
    ).find(item => item.id === id);
    return pageModel && pageModel.collapsed;
  }, folderId);
  expect(restored).toBe(true);
});
