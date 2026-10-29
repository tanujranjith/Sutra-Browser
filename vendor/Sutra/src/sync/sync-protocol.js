/*
 * Sutra Sync protocol v1 — canonical serialization, hashing, record-key
 * grammar, the record classification table, and op/envelope validators.
 * Pure module: no DOM, no storage, no network. Normative spec:
 * docs/architecture/SYNC_PROTOCOL.md.
 */
(function (global) {
  'use strict';

  var PROTOCOL_VERSION = 1;
  var TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

  // ------------------------------------------------------------------
  // Canonical serialization + hashing
  // ------------------------------------------------------------------

  // Deterministic JSON: recursively sorted object keys, arrays in order,
  // undefined properties dropped (like JSON.stringify), non-finite numbers
  // serialized as null (like JSON.stringify).
  function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    var type = typeof value;
    if (type === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'string') return JSON.stringify(value);
    if (type !== 'object') return 'null'; // functions/symbols do not travel
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i += 1) {
        var entry = value[i];
        parts.push(entry === undefined ? 'null' : stableStringify(entry));
      }
      return '[' + parts.join(',') + ']';
    }
    var keys = Object.keys(value).sort();
    var pieces = [];
    for (var k = 0; k < keys.length; k += 1) {
      var key = keys[k];
      var entryValue = value[key];
      if (entryValue === undefined) continue;
      pieces.push(JSON.stringify(key) + ':' + stableStringify(entryValue));
    }
    return '{' + pieces.join(',') + '}';
  }

  function getSubtle() {
    var cryptoObj = (global && global.crypto) || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('WebCrypto (crypto.subtle) is unavailable.');
    return cryptoObj.subtle;
  }

  function bytesToHex(buffer) {
    var view = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < view.length; i += 1) {
      out += (view[i] < 16 ? '0' : '') + view[i].toString(16);
    }
    return out;
  }

  async function hashText(text) {
    var encoded = new TextEncoder().encode(String(text));
    var digest = await getSubtle().digest('SHA-256', encoded);
    return bytesToHex(digest);
  }

  async function hashValue(value) {
    return hashText(stableStringify(value));
  }

  // ------------------------------------------------------------------
  // Record-key grammar: c/<collection>/<id> | a/<section> | o/<name>
  // ------------------------------------------------------------------

  function collectionKey(collection, id) {
    return 'c/' + collection + '/' + encodeURIComponent(String(id));
  }

  function atomicKey(section) {
    return 'a/' + section;
  }

  function orderingKey(name) {
    return 'o/' + name;
  }

  function parseRecordKey(recordKey) {
    var raw = String(recordKey || '');
    if (raw.indexOf('a/') === 0) {
      var section = raw.slice(2);
      if (!section) return null;
      return { type: 'atomic', section: section };
    }
    if (raw.indexOf('o/') === 0) {
      var name = raw.slice(2);
      if (!name || name.indexOf('/') !== -1) return null;
      return { type: 'ordering', name: name };
    }
    if (raw.indexOf('c/') === 0) {
      var rest = raw.slice(2);
      var slash = rest.indexOf('/');
      if (slash <= 0 || slash === rest.length - 1) return null;
      var collection = rest.slice(0, slash);
      var encodedId = rest.slice(slash + 1);
      if (encodedId.indexOf('/') !== -1) return null;
      var id;
      try { id = decodeURIComponent(encodedId); } catch (error) { return null; }
      return { type: 'collection', collection: collection, id: id };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Classification (v1) — must stay in lockstep with SYNC_PROTOCOL.md §3.2
  // and cover docs/architecture/persistence-inventory.json exactly once.
  // ------------------------------------------------------------------

  var CLASSIFICATION = {
    // Top-level arrays of id-keyed records. Every collection also emits an
    // o/<collection> ordering doc from its array order, so record merges
    // never fight over sequence and user-visible ordering survives sync.
    collections: [
      { field: 'pages', collection: 'pages' },
      { field: 'tasks', collection: 'tasks' },
      { field: 'timeBlocks', collection: 'timeBlocks' },
      { field: 'customTabs', collection: 'customTabs' },
      { field: 'trash', collection: 'trash' },
      { field: 'privateDocuments', collection: 'privateDocuments' },
      { field: 'syncAuditLog', collection: 'syncAuditLog' },
      { field: 'migrationHistory', collection: 'migrationHistory' },
      { field: 'attachmentLinks', collection: 'attachmentLinks' },
      { field: 'pdfDocuments', collection: 'pdfDocuments' },
      { field: 'pdfAnnotations', collection: 'pdfAnnotations' }
    ],
    // Sections whose id-keyed collections live under named keys; leftover
    // keys travel as a/<field>.__rest.
    nestedCollections: [
      {
        field: 'homeworkWorkspace',
        parts: [
          { key: 'courses', collection: 'homeworkCourses' },
          { key: 'tasks', collection: 'homeworkTasks' }
        ]
      },
      {
        field: 'reviewWorkspace',
        parts: [
          { key: 'decks', collection: 'reviewDecks' },
          { key: 'items', collection: 'reviewItems' }
        ]
      },
      {
        field: 'assistantChatHistory',
        parts: [
          { key: 'conversations', collection: 'assistantConversations' }
        ]
      }
    ],
    // Top-level fields that ARE ordering data (synced as their own o/ doc).
    orderings: [
      { field: 'taskOrder', ordering: 'taskOrder' }
    ],
    // Whole-section documents (LWW with base check).
    atomics: [
      'spaces', 'streaks', 'habitTracker', 'collegeTracker',
      'academicWorkspace', 'collegeAppWorkspace', 'lifeWorkspace',
      'businessWorkspace', 'apStudyWorkspace', 'courseWorkspace',
      'schoolSchedule', 'gradePlanner', 'semesterSetup', 'cramSessions',
      'focusSessions', 'focusTemplates', 'testingHub',
      'pinnedPages', 'notificationsState',
      'protectedTime', 'taskDependencies', 'studySessions',
      'masteryRecords', 'confidenceObservations', 'studentDecisionState',
      'assistantPermissions', 'assistantMemory',
      'sharedStudySessions', 'operatingManual', 'portfolioWorkspace',
      'settings', 'globalTheme', 'migrationDiagnostics', 'compatibility',
      'localStorageSnapshot', 'schema', 'unknownWorkspaceFields'
    ],
    // Never synced: device-local, regenerable, or echo-prone.
    // splitPaneContexts is per-device pane layout (like ui); workspaceMeta is
    // cross-tab/save coordination rather than workspace content.
    excluded: [
      'version', 'exportedAt', 'workspaceMeta', 'ui', 'splitPaneContexts'
    ],
    // Per-record field policies:
    //  - hashVolatile: carried in op payloads but EXCLUDED from the record
    //    hash — a change to only these fields is not a change (pages get
    //    their updatedAt bumped on every save of the open page; without this
    //    every device would forever "conflict" on whatever page is open).
    //  - localOnly: never travel at all (stripped from payload + hash) and
    //    the receiving device keeps its own value on apply (currently the
    //    homework store's per-device revision counter).
    recordFieldPolicies: {
      'c/pages': { hashVolatile: ['updatedAt'] },
      'c/pdfDocuments': { hashVolatile: ['updatedAt'] },
      'c/pdfAnnotations': { hashVolatile: ['updatedAt'] },
      // The homework store bumps revision/updatedAt/lastMutation on every
      // local mutation INCLUDING a sync apply — pure per-device bookkeeping.
      'a/homeworkWorkspace.__rest': { localOnly: ['revision', 'updatedAt', 'lastMutation'] },
      // Backup chat snapshots stamp exportedAt; sync snapshots omit it, but
      // this keeps older baselines quiescent.
      'a/assistantChatHistory.__rest': { hashVolatile: ['exportedAt'] },
      // Delivery timestamps control this browser's reminder and weekly-review
      // prompts.  They are not shared workspace decisions, so one device
      // opening Sutra must not suppress another device's local prompt.
      'a/notificationsState': { localOnly: ['lastActiveAt', 'lastDigest', 'lastWeeklyReviewAt', 'lastWeeklyNudge'] }
    },
    // Generated records reconstructed by every runtime are not user content.
    // Excluding them prevents a fresh device's bootstrap seed from being
    // unioned into an established vault.
    excludedCollectionRecords: {
      pages: { ids: ['help_page'], systemRoles: ['help-docs'] }
    },
    // Paths stripped from within otherwise-synced records. The sync enable
    // flag/endpoint are device-local and must never force-enable sync on
    // another device. settings.dataHealth mutates on every local save
    // (lastSaveAttemptAt) — syncing it would keep the settings record
    // permanently dirty and replicate device-local health stamps.
    // assistant.localEndpoint is the machine-specific local AI endpoint
    // (base URL, model, vision flag) — one device's 192.168.x.x address must
    // never become another device's model config.
    strippedSettingsPreferenceSections: ['sync'],
    strippedSettingsPreferenceSubpaths: ['assistant.localEndpoint'],
    strippedSettingsKeys: ['dataHealth']
  };

  function listClassifiedFields() {
    var fields = [];
    var i;
    for (i = 0; i < CLASSIFICATION.collections.length; i += 1) fields.push(CLASSIFICATION.collections[i].field);
    for (i = 0; i < CLASSIFICATION.nestedCollections.length; i += 1) fields.push(CLASSIFICATION.nestedCollections[i].field);
    for (i = 0; i < CLASSIFICATION.orderings.length; i += 1) fields.push(CLASSIFICATION.orderings[i].field);
    return fields.concat(CLASSIFICATION.atomics, CLASSIFICATION.excluded);
  }

  // ------------------------------------------------------------------
  // Ops + envelopes
  // ------------------------------------------------------------------

  function makeOpId(deviceId, lamport) {
    return String(deviceId) + ':' + String(lamport);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isSha256(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  }

  function validateOp(op) {
    var errors = [];
    if (!op || typeof op !== 'object' || Array.isArray(op)) return ['op must be an object'];
    if (!isNonEmptyString(op.opId)) errors.push('opId missing');
    if (!isNonEmptyString(op.deviceId)) errors.push('deviceId missing');
    if (isNonEmptyString(op.deviceId) && (op.deviceId.length > 128 || op.deviceId.indexOf(':') !== -1)) errors.push('deviceId is malformed');
    if (!Number.isInteger(op.lamport) || op.lamport < 0) errors.push('lamport must be a non-negative integer');
    if (isNonEmptyString(op.opId) && isNonEmptyString(op.deviceId) && Number.isInteger(op.lamport)
      && op.opId !== makeOpId(op.deviceId, op.lamport)) {
      errors.push('opId does not match deviceId:lamport');
    }
    if (!parseRecordKey(op.recordKey) || String(op.recordKey || '').length > 1024) errors.push('recordKey is malformed');
    if (op.kind !== 'upsert' && op.kind !== 'delete') errors.push('kind must be upsert|delete');
    if (op.kind === 'upsert') {
      // Any JSON value is a legal record payload (atomic sections can be
      // null at boot); only `undefined` means the diff lost the value.
      if (op.payload === undefined) errors.push('upsert payload missing');
      if (!isSha256(op.hash)) errors.push('upsert hash missing or malformed');
    }
    if (op.kind === 'delete') {
      if (op.payload !== null && op.payload !== undefined) errors.push('delete payload must be null');
      if (op.hash !== null && op.hash !== undefined) errors.push('delete hash must be null');
    }
    if (op.baseHash !== null && op.baseHash !== undefined && !isSha256(op.baseHash)) {
      errors.push('baseHash must be a hash or null');
    }
    if (!Number.isInteger(op.schemaVersion) || op.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
    if (op.protocolVersion !== PROTOCOL_VERSION) errors.push('protocolVersion mismatch');
    return errors;
  }

  function envelopeMeta(op) {
    return {
      opId: op.opId,
      deviceId: op.deviceId,
      lamport: op.lamport,
      recordKey: op.recordKey,
      kind: op.kind,
      protocolVersion: op.protocolVersion,
      schemaVersion: op.schemaVersion
    };
  }

  function validateEnvelope(envelope) {
    var errors = [];
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return ['envelope must be an object'];
    if (envelope.v !== 1) errors.push('unsupported envelope version');
    if (envelope.alg !== 'A256GCM') errors.push('unsupported algorithm');
    if (!isNonEmptyString(envelope.iv)) errors.push('iv missing');
    if (!isNonEmptyString(envelope.ct)) errors.push('ct missing');
    var meta = envelope.meta;
    if (!meta || typeof meta !== 'object') {
      errors.push('meta missing');
      return errors;
    }
    if (!isNonEmptyString(meta.opId)) errors.push('meta.opId missing');
    if (!isNonEmptyString(meta.deviceId)) errors.push('meta.deviceId missing');
    if (!Number.isInteger(meta.lamport) || meta.lamport < 0) errors.push('meta.lamport missing');
    if (isNonEmptyString(meta.opId) && isNonEmptyString(meta.deviceId) && Number.isInteger(meta.lamport)
      && meta.opId !== makeOpId(meta.deviceId, meta.lamport)) errors.push('meta.opId mismatch');
    if (!parseRecordKey(meta.recordKey)) errors.push('meta.recordKey malformed');
    if (meta.kind !== 'upsert' && meta.kind !== 'delete') errors.push('meta.kind invalid');
    if (meta.protocolVersion !== PROTOCOL_VERSION) errors.push('meta.protocolVersion mismatch');
    if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1) errors.push('meta.schemaVersion missing');
    return errors;
  }

  // Deterministic total order used by the merge tiebreak: numeric lamport,
  // then lexicographic deviceId. Never wall-clock time.
  function compareOps(a, b) {
    var la = Number(a && a.lamport) || 0;
    var lb = Number(b && b.lamport) || 0;
    if (la !== lb) return la < lb ? -1 : 1;
    var da = String(a && a.deviceId);
    var db = String(b && b.deviceId);
    if (da === db) return 0;
    return da < db ? -1 : 1;
  }

  var api = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    TOMBSTONE_RETENTION_MS: TOMBSTONE_RETENTION_MS,
    stableStringify: stableStringify,
    hashText: hashText,
    hashValue: hashValue,
    collectionKey: collectionKey,
    atomicKey: atomicKey,
    orderingKey: orderingKey,
    parseRecordKey: parseRecordKey,
    CLASSIFICATION: CLASSIFICATION,
    listClassifiedFields: listClassifiedFields,
    makeOpId: makeOpId,
    validateOp: validateOp,
    validateEnvelope: validateEnvelope,
    envelopeMeta: envelopeMeta,
    compareOps: compareOps
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncProtocol = api;
}(typeof window !== 'undefined' ? window : globalThis));
