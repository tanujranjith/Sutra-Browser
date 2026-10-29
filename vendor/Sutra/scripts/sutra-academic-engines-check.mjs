#!/usr/bin/env node
// sutra-academic-engines-check.mjs — execute the deterministic academic
// engines (no DOM, no AI) and verify their math:
//   • school-schedule.js — A/B + cycle rotation, holidays, busy windows
//   • grade-planner.js   — weighted grades, missing work, target solving, GPA
//   • semester-setup.js  — local syllabus/calendar text extraction
//   • assignment-studio.js — studio normalization + progress
//
// These engines power user-facing academic decisions, so they are tested by
// EXECUTION, not by grep. Run: node scripts/sutra-academic-engines-check.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let failures = 0;
const ok = (cond, msg, detail) => {
  if (cond) console.log('  ok:', msg);
  else { failures++; console.error('  FAIL:', msg, detail === undefined ? '' : `(got ${JSON.stringify(detail)})`); }
};
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
console.log('School Schedule — rotation engine');
const SS = require('../src/features/academic/school-schedule.js');

const baseSchedule = {
  enabled: true,
  term: { name: 'Spring', startDate: '2026-01-01', endDate: '2026-06-15' },
  rotation: {
    type: 'ab', cycleLength: 2, labels: ['A', 'B'],
    anchorDate: '2026-01-05', anchorIndex: 0, // Monday Jan 5 2026 = A day
    skipWeekends: true, skipNoSchoolDays: true
  },
  schedules: [{
    id: 'reg', name: 'Regular',
    periods: [
      { id: 'p1', label: 'Period 1', start: '08:00', end: '08:50' },
      { id: 'p2', label: 'Period 2', start: '09:00', end: '09:50' }
    ]
  }],
  defaultScheduleId: 'reg',
  dayTemplates: { A: { scheduleId: 'reg', assignments: { p1: 'course-1' } } },
  overrides: [],
  subscriptions: [],
  settings: {}
};
let ws = SS.normalizeSchoolSchedule(baseSchedule);

ok(SS.resolveDayInfo(ws, '2026-01-05').labelKey === 'A', 'anchor Monday resolves to A day');
ok(SS.resolveDayInfo(ws, '2026-01-06').labelKey === 'B', 'next school day alternates to B');
ok(SS.resolveDayInfo(ws, '2026-01-07').labelKey === 'A', 'A/B keeps alternating');
ok(SS.resolveDayInfo(ws, '2026-01-10').isSchoolDay === false, 'Saturday is not a school day');
ok(SS.resolveDayInfo(ws, '2026-01-12').labelKey === 'B', 'weekend does not consume a cycle day (Mon=B)', SS.resolveDayInfo(ws, '2026-01-12').labelKey);
ok(SS.resolveDayInfo(ws, '2026-01-02').labelKey === 'B', 'rotation counts backwards before the anchor too');

// Holiday consumes no cycle day.
ws = SS.normalizeSchoolSchedule({ ...baseSchedule, overrides: [{ date: '2026-01-06', kind: 'holiday', label: 'Snow day' }] });
ok(SS.resolveDayInfo(ws, '2026-01-06').isSchoolDay === false, 'holiday override is not a school day');
ok(SS.resolveDayInfo(ws, '2026-01-06').reason === 'holiday', 'holiday reason surfaces');
ok(SS.resolveDayInfo(ws, '2026-01-07').labelKey === 'B', 'holiday does not consume a rotation day', SS.resolveDayInfo(ws, '2026-01-07').labelKey);

// Periods + busy windows + study windows.
const dayInfo = SS.resolveDayInfo(SS.normalizeSchoolSchedule(baseSchedule), '2026-01-05');
ok(dayInfo.periods.length === 2 && dayInfo.periods[0].courseId === 'course-1', 'A-day template maps Period 1 to its course');
const busy = SS.getBusyWindowsForDate(SS.normalizeSchoolSchedule(baseSchedule), '2026-01-05');
ok(busy.length === 2 && busy[0].start === 480 && busy[0].end === 530, 'class periods become busy minute-windows', busy);
const free = SS.getStudyWindowsForDate(SS.normalizeSchoolSchedule(baseSchedule), '2026-01-05', { dayStart: 420, dayEnd: 660 });
ok(free.length === 2 && free[0].end === 480 && free[1].start === 590, 'study windows avoid class periods', free);

// Special schedule override.
ws = SS.normalizeSchoolSchedule({
  ...baseSchedule,
  schedules: baseSchedule.schedules.concat([{ id: 'early', name: 'Early dismissal', periods: [{ id: 'e1', label: 'Period 1', start: '08:00', end: '08:30' }] }]),
  overrides: [{ date: '2026-01-07', kind: 'early_dismissal', scheduleId: 'early', label: 'Early out' }]
});
ok(SS.resolveDayInfo(ws, '2026-01-07').scheduleName === 'Early dismissal', 'special-day override swaps the bell schedule');

