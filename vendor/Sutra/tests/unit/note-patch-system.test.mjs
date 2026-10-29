import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const patches = require('../../src/features/assistant/note-patch-system.js');

test('generates distinct proposal ids for distinct notes and edits', () => {
  const first = patches.create({ note: { id: 'n1', content: 'Alpha' }, after: 'Beta' });
  const second = patches.create({ note: { id: 'n2', content: 'Alpha' }, after: 'Beta' });
  const third = patches.create({ note: { id: 'n1', content: 'Alpha' }, after: 'Gamma' });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.id, third.id);
});

test('applies only approved anchored hunks and returns a reversible receipt', () => {
  const note = { id: 'n1', version: 3, content: 'Alpha beta. Gamma delta.' };
  let proposal = patches.create({ note, hunks: [
    { id: 'one', start: 6, end: 10, replacement: 'BETA' },
    { id: 'two', start: 18, end: 23, replacement: 'DELTA' }
  ] });
  proposal = patches.decide(proposal, { one: 'approved', two: 'declined' });
  const applied = patches.apply(proposal, note);
  assert.equal(applied.ok, true);
  assert.equal(applied.content, 'Alpha BETA. Gamma delta.');
  assert.deepEqual(applied.appliedHunkIds, ['one']);
  assert.equal(patches.revert(applied.receipt, { ...note, content: applied.content }).content, note.content);
});

test('detects intervening edits and requires review after a safe rebase', () => {
  const note = { id: 'n1', version: 1, content: 'Header\nThe quick brown fox.\nFooter' };
  const proposal = patches.create({ note, hunks: [{ id: 'fox', start: 17, end: 22, replacement: 'red' }] });
  const edited = { ...note, version: 2, content: 'New intro\n' + note.content };
  const inspected = patches.inspect(proposal, edited);
  assert.equal(inspected.code, 'rebased');
  assert.equal(patches.apply(inspected.proposal, edited, { approveAll: true }).ok, true);
  assert.equal(patches.apply(proposal, edited, { approveAll: true }).code, 'rebase_required');
});

test('refuses ambiguous conflicts and undo after another edit', () => {
  const note = { id: 'n1', content: 'same target same target' };
  const proposal = patches.create({ note, hunks: [{ start: 5, end: 11, replacement: 'value', contextBefore: '', contextAfter: '' }] });
  const conflict = patches.inspect(proposal, { ...note, content: 'prefix same target same target' });
  assert.equal(conflict.code, 'conflict');
  const applied = patches.apply(patches.decide(proposal, { 'hunk-1': true }), note);
  assert.equal(patches.revert(applied.receipt, { ...note, content: applied.content + '!' }).code, 'undo_conflict');
});

test('reconstructs a stale serialized proposal and offers a reviewed rebase', () => {
  const before = { id: 'n1', version: 1, content: 'Title\nUnique sentence.\nEnd' };
  const original = patches.create({ note: before, hunks: [{ id: 'unique', start: 6, end: 22, replacement: 'Better sentence.' }] });
  const after = { ...before, version: 2, content: 'Intro\n' + before.content };
  const serialized = patches.create({
    note: after,
    noteId: original.noteId,
    versionId: original.versionId,
    baseHash: original.baseHash,
    hunks: original.hunks,
    allowStaleAnchors: true
  });
  const checked = patches.inspect(serialized, after);
  assert.equal(checked.code, 'rebased');
  assert.equal(patches.apply(serialized, after, { approveAll: true }).code, 'rebase_required');
});

test('a wrong character offset cannot apply even when the base hash is current', () => {
  const note = { id: 'n1', content: '<p>First</p><p>Unique target</p>' };
  const baseHash = patches.hash(note.content);
  const serialized = patches.create({
    note,
    baseHash,
    hunks: [{ id: 'target', start: 0, end: 13, before: 'Unique target', replacement: 'Changed' }],
    allowStaleAnchors: true
  });
  assert.equal(patches.inspect(serialized, note).code, 'rebased');
  assert.equal(patches.apply(serialized, note, { approveAll: true }).code, 'rebase_required');
});
