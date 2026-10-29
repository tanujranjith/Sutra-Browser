import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const privacy = require('../../src/domain/assistant-permissions.js');

test('off mode exposes only non-workspace envelope metadata', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'off' }) });
  const result = privacy.filterContext({ schema: 'x', view: 'today', tasks: [{ id: 'secret-task' }], life: { wellness: { mood: 1 } } });
  assert.equal(result.tasks, undefined);
  assert.equal(result.life, undefined);
  assert.deepEqual(result.accessReport.areasRead, []);
});

test('read-only mode reports exact records and strips sensitive areas by default', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowWellness: false, allowFinancial: false }) });
  const result = privacy.filterContext({
    tasks: [{ id: 'task-1', title: 'Essay' }],
    life: { id: 'life-1', wellness: { mood: 2 }, goals: [{ id: 'goal-1' }] },
    college: { id: 'college-1', applicationCosts: [{ id: 'cost-1' }], schools: [{ id: 'school-1' }] },
    activeNote: { id: 'note-1', title: 'Private', locked: true, content: 'secret' }
  });
  assert.equal(result.life.wellness, undefined);
  assert.equal(result.college.applicationCosts, undefined);
  assert.equal(result.activeNote.content, undefined);
  assert.ok(result.accessReport.recordsRead.some((row) => row.id === 'task-1'));
  assert.ok(result.accessReport.excludedSensitiveAreas.includes('private_documents'));
});

test('ask-per-area mode accepts one-request approval without changing saved policy', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'ask_per_area', areas: { planning: 'ask', notes: 'denied' } }) });
  const denied = privacy.filterContext({ tasks: [{ id: 't1' }], activeNote: { id: 'n1' } });
  assert.equal(denied.tasks, undefined);
  const approved = privacy.filterContext({ tasks: [{ id: 't1' }], activeNote: { id: 'n1' } }, { approvedAreas: ['planning', 'notes'] });
  assert.equal(approved.tasks.length, 1);
  assert.equal(approved.activeNote, undefined);
});

test('action permissions require approved-actions mode and explicit approval', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only' }) });
  assert.deepEqual(privacy.getActionPermissions({ approved: true }), ['workspace.read']);
  privacy.configure({ getPermissions: () => ({ mode: 'approved_actions' }) });
  assert.deepEqual(privacy.getActionPermissions({ approved: true, destructiveApproved: true }), ['workspace.read', 'workspace.write', 'workspace.delete']);
});

test('top-level privateDocuments are denied by default even when workspace is readable', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowPrivateDocuments: false }) });
  const result = privacy.filterContext({
    tasks: [{ id: 'task-1' }],
    privateDocuments: [{ id: 'doc-1', title: 'Diagnosis letter', content: 'highly sensitive' }]
  });
  // The outbound boundary itself must remove the field; it cannot rely on
  // context builders choosing not to populate it.
  assert.equal(result.privateDocuments, undefined);
  assert.ok(!JSON.stringify(result).includes('Diagnosis letter'));
  assert.ok(result.accessReport.excludedSensitiveAreas.includes('private_documents'));
});

test('explicit allowPrivateDocuments approval admits top-level private documents', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowPrivateDocuments: true }) });
  const result = privacy.filterContext({
    privateDocuments: [{ id: 'doc-1', title: 'Allowed letter' }]
  });
  assert.equal(result.privateDocuments.length, 1);
});

test('wellness and financial concepts are denied as top-level fields by default too', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowWellness: false, allowFinancial: false }) });
  const result = privacy.filterContext({
    wellness: { mood: 3 },
    sleep: [{ id: 's1' }],
    financialAid: [{ id: 'f1' }],
    spending: { id: 'sp-1' }
  });
  assert.equal(result.wellness, undefined);
  assert.equal(result.sleep, undefined);
  assert.equal(result.financialAid, undefined);
  assert.equal(result.spending, undefined);
});

test('nested privateDocuments inside an approved area value are still removed', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowPrivateDocuments: false }) });
  const result = privacy.filterContext({
    courses: { id: 'course-1', name: 'Biology', privateDocuments: [{ id: 'hidden' }] }
  });
  assert.equal(result.courses.privateDocuments, undefined);
});