// Weekly mode.
ws = SS.normalizeSchoolSchedule({ ...baseSchedule, rotation: { ...baseSchedule.rotation, type: 'weekly' }, dayTemplates: { mon: { scheduleId: 'reg', assignments: {} } } });
ok(SS.resolveDayInfo(ws, '2026-01-05').labelKey === 'mon', 'weekly rotation keys by weekday');

// ---------------------------------------------------------------------------
console.log('\nGrade Planner — deterministic grade math');
const GP = require('../src/features/academic/grade-planner.js');

const course = GP.normalizeCourseGrades({
  categories: [
    { id: 'tests', name: 'Tests', weight: 60 },
    { id: 'hw', name: 'Homework', weight: 40 }
  ],
  entries: [
    { id: 'e1', categoryId: 'tests', title: 'Test 1', score: 45, maxScore: 50, status: 'graded' },
    { id: 'e2', categoryId: 'hw', title: 'HW 1', score: 10, maxScore: 10, status: 'graded' }
  ]
});
let grade = GP.computeCourseGrade(course);
ok(near(grade.percent, 94), 'weighted grade: 60%×90 + 40%×100 = 94', grade.percent);
ok(grade.letter === 'A', 'letter derives from percent', grade.letter);

const withMissing = GP.normalizeCourseGrades({
  categories: course.categories,
  entries: course.entries.concat([{ id: 'e3', categoryId: 'tests', title: 'Test 2', score: 0, maxScore: 50, status: 'missing' }])
});
grade = GP.computeCourseGrade(withMissing);
ok(near(grade.percent, 67), 'missing work counts as zero (45/100 in tests → 67 overall)', grade.percent);
ok(grade.missingCount === 1, 'missing count surfaces');

const withExcused = GP.normalizeCourseGrades({
  categories: course.categories,
  entries: course.entries.concat([{ id: 'e4', categoryId: 'tests', title: 'Excused quiz', score: 0, maxScore: 50, status: 'excused' }])
});
ok(near(GP.computeCourseGrade(withExcused).percent, 94), 'excused work never counts');

const withDrops = GP.normalizeCourseGrades({
  categories: [{ id: 'q', name: 'Quizzes', weight: 100, drops: 1 }],
  entries: [
    { id: 'q1', categoryId: 'q', title: 'Q1', score: 5, maxScore: 10, status: 'graded' },
    { id: 'q2', categoryId: 'q', title: 'Q2', score: 10, maxScore: 10, status: 'graded' }
  ]
});
ok(near(GP.computeCourseGrade(withDrops).percent, 100), 'drop-lowest removes the worst score', GP.computeCourseGrade(withDrops).percent);

// Target solving in points mode: 80/100 now, target 85 with a 100-pt final → need 90.
const pointsCourse = GP.normalizeCourseGrades({
  categories: [],
  entries: [{ id: 'p1', categoryId: '', title: 'Work so far', score: 80, maxScore: 100, status: 'graded' }]
});
const solved = GP.scoreNeededForTarget(pointsCourse, { categoryId: '', maxScore: 100, targetPercent: 85 });
ok(solved.possible && near(solved.neededScore, 90, 0.2), 'final-score solver: need 90/100 to reach 85%', solved.neededScore);
ok(GP.scoreNeededForTarget(pointsCourse, { categoryId: '', maxScore: 100, targetPercent: 95 }).achievable === false, 'unreachable targets are reported honestly');

// Impact ranking: completing a missing item should rank above pending busywork.
const impact = GP.rankImpact(withMissing);
ok(impact.length === 1 && impact[0].title === 'Test 2' && impact[0].delta > 20, 'missing test ranked as biggest win', impact);

// GPA: AP 95% + regular 85% → unweighted 3.5, weighted 4.0.
const gpa = GP.computeGpa([
  { percent: 95, credits: 1, level: 'ap', includeInGpa: true },
  { percent: 85, credits: 1, level: 'regular', includeInGpa: true }
], GP.getDefaultGradePlanner().settings);
ok(near(gpa.unweighted, 3.5), 'unweighted GPA averages letter points', gpa.unweighted);
ok(near(gpa.weighted, 4.0), 'weighted GPA applies the AP boost', gpa.weighted);

// Multi-credit courses must retain their real weighting. A 5-credit A paired
// with a 1-credit C produces (5*4 + 1*2) / 6, not an artificial 3-credit cap.
const multiCredit = GP.computeGpa([
  { percent: 95, credits: 5, level: 'regular', includeInGpa: true },
  { percent: 75, credits: 1, level: 'regular', includeInGpa: true }
], GP.getDefaultGradePlanner().settings);
ok(near(multiCredit.unweighted, 3.67) && multiCredit.totalCredits === 6,
  '5-credit courses retain their real GPA weight', multiCredit);
