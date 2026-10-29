import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const life = require('../../src/domain/student-life.js');

const NOW = '2026-08-01T12:00:00.000Z';

test('wellness trends are bounded, actionable, and never medical advice', () => {
  const trends = life.getWellnessTrends({
    lifeWorkspace: {
      wellness: {
        checkIns: [
          { createdAt: '2026-07-30T09:00:00.000Z', stress: 8 },
          { createdAt: '2026-07-31T09:00:00.000Z', stress: 7 },
          { createdAt: '2026-08-01T09:00:00.000Z', stress: 9 }
        ]
      },
      sleepTracker: {
        entries: [
          { date: '2026-07-31T00:00:00.000Z', totalSleepMinutes: 360 },
          { date: '2026-08-01T00:00:00.000Z', totalSleepMinutes: 330 }
        ]
      }
    }
  }, { now: NOW });

  assert.equal(trends.averages.stress, 8, 'stress averages across the window');
  assert.equal(Object.prototype.hasOwnProperty.call(trends.averages, 'energy'), false, 'removed Energy data is not surfaced');
  assert.ok(trends.signals.some(s => s.includes('Stress has been high recently. Consider reducing today to essential commitments.')), 'high stress produces an actionable signal');
  assert.ok(trends.signals.some(s => s.includes('Average sleep is below seven hours.')), 'short sleep produces an actionable signal');
  assert.equal(trends.disclaimer, 'These are gentle personal trends, not medical or mental-health advice.');
});

test('wellness trends stay non-medical and quiet when there is no data', () => {
  const trends = life.getWellnessTrends({}, { now: NOW });
  assert.deepEqual(trends.signals, [], 'no data means no health claims');
  assert.equal(trends.averages.stress, null);
  assert.equal(trends.disclaimer, 'These are gentle personal trends, not medical or mental-health advice.');
});

test('the overwhelmed week plan keeps essentials bounded and never deletes work', () => {
  const plan = life.buildEmergencyWeek({
    tasks: [
      { id: 't1', title: 'Chemistry lab', dueDate: '2026-08-02T23:59:00.000Z', completed: false, gradeImpact: 90, estimatedMinutes: 90, priority: 'high' },
      { id: 't2', title: 'History essay', dueDate: '2026-08-03T23:59:00.000Z', completed: true, gradeImpact: 100, estimatedMinutes: 120 },
      { id: 't3', title: 'Math problem set', dueDate: '2026-08-04T23:59:00.000Z', completed: false, gradeImpact: 60, estimatedMinutes: 45 }
    ],
    timeBlocks: [
      { id: 'b1', title: 'Family dinner', date: '2026-08-02T18:00:00.000Z', fixed: true }
    ]
  }, { now: NOW });

  assert.equal(plan.mode, 'overwhelmed');
  assert.equal(plan.reviewRequired, true, 'the plan is reviewable before applying');
  assert.ok(plan.essentials.length >= 1, 'essential work is selected');
  assert.ok(plan.essentials.every(item => item.id !== 't2'), 'completed work is never scheduled');
  assert.ok(plan.essentials[0].id === 't1', 'the highest-impact open task ranks first');
  assert.deepEqual(plan.fixedCommitments.map(b => b.id), ['b1'], 'fixed commitments are preserved');
  assert.deepEqual(plan.interface.showOnly, ['today', 'timeline', 'focus', 'emergency-plan', 'backup'], 'the emergency surface is a calm subset');
  assert.ok(plan.warnings.some(w => w.includes('leaves lower-impact work unscheduled')), 'deferral is explicit, deletion is never suggested');
  assert.ok(plan.assumptions.some(a => a.includes('Unscheduled work is deferred, not deleted')), 'deferral is called out as non-destructive');
  assert.ok(plan.assumptions.some(a => a.includes('Sleep and fixed commitments are treated as hard constraints')), 'sleep is protected');
  assert.ok(plan.protectedSleepHours >= 7, 'sleep floor is never below seven hours');
});
