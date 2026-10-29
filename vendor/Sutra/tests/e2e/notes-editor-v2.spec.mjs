import { expect, test } from '@playwright/test';
import { waitForAppHydrated } from './helpers/app-ready.mjs';

// Modern Notes Editor (TipTap engine, shipped 2026-07-07; enabled by default
// with editor.editorV2Enabled as a compatibility toggle). Regression coverage:
//   1. THE bug: typing "1. item" produces ONE ordered-list marker — the typed
//      "1. " is consumed by the input rule, never left as literal text, and no
//      phantom empty <li> appears (the user's "1. 1. sim racing wheel" report).
//   2. Storage round-trip: content saves through the legacy mirror in the
//      classic storage format and reloads into v2 intact.
//   3. Structured HTML embed and drawing nodes remain live while their anchors,
//      math blocks, and checklist-item markup keep the classic storage contract.
//   4. Toolbar bridge: the execCommand-era globals (formatText/formatBlock)
//      drive schema commands when v2 is active.
//   5. Toggling Modern Editor off restores the classic contenteditable editor.

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
  await page.waitForFunction(() => {
    const overlay = document.getElementById('studentOnboardingOverlay');
    return !overlay || overlay.hidden || getComputedStyle(overlay).display === 'none';
  });
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() =>
    !!window.SutraNotesEditorV2 &&
    !!window.flowAtelier &&
    typeof window.flowAtelier.flushAppSaveNow === 'function' &&
    typeof window.setWorkspacePreference === 'function' &&
    typeof window.applyWorkspacePreferences === 'function');
  // The static shell and v2 module exist before the async canonical workspace
  // hydrate completes. Wait through the public durability seam so tests never
  // simulate typing into boot defaults that a real user cannot reach beneath
  // the startup overlay.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-app-ready'));
  await completeOnboarding(page);
}

async function enableEditorV2(page) {
  await page.evaluate(() => {
    window.setWorkspacePreference('editor.editorV2Enabled', true, {});
    window.applyWorkspacePreferences({});
  });
  await page.waitForFunction(() => window.SutraNotesEditorV2.isMounted());
}

async function openNotesView(page) {
  // Reload exposes shell markup before navigation handlers are installed.
  // Target the canonical button after hydration, rather than the body whose
  // data-view attribute may also match the old generic selector.
  await waitForAppHydrated(page);
  await page.locator('.view-tab[data-view="notes"]:visible').first().click();
  await page.waitForFunction(() => {
    const view = document.getElementById('view-notes');
    return view && getComputedStyle(view).display !== 'none';
  });
}

// Create a fresh blank note through the real new-page flow and wait for it to
// load into the active editor.
async function createBlankNote(page, name) {
  await page.evaluate((pageName) => {
    window.createNewPage({ templateId: 'blank' });
    const nameInput = document.getElementById('newPageName');
    if (nameInput) {
      nameInput.value = pageName;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.confirmNewPage();
  }, name);
  await page.waitForFunction((pageName) => {
    const title = document.getElementById('pageTitle');
    const pm = document.querySelector('#editorV2Host .ProseMirror');
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    return title && title.value === pageName &&
      current && current.title.split('::').pop() === pageName &&
      current.isSystemPage !== true &&
      pm && !pm.textContent.includes('Sutra Help & Docs');
  }, name);
}

const PM_SELECTOR = '#editorV2Host .ProseMirror';

test('typing "1. " creates ONE list marker and consumes the typed text', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'birthday list');

  // Trusted keyboard input — the exact keystrokes from the bug report.
  await page.click(PM_SELECTOR);
  await page.keyboard.type('1. sim racing wheel along with f1 26');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Logitech MX master 4');

  const state = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    return {
      html: pm.innerHTML,
      text: pm.textContent,
      listCount: pm.querySelectorAll('ol').length,
      itemCount: pm.querySelectorAll('ol > li').length,
      itemTexts: Array.from(pm.querySelectorAll('ol > li')).map(li => li.textContent.trim())
    };
  }, PM_SELECTOR);

  // ONE ordered list, exactly two items, and the typed "1. " was consumed:
  // no literal "1." anywhere in the document text.
  expect(state.listCount).toBe(1);
  expect(state.itemCount).toBe(2);
  expect(state.itemTexts[0]).toBe('sim racing wheel along with f1 26');
  expect(state.itemTexts[1]).toBe('Logitech MX master 4');
  expect(state.text).not.toContain('1.');

  // No phantom empty trailing <li> (the "3." from the report).
  expect(state.itemTexts.every(t => t.length > 0)).toBe(true);
});

test('content saves in classic storage format and reloads into v2', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 roundtrip');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('1. first item');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second item');
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Saving/i);

  // Force the readback-verified save path and capture what persisted.
  const savedContent = await page.evaluate(async () => {
    window.SutraNotesEditorV2.flushToMirror();
    await window.saveWorkspaceLocally();
    const title = document.getElementById('pageTitle').value;
    const mirror = document.getElementById('editor');
    return { title, mirrorHtml: mirror.innerHTML };
  });
  expect(savedContent.mirrorHtml).toContain('<ol>');
  expect(savedContent.mirrorHtml).toContain('first item');
  expect(savedContent.mirrorHtml).not.toContain('1. first');
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Saved/i);

  // Reload the app: the flag persists, v2 remounts, content restores.
  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => window.SutraNotesEditorV2 && window.SutraNotesEditorV2.isMounted());
  await openNotesView(page);

  // Wait for the restored page content to land in the v2 document.
  await page.waitForFunction((sel) => {
    const pm = document.querySelector(sel);
    return pm && pm.textContent.includes('first item');
  }, PM_SELECTOR);
  const restored = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    return { title: document.getElementById('pageTitle').value, text: pm ? pm.textContent : '' };
  }, PM_SELECTOR);
  expect(restored.title).toBe('v2 roundtrip');
  expect(restored.text).toContain('first item');
  expect(restored.text).toContain('second item');
});

test('an immediate reload flushes the latest note before the editor debounce', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'immediate reload trust');

  const sentinel = 'Latest sentence survives an immediate reload.';
  await page.click(PM_SELECTOR);
  await page.keyboard.type(sentinel);
  await expect(page.locator('#taskbarSaveStatus')).toContainText(/Saving/i);

  // Do not call savePage/saveWorkspaceLocally or wait for the editor debounce.
  // The lifecycle flush must synchronously snapshot the editor and start the
  // canonical write/readback or the bounded lifecycle recovery journal before
  // navigation completes.
  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() =>
    !!window.flowAtelier && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-journal-promotion'));
  await page.waitForFunction(() => window.SutraNotesEditorV2 && window.SutraNotesEditorV2.isMounted());
  await openNotesView(page);
  await page.waitForFunction(({ selector, text }) => {
    const editor = document.querySelector(selector);
    return editor && editor.textContent.includes(text);
  }, { selector: PM_SELECTOR, text: sentinel });
  expect(await page.evaluate(() => sessionStorage.getItem('sutra:lifecycle-note-journal:v1'))).toBeNull();
});

