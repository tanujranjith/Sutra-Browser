import { expect, test } from '@playwright/test';

async function openApp(page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { sessionStorage.setItem('sutra_intro_played', '1'); });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('navigation-clarity-ready'));
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    document.body.classList.remove('onboarding-open');
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
    window.setActiveView('today');
  });
  await expect(page.locator('#view-today')).toBeVisible();
}

async function enableAdvancedPacks(page) {
  await page.evaluate(() => {
    ['collegeapp', 'life', 'business', 'assistantview'].forEach((view) => {
      const toggle = document.querySelector(`#featureToggleListSettings [data-feature-view="${view}"]`);
      if (!toggle || toggle.checked) return;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    window.setActiveView('today');
  });
  await expect(page.locator('#moreViewsWrapper')).toBeVisible();
}

test('desktop navigation keeps the daily loop direct and groups advanced packs in More', async ({ page }) => {
  await openApp(page);
  await enableAdvancedPacks(page);

  for (const view of ['today', 'homework', 'notes', 'timeline', 'settings']) {
    await expect(page.locator(`.view-tabs > .view-tab[data-view="${view}"]`)).toBeVisible();
  }
  for (const view of ['apstudy', 'collegeapp', 'life', 'business', 'assistantview']) {
    await expect(page.locator(`.view-tabs > .view-tab[data-view="${view}"]`)).toBeHidden();
  }

  const more = page.locator('#moreViewsToggle');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#moreViewsMenu')).toBeVisible();
  await expect(page.locator('[data-nav-group="workspace"]')).toBeVisible();
  await expect(page.locator('[data-nav-group="tools"]')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'College' })).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Life' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#moreViewsMenu')).toBeHidden();
  await expect(more).toBeFocused();

  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Business' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'business');
  await expect(more).toContainText('Business');
  await expect(more).toHaveAttribute('aria-label', /current section Business/);
});

test('desktop shell keeps Notes contextual and gives major workspaces the full canvas', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);

  const sidebar = page.locator('#sidebar');
  const sidebarToggle = page.locator('#sidebarToggle');
  const main = page.locator('.main-content');
  const topNav = page.locator('.top-nav');

  for (const view of ['today', 'homework', 'timeline', 'settings']) {
    const directTab = page.locator(`.view-tabs > .view-tab[data-view="${view}"]`);
    if (await directTab.isVisible()) {
      await directTab.click();
    } else {
      await page.evaluate((targetView) => window.setActiveView(targetView), view);
    }
    await expect(page.locator('body')).toHaveAttribute('data-view', view);
    if (view === 'homework' && await page.locator('#hwSetupOverlay').isVisible()) {
      await page.locator('#hwSetupOverlay').getByRole('button', { name: 'Cancel for now' }).click();
    }
    await expect(page.locator('body')).toHaveAttribute('data-context-sidebar', 'none');
    await expect(sidebar).toBeHidden();
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    await expect(sidebarToggle).toBeHidden();
    expect(Math.round((await main.boundingBox()).x)).toBe(0);
    if (view === 'settings') {
      const settingsGeometry = await page.evaluate(() => {
        const nav = document.querySelector('.top-nav').getBoundingClientRect();
        const settings = document.querySelector('#view-settings').getBoundingClientRect();
        const page = document.querySelector('#view-settings .cc-page').getBoundingClientRect();
        return {
          viewportWidth: document.documentElement.clientWidth,
          navTop: Math.round(nav.top),
          navBottom: Math.round(nav.bottom),
          settingsTop: Math.round(settings.top),
          settingsLeft: Math.round(settings.left),
          settingsWidth: Math.round(settings.width),
          pageWidth: Math.round(page.width)
        };
      });
      expect(settingsGeometry.navTop).toBe(0);
      expect(settingsGeometry.settingsTop).toBe(settingsGeometry.navBottom);
      expect(settingsGeometry.settingsLeft).toBe(0);
      expect(settingsGeometry.settingsWidth).toBe(settingsGeometry.viewportWidth);
      expect(settingsGeometry.pageWidth).toBeGreaterThanOrEqual(settingsGeometry.viewportWidth - 16);
    }
  }

  expect(await page.evaluate(() => ({
    review: window.SutraContextualShell.sidebarFor('apstudy'),
    courses: window.SutraContextualShell.sidebarFor('courses'),
    custom: window.SutraContextualShell.sidebarFor('custom-student-dashboard')
  }))).toEqual({ review: 'none', courses: 'none', custom: 'none' });

  await page.locator('.view-tabs > .view-tab[data-view="notes"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-context-sidebar', 'notes');
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  await expect(sidebar).not.toHaveAttribute('inert', '');
  await expect(page.locator('.notes-toolbar-overflow')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const nav = document.querySelector('.top-nav').getBoundingClientRect();
    const sidebarRect = document.querySelector('#sidebar').getBoundingClientRect();
    const mainRect = document.querySelector('.main-content').getBoundingClientRect();
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const primaryControls = Array.from(document.querySelectorAll('.view-tabs > .view-tab')).filter(isVisible);
    const more = document.querySelector('.view-tabs > .view-more');
    if (more && isVisible(more)) primaryControls.push(more);
    const primaryRects = primaryControls.map((control) => control.getBoundingClientRect());
    const primaryLeft = Math.min(...primaryRects.map((rect) => rect.left));
    const primaryRight = Math.max(...primaryRects.map((rect) => rect.right));
    const utilityRect = document.querySelector('.nav-utility-group').getBoundingClientRect();
    return {
      navLeft: Math.round(nav.left),
      navWidth: Math.round(nav.width),
      viewportWidth: document.documentElement.clientWidth,
      sidebarWidth: Math.round(sidebarRect.width),
      mainLeft: Math.round(mainRect.left),
      primaryCenter: Math.round((primaryLeft + primaryRight) / 2),
      primaryRight: Math.round(primaryRight),
      utilityLeft: Math.round(utilityRect.left)
    };
  });
  expect(geometry.navLeft).toBe(0);
  expect(geometry.navWidth).toBe(geometry.viewportWidth);
  expect(Math.abs(geometry.primaryCenter - Math.round(geometry.viewportWidth / 2))).toBeLessThanOrEqual(2);
  expect(geometry.utilityLeft).toBeGreaterThan(geometry.primaryRight);
  expect(geometry.mainLeft).toBe(geometry.sidebarWidth);
  await expect(topNav).toBeVisible();
});

