import { expect, test } from '@playwright/test';

// Phase 4 — accessible modal consolidation. Verifies the Review modals and the
// Homework quick-add modal now run through SutraModalManager (Tab-trap,
// scroll-lock, Escape close, focus restoration) without leaking listeners, and
// that repeated open/close cycles stay stable on desktop + mobile viewports.

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
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  // Modal keyboard tests start after the optional startup intro. Otherwise
  // their first Enter can dismiss the intro instead of activating the trigger.
  await page.addInitScript(() => sessionStorage.setItem('sutra_intro_played', '1'));
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  // .app-container is visible on both desktop and mobile viewports (the desktop
  // brand-mark is CSS-hidden on phones), so it is the portable boot signal.
  await expect(page.locator('.app-container')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Homework subject/category quick-add modal (#hwCourseQuickModal)
// ---------------------------------------------------------------------------

async function gotoHomework(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hwCourses:v2', JSON.stringify([{ id: 'c-seed', name: 'Biology', type: 'class' }]));
    localStorage.setItem('hwTasks:v2', JSON.stringify([]));
    localStorage.setItem('hwSchemaVersion', '3');
  });
}

test('Homework quick-add modal: dialog semantics, Tab-trap, Escape close + focus restore, no listener growth', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    ['mobile-chromium', 'tablet', 'narrow-desktop'].includes(testInfo.project.name),
    'Desktop trigger focus-restore stress case; responsive projects use the dedicated mobile usability modal test.'
  );
  await gotoHomework(page);
  await openApp(page);
  await page.evaluate(() => window.setActiveView && window.setActiveView('homework'));
  const trigger = page.locator('[data-course-add]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });

  const baselineListeners = await page.evaluate(() => window.SutraModalManager.getListenerCount());

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const modal = page.locator('#hwCourseQuickModal');
    await expect(modal).toBeVisible();
    // Dialog semantics.
    await expect(modal.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();
    // Manager registered it as the active modal.
    await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(1);
    // Initial focus landed inside the modal.
    await expect.poll(() => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#hwCourseQuickModal'))).toBe(true);

    // Tab + Shift+Tab cannot escape the modal.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#hwCourseQuickModal'))).toBe(true);

    // Escape (handled by the manager) closes the modal and restores focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect.poll(() => page.evaluate(() => !!document.activeElement && document.activeElement.matches('[data-course-add]'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(0);
  }

  // Body scroll-lock is released and no keydown listeners accumulated.
  expect(await page.evaluate(() => document.body.classList.contains('sutra-modal-lock'))).toBe(false);
  expect(await page.evaluate(() => window.SutraModalManager.getListenerCount())).toBe(baselineListeners);
});

