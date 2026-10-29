import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Student OS Phase 2 (#8) — Generate Review Deck workflows:
// 1. Deterministic candidate generation from mixed pasted material.
// 2. Duplicate detection against existing cards (cross-deck).
// 3. openGenerator opens the editable review table with duplicate flags,
//    a warning banner, and a working "remove duplicates" action — and the
//    generated cards save + round-trip with no new persisted fields.

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
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForAppReady(page);
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraReviewGen && !!window.createReviewDeck
    && !!window.renderReviewWorkspace && !!window.flowAtelier && !!window.flowAtelier.reviewWorkspace);
}

test('Review-card generation parses mixed material and de-dupes within a batch', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const raw = [
      'Photosynthesis: process plants use to convert light into energy',
      'Mitochondria - the powerhouse of the cell',
      'Osmosis = diffusion of water across a membrane',
      'Cell wall, rigid outer layer in plant cells',
      '1. Nucleus: control center of the cell',
      '- Ribosome: site of protein synthesis',
      'Photosynthesis: duplicate prompt that should be dropped',
      '',
      'Standalone term with no answer'
    ].join('\n');
    const cards = window.SutraReviewGen.generate(raw);
    return {
      count: cards.length,
      byPrompt: cards.reduce((m, c) => { m[c.prompt] = c.answer; return m; }, {}),
      prompts: cards.map((c) => c.prompt)
    };
  });

  // 8 non-empty lines, but the second "Photosynthesis" is a de-dupe drop → 7.
  expect(result.count).toBe(7);
  expect(result.byPrompt['Photosynthesis']).toBe('process plants use to convert light into energy');
  expect(result.byPrompt['Mitochondria']).toBe('the powerhouse of the cell');
  expect(result.byPrompt['Osmosis']).toBe('diffusion of water across a membrane');
  expect(result.byPrompt['Cell wall']).toBe('rigid outer layer in plant cells');
  expect(result.byPrompt['Nucleus']).toBe('control center of the cell');
  expect(result.byPrompt['Ribosome']).toBe('site of protein synthesis');
  expect(result.byPrompt['Standalone term with no answer']).toBe('');
  // Only one Photosynthesis survived the intra-batch de-dupe.
  expect(result.prompts.filter((p) => p === 'Photosynthesis').length).toBe(1);
});

test('Review extraction and deck creation preserve long authored content', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const question = 'Question ' + 'Q'.repeat(260);
    const answer = 'Answer ' + 'A'.repeat(460);
    const pairs = window.SutraReviewGenerator.extractPairs(`<h2>${question}</h2><p>${answer}</p>`);
    const deck = window.createReviewDeck({ name: 'Deck ' + 'D'.repeat(180) });
    return {
      question: pairs[0] && pairs[0].q,
      answer: pairs[0] && pairs[0].a,
      deckName: deck && deck.name
    };
  });
  expect(result.question).toBe('Question ' + 'Q'.repeat(260));
  expect(result.answer).toBe('Answer ' + 'A'.repeat(460));
  expect(result.deckName).toBe('Deck ' + 'D'.repeat(180));
});

test('Duplicate detection flags candidates that already exist in a deck', async ({ page }) => {
  await openApp(page);

  const marked = await page.evaluate(() => {
    const deck = window.createReviewDeck({ name: 'Bio Vocabulary', subject: 'Biology' });
    window.bulkImportReviewCards(deck.id, 'Photosynthesis - existing card');
    const candidates = window.SutraReviewGen.generate(
      'photosynthesis: should be flagged as duplicate\nGlycolysis: brand new card'
    );
    return window.SutraReviewGen.markDuplicates(candidates);
  });

  expect(marked.duplicates).toBe(1);
  const photo = marked.rows.find((r) => /photosynthesis/i.test(r.prompt));
  const glyco = marked.rows.find((r) => /Glycolysis/.test(r.prompt));
  expect(photo.duplicate).toBe(true);
  expect(glyco.duplicate).toBe(false);
});

test('openGenerator shows an editable review table, duplicate flags, and round-trips on save', async ({ page }) => {
  await openApp(page);

  // Seed an existing card so one generated candidate is a duplicate.
  await page.evaluate(() => {
    const deck = window.createReviewDeck({ name: 'Existing Set', subject: 'Biology' });
    window.bulkImportReviewCards(deck.id, 'Photosynthesis - already here');
  });

  const summary = await page.evaluate(() => {
    return window.SutraReviewGen.openGenerator({
      title: 'Generated Bio Set',
      subject: 'Biology',
      rawText: 'Photosynthesis: light to energy\nMitochondria: powerhouse\nOsmosis: water diffusion'
    });
  });
  expect(summary.total).toBe(3);
  expect(summary.duplicates).toBe(1);

  // Editable review table is rendered with the generated rows + banner.
  await expect(page.locator('#reviewMount .review-generated-banner')).toBeVisible();
  await expect(page.locator('#reviewMount')).toContainText('possible duplicate');
  expect(await page.locator('#reviewMount [data-create-row]').count()).toBe(3);
  expect(await page.locator('#reviewMount .review-dup-badge').count()).toBe(1);

  // "Remove duplicates" drops only the flagged row.
  await page.locator('#reviewMount [data-review-action="create-remove-duplicates"]').click();
  expect(await page.locator('#reviewMount [data-create-row]').count()).toBe(2);
  expect(await page.locator('#reviewMount .review-dup-badge').count()).toBe(0);

  // Save the set, then confirm the cards persist and round-trip cleanly.
  const saved = await page.evaluate(() => {
    document.querySelector('#reviewCreateTitle').value = 'Generated Bio Set';
    document.querySelector('#reviewCreateTitle').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#reviewCreateSetForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const ws = window.flowAtelier.reviewWorkspace || { decks: [], items: [] };
    const gen = (ws.decks || []).find((d) => d.name === 'Generated Bio Set');
    const items = (ws.items || []).filter((i) => i.deckId === (gen && gen.id));
    const rt = window.verifyWorkspaceRoundTrip();
    return {
      deckExists: !!gen,
      cardCount: items.length,
      prompts: items.map((i) => i.prompt).sort(),
      roundTripOk: rt.ok,
      roundTripSummary: rt.summary
    };
  });

  expect(saved.deckExists).toBe(true);
  expect(saved.cardCount).toBe(2);
  expect(saved.prompts).toEqual(['Mitochondria', 'Osmosis']);
  expect(saved.roundTripOk, saved.roundTripSummary).toBeTruthy();
});

test('Library "Generate cards" button opens the paste panel and fills the table', async ({ page }) => {
  await openApp(page);

  // Land on the review library and use the visible entry point.
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach((view) => { view.classList.remove('active'); view.style.display = 'none'; });
    const section = document.getElementById('view-review');
    if (section) { section.classList.add('active'); section.style.display = ''; }
    document.body.dataset.view = 'review';
    if (typeof window.renderReviewWorkspace === 'function') window.renderReviewWorkspace();
  });
  await page.locator('#reviewMount [data-review-action="open-generate"]').click();

  const panel = page.locator('#reviewMount .review-generate-panel');
  await expect(panel).toBeVisible();

  await page.locator('#reviewGenerateInput').fill('Inertia: tendency to resist a change in motion\nVelocity - speed with direction');
  await page.locator('#reviewMount [data-review-action="create-generate-from-text"]').click();

  // Both pasted lines become editable rows with prompts captured.
  await expect(page.locator('#reviewMount [data-create-row]')).toHaveCount(2);
  await expect(page.locator('#reviewMount')).toContainText('Inertia');
  await expect(page.locator('#reviewMount')).toContainText('Velocity');
});
