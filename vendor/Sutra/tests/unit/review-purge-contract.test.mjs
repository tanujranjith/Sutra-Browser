import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const reviewSource = readFileSync(new URL('../../src/features/study/review.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

function loadPurgeNoteContent() {
  const extract = extractFunction(reviewSource, 'purgeNoteContent');
  assert.ok(extract, 'purgeNoteContent is declared in review.js');
  const run = new Function(
    'safeWorkspace',
    'persist',
    `${extract.body}\n; return purgeNoteContent;`
  );
  return { run, body: extract.body };
}

function makeWorkspace(overrides = {}) {
  return {
    decks: [
      { id: 'deck-note', name: 'From note', sourceType: 'note', sourceId: 'page1', sourceNoteId: 'page1' },
      { id: 'deck-course', name: 'From course', sourceType: 'course', sourceId: 'course1', sourceNoteId: null },
      { id: 'deck-legacy', name: 'Legacy note', sourceType: 'note', sourceId: null, sourceNoteId: 'page2' }
    ],
    items: [
      { id: 'i1', deckId: 'deck-note', prompt: 'q', sourceNoteId: 'page1' },
      { id: 'i2', deckId: 'deck-course', prompt: 'q', sourceNoteId: null },
      { id: 'i3', deckId: 'deck-legacy', prompt: 'q', sourceNoteId: 'page2' },
      { id: 'i4', deckId: 'deck-course', prompt: 'q', sourceType: 'note', sourceId: 'page1', sourceNoteId: null }
    ],
    sessions: [
      { id: 's1', deckIds: ['deck-note', 'deck-course'] },
      { id: 's2', deckIds: ['deck-course'] },
      { id: 's3', deckIds: ['deck-legacy'] }
    ],
    ...overrides
  };
}

function purgeWith(run, workspace) {
  let persisted = 0;
  const result = run(
    () => workspace,
    () => { persisted += 1; }
  )(['page1', 'page2']);
  return { workspace, result, persisted };
}

test('purgeNoteContent removes decks, cards, and sessions derived from deleted notes', () => {
  const { run } = loadPurgeNoteContent();
  const ws = makeWorkspace();
  const { workspace, result, persisted } = purgeWith(run, ws);

  assert.deepEqual(workspace.decks.map(d => d.id), ['deck-course'], 'note-derived decks are removed');
  assert.deepEqual(workspace.items.map(i => i.id), ['i2'], 'cards cascade with their deck and by source');
  assert.deepEqual(workspace.sessions.map(s => s.id), ['s2'], 'sessions referencing removed decks are removed');
  assert.deepEqual(result, { decks: 2, items: 3, sessions: 2 });
  assert.equal(persisted, 1, 'purge persists once when anything changed');
});

test('purgeNoteContent leaves non-note decks untouched and persists nothing on no-ops', () => {
  const { run } = loadPurgeNoteContent();
  const ws = makeWorkspace();
  let persisted = 0;
  const result = run(
    () => ws,
    () => { persisted += 1; }
  )(['unrelated-page']);
  assert.deepEqual(result, { decks: 0, items: 0, sessions: 0 });
  assert.equal(persisted, 0);
  assert.equal(ws.decks.length, 3);
});

test('purgeNoteContent fails closed when the workspace is unavailable', () => {
  const { run } = loadPurgeNoteContent();
  const result = run(() => null, () => { throw new Error('must not persist'); })(['page1']);
  assert.deepEqual(result, { failed: true });
});

test('executePageDeletion permanent branch purges Review content and aborts fail-closed', () => {
  const execute = extractFunction(appSource, 'executePageDeletion');
  assert.ok(execute, 'executePageDeletion is declared in app.js');
  const permanentSection = execute.body.slice(execute.body.indexOf('const permanent'));
  assert.ok(permanentSection.includes('purgeReviewContentForDeletedPages(idsToDelete)'),
    'permanent branch invokes the Review purge');
  assert.ok(permanentSection.includes("typeof window.purgeReviewContentForNoteIds !== 'function'"),
    'purge helper routes through the registered Review seam');
  assert.ok(permanentSection.includes('result.failed === true'), 'purge failure aborts the deletion');
  assert.ok(execute.body.includes('Review content could not be cleared'),
    'user-visible failure message exists');
});

test('review.js registers the purge seam on window', () => {
  assert.ok(reviewSource.includes('window.purgeReviewContentForNoteIds = function (noteIds)'),
    'registration uses the window form the guardrail inventory can see');
});
