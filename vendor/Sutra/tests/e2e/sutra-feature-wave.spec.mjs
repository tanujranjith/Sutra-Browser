import { expect, test } from '@playwright/test';

// Feature-wave coverage: the deterministic All Due ranking engine (#2), the
// Review Generator extractor + entry points (#5), and Starter Packs
// preview/apply/undo (#10). These exercise pure/deterministic surfaces through
// the public window globals, so they don't depend on fragile UI timing.

// The first test in a run pays the webServer + browser cold-start; give every
// test headroom so that one-time boot cost never trips the per-test timeout.
test.beforeEach(() => { test.setTimeout(120_000); });

async function boot(page) {
  await page.goto('/Sutra.html');
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted && window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => window.SutraStarterPacks && window.SutraReviewGenerator && window.courseHub, null, { timeout: 20_000 });
}

test.describe('Review Generator — deterministic extractor (#5)', () => {
  test('extracts heading, term:definition, and bold cloze pairs', async ({ page }) => {
    await boot(page);
    const pairs = await page.evaluate(() => {
      const html = ''
        + '<h2>Photosynthesis</h2><p>The process plants use to convert light into chemical energy.</p>'
        + '<ul><li>Mitochondria: the powerhouse of the cell</li><li>Osmosis - movement of water across a membrane</li></ul>'
        + '<p>The capital of France is <strong>Paris</strong>, a major city.</p>';
      return window.SutraReviewGenerator.extractPairs(html);
    });
    const prompts = pairs.map(p => p.q);
    // Heading -> body
    expect(prompts).toContain('Photosynthesis');
    // "term: definition" and "term - definition"
    expect(prompts).toContain('Mitochondria');
    expect(prompts).toContain('Osmosis');
    // Bold cloze: prompt blanks the term, answer is the term
    const cloze = pairs.find(p => /_____/.test(p.q));
    expect(cloze).toBeTruthy();
    expect(cloze.a).toBe('Paris');
    // Every pair has both sides
    expect(pairs.every(p => p.q && p.a)).toBe(true);
  });

  test('exposes note/homework/inbox entry points', async ({ page }) => {
    await boot(page);
    const api = await page.evaluate(() => ({
      fromNoteId: typeof window.SutraReviewGenerator.fromNoteId,
      fromHomeworkTask: typeof window.SutraReviewGenerator.fromHomeworkTask,
      fromInboxItem: typeof window.SutraReviewGenerator.fromInboxItem
    }));
    expect(api.fromNoteId).toBe('function');
    expect(api.fromHomeworkTask).toBe('function');
    expect(api.fromInboxItem).toBe('function');
  });
});

