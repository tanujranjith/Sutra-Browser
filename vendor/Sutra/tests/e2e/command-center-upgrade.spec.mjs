import { expect, test } from '@playwright/test';

// Command-center upgrade regression coverage for the College, Life, and
// Business "mini-OS" tabs:
//   1. Shared SutraCommandCenter foundation loads (signal grid + drawer).
//   2. College: legacy phase migration, new fields, intelligence dashboard,
//      per-school profile drawer, and .sutra round-trip.
//   3. Life: synthesized cockpit, SMART/OKR goal drawer + milestones,
//      spending budgets, journal signals, and round-trip.
//   4. Business: project health scoring, weighted pipeline, meeting agenda.
//   5. Deadline Radar picks up Life goal deadlines.
//   6. Older workspaces missing the new schema normalize safely (defaults).

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
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('business', { test: true }));
  await page.waitForFunction(() => !!window.SutraCommandCenter && typeof window.renderCollegeAppWorkspace === 'function'
    && typeof window.renderLifeWorkspace === 'function' && !!window.NoteFlowBusiness);
}

test('shared command-center foundation loads with signal grid + drawer', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const cc = window.SutraCommandCenter;
    const grid = cc.signalGridHtml([{ id: 's1', label: 'Test', value: '42', tone: 'positive', action: 'demo', target: 'x' }]);
    return {
      hasApi: !!cc && typeof cc.signalGridHtml === 'function' && !!cc.drawer,
      gridHasCard: /cc-signal-card/.test(grid) && /data-cc-action="demo"/.test(grid),
      daysUntil: cc.daysUntil('2099-01-01') > 0,
      money: cc.formatMoney(2500, 'USD')
    };
  });
  expect(result.hasApi).toBe(true);
  expect(result.gridHasCard).toBe(true);
  expect(result.daysUntil).toBe(true);
  expect(result.money).toBe('$2,500');
});

test('college: legacy phases migrate and rich fields survive a round-trip', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    // Legacy workspace using the old planning/in_progress status values.
    const legacy = window.normalizeCollegeAppWorkspace({
      onboardingSeeded: true,
      collegeTracker: [
        { school: 'Legacy Planning U', status: 'planning' },
        { school: 'Legacy InProgress U', status: 'in_progress', tier: 'reach', round: 'ED', priority: 'high', likelihood: 22, nextAction: 'Draft essay' }
      ],
      essayOrganizer: [{ school: 'Common App', prompt: 'Topic of choice', wordTarget: 650, reviewerStatus: 'with_reviewer', nextRevisionTask: 'Tighten intro' }],
      scholarships: [{ name: 'Merit Award', amount: 3000, scope: 'external', merit: true, eligibility: 'GPA 3.5+' }]
    });
    const tracker = legacy.collegeTracker;
    return {
      migratedPlanning: tracker[0].status,
      migratedInProgress: tracker[1].status,
      tier: tracker[1].tier,
      round: tracker[1].round,
      likelihood: tracker[1].likelihood,
      essayWordTarget: legacy.essayOrganizer[0].wordTarget,
      essayReviewer: legacy.essayOrganizer[0].reviewerStatus,
      scholarshipMerit: legacy.scholarships[0].merit === true,
      scholarshipScope: legacy.scholarships[0].scope
    };
  });
  expect(result.migratedPlanning).toBe('research');
  expect(result.migratedInProgress).toBe('applying');
  expect(result.tier).toBe('reach');
  expect(result.round).toBe('ED');
  expect(result.likelihood).toBe(22);
  expect(result.essayWordTarget).toBe(650);
  expect(result.essayReviewer).toBe('with_reviewer');
  expect(result.scholarshipMerit).toBe(true);
  expect(result.scholarshipScope).toBe('external');

  // Seed live workspace, render, and confirm the dashboard + drawer.
  const ui = await page.evaluate(() => {
    const rows = window.getCollegeAppRows('collegeTracker');
    rows.length = 0;
    rows.push(window.createCollegeAppTrackerRow({ school: 'Reach State', tier: 'reach', round: 'ED', priority: 'high', status: 'applying', deadline: window.offsetDateKey(30), likelihood: 18, recLettersRequired: 2, recLettersReceived: 1 }));
    rows.push(window.createCollegeAppTrackerRow({ school: 'Target Tech', tier: 'target', round: 'RD', priority: 'medium', status: 'applying', deadline: window.offsetDateKey(50) }));
    window.renderCollegeAppWorkspace();
    const intel = document.getElementById('collegeAppIntelligence');
    const firstId = window.getCollegeAppRows('collegeTracker')[0].id;
    window.openCollegeProfileDrawer(firstId);
    const drawerOpen = window.SutraCommandCenter.drawer.isOpen();
    const drawerFields = document.querySelectorAll('.cc-drawer [data-collegeapp-field]').length;
    window.SutraCommandCenter.drawer.close();

    // Round-trip the workspace through the export serializer.
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const reach = (payload.collegeAppWorkspace.collegeTracker || []).find((s) => s.school === 'Reach State');
    return {
      intelCards: intel ? intel.querySelectorAll('.cc-signal-card').length : 0,
      drawerOpen,
      drawerFields,
      roundTrip: window.verifyWorkspaceRoundTrip().ok,
      reachTier: reach ? reach.tier : null,
      reachLikelihood: reach ? reach.likelihood : null
    };
  });
  expect(ui.intelCards).toBeGreaterThanOrEqual(5);
  expect(ui.drawerOpen).toBe(true);
  expect(ui.drawerFields).toBeGreaterThanOrEqual(10);
  expect(ui.roundTrip).toBe(true);
  expect(ui.reachTier).toBe('reach');
  expect(ui.reachLikelihood).toBe(18);
});