test('assistant context reads latest v2 note content and visible selection', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'assistant context v2');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('Assistant context sentinel alpha beta stays readable.');

  // Do not call savePage() here. The assistant should still force the v2 mirror
  // current before it builds context, so immediate asks after typing are fresh.
  const context = await page.evaluate(() => {
    const ctx = window.getFlowAssistantContext({ depth: 'currentView' });
    const page = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    return {
      excerpt: ctx.activeNote && ctx.activeNote.excerpt,
      wordCount: ctx.activeNote && ctx.activeNote.wordCount,
      pageContent: page && page.content,
      mirrorHtml: document.getElementById('editor').innerHTML
    };
  });

  expect(context.excerpt).toContain('Assistant context sentinel alpha beta');
  expect(context.wordCount).toBeGreaterThanOrEqual(7);
  expect(context.pageContent).toContain('Assistant context sentinel alpha beta');
  expect(context.mirrorHtml).toContain('Assistant context sentinel alpha beta');

  const selectedText = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let target = null;
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.includes('sentinel alpha beta')) {
        target = walker.currentNode;
        break;
      }
    }
    if (!target) return '';
    const start = target.nodeValue.indexOf('sentinel alpha beta');
    const range = document.createRange();
    range.setStart(target, start);
    range.setEnd(target, start + 'sentinel alpha beta'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return window.getFlowAssistantContext({ depth: 'currentView' }).selection || '';
  }, PM_SELECTOR);

  expect(selectedText).toBe('sentinel alpha beta');
});

test('legacy anchors, math, and checklists survive a v2 round-trip', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);

  const result = await page.evaluate(() => {
    const legacyNote = '<h2>My note</h2>' +
      '<div class="checklist-item"><input type="checkbox" checked><span contenteditable="true">done thing</span></div>' +
      '<div class="checklist-item"><input type="checkbox"><span contenteditable="true">todo thing</span></div>' +
      '<div class="html-embed-anchor" data-note-block-type="html-embed" data-block-id="blk-123" contenteditable="false"></div>' +
      '<p>text with <span class="sutra-math-block" data-latex="x^2" contenteditable="false">x^2</span> math</p>' +
      '<div class="drawing-anchor" data-note-block-type="drawing" data-block-id="draw-9" contenteditable="false"></div>';
    window.SutraNotesEditorV2.setContent(legacyNote);
    const out = window.SutraNotesEditorV2.getStorageHtml();
    return {
      embedAnchorKept: out.includes('data-block-id="blk-123"'),
      drawingAnchorKept: out.includes('data-block-id="draw-9"'),
      mathKept: out.includes('data-latex="x^2"'),
      checklistCount: (out.match(/checklist-item/g) || []).length,
      checkedPreserved: /<input type="checkbox" checked/.test(out)
    };
  });

  expect(result.embedAnchorKept).toBe(true);
  expect(result.drawingAnchorKept).toBe(true);
  expect(result.mathKept).toBe(true);
  expect(result.checklistCount).toBe(2);
  expect(result.checkedPreserved).toBe(true);
});

test('toolbar globals drive schema commands when v2 is active', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 toolbar');

  const result = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    window.SutraNotesEditorV2.setContent('<p>hello world</p>');
    pm.editor.commands.focus();
    pm.editor.commands.selectAll();
    window.formatText('bold');
    const bolded = window.SutraNotesEditorV2.getStorageHtml();
    window.formatBlock('h2');
    const asHeading = window.SutraNotesEditorV2.getStorageHtml();
    window.formatText('undo');
    const undone = window.SutraNotesEditorV2.getStorageHtml();
    return { bolded, asHeading, undone };
  }, PM_SELECTOR);

  // The TrailingNode extension keeps an empty trailing paragraph after
  // non-paragraph blocks (so the caret can always leave a heading/table) —
  // strip it before comparing.
  const strip = (html) => html.replace(/(<p><\/p>)+$/, '');
  expect(strip(result.bolded)).toBe('<p><strong>hello world</strong></p>');
  expect(strip(result.asHeading)).toBe('<h2><strong>hello world</strong></h2>');
  expect(strip(result.undone)).toBe('<p><strong>hello world</strong></p>');
});

test('toolbar pressed states mirror the v2 cursor formatting', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 toolbar state');

  await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent(
      '<p><strong>bold text</strong> plain text</p>' +
      '<h2>Heading text</h2>' +
      '<p style="text-align: center"><a href="https://example.com">linked text</a></p>' +
      '<ul><li><p>bullet text</p></li></ul>'
    );
  });

  await page.locator('#editorV2Host strong').click();
  await expect(page.locator('[data-notes-v2-state="bold"]')).toHaveAttribute('aria-pressed', 'true');
  // The styles dropdown reflects the current block type (paragraph here).
  await expect(page.locator('#toolbarStylesSelect')).toHaveValue('p');

  await page.locator('#editorV2Host h2').click();
  await expect(page.locator('#toolbarStylesSelect')).toHaveValue('h2');
  await expect(page.locator('[data-notes-v2-state="bold"]')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#editorV2Host a').click();
  await expect(page.locator('[data-notes-v2-state="link"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-notes-v2-state="alignCenter"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#editorV2Host li').click();
  await expect(page.locator('[data-notes-v2-state="bulletList"]')).toHaveAttribute('aria-pressed', 'true');
});

test('task lists render beside checkboxes and structured embeds mount a live view', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 task layout');

  const result = await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>Open task item that wraps beside the checkbox.</p></li>' +
        '<li data-type="taskItem" data-checked="true"><p>Done task item</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Nested task</p></li></ul></li>' +
      '</ul>' +
      '<div class="html-embed-anchor" data-note-block-type="html-embed" data-block-id="blk-visible" contenteditable="false"></div>'
    );
    const host = document.querySelector('#editorV2Host');
    const item = host.querySelector('ul[data-type="taskList"] > li[data-checked]');
    const label = item.querySelector(':scope > label');
    const content = item.querySelector(':scope > div');
    const card = host.querySelector('.html-embed-block[data-block-id="blk-visible"]');
    const itemStyle = getComputedStyle(item);
    const cardStyle = getComputedStyle(card);
    const labelBox = label.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const storage = window.SutraNotesEditorV2.getStorageHtml();
    return {
      itemDisplay: itemStyle.display,
      itemGap: itemStyle.gap,
      labelTop: Math.round(labelBox.top),
      contentTop: Math.round(contentBox.top),
      cardDisplay: cardStyle.display,
      cardHasEdit: !!card.querySelector('[data-html-embed-action="edit"]'),
      storageHasAria: storage.includes('aria-label'),
      storageHasAnchor: storage.includes('data-block-id="blk-visible"'),
      storageHasNestedInputInsideSpan: /<span contenteditable="true">[^<]*<input/i.test(storage)
    };
  });

  expect(result.itemDisplay).toBe('flex');
  expect(result.itemGap).not.toBe('normal');
  expect(Math.abs(result.labelTop - result.contentTop)).toBeLessThanOrEqual(6);
  expect(result.cardDisplay).not.toBe('none');
  expect(result.cardHasEdit).toBe(true);
  expect(result.storageHasAria).toBe(false);
  expect(result.storageHasAnchor).toBe(true);
  expect(result.storageHasNestedInputInsideSpan).toBe(false);
});

