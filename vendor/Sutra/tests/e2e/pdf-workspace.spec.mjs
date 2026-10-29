import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadFixturePdfLib(page) {
  expect(await page.evaluate(() => typeof window.PDFLib)).toBe('undefined');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('assets/vendor/pdf-lib/pdf-lib.min.js?v=1.17.1', document.baseURI).href;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('PDF fixture generator failed to load.')), { once: true });
    document.head.appendChild(script);
  }));
}

test('native PDF workspace stores once, renders locally, persists annotations, and preserves exact-original export', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraPdfWorkspace);
  await loadFixturePdfLib(page);

  const created = await page.evaluate(async () => {
    const documentRecord = await window.PDFLib.PDFDocument.create();
    const pdfPage = documentRecord.addPage([612, 792]);
    pdfPage.drawText('Sutra PDF workspace fixture', { x: 72, y: 710, size: 18 });
    pdfPage.drawText('Selectable local text and a form field.', { x: 72, y: 680, size: 12 });
    const form = documentRecord.getForm();
    const field = form.createTextField('student.name');
    field.setText('Ada');
    field.addToPage(pdfPage, { x: 72, y: 620, width: 220, height: 28 });
    const bytes = new Uint8Array(await documentRecord.save());
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const file = new File([bytes], 'native-workspace-fixture.pdf', { type: 'application/pdf' });
    const [meta] = await window.SutraAttachments.addFiles([file], { entityType: 'note', entityId: 'note-pdf-e2e' });
    await window.SutraPdfWorkspace.open(meta.id, { entityType: 'note', entityId: 'note-pdf-e2e' });
    return { fileId: meta.id, hash, length: bytes.length };
  });

  await expect(page.locator('.pdfw-root')).toBeVisible();
  await expect(page.locator('[data-action="close"]')).toHaveText('Close');
  await expect(page.locator('.pdfw-page canvas')).toHaveCount(1);
  await expect(page.locator('.pdfw-text-layer')).toContainText('Sutra PDF workspace fixture');
  await expect(page.locator('.pdfw-form-field[name="student.name"]')).toHaveValue('Ada');
  await page.locator('.pdfw-form-field[name="student.name"]').fill('Grace Hopper');
  await page.locator('.pdfw-form-field[name="student.name"]').blur();

  const links = await page.evaluate(() => window.SutraAttachments.listForEntity('note', 'note-pdf-e2e'));
  expect(links).toHaveLength(1);
  expect(links[0].id).toBe(created.fileId);

  await page.evaluate(async fileId => {
    const record = window.SutraPdfData.findByFile(fileId);
    window.SutraPdfData.upsertAnnotation({
      id: 'pdf-e2e-highlight', documentId: record.id, pageId: record.pages[0].id,
      type: 'highlight', geometry: { rects: [{ x: 0.1, y: 0.08, width: 0.45, height: 0.04 }] },
      style: { color: '#facc15', opacity: 0.42 }, text: 'Sutra PDF workspace fixture'
    });
    window.SutraPdfData.upsertAnnotation({
      id: 'pdf-e2e-comment', documentId: record.id, pageId: record.pages[0].id,
      type: 'comment', geometry: { x: 0.7, y: 0.12, width: 0.035, height: 0.035 },
      style: { color: '#2563eb', opacity: 1 }, text: 'Unicode comment: पढ़ाई ✓'
    });
    window.SutraPdfWorkspace.close();
    await window.SutraPdfWorkspace.open(fileId, { entityType: 'note', entityId: 'note-pdf-e2e' });
  }, created.fileId);
  await expect(page.locator('[data-annotation-id="pdf-e2e-highlight"]')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.SutraPdfWorkspace.export({ mode: 'original' }));
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const downloaded = await fs.readFile(downloadPath);
  expect(downloaded.length).toBe(created.length);
  expect(crypto.createHash('sha256').update(downloaded).digest('hex')).toBe(created.hash);

  const annotatedDownloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.SutraPdfWorkspace.export({ mode: 'annotated', includeForms: true, includeCommentSummary: true }));
  const annotated = await annotatedDownloadPromise;
  const annotatedBytes = await fs.readFile(await annotated.path());
  expect(annotatedBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(annotatedBytes.length).toBeGreaterThan(100);
  const exportedForm = await page.evaluate(async bytes => {
    const documentRecord = await window.PDFLib.PDFDocument.load(new Uint8Array(bytes));
    return documentRecord.getForm().getTextField('student.name').getText();
  }, Array.from(annotatedBytes));
  expect(exportedForm).toBe('Grace Hopper');
});

