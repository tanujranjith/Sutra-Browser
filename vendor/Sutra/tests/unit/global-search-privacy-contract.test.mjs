import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

function loadGlobalSearch() {
  const extract = extractFunction(app, 'globalSearchAll');
  assert.ok(extract, 'globalSearchAll must be a top-level declaration');
  return new Function(
    'pages',
    'tasks',
    'timeBlocks',
    'habits',
    'sutraFuzzyScore',
    `${extract.body}; return globalSearchAll;`
  );
}

const fuzzy = (title, query) => (String(title).toLowerCase().includes(String(query).toLowerCase()) ? 1 : 0);
const lockedPage = { id: 'secret-note', title: 'Private journal', content: '<p>NEVER-SNIPPET password hint</p>', isLocked: true, lockHash: 'abc' };
const openPage = { id: 'open-note', title: 'Biology', content: '<p>mitochondria is the powerhouse</p>' };

test('global search returns a complete empty skeleton for an empty query', () => {
  const search = loadGlobalSearch()([], [], [], [], fuzzy)('');
  assert.deepEqual(search, {
    notes: [], tasks: [], homework: [], courses: [], resources: [], apstudy: [], college: [],
    timeline: [], review: [], trackers: [], assistant: [], settings: []
  });
});

test('locked pages match only on title and never leak body snippets', () => {
  const search = loadGlobalSearch()([lockedPage], [], [], [], fuzzy)('password hint');
  assert.equal(search.notes.length, 0, 'locked body content must not be searchable');
  const byTitle = loadGlobalSearch()([lockedPage], [], [], [], fuzzy)('journal');
  assert.equal(byTitle.notes.length, 1, 'locked pages still match on title');
  assert.equal(byTitle.notes[0].context, 'Locked page', 'context flags the lock instead of showing a snippet');
});

test('session-unlocked locked pages become searchable again', () => {
  const extract = extractFunction(app, 'globalSearchAll');
  const search = new Function(
    'pages',
    'tasks',
    'timeBlocks',
    'habits',
    'unlockedPageIds',
    'sutraFuzzyScore',
    `${extract.body}; return globalSearchAll;`
  )([lockedPage], [], [], [], new Set(['secret-note']), fuzzy)('password hint');
  assert.equal(search.notes.length, 1, 'an unlocked-in-session note is searchable by body');
  assert.ok(!search.notes[0].context.includes('NEVER-SNIPPET password hint'), 'snippets are still bounded to 80 chars');
});

test('open notes surface short bounded snippets, never full content', () => {
  const search = loadGlobalSearch()([openPage], [], [], [], fuzzy)('mitochondria');
  assert.equal(search.notes.length, 1);
  assert.ok(search.notes[0].context.includes('mitochondria'), 'matching snippet is shown');
  assert.ok(search.notes[0].context.length <= 80, 'snippets are bounded');
  assert.ok(!search.notes[0].context.includes('</p>'), 'raw HTML is stripped from snippets');
});

test('the search body derivation is explicit about locked pages', () => {
  const extract = extractFunction(app, 'globalSearchAll');
  assert.ok(extract.body.includes("const body = pageIsLocked ? ''"), 'locked pages produce an empty search body');
  assert.ok(extract.body.includes('getHtmlDocumentSearchText(page).toLowerCase()'), 'authorized HTML Pages contribute safe searchable text');
  assert.ok(extract.body.includes("context: pageIsLocked ? 'Locked page' : body.slice(0, 80)"), 'results distinguish locked from snippet contexts');
  assert.ok(extract.body.includes('MAX = 10'), 'results are bounded per category');
});

// ---------------------------------------------------------------------------
// collectGlobalSearchRecords — the workspace-search modal collector. The same
// privacy rules apply there: locked pages contribute title only, and the
// engine additionally ignores bodies for locked records (defense in depth).
// ---------------------------------------------------------------------------

