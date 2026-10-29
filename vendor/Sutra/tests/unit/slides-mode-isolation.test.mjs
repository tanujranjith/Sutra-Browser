import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const slidesSource = await readFile(new URL('../../src/features/workspace/slides.js', import.meta.url), 'utf8');
const slidesStyles = await readFile(new URL('../../styles/features/slides.css', import.meta.url), 'utf8');

test('hidden Slides editor cannot render beneath Notepad or Canvas', () => {
  assert.match(
    slidesStyles,
    /\.slides-editor\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s,
    'Slides must explicitly preserve hidden display because its author flex rule overrides the browser default'
  );
});

test('Slides visibility makes inactive editor inert and hidden from accessibility APIs', () => {
  assert.match(slidesSource, /function setEditorVisible\(visible\)/);
  assert.match(slidesSource, /root\.hidden\s*=\s*!visible/);
  assert.match(slidesSource, /root\.toggleAttribute\('inert',\s*!visible\)/);
  assert.match(slidesSource, /root\.setAttribute\('aria-hidden',\s*visible\s*\?\s*'false'\s*:\s*'true'\)/);
  assert.match(slidesSource, /else setEditorVisible\(false\)/);
});

test('Slides mutations use the canonical page bridge instead of whole-workspace restore', () => {
  assert.match(slidesSource, /function appBridge\(\)/);
  assert.match(slidesSource, /global\.flowAtelier/);
  assert.match(slidesSource, /bridge\.pages/);
  assert.match(slidesSource, /page\.updatedAt\s*=\s*new Date\(\)\.toISOString\(\)/);
  assert.match(slidesSource, /appBridge\(\)\.persistAppData\(\)/);
  assert.doesNotMatch(slidesSource, /serializeWorkspace|deserializeWorkspace/);
});

test('Slides Assistant edits stay typed, canonical, local, and undoable', () => {
  assert.match(slidesSource, /function validateAssistantOperations\(operations, options\)/);
  assert.match(slidesSource, /engine\.applySlides\(page\.slides, operations/);
  assert.match(slidesSource, /function undoAssistantMutation\(payload\)/);
  assert.match(slidesSource, /engine\.undoSlides\(page\.slides, payload\)/);
  assert.match(slidesSource, /page\.slides\s*=\s*restored\.model/);
  assert.doesNotMatch(slidesSource, /fetch\(|XMLHttpRequest/);
});

test('Slides uses the canonical locked-page authorization boundary', () => {
  assert.match(slidesSource, /function pageContentAuthorized\(page\)/);
  assert.match(slidesSource, /bridge\.isPageContentAuthorized/);
  assert.match(slidesSource, /page && pageContentAuthorized\(page\) \? page : null/);
  assert.match(slidesSource, /page && pageContentAuthorized\(page\) && page\.slides/);
});

test('Slides workbench keeps manipulation session-scoped and uses canonical page persistence', () => {
  assert.match(slidesSource, /function slidesUndo\(\)/);
  assert.match(slidesSource, /function beginElementDrag/);
  assert.match(slidesSource, /function syncElementInspector/);
  assert.match(slidesSource, /page\.slides\s*=\s*cloneDeck\(entry\.deck\)/);
  assert.match(slidesSource, /page\.updatedAt\s*=\s*new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(slidesSource, /localStorage\.setItem|fetch\(|XMLHttpRequest/);
});
