/* Privacy boundary for assistant context and actions. */
(function (global) {
  'use strict';

  var MODES = ['off', 'read_only', 'ask_per_area', 'approved_actions'];
  var adapter = null;
  var KEY_AREAS = {
    activeNote: 'notes', selection: 'notes', canvas: 'notes', slides: 'notes', staleNotes: 'notes',
    tasks: 'planning', homework: 'planning', timelineUpcoming: 'planning', timelineToday: 'planning', timeline: 'planning', deadlines: 'planning', allDue: 'planning', derived: 'planning',
    review: 'learning', apStudy: 'learning', cram: 'learning', testingHub: 'learning',
    college: 'college', applicationCosts: 'college', costs: 'college', financialAid: 'college', financialAidDeadlines: 'college', scholarships: 'college', tuition: 'college',
    courses: 'courses', life: 'life', wellness: 'life', wellnessTrends: 'life', sleep: 'life', mood: 'life', stress: 'life',
    business: 'business', runway: 'business', spending: 'business', income: 'business',
    assistantMemory: 'memory', memory: 'memory', memoryUsedIds: 'memory',
    retrievedNotes: 'notes', notesEvidenceStatus: 'notes', course: 'courses',
    privateDocuments: 'workspace', summary: 'workspace', customTab: 'workspace'
  };
  // Only non-workspace envelope metadata bypasses area permission checks.
  // Human-written summaries and custom-tab content can contain workspace data
  // and therefore must never ride this unconditional path.
  var ALWAYS = new Set(['schema', 'view', 'depth', 'now', 'timeOfDay']);
  // Outbound deny-by-default boundary (audit remediation): these concepts are
  // removed from the FILTERED OUTPUT unless their explicit permission flag is
  // approved — even when a caller supplies them as TOP-LEVEL context fields
  // rather than nested inside their owning area object. stripSensitive()
  // additionally removes nested occurrences inside area values.
  var PRIVATE_TOP_LEVEL_KEYS = ['privateDocuments'];
  var WELLNESS_TOP_LEVEL_FIELDS = ['wellness', 'wellnessTrends', 'sleep', 'mood', 'stress'];
  var FINANCIAL_TOP_LEVEL_FIELDS = ['applicationCosts', 'costs', 'financialAid', 'financialAidDeadlines', 'scholarships', 'runway', 'spending', 'income', 'tuition'];
  var PRIVATE_KEYS = new Set(PRIVATE_TOP_LEVEL_KEYS.map(function (key) { return key.toLowerCase(); }));
  var WELLNESS_KEYS = new Set(WELLNESS_TOP_LEVEL_FIELDS.map(function (key) { return key.toLowerCase(); }));
  var FINANCIAL_KEYS = new Set(FINANCIAL_TOP_LEVEL_FIELDS.map(function (key) { return key.toLowerCase(); }));
  function deniedSensitiveKey(key, permissions) {
    var normalizedKey = String(key || '').toLowerCase();
    if (!permissions.allowPrivateDocuments && PRIVATE_KEYS.has(normalizedKey)) return true;
    if (!permissions.allowWellness && WELLNESS_KEYS.has(normalizedKey)) return true;
    if (!permissions.allowFinancial && FINANCIAL_KEYS.has(normalizedKey)) return true;
    return false;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function normalize(input) {
    var source = input && typeof input === 'object' ? input : {};
    var mode = MODES.indexOf(String(source.mode)) >= 0 ? String(source.mode) : 'off';
    var areas = {};
    Object.keys(source.areas && typeof source.areas === 'object' ? source.areas : {}).forEach(function (key) {
      var value = source.areas[key];
      areas[key] = value === true || value === 'approved' ? 'approved' : value === false || value === 'denied' ? 'denied' : 'ask';
    });
    return {
      version: 1,
      mode: mode,
      areas: areas,
      allowLockedNotes: source.allowLockedNotes === true,
      allowWellness: source.allowWellness === true,
      allowFinancial: source.allowFinancial === true,
      allowPrivateDocuments: source.allowPrivateDocuments === true
    };
  }
  function configure(nextAdapter) { adapter = nextAdapter || null; return api; }
  function getPermissions() {
    try { return normalize(adapter && typeof adapter.getPermissions === 'function' ? adapter.getPermissions() : {}); }
    catch (_) { return normalize({}); }
  }
  function canRead(area, options) {
    var permissions = getPermissions(), opts = options || {};
    if (permissions.mode === 'off') return false;
    var state = permissions.areas[area];
    if (state === 'denied') return false;
    if (permissions.mode === 'ask_per_area') {
      return state === 'approved' || (Array.isArray(opts.approvedAreas) && opts.approvedAreas.indexOf(area) >= 0);
    }
    return state !== 'denied';
  }
  function recordIds(value) {
    if (Array.isArray(value)) return value.map(function (row) { return row && row.id != null ? String(row.id) : ''; }).filter(Boolean).slice(0, 100);
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value.items)) return recordIds(value.items);
    if (Array.isArray(value.exams)) return recordIds(value.exams);
    if (Array.isArray(value.courses)) return recordIds(value.courses);
    return value.id != null ? [String(value.id)] : [];
  }
  function scopedLockedPageIds(options) {
    var ids = options && options.authorizedPageIds;
    if (ids instanceof Set) return new Set(Array.from(ids).map(String));
    if (Array.isArray(ids)) return new Set(ids.map(String));
    return new Set();
  }
  function hasScopedLockedAccess(value, options) {
    if (!value || typeof value !== 'object' || !(value.locked === true || value.isLocked === true)) return false;
    var id = value.id != null ? String(value.id) : (value.noteId != null ? String(value.noteId) : '');
    return !!id && scopedLockedPageIds(options).has(id);
  }
  function stripSensitive(key, value, permissions, options) {
    if (deniedSensitiveKey(key, permissions)) return undefined;
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map(function (entry) { return stripSensitive('', entry, permissions, options); })
        .filter(function (entry) { return entry !== undefined; });
    }
    var locked = value.locked === true || value.isLocked === true;
    var allowedLockedFields = new Set(['id', 'noteId', 'title', 'locked', 'isLocked', 'type']);
    var scopedAccess = hasScopedLockedAccess(value, options);
    var out = {};
    Object.keys(value).forEach(function (field) {
      // The persisted allowLockedNotes preference is retained for migration and
      // display compatibility, but it is never an authorization by itself.
      // Protected content requires a one-request page-scoped grant that has
      // already passed the Assistant consent + page-PIN flow.
      if (locked && !scopedAccess && !allowedLockedFields.has(field)) return;
      if (deniedSensitiveKey(field, permissions)) return;
      var sanitized = stripSensitive(field, value[field], permissions, options);
      if (sanitized !== undefined) out[field] = sanitized;
    });
    return out;
  }
  function filterContext(context, options) {
    var source = context && typeof context === 'object' ? context : {}, permissions = getPermissions(), out = {}, areasRead = [], recordsRead = [];
    var scopedIds = scopedLockedPageIds(options);
    Object.keys(source).forEach(function (key) {
      if (ALWAYS.has(key)) { out[key] = clone(source[key]); return; }
      // The policy boundary enforces its own privacy guarantees: a denied
      // sensitive field never reaches the outbound payload regardless of how
      // the caller structured its context.
      if (!Object.prototype.hasOwnProperty.call(KEY_AREAS, key)) return;
      if (deniedSensitiveKey(key, permissions)) return;
      var area = KEY_AREAS[key];
      if (!canRead(area, options)) return;
      var value = stripSensitive(key, source[key], permissions, options);
      out[key] = value;
      if (areasRead.indexOf(area) < 0) areasRead.push(area);
      recordIds(value).forEach(function (id) { recordsRead.push({ area: area, kind: key, id: id }); });
    });
    out.accessReport = {
      mode: permissions.mode,
      areasRead: areasRead.sort(),
      recordsRead: recordsRead.slice(0, 200),
      excludedSensitiveAreas: [
        !scopedIds.size && 'locked_notes', !permissions.allowWellness && 'wellness',
        !permissions.allowFinancial && 'financial', !permissions.allowPrivateDocuments && 'private_documents'
      ].filter(Boolean),
      lockedNotesRead: Array.from(scopedIds).slice(0, 20)
    };
    return out;
  }
  function getActionPermissions(options) {
    var permissions = getPermissions(), opts = options || {}, granted = [];
    if (permissions.mode !== 'off') granted.push('workspace.read');
    if (permissions.mode === 'approved_actions' && opts.approved === true) granted.push('workspace.write');
    if (permissions.mode === 'approved_actions' && opts.approved === true && opts.destructiveApproved === true) granted.push('workspace.delete');
    if (opts.pluginApproved === true) granted.push('plugin.execute');
    return granted;
  }
  function describeClaim(kind, value, sources) {
    var types = ['workspace_fact', 'deterministic_inference', 'generative_suggestion'];
    var type = types.indexOf(kind) >= 0 ? kind : 'generative_suggestion';
    return { type: type, value: value, sources: Array.isArray(sources) ? sources.map(function (source) { return clone(source); }).slice(0, 20) : [] };
  }

  var api = { VERSION: '1.0.0', MODES: MODES.slice(), configure: configure, normalize: normalize, getPermissions: getPermissions, canRead: canRead, filterContext: filterContext, getActionPermissions: getActionPermissions, describeClaim: describeClaim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraAssistantPrivacy = api;
}(typeof window !== 'undefined' ? window : globalThis));
