import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectionApi = require('../../src/sync/sync-projection.js');
const protocol = require('../../src/sync/sync-protocol.js');

function sampleWorkspace() {
  return {
    version: 5,
    pages: [
      { id: 'p1', title: 'Notes A', body: '<p>alpha</p>' },
      { id: 'p2', title: 'Notes B', body: '<p>beta</p>' },
      { title: 'orphan page without id' }
    ],
    tasks: [
      { id: 't1', text: 'Do homework', done: false },
      { id: 't2', text: 'Study', done: true }
    ],
    taskOrder: ['t2', 't1'],
    timeBlocks: [{ id: 'b1', start: '09:00' }],
    homeworkWorkspace: {
      schemaVersion: 2,
      revision: 12,
      courses: [{ id: 'hc1', name: 'Biology' }],
      tasks: [{ id: 'ht1', courseId: 'hc1', title: 'Lab report' }],
      quarantine: []
    },
    reviewWorkspace: {
      decks: [{ id: 'd1', name: 'Spanish' }],
      items: [{ id: 'ri1', deckId: 'd1', front: 'hola', back: 'hello' }],
      sessions: [{ startedAt: '2026-07-01' }],
      settings: { dailyGoal: 20 }
    },
    customTabs: [{ id: 'ct1', name: 'Dashboard' }],
    trash: [{ id: 'tr1', title: 'Deleted page' }],
    courseWorkspace: {
      courses: [{ id: 'c1', name: 'Biology' }],
      files: [{
        id: 'f1', courseId: 'c1', name: 'lab.pdf', storageType: 'indexeddb',
        blobKey: 'blob-1', syncContentHash: 'a'.repeat(64),
        missingBlob: false, _exportBlob: 'data:application/pdf;base64,UERG'
      }]
    },
    spaces: [{ id: 's1', name: 'School' }],
    settings: {
      theme: 'dark',
      dataHealth: { lastSaveAttemptAt: '2026-07-15T09:00:00.000Z', lastSaveReason: 'autosave' },
      preferences: {
        assistant: { enabled: false },
        sync: { enabled: true, endpoint: 'https://example.supabase.co' }
      }
    },
    globalTheme: { name: 'glass' },
    workspaceMeta: { revision: 44, lastWriterTabId: 'tab-x' },
    localStorageSnapshot: { 'chat_provider': 'openai' },
    syncAuditLog: [{ at: 'x' }],
    ui: { activeView: 'today' },
    migrationDiagnostics: {},
    compatibility: {},
    exportedAt: '2026-07-15T00:00:00.000Z'
  };
}

function shuffleKeys(value) {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value).reverse();
  const out = {};
  for (const key of keys) out[key] = shuffleKeys(value[key]);
  return out;
}

test('projection extracts collections, orderings, rests, and atomics', () => {
  const { records } = projectionApi.buildProjection(sampleWorkspace());
  assert.deepEqual(records['c/pages/p1'], { id: 'p1', title: 'Notes A', body: '<p>alpha</p>' });
  assert.deepEqual(records['o/pages'], ['p1', 'p2']);
  assert.deepEqual(records['a/pages.__rest'], { orphans: [{ title: 'orphan page without id' }] });
  assert.deepEqual(records['o/taskOrder'], ['t2', 't1']);
  assert.deepEqual(records['c/homeworkCourses/hc1'], { id: 'hc1', name: 'Biology' });
  assert.deepEqual(records['o/homeworkCourses'], ['hc1']);
  assert.deepEqual(records['a/homeworkWorkspace.__rest'], { schemaVersion: 2, quarantine: [] }, 'revision is localOnly and must not travel');
  assert.deepEqual(records['c/reviewItems/ri1'], { id: 'ri1', deckId: 'd1', front: 'hola', back: 'hello' });
  assert.deepEqual(records['a/reviewWorkspace.__rest'], { sessions: [{ startedAt: '2026-07-01' }], settings: { dailyGoal: 20 } });
  assert.deepEqual(records['a/spaces'], [{ id: 's1', name: 'School' }]);
  assert.deepEqual(records['a/globalTheme'], { name: 'glass' });
});

