import { expect, test } from '@playwright/test';

// Sutra Assistant action-harness regression coverage (Assistant upgrade):
//   1. window.SutraAssistantActions registry: definitions, risk policy, undo
//      support metadata.
//   2. "what's overdue" → "mark those as complete" end to end: deterministic
//      local listing, reference resolution, batch review card with a readable
//      preview, apply through BOTH task stores (planner appData.tasks +
//      homework hwTasks:v2), surface refresh, Activity logging, Undo restore.
//   3. Quantifier references ("complete the first two") and ambiguity
//      clarification (never guess).
//   4. Reschedule ("move ... to tomorrow"), archive guardrails (homework can't
//      be archived; archiving never deletes), and no-deletion invariants.
//   5. Deterministic daily briefing + recovery plan builders (no model call).
//   6. Grade Planner read-only actions use local math.
//   7. Redesigned panel: WORKING FROM card, quick-action grid / key
//      onboarding, Workspace Pulse from real signals, overflow menu,
//      composer states.
//   8. Persistence: task status changes survive reload; no API keys in
//      exports; activity log rides localStorage.

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
    const intro = document.getElementById('sutraStartupIntro');
    if (intro) intro.remove();
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => !!window.flowAssistant && !!window.SutraAssistantActions
    && !!window.flowIntelligence && !!window.flowAtelier);
  // The Assistant Pack is opt-in for fresh student workspaces (assistant.enabled
  // defaults OFF), so enable it here exactly like a user flipping the Settings ▸
  // Assistant toggle — otherwise the chat launcher stays hidden. This spec also
  // exercises the DETERMINISTIC local command layer (overdue listing, reference
  // resolution, briefing, grade math), which sits behind assistant.localRouting
  // (defaults OFF / AI-only since 2026-06-30) — opt into that too.
  await page.evaluate(() => {
    window.setWorkspacePreference('assistant.enabled', true);
    window.setWorkspacePreference('assistant.localRouting', true);
  });
}

async function openAssistantPanel(page) {
  await page.evaluate(() => document.getElementById('chatbotBtn').click());
  await expect(page.locator('#chatbotPanel')).toBeVisible();
}

function isoDaysFromToday(offset) {
  // Local calendar date, matching the app's local-date semantics.
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedOverdueWork(page) {
  return page.evaluate(({ past11, past12, past7 }) => {
    const fa = window.flowAssistant;
    const r1 = fa.applyAction({ type: 'create_task', title: 'Drill weakest unit first', dueDate: past11, priority: 'high' });
    const r2 = fa.applyAction({ type: 'create_task', title: 'Build a one-week review plan', dueDate: past12, priority: 'high' });
    const r3 = fa.applyAction({ type: 'create_task', title: 'Run final-day checklist', dueDate: past7, priority: 'medium' });
    const r4 = fa.applyAction({ type: 'create_homework', title: 'Weekly reflection review', courseName: 'Study Skills', dueDate: past11 });
    return { ok: r1.ok && r2.ok && r3.ok && r4.ok };
  }, { past11: isoDaysFromToday(-11), past12: isoDaysFromToday(-12), past7: isoDaysFromToday(-7) });
}

async function sendChatMessage(page, text) {
  await page.evaluate((message) => {
    const input = document.getElementById('chatInput');
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.sendChat();
  }, text);
}

async function lastAssistantText(page) {
  // Replies stream word-by-word; poll until the transcript settles.
  await page.waitForTimeout(2400);
  return page.evaluate(() => {
    const msgs = document.querySelectorAll('#chatbotMessages .chatbot-msg.assistant');
    const last = msgs[msgs.length - 1];
    return last ? last.innerText.replace(/\s+/g, ' ').trim() : '';
  });
}

test('action harness registry exposes definitions, risk policy, and undo metadata', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const H = window.SutraAssistantActions;
    const types = H.listActions();
    const def = H.getActionDefinition('update_task_status');
    return {
      hasCore: ['update_task_status', 'reschedule_tasks', 'change_task_priority', 'create_task',
        'create_timeline_block', 'delete_timeline_block', 'append_note_text', 'create_note_from_response',
        'create_recovery_plan', 'run_grade_what_if', 'solve_target_grade', 'import_assignments',
        'canvas_create_board', 'canvas_edit_board', 'slides_create_deck', 'slides_edit_deck']
        .every((t) => types.includes(t)),
      defOk: !!def && def.undoSupported === true && typeof def.description === 'string',
      riskLevels: H.riskLevels,
      singleCompleteRisk: H.classifyRisk({ type: 'update_task_status', taskIds: ['x'], status: 'completed' }),
      batchCompleteRisk: H.classifyRisk({ type: 'update_task_status', taskIds: ['x', 'y'], status: 'completed' }),
      deleteBlockRisk: H.classifyRisk({ type: 'delete_timeline_block', blockId: 'b' }),
      gradeRisk: H.classifyRisk({ type: 'run_grade_what_if', courseName: 'X', score: 90 }),
      undoUnsupported: H.getUndoSupport('navigate'),
      aliasNormalized: H.classifyRisk({ type: 'complete_tasks', taskIds: ['a', 'b'] }),
      dependencyPlan: H.inspectPlan([
        { type: 'create_page', title: 'Plan note', body: '# Plan', planActionId: 'note' },
        { type: 'create_task', title: 'Do the work', planActionId: 'task', dependsOn: ['note'] }
      ]),
      canvasEditUndoable: H.getUndoSupport('canvas_edit_board').supported,
      slidesEditUndoable: H.getUndoSupport('slides_edit_deck').supported,
      surfaceEngineLoaded: !!window.SutraSurfaceAssistantActions,
      validationBlocksUnknown: H.validateAction({ type: 'drop_all_tables' }).ok === false,
      noDeleteTaskAction: !types.includes('delete_task') && !types.includes('delete_tasks')
    };
  });
  expect(result.hasCore).toBe(true);
  expect(result.defOk).toBe(true);
  expect(result.riskLevels).toEqual(['read_only', 'low', 'medium', 'high']);
  expect(result.singleCompleteRisk).toBe('low');
  expect(result.batchCompleteRisk).toBe('medium');
  expect(result.deleteBlockRisk).toBe('high');
  expect(result.gradeRisk).toBe('read_only');
  expect(result.undoUnsupported.supported).toBe(false);
  expect(result.aliasNormalized).toBe('medium');
  expect(result.dependencyPlan.ok).toBe(true);
  expect(result.dependencyPlan.steps[1].dependsOn).toEqual(['note']);
  expect(result.canvasEditUndoable).toBe(true);
  expect(result.slidesEditUndoable).toBe(true);
  expect(result.surfaceEngineLoaded).toBe(true);
  expect(result.validationBlocksUnknown).toBe(true);
  expect(result.noDeleteTaskAction).toBe(true);
});

