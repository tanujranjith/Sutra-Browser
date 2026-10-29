/* Legacy homework storage reader. Deprecated keys are migration inputs only. */
(function (global) {
  'use strict';

  var KEYS = Object.freeze({
    coursesV2: 'hwCourses:v2',
    tasksV2: 'hwTasks:v2',
    coursesV1: 'homeworkCourses:v1',
    tasksV1: 'homeworkTasks:v1'
  });
  var diagnostics = [];

  function record(code, detail) {
    diagnostics.push({ code: code, detail: String(detail || '').slice(0, 240), at: new Date().toISOString() });
    if (diagnostics.length > 100) diagnostics.shift();
  }

  function readArray(storage, key, quarantine) {
    var raw;
    try { raw = storage && storage.getItem ? storage.getItem(key) : null; }
    catch (error) {
      record('storage-read-failed', key + ': ' + (error && error.message || error));
      quarantine.push({ source: key, reason: 'storage-read-failed' });
      return [];
    }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      record('malformed-shape', key);
      quarantine.push({ source: key, reason: 'expected-array', valueType: typeof parsed });
    } catch (error) {
      record('malformed-json', key + ': ' + (error && error.message || error));
      quarantine.push({ source: key, reason: 'malformed-json' });
    }
    return [];
  }

  function readSnapshot(storage) {
    var target = storage || (global && global.localStorage);
    var quarantine = [];
    var coursesV2 = readArray(target, KEYS.coursesV2, quarantine);
    var tasksV2 = readArray(target, KEYS.tasksV2, quarantine);
    var coursesV1 = readArray(target, KEYS.coursesV1, quarantine);
    var tasksV1 = readArray(target, KEYS.tasksV1, quarantine);
    return {
      courses: coursesV2.concat(coursesV1),
      tasks: tasksV2.concat(tasksV1),
      quarantine: quarantine,
      sources: {
        coursesV2: coursesV2.length,
        tasksV2: tasksV2.length,
        coursesV1: coursesV1.length,
        tasksV1: tasksV1.length
      }
    };
  }

  var api = {
    KEYS: KEYS,
    readSnapshot: readSnapshot,
    getDiagnostics: function () { return diagnostics.slice(); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraLegacyHomework = api;
}(typeof window !== 'undefined' ? window : globalThis));
