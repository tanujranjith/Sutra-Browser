// Sutra Intelligence harness + Generate Study Materials (Experimental).
// All provider traffic is mocked with deterministic route handlers — no live
// AI calls. Covers: the model-capability registry, attachment compatibility
// gating (no silent drops / no silent model switches / no uploads before an
// explicit send), structured-output validation, XSS-inert rendering of
// generated content, cancellation, persistence + export round-trips, and the
// GUI-audit editor/theme regressions fixed in the same pass.
import { expect, test } from '@playwright/test';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });

const STRUCTURED_OK = {
  studyGuide: {
    title: 'Photosynthesis Study Guide',
    summary: 'How plants convert light into chemical energy.',
    sections: [
      { id: 'sec_1', heading: 'Light Reactions', content: 'Occur in thylakoids.', keyPoints: ['Thylakoid membrane'], sourcePages: [2] },
      { id: 'sec_2', heading: 'Calvin Cycle', content: 'Occurs in stroma.', keyPoints: ['Carbon fixation'], sourcePages: [4] }
    ],
    keyTerms: [{ term: 'Chlorophyll', definition: 'Green pigment absorbing light.', sourcePages: [1] }],
    importantConcepts: ['Energy conversion'],
    likelyExamTopics: ['Light vs dark reactions']
  },
  practiceTest: {
    title: 'Photosynthesis Practice Test',
    questions: [
      { id: 'q_1', type: 'multiple-choice', prompt: 'Where do light reactions occur?', choices: ['Thylakoid', 'Stroma', 'Nucleus', 'Mitochondria'], correctAnswer: 'Thylakoid', explanation: 'Thylakoid membrane hosts the light reactions.', difficulty: 'easy', sourcePages: [2] },
      { id: 'q_2', type: 'true-false', prompt: 'The Calvin cycle requires light directly.', choices: [], correctAnswer: 'false', explanation: 'It uses ATP/NADPH made by the light reactions.', difficulty: 'medium', sourcePages: [4] },
      { id: 'q_3', type: 'short-answer', prompt: 'Name the green pigment.', choices: [], correctAnswer: 'Chlorophyll', explanation: 'Chlorophyll absorbs red/blue light.', difficulty: 'easy', sourcePages: [1] }
    ]
  }
};

async function openApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    document.body.classList.remove('onboarding-open');
  });
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => window.SutraModelCapabilities
    && window.SutraStudyMaterials
    && window.SutraIntelligence
    && window.flowAssistant
    && window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  // Public globals are registered before IndexedDB hydration completes. Cross
  // the durable-save seam before reading or mutating portable workspace state.
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('intelligence-harness-ready'));
}

// Configure a provider + model and skip the (already-covered) consent modal.
// The provider-change handler repopulates the model fields asynchronously, so
// the custom model must be set AFTER that settles (and verified).
async function armProvider(page, provider, model) {
  await page.evaluate((p) => {
    sessionStorage.setItem(`${p}_api_key`, 'mock-key-for-tests');
    localStorage.setItem('sutra_ai_send_ack_v1', '1');
    const sel = document.getElementById('chatProviderSelect');
    if (sel) { sel.value = p; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, provider);
  await page.waitForTimeout(300);
  await page.evaluate((m) => {
    const custom = document.getElementById('chatCustomModelInput');
    if (custom) { custom.value = m; custom.dispatchEvent(new Event('input', { bubbles: true })); }
  }, model);
  await expect.poll(() => page.evaluate(() => window.SutraIntelligence.getActiveProviderModel().model)).toBe(model);
}

function mockAnthropic(page, payloadText, { delayMs = 0, status = 200, counter } = {}) {
  return page.route('https://api.anthropic.com/**', async route => {
    if (counter) counter.count += 1;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: payloadText }] })
    });
  });
}

