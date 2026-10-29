import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Workspace-wide Global Search modal (#globalSearchPanel): entry points
// (Ctrl/Cmd+K, sidebar launcher), unified results across entity types, filter
// chips, keyboard navigation, open-on-Enter/click navigation, recents,
// locked-page privacy, and freshness (new/edited/deleted items).

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
    }
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('.app-container', { state: 'visible' });
  await page.waitForFunction(() => typeof window.serializeWorkspace === 'function');
  await waitForAppReady(page);
  await completeOnboarding(page);
}

// Homework localStorage seeds must be installed before navigation so the
// canonical homework store hydrates them at boot.
async function addHomeworkSeed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hwCourses:v2', JSON.stringify([
      { id: 'c-bio', name: 'Biology 101', type: 'class' }
    ]));
    localStorage.setItem('hwTasks:v2', JSON.stringify([
      { id: 'hw-1', courseId: 'c-bio', title: 'Biology notes review', dueDate: '2026-05-22', done: false, notes: 'Review your biology notes and make flashcards.', createdAt: '2026-05-19T12:00:00.000Z', updatedAt: '2026-05-19T12:00:00.000Z' }
    ]));
    localStorage.setItem('hwSchemaVersion', '3');
  });
}

async function seedWorkspace(page, { includeQuokka = false } = {}) {
  await addHomeworkSeed(page);
  await openApp(page);
  await applyWorkspace(page, { includeQuokka });
}

// Rebuilds and imports the seeded workspace through the canonical
// deserialize path. Used for seeding and for freshness mutations.
async function applyWorkspace(page, { includeQuokka = false } = {}) {
  await page.evaluate((includeQuokka) => {
    const iso = '2026-05-19T12:00:00.000Z';
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const pages = [
      { id: 'gs-page-hub', title: 'Biology 101 Hub', content: '<p>Central hub for all course notes, labs, and resources.</p>', createdAt: iso, updatedAt: iso },
      { id: 'gs-page-cell', title: 'Cell Structure', content: '<p>Biology is the study of life. Key parts of the cell include the nucleus, membrane, and mitochondria. Photosynthesis happens in chloroplasts.</p>', createdAt: iso, updatedAt: iso },
      { id: 'gs-page-locked', title: 'Private journal', content: '<p>NEVER-SNIPPET secret contents live here.</p>', isLocked: true, lockHash: 'seeded-lock', createdAt: iso, updatedAt: iso },
      { id: 'gs-page-unrelated', title: 'Travel plans', content: '<p>Totally unrelated packing lists.</p>', createdAt: iso, updatedAt: iso }
    ];
    if (includeQuokka) {
      pages.push({ id: 'gs-page-quokka', title: 'Quokka migration patterns', content: '<p>Quokka migration notes for ecology.</p>', createdAt: iso, updatedAt: iso });
    }
    const tasks = [
      { id: 'gs-task-1', title: 'Biology flashcards', notes: 'Make cards for unit 1', dueDate: '2026-05-21', completed: false, priority: 'high', createdAt: iso, updatedAt: iso },
      { id: 'gs-task-2', title: 'Water the plants', notes: '', dueDate: '', completed: false, priority: 'low', createdAt: iso, updatedAt: iso },
      { id: 'gs-task-ap-gov', title: 'AP Gov summer work', notes: '', dueDate: '2026-08-31', completed: false, priority: 'medium', createdAt: iso, updatedAt: iso },
      { id: 'gs-task-ap-lit', title: 'AP Lit summer work', notes: '', dueDate: '2026-08-31', completed: false, priority: 'medium', createdAt: iso, updatedAt: iso },
      { id: 'gs-task-ap-networking', title: 'AP Networking Exam', notes: '', dueDate: '2026-05-05', completed: false, priority: 'low', createdAt: iso, updatedAt: iso }
    ];
    const timeBlocks = [
      { id: 'gs-block-1', name: 'Biology notes study session', date: '2026-05-21', start: '16:00', end: '17:00', category: 'study', createdAt: 1, updatedAt: 1 }
    ];
    window.deserializeWorkspace({
      ...base,
      version: 4,
      pages,
      tasks,
      taskOrder: tasks.map(t => t.id),
      timeBlocks,
      courseWorkspace: {
        schemaVersion: 1,
        courses: [
          { id: 'c-bio', name: 'Biology 101', createdAt: iso, updatedAt: iso },
          { id: 'c-ap-gov', name: 'AP Gov', createdAt: iso, updatedAt: iso }
        ],
        files: [{ id: 'gs-file-1', courseId: 'c-bio', name: 'Biology Notes Summary.pdf', originalName: 'Biology Notes Summary.pdf', kind: 'pdf', mimeType: 'application/pdf', sizeBytes: 1468006, storageType: 'indexeddb', blobKey: '', description: 'Overview of key concepts from biology notes.', createdAt: iso, updatedAt: iso }],
        resourceLinks: [],
        relationships: [],
        settings: {}
      }
    });
  }, includeQuokka);
}

