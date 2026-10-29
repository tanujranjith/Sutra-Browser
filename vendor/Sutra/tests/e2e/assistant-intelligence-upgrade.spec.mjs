// Sutra Intelligence upgrade — Product Knowledge, Assistant Memory, Local Help,
// and the Local Intent Router. Verifies the no-API-key, local-first behaviors in
// a real browser: no provider is configured in any of these tests, so anything
// that works proves it runs entirely on-device.
import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; }
    document.body.classList.remove('onboarding-open');
  });
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() =>
    window.SutraProductKnowledge && window.SutraAssistantMemory &&
    window.SutraLocalHelp && window.SutraCapabilityRegistry && window.flowAssistant);
  // The Assistant Pack is opt-in for fresh student workspaces (assistant.enabled
  // defaults OFF), so the chat panel/launcher stays hidden until enabled. Turn it
  // on here exactly like a user flipping the Settings ▸ Assistant toggle.
  await page.evaluate(() => { window.setWorkspacePreference('assistant.enabled', true); });
}

test('the Intelligence Harness globals load with no provider configured', async ({ page }) => {
  await openApp(page);
  const present = await page.evaluate(() => ({
    pk: !!window.SutraProductKnowledge,
    mem: !!window.SutraAssistantMemory,
    help: !!window.SutraLocalHelp,
    cap: !!window.SutraCapabilityRegistry
  }));
  expect(present).toEqual({ pk: true, mem: true, help: true, cap: true });
});

test('Product Knowledge answers product questions locally', async ({ page }) => {
  await openApp(page);
  const ids = await page.evaluate(() => {
    const qs = ['what is sutra', 'how do i make flashcards', 'does sutra send my data to a server'];
    return qs.map(q => { const a = window.SutraProductKnowledge.answer(q); return a ? a.entry.id : null; });
  });
  expect(ids).toEqual(['what-is-sutra', 'review-flashcards', 'privacy-local-first']);
});

test('the intent router answers product questions locally (handled, no provider)', async ({ page }) => {
  await openApp(page);
  // Local product-knowledge routing sits behind the assistant.localRouting
  // toggle, which defaults OFF (AI-only).
  await page.evaluate(() => { window.setWorkspacePreference('assistant.localRouting', true); });
  const res = await page.evaluate(() => window.flowAssistant.tryHandleCommand('how do I make flashcards?'));
  // Rendered as a rich Local Help card → handled + silent.
  expect(res.handled).toBe(true);
  expect(res.silent).toBe(true);
  expect(res.source).toBe('local');
});

test('Local Help opens an accessible, badged card with choices', async ({ page }) => {
  await openApp(page);
  const opened = await page.evaluate(() => {
    // Ensure a messages host exists; open the sidebar assistant panel.
    if (typeof window.toggleChat === 'function') { try { window.toggleChat(); } catch {} }
    return window.SutraLocalHelp.open('root');
  });
  expect(opened).toBe(true);
  const card = page.locator('.sutra-help-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.sutra-help-badge').first()).toContainText('Answered locally');
  // Multiple-choice buttons exist and clicking one navigates to a follow-up node.
  const choices = card.locator('.sutra-help-choice');
  expect(await choices.count()).toBeGreaterThan(5);
  await card.getByRole('button', { name: 'What is Sutra?' }).click();
  await expect(page.locator('.sutra-help-card').first()).toContainText('local-first');
});

test('Local Help never calls a provider (offline) — no network requests', async ({ page }) => {
  await openApp(page);
  const apiHits = [];
  await page.route('**://api.*/**', route => { apiHits.push(route.request().url()); route.abort(); });
  await page.route('**://*.openai.com/**', route => { apiHits.push(route.request().url()); route.abort(); });
  await page.evaluate(() => {
    if (typeof window.toggleChat === 'function') { try { window.toggleChat(); } catch {} }
    window.SutraLocalHelp.open('flashcards');
  });
  await page.locator('.sutra-help-card').first().waitFor();
  expect(apiHits).toEqual([]);
});

