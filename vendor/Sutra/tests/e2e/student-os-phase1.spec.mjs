import { expect, test } from '@playwright/test';

// Student OS Phase 1 regression coverage:
// 1. Student Inbox aggregates the connected local work graph and safe actions.
// 2. Course Hub reads the deterministic Grade Planner engine and linked course data.
// 3. Assistant Action Review Center blocks high-risk batch actions without confirmation.
// 4. Backup round-trip, data-safety cards, mobile inbox layout, and expanded search.

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
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.courseHub
    && !!window.SutraGradePlanner
    && !!window.SutraAssignmentStudio
    && !!window.SutraAssistantActions
    && !!window.flowAtelier);
}

test('Student Inbox aggregates connected work and safe actions use guarded storage', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const dateKey = (offset = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const course = window.courseHub.createCourse({
      name: 'QA Physics',
      type: 'ap',
      subjectArea: 'Science',
      teacherName: 'Dr. Park',
      room: '201'
    });

    const safeCalls = [];
    const realSafeSet = window.SutraSafeStorage.set;
    window.SutraSafeStorage.set = function (key, value, opts) {
      if (/^hw(Tasks|Courses)/.test(String(key))) {
        safeCalls.push({ key: String(key), importance: opts && opts.importance });
      }
      return realSafeSet.call(window.SutraSafeStorage, key, value, opts);
    };

    const homework = window.courseHub.createAssignmentForCourse(course.id, {
      title: 'Vectors problem set',
      dueDate: dateKey(0),
      dueTime: '20:00',
      priority: 'high',
      difficulty: 'hard',
      notes: 'Complete before lab'
    });
    const milestoneCount = window.SutraAssignmentStudio.addMilestones(homework.id, [
      { title: 'Draft vector diagrams', dueDate: dateKey(0), estimateMinutes: 45 }
    ]);

    window.flowAtelier.tasks.push({
      id: 'qa-planner-1',
      title: 'Bring graphing calculator',
      dueDate: dateKey(0),
      priority: 'high',
      completed: false,
      isActive: true
    });

    window.flowAtelier.timeBlocks.push(
      { id: 'qa-block-1', name: 'Study collision lab', date: dateKey(0), start: '19:00', end: '20:00', category: 'study' },
      { id: 'qa-block-2', name: 'Club overlap', date: dateKey(0), start: '19:30', end: '20:15', category: 'activity' }
    );

    const deck = window.createReviewDeck({
      name: 'Physics Daily Review',
      subject: 'Physics',
      sourceType: 'course',
      sourceId: course.id
    });
    window.bulkImportReviewCards(deck.id, 'Momentum - mass times velocity');

    const ap = window.flowAtelier.apStudyWorkspace;
    ap.subjects.push({
      id: 'qa-ap-physics',
      name: 'AP Physics C',
      examDate: dateKey(3),
      examTime: '08:00',
      confidence: 42,
      courseId: course.id
    });

    const collegeRow = typeof window.createCollegeAppTrackerRow === 'function'
      ? window.createCollegeAppTrackerRow({ school: 'Local Tech', status: 'applying', priority: 'high', deadline: dateKey(4) })
      : { id: 'qa-college-1', school: 'Local Tech', status: 'applying', priority: 'high', deadline: dateKey(4) };
    window.flowAtelier.collegeAppWorkspace.collegeTracker.push(collegeRow);

    window.flowAtelier.businessWorkspace.projects.push({
      id: 'qa-business-1',
      name: 'Robotics demo',
      dueDate: dateKey(2),
      priority: 'high',
      status: 'active'
    });

    window.flowAtelier.pages.push({
      id: 'qa-note-stale',
      title: 'Old Physics Notes',
      content: '<p>Vectors and momentum</p>',
      classLinkId: course.id,
      isLocked: false,
      updatedAt: new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString()
    });

    window.flowAtelier.persistAppData();

    const all = window.courseHub.getStudentInboxItems({ filter: 'all', courseId: 'all', search: '' });
    const sourceSet = Array.from(new Set(all.map((item) => item.source))).sort();
    const filterCounts = {
      highRisk: window.courseHub.getStudentInboxItems({ filter: 'highRisk' }).length,
      unscheduled: window.courseHub.getStudentInboxItems({ filter: 'unscheduled' }).length,
      review: window.courseHub.getStudentInboxItems({ filter: 'review' }).length,
      ap: window.courseHub.getStudentInboxItems({ filter: 'ap' }).length,
      college: window.courseHub.getStudentInboxItems({ filter: 'college' }).length,
      timeline: window.courseHub.getStudentInboxItems({ filter: 'timeline' }).length,
      course: window.courseHub.getStudentInboxItems({ filter: 'course', courseId: course.id }).length
    };
    // Homework persists through the canonical SutraHomeworkStore (the guarded
    // workspace path), not a raw hwTasks:v2 localStorage write, so read done-state
    // from the store snapshot.
    const storeTasks = () => window.SutraHomeworkStore.getSnapshot().tasks || [];
    const beforeDone = storeTasks().find((task) => task.id === homework.id);
    const doneOk = window.cwMarkInboxDone('homework', homework.id);
    const afterDone = storeTasks().find((task) => task.id === homework.id);
    // The Course Hub assignment must be visible in the canonical store in the same
    // session (proves the guarded-store write path, not a stale localStorage copy).
    const inCanonicalStore = storeTasks().some((task) => task.id === homework.id && task.courseId === course.id);
    window.SutraSafeStorage.set = realSafeSet;

    return {
      courseId: course.id,
      homeworkId: homework.id,
      milestoneCount,
      sourceSet,
      filterCounts,
      inCanonicalStore,
      beforeDone: beforeDone && beforeDone.done === true,
      doneOk,
      afterDone: afterDone && afterDone.done === true
    };
  });

  expect(result.milestoneCount).toBe(1);
  expect(result.sourceSet).toEqual(expect.arrayContaining([
    'ap',
    'business',
    'college',
    'homework',
    'milestone',
    'planner',
    'review',
    'timeline'
  ]));
  expect(result.filterCounts.highRisk).toBeGreaterThan(0);
  expect(result.filterCounts.unscheduled).toBeGreaterThan(0);
  expect(result.filterCounts.review).toBeGreaterThan(0);
  expect(result.filterCounts.ap).toBeGreaterThan(0);
  expect(result.filterCounts.college).toBeGreaterThan(0);
  expect(result.filterCounts.timeline).toBeGreaterThan(0);
  expect(result.filterCounts.course).toBeGreaterThan(0);
  expect(result.inCanonicalStore).toBeTruthy();
  expect(result.beforeDone).toBe(false);
  expect(result.doneOk).toBe(true);
  expect(result.afterDone).toBe(true);
});

