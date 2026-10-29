import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => window.flowAtelier && window.SutraAttachments && window.SutraPdfWorkspace);
  await waitForAppReady(page);
}

async function loadFixturePdfLib(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('assets/vendor/pdf-lib/pdf-lib.min.js?v=1.17.1', document.baseURI).href;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('PDF fixture generator failed to load.')), { once: true });
    document.head.appendChild(script);
  }));
}

test('filename imports create leaf Notes in the active Space and retain Share Target titles', async ({ page }) => {
  await openApp(page);
  await loadFixturePdfLib(page);

  const imported = await page.evaluate(async () => {
    const added = [];
    const importAndFind = async (file, importFile) => {
      const previousIds = new Set(window.flowAtelier.pages.map(note => note.id));
      const ok = await importFile(file);
      const created = window.flowAtelier.pages.find(note => !previousIds.has(note.id));
      if (!ok || !created) throw new Error(`Import failed for ${file.name}`);
      added.push(created.id);
      return created;
    };

    const textNote = await importAndFind(
      new File(['Filename import body'], 'Chapter::Notes.md', { type: 'text/markdown' }),
      file => window.importWorkspaceFile(file)
    );
    const sharedNote = await importAndFind(
      new File(['Shared file body'], 'Imported::share-source.md', { type: 'text/markdown' }),
      file => window.flowAtelier.importSharedFiles([file], { title: 'Shared assignment' })
    );

    const pdfDocument = await window.PDFLib.PDFDocument.create();
    pdfDocument.addPage([612, 792]).drawText('PDF import fixture', { x: 72, y: 710, size: 18 });
    const pdfBytes = await pdfDocument.save();
    const pdfNote = await importAndFind(
      new File([pdfBytes], 'Review::Packet.pdf', { type: 'application/pdf' }),
      file => window.importWorkspaceFile(file)
    );
    window.SutraPdfWorkspace.close();

    const ids = new Set(added);
    const createdNotes = window.flowAtelier.pages.filter(note => ids.has(note.id));
    const pdfLinks = window.SutraAttachments.listForEntity('note', pdfNote.id);
    await window.flowAtelier.flushAppSaveNow('normal-file-import-assertions');
    const jsonExport = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return {
      activeSpaceId: window.flowAtelier.activeSpaceId,
      notes: createdNotes.map(note => ({ id: note.id, title: note.title, content: note.content, spaceId: note.spaceId })),
      syntheticParents: createdNotes.filter(note => note.title === 'Imported' || note.title === 'PDF' || note.title.includes('::')),
      pdfLinkCount: pdfLinks.length,
      exportedIds: jsonExport.pages.filter(note => ids.has(note.id)).map(note => note.id)
    };
  });

  expect(imported.notes.map(note => note.title)).toEqual(['Chapter:Notes', 'Shared assignment', 'Review:Packet']);
  expect(imported.notes.every(note => note.spaceId === imported.activeSpaceId)).toBe(true);
  expect(imported.syntheticParents).toEqual([]);
  expect(imported.pdfLinkCount).toBe(1);
  expect(new Set(imported.exportedIds)).toEqual(new Set(imported.notes.map(note => note.id)));
  expect(imported.notes[0].content).toContain('Filename import body');
  expect(imported.notes[1].content).toContain('Shared file body');
  expect(imported.notes[2].content).toContain('Linked PDF');

  await page.reload();
  await page.waitForFunction(() => window.flowAtelier && window.SutraAttachments);
  await waitForAppReady(page);
  const persisted = await page.evaluate(ids => {
    const idSet = new Set(ids);
    return window.flowAtelier.pages.filter(note => idSet.has(note.id)).map(note => ({
      id: note.id,
      title: note.title,
      spaceId: note.spaceId
    }));
  }, imported.notes.map(note => note.id));
  expect(persisted.map(note => note.title)).toEqual(['Chapter:Notes', 'Shared assignment', 'Review:Packet']);
  expect(persisted.every(note => note.spaceId === imported.activeSpaceId)).toBe(true);
});