test('embedded Notes toolbar controls work and the PDF workspace tears down on note or view changes', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraPdfWorkspace && window.__sutraPublicBetaTestHooks);
  await page.evaluate(() => {
    if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true);
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); overlay.style.setProperty('display', 'none', 'important'); }
  });
  await page.locator('.view-tabs > .view-tab[data-view="notes"]').click();
  await loadFixturePdfLib(page);

  const fixture = await page.evaluate(async () => {
    const hooks = window.__sutraPublicBetaTestHooks;
    const first = hooks.createNoteInActiveSpace('PDF toolbar note', '<p>First note.</p>');
    const second = hooks.createNoteInActiveSpace('PDF toolbar destination', '<p>Second note.</p>');
    window.loadPage(first.id);
    const pdf = await window.PDFLib.PDFDocument.create();
    const pdfPage = pdf.addPage([612, 792]);
    pdfPage.drawText('Embedded Notes toolbar fixture', { x: 72, y: 710, size: 18 });
    const [file] = await window.SutraAttachments.addFiles([
      new File([await pdf.save()], 'embedded-notes.pdf', { type: 'application/pdf' })
    ], { entityType: 'note', entityId: first.id });
    return { noteId: first.id, destinationId: second.id, fileId: file.id };
  });

  await page.evaluate(async ({ fileId, noteId }) => {
    await window.SutraPdfWorkspace.open(fileId, { entityType: 'note', entityId: noteId });
  }, fixture);
  await expect(page.locator('.pdfw-root')).toBeVisible();
  await expect(page.locator('#view-notes .toolbar-wrapper > .pdfw-topbar')).toHaveCount(1);
  await expect(page.locator('#view-notes .toolbar-wrapper > .pdfw-toolbar')).toHaveCount(1);
  await page.locator('#view-notes .pdfw-toolbar [data-action="tool-highlight"]').click();
  await expect(page.locator('#view-notes .pdfw-toolbar [data-action="tool-highlight"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#view-notes .pdfw-topbar [data-action="zoom-in"]').click();
  await expect(page.locator('.pdfw-zoom')).toHaveText('140%');

  await page.evaluate(noteId => window.loadPage(noteId), fixture.destinationId);
  await expect(page.locator('.pdfw-root, #view-notes .pdfw-topbar, #view-notes .pdfw-toolbar')).toHaveCount(0);
  await expect(page.locator('#view-notes .toolbar-wrapper')).not.toHaveClass(/pdf-toolbar-active/);
  await expect(page.locator('#view-notes .toolbar')).not.toHaveClass(/pdf-notes-toolbar-hidden/);

  await page.evaluate(async ({ fileId, noteId }) => {
    await window.SutraPdfWorkspace.open(fileId, { entityType: 'note', entityId: noteId });
  }, fixture);
  await expect(page.locator('.pdfw-root')).toBeVisible();
  await page.locator('.view-tabs > .view-tab[data-view="today"]').click();
  await expect(page.locator('.pdfw-root, #view-notes .pdfw-topbar, #view-notes .pdfw-toolbar')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/pdf-page-active/);
});

