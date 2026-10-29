import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch (error) {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page, 'workspace-empty-root-open-ready');
}

async function waitForAppReady(page, reason) {
  await page.waitForFunction(() => !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  // The shell and serialization globals are exposed before IndexedDB
  // hydration and the boot-time recovery adapter finish. Cross the public,
  // readback-verified save seam before inspecting or replacing canonical data.
  await page.evaluate(readyReason => window.flowAtelier.flushAppSaveNow(readyReason), reason);
}

async function leaveAppBeforeDirectStorageSetup(page) {
  // Direct IndexedDB fixtures must not race Sutra's live autosave queue.
  await page.goto('/HomePage.html');
}

async function returnToApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page, 'workspace-empty-root-return-ready');
}

async function writeWorkspaceRecord(page, key, value) {
  await page.evaluate(({ key, value }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { key, value });
}

async function readWorkspaceRecord(page, key) {
  return page.evaluate(keyToRead => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get(keyToRead);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error || tx.error);
      tx.oncomplete = () => db.close();
    };
  }), key);
}

async function deleteWorkspaceRecord(page, key) {
  await page.evaluate(keyToDelete => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').delete(keyToDelete);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), key);
}

function emptyWorkspace() {
  return {
    version: 7,
    pages: [],
    tasks: [],
    taskOrder: [],
    timeBlocks: [],
    settings: {
      onboarding: { version: 1, completed: true, skipped: false, migratedFromLegacy: true }
    }
  };
}

function meaningfulWorkspace(pageId, title) {
  const now = new Date().toISOString();
  return {
    version: 7,
    pages: [{
      id: pageId,
      title,
      type: 'note',
      content: '<p>Recovery sentinel</p>',
      blocks: [],
      createdAt: now,
      updatedAt: now,
      spaceId: 'default'
    }],
    tasks: [],
    taskOrder: [],
    timeBlocks: [],
    settings: {
      onboarding: { version: 1, completed: true, skipped: false, migratedFromLegacy: true }
    }
  };
}

test('present-but-empty canonical root recovers the richer legacy workspace', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  await deleteWorkspaceRecord(page, 'workspace-last-meaningful');
  await deleteWorkspaceRecord(page, 'workspace-confirmed-root');
  await writeWorkspaceRecord(page, 'root', emptyWorkspace());
  const legacy = meaningfulWorkspace('legacy-recovery-page', 'Recovered legacy page');
  await page.evaluate(workspace => {
    localStorage.setItem('noteflow_atelier_db', JSON.stringify({ appData: workspace }));
  }, legacy);

  await returnToApp(page);

  const result = await page.evaluate(async () => {
    const live = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const preservedEmpty = await new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_atelier_db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readonly');
        const get = tx.objectStore('workspace').get('workspace-empty-before-recovery');
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => reject(get.error || tx.error);
        tx.oncomplete = () => db.close();
      };
    });
    return {
      recovered: live.pages.some(item => item.id === 'legacy-recovery-page'),
      preservedEmpty: !!preservedEmpty && Array.isArray(preservedEmpty.pages) && preservedEmpty.pages.length === 0
    };
  });
  expect(result).toEqual({ recovered: true, preservedEmpty: true });
});

test('last meaningful canonical journal restores an accidentally emptied root', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  await writeWorkspaceRecord(page, 'root', meaningfulWorkspace('journal-recovery-page', 'Recovered journal page'));
  await returnToApp(page);

  // A confirmed save journals the meaningful current root in the same
  // transaction as the replacement root.
  await page.evaluate(() => window.saveWorkspaceLocally());
  await leaveAppBeforeDirectStorageSetup(page);
  await writeWorkspaceRecord(page, 'root', emptyWorkspace());

  await returnToApp(page);
  const recovered = await page.evaluate(() => {
    const live = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return live.pages.some(item => item.id === 'journal-recovery-page');
  });
  expect(recovered).toBe(true);
});