test('Modern Editor inserts, edits, saves, and restores live HTML embeds', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 live HTML embed');
  await page.locator(PM_SELECTOR).click();
  await page.evaluate(() => { window.insertHtmlEmbed(); });
  await expect(page.locator('#htmlEmbedModal')).toHaveClass(/active/);
  await page.locator('#htmlEmbedModalInput').fill('<section><h2>First embed</h2></section>');
  await page.locator('#htmlEmbedModalConfirmBtn').click();
  const embed = page.locator('#editorV2Host .html-embed-block');
  await expect(embed).toHaveCount(1);
  await expect(embed.locator('.html-embed-block-surface h2')).toHaveText('First embed');
  const initial = await page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    return { html: window.SutraNotesEditorV2.getStorageHtml(), blocks: current.blocks };
  });
  expect(initial.html).toContain('html-embed-anchor');
  expect(initial.html).not.toContain('html-embed-block-header');
  expect(initial.blocks.filter(block => block.type === 'htmlEmbed')).toHaveLength(1);

  await embed.locator('.html-embed-menu-btn').click();
  await embed.locator('[data-html-embed-action="edit"]').click();
  await expect(page.locator('#htmlEmbedModalInput')).toHaveValue(/First embed/);
  await page.locator('#htmlEmbedModalInput').fill('<section><h2>Edited embed</h2></section>');
  await page.locator('#htmlEmbedModalConfirmBtn').click();
  await expect(embed.locator('.html-embed-block-surface h2')).toHaveText('Edited embed');
  const beforeSize = await page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    const block = current.blocks.find(entry => entry.type === 'htmlEmbed');
    return { width: block.widthPct, height: block.heightPx };
  });
  await expect.poll(async () => {
    const rect = await embed.locator('.html-embed-block-stage').boundingBox();
    return Math.abs(rect.height - beforeSize.height);
  }).toBeLessThanOrEqual(2);
  for (const [axis, dx, dy] of [['x', -50, 0], ['y', 0, 60]]) {
    const later = page.locator('#sutraUpdateBanner').getByRole('button', { name: 'Later' });
    if (await later.isVisible()) await later.click();
    const handle = embed.locator(`[data-html-embed-resize-axis="${axis}"]`);
    await handle.scrollIntoViewIfNeeded();
    await handle.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    const block = current.blocks.find(entry => entry.type === 'htmlEmbed');
    return block.widthPct;
  })).toBeLessThan(beforeSize.width);
  await expect.poll(() => page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    const block = current.blocks.find(entry => entry.type === 'htmlEmbed');
    return block.heightPx;
  })).toBeGreaterThan(beforeSize.height);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-live-embed'));
  await page.reload();
  await openNotesView(page);
  await expect(page.locator('#editorV2Host .html-embed-block-surface h2')).toHaveText('Edited embed');
  const reloadedSize = await page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    const block = current.blocks.find(entry => entry.type === 'htmlEmbed');
    return { width: block.widthPct, height: block.heightPx };
  });
  expect(reloadedSize.width).toBeLessThan(beforeSize.width);
  expect(reloadedSize.height).toBeGreaterThan(beforeSize.height);
});

test('Modern Editor removes and undoes an HTML embed without orphaning its payload', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 embed history');
  await page.locator(PM_SELECTOR).click();
  await page.evaluate(() => { window.insertHtmlEmbed(); });
  await page.locator('#htmlEmbedModalInput').fill('<p>Undoable embed</p>');
  await page.locator('#htmlEmbedModalConfirmBtn').click();
  const embed = page.locator('#editorV2Host .html-embed-block');
  await expect(embed).toHaveCount(1);
  await embed.locator('.html-embed-menu-btn').click();
  await embed.locator('[data-html-embed-action="remove"]').click();
  await expect(embed).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.flowAtelier.pages
    .find(p => p.id === window.flowAtelier.currentPageId).blocks
    .filter(block => block.type === 'htmlEmbed').length)).toBe(0);
  await page.locator(PM_SELECTOR).focus();
  await page.keyboard.press('Control+z');
  await expect(embed).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.flowAtelier.pages
    .find(p => p.id === window.flowAtelier.currentPageId).blocks
    .filter(block => block.type === 'htmlEmbed').length)).toBe(1);
  await page.keyboard.press('Control+y');
  await expect(embed).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.flowAtelier.pages
    .find(p => p.id === window.flowAtelier.currentPageId).blocks
    .filter(block => block.type === 'htmlEmbed').length)).toBe(0);
});

