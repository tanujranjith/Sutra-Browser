import { expect, test } from '@playwright/test';

// Part 3 — Planning & Assistant:
//  - Reverse/spread study scheduling (planning engine, exposed in the browser)
//  - Keyless assistant wiring (the deterministic planner is reachable with no key)
// The engine's math is also unit-checked in Node by scripts/sutra-academic-engines-check.mjs.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.SutraPlanningEngine && window.SutraPlanningEngine.planWork));
}

test('planning engine spreads multi-chunk work across distinct days (anti-clustering)', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const dates = ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24'];
    const free = {};
    dates.forEach(d => { free[d] = [{ start: 540, end: 1020 }]; });
    const plan = window.SutraPlanningEngine.planWork({
      today: '2026-06-20', dates,
      items: [{ id: 'p1', kind: 'task', title: 'Essay', dueDate: '2026-06-25', estimateMinutes: 270, priority: 'high', difficulty: 'hard' }],
      freeWindowsByDate: free
    });
    return { blocks: plan.blocks.length, days: new Set(plan.blocks.map(b => b.date)).size };
  });
  expect(r.blocks).toBeGreaterThanOrEqual(3);
  expect(r.days).toBeGreaterThanOrEqual(3);
});

test('exam prep reverse-schedules study sessions before the exam date', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const items = window.SutraPlanningEngine.engine.expandExamPrep(
      [{ id: 'apbio', name: 'AP Bio', examDate: '2026-06-27', confidence: 2 }], { today: '2026-06-20' });
    const dates = ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27'];
    const free = {};
    dates.forEach(d => { free[d] = [{ start: 540, end: 1020 }]; });
    const plan = window.SutraPlanningEngine.planWork({ today: '2026-06-20', dates, items, freeWindowsByDate: free });
    return {
      itemCount: items.length,
      pref: items[0] && items[0].preferredChunkMinutes,
      allBefore: plan.blocks.length > 0 && plan.blocks.every(b => b.date <= '2026-06-27')
    };
  });
  expect(r.itemCount).toBe(1);
  expect(r.pref).toBe(45);
  expect(r.allBefore).toBe(true);
});

test('keyless planner entry points are exposed (no API key required)', async ({ page }) => {
  await openApp(page);
  const api = await page.evaluate(() => ({
    planDay: typeof window.SutraPlanningEngine.planDay,
    planWeek: typeof window.SutraPlanningEngine.planWeek,
    repairPlan: typeof window.SutraPlanningEngine.repairPlan
  }));
  expect(api.planDay).toBe('function');
  expect(api.planWeek).toBe('function');
  expect(api.repairPlan).toBe('function');
});
