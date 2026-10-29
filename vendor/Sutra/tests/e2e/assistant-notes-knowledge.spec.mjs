import { expect, test } from '@playwright/test';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.flowAssistant && !!window.SutraAssistantActions);
}

test('grounded local note search shares sources across dock and full view and supports exclusions', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#view-notes .view-flow-row')).toHaveCount(0);
  await page.evaluate(() => {
    const note = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace(
      'Heliotrope research',
      '<h2>Protocol</h2><p>The heliotrope protocol uses violet index cards every Thursday.</p>'
    );
    window.flowAtelier.loadPage(note.id);
  });

  await page.locator('#chatbotBtn').click();
  await expect(page.locator('#chatbotPanel')).toBeVisible();
  await page.locator('#chatInput').fill('search my notes for heliotrope protocol');
  await page.locator('#chatSendBtn').click();
  const dockSources = page.locator('#chatbotPanel .assistant-sources');
  await expect(dockSources).toBeVisible();
  await expect(dockSources).toContainText('Heliotrope research');

  await page.evaluate(() => window.setActiveView('assistantview'));
  await expect(page.locator('#view-assistantview')).toBeVisible();
  const fullSources = page.locator('#asstMessages .assistant-sources');
  await expect(fullSources).toBeVisible();
  await expect(fullSources).toContainText('Heliotrope research');

  await page.evaluate(() => {
    const panel = document.getElementById('chatbotPanel');
    if (panel && panel.getAttribute('aria-hidden') === 'false') window.toggleChat();
  });
  await fullSources.locator('summary').click();
  await fullSources.locator('.assistant-source-exclude').click();
  const exclusion = await page.evaluate(() => window.SutraAssistantConversationController.getCurrent().scope.excludedSourceIds || []);
  expect(exclusion.length).toBe(1);

  await page.evaluate(() => window.flowAssistant.openProviderSetupWizard('openai'));
  await expect(page.locator('.assistant-provider-wizard')).toBeVisible();
  await expect(page.locator('.assistant-provider-wizard')).toContainText('Session-only API key');
  await expect(page.locator('.assistant-provider-remember')).toHaveCount(0);
});

test('structural note operations are logged, preserve sources, and undo cleanly', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const target = hooks.createNoteInActiveSpace('Merge target', '<p>Target opening.</p>');
    const source = hooks.createNoteInActiveSpace('Merge source', '<p>Source evidence.</p>');
    const originalTarget = target.content;

    const merged = window.flowAssistant.applyActionLogged({
      type: 'merge_notes',
      targetNoteId: target.id,
      sourceNoteIds: [source.id]
    }, { userPrompt: 'merge these notes' });
    const mergeState = {
      ok: merged.ok,
      activityId: merged.activityId,
      targetContainsSource: window.flowAtelier.getPageById(target.id).content.includes('Source evidence.'),
      sourceStillExists: !!window.flowAtelier.getPageById(source.id)
    };
    const mergeUndo = window.flowAssistant.undoActivity(merged.activityId);
    mergeState.undoOk = mergeUndo.ok;
    mergeState.targetRestored = window.flowAtelier.getPageById(target.id).content === originalTarget;
    mergeState.sourceAfterUndo = !!window.flowAtelier.getPageById(source.id);

    const tagged = window.flowAssistant.applyActionLogged({
      type: 'apply_note_tags', noteId: target.id, tags: ['research', 'review'], mode: 'add'
    }, { userPrompt: 'tag this note' });
    const tagNames = window.flowAtelier.getPageById(target.id).tags.map(tag => tag.name || tag);
    const tagUndo = window.flowAssistant.undoActivity(tagged.activityId);
    const tagsAfterUndo = window.flowAtelier.getPageById(target.id).tags.map(tag => tag.name || tag);

    const splitSource = hooks.createNoteInActiveSpace('Split source', '<p>Keep this.</p><p>Move this exact section.</p>');
    const before = '<p>Move this exact section.</p>';
    const start = splitSource.content.indexOf(before);
    const split = window.flowAssistant.applyActionLogged({
      type: 'split_note',
      noteId: splitSource.id,
      hunks: [{ id: 'move-section', start, end: start + before.length, before, replacement: '', label: 'Move section' }],
      newTitle: 'Split result',
      newBody: 'Move this exact section.'
    }, { userPrompt: 'split this note' });
    const created = window.flowAtelier.pages.find(note => note.title === 'Split result');
    const splitState = {
      ok: split.ok,
      sourceChanged: !window.flowAtelier.getPageById(splitSource.id).content.includes('Move this exact section.'),
      created: !!created
    };
    const splitUndo = window.flowAssistant.undoActivity(split.activityId);
    splitState.undoOk = splitUndo.ok;
    splitState.sourceRestored = window.flowAtelier.getPageById(splitSource.id).content.includes('Move this exact section.');
    splitState.createdRemoved = !window.flowAtelier.pages.some(note => note.title === 'Split result');

    return {
      mergeState,
      tags: { ok: tagged.ok, tagNames, undoOk: tagUndo.ok, tagsAfterUndo },
      splitState,
      definitions: ['split_note', 'merge_notes', 'move_note_blocks', 'rename_note_heading', 'apply_note_tags', 'create_note_backlink', 'deduplicate_note', 'convert_selection_to_fields']
        .every(type => !!window.SutraAssistantActions.getActionDefinition(type))
    };
  });

  expect(result.mergeState).toMatchObject({ ok: true, targetContainsSource: true, sourceStillExists: true, undoOk: true, targetRestored: true, sourceAfterUndo: true });
  expect(result.tags.ok).toBe(true);
  expect(result.tags.tagNames).toEqual(expect.arrayContaining(['research', 'review']));
  expect(result.tags.undoOk).toBe(true);
  expect(result.tags.tagsAfterUndo).toEqual([]);
  expect(result.splitState).toEqual({ ok: true, sourceChanged: true, created: true, undoOk: true, sourceRestored: true, createdRemoved: true });
  expect(result.definitions).toBe(true);
});

