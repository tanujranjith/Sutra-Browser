import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import {
  createEverythingWorkspace,
  createReverseDirectionWorkspace,
  EVERYTHING_ASSISTANT_HISTORY
} from '../fixtures/everything-workspace.mjs';
import { comparePortableWorkspaces, fieldDiff } from '../helpers/sync-parity.mjs';

const require = createRequire(import.meta.url);
const projectionApi = require('../../src/sync/sync-projection.js');
const diffApi = require('../../src/sync/sync-diff.js');
const mergeApi = require('../../src/sync/sync-merge.js');
const inventory = JSON.parse(fs.readFileSync(
  new URL('../../docs/architecture/persistence-inventory.json', import.meta.url),
  'utf8'
));

async function projected(workspace) {
  const projection = projectionApi.buildProjection(workspace);
  return { records: projection.records, hashes: await projectionApi.hashProjection(projection) };
}

function identity(deviceId, start = 0) {
  let lamport = start;
  return {
    deviceId, schemaVersion: 8, clientTime: '2026-07-16T14:00:00.000Z',
    nextLamport() { lamport += 1; return lamport; }
  };
}

async function protocolTransfer(sourceWorkspace, targetWorkspace, deviceId) {
  const source = await projected(sourceWorkspace);
  const outbox = diffApi.computeOutbox({
    baseHashes: {}, currentRecords: source.records, currentHashes: source.hashes,
    previousOutbox: [], identity: identity(deviceId)
  });
  const merged = await mergeApi.merge({
    baseRecords: {}, baseHashes: {}, localRecords: {}, localHashes: {},
    remoteOps: outbox.ops, localOps: [], tombstones: {},
    ownDeviceId: 'target-device', now: 1
  });
  return projectionApi.applyProjectionToWorkspace(targetWorkspace, { records: merged.mergedRecords });
}

test('everything fixture survives actual diff, merge, and projection bootstrap', async () => {
  const deviceA = createEverythingWorkspace({});
  const deviceB = await protocolTransfer(deviceA, {
    version: 8,
    workspaceMeta: { revision: 2, lastWriterTabId: 'device-b' },
    ui: { lastActiveView: 'today' },
    splitPaneContexts: { primary: { pageId: 'device-b-page' } },
    settings: {
      dataHealth: { lastSaveAttemptAt: 'device-b-only' },
      preferences: { sync: { enabled: true, endpoint: 'device-b-only' } }
    },
    notificationsState: { lastActiveAt: 123, lastDigest: 456, lastWeeklyReviewAt: 789, lastWeeklyNudge: 101112 }
  }, 'device-a');

  const comparison = comparePortableWorkspaces(deviceA, deviceB);
  assert.deepEqual(comparison.differences, [], JSON.stringify(comparison.differences.slice(0, 20), null, 2));
  assert.equal(deviceB.workspaceMeta.lastWriterTabId, 'device-b');
  assert.equal(deviceB.ui.lastActiveView, 'today');
  assert.equal(deviceB.settings.preferences.sync.endpoint, 'device-b-only');
  assert.equal(deviceB.notificationsState.lastActiveAt, 123);
  assert.equal(deviceB.notificationsState.lastDigest, 456);
  assert.equal(deviceB.notificationsState.lastWeeklyReviewAt, 789);
  assert.equal(deviceB.notificationsState.lastWeeklyNudge, 101112);
});

test('Assistant thread contract includes order, provenance, receipts, memory, and empty threads', () => {
  const records = projectionApi.buildProjection(createEverythingWorkspace({})).records;
  const main = records['c/assistantConversations/chat-parity-main'];
  const empty = records['c/assistantConversations/chat-parity-empty'];
  assert.deepEqual(main.messages.map(message => message.id), ['msg-parity-user', 'msg-parity-assistant']);
  assert.equal(main.messages[1].sources[0].quote, 'Unique parity evidence.');
  assert.equal(main.messages[1].sources[0].score, 0);
  assert.equal(main.messages[1].sources[0].sourceOffsets, null);
  assert.equal(main.messages[1].receipt.schema, 'sutra-assistant-receipt/1');
  assert.deepEqual(main.messages[1].receipt.actionsProposed, ['create_task']);
  assert.deepEqual(main.messages[1].memoryUsedIds, ['memory-parity-1']);
  assert.deepEqual(empty.messages, []);
  assert.deepEqual(records['a/assistantChatHistory.__rest'], {
    version: EVERYTHING_ASSISTANT_HISTORY.version,
    legacyMigrationComplete: true,
    currentChatId: EVERYTHING_ASSISTANT_HISTORY.currentChatId
  });
});

