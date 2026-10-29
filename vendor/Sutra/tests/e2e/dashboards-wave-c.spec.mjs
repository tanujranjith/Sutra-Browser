import { expect, test } from '@playwright/test';

// Wave C — Dashboards:
//  #5 Focus stats dashboard (visual time-by-subject + 14-day chart)
//  #9 Grade trends (per-course cumulative grade over time)

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.openFocusStatsModal && window.openGradeTrendsModal && window.__sutraPublicBetaTestHooks));
}

test('focus stats dashboard opens and shows recorded time by subject', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    H.recordFocusSession({ minutes: 25, subject: 'Calculus' });
    H.recordFocusSession({ minutes: 50, subject: 'Calculus' });
    H.recordFocusSession({ minutes: 20, subject: 'History' });
    window.openFocusStatsModal();
    const m = document.getElementById('sutraFocusStatsModal');
    const active = !!(m && m.classList.contains('active'));
    const text = m ? m.textContent : '';
    const hasSvg = !!(m && m.querySelector('svg'));
    return { active, hasCalc: /Calculus/.test(text), hasWeek: /This week/i.test(text), hasSvg };
  });
  expect(r.active).toBe(true);
  expect(r.hasCalc).toBe(true);
  expect(r.hasWeek).toBe(true);
  expect(r.hasSvg).toBe(true);
});

test('grade-trend computation is exposed and null-safe; modal opens', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const gp = window.SutraGradePlanner;
    const t = (gp && typeof gp.computeGradeTrend === 'function') ? gp.computeGradeTrend('no-such-course') : null;
    window.openGradeTrendsModal();
    const m = document.getElementById('sutraGradeTrendsModal');
    return { isFn: typeof (gp && gp.computeGradeTrend), trendIsArray: Array.isArray(t), modalActive: !!(m && m.classList.contains('active')) };
  });
  expect(r.isFn).toBe('function');
  expect(r.trendIsArray).toBe(true);
  expect(r.modalActive).toBe(true);
});

test('a course with dated scores produces a multi-point grade trend', async ({ page }) => {
  await openApp(page);
  const len = await page.evaluate(() => {
    const gp = window.SutraGradePlanner;
    if (!gp) return -1;
    const cid = 'qa-trend-course';
    gp.setCategoriesForCourse(cid, [{ name: 'All', weight: 100 }]);
    const planner = gp.getPlanner();
    const catId = (planner.courses[cid].categories[0] || {}).id;
    gp.addEntryForCourse(cid, { title: 'Q1', score: 90, maxScore: 100, date: '2026-01-10', categoryId: catId });
    gp.addEntryForCourse(cid, { title: 'Q2', score: 70, maxScore: 100, date: '2026-02-10', categoryId: catId });
    gp.addEntryForCourse(cid, { title: 'Q3', score: 80, maxScore: 100, date: '2026-03-10', categoryId: catId });
    return gp.computeGradeTrend(cid).length;
  });
  expect(len).toBeGreaterThanOrEqual(2);
});
