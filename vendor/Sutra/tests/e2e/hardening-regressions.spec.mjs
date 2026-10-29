import { expect, test } from '@playwright/test';

// Targeted regressions for bugs fixed during the hardening pass.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  // Feature globals and shell markup arrive before canonical IndexedDB
  // hydration. Slides must create its page against the hydrated bridge.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
  });
}

// Regression: undoStarterPack counted EVERY deck branch as removed even when the
// deck was already gone, because deleteReviewDeck always returned true. It now
// returns whether a deck actually existed, so the "Removed N items" count is
// honest. Guard the truthful return contract here.
test('deleteReviewDeck returns true only when a deck actually existed', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => typeof window.createReviewDeck === 'function' && typeof window.deleteReviewDeck === 'function');

  const result = await page.evaluate(() => {
    const deck = window.createReviewDeck({ name: 'Regression Deck ' + Math.random().toString(36).slice(2) });
    const id = deck && deck.id;
    return {
      created: !!id,
      firstDelete: window.deleteReviewDeck(id),     // deck exists → true
      secondDelete: window.deleteReviewDeck(id),    // already gone → false
      unknownDelete: window.deleteReviewDeck('definitely-not-a-real-deck-id')
    };
  });

  expect(result.created).toBe(true);
  expect(result.firstDelete).toBe(true);
  expect(result.secondDelete).toBe(false);
  expect(result.unknownDelete).toBe(false);
});

test('Slides editor is removed from layout after switching to a normal note', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => window.SutraSlides && typeof window.SutraSlides.createPage === 'function');

  const normalPageId = await page.evaluate(() => {
    const workspace = window.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
    const normalPage = workspace.pages.find((item) => item && !(item.slides && Array.isArray(item.slides.slides)));
    return normalPage && normalPage.id;
  });
  expect(normalPageId).toBeTruthy();

  await page.evaluate(() => window.SutraSlides.createPage('Isolation regression deck'));
  await expect(page.locator('#slidesEditor')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/slides-page-active/);

  await page.evaluate((pageId) => window.loadPage(pageId), normalPageId);
  await expect(page.locator('body')).not.toHaveClass(/slides-page-active/);
  await expect(page.locator('#slidesEditor')).toBeHidden();
  await expect(page.locator('#slidesEditor')).toHaveAttribute('inert', '');
  await expect(page.locator('#slidesEditor')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#notesPrimaryPane')).toBeVisible();
});