test('projection excludes only device-local fields and the sync preference', () => {
  const { records } = projectionApi.buildProjection(sampleWorkspace());
  for (const excluded of ['version', 'exportedAt', 'workspaceMeta', 'ui', 'splitPaneContexts']) {
    assert.ok(!(('a/' + excluded) in records), `excluded field projected: ${excluded}`);
  }
  assert.deepEqual(records['a/migrationDiagnostics'], {});
  assert.deepEqual(records['a/compatibility'], {});
  assert.deepEqual(records['a/localStorageSnapshot'], { chat_provider: 'openai' });
  assert.equal(records['a/settings'].theme, 'dark');
  assert.equal(records['a/settings'].preferences.sync, undefined, 'sync preference must be stripped');
  assert.equal(records['a/settings'].dataHealth, undefined, 'per-save dataHealth churn must be stripped');
  assert.deepEqual(records['a/settings'].preferences.assistant, { enabled: false });
  const wire = protocol.stableStringify(records);
  assert.ok(!wire.includes('example.supabase.co'), 'sync endpoint leaked into projection');
  assert.ok(!wire.includes('UERG'), 'attachment bytes must use the asset channel, not operation records');
  assert.equal(records['a/courseWorkspace'].files[0].missingBlob, undefined, 'device-local materialization state leaked');
});

test('projection is deterministic under object key shuffling', async () => {
  const a = projectionApi.buildProjection(sampleWorkspace());
  const b = projectionApi.buildProjection(shuffleKeys(sampleWorkspace()));
  const hashesA = await projectionApi.hashProjection(a);
  const hashesB = await projectionApi.hashProjection(b);
  assert.deepEqual(hashesA, hashesB);
});

test('apply + rebuild round-trips to identical record hashes', async () => {
  const workspace = sampleWorkspace();
  const original = projectionApi.buildProjection(workspace);
  // Apply onto a *different* current workspace (simulating another device
  // whose device-local fields differ).
  const otherDevice = {
    version: 5,
    workspaceMeta: { revision: 9, lastWriterTabId: 'tab-y' },
    ui: { activeView: 'notes' },
    settings: { dataHealth: { lastSaveAttemptAt: 'device-b-stamp' }, preferences: { sync: { enabled: false, endpoint: '' } } },
    pages: [], tasks: [], taskOrder: [], timeBlocks: [], customTabs: [], trash: []
  };
  const applied = projectionApi.applyProjectionToWorkspace(otherDevice, original);

  // Device-local fields survive from the target device.
  assert.deepEqual(applied.workspaceMeta, { revision: 9, lastWriterTabId: 'tab-y' });
  assert.deepEqual(applied.ui, { activeView: 'notes' });
  assert.equal(applied.version, 5);
  assert.deepEqual(applied.settings.preferences.sync, { enabled: false, endpoint: '' }, 'device-local sync pref must survive');
  assert.deepEqual(applied.settings.dataHealth, { lastSaveAttemptAt: 'device-b-stamp' }, 'device-local dataHealth must survive a remote apply');

  // Ordering respected: taskOrder data + pages array order.
  assert.deepEqual(applied.taskOrder, ['t2', 't1']);
  assert.deepEqual(applied.pages.map(p => p.id), ['p1', 'p2', undefined]);
  assert.equal(applied.pages[2].title, 'orphan page without id');

  // Nested sections reassemble.
  assert.deepEqual(applied.homeworkWorkspace.courses, [{ id: 'hc1', name: 'Biology' }]);
  // revision is localOnly: the target device had none, so none appears.
  assert.equal(applied.homeworkWorkspace.revision, undefined);
  assert.deepEqual(applied.reviewWorkspace.items, [{ id: 'ri1', deckId: 'd1', front: 'hola', back: 'hello' }]);
  assert.equal(applied.courseWorkspace.files[0].missingBlob, true, 'new remote attachment starts pending until bytes arrive');

  // Round-trip: re-projecting the applied workspace yields identical hashes
  // (the synced subset is a fixed point).
  const reprojected = projectionApi.buildProjection(applied);
  assert.deepEqual(await projectionApi.hashProjection(reprojected), await projectionApi.hashProjection(original));
});

test('ordering doc controls assembled array order; unknown ids fall back sorted', () => {
  const projection = projectionApi.buildProjection(sampleWorkspace());
  // Reverse the pages order and drop p1 from the ordering entirely.
  projection.records['o/pages'] = ['p2'];
  const applied = projectionApi.applyProjectionToWorkspace({}, projection);
  assert.deepEqual(applied.pages.filter(p => p.id).map(p => p.id), ['p2', 'p1']);
});

