import { expect, test } from '@playwright/test';

// Today view redesign coverage:
// 1. SutraTodayCenter pure helpers are deterministic (injected clock):
//    urgency labels, time-horizon grouping (overdue/today/tomorrow/thisWeek/
//    later/undated), next-priority selection, summary counts, agenda ordering.
// 2. The Upcoming Radar renders real workspace items, respects the category
//    filter, hides undated items unless explicitly filtered, caps zones with
//    a "+N more" overflow that opens the Deadline Radar modal, and opens the
//    correct source view on chip click.
// 3. The Next Up card + footer counts populate from live data and fall back
//    to friendly empty states.

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
  // flowAtelier is published before the canonical workspace has finished
  // hydrating. Seed records only after the late boot delegates are bound so
  // hydration cannot replace the arrays underneath this test.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraTodayCenter && !!window.flowAtelier);
}

const dateKey = (offset) => `
  (function () {
    const d = new Date();
    d.setDate(d.getDate() + (${offset}));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })()
`;

test('pure helpers: urgency, grouping, prioritization, summary, agenda', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const T = window.SutraTodayCenter;
    // Fixed clock: Tuesday 2026-03-10 09:00 local.
    const now = new Date(2026, 2, 10, 9, 0, 0);
    const mk = (id, dayOffset, extra) => {
      let due = null;
      if (dayOffset !== null) {
        due = new Date(2026, 2, 10 + dayOffset, 12, 0, 0);
      }
      return Object.assign({ id, source: 'task', sourceId: id, title: id, due, priority: 'medium', status: 'open', overdue: !!(due && due < now) }, extra || {});
    };
    const items = [
      mk('overdue-2d', -2, { priority: 'high' }),
      mk('overdue-30d', -30, { priority: 'low' }),
      mk('due-today', 0, { priority: 'high' }),
      mk('due-tomorrow', 1),
      mk('due-in-4', 4),
      mk('due-in-6', 6),
      mk('due-in-7', 7),
      mk('due-in-30', 30),
      mk('undated', null),
      mk('done-today', 0, { status: 'done' })
    ];
    const groups = T.groupItemsByTimeHorizon(items, now);
    const summary = T.getTodaySummary(items, now);
    const next = T.getNextPriorityItem(items, { now });
    const nextEmpty = T.getNextPriorityItem([], { now });
    const undatedOnly = T.getNextPriorityItem([mk('undated-b', null)], { now });
    const agenda = T.getTodayAgenda({
      blocks: [
        { name: 'Late block', date: '2026-03-10', start: '14:00', end: '15:00', category: 'study' },
        { name: 'Early block', date: '2026-03-10', start: '08:00', end: '09:00', category: 'study' },
        { name: 'Other day', date: '2026-03-11', start: '08:00', end: '09:00', category: 'study' }
      ],
      items: [
        mk('timed-deadline', 0),                                   // 12:00 → appears
        { id: 'allday', source: 'task', title: 'allday', due: new Date(2026, 2, 10, 23, 59), priority: 'medium', status: 'open', overdue: false }
      ]
    }, now);
    const radarDefault = T.getUpcomingRadarItems(items, { now, filter: 'all' });
    const radarUndated = T.getUpcomingRadarItems(items, { now, filter: 'undated' });
    return {
      groupIds: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map(i => i.id)])),
      summary,
      nextId: next && next.item.id,
      nextStatus: next && next.status.label,
      nextEmpty,
      undatedOnlyWins: undatedOnly,
      urgencyLabels: {
        overdue2: T.getUrgencyStatus(items[0], now).label,
        today: T.getUrgencyStatus(items[2], now).label,
        tomorrow: T.getUrgencyStatus(items[3], now).label,
        undated: T.getUrgencyStatus(items[8], now).label
      },
      agendaTitles: agenda.map(a => a.title + '@' + a.timeLabel),
      radarZoneCounts: radarDefault.zones.map(z => [z.key, z.items.length, z.overflow]),
      radarHasUndatedByDefault: radarDefault.zones.some(z => z.items.some(i => i.id === 'undated')),
      radarUndatedIds: radarUndated.zones[0].items.map(i => i.id)
    };
  });

  expect(result.groupIds.overdue).toEqual(['overdue-30d', 'overdue-2d']);
  // Same due timestamp → stable (due, id) tie-break sorts by id.
  expect(result.groupIds.today).toEqual(['done-today', 'due-today']);
  expect(result.groupIds.tomorrow).toEqual(['due-tomorrow']);
  expect(result.groupIds.thisWeek).toEqual(['due-in-4', 'due-in-6']);
  expect(result.groupIds.later).toEqual(['due-in-7', 'due-in-30']);
  expect(result.groupIds.undated).toEqual(['undated']);

  expect(result.summary).toMatchObject({ overdue: 2, dueToday: 2, dueTomorrow: 1, dueThisWeek: 2, later: 2, undated: 1, total: 10 });

  // Deterministic prioritization: deeper overdue outranks newer overdue and
  // everything due later; undated/completed items never win; empty → null.
  expect(result.nextId).toBe('overdue-30d');
  expect(result.nextStatus).toBe('Overdue by 30 days');
  expect(result.nextEmpty).toBeNull();
  expect(result.undatedOnlyWins).toBeNull();

  expect(result.urgencyLabels.overdue2).toBe('Overdue by 2 days');
  expect(result.urgencyLabels.today).toBe('Due today');
  expect(result.urgencyLabels.tomorrow).toBe('Due tomorrow');
  expect(result.urgencyLabels.undated).toBe('No due date');

  // Agenda: chronological, today only, all-day (23:59) deadlines excluded.
  expect(result.agendaTitles).toEqual(['Early block@8:00 AM', 'timed-deadline@12:00 PM', 'Late block@2:00 PM']);

  // Radar zones: overdue merges into the Today band; done items excluded;
  // undated hidden by default but exposed via the explicit filter.
  expect(result.radarZoneCounts).toEqual([['today', 3, 0], ['tomorrow', 1, 0], ['thisWeek', 2, 0], ['later', 2, 0]]);
  expect(result.radarHasUndatedByDefault).toBe(false);
  expect(result.radarUndatedIds).toEqual(['undated']);
});

