import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PASS = 'correct horse battery staple';
const PORTABLE_INLINE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('long authored note, HTML and Homework content survives encrypted export, restore and reload', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  const expected = {
    title: 'Research journal ' + 'Long title '.repeat(160) + 'END-TITLE',
    content: '<p>' + 'Research observations and calculations. '.repeat(5000) + 'END-NOTE</p>',
    html: '<main><p>' + 'Laboratory portal content. '.repeat(10000) + 'END-HTML</p></main>',
    homeworkTitle: 'Assignment ' + 'Problem set '.repeat(200) + 'END-TITLE',
    notes: 'Homework analysis. '.repeat(5000) + 'END-HOMEWORK'
  };
  await page.evaluate(async data => {
    const base = window.serializeWorkspace();
    window.deserializeWorkspace({ ...base,
      pages: [{ id: 'qa-long-note', title: data.title, content: data.content }],
      homeworkWorkspace: {
        courses: [{ id: 'qa-long-course', name: 'QA Calculus', type: 'class' }],
        tasks: [{ id: 'qa-long-task', courseId: 'qa-long-course', title: data.homeworkTitle, notes: data.notes }]
      }
    });
    window.SutraHTMLPages.createPage('QA long HTML', { source: data.html });
    await window.saveWorkspaceLocally();
  }, expected);
  const inspect = () => page.evaluate(() => {
    const ws = window.serializeWorkspace();
    const note = ws.pages.find(p => p.id === 'qa-long-note');
    const html = ws.pages.find(p => p.title === 'QA long HTML');
    const task = ws.homeworkWorkspace.tasks.find(t => t.id === 'qa-long-task');
    return { title: note?.title, content: note?.content, html: html?.htmlDocument?.source,
      homeworkTitle: task?.title, notes: task?.notes };
  });
  await expect.poll(inspect).toEqual(expected);
  await page.reload();
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await expect.poll(inspect).toEqual(expected);
  const bytes = await page.evaluate(async pass => {
    const result = await window.SutraEncryptedBackups.createBackupBlob(pass);
    return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
  }, PASS);
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 8).toString()).toBe('SUTRAENC');
  expect(buffer.includes(Buffer.from('END-HOMEWORK'))).toBe(false);
  await seedRichWorkspace(page, 'LONG-RESTORE-TARGET');
  await page.setInputFiles('#fileInput', { name: 'long-content.sutra', mimeType: 'application/octet-stream', buffer });
  await page.locator('#sutraImportPassphraseInput').fill(PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);
  await expect.poll(inspect, { timeout: 30_000 }).toEqual(expected);
  // Applying the workspace precedes the restore's asynchronous durability
  // gate. Wait for its IndexedDB commit before simulating an immediate reload.
  await expect.poll(() => readPersistedPageTitle(page, 'qa-long-note'), { timeout: 30_000 }).toBe(expected.title);
  await page.reload();
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await expect.poll(inspect).toEqual(expected);
});

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
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

async function readPersistedPageTitle(page, pageId = null) {
  return page.evaluate(pageId => new Promise((resolve, reject) => {
    const request = indexedDB.open('noteflow_atelier_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('root');
      get.onerror = () => {
        db.close();
        reject(get.error || tx.error);
      };
      get.onsuccess = () => {
        const pages = get.result?.pages || [];
        const title = (pageId ? pages.find(entry => entry.id === pageId) : pages[0])?.title || '';
        db.close();
        resolve(title);
      };
    };
  }), pageId);
}

