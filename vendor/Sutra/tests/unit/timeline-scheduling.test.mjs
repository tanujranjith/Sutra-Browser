import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../../src/features/workspace/timeline-drag.js');

function setup(initial = [], flush = async () => {}, homeworkTitle = 'Canonical essay') {
    const timeBlocks = structuredClone(initial);
    globalThis.flowAtelier = {
        timeBlocks,
        saveTimeBlocks() {},
        flushAppSaveNow: flush
    };
    globalThis.SutraHomeworkStore = {
        getSnapshot() {
            return {
                tasks: [{
                    id: 'hw-1',
                    title: homeworkTitle,
                    courseId: 'english',
                    priority: 'high',
                    dueDate: '2026-07-20',
                    estimateMinutes: 90,
                    extensionField: { preserved: true }
                }]
            };
        }
    };
    return timeBlocks;
}

test('preview keeps a long canonical Homework title for the Timeline block', () => {
    const title = 'Canonical assignment ' + 'T'.repeat(1400);
    setup([], async () => {}, title);
    const preview = api.previewSchedule(
        { source: 'homework', sourceId: 'hw-1' },
        { date: '2026-07-18', start: '16:00', durationMinutes: 45 }
    );
    assert.equal(preview.item.title, title);
    assert.equal(preview.item.title.length, title.length);
});

test('preview rejects occupied time and allows an exact adjacent fit', () => {
    const rows = setup([{ id: 'busy', date: '2026-07-14', start: '10:00', end: '11:00', name: 'Class' }]);
    const conflict = api.previewSchedule(
        { title: 'Read', source: 'task', sourceId: 'task-1' },
        { date: '2026-07-14', start: '10:30', durationMinutes: 30 },
        rows
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'conflict');
    assert.deepEqual(conflict.conflicts.map((block) => block.id), ['busy']);

    const adjacent = api.previewSchedule(
        { title: 'Read', source: 'task', sourceId: 'task-1' },
        { date: '2026-07-14', start: '11:00', durationMinutes: 30 },
        rows
    );
    assert.equal(adjacent.ok, true);
    assert.equal(adjacent.start, '11:00');
    assert.equal(adjacent.end, '11:30');
});

test('preview rejects impossible calendar dates and safely defaults invalid duration input', () => {
    setup();
    const badDate = api.previewSchedule(
        { title: 'Read', source: 'task', sourceId: 'task-1' },
        { date: '2026-02-31', start: '10:00', durationMinutes: 30 }
    );
    assert.equal(badDate.ok, false);
    assert.equal(badDate.code, 'invalid_slot');

    const duration = api.previewSchedule(
        { title: 'Read', source: 'task', sourceId: 'task-1' },
        { date: '2026-02-28', start: '10:00', durationMinutes: 'not-a-number' }
    );
    assert.equal(duration.ok, true);
    assert.equal(duration.end, '11:00');
});

test('stable source IDs update a linked block instead of creating duplicates', async () => {
    const rows = setup();
    const first = await api.scheduleItemAt(
        { title: 'Stale title', source: 'homework', sourceId: 'hw-1' },
        { date: '2026-07-18', start: '16:00', durationMinutes: 45 }
    );
    assert.equal(first.ok, true);
    assert.equal(first.operation, 'create');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Stale title');
    assert.equal(rows[0].sourceKey, 'homework:hw-1');
    assert.equal(rows[0].homeworkId, 'hw-1');
    assert.equal(rows[0].assignmentId, 'hw-1');
    assert.equal(rows[0].courseId, 'english');
    assert.equal(rows[0].priority, 'high');
    assert.equal(rows[0].dueAt, '2026-07-20');
    assert.equal(rows[0].effortMinutes, 90);

    rows[0].unknownCompatibilityField = { keep: true };
    const second = await api.scheduleItemAt(
        { title: 'Canonical essay', source: 'homework', sourceId: 'hw-1' },
        { date: '2026-07-19', start: '17:00', durationMinutes: 60 }
    );
    assert.equal(second.ok, true);
    assert.equal(second.operation, 'update');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-07-19');
    assert.equal(rows[0].start, '17:00');
    assert.deepEqual(rows[0].unknownCompatibilityField, { keep: true });
});

test('persistence rejection restores the exact pre-change block array', async () => {
    const initial = [{ id: 'keep', date: '2026-07-15', start: '09:00', end: '10:00', name: 'Keep', custom: 7 }];
    const rows = setup(initial, async () => { throw new Error('disk unavailable'); });
    const result = await api.scheduleItemAt(
        { title: 'Unsafe create', source: 'task', sourceId: 'task-2' },
        { date: '2026-07-15', start: '11:00', durationMinutes: 30 }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'persistence_failed');
    assert.deepEqual(rows, initial);
});

test('moving an existing block checks conflicts before mutation', async () => {
    const initial = [
        { id: 'move', date: '2026-07-16', start: '08:00', end: '09:00', name: 'Move me' },
        { id: 'busy', date: '2026-07-16', start: '10:00', end: '11:00', name: 'Busy' }
    ];
    const rows = setup(initial);
    const result = await api.rescheduleBlock('move', '2026-07-16', 10 * 60);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'conflict');
    assert.deepEqual(rows, initial);
});

