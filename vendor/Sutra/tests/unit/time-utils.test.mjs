import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const time = require('../../src/core/time-utils.js');

test('duration formatting stays distinct from clock formatting', () => {
  assert.equal(time.formatDurationMinutes(30), '30 min');
  assert.equal(time.formatDurationMinutes(80), '1h 20m');
  assert.equal(time.formatDurationMinutes(120), '2h');
  assert.equal(time.formatClockTime('00:45'), '12:45 AM');
  assert.equal(time.formatClockTime('12:45'), '12:45 PM');
  assert.equal(time.formatClockTime('23:05'), '11:05 PM');
  assert.notEqual(time.formatDurationMinutes(45), time.formatClockTime('00:45'));
});

test('clock formatting rejects malformed times without throwing', () => {
  for (const value of [null, undefined, true, [], {}, '24:00', '12:90', 'noon']) {
    assert.equal(time.formatClockTime(value), '');
  }
});