async function openSearch(page) {
  await page.evaluate(() => {
    window.SutraGlobalSearchModal.open('');
  });
  await expect(page.locator('#globalSearchPanel.active')).toBeVisible();
}

async function searchFor(page, query) {
  await openSearch(page);
  await page.locator('#globalSearchInput').fill(query);
  await page.waitForFunction((q) => {
    const input = document.getElementById('globalSearchInput');
    const box = document.getElementById('globalSearchResults');
    return input && input.value === q && box && (box.querySelector('.global-search-item') || box.querySelector('.global-search-empty'));
  }, query, { timeout: 5000 });
}

async function resultLabels(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#globalSearchResults .global-search-item .global-search-item-typelabel')).map(n => n.textContent.trim()));
}

test('Ctrl+K opens the search modal with focus, Esc closes and restores focus', async ({ page }) => {
  await seedWorkspace(page);

  await page.locator('#sidebarSearchLauncher').waitFor({ state: 'visible' });
  await page.locator('#sidebarSearchLauncher').focus();
  await page.keyboard.press('Control+k');

  const panel = page.locator('#globalSearchPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#globalSearchInput')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#sidebarSearchLauncher')).toBeFocused();
});

test('sidebar Search launcher opens the modal', async ({ page }) => {
  await seedWorkspace(page);
  await page.locator('#sidebarSearchLauncher').click();
  await expect(page.locator('#globalSearchPanel.active')).toBeVisible();
  await expect(page.locator('#globalSearchInput')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchPanel')).toBeHidden();
});

test('one query returns results across pages, homework, tasks, timeline, and attachments with highlights', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'biology');

  const types = await resultLabels(page);
  expect(types).toContain('Page');
  expect(types).toContain('Note');
  expect(types).toContain('Homework');
  expect(types).toContain('Task');
  expect(types).toContain('Timeline event');
  expect(types).toContain('Attachment');

  const count = await page.locator('#globalSearchCount').textContent();
  expect(count).toMatch(/\d+ results?/);

  const marks = await page.evaluate(() => Array.from(document.querySelectorAll('#globalSearchResults mark')).map(n => n.textContent.toLowerCase()));
  expect(marks.some(text => text.includes('biolog'))).toBeTruthy();
});

test('specific multi-word queries suppress partial-token noise', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'ap gov summer work');

  const titles = await page.locator('#globalSearchResults .global-search-item-title').allTextContents();
  expect(titles).toContain('AP Gov summer work');
  expect(titles).toContain('AP Lit summer work');
  expect(titles).not.toContain('AP Networking Exam');
  expect(titles).not.toContain('AP Gov');
  expect(titles[0]).toBe('AP Gov summer work');
});

test('search card remains solid over page content in Minimal card mode', async ({ page }) => {
  await seedWorkspace(page);
  await page.evaluate(() => document.body.setAttribute('data-card-style', 'minimal'));
  await searchFor(page, 'biology');

  const surface = await page.locator('.global-search-card').evaluate((card) => {
    const style = getComputedStyle(card);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none'
    };
  });
  expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(surface.backgroundColor).not.toBe('transparent');
  expect(surface.backgroundImage).toBe('none');
  expect(surface.backdropFilter).toBe('none');
});

test('locked pages appear by title only and never leak contents', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'private journal');

  const bodyText = await page.locator('#globalSearchResults').innerText();
  expect(bodyText).toContain('Private journal');
  expect(bodyText).not.toContain('NEVER-SNIPPET');
  expect(bodyText).not.toContain('secret contents');
  expect(bodyText).toContain('Locked');
});

