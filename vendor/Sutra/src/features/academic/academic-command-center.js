/*
 * Academic Command Center - deterministic, read-only academic aggregation.
 *
 * This module creates no parallel store. It reads Course Hub, Homework,
 * Grade Planner, School Schedule, Review, AP Study, Notes, and Timeline data,
 * then derives a course snapshot and a ranked "what should I do now" list.
 */
(function (global) {
  'use strict';

  function arr(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return String(value == null ? '' : value); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function localDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    var raw = text(value).trim();
    var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    var parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function startOfDay(value) {
    var date = localDate(value) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dayDelta(value, now) {
    var due = localDate(value);
    if (!due) return null;
    return Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86400000);
  }

  function parseGrade(value) {
    var match = text(value).match(/(\d{1,3}(?:\.\d+)?)\s*%?/);
    if (!match) return null;
    var grade = Number(match[1]);
    return Number.isFinite(grade) ? grade : null;
  }

  function dueLabel(days) {
    if (days === null) return 'No due date';
    if (days < -1) return Math.abs(days) + ' days overdue';
    if (days === -1) return '1 day overdue';
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return 'Due in ' + days + ' days';
  }

  function normalizedTitle(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function isScheduled(task, blocks) {
    var taskId = text(task && task.id);
    var title = normalizedTitle(task && (task.title || task.text));
    return arr(blocks).some(function (block) {
      if (!block) return false;
      if (taskId && [block.linkedTaskId, block.linkedHomeworkId, block.taskId, block.sourceId].some(function (id) { return text(id) === taskId; })) return true;
      var blockTitle = normalizedTitle(block.name || block.title);
      return title && blockTitle && (blockTitle.indexOf(title) !== -1 || title.indexOf(blockTitle) !== -1);
    });
  }

  function courseGrade(course, plannerCourse) {
    if (plannerCourse && Number.isFinite(Number(plannerCourse.computedPercent))) return Number(plannerCourse.computedPercent);
    return parseGrade(course && course.currentGrade);
  }

  function targetGrade(course, plannerCourse) {
    if (plannerCourse && Number.isFinite(Number(plannerCourse.targetPercent))) return Number(plannerCourse.targetPercent);
    return parseGrade(course && course.targetGrade);
  }

  function gradeRisk(grade, target, overdueCount) {
    if (grade !== null && grade < 70) return 'danger';
    if (grade !== null && target !== null && target - grade >= 5) return 'danger';
    if (overdueCount > 0 || (grade !== null && target !== null && target - grade >= 2)) return 'warn';
    if (grade !== null) return 'safe';
    return 'neutral';
  }

  function nextClass(course, now) {
    var schedule = arr(course && course.schedule);
    if (!schedule.length) return null;
    var base = localDate(now) || new Date();
    var dayNames = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
    var candidates = [];
    schedule.forEach(function (meeting) {
      var targetDay = dayNames[text(meeting.day).toLowerCase()];
      if (targetDay === undefined) return;
      var delta = (targetDay - base.getDay() + 7) % 7;
      var timeMatch = text(meeting.startTime || meeting.start).match(/^(\d{1,2}):(\d{2})/);
      var date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta, timeMatch ? Number(timeMatch[1]) : 8, timeMatch ? Number(timeMatch[2]) : 0);
      if (date.getTime() < base.getTime()) date.setDate(date.getDate() + 7);
      candidates.push({ at: date.getTime(), day: text(meeting.day), start: text(meeting.startTime || meeting.start), location: text(meeting.location || meeting.room) });
    });
    candidates.sort(function (a, b) { return a.at - b.at; });
    return candidates[0] || null;
  }

  function weakTopicsForCourse(course, apSubjects) {
    var courseName = normalizedTitle(course && course.name);
    var subject = arr(apSubjects).find(function (item) {
      var subjectName = normalizedTitle(item && item.name);
      return subjectName && courseName && (subjectName.indexOf(courseName) !== -1 || courseName.indexOf(subjectName) !== -1);
    });
    if (!subject) return [];
    var topics = [];
    arr(subject.units).forEach(function (unit) {
      arr(unit && unit.topics).forEach(function (topic) {
        var confidence = Number(topic && (topic.confidence != null ? topic.confidence : topic.mastery));
        var status = text(topic && topic.status).toLowerCase();
        if ((Number.isFinite(confidence) && confidence <= 2) || status === 'weak' || status === 'learning') {
          topics.push(text(topic.title || topic.name));
        }
      });
    });
    return topics.filter(Boolean).slice(0, 3);
  }

  function buildCourseSummaries(input) {
    var now = input.now || new Date();
    var tasks = arr(input.homeworkTasks).filter(function (task) { return task && !task.done && !task.completed; });
    var plannerCourses = input.gradePlanner && input.gradePlanner.courses ? input.gradePlanner.courses : {};
    return arr(input.courses).filter(function (course) { return course && !course.archived; }).map(function (course) {
      var courseTasks = tasks.filter(function (task) { return text(task.courseId) === text(course.id); });
      var dated = courseTasks.map(function (task) { return { task: task, days: dayDelta(task.dueDate || task.due, now) }; })
        .filter(function (item) { return item.days !== null; })
        .sort(function (a, b) { return a.days - b.days; });
      var overdue = dated.filter(function (item) { return item.days < 0; });
      var grade = courseGrade(course, plannerCourses[text(course.id)]);
      var target = targetGrade(course, plannerCourses[text(course.id)]);
      var notes = arr(input.pages).filter(function (page) { return page && text(page.classLinkId) === text(course.id); })
        .sort(function (a, b) { return text(b.updatedAt).localeCompare(text(a.updatedAt)); });
      var exams = dated.filter(function (item) { return /\b(exam|test|quiz|midterm|final|frq)\b/i.test(text(item.task.title || item.task.text)); });
      return {
        id: text(course.id),
        name: text(course.name || 'Course'),
        color: text(course.color || ''),
        nextAssignment: dated[0] || null,
        overdueCount: overdue.length,
        nextClass: nextClass(course, now),
        grade: grade,
        target: target,
        risk: gradeRisk(grade, target, overdue.length),
        weakTopics: weakTopicsForCourse(course, input.apSubjects),
        recentNote: notes[0] ? { id: text(notes[0].id), title: text(notes[0].title || 'Untitled note') } : null,
        linkedFileCount: Number(course.linkedFileCount || 0),
        reviewDeckCount: Number(course.reviewDeckCount || 0),
        upcomingExam: exams[0] || null
      };
    });
  }

  function scoreTask(task, courseSummary, blocks, now) {
    var days = dayDelta(task.dueDate || task.due, now);
    var score = 5;
    var reasons = [];
    if (days !== null && days < 0) { score += 120 + Math.min(30, Math.abs(days) * 4); reasons.push(dueLabel(days)); }
    else if (days === 0) { score += 100; reasons.push('due today'); }
    else if (days === 1) { score += 80; reasons.push('due tomorrow'); }
    else if (days !== null && days <= 3) { score += 62; reasons.push(dueLabel(days).toLowerCase()); }
    else if (days !== null && days <= 7) { score += 42; reasons.push(dueLabel(days).toLowerCase()); }
    if (text(task.priority).toLowerCase() === 'high') { score += 22; reasons.push('high priority'); }
    if (text(task.difficulty).toLowerCase() === 'hard') { score += 16; reasons.push('hard'); }
    if (courseSummary && courseSummary.risk === 'danger') { score += 18; reasons.push('grade at risk'); }
    if (!isScheduled(task, blocks)) { score += 10; reasons.push('not scheduled'); }
    var estimate = Number(task.studio && task.studio.effort && task.studio.effort.estimateMinutes);
    return {
      id: text(task.id),
      kind: 'homework',
      title: text(task.title || task.text || 'Assignment'),
      courseId: text(task.courseId),
      courseName: courseSummary ? courseSummary.name : '',
      dueDate: text(task.dueDate || task.due),
      score: score,
      estimateMinutes: Number.isFinite(estimate) && estimate > 0 ? estimate : (text(task.difficulty) === 'hard' ? 60 : 30),
      reason: reasons.slice(0, 4).join(' · ') || 'open assignment'
    };
  }

  function rankActions(input, courseSummaries) {
    var byCourse = Object.create(null);
    arr(courseSummaries).forEach(function (course) { byCourse[course.id] = course; });
    var actions = arr(input.homeworkTasks).filter(function (task) { return task && !task.done && !task.completed; })
      .map(function (task) { return scoreTask(task, byCourse[text(task.courseId)], input.timeBlocks, input.now); });

    var review = input.reviewStats || {};
    if (Number(review.due) > 0) {
      actions.push({ id: 'review-due', kind: 'review', title: 'Clear review backlog', courseId: '', courseName: '', dueDate: '', score: 48 + Math.min(35, Number(review.overdue || 0) * 3 + Number(review.due || 0)), estimateMinutes: 20, reason: Number(review.due) + ' cards due' });
    }

    arr(input.apSubjects).forEach(function (subject) {
      var confidence = Number(subject && (subject.confidenceLevel != null ? subject.confidenceLevel : subject.confidence));
      var days = dayDelta(subject && subject.examDate, input.now);
      if (!Number.isFinite(confidence) || confidence > 2 || days === null || days < 0 || days > 30) return;
      actions.push({ id: text(subject.id), kind: 'ap', title: 'Review ' + text(subject.name || 'AP subject'), courseId: '', courseName: text(subject.name), dueDate: text(subject.examDate), score: 52 + Math.max(0, 30 - days), estimateMinutes: 30, reason: 'low confidence · exam in ' + days + ' days' });
    });

    actions.sort(function (a, b) { return b.score - a.score || text(a.dueDate).localeCompare(text(b.dueDate)); });
    return actions.slice(0, 7);
  }

  function buildModel(input) {
    var source = input || {};
    var courses = buildCourseSummaries(source);
    var actions = rankActions(source, courses);
    return {
      courses: courses,
      actions: actions,
      topAction: actions[0] || null,
      totals: {
        courses: courses.length,
        overdue: courses.reduce(function (sum, course) { return sum + course.overdueCount; }, 0),
        atRisk: courses.filter(function (course) { return course.risk === 'danger' || course.risk === 'warn'; }).length,
        reviewDue: Number(source.reviewStats && source.reviewStats.due) || 0
      }
    };
  }

  var Engine = { buildModel: buildModel, buildCourseSummaries: buildCourseSummaries, rankActions: rankActions, dayDelta: dayDelta };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (typeof window === 'undefined') return;

  function homeworkSnapshot() {
    try {
      return global.SutraHomeworkStore && typeof global.SutraHomeworkStore.getSnapshot === 'function'
        ? global.SutraHomeworkStore.getSnapshot()
        : { courses: [], tasks: [] };
    } catch (error) { return { courses: [], tasks: [] }; }
  }

  function readSnapshot() {
    var hub = global.courseHub;
    var bridge = global.flowAtelier || {};
    var courses = hub && typeof hub.getCourses === 'function' ? hub.getCourses({ filter: 'active' }) : [];
    var planner = global.SutraAcademicState && global.SutraAcademicState.getGradePlanner ? global.SutraAcademicState.getGradePlanner() : {};
    var gradeEngine = global.SutraGradePlanner;
    var plannerCourses = Object.assign({}, planner && planner.courses ? planner.courses : {});
    courses = arr(courses).map(function (course) {
      var copy = Object.assign({}, course);
      copy.linkedFileCount = hub && hub.getFilesForCourse ? arr(hub.getFilesForCourse(course.id)).length : 0;
      copy.reviewDeckCount = hub && hub.getReviewDecksForCourse ? arr(hub.getReviewDecksForCourse(course.id)).length : 0;
      var data = plannerCourses[text(course.id)];
      if (data && gradeEngine && typeof gradeEngine.computeCourseGrade === 'function') {
        var computed = gradeEngine.computeCourseGrade(data);
        plannerCourses[text(course.id)] = Object.assign({}, data, { computedPercent: computed && computed.percent });
      }
      return copy;
    });
    return {
      now: new Date(),
      courses: courses,
      homeworkTasks: arr(homeworkSnapshot().tasks),
      pages: arr(bridge.pages),
      timeBlocks: arr(bridge.timeBlocks),
      gradePlanner: Object.assign({}, planner, { courses: plannerCourses }),
      apSubjects: bridge.apStudyWorkspace ? arr(bridge.apStudyWorkspace.subjects) : [],
      reviewStats: typeof global.getReviewTodayStats === 'function' ? global.getReviewTodayStats() : {}
    };
  }

  function riskLabel(risk) {
    if (risk === 'danger') return 'At risk';
    if (risk === 'warn') return 'Watch';
    if (risk === 'safe') return 'On track';
    return 'No grade yet';
  }

  function actionButtons(action, compact) {
    if (!action) return '';
    var cls = compact ? ' acc-btn-compact' : '';
    if (action.kind === 'homework') {
      return '<div class="acc-actions">'
        + '<button type="button" class="acc-btn' + cls + '" data-acc-action="open-homework" data-acc-id="' + escapeHtml(action.id) + '">Open</button>'
        + '<button type="button" class="acc-btn' + cls + '" data-acc-action="schedule" data-acc-id="' + escapeHtml(action.id) + '">Schedule</button>'
        + '<button type="button" class="acc-btn acc-btn-primary' + cls + '" data-acc-action="focus" data-acc-id="' + escapeHtml(action.id) + '">Focus</button>'
        + '</div>';
    }
    return '<div class="acc-actions"><button type="button" class="acc-btn acc-btn-primary' + cls + '" data-acc-action="open-' + escapeHtml(action.kind) + '">Open</button></div>';
  }

  function renderHtml() {
    var model = buildModel(readSnapshot());
    if (!model.courses.length) return '';
    var top = model.topAction;
    var ranked = model.actions.slice(1, 5).map(function (action, index) {
      return '<li class="acc-ranked-row"><span class="acc-rank">' + (index + 2) + '</span><span class="acc-ranked-copy"><strong>' + escapeHtml(action.title) + '</strong><small>' + escapeHtml(action.courseName ? action.courseName + ' · ' + action.reason : action.reason) + '</small></span>' + actionButtons(action, true) + '</li>';
    }).join('');
    var courseCards = model.courses.slice(0, 8).map(function (course) {
      var next = course.nextAssignment;
      var grade = course.grade === null ? '—' : Math.round(course.grade * 10) / 10 + '%';
      var weak = course.weakTopics.length ? course.weakTopics.join(', ') : 'No weak topics flagged';
      return '<button type="button" class="acc-course-card acc-risk-' + escapeHtml(course.risk) + '" data-acc-action="open-course" data-acc-id="' + escapeHtml(course.id) + '">'
        + '<span class="acc-course-head"><span class="acc-course-dot" style="background:' + escapeHtml(course.color || 'var(--accent-strong)') + '"></span><strong>' + escapeHtml(course.name) + '</strong><span class="acc-risk-pill">' + escapeHtml(riskLabel(course.risk)) + '</span></span>'
        + '<span class="acc-course-grade">' + escapeHtml(grade) + '<small> current grade</small></span>'
        + '<span class="acc-course-line"><b>Next:</b> ' + escapeHtml(next ? next.task.title || next.task.text : 'No open assignments') + '</span>'
        + '<span class="acc-course-line"><b>Context:</b> ' + escapeHtml(course.overdueCount ? course.overdueCount + ' overdue' : (course.nextClass ? course.nextClass.day + ' ' + course.nextClass.start : 'No upcoming class')) + '</span>'
        + '<span class="acc-course-line"><b>Study:</b> ' + escapeHtml(weak) + '</span>'
        + '<span class="acc-course-meta">' + course.linkedFileCount + ' files · ' + course.reviewDeckCount + ' decks' + (course.recentNote ? ' · recent note: ' + escapeHtml(course.recentNote.title) : '') + '</span>'
        + '</button>';
    }).join('');

    return '<section class="academic-command-center" aria-labelledby="academicCommandCenterTitle">'
      + '<div class="acc-header"><div><span class="acc-eyebrow">Unified academic command center</span><h2 id="academicCommandCenterTitle">What should I do now?</h2><p>Local, deterministic ranking across assignments, grades, schedule, AP confidence, and review debt.</p></div>'
      + '<button type="button" class="acc-refresh" data-acc-action="refresh" aria-label="Refresh academic command center"><i class="fas fa-rotate" aria-hidden="true"></i></button></div>'
      + '<div class="acc-summary"><span><b>' + model.totals.overdue + '</b> overdue</span><span><b>' + model.totals.atRisk + '</b> courses to watch</span><span><b>' + model.totals.reviewDue + '</b> review due</span></div>'
      + (top ? '<div class="acc-top-action"><span class="acc-top-icon"><i class="fas fa-bolt" aria-hidden="true"></i></span><span class="acc-top-copy"><small>Top recommendation</small><strong>' + escapeHtml(top.title) + '</strong><span>' + escapeHtml(top.courseName ? top.courseName + ' · ' + top.reason : top.reason) + ' · about ' + top.estimateMinutes + ' min</span></span>' + actionButtons(top, false) + '</div>' : '<div class="acc-calm-state">Nothing urgent is competing for your attention. Use the time for review or deeper work.</div>')
      + (ranked ? '<ol class="acc-ranked-list" aria-label="Other recommended actions">' + ranked + '</ol>' : '')
      + '<div class="acc-course-grid">' + courseCards + '</div>'
      + '</section>';
  }

  function taskById(id) {
    return arr(homeworkSnapshot().tasks).find(function (task) { return text(task && task.id) === text(id); }) || null;
  }

  function handleClick(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-acc-action]') : null;
    if (!button) return;
    var action = button.getAttribute('data-acc-action');
    var id = button.getAttribute('data-acc-id') || '';
    if (action === 'refresh') { if (typeof global.renderCourseHubView === 'function') global.renderCourseHubView(); return; }
    if (action === 'open-course') { if (typeof global.cwSelectCourse === 'function') global.cwSelectCourse(id); return; }
    if (action === 'open-homework') {
      if (typeof global.openHomeworkTaskModal === 'function') global.openHomeworkTaskModal('v2', id);
      else if (typeof global.setActiveView === 'function') global.setActiveView('homework');
      return;
    }
    if (action === 'schedule') {
      var task = taskById(id);
      if (task && global.flowAtelier && typeof global.flowAtelier.scheduleGenericItemAsBlock === 'function') global.flowAtelier.scheduleGenericItemAsBlock(task);
      return;
    }
    if (action === 'focus') {
      var focusTask = taskById(id);
      if (global.flowAtelier && typeof global.flowAtelier.startFocusSession === 'function') global.flowAtelier.startFocusSession(id, { title: focusTask ? focusTask.title || focusTask.text : 'Study session', plannedDurationSeconds: 1800 });
      return;
    }
    if (action === 'open-review') { if (typeof global.setActiveView === 'function') global.setActiveView('review'); return; }
    if (action === 'open-ap') { if (typeof global.setActiveView === 'function') global.setActiveView('apstudy'); }
  }

  global.SutraAcademicCommandCenter = {
    VERSION: 1,
    engine: Engine,
    buildModel: buildModel,
    readSnapshot: readSnapshot,
    renderHtml: renderHtml
  };

  document.addEventListener('click', handleClick);
}(typeof window !== 'undefined' ? window : globalThis));