const PDF_SOURCE = {
  kind: 'attachment',
  attachment: { name: 'photosynthesis.pdf', mediaType: 'application/pdf', sizeBytes: 14, category: 'pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQgZmFrZQ==', extractedText: '' }
};
const GEN_SETTINGS = { makeGuide: true, makeTest: true, makeFlashcards: false, guideDepth: 'standard', questionCount: 3, difficulty: 'mixed', questionTypes: 'mixed', revealMode: 'after-submit' };

test('capability registry reports honest, conservative modality support', async ({ page }) => {
  await openApp(page);
  const plans = await page.evaluate(() => {
    const reg = window.SutraModelCapabilities;
    const probe = (p, m, f) => reg.determineAttachmentProcessingPlan(p, m, f);
    const pdf = { name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };
    return {
      pdfOnGroq: probe('groq', 'llama-3.3-70b-versatile', pdf).plan,
      pdfOnClaude: probe('anthropic', 'claude-sonnet-4-20250514', pdf).plan,
      pdfOnGemini: probe('gemini', 'gemini-2.0-flash', pdf).plan,
      pdfOnOpenAi: probe('openai', 'gpt-4o', pdf).plan,
      pdfUnknownModel: probe('anthropic', '', pdf).plan,
      imageOnTextOnly: probe('groq', 'llama-guard', { name: 'i.png', mimeType: 'image/png', sizeBytes: 10 }).plan,
      txt: probe('groq', 'llama-3.3-70b-versatile', { name: 'n.txt', mimeType: 'text/plain', sizeBytes: 10 }).plan,
      zip: probe('anthropic', 'claude-sonnet-4', { name: 'z.zip', mimeType: 'application/zip', sizeBytes: 10 }).plan,
      exe: probe('anthropic', 'claude-sonnet-4', { name: 's.exe', mimeType: '', sizeBytes: 10 }).plan,
      macroDoc: probe('anthropic', 'claude-sonnet-4', { name: 'm.docm', mimeType: '', sizeBytes: 10 }).plan,
      mimeSpoofedZip: probe('anthropic', 'claude-sonnet-4', { name: 'sneaky.zip', mimeType: 'application/pdf', sizeBytes: 10 }).plan,
      tooBig: probe('groq', 'llama-3.3-70b-versatile', { name: 'big.png', mimeType: 'image/png', sizeBytes: 999999999 }).plan,
      deepseek: reg.resolveModelCapabilities('deepseek', 'deepseek-chat'),
      xai: reg.resolveModelCapabilities('xai', 'grok-4'),
      perplexity: reg.resolveModelCapabilities('perplexity', 'sonar'),
      unknownGptLike: reg.resolveModelCapabilities('unconfigured-provider', 'gpt-4o')
    };
  });
  expect(plans.pdfOnGroq).toBe('unsupported-model');
  expect(plans.pdfOnClaude).toBe('native-pdf');
  expect(plans.pdfOnGemini).toBe('native-pdf');
  // OpenAI chat-completions adapter cannot submit PDFs — must NOT claim it.
  expect(plans.pdfOnOpenAi).toBe('unsupported-model');
  expect(plans.pdfUnknownModel).toBe('unsupported-model');
  expect(plans.imageOnTextOnly).toBe('unsupported-model');
  expect(plans.txt).toBe('local-extraction');
  expect(plans.zip).toBe('blocked-archive');
  expect(plans.exe).toBe('blocked-executable');
  expect(plans.macroDoc).toBe('blocked-macro');
  expect(plans.mimeSpoofedZip).toBe('blocked-archive');
  expect(plans.tooBig).toBe('too-large');
  // Explicit adapters retain the audited OpenAI-compatible payload behavior;
  // unknown IDs must not inherit image support from a familiar model name.
  expect(plans.deepseek.providerType).toBe('openai_compatible');
  expect(plans.xai.providerType).toBe('openai_compatible');
  expect(plans.perplexity.providerType).toBe('openai_compatible');
  expect(plans.unknownGptLike.providerType).toBe('unknown');
  expect(plans.unknownGptLike.nativeAttachmentSupport.images).toBe(false);
});