test('undo restores the grouped prior schedule and persists it', async () => {
    let flushes = 0;
    const rows = setup([], async () => { flushes += 1; });
    const result = await api.scheduleItemAt(
        { title: 'Review', source: 'review', sourceId: 'deck-1' },
        { date: '2026-07-17', start: '13:00', durationMinutes: 30 }
    );
    assert.equal(result.ok, true);
    assert.equal(rows.length, 1);
    const undone = await api.undoLastSchedule();
    assert.equal(undone.ok, true);
    assert.deepEqual(rows, []);
    assert.equal(flushes, 2);
});

test('Push time previews forward and backward shifts without losing block fields', () => {
    const initial = [
        { id: 'one', date: '2026-07-30', start: '11:30', end: '12:30', name: 'Cloud work', custom: { keep: true } },
        { id: 'two', date: '2026-07-30', start: '12:30', end: '14:30', name: 'Study' }
    ];
    setup(initial);

    const forward = api.previewPushTime({ direction: 'forward', amount: 90, unit: 'minutes', now: 77 }, initial);
    assert.equal(forward.ok, true);
    assert.equal(forward.affectedCount, 2);
    assert.deepEqual(forward.blocks.map((block) => [block.start, block.end]), [['13:00', '14:00'], ['14:00', '16:00']]);
    assert.deepEqual(forward.blocks[0].custom, { keep: true });
    assert.equal(forward.blocks[0].updatedAt, 77);

    const backward = api.previewPushTime({ direction: 'backward', amount: 1, unit: 'hours', now: 88 }, initial);
    assert.equal(backward.ok, true);
    assert.deepEqual(backward.blocks.map((block) => [block.start, block.end]), [['10:30', '11:30'], ['11:30', '13:30']]);
});

test('Push time moves dates and recurrence weekdays when a whole block crosses a day boundary', () => {
    const initial = [{
        id: 'late',
        date: '2026-07-27',
        start: '23:00',
        end: '23:30',
        name: 'Late review',
        recurrence: 'weekdays',
        recurrenceUntil: '2026-08-07'
    }];
    setup(initial);

    const preview = api.previewPushTime({ direction: 'forward', amount: 2, unit: 'hours', now: 99 }, initial);
    assert.equal(preview.ok, true);
    assert.equal(preview.blocks[0].date, '2026-07-28');
    assert.equal(preview.blocks[0].start, '01:00');
    assert.equal(preview.blocks[0].end, '01:30');
    assert.equal(preview.blocks[0].recurrence, 'weekly');
    assert.deepEqual(preview.blocks[0].weeklyDays, [2, 3, 4, 5, 6]);
    assert.equal(preview.blocks[0].recurrenceUntil, '2026-08-08');
});

test('Push time is all-or-nothing when any block would span midnight', async () => {
    const initial = [
        { id: 'safe', date: '2026-07-30', start: '10:00', end: '11:00', name: 'Safe' },
        { id: 'overnight', date: '2026-07-30', start: '23:00', end: '23:45', name: 'Overnight' }
    ];
    const rows = setup(initial);
    const preview = api.previewPushTime({ direction: 'forward', amount: 30, unit: 'minutes' }, initial);
    assert.equal(preview.ok, false);
    assert.equal(preview.code, 'blocked');
    assert.deepEqual(preview.blocked.map((item) => item.id), ['overnight']);

    const result = await api.pushTime({ direction: 'forward', amount: 30, unit: 'minutes' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'blocked');
    assert.deepEqual(rows, initial);
});

test('Push time persists atomically, supports undo, and rolls back a rejected save', async () => {
    const initial = [{ id: 'keep', date: '2026-07-30', start: '09:00', end: '10:00', name: 'Keep', custom: 7 }];
    const reasons = [];
    const rows = setup(initial, async (reason) => { reasons.push(reason); });

    const pushed = await api.pushTime({ direction: 'forward', amount: 45, unit: 'minutes' });
    assert.equal(pushed.ok, true);
    assert.equal(pushed.code, 'saved');
    assert.equal(rows[0].start, '09:45');
    assert.equal(rows[0].end, '10:45');
    assert.equal(rows[0].custom, 7);

    const undone = await api.undoLastPushTime();
    assert.equal(undone.ok, true);
    assert.deepEqual(rows, initial);
    assert.deepEqual(reasons, ['timeline-push-time', 'timeline-push-time-undo']);

    const rejectedRows = setup(initial, async () => { throw new Error('disk unavailable'); });
    const rejected = await api.pushTime({ direction: 'backward', amount: 30, unit: 'minutes' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'persistence_failed');
    assert.deepEqual(rejectedRows, initial);

    const changedRows = setup(initial);
    const shiftedAgain = await api.pushTime({ direction: 'forward', amount: 15, unit: 'minutes' });
    assert.equal(shiftedAgain.ok, true);
    changedRows[0].name = 'Edited after Push time';
    const unsafeUndo = await api.undoLastPushTime();
    assert.equal(unsafeUndo.ok, false);
    assert.equal(unsafeUndo.code, 'calendar_changed');
    assert.equal(changedRows[0].name, 'Edited after Push time');
    assert.equal(changedRows[0].start, '09:15');
});