ok(GP.normalizeCourseGrades({ gpa: { credits: 5 } }).gpa.credits === 5,
  'course normalization preserves 5-credit courses');

// Grade risk classification (deterministic enum safe/watch/risk/danger/unknown).
const riskSafe = GP.computeGradeRisk(GP.normalizeCourseGrades({ targetPercent: 90, categories: [], entries: [{ id: 'e', categoryId: '', title: 'A', score: 95, maxScore: 100, status: 'graded' }] }));
ok(riskSafe.status === 'safe', 'a grade above target is safe', riskSafe);
const riskDanger = GP.computeGradeRisk(GP.normalizeCourseGrades({ targetPercent: 90, categories: [], entries: [{ id: 'e', categoryId: '', title: 'A', score: 70, maxScore: 100, status: 'graded' }] }));
ok(riskDanger.status === 'danger', 'a grade far below target is danger', riskDanger);
const riskUnknown = GP.computeGradeRisk(GP.normalizeCourseGrades({ categories: [], entries: [] }));
ok(riskUnknown.status === 'unknown' && riskUnknown.percent === null, 'no graded work yields unknown, not a fake grade', riskUnknown);
const riskNoTarget = GP.computeGradeRisk(GP.normalizeCourseGrades({ categories: [], entries: [{ id: 'e', categoryId: '', title: 'A', score: 84, maxScore: 100, status: 'graded' }] }));
ok(riskNoTarget.status === 'watch', 'without a target, absolute thresholds apply (84% → watch)', riskNoTarget);
const riskMissingDrag = GP.computeGradeRisk(GP.normalizeCourseGrades({ targetPercent: 88, categories: [], entries: [
  { id: 'e1', categoryId: '', title: 'A', score: 95, maxScore: 100, status: 'graded' },
  { id: 'm1', categoryId: '', title: 'M1', score: 0, maxScore: 100, status: 'missing' },
  { id: 'm2', categoryId: '', title: 'M2', score: 0, maxScore: 100, status: 'missing' }
] }));
ok(riskMissingDrag.missingCount === 2 && riskMissingDrag.status !== 'safe', 'missing work pulls an otherwise-safe grade down a notch', riskMissingDrag);

const radar = GP.projectGradeScenarios(GP.normalizeCourseGrades({
  targetPercent: 90,
  categories: [{ id: 'tests', name: 'Tests', weight: 100 }],
  entries: [
    { id: 'past', categoryId: 'tests', title: 'Midterm', score: 80, maxScore: 100, status: 'graded' },
    { id: 'final', categoryId: 'tests', title: 'Final', score: 0, maxScore: 100, status: 'pending' }
  ]
}), { expectedPercent: 85 });
ok(radar.scenarios.worst.grade.percent === 40 && radar.scenarios.best.grade.percent === 90, 'risk radar computes best/worst pending-work scenarios', radar.scenarios);
ok(radar.scenarios.expected.grade.percent === 82.5, 'risk radar computes the labeled expected scenario', radar.scenarios.expected);
ok(radar.upcomingLeverage[0].title === 'Final' && radar.upcomingLeverage[0].swing === 50, 'risk radar ranks upcoming assessment leverage', radar.upcomingLeverage);
ok(radar.targetRequirement && near(radar.targetRequirement.neededPercent, 100, 0.2), 'risk radar solves the target requirement', radar.targetRequirement);
const radarAssumptions = GP.projectGradeScenarios(GP.normalizeCourseGrades({ categories: [{ id: 'x', name: 'Only', weight: 70 }], entries: [] }));
ok(radarAssumptions.confidence === 'low' && radarAssumptions.assumptions.length >= 3, 'incomplete grade data is explicitly assumption-labeled', radarAssumptions);

