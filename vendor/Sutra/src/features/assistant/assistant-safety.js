/* Deterministic privacy, provenance, context, tutoring, and quality contracts. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var RECEIPT_SCHEMA = 'sutra-assistant-receipt/1';
  var MAX_RECEIPT_ROWS = 40;
  var SECRET_PATTERNS = [
    /\b(?:sk|gsk|xai|pplx|sess)-[A-Za-z0-9_-]{12,}\b/gi,
    /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{10,}\b/gi,
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*[^\s,;]{6,}/gi,
    /\b(?:password|passphrase|client[_ -]?secret)\s*[:=]\s*[^\s,;]{4,}/gi
  ];
  var UNSAFE_SCHEMES = /^(?:javascript|data:text\/html|vbscript|file|filesystem):/i;
  var ALLOWED_SOURCE_KINDS = ['note', 'page', 'task', 'homework', 'course', 'timeline', 'reviewDeck', 'reviewCard', 'exam', 'college', 'memory', 'plan', 'assignment'];
  var ACTION_REF_FIELDS = {
    noteId: 'note', targetNoteId: 'note', fromNoteId: 'note', toNoteId: 'note', sourceNoteIds: 'note', pageId: 'page', linkPageId: 'page',
    taskId: 'task', taskIds: 'task', homeworkTaskId: 'homework', homeworkIds: 'homework', courseId: 'course', blockId: 'timeline', blockIds: 'timeline',
    deckId: 'reviewDeck', cardId: 'reviewCard', examId: 'exam', collegeItemId: 'college', memoryId: 'memory', planId: 'plan', id: ''
  };
  var TUTORING_MODES = Object.freeze({
    explain: { label: 'Explain', instruction: 'Explain the concept clearly, distinguish source-grounded facts from general knowledge, and check understanding.' },
    hint_first: { label: 'Hint First', instruction: 'Give exactly one useful hint. Do not reveal the full answer unless the student explicitly asks. Offer a progressively stronger next hint.' },
    check_attempt: { label: 'Check My Attempt', instruction: 'State what is correct, identify the first meaningful error, explain why, and suggest only the next correction. Do not replace the whole solution.' },
    quiz_me: { label: 'Quiz Me', instruction: 'Ask one question at a time and wait. Avoid answer leakage. Adapt difficulty, explain after each response, and offer Review-card creation afterward.' },
    diagnose_mistake: { label: 'Diagnose My Mistake', instruction: 'Identify the likely misconception and classify it as conceptual, arithmetic, syntax, or reading. Connect the weak area to source material and offer targeted practice.' },
    create_practice: { label: 'Create Practice', instruction: 'Create source-grounded analogous practice with valid answer keys, explanations, varied coverage, and no leaked answers.' },
    review_cards: { label: 'Turn This Into Review Cards', instruction: 'Propose certified Review-card actions only after deduplicating against supplied cards. Keep each card atomic and source-linked.' },
    study_plan: { label: 'Build a Study Plan', instruction: 'Use deterministic deadlines and Timeline conflicts as authoritative. Propose a reviewable plan; never claim it was scheduled before confirmed state.' },
    rubric: { label: 'Compare My Work to a Rubric', instruction: 'Compare the student\'s actual work to each supplied rubric criterion. Quote short evidence, identify gaps, and do not invent rubric requirements.' },
    summarize_notes: { label: 'Summarize My Notes', instruction: 'Summarize only the supplied unlocked notes, preserve uncertainty and source links, and identify missing coverage.' },
    teach_materials: { label: 'Teach From My Materials', instruction: 'Prioritize selected notes, assignments, files, and course resources. Label source-grounded statements versus general model knowledge and never claim an unused source.' }
  });

  function string(value, max) { var out = String(value == null ? '' : value); return max ? out.slice(0, max) : out; }
  function list(value, max) { return (Array.isArray(value) ? value : []).slice(0, max || MAX_RECEIPT_ROWS); }
  function unique(value, max) { var seen = Object.create(null); return list(value, max || MAX_RECEIPT_ROWS).map(function (row) { return string(row, 160).trim(); }).filter(function (row) { if (!row || seen[row]) return false; seen[row] = true; return true; }); }
  function clone(value, fallback) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }
  function hash(value) { var text = string(value), h = 2166136261; for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function redactText(value) {
    var out = string(value, 200000);
    SECRET_PATTERNS.forEach(function (pattern) { pattern.lastIndex = 0; out = out.replace(pattern, '[redacted]'); });
    return out;
  }
  function containsSecret(value) { return redactText(value) !== string(value, 200000); }
  function safeUrl(value) { var url = string(value, 800).trim(); if (!url) return ''; if (UNSAFE_SCHEMES.test(url)) return ''; if (/^sutra:\/\/[a-z-]+\/[A-Za-z0-9._~%+-]+$/i.test(url)) return url; if (/^https?:\/\//i.test(url)) return url; return ''; }
  function safeObject(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(safeObject);
    if (typeof value !== 'object') return undefined;
    var out = {};
    Object.keys(value).slice(0, 100).forEach(function (key) {
      if (/^(?:api_?key|access_?token|refresh_?token|authorization|authorizationHeader|client_?secret|password|passphrase|systemPrompt|rawContext)$/i.test(key)) return;
      var next = safeObject(value[key]); if (next !== undefined) out[key] = next;
    });
    return out;
  }

  function sourceMetadata(raw) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var kind = string(row.kind || row.type || 'note', 40);
    if (ALLOWED_SOURCE_KINDS.indexOf(kind) < 0) kind = 'source';
    var id = string(row.id || row.noteId || row.taskId || row.courseId || row.blockId, 160);
    var locked = row.locked === true || row.isLocked === true;
    return {
      id: id, kind: kind, title: redactText(string(row.title || row.name || 'Untitled', 240)), locked: locked,
      status: string(row.status || 'available', 40), href: locked ? '' : safeUrl(row.href || ''),
      updatedAt: string(row.updatedAt || row.modifiedAt || '', 40), version: string(row.version || row.versionId || '', 120),
      quote: locked ? '' : redactText(string(row.quote || row.excerpt || '', 500)), reason: redactText(string(row.reason || '', 180))
    };
  }
  function validateSource(raw, resolver) {
    var source = sourceMetadata(raw), live = null;
    if (!source.id || typeof resolver !== 'function') { source.status = source.id ? 'unverified' : 'invalid'; source.href = ''; source.quote = ''; return source; }
    try { live = resolver(source.kind, source.id); } catch (_) { live = null; }
    if (!live) { source.status = 'unavailable'; source.title = source.title || 'Source no longer available'; source.href = ''; source.quote = ''; return source; }
    var current = sourceMetadata(Object.assign({}, live, { kind: source.kind, id: source.id }));
    current.status = 'available';
    if (current.locked) { current.status = 'locked'; current.quote = ''; current.href = ''; }
    if (source.version && current.version && source.version !== current.version) current.status = 'stale';
    return current;
  }

  function normalizeReceipt(raw, resolver) {
    var row = raw && typeof raw === 'object' ? raw : {}, local = row.local === true;
    var sources = list(row.sources, 20).map(function (source) { return validateSource(source, resolver); });
    var receipt = {
      schema: RECEIPT_SCHEMA, local: local, status: string(row.status || 'complete', 30),
      summary: local ? 'Answered locally' : string(row.provider || 'Provider response', 100),
      provider: local ? '' : redactText(string(row.provider, 100)), model: local ? '' : redactText(string(row.model, 160)),
      workspaceAccess: string(row.workspaceAccess || 'minimal', 40), selectedTextIncluded: row.selectedTextIncluded === true,
      priorConversationIncluded: row.priorConversationIncluded === true, areasInspected: unique(row.areasInspected, 20),
      sources: sources, memoryUsedIds: unique(row.memoryUsedIds, 20), memoryInfluenced: list(row.memoryUsedIds, 20).length > 0,
      attachments: list(row.attachments, 20).map(function (item) { return { name: redactText(string(item && item.name, 200)), type: string(item && (item.type || item.category), 60), processingPath: string(item && (item.processingPath || item.processingPlan), 80), status: string(item && item.status || 'included', 40) }; }),
      deterministicEngines: unique(row.deterministicEngines, 20), actionsProposed: unique(row.actionsProposed, 30),
      dataTransmitted: !local && row.dataTransmitted !== false, transmittedCategories: local ? [] : unique(row.transmittedCategories, 30),
      contextReduced: row.contextReduced === true, reductionReasons: unique(row.reductionReasons, 10), omittedSourceCount: Math.max(0, Number(row.omittedSourceCount) || 0),
      errorCategory: string(row.errorCategory, 60), partial: row.partial === true, createdAt: string(row.createdAt || new Date().toISOString(), 40)
    };
    if (local) { receipt.provider = ''; receipt.model = ''; receipt.dataTransmitted = false; receipt.transmittedCategories = []; }
    return safeObject(receipt);
  }

  function appendRow(doc, host, label, value) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    var row = doc.createElement('div'); row.className = 'assistant-receipt-row';
    var term = doc.createElement('span'); term.className = 'assistant-receipt-label'; term.textContent = label;
    var detail = doc.createElement('span'); detail.className = 'assistant-receipt-value'; detail.textContent = Array.isArray(value) ? value.join(', ') : String(value);
    row.appendChild(term); row.appendChild(detail); host.appendChild(row);
  }
  function renderReceipt(raw, options) {
    var opts = options || {}, doc = opts.document || (global && global.document); if (!doc) return null;
    var receipt = normalizeReceipt(raw, opts.resolveSource), details = doc.createElement('details');
    details.className = 'assistant-response-receipt'; details.setAttribute('data-sutra-component', 'assistant-response-receipt');
    var summary = doc.createElement('summary'); summary.textContent = 'How this was answered'; details.appendChild(summary);
    var body = doc.createElement('div'); body.className = 'assistant-response-receipt-body';
    appendRow(doc, body, 'Result', receipt.local ? 'Answered locally · No provider contacted' : receipt.provider + (receipt.model ? ' · ' + receipt.model : ''));
    appendRow(doc, body, 'Workspace Access', receipt.workspaceAccess);
    appendRow(doc, body, 'Selected text', receipt.selectedTextIncluded ? 'Included' : 'Not included');
    appendRow(doc, body, 'Prior conversation', receipt.priorConversationIncluded ? 'Included' : 'Not included');
    appendRow(doc, body, 'Workspace areas inspected', receipt.areasInspected);
    var sourceTitleCounts = Object.create(null);
    receipt.sources.forEach(function (source) { var key = source.kind + ':' + source.title.toLowerCase(); sourceTitleCounts[key] = (sourceTitleCounts[key] || 0) + 1; });
    appendRow(doc, body, 'Sources', receipt.sources.map(function (source) {
      if (source.status === 'unavailable') return 'Source no longer available';
      var key = source.kind + ':' + source.title.toLowerCase();
      var identity = sourceTitleCounts[key] > 1 && source.id ? ' · ' + source.id.slice(-8) : '';
      return source.title + ' (' + source.kind + identity + (source.status !== 'available' ? ', ' + source.status : '') + ')';
    }));
    appendRow(doc, body, 'Saved memory', receipt.memoryInfluenced ? receipt.memoryUsedIds.length + ' relevant item(s) influenced this answer' : 'Not used');
    appendRow(doc, body, 'Attachments', receipt.attachments.map(function (item) { return item.name + ' · ' + item.processingPath; }));
    appendRow(doc, body, 'Deterministic engines', receipt.deterministicEngines);
    appendRow(doc, body, 'Actions proposed', receipt.actionsProposed);
    appendRow(doc, body, 'Data transmitted', receipt.dataTransmitted ? 'Yes · ' + receipt.transmittedCategories.join(', ') : 'No');
    if (receipt.contextReduced) appendRow(doc, body, 'Context reduced', receipt.reductionReasons.concat(receipt.omittedSourceCount ? [receipt.omittedSourceCount + ' source(s) omitted'] : []));
    if (receipt.contextReduced && typeof opts.onNarrow === 'function') {
      var narrow = doc.createElement('button'); narrow.type = 'button'; narrow.className = 'assistant-receipt-narrow';
      narrow.textContent = 'Narrow future context';
      narrow.addEventListener('click', function () { opts.onNarrow(receipt); });
      body.appendChild(narrow);
    }
    if (receipt.status !== 'complete') appendRow(doc, body, 'Response status', receipt.status + (receipt.partial ? ' · partial output preserved' : ''));
    if (receipt.errorCategory) appendRow(doc, body, 'Error', receipt.errorCategory);
    details.appendChild(body); details._sutraReceipt = receipt; return details;
  }

  function actionReferences(action) {
    var refs = [], row = action && typeof action === 'object' ? action : {};
    Object.keys(ACTION_REF_FIELDS).forEach(function (field) {
      var kind = ACTION_REF_FIELDS[field], value = row[field]; if (!kind || value == null) return;
      (Array.isArray(value) ? value : [value]).forEach(function (id) { id = string(id, 160).trim(); if (id) refs.push({ field: field, kind: kind, id: id }); });
    });
    return refs;
  }
  function targetSnapshot(action, resolver) {
    var rows = actionReferences(action).map(function (ref) {
      var live = null; try { live = resolver(ref.kind, ref.id); } catch (_) {}
      if (!live) return { field: ref.field, kind: ref.kind, id: ref.id, status: 'unavailable' };
      return { field: ref.field, kind: ref.kind, id: ref.id, status: 'available', title: string(live.title || live.name, 240), version: string(live.version || live.versionId || live.updatedAt, 120), locked: live.locked === true || live.isLocked === true };
    });
    return { rows: rows, fingerprint: hash(JSON.stringify(rows)) };
  }
  function validateActionTargets(action, options) {
    var opts = options || {}, resolver = opts.resolve, snap = targetSnapshot(action, resolver || function () { return null; });
    var unavailable = snap.rows.filter(function (row) { return row.status !== 'available'; });
    if (unavailable.length) return { ok: false, code: 'stale_source', message: 'Source no longer available.', targets: snap.rows, snapshot: snap };
    var changed = opts.previewSnapshot && opts.previewSnapshot.fingerprint !== snap.fingerprint;
    if (changed) return { ok: false, code: 'stale_preview', reviewRequired: true, message: 'The target changed after preview. Refresh the preview and confirm again.', targets: snap.rows, snapshot: snap };
    return { ok: true, code: 'valid', targets: snap.rows, snapshot: snap };
  }

  function estimateTokens(value) { return Math.max(1, Math.ceil(string(typeof value === 'string' ? value : JSON.stringify(value || '')).length / 3.5)); }
  function contextCandidate(raw, fallbackPriority) {
    var row = raw && typeof raw === 'object' ? raw : { value: raw }, value = row.value != null ? row.value : row;
    var safeValue = safeObject(value);
    return { id: string(row.id || row.sourceId || hash(JSON.stringify(value)), 160), kind: string(row.kind || 'context', 60), title: string(row.title || row.name || row.kind || 'Context', 200), value: safeValue, priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : fallbackPriority, reason: string(row.reason || 'Relevant to this request', 240), locked: row.locked === true || row.isLocked === true, enabled: row.enabled !== false, expiresAt: string(row.expiresAt, 40), tokens: estimateTokens(safeValue) };
  }
  function compactContextValue(value, depth) {
    if (depth > 4) return undefined;
    if (typeof value === 'string') return value.slice(0, 1200);
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 12).map(function (item) { return compactContextValue(item, depth + 1); });
    var out = {}, essential = /^(?:id|title|name|type|kind|date|dueDate|dueTime|start|end|status|priority|course|courseId|noteId|taskId|homeworkId|blockId|deckId|cardId|examId|planId|href|source|sourceId|linked\w*|relationship\w*|locked|isLocked|version|versionId|updatedAt|createdAt|excerpt|quote|content|body|patchContent)$/i;
    Object.keys(value).forEach(function (key) {
      if (!essential.test(key)) return;
      var compacted = compactContextValue(value[key], depth + 1);
      if (compacted !== undefined) out[key] = compacted;
    });
    return out;
  }

  function selectContext(input) {
    var row = input || {}, candidates = [], excluded = [], now = Date.now();
    function add(values, priority, reason) { list(values, 100).forEach(function (value) { var item = contextCandidate(Object.assign({}, value && typeof value === 'object' ? value : { value: value }, { reason: value && value.reason || reason }), priority); if (item.locked) { excluded.push({ id: item.id, reason: 'locked' }); return; } if (!item.enabled) { excluded.push({ id: item.id, reason: 'disabled' }); return; } if (item.expiresAt && Date.parse(item.expiresAt) <= now) { excluded.push({ id: item.id, reason: 'expired' }); return; } if (containsSecret(JSON.stringify(item.value))) { excluded.push({ id: item.id, reason: 'secret' }); return; } candidates.push(item); }); }
    add(row.explicitTargets, 100, 'Explicitly selected by the student'); add(row.currentScreen, 90, 'Current screen'); add(row.selectedText, 88, 'Selected text'); add(row.linked, 80, 'Linked to the current target'); add(row.course, 70, 'Relevant course context'); add(row.dueWork, 60, 'Due or active academic work'); add(row.memories, 55, 'Relevant enabled saved memory'); if (row.includeConversation === true) add(row.conversation, 35, 'Recent conversation enabled');
    candidates.sort(function (a, b) { return b.priority - a.priority || a.tokens - b.tokens || a.id.localeCompare(b.id); });
    var seen = Object.create(null); candidates = candidates.filter(function (item) { var key = item.kind + ':' + item.id; if (seen[key]) return false; seen[key] = true; return true; });
    return { selected: candidates, excluded: excluded, selectionReasons: candidates.map(function (item) { return { id: item.id, kind: item.kind, reason: item.reason }; }) };
  }
  function budgetContext(selection, options) {
    var opts = options || {}, max = Math.max(1024, Number(opts.maxTokens) || 12000), reserve = Math.max(512, Number(opts.reserveResponseTokens) || 2048), attachmentTokens = Math.max(0, Number(opts.attachmentTokens) || 0), systemTokens = Math.max(0, Number(opts.systemTokens) || 0), available = Math.max(0, max - reserve - attachmentTokens - systemTokens);
    var included = [], omitted = [], used = 0, compressedCount = 0;
    list(selection && selection.selected, 200).forEach(function (item) {
      if (used + item.tokens <= available) { included.push(item); used += item.tokens; return; }
      var compactValue = compactContextValue(item.value, 0), compactTokens = estimateTokens(compactValue);
      if (compactValue && Object.keys(compactValue).length && used + compactTokens <= available) {
        included.push(Object.assign({}, item, { value: compactValue, tokens: compactTokens, compressed: true }));
        used += compactTokens; compressedCount += 1; return;
      }
      omitted.push(Object.assign({}, item, { omittedReason: 'request budget' }));
    });
    var reasons = [];
    if (compressedCount) reasons.push(compressedCount + ' oversized record(s) were compressed locally while preserving identifiers and relationships.');
    if (omitted.length) reasons.push('Conservative model/request limit reached; structured records were kept whole.');
    return { included: included, omitted: omitted, usedTokens: used, availableTokens: available, maxTokens: max, reserveResponseTokens: reserve, attachmentTokens: attachmentTokens, reduced: omitted.length > 0 || compressedCount > 0, compressedCount: compressedCount, reductionReasons: reasons, canNarrow: omitted.length > 0 };
  }

  // Neutralize any attempt by embedded content (note text, quotes, imported
  // data) to forge or close the untrusted-data fence. Without this a value
  // containing the literal terminator could "escape" the fence and pose the
  // text after it as trusted instructions.
  function defangFence(value) {
    return string(value, 400000).replace(/<<<\s*(?:\/?\s*END_)?SUTRA_UNTRUSTED_DATA/gi, function (m) { return m.replace(/</g, '‹'); });
  }
  function wrapUntrusted(label, value) { return '<<<SUTRA_UNTRUSTED_DATA label="' + string(label, 100).replace(/["<>]/g, '') + '">>>\n' + defangFence(value) + '\n<<<END_SUTRA_UNTRUSTED_DATA>>>'; }
  function auditRequest(raw) {
    var request = raw && typeof raw === 'object' ? raw : {}, issues = [], serialized = '';
    try { serialized = JSON.stringify(request); } catch (_) { issues.push('Request is not serializable.'); }
    if (containsSecret(serialized)) issues.push('Credentials or secrets were detected.');
    if (/locked(?:Note)?Body|lockedContent/i.test(serialized)) issues.push('Locked-note content was detected.');
    list(request.urls, 30).forEach(function (url) { if (!safeUrl(url)) issues.push('Unsafe URL scheme was blocked.'); });
    var access = string(request.workspaceAccess || 'minimal');
    var allowed = unique(request.allowedCategories || [], 40), sent = unique(request.transmittedCategories || [], 40);
    sent.forEach(function (category) { if (allowed.length && allowed.indexOf(category) < 0) issues.push('Category outside Workspace Access: ' + category); });
    return { ok: issues.length === 0, issues: unique(issues, 30), auditedAt: new Date().toISOString(), dataTransmitted: request.dataTransmitted === true, transmittedCategories: sent };
  }

  function classifyError(error) {
    var row = error && typeof error === 'object' ? error : { message: error }, status = Number(row.status) || 0, text = string(row.message || row.errorMessage).toLowerCase(), category = string(row.category || row.errorCategory);
    var aliases = { auth: 'invalid-key', 'too-large': 'oversized-attachment', cancelled: 'cancellation', network: 'network-failure', validation: 'malformed-structured-output', 'incompatible-model': 'blocked-attachment', 'bad-request': 'unsupported-endpoint' };
    if (aliases[category]) category = aliases[category];
    if (!category) {
      if (row.cancelled || /abort|cancel|stopped/.test(text)) category = 'cancellation'; else if (status === 401) category = 'invalid-key'; else if (status === 403) category = 'expired-authentication'; else if (status === 404 || /model.*(?:not found|unavailable)/.test(text)) category = 'unavailable-model'; else if (status === 413 || /too large|oversized/.test(text)) category = 'oversized-attachment'; else if (status === 429) category = 'rate-limit'; else if (status >= 500 && /overload|capacity/.test(text)) category = 'provider-overload'; else if (status >= 500) category = 'provider-error'; else if (/content security policy|csp/.test(text)) category = 'csp-block'; else if (/offline/.test(text)) category = 'offline'; else if (/timeout|timed out/.test(text)) category = 'timeout'; else if (/failed to fetch|network|cors/.test(text)) category = 'network-failure'; else if (/malformed|invalid json|parse/.test(text)) category = 'malformed-response'; else if (/empty response/.test(text)) category = 'empty-response'; else if (/stale|no longer available/.test(text)) category = 'stale-source'; else if (/storage|quota|indexeddb/.test(text)) category = 'storage-failure'; else category = 'unknown';
    }
    return { category: category, whatHappened: string(row.userMessage || row.message || category, 500), dataSent: row.dataSent === true, partialOutput: row.partial === true || !!row.partialText, actionApplied: row.actionApplied === true, next: string(row.next || recoveryFor(category), 300) };
  }
  function recoveryFor(category) { var map = { 'no-provider': 'Connect a provider or use Guided Local Mode.', 'no-key': 'Add the selected provider key in Integrations.', offline: 'Reconnect or use Guided Local Mode.', 'invalid-key': 'Check the provider key, then retry.', 'expired-authentication': 'Reconnect the provider, then retry.', 'rate-limit': 'Wait briefly or choose another model, then retry.', 'provider-overload': 'Retry later; your message and attachments are preserved.', 'provider-error': 'Retry later or choose another configured provider yourself.', timeout: 'Retry or narrow the context.', 'network-failure': 'Check the connection and provider CORS policy.', 'csp-block': 'Use an approved endpoint or a local compatible endpoint.', 'unavailable-model': 'Choose an available model.', 'unsupported-endpoint': 'Review the endpoint configuration and use an implemented compatible endpoint.', 'malformed-response': 'Retry; no action was applied.', 'empty-response': 'Retry or choose another model.', 'malformed-structured-output': 'Retry; incomplete structured output was not applied.', 'blocked-attachment': 'Remove the blocked file or choose a compatible model.', 'oversized-attachment': 'Attach a smaller file or split it.', 'context-length': 'The request is too large. Lower Workspace Access or remove an attachment, then retry.', 'stream-stalled': 'The stream went idle and was stopped; the partial answer was kept. Retry.', cancellation: 'Retry when ready; partial output is preserved when present.', 'partial-response': 'Review the preserved partial text, then retry if needed.', 'stale-source': 'Open the source, refresh context, and review again.', 'action-validation-failure': 'Refresh the preview and confirm the valid target.', 'storage-failure': 'Check Storage Health before retrying the action.', 'undo-failure': 'Review authoritative state in Activity before trying again.', 'partial-action-failure': 'Review succeeded, failed, and rolled-back actions before continuing.', 'privacy-audit': 'Remove the sensitive content or narrow Workspace Access, then retry.' }; return map[category] || 'Review the details, narrow context if useful, and retry.'; }

  function academicIntegrity(input) {
    var text = string(input && (input.text || input.prompt) || input).toLowerCase(), hasAttempt = !!(input && input.hasAttempt), active = /(?:active|live|proctored|closed[- ]book|during)\s+(?:quiz|test|exam)|answer (?:this|these) (?:quiz|test|exam)/.test(text), ambiguous = !active && /\b(?:quiz|test|exam|assessment)\b/.test(text), fabricate = /(?:invent|fabricate|make up)\s+(?:a |the )?(?:citation|quote|source|interview|experiment|data|evidence)/.test(text);
    var mode = fabricate ? 'fabrication' : active ? 'active-assessment' : ambiguous ? 'ambiguous-assessment' : /essay|paper|rubric|thesis/.test(text) ? 'writing' : /homework|problem set|assignment/.test(text) ? 'homework-support' : 'learning';
    return { mode: mode, hasAttempt: hasAttempt, allowCompleteAnswer: !fabricate && !active && (!ambiguous || hasAttempt), response: fabricate ? 'I can help organize real sources, flag unsupported claims, or draft citation placeholders, but I won\'t invent evidence or citations.' : active ? 'I can give one hint, explain the concept, check your attempt, or create an analogous practice problem.' : ambiguous && !hasAttempt ? 'Is this an active assessment? I can start with a hint or check your attempt while we clarify.' : '' };
  }
  function buildTutoringPrompt(mode, input) { var contract = TUTORING_MODES[mode]; if (!contract) return { ok: false, error: 'Unsupported tutoring mode' }; var integrity = academicIntegrity(input || {}); return { ok: true, mode: mode, label: contract.label, instruction: contract.instruction + (integrity.response ? '\nAcademic-integrity boundary: ' + integrity.response : ''), integrity: integrity, providerRequired: true }; }

  function normalizedQuestionText(value) { return string(value, 4000).toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function similarity(a, b) { var aa = new Set(normalizedQuestionText(a).split(' ').filter(Boolean)), bb = new Set(normalizedQuestionText(b).split(' ').filter(Boolean)); if (!aa.size || !bb.size) return 0; var same = 0; aa.forEach(function (word) { if (bb.has(word)) same += 1; }); return same / Math.max(aa.size, bb.size); }
  function validateStudyMaterials(raw, options) {
    var value = raw && typeof raw === 'object' ? raw : {}, requested = unique(options && options.requestedTopics || [], 60), questions = list(value.questions || value.practiceTest && value.practiceTest.questions, 100), cards = list(value.flashcards || value.cards, 200), sections = list(value.sections || value.studyGuide && value.studyGuide.sections, 100), issues = [], duplicates = [], leakage = [], missingExplanations = [], covered = Object.create(null);
    questions.forEach(function (question, index) {
      var stem = string(question && (question.prompt || question.question || question.stem), 4000), choices = list(question && question.choices, 12).map(function (choice) { return string(choice && (choice.text || choice.label || choice), 1000); }), answer = string(question && (question.answer || question.correctAnswer || question.answerKey), 1000), explanation = string(question && question.explanation, 4000), type = string(question && question.type || 'short-answer');
      var correctChoices = list(question && question.choices, 12).filter(function (choice) { return choice && typeof choice === 'object' && choice.correct === true; });
      if (!stem) issues.push('Question ' + (index + 1) + ' has an empty stem.');
      if (['multiple-choice', 'true-false', 'short-answer', 'free-response'].indexOf(type) < 0) issues.push('Question ' + (index + 1) + ' uses an unsupported type.');
      if (!answer) issues.push('Question ' + (index + 1) + ' has no answer key.');
      if (!explanation) missingExplanations.push(index);
      var choiceNorm = choices.map(normalizedQuestionText); if (new Set(choiceNorm).size !== choiceNorm.length) issues.push('Question ' + (index + 1) + ' repeats answer choices.');
      if (correctChoices.length > 1) issues.push('Question ' + (index + 1) + ' marks more than one choice correct.');
      if (type === 'multiple-choice' && answer && choices.length && choiceNorm.indexOf(normalizedQuestionText(answer)) < 0) issues.push('Question ' + (index + 1) + ' has a malformed answer key.');
      if (answer && normalizedQuestionText(stem).includes(normalizedQuestionText(answer)) && normalizedQuestionText(answer).length > 3) leakage.push(index);
      if (question && question.hint && answer && normalizedQuestionText(question.hint).includes(normalizedQuestionText(answer))) leakage.push(index);
      questions.slice(0, index).forEach(function (other, otherIndex) { var score = similarity(stem, other && (other.prompt || other.question || other.stem)); if (score >= 0.82) duplicates.push({ first: otherIndex, second: index, score: score }); });
      if (/<\s*(?:script|iframe|object|embed|style)|\bon\w+\s*=|(?:javascript|vbscript|data:text\/html)\s*:/i.test(stem + '\n' + explanation + '\n' + choices.join('\n'))) issues.push('Question ' + (index + 1) + ' contains unsafe markup.');
      list(question && question.topics, 20).concat(question && question.topic ? [question.topic] : []).forEach(function (topic) { covered[normalizedQuestionText(topic)] = true; });
    });
    var cardSeen = Object.create(null); cards.forEach(function (card, index) { var key = normalizedQuestionText(card && card.front); if (!key || !normalizedQuestionText(card && card.back)) issues.push('Review card ' + (index + 1) + ' is incomplete.'); else if (cardSeen[key]) issues.push('Review card ' + (index + 1) + ' duplicates another card.'); else cardSeen[key] = true; });
    sections.forEach(function (section) { list(section && (section.topics || section.keyPoints), 30).forEach(function (topic) { covered[normalizedQuestionText(topic)] = true; }); });
    if (!questions.length && !cards.length && !sections.length) issues.push('Generated material is empty.');
    if (!unique(value.sourcesUsed || [], 40).length) issues.push('Generated material does not identify a supported source.');
    if (questions.length > 60 || cards.length > 150) issues.push('Generated material is excessively long.');
    var missingTopics = requested.filter(function (topic) { return !covered[normalizedQuestionText(topic)]; });
    return { ok: issues.length === 0 && duplicates.length === 0 && leakage.length === 0 && missingTopics.length === 0, topicsCovered: Object.keys(covered), underrepresentedTopics: missingTopics, duplicates: duplicates, possibleAnswerLeakage: unique(leakage, 100), missingExplanations: missingExplanations, sourcesUsed: unique(value.sourcesUsed || [], 40), issues: issues, sectionsRequiringRegeneration: unique([].concat(duplicates.map(function (row) { return 'question:' + row.second; }), leakage.map(function (index) { return 'question:' + index; }), missingExplanations.map(function (index) { return 'question:' + index; }), missingTopics.map(function (topic) { return 'topic:' + topic; })), 100) };
  }
  function replaceSection(original, selector, replacement, options) {
    var before = clone(original, null); if (!before) return { ok: false, code: 'invalid_original' };
    var next = clone(before, null), collection = string(selector && selector.collection || 'sections'), index = Number(selector && selector.index);
    var path = collection.split('.').filter(Boolean), beforeHost = before, nextHost = next;
    for (var depth = 0; depth < path.length; depth += 1) { beforeHost = beforeHost && beforeHost[path[depth]]; nextHost = nextHost && nextHost[path[depth]]; }
    if (!Array.isArray(nextHost) || !Array.isArray(beforeHost) || !Number.isInteger(index) || index < 0 || index >= nextHost.length) return { ok: false, code: 'section_unavailable' };
    nextHost[index] = clone(replacement, null);
    if (options && Array.isArray(options.sourcesUsed)) next.sourcesUsed = options.sourcesUsed.slice();
    var quality = validateStudyMaterials(next, options || {});
    return { ok: quality.ok, code: quality.ok ? 'preview_ready' : 'replacement_failed_validation', preview: { collection: collection, index: index, before: beforeHost[index], after: nextHost[index] }, value: next, quality: quality, undo: { kind: 'study-material-section', collection: collection, index: index, before: beforeHost[index] } };
  }

  var api = {
    VERSION: VERSION, RECEIPT_SCHEMA: RECEIPT_SCHEMA, TUTORING_MODES: TUTORING_MODES,
    redactText: redactText, containsSecret: containsSecret, safeObject: safeObject, safeUrl: safeUrl,
    normalizeReceipt: normalizeReceipt, renderReceipt: renderReceipt, validateSource: validateSource,
    actionReferences: actionReferences, targetSnapshot: targetSnapshot, validateActionTargets: validateActionTargets,
    estimateTokens: estimateTokens, selectContext: selectContext, budgetContext: budgetContext,
    wrapUntrusted: wrapUntrusted, auditRequest: auditRequest, classifyError: classifyError,
    academicIntegrity: academicIntegrity, buildTutoringPrompt: buildTutoringPrompt,
    validateStudyMaterials: validateStudyMaterials, replaceStudyMaterialSection: replaceSection
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraAssistantSafety = api;
}(typeof window !== 'undefined' ? window : globalThis));
