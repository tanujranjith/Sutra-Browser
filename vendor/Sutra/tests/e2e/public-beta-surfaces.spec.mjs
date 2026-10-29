import { expect, test } from '@playwright/test';

const PASS = 'correct horse battery staple';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch {}
    sessionStorage.setItem('sutra_intro_played', '1');
    // The wizard adds body.onboarding-open which makes all app chrome
    // pointer-events:none; ensure it is gone even if the overlay was mid-open.
    document.body.classList.remove('onboarding-open');
    for (const id of ['studentOnboardingOverlay', 'sutraStartupIntro']) {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.classList.remove('active', 'intro-exiting');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  });
}

async function openApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sutra_intro_played', '1');
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => window.SutraSmartImport
    && window.SutraAssistantChats
    && window.SutraIntegrations
    && window.SutraAssistantConversationController
    && window.flowAssistant);
}

test('Release notes open locally from the notification center without network fetch', async ({ page }) => {
  // The standalone top-bar "What's New" control was removed; release notes are
  // surfaced exclusively through the notification center now. This verifies the
  // notification-center path still opens release notes locally with no remote fetch.
  const externalRequests = [];
  page.on('request', request => {
    const url = request.url();
    let local = false;
    try { const host = new URL(url).hostname; local = host === '127.0.0.1' || host === 'localhost'; } catch (e) {}
    // Any local dev-server asset (on whatever port the harness chose) is fine; only
    // genuinely remote hosts count as an unexpected network fetch.
    if (!local) externalRequests.push(url);
  });
  await openApp(page);

  // The release-notes data source must remain available for the notification center.
  const releaseApi = await page.evaluate(() => ({
    defined: !!window.SutraReleaseNotes,
    notes: window.SutraReleaseNotes?.notes?.length || 0,
    hasOpen: typeof window.SutraReleaseNotes?.open === 'function'
  }));
  expect(releaseApi.defined).toBe(true);
  expect(releaseApi.hasOpen).toBe(true);
  expect(releaseApi.notes).toBeGreaterThan(0);

  // The obsolete top-bar control must be gone.
  await expect(page.locator('#whatsNewBtn')).toHaveCount(0);

  // Open the notification center and click the release notification.
  await page.locator('#notifBellBtn:visible, [data-mobile-action="notifications"]:visible').first().click();
  await expect(page.locator('#notifPanel')).toBeVisible();
  await page.locator('#notifPanel').getByText(/release notes/i).first().click();

  await expect(page.getByRole('dialog', { name: /what's new/i })).toBeVisible();
  await expect(page.locator('.release-note-version')).toContainText('Privacy & Security');
  await page.keyboard.press('Escape');

  expect(externalRequests, 'release notes must not trigger remote startup/fetch requests').toEqual([]);
});

test('integration registry truthfully gates external services and Smart Import applies approved items only', async ({ page }) => {
  await openApp(page);

  const registry = await page.evaluate(() => window.SutraIntegrations.registry());
  const drive = registry.find(item => item.id === 'google-drive-backup');
  const docs = registry.find(item => item.id === 'google-docs-smart-import');
  expect(drive.status).toBe('Gated');
  expect(docs.status).toBe('Gated');
  expect(registry.find(item => item.id === 'paste-text').status).toBe('Available');

  const rejected = await page.evaluate(() => window.SutraSmartImport.parse('<script>alert(1)</script>\n__proto__: polluted').rejected.length);
  expect(rejected).toBeGreaterThan(0);

  await page.evaluate(() => localStorage.setItem('hwTasks:v2', '[]'));
  await page.evaluate(() => localStorage.setItem('hwCourses:v2', '[]'));
  await page.evaluate(() => window.SutraSmartImport.open('AP Chem | Lab homework | 2026-06-15 | high'));
  await expect(page.getByRole('dialog', { name: /smart import/i })).toBeVisible();
  await page.locator('#smartImportAnalyzeBtn').click();
  await expect(page.locator('.smart-import-proposal')).toHaveCount(1);

  // Smart Import writes through the canonical SutraHomeworkStore (workspace/IndexedDB),
  // not the legacy hwTasks:v2 localStorage key — read homework from the store.
  const before = await page.evaluate(() => (window.SutraHomeworkStore.getSnapshot().tasks || []).length);
  expect(before).toBe(0);

  await page.locator('#smartImportApplyBtn').click();
  await expect(page.locator('#smartImportStatus')).toContainText('Applied 1 approved item');
  const after = await page.evaluate(() => (window.SutraHomeworkStore.getSnapshot().tasks || []).map(item => item.title));
  expect(after).toContain('Lab homework');

  await page.locator('#smartImportUndoBtn').click();
  const undone = await page.evaluate(() => (window.SutraHomeworkStore.getSnapshot().tasks || []).length);
  expect(undone).toBe(0);
});

test('Notes rich paste sanitizes scripts, handlers, and javascript URLs', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    // This tests the classic editor's paste sanitiser; opt out of the modern
    // (v2) editor which is now the default.
    if (typeof window.setWorkspacePreference === 'function') {
      window.setWorkspacePreference('editor.editorV2Enabled', false, {});
      window.applyWorkspacePreferences({});
    }
    if (typeof window.setActiveView === 'function') window.setActiveView('notes');
  });
  const html = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<p>Paste target</p>';
    editor.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', '<p onclick="alert(1)">Bad</p><script>alert(2)</script><a href="javascript:alert(3)">link</a><img src="x" onerror="alert(4)">');
    dt.setData('text/plain', 'Bad');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    editor.dispatchEvent(ev);
    return editor.innerHTML;
  });
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/onerror|onclick/i);
  expect(html).not.toMatch(/javascript:/i);
});