test('everything fixture covers every portable top-level and named nested contract', () => {
  const fixture = createEverythingWorkspace({});
  const portableCategories = new Set(['record', 'ordered', 'atomic', 'asset', 'compatibility']);
  for (const [field, decision] of Object.entries(inventory.workspaceFieldClassifications)) {
    if (!portableCategories.has(decision.category) || decision.category === 'asset') continue;
    assert.ok(Object.prototype.hasOwnProperty.call(fixture, field), 'fixture missing portable field: ' + field);
  }

  const samples = {
    'pages[]': Object.assign({}, ...fixture.pages),
    'tasks[]': Object.assign({}, ...fixture.tasks),
    'timeBlocks[]': fixture.timeBlocks[0],
    assistantChatHistory: fixture.assistantChatHistory,
    'assistantChatHistory.conversations[]': fixture.assistantChatHistory.conversations[0],
    'assistantChatHistory.conversations[].messages[]':
      Object.assign({}, ...fixture.assistantChatHistory.conversations[0].messages.map(row => row)),
    'courseWorkspace.files[]': fixture.courseWorkspace.files[0],
    'attachmentLinks[]': fixture.attachmentLinks[0],
    'pdfDocuments[]': fixture.pdfDocuments[0],
    'pdfDocuments[].pages[]': fixture.pdfDocuments[0].pages[0],
    'pdfDocuments[].bookmarks[]': fixture.pdfDocuments[0].bookmarks[0],
    'pdfDocuments[].checkpoints[]': fixture.pdfDocuments[0].checkpoints[0],
    'pdfAnnotations[]': fixture.pdfAnnotations[0],
    'settings.preferences': fixture.settings.preferences,
    'settings.preferences.assistant': fixture.settings.preferences.assistant,
    'settings.preferences.assistant.localEndpoint': fixture.settings.preferences.assistant.localEndpoint,
    'settings.preferences.today': fixture.settings.preferences.today,
    'settings.preferences.today.dashboard': fixture.settings.preferences.today.dashboard,
    'settings.preferences.quotes': fixture.settings.preferences.quotes,
    'settings.preferences.quotes.customQuotes[]': fixture.settings.preferences.quotes.customQuotes[0],
    homeworkWorkspace: fixture.homeworkWorkspace,
    reviewWorkspace: fixture.reviewWorkspace
  };
  for (const [contract, fields] of Object.entries(inventory.nestedPersistentContracts)) {
    if (!Array.isArray(fields)) continue;
    const sample = samples[contract];
    assert.ok(sample, 'fixture has no sample for nested contract: ' + contract);
    for (const field of fields) {
      if (contract === 'courseWorkspace.files[]' && field === 'syncContentHash') continue;
      assert.ok(Object.prototype.hasOwnProperty.call(sample, field),
        'fixture missing ' + contract + '.' + field);
    }
  }
});

test('every inventory-approved workspace field survives an isolated incremental sync change', async () => {
  const portableCategories = new Set(['record', 'ordered', 'atomic', 'compatibility']);
  const fields = Object.entries(inventory.workspaceFieldClassifications)
    .filter(([, decision]) => portableCategories.has(decision.category))
    .map(([field]) => field);

  function stampField(workspace, field, token) {
    const value = workspace[field];
    if (Array.isArray(value)) {
      if (value.length && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
        value[0] = { ...value[0], parityAuditToken: token };
      } else {
        workspace[field] = value.concat([token]);
      }
      return;
    }
    if (value && typeof value === 'object') {
      workspace[field] = { ...value, parityAuditToken: token };
      return;
    }
    workspace[field] = `${String(value || '')}:${token}`;
  }

  for (const field of fields) {
    const baselineWorkspace = createEverythingWorkspace({});
    const changedWorkspace = structuredClone(baselineWorkspace);
    const token = `isolated-sync-parity:${field}`;
    stampField(changedWorkspace, field, token);

    const baseline = await projected(baselineWorkspace);
    const changed = await projected(changedWorkspace);
    const outbox = diffApi.computeOutbox({
      baseHashes: baseline.hashes, currentRecords: changed.records,
      currentHashes: changed.hashes, previousOutbox: [], identity: identity(`audit-${field}`)
    });
    assert.ok(outbox.ops.length > 0, `${field} mutation did not produce an incremental operation`);

    const remote = mergeApi.applyOpsToRecords(baseline.records, outbox.ops).records;
    const applied = projectionApi.applyProjectionToWorkspace(baselineWorkspace, { records: remote });
    const comparison = comparePortableWorkspaces(changedWorkspace, applied);
    assert.deepEqual(comparison.differences, [], `${field} failed isolated portability:\n${JSON.stringify(comparison.differences.slice(0, 8), null, 2)}`);
  }
});

