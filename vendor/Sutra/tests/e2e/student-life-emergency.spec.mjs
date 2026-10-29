import { expect, test } from '@playwright/test';

// Emergency Week ("I'm overwhelmed") must produce a REVIEWED, sleep-protected plan.
// Regression guard for the scheduler: even with many same-day tasks, minimum-viable
// blocks must stay inside the 16:00–22:00 evening window — never crossing midnight
// or eating into protected sleep (earlier code accumulated an offset that produced
// invalid times like "25:00").

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
}

test('Emergency Week schedules only within the sleep-protected 16:00–22:00 window', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);

  const result = await page.evaluate(() => {
    const now = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = iso(now);
    // 16 high-impact tasks all due today — far more than one evening can hold, so the
    // scheduler must roll extras to later days (or defer), never overflow past 22:00.
    for (let i = 0; i < 16; i++) {
      window.flowAtelier.tasks.push({
        id: `ew-task-${i}`, title: `Cram item ${i}`, dueDate: today, dueAt: `${today}T23:00:00`,
        priority: 'high', gradeImpact: 80, estimatedMinutes: 60, completed: false, isActive: true
      });
    }
    const before = window.flowAtelier.timeBlocks.length;
    const receipt = window.SutraStudentLifeApp.applyEmergencyWeek({
      reviewed: true, now: now.toISOString(), dailyCapacityMinutes: 180, protectedSleepHours: 8
    });
    const created = window.flowAtelier.timeBlocks.slice(before);
    const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const violations = created.filter((b) => toMinutes(b.start) < 16 * 60 || toMinutes(b.end) > 22 * 60 || toMinutes(b.end) > 24 * 60);
    // No two blocks on the same day may overlap.
    const byDay = {};
    let overlaps = 0;
    created.forEach((b) => { (byDay[b.date] = byDay[b.date] || []).push(b); });
    Object.values(byDay).forEach((rows) => {
      rows.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
      for (let i = 1; i < rows.length; i++) if (toMinutes(rows[i].start) < toMinutes(rows[i - 1].end)) overlaps++;
    });
    return {
      reviewRequired: receipt.plan.reviewRequired,
      createdCount: created.length,
      violations: violations.map((b) => `${b.date} ${b.start}-${b.end}`),
      overlaps,
      protectedSleepHours: receipt.plan.protectedSleepHours,
      hasUndo: Array.isArray(receipt.undo.removeTimeBlockIds),
      warnings: receipt.warnings
    };
  });

  expect(result.reviewRequired).toBe(true);
  expect(result.protectedSleepHours).toBeGreaterThanOrEqual(7);
  expect(result.createdCount).toBeGreaterThan(0);
  expect(result.violations, 'no block may fall outside 16:00–22:00 or cross midnight').toEqual([]);
  expect(result.overlaps).toBe(0);
  expect(result.hasUndo).toBe(true);
});

test('applyEmergencyWeek requires an explicit reviewed flag', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  const threw = await page.evaluate(() => {
    try { window.SutraStudentLifeApp.applyEmergencyWeek({ now: new Date().toISOString() }); return false; }
    catch (e) { return /review/i.test(String(e.message)); }
  });
  expect(threw).toBe(true);
});