console.log('\nLearning Engine — calibration, corrections, and exam readiness');
const LE = require('../src/domain/learning-engine.js');
const prediction = LE.startConfidenceCheck({ masteryRecords: [], confidenceObservations: [] }, { id: 'pred-1', key: 'bio:cells', confidence: 0.9 }, { now: '2026-07-10T09:00:00Z' });
const revealed = LE.resolveConfidenceCheck(prediction.workspace, 'pred-1', { correct: false }, { now: '2026-07-10T09:01:00Z' });
const calibration = LE.getCalibration(revealed.workspace);
ok(calibration.samples === 1 && calibration.tendency === 'overconfident' && calibration.brierScore === 0.81, 'confidence is captured before reveal and calibration is scored', calibration);
const correction = LE.createCorrectionFromMistake({ reviewWorkspace: { decks: [], items: [], sessions: [], settings: {} }, tasks: [] }, { id: 'mistake-1', courseName: 'Biology', question: 'Cell energy molecule?', correctAnswer: 'ATP' }, { now: '2026-07-10T09:00:00Z' });
ok(correction.card.sourceCitation.id === 'mistake-1' && correction.workspace.tasks.length === 1, 'mistake creates a cited correction card plus follow-up practice', correction.receipt);
const learningWorkspace = { masteryRecords: [{ key: 'bio:cells', score: .5, attempts: 2, lastObservedAt: '2026-07-09T09:00:00Z' }] };
const examReadiness = LE.computeReadiness(learningWorkspace, { id: 'bio', courseId: 'bio', examDate: '2026-07-12T09:00:00Z', practiceTests: [{ percent: 70, completedAt: '2026-07-09T09:00:00Z' }], mistakes: [{ id: 'm1', unresolved: true }] }, { now: '2026-07-10T09:00:00Z' });
ok(examReadiness.daysUntil === 2 && examReadiness.components.mastery === 50, 'readiness exposes weighted components and days remaining', examReadiness);
const final72 = LE.buildFinal72Plan(learningWorkspace, { id: 'bio', courseId: 'bio', examDate: '2026-07-12T09:00:00Z', mistakes: [{ id: 'm1', title: 'Membranes', resolved: false }] }, { now: '2026-07-10T09:00:00Z', protectedSleepHours: 8 });
ok(final72.eligible && final72.reviewRequired && final72.protectedSleepHours === 8, 'final-72-hours plan is reviewed and sleep-protected', final72);

// ---------------------------------------------------------------------------
console.log('\nSemester Setup — local extraction');
const SEM = require('../src/features/academic/semester-setup.js');

const sample = [
  'AP Biology — Mr. Smith (Room 204)',
  'Grading Policy:',
  'Tests: 40%',
  'Homework: 25%',
  'Labs: 35%',
  'Class meets MWF 10:00 am - 10:50 am',
  'Lab report due 9/12/2026',
  'Midterm exam October 16, 2026',
  'No School — Thanksgiving Break 11/25/2026'
].join('\n');
const parsed = SEM.parseSourceText(sample, { id: 'src1' });
const kinds = parsed.items.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
ok(kinds.course === 1, 'detects the course header', kinds);
ok(parsed.items.find(i => i.kind === 'course' && /smith/i.test(i.teacher)), 'captures the teacher name');
ok(kinds.grading_category === 3, 'captures all grading weights', kinds);
ok(parsed.items.find(i => i.kind === 'grading_category' && i.title === 'Tests' && i.weight === 40), 'grading weight value parsed');
ok(kinds.assignment >= 1 && parsed.items.find(i => i.kind === 'assignment' && i.date === '2026-09-12'), 'assignment with slash date parsed', parsed.items.filter(i => i.kind === 'assignment'));
ok(parsed.items.find(i => i.kind === 'exam' && i.date === '2026-10-16'), 'exam with month-name date parsed');
ok(parsed.items.find(i => i.kind === 'no_school' && i.date === '2026-11-25'), 'no-school day parsed');
ok(parsed.items.find(i => i.kind === 'recurring_class' && i.days.join(',') === '1,3,5' && i.time === '10:00'), 'MWF meeting times parsed', parsed.items.filter(i => i.kind === 'recurring_class'));
ok(parsed.items.filter(i => i.kind === 'grading_category').every(i => i.courseName === 'AP Biology'), 'grading weights attach to the current course');

ok(SEM.parseDayTokens('TTh') .join(',') === '2,4', 'compact TTh day tokens', SEM.parseDayTokens('TTh'));
ok(SEM.parseTimeToken('2:30 pm') === '14:30', '12-hour time normalizes');

// Item normalization is idempotent under the workspace normalizer.
const wsState = SEM.normalizeSemesterSetup({ drafts: [{ id: 'd1', items: parsed.items, sources: [], status: 'in_review' }] });
ok(wsState.drafts.length === 1 && wsState.drafts[0].items.length === parsed.items.length, 'drafts normalize losslessly');

// ---------------------------------------------------------------------------
console.log('\nAssignment Studio — progress + normalization');
const AS = require('../src/features/academic/assignment-studio.js');
const studio = AS.normalizeStudio({
  milestones: [{ title: 'Draft', done: true }, { title: 'Final', done: false }],
  subtasks: [{ title: 'Sources', done: false }, { title: 'Outline', done: true }],
  rubric: [{ criterion: 'Thesis', points: 10 }],
  effort: { estimateMinutes: 120, loggedMinutes: 25 }
});
ok(studio.milestones.length === 2 && studio.subtasks.length === 2, 'studio payload normalizes');
ok(AS.computeProgress(studio) === 50, 'progress weighs milestones double (3/6 = 50%)', AS.computeProgress(studio));
ok(AS.normalizeStudio({ milestones: [{ title: '' }] }).milestones.length === 0, 'empty milestones are dropped');
ok(AS.normalizeStudio(null) === null, 'null studio stays null (no phantom payloads)');