async function seedRichWorkspace(page, marker) {
  await page.evaluate(async ({ marker }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const b64 = (value) => btoa(unescape(encodeURIComponent(value)));
    const inlineAsset = `data:image/png;base64,${b64(`INLINE-ASSET-${marker}`)}`;
    const docBg = `data:image/png;base64,${b64(`DOC-BACKGROUND-${marker}`)}`;
    const attachmentBlob = `data:text/plain;base64,${b64(`ATTACHMENT-BYTES-${marker}`)}`;
    const now = new Date().toISOString();
    const payload = {
      ...base,
      pages: [{
        id: `page-${marker}`,
        title: `Sentinel Note ${marker}`,
        content: `<h1>Sentinel Note ${marker}</h1><p>Secret note body ${marker}</p><img src="${inlineAsset}" alt="inline">`,
        blocks: [{
          id: `drawing-${marker}`,
          type: 'drawing',
          strokes: [{ id: `stroke-${marker}`, tool: 'pen', color: '#123456', width: 3, points: [{ x: 1, y: 2, p: 0.5 }] }]
        }],
        icon: 'doc',
        collapsed: false,
        pinned: true,
        locked: true,
        lockHash: `pin-hash-${marker}`,
        lockSalt: `pin-salt-${marker}`,
        documentBackground: { enabled: true, image: docBg, opacity: 0.4, blur: 2 },
        createdAt: now,
        updatedAt: now,
        theme: 'dark'
      }],
      tasks: [{ id: `task-${marker}`, title: `Task ${marker}`, status: 'todo', priority: 'high', difficulty: 'hard', notes: `Task notes ${marker}` }],
      taskOrder: [`task-${marker}`],
      timeBlocks: [{ id: `block-${marker}`, title: `Timeline ${marker}`, date: '2026-06-06', start: '09:00', end: '10:00' }],
      homeworkWorkspace: {
        courses: [{ id: `course-${marker}`, name: `Homework Course ${marker}`, type: 'class' }],
        tasks: [{ id: `hw-${marker}`, courseId: `course-${marker}`, title: `Homework ${marker}`, dueDate: '2026-06-07' }]
      },
      apStudyWorkspace: { subjects: [{ id: `ap-${marker}`, name: `AP Subject ${marker}`, units: [] }], sessions: [] },
      reviewWorkspace: {
        decks: [{ id: `deck-${marker}`, name: `Deck ${marker}`, cards: [{ id: `card-${marker}`, prompt: `Prompt ${marker}`, answer: `Answer ${marker}` }] }],
        settings: { dailyLimit: 12 }
      },
      courseWorkspace: {
        courses: [{ id: `course-${marker}`, name: `Course ${marker}`, links: [] }],
        files: [{
          id: `file-${marker}`,
          courseId: `course-${marker}`,
          name: `Attachment Filename ${marker}.txt`,
          storageType: 'indexeddb',
          blobKey: `blob-${marker}`,
          _exportBlob: attachmentBlob,
          createdAt: now
        }],
        resources: [],
        assignments: [],
        settings: { activeCourseId: `course-${marker}` }
      },
      settings: {
        ...base.settings,
        theme: 'dark',
        atelierTheme: 'retro95',
        mobileTodayMode: 'on',
        recentSearches: [{ query: `Settings Sentinel ${marker}`, at: now }],
        customization: {
          ...(base.settings && base.settings.customization ? base.settings.customization : {}),
          modsEnabled: true,
          cssSnippets: [{ id: `css-${marker}`, name: `CSS ${marker}`, css: `.qa-${marker}{color:red;}`, enabled: true, order: 0 }],
          installedPlugins: [{
            manifest: {
              schemaVersion: 1,
              id: `qa.plugin.${marker.toLowerCase()}`,
              name: `Plugin ${marker}`,
              version: '1.0.0',
              description: 'QA plugin',
              author: 'QA',
              permissions: ['ui.commands'],
              contributions: { commands: [{ id: `cmd-${marker}`, label: `Command ${marker}`, hint: '', action: 'noop' }] },
              hasRuntime: true,
              runtime: { type: 'sandboxed-script', code: 'atelier.toast("qa");' }
            },
            enabled: true,
            reviewRequired: false,
            installedAt: now,
            updatedAt: now,
            pluginSettings: {}
          }]
        }
      },
      localStorageSnapshot: {
        'chat_provider': 'openai',
        'chat_model_by_provider': JSON.stringify({ openai: `model-${marker}` })
      }
    };
    window.deserializeWorkspace(payload);
    await window.__sutraPublicBetaTestHooks.seedCourseAttachmentBlob(`blob-${marker}`, attachmentBlob);
    sessionStorage.setItem('groq_api_key', `sk-secret-${marker}`);
    await window.saveWorkspaceLocally();
  }, { marker });
}

