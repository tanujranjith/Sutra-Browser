/*
 * Sutra Sync merge — deterministic three-way merge of (baseline, local,
 * remote ops), dedicated conflict-review records for irreconcilable leaves,
 * and tombstone bookkeeping. Pure module.
 * Spec: docs/architecture/SYNC_PROTOCOL.md §6.
 *
 * Determinism contract: every decision is a pure function of the record
 * values and the competing ops' (lamport, deviceId) order — never wall
 * clock — so two devices merging the same inputs in either direction
 * produce identical results (including identical conflict-review ids).
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var protocolApi = isNode ? require('./sync-protocol.js') : global.SutraSyncProtocol;
  var projectionApi = isNode ? require('./sync-projection.js') : global.SutraSyncProjection;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function has(map, key) {
    return !!map && Object.prototype.hasOwnProperty.call(map, key);
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function sameRawValue(a, b) {
    return protocolApi.stableStringify(a) === protocolApi.stableStringify(b);
  }

  // Opaque, deterministic audit reference for an op. The raw opId encodes
  // the originating device identity (<deviceId>:<lamport>); conflict
  // resolution records sync to every device, so they carry only a content
  // hash of that id — never the id itself. Same input -> same ref, so
  // resolution markers stay stable across devices and retries.
  async function auditRefFor(op) {
    return op && op.opId ? await protocolApi.hashText(String(op.opId)) : null;
  }

  function deterministicEquivalentValue(a, b) {
    var aText = protocolApi.stableStringify(a);
    var bText = protocolApi.stableStringify(b);
    return clone(aText <= bText ? a : b);
  }

  function leafName(path) {
    var value = String(path || '');
    var dot = value.lastIndexOf('.');
    return dot === -1 ? value.replace(/^\$/, '') : value.slice(dot + 1);
  }

  function normalizeStyleAttribute(value) {
    return String(value || '').split(';').map(function (entry) { return entry.trim(); })
      .filter(Boolean).sort().join(';');
  }

  function normalizeClassAttribute(value) {
    return String(value || '').split(/\s+/).filter(Boolean).sort().join(' ');
  }

  // A comparison-only HTML canonicalizer. It never rewrites stored user
  // content; it merely prevents harmless browser serialization differences
  // (attribute order, inter-tag whitespace, equivalent empty paragraphs)
  // from being mistaken for concurrent authorship.
  function canonicalizeHtml(value) {
    var html = String(value === null || value === undefined ? '' : value)
      .replace(/\r\n?/g, '\n').trim();
    if (!html) return '';
    html = html.replace(/<([A-Za-z][\w:-]*)(\s[^<>]*?)?(\/?)>/g,
      function (full, rawTag, rawAttrs, slash) {
        var tag = String(rawTag || '').toLowerCase();
        var attrs = [];
        var source = String(rawAttrs || '');
        var re = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        var match;
        while ((match = re.exec(source))) {
          var name = String(match[1] || '').toLowerCase();
          var attrValue = match[2] !== undefined ? match[2]
            : (match[3] !== undefined ? match[3] : match[4]);
          if (attrValue !== undefined) {
            if (name === 'class') attrValue = normalizeClassAttribute(attrValue);
            if (name === 'style') attrValue = normalizeStyleAttribute(attrValue);
            attrs.push(name + '=' + JSON.stringify(String(attrValue)));
          } else {
            attrs.push(name);
          }
        }
        attrs.sort();
        return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + (slash ? '/' : '') + '>';
      });
    html = html.replace(/<\/([A-Za-z][\w:-]*)\s*>/g, function (full, tag) {
      return '</' + String(tag).toLowerCase() + '>';
    });
    html = html.replace(/>\s+</g, '><');
    html = html.replace(/<(p|div)([^>]*)>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/\1>/gi,
      function (full, tag, attrs) { return '<' + String(tag).toLowerCase() + String(attrs || '') + '></' + String(tag).toLowerCase() + '>'; });
    return html.trim();
  }

  function isHtmlPath(path) {
    var leaf = leafName(path);
    return leaf === 'content' || leaf === 'body';
  }

  function versionSemanticSignature(entry) {
    if (!entry || typeof entry !== 'object') return protocolApi.stableStringify(entry);
    return protocolApi.stableStringify({
      label: typeof entry.label === 'string' ? entry.label : '',
      state: entry.state && typeof entry.state === 'object' ? entry.state : {}
    });
  }

  function semanticVersionList(value) {
    if (!Array.isArray(value)) return value;
    return value.map(versionSemanticSignature).sort();
  }

  function semanticValue(path, value) {
    var leaf = leafName(path);
    if (isHtmlPath(path) && typeof value === 'string') return canonicalizeHtml(value);
    if (leaf === 'versions' && Array.isArray(value)) return semanticVersionList(value);
    if (leaf === 'tags' && Array.isArray(value)) {
      return value.map(function (tag) {
        if (tag && typeof tag === 'object') {
          return { name: String(tag.name || '').trim().toLowerCase(), color: String(tag.color || '') };
        }
        return String(tag || '').trim().toLowerCase();
      }).sort(function (a, b) { return protocolApi.stableStringify(a).localeCompare(protocolApi.stableStringify(b)); });
    }
    return value;
  }

  function sameValue(a, b, path) {
    return protocolApi.stableStringify(semanticValue(path, a))
      === protocolApi.stableStringify(semanticValue(path, b));
  }

  var VOID_HTML_TAGS = {
    area: true, base: true, br: true, col: true, embed: true, hr: true,
    img: true, input: true, link: true, meta: true, param: true,
    source: true, track: true, wbr: true
  };

  // Split editor HTML into top-level document blocks without introducing a
  // browser/DOM dependency into the pure sync engine. Invalid or ambiguous
  // markup returns null and therefore falls back to explicit conflict review.
  function splitTopLevelHtml(value) {
    var html = String(value === null || value === undefined ? '' : value);
    if (!html.trim()) return [];
    var tokens = [];
    var re = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
    var depth = 0;
    var blockStart = null;
    var cursor = 0;
    var match;
    while ((match = re.exec(html))) {
      if (depth === 0 && blockStart === null && match.index > cursor) {
        var text = html.slice(cursor, match.index);
        if (text.trim()) tokens.push({ raw: text, norm: canonicalizeHtml(text) });
      }
      var raw = match[0];
      if (raw.indexOf('<!--') === 0) {
        if (depth === 0) tokens.push({ raw: raw, norm: raw });
        cursor = re.lastIndex;
        continue;
      }
      var closing = /^<\//.test(raw);
      var tagMatch = raw.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
      if (!tagMatch) return null;
      var tag = tagMatch[1].toLowerCase();
      var selfClosing = /\/\s*>$/.test(raw) || VOID_HTML_TAGS[tag] === true;
      if (closing) {
        if (depth <= 0 || blockStart === null) return null;
        depth -= 1;
        if (depth === 0) {
          var block = html.slice(blockStart, re.lastIndex);
          tokens.push({ raw: block, norm: canonicalizeHtml(block) });
          blockStart = null;
        }
      } else if (selfClosing) {
        if (depth === 0) tokens.push({ raw: raw, norm: canonicalizeHtml(raw) });
      } else {
        if (depth === 0) blockStart = match.index;
        depth += 1;
      }
      cursor = re.lastIndex;
    }
    if (depth !== 0 || blockStart !== null) return null;
    if (cursor < html.length) {
      var tail = html.slice(cursor);
      if (tail.trim()) tokens.push({ raw: tail, norm: canonicalizeHtml(tail) });
    }
    return tokens;
  }

  function sequenceEdits(baseBlocks, variantBlocks) {
    var n = baseBlocks.length;
    var m = variantBlocks.length;
    var dp = new Array(n + 1);
    var i;
    var j;
    for (i = 0; i <= n; i += 1) dp[i] = new Array(m + 1).fill(0);
    for (i = n - 1; i >= 0; i -= 1) {
      for (j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = baseBlocks[i].norm === variantBlocks[j].norm
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var matches = [];
    i = 0;
    j = 0;
    while (i < n && j < m) {
      if (baseBlocks[i].norm === variantBlocks[j].norm) {
        matches.push([i, j]); i += 1; j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
      else j += 1;
    }
    matches.push([n, m]);
    var edits = [];
    var baseCursor = 0;
    var variantCursor = 0;
    for (i = 0; i < matches.length; i += 1) {
      var baseAt = matches[i][0];
      var variantAt = matches[i][1];
      if (baseCursor !== baseAt || variantCursor !== variantAt) {
        edits.push({
          start: baseCursor,
          end: baseAt,
          replacement: variantBlocks.slice(variantCursor, variantAt)
        });
      }
      baseCursor = baseAt + 1;
      variantCursor = variantAt + 1;
    }
    return edits;
  }

  function sameReplacement(a, b) {
    return protocolApi.stableStringify((a || []).map(function (entry) { return entry.norm; }))
      === protocolApi.stableStringify((b || []).map(function (entry) { return entry.norm; }));
  }

  function editsOverlap(a, b) {
    var aInsert = a.start === a.end;
    var bInsert = b.start === b.end;
    if (aInsert && bInsert) return false;
    if (aInsert) return a.start > b.start && a.start < b.end;
    if (bInsert) return b.start > a.start && b.start < a.end;
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
  }

  function mergeHtmlThreeWay(baseValue, localValue, remoteValue, localWins) {
    var baseBlocks = splitTopLevelHtml(baseValue);
    var localBlocks = splitTopLevelHtml(localValue);
    var remoteBlocks = splitTopLevelHtml(remoteValue);
    if (!baseBlocks || !localBlocks || !remoteBlocks) return null;
    var localEdits = sequenceEdits(baseBlocks, localBlocks).map(function (edit) {
      edit.source = 'local'; edit.rank = localWins ? 0 : 1; return edit;
    });
    var remoteEdits = sequenceEdits(baseBlocks, remoteBlocks).map(function (edit) {
      edit.source = 'remote'; edit.rank = localWins ? 1 : 0; return edit;
    });
    var skippedRemote = {};
    for (var i = 0; i < localEdits.length; i += 1) {
      for (var j = 0; j < remoteEdits.length; j += 1) {
        var localEdit = localEdits[i];
        var remoteEdit = remoteEdits[j];
        if (localEdit.start === remoteEdit.start && localEdit.end === remoteEdit.end
          && sameReplacement(localEdit.replacement, remoteEdit.replacement)) {
          skippedRemote[j] = true;
          continue;
        }
        if (editsOverlap(localEdit, remoteEdit)) return null;
      }
    }
    var edits = localEdits.concat(remoteEdits.filter(function (edit, index) { return !skippedRemote[index]; }));
    edits.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.source.localeCompare(b.source);
    });
    var output = [];
    var cursor = 0;
    for (i = 0; i < edits.length; i += 1) {
      var edit = edits[i];
      for (; cursor < edit.start; cursor += 1) output.push(baseBlocks[cursor].raw);
      for (j = 0; j < edit.replacement.length; j += 1) output.push(edit.replacement[j].raw);
      if (edit.end > cursor) cursor = edit.end;
    }
    for (; cursor < baseBlocks.length; cursor += 1) output.push(baseBlocks[cursor].raw);
    return output.join('');
  }

  function mergeVersionArrays(baseValue, localValue, remoteValue) {
    var candidates = [];
    [baseValue, localValue, remoteValue].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (entry) { candidates.push(clone(entry)); });
    });
    var bySignature = {};
    candidates.forEach(function (entry) {
      var signature = versionSemanticSignature(entry);
      if (!has(bySignature, signature)
        || protocolApi.stableStringify(entry) < protocolApi.stableStringify(bySignature[signature])) {
        bySignature[signature] = entry;
      }
    });
    return Object.keys(bySignature).map(function (signature) { return bySignature[signature]; })
      .sort(function (a, b) {
        var stamp = String(a && a.savedAt || '').localeCompare(String(b && b.savedAt || ''));
        if (stamp) return stamp;
        return versionSemanticSignature(a).localeCompare(versionSemanticSignature(b));
      }).slice(-20);
  }

  function arrayKeyForPath(path, entry) {
    var leaf = leafName(path);
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (entry.id !== undefined && entry.id !== null && String(entry.id)) return 'id:' + String(entry.id);
      if (leaf === 'tags' && entry.name) return 'tag:' + String(entry.name).trim().toLowerCase();
      if (entry.hash) return 'hash:' + String(entry.hash);
      if (entry.contentHash) return 'hash:' + String(entry.contentHash);
    }
    if (entry === null || typeof entry !== 'object') return 'value:' + protocolApi.stableStringify(entry);
    return null;
  }

  function canKeyArray(path, value) {
    if (!Array.isArray(value)) return false;
    for (var i = 0; i < value.length; i += 1) {
      if (arrayKeyForPath(path, value[i]) === null) return false;
    }
    return true;
  }

  function orderedArrayKeys(path, value) {
    return (Array.isArray(value) ? value : []).map(function (entry) { return arrayKeyForPath(path, entry); });
  }

  function mergeArrayOrder(path, baseValue, localValue, remoteValue, localWins) {
    var baseKeys = orderedArrayKeys(path, baseValue);
    var localKeys = orderedArrayKeys(path, localValue);
    var remoteKeys = orderedArrayKeys(path, remoteValue);
    var present = {};
    var baseSet = {};
    var localSet = {};
    var remoteSet = {};
    baseKeys.forEach(function (key) { baseSet[key] = true; });
    localKeys.forEach(function (key) { localSet[key] = true; });
    remoteKeys.forEach(function (key) { remoteSet[key] = true; });
    Object.keys(baseSet).forEach(function (key) {
      if (localSet[key] && remoteSet[key]) present[key] = true;
    });
    Object.keys(localSet).concat(Object.keys(remoteSet)).forEach(function (key) {
      if (!baseSet[key] && (localSet[key] || remoteSet[key])) present[key] = true;
    });
    var winner = localWins ? localKeys : remoteKeys;
    var loser = localWins ? remoteKeys : localKeys;
    var result = [];
    winner.concat(loser).forEach(function (key) {
      if (present[key] && result.indexOf(key) === -1) result.push(key);
    });
    Object.keys(present).sort().forEach(function (key) {
      if (result.indexOf(key) === -1) result.push(key);
    });
    return result;
  }

  function mergeKeyedArray(baseValue, localValue, remoteValue, path, localWins, context) {
    var lists = [baseValue, localValue, remoteValue].map(function (value) { return Array.isArray(value) ? value : []; });
    var maps = [{}, {}, {}];
    var keys = {};
    for (var listIndex = 0; listIndex < lists.length; listIndex += 1) {
      for (var i = 0; i < lists[listIndex].length; i += 1) {
        var key = arrayKeyForPath(path, lists[listIndex][i]);
        if (key === null) return null;
        maps[listIndex][key] = lists[listIndex][i];
        keys[key] = true;
      }
    }
    var values = {};
    var conflicts = [];
    Object.keys(keys).sort().forEach(function (key) {
      var child = mergeJsonValue(maps[0][key], maps[1][key], maps[2][key],
        path + '[' + key + ']', localWins, null, context);
      if (child.value !== undefined) values[key] = child.value;
      conflicts = conflicts.concat(child.conflicts);
    });
    var order = mergeArrayOrder(path, lists[0], lists[1], lists[2], localWins);
    var output = [];
    order.forEach(function (key) { if (has(values, key)) output.push(values[key]); });
    Object.keys(values).sort().forEach(function (key) {
      if (order.indexOf(key) === -1) output.push(values[key]);
    });
    return { value: output, conflicts: conflicts };
  }

  function isTimestampLeaf(leaf) {
    return /(?:^|_)(?:createdAt|updatedAt|modifiedAt|savedAt|lastSeenAt|lastOpenedAt|lockedAt)$/i.test(leaf)
      || /(?:created|updated|modified|saved|seen|opened|locked)At$/.test(leaf);
  }

  function mergeTimestampValue(leaf, localValue, remoteValue) {
    var localNumber = typeof localValue === 'number' ? localValue : Date.parse(String(localValue || ''));
    var remoteNumber = typeof remoteValue === 'number' ? remoteValue : Date.parse(String(remoteValue || ''));
    if (!Number.isFinite(localNumber)) return clone(remoteValue);
    if (!Number.isFinite(remoteNumber)) return clone(localValue);
    var chooseEarlier = /^createdAt$/i.test(leaf);
    return clone((chooseEarlier ? localNumber <= remoteNumber : localNumber >= remoteNumber) ? localValue : remoteValue);
  }

  function isPageLowRiskField(leaf) {
    return [
      'updatedAt', 'createdAt', 'collapsed', 'spaceId', 'parentId', 'folderId',
      'icon', 'theme', 'type', 'isTemporary', 'temporaryCreatedAt',
      'temporaryExpiresAt', 'isLocked', 'lockHash', 'lockSalt', 'lockedAt',
      'lockAutoLock', 'lockDuressVerifier', 'isSystemPage', 'builtInId', 'systemRole'
    ].indexOf(leaf) !== -1;
  }

  function isSetLikeArrayPath(path) {
    var leaf = leafName(path);
    return leaf === 'tags' || leaf === 'links' || /(?:Ids|Refs|Hashes)$/.test(leaf);
  }

  function mergePrimitiveSet(baseValue, localValue, remoteValue, path, localWins) {
    var keyed = mergeKeyedArray(baseValue, localValue, remoteValue, path, localWins, {});
    return keyed || { value: clone(localWins ? localValue : remoteValue), conflicts: [] };
  }

  function fieldConflict(path, localValue, remoteValue, reason) {
    return {
      path: path || '$',
      reason: reason || 'overlapping-change',
      localValue: clone(localValue),
      remoteValue: clone(remoteValue)
    };
  }

  // Recursive, field-aware three-way merge. Independent edits combine;
  // semantic equality suppresses browser-only churn; top-level rich-text
  // blocks merge when their changed ranges do not overlap. Only a genuinely
  // overlapping user-content leaf is retained as an unresolved conflict.
  function mergeJsonValue(baseValue, localValue, remoteValue, path, localWins, ignoredKeys, context) {
    var mergeContext = context || {};
    if (sameValue(localValue, remoteValue, path)) {
      return { value: deterministicEquivalentValue(localValue, remoteValue), conflicts: [] };
    }
    if (sameValue(localValue, baseValue, path)) return { value: clone(remoteValue), conflicts: [] };
    if (sameValue(remoteValue, baseValue, path)) return { value: clone(localValue), conflicts: [] };

    var leaf = leafName(path);
    if (leaf === 'versions' && Array.isArray(localValue) && Array.isArray(remoteValue)) {
      return { value: mergeVersionArrays(baseValue, localValue, remoteValue), conflicts: [] };
    }

    if (mergeContext.isOrdering && Array.isArray(localValue) && Array.isArray(remoteValue)) {
      var orderPath = path || '$';
      var primitiveBase = (Array.isArray(baseValue) ? baseValue : []).map(String);
      var primitiveLocal = localValue.map(String);
      var primitiveRemote = remoteValue.map(String);
      var orderingValues = {};
      primitiveBase.concat(primitiveLocal, primitiveRemote).forEach(function (entry) {
        orderingValues[arrayKeyForPath(orderPath, entry)] = entry;
      });
      return {
        value: mergeArrayOrder(orderPath, primitiveBase, primitiveLocal, primitiveRemote, localWins)
          .map(function (key) { return orderingValues[key]; }),
        conflicts: []
      };
    }

    if (Array.isArray(localValue) && Array.isArray(remoteValue)
      && canKeyArray(path, localValue) && canKeyArray(path, remoteValue)
      && (baseValue === undefined || canKeyArray(path, baseValue))) {
      var keyedMerge = mergeKeyedArray(baseValue, localValue, remoteValue, path, localWins, mergeContext);
      if (keyedMerge) return keyedMerge;
    }

    if (Array.isArray(localValue) && Array.isArray(remoteValue) && isSetLikeArrayPath(path)) {
      return mergePrimitiveSet(baseValue, localValue, remoteValue, path, localWins);
    }

    if (mergeContext.isPage && isHtmlPath(path)
      && typeof localValue === 'string' && typeof remoteValue === 'string'
      && (baseValue === undefined || typeof baseValue === 'string')) {
      var htmlMerge = mergeHtmlThreeWay(String(baseValue || ''), localValue, remoteValue, localWins);
      if (htmlMerge !== null) return { value: htmlMerge, conflicts: [] };
      return {
        value: clone(localWins ? localValue : remoteValue),
        conflicts: [fieldConflict(path, localValue, remoteValue, 'overlapping-rich-text')]
      };
    }

    if (isTimestampLeaf(leaf)) {
      return { value: mergeTimestampValue(leaf, localValue, remoteValue), conflicts: [] };
    }

    if (mergeContext.isPage && isPageLowRiskField(leaf)) {
      return { value: clone(localWins ? localValue : remoteValue), conflicts: [] };
    }

    if (isPlainObject(localValue) && isPlainObject(remoteValue)
      && (baseValue === undefined || isPlainObject(baseValue))) {
      var baseObject = isPlainObject(baseValue) ? baseValue : {};
      var keys = {};
      Object.keys(baseObject).forEach(function (key) { keys[key] = true; });
      Object.keys(localValue).forEach(function (key) { keys[key] = true; });
      Object.keys(remoteValue).forEach(function (key) { keys[key] = true; });
      var output = {};
      var conflicts = [];
      Object.keys(keys).sort().forEach(function (key) {
        if (ignoredKeys && ignoredKeys[key]) {
          var ignored = localWins ? localValue[key] : remoteValue[key];
          if (ignored !== undefined) output[key] = clone(ignored);
          return;
        }
        var child = mergeJsonValue(baseObject[key], localValue[key], remoteValue[key],
          path ? path + '.' + key : key, localWins, null, mergeContext);
        if (child.value !== undefined) output[key] = child.value;
        conflicts = conflicts.concat(child.conflicts);
      });
      return { value: output, conflicts: conflicts };
    }

    return {
      value: clone(localWins ? localValue : remoteValue),
      conflicts: [fieldConflict(path, localValue, remoteValue)]
    };
  }

  // Applies remote ops over the baseline → the server's head state as this
  // client can know it. A direct baseHash → hash link is a causal edge and
  // always beats numeric ordering: this matters when an older client failed
  // to raise its Lamport counter after observing another device. Truly
  // concurrent same-key ops use authenticated (lamport, deviceId) order —
  // never server arrival time — so replay order cannot change the winner.
  function shouldReplaceAppliedOp(candidate, prior) {
    if (!prior) return true;
    if (candidate.opId && prior.opId && candidate.opId === prior.opId) return false;
    if (candidate.baseHash !== null && candidate.baseHash !== undefined
      && candidate.baseHash === prior.hash) return true;
    if (prior.baseHash !== null && prior.baseHash !== undefined
      && prior.baseHash === candidate.hash) return false;
    return protocolApi.compareOps(candidate, prior) >= 0;
  }

  function applyOpsToRecords(baseRecords, ops) {
    var records = clone(baseRecords || {});
    var lastOpByKey = {};
    var list = Array.isArray(ops) ? ops : [];
    for (var i = 0; i < list.length; i += 1) {
      var op = list[i];
      if (!op || !op.recordKey) continue;
      var prior = lastOpByKey[op.recordKey];
      if (!shouldReplaceAppliedOp(op, prior)) continue;
      if (op.kind === 'delete') {
        delete records[op.recordKey];
      } else {
        records[op.recordKey] = clone(op.payload);
      }
      lastOpByKey[op.recordKey] = op;
    }
    return { records: records, lastOpByKey: lastOpByKey };
  }

  async function makeConflictId(recordKey, localOp, remoteOp, baseHash, fieldConflicts) {
    var opIds = [
      localOp && localOp.opId ? String(localOp.opId) : '',
      remoteOp && remoteOp.opId ? String(remoteOp.opId) : ''
    ].filter(Boolean).sort();
    var paths = (Array.isArray(fieldConflicts) ? fieldConflicts : [])
      .map(function (entry) { return String(entry && entry.path || '$'); }).sort();
    var material = protocolApi.stableStringify({
      recordKey: String(recordKey || ''),
      opIds: opIds,
      baseHash: baseHash || null,
      paths: paths
    });
    return 'sync-conflict-' + (await protocolApi.hashText(material)).slice(0, 24);
  }

  function stripLegacyConflictTitle(value) {
    return String(value || '')
      .replace(/\s*\(conflict copy(?:\s*[—-][^)]*)?\)\s*$/i, '')
      .trim();
  }

  function isLegacyConflictPage(page) {
    if (!page || typeof page !== 'object') return false;
    return /^conflict-/.test(String(page.id || ''))
      || /\(conflict copy(?:\s*[—-][^)]*)?\)\s*$/i.test(String(page.title || ''));
  }

  function pageSemanticForCleanup(page) {
    var value = clone(page || {});
    delete value.id;
    delete value.createdAt;
    delete value.updatedAt;
    value.title = stripLegacyConflictTitle(value.title);
    if (typeof value.content === 'string') value.content = canonicalizeHtml(value.content);
    if (typeof value.body === 'string') value.body = canonicalizeHtml(value.body);
    if (Array.isArray(value.versions)) value.versions = semanticVersionList(value.versions);
    return value;
  }

  function pageCleanupCore(page) {
    var value = pageSemanticForCleanup(page);
    delete value.versions;
    return value;
  }

  function versionHistoryIsSubset(copyPage, originalPage) {
    var copyVersions = semanticVersionList(Array.isArray(copyPage && copyPage.versions) ? copyPage.versions : []);
    var originalVersions = semanticVersionList(Array.isArray(originalPage && originalPage.versions) ? originalPage.versions : []);
    var originalSet = {};
    originalVersions.forEach(function (signature) { originalSet[signature] = true; });
    return copyVersions.every(function (signature) { return originalSet[signature] === true; });
  }

  function htmlTextForContainment(value) {
    return canonicalizeHtml(value).replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ').trim();
  }

  // Conservative audit for pages generated by the old sidebar-copy merge.
  // It never mutates data. Only exact semantic duplicates with no descendants
  // are eligible for automated consolidation; unique/ambiguous content stays.
  function analyzeLegacyConflictCopies(workspace, conflictRows) {
    var pages = workspace && Array.isArray(workspace.pages) ? workspace.pages : [];
    var rows = Array.isArray(conflictRows) ? conflictRows : [];
    var rowByCopyId = {};
    rows.forEach(function (row) {
      if (row && row.copyId) rowByCopyId[String(row.copyId)] = row;
    });
    var pageById = {};
    pages.forEach(function (page) { if (page && page.id) pageById[String(page.id)] = page; });
    var items = [];
    var seenSignatureByOriginal = {};
    pages.filter(isLegacyConflictPage).forEach(function (copyPage) {
      var copyId = String(copyPage.id || '');
      var row = rowByCopyId[copyId] || null;
      var original = null;
      if (row && row.recordKey) {
        var parsed = protocolApi.parseRecordKey(row.recordKey);
        if (parsed && parsed.collection === 'pages') original = pageById[String(parsed.id)] || null;
      }
      var baseTitle = stripLegacyConflictTitle(copyPage.title);
      var candidates = pages.filter(function (page) {
        return page !== copyPage && !isLegacyConflictPage(page)
          && String(page.spaceId || 'default') === String(copyPage.spaceId || 'default')
          && String(page.title || '') === baseTitle;
      });
      if (!original && candidates.length === 1) original = candidates[0];
      var hasChildren = pages.some(function (page) {
        return page !== copyPage && String(page.title || '').indexOf(String(copyPage.title || '') + '::') === 0;
      });
      var recursive = /^conflict-conflict-/.test(copyId)
        || (String(copyPage.title || '').match(/\(conflict copy/g) || []).length > 1;
      var classification = 'ambiguous';
      var signature = protocolApi.stableStringify(pageSemanticForCleanup(copyPage));
      if (original && !hasChildren) {
        var copyCoreSignature = protocolApi.stableStringify(pageCleanupCore(copyPage));
        var originalCoreSignature = protocolApi.stableStringify(pageCleanupCore(original));
        if (copyCoreSignature === originalCoreSignature && versionHistoryIsSubset(copyPage, original)) {
          classification = 'exact-duplicate';
        }
        else {
          var copyText = htmlTextForContainment(copyPage.content || copyPage.body || '');
          var originalText = htmlTextForContainment(original.content || original.body || '');
          if (copyText && originalText && originalText.indexOf(copyText) !== -1) classification = 'contained';
          else classification = 'unique';
        }
      }
      var originalId = original && String(original.id || '');
      var duplicateKey = originalId ? originalId + '|' + signature : '';
      if (duplicateKey && seenSignatureByOriginal[duplicateKey]) classification = 'duplicate-artifact';
      if (duplicateKey) seenSignatureByOriginal[duplicateKey] = copyId;
      items.push({
        copyId: copyId,
        originalId: originalId || null,
        classification: classification,
        recursive: recursive,
        hasChildren: hasChildren,
        reviewEligible: !!originalId && !hasChildren
          && (classification === 'unique' || classification === 'contained'),
        safeToConsolidate: !hasChildren && (classification === 'exact-duplicate' || classification === 'duplicate-artifact')
      });
    });
    var counts = { total: items.length, exact: 0, contained: 0, unique: 0, recursive: 0, ambiguous: 0, safe: 0, review: 0 };
    items.forEach(function (item) {
      if (item.classification === 'exact-duplicate' || item.classification === 'duplicate-artifact') counts.exact += 1;
      else if (item.classification === 'contained') counts.contained += 1;
      else if (item.classification === 'unique') counts.unique += 1;
      else counts.ambiguous += 1;
      if (item.recursive) counts.recursive += 1;
      if (item.safeToConsolidate) counts.safe += 1;
      if (item.reviewEligible) counts.review += 1;
    });
    return { items: items, counts: counts };
  }

  function consolidateExactLegacyConflictCopies(workspace, analysis) {
    var source = clone(workspace || {});
    var result = analysis && Array.isArray(analysis.items)
      ? analysis
      : analyzeLegacyConflictCopies(source, []);
    var removable = {};
    result.items.forEach(function (item) {
      if (item && item.safeToConsolidate && !item.hasChildren) removable[String(item.copyId)] = true;
    });
    source.pages = (Array.isArray(source.pages) ? source.pages : []).filter(function (page) {
      return !(page && removable[String(page.id || '')]);
    });
    return { workspace: source, removedIds: Object.keys(removable).sort() };
  }

  /*
   * merge(options) ->
   *   {
   *     mergedRecords,          // the state this device should now show
   *     remoteRecords,          // baseline + remote ops = new pre-push baseline
   *     remoteHashes,           // hashes of remoteRecords
   *     conflicts,              // UI-facing conflict descriptors
   *     tombstones,             // updated tombstone map
   *     stats
   *   }
   *
   * options: {
   *   baseRecords, baseHashes,        // acknowledged baseline
   *   localRecords, localHashes,      // current local projection
   *   remoteOps,                      // decrypted pulled ops, server order
   *   localOps,                       // fresh outbox (diff vs baseline) — the
   *                                   //   lamport identities for local edits
   *   tombstones,                     // { recordKey: { deletedAt, opId } }
   *   ownDeviceId,                    // this device's id: pulled-back own ops
   *                                   //   (push acked but ack lost) are treated
   *                                   //   as remote-UNchanged so a device never
   *                                   //   conflicts with its own older edit
   *   now                             // ms timestamp (injected, bookkeeping only)
   * }
   */
  async function merge(options) {
    var config = options || {};
    var baseRecords = config.baseRecords || {};
    var baseHashes = config.baseHashes || {};
    var localRecords = config.localRecords || {};
    var localHashes = config.localHashes || {};
    var now = Number(config.now) || 0;

    // Normally the remote head = acknowledged baseline + pulled ops. During a
    // new-device bootstrap the remote head = decrypted compaction SNAPSHOT +
    // ops after its cursor, while the acknowledged baseline stays empty — so
    // snapshot records read as "remote-changed" (pulled in) and local-only
    // records read as "local-changed" (pushed out): a union merge, never a
    // diff-delete of the vault.
    var remoteBaseRecords = config.remoteBaseRecords || baseRecords;
    var usingSeparateRemoteBase = config.remoteBaseRecords !== undefined && config.remoteBaseRecords !== null;
    var remote = applyOpsToRecords(remoteBaseRecords, config.remoteOps);
    var remoteRecords = remote.records;
    var remoteOpByKey = remote.lastOpByKey;

    var remoteHashes = {};
    var remoteKeys = Object.keys(remoteRecords);
    var i;
    for (i = 0; i < remoteKeys.length; i += 1) {
      var rKey = remoteKeys[i];
      // Reuse the baseline hash when the record is untouched by remote ops.
      // Fresh hashes go through the policy-aware record hash (hashVolatile
      // fields excluded) so churny metadata never looks like a change.
      remoteHashes[rKey] = (!usingSeparateRemoteBase && !has(remoteOpByKey, rKey) && has(baseHashes, rKey))
        ? baseHashes[rKey]
        : await projectionApi.hashRecord(rKey, remoteRecords[rKey]);
    }

    var localOpByKey = {};
    var localOpsList = Array.isArray(config.localOps) ? config.localOps : [];
    for (i = 0; i < localOpsList.length; i += 1) {
      if (localOpsList[i] && localOpsList[i].recordKey) localOpByKey[localOpsList[i].recordKey] = localOpsList[i];
    }

    var tombstones = clone(config.tombstones || {});
    var merged = {};
    var conflicts = [];
    var stats = { tookLocal: 0, tookRemote: 0, converged: 0, conflicted: 0, deleted: 0, resurrected: 0 };
    // A device with NO acknowledged baseline is joining the vault: every one
    // of its sections reads as "changed" even when it is an unedited boot
    // default, and letting those LWW-race the vault's established atomic
    // sections can wipe real vault data (which section wins would depend on
    // lamport noise). During a join, the vault's atomic/ordering records win
    // deterministically; per-record collections still union below.
    var isBootstrapJoin = Object.keys(baseHashes).length === 0;

    var union = {};
    Object.keys(baseRecords).forEach(function (key) { union[key] = true; });
    Object.keys(localRecords).forEach(function (key) { union[key] = true; });
    Object.keys(remoteRecords).forEach(function (key) { union[key] = true; });
    var keys = Object.keys(union).sort();

    for (i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var inBase = has(baseHashes, key);
      var inLocal = has(localHashes, key);
      var inRemote = has(remoteHashes, key);
      var baseHash = inBase ? baseHashes[key] : null;
      var localHash = inLocal ? localHashes[key] : null;
      var remoteHash = inRemote ? remoteHashes[key] : null;
      var localChanged = localHash !== baseHash;
      var remoteChanged = remoteHash !== baseHash;
      // A pulled-back op from THIS device is an echo of an earlier local
      // state (retried push, lost ack). Local state is authoritative for our
      // own edits: treat the key as remote-unchanged so the normal local
      // rules decide, while remoteRecords still advances the baseline.
      if (remoteChanged && config.ownDeviceId && has(remoteOpByKey, key)
        && remoteOpByKey[key].deviceId === config.ownDeviceId) {
        if (localChanged) {
          remoteChanged = false;
        } else if (localHash === remoteHash) {
          // Local already reflects our own pulled-back op.
          remoteChanged = false;
        }
        // If local reverted below our own remote op (localHash === baseHash
        // but remote differs), fall through: local-authoritative means the
        // revert should win, which the (localChanged=false, remoteChanged
        // =true→false) path would get wrong — so force the local value.
        if (!localChanged && localHash !== remoteHash) {
          if (inLocal) merged[key] = clone(localRecords[key]);
          stats.tookLocal += 1;
          continue;
        }
      }

      if (!localChanged && !remoteChanged) {
        if (inBase) merged[key] = clone(baseRecords[key]);
        continue;
      }
      if (localChanged && !remoteChanged) {
        if (inLocal) { merged[key] = clone(localRecords[key]); stats.tookLocal += 1; }
        else {
          // Local delete of a remotely-unchanged record.
          var localDeleteOp = localOpByKey[key] || null;
          tombstones[key] = { deletedAt: now, opId: localDeleteOp ? localDeleteOp.opId : null };
          stats.deleted += 1;
        }
        continue;
      }
      if (!localChanged && remoteChanged) {
        // A record arriving purely from the snapshot remote-base (no op) that
        // this device has a live tombstone for was deleted here after the
        // snapshot was taken — do not resurrect it from stale snapshot data.
        if (inRemote && usingSeparateRemoteBase && !has(remoteOpByKey, key)
          && tombstones[key] && Number(tombstones[key].deletedAt) > 0) {
          stats.deleted += 1;
          continue;
        }
        if (inRemote) { merged[key] = clone(remoteRecords[key]); stats.tookRemote += 1; }
        else {
          var remoteDeleteOp = remoteOpByKey[key] || null;
          tombstones[key] = { deletedAt: now, opId: remoteDeleteOp ? remoteDeleteOp.opId : null };
          stats.deleted += 1;
        }
        continue;
      }

      // Both sides changed.
      if (!inLocal && !inRemote) {
        // Deleted on both sides.
        var eitherOp = remoteOpByKey[key] || localOpByKey[key] || null;
        tombstones[key] = { deletedAt: now, opId: eitherOp ? eitherOp.opId : null };
        stats.deleted += 1;
        continue;
      }
      if (!inLocal && inRemote) {
        // Local delete vs remote edit: the EDIT wins, record resurrects.
        merged[key] = clone(remoteRecords[key]);
        delete tombstones[key];
        stats.resurrected += 1;
        var localDelete = localOpByKey[key] || null;
        var remoteEdit = remoteOpByKey[key] || null;
        var localDeleteFields = [fieldConflict('$', undefined, remoteRecords[key], 'delete-versus-edit')];
        conflicts.push({
          id: await makeConflictId(key, localDelete, remoteEdit, baseHash, localDeleteFields),
          recordKey: key,
          type: 'delete-edit-conflict',
          winner: 'remote-edit',
          winnerOpId: remoteEdit && remoteEdit.opId || null,
          loserOpId: localDelete && localDelete.opId || null,
          winnerAuditId: await auditRefFor(remoteEdit),
          loserAuditId: await auditRefFor(localDelete),
          deletedSide: 'local',
          fieldConflicts: localDeleteFields,
          baseValue: clone(baseRecords[key]),
          localValue: undefined,
          remoteValue: clone(remoteRecords[key]),
          at: now
        });
        stats.conflicted += 1;
        continue;
      }
      if (inLocal && !inRemote) {
        // Remote delete vs local edit: the EDIT wins; local op will push a
        // resurrecting upsert.
        merged[key] = clone(localRecords[key]);
        delete tombstones[key];
        stats.resurrected += 1;
        var localEdit = localOpByKey[key] || null;
        var remoteDelete = remoteOpByKey[key] || null;
        var remoteDeleteFields = [fieldConflict('$', localRecords[key], undefined, 'delete-versus-edit')];
        conflicts.push({
          id: await makeConflictId(key, localEdit, remoteDelete, baseHash, remoteDeleteFields),
          recordKey: key,
          type: 'delete-edit-conflict',
          winner: 'local-edit',
          winnerOpId: localEdit && localEdit.opId || null,
          loserOpId: remoteDelete && remoteDelete.opId || null,
          winnerAuditId: await auditRefFor(localEdit),
          loserAuditId: await auditRefFor(remoteDelete),
          deletedSide: 'remote',
          fieldConflicts: remoteDeleteFields,
          baseValue: clone(baseRecords[key]),
          localValue: clone(localRecords[key]),
          remoteValue: undefined,
          at: now
        });
        stats.conflicted += 1;
        continue;
      }
      if (localHash === remoteHash) {
        // Converged: keep the LOCAL value so hash-volatile metadata (e.g. a
        // page's updatedAt) is not needlessly clobbered by the remote copy.
        merged[key] = clone(localRecords[key]);
        stats.converged += 1;
        continue;
      }

      // Bootstrap join: the established vault wins when BOTH sides contain
      // the same record id. Collections still union because records that
      // exist only on the joining device took the local-only branch above;
      // this rule merely prevents a fresh profile's seeded/default record
      // with a colliding id from being concatenated or racing real vault
      // content. Ordering docs are merged below so both sets stay reachable.
      if (isBootstrapJoin && inRemote) {
        var joinParsed = protocolApi.parseRecordKey(key);
        if (joinParsed && joinParsed.type !== 'ordering') {
          merged[key] = clone(remoteRecords[key]);
          stats.tookRemote += 1;
          continue;
        }
      }

      // Both records changed. First merge independent fields recursively;
      // only overlapping divergent leaves are true conflicts.
      var localOp = localOpByKey[key] || null;
      var remoteOp = remoteOpByKey[key] || null;
      var localWins;
      if (localOp && remoteOp) {
        localWins = protocolApi.compareOps(localOp, remoteOp) > 0;
      } else {
        // The engine always diffs before merging, so both ops should exist.
        // Defensive fallback: keep local (data stays on this device and will
        // push); noted as non-deterministic in the conflict record.
        localWins = true;
      }
      var parsed = protocolApi.parseRecordKey(key);
      var isPage = !!parsed && parsed.type === 'collection' && parsed.collection === 'pages';
      var fieldMerge = mergeJsonValue(
        inBase ? baseRecords[key] : undefined,
        localRecords[key],
        remoteRecords[key],
        '$',
        localWins,
        null,
        {
          recordKey: key,
          isPage: isPage,
          isOrdering: !!parsed && parsed.type === 'ordering'
        }
      );

      if (!fieldMerge.conflicts.length) {
        merged[key] = fieldMerge.value;
        stats.converged += 1;
        continue;
      }
      stats.conflicted += 1;
      // Keep the field-merged original in place. The unresolved values live
      // only in the dedicated conflict store; they never become ordinary
      // pages or enter o/pages, so a conflict cannot recursively conflict.
      merged[key] = fieldMerge.value;
      conflicts.push({
        id: await makeConflictId(key, localOp, remoteOp, baseHash, fieldMerge.conflicts),
        recordKey: key,
        recordId: parsed && parsed.id || null,
        type: isPage ? 'page-content-conflict' : 'field-conflict',
        winner: localWins ? 'local' : 'remote',
        winnerOpId: localOp && remoteOp ? (localWins ? localOp : remoteOp).opId : null,
        loserOpId: localOp && remoteOp ? (localWins ? remoteOp : localOp).opId : null,
        winnerAuditId: await auditRefFor(localOp && remoteOp ? (localWins ? localOp : remoteOp) : null),
        loserAuditId: await auditRefFor(localOp && remoteOp ? (localWins ? remoteOp : localOp) : null),
        deterministic: !!(localOp && remoteOp),
        fieldConflicts: fieldMerge.conflicts,
        baseValue: clone(inBase ? baseRecords[key] : undefined),
        mergedValue: clone(fieldMerge.value),
        localValue: clone(localRecords[key]),
        remoteValue: clone(remoteRecords[key]),
        at: now
      });
    }

    // Prune expired tombstones.
    var tombstoneKeys = Object.keys(tombstones);
    for (i = 0; i < tombstoneKeys.length; i += 1) {
      var entry = tombstones[tombstoneKeys[i]];
      if (entry && Number(entry.deletedAt) > 0 && now - Number(entry.deletedAt) > protocolApi.TOMBSTONE_RETENTION_MS) {
        delete tombstones[tombstoneKeys[i]];
      }
    }

    return {
      mergedRecords: merged,
      remoteRecords: remoteRecords,
      remoteHashes: remoteHashes,
      conflicts: conflicts,
      tombstones: tombstones,
      stats: stats
    };
  }

  var api = {
    merge: merge,
    applyOpsToRecords: applyOpsToRecords,
    canonicalizeHtml: canonicalizeHtml,
    mergeHtmlThreeWay: mergeHtmlThreeWay,
    makeConflictId: makeConflictId,
    analyzeLegacyConflictCopies: analyzeLegacyConflictCopies,
    consolidateExactLegacyConflictCopies: consolidateExactLegacyConflictCopies
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncMerge = api;
}(typeof window !== 'undefined' ? window : globalThis));