// Studio 2.0 — extended milestone shape stays backward-compatible with `done`.
const legacyMs = AS.normalizeStudio({ milestones: [{ title: 'Old', done: true }] }).milestones[0];
ok(legacyMs.status === 'done' && legacyMs.done === true, 'legacy done-only milestone derives status=done', legacyMs);
ok(Array.isArray(legacyMs.linkedBlockIds) && typeof legacyMs.linkedNoteId === 'string' && legacyMs.type === 'other', 'new milestone fields default safely', legacyMs);
const statusMs = AS.normalizeStudio({ milestones: [{ title: 'WIP', status: 'in_progress' }] }).milestones[0];
ok(statusMs.status === 'in_progress' && statusMs.done === false, 'in_progress status does not count as done', statusMs);

// Studio 2.0 — deterministic per-type generation.
ok(AS.resolvePlanKey('Persuasive Essay') === 'essay', 'essay kind resolves', AS.resolvePlanKey('Persuasive Essay'));
ok(AS.resolvePlanKey('Unit 4 Quiz') === 'test', 'quiz resolves to test plan');
ok(AS.resolvePlanKey('Read chapter 7') === 'reading', 'reading resolves');
const essayGen = AS.generateMilestones('essay');
ok(essayGen.length === 6 && essayGen[0].type === 'research' && essayGen[essayGen.length - 1].type === 'submit', 'essay plan runs research → submit', essayGen.map(m => m.title));
ok(AS.generateMilestones('totally unknown kind').length === 3, 'unknown kind falls back to the generic plan');

// Studio 2.0 — work-backward scheduling.
const sched = AS.scheduleMilestonesBackward(essayGen, '2026-06-30', { startDate: '2026-06-16' });
ok(sched.milestones.every(m => m.dueDate && m.dueDate <= '2026-06-30'), 'no milestone is scheduled after the due date', sched.milestones.map(m => m.dueDate));
ok(sched.milestones[sched.milestones.length - 1].dueDate === '2026-06-30', 'final milestone lands on the deadline');
ok(sched.milestones.every((m, i, a) => i === 0 || m.dueDate >= a[i - 1].dueDate), 'milestones are in non-decreasing date order');
ok(sched.compressed === false && sched.pressure === false, 'a 2-week runway is neither compressed nor high pressure', sched);
const crunch = AS.scheduleMilestonesBackward(essayGen, '2026-06-17', { startDate: '2026-06-16' });
ok(crunch.compressed === true && crunch.pressure === true, 'a 1-day runway is flagged compressed + high pressure', crunch);
const overdue = AS.scheduleMilestonesBackward(essayGen, '2026-06-10', { startDate: '2026-06-16' });
ok(overdue.milestones.every(m => m.dueDate === '2026-06-10'), 'a past due date produces a same-day crunch plan');
ok(AS.scheduleMilestonesBackward(essayGen, '').milestones.length === 6 && !AS.scheduleMilestonesBackward(essayGen, '').compressed, 'no due date leaves milestones undated without crashing');

// ---------------------------------------------------------------------------
console.log('\nPlanning Engine — deterministic plan + repair');
const PE = require('../src/features/academic/planning-engine.js');
// Two items, one overdue & high-priority, into a day with a class 9:00-10:00.
const plan = PE.planWork({
  today: '2026-06-16',
  dates: ['2026-06-16', '2026-06-17'],
  items: [
    { id: 'a', kind: 'task', title: 'Essay revision', dueDate: '2026-06-15', priority: 'high', difficulty: 'hard', estimateMinutes: 60 },
    { id: 'b', kind: 'task', title: 'Reading', dueDate: '2026-06-17', priority: 'low', difficulty: 'easy', estimateMinutes: 40 }
  ],
  // 8:00-9:00 free, 9:00-10:00 class (busy → not in free), 10:00-12:00 free
  freeWindowsByDate: {
    '2026-06-16': [{ start: 8 * 60, end: 9 * 60 }, { start: 10 * 60, end: 12 * 60 }],
    '2026-06-17': [{ start: 15 * 60, end: 18 * 60 }]
  },
  prefs: { studyBlockMinutes: 45, breakMinutes: 10, maxDailyBlocks: 4, maxBlockMinutes: 60 }
});
ok(plan.blocks.length >= 2, 'planner produces blocks for open work', plan.blocks.map(b => b.title + '@' + b.date + ' ' + b.start));
// No two blocks on the same day overlap.
const byDate = {};
plan.blocks.forEach(b => { (byDate[b.date] = byDate[b.date] || []).push(b); });
let overlap = false;
Object.values(byDate).forEach(list => {
  list.sort((x, y) => x.startMin - y.startMin);
  for (let i = 1; i < list.length; i++) if (list[i].startMin < list[i - 1].endMin) overlap = true;
});
ok(!overlap, 'no two suggested blocks overlap');
// Nothing scheduled inside the 9-10 class window.
ok(plan.blocks.every(b => !(b.date === '2026-06-16' && b.startMin < 10 * 60 && b.endMin > 9 * 60)), 'planner avoids the class period');
// The overdue high-priority item is scheduled at/before its due date is impossible (overdue),
// but it must rank first → earliest block belongs to item 'a'.
ok(plan.blocks[0].sourceId === 'a', 'overdue high-priority work is scheduled first', plan.blocks[0]);
// Reading (due 6-17) is not placed after its due date.
ok(plan.blocks.filter(b => b.sourceId === 'b').every(b => b.date <= '2026-06-17'), 'work is never scheduled after its due date');
// Every block explains itself.
ok(plan.blocks.every(b => b.reason && b.reason.length), 'every block carries a plain-language reason');