test('filter chips narrow results to the selected entity type', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'biology');

  await page.locator('[data-gs-filter="homework"]').click();
  await page.waitForFunction(() => {
    const box = document.getElementById('globalSearchResults');
    return box && box.querySelector('[data-gs-type="homework"]') && !box.querySelector('[data-gs-type="page"]');
  });
  let labels = await resultLabels(page);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every(l => l === 'Homework')).toBeTruthy();

  await page.locator('[data-gs-filter="pages"]').click();
  await page.waitForFunction(() => {
    const box = document.getElementById('globalSearchResults');
    const first = box && box.querySelector('[data-gs-type]');
    return first && first.getAttribute('data-gs-type') === 'page';
  });
  labels = await resultLabels(page);
  expect(labels.every(l => l === 'Page')).toBeTruthy();

  await page.locator('[data-gs-filter="all"]').click();
  await page.locator('#globalSearchInput').fill('zzzznothing');
  await expect(page.locator('#globalSearchResults .global-search-empty')).toBeVisible();
});

test('keyboard navigation moves the selection and Enter opens the page', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'biology');

  const firstActive = await page.evaluate(() => document.getElementById('globalSearchInput').getAttribute('aria-activedescendant'));
  expect(firstActive).toBe('globalSearchResult-0');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((prev) => document.getElementById('globalSearchInput').getAttribute('aria-activedescendant') !== prev, firstActive);
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchPanel')).toBeHidden();

  // Single-result search: Enter opens the selected (first) result.
  await searchFor(page, 'photosynthesis');
  await page.keyboard.press('Enter');
  await expect(page.locator('#globalSearchPanel')).toBeHidden();
  await expect(page.locator('#pageTitle')).toHaveValue(/Cell Structure/i);
});

test('clicking a result opens the underlying item', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'photosynthesis');

  await page.locator('#globalSearchResults .global-search-item').first().click();
  await expect(page.locator('#globalSearchPanel')).toBeHidden();
  await expect(page.locator('#pageTitle')).toHaveValue(/Cell Structure/i);
});

test('timeline result navigates to the block date', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'study session');

  await page.locator('#globalSearchResults [data-gs-type="timeline"]').first().click();
  await expect(page.locator('#globalSearchPanel')).toBeHidden();
  const timelineState = await page.evaluate(() => document.getElementById('view-timeline') && document.getElementById('view-timeline').classList.contains('active'));
  expect(timelineState).toBeTruthy();
});

test('recent searches appear on the next open, re-run on click, and Clear empties them', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'photosynthesis');
  await page.locator('#globalSearchResults .global-search-item').first().click();
  await expect(page.locator('#globalSearchPanel')).toBeHidden();

  await openSearch(page);
  const recents = page.locator('#globalSearchResults [data-gs-recent]');
  await expect(recents.first()).toBeVisible();
  await expect(recents.first()).toContainText('photosynthesis');

  await recents.first().click();
  await expect(page.locator('#globalSearchResults .global-search-item').first()).toBeVisible();

  await page.evaluate(() => window.SutraGlobalSearchModal.open(''));
  await page.locator('[data-gs-clear-recents]').click();
  await expect(page.locator('#globalSearchResults [data-gs-recent]')).toHaveCount(0);
});

test('new and deleted workspace items are reflected immediately', async ({ page }) => {
  await seedWorkspace(page);

  await searchFor(page, 'quokka migration');
  await expect(page.locator('#globalSearchResults .global-search-empty')).toBeVisible();

  // Add through the canonical workspace path, then search again.
  await applyWorkspace(page, { includeQuokka: true });
  await searchFor(page, 'quokka migration');
  await expect(page.locator('#globalSearchResults')).toContainText('Quokka migration patterns');

  // Remove it again through the same canonical path.
  await applyWorkspace(page, { includeQuokka: false });
  await searchFor(page, 'quokka migration');
  await expect(page.locator('#globalSearchResults .global-search-empty')).toBeVisible();
});

