import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => !!window.flowAtelier && !!window.JSZip && !!window.SutraOfficeInterop);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('office-offline-ready'));
}

test('a fresh installed app can import DOCX and XLSX after going offline', async ({ page, context }, testInfo) => {
  const unexpectedParserRequests = [];
  page.on('request', (request) => {
    if (/\b(?:unpkg|cdnjs|jsdelivr)\b/i.test(request.url())) unexpectedParserRequests.push(request.url());
  });
  await openApp(page);
  const cacheState = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const cache = await caches.open(names.find((name) => name.startsWith('sutra-cache-')));
    const docx = await cache.match('/assets/vendor/office/mammoth.browser.min.js?v=1.8.0');
    const xlsx = await cache.match('/assets/vendor/office/xlsx.full.min.js?v=0.18.5');

    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Offline DOCX evidence</w:t></w:r></w:p></w:body></w:document>');
    const docxBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const engine = window.SutraSheetsEngine;
    const book = engine.createWorkbook('Offline sheet');
    engine.setCell(book.sheets[0], 0, 0, { value: 'Offline XLSX evidence' });
    const xlsxBlob = await window.SutraOfficeInterop.exportXlsx(book);
    return {
      docxCached: !!docx,
      xlsxCached: !!xlsx,
      docxBytes: Array.from(new Uint8Array(await docxBlob.arrayBuffer())),
      xlsxBytes: Array.from(new Uint8Array(await xlsxBlob.arrayBuffer()))
    };
  });
  expect({ docx: cacheState.docxCached, xlsx: cacheState.xlsxCached }).toEqual({ docx: true, xlsx: true });

  const docxPath = testInfo.outputPath('offline-evidence.docx');
  const xlsxPath = testInfo.outputPath('offline-evidence.xlsx');
  const malformedPath = testInfo.outputPath('malformed.docx');
  await mkdir(dirname(docxPath), { recursive: true });
  await writeFile(docxPath, Buffer.from(cacheState.docxBytes));
  await writeFile(xlsxPath, Buffer.from(cacheState.xlsxBytes));
  await writeFile(malformedPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  // Playwright WebKit's setOffline(true) also disables local Blob/File I/O.
  // Abort network requests instead so this exercises a real offline import:
  // OS-backed files remain readable and parser scripts must come from the SW cache.
  await context.route('**/*', (route) => route.abort());
  try {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'officeOfflineFiles';
      input.type = 'file';
      input.multiple = true;
      document.body.appendChild(input);
    });
    await page.locator('#officeOfflineFiles').setInputFiles([docxPath, xlsxPath, malformedPath]);
    const result = await page.evaluate(async () => {
      const [docx, xlsx, malformed] = Array.from(document.getElementById('officeOfflineFiles').files || []);
      const binaryProbe = {};
      try { binaryProbe.fileBytes = (await docx.arrayBuffer()).byteLength; }
      catch (error) { binaryProbe.fileError = error && error.message; }
      FileReader.prototype.readAsArrayBuffer = function () {
        throw new Error('Office import must prefer File.arrayBuffer when available.');
      };
      const docxOk = await window.importWorkspaceFile(docx);
      const xlsxOk = await window.importWorkspaceFile(xlsx);
      const pageCountBeforeMalformed = window.flowAtelier.pages.length;
      const malformedOk = await window.importWorkspaceFile(malformed);
      const pages = window.flowAtelier.pages;
      return {
        docxOk,
        xlsxOk,
        malformedOk,
        malformedCreatedPage: pages.length !== pageCountBeforeMalformed,
        binaryProbe,
        importedNotes: pages.filter((item) => item.title === 'offline-evidence').map((item) => ({
          id: item.id,
          content: item.content,
          spaceId: item.spaceId
        })),
        activeSpaceId: window.flowAtelier.activeSpaceId,
        syntheticImportedParents: pages.filter((item) => item.title === 'Imported' || item.title.startsWith('Imported::')).length
      };
    });
    expect(result.binaryProbe.fileBytes).toBeGreaterThan(0);
    expect(result.docxOk, JSON.stringify(result.binaryProbe)).toBe(true);
    expect(result.xlsxOk).toBe(true);
    expect(result.malformedOk).toBe(false);
    expect(result.malformedCreatedPage).toBe(false);
    expect(result.importedNotes).toHaveLength(2);
    expect(new Set(result.importedNotes.map((item) => item.id)).size).toBe(2);
    expect(result.importedNotes.every((item) => item.spaceId === result.activeSpaceId)).toBe(true);
    expect(result.syntheticImportedParents).toBe(0);
    expect(result.importedNotes.some((item) => item.content.includes('Offline DOCX evidence'))).toBe(true);
    expect(result.importedNotes.some((item) => item.content.includes('Offline XLSX evidence'))).toBe(true);
    expect(unexpectedParserRequests).toEqual([]);
  } finally {
    await context.unroute('**/*');
  }
});