test('"what\'s overdue" then "mark those as complete": batch card, both stores, Activity, Undo', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  // 1. Deterministic local overdue listing (no provider key configured).
  await sendChatMessage(page, "what's overdue?");
  const overdueReply = await lastAssistantText(page);
  expect(overdueReply).toContain('4 overdue');
  expect(overdueReply).toContain('Drill weakest unit first');
  expect(overdueReply).toContain('Weekly reflection review');

  // 2. "mark those as complete" resolves the listed refs into ONE batch card.
  await sendChatMessage(page, 'mark those as complete');
  await page.waitForTimeout(2400);
  const card = page.locator('#chatbotMessages .flow-action-card[data-action-type="update_task_status"]').last();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-risk', 'medium');
  await expect(card.locator('.flow-action-label')).toContainText('Mark 4 tasks as complete');
  // Readable preview lists the actual tasks; raw JSON only under details.
  await expect(card.locator('.flow-action-readable')).toContainText('Build a one-week review plan');
  await expect(card.locator('.flow-action-preview summary')).toHaveText('Technical details');
  const applyBtn = card.locator('.flow-action-apply');
  await expect(applyBtn).toHaveText('Mark complete');

  // 3. Apply → both stores update, Activity gets a reversible record.
  await applyBtn.click();
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => {
    const open = window.flowAssistant.listOpenWorkspaceTasks().filter((t) => !t.completed && !t.archived);
    const hwDone = (window.SutraHomeworkStore.getSnapshot().tasks || []).filter((t) => t.done).length;
    const rec = window.flowIntelligence.getActivityLog()[0];
    return {
      remainingOpen: open.length,
      hwDone,
      plannerCompleted: (window.flowAtelier.tasks || []).filter((t) => t.completed && t.origin !== 'homework').length,
      rec: rec ? { type: rec.actionType, reversible: rec.reversible, hasUndo: !!rec.undoPayload, risk: rec.risk, affected: (rec.affected || []).length } : null
    };
  });
  expect(applied.remainingOpen).toBe(0);
  expect(applied.hwDone).toBe(1);
  expect(applied.plannerCompleted).toBe(3);
  expect(applied.rec).toEqual({ type: 'update_task_status', reversible: true, hasUndo: true, risk: 'medium', affected: 4 });

  // 4. "undo that" restores every item in both stores — nothing was deleted.
  await sendChatMessage(page, 'undo that');
  await page.waitForTimeout(2400);
  const restored = await page.evaluate(() => ({
    open: window.flowAssistant.listOpenWorkspaceTasks().filter((t) => !t.completed && !t.archived).length,
    hwDone: (window.SutraHomeworkStore.getSnapshot().tasks || []).filter((t) => t.done).length,
    recStatus: window.flowIntelligence.getActivityLog()[0].status,
    totalTasksKept: (window.flowAtelier.tasks || []).filter((t) => t.origin !== 'homework').length
  }));
  expect(restored.open).toBe(4);
  expect(restored.hwDone).toBe(0);
  expect(restored.recStatus).toBe('undone');
  expect(restored.totalTasksKept).toBe(3);
});