test.describe('Starter Packs — preview / apply / undo (#10)', () => {
  test('ships the nine local packs with artifact counts', async ({ page }) => {
    await boot(page);
    const info = await page.evaluate(() => {
      const packs = window.SutraStarterPacks.list();
      return {
        ids: packs.map(p => p.id),
        counts: window.SutraStarterPacks.counts(packs.find(p => p.id === 'ap-student'))
      };
    });
    expect(info.ids).toEqual(expect.arrayContaining([
      'ap-student', 'college-apps', 'sat-act-prep', 'tsa-project', 'robotics-team',
      'senior-year', 'research-project', 'business-freelancer', 'personal-life-os'
    ]));
    expect(info.counts.courses).toBeGreaterThan(0);
    expect(info.counts.decks).toBeGreaterThan(0);
  });

  test('apply creates artifacts and undo removes the whole batch', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => {
      const batch = window.SutraStarterPacks.apply('personal-life-os', {});
      const created = batch ? batch.created.length : 0;
      const removed = window.SutraStarterPacks.undo(batch);
      return { created, removed };
    });
    // personal-life-os: 1 note + 2 tasks + 2 timeline blocks
    expect(result.created).toBe(5);
    expect(result.removed).toBe(5);
  });

  test('apply selected only creates chosen groups', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => {
      // Only the note group from personal-life-os
      const batch = window.SutraStarterPacks.apply('personal-life-os', { notes: true, tasks: false, timeBlocks: false });
      const kinds = batch ? batch.created.map(c => c.kind) : [];
      window.SutraStarterPacks.undo(batch);
      return kinds;
    });
    expect(result).toEqual(['note']);
  });

  test('a malicious custom pack id is rejected on import and never reaches an onclick sink', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(async () => {
      // A pack id flows into inline onclick="starterPacksPreview('<id>')".
      // escapeHtml is NOT enough there — the browser HTML-decodes the entity
      // before the JS parser runs, so a raw quote in the id would break out.
      const payload = JSON.stringify({
        id: "x');alert(document.domain);//",
        name: 'Evil Pack',
        artifacts: { tasks: [{ title: 'noop' }] }
      });
      window.atelierPrompt = async () => payload;            // feed the importer
      await window.starterPacksImport();
      window.openStarterPacks();                             // force a render
      const body = document.getElementById('starterPacksBody');
      const html = body ? body.innerHTML : '';
      window.closeStarterPacks && window.closeStarterPacks();
      return {
        inCatalog: window.SutraStarterPacks.list().some(p => /alert\(/.test(String(p.id))),
        resolvable: !!window.SutraStarterPacks.getById("x');alert(document.domain);//"),
        breakout: /alert\(document\.domain\)/.test(html)
      };
    });
    expect(res.inCatalog).toBe(false);   // rejected at import
    expect(res.resolvable).toBe(false);  // not addressable
    expect(res.breakout).toBe(false);    // no broken-out JS in the rendered markup
  });

  test('a custom pack id that reuses a built-in id is rejected (no silent shadowing)', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(async () => {
      window.atelierPrompt = async () => JSON.stringify({ id: 'ap-student', name: 'Hijack', artifacts: { tasks: [] } });
      await window.starterPacksImport();
      const pack = window.SutraStarterPacks.getById('ap-student');
      const count = window.SutraStarterPacks.list().filter(p => String(p.id) === 'ap-student').length;
      return { name: pack ? pack.name : null, count };
    });
    expect(res.name).toBe('AP Student');  // built-in still resolves, not 'Hijack'
    expect(res.count).toBe(1);             // the colliding custom pack was dropped
  });

  test('a hand-injected custom pack with an unsafe id is filtered from the catalog (defense in depth)', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(() => {
      const KEY = 'sutra:starterPacks:custom:v1';   // STARTER_PACK_CUSTOM_KEY
      // SafeStorage.set JSON-encodes for us (the array, not a pre-stringified blob).
      window.SutraSafeStorage.set(KEY, [
        { id: "y'-alert(1)-'", name: 'Bad', artifacts: { tasks: [] } },
        { id: 'safe-custom', name: 'Good', artifacts: { tasks: [{ title: 'ok' }] } }
      ]);
      const ids = window.SutraStarterPacks.list().map(p => String(p.id));
      return { hasUnsafe: ids.some(id => /alert/.test(id)), hasSafe: ids.includes('safe-custom') };
    });
    expect(res.hasUnsafe).toBe(false);   // unsafe id stripped on read
    expect(res.hasSafe).toBe(true);      // valid custom pack still shows
  });

  test('a valid custom pack imports, persists through SafeStorage, and appears in the catalog', async ({ page }) => {
    // Regression: custom-pack persistence called SutraSafeStorage.getItem/setItem,
    // which do not exist (the API is get/set), so every import silently no-op'd and
    // imported packs vanished. The existing tests only used built-in packs.
    await boot(page);
    const res = await page.evaluate(async () => {
      window.atelierPrompt = async () => JSON.stringify({
        id: 'my-custom-pack', name: 'My Custom Pack', icon: '🎒',
        artifacts: { tasks: [{ title: 'Custom task', priority: 'high' }] }
      });
      await window.starterPacksImport();
      const pack = window.SutraStarterPacks.getById('my-custom-pack');
      const stored = window.SutraSafeStorage.get('sutra:starterPacks:custom:v1', { fallback: [] });
      return {
        inCatalog: !!pack && pack.name === 'My Custom Pack',
        custom: !!pack && pack.custom === true,
        persisted: Array.isArray(stored) && stored.some(p => p.id === 'my-custom-pack')
      };
    });
    expect(res.inCatalog).toBe(true);   // resolvable after import
    expect(res.custom).toBe(true);      // flagged as a custom pack
    expect(res.persisted).toBe(true);   // actually written to SafeStorage
  });
});

test.describe('All Due — deterministic ranking + annotations (#2)', () => {
  test('inbox items carry rankReason/rankScore/effort and smart sort is by score', async ({ page }) => {
    await boot(page);
    const data = await page.evaluate(() => {
      const batch = window.SutraStarterPacks.apply('ap-student', { tasks: true, courses: false, notes: false, decks: false, timeBlocks: false });
      const smart = window.courseHub.getStudentInboxItems({ filter: 'all', courseId: 'all', search: '', sort: 'smart' });
      const annotated = smart.length ? {
        hasReason: typeof smart[0].rankReason === 'string' && smart[0].rankReason.length > 0,
        hasScore: typeof smart[0].rankScore === 'number',
        hasEffort: typeof smart[0].effortMinutes === 'number'
      } : null;
      const sortedDesc = smart.every((it, i) => i === 0 || (smart[i - 1].rankScore >= it.rankScore));
      window.SutraStarterPacks.undo(batch);
      return { count: smart.length, annotated, sortedDesc };
    });
    expect(data.count).toBeGreaterThan(0);
    expect(data.annotated.hasReason).toBe(true);
    expect(data.annotated.hasScore).toBe(true);
    expect(data.annotated.hasEffort).toBe(true);
    expect(data.sortedDesc).toBe(true);
  });

  test('the shared ranking engine is deterministic for a synthetic item', async ({ page }) => {
    await boot(page);
    const ranks = await page.evaluate(() => {
      // Two calls must produce identical scores (no Math.random / time drift in the score).
      const a = window.courseHub.getStudentInboxItems({ filter: 'all', courseId: 'all', search: '', sort: 'smart' });
      const b = window.courseHub.getStudentInboxItems({ filter: 'all', courseId: 'all', search: '', sort: 'smart' });
      return { a: a.map(i => i.rankScore), b: b.map(i => i.rankScore) };
    });
    expect(ranks.a).toEqual(ranks.b);
  });
});
