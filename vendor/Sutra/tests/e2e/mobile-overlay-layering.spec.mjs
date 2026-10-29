import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

test.use({ viewport: { width: 390, height: 844 } });

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#sutraBottomNav', { state: 'attached' });
  // The phone shell is present before canonical startup can finish. Settle that
  // boundary before suppressing onboarding or inserting sidebar test pages.
  await waitForAppReady(page);
  await page.evaluate(async () => {
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
    await window.flowAtelier.flushAppSaveNow('e2e-mobile-overlay-onboarding-complete');
  });
  await expect(page.locator('#sutraBottomNav')).toBeVisible();
}

test('blocking dialogs and sheets remain above fixed mobile navigation', async ({ page }, testInfo) => {
  await openApp(page);

  const report = await page.evaluate(() => {
    const nav = document.getElementById('sutraBottomNav');
    const navStyle = getComputedStyle(nav);
    const navLayer = Number.parseInt(navStyle.zIndex, 10);
    const tokenLayer = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--z-nav'),
      10
    );

    const selector = [
      '.modal',
      '.version-history-modal',
      '.command-palette-modal',
      '.quick-capture-modal',
      '.deadline-radar-modal',
      '.google-feedback-modal',
      '.doc-stats-modal',
      '.acad-modal-overlay',
      '.emoji-modal-overlay',
      '.emoji-picker',
      '.hw-paste-modal',
      '.class-dashboard-drawer',
      '.atelier-onboarding',
      '.onboarding-overlay',
      '.cw-modal-overlay',
      '.th2-modal-overlay',
      '.doc-bg-modal',
      '#atelierDialogBackdrop',
      '#studentOnboardingOverlay',
      '#homeworkPasteImportModal',
      '#globalSearchPanel',
      '#businessEntityModal',
      '#googleFeedbackModal',
      '#docStatsModal',
      '#todayAcademicDeadlineModal',
      '#pageLinkModal',
      '#reviewModalRoot',
      '#hwCourseQuickModal',
      '.sutra-academic-modal',
      '[data-sutra-layer="modal"]'
    ].join(',');

    const seen = new Set();
    const surfaces = Array.from(document.querySelectorAll(selector))
      .filter((surface) => {
        if (seen.has(surface)) return false;
        seen.add(surface);
        return getComputedStyle(surface).position === 'fixed';
      })
      .map((surface) => ({
        name: surface.id
          ? `#${surface.id}`
          : `.${Array.from(surface.classList).join('.')}`,
        layer: Number.parseInt(getComputedStyle(surface).zIndex, 10)
      }));

    return {
      navLayer,
      tokenLayer,
      surfaces,
      failures: surfaces.filter((surface) => !Number.isFinite(surface.layer) || surface.layer <= navLayer)
    };
  });

  expect(report.navLayer).toBe(report.tokenLayer);
  expect(report.surfaces.length).toBeGreaterThan(20);
  expect(report.failures, JSON.stringify(report.failures, null, 2)).toEqual([]);

  await page.evaluate(() => window.openQuickCaptureModal(''));
  const capture = page.locator('#quickCaptureModal');
  await expect(capture).toBeVisible();
  await expect(capture).toHaveAttribute('aria-hidden', 'false');

  const geometry = await page.evaluate(() => {
    const nav = document.getElementById('sutraBottomNav');
    const capture = document.getElementById('quickCaptureModal');
    return {
      navLayer: Number.parseInt(getComputedStyle(nav).zIndex, 10),
      captureLayer: Number.parseInt(getComputedStyle(capture).zIndex, 10),
      topElementId: document.elementFromPoint(
        window.innerWidth / 2,
        Math.min(window.innerHeight - 8, nav.getBoundingClientRect().top + 8)
      )?.closest('#quickCaptureModal, #sutraBottomNav')?.id || ''
    };
  });

  expect(geometry.captureLayer).toBeGreaterThan(geometry.navLayer);
  expect(geometry.topElementId).toBe('quickCaptureModal');

  if (process.env.SUTRA_CAPTURE_QA === '1') {
    await page.screenshot({
      path: '.tmp/quick-capture-above-mobile-nav.png',
      fullPage: false
    });
  } else {
    await testInfo.attach('quick-capture-above-mobile-nav', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    });
  }

  await page.keyboard.press('Escape');
  await expect(capture).toBeHidden();
  await page.locator('[data-bn-view="__more"]').click();

  const moreOverlay = page.locator('.sutra-mobile-more-overlay');
  await expect(moreOverlay).toBeVisible();
  const moreGeometry = await page.evaluate(() => {
    const nav = document.getElementById('sutraBottomNav');
    const overlay = document.querySelector('.sutra-mobile-more-overlay');
    return {
      navLayer: Number.parseInt(getComputedStyle(nav).zIndex, 10),
      overlayLayer: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
      topSurface: document.elementFromPoint(
        window.innerWidth / 2,
        Math.min(window.innerHeight - 8, nav.getBoundingClientRect().top + 8)
      )?.closest('.sutra-mobile-more-overlay, #sutraBottomNav')?.className || ''
    };
  });

  expect(moreGeometry.overlayLayer).toBeGreaterThan(moreGeometry.navLayer);
  expect(moreGeometry.topSurface).toContain('sutra-mobile-more-overlay');

  if (process.env.SUTRA_CAPTURE_QA === '1') {
    await page.screenshot({
      path: '.tmp/all-sections-above-mobile-nav.png',
      fullPage: false
    });
  } else {
    await testInfo.attach('all-sections-above-mobile-nav', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    });
  }
});