test('quantifier references and ambiguity: "complete the first two" works, ambiguous titles ask', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  await sendChatMessage(page, "what's overdue?");
  await page.waitForTimeout(2400);
  await sendChatMessage(page, 'complete the first two');
  await page.waitForTimeout(2400);
  const card = page.locator('#chatbotMessages .flow-action-card[data-action-type="update_task_status"]').last();
  await expect(card.locator('.flow-action-label')).toContainText('Mark 2 tasks as complete');

  // Ambiguity: two same-named homework items → clarification, no action card.
  await page.evaluate(() => {
    window.flowAssistant.applyAction({ type: 'create_homework', title: 'Lab Report', courseName: 'Chemistry', dueDate: '2026-06-20' });
    window.flowAssistant.applyAction({ type: 'create_homework', title: 'Lab Report', courseName: 'Chemistry', dueDate: '2026-06-27' });
  });
  const cardsBefore = await page.locator('#chatbotMessages .flow-action-card').count();
  await sendChatMessage(page, 'complete the lab report');
  const clarify = await lastAssistantText(page);
  expect(clarify).toContain('2 items matching');
  expect(clarify).toContain('Which one');
  const cardsAfter = await page.locator('#chatbotMessages .flow-action-card').count();
  expect(cardsAfter).toBe(cardsBefore);
  // Nothing mutated.
  const mutated = await page.evaluate(() => (window.SutraHomeworkStore.getSnapshot().tasks || []).filter((t) => t.done).length);
  expect(mutated).toBe(0);
});

test('reschedule to tomorrow and archive guardrails (no deletion, homework protected)', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  await sendChatMessage(page, "what's overdue?");
  await page.waitForTimeout(2400);
  await sendChatMessage(page, 'move those to tomorrow');
  await page.waitForTimeout(2400);
  const card = page.locator('#chatbotMessages .flow-action-card[data-action-type="reschedule_tasks"]').last();
  await expect(card).toBeVisible();
  await card.locator('.flow-action-apply').click();
  await page.waitForTimeout(400);

  const tomorrow = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const all = window.flowAssistant.listOpenWorkspaceTasks().filter((t) => !t.completed);
    return { iso, movedCount: all.filter((t) => t.dueDate === iso).length, total: all.length };
  });
  expect(tomorrow.movedCount).toBe(4);

  // Archive a planner task: object preserved, flags set, never deleted.
  const archive = await page.evaluate(() => {
    const fa = window.flowAssistant;
    fa.applyAction({ type: 'create_task', title: 'Stale brainstorm task', dueDate: '2026-05-01' });
    const before = (window.flowAtelier.tasks || []).length;
    const res = fa.applyActionLogged({ type: 'update_task_status', taskTitles: ['Stale brainstorm task'], status: 'archived' });
    const after = (window.flowAtelier.tasks || []).length;
    const t = (window.flowAtelier.tasks || []).find((x) => x.title === 'Stale brainstorm task');
    return { ok: res.ok, kept: before === after, archived: t && t.archived === true && t.isActive === false };
  });
  expect(archive.ok).toBe(true);
  expect(archive.kept).toBe(true);
  expect(archive.archived).toBe(true);

  // Homework archive is rejected with an explanation — never applied.
  const hwGuard = await page.evaluate(() => window.flowAssistant.validateAction({
    type: 'update_task_status', taskTitles: ['Weekly reflection review'], status: 'archived'
  }));
  expect(hwGuard.ok).toBe(false);
  expect(String(hwGuard.error)).toContain("can't be archived");
});

