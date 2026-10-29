import { expect, test } from '@playwright/test';

// Student OS Phase 3 — new connected-workspace surfaces:
//  • Assignment Studio 2.0: deterministic plan generation + extended milestone
//    model that round-trips through hwTasks:v2 (and therefore .sutra).
//  • Planning engine: pure plan/repair globals are wired and the preview modal
//    opens from the Today entry point without auto-applying anything.
//  • Import wizard: the multi-format parser is exposed in the browser.
//  • Grade risk: the deterministic risk enum is exposed and computed locally.

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
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraAssignmentStudio && !!window.SutraPlanningEngine
    && !!window.SutraGradePlanner && !!window.sutraIntelligence && !!window.flowAtelier);
}

test('Assignment Studio 2.0 generates a work-backward plan that round-trips', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    // Seed one homework assignment due in two weeks.
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    const task = {
      id: 'studio_e2e_1', courseId: '', title: 'Persuasive essay on climate policy',
      text: 'Persuasive essay on climate policy', done: false, dueDate: iso, dueTime: '23:59',
      priority: 'high', difficulty: 'hard', notes: ''
    };
    // Seed into the canonical homework store (Assignment Studio's source of truth).
    window.SutraHomeworkStore.replace({ courses: [], tasks: [task] }, { reason: 'test-seed' });

    // Generate a deterministic plan (essay → research…submit), work-backward scheduled.
    const plan = window.SutraAssignmentStudio.applyPlanToTask('studio_e2e_1', { kind: 'essay' });

    // Read it back from the store to confirm persistence + extended fields.
    const stored = window.SutraHomeworkStore.getSnapshot().tasks || [];
    const studio = window.SutraAssignmentStudio.normalizeStudio(stored[0].studio);
    return {
      planCount: plan && plan.count,
      kind: plan && plan.kind,
      milestoneTitles: studio.milestones.map((m) => m.title),
      lastDue: studio.milestones[studio.milestones.length - 1].dueDate,
      targetDue: iso,
      hasTypes: studio.milestones.every((m) => typeof m.type === 'string' && m.type.length > 0),
      hasStatus: studio.milestones.every((m) => ['not_started', 'in_progress', 'done'].includes(m.status)),
      hasLinkArrays: studio.milestones.every((m) => Array.isArray(m.linkedBlockIds))
    };
  });

  expect(result.kind).toBe('essay');
  expect(result.planCount).toBeGreaterThanOrEqual(5);
  expect(result.milestoneTitles.join(' ')).toMatch(/research/i);
  expect(result.lastDue).toBe(result.targetDue); // final milestone lands on the deadline
  expect(result.hasTypes).toBe(true);
  expect(result.hasStatus).toBe(true);
  expect(result.hasLinkArrays).toBe(true);
});

test('Planning engine is wired and previews without auto-applying', async ({ page }) => {
  await openApp(page);

  const wired = await page.evaluate(() => ({
    hasPlanWork: typeof window.SutraPlanningEngine.planWork === 'function',
    hasAnalyze: typeof window.SutraPlanningEngine.analyzePlan === 'function',
    // pure planning: two items into a single free window, no overlap
    plan: window.SutraPlanningEngine.planWork({
      today: '2026-06-16', dates: ['2026-06-16'],
      items: [
        { id: 'a', title: 'Math set', dueDate: '2026-06-16', priority: 'high', estimateMinutes: 45 },
        { id: 'b', title: 'Reading', dueDate: '2026-06-16', priority: 'low', estimateMinutes: 30 }
      ],
      freeWindowsByDate: { '2026-06-16': [{ start: 900, end: 1080 }] },
      prefs: { maxBlockMinutes: 60, breakMinutes: 10 }
    })
  }));

  expect(wired.hasPlanWork).toBe(true);
  expect(wired.hasAnalyze).toBe(true);
  expect(wired.plan.blocks.length).toBeGreaterThanOrEqual(2);
  // blocks must not overlap
  const blocks = wired.plan.blocks.slice().sort((x, y) => x.startMin - y.startMin);
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i].startMin).toBeGreaterThanOrEqual(blocks[i - 1].endMin);
  }

  // The Today "Suggest plan" button opens a preview modal; nothing is written yet.
  const blocksBefore = await page.evaluate(() => (window.flowAtelier.timeBlocks || []).length);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-plan-preview="day"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  const modalVisible = await page.evaluate(() => {
    const m = document.getElementById('sutraPlanPreviewModal');
    return !!m && !m.hidden;
  });
  const blocksAfter = await page.evaluate(() => (window.flowAtelier.timeBlocks || []).length);
  expect(modalVisible).toBe(true);
  expect(blocksAfter).toBe(blocksBefore); // preview only — no auto-apply
});

test('Import parser and grade-risk engine are exposed in the browser', async ({ page }) => {
  await openApp(page);

  const out = await page.evaluate(() => {
    const rows = window.sutraIntelligence.parseAssignmentText(
      '| Title | Course | Due |\n|---|---|---|\n| Lab report | Chemistry | 2026-06-22 |'
    );
    const normalized = window.sutraIntelligence.normalizeImportBatch(rows);
    const risk = window.SutraGradePlanner.computeGradeRisk(
      window.SutraGradePlanner.engine.normalizeCourseGrades({
        targetPercent: 90, categories: [],
        entries: [{ id: 'e', categoryId: '', title: 'Test', score: 72, maxScore: 100, status: 'graded' }]
      })
    );
    return {
      rowTitle: rows[0] && rows[0].title,
      rowCourse: rows[0] && rows[0].course,
      normType: normalized[0] && normalized[0].type,
      hasDestinations: !!(normalized[0] && Array.isArray(normalized[0].destinations)),
      riskStatus: risk.status
    };
  });

  expect(out.rowTitle).toBe('Lab report');
  expect(out.rowCourse).toBe('Chemistry');
  expect(out.normType).toBe('lab');
  expect(out.hasDestinations).toBe(true);
  expect(out.riskStatus).toBe('danger'); // 72% vs 90% target
});