test('record field policies: updatedAt is hash-volatile, versions sync, revision is local-only', async () => {
  const ws = sampleWorkspace();
  ws.pages[0].versions = [{ id: '_deviceRandomA', savedAt: '2026-07-15T01:00:00Z', state: {} }];
  ws.homeworkWorkspace.revision = 41;
  const { records } = projectionApi.buildProjection(ws);

  // Durable page version history travels; only Homework bookkeeping is local.
  assert.deepEqual(records['c/pages/p1'].versions, [{ id: '_deviceRandomA', savedAt: '2026-07-15T01:00:00Z', state: {} }]);
  assert.equal(records['a/homeworkWorkspace.__rest'].revision, undefined, 'homework revision must not travel');

  // hashVolatile: an updatedAt-only change produces the same hash…
  const bumped = sampleWorkspace();
  bumped.pages[0].updatedAt = '2026-07-16T09:09:09.000Z';
  const hashA = await projectionApi.hashRecord('c/pages/p1', projectionApi.buildProjection(sampleWorkspace()).records['c/pages/p1']);
  const hashB = await projectionApi.hashRecord('c/pages/p1', projectionApi.buildProjection(bumped).records['c/pages/p1']);
  assert.equal(hashA, hashB, 'updatedAt-only change must not change the record hash');
  // …but updatedAt still travels in the payload.
  assert.ok(projectionApi.buildProjection(bumped).records['c/pages/p1'].updatedAt);

  // A content change still changes the hash.
  const edited = sampleWorkspace();
  edited.pages[0].body = 'different';
  const hashC = await projectionApi.hashRecord('c/pages/p1', projectionApi.buildProjection(edited).records['c/pages/p1']);
  assert.notEqual(hashA, hashC);

  // Apply uses the synchronized page history while re-injecting Homework's
  // local-only revision.
  const current = sampleWorkspace();
  current.pages[0].versions = [{ id: '_localHistory', savedAt: 'x', state: {} }];
  current.homeworkWorkspace.revision = 99;
  const applied = projectionApi.applyProjectionToWorkspace(current, projectionApi.buildProjection(ws));
  assert.deepEqual(applied.pages.find(p => p.id === 'p1').versions, [{ id: '_deviceRandomA', savedAt: '2026-07-15T01:00:00Z', state: {} }]);
  assert.equal(applied.homeworkWorkspace.revision, 99);
});

test('missing sections project to no record and apply keeps current value', () => {
  const sparse = { pages: [{ id: 'p1', title: 'only' }] };
  const { records } = projectionApi.buildProjection(sparse);
  assert.ok(!('a/settings' in records), 'absent atomic section must not produce a record');
  const applied = projectionApi.applyProjectionToWorkspace({ settings: { theme: 'light' } }, { records });
  assert.deepEqual(applied.settings, { theme: 'light' });
  assert.deepEqual(applied.tasks, []);
});

test('generated Help page is reconstructed, not synchronized as user content', () => {
  const workspace = sampleWorkspace();
  workspace.pages.push({
    id: 'help_page', title: 'Help & Docs', isSystemPage: true,
    builtInId: 'help-docs', systemRole: 'help-docs', content: 'generated'
  });
  const records = projectionApi.buildProjection(workspace).records;
  assert.equal(records['c/pages/help_page'], undefined);
  assert.ok(!records['o/pages'].includes('help_page'));
});

test('remote absence, deletion, and same-id collision cannot remove or replace local Help', () => {
  const localHelp = {
    id: 'help_page', title: 'Help & Docs', isSystemPage: true,
    builtInId: 'help-docs', systemRole: 'help-docs',
    content: '<p>current generated local docs</p>'
  };
  const local = sampleWorkspace();
  local.pages = [localHelp, ...local.pages.filter(page => page.id)];

  // Simulate a stale/malicious remote record reusing the stable Help id.
  // The local generated resource must win and remain unique.
  const remoteWithCollision = sampleWorkspace();
  remoteWithCollision.pages = [
    { id: 'help_page', title: 'Remote replacement', content: '<p>not system help</p>' },
    { id: 'remote-page', title: 'Remote note', content: '<p>remote</p>' }
  ];
  let applied = projectionApi.applyProjectionToWorkspace(
    local,
    projectionApi.buildProjection(remoteWithCollision)
  );
  let helpPages = applied.pages.filter(page =>
    page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs');
  assert.equal(helpPages.length, 1);
  assert.deepEqual(helpPages[0], localHelp, 'remote content must not replace the local system resource');
  assert.ok(applied.pages.some(page => page.id === 'remote-page'));

  // A delete op/tombstone is represented at projection apply time by the
  // record being absent. Repeated remote applies must preserve exactly one
  // local Help resource and never create a synchronized Help record.
  const afterRemoteDelete = projectionApi.buildProjection({ pages: [] });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    applied = projectionApi.applyProjectionToWorkspace(applied, afterRemoteDelete);
    helpPages = applied.pages.filter(page =>
      page.id === 'help_page' || page.systemRole === 'help-docs' || page.builtInId === 'help-docs');
    assert.equal(helpPages.length, 1, `cycle ${cycle + 1} duplicated or deleted Help`);
    assert.deepEqual(helpPages[0], localHelp);
  }
  const reprojected = projectionApi.buildProjection(applied).records;
  assert.equal(reprojected['c/pages/help_page'], undefined);
  assert.ok(!reprojected['o/pages'].includes('help_page'));
});