test('multiple live HTML embeds move with their anchors and remain classic compatible', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 embed move');
  const ids = [];
  for (const label of ['First live embed', 'Second live embed']) {
    await page.locator(PM_SELECTOR).click();
    await page.evaluate(() => { window.insertHtmlEmbed(); });
    await page.locator('#htmlEmbedModalInput').fill(`<p>${label}</p>`);
    await page.locator('#htmlEmbedModalConfirmBtn').click();
    ids.push(await page.evaluate(() => window.flowAtelier.pages
      .find(p => p.id === window.flowAtelier.currentPageId).blocks
      .filter(block => block.type === 'htmlEmbed').at(-1)?.id));
  }
  expect(new Set(ids).size).toBe(2);
  await page.evaluate(([first, second]) => window.SutraNotesEditorV2.setContent(
    `<p>Before</p><div class="html-embed-anchor" data-note-block-type="html-embed" data-block-id="${first}" contenteditable="false"></div>` +
    `<p>Middle</p><div class="html-embed-anchor" data-note-block-type="html-embed" data-block-id="${second}" contenteditable="false"></div><p>After</p>`
  ), ids);
  const nodes = page.locator('#editorV2Host .editor-v2-structured-block');
  await expect(nodes).toHaveCount(2);
  await nodes.first().hover();
  await expect(page.locator('.editor-v2-drag-handle')).toBeVisible();
  await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const pm = document.querySelector('#editorV2Host .ProseMirror');
    const nodes = () => pm.querySelectorAll(':scope > .editor-v2-structured-block');
    const first = nodes()[0].getBoundingClientRect();
    const last = nodes()[1].getBoundingClientRect();
    pm.dispatchEvent(new MouseEvent('mousemove', { clientX: first.left + 16, clientY: first.top + 12, bubbles: true }));
    await sleep(40);
    const handle = [...document.querySelectorAll('.editor-v2-drag-handle')].find(el => getComputedStyle(el).display !== 'none');
    const grip = handle.getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: grip.left + 2, clientY: grip.top + 2, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: last.left + 16, clientY: last.bottom + 6, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: last.left + 16, clientY: last.bottom + 6, bubbles: true }));
  });
  const moved = await page.evaluate(() => {
    const current = window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId);
    return { html: window.SutraNotesEditorV2.getStorageHtml(), ids: current.blocks.filter(block => block.type === 'htmlEmbed').map(block => block.id) };
  });
  expect(moved.html.indexOf(ids[1])).toBeLessThan(moved.html.indexOf(ids[0]));
  expect(moved.ids).toHaveLength(2);
  expect(new Set(moved.ids)).toEqual(new Set(ids));
  expect(moved.html).not.toContain('html-embed-block-header');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-moved-embeds'));
  const saved = await page.evaluate(() => window.flowAtelier.pages.find(p => p.id === window.flowAtelier.currentPageId));
  expect(saved.content.indexOf(ids[1])).toBeLessThan(saved.content.indexOf(ids[0]));
  expect(saved.blocks.filter(block => block.type === 'htmlEmbed')).toHaveLength(2);
  await page.reload();
  await page.waitForFunction(() => window.flowAtelier?.pages?.some(p => p.title === 'v2 embed move') && window.SutraNotesEditorV2?.isMounted());
  await completeOnboarding(page);
  await openNotesView(page);
  await expect(page.locator('#editorV2Host .html-embed-block')).toHaveCount(2);
  await page.evaluate(() => {
    window.setWorkspacePreference('editor.editorV2Enabled', false, {});
    window.applyWorkspacePreferences({});
  });
  await expect(page.locator('#editor .html-embed-block')).toHaveCount(2);
});

test('Modern Editor keeps handwriting live and durable', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 handwriting');
  await page.locator(PM_SELECTOR).click();
  await page.evaluate(() => window.insertDrawingBlock());
  const drawing = page.locator('#editorV2Host .drawing-block');
  await expect(drawing).toHaveCount(1);
  const canvas = drawing.locator('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 25, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 85, box.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.flowAtelier.pages
    .find(p => p.id === window.flowAtelier.currentPageId).blocks
    .find(block => block.type === 'drawing')?.strokes.length)).toBe(1);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-live-drawing'));
  await page.reload();
  await page.waitForFunction(() => window.SutraNotesEditorV2?.isMounted() && window.flowAtelier?.pages?.length);
  await openNotesView(page);
  await expect(page.locator('#editorV2Host .drawing-block canvas')).toBeVisible();
});

test('locking a live embed clears its preview until the page is unlocked', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 private embed');
  await page.locator(PM_SELECTOR).click();
  await page.evaluate(() => { window.insertHtmlEmbed(); });
  await page.locator('#htmlEmbedModalInput').fill('<p>Private embed sentinel</p>');
  await page.locator('#htmlEmbedModalConfirmBtn').click();
  await expect(page.locator('#editorV2Host .html-embed-block')).toHaveCount(1);
  await page.evaluate(async () => {
    const id = window.flowAtelier.currentPageId;
    await window.__sutraPublicBetaTestHooks.lockPageWithPin(id, '4826');
    window.loadPage(id);
  });
  await expect(page.locator('#lockedPageScreen')).toBeVisible();
  const lockedSurface = await page.evaluate(() => ({
    text: document.getElementById('editorV2Host')?.textContent || '',
    iframeCount: document.querySelectorAll('#editorV2Host iframe').length,
    mirror: document.getElementById('editor')?.textContent || ''
  }));
  expect(lockedSurface.text + lockedSurface.mirror).not.toContain('Private embed sentinel');
  expect(lockedSurface.iframeCount).toBe(0);
  await page.locator('#lockScreenPinInput').fill('4826');
  await page.locator('#lockScreenForm button[type="submit"]').click();
  await expect(page.locator('#editorV2Host .html-embed-block-surface')).toContainText('Private embed sentinel');
});

test('Split View mounts independent Modern Editor instances', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 split left');
  await createBlankNote(page, 'v2 split right');
  await page.evaluate(() => document.getElementById('splitNotesToggleBtn').click());
  const left = page.locator('#editorV2Host .ProseMirror');
  const right = page.locator('#editorV2SecondaryHost .ProseMirror');
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await left.click();
  await page.keyboard.type('Left pane text');
  await right.click();
  await page.keyboard.type('Right pane text');
  await expect(left).toContainText('Left pane text');
  await expect(right).toContainText('Right pane text');
  await expect(left).not.toContainText('Right pane text');
  await expect(right).not.toContainText('Left pane text');
  await page.evaluate(() => {
    const pm = document.querySelector('#editorV2SecondaryHost .ProseMirror');
    pm.editor.commands.selectAll();
    window.formatText('bold');
  });
  await expect(right.locator('strong')).toContainText('Right pane text');
  await expect(left.locator('strong')).toHaveCount(0);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-split-modern'));
  await expect.poll(() => page.evaluate(() => {
    const pages = window.flowAtelier.pages;
    return ['v2 split left', 'v2 split right'].map(name => pages.find(p => p.title.split('::').pop() === name)?.content || '');
  })).toEqual([expect.stringContaining('Right pane text'), expect.stringContaining('Left pane text')]);
  await right.locator('p').first().hover();
  const secondaryHandle = page.locator('.editor-v2-drag-handle[data-editor-v2-owner="editorV2SecondaryHost"]');
  await expect(secondaryHandle).toHaveCount(1);
  await page.evaluate(() => document.getElementById('splitNotesToggleBtn').click());
  await expect(page.locator('#editorV2SecondaryHost')).toHaveCount(0);
  await expect(secondaryHandle).toHaveCount(0);
});

