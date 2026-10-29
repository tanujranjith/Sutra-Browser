import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openEditableNote(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(async () => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
    window.setWorkspacePreference('editor.editorV2Enabled', true, {});
    window.applyWorkspacePreferences({});
    window.setActiveView('notes');
    const note = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace(
      'Focus styles',
      '<p>Editable text.</p>'
    );
    window.loadPage(note.id);
    await new Promise(resolve => setTimeout(resolve, 300));
  });
  await page.waitForSelector('#editorV2Host .ProseMirror');
}

async function applyTheme(page, theme) {
  await page.evaluate(async name => {
    window.applyAtelierTheme(name);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, theme);
}

async function focusedControlColors(page) {
  return page.evaluate(() => {
    const element = document.createElement('input');
    element.setAttribute('aria-label', 'Focus contract probe');
    element.style.position = 'fixed';
    element.style.left = '-10000px';
    document.body.appendChild(element);
    element.focus();
    const style = getComputedStyle(element);
    const outlineColor = style.outlineColor;
    const outlineStyle = style.outlineStyle;
    // WebKit's native input appearance suppresses box-shadow even when the
    // declaration is valid. Check its outline above, then probe the shared
    // shadow token on an author-styled control without changing app styling.
    element.style.appearance = 'none';
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-strong, var(--accent))';
    document.body.appendChild(probe);
    const themeAccent = getComputedStyle(probe).color;
    probe.remove();
    const result = {
      outlineColor,
      outlineStyle,
      boxShadow: style.boxShadow,
      themeAccent,
    };
    element.remove();
    return result;
  });
}

async function focusedEditorColors(page) {
  const editor = page.locator('#editorV2Host .ProseMirror');
  await editor.click({ position: { x: 30, y: 12 } });
  return editor.evaluate(element => {
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const themeAccent = getComputedStyle(probe).color;
    probe.remove();
    return {
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
      caretColor: style.caretColor,
      themeAccent,
    };
  });
}

test('shared focus rings follow the active theme instead of the gold fallback', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditableNote(page);

  await applyTheme(page, 'dark');
  const dark = await focusedControlColors(page);
  expect(dark.outlineStyle).toBe('solid');
  expect(dark.outlineColor).toBe(dark.themeAccent);
  expect(dark.boxShadow).not.toBe('none');
  expect(dark.outlineColor).not.toBe('rgb(183, 154, 115)');

  await applyTheme(page, 'sutra');
  const sutra = await focusedControlColors(page);
  expect(sutra.outlineColor).toBe(sutra.themeAccent);
  expect(sutra.boxShadow).not.toBe('none');
  expect(sutra.outlineColor).not.toBe(dark.outlineColor);
});

test('the rich-text editor uses a theme caret without a full-surface focus box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditableNote(page);
  await applyTheme(page, 'dark');

  const desktop = await focusedEditorColors(page);
  expect(desktop.outlineStyle).toBe('none');
  expect(desktop.boxShadow).toBe('none');
  expect(desktop.caretColor).toBe(desktop.themeAccent);

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await focusedEditorColors(page);
  expect(phone.outlineStyle).toBe('none');
  expect(phone.boxShadow).toBe('none');
  expect(phone.caretColor).toBe(phone.themeAccent);
});