test('daily briefing and recovery plan are deterministic and local (no key, no fetch)', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  let fetchCalls = 0;
  await page.route('**://api.groq.com/**', (route) => { fetchCalls += 1; route.abort(); });

  await sendChatMessage(page, 'what should I do today');
  const briefing = await lastAssistantText(page);
  expect(briefing).toContain("Today's briefing");
  expect(briefing).toContain('overdue');
  expect(briefing).toContain('Work in this order');

  await sendChatMessage(page, 'make a recovery plan');
  const recovery = await lastAssistantText(page);
  expect(recovery).toContain('Recovery plan');
  expect(recovery).toContain('catch-up order');
  expect(fetchCalls).toBe(0);
});

test('grade actions use deterministic local math and run read-only', async ({ page }) => {
  await openApp(page);
  await openAssistantPanel(page);
  await page.evaluate(() => {
    const hub = window.courseHub;
    const gp = window.SutraGradePlanner;
    const course = hub.createCourse({ name: 'Chemistry', type: 'class' });
    gp.setCategoriesForCourse(course.id, [
      { id: 'cat_hw', name: 'Homework', weight: 30 },
      { id: 'cat_test', name: 'Tests', weight: 70 }
    ]);
    gp.addEntryForCourse(course.id, { categoryId: 'cat_hw', title: 'Worksheet 1', score: 9, maxScore: 10, status: 'graded' });
    gp.addEntryForCourse(course.id, { categoryId: 'cat_test', title: 'Test 1', score: 78, maxScore: 100, status: 'graded' });
    gp.addEntryForCourse(course.id, { categoryId: 'cat_hw', title: 'Missing lab report', score: null, maxScore: 50, status: 'missing' });
  });

  await sendChatMessage(page, 'what happens if I score 85 on the next test in Chemistry?');
  await page.waitForTimeout(2600);
  const whatIf = await page.evaluate(() => {
    const results = document.querySelectorAll('#chatbotMessages .flow-action-result');
    return results.length ? results[results.length - 1].innerText.replace(/\s+/g, ' ') : '';
  });
  expect(whatIf).toContain('computed locally');
  expect(whatIf).toContain('If you score 85/100');
  expect(whatIf).toMatch(/Change: [+-]?\d+(\.\d+)? percentage points/);

  await sendChatMessage(page, 'rank missing work in Chemistry');
  await page.waitForTimeout(2600);
  const rank = await page.evaluate(() => {
    const results = document.querySelectorAll('#chatbotMessages .flow-action-result');
    return results.length ? results[results.length - 1].innerText.replace(/\s+/g, ' ') : '';
  });
  expect(rank).toContain('Missing lab report');
  expect(rank).toMatch(/\+\d+(\.\d+)? pts/);

  // Read-only: nothing was mutated, no approval button rendered for these.
  const mutation = await page.evaluate(() => ({
    gradeEntries: Object.values(window.SutraGradePlanner.getPlanner().courses)[0].entries.length,
    applyButtons: document.querySelectorAll('.flow-action-card[data-risk="read_only"] .flow-action-apply').length
  }));
  expect(mutation.gradeEntries).toBe(3);
  expect(mutation.applyButtons).toBe(0);
});