test('Course Hub centralizes linked course data and deterministic grade math', async ({ page }) => {
  await openApp(page);

  const grade = await page.evaluate(() => {
    const course = window.courseHub.createCourse({ name: 'QA Chemistry', type: 'class', room: '305' });
    window.courseHub.createAssignmentForCourse(course.id, {
      title: 'Stoichiometry packet',
      dueDate: '2099-05-01',
      priority: 'high',
      difficulty: 'hard'
    });
    window.courseHub.addCourseResourceLink(course.id, {
      name: 'Stoichiometry reference',
      url: 'https://example.com/stoich',
      kind: 'link',
      description: 'Course formula sheet'
    });
    const pageObj = {
      id: 'qa-chem-note',
      title: 'QA Chemistry Notes',
      content: '<p>Moles and ratios</p>',
      isLocked: false,
      updatedAt: new Date().toISOString()
    };
    window.flowAtelier.pages.push(pageObj);
    window.courseHub.linkNoteToCourse(course.id, pageObj.id);
    window.cwCreateReviewDeck(course.id);

    const planner = window.SutraGradePlanner.getPlanner();
    planner.courses[course.id] = {
      categories: [
        { id: 'tests', name: 'Tests', weight: 60, drops: 0 },
        { id: 'hw', name: 'Homework', weight: 40, drops: 0 }
      ],
      entries: [
        { id: 'e1', categoryId: 'tests', title: 'Unit test', score: 45, maxScore: 50, status: 'graded' },
        { id: 'e2', categoryId: 'hw', title: 'Practice set', score: 8, maxScore: 10, status: 'graded' },
        { id: 'e3', categoryId: 'tests', title: 'Missing lab', score: null, maxScore: 50, status: 'missing' },
        { id: 'e4', categoryId: 'hw', title: 'Pending quiz', score: null, maxScore: 10, status: 'pending' },
        { id: 'e5', categoryId: 'hw', title: 'Excused warmup', score: null, maxScore: 5, status: 'excused' }
      ],
      targetPercent: 90,
      gpa: { credits: 1, level: 'honors', includeInGpa: true }
    };
    window.SutraGradePlanner.setPlanner(planner);

    const engine = window.SutraGradePlanner.engine;
    const data = engine.normalizeCourseGrades(planner.courses[course.id]);
    const computed = engine.computeCourseGrade(data, planner.settings);
    const solved = engine.scoreNeededForTarget(data, { targetPercent: 90, categoryId: 'tests', maxScore: 100 }, planner.settings);
    const impact = engine.rankImpact(data, planner.settings);
    const gpa = engine.computeGpa([{ courseId: course.id, percent: computed.percent, credits: 1, level: 'honors', includeInGpa: true }], planner.settings);

    window.cwSelectCourse(course.id);
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.remove('active');
      view.style.display = 'none';
    });
    const section = document.getElementById('view-courses');
    if (section) {
      section.classList.add('active');
      section.style.display = '';
    }
    document.body.dataset.view = 'courses';
    window.renderCourseHubView();

    return {
      percent: computed.percent,
      missingCount: computed.missingCount,
      pendingCount: computed.pendingCount,
      excusedCount: computed.excusedCount,
      solvedPossible: solved.possible,
      impactTitle: impact[0] && impact[0].title,
      weightedGpa: gpa.weighted,
      courseId: course.id
    };
  });

  expect(grade.percent).toBe(59);
  expect(grade.missingCount).toBe(1);
  expect(grade.pendingCount).toBe(1);
  expect(grade.excusedCount).toBe(1);
  expect(grade.solvedPossible).toBe(true);
  expect(grade.impactTitle).toBe('Missing lab');
  expect(grade.weightedGpa).not.toBeNull();

  await expect(page.locator('#courseHubMount')).toContainText('Next Actions');
  await expect(page.locator('#courseHubMount')).toContainText('Files & Resources');
  await expect(page.locator('#courseHubMount')).toContainText('Linked Notes');
  await expect(page.locator('#courseHubMount')).toContainText('Local grade engine');
  await expect(page.locator('#courseHubMount')).toContainText('School Schedule');
  await expect(page.locator('#courseHubMount')).toContainText('Create review deck');
  await expect(page.locator('#courseHubMount')).toContainText('Study Block');
});

