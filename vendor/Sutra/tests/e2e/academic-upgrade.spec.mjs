import { expect, test } from '@playwright/test';

// Academic-planning upgrade regression coverage:
//   1. New workspaces (schoolSchedule / gradePlanner / semesterSetup) are
//      registered, normalized, exported, and survive a JSON round-trip.
//   2. School-schedule rotation drives the Today strip + study windows.
//   3. Grade Planner renders in the Course Hub Grades tab and computes
//      deterministic forecasts.
//   4. Semester Setup wizard extracts locally and applies only approved items.
//   5. Assignment Studio milestones persist on homework tasks and surface as
//      deadlines (reminder sources).
//   6. New state survives a reload (autosave persistence).

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
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => !!window.SutraAcademicState && !!window.SutraSchoolSchedule
    && !!window.SutraGradePlanner && !!window.SutraSemesterSetup && !!window.SutraAssignmentStudio
    && !!window.flowAtelier && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('academic-upgrade-ready'));
  await completeOnboarding(page);
}

const SAMPLE_SCHEDULE = {
  enabled: true,
  term: { name: 'Spring', startDate: '2026-01-01', endDate: '2026-06-15' },
  rotation: { type: 'ab', cycleLength: 2, labels: ['A', 'B'], anchorDate: '2026-01-05', anchorIndex: 0, skipWeekends: true, skipNoSchoolDays: true },
  schedules: [{ id: 'reg', name: 'Regular', periods: [
    { id: 'p1', label: 'Period 1', start: '08:00', end: '08:50' },
    { id: 'p2', label: 'Period 2', start: '09:00', end: '09:50' }
  ] }],
  defaultScheduleId: 'reg',
  dayTemplates: { A: { scheduleId: 'reg', assignments: {} }, B: { scheduleId: 'reg', assignments: {} } },
  overrides: [{ id: 'ovr1', date: '2026-01-06', kind: 'holiday', label: 'Snow day' }],
  subscriptions: [],
  settings: { showTodayStrip: true, classReminders: true, classReminderLeadMinutes: 5 }
};

test('academic workspaces are registered and survive an export round-trip', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate((schedule) => {
    window.SutraAcademicState.setSchoolSchedule(schedule);
    const planner = window.SutraGradePlanner.getPlanner();
    planner.courses['qa-course-1'] = {
      categories: [{ id: 'cat-tests', name: 'Tests', weight: 60, drops: 0 }],
      entries: [{ id: 'ge1', categoryId: 'cat-tests', title: 'Unit test', score: 45, maxScore: 50, status: 'graded' }],
      targetPercent: 93,
      gpa: { credits: 1, level: 'ap', includeInGpa: true }
    };
    window.SutraGradePlanner.setPlanner(planner);

    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const cloned = JSON.parse(JSON.stringify(payload));
    return {
      roundTrip: window.verifyWorkspaceRoundTrip(),
      hasSchedule: !!cloned.schoolSchedule && cloned.schoolSchedule.enabled === true,
      overrideKept: cloned.schoolSchedule.overrides.some((o) => o.date === '2026-01-06'),
      hasPlanner: !!cloned.gradePlanner && !!cloned.gradePlanner.courses['qa-course-1'],
      plannerTarget: cloned.gradePlanner.courses['qa-course-1'].targetPercent,
      hasSemesterSetup: !!cloned.semesterSetup && Array.isArray(cloned.semesterSetup.drafts)
    };
  }, SAMPLE_SCHEDULE);

  expect(result.roundTrip.ok, result.roundTrip.summary).toBeTruthy();
  expect(result.hasSchedule).toBeTruthy();
  expect(result.overrideKept).toBeTruthy();
  expect(result.hasPlanner).toBeTruthy();
  expect(result.plannerTarget).toBe(93);
  expect(result.hasSemesterSetup).toBeTruthy();
});

test('rotation engine resolves A/B days, holidays, and study windows', async ({ page }) => {
  await openApp(page);
  const info = await page.evaluate((schedule) => {
    window.SutraAcademicState.setSchoolSchedule(schedule);
    return {
      anchor: window.SutraSchoolSchedule.resolveDayInfo('2026-01-05'),
      holiday: window.SutraSchoolSchedule.resolveDayInfo('2026-01-06'),
      afterHoliday: window.SutraSchoolSchedule.resolveDayInfo('2026-01-07'),
      busy: window.SutraSchoolSchedule.getBusyWindowsForDate('2026-01-05'),
      windows: window.SutraSchoolSchedule.getStudyWindowsForDate('2026-01-05', { dayStart: 420, dayEnd: 660 })
    };
  }, SAMPLE_SCHEDULE);

  expect(info.anchor.labelKey).toBe('A');
  expect(info.holiday.isSchoolDay).toBe(false);
  expect(info.holiday.reason).toBe('holiday');
  // Holiday consumed no rotation day: Jan 7 is still B.
  expect(info.afterHoliday.labelKey).toBe('B');
  expect(info.busy.length).toBe(2);
  // The 10-minute passing period is below the 20-minute usable threshold, so
  // the study windows are before first period and after last period only.
  expect(info.windows.map((w) => [w.start, w.end])).toEqual([[420, 480], [590, 660]]);
});