test('no unexpected page errors during search interactions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await seedWorkspace(page);
  await searchFor(page, 'biology');
  await page.locator('[data-gs-filter="attachments"]').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('metadata-only queries surface homework by due date and attachments by kind', async ({ page }) => {
  await seedWorkspace(page);

  // The seeded homework is due 2026-05-22; its title/notes never contain it.
  await searchFor(page, '2026-05-22');
  const dueLabels = await resultLabels(page);
  expect(dueLabels).toContain('Homework');
  const dueBody = await page.locator('#globalSearchResults').innerText();
  expect(dueBody).toContain('Biology notes review');

  // The seeded attachment is the only PDF; its name contains no "pdf" token
  // beyond the extension, so query the MIME type instead.
  await page.locator('#globalSearchInput').fill('application/pdf');
  await page.waitForFunction(() => {
    const input = document.getElementById('globalSearchInput');
    const box = document.getElementById('globalSearchResults');
    return input && input.value === 'application/pdf' && box && (box.querySelector('.global-search-item') || box.querySelector('.global-search-empty'));
  }, undefined, { timeout: 5000 });
  await expect(page.locator('#globalSearchResults')).toContainText('Biology Notes Summary.pdf');
});

test('phone layout (390x844): full-viewport overlay, sheet card, no overflow, reachable chips, no bleed-through', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedWorkspace(page);
  await searchFor(page, 'biology');

  const geo = await page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const panel = document.getElementById('globalSearchPanel');
    const chips = panel.querySelector('.global-search-chips');
    // Measure at scroll origin first: the active chip must be visible.
    const chipRectsAtOrigin = Array.from(chips.querySelectorAll('[data-gs-filter]')).map((c) => rect(c));
    const activeChip = rect(panel.querySelector('[data-gs-filter].is-active'));
    // Then scroll to the far end: the last chip must become reachable/visible.
    chips.scrollLeft = chips.scrollWidth;
    const chipRectsAtEnd = Array.from(chips.querySelectorAll('[data-gs-filter]')).map((c) => rect(c));
    const clearBtn = panel.querySelector('#globalSearchClear');
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      panel: rect(panel),
      backdrop: rect(panel.querySelector('.global-search-backdrop')),
      card: rect(panel.querySelector('.global-search-card')),
      inputRow: rect(panel.querySelector('.global-search-inputrow')),
      close: rect(panel.querySelector('.global-search-close')),
      clear: clearBtn && !clearBtn.hidden ? rect(clearBtn) : null,
      activeChip,
      chipsScroll: { scrollWidth: chips.scrollWidth, clientWidth: chips.clientWidth, scrollLeft: chips.scrollLeft },
      chipRectsAtOrigin,
      chipRectsAtEnd,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    };
  });

  // Overlay root + backdrop cover the entire visual viewport.
  expect(geo.viewport.w).toBe(390);
  expect(geo.viewport.h).toBe(844);
  for (const surface of [geo.panel, geo.backdrop]) {
    expect(surface.x).toBeLessThanOrEqual(0.5);
    expect(surface.y).toBeLessThanOrEqual(0.5);
    expect(surface.right).toBeGreaterThanOrEqual(389.5);
    expect(surface.bottom).toBeGreaterThanOrEqual(843.5);
  }

  // No document-level horizontal overflow.
  expect(geo.docScrollWidth).toBeLessThanOrEqual(390);
  expect(geo.bodyScrollWidth).toBeLessThanOrEqual(390);

  // Card is a sheet fully inside the viewport.
  expect(geo.card.x).toBeGreaterThanOrEqual(0);
  expect(geo.card.y).toBeGreaterThanOrEqual(0);
  expect(geo.card.right).toBeLessThanOrEqual(390.5);
  expect(geo.card.bottom).toBeLessThanOrEqual(844.5);

  // Input row, close control, and the active filter stay inside the viewport.
  for (const [name, box] of [['inputRow', geo.inputRow], ['close', geo.close], ['activeChip', geo.activeChip]]) {
    expect(box, name).toBeTruthy();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.right, name).toBeLessThanOrEqual(390.5);
    expect(box.bottom, name).toBeLessThanOrEqual(844.5);
  }

  // Primary mobile controls meet the 44px touch target.
  expect(geo.close.height).toBeGreaterThanOrEqual(43.5);
  expect(geo.activeChip.height).toBeGreaterThanOrEqual(43.5);
  if (geo.clear) expect(geo.clear.height).toBeGreaterThanOrEqual(43.5);

  // The nowrap filter row scrolls horizontally and every chip is reachable:
  // the active chip is fully visible at scroll origin, and the last chip is
  // fully visible after scrolling to the far end. (Chips partially clipped at
  // the scroll boundary are expected; the container clips them, and the
  // document-overflow assertions above prove nothing spills.)
  expect(geo.chipsScroll.scrollWidth).toBeGreaterThan(geo.chipsScroll.clientWidth);
  expect(geo.chipsScroll.scrollLeft).toBeGreaterThan(0);
  expect(geo.activeChip.x).toBeGreaterThanOrEqual(-0.5);
  expect(geo.activeChip.right).toBeLessThanOrEqual(390.5);
  const lastChipAtEnd = geo.chipRectsAtEnd[geo.chipRectsAtEnd.length - 1];
  expect(lastChipAtEnd.x).toBeGreaterThanOrEqual(-0.5);
  expect(lastChipAtEnd.right).toBeLessThanOrEqual(390.5);

  // Nothing under the sheet is interactable: a point below the card (inside
  // the viewport) is the backdrop, and clicking it dismisses the modal.
  const probe = await page.evaluate(() => {
    const card = document.querySelector('#globalSearchPanel .global-search-card').getBoundingClientRect();
    const x = Math.min(195, Math.max(8, window.innerWidth / 2));
    const y = Math.min(window.innerHeight - 8, card.bottom + 24);
    const el = document.elementFromPoint(x, y);
    return { x, y, hit: el ? String(el.className || el.id || el.tagName) : '' };
  });
  expect(probe.hit).toContain('global-search-backdrop');
  await page.mouse.click(probe.x, probe.y);
  await expect(page.locator('#globalSearchPanel')).toBeHidden();

  // Scroll lock released, focus restored into the app.
  expect(await page.evaluate(() => document.body.classList.contains('sutra-modal-lock'))).toBeFalsy();
});

