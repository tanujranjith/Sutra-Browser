/* Deterministic, review-first scheduling and missed-plan repair engine. */
(function (global) {
  'use strict';
  function list(value) { return Array.isArray(value) ? value : []; }
  function parse(value) { var ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : null; }
  function parseDeadline(value) {
    var raw = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var localEnd = new Date(raw + 'T23:59:59.999');
      return Number.isFinite(localEnd.getTime()) ? localEnd.getTime() : null;
    }
    return parse(raw);
  }
  function iso(ms) { return new Date(ms).toISOString(); }
  function number(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function startOfLocalDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d; }
  function nextLocalDay(ms) { var d = startOfLocalDay(ms); d.setDate(d.getDate() + 1); return d.getTime(); }
  function atLocalHour(dayMs, hour) { var d = startOfLocalDay(dayMs); d.setMinutes(Math.round(hour * 60)); return d.getTime(); }
  function overlaps(start, end, block) {
    var bs = parse(block.startAt || block.start || block.startTime);
    var be = parse(block.endAt || block.end || block.endTime);
    return bs !== null && be !== null && start < be && end > bs;
  }
  function sourceKey(row) { return String(row && (row.sourceKey || row.actionId || ((row.sourceType || row.type || '') + ':' + (row.sourceId || row.id || ''))) || ''); }
  function blockSourceKey(row) { return String(row && (row.sourceKey || row.actionId || ((row.sourceType || row.source || '') + ':' + (row.sourceId || ''))) || ''); }
  function isComplete(action) { return !!(action && (action.completed || action.done || ['done', 'completed'].indexOf(String(action.status || '').toLowerCase()) >= 0)); }
  function selected(action, opts) {
    var ids = list(opts.selectedIds).map(String);
    var courses = list(opts.selectedCourseIds).map(String);
    var types = list(opts.selectedSourceTypes).map(String);
    if (ids.length && ids.indexOf(String(action.id || action.sourceId || '')) < 0) return false;
    if (courses.length && courses.indexOf(String(action.courseId || '')) < 0) return false;
    if (types.length && types.indexOf(String(action.sourceType || action.type || '')) < 0) return false;
    return true;
  }
  function sortActions(actions) {
    var urgency = { overdue: 4, danger: 4, high: 3, 'due-soon': 3, medium: 2, low: 1 };
    return actions.slice().sort(function (a, b) {
      var ap = number(a.rankScore, urgency[a.urgency] || urgency[a.priority] || 0);
      var bp = number(b.rankScore, urgency[b.urgency] || urgency[b.priority] || 0);
      if (ap !== bp) return bp - ap;
      return (parseDeadline(a.dueAt || a.dueDate) || Infinity) - (parseDeadline(b.dueAt || b.dueDate) || Infinity);
    });
  }
  function normalizeBlock(block) {
    var start = parse(block && (block.startAt || block.start || block.startTime));
    var end = parse(block && (block.endAt || block.end || block.endTime));
    return start !== null && end !== null && end > start ? { raw: block, start: start, end: end } : null;
  }
  function proposalBlock(proposal) { return { startAt: proposal.startAt, endAt: proposal.endAt }; }

  function proposeSchedule(input, options) {
    var source = input || {};
    var opts = options || {};
    var now = parse(opts.startAt) ?? Date.now();
    var days = Math.max(1, Math.min(60, Math.floor(number(opts.days, 7))));
    var horizonDay = startOfLocalDay(now); horizonDay.setDate(horizonDay.getDate() + days);
    var horizon = horizonDay.getTime();
    var dayStartHour = Math.max(0, Math.min(23.75, number(opts.dayStartHour, 8)));
    var dayEndHour = Math.max(dayStartHour + 0.25, Math.min(24, number(opts.dayEndHour, 22)));
    var breakMinutes = Math.max(0, Math.min(120, Math.round(number(opts.breakMinutes, 10))));
    var allowWeekends = opts.allowWeekends !== false;
    var occupied = list(source.existingBlocks).concat(list(source.protectedTime)).map(normalizeBlock).filter(Boolean);
    var actions = sortActions(list(source.actions || source).filter(function (action) {
      return action && !isComplete(action) && selected(action, opts) && action.excluded !== true;
    }));
    var proposals = [];
    var unscheduled = [];
    var totalRequestedMinutes = 0;

    actions.forEach(function (action) {
      var duration = Math.max(15, Math.min(480, Math.round(number(action.estimatedMinutes || action.effortMinutes, 30))));
      totalRequestedMinutes += duration;
      if (action.blocked) {
        unscheduled.push({ actionId: action.id, sourceId: action.sourceId, title: action.title, reason: action.blockReason || 'Blocked by an incomplete dependency.', code: 'dependency_blocked' });
        return;
      }
      var durationMs = duration * 60000;
      var due = parseDeadline(action.dueAt || action.dueDate);
      var latest = parseDeadline(action.latestAcceptableAt);
      var deadline = due === null ? latest : (latest === null ? due : Math.min(due, latest));
      var notBefore = Math.max(now, parse(action.notBeforeAt) || now);
      var key = sourceKey(action);
      var linked = key ? list(source.existingBlocks).find(function (block) { return blockSourceKey(block) === key; }) : null;
      var cursor = notBefore;
      var placed = null;

      while (cursor + durationMs <= horizon) {
        var day = startOfLocalDay(cursor);
        if (!allowWeekends && (day.getDay() === 0 || day.getDay() === 6)) { cursor = nextLocalDay(day.getTime()); continue; }
        var workStart = atLocalHour(day.getTime(), dayStartHour);
        var workEnd = atLocalHour(day.getTime(), dayEndHour);
        if (cursor < workStart) cursor = workStart;
        if (cursor + durationMs > workEnd) { cursor = nextLocalDay(day.getTime()); continue; }
        var end = cursor + durationMs;
        if (deadline !== null && end > deadline) break;
        var conflict = occupied.find(function (row) {
          return (!linked || row.raw !== linked) && cursor < row.end && end > row.start;
        });
        if (!conflict) {
          var proposalConflict = proposals.find(function (row) { return overlaps(cursor, end, proposalBlock(row)); });
          if (!proposalConflict) {
            placed = {
              id: 'proposal:' + String(action.id || action.sourceId || proposals.length),
              actionId: action.id,
              sourceType: action.sourceType || action.type || '',
              sourceId: action.sourceId || action.id,
              sourceKey: key,
              courseId: action.courseId || '',
              priority: action.priority || '',
              dueAt: action.dueAt || action.dueDate || '',
              title: action.title || 'Untitled work',
              startAt: iso(cursor), endAt: iso(end), durationMinutes: duration,
              linkedBlockId: linked && linked.id || null,
              operation: linked ? 'update' : 'create',
              category: 'suggested', status: 'proposed',
              reason: action.rankReason || (action.urgency === 'overdue' ? 'Overdue work is placed in the earliest open slot.' : 'Placed before its deadline in available work hours.')
            };
            break;
          }
          cursor = parse(proposalConflict.endAt) + breakMinutes * 60000;
          continue;
        }
        cursor = conflict.end + breakMinutes * 60000;
      }
      if (placed) proposals.push(placed);
      else unscheduled.push({
        actionId: action.id, sourceId: action.sourceId || action.id, title: action.title,
        reason: deadline !== null ? 'No conflict-free slot fits before the due time.' : 'No conflict-free slot fits inside the planning horizon and work hours.',
        code: deadline !== null ? 'no_slot_before_due' : 'no_slot'
      });
    });

    var scheduledMinutes = proposals.reduce(function (sum, row) { return sum + row.durationMinutes; }, 0);
    return {
      proposals: proposals,
      unscheduled: unscheduled,
      impossibleWorkload: unscheduled.length > 0,
      requestedMinutes: totalRequestedMinutes,
      scheduledMinutes: scheduledMinutes,
      warnings: unscheduled.length ? [unscheduled.length + ' item(s) could not be placed without breaking a scheduling rule.'] : [],
      assumptions: { dayStartHour: dayStartHour, dayEndHour: dayEndHour, allowWeekends: allowWeekends, breakMinutes: breakMinutes, days: days },
      reviewed: false
    };
  }

  function repairSchedule(workspace, options) {
    var engine = global.SutraStudentEngine;
    if (!engine && typeof module !== 'undefined' && module.exports) {
      try { engine = require('./student-engine.js'); } catch (error) {}
    }
    var actions = engine ? engine.getInbox(workspace, options) : [];
    return proposeSchedule({ actions: actions, existingBlocks: list(workspace && workspace.timeBlocks), protectedTime: list(workspace && workspace.protectedTime) }, options);
  }
  var api = { proposeSchedule: proposeSchedule, repairSchedule: repairSchedule };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraPlanner = api;
}(typeof window !== 'undefined' ? window : globalThis));
