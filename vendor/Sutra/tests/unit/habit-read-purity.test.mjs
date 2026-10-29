import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const source = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

function readerFor(dayStates) {
  const declaration = extractFunction(source, 'readHabitDayState');
  assert.ok(declaration, 'habit display paths have a non-mutating reader');
  return new Function('habitDayStates', `${declaration.body}; return readHabitDayState;`)(dayStates);
}

test('habit display reads do not create a durable empty day', () => {
  const days = {};
  const read = readerFor(days);
  assert.deepEqual(read('2026-09-05'), { completedHabitIds: [] });
  read('2026-09-05').completedHabitIds.push('not-a-completion');
  assert.deepEqual(days, {});
  assert.deepEqual(read('2026-09-05'), { completedHabitIds: [] });
});

test('habit display reads preserve saved empty days, completions, and unknown fields', () => {
  const days = {
    empty: { completedHabitIds: [], extension: 'keep' },
    done: { completedHabitIds: ['habit-1'], extension: { future: true } },
    legacy: { extension: 'legacy' }
  };
  const before = structuredClone(days);
  const read = readerFor(days);
  assert.equal(read('empty'), days.empty);
  assert.equal(read('done'), days.done);
  assert.deepEqual(read('legacy'), { completedHabitIds: [] });
  assert.deepEqual(days, before);
});

test('habit completion actions retain the canonical mutable day-state helper', () => {
  const days = {};
  const declaration = extractFunction(source, 'getHabitDayState');
  const get = new Function('habitDayStates', `${declaration.body}; return getHabitDayState;`)(days);
  get('2026-09-05').completedHabitIds.push('habit-1');
  assert.deepEqual(days, { '2026-09-05': { completedHabitIds: ['habit-1'] } });
  for (const name of ['confirmTimedHabit', 'toggleHabitComplete']) {
    assert.match(extractFunction(source, name).body, /getHabitDayState\(/);
  }
});

test('habit summary and renderer paths use read-only day access', () => {
  for (const name of ['renderHabitTracker', 'renderTodayTrackerSummary']) {
    const body = extractFunction(source, name).body;
    assert.match(body, /readHabitDayState\(/);
    assert.doesNotMatch(body, /\bgetHabitDayState\(/);
  }
  assert.match(source, /getHabitsToday:\s*\(\)\s*=>\s*\{\s*try\s*\{\s*const state = readHabitDayState\(today\(\)\)/);
});