test('attachments never upload before send, stay visible when incompatible, and block the send', async ({ page }) => {
  await openApp(page);
  const counter = { count: 0 };
  await page.route('https://api.groq.com/**', async route => { counter.count += 1; await route.abort(); });
  // Open the assistant panel BEFORE arming — opening it refreshes the model
  // selector, which would wipe a custom model set earlier.
  await page.evaluate(() => document.getElementById('chatbotBtn').click());
  await page.waitForTimeout(300);
  await armProvider(page, 'groq', 'llama-3.3-70b-versatile');

  const state = await page.evaluate(async () => {
    const fa = window.flowAssistant;
    fa.clearAttachments();
    await fa.addAttachmentFromFile(new File(['hello notes'], 'notes.txt', { type: 'text/plain' }));
    await fa.addAttachmentFromFile(new File(['PK fake'], 'archive.zip', { type: 'application/zip' }));
    await fa.addAttachmentFromFile(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));
    const chips = Array.from(document.querySelectorAll('.flow-attach-chip')).map(ch => ({
      cls: ch.className, meta: ch.querySelector('.flow-attach-meta').textContent
    }));
    // Explicit send with incompatible attachments must be blocked.
    const input = document.getElementById('chatInput');
    input.value = 'summarize my files';
    await window.sendChat();
    await new Promise(r => setTimeout(r, 300));
    const notice = Array.from(document.querySelectorAll('.chatbot-notice')).map(n => n.textContent).join('\n');
    const chipsStillVisible = document.querySelectorAll('.flow-attach-chip').length;
    return { chips, notice, chipsStillVisible, attachmentsKept: fa.getAttachments().length };
  });

  expect(state.chips).toHaveLength(3);
  expect(state.chips[0].meta).toContain('Text extracted locally');
  expect(state.chips[1].cls).toContain('is-blocked');
  expect(state.chips[2].cls).toContain('is-incompatible');
  expect(state.notice).toContain('Message not sent');
  expect(state.notice).toMatch(/archive\.zip|doc\.pdf/);
  expect(state.notice).toContain('Compatible options');
  // Incompatible files stay visible + selected (no silent discard).
  expect(state.chipsStillVisible).toBe(3);
  expect(state.attachmentsKept).toBe(3);
  // NOTHING was transmitted: selection, preview, and the blocked send made
  // zero provider requests.
  expect(counter.count).toBe(0);
});