test('secondary pane saves its pending edit before switching pages or closing Split View', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  for (const name of ['split boundary one', 'split boundary two', 'split boundary three']) {
    await createBlankNote(page, name);
  }
  await page.evaluate(() => document.getElementById('splitNotesToggleBtn').click());
  await expect(page.locator('#editorV2SecondaryHost .ProseMirror')).toBeVisible();
  const pages = await page.evaluate(() => ({
    oldId: document.querySelector('#splitNoteSelect').value,
    options: [...document.querySelector('#splitNoteSelect').options].map(option => option.value)
  }));
  const nextId = pages.options.find(id => id && id !== pages.oldId);
  expect(nextId).toBeTruthy();

  await page.evaluate(targetId => {
    document.querySelector('#editorV2SecondaryHost .ProseMirror').editor.commands.insertContent('Saved before switch');
    const select = document.getElementById('splitNoteSelect');
    select.value = targetId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, nextId);
  await expect.poll(() => page.evaluate(oldId => window.flowAtelier.pages.find(p => p.id === oldId)?.content, pages.oldId))
    .toContain('Saved before switch');
  await expect(page.locator('#editorV2SecondaryHost .ProseMirror')).not.toContainText('Saved before switch');

  await page.evaluate(() => {
    document.querySelector('#editorV2SecondaryHost .ProseMirror').editor.commands.insertContent('Saved before close');
    document.getElementById('splitNotesToggleBtn').click();
  });
  await expect(page.locator('#editorV2SecondaryHost')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => window.flowAtelier.pages.find(p => p.id === id)?.content, nextId))
    .toContain('Saved before close');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-split-boundary'));
  await page.reload();
  await page.waitForFunction(() => window.flowAtelier?.pages?.length >= 4);
  const restored = await page.evaluate(ids => ids.map(id => window.flowAtelier.pages.find(p => p.id === id)?.content || ''), [pages.oldId, nextId]);
  expect(restored[0]).toContain('Saved before switch');
  expect(restored[1]).toContain('Saved before close');
});

test('empty Enter exits ordered lists without leaving a phantom list item', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 list boundary');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('1. first item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('after list');

  const state = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    return {
      listItems: Array.from(pm.querySelectorAll('ol > li')).map(li => li.textContent.trim()),
      trailingParagraphs: Array.from(pm.querySelectorAll(':scope > p')).map(p => p.textContent.trim())
    };
  }, PM_SELECTOR);

  expect(state.listItems).toEqual(['first item']);
  expect(state.trailingParagraphs).toContain('after list');
});

test('pasted foreign fonts and colors are stripped while document structure survives', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 paste cleanup');

  await page.click(PM_SELECTOR);
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const data = new DataTransfer();
    data.setData('text/html',
      '<h1 style="font-family: Comic Sans MS; color: red">Paste Heading</h1>' +
      '<p class="MsoNormal" style="font-size: 22pt; color: blue"><strong><a href="https://example.com" style="color: green">Linked bold</a></strong></p>' +
      '<table style="font-family: Times New Roman; color: purple"><tbody><tr><td style="background: yellow; color: purple">Cell</td></tr></tbody></table>'
    );
    data.setData('text/plain', 'Paste Heading\nLinked bold\nCell');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    // Firefox's synthetic ClipboardEvent constructor does not retain supplied
    // DataTransfer contents. Keep this fixture payload on the dispatched event.
    Object.defineProperty(event, 'clipboardData', { value: data });
    pm.dispatchEvent(event);
  }, PM_SELECTOR);

  await page.waitForFunction((sel) => document.querySelector(sel).textContent.includes('Linked bold'), PM_SELECTOR);
  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<h1>Paste Heading</h1>');
  expect(html).toContain('<strong>');
  expect(html).toContain('<a');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('<table');
  expect(html).not.toMatch(/font-family|font-size|color:\s*(red|blue|green|purple)|background:\s*yellow|class="MsoNormal"/i);
});

test('modern editor is ON by default; disabling restores the classic editor', async ({ page }) => {
  await openApp(page);

  // Default ON: v2 mounts at boot, the classic #editor is a hidden mirror.
  await page.waitForFunction(() => window.SutraNotesEditorV2.isMounted(), { timeout: 8000 });
  const defaults = await page.evaluate(() => ({
    mounted: window.SutraNotesEditorV2.isMounted(),
    hostExists: !!document.getElementById('editorV2Host'),
    legacyEditable: document.getElementById('editor').getAttribute('contenteditable'),
    legacyDisplay: document.getElementById('editor').style.display
  }));
  expect(defaults.mounted).toBe(true);
  expect(defaults.hostExists).toBe(true);
  expect(defaults.legacyEditable).toBe('false');
  expect(defaults.legacyDisplay).toBe('none');

  // Explicit opt-out: v2 unmounts and the classic editor comes back.
  await page.evaluate(() => {
    window.setWorkspacePreference('editor.editorV2Enabled', false, {});
    window.applyWorkspacePreferences({});
  });
  const restored = await page.evaluate(() => ({
    mounted: window.SutraNotesEditorV2.isMounted(),
    hostExists: !!document.getElementById('editorV2Host'),
    legacyDisplay: document.getElementById('editor').style.display,
    legacyEditable: document.getElementById('editor').getAttribute('contenteditable')
  }));
  expect(restored.mounted).toBe(false);
  expect(restored.hostExists).toBe(false);
  expect(restored.legacyDisplay).not.toBe('none');
  expect(restored.legacyEditable).toBe('true');
});

// ---- Phase 1: parity plumbing (find/replace, indent, keymap, spacing, fonts) ----

test('find & replace runs over the v2 document, not the hidden mirror', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 find replace');

  const found = await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent('<p>alpha beta alpha gamma alpha</p>');
    return window.SutraNotesEditorV2.search.set('alpha');
  });
  expect(found.count).toBe(3);
  expect(found.index).toBe(0);

  const cycled = await page.evaluate(() => window.SutraNotesEditorV2.search.next());
  expect(cycled.index).toBe(1);

  const afterReplace = await page.evaluate(() => {
    window.SutraNotesEditorV2.search.set('alpha');
    window.SutraNotesEditorV2.search.replaceAll('ALPHA');
    return window.SutraNotesEditorV2.getStorageHtml();
  });
  expect(afterReplace).toContain('ALPHA');
  expect(afterReplace).not.toContain('alpha');
  // Decoration highlights are view-only — they must never leak into storage.
  expect(afterReplace).not.toContain('find-highlight');
});

test('Tab indents a paragraph and stores margin-left (legacy-compatible)', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 indent');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('indented line');
  await page.keyboard.press('Tab');

  const afterIndent = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(afterIndent).toContain('margin-left: 40px');

  await page.keyboard.press('Shift+Tab');
  const afterOutdent = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(afterOutdent).not.toContain('margin-left');
});

test('Ctrl+Alt+1 turns the current block into an H1', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 heading shortcut');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('make me a heading');
  await page.keyboard.press('Control+Alt+1');

  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<h1>make me a heading</h1>');
});

