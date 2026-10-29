import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const SutraImport = require('../../src/domain/import-engine.js');

test('preview parses syllabus facts with confidence and mandatory review', () => {
  const batch = SutraImport.preview({ sourceId: 'chem-syllabus', name: 'Chemistry', format: 'text', text: [
    'Course: AP Chemistry',
    'Tests 40%',
    'Office Hours Tuesdays 3:30 pm',
    'Late work policy: 10% deducted per day',
    'Lab report due September 12, 2026',
    'Final Exam December 16, 2026 9:00 am'
  ].join('\n') }, { now: '2026-07-10T12:00:00Z' });
  assert.equal(batch.ok, true);
  assert.ok(batch.items.some((item) => item.kind === 'grading_category' && item.weight === 40));
  assert.ok(batch.items.some((item) => item.kind === 'late_policy'));
  assert.ok(batch.items.every((item) => item.review.required));
  assert.ok(batch.items.every((item) => item.importIdentity));
});

test('CSV and ICS previews preserve structured source identity', () => {
  const csv = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'type,title,course,due,weight\nassignment,"Essay, draft",English,2026-09-01,\ngrading category,Tests,English,,40' });
  assert.equal(csv.items.length, 2);
  assert.equal(csv.items[0].title, 'Essay, draft');
  const ics = SutraImport.preview({ format: 'ics', sourceId: 'calendar', text: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:exam-1\nSUMMARY:Biology Midterm\nDTSTART:20261003T090000\nEND:VEVENT\nEND:VCALENDAR' });
  assert.equal(ics.items[0].kind, 'exam');
  assert.equal(ics.items[0].date, '2026-10-03');
  assert.match(ics.items[0].importIdentity, /^ics:/);
});

test('ICS preview rejects an incomplete calendar instead of importing partial events', () => {
  const preview = SutraImport.preview({ format: 'ics', sourceId: 'calendar', text: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:partial\nSUMMARY:Partial exam\nDTSTART:20261003T090000\nEND:VEVENT' });
  assert.equal(preview.items.length, 0);
});

test('re-import matching distinguishes duplicate and reviewed update', () => {
  const first = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'title,course,due\nEssay,English,2026-09-01' });
  const prior = { ...first.items[0], id: 'existing-1' };
  const duplicate = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'title,course,due\nEssay,English,2026-09-01' }, { existingRecords: [prior] });
  assert.equal(duplicate.items[0].match.action, 'duplicate');
  const revised = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'title,course,due,details\nEssay,English,2026-09-01,Revised rubric' }, { existingRecords: [prior] });
  assert.equal(revised.items[0].match.action, 'update');
  assert.equal(revised.items[0].match.targetId, 'existing-1');
});

test('apply requires review, persists once, and returns an undoable receipt', async () => {
  const batch = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'title,course,due\nEssay,English,2026-09-01\nQuiz,English,2026-09-02' });
  assert.equal((await SutraImport.applyReviewedBatch(batch, {}, {})).code, 'review_required');
  const events = [];
  const receipt = await SutraImport.applyReviewedBatch(batch, { reviewed: true }, {
    apply(item) { events.push(`apply:${item.title}`); return { ok: true, id: item.id }; },
    rollback(row) { events.push(`undo:${row.item.title}`); },
    persist() { events.push('persist'); }
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.changedIds.length, 2);
  assert.equal(receipt.persistence.status, 'persisted');
  const undone = await SutraImport.rollback(receipt, {
    rollback(row) { events.push(`undo:${row.item.title}`); },
    persist() { events.push('persist-undo'); }
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(events.slice(-3), ['undo:Quiz', 'undo:Essay', 'persist-undo']);
});

test('persistence failure compensates applied rows in reverse order', async () => {
  const batch = SutraImport.preview({ format: 'csv', sourceId: 'portal', text: 'title,due\nOne,2026-09-01\nTwo,2026-09-02' });
  const events = [];
  const result = await SutraImport.applyReviewedBatch(batch, { reviewed: true }, {
    apply(item) { events.push(`apply:${item.title}`); return { ok: true, id: item.id }; },
    persist() { throw new Error('quota full'); },
    rollback(row) { events.push(`undo:${row.item.title}`); }
  });
  assert.equal(result.code, 'rolled_back');
  assert.deepEqual(events, ['apply:One', 'apply:Two', 'undo:Two', 'undo:One']);
});
