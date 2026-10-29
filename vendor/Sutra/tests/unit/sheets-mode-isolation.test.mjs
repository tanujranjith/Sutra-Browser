import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../src/features/workspace/sheets.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../styles/features/sheets.css', import.meta.url), 'utf8');

test('Sheets keeps an inactive editor out of the layout and accessibility tree', () => {
  assert.match(styles, /\.sheets-editor\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(source, /rootValue\.hidden\s*=\s*true/);
  assert.match(source, /rootValue\.setAttribute\('inert'/);
  assert.match(source, /rootValue\.setAttribute\('aria-hidden',\s*'true'\)/);
});

test('Sheets uses the canonical page bridge and authorization boundary', () => {
  assert.match(source, /global\.flowAtelier/);
  assert.match(source, /value\.isPageContentAuthorized/);
  assert.match(source, /bridge\(\)\.persistAppData\(\)/);
  assert.doesNotMatch(source, /localStorage\.setItem|fetch\(|XMLHttpRequest/);
});

test('grid rendering is viewport based rather than materializing the whole sheet', () => {
  assert.match(source, /sheetLimit\(sheet, 'row'\)/);
  assert.match(source, /firstRow/);
  assert.match(source, /lastRow/);
  assert.match(source, /canvas\.replaceChildren\(\)/);
});