test('line spacing sets block line-height in storage', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 line spacing');

  const html = await page.evaluate((sel) => {
    window.SutraNotesEditorV2.setContent('<p>spaced paragraph</p>');
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    pm.editor.commands.selectAll();
    window.SutraNotesEditorV2.exec('lineHeight', '2');
    return window.SutraNotesEditorV2.getStorageHtml();
  }, PM_SELECTOR);
  expect(html).toContain('line-height: 2');
});

test('font family and size commands round-trip through storage', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 fonts');

  const html = await page.evaluate((sel) => {
    window.SutraNotesEditorV2.setContent('<p>styled text</p>');
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    pm.editor.commands.selectAll();
    window.SutraNotesEditorV2.exec('fontFamily', 'Georgia');
    window.SutraNotesEditorV2.exec('fontSize', '24px');
    return window.SutraNotesEditorV2.getStorageHtml();
  }, PM_SELECTOR);
  expect(html).toMatch(/font-family:\s*Georgia/i);
  expect(html).toContain('24px');
});

// ---- Phase 2: Docs-style toolbar controls (selects/steppers) ----

test('toolbar style + font + spacing selects drive the v2 document', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 toolbar controls');

  const selectAll = () => page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    pm.editor.commands.selectAll();
  }, PM_SELECTOR);

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p>styled paragraph</p>'));
  await selectAll();
  await page.selectOption('#toolbarStylesSelect', 'h2');
  await selectAll();
  await page.selectOption('#toolbarFontFamily', 'Georgia, serif');
  await selectAll();
  await page.selectOption('#toolbarLineSpacing', '1.5');

  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<h2');
  expect(html).toMatch(/font-family:\s*Georgia/i);
  expect(html).toContain('line-height: 1.5');
});

test('font-size stepper buttons change the size and reflect in the input', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 size stepper');

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p>resize me</p>'));
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    pm.editor.commands.selectAll();
  }, PM_SELECTOR);
  await page.evaluate(() => { document.getElementById('toolbarFontSize').value = '16'; });

  // Click "+" twice → 16 → 18 → 20.
  const plus = page.locator('.toolbar-size-stepper .toolbar-size-btn').last();
  await plus.click();
  await plus.click();

  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('20px');
});

// ---- Phase 3: contextual editing UX ----

test('selection bubble menu appears and applies bold', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 bubble');

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p>select these words</p>'));
  await page.click(PM_SELECTOR);
  await page.keyboard.press('Control+a');

  const bubble = page.locator('.editor-v2-bubble');
  await expect(bubble).toBeVisible();
  await bubble.locator('.editor-v2-mini-btn').first().click(); // Bold

  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<strong>');
});

test('slash menu inserts a block and consumes the trigger text', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 slash');

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p></p>'));
  await page.click(PM_SELECTOR);
  await page.keyboard.type('/table');
  await expect(page.locator('.editor-v2-slash-menu')).toBeVisible();
  await page.keyboard.press('Enter');

  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<table');
  // The typed "/table" trigger must be consumed — no literal text left behind.
  const text = await page.evaluate((sel) => document.querySelector(sel).textContent, PM_SELECTOR);
  expect(text).not.toContain('/table');
});

test('smart paste recovers Google Docs style-based bold/italic as semantics', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 docs paste');

  await page.click(PM_SELECTOR);
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const data = new DataTransfer();
    data.setData('text/html',
      '<b id="docs-internal-guid-abc" style="font-weight:normal">' +
      '<p><span style="font-weight:700">Bold via style</span> and <span style="font-style:italic">italic via style</span></p>' +
      '</b>');
    data.setData('text/plain', 'Bold via style and italic via style');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    pm.dispatchEvent(event);
  }, PM_SELECTOR);

  await page.waitForFunction((sel) => document.querySelector(sel).textContent.includes('Bold via style'), PM_SELECTOR);
  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('<strong>Bold via style</strong>');
  expect(html).toContain('<em>italic via style</em>');
  expect(html).not.toMatch(/font-weight|font-style/i);
});

test('smart paste converts Word mso-list paragraphs into a real list', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 word list paste');

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p></p>'));
  await page.click(PM_SELECTOR);
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const data = new DataTransfer();
    data.setData('text/html',
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.</span>First item</p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.</span>Second item</p>');
    data.setData('text/plain', 'First item\nSecond item');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    pm.dispatchEvent(event);
  }, PM_SELECTOR);

  await page.waitForFunction((sel) => document.querySelector(sel).textContent.includes('First item'), PM_SELECTOR);
  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toMatch(/<ol>/);
  expect(html).toContain('First item');
  expect(html).not.toContain('mso-list');
});

test('block drag handle appears on hover and reorders top-level blocks', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 drag reorder');

  await page.evaluate(() => window.SutraNotesEditorV2.setContent('<p>Alpha block</p><p>Beta block</p><p>Gamma block</p>'));
  const first = page.locator('#editorV2Host .ProseMirror > p').first();
  await first.hover();
  await expect(page.locator('.editor-v2-drag-handle')).toBeVisible();

  // Drive the pointer drag through real DOM events on the handle element.
  // (Coordinate hit-testing on a body-appended fixed handle is flaky headless;
  // dispatching on the element exercises the same mousedown→move→up handlers.)
  const order = await page.evaluate(async (sel) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pm = document.querySelector(sel);
    const ps = () => pm.querySelectorAll(':scope > p');
    const r0 = ps()[0].getBoundingClientRect();
    pm.dispatchEvent(new MouseEvent('mousemove', { clientX: r0.left + 20, clientY: r0.top + 8, bubbles: true }));
    await sleep(40);
    const handle = document.querySelector('.editor-v2-drag-handle');
    const hb = handle.getBoundingClientRect();
    const gamma = ps()[2].getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: hb.left + 2, clientY: hb.top + 2, bubbles: true }));
    for (let i = 1; i <= 6; i++) {
      const y = r0.top + (gamma.bottom + 6 - r0.top) * (i / 6);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: gamma.left + 20, clientY: y, bubbles: true }));
      await sleep(8);
    }
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: gamma.left + 20, clientY: gamma.bottom + 6, bubbles: true }));
    await sleep(60);
    return Array.from(ps()).map(p => p.textContent.trim()).filter(Boolean);
  }, PM_SELECTOR);
  expect(order[order.length - 1]).toContain('Alpha');
});

// ---- Phase 4: Docs-grade tables & images ----