test('radar renders live data, filters, overflow, and opens the right source', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone Home shell uses its dedicated Next Up and agenda contract instead of the desktop radar.');
  await openApp(page);

  await page.evaluate(() => {
    const fa = window.flowAtelier;
    const dk = (off) => {
      const d = new Date();
      d.setDate(d.getDate() + off);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    fa.tasks.splice(0, fa.tasks.length);
    fa.timeBlocks.splice(0, fa.timeBlocks.length);
    fa.tasks.push(
      { id: 'qa-today', title: 'QA due today task', dueDate: dk(0), priority: 'high', completed: false, isActive: true, scheduleType: 'once' },
      { id: 'qa-undated', title: 'QA undated task', dueDate: '', priority: 'low', completed: false, isActive: true, scheduleType: 'once' }
    );
    fa.apStudyWorkspace.subjects.push({ id: 'qa-ap', name: 'QA Radar Subject', examDate: dk(2), examTime: '08:00', confidence: 40 });
    fa.renderTaskViews();
  });

  const mount = page.locator('#upcomingRadarMount');
  await expect(mount.locator('.radar-chip', { hasText: 'QA due today task' })).toBeVisible();
  const apChip = mount.locator('.radar-chip', { hasText: 'AP Exam: QA Radar Subject' });
  await expect(apChip).toBeVisible();

  // Undated items stay off the radar unless explicitly filtered in.
  await expect(mount.locator('.radar-chip', { hasText: 'QA undated task' })).toHaveCount(0);
  await page.selectOption('#upcomingRadarFilter', 'undated');
  await expect(mount.locator('.radar-list-item', { hasText: 'QA undated task' })).toBeVisible();
  await expect(mount.locator('.radar-list-item', { hasText: 'QA due today task' })).toHaveCount(0);
  await page.selectOption('#upcomingRadarFilter', 'all');

  // Chip click opens the underlying source (AP exam → Testing Hub view).
  await apChip.click();
  await expect(page.locator('#view-apstudy')).toHaveClass(/active/);
  await page.evaluate(() => window.flowAtelier.setActiveView('today'));

  // Zone overflow: more due-today items than the cap → "+N more" chip that
  // opens the full Deadline Radar list modal.
  await page.evaluate(() => {
    const fa = window.flowAtelier;
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    for (let i = 0; i < 8; i++) {
      fa.tasks.push({ id: `qa-bulk-${i}`, title: `QA bulk task ${i}`, dueDate: key, priority: 'medium', completed: false, isActive: true, scheduleType: 'once' });
    }
    fa.renderTaskViews();
  });
  const overflowChip = mount.locator('.radar-chip-overflow').first();
  await expect(overflowChip).toBeVisible();
  await overflowChip.click();
  await expect(page.locator('#deadlineRadarModal')).toHaveClass(/active/);
});