test('collapsed Notes sidebar remains a clean icon rail', async ({ page }) => {
  await openApp(page);
  await page.locator('.view-tabs > .view-tab[data-view="notes"]').click();

  const sidebar = page.locator('#sidebar');
  await page.locator('#sidebarToggle').click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect(sidebar.locator('.sidebar-context-copy')).toBeHidden();
  await expect(sidebar.locator('.sidebar-spaces-row')).toBeHidden();
  await expect(sidebar.locator('#sidebarSearchFeedback')).toBeHidden();
  await expect(sidebar.locator('.new-folder-btn')).toBeHidden();
  await expect(sidebar.locator('.quick-new-page-btn')).toBeHidden();

  const pageItem = sidebar.locator('.page-item').first();
  await expect(pageItem.locator('.page-icon')).toBeVisible();
  await expect(pageItem.locator('.page-title-text')).toBeHidden();
  await expect(pageItem.locator('.page-item-actions-toggle')).toBeHidden();
  await expect(pageItem.locator('.page-tree-guides')).toBeHidden();
  expect(await pageItem.evaluate((node) => Math.round(parseFloat(getComputedStyle(node).paddingLeft)))).toBe(0);
});

test('overflowed custom dashboards remain reachable through My dashboards', async ({ page }) => {
  await openApp(page, 1060);
  await page.waitForFunction(() => !!window.SutraCustomTabsBridge && !!window.SutraCustomTabs);
  await enableAdvancedPacks(page);
  await page.evaluate(() => {
    window.SutraCustomTabsBridge.setTabs([
      { id: 'qa-dashboard-one', name: 'Dashboard One', icon: 'fa-star', widgets: [] },
      { id: 'qa-dashboard-two', name: 'Dashboard Two', icon: 'fa-star', widgets: [] },
      { id: 'qa-dashboard-three', name: 'Dashboard Three', icon: 'fa-star', widgets: [] },
      { id: 'qa-night-shift', name: 'Night Shift', icon: 'fa-star', widgets: [] }
    ]);
    window.SutraCustomTabs.refresh();
    window.setActiveView('today');
  });

  const direct = page.locator('.view-tabs > [data-custom-tab="qa-night-shift"]');
  const overflow = page.locator('#moreViewsMenu [data-generated-overflow-item="true"][data-view="custom-qa-night-shift"]');
  await expect(direct).toBeHidden();
  await page.locator('#moreViewsToggle').click();
  await expect(page.locator('[data-nav-group="custom"]')).toBeVisible();
  await expect(overflow).toBeVisible();
  await expect(overflow).toHaveText(/Night Shift/);

  await overflow.click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'custom-qa-night-shift');
  await expect(page.locator('#view-custom-qa-night-shift')).toBeVisible();
  await expect(page.locator('#moreViewsMenu')).toBeHidden();
});

test('the 641px tablet boundary never loses both navigation surfaces', async ({ page }) => {
  await openApp(page, 641);
  await expect(page.locator('.top-nav')).toBeVisible();
  await expect(page.locator('#sutraBottomNav')).toBeHidden();
  await expect(page.locator('#moreViewsWrapper')).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  )).toBeLessThanOrEqual(1);
});