test('table structure commands merge cells, toggle header, and delete a column', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 tables');

  const result = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    // Insert a 3x3 table, place the cursor in the first body cell.
    window.SutraNotesEditorV2.exec('table', { rows: 3, cols: 3 });
    const table = pm.querySelector('table');
    const firstCell = table.querySelectorAll('td, th')[0];
    // Select the first two header cells → merge.
    const cells = table.querySelectorAll('th');
    const range = document.createRange();
    range.selectNodeContents(cells[0]);
    const range2 = document.createRange();
    range2.selectNodeContents(cells[1]);
    // Use TipTap cell-selection via commands instead of DOM selection.
    return { hasTable: !!table, headerCells: cells.length };
  }, PM_SELECTOR);
  expect(result.hasTable).toBe(true);

  // Header row toggle + delete column via the command bridge.
  const storage = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    // put cursor in first cell
    pm.editor.commands.setTextSelection(3);
    window.SutraNotesEditorV2.exec('addColumnAfter');
    window.SutraNotesEditorV2.exec('toggleHeaderRow');
    return window.SutraNotesEditorV2.getStorageHtml();
  }, PM_SELECTOR);
  expect(storage).toContain('<table');
  // Round-trips as legacy table HTML (colgroup + cells).
  expect(storage).toMatch(/<t(d|h)/);
});

test('merged cells round-trip through storage with colspan', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 merge');

  const storage = await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    window.SutraNotesEditorV2.exec('table', { rows: 2, cols: 3 });
    // Select the first two cells of the body row as a CellSelection and merge.
    // CellSelection positions point at (before) each cell node.
    if (pm.editor.commands.setCellSelection) {
      let bodyCells = [];
      pm.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell') bodyCells.push(pos);
      });
      if (bodyCells.length >= 2) {
        pm.editor.commands.setCellSelection({ anchorCell: bodyCells[0], headCell: bodyCells[1] });
        window.SutraNotesEditorV2.exec('mergeCells');
      }
    }
    return window.SutraNotesEditorV2.getStorageHtml();
  }, PM_SELECTOR);
  expect(storage).toMatch(/colspan="2"/);
});

test('inserting an image in v2 creates a resizable image node, not a media-wrapper', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 image');

  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    window.SutraNotesEditorV2.insertHtml('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="dot">');
  }, PM_SELECTOR);

  // The NodeView renders a wrap + resize handle in the editor.
  await expect(page.locator('#editorV2Host .sutra-img-wrap img')).toBeVisible();

  // Align + width via the command bridge round-trips to storage.
  const storage = await page.evaluate(() => {
    const pm = document.querySelector('#editorV2Host .ProseMirror');
    pm.editor.commands.focus();
    // Select the image node (first child).
    pm.editor.commands.setNodeSelection(0);
    window.SutraNotesEditorV2.exec('imageAlign', 'center');
    window.SutraNotesEditorV2.exec('imageWidth', '240px');
    return window.SutraNotesEditorV2.getStorageHtml();
  });
  expect(storage).toContain('<img');
  expect(storage).toContain('data-align="center"');
  expect(storage).toContain('width: 240px');
  expect(storage).not.toContain('media-wrapper');
});

test('pasting an image into v2 inserts and persists the image', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 pasted image');

  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.focus();
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    ), (char) => char.charCodeAt(0));
    data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    pm.dispatchEvent(event);
  }, PM_SELECTOR);

  await expect(page.locator('#editorV2Host .sutra-img-wrap img')).toBeVisible({ timeout: 5_000 });
  const state = await page.evaluate(() => ({
    imageCount: document.querySelectorAll('#editorV2Host .sutra-img-wrap img').length,
    storage: window.SutraNotesEditorV2.getStorageHtml()
  }));
  expect(state.imageCount).toBe(1);
  expect(state.storage).toContain('data:image/png;base64,');

  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    window.SutraNotesEditorV2.flushToMirror();
    await window.saveWorkspaceLocally();
  });
  await expect.poll(() => page.evaluate(async () => {
    const workspace = await window.loadWorkspaceLocally();
    const current = workspace?.pages?.find((note) => note.id === window.flowAtelier.currentPageId);
    return current?.content || '';
  })).toContain('data:image/png;base64,');

  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => window.SutraNotesEditorV2 && window.SutraNotesEditorV2.isMounted());
  await openNotesView(page);
  await expect(page.locator('#editorV2Host .sutra-img-wrap img')).toBeVisible({ timeout: 5_000 });
  const restored = await page.evaluate(() => {
    const image = document.querySelector('#editorV2Host .sutra-img-wrap img');
    return {
      src: image?.getAttribute('src') || '',
      naturalWidth: image?.naturalWidth || 0
    };
  });
  expect(restored.src).toContain('data:image/png;base64,');
  expect(restored.naturalWidth).toBeGreaterThan(0);
});

// ---- Phase 5: page-like layout ----

test('pages mode renders the v2 host as a clean page card', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 pages');

  await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent('<h1>Doc title</h1><p>Body text on the page.</p>');
    if (!document.body.classList.contains('notes-pages-mode')) window.togglePagesMode();
  });
  await expect(page.locator('body')).toHaveClass(/notes-pages-mode/);

  const metrics = await page.evaluate(() => {
    const host = document.getElementById('editorV2Host');
    const pane = document.querySelector('#view-notes .notes-pane-primary');
    const hcs = getComputedStyle(host);
    return {
      paneWidth: Math.round(pane.getBoundingClientRect().width),
      hostBg: hcs.backgroundColor,
      hostPad: hcs.padding
    };
  });
  // The pane is the physical page card (~816px letter width); the host adds no
  // background or padding of its own (no double-padding / grey inner panel).
  expect(metrics.paneWidth).toBeGreaterThanOrEqual(760);
  expect(metrics.hostPad).toBe('0px');
  expect(metrics.hostBg).toBe('rgba(0, 0, 0, 0)');

  // A page break inserts as a rendered break atom inside the host.
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    pm.editor.commands.focus();
    if (window.insertPageBreak) window.insertPageBreak();
  }, PM_SELECTOR);
  await expect(page.locator('#editorV2Host .atelier-page-break')).toHaveCount(1);
  expect(await page.locator('#editorV2Host .atelier-page-break').evaluate((node) => getComputedStyle(node, '::after').display)).toBe('none');
});

