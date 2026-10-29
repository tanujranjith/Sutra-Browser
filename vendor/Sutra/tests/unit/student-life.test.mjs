import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const life = require('../../src/domain/student-life.js');

/* ---------------------------------------------------------------- Activities */

test('activity limits are the Common App values and validation reports overflow', () => {
  assert.equal(life.ACTIVITY_LIMITS.position, 50);
  assert.equal(life.ACTIVITY_LIMITS.organization, 100);
  assert.equal(life.ACTIVITY_LIMITS.description, 150);
  const longDesc = 'x'.repeat(160);
  const check = life.validateActivity({ position: 'Captain', organization: 'Team', description: longDesc });
  assert.equal(check.valid, false);
  assert.match(check.errors.join(' '), /description exceeds the 150-character limit by 10/);
  assert.equal(check.remaining.description, -10);
});

test('missing role or organization is rejected; missing impact is a warning', () => {
  const noRole = life.validateActivity({ organization: 'Team', description: 'Did things' });
  assert.equal(noRole.valid, false);
  assert.match(noRole.errors.join(' '), /role or position is required/);
  const noOrg = life.validateActivity({ position: 'Captain', description: 'Did things' });
  assert.equal(noOrg.valid, false);
  assert.match(noOrg.errors.join(' '), /organization or activity name is required/);
  const noImpact = life.validateActivity({ position: 'Captain', organization: 'Team' });
  assert.equal(noImpact.valid, true);
  assert.match(noImpact.warnings.join(' '), /concrete action and measurable impact/);
});

test('normalization preserves full text (no silent truncation) and flags overflow', () => {
  const longDesc = 'y'.repeat(200);
  const row = life.normalizeActivity({ role: 'President', name: 'Robotics Club', impact: longDesc });
  assert.equal(row.description.length, 200, 'full text preserved');
  assert.equal(row.limitViolations.description, 50, 'overflow surfaced, not lost');
  assert.equal(row.position, 'President');
  assert.equal(row.organization, 'Robotics Club');
  assert.ok(row.id);
});

test('upsert rejects over-limit input but stores full text for in-limit input', () => {
  const ws = { collegeAppWorkspace: { activities: [] } };
  assert.throws(() => life.upsertActivity(ws, { id: 'a1', position: 'C'.repeat(60), organization: 'Team', description: 'ok' }), /exceeds/);
  const result = life.upsertActivity(ws, { id: 'a1', position: 'Captain', organization: 'Varsity Soccer', description: 'Led practices.' });
  assert.equal(result.workspace.collegeAppWorkspace.activities.length, 1);
  assert.equal(result.receipt.changedIds[0], 'a1');
  assert.deepEqual(result.receipt.undo.removeActivityIds, ['a1']);
  assert.equal(result.receipt.persistenceStatus, 'pending');
  // Update path yields an activityBefore undo snapshot.
  const updated = life.upsertActivity(result.workspace, { id: 'a1', position: 'Co-Captain', organization: 'Varsity Soccer', description: 'Led practices.' });
  assert.ok(updated.receipt.undo.activityBefore);
  assert.equal(updated.receipt.undo.activityBefore.position, 'Captain');
});

test('activities keep deterministic 1..N order after upsert and reorder', () => {
  let ws = { collegeAppWorkspace: { activities: [] } };
  ws = life.upsertActivity(ws, { id: 'a', position: 'A', organization: 'A', order: 3 }).workspace;
  ws = life.upsertActivity(ws, { id: 'b', position: 'B', organization: 'B', order: 1 }).workspace;
  ws = life.upsertActivity(ws, { id: 'c', position: 'C', organization: 'C', order: 2 }).workspace;
  assert.deepEqual(ws.collegeAppWorkspace.activities.map((r) => r.order), [1, 2, 3]);
  const reordered = life.reorderActivities(ws, ['c', 'a', 'b']);
  const rows = reordered.workspace.collegeAppWorkspace.activities;
  assert.deepEqual(rows.map((r) => r.id + ':' + r.order), ['c:1', 'a:2', 'b:3']);
  assert.ok(reordered.receipt.undo.activityOrderBefore.length === 3);
});

test('reusable descriptions are preserved and overflow flagged', () => {
  const row = life.normalizeActivity({ position: 'Lead', organization: 'Org', reusableDescriptions: [{ label: 'short', description: 'brief' }, { label: 'long', description: 'z'.repeat(180) }] });
  assert.equal(row.reusableDescriptions.length, 2);
  assert.equal(row.reusableDescriptions[1].description.length, 180);
  assert.equal(row.reusableDescriptions[1].overLimitBy, 30);
});

/* -------------------------------------------------------- Submission readiness */

