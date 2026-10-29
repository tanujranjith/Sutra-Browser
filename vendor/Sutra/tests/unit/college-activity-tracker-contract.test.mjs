import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../src/domain/student-life.js', import.meta.url), 'utf8');

function load() {
  const context = { window: {}, globalThis: {}, Date, JSON, Math, Map, Set };
  new Function('window', 'globalThis', 'Date', 'JSON', 'Math', 'Map', 'Set', source)(context.window, context.globalThis, Date, JSON, Math, Map, Set);
  return context.window.SutraStudentLife;
}

test('college activity records preserve full student text and enforce Common App-style limits before mutation', () => {
  const api = load();
  const long = 'x'.repeat(151);
  const normalized = api.normalizeActivity({ position: 'Founder', organization: 'Robotics', description: long }, 0);
  assert.equal(normalized.description.length, 151);
  assert.equal(normalized.limitViolations.description, 1);
  assert.throws(() => api.upsertActivity({}, normalized), /description exceeds the 150-character limit/);
  const accepted = api.upsertActivity({}, { position: 'Founder', organization: 'Robotics', description: 'Led a 12-student build team.', hoursPerWeek: 5, weeksPerYear: 30 });
  assert.equal(accepted.workspace.collegeAppWorkspace.activities.length, 1);
  assert.equal(accepted.activity.order, 1);
});