test('both assistant shells remain labeled, focusable, and viewport-safe on a reduced-motion phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);

  // The dedicated mobile Home shell intentionally hides floating controls.
  // Exercise the dock from a normal workspace surface where it is available.
  await page.evaluate(() => window.setActiveView('notes'));
  await expect(page.locator('#view-notes')).toBeVisible();
  const launcher = page.locator('#chatbotBtn');
  await expect(launcher).toHaveAttribute('aria-label', /Open Sutra Assistant/i);
  await expect(launcher).toBeVisible();
  await launcher.click();
  const panel = page.locator('#chatbotPanel');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
  await page.locator('#chatInput').focus();
  await expect(page.locator('#chatInput')).toBeFocused();
  await expect(page.locator('#chatSendBtn')).toHaveAttribute('aria-label', /Send message/i);

  await page.evaluate(() => {
    window.setActiveView('assistantview');
    const dock = document.getElementById('chatbotPanel');
    if (dock && dock.getAttribute('aria-hidden') === 'false') window.toggleChat();
  });
  await expect(page.locator('#view-assistantview')).toBeVisible();
  const composer = page.locator('#asstInput');
  await composer.focus();
  await expect(composer).toBeFocused();
  await expect(page.locator('#asstSendBtn')).toHaveAttribute('aria-label', /Send message/i);
  const mainBox = await page.locator('#asstMainPanel').boundingBox();
  expect(mainBox.x).toBeGreaterThanOrEqual(0);
  expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(390);
});

test('provider setup discovers models while API keys remain session-only and stay out of exports', async ({ page }) => {
  await page.route('http://127.0.0.1:11434/v1/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'local-test-model' }] })
  }));
  await page.route('https://api.openai.com/v1/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'gpt-test-model' }] })
  }));
  await openApp(page);

  const result = await page.evaluate(async () => {
    const meta = window.SutraProviderMeta;
    window.setWorkspacePreference('assistant.localEndpoint', { baseUrl: 'http://127.0.0.1:11434/v1', model: '' });
    meta.saveSessionKey('openai', 'sk-test-provider-secret-123456789');
    const remote = await meta.discoverModels('openai');
    const local = await meta.discoverModels('local');
    const sessionHasKey = meta.hasKey('openai');
    const persistedKey = localStorage.getItem('openai_api_key') || '';
    const exported = JSON.stringify(window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }));
    sessionStorage.removeItem('openai_api_key');
    return {
      remote,
      local,
      sessionHasKey,
      persistedKey,
      clearedHasKey: meta.hasKey('openai'),
      exportLeaksKey: exported.includes('sk-test-provider-secret')
    };
  });

  expect(result).toEqual({
    remote: ['gpt-test-model'],
    local: ['local-test-model'],
    sessionHasKey: true, persistedKey: '', clearedHasKey: false,
    exportLeaksKey: false
  });
});