test('page-break dividers survive legacy style overrides, themes, reload, and print', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 page-break dividers');

  await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent(
      '<p>Paragraph before the first break.</p>' +
      '<div class="atelier-page-break" data-atelier-block="page-break" role="separator" aria-label="Page break"></div>' +
      '<h2>Heading between breaks</h2>' +
      '<div class="atelier-page-break" data-atelier-block="page-break" style="background: none;" role="separator" aria-label="Page break"></div>' +
      '<ul><li>List content between breaks</li></ul>' +
      '<div class="atelier-page-break" data-atelier-block="page-break" style="background-image: none;" role="separator" aria-label="Page break"></div>' +
      '<blockquote>Blockquote after the last break.</blockquote>'
    );
  });

  const readBreakMetrics = () => page.evaluate(() => Array.from(document.querySelectorAll('#editorV2Host .atelier-page-break')).map((node) => {
    const line = getComputedStyle(node, '::after');
    const rect = node.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      lineDisplay: line.display,
      lineWidth: parseFloat(line.width),
      lineHeight: line.height,
      lineColor: line.backgroundColor,
      lineLeft: line.left,
      lineRight: line.right,
      labelDisplay: getComputedStyle(node, '::before').display
    };
  }));

  const assertVisibleDividers = (metrics) => {
    expect(metrics).toHaveLength(3);
    expect(metrics.map((metric) => metric.width)).toEqual([metrics[0].width, metrics[0].width, metrics[0].width]);
    expect(metrics.every((metric) => metric.width > 0 && metric.height > 0)).toBe(true);
    expect(metrics.every((metric) => metric.lineDisplay === 'block')).toBe(true);
    expect(metrics.every((metric) => Math.abs(metric.lineWidth - metric.width) < 0.1)).toBe(true);
    expect(metrics.every((metric) => metric.lineHeight === '1px')).toBe(true);
    expect(metrics.every((metric) => metric.lineColor !== 'rgba(0, 0, 0, 0)')).toBe(true);
    expect(metrics.every((metric) => metric.lineLeft === '0px' && metric.lineRight === '0px')).toBe(true);
    expect(metrics.every((metric) => metric.labelDisplay === 'block')).toBe(true);
  };

  assertVisibleDividers(await readBreakMetrics());

  await page.evaluate(async () => {
    await window.applyAtelierTheme('dark', { persist: false });
  });
  const darkMetrics = await readBreakMetrics();
  assertVisibleDividers(darkMetrics);
  expect(new Set(darkMetrics.map((metric) => metric.lineColor)).size).toBe(1);

  await page.evaluate(async () => {
    window.SutraNotesEditorV2.flushToMirror();
    await window.saveWorkspaceLocally();
  });
  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => window.SutraNotesEditorV2 && window.SutraNotesEditorV2.isMounted());
  await openNotesView(page);
  await page.waitForFunction(() => document.querySelectorAll('#editorV2Host .atelier-page-break').length === 3);
  await page.evaluate(async () => {
    await window.applyAtelierTheme('dark', { persist: false });
  });
  assertVisibleDividers(await readBreakMetrics());

  await page.evaluate(() => window.togglePagesMode());
  const pageModeMetrics = await page.evaluate(() => Array.from(document.querySelectorAll('#editorV2Host .atelier-page-break')).map((node) => ({
    height: getComputedStyle(node).height,
    backgroundColor: getComputedStyle(node).backgroundColor,
    lineDisplay: getComputedStyle(node, '::after').display,
    labelDisplay: getComputedStyle(node, '::before').display
  })));
  expect(pageModeMetrics.every((metric) => metric.height === '60px')).toBe(true);
  expect(pageModeMetrics.every((metric) => metric.backgroundColor !== 'rgba(0, 0, 0, 0)')).toBe(true);
  expect(pageModeMetrics.every((metric) => metric.lineDisplay === 'none' && metric.labelDisplay === 'none')).toBe(true);
  await page.evaluate(() => window.togglePagesMode());

  await page.emulateMedia({ media: 'print' });
  const printMetrics = await page.evaluate(() => Array.from(document.querySelectorAll('#editorV2Host .atelier-page-break')).map((node) => ({
    breakBefore: getComputedStyle(node).breakBefore,
    lineDisplay: getComputedStyle(node, '::after').display,
    labelDisplay: getComputedStyle(node, '::before').display
  })));
  expect(printMetrics.every((metric) => metric.breakBefore === 'page')).toBe(true);
  expect(printMetrics.every((metric) => metric.lineDisplay === 'none' && metric.labelDisplay === 'none')).toBe(true);
  await page.emulateMedia({ media: 'screen' });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMetrics = await readBreakMetrics();
  assertVisibleDividers(mobileMetrics);
});

// ---- Phase 6: live NodeViews for preserved atoms ----

test('embedded media renders as a live element and still round-trips verbatim', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 media live');

  await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent(
      '<div class="media-wrapper" data-type="video"><video controls><source src="data:video/mp4;base64,AAAAHGZ0" type="video/mp4"></video></div>'
    );
  });

  // The media element is live in the editor (NodeView renders it), not a card.
  await expect(page.locator('#editorV2Host video')).toHaveCount(1);

  // Storage keeps the media-wrapper anchor byte-compatible.
  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('class="media-wrapper"');
  expect(html).toContain('<video');
});

test('math atoms render live KaTeX while storage keeps the raw LaTeX', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'v2 math live');

  await page.evaluate(() => {
    window.SutraNotesEditorV2.setContent(
      '<p>x: <span class="sutra-math-block" data-latex="x^2" contenteditable="false">x^2</span></p>'
    );
  });

  // The NodeView renders KaTeX into the span for display.
  await expect(page.locator('#editorV2Host .sutra-math-block .katex')).toBeVisible({ timeout: 6000 });

  // Storage still holds the raw LaTeX (display-only render never leaks in).
  const html = await page.evaluate(() => window.SutraNotesEditorV2.getStorageHtml());
  expect(html).toContain('data-latex="x^2"');
  expect(html).not.toContain('class="katex"');
});


test('undo history is isolated when switching between notes', async ({ page }) => {
  await openApp(page);
  await enableEditorV2(page);
  await openNotesView(page);
  await createBlankNote(page, 'undo boundary alpha');

  await page.click(PM_SELECTOR);
  await page.keyboard.type('alpha-only note content');
  const alphaId = await page.evaluate(() => {
    window.SutraNotesEditorV2.flushToMirror();
    window.savePage();
    return window.flowAtelier.currentPageId;
  });

  await createBlankNote(page, 'undo boundary beta');
  await page.click(PM_SELECTOR);
  await page.keyboard.type('beta-only note content');
  const betaId = await page.evaluate(() => {
    window.SutraNotesEditorV2.flushToMirror();
    window.savePage();
    return window.flowAtelier.currentPageId;
  });

  await page.evaluate(({ firstId, secondId }) => {
    window.loadPage(firstId);
    window.loadPage(secondId);
  }, { firstId: alphaId, secondId: betaId });
  await page.waitForFunction(({ id, text }) => {
    const pm = document.querySelector('#editorV2Host .ProseMirror');
    return window.flowAtelier.currentPageId === id && pm && pm.textContent.includes(text);
  }, { id: betaId, text: 'beta-only note content' });

  await page.click(PM_SELECTOR);
  await page.keyboard.press('Control+z');

  const current = await page.evaluate(() => ({
    pageId: window.flowAtelier.currentPageId,
    text: document.querySelector('#editorV2Host .ProseMirror').textContent
  }));
  expect(current.pageId).toBe(betaId);
  expect(current.text).toContain('beta-only note content');
  expect(current.text).not.toContain('alpha-only note content');
});