test('study-material generation creates an editable guide Note and an interactive Testing Hub test with intact relationships', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, JSON.stringify(STRUCTURED_OK));
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');

  const result = await page.evaluate(async ([src, settings]) => {
    const r = await window.SutraStudyMaterials.generate(src, settings, {});
    return {
      ok: r.ok,
      guideTitle: r.guidePage && r.guidePage.title,
      guideMeta: r.guidePage && r.guidePage.generatedMaterial,
      guideEditable: r.guidePage && typeof r.guidePage.content === 'string' && r.guidePage.content.includes('<h2>'),
      testQuestions: r.test && r.test.questions.length,
      linked: !!(r.test && r.guidePage && r.test.guidePageId === r.guidePage.id && r.guidePage.generatedMaterial.testId === r.test.id),
      inHub: window.SutraStudyMaterials.listTests().length
    };
  }, [PDF_SOURCE, GEN_SETTINGS]);

  expect(result.ok).toBe(true);
  expect(result.guideTitle).toBe('Photosynthesis Study Guide');
  expect(result.guideEditable).toBe(true);
  expect(result.guideMeta.kind).toBe('study-guide');
  expect(result.guideMeta.provider).toBe('anthropic');
  expect(result.testQuestions).toBe(3);
  expect(result.linked).toBe(true);
  expect(result.inHub).toBe(1);

  // A section replacement is transactional: it creates an Activity receipt,
  // supports authoritative Undo, and rolls back if the receipt cannot be made.
  const regeneration = await page.evaluate(() => {
    const api = window.SutraStudyMaterials;
    const test = api.listTests()[0];
    const original = JSON.parse(JSON.stringify(test.questions[0]));
    const preview = {
      testId: test.id,
      index: 0,
      baseUpdatedAt: test.updatedAt || '',
      before: original,
      after: { ...original, prompt: 'Which structure contains chlorophyll?', explanation: 'Chlorophyll is embedded in thylakoid membranes.' }
    };
    const applied = api.applyQuestionReplacement(preview);
    const activity = window.SutraAssistantActions.getActivityLog().find(row => row.id === applied.activityId);
    const changed = api.getTestById(test.id).questions[0].prompt;
    const undone = window.SutraAssistantActions.undoAction(applied.activityId);
    const restored = api.getTestById(test.id).questions[0].prompt;

    const second = api.getTestById(test.id);
    const rollbackPreview = {
      testId: second.id,
      index: 0,
      baseUpdatedAt: second.updatedAt || '',
      before: JSON.parse(JSON.stringify(second.questions[0])),
      after: { ...second.questions[0], prompt: 'This must roll back.' }
    };
    const actions = window.SutraAssistantActions;
    window.SutraAssistantActions = null;
    const refused = api.applyQuestionReplacement(rollbackPreview);
    window.SutraAssistantActions = actions;
    return {
      applied, activityType: activity && activity.actionType, changed,
      undone, restored, original: original.prompt,
      refused, afterRefusal: api.getTestById(test.id).questions[0].prompt
    };
  });
  expect(regeneration.applied.ok).toBe(true);
  expect(regeneration.applied.reversible).toBe(true);
  expect(regeneration.activityType).toBe('regenerate_study_material_section');
  expect(regeneration.changed).toBe('Which structure contains chlorophyll?');
  expect(regeneration.restored).toBe(regeneration.original);
  expect(regeneration.refused).toMatchObject({ ok: false, code: 'activity-failure' });
  expect(regeneration.afterRefusal).toBe(regeneration.original);

  // The Testing Hub practice tab shows the generated test + Experimental badge
  // + Create from PDF entry point.
  const hub = await page.evaluate(async () => {
    window.setActiveView('testing');
    await new Promise(r => setTimeout(r, 300));

    window.switchTestingHubSection('practice');
    await new Promise(r => setTimeout(r, 300));
    const panel = document.querySelector('.sutra-gen-tests-panel');
    return {
      panel: !!panel,
      badges: panel ? panel.querySelectorAll('.sutra-exp-badge').length : 0,
      createFromPdf: panel ? !!panel.querySelector('[onclick*="sutraOpenStudyMaterialsFromHub"]') : false,
      row: panel ? panel.textContent.includes('Photosynthesis Practice Test') : false
    };
  });
  expect(hub.panel).toBe(true);
  expect(hub.badges).toBeGreaterThanOrEqual(2);
  expect(hub.createFromPdf).toBe(true);
  expect(hub.row).toBe(true);

  // Take the test: answers hidden before submit, scored after, explanations
  // revealed, attempt recorded, resume/retake controls present.
  const run = await page.evaluate(async () => {
    const t = window.SutraStudyMaterials.listTests()[0];
    window.sutraOpenGeneratedTest(t.id);
    await new Promise(r => setTimeout(r, 300));
    const runner = document.querySelector('.sutra-test-runner');
    const leakedBefore = !!runner.querySelector('.sutra-test-reveal');
    runner.querySelector('input[name="q_q_1"][value="Thylakoid"]').click();
    runner.querySelector('input[name="q_q_2"][value="true"]').click();
    runner.querySelector('#testSubmit').click();
    await new Promise(r => setTimeout(r, 200));
    const after = document.querySelector('.sutra-test-runner');
    const result = {
      leakedBefore,
      score: after.querySelector('.sutra-test-scorebar').textContent,
      explanations: after.querySelectorAll('.sutra-test-explanation').length,
      retake: !!after.querySelector('#testRetake'),
      attempts: window.SutraStudyMaterials.getTestById(t.id).attempts.length
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;
  });
  expect(run.leakedBefore).toBe(false);
  expect(run.score).toContain('1 / 2');
  expect(run.explanations).toBe(3);
  expect(run.retake).toBe(true);
  // Escape-close must not lose the submitted attempt.
  expect(run.attempts).toBe(1);

  // Persistence: survives reload, JSON round-trip, and deleting the source
  // guide page only clears the link (never crashes the test).
  // Force a confirmed save first — the runner persists through the normal
  // debounced autosave, which an immediate reload could race.
  await page.evaluate(() => window.saveWorkspaceLocally());
  await page.reload();
  await page.waitForFunction(() => window.SutraStudyMaterials
    && window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('intelligence-harness-reload-ready'));
  const persisted = await page.evaluate(() => {
    const t = window.SutraStudyMaterials.listTests()[0];
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    window.deserializeWorkspace(payload);
    const after = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const guide = after.pages.find(p => p.generatedMaterial && p.generatedMaterial.kind === 'study-guide');
    return {
      test: !!t, attempts: t ? t.attempts.length : 0,
      roundTripTests: (after.testingHub.generatedTests || []).length,
      roundTripGuide: !!guide,
      secretsLeak: JSON.stringify(payload).includes('mock-key-for-tests')
    };
  });
  expect(persisted.test).toBe(true);
  expect(persisted.attempts).toBe(1);
  expect(persisted.roundTripTests).toBe(1);
  expect(persisted.roundTripGuide).toBe(true);
  expect(persisted.secretsLeak).toBe(false);
});