test('radar consolidates linked Homework deadline, due marker, and focus block', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const fa = window.flowAtelier;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const dueDate = due.getFullYear() + '-' + String(due.getMonth() + 1).padStart(2, '0') + '-' + String(due.getDate()).padStart(2, '0');
    const homeworkId = 'qa-radar-cpp';
    const mirrorTaskId = `hw_v2_${homeworkId}`;

    // The one Homework item is deliberately represented in each connected
    // store, matching the records that previously produced three Radar chips.
    const homeworkStore = window.SutraHomeworkStore;
    const homeworkSnapshot = homeworkStore.getSnapshot();
    homeworkStore.replace({
      ...homeworkSnapshot,
      courses: [{ id: 'qa-robotics', name: 'Robotics' }],
      tasks: [{
        id: homeworkId, courseId: 'qa-robotics', title: 'Finish the C++ code',
        dueDate, dueTime: '', done: false, priority: 'high', difficulty: 'medium'
      }]
    }, { reason: 'today-radar-regression' });
    fa.tasks.splice(0, fa.tasks.length, {
      id: mirrorTaskId, title: 'Finish the C++ code', dueDate, dueTime: '',
      completed: false, isActive: true, scheduleType: 'once', origin: 'homework',
      homeworkSource: 'v2', homeworkSourceId: homeworkId
    });
    fa.timeBlocks.splice(0, fa.timeBlocks.length,
      {
        id: `hw_block_v2_${homeworkId}`, date: dueDate, start: '23:00', end: '23:30',
        name: 'Finish the C++ code — Due', source: 'hw_due'
      },
      {
        id: 'qa-radar-focus', date: dueDate, start: '06:00', end: '06:30',
        name: 'Focus: Finish the C++ code', source: 'planner_auto',
        autoSourceKey: `auto:task:${mirrorTaskId}:${dueDate}`
      }
    );
    // The collector cache is frame-scoped, so let the preceding boot render
    // clear before collecting the intentionally seeded records.
    await Promise.resolve();
    const rows = window.collectWorkspaceDeadlines()
      .filter((item) => /finish the c\+\+ code/i.test(item.title));
    fa.renderTaskViews();
    return rows.map((item) => ({ source: item.source, title: item.title, scheduleSummary: item.scheduleSummary || '' }));
  });

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ source: 'homework', title: 'Finish the C++ code' });
  expect(result[0].scheduleSummary).toMatch(/^Scheduled /);
  const chip = page.locator('#upcomingRadarMount .radar-chip', { hasText: 'Finish the C++ code' });
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('.radar-chip-meta')).toContainText('Scheduled');
});

test('Deadline Radar can mark tasks, Homework, and Timeline items done', async ({ page }) => {
  await openApp(page);

  const ids = await page.evaluate(async () => {
    const fa = window.flowAtelier;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const dueDate = due.getFullYear() + '-' + String(due.getMonth() + 1).padStart(2, '0') + '-' + String(due.getDate()).padStart(2, '0');
    const taskId = 'qa-radar-complete-task';
    const homeworkId = 'qa-radar-complete-homework';
    const blockId = 'qa-radar-complete-block';
    fa.tasks.push({ id: taskId, title: 'Radar task to complete', dueDate, dueTime: '', completed: false, isActive: true, scheduleType: 'once' });
    const homeworkStore = window.SutraHomeworkStore;
    const homeworkSnapshot = homeworkStore.getSnapshot();
    homeworkStore.replace({
      ...homeworkSnapshot,
      courses: [...(homeworkSnapshot.courses || []), { id: 'qa-radar-complete-course', name: 'Radar Class' }],
      tasks: [...(homeworkSnapshot.tasks || []), {
        id: homeworkId, courseId: 'qa-radar-complete-course', title: 'Radar homework to complete',
        dueDate, dueTime: '', done: false, priority: 'medium', difficulty: 'medium'
      }]
    }, { reason: 'today-radar-completion-regression' });
    fa.timeBlocks.push({ id: blockId, date: dueDate, start: '15:00', end: '15:30', name: 'Radar block to complete', source: 'manual' });
    // Homework replacement renders connected surfaces synchronously. Let the
    // frame-scoped deadline cache clear before collecting the Timeline block
    // added immediately afterward in this synthetic multi-store setup.
    await Promise.resolve();
    fa.renderTaskViews();
    window.openDeadlineRadar();
    return { taskId, homeworkId, blockId };
  });

  const radar = page.locator('#deadlineRadarModal');
  for (const title of ['Radar task to complete', 'Radar homework to complete', 'Radar block to complete']) {
    await expect(radar.locator('.deadline-radar-item', { hasText: title }).locator('[data-deadline-done]')).toBeVisible();
  }

  await radar.locator('.deadline-radar-item', { hasText: 'Radar task to complete' }).locator('[data-deadline-done]').click();
  await expect(radar.locator('.deadline-radar-item', { hasText: 'Radar task to complete' })).toHaveCount(0);
  await radar.locator('.deadline-radar-item', { hasText: 'Radar homework to complete' }).locator('[data-deadline-done]').click();
  await expect(radar.locator('.deadline-radar-item', { hasText: 'Radar homework to complete' })).toHaveCount(0);
  await radar.locator('.deadline-radar-item', { hasText: 'Radar block to complete' }).locator('[data-deadline-done]').click();
  await expect(radar.locator('.deadline-radar-item', { hasText: 'Radar block to complete' })).toHaveCount(0);

  await expect.poll(() => page.evaluate(({ taskId, homeworkId, blockId }) => ({
    task: window.flowAtelier.tasks.find((task) => task.id === taskId)?.completed === true,
    homework: window.SutraHomeworkStore.getSnapshot().tasks.find((task) => task.id === homeworkId)?.done === true,
    block: window.flowAtelier.timeBlocks.find((block) => block.id === blockId)?.completed === true
  }), ids)).toEqual({ task: true, homework: true, block: true });
});

