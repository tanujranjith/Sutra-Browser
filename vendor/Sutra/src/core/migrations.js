/* Sequential, recoverable Sutra workspace schema migrations. */
(function (global) {
  'use strict';

  var CURRENT_VERSION = 8;
  var registry = Object.create(null);

  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function normalizeVersion(value) {
    var parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  }
  function nowIso(options) { return options && options.now ? String(options.now) : new Date().toISOString(); }

  function inspectSerializable(root) {
    var issues = [];
    var active = typeof WeakSet === 'function' ? new WeakSet() : null;
    function visit(value, path, depth) {
      if (depth > 100) { issues.push({ path: path, code: 'max-depth', fatal: true }); return; }
      if (value === null || value === undefined) return;
      var type = typeof value;
      if (type === 'function' || type === 'symbol' || type === 'bigint') {
        issues.push({ path: path, code: 'non-serializable-' + type, fatal: true });
        return;
      }
      if (type !== 'object') return;
      if (active && active.has(value)) { issues.push({ path: path, code: 'recursive-object', fatal: true }); return; }
      if (active) active.add(value);
      var keys = Object.keys(value);
      if (keys.length > 100000) issues.push({ path: path, code: 'too-many-fields', fatal: true });
      keys.forEach(function (key) { visit(value[key], path + '.' + key, depth + 1); });
      if (active) active.delete(value);
    }
    visit(root, '$', 0);
    return issues;
  }

  function validateRelationships(workspace) {
    var issues = [];
    var homework = isObject(workspace.homeworkWorkspace) ? workspace.homeworkWorkspace : {};
    var homeworkCourses = Array.isArray(homework.courses) ? homework.courses : [];
    var homeworkTasks = Array.isArray(homework.tasks) ? homework.tasks : [];
    var courseIds = Object.create(null);
    var taskIds = Object.create(null);
    homeworkCourses.forEach(function (course, index) {
      var id = course && String(course.id || '');
      if (!id) issues.push({ path: '$.homeworkWorkspace.courses[' + index + ']', code: 'missing-id', fatal: false });
      else if (courseIds[id]) issues.push({ path: '$.homeworkWorkspace.courses[' + index + '].id', code: 'duplicate-id', fatal: false });
      else courseIds[id] = true;
    });
    homeworkTasks.forEach(function (task, index) {
      var id = task && String(task.id || '');
      if (!id) issues.push({ path: '$.homeworkWorkspace.tasks[' + index + ']', code: 'missing-id', fatal: false });
      else if (taskIds[id]) issues.push({ path: '$.homeworkWorkspace.tasks[' + index + '].id', code: 'duplicate-id', fatal: false });
      else taskIds[id] = true;
      if (task && task.courseId && !courseIds[String(task.courseId)]) {
        issues.push({ path: '$.homeworkWorkspace.tasks[' + index + '].courseId', code: 'missing-course-reference', fatal: false });
      }
    });

    var pages = Array.isArray(workspace.pages) ? workspace.pages : [];
    var pageIds = Object.create(null);
    pages.forEach(function (page) { if (page && page.id) pageIds[String(page.id)] = true; });
    (Array.isArray(workspace.timeBlocks) ? workspace.timeBlocks : []).forEach(function (block, index) {
      if (block && block.homeworkId && !taskIds[String(block.homeworkId)]) issues.push({ path: '$.timeBlocks[' + index + '].homeworkId', code: 'missing-homework-reference', fatal: false });
      if (block && block.noteId && !pageIds[String(block.noteId)]) issues.push({ path: '$.timeBlocks[' + index + '].noteId', code: 'missing-note-reference', fatal: false });
    });
    var review = isObject(workspace.reviewWorkspace) ? workspace.reviewWorkspace : {};
    (Array.isArray(review.items) ? review.items : []).forEach(function (item, index) {
      if (item && item.noteId && !pageIds[String(item.noteId)]) issues.push({ path: '$.reviewWorkspace.items[' + index + '].noteId', code: 'missing-note-reference', fatal: false });
      if (item && item.homeworkId && !taskIds[String(item.homeworkId)]) issues.push({ path: '$.reviewWorkspace.items[' + index + '].homeworkId', code: 'missing-homework-reference', fatal: false });
    });
    var memory = isObject(workspace.assistantMemory) ? workspace.assistantMemory : {};
    (Array.isArray(memory.items) ? memory.items : []).forEach(function (item, index) {
      if (item && item.noteId && !pageIds[String(item.noteId)]) issues.push({ path: '$.assistantMemory.items[' + index + '].noteId', code: 'missing-note-reference', fatal: false });
    });
    return issues;
  }

  function validateWorkspace(workspace) {
    var issues = [];
    if (!isObject(workspace)) issues.push({ path: '$', code: 'workspace-not-object', fatal: true });
    else {
      issues = issues.concat(inspectSerializable(workspace));
      issues = issues.concat(validateRelationships(workspace));
    }
    return { ok: !issues.some(function (issue) { return issue.fatal; }), issues: issues };
  }

  function register(fromVersion, migrate, options) {
    var from = normalizeVersion(fromVersion);
    if (typeof migrate !== 'function') throw new TypeError('Migration must be a function.');
    registry[from] = { migrate: migrate, destructive: !!(options && options.destructive), description: String(options && options.description || '') };
  }

  register(1, function migrateV1ToV2(workspace) {
    var next = workspace;
    var legacyStreaks = isObject(next.streaks) ? next.streaks : {};
    next.streaks = Object.assign({}, legacyStreaks);
    if (!next.streaks.dayStates && next.dayStates) next.streaks.dayStates = next.dayStates;
    if (!next.streaks.taskStreaks && next.taskStreaks) next.streaks.taskStreaks = next.taskStreaks;
    if (!next.streaks.streakState && next.streakState) next.streaks.streakState = next.streakState;
    if (!isObject(next.settings)) next.settings = {};
    return next;
  }, { description: 'Nest legacy streak state.' });

  register(2, function migrateV2ToV3(workspace, options) {
    var next = workspace;
    var homework = isObject(next.homeworkWorkspace) ? next.homeworkWorkspace : {};
    var legacyCourses = Array.isArray(homework.legacyCourses) ? homework.legacyCourses : [];
    var legacyTasks = Array.isArray(homework.legacyTasks) ? homework.legacyTasks : [];
    next.compatibility = Object.assign({}, next.compatibility);
    if ((legacyCourses.length || legacyTasks.length) && !next.compatibility.legacyHomeworkSnapshot) {
      next.compatibility.legacyHomeworkSnapshot = { courses: clone(legacyCourses), tasks: clone(legacyTasks), migratedAt: nowIso(options) };
    }
    homework = Object.assign({}, homework, {
      schemaVersion: 2,
      revision: Math.max(0, Math.floor(Number(homework.revision) || 0)),
      courses: (Array.isArray(homework.courses) ? homework.courses : []).concat(legacyCourses),
      tasks: (Array.isArray(homework.tasks) ? homework.tasks : []).concat(legacyTasks),
      quarantine: Array.isArray(homework.quarantine) ? homework.quarantine : []
    });
    delete homework.legacyCourses;
    delete homework.legacyTasks;
    next.homeworkWorkspace = homework;
    return next;
  }, { destructive: true, description: 'Move homework into the canonical workspace store.' });

  register(3, function migrateV3ToV4(workspace) {
    var next = workspace;
    var quarantine = [];
    ['pages', 'tasks', 'timeBlocks', 'spaces', 'trash', 'focusSessions', 'cramSessions'].forEach(function (key) {
      if (next[key] !== undefined && !Array.isArray(next[key])) {
        quarantine.push({ path: '$.' + key, reason: 'expected-array', value: clone(next[key]) });
        next[key] = [];
      }
    });
    next.migrationDiagnostics = Object.assign({}, next.migrationDiagnostics, {
      quarantine: (Array.isArray(next.migrationDiagnostics && next.migrationDiagnostics.quarantine)
        ? next.migrationDiagnostics.quarantine : []).concat(quarantine).slice(-500)
    });
    next.schema = Object.assign({}, next.schema, { name: 'sutra-workspace', version: 4 });
    return next;
  }, { destructive: true, description: 'Quarantine invalid collection shapes and record schema metadata.' });

  register(4, function migrateV4ToV5(workspace) {
    var next = workspace;
    function arrayOrEmpty(value) { return Array.isArray(value) ? value : []; }
    function objectOrDefault(value, fallback) { return isObject(value) ? value : clone(fallback); }
    next.protectedTime = arrayOrEmpty(next.protectedTime);
    next.taskDependencies = arrayOrEmpty(next.taskDependencies);
    next.studySessions = arrayOrEmpty(next.studySessions);
    next.masteryRecords = arrayOrEmpty(next.masteryRecords);
    next.confidenceObservations = arrayOrEmpty(next.confidenceObservations);
    next.syncAuditLog = arrayOrEmpty(next.syncAuditLog);
    next.privateDocuments = arrayOrEmpty(next.privateDocuments);
    next.sharedStudySessions = arrayOrEmpty(next.sharedStudySessions);
    next.studentDecisionState = objectOrDefault(next.studentDecisionState, {
      version: 1, preset: 'balanced', snoozed: {}, dismissed: [], pinned: []
    });
    next.assistantPermissions = objectOrDefault(next.assistantPermissions, {
      version: 1, mode: 'off', areas: {}, allowLockedNotes: false, allowWellness: false, allowFinancial: false, allowPrivateDocuments: false
    });
    next.assistantMemory = objectOrDefault(next.assistantMemory, { version: 1, enabled: false, items: [] });
    next.workspaceMeta = objectOrDefault(next.workspaceMeta, { version: 1, revision: 0, lastWriterTabId: '', lastSavedAt: '' });
    next.operatingManual = objectOrDefault(next.operatingManual, {
      version: 1, preferredStudyTimes: [], reminderStyle: 'calm', planningStyle: 'balanced', accessibility: {}, notes: ''
    });
    next.portfolioWorkspace = objectOrDefault(next.portfolioWorkspace, { version: 1, entries: [], settings: {} });
    next.collegeAppWorkspace = objectOrDefault(next.collegeAppWorkspace, {});
    next.collegeAppWorkspace.activities = arrayOrEmpty(next.collegeAppWorkspace.activities);
    next.collegeAppWorkspace.submissionReadiness = arrayOrEmpty(next.collegeAppWorkspace.submissionReadiness);
    next.collegeAppWorkspace.applicationCosts = arrayOrEmpty(next.collegeAppWorkspace.applicationCosts);
    next.collegeAppWorkspace.financialAidDeadlines = arrayOrEmpty(next.collegeAppWorkspace.financialAidDeadlines);
    next.schema = Object.assign({}, next.schema, { name: 'sutra-workspace', version: 5 });
    return next;
  }, { description: 'Add Sutra 2.0 planning, mastery, privacy, collaboration, and portfolio contracts.' });

  register(5, function migrateV5ToV6(workspace) {
    var next = workspace;
    next.schema = Object.assign({}, next.schema, { name: 'sutra-workspace', version: 6 });
    next.migrationHistory = Array.isArray(next.migrationHistory) ? next.migrationHistory : [];
    next.migrationDiagnostics = isObject(next.migrationDiagnostics) ? next.migrationDiagnostics : {};
    next.compatibility = isObject(next.compatibility) ? next.compatibility : {};
    next.privateDocuments = Array.isArray(next.privateDocuments) ? next.privateDocuments : [];
    next.syncAuditLog = Array.isArray(next.syncAuditLog) ? next.syncAuditLog : [];
    return next;
  }, { description: 'Version the complete encrypted sync-portability contract and recovery fields.' });

  register(6, function migrateV6ToV7(workspace) {
    var next = workspace;
    var history = isObject(next.assistantChatHistory) ? next.assistantChatHistory : {};
    next.assistantChatHistory = Object.assign({}, history, {
      version: 1,
      currentChatId: typeof history.currentChatId === 'string' ? history.currentChatId : '',
      conversations: Array.isArray(history.conversations) ? history.conversations : [],
      // Existing v6 profiles may still have their only durable chat copy in
      // the legacy SafeStorage/localStorage mirror. The browser runtime imports
      // that mirror exactly once and then flips this marker. Keeping the marker
      // in the canonical workspace prevents a stale/empty mirror from ever
      // overriding synchronized history on later starts.
      legacyMigrationComplete: history.legacyMigrationComplete === true
    });
    next.schema = Object.assign({}, next.schema, { name: 'sutra-workspace', version: 7 });
    return next;
  }, { description: 'Make Assistant conversations canonical workspace data with one-time legacy mirror migration.' });

  register(7, function migrateV7ToV8(workspace) {
    var next = workspace;
    next.attachmentLinks = Array.isArray(next.attachmentLinks) ? next.attachmentLinks : [];
    next.pdfDocuments = Array.isArray(next.pdfDocuments) ? next.pdfDocuments : [];
    next.pdfAnnotations = Array.isArray(next.pdfAnnotations) ? next.pdfAnnotations : [];
    var seen = Object.create(null);
    next.attachmentLinks.forEach(function (link) {
      if (!link || !link.fileId || !link.entityType || !link.entityId) return;
      seen[String(link.fileId) + '\n' + String(link.entityType) + '\n' + String(link.entityId)] = true;
    });
    var files = next.courseWorkspace && Array.isArray(next.courseWorkspace.files) ? next.courseWorkspace.files : [];
    files.forEach(function (file) {
      if (!file || !file.id) return;
      var pairs = [];
      if (file.courseId && String(file.courseId) !== '__private_vault__') pairs.push(['course', String(file.courseId)]);
      if (file.linkedEntityType && file.linkedEntityId) pairs.push([String(file.linkedEntityType), String(file.linkedEntityId)]);
      pairs.forEach(function (pair) {
        var key = String(file.id) + '\n' + pair[0] + '\n' + pair[1];
        if (seen[key]) return;
        next.attachmentLinks.push({
          id: 'alink_' + String(file.id) + '_' + pair[0] + '_' + pair[1],
          fileId: String(file.id), entityType: pair[0], entityId: pair[1],
          createdAt: file.createdAt || new Date(0).toISOString()
        });
        seen[key] = true;
      });
    });
    (Array.isArray(next.privateDocuments) ? next.privateDocuments : []).forEach(function (documentRecord) {
      if (!documentRecord || !documentRecord.id || !documentRecord.fileId) return;
      var key = String(documentRecord.fileId) + '\nprivate_document\n' + String(documentRecord.id);
      if (seen[key]) return;
      next.attachmentLinks.push({ id: 'alink_' + documentRecord.fileId + '_private_' + documentRecord.id, fileId: String(documentRecord.fileId), entityType: 'private_document', entityId: String(documentRecord.id), createdAt: documentRecord.createdAt || new Date(0).toISOString() });
      seen[key] = true;
    });
    next.pdfDocuments.forEach(function (documentRecord) {
      (documentRecord && Array.isArray(documentRecord.pages) ? documentRecord.pages : []).forEach(function (page) {
        if (!page || !page.id || !page.sourceFileId) return;
        var key = String(page.sourceFileId) + '\npdf_page_source\n' + String(page.id);
        if (seen[key]) return;
        next.attachmentLinks.push({ id: 'alink_' + page.sourceFileId + '_pdf_page_' + page.id, fileId: String(page.sourceFileId), entityType: 'pdf_page_source', entityId: String(page.id), createdAt: documentRecord.createdAt || new Date(0).toISOString() });
        seen[key] = true;
      });
    });
    next.schema = Object.assign({}, next.schema, { name: 'sutra-workspace', version: 8 });
    return next;
  }, { description: 'Add canonical attachment links and normalized native PDF workspace records.' });

  function plan(input, targetVersion) {
    var target = normalizeVersion(targetVersion || CURRENT_VERSION);
    var version = normalizeVersion(input && input.version);
    var steps = [];
    while (version < target) {
      var definition = registry[version];
      if (!definition) throw new Error('Missing Sutra workspace migration v' + version + ' -> v' + (version + 1));
      steps.push({ from: version, to: version + 1, destructive: definition.destructive, description: definition.description });
      version += 1;
    }
    return steps;
  }

  function migrateWorkspace(input, options) {
    var opts = options || {};
    var inputValidation = validateWorkspace(input);
    if (!inputValidation.ok) {
      var validationError = new Error('Workspace failed pre-migration validation.');
      validationError.name = 'WorkspaceValidationError';
      validationError.issues = inputValidation.issues;
      throw validationError;
    }
    var targetVersion = normalizeVersion(opts.targetVersion || CURRENT_VERSION);
    var workspace = clone(input);
    var fromVersion = normalizeVersion(workspace.version);
    var applied = [];
    if (fromVersion > targetVersion) return { workspace: workspace, fromVersion: fromVersion, toVersion: fromVersion, applied: [], futureVersion: true, validation: inputValidation };

    var steps = plan(workspace, targetVersion);
    if (steps.some(function (step) { return step.destructive; }) && typeof opts.onBeforeDestructive === 'function') {
      opts.onBeforeDestructive(clone(workspace), clone(steps));
    }
    var version = fromVersion;
    while (version < targetVersion) {
      var definition = registry[version];
      workspace = definition.migrate(workspace, opts) || workspace;
      version += 1;
      workspace.version = version;
      var record = { id: 'v' + (version - 1) + '->v' + version, from: version - 1, to: version, appliedAt: nowIso(opts) };
      workspace.migrationHistory = (Array.isArray(workspace.migrationHistory) ? workspace.migrationHistory : []).filter(function (item) { return item && item.id !== record.id; });
      workspace.migrationHistory.push(record);
      applied.push(record.id);
      var stepValidation = validateWorkspace(workspace);
      if (!stepValidation.ok) {
        var outputError = new Error('Workspace failed validation after ' + record.id + '.');
        outputError.name = 'WorkspaceMigrationError';
        outputError.issues = stepValidation.issues;
        throw outputError;
      }
    }
    var outputValidation = validateWorkspace(workspace);
    return { workspace: workspace, fromVersion: fromVersion, toVersion: version, applied: applied, futureVersion: false, validation: outputValidation };
  }

  var api = {
    CURRENT_VERSION: CURRENT_VERSION,
    register: register,
    migrateWorkspace: migrateWorkspace,
    validateWorkspace: validateWorkspace,
    validateRelationships: validateRelationships,
    plan: plan,
    requiresBackup: function (input, target) { return plan(input, target).some(function (step) { return step.destructive; }); },
    list: function () { return Object.keys(registry).map(Number).sort(function (a, b) { return a - b; }); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraMigrations = api;
}(typeof window !== 'undefined' ? window : globalThis));