test('Assistant chat history persists locally and is included in encrypted backups but not plaintext JSON by default', async ({ page }) => {
  // This integration deliberately derives keys for backup creation, envelope
  // inspection, restore decryption, and the pre-restore safety snapshot.
  test.setTimeout(240_000);
  await openApp(page);
  // The Assistant Pack is opt-in for fresh student workspaces (assistant.enabled
  // defaults OFF); enable it like a user would so the chat panel can open.
  await page.evaluate(() => { window.setWorkspacePreference('assistant.enabled', true); });
  await page.evaluate(() => {
    const panel = document.getElementById('chatbotPanel');
    if (panel && panel.style.display !== 'flex' && typeof window.toggleChat === 'function') window.toggleChat();
  });
  await expect(page.locator('#chatbotMessages')).toBeVisible();
  // Deterministic local commands ("open notes") sit behind the
  // assistant.localRouting toggle, which defaults OFF (AI-only).
  await page.evaluate(() => {
    window.setWorkspacePreference('assistant.localRouting', true);
    window.setWorkspacePreference('assistant.saveChatHistory', true);
    window.setWorkspacePreference('assistant.includeChatsInEncryptedBackups', true);
    window.setWorkspacePreference('assistant.includeChatsInPlaintextRecovery', false);
    if (!window.SutraAssistantConversationController.getState().conversations.length) {
      window.SutraAssistantConversationController.create({ title: 'Encrypted backup QA' });
    }
  });
  const localRoute = await page.evaluate(() => ({
    enabled: window.getWorkspacePreference('assistant.localRouting', null),
    result: window.flowAssistant.handleOutgoing("what's overdue?")
  }));
  expect(localRoute.enabled).toBe(true);
  expect(localRoute.result?.handled).toBe(true);
  await page.evaluate(async () => {
    document.getElementById('chatInput').value = "what's overdue?";
    await window.sendChat();
  });
  await expect(page.locator('#chatbotMessages .chatbot-msg.assistant').last()).toContainText(/overdue|caught up/i);

  const chatState = await page.evaluate(() => {
    const mirror = JSON.parse(localStorage.getItem('sutra:assistantChats:v1') || '{}');
    return {
      saveChatHistory: window.getWorkspacePreference('assistant.saveChatHistory', null),
      internalRoles: window.SutraAssistantConversationController.getState()
        .conversations?.[0]?.messages?.map(message => message.role),
      canonicalRoles: window.SutraAssistantChats.getStore()
        .conversations?.[0]?.messages?.map(message => message.role),
      mirrorRoles: mirror.conversations?.[0]?.messages?.map(message => message.role)
    };
  });
  expect(chatState.saveChatHistory).toBe(true);
  expect(chatState.internalRoles).toEqual(['user', 'assistant']);
  expect(chatState.canonicalRoles).toEqual(['user', 'assistant']);
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('sutra:assistantChats:v1') || '{}');
    return stored.conversations?.[0]?.messages?.map(message => message.role);
  })).toEqual(['user', 'assistant']);
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('sutra:assistantChats:v1') || '{}'));
  expect(JSON.stringify(store)).not.toMatch(/<think>|flow-actions|sk-secret|developer prompt|system prompt/i);

  const backup = await page.evaluate(async ({ pass }) => {
    const created = await window.SutraEncryptedBackups.createBackupBlob(pass);
    const bytes = new Uint8Array(await created.blob.arrayBuffer());
    const plain = await window.SutraEncryptedBackups.decryptEnvelopeBytes(bytes.buffer, pass);
    const zip = await window.JSZip.loadAsync(plain);
    const workspace = JSON.parse(await zip.file('workspace.json').async('string'));
    return {
      bytes: Array.from(bytes),
      encryptedChatCount: workspace.assistantChatHistory?.conversations?.length || 0,
      encryptedMessageRoles: workspace.assistantChatHistory?.conversations?.[0]?.messages?.map(m => m.role) || [],
      plaintextChatHistory: window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).assistantChatHistory || null
    };
  }, { pass: PASS });

  expect(backup.encryptedChatCount).toBeGreaterThan(0);
  expect(backup.encryptedMessageRoles).toEqual(['user', 'assistant']);
  expect(backup.plaintextChatHistory).toBeNull();

  await page.evaluate(() => {
    localStorage.removeItem('sutra:assistantChats:v1');
    localStorage.removeItem('sutra:assistantCurrentChatId:v1');
  });
  await page.setInputFiles('#fileInput', {
    name: 'chat-restore.sutra',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(backup.bytes)
  });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
  // Whole-workspace imports onto a non-empty device now show the restore
  // conflict chooser (applyValidatedWorkspaceImport). Accept it to proceed.
  await page.locator('.sutra-modal-overlay button', { hasText: 'Restore backup' }).click({ timeout: 20_000 });
  // Manual restores now complete an encrypted pre-restore safety snapshot first.
  const snapModal = page.locator('#sutraBackupPasswordModal');
  await snapModal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', PASS);
  await page.fill('#sutraBackupPassphraseConfirmInput', PASS);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  await expect(snapModal).not.toHaveClass(/active/, { timeout: 60_000 });
  await expect.poll(
    () => page.evaluate(() => !!localStorage.getItem('sutra:assistantChats:v1')),
    { timeout: 20_000 }
  ).toBe(true);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('sutra:assistantChats:v1') || '{}'));
  expect(restored.conversations?.[0]?.restoredFromBackup).toBe(true);
  expect(restored.conversations?.[0]?.messages?.map(m => m.role)).toEqual(['user', 'assistant']);
});