test('Next Up card, footer counts, and empty states use live data', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone Home shell has separate live Next Up assertions below.');
  await openApp(page);

  // Empty workspace → clear empty states, zero counts, empty radar.
  await page.evaluate(() => {
    const fa = window.flowAtelier;
    fa.tasks.splice(0, fa.tasks.length);
    fa.timeBlocks.splice(0, fa.timeBlocks.length);
    fa.apStudyWorkspace.subjects.splice(0, fa.apStudyWorkspace.subjects.length);
    fa.renderTaskViews();
  });
  await expect(page.locator('#todayDailyBrief .tnu-title')).toHaveText(/Nothing due/);
  await expect(page.locator('#tccOverdueCount')).toHaveText('0');
  await expect(page.locator('#tccDueTodayCount')).toHaveText('0');
  await expect(page.locator('#tccDueWeekCount')).toHaveText('0');
  await expect(page.locator('#upcomingRadarMount .radar-empty')).toBeVisible();

  // Seed an overdue high-priority task → it becomes Next Up with an overdue
  // status pill, focus + open actions, and live footer counts.
  await page.evaluate(() => {
    const fa = window.flowAtelier;
    const dk = (off) => {
      const d = new Date();
      d.setDate(d.getDate() + off);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    fa.tasks.push(
      { id: 'qa-overdue', title: 'QA overdue essay', dueDate: dk(-3), priority: 'high', completed: false, isActive: true, scheduleType: 'once' },
      { id: 'qa-week', title: 'QA next week task', dueDate: dk(4), priority: 'medium', completed: false, isActive: true, scheduleType: 'once' }
    );
    fa.renderTaskViews();
  });
  const brief = page.locator('#todayDailyBrief');
  await expect(brief.locator('.tnu-title')).toHaveText('QA overdue essay');
  await expect(brief.locator('.tnu-status-pill')).toHaveText('Overdue by 3 days');
  await expect(brief.locator('[data-donow-focus]')).toBeVisible();
  await expect(brief.locator('[data-brief-open-source]')).toBeVisible();
  await expect(page.locator('#tccOverdueCount')).toHaveText('1');
  await expect(page.locator('#tccDueWeekCount')).toHaveText('1');

  // Footer overdue count opens the overdue recovery flow.
  await page.click('[data-nextup-count="overdue"]');
  await expect(page.locator('#overdueRecoveryModal')).toHaveClass(/active/);
});

