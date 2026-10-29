/* College applications, financial runway, wellness trends, and recovery planning. */
(function (global) {
  'use strict';

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function number(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : (arguments.length > 1 ? fallback : 0); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function timestamp(options) { return String(options && options.now || new Date().toISOString()); }
  function dateMs(value) { var parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : null; }
  function dayKey(value) { var parsed = dateMs(value); return parsed === null ? '' : new Date(parsed).toISOString().slice(0, 10); }
  function words(value) { return text(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }

  var ACTIVITY_LIMITS = Object.freeze({ position: 50, organization: 100, description: 150 });

  function normalizeActivity(seed, index) {
    var row = seed || {};
    // Never silently truncate: canonical fields keep the student's full text so migration
    // and re-import cannot lose data. Overflow is surfaced via limitViolations so the UI
    // can show over-limit warnings and the reviewed upsert path can reject before save.
    var position = text(row.position || row.role);
    var organization = text(row.organization || row.name);
    var description = text(row.description || row.impact);
    var limitViolations = {};
    if (position.length > ACTIVITY_LIMITS.position) limitViolations.position = position.length - ACTIVITY_LIMITS.position;
    if (organization.length > ACTIVITY_LIMITS.organization) limitViolations.organization = organization.length - ACTIVITY_LIMITS.organization;
    if (description.length > ACTIVITY_LIMITS.description) limitViolations.description = description.length - ACTIVITY_LIMITS.description;
    return {
      id: text(row.id) || uid('activity'),
      order: Math.max(1, Math.round(number(row.order, Number(index) + 1 || 1))),
      type: text(row.type || row.category || 'other'),
      position: position,
      organization: organization,
      description: description,
      impact: text(row.impact),
      grades: list(row.grades).map(String),
      timing: text(row.timing || row.participationTiming),
      hoursPerWeek: Math.max(0, number(row.hoursPerWeek, 0)),
      weeksPerYear: Math.max(0, number(row.weeksPerYear, 0)),
      continueInCollege: row.continueInCollege === true,
      limitViolations: limitViolations,
      reusableDescriptions: list(row.reusableDescriptions).map(function (entry) {
        var copy = text(entry && entry.description);
        return { id: text(entry && entry.id) || uid('activity_copy'), label: text(entry && entry.label), description: copy, overLimitBy: Math.max(0, copy.length - ACTIVITY_LIMITS.description) };
      }),
      updatedAt: text(row.updatedAt) || new Date().toISOString()
    };
  }

  function validateActivity(seed) {
    var row = seed || {}, errors = [], warnings = [];
    [['position', ACTIVITY_LIMITS.position], ['organization', ACTIVITY_LIMITS.organization], ['description', ACTIVITY_LIMITS.description]].forEach(function (pair) {
      var length = text(row[pair[0]] || (pair[0] === 'position' ? row.role : pair[0] === 'organization' ? row.name : row.impact)).length;
      if (length > pair[1]) errors.push(pair[0] + ' exceeds the ' + pair[1] + '-character limit by ' + (length - pair[1]) + '.');
    });
    if (!text(row.position || row.role)) errors.push('A role or position is required.');
    if (!text(row.organization || row.name)) errors.push('An organization or activity name is required.');
    if (!text(row.description || row.impact)) warnings.push('Add a concrete action and measurable impact.');
    if (!number(row.hoursPerWeek, 0) || !number(row.weeksPerYear, 0)) warnings.push('Add time commitment so the activity has context.');
    return { valid: !errors.length, errors: errors, warnings: warnings, remaining: { position: ACTIVITY_LIMITS.position - text(row.position || row.role).length, organization: ACTIVITY_LIMITS.organization - text(row.organization || row.name).length, description: ACTIVITY_LIMITS.description - text(row.description || row.impact).length } };
  }

  function upsertActivity(workspace, activity, options) {
    var next = clone(workspace || {}), college = next.collegeAppWorkspace || (next.collegeAppWorkspace = {});
    college.activities = list(college.activities);
    var check = validateActivity(activity);
    if (!check.valid) throw new Error(check.errors.join(' '));
    var index = college.activities.findIndex(function (row) { return String(row && row.id) === String(activity && activity.id); });
    var normalized = normalizeActivity(activity, index >= 0 ? index : college.activities.length);
    var undo = index >= 0 ? { activityBefore: clone(college.activities[index]) } : { removeActivityIds: [normalized.id] };
    if (index >= 0) college.activities[index] = normalized; else college.activities.push(normalized);
    college.activities.sort(function (a, b) { return number(a.order, 999) - number(b.order, 999); }).forEach(function (row, i) { row.order = i + 1; });
    return { workspace: next, activity: normalized, receipt: { changedIds: [normalized.id], warnings: check.warnings, undo: undo, persistenceStatus: 'pending' } };
  }

  function reorderActivities(workspace, orderedIds) {
    var next = clone(workspace || {}), college = next.collegeAppWorkspace || (next.collegeAppWorkspace = {}), rows = list(college.activities);
    var before = rows.map(function (row) { return { id: row.id, order: row.order }; });
    var rank = new Map(list(orderedIds).map(function (id, index) { return [String(id), index]; }));
    rows.sort(function (a, b) { var ar = rank.has(String(a.id)) ? rank.get(String(a.id)) : 10000 + number(a.order, 0); var br = rank.has(String(b.id)) ? rank.get(String(b.id)) : 10000 + number(b.order, 0); return ar - br; });
    rows.forEach(function (row, index) { row.order = index + 1; });
    college.activities = rows;
    return { workspace: next, receipt: { changedIds: rows.map(function (row) { return row.id; }), warnings: [], undo: { activityOrderBefore: before }, persistenceStatus: 'pending' } };
  }

  var DEFAULT_REQUIREMENTS = [
    ['profile', 'Profile and contact details'], ['transcript', 'Transcript'], ['school_report', 'School report'],
    ['recommendations', 'Required recommendations'], ['personal_statement', 'Personal statement'],
    ['supplements', 'School supplements'], ['activities', 'Activities list'], ['payment', 'Fee or waiver'], ['review', 'Final review']
  ];

  function buildSubmissionReadiness(workspace, schoolId, options) {
    var snapshot = workspace || {}, college = snapshot.collegeAppWorkspace || {};
    var school = list(college.collegeTracker).find(function (row) { return String(row && row.id) === String(schoolId) || text(row && row.school).toLowerCase() === text(schoolId).toLowerCase(); }) || {};
    var saved = list(college.submissionReadiness).filter(function (row) { return String(row && row.schoolId) === String(school.id || schoolId); });
    var requirementSeeds = list(options && options.requirements).length ? options.requirements : DEFAULT_REQUIREMENTS.map(function (pair) { return { key: pair[0], label: pair[1] }; });
    var requirements = requirementSeeds.map(function (seed) {
      var prior = saved.find(function (row) { return String(row && (row.key || row.requirement)) === String(seed.key); }) || {};
      var dependencyIds = list(seed.dependencyIds || prior.dependencyIds).map(String);
      var dependenciesMet = dependencyIds.every(function (id) { return saved.some(function (row) { return String(row && row.id) === id && row.complete === true; }); });
      return { id: text(prior.id || seed.id) || uid('readiness'), schoolId: text(school.id || schoolId), key: text(seed.key), label: text(seed.label), complete: prior.complete === true || seed.complete === true, required: seed.required !== false, dependencyIds: dependencyIds, dependenciesMet: dependenciesMet, documentIds: list(prior.documentIds || seed.documentIds).map(String), notes: text(prior.notes || seed.notes) };
    });
    var required = requirements.filter(function (row) { return row.required; });
    var blocked = required.filter(function (row) { return !row.dependenciesMet; });
    var completed = required.filter(function (row) { return row.complete && row.dependenciesMet; });
    var recRequired = Math.max(0, number(school.recLettersRequired, 0));
    var recReceived = Math.max(number(school.recLettersReceived, 0), list(college.recommenders).filter(function (row) { return row && row.status === 'submitted'; }).length);
    var recommendationGap = Math.max(0, recRequired - recReceived);
    return { school: school, requirements: requirements, percent: required.length ? Math.round(completed.length / required.length * 100) : 0, completeCount: completed.length, totalCount: required.length, blocked: blocked, recommendationGap: recommendationGap, ready: required.length > 0 && completed.length === required.length && recommendationGap === 0, warnings: recommendationGap ? [recommendationGap + ' recommendation letter' + (recommendationGap === 1 ? '' : 's') + ' still needed.'] : [] };
  }

  function analyzeEssayReuse(essays, candidate) {
    var source = candidate || {}, sourceWords = new Set(words(source.prompt + ' ' + source.versionNotes));
    var rows = list(essays).filter(function (row) { return row && String(row.id) !== String(source.id); });
    var matches = rows.map(function (row) {
      var target = words(row.prompt + ' ' + row.versionNotes), overlap = target.filter(function (word) { return sourceWords.has(word); }).length;
      var similarity = sourceWords.size && target.length ? overlap / Math.max(sourceWords.size, new Set(target).size) : 0;
      return { essayId: row.id, school: row.school, similarity: Math.round(similarity * 100), schoolSpecificRisk: text(source.school) && text(row.school) && text(source.school).toLowerCase() !== text(row.school).toLowerCase() && similarity >= .35 };
    }).filter(function (row) { return row.similarity >= 20; }).sort(function (a, b) { return b.similarity - a.similarity; });
    return { matches: matches, warnings: matches.filter(function (row) { return row.schoolSpecificRisk; }).map(function (row) { return 'Review school-specific names and details before reusing this draft for ' + (row.school || 'another school') + '.'; }) };
  }

  function scoreDecisionMatrix(matrix) {
    var source = matrix || {}, criteria = list(source.criteria).filter(function (row) { return row && number(row.weight, 0) > 0; });
    var totalWeight = criteria.reduce(function (sum, row) { return sum + number(row.weight, 0); }, 0);
    var ranked = list(source.colleges || source.options).map(function (college) {
      var weighted = 0, answeredWeight = 0, missing = [];
      criteria.forEach(function (criterion) {
        var raw = college && college.scores ? college.scores[criterion.id] : null;
        if (raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) { missing.push(criterion.id); return; }
        weighted += clamp(raw, 0, 10) * number(criterion.weight, 0); answeredWeight += number(criterion.weight, 0);
      });
      return { id: college.id, name: college.name, score: answeredWeight ? Math.round(weighted / (answeredWeight * 10) * 1000) / 10 : 0, coverage: totalWeight ? Math.round(answeredWeight / totalWeight * 100) : 0, missingCriteriaIds: missing };
    }).sort(function (a, b) { return b.score - a.score || String(a.name).localeCompare(String(b.name)); });
    return { ranked: ranked, criteria: criteria, totalWeight: totalWeight, disclaimer: 'This is a personal fit comparison based only on your weights and ratings. It is not an admissions prediction or guarantee.', assumptions: ['Unrated criteria are excluded from each school score.', 'Weights reflect the student’s current priorities and may be changed at any time.'] };
  }

  function computeFinancialRunway(workspace, options) {
    var snapshot = workspace || {}, college = snapshot.collegeAppWorkspace || {}, life = snapshot.lifeWorkspace || {}, opts = options || {};
    var months = Math.max(1, Math.round(number(opts.months, 12)));
    var start = dateMs(opts.startDate) || Date.now(), end = start + months * 30.4375 * 86400000;
    var inRange = function (value) { var ms = dateMs(value); return ms === null || (ms >= start && ms <= end); };
    var spending = list(life.spending).filter(function (row) { return inRange(row.date); }).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)); }, 0);
    var recurring = list(life.recurringExpenses).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)) * months; }, 0);
    var costs = list(college.applicationCosts).filter(function (row) { return row && row.waived !== true && inRange(row.dueDate); }).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)); }, 0);
    var tuition = list(opts.tuition || college.tuitionPlans).filter(function (row) { return inRange(row.dueDate || row.date); }).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)); }, 0);
    var income = list(opts.expectedIncome || life.expectedIncome).filter(function (row) { return inRange(row.date || row.expectedDate); }).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)); }, 0);
    var scholarships = list(college.scholarships).filter(function (row) { return row && row.status === 'won'; }).reduce(function (sum, row) { return sum + Math.max(0, number(row.amount, 0)); }, 0);
    var openingBalance = Math.max(0, number(opts.openingBalance !== undefined ? opts.openingBalance : life.openingBalance, 0));
    var outflow = spending + recurring + costs + tuition, inflow = openingBalance + income + scholarships, endingBalance = inflow - outflow;
    var monthlyBurn = outflow / months, runwayMonths = monthlyBurn > 0 ? inflow / monthlyBurn : null;
    return { periodMonths: months, openingBalance: openingBalance, expectedIncome: income, wonScholarships: scholarships, recordedSpending: spending, recurringExpenses: recurring, applicationCosts: costs, tuition: tuition, totalInflow: inflow, totalOutflow: outflow, endingBalance: endingBalance, monthlyBurn: Math.round(monthlyBurn * 100) / 100, runwayMonths: runwayMonths === null ? null : Math.round(runwayMonths * 10) / 10, status: endingBalance < 0 ? 'gap' : endingBalance < monthlyBurn ? 'tight' : 'funded', assumptions: ['Only entered amounts are included.', 'Researching or submitted scholarships are excluded until marked won.', 'Recurring expenses are projected evenly across the selected period.'] };
  }

  function wellnessTrends(workspace, options) {
    var life = workspace && workspace.lifeWorkspace || {}, wellness = life.wellness || {}, now = dateMs(options && options.now) || Date.now();
    var days = Math.max(3, Math.round(number(options && options.days, 14))), cutoff = now - days * 86400000;
    var checks = list(wellness.checkIns).filter(function (row) { var ms = dateMs(row.createdAt || row.date || row.timestamp); return ms !== null && ms >= cutoff && ms <= now; });
    var sleep = list(life.sleepTracker && life.sleepTracker.entries).filter(function (row) { var ms = dateMs(row.date); return ms !== null && ms >= cutoff && ms <= now; });
    function avg(rows, field) { var vals = rows.map(function (row) { return number(row[field], NaN); }).filter(Number.isFinite); return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null; }
    var recent = checks.slice().sort(function (a, b) { return (dateMs(b.createdAt || b.date) || 0) - (dateMs(a.createdAt || a.date) || 0); });
    var half = Math.max(1, Math.floor(recent.length / 2)), current = recent.slice(0, half), prior = recent.slice(half, half * 2);
    var stress = avg(checks, 'stress'), sleepMinutes = avg(sleep, 'totalSleepMinutes');
    var stressDelta = avg(current, 'stress') !== null && avg(prior, 'stress') !== null ? avg(current, 'stress') - avg(prior, 'stress') : null;
    var signals = [];
    if (stress !== null && stress >= 7) signals.push('Stress has been high recently. Consider reducing today to essential commitments.');
    if (sleepMinutes !== null && sleepMinutes < 420) signals.push('Average sleep is below seven hours. Avoid scheduling optional late-night work.');
    return { days: days, samples: { checkIns: checks.length, sleep: sleep.length }, averages: { stress: stress === null ? null : Math.round(stress * 10) / 10, sleepMinutes: sleepMinutes === null ? null : Math.round(sleepMinutes) }, direction: { stress: stressDelta === null ? 'unknown' : stressDelta > .5 ? 'rising' : stressDelta < -.5 ? 'falling' : 'stable' }, signals: signals, disclaimer: 'These are gentle personal trends, not medical or mental-health advice.' };
  }

  function buildEmergencyWeek(workspace, options) {
    var snapshot = workspace || {}, opts = options || {}, now = dateMs(opts.now) || Date.now(), horizon = now + 7 * 86400000;
    var tasks = list(snapshot.tasks).concat(list(snapshot.homeworkWorkspace && snapshot.homeworkWorkspace.tasks)).filter(function (row) {
      if (!row || row.completed === true || row.status === 'completed') return false;
      var due = dateMs(row.dueAt || row.dueDate || row.date); return due === null || due <= horizon;
    });
    var fixed = list(snapshot.timeBlocks).filter(function (row) { var start = dateMs(row.startAt || row.date); return start !== null && start >= now && start <= horizon && (row.fixed === true || row.kind === 'commitment' || row.flexibility === 'fixed'); });
    var ranked = tasks.map(function (row) {
      var due = dateMs(row.dueAt || row.dueDate || row.date), days = due === null ? 7 : Math.max(0, (due - now) / 86400000);
      var impact = clamp(row.gradeImpact !== undefined ? row.gradeImpact : row.weight, 0, 100);
      var effort = Math.max(10, number(row.minimumViableMinutes || row.estimatedMinutes || row.effortMinutes, 45));
      var score = (8 - Math.min(7, days)) * 12 + impact * .8 + (row.priority === 'high' ? 20 : row.priority === 'medium' ? 10 : 0);
      return { id: row.id, title: text(row.title || row.name || 'Untitled task'), dueAt: due === null ? null : new Date(due).toISOString(), score: Math.round(score), minimumViableMinutes: Math.min(effort, Math.max(15, number(row.minimumViableMinutes, Math.ceil(effort * .55)))), originalMinutes: effort, gradeImpact: impact, source: row };
    }).sort(function (a, b) { return b.score - a.score || number(dateMs(a.dueAt), Infinity) - number(dateMs(b.dueAt), Infinity); });
    var dailyCapacity = Math.max(30, number(opts.dailyCapacityMinutes, 180)), selected = [], omitted = [], usedByDay = {};
    ranked.forEach(function (item) {
      var dueKey = dayKey(item.dueAt) || new Date(now).toISOString().slice(0, 10), used = usedByDay[dueKey] || 0;
      if (used + item.minimumViableMinutes <= dailyCapacity || selected.length < 3) { usedByDay[dueKey] = used + item.minimumViableMinutes; selected.push(item); } else omitted.push(item);
    });
    return { mode: 'overwhelmed', reviewRequired: true, essentials: selected.slice(0, Math.max(3, number(opts.maxEssentials, 12))), deferred: omitted.concat(selected.slice(Math.max(3, number(opts.maxEssentials, 12)))), fixedCommitments: fixed, protectedSleepHours: Math.max(7, number(opts.protectedSleepHours, 8)), protectedRecoveryMinutes: Math.max(20, number(opts.protectedRecoveryMinutes, 45)), dailyCapacityMinutes: dailyCapacity, interface: { showOnly: ['today', 'timeline', 'focus', 'emergency-plan', 'backup'], hideOptionalPacks: true }, warnings: ['This plan intentionally leaves lower-impact work unscheduled.', 'Review deadlines and teacher policies before applying minimum-viable submissions.'], assumptions: ['Grade impact uses entered values when available.', 'Unscheduled work is deferred, not deleted.', 'Sleep and fixed commitments are treated as hard constraints.'] };
  }

  function normalizeOperatingManual(seed) {
    var row = seed || {};
    return { version: 1, preferredStudyTimes: list(row.preferredStudyTimes).map(String), reminderStyle: text(row.reminderStyle) || 'calm', planningStyle: text(row.planningStyle) || 'balanced', accessibility: row.accessibility && typeof row.accessibility === 'object' ? clone(row.accessibility) : {}, hardConstraints: list(row.hardConstraints).map(String), helpfulStrategies: list(row.helpfulStrategies).map(String), unhelpfulStrategies: list(row.unhelpfulStrategies).map(String), notes: text(row.notes), updatedAt: text(row.updatedAt) || new Date().toISOString() };
  }

  var api = {
    VERSION: '1.0.0', ACTIVITY_LIMITS: ACTIVITY_LIMITS,
    normalizeActivity: normalizeActivity, validateActivity: validateActivity, upsertActivity: upsertActivity, reorderActivities: reorderActivities,
    buildSubmissionReadiness: buildSubmissionReadiness, analyzeEssayReuse: analyzeEssayReuse, scoreDecisionMatrix: scoreDecisionMatrix,
    computeFinancialRunway: computeFinancialRunway, getWellnessTrends: wellnessTrends, buildEmergencyWeek: buildEmergencyWeek,
    normalizeOperatingManual: normalizeOperatingManual
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraStudentLife = api;
}(typeof window !== 'undefined' ? window : globalThis));