test('opening the phone notes sidebar keeps the drawer contents sharp', async ({ page }) => {
  await openApp(page);
  await page.locator('#sutraBottomNav [data-bn-view="notes"]').click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.view)).toBe('notes');

  const sidebar = page.locator('#sidebar');
  const toggle = page.locator('#sidebarToggle');
  if (!(await sidebar.evaluate((node) => node.classList.contains('collapsed')))) {
    await page.evaluate(() => document.getElementById('sidebarToggle').click());
  }
  await toggle.click();
  await expect(page.locator('#sidebarOverlay')).toHaveClass(/active/);

  const styles = await page.evaluate(() => ({
    overlay: (() => {
      const style = getComputedStyle(document.getElementById('sidebarOverlay'));
      return {
        backdropFilter: style.getPropertyValue('backdrop-filter'),
        webkitBackdropFilter: style.getPropertyValue('-webkit-backdrop-filter')
      };
    })(),
    sidebar: (() => {
      const style = getComputedStyle(document.getElementById('sidebar'));
      return {
        filter: style.getPropertyValue('filter'),
        backdropFilter: style.getPropertyValue('backdrop-filter'),
        webkitBackdropFilter: style.getPropertyValue('-webkit-backdrop-filter')
      };
    })()
  }));

  expect(`${styles.overlay.backdropFilter || ''} ${styles.overlay.webkitBackdropFilter || ''}`).not.toMatch(/blur/i);
  expect(styles.sidebar.filter || '').not.toMatch(/blur/i);
  expect(`${styles.sidebar.backdropFilter || ''} ${styles.sidebar.webkitBackdropFilter || ''}`).not.toMatch(/blur/i);
});

test('phone notes and folder rows remain clickable above the sidebar scrim', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const now = new Date().toISOString();
    window.deserializeWorkspace({
      ...base,
      pages: [
        ...base.pages,
        {
          id: 'mobile-click-folder',
          title: 'Mobile Click Folder',
          type: 'folder',
          content: '',
          icon: '📁',
          isSystemPage: false,
          builtInId: '',
          systemRole: '',
          createdAt: now,
          updatedAt: now,
          collapsed: true
        },
        {
          id: 'mobile-click-note',
          title: 'Mobile Click Folder::Mobile Click Note',
          type: 'note',
          content: '<p>Mobile sidebar click target.</p>',
          icon: '📄',
          isSystemPage: false,
          builtInId: '',
          systemRole: '',
          createdAt: now,
          updatedAt: now
        }
      ]
    });
  });
  await page.locator('#sutraBottomNav [data-bn-view="notes"]').click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.view)).toBe('notes');

  const sidebar = page.locator('#sidebar');
  const toggle = page.locator('#sidebarToggle');
  if (!(await sidebar.evaluate((node) => node.classList.contains('collapsed')))) {
    await page.evaluate(() => document.getElementById('sidebarToggle').click());
  }
  await toggle.click();
  await expect(page.locator('#sidebarOverlay')).toHaveClass(/active/);

  const folder = page.locator('.page-item[data-page-id="mobile-click-folder"]');
  const note = page.locator('.page-item[data-page-id="mobile-click-note"]');
  await expect(folder).toBeVisible();
  await expect(note).toBeHidden();
  await folder.click();
  await expect(note).toBeVisible();
  await note.click();
  await expect.poll(() => page.evaluate(() => window.flowAtelier.currentPageId)).toBe('mobile-click-note');
});
