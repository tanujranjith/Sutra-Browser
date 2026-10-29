import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Ics = require('../../src/domain/icalendar.js');

function calendar(events, headers = []) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...headers, ...events, 'END:VCALENDAR'].join('\r\n');
}

function event(lines) {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

test('unfolds lines, respects quoted parameter colons, and decodes RFC text escapes', () => {
  const parsed = Ics.parse(calendar(event([
    'UID:folded-1',
    'DTSTART;VALUE=DATE:20260831',
    'SUMMARY:Study\\, planning',
    'DESCRIPTION;ALTREP="cid:part1@example.org":Line one\\n',
    ' continued'
  ])));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].SUMMARY, 'Study\\, planning');
  assert.equal(parsed.events[0].DESCRIPTION, 'Line one\\ncontinued');
  assert.deepEqual(parsed.events[0].DESCRIPTION_PARAMS, ['ALTREP=cid:part1@example.org']);
  assert.equal(Ics.decodeText(parsed.events[0].SUMMARY), 'Study, planning');
});

test('converts TZID and UTC timestamps to absolute instants', () => {
  const eastern = Ics.parseDateTime('20260831T090000', ['TZID=America/New_York']);
  assert.equal(eastern.epochMs, Date.UTC(2026, 7, 31, 13, 0, 0));
  assert.equal(eastern.timeZone, 'America/New_York');

  const utc = Ics.parseDateTime('20260831T130000Z');
  assert.equal(utc.epochMs, eastern.epochMs);
  assert.equal(utc.floating, false);
});

test('maps all-day and cross-midnight events into bounded canonical day segments', () => {
  const result = Ics.toTimeBlocks(calendar([
    ...event(['UID:trip', 'SUMMARY:Campus trip', 'DTSTART;VALUE=DATE:20260831', 'DTEND;VALUE=DATE:20260903']),
    ...event(['UID:overnight', 'SUMMARY:Overnight lab', 'DTSTART:20260905T230000', 'DTEND:20260906T013000'])
  ]), { fileName: 'school.ics' });

  assert.equal(result.ok, true);
  const trip = result.blocks.filter(block => block.calendarUid === 'trip');
  assert.deepEqual(trip.map(block => block.date), ['2026-08-31', '2026-09-01', '2026-09-02']);
  assert.ok(trip.every(block => block.isAllDay && block.start === '00:00' && block.end === '23:59'));
  const overnight = result.blocks.filter(block => block.calendarUid === 'overnight');
  assert.deepEqual(overnight.map(block => [block.date, block.start, block.end]), [
    ['2026-09-05', '23:00', '23:59'],
    ['2026-09-06', '00:00', '01:30']
  ]);
});

test('supports DURATION and safe common fields without accepting unsafe URLs', () => {
  const result = Ics.toTimeBlocks(calendar(event([
    'UID:duration',
    'SUMMARY:Office hours',
    'DTSTART:20260831T153000',
    'DURATION:PT45M',
    'LOCATION:Library 2',
    'DESCRIPTION:Bring questions',
    'CATEGORIES:SCHOOL,STUDY',
    'URL:https://school.example/office-hours'
  ])), { fileName: 'classes.ics' });
  const block = result.blocks[0];
  assert.equal(block.end, '16:15');
  assert.equal(block.category, 'study');
  assert.match(block.notes, /Location: Library 2/);
  assert.equal(block.referenceUrl, 'https://school.example/office-hours');

  const unsafe = Ics.toTimeBlocks(calendar(event(['UID:unsafe', 'SUMMARY:Unsafe', 'DTSTART:20260831T090000', 'URL:javascript:alert(1)'])), { fileName: 'unsafe.ics' });
  assert.equal(unsafe.blocks[0].referenceUrl, null);
});