test('filter chips are keyboard-operable aria-pressed toggles', async ({ page }) => {
  await seedWorkspace(page);
  await searchFor(page, 'biology');

  const chipOrder = ['all', 'pages', 'notes', 'homework', 'tasks', 'timeline', 'attachments'];
  await page.locator('[data-gs-filter="all"]').focus();
  await expect(page.locator('[data-gs-filter="all"]')).toBeFocused();

  for (let i = 0; i < chipOrder.length; i += 1) {
    const key = chipOrder[i];
    // Activate the focused chip: Enter for the first, Space for the second,
    // Enter thereafter — both activation keys must work on toggle buttons.
    await page.keyboard.press(i === 1 ? ' ' : 'Enter');
    await page.waitForFunction((k) => {
      const active = document.querySelector('[data-gs-filter].is-active');
      return active && active.getAttribute('data-gs-filter') === k;
    }, key);

    const state = await page.evaluate(() => ({
      pressed: Array.from(document.querySelectorAll('[data-gs-filter]'))
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => c.getAttribute('data-gs-filter')),
      anyAriaSelected: !!document.querySelector('[data-gs-filter][aria-selected]')
    }));
    expect(state.pressed).toEqual([key]);
    expect(state.anyAriaSelected).toBeFalsy();

    // Homework filter narrows the visible result types.
    if (key === 'homework') {
      await page.waitForFunction(() => {
        const box = document.getElementById('globalSearchResults');
        const first = box && box.querySelector('.global-search-item [data-gs-type]');
        return first && first.getAttribute('data-gs-type') === 'homework';
      });
    }

    if (i < chipOrder.length - 1) {
      await page.keyboard.press('Tab');
      const nextFocused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-gs-filter'));
      expect(nextFocused).toBe(chipOrder[i + 1]);
    }
  }

  // Shift+Tab walks backwards too.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-gs-filter'))).toBe('timeline');
});

test('shortcut scopes: Ctrl+K search, Ctrl+Shift+P palette, AP add-subject, V2 insert link', async ({ page }) => {
  await seedWorkspace(page);

  // 1. Ctrl+K opens Global Search.
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchPanel.active')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchPanel')).toBeHidden();

  // 2. Ctrl+Shift+P opens the Command Palette.
  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('#commandPaletteModal.active')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#commandPaletteModal')).toBeHidden();

  // 3. On an enabled AP Study (Testing Hub) view, Ctrl+K is owned by Add
  // subject. AP Study is an opt-in pack, so enable it through the same
  // runtime path the tutorial uses before asserting the exception.
  await page.evaluate(() => window.tutorialRevealView('apstudy'));
  await page.waitForFunction(() => {
    const view = document.getElementById('view-apstudy');
    return view && view.classList.contains('active');
  });
  await page.keyboard.press('Control+k');
  await expect(page.locator('#apStudyModal')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('globalSearchPanel').classList.contains('active'))).toBeFalsy();
  await page.keyboard.press('Escape');
  await expect(page.locator('#apStudyModal')).toBeHidden();

  // 4. Inside the Notes Editor V2, Ctrl+K remains Insert Link.
  const pageId = await page.evaluate(() => {
    const payload = JSON.parse(JSON.stringify(window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false })));
    const target = (payload.pages || []).find((p) => p.id === 'gs-page-cell');
    if (target && typeof window.loadPage === 'function') window.loadPage(target.id);
    return target ? target.id : null;
  });
  expect(pageId).toBe('gs-page-cell');
  await expect(page.locator('#editorV2Host')).toBeVisible();
  await page.locator('#editorV2Host [contenteditable="true"]').first().click();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#customPromptModal')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('globalSearchPanel').classList.contains('active'))).toBeFalsy();
});
