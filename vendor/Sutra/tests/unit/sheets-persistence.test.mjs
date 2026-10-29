import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const inventory = JSON.parse(await readFile(new URL('../../docs/architecture/persistence-inventory.json', import.meta.url), 'utf8'));
const sheets = await readFile(new URL('../../src/features/workspace/sheets.js', import.meta.url), 'utf8');

test('spreadsheet is an inventoried page-owned durable field', () => {
  assert.ok(inventory.nestedPersistentContracts['pages[]'].includes('spreadsheet'));
  assert.match(sheets, /spreadsheet:\s*engine\(\)\.normalizeWorkbook/);
  assert.match(sheets, /value\.persistAppData\(\)/);
});

test('session-only editor state is not persisted through browser storage', () => {
  assert.match(sheets, /var activePageId.*var editing.*var undo/s);
  assert.doesNotMatch(sheets, /localStorage\.setItem|indexedDB\.open|fetch\(|XMLHttpRequest/);
});
