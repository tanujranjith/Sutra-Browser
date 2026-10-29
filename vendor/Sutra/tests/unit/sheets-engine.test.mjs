import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Sheets = require('../../src/features/workspace/sheets-engine.js');

function book() { return Sheets.createWorkbook('Test'); }
function set(sheet, row, column, cell) { Sheets.setCell(sheet, row, column, cell); }

test('uses stable row and column ids with sparse cells', () => {
  const workbook = book(); const sheet = workbook.sheets[0];
  const key = Sheets.cellKey(sheet, 0, 0); set(sheet, 0, 0, { value: 'hello' });
  assert.equal(Object.keys(sheet.cells).length, 1); assert.match(key, /^row_[^:]+:col_/);
  set(sheet, 0, 0, { value: '' }); assert.equal(Object.keys(sheet.cells).length, 0);
});

test('evaluates arithmetic, ranges, cross-sheet formulas, and errors', () => {
  const workbook = book(); const one = workbook.sheets[0]; const two = Sheets.createSheet('Sheet2'); workbook.sheets.push(two);
  set(one, 0, 0, { value: 2 }); set(one, 1, 0, { value: 3 }); set(one, 0, 1, { formula: '=SUM(A1:A2)*2' }); set(two, 0, 0, { formula: '=Sheet1!B1+1' }); set(one, 0, 2, { formula: '=1/0' });
  const evaluation = Sheets.evaluate(workbook);
  assert.equal(evaluation.getValue(one, 0, 1), 10); assert.equal(evaluation.getValue(two, 0, 0), 11); assert.equal(evaluation.getValue(one, 0, 2).error, '#DIV/0!');
});

test('supports relative, absolute, and mixed formula fill translation', () => {
  assert.equal(Sheets.translateFormula('=A1+$B$2+C$3+$D4', 2, 1), '=B3+$B$2+D$3+$D6');
});

test('detects a cycle deterministically', () => {
  const workbook = book(); const sheet = workbook.sheets[0]; set(sheet, 0, 0, { formula: '=B1' }); set(sheet, 0, 1, { formula: '=A1' });
  assert.equal(Sheets.evaluate(workbook).getValue(sheet, 0, 0).error, '#CYCLE!');
});

test('normalizes V1 workbooks to V2 while preserving unknown fields', () => {
  const source = book();
  source.version = 1;
  source.futureWorkbookField = { keep: true };
  source.sheets[0].futureSheetField = 'kept';
  source.sheets[0].rows[0].futureRowField = 'kept';
  source.sheets[0].columns[0].futureColumnField = 'kept';
  const normalized = Sheets.normalizeWorkbook(source);
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.futureWorkbookField, { keep: true });
  assert.equal(normalized.sheets[0].futureSheetField, 'kept');
  assert.equal(normalized.sheets[0].rows[0].futureRowField, 'kept');
  assert.equal(normalized.sheets[0].columns[0].futureColumnField, 'kept');
  assert.deepEqual(normalized.sheets[0].conditionalFormats, []);
  assert.deepEqual(normalized.sheets[0].charts, []);
});

test('rewrites structural row and column references', () => {
  assert.equal(Sheets.rewriteFormulaForStructure('=SUM(A1:B4)+$C$2', 'row', 1, 1), '=SUM(A1:B5)+$C$3');
  assert.equal(Sheets.rewriteFormulaForStructure('=A2+B3', 'row', 1, -1), '=#REF!+B2');
  assert.equal(Sheets.rewriteFormulaForStructure('=B1+$D2', 'column', 1, 1), '=C1+$E2');
});

test('evaluates named ranges and keeps them formula-aware during structural edits', () => {
  const workbook = Sheets.createWorkbook('Named ranges');
  const sheet = workbook.sheets[0];
  Sheets.setCell(sheet, 0, 0, { value: 4 });
  Sheets.setCell(sheet, 1, 0, { value: 6 });
  workbook.namedRanges.StudyScores = "'Sheet1'!A1:A2";
  Sheets.setCell(sheet, 0, 1, { formula: '=SUM(StudyScores)' });
  assert.equal(Sheets.evaluate(workbook).getValue(sheet, 0, 1), 10);
  Sheets.rewriteWorkbookFormulas(workbook, 'row', 0, 1);
  assert.equal(workbook.namedRanges.StudyScores, "'Sheet1'!A2:A3");
});

test('supports additional V2 statistical, lookup, text, and date formulas', () => {
  const workbook = book(); const sheet = workbook.sheets[0];
  set(sheet, 0, 0, { value: 2 }); set(sheet, 1, 0, { value: 8 }); set(sheet, 2, 0, { value: 5 });
  set(sheet, 0, 1, { formula: '=MEDIAN(A1:A3)' });
  set(sheet, 1, 1, { formula: '=MATCH(8,A1:A3,0)' });
  set(sheet, 2, 1, { formula: '=SUBSTITUTE("student plan","plan","home")' });
  const evaluation = Sheets.evaluate(workbook);
  assert.equal(evaluation.getValue(sheet, 0, 1), 5);
  assert.equal(evaluation.getValue(sheet, 1, 1), 2);
  assert.equal(evaluation.getValue(sheet, 2, 1), 'student home');
});
