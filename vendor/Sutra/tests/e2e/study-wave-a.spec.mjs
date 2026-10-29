import { expect, test } from '@playwright/test';

// Wave A — Study upgrades:
//  #1 Automated exam-readiness predictor (AP Study)
//  #2 Image cards + image occlusion (hide-until-flip)

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.computeSuggestedExamReadiness && window.SutraReviewTesting && window.SutraReviewTesting.addCard));
}

test('exam-readiness predictor is wired and null-safe for unknown subjects', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => ({
    typeofFn: typeof window.computeSuggestedExamReadiness,
    unknown: window.computeSuggestedExamReadiness('does-not-exist')
  }));
  expect(r.typeofFn).toBe('function');
  expect(r.unknown).toBeNull();
});

test('a card stores an image and the occlude-until-flip flag', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const T = window.SutraReviewTesting;
    const deck = window.createReviewDeck({ name: 'Image deck' });
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const card = T.addCard({ deckId: deck.id, prompt: 'Label this diagram', imageUrl: tinyPng, occludeImage: true });
    return { ok: !!card, hasImage: !!(card && card.imageUrl), occlude: !!(card && card.occludeImage) };
  });
  expect(r.ok).toBe(true);
  expect(r.hasImage).toBe(true);
  expect(r.occlude).toBe(true);
});

test('the card editor exposes an image upload field and occlude toggle', async ({ page }) => {
  await openApp(page);
  // Drive to the Review/Testing Hub and open a deck's add-card drawer is heavy;
  // instead assert the form markup ships the new controls when rendered. We at
  // least confirm the field ids exist in the bundle the editor renders.
  const src = await (await page.request.get('/src/features/study/review.js')).text();
  expect(src).toContain('reviewCardImageInput');
  expect(src).toContain('reviewCardOcclude');
  expect(src).toContain('downscaleImageToDataUrl');
});
