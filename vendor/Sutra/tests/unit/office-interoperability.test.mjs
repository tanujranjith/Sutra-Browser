import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
globalThis.JSZip = JSZip;
const Sheets = require('../../src/features/workspace/sheets-engine.js');
const Office = require('../../src/features/workspace/office-interoperability.js');

test('CSV parser handles quoted separators, escaped quotes, and newlines', () => {
  assert.deepEqual(Office.parseDelimited('Name,Note\r\nAda,"Hello, world"\r\nLin,"A ""quote"""', ','), [
    ['Name', 'Note'],
    ['Ada', 'Hello, world'],
    ['Lin', 'A "quote"']
  ]);
});

test('CSV import/export preserves values and formulas', () => {
  const workbook = Office.workbookFromDelimited('Item,Score\nQuiz,8\nTotal,=SUM(B2:B2)', { delimiter: ',', title: 'Grades' });
  const sheet = workbook.sheets[0];
  assert.equal(workbook.version, 2);
  assert.equal(Sheets.cellAt(sheet, 1, 1).value, 8);
  assert.equal(Sheets.cellAt(sheet, 2, 1).formula, '=SUM(B2:B2)');
  assert.match(Office.exportDelimited(workbook, sheet.id, ','), /Total,=SUM\(B2:B2\)/);
});

test('XLSX export creates a standards-shaped local Office package', async () => {
  const workbook = Sheets.createWorkbook('Lab results');
  const sheet = workbook.sheets[0];
  sheet.name = 'Data';
  Sheets.setCell(sheet, 0, 0, { value: 'Trial' });
  workbook.styles.score = { fontWeight: '700', textAlign: 'center', backgroundColor: '#DBEAFE', numberFormat: 'currency', border: '1px solid #9ca3af' };
  Sheets.setCell(sheet, 0, 1, { value: 12, styleId: 'score' });
  Sheets.setCell(sheet, 1, 1, { formula: '=B1*2' });
  sheet.frozen.rows = 1;
  sheet.merges.push('A3:B3');
  const blob = await Office.exportXlsx(workbook);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file('[Content_Types].xml'));
  assert.ok(zip.file('xl/workbook.xml'));
  assert.ok(zip.file('xl/worksheets/sheet1.xml'));
  assert.ok(zip.file('xl/styles.xml'));
  const worksheet = await zip.file('xl/worksheets/sheet1.xml').async('text');
  assert.match(worksheet, /state="frozen"/);
  assert.match(worksheet, /mergeCell ref="A3:B3"/);
  assert.match(worksheet, /<f>B1\*2<\/f>/);
  assert.match(worksheet, /r="B1" s="1"/);
  const styles = await zip.file('xl/styles.xml').async('text');
  assert.match(styles, /horizontal="center"/);
  assert.match(styles, /FFDBEAFE/);
  assert.match(styles, /numFmtId="164"/);
});

test('PPTX export creates a standards-shaped PowerPoint package and losslessly reimports Sutra decks', async () => {
  const deck = {
    version: 2,
    title: 'Biology review',
    size: 'widescreen',
    theme: 'sutra',
    slides: [{
      id: 'slide-1',
      title: 'Cell structure',
      background: '#FFFFFF',
      speakerNotes: 'Explain the diagram before the table.',
      elements: [
        { id: 'title', type: 'text', text: 'Cell structure', x: 8, y: 8, width: 80, height: 14, fontSize: 6, fontWeight: 'bold', color: '#173D2B' },
        { id: 'table', type: 'table', rows: [['Part', 'Role'], ['Nucleus', 'DNA']], text: 'Part\tRole\nNucleus\tDNA', x: 10, y: 30, width: 50, height: 30 },
        { id: 'chart', type: 'chart', chart: { labels: ['A', 'B'], values: [3, 7] }, x: 65, y: 30, width: 25, height: 35 }
      ]
    }]
  };
  const blob = await Office.exportPptx(deck);
  const bytes = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('ppt/presentation.xml'));
  assert.ok(zip.file('ppt/slideMasters/slideMaster1.xml'));
  assert.ok(zip.file('ppt/slideLayouts/slideLayout1.xml'));
  assert.ok(zip.file('ppt/theme/theme1.xml'));
  assert.ok(zip.file('ppt/slides/slide1.xml'));
  assert.ok(zip.file('ppt/sutra-deck.json'));
  assert.match(await zip.file('ppt/presentation.xml').async('text'), /presentationml\/2006\/main/);
  assert.match(await zip.file('ppt/slides/slide1.xml').async('text'), /Cell structure/);
  const imported = await Office.importPptx(bytes);
  assert.deepEqual(imported.deck, deck);
  assert.deepEqual(imported.report.warnings, []);
});

test('macro-enabled Office packages fail explicitly', async () => {
  const zip = new JSZip();
  zip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3]));
  const blob = await zip.generateAsync({ type: 'blob' });
  const bytes = await blob.arrayBuffer();
  await assert.rejects(() => Office.importXlsx(bytes), /Macro-enabled workbooks are not supported/);
});

test('macro-enabled PowerPoint packages fail explicitly', async () => {
  const zip = new JSZip();
  zip.file('ppt/vbaProject.bin', new Uint8Array([1, 2, 3]));
  const bytes = await (await zip.generateAsync({ type: 'blob' })).arrayBuffer();
  await assert.rejects(() => Office.importPptx(bytes), /Macro-enabled presentations are not supported/);
});

test('Office imports reject oversized files and suspicious ZIP expansion before parsing content', () => {
  assert.throws(
    () => Office._test.validateOfficeInput({ byteLength: (25 * 1024 * 1024) + 1 }),
    /25 MB or smaller/
  );
  assert.throws(
    () => Office._test.validateOfficePackage({
      files: { 'xl/workbook.xml': { _data: { uncompressedSize: (100 * 1024 * 1024) + 1 } } }
    }),
    /100 MB safety limit/
  );
  const files = {};
  for (let index = 0; index < 2501; index += 1) files[`part-${index}.xml`] = { _data: { uncompressedSize: 1 } };
  assert.throws(() => Office._test.validateOfficePackage({ files }), /too many parts/);
});