test('Assistant Memory: explicit create, retrieve, and undo (local store)', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const M = window.SutraAssistantMemory;
    M.__resetForTests && M.__resetForTests();
    // Use the real store this session by clearing any prior key.
    const c = M.create({ category: 'study_preferences', content: 'I study best in the early morning' });
    const hit = M.retrieve('when should I study')[0];
    const undo = M.applyUndo(c.undo);
    return { created: c.ok, retrieved: hit ? hit.record.id === c.record.id : false, undone: undo === 1, gone: !M.get(c.record.id) };
  });
  expect(result).toEqual({ created: true, retrieved: true, undone: true, gone: true });
});

test('Assistant Memory blocks sensitive content', async ({ page }) => {
  await openApp(page);
  const blocked = await page.evaluate(() => {
    const r = window.SutraAssistantMemory.create({ content: 'my password is hunter2' });
    return { ok: r.ok, blocked: r.blocked };
  });
  expect(blocked).toEqual({ ok: false, blocked: true });
});

test('the intent router saves and reports memory locally', async ({ page }) => {
  await openApp(page);
  const flow = await page.evaluate(() => {
    const save = window.flowAssistant.tryHandleCommand('remember that I have band practice on Mondays');
    const recall = window.flowAssistant.tryHandleCommand('what do you remember about me');
    return { saveHandled: save.handled, saveSource: save.source, recall: recall.message };
  });
  expect(flow.saveHandled).toBe(true);
  expect(flow.saveSource).toBe('memory');
  expect(flow.recall).toContain('band practice');
});

test('"can you remember that…" is saved locally (not just claimed by a model)', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    window.SutraAssistantMemory.__resetForTests && window.SutraAssistantMemory.__resetForTests();
    const before = window.SutraAssistantMemory.getAll().length;
    const res = window.flowAssistant.tryHandleCommand('can you remember that i have a fitbit delivery for 2 days');
    const after = window.SutraAssistantMemory.getAll();
    return { handled: res.handled, source: res.source, added: after.length - before, content: after[0] && after[0].content, expires: !!(after[0] && after[0].expiresAt) };
  });
  expect(result.handled).toBe(true);
  expect(result.source).toBe('memory');
  expect(result.added).toBe(1);                    // a real memory was created
  expect(result.content).toContain('fitbit delivery');
  expect(result.expires).toBe(true);               // "for 2 days" → temporary expiry
});

test('"remember to <task>" is NOT saved as a memory', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() =>
    window.flowAssistant.tryHandleCommand('can you remember to call my mom'));
  // Not a memory fact → router returns unhandled so it can go elsewhere.
  expect(res.handled).toBe(false);
});

test('assistant.useMemory defaults to ON', async ({ page }) => {
  await openApp(page);
  const val = await page.evaluate(() => window.getWorkspacePreference('assistant.useMemory', 'MISSING'));
  expect(val).toBe(true);
});

// The local "forget this memory?" card builds a delete_memory action carrying a
// display-only `label`. delete_memory is a strict-validated action, so the label
// must be tolerated (and stripped) or Apply silently fails without deleting.
test('a forget-memory card (delete_memory with a label field) actually deletes', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const mem = window.SutraAssistantMemory;
    if (mem.__resetForTests) mem.__resetForTests();
    mem.create({ category: 'user_notes', content: 'fact to forget', source: 'user_explicit' });
    const id = mem.getAll()[0].id;
    const res = window.flowAssistant.applyAction({ type: 'delete_memory', id, label: 'Forget: fact to forget' });
    return { ok: res.ok, remaining: mem.getAll().length };
  });
  expect(out.ok).toBe(true);
  expect(out.remaining).toBe(0);
});