test('malformed and schema-invalid model output fails safely without persisting anything', async ({ page }) => {
  await openApp(page);
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');

  await mockAnthropic(page, 'Sure! Here are your study materials in prose form.');
  const malformed = await page.evaluate(async ([src, settings]) => {
    const before = window.SutraStudyMaterials.listTests().length;
    const r = await window.SutraStudyMaterials.generate(src, settings, {});
    return { ok: r.ok, category: r.errorCategory, saved: window.SutraStudyMaterials.listTests().length - before };
  }, [PDF_SOURCE, GEN_SETTINGS]);
  expect(malformed.ok).toBe(false);
  expect(malformed.category).toBe('validation');
  expect(malformed.saved).toBe(0);

  await page.unroute('https://api.anthropic.com/**');
  await mockAnthropic(page, JSON.stringify({ practiceTest: { title: 'Bad', questions: [{ id: 'q1', type: 'multiple-choice', prompt: 'Q?', choices: ['A', 'B'], correctAnswer: 'C' }] } }));
  const invalid = await page.evaluate(async ([src]) => {
    const before = window.SutraStudyMaterials.listTests().length;
    const r = await window.SutraStudyMaterials.generate(src, { makeGuide: false, makeTest: true, makeFlashcards: false, guideDepth: 'standard', questionCount: 1, difficulty: 'mixed', questionTypes: 'multiple-choice', revealMode: 'after-submit' }, {});
    return { ok: r.ok, msg: r.errorMessage, saved: window.SutraStudyMaterials.listTests().length - before };
  }, [PDF_SOURCE]);
  expect(invalid.ok).toBe(false);
  expect(invalid.msg).toContain('correct answer is not one of the choices');
  expect(invalid.saved).toBe(0);
});