async function createEncryptedBytes(page, marker = 'ALPHA') {
  await seedRichWorkspace(page, marker);
  const data = await page.evaluate(async ({ pass }) => {
    const created = await window.SutraEncryptedBackups.createBackupBlob(pass);
    const bytes = new Uint8Array(await created.blob.arrayBuffer());
    const inspect = await window.SutraEncryptedBackups.inspectEnvelope(created.blob);
    return { bytes: Array.from(bytes), inspect, filename: created.filename };
  }, { pass: PASS });
  return { buffer: Buffer.from(data.bytes), inspect: data.inspect, filename: data.filename };
}

async function cancelImportPasswordModal(page) {
  await page.locator('#sutraImportPasswordCancelBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/);
}

// Whole-workspace imports onto a non-empty device now show the restore
// conflict chooser (applyValidatedWorkspaceImport). Accept it to proceed.
async function acceptRestoreConflictChooser(page) {
  await page.locator('.sutra-modal-overlay button', { hasText: 'Restore backup' }).click({ timeout: 20_000 });
}

// Manual restores now offer an ENCRYPTED pre-restore safety snapshot through
// the standard backup-passphrase dialog. Complete it so the import proceeds;
// the resulting .sutra download is captured by Playwright's temp storage.
async function completeSafetySnapshotDialog(page, pass = PASS) {
  const modal = page.locator('#sutraBackupPasswordModal');
  await modal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', pass);
  await page.fill('#sutraBackupPassphraseConfirmInput', pass);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  // PBKDF2 (600k iterations) runs before the dialog closes.
  await expect(modal).not.toHaveClass(/active/, { timeout: 60_000 });
}

// Decline path: cancelling the snapshot passphrase must cancel the whole
// import — the workspace stays exactly as it was.
async function declineSafetySnapshotDialog(page) {
  const modal = page.locator('#sutraBackupPasswordModal');
  await modal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#sutraBackupPasswordCancelBtn').click();
  await expect(modal).not.toHaveClass(/active/);
}

test('new .sutra export is an authenticated encrypted envelope with no plaintext workspace data', async ({ page }) => {
  await openApp(page);
  await seedRichWorkspace(page, 'EXPORT');
  const result = await page.evaluate(async ({ pass }) => {
    const first = await window.SutraEncryptedBackups.createBackupBlob(pass);
    const second = await window.SutraEncryptedBackups.createBackupBlob(pass);
    const firstBytes = new Uint8Array(await first.blob.arrayBuffer());
    const secondBytes = new Uint8Array(await second.blob.arrayBuffer());
    const firstText = new TextDecoder('latin1').decode(firstBytes);
    const secondText = new TextDecoder('latin1').decode(secondBytes);
    let zipParsed = false;
    try { await window.JSZip.loadAsync(first.blob); zipParsed = true; } catch (error) {}
    const inspectFirst = await window.SutraEncryptedBackups.inspectEnvelope(first.blob);
    const inspectSecond = await window.SutraEncryptedBackups.inspectEnvelope(second.blob);
    const has = (needle) => firstText.includes(needle);
    return {
      filename: first.filename,
      magic: firstText.slice(0, 8),
      zipParsed,
      header: inspectFirst.header,
      saltDifferent: inspectFirst.header.kdf.salt !== inspectSecond.header.kdf.salt,
      ivDifferent: inspectFirst.header.cipher.iv !== inspectSecond.header.cipher.iv,
      ciphertextDifferent: firstText !== secondText,
      leaksTitle: has('Sentinel Note EXPORT'),
      leaksSetting: has('Settings Sentinel EXPORT'),
      leaksAsset: has('INLINE-ASSET-EXPORT') || has('DOC-BACKGROUND-EXPORT'),
      leaksAttachment: has('ATTACHMENT-BYTES-EXPORT') || has('Attachment Filename EXPORT'),
      leaksApiKey: has('sk-secret-EXPORT')
    };
  }, { pass: PASS });

  expect(result.filename).toMatch(/^sutra_workspace_.*\.sutra$/);
  expect(result.magic).toBe('SUTRAENC');
  expect(result.zipParsed).toBe(false);
  expect(result.header.format).toBe('sutra-encrypted-envelope');
  expect(result.header.envelopeVersion).toBe(1);
  expect(result.header.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
  expect(result.header.cipher).toMatchObject({ name: 'AES-GCM', keyLength: 256, tagLength: 128 });
  expect(result.header.payload.contentType).toBe('application/zip');
  expect(result.saltDifferent).toBe(true);
  expect(result.ivDifferent).toBe(true);
  expect(result.ciphertextDifferent).toBe(true);
  expect(result.leaksTitle).toBe(false);
  expect(result.leaksSetting).toBe(false);
  expect(result.leaksAsset).toBe(false);
  expect(result.leaksAttachment).toBe(false);
  expect(result.leaksApiKey).toBe(false);
});

test('encrypted .sutra import rejects wrong password without mutating, then restores with correct password and persists', async ({ page }) => {
  // This path deliberately performs four 600k-iteration PBKDF2 operations
  // (export, wrong-password import, successful import, and safety snapshot).
  test.setTimeout(240_000);
  await openApp(page);
  const { buffer } = await createEncryptedBytes(page, 'IMPORT');
  await seedRichWorkspace(page, 'LOCAL');

  await page.setInputFiles('#fileInput', { name: 'IMPORT.SUTRA', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', 'wrong password');
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordError')).toContainText(/could not be decrypted/i);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Sentinel Note LOCAL');
  await cancelImportPasswordModal(page);

  await page.setInputFiles('#fileInput', { name: 'IMPORT.SUTRA', mimeType: '', buffer });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel Note IMPORT');
  await expect.poll(() => readPersistedPageTitle(page), { timeout: 20_000 }).toBe('Sentinel Note IMPORT');

  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Sentinel Note IMPORT');
  const restored = await page.evaluate(() => {
    const ws = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const plugin = ws.settings.customization.installedPlugins[0];
    return {
      setting: ws.settings.recentSearches[0] && ws.settings.recentSearches[0].query,
      attachment: ws.courseWorkspace.files[0],
      homeworkCourse: ws.homeworkWorkspace.courses[0],
      homeworkTask: ws.homeworkWorkspace.tasks[0],
      pluginReviewRequired: plugin.reviewRequired === true,
      pluginDisabled: plugin.enabled === false,
      apiKeyExported: JSON.stringify(ws).includes('sk-secret-IMPORT')
    };
  });
  expect(restored.setting).toBe('Settings Sentinel IMPORT');
  expect(restored.attachment.missingBlob).toBe(false);
  expect(restored.homeworkCourse).toMatchObject({ id: 'course-IMPORT', name: 'Homework Course IMPORT' });
  expect(restored.homeworkTask).toMatchObject({ id: 'hw-IMPORT', courseId: 'course-IMPORT', title: 'Homework IMPORT', dueDate: '2026-06-07' });
  expect(restored.pluginReviewRequired).toBe(true);
  expect(restored.pluginDisabled).toBe(true);
  expect(restored.apiKeyExported).toBe(false);
});

test('inline note images survive encrypted packaging, restore, and reload', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);

  const packaged = await page.evaluate(async ({ imageSrc }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const pageId = 'portable-inline-image';
    const now = new Date().toISOString();
    window.deserializeWorkspace({
      ...base,
      pages: [{
        id: pageId,
        title: 'Portable inline image',
        type: 'note',
        content: `<p>Portable image sentinel.</p><p><img src="${imageSrc}" alt="Portable image"></p>`,
        blocks: [],
        isLocked: false,
        lockHash: null,
        lockSalt: null,
        createdAt: now,
        updatedAt: now
      }]
    });
    await window.saveWorkspaceLocally();

    const backup = await window.SutraEncryptedBackups.createBackupBlob('correct horse battery staple');
    const zipBytes = await window.SutraEncryptedBackups.decryptEnvelopeBytes(backup.blob, 'correct horse battery staple');
    const zip = await window.JSZip.loadAsync(zipBytes);
    const manifest = JSON.parse(await zip.file('manifest.json').async('text'));
    const workspace = JSON.parse(await zip.file('workspace.json').async('text'));
    const note = workspace.pages.find(item => item && item.id === pageId);
    const reference = String(note && note.content || '').match(/atelier-asset:\/\/([A-Za-z0-9._-]+)/);
    const assetBytes = reference ? await zip.file(`assets/${reference[1]}`).async('uint8array') : null;
    let assetBase64 = '';
    if (assetBytes) {
      let binary = '';
      assetBytes.forEach(byte => { binary += String.fromCharCode(byte); });
      assetBase64 = btoa(binary);
    }
    return {
      packageReference: reference ? reference[1] : '',
      packageStillHasDataUrl: String(note && note.content || '').includes(imageSrc),
      manifestAssetFiles: (manifest.assets || []).map(asset => asset.file),
      assetBase64
    };
  }, { imageSrc: PORTABLE_INLINE_IMAGE });

  expect(packaged.packageReference).toMatch(/^asset_[A-Za-z0-9]+\.png$/);
  expect(packaged.packageStillHasDataUrl).toBe(false);
  expect(packaged.manifestAssetFiles).toContain(packaged.packageReference);
  expect(packaged.assetBase64).toBe(PORTABLE_INLINE_IMAGE.split(',')[1]);

  const buffer = await page.evaluate(async () => {
    const backup = await window.SutraEncryptedBackups.createBackupBlob('correct horse battery staple');
    return Array.from(new Uint8Array(await backup.blob.arrayBuffer()));
  });
  await page.setInputFiles('#fileInput', {
    name: 'portable-inline-image.sutra',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buffer)
  });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);

  await expect.poll(() => page.evaluate(() => {
    const workspace = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return workspace.pages.find(item => item && item.id === 'portable-inline-image')?.content || '';
  }), { timeout: 20_000 }).toContain(PORTABLE_INLINE_IMAGE);

  await page.evaluate(() => window.loadPage('portable-inline-image'));
  await expect.poll(() => page.evaluate(() => {
    const image = document.querySelector('#editorV2Host img, #editor img');
    return image?.getAttribute('src') || '';
  }), { timeout: 10_000 }).toBe(PORTABLE_INLINE_IMAGE);

  const restored = await page.evaluate(() => {
    const image = document.querySelector('#editorV2Host img, #editor img');
    return {
      src: image?.getAttribute('src') || '',
      naturalWidth: image?.naturalWidth || 0
    };
  });
  expect(restored.src).toBe(PORTABLE_INLINE_IMAGE);
  expect(restored.naturalWidth).toBeGreaterThan(0);

  await page.reload();
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await completeOnboarding(page);
  await expect.poll(() => page.evaluate(() => {
    const workspace = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return workspace.pages.find(item => item && item.id === 'portable-inline-image')?.content || '';
  })).toContain(PORTABLE_INLINE_IMAGE);
});