test('Memory manager supports adding and removing individual details', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const M = window.SutraAssistantMemory;
    M.__resetForTests && M.__resetForTests();
    M.create({ category: 'study_preferences', content: 'I study best in the morning' });
    M.openManager();
  });
  const modal = page.locator('.sutra-memory-modal');
  await modal.getByRole('button', { name: 'Edit' }).first().click();
  // Add a detail.
  await modal.locator('.sutra-mem-detail-add input').fill('I prefer 2-hour blocks');
  await modal.locator('.sutra-mem-detail-add button', { hasText: 'Add' }).click();
  await expect(modal.locator('.sutra-mem-detail-row')).toHaveCount(2);
  // Remove the first detail.
  await modal.locator('.sutra-mem-detail-x').first().click();
  await expect(modal.locator('.sutra-mem-detail-row')).toHaveCount(1);
});

test('Memory manager opens from Assistant settings and lists memories', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.SutraAssistantMemory.create({ category: 'academic_goals', content: 'Aim for a 4.0 GPA this year' });
    window.SutraAssistantMemory.openManager();
  });
  const modal = page.locator('.sutra-memory-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('4.0 GPA');
  // Closeable via a discoverable control.
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toHaveCount(0);
});

test('a model reply that only CLAIMS to schedule becomes a real proposal', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const claim = "I'll add the Fitbit delivery as a general event to your timeline for July 1st. Since you didn't specify a time, I'll set it for 10:00 AM.";
    const res = window.flowAssistant.parseActions(claim);
    const plain = window.flowAssistant.parseActions('Photosynthesis converts light into chemical energy.');
    return {
      inferred: !!res.inferred,
      type: res.actions[0] && res.actions[0].type,
      name: res.actions[0] && res.actions[0].name,
      date: res.actions[0] && res.actions[0].date,
      start: res.actions[0] && res.actions[0].start,
      plainCount: plain.actions.length
    };
  });
  expect(out.inferred).toBe(true);
  expect(out.type).toBe('create_timeline_block');
  expect(out.name).toContain('Fitbit delivery');
  expect(out.date).toBe('2026-07-01');
  expect(out.start).toBe('10:00');
  expect(out.plainCount).toBe(0);                 // plain chat is never turned into an action
});

test('an inferred timeline proposal applies to a real, valid block', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const claim = "I'll add the Fitbit delivery to your timeline for July 1st at 10:00 AM.";
    const action = window.flowAssistant.parseActions(claim).actions[0];
    const valid = window.flowAssistant.validateAction(action);
    return { valid: valid.ok };
  });
  expect(res.valid).toBe(true);
});

test('the chat list is resizable and the width persists', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.flowAssistant.applyAction({ type: 'navigate', view: 'assistantview' }));
  await page.waitForSelector('#asstSidebarResizer', { state: 'visible' });
  const widthOf = () => page.evaluate(() => parseInt(getComputedStyle(document.getElementById('asstSidebar')).width, 10));
  const before = await widthOf();
  const handle = page.locator('#asstSidebarResizer');
  await handle.focus();
  for (let i = 0; i < 5; i++) await handle.press('ArrowRight');
  const after = await widthOf();
  expect(after).toBeGreaterThan(before);
  const saved = await page.evaluate(() => window.SutraSafeStorage.get('sutra:assistantSidebarWidth:v1', null));
  expect(Number(saved)).toBeGreaterThanOrEqual(after - 2);
});

test('Capability Registry exposes domain + scope metadata for actions', async ({ page }) => {
  await openApp(page);
  const meta = await page.evaluate(() => {
    const def = window.SutraAssistantActions.getActionDefinition('delete_memory');
    const nav = window.SutraAssistantActions.getActionDefinition('navigate');
    return {
      memDomain: def.domain, memDestructive: def.destructive, memReversible: def.reversible,
      navScope: nav.requiredScope
    };
  });
  expect(meta.memDomain).toBe('memory');
  expect(meta.memDestructive).toBe(true);
  expect(meta.memReversible).toBe(true);
  expect(meta.navScope).toBe('none');
});