test('PDF open generations prevent stale opens and navigation from remounting the workspace', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraPdfWorkspace && window.__sutraPublicBetaTestHooks);
  await page.evaluate(() => {
    if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true);
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); overlay.style.setProperty('display', 'none', 'important'); }
  });
  await page.locator('.view-tabs > .view-tab[data-view="notes"]').click();
  await loadFixturePdfLib(page);

  const fixture = await page.evaluate(async () => {
    const note = window.__sutraPublicBetaTestHooks.createNoteInActiveSpace('PDF open generation', '<p>Workspace owner.</p>');
    window.loadPage(note.id);
    async function addPdf(name) {
      const pdf = await window.PDFLib.PDFDocument.create();
      pdf.addPage([320, 480]).drawText(name, { x: 30, y: 420, size: 14 });
      const [file] = await window.SutraAttachments.addFiles([
        new File([await pdf.save()], name + '.pdf', { type: 'application/pdf' })
      ], { entityType: 'note', entityId: note.id });
      return file.id;
    }
    return { noteId: note.id, firstId: await addPdf('slow'), secondId: await addPdf('latest') };
  });

  await page.evaluate(({ firstId, noteId }) => {
    const originalRead = window.SutraAttachments.readBytes.bind(window.SutraAttachments);
    let release;
    let shouldDelay = true;
    window.__releaseSlowPdfRead = () => release();
    window.SutraAttachments.readBytes = async fileId => {
      if (shouldDelay && fileId === firstId) {
        shouldDelay = false;
        await new Promise(resolve => { release = resolve; });
      }
      return originalRead(fileId);
    };
    window.__slowPdfOpen = window.SutraPdfWorkspace.open(firstId, { entityType: 'note', entityId: noteId });
  }, fixture);
  await page.evaluate(async ({ secondId, noteId }) => {
    await window.SutraPdfWorkspace.open(secondId, { entityType: 'note', entityId: noteId });
  }, fixture);
  await page.evaluate(() => window.__releaseSlowPdfRead());
  await page.evaluate(() => window.__slowPdfOpen);
  await expect(page.locator('.pdfw-root')).toHaveCount(1);
  expect(await page.evaluate(() => window.SutraPdfWorkspace.getContext().fileId)).toBe(fixture.secondId);

  await page.evaluate(({ firstId, noteId }) => {
    let release;
    window.__releaseNavigatingPdfRead = () => release();
    const originalRead = window.SutraAttachments.readBytes.bind(window.SutraAttachments);
    window.SutraAttachments.readBytes = async fileId => {
      if (fileId === firstId) await new Promise(resolve => { release = resolve; });
      return originalRead(fileId);
    };
    window.__navigatingPdfOpen = window.SutraPdfWorkspace.open(firstId, { entityType: 'note', entityId: noteId });
  }, fixture);
  await page.locator('.view-tabs > .view-tab[data-view="today"]').click();
  await expect(page.locator('.pdfw-root')).toHaveCount(0);
  await page.evaluate(() => window.__releaseNavigatingPdfRead());
  await page.evaluate(() => window.__navigatingPdfOpen);
  expect(await page.evaluate(() => window.SutraPdfWorkspace.getContext())).toBeNull();
  await expect(page.locator('.pdfw-root, .pdfw-topbar, .pdfw-toolbar')).toHaveCount(0);
});

test('blank PDF canvases render with an opaque white background', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraPdfWorkspace);
  await loadFixturePdfLib(page);
  await page.evaluate(async () => {
    const pdf = await window.PDFLib.PDFDocument.create();
    pdf.addPage([612, 792]);
    const [file] = await window.SutraAttachments.addFiles([
      new File([await pdf.save()], 'blank-canvas.pdf', { type: 'application/pdf' })
    ], {});
    await window.SutraPdfWorkspace.open(file.id, {});
  });
  await expect(page.locator('.pdfw-page canvas')).toHaveCount(1);
  const pixel = await page.locator('.pdfw-page canvas').evaluate(canvas => {
    const context = canvas.getContext('2d');
    return Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
  });
  expect(pixel[0]).toBeGreaterThan(245);
  expect(pixel[1]).toBeGreaterThan(245);
  expect(pixel[2]).toBeGreaterThan(245);
});