// Repair detects an overlap and a no-buffer back-to-back.
const repair = PE.analyzePlan({
  today: '2026-06-16',
  blocks: [
    { id: 'x', date: '2026-06-16', start: '10:00', end: '11:00', name: 'Math' },
    { id: 'y', date: '2026-06-16', start: '10:30', end: '11:30', name: 'Science' },
    { id: 'z', date: '2026-06-17', start: '09:00', end: '10:00', name: 'A' },
    { id: 'w', date: '2026-06-17', start: '10:00', end: '11:00', name: 'B' }
  ],
  signals: { reviewDue: 12, hasReviewSession: false, apExams: [{ id: 'apbio', name: 'AP Bio', examDate: '2026-06-30', daysUntil: 14, hasStudyBlock: false }] },
  prefs: { breakMinutes: 10 }
});
const repairKinds = repair.issues.map(i => i.kind);
ok(repairKinds.includes('overlap'), 'repair flags overlapping blocks', repairKinds);
ok(repairKinds.includes('no_buffer'), 'repair flags back-to-back with no buffer', repairKinds);
ok(repairKinds.includes('ap_no_study'), 'repair flags an AP exam within 21 days with no study blocks');
ok(repairKinds.includes('review_no_session'), 'repair flags review backlog with no session');
ok(repair.issues[0].severity === 'high', 'repair sorts high-severity issues first', repair.issues[0]);

// ---------------------------------------------------------------------------
console.log('\nImport Wizard — multi-format parser + normalization');
const FI = require('../src/features/assistant/flow-intelligence.js');
const mdRows = FI.parseAssignmentText('| Title | Course | Due |\n|---|---|---|\n| Essay on WWII | History | 2026-06-20 |\n| Lab report | Chemistry | 2026-06-22 |');
ok(mdRows.length === 2 && mdRows[0].title === 'Essay on WWII' && mdRows[0].course === 'History' && mdRows[0].dueDate === '2026-06-20', 'markdown table parses title/course/due', mdRows);
const csvRows = FI.parseAssignmentText('Assignment,Class,Due Date,Priority\nRead ch 5,Bio,2026-06-18,high\nProblem set,Math,2026-06-19,medium');
ok(csvRows.length === 2 && csvRows[1].course === 'Math' && csvRows[0].priority === 'high', 'CSV with header maps columns by name', csvRows);
const tsvRows = FI.parseAssignmentText('Task\tCourse\tDue\nLab safety quiz\tChem\t2026-06-21');
ok(tsvRows.length === 1 && tsvRows[0].title === 'Lab safety quiz', 'TSV with header parses', tsvRows);
const dashRows = FI.parseAssignmentText('Study for quiz - Spanish - 6/20 2:30pm');
ok(dashRows[0].course === 'Spanish' && dashRows[0].dueTime === '2:30pm' && dashRows[0].dueDate === '6/20', 'dash rows split date and time', dashRows[0]);
const sylRows = FI.parseAssignmentText('The midterm exam will be held on October 16. Final essay due December 5.');
ok(sylRows.length === 2 && /midterm/i.test(sylRows[0].title) && sylRows[1].dueDate === 'December 5', 'syllabus prose yields one row per dated sentence', sylRows.map(r => r.title + '|' + r.dueDate));
ok(FI.parseAssignmentText('').length === 0, 'empty text yields no rows');
// Normalization adds confidence + ambiguity + suggested destinations.
const normd = FI.normalizeImportBatch(mdRows);
ok(normd[0].type === 'essay' && normd[0].confidence >= 0.7 && Array.isArray(normd[0].destinations) && normd[0].destinations.includes('homework'), 'normalized rows infer type, confidence, and destinations', normd[0]);
const ambiguous = FI.normalizeImportBatch([{ title: 'Something', dueDate: 'whenever' }]);
ok(ambiguous[0].ambiguity.includes('unparsed-date') && ambiguous[0].ambiguity.includes('no-course'), 'ambiguity flags surface unparsed dates and missing course', ambiguous[0].ambiguity);
// Title similarity backs the duplicate detector.
ok(FI.titleSimilarity('Read chapter 5', 'read ch 5') < 1 && FI.titleSimilarity('Essay on WWII', 'Essay on WWII') === 1, 'title similarity is normalized + bounded');

