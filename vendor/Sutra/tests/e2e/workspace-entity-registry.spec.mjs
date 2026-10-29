import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  await page.waitForFunction(() =>
    !!window.flowAtelier
    && !!window.SutraWorkspaceEntityRegistry
    && window.SutraWorkspaceEntityRegistry.listAdapters().length >= 20
  );
}

test('canonical workspace entity registry installs against the live core bridge', async ({ page }) => {
  await openApp(page);

  const state = await page.evaluate(() => {
    const registry = window.SutraWorkspaceEntityRegistry;
    const portable = window.serializeWorkspace({ mode: 'sync', includeSensitiveSettings: false });
    return {
      version: registry.version,
      adapterIds: registry.listAdapters().map((adapter) => adapter.id),
      portableHasEntityIndex: Object.keys(portable).some((key) => /entity.*index|search.*index/i.test(key)),
      entitiesAreFrozen: registry.collect().every((entity) => Object.isFrozen(entity))
    };
  });

  expect(state.version).toBe(1);
  expect(state.adapterIds).toEqual(expect.arrayContaining([
    'note',
    'task',
    'homework',
    'assignment_milestone',
    'course',
    'course_file',
    'timeline_block',
    'review_deck',
    'review_card',
    'academic_record',
    'study_record',
    'testing_exam',
    'grade_record',
    'college_record',
    'life_record',
    'business_record',
    'custom_tab',
    'assistant_conversation',
    'private_document'
  ]));
  expect(state.portableHasEntityIndex).toBe(false);
  expect(state.entitiesAreFrozen).toBe(true);
});

test('established feature events invalidate the registry without storing a derived index', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(async () => {
    const registry = window.SutraWorkspaceEntityRegistry;
    const events = [];
    const unsubscribe = registry.subscribe((event) => events.push(event));
    const before = registry.getRevision();
    window.dispatchEvent(new CustomEvent('homework:updated'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    return {
      before,
      after: registry.getRevision(),
      reasons: events.map((event) => event.reason),
      workspaceHasDerivedIndex: Object.keys(window.serializeWorkspace({ mode: 'sync', includeSensitiveSettings: false }))
        .some((key) => /index/i.test(key))
    };
  });

  expect(result.after).toBeGreaterThan(result.before);
  expect(result.reasons).toContain('homework:updated');
  expect(result.workspaceHasDerivedIndex).toBe(false);
});
