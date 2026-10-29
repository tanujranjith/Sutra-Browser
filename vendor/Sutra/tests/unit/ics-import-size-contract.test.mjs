import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

test('ICS import preflights file size before reading text', () => {
  const handler = extractFunction(appSource, 'handleCalendarIcsSelected');
  assert.ok(handler, 'handleCalendarIcsSelected is a top-level declaration');
  const readCall = handler.body.indexOf('readFileAsText(file)');
  const preflight = handler.body.indexOf('assertIcsImportSize(file)');
  assert.ok(preflight >= 0, 'ICS handler checks the size limit');
  assert.ok(preflight < readCall, 'size preflight runs before the file is read');
  assert.ok(handler.body.includes("return;"), 'refused files stop the import');
});

test('smart import refuses oversized text and ICS files before reading them', () => {
  const loadMarker = "querySelector('#smartImportFileInput')?.addEventListener('change'";
  const markerIndex = appSource.indexOf(loadMarker);
  assert.ok(markerIndex >= 0, 'smart import file loader is present');
  const section = appSource.slice(markerIndex, markerIndex + 1200);
  assert.ok(section.includes('assertIcsImportSize(file)'), 'smart import checks the size limit');
  assert.ok(section.includes('file.text()'), 'smart import still reads allowed files');
  const preflight = section.indexOf('assertIcsImportSize(file)');
  const readCall = section.indexOf('file.text()');
  assert.ok(preflight >= 0 && readCall >= 0 && preflight < readCall,
    'size preflight runs before file.text()');
});

test('ICS import limit is bounded and consistent with the toast copy', () => {
  const extract = extractFunction(appSource, 'assertIcsImportSize');
  assert.ok(extract, 'assertIcsImportSize is a top-level declaration');
  const sanitize = new Function(`return (${extract.body});`)();
  const sizeField = extract.body.match(/MAX_ICS_IMPORT_BYTES/);
  assert.ok(sizeField, 'the guard uses the dedicated ICS limit');
  const constants = appSource.slice(appSource.indexOf('MAX_ICS_IMPORT_BYTES ='), appSource.indexOf('MAX_ICS_IMPORT_BYTES =') + 60);
  assert.match(constants, /25 \* 1024 \* 1024/, 'the ICS cap is 25 MB');
  assert.ok(extract.body.includes('formatByteCount'), 'refusal message is human readable');
});

test('ICS limit is declared exactly once and is visible to the handler closure', () => {
  const matches = appSource.match(/const MAX_ICS_IMPORT_BYTES/g) || [];
  assert.equal(matches.length, 1, 'the ICS limit must not be shadowed or duplicated');
  assert.ok(appSource.includes('function assertIcsImportSize'), 'the guard helper is a top-level declaration');
  assert.ok(appSource.includes('async function handleCalendarIcsSelected'), 'the ICS handler is a top-level declaration');
  const handler = extractFunction(appSource, 'handleCalendarIcsSelected');
  assert.ok(!handler.body.includes('MAX_ICS_IMPORT_BYTES ='), 'the handler does not redefine the limit');
});
