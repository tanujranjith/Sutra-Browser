/* Anchored, conflict-aware note edit proposals with hunk approval and undo. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  function clone(value) { if (value == null) return value; if (typeof structuredClone === 'function') return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
  function str(value) { return String(value == null ? '' : value); }
  function hash(value) {
    var input = str(value), result = 2166136261;
    for (var i = 0; i < input.length; i += 1) { result ^= input.charCodeAt(i); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(36);
  }
  function proposalId(noteId, hunks) { return 'patch_' + hash(str(noteId) + '\u0000' + JSON.stringify(hunks)); }
  function contextBefore(content, start) { return content.slice(Math.max(0, start - 80), start); }
  function contextAfter(content, end) { return content.slice(end, Math.min(content.length, end + 80)); }
  function normalizeHunk(raw, content, index, allowStaleAnchors) {
    var row = raw && typeof raw === 'object' ? raw : {}, start = Math.max(0, Math.floor(Number(row.start) || 0));
    var end = Math.max(start, Math.floor(Number(row.end) || start));
    if (end > content.length) throw new Error('Hunk ' + (index + 1) + ' ends outside the note.');
    var before = row.before == null ? content.slice(start, end) : str(row.before);
    var anchorMatches = content.slice(start, end) === before;
    if (!anchorMatches && allowStaleAnchors !== true) throw new Error('Hunk ' + (index + 1) + ' does not match its anchor.');
    return {
      id: str(row.id || 'hunk-' + (index + 1)).slice(0, 120),
      blockId: str(row.blockId || '').slice(0, 200),
      start: start,
      end: end,
      before: before,
      replacement: str(row.replacement == null ? row.after : row.replacement),
      contextBefore: str(row.contextBefore == null ? (anchorMatches ? contextBefore(content, start) : '') : row.contextBefore).slice(-160),
      contextAfter: str(row.contextAfter == null ? (anchorMatches ? contextAfter(content, end) : '') : row.contextAfter).slice(0, 160),
      status: ['approved', 'declined'].indexOf(row.status) >= 0 ? row.status : 'pending',
      label: str(row.label || '').slice(0, 200)
    };
  }
  function create(input) {
    var row = input && typeof input === 'object' ? input : {}, note = row.note && typeof row.note === 'object' ? row.note : {};
    var noteId = str(row.noteId || note.id), content = str(row.content == null ? (note.content || note.body) : row.content);
    if (!noteId) throw new Error('A note id is required.');
    var rawHunks = Array.isArray(row.hunks) ? row.hunks : [];
    if (!rawHunks.length && row.after != null) {
      var after = str(row.after), prefix = 0, suffix = 0;
      while (prefix < content.length && prefix < after.length && content.charAt(prefix) === after.charAt(prefix)) prefix += 1;
      while (suffix < content.length - prefix && suffix < after.length - prefix && content.charAt(content.length - 1 - suffix) === after.charAt(after.length - 1 - suffix)) suffix += 1;
      rawHunks = [{ start: prefix, end: content.length - suffix, replacement: after.slice(prefix, after.length - suffix) }];
    }
    if (!rawHunks.length) throw new Error('At least one hunk is required.');
    var hunks = rawHunks.map(function (hunk, index) { return normalizeHunk(hunk, content, index, row.allowStaleAnchors === true); }).sort(function (a, b) { return a.start - b.start; });
    for (var i = 1; i < hunks.length; i += 1) if (hunks[i].start < hunks[i - 1].end) throw new Error('Patch hunks may not overlap.');
    return {
      schema: 'sutra-note-patch/1', version: VERSION, id: str(row.id || proposalId(noteId, hunks)), noteId: noteId,
      versionId: str(row.versionId || note.versionId || note.version || (Array.isArray(note.versions) ? note.versions.length : '')),
      baseHash: str(row.baseHash || hash(content)), blockId: str(row.blockId || '').slice(0, 200), title: str(row.title || 'Suggested note edit').slice(0, 240),
      createdAt: str(row.createdAt || new Date().toISOString()), hunks: hunks
    };
  }
  function findRebasedPosition(content, hunk) {
    var candidates = [], offset = 0;
    if (!hunk.before) {
      // Pure insertion. Require an unambiguous anchor, like the replacement
      // branch below: if the surrounding context recurs in a note that changed
      // since the proposal, report a conflict (-1) rather than silently
      // inserting at the first match, which could be the wrong place.
      var needle = hunk.contextBefore + hunk.contextAfter;
      if (!needle) return content.length === 0 ? 0 : -1;
      var insertAt = [], scan = 0, hit;
      while ((hit = content.indexOf(needle, scan)) >= 0) { insertAt.push(hit + hunk.contextBefore.length); scan = hit + Math.max(1, needle.length); }
      return insertAt.length === 1 ? insertAt[0] : -1;
    }
    while ((offset = content.indexOf(hunk.before, offset)) >= 0) {
      var beforeMatches = !hunk.contextBefore || content.slice(Math.max(0, offset - hunk.contextBefore.length), offset) === hunk.contextBefore;
      var afterStart = offset + hunk.before.length;
      var afterMatches = !hunk.contextAfter || content.slice(afterStart, afterStart + hunk.contextAfter.length) === hunk.contextAfter;
      if (beforeMatches && afterMatches) candidates.push(offset);
      offset += Math.max(1, hunk.before.length);
    }
    return candidates.length === 1 ? candidates[0] : -1;
  }
  function inspect(proposal, note) {
    var patch = clone(proposal), content = str(note && (note.content == null ? note.body : note.content));
    var currentVersion = str(note && (note.versionId || note.version || (Array.isArray(note.versions) ? note.versions.length : '')));
    var anchorsMatch = patch.hunks.every(function (hunk) { return content.slice(hunk.start, hunk.end) === hunk.before; });
    if (anchorsMatch && hash(content) === patch.baseHash && (!patch.versionId || !currentVersion || patch.versionId === currentVersion)) return { ok: true, code: 'ready', proposal: patch };
    var rebased = [], failed = [];
    patch.hunks.forEach(function (hunk) {
      var nextStart = findRebasedPosition(content, hunk);
      if (nextStart < 0) { failed.push(hunk.id); return; }
      var next = clone(hunk);
      next.start = nextStart; next.end = nextStart + hunk.before.length;
      next.contextBefore = contextBefore(content, next.start); next.contextAfter = contextAfter(content, next.end);
      rebased.push(next);
    });
    if (failed.length) return { ok: false, code: 'conflict', conflictingHunkIds: failed, message: 'The note changed after this proposal was generated.' };
    patch.hunks = rebased.sort(function (a, b) { return a.start - b.start; });
    patch.baseHash = hash(content); patch.versionId = currentVersion; patch.rebasedAt = new Date().toISOString();
    return { ok: true, code: 'rebased', proposal: patch };
  }
  function decide(proposal, decisions) {
    var patch = clone(proposal), map = decisions && typeof decisions === 'object' ? decisions : {};
    patch.hunks.forEach(function (hunk) {
      var decision = map[hunk.id];
      if (decision === true || decision === 'approved') hunk.status = 'approved';
      if (decision === false || decision === 'declined') hunk.status = 'declined';
    });
    return patch;
  }
  function apply(proposal, note, options) {
    var checked = inspect(proposal, note);
    if (!checked.ok) return checked;
    if (checked.code === 'rebased' && !(options && options.allowRebase === true)) return { ok: false, code: 'rebase_required', proposal: checked.proposal, message: 'Review the rebased diff before applying.' };
    var patch = checked.proposal, content = str(note && (note.content == null ? note.body : note.content));
    var selected = patch.hunks.filter(function (hunk) { return hunk.status === 'approved' || (options && options.approveAll === true && hunk.status !== 'declined'); });
    if (!selected.length) return { ok: false, code: 'nothing_approved', message: 'Approve at least one hunk.' };
    selected.slice().sort(function (a, b) { return b.start - a.start; }).forEach(function (hunk) {
      content = content.slice(0, hunk.start) + hunk.replacement + content.slice(hunk.end);
    });
    return {
      ok: true, code: 'applied', noteId: patch.noteId, content: content, appliedHunkIds: selected.map(function (hunk) { return hunk.id; }),
      receipt: { schema: 'sutra-note-patch-receipt/1', proposalId: patch.id, noteId: patch.noteId, before: str(note && (note.content == null ? note.body : note.content)), after: content, beforeHash: patch.baseHash, afterHash: hash(content), appliedHunkIds: selected.map(function (hunk) { return hunk.id; }), appliedAt: new Date().toISOString() }
    };
  }
  function revert(receipt, note) {
    var content = str(note && (note.content == null ? note.body : note.content));
    if (!receipt || hash(content) !== receipt.afterHash) return { ok: false, code: 'undo_conflict', message: 'The note changed after this patch was applied.' };
    return { ok: true, code: 'reverted', noteId: receipt.noteId, content: str(receipt.before) };
  }
  function diffHunk(hunk) {
    return { id: hunk.id, label: hunk.label, before: hunk.before, after: hunk.replacement, status: hunk.status, start: hunk.start, end: hunk.end };
  }

  var api = { VERSION: VERSION, hash: hash, create: create, inspect: inspect, decide: decide, apply: apply, revert: revert, diffHunk: diffHunk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraNotePatchSystem = api;
}(typeof window !== 'undefined' ? window : globalThis));
