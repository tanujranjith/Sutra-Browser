/* Deterministic, local-only student action derivation and ranking. */
(function (global) {
  'use strict';

  var PRESETS = Object.freeze({
    balanced: Object.freeze({ urgency: 1.0, gradeImpact: 0.8, importance: 0.7, staleness: 0.35, effort: 0.25 }),
    deadline_first: Object.freeze({ urgency: 1.5, gradeImpact: 0.55, importance: 0.55, staleness: 0.2, effort: 0.1 }),
    grade_recovery: Object.freeze({ urgency: 0.8, gradeImpact: 1.5, importance: 0.8, staleness: 0.3, effort: 0.15 }),
    exam_week: Object.freeze({ urgency: 1.25, gradeImpact: 1.2, importance: 0.75, staleness: 0.45, effort: 0.15 }),
    overwhelmed: Object.freeze({ urgency: 0.9, gradeImpact: 0.8, importance: 0.65, staleness: 0.15, effort: 1.15 })
  });

  function list(value) { return Array.isArray(value) ? value : []; }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
  function parseDate(value) {
    var raw = String(value == null ? '' : value);
    // A bare calendar date (YYYY-MM-DD) has no time-of-day. Date.parse treats it
    // as UTC midnight, which reads as "overdue" up to a full day early in western
    // time zones. Treat a date-only deadline as local end-of-day, matching the
    // canonical planner semantics (planner.js parseDeadline).
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var localEnd = new Date(raw + 'T23:59:59.999');
      var localMs = localEnd.getTime();
      return Number.isFinite(localMs) ? localMs : null;
    }
    var ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  function localDayKey(ms) {
    var d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return 'unscheduled';
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  function normalizeStatus(value) { return String(value || 'todo').toLowerCase().replace(/[\s-]+/g, '_'); }
  function isDone(value) { return ['done', 'complete', 'completed', 'submitted', 'mastered', 'cancelled'].indexOf(normalizeStatus(value)) !== -1; }
  function priorityScore(value) {
    var key = String(value || '').toLowerCase();
    return key === 'critical' ? 1 : key === 'high' ? 0.8 : key === 'medium' ? 0.5 : key === 'low' ? 0.2 : 0.35;
  }
  function effortMinutes(item) {
    var direct = Number(item.estimatedMinutes || item.effortMinutes || item.durationMinutes || 0);
    if (direct > 0) return clamp(direct, 5, 720);
    var difficulty = String(item.difficulty || '').toLowerCase();
    return difficulty === 'hard' ? 90 : difficulty === 'medium' ? 45 : 25;
  }
  function dueValue(item) { return item.dueAt || item.dueDate || item.due || item.deadline || item.date || ''; }
  function makeId(type, item, index) { return type + ':' + String(item.id || item.uid || item.key || index); }

  function collectSource(type, rows, map) {
    list(rows).forEach(function (item, index) {
      if (!item || isDone(item.status || (item.completed ? 'done' : 'todo'))) return;
      var id = makeId(type, item, index);
      map.push({
        id: id,
        sourceType: type,
        sourceId: String(item.id || item.uid || item.key || index),
        title: String(item.title || item.name || item.label || 'Untitled action').trim().slice(0, 300),
        dueAt: dueValue(item),
        status: normalizeStatus(item.status),
        priority: String(item.priority || 'medium'),
        estimatedMinutes: effortMinutes(item),
        gradeImpact: clamp(item.gradeImpact || item.gradeWeight || item.weight || 0, 0, 1),
        updatedAt: item.updatedAt || item.modifiedAt || item.createdAt || '',
        courseId: String(item.courseId || item.classId || item.classLinkId || ''),
        raw: item
      });
    });
  }

  function collectActions(workspace) {
    var ws = object(workspace);
    var out = [];
    collectSource('task', ws.tasks, out);
    collectSource('homework', object(ws.homeworkWorkspace).tasks, out);
    collectSource('exam', object(ws.testingHub).exams, out);
    collectSource('college', object(ws.collegeAppWorkspace).deadlines, out);
    collectSource('college', object(ws.collegeTracker).deadlines, out);
    collectSource('review', object(ws.reviewWorkspace).items, out);
    return out;
  }

  function dependencyState(workspace, action, allActions) {
    var edges = list(object(workspace).taskDependencies);
    var relevant = edges.filter(function (edge) {
      return edge && (String(edge.taskId || edge.actionId) === action.sourceId || String(edge.taskId || edge.actionId) === action.id);
    });
    if (!relevant.length) return { blocked: false, missing: [] };
    var missing = relevant.filter(function (edge) {
      var wanted = String(edge.dependsOnId || edge.prerequisiteId || '');
      var found = allActions.find(function (candidate) { return candidate.sourceId === wanted || candidate.id === wanted; });
      return !!found;
    }).map(function (edge) { return String(edge.dependsOnId || edge.prerequisiteId || ''); });
    return { blocked: missing.length > 0, missing: missing };
  }

  function urgency(dueAt, nowMs) {
    var dueMs = parseDate(dueAt);
    if (dueMs === null) return { score: 0.2, label: 'no due date' };
    var hours = (dueMs - nowMs) / 3600000;
    if (hours < 0) return { score: 1, label: 'overdue' };
    if (hours <= 24) return { score: 0.95, label: 'due within 24 hours' };
    if (hours <= 72) return { score: 0.78, label: 'due within 3 days' };
    if (hours <= 168) return { score: 0.55, label: 'due this week' };
    return { score: 0.25, label: 'due later' };
  }

  function rankCollected(workspace, actions, options) {
    var ws = object(workspace);
    var opts = options || {};
    var nowMs = parseDate(opts.now) || Date.now();
    var state = object(ws.studentDecisionState);
    var presetName = PRESETS[opts.preset] ? opts.preset : (PRESETS[state.preset] ? state.preset : 'balanced');
    var weights = PRESETS[presetName];
    var dismissed = new Set(list(state.dismissed).map(String));
    var pinned = new Set(list(state.pinned).map(String));
    var snoozed = object(state.snoozed);
    return actions.map(function (action) {
      var dep = dependencyState(ws, action, actions);
      var due = urgency(action.dueAt, nowMs);
      var importance = priorityScore(action.priority);
      var grade = action.gradeImpact || (action.sourceType === 'exam' ? 0.85 : action.sourceType === 'homework' ? 0.55 : 0.25);
      var ageMs = Math.max(0, nowMs - (parseDate(action.updatedAt) || nowMs));
      var stale = clamp(ageMs / (30 * 86400000), 0, 1);
      var shortEffort = 1 - clamp((action.estimatedMinutes - 10) / 170, 0, 1);
      var score = due.score * weights.urgency + grade * weights.gradeImpact + importance * weights.importance
        + stale * weights.staleness + shortEffort * weights.effort;
      if (pinned.has(action.id) || pinned.has(action.sourceId)) score += 1.25;
      if (dep.blocked) score -= 10;
      var snoozeUntil = parseDate(snoozed[action.id] || snoozed[action.sourceId]);
      var hidden = dismissed.has(action.id) || dismissed.has(action.sourceId) || (snoozeUntil !== null && snoozeUntil > nowMs);
      var reason = dep.blocked
        ? 'Blocked until a prerequisite is completed.'
        : (due.label + (grade >= 0.7 ? ', with high grade impact' : '') + '.');
      return Object.assign({}, action, { rankScore: Math.round(score * 100) / 100, rankReason: reason.charAt(0).toUpperCase() + reason.slice(1), blocked: dep.blocked, prerequisiteIds: dep.missing, hidden: hidden, preset: presetName });
    }).filter(function (action) { return opts.includeHidden === true || !action.hidden; })
      .sort(function (a, b) { return b.rankScore - a.rankScore || String(a.dueAt).localeCompare(String(b.dueAt)) || a.id.localeCompare(b.id); });
  }

  function rank(workspace, options) {
    var ws = object(workspace);
    return rankCollected(ws, collectActions(ws), options);
  }

  function rankActions(workspace, rows, options) {
    var actions = list(rows).map(function (item, index) {
      var sourceType = String(item.sourceType || item.source || item.type || 'action').toLowerCase();
      var sourceId = String(item.sourceId || item.id || index);
      return {
        id: String(item.actionId || (sourceType + ':' + sourceId)),
        sourceType: sourceType,
        sourceId: sourceId,
        title: String(item.title || item.name || 'Untitled action').slice(0, 300),
        dueAt: dueValue(item),
        status: normalizeStatus(item.status),
        priority: String(item.priority || 'medium'),
        estimatedMinutes: effortMinutes(item),
        gradeImpact: clamp(item.gradeImpact || item.gradeWeight || item.riskScore && Number(item.riskScore) / 5 || 0, 0, 1),
        updatedAt: item.updatedAt || item.modifiedAt || item.createdAt || '',
        courseId: String(item.courseId || item.classId || item.classLinkId || ''),
        raw: item
      };
    });
    return rankCollected(object(workspace), actions, options);
  }

  function workload(workspace, options) {
    var rows = rank(workspace, options);
    var days = Object.create(null);
    rows.forEach(function (row) {
      var ms = parseDate(row.dueAt);
      var key = ms === null ? 'unscheduled' : localDayKey(ms);
      if (!days[key]) days[key] = { date: key, count: 0, minutes: 0, highImpact: 0 };
      days[key].count += 1;
      days[key].minutes += row.estimatedMinutes;
      if (row.gradeImpact >= 0.7) days[key].highImpact += 1;
    });
    return Object.keys(days).sort().map(function (key) { return days[key]; });
  }

  var api = {
    PRESETS: PRESETS,
    getInbox: rank,
    rankActions: rankActions,
    recommendNext: function (workspace, options) { return rank(workspace, options)[0] || null; },
    getWorkload: workload,
    collectActions: collectActions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraStudentEngine = api;
}(typeof window !== 'undefined' ? window : globalThis));