test('submission readiness computes percent, blocked items, and rec gap', () => {
  const ws = { collegeAppWorkspace: {
    collegeTracker: [{ id: 's1', school: 'State U', recLettersRequired: 2, recLettersReceived: 0 }],
    submissionReadiness: [
      { id: 'r1', schoolId: 's1', key: 'transcript', complete: true },
      { id: 'r2', schoolId: 's1', key: 'personal_statement', complete: false }
    ],
    recommenders: [{ status: 'submitted' }]
  } };
  const readiness = life.buildSubmissionReadiness(ws, 's1');
  assert.equal(readiness.school.id, 's1');
  assert.equal(readiness.recommendationGap, 1, '2 required, 1 submitted');
  assert.ok(readiness.percent >= 0 && readiness.percent <= 100);
  assert.equal(readiness.ready, false);
  assert.match(readiness.warnings.join(' '), /1 recommendation letter still needed/);
});

test('submission readiness marks dependency-blocked requirements', () => {
  const ws = { collegeAppWorkspace: {
    collegeTracker: [{ id: 's1', school: 'State U' }],
    submissionReadiness: [{ id: 'base', schoolId: 's1', key: 'transcript', complete: false }]
  } };
  const readiness = life.buildSubmissionReadiness(ws, 's1', {
    requirements: [
      { key: 'transcript', label: 'Transcript' },
      { key: 'review', label: 'Final review', dependencyIds: ['base'] }
    ]
  });
  const review = readiness.requirements.find((r) => r.key === 'review');
  assert.equal(review.dependenciesMet, false, 'base is incomplete so review is blocked');
  assert.ok(readiness.blocked.some((r) => r.key === 'review'));
});

test('unknown school id yields an empty-but-safe readiness result', () => {
  const readiness = life.buildSubmissionReadiness({ collegeAppWorkspace: {} }, 'missing');
  assert.equal(readiness.percent, 0);
  assert.equal(readiness.ready, false);
  assert.ok(Array.isArray(readiness.requirements));
});

/* ------------------------------------------------------------- Essay reuse */

test('essay reuse warns about school-specific risk on high overlap', () => {
  const essays = [
    { id: 'e1', school: 'Alpha University', prompt: 'Why Alpha University community values fit you', versionNotes: 'mentions Alpha traditions' },
    { id: 'e2', school: 'Beta College', prompt: 'Describe a challenge', versionNotes: 'general growth essay' }
  ];
  const result = life.analyzeEssayReuse(essays, { id: 'e3', school: 'Gamma Tech', prompt: 'Why Alpha University community values fit you', versionNotes: 'mentions Alpha traditions' });
  assert.ok(result.matches.length >= 1);
  assert.equal(result.matches[0].essayId, 'e1');
  assert.ok(result.matches[0].similarity >= 20);
  assert.ok(result.warnings.some((w) => /Alpha University/.test(w)));
});

/* ---------------------------------------------------------- Decision matrix */

test('decision matrix is transparent, weighted, and never a prediction', () => {
  const matrix = {
    criteria: [{ id: 'cost', weight: 3 }, { id: 'fit', weight: 2 }, { id: 'ignored', weight: 0 }],
    colleges: [
      { id: 'x', name: 'X', scores: { cost: 8, fit: 6 } },
      { id: 'y', name: 'Y', scores: { cost: 5 } }
    ]
  };
  const result = life.scoreDecisionMatrix(matrix);
  assert.match(result.disclaimer, /not an admissions prediction/i);
  assert.equal(result.totalWeight, 5, 'zero-weight criteria excluded');
  const x = result.ranked.find((r) => r.id === 'x');
  const y = result.ranked.find((r) => r.id === 'y');
  assert.equal(x.coverage, 100);
  assert.equal(y.coverage, 60, 'only cost (weight 3 of 5) answered');
  assert.deepEqual(y.missingCriteriaIds, ['fit']);
  assert.ok(x.score >= 0 && x.score <= 100);
});

/* --------------------------------------------------------- Financial runway */

test('financial runway separates won from pending scholarships and reports status', () => {
  const ws = {
    collegeAppWorkspace: {
      applicationCosts: [{ amount: 80, dueDate: '2026-07-20' }, { amount: 90, waived: true, dueDate: '2026-07-20' }],
      scholarships: [{ amount: 5000, status: 'won' }, { amount: 10000, status: 'researching' }],
      tuitionPlans: [{ amount: 4000, dueDate: '2026-08-01' }]
    },
    lifeWorkspace: {
      openingBalance: 2000,
      spending: [{ amount: 300, date: '2026-07-15' }],
      recurringExpenses: [{ amount: 100 }],
      expectedIncome: [{ amount: 1500, date: '2026-07-25' }]
    }
  };
  const runway = life.computeFinancialRunway(ws, { months: 3, startDate: '2026-07-10' });
  assert.equal(runway.wonScholarships, 5000, 'pending scholarship excluded');
  assert.equal(runway.applicationCosts, 80, 'waived fee excluded');
  assert.equal(runway.recurringExpenses, 300, '100/mo * 3 months');
  assert.equal(runway.tuition, 4000);
  // inflow = 2000 + 1500 + 5000 = 8500 ; outflow = 300 + 300 + 80 + 4000 = 4680
  assert.equal(runway.totalInflow, 8500);
  assert.equal(runway.totalOutflow, 4680);
  assert.equal(runway.endingBalance, 3820);
  assert.equal(runway.status, 'funded');
  assert.ok(runway.assumptions.some((a) => /marked won/i.test(a)));
});