test('Assistant Action Review Center blocks high-risk batch actions and search spans new sources', async ({ page }) => {
  await openApp(page);

  const seeded = await page.evaluate(() => {
    const course = window.courseHub.createCourse({ name: 'QA Optics', type: 'class' });
    window.courseHub.addCourseResourceLink(course.id, {
      name: 'Spectrometer guide',
      url: 'https://example.com/spectrometer',
      kind: 'link',
      description: 'Spectrometer lab sheet'
    });
    const deck = window.createReviewDeck({ name: 'Optics Review', subject: 'Physics' });
    window.bulkImportReviewCards(deck.id, 'Spectrometer - tool for measuring wavelengths');
    window.SutraAssistantActions.logActivity({
      id: 'qa-assistant-search',
      actionType: 'reschedule_tasks',
      summary: 'Reschedule spectrometer lab',
      status: 'applied',
      risk: 'medium',
      batchId: 'qa-search-batch',
      timestamp: new Date().toISOString()
    });
    return { courseCount: window.courseHub.getCourses({ filter: 'all' }).length };
  });

  await page.evaluate(() => {
    window.__qaConfirmCalls = 0;
    window.showCustomConfirmDialog = () => {
      window.__qaConfirmCalls += 1;
      return Promise.resolve(false);
    };
    window.SutraAssistantActions.openReviewCenter([
      { type: 'create_course', name: 'Risky Created Course' },
      { type: 'navigate', view: 'today' }
    ], { meta: { userPrompt: 'qa batch' } });
  });

  await expect(page.locator('#flowActionReviewOverlay')).toBeVisible();
  await expect(page.locator('.flow-action-review-head')).toContainText('Proposed plan');
  await expect(page.locator('.flow-risk-high')).toBeVisible();
  await expect(page.locator('.flow-before-after').first()).toBeVisible();
  await page.locator('[data-flow-batch="selected"]').click();
  await expect.poll(() => page.evaluate(() => window.__qaConfirmCalls)).toBe(1);

  const blocked = await page.evaluate((beforeCount) => ({
    confirmCalls: window.__qaConfirmCalls,
    courseCount: window.courseHub.getCourses({ filter: 'all' }).length,
    riskyCreated: window.courseHub.getCourses({ filter: 'all' }).some((course) => course.name === 'Risky Created Course')
  }), seeded.courseCount);
  expect(blocked.confirmCalls).toBe(1);
  expect(blocked.courseCount).toBe(seeded.courseCount);
  expect(blocked.riskyCreated).toBe(false);

  await page.locator('[data-flow-batch="history"]').click();
  await expect(page.locator('#flowActivityOverlay')).toBeVisible();
  await expect(page.locator('#flowActivityOverlay')).toContainText('Reschedule spectrometer lab');

  const search = await page.evaluate(() => {
    const runSearch = typeof globalSearchAll === 'function' ? globalSearchAll : window.globalSearchAll;
    return {
      spectrometer: runSearch('spectrometer'),
      backup: runSearch('backup'),
      momentum: runSearch('wavelengths')
    };
  });
  expect(search.spectrometer.resources.some((item) => /Spectrometer/i.test(item.title))).toBeTruthy();
  expect(search.spectrometer.assistant.some((item) => /spectrometer/i.test(item.title))).toBeTruthy();
  expect(search.backup.settings.some((item) => /Data & backups/i.test(item.title))).toBeTruthy();
  expect(search.momentum.review.some((item) => /Spectrometer/i.test(item.title))).toBeTruthy();
});