test('life: cockpit, goal drawer milestones, and budgets persist', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const goals = window.getLifeRows('goals');
    goals.length = 0;
    goals.push(window.createLifeGoalRow({ title: 'Run a 5k', status: 'active', priority: 'high', targetDate: window.offsetDateKey(30), progress: 40, milestones: [{ title: 'Buy shoes', done: true }, { title: 'Week 3 run' }] }));
    const spend = window.getLifeRows('spending');
    spend.length = 0;
    spend.push(window.createLifeSpendingRow({ date: window.today(), category: 'Food', amount: 55 }));
    window.setLifeBudgetCap('Food', 40);

    window.renderLifeWorkspace();
    const cockpit = document.getElementById('lifeCockpit');
    const checkin = document.getElementById('lifeCheckInCard');
    const budgetsCard = document.getElementById('lifeBudgetsCard');
    const wellness = document.getElementById('lifePage-wellness');
    const sleepTable = document.getElementById('lifeSleepTableBody')?.closest('table');

    const goalId = window.getLifeRows('goals')[0].id;
    window.openLifeGoalDrawer(goalId);
    const drawerOpen = window.SutraCommandCenter.drawer.isOpen();
    const milestoneInputs = document.querySelectorAll('.cc-drawer [data-life-milestone-id]').length;
    window.SutraCommandCenter.drawer.close();

    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const lw = payload.lifeWorkspace;
    const goal = (lw.goals || []).find((g) => g.title === 'Run a 5k');
    return {
      cockpitCards: cockpit ? cockpit.querySelectorAll('.cc-signal-card').length : 0,
      checkinPresent: checkin ? !!checkin.querySelector('#lifeCheckInMood') : false,
      retiredEnergyControls: document.querySelectorAll('#lifeCheckInEnergy, #wellnessEnergyInput, [data-life-sleep-field="nextDayEnergy"]').length,
      wellnessMentionsEnergy: wellness ? /\benergy\b/i.test(wellness.textContent || '') : false,
      sleepTableMentionsEnergy: sleepTable ? /\benergy\b/i.test(sleepTable.textContent || '') : false,
      budgetRows: budgetsCard ? budgetsCard.querySelectorAll('.life-budget-row').length : 0,
      drawerOpen,
      milestoneInputs,
      roundTrip: window.verifyWorkspaceRoundTrip().ok,
      goalMilestones: goal ? (goal.milestones || []).length : 0,
      budgetCap: lw.spendingBudgets ? lw.spendingBudgets.Food : null
    };
  });
  expect(result.cockpitCards).toBeGreaterThanOrEqual(3);
  expect(result.checkinPresent).toBe(true);
  expect(result.retiredEnergyControls).toBe(0);
  expect(result.wellnessMentionsEnergy).toBe(false);
  expect(result.sleepTableMentionsEnergy).toBe(false);
  expect(result.budgetRows).toBeGreaterThanOrEqual(1);
  expect(result.drawerOpen).toBe(true);
  expect(result.milestoneInputs).toBeGreaterThanOrEqual(2);
  expect(result.roundTrip).toBe(true);
  expect(result.goalMilestones).toBe(2);
  expect(result.budgetCap).toBe(40);
});