test('financial runway reports a gap when outflow exceeds inflow', () => {
  const ws = { collegeAppWorkspace: { tuitionPlans: [{ amount: 9000 }] }, lifeWorkspace: { openingBalance: 1000 } };
  const runway = life.computeFinancialRunway(ws, { months: 2 });
  assert.equal(runway.endingBalance, -8000);
  assert.equal(runway.status, 'gap');
});

/* ------------------------------------------------------------- Wellness */

test('wellness trends average within window, flag low sleep, stay non-medical', () => {
  const now = '2026-07-10T12:00:00Z';
  const ws = { lifeWorkspace: {
    wellness: { checkIns: [
      { createdAt: '2026-07-09T12:00:00Z', stress: 8 },
      { createdAt: '2026-07-08T12:00:00Z', stress: 7 },
      { createdAt: '2026-01-01T12:00:00Z', stress: 1 } // outside window
    ] },
    sleepTracker: { entries: [{ date: '2026-07-09', totalSleepMinutes: 360 }] }
  } };
  const trends = life.getWellnessTrends(ws, { now, days: 14 });
  assert.equal(trends.samples.checkIns, 2, 'old check-in excluded');
  assert.equal(trends.averages.stress, 7.5);
  assert.equal(Object.prototype.hasOwnProperty.call(trends.averages, 'energy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(trends.direction, 'energy'), false);
  assert.equal(trends.averages.sleepMinutes, 360);
  assert.ok(trends.signals.some((s) => /Stress has been high/.test(s)));
  assert.ok(trends.signals.some((s) => /below seven hours/.test(s)));
  assert.match(trends.disclaimer, /not medical/i);
});

/* --------------------------------------------------------- Emergency Week */

test('emergency week is deterministic, defers (not deletes) work, protects sleep', () => {
  const ws = {
    tasks: [
      { id: 't1', title: 'Essay', dueAt: '2026-07-11T23:00:00Z', gradeImpact: 40, estimatedMinutes: 120 },
      { id: 't2', title: 'Reading', dueAt: '2026-07-16T23:00:00Z', gradeImpact: 5, estimatedMinutes: 60 },
      { id: 't3', title: 'Done', completed: true }
    ],
    timeBlocks: [{ id: 'b1', startAt: '2026-07-11T15:00:00Z', fixed: true }]
  };
  const now = '2026-07-10T08:00:00Z';
  const a = life.buildEmergencyWeek(ws, { now, dailyCapacityMinutes: 180 });
  const b = life.buildEmergencyWeek(ws, { now, dailyCapacityMinutes: 180 });
  assert.deepEqual(a.essentials.map((e) => e.id), b.essentials.map((e) => e.id), 'deterministic');
  assert.equal(a.reviewRequired, true);
  assert.ok(a.protectedSleepHours >= 7);
  assert.ok(a.essentials.some((e) => e.id === 't1'), 'high-impact task selected');
  assert.ok(!a.essentials.some((e) => e.id === 't3'), 'completed task excluded');
  // Nothing deleted: every non-complete task appears in essentials or deferred.
  const covered = new Set(a.essentials.concat(a.deferred).map((e) => e.id));
  assert.ok(covered.has('t1') && covered.has('t2'));
  assert.equal(a.fixedCommitments.length, 1);
  assert.ok(a.assumptions.some((s) => /deferred, not deleted/i.test(s)));
  // Minimum-viable minutes never exceed the original estimate.
  a.essentials.forEach((e) => assert.ok(e.minimumViableMinutes <= e.originalMinutes));
});

test('emergency week tolerates tasks with no due date and empty workspace', () => {
  const plan = life.buildEmergencyWeek({ tasks: [{ id: 'x', title: 'Someday' }] }, { now: '2026-07-10T08:00:00Z' });
  assert.ok(plan.essentials.length + plan.deferred.length >= 1);
  const empty = life.buildEmergencyWeek({}, { now: '2026-07-10T08:00:00Z' });
  assert.deepEqual(empty.essentials, []);
});

/* --------------------------------------------------- Operating Manual */

test('operating manual normalizes to stable shape with sane defaults', () => {
  const manual = life.normalizeOperatingManual({ preferredStudyTimes: ['morning'], hardConstraints: ['Work Fri 5-9pm'], extraPlugin: 'kept?' });
  assert.equal(manual.version, 1);
  assert.deepEqual(manual.preferredStudyTimes, ['morning']);
  assert.equal(manual.reminderStyle, 'calm');
  assert.equal(manual.planningStyle, 'balanced');
  assert.deepEqual(manual.hardConstraints, ['Work Fri 5-9pm']);
  assert.ok(manual.updatedAt);
});