test('canonical journal outranks a larger but older legacy workspace', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  const journal = meaningfulWorkspace('newer-journal-page', 'Newer journal page');
  const legacy = meaningfulWorkspace('older-legacy-page-1', 'Older legacy page 1');
  for (let index = 2; index <= 8; index += 1) {
    legacy.pages.push(meaningfulWorkspace(`older-legacy-page-${index}`, `Older legacy page ${index}`).pages[0]);
  }
  await deleteWorkspaceRecord(page, 'workspace-confirmed-root');
  await writeWorkspaceRecord(page, 'workspace-last-meaningful', journal);
  await writeWorkspaceRecord(page, 'root', emptyWorkspace());
  await page.evaluate(workspace => {
    localStorage.setItem('noteflow_atelier_db', JSON.stringify({ appData: workspace }));
  }, legacy);

  await returnToApp(page);
  const result = await page.evaluate(() => {
    const live = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return {
      journalPresent: live.pages.some(item => item.id === 'newer-journal-page'),
      legacyPresent: live.pages.some(item => item.id === 'older-legacy-page-1')
    };
  });
  expect(result).toEqual({ journalPresent: true, legacyPresent: false });
});

test('assistant-only canonical data is not mistaken for an empty workspace', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  const assistantOnly = emptyWorkspace();
  assistantOnly.assistantChatHistory = {
    version: 1,
    currentChatId: 'chat-preserve',
    legacyMigrationComplete: true,
    conversations: [{
      id: 'chat-preserve',
      title: 'Do not replace me',
      messages: [{ id: 'message-preserve', role: 'user', content: 'Important study context' }]
    }]
  };
  await writeWorkspaceRecord(page, 'root', assistantOnly);
  await writeWorkspaceRecord(page, 'workspace-last-meaningful', meaningfulWorkspace('stale-journal-page', 'Stale journal page'));

  await returnToApp(page);
  const stored = await readWorkspaceRecord(page, 'root');
  const result = {
    conversationPresent: stored.assistantChatHistory.conversations.some(item => item.id === 'chat-preserve'),
    stalePagePresent: stored.pages.some(item => item.id === 'stale-journal-page')
  };
  expect(result).toEqual({ conversationPresent: true, stalePagePresent: false });
});

test('unknown forward-compatible canonical fields prevent automatic replacement', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  const futureWorkspace = emptyWorkspace();
  futureWorkspace.futureUserCounter = 0;
  await writeWorkspaceRecord(page, 'root', futureWorkspace);
  await writeWorkspaceRecord(page, 'workspace-last-meaningful', meaningfulWorkspace('stale-future-journal-page', 'Stale journal page'));

  await returnToApp(page);
  const stored = await readWorkspaceRecord(page, 'root');
  expect({
    futureValue: stored.futureUserCounter,
    stalePagePresent: stored.pages.some(item => item.id === 'stale-future-journal-page')
  }).toEqual({ futureValue: 0, stalePagePresent: false });
});

test('a canonically confirmed empty workspace does not resurrect its journal', async ({ page }) => {
  await openApp(page);
  await leaveAppBeforeDirectStorageSetup(page);
  await writeWorkspaceRecord(page, 'root', meaningfulWorkspace('intentionally-removed-page', 'Remove me intentionally'));
  await returnToApp(page);

  const committed = await page.evaluate(async next => {
    const db = window.SutraWorkspaceDB.create({
      dbName: 'noteflow_atelier_db',
      storeName: 'workspace',
      version: Number(window.SutraMigrations?.CURRENT_VERSION) || 8
    });
    try {
      return await db.writeIf('root', next, current => Array.isArray(current?.pages)
        && current.pages.some(item => item.id === 'intentionally-removed-page'));
    } finally {
      db.close();
    }
  }, emptyWorkspace());
  expect(committed.written).toBe(true);

  await leaveAppBeforeDirectStorageSetup(page);
  await returnToApp(page);
  const stored = await readWorkspaceRecord(page, 'root');
  const journal = await readWorkspaceRecord(page, 'workspace-last-meaningful');
  const marker = await readWorkspaceRecord(page, 'workspace-confirmed-root');
  const userPageIds = stored.pages
    .filter(item => item.id !== 'help_page' && item.systemRole !== 'help-docs' && item.builtInId !== 'help-docs')
    .map(item => item.id);
  expect({
    rootStayedEmpty: userPageIds.length === 0,
    journalRetained: journal.pages.some(item => item.id === 'intentionally-removed-page'),
    userPageIds,
    marker
  }).toEqual({ rootStayedEmpty: true, journalRetained: true, userPageIds: [], marker: expect.any(Object) });
});