test('tampered encrypted backups fail authentication without replacing local workspace', async ({ page }) => {
  // Export plus two authenticated rejection attempts can exceed the ordinary
  // UI timeout on slower browser/CI workers.
  test.setTimeout(180_000);
  await openApp(page);
  const { buffer } = await createEncryptedBytes(page, 'TAMPER');
  await seedRichWorkspace(page, 'SAFE');
  const tampered = Buffer.from(buffer);
  tampered[tampered.length - 8] ^= 0xff;

  await page.setInputFiles('#fileInput', { name: 'tampered.sutra', mimeType: 'application/octet-stream', buffer: tampered });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordError')).toContainText(/could not be decrypted/i);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Sentinel Note SAFE');
  await cancelImportPasswordModal(page);

  const headerLength = buffer.readUInt32BE(9);
  const headerStart = 8 + 1 + 4;
  const header = JSON.parse(buffer.slice(headerStart, headerStart + headerLength).toString('utf8'));
  header.cipher.iv = (header.cipher.iv[0] === 'A' ? 'B' : 'A') + header.cipher.iv.slice(1);
  const tamperedHeader = Buffer.from(JSON.stringify(header), 'utf8');
  expect(tamperedHeader.length).toBe(headerLength);
  const headerTampered = Buffer.concat([
    buffer.slice(0, headerStart),
    tamperedHeader,
    buffer.slice(headerStart + headerLength)
  ]);
  await page.setInputFiles('#fileInput', { name: 'header-tampered.sutra', mimeType: 'application/octet-stream', buffer: headerTampered });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordError')).toContainText(/decrypt|header|backup/i);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('Sentinel Note SAFE');
});