test('Grade Planner renders in Course Hub and forecasts deterministically', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => {
    const course = window.courseHub.createCourse({ name: 'QA Chemistry', type: 'class' });
    const planner = window.SutraGradePlanner.getPlanner();
    planner.courses[course.id] = {
      categories: [
        { id: 'tests', name: 'Tests', weight: 60, drops: 0 },
        { id: 'hw', name: 'Homework', weight: 40, drops: 0 }
      ],
      entries: [
        { id: 'e1', categoryId: 'tests', title: 'Test 1', score: 45, maxScore: 50, status: 'graded' },
        { id: 'e2', categoryId: 'hw', title: 'HW 1', score: 10, maxScore: 10, status: 'graded' },
        { id: 'e3', categoryId: 'tests', title: 'Missing lab', score: 0, maxScore: 50, status: 'missing' }
      ],
      targetPercent: 90,
      gpa: { credits: 1, level: 'honors', includeInGpa: true }
    };
    window.SutraGradePlanner.setPlanner(planner);
    window.cwSelectCourse(course.id);
    window.cwSetCourseTab('grades');
    // Course Hub view-tab visibility is gated behind a beta preference with a
    // draft/apply settings flow; this test targets the Grade Planner itself,
    // so reveal the already-rendered section directly.
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const section = document.getElementById('view-courses');
    if (section) section.classList.add('active');
    document.body.dataset.view = 'courses';
  });

  await expect(page.locator('.gp-panel')).toBeVisible();
  // 60%×45/100 + 40%×100 = 67
  await expect(page.locator('.gp-grade-big')).toHaveText(/67\.0%/);
  await expect(page.locator('.gp-missing-chip').first()).toContainText('1 missing');
  await expect(page.locator('.gp-impact-row').first()).toContainText('Missing lab');
  await expect(page.locator('.gp-deterministic-note')).toContainText('no AI');

  // Scenario: what do I need on a 100-point final to hit 90%?
  await page.locator('[data-gp-action="run-needed"]').click();
  await expect(page.locator('#gpScenarioResult')).toContainText(/need|above the maximum|locked in/);
});

test('Semester Setup extracts locally and applies only approved items', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.SutraSemesterSetup.open());
  await expect(page.locator('#semesterSetupModal .sutra-academic-card')).toBeVisible();

  const syllabus = [
    'AP Biology — Mr. Smith (Room 204)',
    'Grading Policy:',
    'Tests: 40%',
    'Homework: 60%',
    'Lab report due 9/12/2026',
    'No School — Fall Break 10/12/2026'
  ].join('\n');
  await page.locator('#semPasteArea').fill(syllabus);
  await page.locator('[data-sem-action="add-paste"]').click();
  await expect(page.locator('.semsetup-source-row')).toContainText('parsed locally');

  await page.locator('[data-sem-action="to-review"]').click();
  await expect(page.locator('.semsetup-group').first()).toBeVisible();

  // Approval is explicit: nothing exists in the workspace yet.
  const before = await page.evaluate(() => ({
    courses: window.courseHub.getCourses({ filter: 'all' }).length,
    hw: JSON.parse(localStorage.getItem('hwTasks:v2') || '[]').length
  }));

  await page.locator('[data-sem-action="apply"]').click();
  await expect(page.locator('.semsetup-done')).toBeVisible();

  const after = await page.evaluate(() => ({
    courses: window.courseHub.getCourses({ filter: 'all' }).map((c) => c.name),
    hw: window.SutraHomeworkStore.getSnapshot().tasks || [],
    overrides: window.SutraSchoolSchedule.getState().overrides,
    planner: window.SutraGradePlanner.getPlanner()
  }));

  expect(after.courses).toContain('AP Biology');
  expect(after.courses.length).toBeGreaterThan(before.courses);
  expect(after.hw.some((t) => /lab report/i.test(t.title))).toBeTruthy();
  expect(after.overrides.some((o) => o.date === '2026-10-12' && o.kind === 'holiday')).toBeTruthy();
  const apBioId = await page.evaluate(() => window.courseHub.getCourses({ filter: 'all' }).find((c) => c.name === 'AP Biology').id);
  expect(after.planner.courses[apBioId].categories.length).toBe(2);
});