function loadCollector() {
  const extract = extractFunction(app, 'collectGlobalSearchRecords');
  assert.ok(extract, 'collectGlobalSearchRecords must be a top-level declaration');
  const breadcrumb = extractFunction(app, 'globalSearchPageBreadcrumb');
  assert.ok(breadcrumb, 'globalSearchPageBreadcrumb must be a top-level declaration');
  return (pages, tasks, timeBlocks, courseWorkspace, unlockedPageIds, query = '') => new Function(
    'pages',
    'tasks',
    'timeBlocks',
    'courseWorkspace',
    'unlockedPageIds',
    'getHtmlDocumentSearchText',
    'getCanvasSearchText',
    'normalizePageType',
    'PAGE_TYPES',
    'readLocalArraySafe',
    'globalSearchAll',
    `${breadcrumb.body}; ${extract.body}; return collectGlobalSearchRecords;`
  )(
    pages,
    tasks,
    timeBlocks,
    courseWorkspace,
    unlockedPageIds,
    (page) => String(page.htmlDocument.source || ''),
    () => '',
    () => 'note',
    { CANVAS: 'canvas' },
    () => [],
    () => null
  )(query);
}

test('collector withholds locked page bodies even when unlocked elsewhere', () => {
  const collect = loadCollector();
  const records = collect([lockedPage], [], [], {}, new Set());
  const record = records.find(r => r.sourceId === 'secret-note');
  assert.ok(record, 'locked page still produces a record');
  assert.equal(record.body, '', 'locked body text must never enter the search pipeline');
  assert.equal(record.locked, true, 'record is flagged locked');
  assert.equal(record.metadata.locked, true, 'metadata flags the lock for the UI');
});

test('collector exposes unlocked-in-session locked pages and open pages by body', () => {
  const collect = loadCollector();
  const unlocked = collect([lockedPage], [], [], {}, new Set(['secret-note']));
  assert.equal(unlocked.find(r => r.sourceId === 'secret-note').body.includes('NEVER-SNIPPET'), true, 'session-unlocked page contributes its body');

  const open = collect([openPage], [], [], {}, new Set());
  const openRecord = open.find(r => r.sourceId === 'open-note');
  assert.equal(openRecord.body.includes('mitochondria'), true, 'open page body is searchable');
  assert.equal(openRecord.body.includes('<p>'), false, 'HTML is stripped from searchable body text');
});

test('collector maps tasks, homework, timeline, and attachments to typed records', () => {
  const collect = loadCollector();
  const records = collect(
    [],
    [{ id: 't1', title: 'Read biology chapter', notes: 'chapter 4', dueDate: '2026-05-21', completed: false }],
    [{ id: 'b1', name: 'Biology study session', date: '2026-05-21', start: '16:00' }],
    {
      courses: [{ id: 'c1', name: 'Biology 101' }],
      files: [{ id: 'f1', name: 'summary.pdf', courseId: 'c1', kind: 'pdf', sizeBytes: 1400, updatedAt: '2026-05-01T00:00:00Z' }]
    },
    new Set()
  );
  const types = Object.fromEntries(records.map(r => [r.type + ':' + r.sourceId, r]));
  assert.ok(types['task:t1'], 'task record exists');
  assert.equal(types['task:t1'].body, 'chapter 4', 'task notes are searchable');
  assert.ok(types['homework:f1'] === undefined, 'no homework without stored homework');
  assert.ok(types['timeline:b1'], 'timeline record exists');
  const file = types['attachment:f1'];
  assert.ok(file, 'attachment record exists');
  assert.equal(file.breadcrumb, 'Biology 101 / Attachments', 'attachment breadcrumb names the course');
  assert.equal(file.metadata.kind, 'pdf', 'attachment kind is metadata');
});

test('collector never calls globalSearchAll for an empty query', () => {
  const extract = extractFunction(app, 'collectGlobalSearchRecords');
  assert.ok(extract.body.includes("String(query || '').trim() && typeof globalSearchAll === 'function'"), 'secondary bridges are query-gated');
});