test('missing attachment still refuses encrypted and emergency .sutra export', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__sutraPublicBetaTestHooks.injectMissingCourseAttachment());
  const normal = await page.evaluate(async ({ pass }) => {
    try { await window.SutraEncryptedBackups.createBackupBlob(pass, { requireCompleteAttachments: true }); return 'ok'; }
    catch (error) { return error.name; }
  }, { pass: PASS });
  expect(['MissingAttachmentBlobError', 'AttachmentWarmupError']).toContain(normal);

  const emergency = await page.evaluate(async ({ pass }) => {
    try { await window.exportWorkspaceAsAtelierPackage({ emergency: true, requireCompleteAttachments: true, passphrase: pass }); return 'ok'; }
    catch (error) { return error.name; }
  }, { pass: PASS });
  expect(['MissingAttachmentBlobError', 'AttachmentWarmupError']).toContain(emergency);
});

test('legacy unencrypted .sutra, legacy .atelier, and JSON workspace imports still work', async ({ page }) => {
  test.setTimeout(120000);
  await openApp(page);
  await seedRichWorkspace(page, 'LEGACY');
  const fixtures = await page.evaluate(async () => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const makePayload = (title) => ({ ...base, pages: [{ ...base.pages[0], id: `page-${title}`, title }] });
    const makeZip = async (title) => {
      const result = await window.__sutraPublicBetaTestHooks.createLegacyWorkspacePackageBlob(makePayload(title));
      return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
    };
    const makeAtelierZip = async (title) => {
      const zip = new window.JSZip();
      zip.file('manifest.json', JSON.stringify({
        product: 'NoteFlow Atelier',
        appName: 'NoteFlow Atelier',
        format: 'noteflow_atelier_project',
        formatVersion: 1,
        schemaVersion: 1,
        assets: []
      }));
      zip.file('workspace.json', JSON.stringify(makePayload(title)));
      const blob = await zip.generateAsync({ type: 'blob' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return {
      sutra: await makeZip('Legacy Plain Sutra'),
      atelier: await makeAtelierZip('Legacy Atelier'),
      json: Array.from(new TextEncoder().encode(JSON.stringify(makePayload('JSON Restore'))))
    };
  });

  await page.setInputFiles('#fileInput', { name: 'legacy.sutra', mimeType: '', buffer: Buffer.from(fixtures.sutra) });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Legacy Plain Sutra');

  await page.setInputFiles('#fileInput', { name: 'legacy.atelier', mimeType: 'application/octet-stream', buffer: Buffer.from(fixtures.atelier) });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Legacy Atelier');

  await page.setInputFiles('#fileInput', { name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(fixtures.json) });
  await acceptRestoreConflictChooser(page);
  await completeSafetySnapshotDialog(page);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('JSON Restore');
});

test('workspace and plugin pickers do not use restrictive accept filters and same file can be selected twice', async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => ({
    workspaceAccept: document.getElementById('fileInput').getAttribute('accept'),
    pluginAccept: document.getElementById('modsPluginImportInput').getAttribute('accept')
  }));
  expect(before.workspaceAccept).toBeNull();
  expect(before.pluginAccept).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  const runtime = await page.evaluate(async () => {
    const input = document.getElementById('fileInput');
    const clicks = [];
    const original = input.click.bind(input);
    input.click = function () { clicks.push(input.getAttribute('accept')); };
    window.showCustomConfirmDialog = async () => true;
    await window.importFromFile();
    document.getElementById('importDropBrowseBtn').click();
    input.click = original;
    return clicks;
  });
  expect(runtime).toEqual([null]);

  const { buffer } = await createEncryptedBytes(page, 'TWICE');
  await page.setInputFiles('#fileInput', { name: 'twice.sutra', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await cancelImportPasswordModal(page);
  await page.setInputFiles('#fileInput', { name: 'twice.sutra', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
});

test('export passphrase modal blocks on mismatch and too-short, then exports a valid envelope when matched', async ({ page }) => {
  await openApp(page);
  await seedRichWorkspace(page, 'MODAL');

  // Drive the real dual-field export modal (not the programmatic createBackupBlob API).
  await page.evaluate(() => { window.__sutraExportModalPromise = window.exportWorkspaceAsAtelierPackage(); });
  await expect(page.locator('#sutraBackupPasswordModal')).toHaveClass(/active/);

  // Mismatch: confirm differs from passphrase -> blocked.
  await page.fill('#sutraBackupPassphraseInput', PASS);
  await page.fill('#sutraBackupPassphraseConfirmInput', 'a different passphrase');
  await expect(page.locator('#sutraBackupPasswordError')).toContainText('Passwords do not match.');
  await expect(page.locator('#sutraBackupPasswordSubmitBtn')).toBeDisabled();

  // Too short: both fields match but under the 12-char minimum -> blocked.
  await page.fill('#sutraBackupPassphraseInput', 'shortpw');
  await page.fill('#sutraBackupPassphraseConfirmInput', 'shortpw');
  await expect(page.locator('#sutraBackupPasswordError')).toContainText('Use at least 12 characters.');
  await expect(page.locator('#sutraBackupPasswordSubmitBtn')).toBeDisabled();

  // Matched and long enough -> submit enabled, export produces a real .sutra envelope.
  await page.fill('#sutraBackupPassphraseInput', PASS);
  await page.fill('#sutraBackupPassphraseConfirmInput', PASS);
  await expect(page.locator('#sutraBackupPasswordSubmitBtn')).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sutra_workspace_.*\.sutra$/);
  await expect(page.locator('#sutraBackupPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
});

test('pre-restore safety snapshot is encrypted and never a plaintext JSON side effect', async ({ page }) => {
  test.setTimeout(120000);
  await openApp(page);
  await seedRichWorkspace(page, 'SNAP');
  const healthBefore = await page.evaluate(() =>
    window.serializeWorkspace().settings?.dataHealth?.lastPreImportSnapshotAt || null
  );
  const { buffer, payload } = await createEncryptedBytes(page, 'SNAPTARGET');
  await page.setInputFiles('#fileInput', { name: 'SNAPTARGET.SUTRA', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 30_000 });
  await acceptRestoreConflictChooser(page);

  // The safety-snapshot passphrase dialog appears; capture the download it
  // produces and prove it is an encrypted .sutra envelope containing none of
  // the current workspace's plaintext.
  const downloadPromise = page.waitForEvent('download');
  const modal = page.locator('#sutraBackupPasswordModal');
  await modal.waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#sutraBackupPassphraseInput', PASS);
  await page.fill('#sutraBackupPassphraseConfirmInput', PASS);
  await page.locator('#sutraBackupPasswordSubmitBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sutra_pre_import_snapshot_.*\.sutra$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('SUTRAENC');
  expect(bytes.toString('latin1')).not.toContain('Sentinel Note SNAP');
  const healthAfterDownload = await page.evaluate(() =>
    window.serializeWorkspace().settings?.dataHealth?.lastPreImportSnapshotAt || null
  );
  expect(healthAfterDownload).toBe(healthBefore, 'an unverified browser download must not update the verified safety-snapshot timestamp');

  await expect(modal).not.toHaveClass(/active/, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title), { timeout: 20_000 }).toBe('Sentinel Note SNAPTARGET');
});