test('redesigned panel: WORKING FROM card, onboarding card without key, pulse from real signals, overflow menu', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  const ui = await page.evaluate(() => {
    const es = document.getElementById('chatEmptyState');
    return {
      workingFrom: !!es.querySelector('.flow-workingfrom'),
      workingFromLabel: (es.querySelector('.flow-workingfrom-label') || {}).textContent || '',
      signals: (es.querySelector('.flow-workingfrom-signals') || {}).textContent || '',
      onboarding: !!es.querySelector('.flow-onboarding'),
      providerIds: Array.from(es.querySelectorAll('.flow-onboarding-provider'))
        .map(button => button.getAttribute('data-flow-connect')),
      registeredProviderIds: window.SutraProviderMeta.list().map(provider => provider.id),
      pulse: !!es.querySelector('.flow-pulse'),
      pulseText: (es.querySelector('.flow-pulse') || {}).innerText || '',
      subtitle: document.getElementById('chatbotSubtitle').textContent,
      launcherHidden: document.getElementById('chatbotBtn').style.display === 'none'
    };
  });
  expect(ui.workingFrom).toBe(true);
  expect(ui.workingFromLabel).toBe('WORKING FROM');
  expect(ui.signals).toContain('Workspace signals enabled');
  // No key configured → onboarding stays aligned with the central provider
  // registry as implemented providers are added or removed.
  expect(ui.onboarding).toBe(true);
  expect(ui.providerIds).toEqual(ui.registeredProviderIds);
  expect(ui.providerIds).toEqual(expect.arrayContaining([
    'groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'local'
  ]));
  // Pulse shows the REAL overdue signal (4 seeded), not demo data.
  expect(ui.pulse).toBe(true);
  expect(ui.pulseText).toContain('4 overdue assignments');
  expect(ui.subtitle).toContain('·');
  expect(ui.launcherHidden).toBe(true);

  // "Continue without AI" swaps onboarding for the quick-action grid.
  await page.evaluate(() => document.querySelector('[data-flow-skip-ai]').click());
  const afterSkip = await page.evaluate(() => {
    const es = document.getElementById('chatEmptyState');
    return {
      grid: !!es.querySelector('.flow-qa-grid'),
      gridCards: es.querySelectorAll('.flow-qa-card').length,
      heading: (es.querySelector('.flow-qa-heading') || {}).textContent || ''
    };
  });
  expect(afterSkip.grid).toBe(true);
  expect(afterSkip.gridCards).toBe(4);
  expect(afterSkip.heading).toBe('What would you like to do?');

  // Overflow menu opens, contains relocated controls, closes on outside click.
  await page.evaluate(() => document.getElementById('chatOverflowBtn').click());
  await expect(page.locator('#chatOverflowMenu')).toBeVisible();
  for (const id of ['chatHistoryBtn', 'chatFullBtn', 'chatMenuActivity', 'chatMenuContext', 'chatGuideBtn', 'chatInfoBtn']) {
    await expect(page.locator(`#chatOverflowMenu #${id}`)).toBeAttached();
  }
  await page.evaluate(() => document.body.click());
  await expect(page.locator('#chatOverflowMenu')).toBeHidden();

  // Composer: send disabled when empty, enabled when filled.
  const composer = await page.evaluate(() => {
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSendBtn');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    const disabledEmpty = send.disabled;
    input.value = 'hi'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const enabledFilled = !send.disabled;
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    return { disabledEmpty, enabledFilled, attach: !!document.getElementById('chatAttachBtn') };
  });
  expect(composer.disabledEmpty).toBe(true);
  expect(composer.enabledFilled).toBe(true);
  expect(composer.attach).toBe(true);
});

test('context editor shows a truthful readable summary and raw payload', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);
  await page.evaluate(() => window.flowAssistant.showContextModal());
  const modal = page.locator('#flowContextOverlay');
  await expect(modal).toBeVisible();
  const summary = await modal.locator('#flowCtxSummary').textContent();
  expect(summary).toContain('Sutra will send');
  expect(summary).toContain('No Course Hub file contents');
  expect(summary).toContain('API key is never part of the message');
  await expect(modal.locator('.flow-ctx-raw summary')).toContainText('Raw payload');
  // Memory + depth controls present with the spec'd options.
  const depths = await modal.locator('#flowCtxMemoryDepth option').allTextContents();
  expect(depths.join(',')).toContain('3 messages');
  expect(depths.join(',')).toContain('25 messages');
  await page.evaluate(() => document.getElementById('flowCtxClose').click());
});

test('persistence: completed status survives reload; exports never contain API keys', async ({ page }) => {
  await openApp(page);
  await seedOverdueWork(page);
  await openAssistantPanel(page);

  await page.evaluate(() => {
    // Simulate a saved session key, then complete one task and persist.
    sessionStorage.setItem('groq_api_key', 'gsk_FAKE_TEST_KEY_000000000000');
    window.flowAssistant.applyActionLogged({ type: 'update_task_status', taskTitles: ['Run final-day checklist'], status: 'completed' });
  });
  await page.waitForTimeout(900); // allow debounced autosave to commit

  const exportCheck = await page.evaluate(() => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const raw = JSON.stringify(payload);
    return {
      containsKey: raw.includes('gsk_FAKE_TEST_KEY'),
      containsKeyName: raw.includes('groq_api_key') && raw.includes('gsk_'),
      activityIncluded: !!(payload.localStorageSnapshot && payload.localStorageSnapshot['sutra:activityLog:v1'])
        || raw.includes('update_task_status')
    };
  });
  expect(exportCheck.containsKey).toBe(false);

  await page.reload();
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.flowAssistant && !!window.flowAtelier);
  const afterReload = await page.evaluate(() => {
    const t = (window.flowAtelier.tasks || []).find((x) => x.title === 'Run final-day checklist');
    const rec = window.flowIntelligence.getActivityLog().find((r) => r.actionType === 'update_task_status');
    return { completed: !!(t && t.completed), activityKept: !!rec, undoKept: !!(rec && rec.undoPayload) };
  });
  expect(afterReload.completed).toBe(true);
  expect(afterReload.activityKept).toBe(true);
  expect(afterReload.undoKept).toBe(true);
});
