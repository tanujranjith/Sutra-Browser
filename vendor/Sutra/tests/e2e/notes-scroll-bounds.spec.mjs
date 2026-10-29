import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openShortNote(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
    window.setActiveView('notes');
    const note = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace(
      'Short page',
      '<p>One short line.</p>'
    );
    window.loadPage(note.id);
  });
  await page.waitForSelector('#editorV2Host .ProseMirror');
}

function readPageGeometry() {
  const rect = selector => {
    const el = document.querySelector(selector);
    const box = el.getBoundingClientRect();
    return { height: Math.round(box.height), top: Math.round(box.top), bottom: Math.round(box.bottom) };
  };
  const view = document.getElementById('view-notes');
  return {
    pane: rect('#notesPrimaryPane'),
    editor: rect('#editorV2Host'),
    prose: rect('#editorV2Host .ProseMirror'),
    viewClientHeight: view.clientHeight,
    viewScrollHeight: view.scrollHeight,
  };
}

test('short pageless notes do not create a phantom vertical scroll range', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShortNote(page);
  const geometry = await page.evaluate(readPageGeometry);
  expect(geometry.viewScrollHeight).toBeLessThanOrEqual(geometry.viewClientHeight + 1);
});

test('fresh Untitled pages keep the same title position as existing notes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShortNote(page);
  const existingTitleTop = await page.locator('#pageTitle').evaluate(element => Math.round(element.getBoundingClientRect().top));

  const freshPageId = await page.evaluate(() => {
    const freshPage = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace('Untitled', '');
    return freshPage.id;
  });
  await page.evaluate(pageId => window.loadPage(pageId), freshPageId);
  await expect(page.locator('#pageTitle')).toHaveValue('Untitled');

  const freshTitleTop = await page.locator('#pageTitle').evaluate(element => Math.round(element.getBoundingClientRect().top));
  expect(freshTitleTop).toBeLessThan(200);
  expect(Math.abs(freshTitleTop - existingTitleTop)).toBeLessThanOrEqual(1);
});

test('Pages mode owns one page minimum without nesting a second page height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShortNote(page);
  await page.locator('.notes-toolbar-overflow-toggle').click();
  await page.locator('#pagesToggleBtn').click();
  await expect(page.locator('body')).toHaveClass(/notes-pages-mode/);
  const geometry = await page.evaluate(readPageGeometry);
  expect(geometry.pane.height).toBeGreaterThanOrEqual(1040);
  expect(geometry.pane.height).toBeLessThanOrEqual(1080);
  expect(geometry.editor.height).toBeLessThan(geometry.pane.height);
  expect(geometry.prose.height).toBeLessThan(geometry.pane.height);
});

test('Pages mode uses a viewport-sized minimum on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShortNote(page);
  await page.locator('.notes-toolbar-overflow-toggle').click();
  await page.locator('#pagesToggleBtn').click();
  await expect(page.locator('body')).toHaveClass(/notes-pages-mode/);
  const geometry = await page.evaluate(readPageGeometry);
  expect(geometry.pane.height).toBeGreaterThanOrEqual(560);
  expect(geometry.pane.height).toBeLessThanOrEqual(740);
});