test('preserves supported recurrence, COUNT bounds, EXDATE, and RECURRENCE-ID overrides', () => {
  const result = Ics.toTimeBlocks(calendar([
    ...event([
      'UID:chem',
      'SUMMARY:Chemistry',
      'DTSTART:20260831T090000',
      'DTEND:20260831T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
      'EXDATE:20260907T090000'
    ]),
    ...event([
      'UID:chem',
      'RECURRENCE-ID:20260902T090000',
      'SUMMARY:Chemistry — moved',
      'DTSTART:20260902T110000',
      'DTEND:20260902T120000'
    ])
  ]), { fileName: 'classes.ics' });
  const master = result.blocks.find(block => block.calendarUid === 'chem' && !block.calendarRecurrenceId);
  const moved = result.blocks.find(block => block.calendarRecurrenceId);
  assert.equal(master.recurrence, 'weekly');
  assert.deepEqual(master.weeklyDays, [1, 3]);
  assert.equal(master.recurrenceUntil, '2026-09-09');
  assert.deepEqual(master.recurrenceExceptions, ['2026-09-02', '2026-09-07']);
  assert.equal(moved.start, '11:00');
});

test('maps weekday recurrence and degrades unsupported recurrence constraints safely', () => {
  const result = Ics.toTimeBlocks(calendar([
    ...event(['UID:weekday', 'SUMMARY:Weekday class', 'DTSTART:20260831T090000', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR']),
    ...event(['UID:constrained', 'SUMMARY:First Monday', 'DTSTART:20260831T100000', 'RRULE:FREQ=MONTHLY;BYDAY=1MO']),
    ...event(['UID:filtered', 'SUMMARY:Filtered daily', 'DTSTART:20260831T110000', 'RRULE:FREQ=DAILY;BYMONTH=8'])
  ]), { fileName: 'recurrence.ics' });

  assert.equal(result.blocks.find(block => block.calendarUid === 'weekday').recurrence, 'weekdays');
  assert.equal(result.blocks.find(block => block.calendarUid === 'constrained').recurrence, 'none');
  assert.equal(result.blocks.find(block => block.calendarUid === 'filtered').recurrence, 'none');
  assert.ok(result.warnings.some(warning => warning.code === 'unsupported_recurrence_frequency'));
  assert.ok(result.warnings.some(warning => warning.code === 'unsupported_recurrence_parts'));
});

test('collapses duplicate revisions and excludes cancelled events', () => {
  const result = Ics.toTimeBlocks(calendar([
    ...event(['UID:revised', 'SEQUENCE:1', 'SUMMARY:Old title', 'DTSTART:20260831T090000']),
    ...event(['UID:revised', 'SEQUENCE:2', 'SUMMARY:New title', 'DTSTART:20260831T100000']),
    ...event(['UID:cancelled', 'STATUS:CANCELLED', 'SUMMARY:Cancelled', 'DTSTART:20260831T120000'])
  ]), { fileName: 'school.ics' });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].name, 'New title');
  assert.equal(result.stats.duplicatesCollapsed, 1);
  assert.equal(result.stats.cancelled, 1);
});

test('source-scopes stable identities so one file cannot replace another file', () => {
  const source = calendar(event(['UID:shared', 'SUMMARY:Same UID', 'DTSTART:20260831T090000']));
  const first = Ics.toTimeBlocks(source, { fileName: 'school.ics' });
  const same = Ics.toTimeBlocks(source, { fileName: 'school.ics' });
  const other = Ics.toTimeBlocks(source, { fileName: 'personal.ics' });
  assert.equal(first.blocks[0].sourceUid, same.blocks[0].sourceUid);
  assert.equal(first.blocks[0].id, same.blocks[0].id);
  assert.notEqual(first.calendarImportId, other.calendarImportId);
  assert.notEqual(first.blocks[0].sourceUid, other.blocks[0].sourceUid);
});

test('rejects incomplete calendars and safely skips malformed events', () => {
  const incomplete = Ics.toTimeBlocks('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No end');
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'incomplete_calendar');

  const mixed = Ics.toTimeBlocks(calendar([
    ...event(['UID:bad', 'SUMMARY:Bad date', 'DTSTART:20260231T090000']),
    ...event(['UID:good', 'SUMMARY:Good date', 'DTSTART:20260228T090000'])
  ]), { fileName: 'mixed.ics' });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.blocks.length, 1);
  assert.equal(mixed.stats.skipped, 1);
  assert.ok(mixed.warnings.some(warning => warning.code === 'missing_or_invalid_dtstart'));
});