// --- Import parser regressions (bug-check pass) ---
const thisYear = new Date().getFullYear();
ok(FI.toISODate('6/22') === thisYear + '-06-22', 'bare M/D uses the current year, NOT 2001 (date-corruption fix)', FI.toISODate('6/22'));
ok(FI.toISODate('June 18') === thisYear + '-06-18', 'month-name without year uses current year', FI.toISODate('June 18'));
ok(FI.toISODate('06/18/2026') === '2026-06-18', 'explicit M/D/Y is preserved');
ok(FI.toISODate('whenever') === '' && FI.toISODate('') === '', 'unparseable dates return empty (so ambiguity is flagged, not invented)');
const wkTitle = FI.parseAssignmentText('The Wednesday Wars essay | English');
ok(wkTitle[0].title === 'The Wednesday Wars essay' && wkTitle[0].course === 'English' && !wkTitle[0].dueDate, 'a title containing a weekday word is not mistaken for a date', wkTitle[0]);
const sunny = FI.parseAssignmentText('Sunny day poem | English');
ok(sunny[0].title === 'Sunny day poem' && !sunny[0].dueDate, '"Sunny" is not parsed as Sunday', sunny[0]);
const twoDate = FI.parseAssignmentText('Essay - 6/20 - 6/22');
ok(twoDate[0].dueDate === '6/20' && !twoDate[0].course, 'a second date token is dropped, never filed as the course', twoDate[0]);
ok(FI.parseAssignmentText('Course | Due\nHistory | 2026-06-20').length === 0, 'a header row with no title column is not imported as a junk assignment');
const dateless = FI.parseAssignmentText('Read chapter 5');
ok(dateless.length === 1 && dateless[0].title === 'Read chapter 5', 'a valid dateless assignment line is kept, not silently dropped', dateless);
const twoWord = FI.parseAssignmentText('Title | Due Date\nEssay | 2026-06-20');
ok(twoWord[0].title === 'Essay' && twoWord[0].dueDate === '2026-06-20', 'two-word "Due Date" header maps correctly (no title/class swap)', twoWord[0]);
const wkReal = FI.parseAssignmentText('Quiz - Spanish - Friday 2:30pm');
ok(wkReal[0].dueDate === 'Friday' && wkReal[0].dueTime === '2:30pm' && wkReal[0].course === 'Spanish', 'a short weekday+time cell still parses as date+time', wkReal[0]);

// --- Assignment Studio done/status reconciliation (bug-check pass) ---
const contradictory = AS.normalizeStudio({ milestones: [{ title: 'X', status: 'in_progress', done: true }] }).milestones[0];
ok(contradictory.done === true && contradictory.status === 'done', 'an explicit done:true is never lost when status disagrees', contradictory);
const statusDone = AS.normalizeStudio({ milestones: [{ title: 'Y', status: 'done', done: false }] }).milestones[0];
ok(statusDone.done === true, 'status:done implies done:true', statusDone);

// --- Grade risk hardening (bug-check pass) ---
const nanTarget = GP.computeGradeRisk({ categories: [], entries: [{ id: 'e', categoryId: '', title: 't', score: 90, maxScore: 100, status: 'graded' }], targetPercent: 'A' });
ok(nanTarget.status === 'safe' && nanTarget.target === null && !/NaN/.test(nanTarget.reason), 'a non-numeric target is ignored (no false danger, no NaN in reason)', nanTarget);
ok(GP.computeGradeRisk({ entries: [null] }).status === 'unknown', 'null entries do not throw (returns unknown)');
ok(GP.computeGradeRisk({ entries: [null, { id: 'e', categoryId: '', title: 't', score: 80, maxScore: 100, status: 'graded' }] }).percent === 80, 'null entries are skipped, real ones still counted');

