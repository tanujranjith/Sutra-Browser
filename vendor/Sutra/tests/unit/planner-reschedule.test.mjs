import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

process.env.TZ = 'America/New_York';

const require = createRequire(import.meta.url);
const planner = require('../../src/domain/planner.js');

test('planner handles exact fits, occupied time, work hours, and breaks', () => {
  const result = planner.proposeSchedule({
    actions: [
      { id: 'a', sourceType: 'task', sourceId: 'a', title: 'A', estimatedMinutes: 60 },
      { id: 'b', sourceType: 'task', sourceId: 'b', title: 'B', estimatedMinutes: 60 }
    ],
    existingBlocks: [{ startAt: '2026-07-13T09:00:00-04:00', endAt: '2026-07-13T10:00:00-04:00' }]
  }, { startAt: '2026-07-13T08:00:00-04:00', days: 1, dayStartHour: 8, dayEndHour: 11, breakMinutes: 0 });
  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0].startAt, '2026-07-13T12:00:00.000Z');
  assert.equal(result.proposals[1].startAt, '2026-07-13T14:00:00.000Z');
  assert.equal(result.impossibleWorkload, false);
});

test('planner never places work after its due time', () => {
  const result = planner.proposeSchedule({ actions: [
    { id: 'late', title: 'Due at 8:30', estimatedMinutes: 60, dueAt: '2026-07-13T08:30:00-04:00' }
  ] }, { startAt: '2026-07-13T08:00:00-04:00', days: 1, dayStartHour: 8, dayEndHour: 22 });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.unscheduled[0].code, 'no_slot_before_due');
});

test('a date-only deadline means the end of that local day', () => {
  const result = planner.proposeSchedule({ actions: [
    { id: 'date-only', title: 'Worksheet', estimatedMinutes: 60, dueDate: '2026-07-13' }
  ] }, { startAt: '2026-07-13T20:00:00-04:00', days: 1, dayStartHour: 8, dayEndHour: 22 });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].endAt, '2026-07-14T01:00:00.000Z');
});

test('planner respects weekends, dependencies, selections, and impossible workload', () => {
  const result = planner.proposeSchedule({ actions: [
    { id: 'blocked', title: 'Blocked', blocked: true, blockReason: 'Finish outline first', estimatedMinutes: 30 },
    { id: 'selected', title: 'Selected', sourceType: 'homework', estimatedMinutes: 120 },
    { id: 'ignored', title: 'Ignored', sourceType: 'task', estimatedMinutes: 30 }
  ] }, {
    startAt: '2026-07-11T08:00:00-04:00', days: 3, dayStartHour: 8, dayEndHour: 9,
    allowWeekends: false, selectedIds: ['blocked', 'selected']
  });
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.unscheduled.map(row => row.code).sort(), ['dependency_blocked', 'no_slot']);
  assert.equal(result.impossibleWorkload, true);
});

test('planner updates an existing linked block instead of proposing a duplicate', () => {
  const result = planner.proposeSchedule({
    actions: [{ id: 'essay-action', sourceType: 'task', sourceId: 'essay', title: 'Essay', estimatedMinutes: 45 }],
    existingBlocks: [{ id: 'block-essay', sourceType: 'task', sourceId: 'essay', startAt: '2026-07-13T08:00:00-04:00', endAt: '2026-07-13T08:45:00-04:00' }]
  }, { startAt: '2026-07-13T08:00:00-04:00', days: 1, dayStartHour: 8, dayEndHour: 10 });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].operation, 'update');
  assert.equal(result.proposals[0].linkedBlockId, 'block-essay');
});
