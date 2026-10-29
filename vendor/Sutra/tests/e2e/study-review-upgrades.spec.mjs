import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Part 2 — Study & Review upgrades:
//  - Math/LaTeX rendering (vendored KaTeX, lazy + offline)
//  - Code syntax highlighting (dependency-free)
//  - Cloze deletions ({{...}})
//  - Robust deck import (Quizlet / Anki text / CSV)
//  - Retention analytics helpers (retention rate, due forecast)

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await waitForAppReady(page);
  await page.waitForFunction(() => !!(window.SutraHighlight && window.SutraMath && window.SutraReviewTesting));
}

async function openReviewDeck(page, cards) {
  const deckId = await page.evaluate((rows) => {
    const deck = window.createReviewDeck({ name: 'Mode Regression Deck' });
    rows.forEach((row) => window.SutraReviewTesting.addCard({ deckId: deck.id, prompt: row[0], answer: row[1] }));
    window.openReviewTab();
    window.openReviewDeck(deck.id);
    return deck.id;
  }, cards);
  await expect(page.locator('#reviewMount')).toBeVisible();
  return deckId;
}

test('code highlighting tokenizes keywords, strings and comments (offline, no deps)', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate(() =>
    window.SutraHighlight.highlight('const x = "hi"; // note', 'js'));
  expect(html).toContain('tok-keyword');
  expect(html).toContain('tok-string');
  expect(html).toContain('tok-comment');
  // Output is escaped — no raw injection.
  expect(html).not.toContain('<script');
});

test('math renders via the locally-vendored KaTeX build (works same-origin/offline)', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(async () => {
    await window.SutraMath.ensure();
    return window.SutraMath.renderToHtml('\\frac{1}{2} + x^2', true);
  });
  expect(out).not.toBeNull();
  expect(out).toContain('katex');
});

test('the vendored KaTeX asset is served same-origin (not a CDN)', async ({ request }) => {
  const css = await request.get('/assets/vendor/katex/katex.min.css');
  expect(css.ok()).toBeTruthy();
  const js = await request.get('/assets/vendor/katex/katex.min.js');
  expect(js.ok()).toBeTruthy();
});

test('cloze deletions blank the term on the front and reveal it on the back', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const T = window.SutraReviewTesting;
    return {
      isCloze: T.hasCloze('The capital of France is {{Paris}}.'),
      front: T.renderClozeHtml('The capital of France is {{Paris}}.', false),
      back: T.renderClozeHtml('The capital of France is {{Paris}}.', true)
    };
  });
  expect(r.isCloze).toBe(true);
  expect(r.front).toContain('review-cloze-blank');
  expect(r.front).not.toContain('Paris');
  expect(r.back).toContain('Paris');
});

test('import parses Quizlet (tab), CSV (quoted), and decodes entities', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const T = window.SutraReviewTesting;
    return {
      tab: T.parseImportLine('Mitochondria\tThe powerhouse of the cell'),
      csv: T.parseImportLine('"Cell, basic","Smallest unit of life"'),
      ent: T.parseImportLine('A &amp; B\tplus &lt;c&gt;')
    };
  });
  expect(r.tab.prompt).toBe('Mitochondria');
  expect(r.tab.answer).toContain('powerhouse');
  expect(r.csv.prompt).toBe('Cell, basic');
  expect(r.csv.answer).toBe('Smallest unit of life');
  expect(r.ent.prompt).toBe('A & B');
  expect(r.ent.answer).toBe('plus <c>');
});

test('bulk import creates cards and skips Anki "#" directive lines', async ({ page }) => {
  await openApp(page);
  const count = await page.evaluate(() => {
    const deck = window.createReviewDeck({ name: 'QA Import Deck' });
    if (!deck) return -1;
    const text = '#separator:tab\n#html:true\nApple\tA fruit\nDog\tAn animal';
    return window.bulkImportReviewCards(deck.id, text);
  });
  expect(count).toBe(2);
});

test('analytics helpers return well-formed shapes', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const T = window.SutraReviewTesting;
    const ret = T.getRetentionRate();
    const fc = T.getDueForecast(7);
    return { ret, len: fc.series.length, hasOverdue: typeof fc.overdue === 'number' };
  });
  expect(typeof r.ret.rate).toBe('number');
  expect(r.ret.rate).toBeGreaterThanOrEqual(0);
  expect(r.ret.rate).toBeLessThanOrEqual(100);
  expect(r.len).toBe(7);
  expect(r.hasOverdue).toBe(true);
});

test('shared Review actions extract every mode-specific data attribute', async ({ page }) => {
  await openApp(page);
  const ctx = await page.evaluate(() => {
    const button = document.createElement('button');
    button.setAttribute('data-deck-id', 'deck-1');
    button.setAttribute('data-card-id', 'card-1');
    button.setAttribute('data-mode', 'match');
    button.setAttribute('data-grade', 'again');
    button.setAttribute('data-tile-id', 'tile-1');
    button.setAttribute('data-correct', 'true');
    button.setAttribute('data-answer-id', 'answer-1');
    button.setAttribute('data-pair-id', 'pair-1');
    button.setAttribute('data-question-id', 'question-1');
    button.setAttribute('data-choice-id', 'choice-1');
    return window.SutraReviewTesting.extractActionContext(button);
  });
  expect(ctx).toEqual({
    deckId: 'deck-1', cardId: 'card-1', mode: 'match', grade: 'again',
    tileId: 'tile-1', correct: 'true', answerId: 'answer-1', pairId: 'pair-1',
    questionId: 'question-1', choiceId: 'choice-1'
  });
});

test('Flashcards Again stays in the active session and grading works by mouse and keyboard', async ({ page }) => {
  await openApp(page);
  const deckId = await openReviewDeck(page, [['Capital of France?', 'Paris']]);
  await page.locator('[data-review-action="study"][data-mode="flashcards"]').first().click();
  await expect(page.locator('.review-study-shell[data-mode="flashcards"]')).toBeVisible();

  await page.locator('[data-review-action="flashcards-flip"]').first().click();
  await page.locator('[data-review-action="flashcards-grade"][data-grade="again"]').click();
  // A one-card queue must still show the card after Again instead of ending and
  // postponing all relearning until tomorrow.
  await expect(page.locator('[data-review-action="flashcards-flip"]').first()).toBeVisible();
  const afterMouse = await page.evaluate((id) => {
    const card = window.SutraReviewTesting.getItems(id)[0];
    return { lapses: card.lapses, status: card.status };
  }, deckId);
  expect(afterMouse).toMatchObject({ lapses: 1, status: 'lapsed' });

  await page.keyboard.press('Space');
  await page.keyboard.press('1');
  await expect(page.locator('[data-review-action="flashcards-flip"]').first()).toBeVisible();
  const afterKeyboard = await page.evaluate((id) => window.SutraReviewTesting.getItems(id)[0].lapses, deckId);
  expect(afterKeyboard).toBe(2);

  // The bounded policy permits two relearning appearances, then completes.
  await page.keyboard.press('Space');
  await page.keyboard.press('1');
  // Scope to the review shell's exact eyebrow: a bare getByText('Session complete')
  // also matches the Focus-timer "Focus session complete. Alarm…" element that is
  // always present in the shell markup (strict-mode ambiguity).
  await expect(page.locator('.review-study-shell').getByText('Session complete', { exact: true })).toBeVisible();
});