test('reverse changes, deletions, reordering, and empty values survive incremental ops', async () => {
  const baselineWorkspace = createEverythingWorkspace({});
  const baseline = await projected(baselineWorkspace);
  const changedWorkspace = createReverseDirectionWorkspace(baselineWorkspace);
  changedWorkspace.pages = [changedWorkspace.pages[1], changedWorkspace.pages[0]];
  changedWorkspace.focusSessions = [];
  changedWorkspace.assistantChatHistory.conversations[0].messages.push({
    id: 'msg-reverse', role: 'user',
    content: 'Reverse-direction Assistant sentinel.',
    createdAt: '2026-07-16T15:00:00.000Z'
  });
  changedWorkspace.assistantChatHistory.conversations =
    changedWorkspace.assistantChatHistory.conversations.filter(row => row.id !== 'chat-parity-empty');
  const changed = await projected(changedWorkspace);
  const outbox = diffApi.computeOutbox({
    baseHashes: baseline.hashes, currentRecords: changed.records,
    currentHashes: changed.hashes, previousOutbox: [],
    identity: identity('device-b', 100)
  });
  assert.ok(outbox.ops.some(op =>
    op.recordKey === 'c/assistantConversations/chat-parity-empty' && op.kind === 'delete'));
  assert.ok(outbox.ops.some(op =>
    op.recordKey === 'a/focusSessions' && op.kind === 'upsert'
    && Array.isArray(op.payload) && op.payload.length === 0));
  assert.ok(outbox.ops.some(op => op.recordKey === 'o/pages' && op.kind === 'upsert'));

  const remote = mergeApi.applyOpsToRecords(baseline.records, outbox.ops).records;
  const applied = projectionApi.applyProjectionToWorkspace(baselineWorkspace, { records: remote });
  const comparison = comparePortableWorkspaces(changedWorkspace, applied);
  assert.deepEqual(comparison.differences, [], JSON.stringify(comparison.differences.slice(0, 20), null, 2));
});

test('Slides edits and nested deletions travel incrementally with their canonical page', async () => {
  const baselineWorkspace = createEverythingWorkspace({});
  const baseline = await projected(baselineWorkspace);
  const changedWorkspace = JSON.parse(JSON.stringify(baselineWorkspace));
  const changedPage = changedWorkspace.pages.find(page => page.id === 'page-parent');
  changedPage.slides.slides[0].speakerNotes = 'Edited slide notes from device B.';
  changedPage.slides.slides[0].elements[0].text = 'Edited slide evidence from device B.';
  changedPage.slides.slides.push({
    id: 'slide-added-on-b', layout: 'title-body', title: 'Incremental slide',
    speakerNotes: 'Added incrementally.',
    elements: [{ id: 'slide-added-text', type: 'text', x: 8, y: 8, width: 80, height: 16, text: 'New slide content.' }]
  });

  const changed = await projected(changedWorkspace);
  const outbox = diffApi.computeOutbox({
    baseHashes: baseline.hashes, currentRecords: changed.records,
    currentHashes: changed.hashes, previousOutbox: [],
    identity: identity('slides-device-b', 200)
  });
  const pageOps = outbox.ops.filter(op => op.recordKey === 'c/pages/page-parent');
  assert.equal(pageOps.length, 1);
  assert.equal(pageOps[0].kind, 'upsert');
  assert.equal(pageOps[0].payload.content, '<p>Parent sentinel.</p>');
  assert.equal(pageOps[0].payload.slides.slides[1].id, 'slide-added-on-b');

  const remote = mergeApi.applyOpsToRecords(baseline.records, outbox.ops).records;
  const applied = projectionApi.applyProjectionToWorkspace(baselineWorkspace, { records: remote });
  assert.deepEqual(
    applied.pages.find(page => page.id === 'page-parent').slides,
    changedPage.slides
  );
  assert.equal(applied.pages.find(page => page.id === 'page-parent').content, '<p>Parent sentinel.</p>');

  const afterAdd = await projected(changedWorkspace);
  const afterDeleteWorkspace = JSON.parse(JSON.stringify(changedWorkspace));
  const afterDeletePage = afterDeleteWorkspace.pages.find(page => page.id === 'page-parent');
  afterDeletePage.slides.slides = afterDeletePage.slides.slides.filter(slide => slide.id !== 'slide-parity');
  const afterDelete = await projected(afterDeleteWorkspace);
  const deleteOutbox = diffApi.computeOutbox({
    baseHashes: afterAdd.hashes, currentRecords: afterDelete.records,
    currentHashes: afterDelete.hashes, previousOutbox: [],
    identity: identity('slides-device-b', 300)
  });
  assert.ok(deleteOutbox.ops.some(op =>
    op.recordKey === 'c/pages/page-parent' && op.kind === 'upsert'
    && op.payload.slides.slides.length === 1
    && op.payload.slides.slides[0].id === 'slide-added-on-b'
  ));
  assert.ok(!deleteOutbox.ops.some(op => op.kind === 'delete'),
    'nested slide deletion is represented by the owning page upsert, not a record tombstone');
});

test('field-level diff reports exact content paths', () => {
  const differences = fieldDiff(
    { assistant: { conversations: [{ messages: [{ content: 'expected' }] }] } },
    { assistant: { conversations: [{ messages: [{ content: 'actual' }] }] } }
  );
  assert.deepEqual(
    differences.map(row => row.path),
    ['$.assistant.conversations[0].messages[0].content']
  );
});
