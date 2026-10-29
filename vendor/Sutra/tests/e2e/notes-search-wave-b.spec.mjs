import { expect, test } from '@playwright/test';

// Wave B — Notes & Search:
//  #3 Math block in the notes editor (persistence-safe, renders from data-latex)
//  #7 Shareable self-contained deck export (standalone HTML flashcards)
//  #8 Related notes ("see also" by shared vocabulary)
//  #10 Fuzzy + recent command palette

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.__sutraPublicBetaTestHooks && window.__sutraPublicBetaTestHooks.getRelatedNotes && window.sutraFuzzyScore));
}

test('command palette fuzzy scorer ranks prefix > subsequence and recents persist', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const prefix = window.sutraFuzzyScore('Open Timeline', 'timeline');
    const subseq = window.sutraFuzzyScore('Open Timeline', 'otl');
    window.recordRecentCommand('open-notes');
    return { prefix, subseq, recent: window.getRecentCommandIds()[0] };
  });
  expect(r.prefix).toBeGreaterThan(0);
  expect(r.subseq).toBeGreaterThan(0);
  expect(r.prefix).toBeGreaterThan(r.subseq);
  expect(r.recent).toBe('open-notes');
});

test('related notes surface other pages that share vocabulary', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    const a = H.createNoteInActiveSpace('Photosynthesis', '<p>chlorophyll stomata glucose photosynthesis reactions</p>');
    H.createNoteInActiveSpace('Cellular respiration', '<p>chlorophyll glucose mitochondria respiration energy</p>');
    const rel = H.getRelatedNotes(a.id, 5);
    return { count: rel.length, hasResp: rel.some(x => /respiration/i.test(x.title)) };
  });
  expect(r.count).toBeGreaterThanOrEqual(1);
  expect(r.hasResp).toBe(true);
});

test('a deck exports as a self-contained shareable HTML flashcard file', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate(() => {
    const T = window.SutraReviewTesting;
    const deck = window.createReviewDeck({ name: 'Bio Unit 1' });
    window.bulkImportReviewCards(deck.id, 'Mitochondria\tPowerhouse of the cell');
    const items = T.getItems(deck.id);
    return T.buildShareableDeckHtml(deck, items);
  });
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Bio Unit 1');
  expect(html).toContain('Mitochondria');
  expect(html).toContain('function flip()');
});

test('shareable deck treats hostile prompts, answers, cloze text, and images as inert data', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate(() => window.SutraReviewTesting.buildShareableDeckHtml(
    { name: '</title><script>window.__deckXss=1<\/script>Biology' },
    [{
      prompt: '{{</span><img src=x onerror="window.__deckXss=2">}} after </script>',
      answer: '<svg onload="window.__deckXss=3">answer</svg>',
      imageUrl: 'data:image/svg+xml,<svg onload="window.__deckXss=4"></svg>'
    }]
  ));
  await page.setContent(html, { waitUntil: 'load' });
  const result = await page.evaluate(() => ({
    fired: window.__deckXss || 0,
    title: document.querySelector('h1')?.textContent || '',
    prompt: document.querySelector('.face')?.textContent || '',
    images: document.querySelectorAll('img').length
  }));
  expect(result.fired).toBe(0);
  expect(result.title).toContain('</title><script>window.__deckXss=1</script>Biology');
  expect(result.prompt).toContain('[…] after </script>');
  expect(result.images).toBe(0);
});

test('math blocks render from their LaTeX source', async ({ page }) => {
  await openApp(page);
  const rendered = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<span class="sutra-math-block" data-latex="x^2 + y^2">x^2 + y^2</span>';
    document.body.appendChild(host);
    await window.__sutraPublicBetaTestHooks.renderMathBlocksIn(host);
    // ensure() resolves before render; give the microtask a beat
    await new Promise(r => setTimeout(r, 200));
    return host.querySelector('.sutra-math-block').innerHTML.indexOf('katex') !== -1;
  });
  expect(rendered).toBe(true);
});

test('the /math slash command and insert path ship in the bundle', async ({ request }) => {
  const src = await (await request.get('/src/core/app.js')).text();
  expect(src).toContain("id: 'math'");
  expect(src).toContain('function insertMathBlock');
  expect(src).toContain('sutra-math-block');
});