// --- Planning engine due-time enforcement (bug-check pass) ---
const dtCap = PE.planWork({
  today: '2026-06-16', dates: ['2026-06-16'],
  items: [{ id: 'a', title: 'X', dueDate: '2026-06-16', dueTime: '09:00', estimateMinutes: 60 }],
  freeWindowsByDate: { '2026-06-16': [{ start: 600, end: 720 }] } // 10:00-12:00, all after the 09:00 due time
});
ok(dtCap.blocks.length === 0 && dtCap.unplaced.length === 1, 'work is never scheduled after its due TIME on the due date', dtCap);
const dtOk = PE.planWork({
  today: '2026-06-16', dates: ['2026-06-16'],
  items: [{ id: 'a', title: 'X', dueDate: '2026-06-16', dueTime: '12:00', estimateMinutes: 60 }],
  freeWindowsByDate: { '2026-06-16': [{ start: 540, end: 720 }] }
});
ok(dtOk.blocks.length === 1 && dtOk.blocks[0].endMin <= 12 * 60, 'a slot finishing by the due time is allowed', dtOk.blocks[0]);
const clampB = PE.planWork({
  today: '2026-06-16', dates: ['2026-06-16'],
  items: [{ id: 'a', title: 'X', dueDate: '2026-06-16', estimateMinutes: 30 }],
  freeWindowsByDate: { '2026-06-16': [{ start: 1400, end: 1440 }] }, prefs: { maxBlockMinutes: 60 }
});
ok(clampB.blocks[0].endMin <= 1439 && PE.hhmmToMinutes(clampB.blocks[0].end) === clampB.blocks[0].endMin, 'block HH:MM string never desyncs from its minute value (1440 clamp)', clampB.blocks[0]);

// Anti-clustering: a multi-chunk item across a multi-day runway must spread
// across distinct days, not pile into the earliest free slots.
const spreadDates = ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24'];
const spreadPlan = PE.planWork({
  today: '2026-06-20', dates: spreadDates,
  items: [{ id: 'p1', kind: 'task', title: 'Essay', dueDate: '2026-06-25', estimateMinutes: 270, priority: 'high', difficulty: 'hard' }],
  freeWindowsByDate: Object.fromEntries(spreadDates.map(d => [d, [{ start: 540, end: 1020 }]]))
});
const spreadDays = new Set(spreadPlan.blocks.map(b => b.date));
ok(spreadPlan.blocks.length >= 3 && spreadDays.size >= 3, 'multi-chunk work spreads across distinct days (anti-clustering)', { chunks: spreadPlan.blocks.length, days: spreadDays.size });

// Reverse exam scheduling: expandExamPrep turns an exam into spread-out study
// sessions that all land strictly BEFORE the exam date.
const examItems = PE.expandExamPrep([{ id: 'apbio', name: 'AP Bio', examDate: '2026-06-27', confidence: 2 }], { today: '2026-06-20' });
ok(examItems.length === 1 && examItems[0].preferredChunkMinutes === 45 && examItems[0].dueDate === '2026-06-27', 'expandExamPrep builds a session-chunked study item due on the exam date', examItems[0]);
const examPlanDates = ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27'];
const examPlan = PE.planWork({
  today: '2026-06-20', dates: examPlanDates, items: examItems,
  freeWindowsByDate: Object.fromEntries(examPlanDates.map(d => [d, [{ start: 540, end: 1020 }]]))
});
ok(examPlan.blocks.length >= 2 && examPlan.blocks.every(b => b.date <= '2026-06-27'), 'exam study sessions are all scheduled before the exam', { blocks: examPlan.blocks.length });

// ---------------------------------------------------------------------------
console.log('\nAcademic Command Center - deterministic action ranking');
const ACC = require('../src/features/academic/academic-command-center.js');
const commandModel = ACC.buildModel({
  now: new Date(2026, 5, 14, 12, 0, 0),
  courses: [{ id: 'chem', name: 'Chemistry', currentGrade: '68%', targetGrade: '85%', schedule: [{ day: 'Mon', startTime: '09:00' }] }],
  homeworkTasks: [
    { id: 'late-lab', courseId: 'chem', title: 'Lab conclusion', dueDate: '2026-06-13', priority: 'high', difficulty: 'hard', done: false },
    { id: 'reading', courseId: 'chem', title: 'Chapter reading', dueDate: '2026-06-18', priority: 'medium', difficulty: 'easy', done: false }
  ],
  pages: [{ id: 'note-1', title: 'Acids and bases', classLinkId: 'chem', updatedAt: '2026-06-14T10:00:00Z' }],
  timeBlocks: [],
  gradePlanner: { courses: {} },
  apSubjects: [],
  reviewStats: { due: 12, overdue: 3 }
});
ok(commandModel.courses.length === 1 && commandModel.courses[0].risk === 'danger', 'course summary marks a large grade gap as at risk', commandModel.courses[0]);
ok(commandModel.topAction && commandModel.topAction.id === 'late-lab', 'overdue high-impact work ranks first', commandModel.topAction);
ok(commandModel.topAction.reason.includes('overdue') && commandModel.topAction.reason.includes('grade at risk'), 'recommendation explains its deterministic factors', commandModel.topAction.reason);
ok(commandModel.courses[0].recentNote && commandModel.courses[0].recentNote.id === 'note-1', 'recent linked note surfaces in the course summary');

// ---------------------------------------------------------------------------
if (failures) {
  console.error(`\nAcademic engines check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('\nAcademic engines check passed — rotation, grade math, extraction, and studio engines verified by execution.');