test('generated content renders inert — markup in titles, prompts, and explanations cannot execute', async ({ page }) => {
  await openApp(page);
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  await mockAnthropic(page, JSON.stringify({
    practiceTest: {
      title: '<img src=x onerror=window.__xss=1>',
      questions: [{ id: 'q1', type: 'true-false', prompt: '<script>window.__xss=2</script>Is this inert?', choices: [], correctAnswer: 'true', explanation: '<b onmouseover=window.__xss=3>boom</b>' }]
    }
  }));
  const xss = await page.evaluate(async ([src]) => {
    const r = await window.SutraStudyMaterials.generate(src, { makeGuide: false, makeTest: true, makeFlashcards: false, guideDepth: 'standard', questionCount: 1, difficulty: 'mixed', questionTypes: 'true-false', revealMode: 'immediate' }, {});
    window.sutraOpenGeneratedTest(r.test.id);
    await new Promise(res => setTimeout(res, 300));
    const runner = document.querySelector('.sutra-test-runner');
    const out = {
      fired: window.__xss || null,
      scripts: runner.querySelectorAll('script, img[onerror], [onmouseover]').length,
      promptInert: runner.querySelector('.sutra-test-prompt').textContent.includes('<script>')
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return out;
  }, [PDF_SOURCE]);
  expect(xss.fired).toBeNull();
  expect(xss.scripts).toBe(0);
  expect(xss.promptInert).toBe(true);
});

test('generation can be cancelled mid-flight; nothing is saved and the source is kept', async ({ page }) => {
  await openApp(page);
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  await mockAnthropic(page, JSON.stringify(STRUCTURED_OK), { delayMs: 8000 });
  const cancelled = await page.evaluate(async ([src, settings]) => {
    const before = window.SutraStudyMaterials.listTests().length;
    const promise = window.SutraStudyMaterials.generate(src, settings, {
      onRequestStarted: (id) => setTimeout(() => window.SutraIntelligence.cancelRequest(id), 400)
    });
    const r = await promise;
    return { ok: r.ok, cancelled: r.cancelled, saved: window.SutraStudyMaterials.listTests().length - before };
  }, [PDF_SOURCE, GEN_SETTINGS]);
  expect(cancelled.ok).toBe(false);
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.saved).toBe(0);
});

test('GUI-audit regressions stay fixed: heading toggle, valid list markup, dark-theme persistence', async ({ page }) => {
  await openApp(page);
  // This exercises the classic contenteditable editor; opt out of the modern
  // (v2) editor which is now the default.
  await page.evaluate(() => {
    if (typeof window.setWorkspacePreference === 'function') {
      window.setWorkspacePreference('editor.editorV2Enabled', false, {});
      window.applyWorkspacePreferences({});
    }
  });
  const editor = await page.evaluate(async () => {
    window.setActiveView('notes');
    await new Promise(r => setTimeout(r, 200));
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    const mk = (node) => { sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(node); sel.addRange(r); };
    ed.innerHTML = '<p>toggle test</p>'; ed.focus();
    // Heading H1/H2/H3 moved from standalone buttons into the styles dropdown;
    // drive the same classic-editor command the toolbar invokes.
    mk(ed.firstChild); window.formatBlock('h1');
    const afterH1 = ed.innerHTML;
    mk(ed.firstChild); window.formatBlock('h1');
    const afterToggle = ed.innerHTML;
    ed.innerHTML = '<p>item one</p>'; mk(ed.firstChild);
    window.formatText('insertUnorderedList');
    const afterUl = ed.innerHTML;
    return { afterH1, afterToggle, afterUl };
  });
  expect(editor.afterH1).toContain('<h1>');
  expect(editor.afterToggle).toContain('<p>');
  expect(editor.afterToggle).not.toContain('<h1>');
  // Lists must never nest inside the source paragraph (invalid HTML that
  // re-parses differently after save/reload).
  expect(editor.afterUl).not.toMatch(/<p>\s*<ul>/);
  expect(editor.afterUl).toContain('<ul>');

  await page.evaluate(() => window.applyAtelierTheme('dark'));
  await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-theme'))).toBe('dark');
  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-theme')), { timeout: 10000 }).toBe('dark');
});
