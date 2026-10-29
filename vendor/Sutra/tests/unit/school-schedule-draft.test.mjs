import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schedule = require('../../src/features/academic/school-schedule.js');

function persistedState() {
    return schedule.normalizeSchoolSchedule({
        enabled: true,
        term: { name: 'Fall', startDate: '2026-08-20', endDate: '2026-12-18' },
        schedules: [{ id: 'regular', name: 'Regular', periods: [{ id: 'p1', label: 'Math', start: '08:00', end: '08:50' }] }],
        defaultScheduleId: 'regular',
        subscriptions: [{ id: 'district', name: 'District', url: 'https://school.test/calendar.ics' }]
    });
}

test('school schedule drafts are deep copies and begin clean', () => {
    const persisted = persistedState();
    const session = schedule.createDraftSession(persisted);
    assert.notEqual(session.draft, persisted);
    assert.notEqual(session.draft.schedules[0], persisted.schedules[0]);
    assert.equal(session.isDirty(), false);

    session.draft.term.name = 'Edited but unsaved';
    session.draft.schedules[0].periods[0].label = 'Physics';
    session.draft.subscriptions.splice(0, 1);
    assert.equal(session.isDirty(), true);
    assert.equal(persisted.term.name, 'Fall');
    assert.equal(persisted.schedules[0].periods[0].label, 'Math');
    assert.equal(persisted.subscriptions.length, 1);
});

test('commitValue normalizes the reviewed draft without mutating persisted state', () => {
    const persisted = persistedState();
    const session = schedule.createDraftSession(persisted);
    session.draft.rotation.type = 'ab';
    session.draft.rotation.cycleLength = 7;
    session.draft.rotation.labels = ['Red'];
    const committed = session.commitValue();
    assert.equal(committed.rotation.cycleLength, 2);
    assert.deepEqual(committed.rotation.labels, ['Red', 'B']);
    assert.equal(persisted.rotation.type, 'weekly');
});