test('PDF page organizer keeps source bytes and requires references to be removed before deletion', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraPdfWorkspace);
  await loadFixturePdfLib(page);
  const result = await page.evaluate(async () => {
    const documentRecord = await window.PDFLib.PDFDocument.create();
    const rotatedPage = documentRecord.addPage([300, 400]);
    rotatedPage.setRotation(window.PDFLib.degrees(90));
    documentRecord.addPage([300, 400]);
    const file = new File([await documentRecord.save()], 'organizer.pdf', { type: 'application/pdf' });
    const [meta] = await window.SutraAttachments.addFiles([file], { entityType: 'assignment', entityId: 'assignment-pdf-e2e' });
    await window.SutraPdfWorkspace.open(meta.id, { entityType: 'assignment', entityId: 'assignment-pdf-e2e' });
    const pdfRecord = window.SutraPdfData.findByFile(meta.id);
    return { fileId: meta.id, documentId: pdfRecord.id, firstPageId: pdfRecord.pages[0].id, sourceRotation: pdfRecord.pages[0].rotation };
  });
  expect(result.sourceRotation).toBe(90);
  await page.locator('[data-action="organizer"]').click();
  await page.locator('.pdfw-organizer-row').first().locator('[data-action="rotate"]').click();
  await expect(page.locator('.pdfw-page canvas')).toHaveCount(2);
  const durable = await page.evaluate(documentId => window.SutraPdfData.getDocument(documentId), result.documentId);
  expect(durable.pages[0].rotation).toBe(180);
  const refused = await page.evaluate(fileId => window.SutraAttachments.remove(fileId), result.fileId);
  expect(refused.removed).toBe(false);
  expect(refused.reason).toBe('referenced');
});

test('Homework and Assignment Studio uploads reuse the canonical attachment bridge', async ({ page }) => {
  await page.goto('/Sutra.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('sutra_startup_sound') !== null);
  await page.waitForFunction(() => window.SutraAttachments && window.SutraHomework && window.SutraAssignmentStudio);
  await loadFixturePdfLib(page);
  const ids = await page.evaluate(() => {
    const task = window.SutraHomework.createTask({ title: 'PDF lab report', dueDate: '2026-09-01' });
    return { taskId: task.id };
  });
  await page.evaluate(taskId => window.SutraAssignmentStudio.open(taskId), ids.taskId);
  await page.locator('[data-studio-tab="links"]').click();
  const pdfBytes = await page.evaluate(async () => {
    const documentRecord = await window.PDFLib.PDFDocument.create();
    const pdfPage = documentRecord.addPage([300, 400]);
    pdfPage.drawText('Assignment attachment', { x: 30, y: 340, size: 14 });
    return Array.from(new Uint8Array(await documentRecord.save()));
  });
  await page.locator('[data-studio-upload]').setInputFiles({ name: 'assignment-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfBytes) });
  await expect(page.locator('[data-file-link]')).toContainText('assignment-source.pdf');

  const studioLinks = await page.evaluate(taskId => window.SutraAttachments.listForEntity('assignment', taskId), ids.taskId);
  expect(studioLinks).toHaveLength(1);
  await page.evaluate(({ fileId, taskId }) => window.SutraAttachments.link(fileId, 'homework', taskId), { fileId: studioLinks[0].id, taskId: ids.taskId });
  const homeworkLinks = await page.evaluate(taskId => window.SutraAttachments.listForEntity('homework', taskId), ids.taskId);
  expect(homeworkLinks).toHaveLength(1);
  expect(homeworkLinks[0].id).toBe(studioLinks[0].id);
});

test('direct file mode uses the same-thread local PDF.js fallback', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Direct-file fallback is certified in Chromium; served mode covers the cross-browser matrix.');
  await page.goto(pathToFileURL(path.resolve(process.cwd(), 'Sutra.html')).href);
  await page.waitForFunction(() => window.SutraPdfAdapter && window.pdfjsLib && window.pdfjsWorker);
  await loadFixturePdfLib(page);
  const result = await page.evaluate(async () => {
    const source = await window.PDFLib.PDFDocument.create();
    const sourcePage = source.addPage([320, 480]); sourcePage.drawText('Direct file PDF fallback', { x: 40, y: 400, size: 16 });
    const bytes = new Uint8Array(await source.save());
    const loaded = await window.SutraPdfAdapter.load(bytes);
    const first = await loaded.getPage(1); const text = await first.getTextContent();
    if (loaded.cleanup) await loaded.cleanup();
    return { pages: loaded.numPages, text: text.items.map(item => item.str).join(' ') };
  });
  expect(result.pages).toBe(1);
  expect(result.text).toContain('Direct file PDF fallback');
});