test('approved private documents survive at every nesting depth', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowPrivateDocuments: true }) });
  const result = privacy.filterContext({
    courses: { nested: { privateDocuments: [{ id: 'allowed', content: 'approved' }] } }
  });
  assert.equal(result.courses.nested.privateDocuments[0].content, 'approved');
});

test('unknown top-level context is denied instead of inheriting workspace access', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {} }) });
  const result = privacy.filterContext({
    schema: 'flow-context/1',
    unexpectedProviderPayload: { id: 'secret', content: 'must not leave the browser' }
  });
  assert.equal(result.unexpectedProviderPayload, undefined);
  assert.ok(!JSON.stringify(result).includes('must not leave the browser'));
});

test('sensitive concepts and locked records are stripped recursively', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {} }) });
  const result = privacy.filterContext({
    courses: {
      nested: {
        wellness: { mood: 1 },
        privateDocuments: [{ content: 'medical' }],
        note: { id: 'locked-1', title: 'Locked', isLocked: true, content: 'private note' }
      }
    }
  });
  assert.equal(result.courses.nested.wellness, undefined);
  assert.equal(result.courses.nested.privateDocuments, undefined);
  assert.deepEqual(result.courses.nested.note, { id: 'locked-1', title: 'Locked', isLocked: true });
});

test('locked note content requires a one-request page-scoped grant', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowLockedNotes: true }) });
  const context = {
    activeNote: { id: 'locked-1', title: 'Locked', locked: true, content: 'PIN-protected text' }
  };
  const denied = privacy.filterContext(context);
  assert.equal(denied.activeNote.content, undefined);
  assert.ok(denied.accessReport.excludedSensitiveAreas.includes('locked_notes'));

  const approved = privacy.filterContext(context, { authorizedPageIds: ['locked-1'] });
  assert.equal(approved.activeNote.content, 'PIN-protected text');
  assert.deepEqual(approved.accessReport.lockedNotesRead, ['locked-1']);
  assert.ok(!approved.accessReport.excludedSensitiveAreas.includes('locked_notes'));
});

test('persisted allowLockedNotes cannot authorize a locked page by itself', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'read_only', areas: {}, allowLockedNotes: true }) });
  const result = privacy.filterContext({
    retrievedNotes: [{ id: 'locked-1', title: 'Locked', isLocked: true, quote: 'must stay hidden' }]
  });
  assert.equal(result.retrievedNotes[0].quote, undefined);
  assert.ok(result.accessReport.excludedSensitiveAreas.includes('locked_notes'));

  const approved = privacy.filterContext({
    retrievedNotes: [{ noteId: 'locked-1', title: 'Locked', locked: true, quote: 'shared for this request' }]
  }, { authorizedPageIds: ['locked-1'] });
  assert.equal(approved.retrievedNotes[0].quote, 'shared for this request');
});

test('summary and custom-tab content obey workspace area policy', () => {
  privacy.configure({ getPermissions: () => ({ mode: 'ask_per_area', areas: { workspace: 'ask' } }) });
  const denied = privacy.filterContext({ summary: 'Private dashboard text', customTab: { widgets: ['secret'] } });
  assert.equal(denied.summary, undefined);
  assert.equal(denied.customTab, undefined);
  const approved = privacy.filterContext(
    { summary: 'Approved dashboard text', customTab: { widgets: ['allowed'] } },
    { approvedAreas: ['workspace'] }
  );
  assert.equal(approved.summary, 'Approved dashboard text');
  assert.equal(approved.customTab.widgets[0], 'allowed');
});

test('memory and retrieved-note enrichment remain permission-scoped', () => {
  privacy.configure({ getPermissions: () => ({
    mode: 'ask_per_area',
    areas: { memory: 'ask', notes: 'ask' }
  }) });
  const context = {
    memory: ['private study preference'],
    memoryUsedIds: ['memory-1'],
    retrievedNotes: [{ id: 'note-1', title: 'Private note', quote: 'private excerpt' }],
    notesEvidenceStatus: 'complete'
  };
  const denied = privacy.filterContext(context);
  assert.equal(denied.memory, undefined);
  assert.equal(denied.retrievedNotes, undefined);

  const approved = privacy.filterContext(context, { approvedAreas: ['memory', 'notes'] });
  assert.deepEqual(approved.memory, ['private study preference']);
  assert.deepEqual(approved.memoryUsedIds, ['memory-1']);
  assert.equal(approved.retrievedNotes[0].quote, 'private excerpt');
});