test('Backup health exports new inbox settings and mobile Student Inbox stays usable', async ({ page }) => {
  await openApp(page);

  const roundTrip = await page.evaluate(() => {
    const dateKey = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const course = window.courseHub.createCourse({ name: 'QA Mobile Biology', type: 'class' });
    window.courseHub.createAssignmentForCourse(course.id, {
      title: 'Cell transport worksheet',
      dueDate: dateKey(),
      priority: 'high',
      difficulty: 'hard'
    });
    window.cwSetStudentInboxFilter('highRisk');
    sessionStorage.setItem('groq_api_key', 'gsk_PHASE1_FAKE_SECRET');
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const rt = window.verifyWorkspaceRoundTrip();
    return {
      ok: rt.ok,
      summary: rt.summary,
      inboxFilter: payload.courseWorkspace && payload.courseWorkspace.settings
        ? payload.courseWorkspace.settings.studentInboxFilter
        : '',
      hasDataSafetyCards: [
        'sutraDataSafetyLastExport',
        'sutraDataSafetyStorage',
        'sutraDataSafetyDegraded',
        'sutraDataSafetyDrive',
        'sutraDataSafetyExportBtn',
        'sutraDataSafetyEmergencyBtn',
        'sutraDataSafetyRestoreBtn',
        'sutraDataSafetyDiagnosticsBtn'
      ].every((id) => !!document.getElementById(id)),
      containsSecret: JSON.stringify(payload).includes('gsk_PHASE1_FAKE_SECRET')
    };
  });

  expect(roundTrip.ok, roundTrip.summary).toBeTruthy();
  expect(roundTrip.inboxFilter).toBe('highRisk');
  expect(roundTrip.hasDataSafetyCards).toBe(true);
  expect(roundTrip.containsSecret).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.remove('active');
      view.style.display = 'none';
    });
    const section = document.getElementById('view-alldue');
    if (section) {
      section.classList.add('active');
      section.style.display = '';
    }
    document.body.dataset.view = 'alldue';
    window.renderAllDueView();
  });

  const mobile = await page.evaluate(() => {
    const mount = document.getElementById('allDueMount');
    const row = mount && mount.querySelector('.student-inbox-row');
    const actions = row && row.querySelector('.ad-row-actions');
    const filter = mount && mount.querySelector('.ad-filter-bar');
    if (!mount || !row || !actions || !filter) return { ok: false };
    const mountRect = mount.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const buttonHeights = Array.from(actions.querySelectorAll('button')).map((button) => button.getBoundingClientRect().height);
    return {
      ok: true,
      hasFilters: filter.querySelectorAll('.ad-filter-chip').length >= 8,
      hasActions: actions.querySelectorAll('button').length >= 4,
      rowWithinMount: rowRect.left >= mountRect.left - 1 && rowRect.right <= mountRect.right + 1,
      actionButtonsTouchable: buttonHeights.length > 0 && Math.min(...buttonHeights) >= 28
    };
  });

  expect(mobile.ok).toBe(true);
  expect(mobile.hasFilters).toBe(true);
  expect(mobile.hasActions).toBe(true);
  expect(mobile.rowWithinMount).toBe(true);
  expect(mobile.actionButtonsTouchable).toBe(true);
});