test('mobile Today is a focused command surface with bounded chrome and live actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  await page.evaluate(async () => {
    const fa = window.flowAtelier;
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    fa.tasks.splice(0, fa.tasks.length, {
      id: 'qa-mobile-next',
      title: 'Chemistry lab report',
      dueDate: key,
      dueTime: '18:00',
      priority: 'high',
      completed: false,
      isActive: true,
      scheduleType: 'once'
    });
    fa.timeBlocks.splice(0, fa.timeBlocks.length,
      { id: 'qa-mobile-calc', name: 'Calculus review', date: key, start: '11:30', end: '12:00', category: 'study' },
      { id: 'qa-mobile-chem', name: 'Chemistry lab report', date: key, start: '15:00', end: '15:45', category: 'study' },
      { id: 'qa-mobile-read', name: 'Read The Great Gatsby', date: key, start: '19:00', end: '19:30', category: 'reading' },
      { id: 'qa-mobile-later', name: 'Fourth item stays off the first screen', date: key, start: '20:00', end: '20:30', category: 'study' }
    );
    if (fa.apStudyWorkspace && Array.isArray(fa.apStudyWorkspace.subjects)) fa.apStudyWorkspace.subjects.splice(0);
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    fa.renderTaskViews();
  });

  await expect(page.locator('body')).toHaveClass(/mobile-today-mode/);
  const shell = page.locator('#todayMobileShell');
  await expect(shell).toBeVisible();
  await expect(page.locator('.top-nav')).toBeHidden();
  await expect(page.locator('#storageOptions')).toBeHidden();
  await expect(page.locator('#view-today .today-cc-layout')).toBeHidden();

  await expect(shell.locator('.today-mobile-appbar')).toBeVisible();
  await expect(shell.locator('.today-mobile-greeting h1')).toContainText(/Good (morning|afternoon|evening)/);
  await expect(shell.locator('.today-mobile-next .mobile-card-title')).toHaveText('Chemistry lab report');
  await expect(shell.locator('.today-mobile-focus-cta')).toContainText(/Start \d+-min focus/);
  await expect(shell.locator('.today-mobile-open-link')).toBeVisible();
  await expect(shell.locator('.today-mobile-agenda-row')).toHaveCount(3);
  await expect(shell.locator('.today-mobile-review-row')).toBeVisible();
  await expect(shell.locator('.today-mobile-trust')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const nav = document.getElementById('sutraBottomNav');
    const capture = nav && nav.querySelector('.sutra-bn-capture');
    const navBox = nav && nav.getBoundingClientRect();
    const captureBox = capture && capture.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      navBottom: navBox && navBox.bottom,
      navHeight: navBox && navBox.height,
      captureHeight: captureBox && captureBox.height
    };
  });
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.navBottom).toBeLessThanOrEqual(845);
  expect(geometry.navHeight).toBeLessThanOrEqual(90);
  expect(geometry.captureHeight).toBeLessThanOrEqual(60);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.tmp/mobile-today-implementation-390x844.png', fullPage: false });
  const notificationTrigger = shell.locator('.today-mobile-notifications');
  await notificationTrigger.click();
  const notificationPanel = page.locator('#notifPanel');
  await expect(notificationPanel).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('body')).toHaveClass(/notif-panel-open/);

  const notificationGeometry = await page.evaluate(() => {
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    const nav = document.getElementById('sutraBottomNav');
    const footer = panel && panel.querySelector('.notif-panel-footer');
    const panelBox = panel && panel.getBoundingClientRect();
    const footerBox = footer && footer.getBoundingClientRect();
    return {
      panelBottom: panelBox && panelBox.bottom,
      panelTop: panelBox && panelBox.top,
      footerBottom: footerBox && footerBox.bottom,
      viewportHeight: window.innerHeight,
      panelZ: panel ? Number.parseInt(getComputedStyle(panel).zIndex, 10) : 0,
      overlayZ: overlay ? Number.parseInt(getComputedStyle(overlay).zIndex, 10) : 0,
      navZ: nav ? Number.parseInt(getComputedStyle(nav).zIndex, 10) : 0,
      bodyOverflow: getComputedStyle(document.body).overflow,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    };
  });
  expect(notificationGeometry.panelBottom).toBeLessThanOrEqual(notificationGeometry.viewportHeight + 1);
  expect(notificationGeometry.footerBottom).toBeLessThanOrEqual(notificationGeometry.viewportHeight + 1);
  expect(notificationGeometry.panelTop).toBeGreaterThanOrEqual(0);
  expect(notificationGeometry.panelZ).toBeGreaterThan(notificationGeometry.navZ);
  expect(notificationGeometry.overlayZ).toBeGreaterThan(notificationGeometry.navZ);
  expect(notificationGeometry.bodyOverflow).toBe('hidden');
  expect(notificationGeometry.horizontalOverflow).toBe(false);

  await page.screenshot({ path: '.tmp/mobile-notification-sheet-fixed-390x844.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(notificationPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('body')).not.toHaveClass(/notif-panel-open/);
  await expect(notificationTrigger).toBeFocused();
});
