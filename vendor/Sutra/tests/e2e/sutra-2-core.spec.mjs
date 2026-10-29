import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.serializeWorkspace
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  // Public globals are registered before IndexedDB hydration completes. Cross
  // the durable-save seam before reading or mutating portable workspace state.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('sutra-2-core-ready'));
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
  });
}

test('Sutra 2.0 student OS ranks, plans, records mastery, and round-trips its schema', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const now = new Date();
    const due = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
    await window.deserializeWorkspace({
      ...base,
      version: 5,
      pages: base.pages || [],
      tasks: [
        { id: 'sutra2-task', title: 'Finish the lab report', dueAt: due, priority: 'high', estimatedMinutes: 60, gradeImpact: 0.9, status: 'todo' }
      ],
      // Legacy workspaces may still contain the removed profile. Import must
      // retain it in unknownWorkspaceFields rather than revive the feature.
      energyProfile: { version: 1, enabled: true, currentEnergy: 'medium', windows: [] },
      taskOrder: ['sutra2-task'],
      taskDependencies: [],
      studentDecisionState: { version: 1, preset: 'balanced', snoozed: {}, dismissed: [], pinned: [] },
      masteryRecords: [],
      confidenceObservations: []
    });
    const next = window.SutraStudentOS.recommendNext({ now: now.toISOString() });
    const presetReceipt = window.SutraStudentOS.setPreset('grade_recovery');
    const proposal = window.SutraStudentOS.proposeSchedule({ startAt: now.toISOString(), days: 2 });
    let reviewBlocked = false;
    try { window.SutraStudentOS.applyScheduleProposal(proposal); } catch (error) { reviewBlocked = /reviewed/i.test(error.message); }
    const scheduleReceipt = window.SutraStudentOS.applyScheduleProposal(proposal, { reviewed: true });
    const masteryReceipt = window.SutraStudentOS.recordMastery({ id: 'obs-1', key: 'chem:stoichiometry', correct: true, confidence: 0.8, sourceId: 'sutra2-task' });
    await window.saveWorkspaceLocally();
    const exported = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return { next, presetReceipt, proposal, reviewBlocked, scheduleReceipt, masteryReceipt, exported };
  });

  expect(result.next.sourceId).toBe('sutra2-task');
  expect(result.next.rankReason).toMatch(/due|grade/i);
  expect(result.presetReceipt.changedIds).toContain('studentDecisionState');
  expect(result.proposal.reviewed).toBe(false);
  expect(result.reviewBlocked).toBe(true);
  expect(result.scheduleReceipt.changedIds.length).toBeGreaterThan(0);
  expect(result.masteryReceipt.changedIds).toContain('chem:stoichiometry');
  expect(result.exported.studentDecisionState.preset).toBe('grade_recovery');
  expect(result.exported.masteryRecords).toHaveLength(1);
  expect(result.exported.taskDependencies).toEqual([]);
  expect(result.exported.unknownWorkspaceFields.energyProfile.currentEnergy).toBe('medium');

  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => !!window.serializeWorkspace
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('sutra-2-core-reload-ready'));
  const persisted = await page.evaluate(() => window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }));
  expect(persisted.studentDecisionState.preset).toBe('grade_recovery');
  expect(persisted.masteryRecords).toHaveLength(1);
});