test('business: project health scoring, weighted pipeline, and meeting agenda', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const ws = window.flowAtelier.businessWorkspace;
    ws.projects.length = 0; ws.opportunities.length = 0; ws.meetings.length = 0;
    ws.projects.push(window.createBusinessProjectRow({ name: 'Late Build', status: 'blocked', priority: 'high', dueDate: window.offsetDateKey(-12), completionPercent: 20, estimatedHours: 40, loggedHours: 55 }));
    ws.opportunities.push(window.createBusinessOpportunityRow({ name: 'Deal A', value: 10000, probability: 40, stage: 'negotiation' }));
    ws.opportunities.push(window.createBusinessOpportunityRow({ name: 'Deal B', value: 5000, stage: 'won' }));
    ws.meetings.push(window.createBusinessMeetingRow({ title: 'Kickoff', date: window.offsetDateKey(2), agenda: 'Scope review', decisions: 'Approved' }));
    window.NoteFlowBusiness.render();

    const summary = window.NoteFlowBusiness.getAssistantSummary();
    const rootEl = document.getElementById('businessDashboardRoot');
    const pipelineText = rootEl ? (rootEl.querySelector('.business-pipeline-summary') || {}).textContent || '' : '';

    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const meeting = (payload.businessWorkspace.meetings || []).find((m) => m.title === 'Kickoff');
    return {
      healthAtRisk: summary ? summary.healthAtRisk : null,
      weightedPipeline: summary ? summary.weightedPipeline : null,
      conversionRate: summary ? summary.conversionRate : null,
      hasHealthBar: rootEl ? !!rootEl.querySelector('.business-health-bar') : false,
      pipelineMentionsWeighted: /Weighted/.test(pipelineText),
      meetingAgenda: meeting ? meeting.agenda : null,
      meetingDecisions: meeting ? meeting.decisions : null,
      roundTrip: window.verifyWorkspaceRoundTrip().ok
    };
  });
  expect(result.healthAtRisk).toBeGreaterThanOrEqual(1);
  expect(result.weightedPipeline).toBe(4000);
  expect(result.conversionRate).toBe(100);
  expect(result.hasHealthBar).toBe(true);
  expect(result.pipelineMentionsWeighted).toBe(true);
  expect(result.meetingAgenda).toBe('Scope review');
  expect(result.meetingDecisions).toBe('Approved');
  expect(result.roundTrip).toBe(true);
});

test('deadline radar surfaces Life goal deadlines', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const goals = window.getLifeRows('goals');
    goals.length = 0;
    goals.push(window.createLifeGoalRow({ title: 'RadarGoalXYZ', status: 'active', targetDate: window.offsetDateKey(5) }));
    const deadlines = window.collectWorkspaceDeadlines({ includeBusiness: false });
    const entry = deadlines.find((d) => d.source === 'life' && /RadarGoalXYZ/.test(d.title));
    return { found: !!entry, sourceId: entry ? entry.sourceId : null };
  });
  expect(result.found).toBe(true);
  expect(result.sourceId).toBeTruthy();
});

test('older workspaces without the new schema normalize with safe defaults', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    // Minimal/empty objects — every normalizer must fill defaults, not throw.
    const college = window.normalizeCollegeAppWorkspace({});
    const life = window.normalizeLifeWorkspace({});
    const business = window.normalizeBusinessWorkspace({});
    return {
      collegeHasSavedViews: Array.isArray(college.savedViews),
      collegeTrackerView: !!college.trackerView && college.trackerView.sort === 'deadline',
      lifeHasBudgets: !!life.spendingBudgets && typeof life.spendingBudgets === 'object',
      lifeHasRecurring: Array.isArray(life.recurringExpenses),
      lifeHabitExcused: !!life.habitExcused,
      businessProjects: Array.isArray(business.projects)
    };
  });
  expect(result.collegeHasSavedViews).toBe(true);
  expect(result.collegeTrackerView).toBe(true);
  expect(result.lifeHasBudgets).toBe(true);
  expect(result.lifeHasRecurring).toBe(true);
  expect(result.lifeHabitExcused).toBe(true);
  expect(result.businessProjects).toBe(true);
});