test('Homework quick-add modal is usable on a mobile viewport', async ({ page }) => {
  await gotoHomework(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.evaluate(() => window.setActiveView && window.setActiveView('homework'));
  const trigger = page.locator('[data-course-add]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await trigger.click();
  const input = page.locator('#hwCourseQuickModal [data-course-quick-input]');
  await expect(input).toBeVisible();
  await input.fill('Chemistry');
  // The Add control is a real, tappable target.
  const box = await page.locator('#hwCourseQuickModal [data-course-quick-add]').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(28);
  await page.keyboard.press('Escape');
  await expect(page.locator('#hwCourseQuickModal')).toBeHidden();
});

// ---------------------------------------------------------------------------
// Review modals (#reviewModalRoot) — own Escape via data-sutra-no-escape
// ---------------------------------------------------------------------------

// Creates a deck and opens its detail view, where the Review modal triggers
// (Bulk import / Delete) live in the header action row.
async function openReviewDeckDetail(page) {
  await page.waitForFunction(() => typeof window.openReviewTab === 'function'
    && typeof window.createReviewDeck === 'function'
    && typeof window.openReviewDeck === 'function');
  await page.evaluate(() => {
    window.openReviewTab && window.openReviewTab();
    const deck = window.createReviewDeck ? window.createReviewDeck({ name: 'Modal QA Deck' }) : null;
    const id = deck && (deck.id || deck.deckId) ? (deck.id || deck.deckId) : (typeof deck === 'string' ? deck : null);
    if (id && window.openReviewDeck) window.openReviewDeck(id);
    else if (window.renderReviewWorkspace) window.renderReviewWorkspace();
  });
}

test('Review modal: dialog semantics, Tab-trap, own-Escape close + focus restore, no listener growth', async ({ page }) => {
  await openApp(page);
  await openReviewDeckDetail(page);
  const trigger = page.locator('[data-review-action="open-bulk-import"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });

  const baselineListeners = await page.evaluate(() => window.SutraModalManager.getListenerCount());

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await trigger.click();
    const root = page.locator('#reviewModalRoot');
    await expect(root.locator('.review-modal-card[role="dialog"][aria-modal="true"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(1);
    await expect.poll(() => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#reviewModalRoot'))).toBe(true);

    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#reviewModalRoot'))).toBe(true);

    // Escape is handled by review.js's own handler (data-sutra-no-escape); the
    // manager still restores focus to the trigger via onClose.
    await page.keyboard.press('Escape');
    await expect(root.locator('.review-modal-card')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.activeElement && document.activeElement.matches('[data-review-action="open-bulk-import"]'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(0);
  }

  expect(await page.evaluate(() => document.body.classList.contains('sutra-modal-lock'))).toBe(false);
  expect(await page.evaluate(() => window.SutraModalManager.getListenerCount())).toBe(baselineListeners);
});

test('Review confirm modal traps focus and closes on Escape', async ({ page }) => {
  await openApp(page);
  await openReviewDeckDetail(page);
  const del = page.locator('[data-review-action="delete-deck"]').first();
  await del.waitFor({ state: 'visible', timeout: 15000 });
  await del.click();
  const root = page.locator('#reviewModalRoot');
  await expect(root.locator('.review-modal-card[role="dialog"]')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('#reviewModalRoot'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(root.locator('.review-modal-card')).toHaveCount(0);
});

test('open modal isolates background content with inert and releases it on close', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === 'tablet',
    'Same manager path as desktop; covered once per engine.'
  );
  await gotoHomework(page);
  await openApp(page);
  await page.evaluate(() => window.setActiveView && window.setActiveView('homework'));
  const trigger = page.locator('[data-course-add]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await trigger.click();
  const modal = page.locator('#hwCourseQuickModal');
  await expect(modal).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(1);

  // While the modal is open, the modal's ancestor path stays operable and
  // every sibling branch containing background controls is isolated.
  const whileOpen = await page.evaluate(() => {
    const inertRoots = Array.from(document.querySelectorAll('[data-sutra-modal-inert]')).map(el => el.id || el.className || el.tagName);
    const modalRoot = document.getElementById('hwCourseQuickModal');
    const isolatedControl = Array.from(document.querySelectorAll('[data-sutra-modal-inert]'))
      .find(branch => branch.querySelector('button, input, select, textarea, a[href]'));
    return {
      inertCount: inertRoots.length,
      modalHasInertAncestor: !!modalRoot?.closest('[data-sutra-modal-inert]'),
      backgroundControlBranchInert: !!isolatedControl && isolatedControl.inert === true,
      backgroundControlBranchHidden: isolatedControl?.getAttribute('aria-hidden') === 'true'
    };
  });
  expect(whileOpen.inertCount).toBeGreaterThan(0);
  expect(whileOpen.modalHasInertAncestor).toBe(false);
  expect(whileOpen.backgroundControlBranchInert).toBe(true);
  expect(whileOpen.backgroundControlBranchHidden).toBe(true);

  // Focus cannot land on inert background content via keyboard.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('#hwCourseQuickModal'))).toBe(true);

  // Closing the last modal fully releases every MANAGED inert root (other
  // subsystems may keep their own legitimate inert state, e.g. the
  // contextual-shell sidebar).
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({
    active: window.SutraModalManager.getActiveCount(),
    marked: document.querySelectorAll('[data-sutra-modal-inert]').length,
    appBackgroundStillInert: (() => {
      const el = document.querySelector('.app-container');
      return !!el && el.hasAttribute('data-sutra-modal-inert') && el.inert === true;
    })()
  }))).toEqual({ active: 0, marked: 0, appBackgroundStillInert: false });
});

test('emoji picker keeps its sibling surfaces interactive while open', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.setActiveView && window.setActiveView('notes'));
  await page.waitForFunction(() => document.getElementById('view-notes')?.classList.contains('active'));

  const sidebar = page.locator('#sidebar');
  const openSidebar = async () => {
    if (await sidebar.evaluate(element => element.classList.contains('collapsed'))) {
      await page.locator('#sidebarToggle').click();
    }
  };
  await openSidebar();

  await page.locator('button.new-page-btn:visible').first().click();
  await page.fill('#newPageName', 'Emoji picker modal QA');
  await page.locator('#newPageModal button.btn-primary').click();
  await page.waitForFunction(() => document.getElementById('pageTitle')?.value === 'Emoji picker modal QA');
  await openSidebar();
  const pageId = await page.evaluate(() => window.flowAtelier.currentPageId);
  const icon = page.locator(`.page-item[data-page-id="${pageId}"] .page-icon`);
  await expect(icon).toBeVisible();
  await icon.click();

  const picker = page.locator('#emojiPicker');
  const overlay = page.locator('#emojiModalOverlay');
  await expect(picker).toHaveClass(/active/);
  await expect(overlay).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(2);
  await expect(page.locator('#emojiSearch')).toBeFocused();

  const protectedState = await page.evaluate(() => {
    const picker = document.getElementById('emojiPicker');
    const overlay = document.getElementById('emojiModalOverlay');
    return {
      pickerInert: picker?.inert === true,
      pickerMarkedInert: picker?.hasAttribute('data-sutra-modal-inert') === true,
      pickerAriaHidden: picker?.getAttribute('aria-hidden'),
      overlayInert: overlay?.inert === true,
      overlayMarkedInert: overlay?.hasAttribute('data-sutra-modal-inert') === true,
      backgroundIsolated: Array.from(document.querySelectorAll('[data-sutra-modal-inert]')).some((branch) =>
        branch.querySelector('button, input, select, textarea, a[href]')
      )
    };
  });
  expect(protectedState).toEqual({
    pickerInert: false,
    pickerMarkedInert: false,
    pickerAriaHidden: null,
    overlayInert: false,
    overlayMarkedInert: false,
    backgroundIsolated: true
  });

  const allGrid = page.locator('#emojiGrid');
  const allScrollTop = await allGrid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(allScrollTop).toBeGreaterThan(0);

  const search = page.locator('#emojiSearch');
  await search.fill('heart');
  await expect(search).toBeFocused();
  await expect(page.locator('#emojiGrid .emoji-option').first()).toBeVisible();

  const category = page.locator('#emojiPicker .emoji-cat-btn').nth(1);
  await category.click();
  await expect(category).toHaveClass(/active/);
  await expect(search).toHaveValue('');
  await expect(picker).toHaveClass(/active/);

  const choice = page.locator('#emojiGrid .emoji-option').first();
  const selectedEmoji = await choice.textContent();
  await choice.click();
  await expect(picker).not.toHaveClass(/active/);
  await expect(overlay).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(0);
  await expect.poll(() => page.evaluate((id) => window.flowAtelier.pages.find((entry) => entry.id === id)?.icon || '', pageId)).toBe(selectedEmoji);

  await icon.click();
  await expect(picker).toHaveClass(/active/);
  await page.locator('#emojiPicker .emoji-close-btn').click();
  await expect(picker).not.toHaveClass(/active/);

  await icon.click();
  await expect(picker).toHaveClass(/active/);
  await page.evaluate(() => document.getElementById('emojiModalOverlay').click());
  await expect(picker).not.toHaveClass(/active/);

  await icon.click();
  await expect(picker).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(picker).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.SutraModalManager.getActiveCount())).toBe(0);

  await openSidebar();
  await icon.click();
  await expect(picker).toHaveClass(/active/);
  await page.locator('#emojiPicker .emoji-remove-btn').click();
  await expect(picker).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate((id) => window.flowAtelier.pages.find((entry) => entry.id === id)?.icon, pageId)).toBeUndefined();
});

test('stacked modals isolate the lower dialog and restore focus when the top closes', async ({ page }) => {
  await openApp(page);
  const opened = await page.evaluate(async () => {
    const makeModal = (id, label) => {
      const root = document.createElement('div');
      root.id = id;
      root.className = 'modal active';
      root.style.cssText = 'display:grid;position:fixed;inset:0;z-index:2147483000;';
      const dialog = document.createElement('section');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', label);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      dialog.appendChild(button);
      root.appendChild(dialog);
      document.body.appendChild(root);
      return { root, button };
    };
    const first = makeModal('sol1StackFirst', 'First dialog');
    window.SutraModalManager.sync();
    await new Promise(resolve => setTimeout(resolve, 20));
    first.button.focus();
    const second = makeModal('sol1StackSecond', 'Second dialog');
    window.SutraModalManager.sync();
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      active: window.SutraModalManager.getActiveCount(),
      lowerIsolated: !!first.root.closest('[data-sutra-modal-inert]'),
      topIsolated: !!second.root.closest('[data-sutra-modal-inert]'),
      focusInTop: second.root.contains(document.activeElement)
    };
  });
  expect(opened).toEqual({ active: 2, lowerIsolated: true, topIsolated: false, focusInTop: true });

  const closed = await page.evaluate(async () => {
    const first = document.getElementById('sol1StackFirst');
    const second = document.getElementById('sol1StackSecond');
    second.classList.remove('active');
    window.SutraModalManager.sync();
    await new Promise(resolve => setTimeout(resolve, 40));
    const outcome = {
      active: window.SutraModalManager.getActiveCount(),
      lowerIsolated: !!first.closest('[data-sutra-modal-inert]'),
      focusInLower: first.contains(document.activeElement)
    };
    first.classList.remove('active');
    window.SutraModalManager.sync();
    first.remove();
    second.remove();
    return outcome;
  });
  expect(closed).toEqual({ active: 1, lowerIsolated: false, focusInLower: true });
});

test('encrypted backup password modal restores its trigger after every cancel path', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.setActiveView && window.setActiveView('settings'));
  const mobileCategory = page.locator('#settingsCategorySelect');
  if (await mobileCategory.isVisible()) {
    await mobileCategory.selectOption('data');
  } else {
    await page.locator('[data-settings-nav="data"]').click();
  }

  const trigger = page.locator('#exportAtelierWorkspaceBtn');
  const modal = page.locator('#sutraBackupPasswordModal');
  await trigger.waitFor({ state: 'visible', timeout: 15000 });

  const closeCases = [
    { name: 'Escape', close: async () => page.keyboard.press('Escape') },
    { name: 'Cancel', close: async () => page.locator('#sutraBackupPasswordCancelBtn').click() },
    { name: 'close button', close: async () => page.locator('#sutraBackupPasswordCloseBtn').click() }
  ];

  for (const closeCase of closeCases) {
    await test.step(closeCase.name, async () => {
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(modal).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#sutraBackupPasswordModal'))).toBe(true);

      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('#sutraBackupPasswordModal'))).toBe(true);

      await closeCase.close();
      await expect(modal).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('exportAtelierWorkspaceBtn');
    });
  }
});
