/* Canonical homework domain store. The primary Sutra workspace is authoritative. */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 2;
  var MAX_COURSES = 2000;
  var MAX_TASKS = 50000;

  function clone(value, fallback) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
      return JSON.parse(JSON.stringify(value));
    } catch (error) { return fallback; }
  }

  function text(value, max) {
    var normalized = String(value == null ? '' : value).trim();
    return max == null ? normalized : normalized.slice(0, max);
  }
  function stableHash(value) {
    var source = String(value || '');
    var hash = 2166136261;
    for (var i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function safeDate(value) {
    var raw = text(value, 64);
    if (!raw) return '';
    var match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return '';
    var date = new Date(match[1] + 'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? '' : match[1];
  }
  function safeTime(value) {
    var raw = text(value, 16);
    var match = raw.match(/^(\d{2}):(\d{2})/);
    if (!match) return '';
    return Number(match[1]) < 24 && Number(match[2]) < 60 ? match[1] + ':' + match[2] : '';
  }
  function safeUrl(value) {
    var raw = text(value, 2048);
    if (!raw) return '';
    try {
      var parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (error) { return ''; }
  }
  function timestamp(value, fallback) {
    var parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
  }

  function normalizeCourse(raw, index, now) {
    if (!raw || typeof raw !== 'object') return null;
    var name = text(raw.name || raw.subject || raw.title);
    if (!name) return null;
    var id = text(raw.id, 160) || ('course-' + stableHash(name.toLowerCase() + '|' + index));
    return Object.assign({}, raw, {
      id: id,
      name: name,
      type: raw.type === 'misc' ? 'misc' : 'class',
      createdAt: timestamp(raw.createdAt, now),
      updatedAt: timestamp(raw.updatedAt, timestamp(raw.createdAt, now))
    });
  }

  function normalizeTask(raw, index, courseIds, courseNames, now) {
    if (!raw || typeof raw !== 'object') return null;
    var title = text(raw.title || raw.text || raw.task);
    if (!title) return null;
    var dueDate = safeDate(raw.dueDate || raw.date || raw.due);
    var dueTime = safeTime(raw.dueTime || raw.time || raw.due);
    var courseId = text(raw.courseId, 160);
    var courseName = text(raw.courseName || raw.course || raw.subject || raw.className).toLowerCase();
    if (!courseId && courseName && courseNames[courseName]) courseId = courseNames[courseName];
    var orphanedCourseId = '';
    if (courseId && !courseIds[courseId]) { orphanedCourseId = courseId; courseId = ''; }
    var idSeed = title.toLowerCase() + '|' + courseId + '|' + dueDate + '|' + index;
    var id = text(raw.id, 160) || ('homework-' + stableHash(idSeed));
    var createdAt = timestamp(raw.createdAt, now);
    var normalized = Object.assign({}, raw, {
      id: id,
      courseId: courseId,
      title: title,
      text: title,
      done: raw.done === true || raw.completed === true || raw.status === 'done',
      dueDate: dueDate,
      dueTime: dueTime,
      due: dueDate,
      priority: ['high', 'medium', 'low'].indexOf(String(raw.priority || '').toLowerCase()) >= 0 ? String(raw.priority).toLowerCase() : 'medium',
      difficulty: ['easy', 'medium', 'hard'].indexOf(String(raw.difficulty || '').toLowerCase()) >= 0 ? String(raw.difficulty).toLowerCase() : 'medium',
      recurrence: ['none', 'daily', 'weekly', 'monthly'].indexOf(String(raw.recurrence || '').toLowerCase()) >= 0 ? String(raw.recurrence).toLowerCase() : 'none',
      notes: text(raw.notes),
      createdAt: createdAt,
      updatedAt: timestamp(raw.updatedAt, createdAt)
    });
    if (orphanedCourseId) normalized.orphanedCourseId = orphanedCourseId;
    if (raw.sourceUrl) normalized.sourceUrl = safeUrl(raw.sourceUrl);
    return normalized;
  }

  function newest(left, right) {
    return Date.parse(right.updatedAt || right.createdAt || '') > Date.parse(left.updatedAt || left.createdAt || '') ? right : left;
  }

  function normalizeWorkspace(input, options) {
    var source = input && typeof input === 'object' ? input : {};
    var now = options && options.now || new Date().toISOString();
    var quarantine = Array.isArray(source.quarantine) ? clone(source.quarantine, []) : [];
    var courses = [];
    var courseById = Object.create(null);
    var courseAliases = Object.create(null);
    (Array.isArray(source.courses) ? source.courses : []).slice(0, MAX_COURSES).forEach(function (raw, index) {
      var course = normalizeCourse(raw, index, now);
      if (!course) { quarantine.push({ entity: 'course', index: index, reason: 'invalid' }); return; }
      var existing = courseById[course.id];
      if (existing) {
        var existingId = existing.id;
        courseAliases[course.id] = existingId;
        var preferred = newest(existing, course);
        Object.assign(existing, preferred);
        existing.id = existingId;
        return;
      }
      courses.push(course);
      courseById[course.id] = course;
    });
    var courseIds = Object.create(null);
    var courseNames = Object.create(null);
    courses.forEach(function (course) {
      courseIds[course.id] = true;
      var nameKey = course.name.toLowerCase();
      // A name-only relationship is safe only when it is unambiguous. Two
      // distinct courses may legitimately share a display name.
      courseNames[nameKey] = courseNames[nameKey] ? '' : course.id;
    });

    var tasks = [];
    var taskById = Object.create(null);
    (Array.isArray(source.tasks) ? source.tasks : []).slice(0, MAX_TASKS).forEach(function (raw, index) {
      var candidate = raw && typeof raw === 'object' ? Object.assign({}, raw) : raw;
      if (candidate && courseAliases[candidate.courseId]) candidate.courseId = courseAliases[candidate.courseId];
      var task = normalizeTask(candidate, index, courseIds, courseNames, now);
      if (!task) { quarantine.push({ entity: 'task', index: index, reason: 'invalid' }); return; }
      var existing = taskById[task.id];
      if (existing) {
        var existingTaskId = existing.id;
        Object.assign(existing, newest(existing, task));
        existing.id = existingTaskId;
        return;
      }
      tasks.push(task);
      taskById[task.id] = task;
    });

    return Object.assign({}, source, {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
      updatedAt: timestamp(source.updatedAt, now),
      courses: courses,
      tasks: tasks,
      quarantine: quarantine.slice(-500)
    });
  }

  function mergeLegacy(primary, legacy, options) {
    var now = options && options.now || new Date().toISOString();
    var canonical = normalizeWorkspace(primary, { now: now });
    var marker = canonical.migrations && canonical.migrations.legacyHomework;
    if (marker && marker.status === 'complete') return canonical;
    var legacySource = legacy && typeof legacy === 'object' ? legacy : {};
    var merged = normalizeWorkspace(Object.assign({}, canonical, {
      courses: canonical.courses.concat(Array.isArray(legacySource.courses) ? legacySource.courses : []),
      tasks: canonical.tasks.concat(Array.isArray(legacySource.tasks) ? legacySource.tasks : []),
      quarantine: canonical.quarantine.concat(Array.isArray(legacySource.quarantine) ? legacySource.quarantine : [])
    }), { now: now });
    var fingerprint = stableHash(JSON.stringify({
      courses: (legacySource.courses || []).map(function (item) { return item && item.id || item && item.name || ''; }),
      tasks: (legacySource.tasks || []).map(function (item) { return item && item.id || item && item.title || item && item.text || ''; })
    }));
    merged.migrations = Object.assign({}, canonical.migrations, {
      legacyHomework: { status: 'complete', fingerprint: fingerprint, completedAt: now }
    });
    merged.revision = canonical.revision + 1;
    merged.updatedAt = now;
    return merged;
  }

  function createStore(initial) {
    var state = normalizeWorkspace(initial || {});
    var adapter = null;
    var listeners = [];
    var durableTail = Promise.resolve();
    function emit(meta) { listeners.slice().forEach(function (listener) { try { listener(getSnapshot(), meta || {}); } catch (_) {} }); }
    function getSnapshot() { return clone(state, normalizeWorkspace({})); }
    function commit(next, meta) {
      var previous = state;
      state = normalizeWorkspace(next);
      state.revision = previous.revision + 1;
      state.updatedAt = new Date().toISOString();
      state.lastMutation = { id: text(meta && meta.id, 160) || ('mutation-' + stableHash(state.updatedAt + '|' + state.revision)), reason: text(meta && meta.reason, 160) || 'update', at: state.updatedAt };
      try {
        if (adapter && typeof adapter.setWorkspace === 'function') adapter.setWorkspace(getSnapshot());
        if (adapter && typeof adapter.persist === 'function') {
          // Scheduled (non-durable) path: the mutation is accepted now and the
          // save rides the canonical persistence pipeline. The adapter may
          // return a real promise (durable contract), so observe rejection
          // here — failures surface through persistence health, not as an
          // unhandled rejection. Durable callers go through commitDurably.
          var scheduledPersist = adapter.persist(state.lastMutation.reason);
          if (scheduledPersist && typeof scheduledPersist.catch === 'function') {
            scheduledPersist.catch(function () { /* surfaced by workspace persistence health */ });
          }
        }
      } catch (error) {
        state = previous;
        try { if (adapter && typeof adapter.setWorkspace === 'function') adapter.setWorkspace(getSnapshot()); } catch (_) {}
        throw error;
      }
      emit(meta);
      return getSnapshot();
    }
    function commitDurably(buildNext, meta, outcome) {
      var operation = durableTail.then(async function () {
        var previous = state;
        var draft = getSnapshot();
        var next = typeof buildNext === 'function' ? buildNext(draft) : draft;
        state = normalizeWorkspace(next === undefined ? draft : next);
        state.revision = previous.revision + 1;
        state.updatedAt = new Date().toISOString();
        state.lastMutation = {
          id: text(meta && meta.id, 160) || ('mutation-' + stableHash(state.updatedAt + '|' + state.revision)),
          reason: text(meta && meta.reason, 160) || 'update',
          at: state.updatedAt
        };
        var attemptedMutationId = state.lastMutation.id;
        var attemptedRevision = state.revision;
        try {
          if (adapter && typeof adapter.setWorkspace === 'function') adapter.setWorkspace(getSnapshot());
          if (adapter && typeof adapter.persist === 'function') {
            await Promise.resolve(adapter.persist(state.lastMutation.reason));
          }
        } catch (error) {
          // Roll back only while this durable mutation is still the newest
          // optimistic state. A scheduled UI mutation may have landed while
          // the save was awaiting IndexedDB. Restoring `previous` in that case
          // would erase the later accepted change; its queued canonical flush
          // can still persist the combined state and persistence health already
          // exposes the failed attempt.
          var stillCurrent = state.revision === attemptedRevision
            && state.lastMutation && state.lastMutation.id === attemptedMutationId;
          if (stillCurrent) state = previous;
          try { if (adapter && typeof adapter.setWorkspace === 'function') adapter.setWorkspace(getSnapshot()); } catch (_) {}
          throw error;
        }
        emit(meta);
        return { result: outcome ? outcome.value : undefined, workspace: getSnapshot() };
      });
      // A failed operation must not poison the queue; the next mutation starts
      // from the rolled-back canonical state.
      durableTail = operation.then(function () {}, function () {});
      return operation;
    }
    return {
      configure: function (nextAdapter) {
        adapter = nextAdapter || null;
        var canonical = adapter && typeof adapter.getWorkspace === 'function' ? adapter.getWorkspace() : state;
        var legacy = adapter && typeof adapter.readLegacy === 'function' ? adapter.readLegacy() : null;
        state = mergeLegacy(canonical || state, legacy || {}, { now: new Date().toISOString() });
        if (adapter && typeof adapter.setWorkspace === 'function') adapter.setWorkspace(getSnapshot());
        if (adapter && typeof adapter.persist === 'function') {
          var migrationPersist = adapter.persist('homework-migration');
          if (migrationPersist && typeof migrationPersist.catch === 'function') {
            migrationPersist.catch(function () { /* surfaced by workspace persistence health */ });
          }
        }
        emit({ reason: 'configure' });
        return getSnapshot();
      },
      getSnapshot: getSnapshot,
      replace: function (next, meta) { return commit(Object.assign({}, state, next || {}), meta || {}); },
      removeCourse: function (courseId, meta) {
        var id = text(courseId, 160);
        var target = state.courses.find(function (course) { return String(course.id) === id; });
        if (!target) return { result: { removed: false, course: null, tasks: [] }, workspace: getSnapshot() };
        var removedCourse = clone(target, {});
        var removedTasks = state.tasks.filter(function (task) { return String(task.courseId || '') === id; });
        var next = Object.assign({}, state, {
          courses: state.courses.filter(function (course) { return String(course.id) !== id; }),
          tasks: state.tasks.filter(function (task) { return String(task.courseId || '') !== id; })
        });
        var snapshot = commit(next, Object.assign({ reason: 'homework-course-remove' }, meta || {}));
        return { result: { removed: true, course: removedCourse, tasks: clone(removedTasks, []) }, workspace: snapshot };
      },
      replaceDurably: function (next, meta) {
        var replacement = clone(next || {}, {});
        return commitDurably(function (draft) { return Object.assign({}, draft, replacement); }, meta || {})
          .then(function (receipt) { return receipt.workspace; });
      },
      transact: function (mutator, meta) {
        if (typeof mutator !== 'function') throw new TypeError('Homework transaction requires a mutator.');
        var draft = getSnapshot();
        var result = mutator(draft);
        var snapshot = commit(draft, meta || {});
        return { result: result, workspace: snapshot };
      },
      transactDurably: function (mutator, meta) {
        if (typeof mutator !== 'function') return Promise.reject(new TypeError('Homework transaction requires a mutator.'));
        var outcome = {};
        return commitDurably(function (draft) {
          outcome.value = mutator(draft);
          return draft;
        }, meta || {}, outcome);
      },
      whenPersisted: function () { return durableTail; },
      subscribe: function (listener) {
        if (typeof listener !== 'function') return function () {};
        listeners.push(listener);
        return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
      },
      normalizeWorkspace: normalizeWorkspace,
      mergeLegacy: mergeLegacy
    };
  }

  var singleton = createStore({});
  singleton.SCHEMA_VERSION = SCHEMA_VERSION;
  singleton.createStore = createStore;
  singleton.normalizeWorkspace = normalizeWorkspace;
  singleton.mergeLegacy = mergeLegacy;
  if (typeof module !== 'undefined' && module.exports) module.exports = singleton;
  if (global) global.SutraHomeworkStore = singleton;
}(typeof window !== 'undefined' ? window : globalThis));
