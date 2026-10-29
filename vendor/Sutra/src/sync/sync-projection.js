/*
 * Sutra Sync projection — deterministic flat record map derived from the
 * portable workspace payload, and the inverse reassembly. Pure module.
 * The classification lives in sync-protocol.js (CLASSIFICATION); this file
 * only mechanizes it. Spec: docs/architecture/SYNC_PROTOCOL.md §3.
 */
(function (global) {
  'use strict';

  var protocolApi = (typeof module !== 'undefined' && module.exports)
    ? require('./sync-protocol.js')
    : global.SutraSyncProtocol;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function usableId(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    var id = entry.id;
    if (typeof id === 'number' && Number.isFinite(id)) id = String(id);
    if (typeof id !== 'string') return null;
    var trimmed = id.trim();
    return trimmed.length ? trimmed : null;
  }

  function restKey(field) {
    return protocolApi.atomicKey(field + '.__rest');
  }

  function isExcludedCollectionRecord(collection, entry) {
    var exclusions = protocolApi.CLASSIFICATION.excludedCollectionRecords || {};
    var rule = exclusions[collection];
    if (!rule || !entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    var entryId = String(entry.id || '');
    var entryRole = String(entry.systemRole || entry.builtInId || '');
    var excludedId = Array.isArray(rule.ids) && rule.ids.indexOf(entryId) !== -1;
    var excludedRole = Array.isArray(rule.systemRoles) && rule.systemRoles.indexOf(entryRole) !== -1;
    return (excludedId && entry.isSystemPage === true) || excludedRole;
  }

  // Record field policies (hashVolatile / localOnly) — see sync-protocol.js.
  function policyForRecordKey(recordKey) {
    var policies = protocolApi.CLASSIFICATION.recordFieldPolicies || {};
    if (Object.prototype.hasOwnProperty.call(policies, recordKey)) return policies[recordKey];
    var parsed = protocolApi.parseRecordKey(recordKey);
    if (parsed && parsed.type === 'collection') {
      var collectionScope = 'c/' + parsed.collection;
      if (Object.prototype.hasOwnProperty.call(policies, collectionScope)) return policies[collectionScope];
    }
    return null;
  }

  function stripFields(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !fields || !fields.length) return value;
    var out = clone(value);
    for (var i = 0; i < fields.length; i += 1) delete out[fields[i]];
    return out;
  }

  function stripLocalOnly(recordKey, value) {
    var policy = policyForRecordKey(recordKey);
    return policy && policy.localOnly ? stripFields(value, policy.localOnly) : value;
  }

  // The canonical record hash: localOnly fields never exist in stored
  // records, and hashVolatile fields are excluded so churn in them is not a
  // change. ALL record hashing (projection, diff baselines, merge) must go
  // through this function.
  async function hashRecord(recordKey, value) {
    var policy = policyForRecordKey(recordKey);
    var hashable = policy && policy.hashVolatile ? stripFields(value, policy.hashVolatile) : value;
    return protocolApi.hashValue(hashable);
  }

  // Splits one array collection into id-keyed records + an ordering + orphans.
  function projectCollectionArray(records, sourceArray, collection) {
    var order = [];
    var orphans = [];
    var list = Array.isArray(sourceArray) ? sourceArray : [];
    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      if (isExcludedCollectionRecord(collection, entry)) continue;
      var id = usableId(entry);
      if (id === null) {
        if (entry !== undefined && entry !== null) orphans.push(clone(entry));
        continue;
      }
      var key = protocolApi.collectionKey(collection, id);
      records[key] = stripLocalOnly(key, clone(entry));
      if (order.indexOf(id) === -1) order.push(id);
    }
    records[protocolApi.orderingKey(collection)] = order;
    return orphans;
  }

function nestedGet(object, segments) {
var node = object;
for (var i = 0; i < segments.length; i += 1) {
if (!node || typeof node !== 'object' || Array.isArray(node)
|| !Object.prototype.hasOwnProperty.call(node, segments[i])) return undefined;
node = node[segments[i]];
}
return node;
}

function stripDeviceLocalSettings(settingsValue) {
var settings = clone(settingsValue);
if (!settings || typeof settings !== 'object') return settings;
var strippedKeys = protocolApi.CLASSIFICATION.strippedSettingsKeys || [];
for (var k = 0; k < strippedKeys.length; k += 1) {
delete settings[strippedKeys[k]];
}
if (settings.preferences && typeof settings.preferences === 'object') {
var stripped = protocolApi.CLASSIFICATION.strippedSettingsPreferenceSections;
for (var i = 0; i < stripped.length; i += 1) {
delete settings.preferences[stripped[i]];
}
var subpaths = protocolApi.CLASSIFICATION.strippedSettingsPreferenceSubpaths || [];
for (var sp = 0; sp < subpaths.length; sp += 1) {
var segments = subpaths[sp].split('.');
var parent = settings.preferences;
var key = null;
var reachable = true;
for (var si = 0; si < segments.length; si += 1) {
if (si === segments.length - 1) { key = segments[si]; break; }
if (!parent || typeof parent !== 'object' || Array.isArray(parent)
|| !Object.prototype.hasOwnProperty.call(parent, segments[si])) { reachable = false; break; }
parent = parent[segments[si]];
}
if (reachable && key !== null && parent && typeof parent === 'object' && !Array.isArray(parent)) {
delete parent[key];
}
}
}
return settings;
}

  // Course attachment bytes travel through the encrypted asset channel, never
  // inside an operation/snapshot record. missingBlob is device-local material-
  // ization state; exporting it would make one device's missing bytes mark the
  // file missing everywhere.
  function stripDeviceLocalCourseFiles(courseValue) {
    var course = clone(courseValue);
    if (!course || typeof course !== 'object' || !Array.isArray(course.files)) return course;
    course.files = course.files.map(function (file) {
      if (!file || typeof file !== 'object') return file;
      var next = clone(file);
      if (next.storageType === 'indexeddb') {
        delete next._exportBlob;
        delete next.dataUrl;
        delete next.missingBlob;
      }
      return next;
    });
    return course;
  }

  function stripDeviceLocalNotificationState(notificationValue) {
    var notifications = clone(notificationValue);
    if (!notifications || typeof notifications !== 'object') return notifications;
    delete notifications.lastActiveAt;
    delete notifications.lastDigest;
    delete notifications.lastWeeklyReviewAt;
    delete notifications.lastWeeklyNudge;
    return notifications;
  }

  function prepareAtomicForSync(field, value) {
    if (field === 'settings') return stripDeviceLocalSettings(value);
    if (field === 'courseWorkspace') return stripDeviceLocalCourseFiles(value);
    if (field === 'notificationsState') return stripDeviceLocalNotificationState(value);
    return clone(value);
  }

  // workspaceJson -> { records: { recordKey -> plain value } }
  // Determinism: same logical workspace (any key order) -> identical records.
  function buildProjection(workspaceJson) {
    var workspace = workspaceJson && typeof workspaceJson === 'object' ? workspaceJson : {};
    var classification = protocolApi.CLASSIFICATION;
    var records = {};
    var i;
    var j;

    for (i = 0; i < classification.collections.length; i += 1) {
      var spec = classification.collections[i];
      var orphans = projectCollectionArray(records, workspace[spec.field], spec.collection);
      if (orphans.length) records[restKey(spec.field)] = { orphans: orphans };
    }

    for (i = 0; i < classification.nestedCollections.length; i += 1) {
      var nested = classification.nestedCollections[i];
      var section = workspace[nested.field] && typeof workspace[nested.field] === 'object'
        ? workspace[nested.field]
        : {};
      var rest = {};
      var extractedKeys = {};
      var restOrphans = [];
      for (j = 0; j < nested.parts.length; j += 1) {
        var part = nested.parts[j];
        extractedKeys[part.key] = true;
        var partOrphans = projectCollectionArray(records, section[part.key], part.collection);
        for (var p = 0; p < partOrphans.length; p += 1) restOrphans.push(partOrphans[p]);
      }
      var sectionKeys = Object.keys(section);
      for (j = 0; j < sectionKeys.length; j += 1) {
        var keyName = sectionKeys[j];
        if (!extractedKeys[keyName] && section[keyName] !== undefined) rest[keyName] = clone(section[keyName]);
      }
      if (restOrphans.length) rest.__orphans = restOrphans;
      records[restKey(nested.field)] = stripLocalOnly(restKey(nested.field), rest);
    }

    for (i = 0; i < classification.orderings.length; i += 1) {
      var orderingSpec = classification.orderings[i];
      var orderingValue = workspace[orderingSpec.field];
      records[protocolApi.orderingKey(orderingSpec.ordering)] = Array.isArray(orderingValue) ? clone(orderingValue) : [];
    }

    for (i = 0; i < classification.atomics.length; i += 1) {
      var field = classification.atomics[i];
      var value = workspace[field];
      if (value === undefined) continue; // absent sections are not records
      records[protocolApi.atomicKey(field)] = prepareAtomicForSync(field, value);
    }

    return { records: records };
  }

  async function hashProjection(projection) {
    var records = projection && projection.records ? projection.records : {};
    var keys = Object.keys(records);
    var hashes = {};
    for (var i = 0; i < keys.length; i += 1) {
      hashes[keys[i]] = await hashRecord(keys[i], records[keys[i]]);
    }
    return hashes;
  }

  function assembleCollection(recordsByKey, collection, restRecord) {
    var prefix = 'c/' + collection + '/';
    var byId = {};
    var allIds = [];
    var keys = Object.keys(recordsByKey);
    var i;
    for (i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf(prefix) !== 0) continue;
      var parsed = protocolApi.parseRecordKey(keys[i]);
      if (!parsed || parsed.type !== 'collection') continue;
      byId[parsed.id] = recordsByKey[keys[i]];
      allIds.push(parsed.id);
    }
    var order = recordsByKey[protocolApi.orderingKey(collection)];
    var result = [];
    var used = {};
    if (Array.isArray(order)) {
      for (i = 0; i < order.length; i += 1) {
        var id = String(order[i]);
        if (Object.prototype.hasOwnProperty.call(byId, id) && !used[id]) {
          used[id] = true;
          result.push(clone(byId[id]));
        }
      }
    }
    allIds.sort();
    for (i = 0; i < allIds.length; i += 1) {
      if (!used[allIds[i]]) {
        used[allIds[i]] = true;
        result.push(clone(byId[allIds[i]]));
      }
    }
    var orphans = restRecord && Array.isArray(restRecord.orphans) ? restRecord.orphans : [];
    for (i = 0; i < orphans.length; i += 1) result.push(clone(orphans[i]));
    return result;
  }

  // Generated/system records are intentionally absent from Sync records, but
  // absence in a remote projection is not a deletion instruction. Preserve
  // this device's canonical copies across snapshot bootstrap, remote apply,
  // stale delete ops/tombstones, and repeated cycles. A local system resource
  // also wins a same-id collision so remote user content cannot replace it.
  function reinjectExcludedCollectionRecords(collection, assembledArray, currentArray) {
    var assembled = Array.isArray(assembledArray) ? assembledArray : [];
    var current = Array.isArray(currentArray) ? currentArray : [];
    var preserved = [];
    var preservedIds = {};
    var i;
    for (i = 0; i < current.length; i += 1) {
      var entry = current[i];
      if (!isExcludedCollectionRecord(collection, entry)) continue;
      var id = usableId(entry);
      if (id === null || preservedIds[id]) continue;
      preservedIds[id] = true;
      preserved.push(clone(entry));
    }
    if (!preserved.length) return assembled;
    var remote = [];
    for (i = 0; i < assembled.length; i += 1) {
      var remoteId = usableId(assembled[i]);
      if (remoteId !== null && preservedIds[remoteId]) continue;
      remote.push(assembled[i]);
    }
    return preserved.concat(remote);
  }

  // Puts this device's localOnly record fields (currently Homework's local
  // revision bookkeeping) back after a remote apply.
  function reinjectLocalOnly(scopeKey, assembledArray, currentArray) {
    var policies = protocolApi.CLASSIFICATION.recordFieldPolicies || {};
    var policy = policies[scopeKey];
    if (!policy || !policy.localOnly || !Array.isArray(assembledArray)) return;
    var currentById = {};
    var list = Array.isArray(currentArray) ? currentArray : [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      var id = usableId(list[i]);
      if (id !== null) currentById[id] = list[i];
    }
    for (i = 0; i < assembledArray.length; i += 1) {
      var entry = assembledArray[i];
      var entryId = usableId(entry);
      if (entryId === null || !Object.prototype.hasOwnProperty.call(currentById, entryId)) continue;
      for (var f = 0; f < policy.localOnly.length; f += 1) {
        var field = policy.localOnly[f];
        if (currentById[entryId][field] !== undefined) entry[field] = clone(currentById[entryId][field]);
      }
    }
  }

  // (currentWorkspace, projection) -> full workspace JSON. Excluded fields
  // (version, workspaceMeta, ui, ...) pass through from currentWorkspace
  // untouched; device-local settings.preferences.sync is re-injected.
  function applyProjectionToWorkspace(currentWorkspace, projection) {
    var classification = protocolApi.CLASSIFICATION;
    var workspace = clone(currentWorkspace && typeof currentWorkspace === 'object' ? currentWorkspace : {});
    var records = projection && projection.records ? projection.records : {};
    var i;
    var j;

    for (i = 0; i < classification.collections.length; i += 1) {
      var spec = classification.collections[i];
      var assembled = assembleCollection(records, spec.collection, records[restKey(spec.field)]);
      assembled = reinjectExcludedCollectionRecords(
        spec.collection,
        assembled,
        currentWorkspace ? currentWorkspace[spec.field] : null
      );
      reinjectLocalOnly('c/' + spec.collection, assembled, currentWorkspace ? currentWorkspace[spec.field] : null);
      workspace[spec.field] = assembled;
    }

    for (i = 0; i < classification.nestedCollections.length; i += 1) {
      var nested = classification.nestedCollections[i];
      var rest = records[restKey(nested.field)];
      var section = rest && typeof rest === 'object' ? clone(rest) : {};
      delete section.__orphans;
      var currentSection = currentWorkspace && currentWorkspace[nested.field] && typeof currentWorkspace[nested.field] === 'object'
        ? currentWorkspace[nested.field]
        : null;
      // Re-inject the section's localOnly rest fields (e.g. the homework
      // store's per-device revision counter) from this device.
      var restPolicy = policyForRecordKey(restKey(nested.field));
      if (restPolicy && restPolicy.localOnly && currentSection) {
        for (j = 0; j < restPolicy.localOnly.length; j += 1) {
          var restField = restPolicy.localOnly[j];
          if (currentSection[restField] !== undefined) section[restField] = clone(currentSection[restField]);
        }
      }
      for (j = 0; j < nested.parts.length; j += 1) {
        var part = nested.parts[j];
        var partAssembled = assembleCollection(records, part.collection, null);
        reinjectLocalOnly('c/' + part.collection, partAssembled, currentSection ? currentSection[part.key] : null);
        section[part.key] = partAssembled;
      }
      workspace[nested.field] = section;
    }

    for (i = 0; i < classification.orderings.length; i += 1) {
      var orderingSpec = classification.orderings[i];
      var orderingValue = records[protocolApi.orderingKey(orderingSpec.ordering)];
      if (orderingValue !== undefined) workspace[orderingSpec.field] = clone(orderingValue);
    }

    for (i = 0; i < classification.atomics.length; i += 1) {
      var field = classification.atomics[i];
      var key = protocolApi.atomicKey(field);
      if (!Object.prototype.hasOwnProperty.call(records, key)) continue;
      var incoming = clone(records[key]);
      if (field === 'settings' && incoming && typeof incoming === 'object') {
        // Re-inject this device's stripped device-local settings so a remote
        // apply never clobbers them.
        var currentSettings = currentWorkspace && currentWorkspace.settings && typeof currentWorkspace.settings === 'object'
          ? currentWorkspace.settings
          : {};
        var strippedKeys = protocolApi.CLASSIFICATION.strippedSettingsKeys || [];
        for (var sk = 0; sk < strippedKeys.length; sk += 1) {
          if (currentSettings[strippedKeys[sk]] !== undefined) {
            incoming[strippedKeys[sk]] = clone(currentSettings[strippedKeys[sk]]);
          }
        }
        var currentSync = currentSettings.preferences ? currentSettings.preferences.sync : undefined;
        if (!incoming.preferences || typeof incoming.preferences !== 'object') incoming.preferences = {};
        if (currentSync !== undefined) incoming.preferences.sync = clone(currentSync);
        var subpaths = protocolApi.CLASSIFICATION.strippedSettingsPreferenceSubpaths || [];
        for (var sub = 0; sub < subpaths.length; sub += 1) {
          var segments = subpaths[sub].split('.');
          var currentValue = nestedGet(currentSettings.preferences, segments);
          if (currentValue === undefined) continue;
          var cursor = incoming.preferences;
          for (var seg = 0; seg < segments.length - 1; seg += 1) {
            if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) { cursor = null; break; }
            if (cursor[segments[seg]] === undefined) cursor[segments[seg]] = {};
            cursor = cursor[segments[seg]];
          }
          if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
            cursor[segments[segments.length - 1]] = clone(currentValue);
          }
        }
      }
      if (field === 'courseWorkspace' && incoming && Array.isArray(incoming.files)) {
        var currentCourse = currentWorkspace && currentWorkspace.courseWorkspace && typeof currentWorkspace.courseWorkspace === 'object'
          ? currentWorkspace.courseWorkspace
          : {};
        var currentFiles = Array.isArray(currentCourse.files) ? currentCourse.files : [];
        var currentFilesById = {};
        for (var cf = 0; cf < currentFiles.length; cf += 1) {
          if (currentFiles[cf] && currentFiles[cf].id !== undefined) currentFilesById[String(currentFiles[cf].id)] = currentFiles[cf];
        }
        for (var inf = 0; inf < incoming.files.length; inf += 1) {
          var incomingFile = incoming.files[inf];
          if (!incomingFile || incomingFile.storageType !== 'indexeddb') continue;
          delete incomingFile._exportBlob;
          delete incomingFile.dataUrl;
          var currentFile = currentFilesById[String(incomingFile.id)] || null;
          incomingFile.missingBlob = !(currentFile
            && currentFile.syncContentHash
            && currentFile.syncContentHash === incomingFile.syncContentHash
            && currentFile.missingBlob !== true);
        }
      }
      if (field === 'notificationsState' && incoming && typeof incoming === 'object') {
        var currentNotifications = currentWorkspace && currentWorkspace.notificationsState
          && typeof currentWorkspace.notificationsState === 'object'
          ? currentWorkspace.notificationsState
          : {};
        var localNotificationFields = ['lastActiveAt', 'lastDigest', 'lastWeeklyReviewAt', 'lastWeeklyNudge'];
        for (var nf = 0; nf < localNotificationFields.length; nf += 1) {
          var notificationField = localNotificationFields[nf];
          if (currentNotifications[notificationField] !== undefined) {
            incoming[notificationField] = clone(currentNotifications[notificationField]);
          }
        }
      }
      workspace[field] = incoming;
    }

    return workspace;
  }

  var api = {
    buildProjection: buildProjection,
    hashProjection: hashProjection,
    hashRecord: hashRecord,
    applyProjectionToWorkspace: applyProjectionToWorkspace
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncProjection = api;
}(typeof window !== 'undefined' ? window : globalThis));