test('Testing Hub custom exam content survives normalization and workspace restore', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const name = 'Custom exam ' + 'N'.repeat(160);
    const description = 'Description ' + 'D'.repeat(800);
    const hub = window.flowAtelier.testingHub;
    hub.custom = [{ id: 'custom-long-content', name, description, sections: [] }];
    window.flowAtelier.persistAppData();
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    const restored = window.flowAtelier.testingHub.custom.find((exam) => exam.id === 'custom-long-content');
    return { name: restored && restored.name, description: restored && restored.description };
  });
  expect(result.name).toBe('Custom exam ' + 'N'.repeat(160));
  expect(result.description).toBe('Description ' + 'D'.repeat(800));
});

test('Assignment Studio milestones persist and surface as deadlines', async ({ page }) => {
  await openApp(page);

  const taskId = await page.evaluate(() => {
    const tasks = [{
      id: 'qa-hw-studio-1', courseId: '', title: 'Research paper', text: 'Research paper',
      done: false, dueDate: '2099-05-01', dueTime: '', due: '2099-05-01',
      priority: 'high', difficulty: 'hard', recurrence: 'none', notes: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }];
    // Seed into the canonical homework store (the source of truth Assignment Studio
    // reads), not the legacy hwTasks:v2 localStorage key.
    window.SutraHomeworkStore.replace({ courses: [], tasks }, { reason: 'test-seed' });
    window.dispatchEvent(new CustomEvent('homework:updated'));
    const added = window.SutraAssignmentStudio.addMilestones('qa-hw-studio-1', [
      { title: 'Outline', dueDate: '2099-04-01' },
      { title: 'First draft', dueDate: '2099-04-15' }
    ]);
    return added === 2 ? 'qa-hw-studio-1' : null;
  });
  expect(taskId).toBe('qa-hw-studio-1');

  const state = await page.evaluate(() => {
    const tasks = window.SutraHomeworkStore.getSnapshot().tasks || [];
    const task = tasks.find((t) => t.id === 'qa-hw-studio-1');
    const deadlines = window.collectWorkspaceDeadlines ? window.collectWorkspaceDeadlines() : [];
    return {
      milestones: task && task.studio ? task.studio.milestones.length : 0,
      milestoneDeadlines: deadlines.filter((d) => d.source === 'milestone').map((d) => d.title)
    };
  });
  expect(state.milestones).toBe(2);
  expect(state.milestoneDeadlines).toContain('Outline');

  // Studio modal opens with accessible dialog semantics.
  await page.evaluate(() => window.SutraAssignmentStudio.open('qa-hw-studio-1'));
  const dialog = page.locator('#assignmentStudioModal [role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#assignmentStudioModal .studio-ms-row')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#assignmentStudioModal')).toBeHidden();
});

test('new academic state survives a reload', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async (schedule) => {
    window.SutraAcademicState.setSchoolSchedule(schedule);
    const planner = window.SutraGradePlanner.getPlanner();
    planner.courses['qa-reload-course'] = {
      categories: [{ id: 'c1', name: 'Projects', weight: 100, drops: 0 }],
      entries: [], targetPercent: 88, gpa: { credits: 1, level: 'regular', includeInGpa: true }
    };
    window.SutraGradePlanner.setPlanner(planner);
    if (typeof window.flushAppSaveNow === 'function') await window.flushAppSaveNow('qa');
  }, SAMPLE_SCHEDULE);
  // Give the debounced save queue a moment, then reload.
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => !!window.SutraAcademicState && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('academic-upgrade-reload-ready'));
  await completeOnboarding(page);

  const restored = await page.evaluate(() => ({
    scheduleEnabled: window.SutraAcademicState.getSchoolSchedule().enabled,
    anchor: window.SutraAcademicState.getSchoolSchedule().rotation.anchorDate,
    target: (window.SutraAcademicState.getGradePlanner().courses['qa-reload-course'] || {}).targetPercent
  }));
  expect(restored.scheduleEnabled).toBe(true);
  expect(restored.anchor).toBe('2026-01-05');
  expect(restored.target).toBe(88);
});

test('Today strip and reminder surfaces are present and honest', async ({ page }) => {
  await openApp(page);
  await page.evaluate((schedule) => {
    window.SutraAcademicState.setSchoolSchedule(schedule);
    window.SutraSchoolSchedule.renderTodayStrip();
    window.setActiveView('today');
  }, SAMPLE_SCHEDULE);
  await expect(page.locator('#sutraSchoolDayStrip')).toBeVisible();

  // Notification preferences include the new categories + honest limits copy.
  const notif = await page.evaluate(() => {
    const prefs = window.SutraNotifications.getPreferences();
    return {
      milestoneCat: prefs.categories.milestone,
      scheduleCat: prefs.categories.schedule,
      replay: prefs.missedReplayEnabled !== false,
      hasIcsExport: typeof window.SutraNotifications.exportRemindersToCalendar === 'function'
    };
  });
  expect(notif.milestoneCat).toBe(true);
  expect(notif.scheduleCat).toBe(true);
  expect(notif.replay).toBe(true);
  expect(notif.hasIcsExport).toBe(true);
});
