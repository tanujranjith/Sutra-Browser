/* Canonical AssistantConversation / Message / Context / Request models and controller. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  function clone(value) { if (value == null) return value; if (typeof structuredClone === 'function') return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
  function value(input, max) { var out = String(input == null ? '' : input); return max ? out.slice(0, max) : out; }
  function sanitizeReceipt(input) {
    if (!input || typeof input !== 'object') return null;
    if (global && global.SutraAssistantSafety && typeof global.SutraAssistantSafety.normalizeReceipt === 'function') {
      try { return global.SutraAssistantSafety.normalizeReceipt(input); } catch (_) {}
    }
    function clean(next) {
      if (typeof next === 'string') return next
        .replace(/\b(?:sk|gsk|xai|pplx|sess)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
        .replace(/\bAIza[0-9A-Za-z._-]{10,}\b/g, '[redacted]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{10,}\b/gi, 'Bearer [redacted]');
      if (Array.isArray(next)) return next.slice(0, 100).map(clean);
      if (!next || typeof next !== 'object') return next;
      var out = {};
      Object.keys(next).slice(0, 100).forEach(function (key) {
        if (/^(?:api_?key|access_?token|refresh_?token|authorization|authorizationHeader|client_?secret|password|passphrase|systemPrompt|rawPrompt|rawContext)$/i.test(key)) return;
        out[key] = clean(next[key]);
      });
      return out;
    }
    return clean(input);
  }
  function id(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function source(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var noteId = value(raw.noteId || raw.id, 160), href = value(raw.href || (noteId ? 'sutra://page/' + encodeURIComponent(noteId) : ''), 500);
    if (!noteId || !/^sutra:\/\/(?:page|note)\//i.test(href)) return null;
    return {
      id: value(raw.id || noteId, 240), kind: 'note', noteId: noteId, blockId: value(raw.blockId, 240),
      title: value(raw.title || 'Untitled', 300), headingPath: (Array.isArray(raw.headingPath) ? raw.headingPath : []).map(function (part) { return value(part, 240); }).slice(0, 12),
      quote: value(raw.quote, 1200), href: href, updatedAt: value(raw.updatedAt, 40), version: value(raw.version, 120),
      sourceOffsets: raw.sourceOffsets && typeof raw.sourceOffsets === 'object' ? { start: Math.max(0, Number(raw.sourceOffsets.start) || 0), end: Math.max(0, Number(raw.sourceOffsets.end) || 0) } : null,
      score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0, confidence: ['high', 'medium', 'low'].indexOf(raw.confidence) >= 0 ? raw.confidence : 'low',
      reasonCodes: (Array.isArray(raw.reasonCodes) ? raw.reasonCodes : []).map(function (reason) { return value(reason, 80); }).slice(0, 20),
      safetyFlags: (Array.isArray(raw.safetyFlags) ? raw.safetyFlags : []).map(function (flag) { return value(flag, 80); }).slice(0, 10),
      stale: raw.stale === true
    };
  }
  function message(raw) {
    var row = raw && typeof raw === 'object' ? raw : {}, role = value(row.role).toLowerCase();
    if (['user', 'assistant', 'notice', 'error'].indexOf(role) < 0) role = 'user';
    return {
      id: value(row.id || id('msg'), 100), role: role, content: value(row.content || row.text, 200000), createdAt: value(row.createdAt || new Date().toISOString(), 40),
      claimType: ['external_sourced_fact', 'workspace_fact', 'saved_memory_preference', 'deterministic_calculation', 'deterministic_inference', 'inference', 'recommendation', 'proposed_action', 'generative_suggestion'].indexOf(row.claimType) >= 0 ? row.claimType : '',
      memoryUsedIds: (Array.isArray(row.memoryUsedIds) ? row.memoryUsedIds : []).map(function (memoryId) { return value(memoryId, 120); }).slice(0, 20),
      providerLabel: value(row.providerLabel, 80), modelLabel: value(row.modelLabel, 120), receipt: sanitizeReceipt(row.receipt),
      sources: (Array.isArray(row.sources) ? row.sources : []).map(source).filter(Boolean).slice(0, 20), favorite: row.favorite === true,
      grounding: row.grounding && typeof row.grounding === 'object' ? { evidenceStatus: value(row.grounding.evidenceStatus, 40), query: value(row.grounding.query, 1000), scope: clone(row.grounding.scope || null) } : null
    };
  }
  function context(raw) {
    var row = raw && typeof raw === 'object' ? raw : {};
    return { schema: 'sutra-assistant-context/1', view: value(row.view || 'today', 80), depth: value(row.depth || 'currentView', 40), selection: value(row.selection, 20000), activeNote: clone(row.activeNote || null), retrievedNotes: (Array.isArray(row.retrievedNotes) ? row.retrievedNotes : []).map(source).filter(Boolean).slice(0, 20), accessReport: clone(row.accessReport || null) };
  }
  function request(raw) {
    var row = raw && typeof raw === 'object' ? raw : {};
    return { schema: 'sutra-assistant-request/1', id: value(row.id || id('req'), 100), conversationId: value(row.conversationId, 100), input: value(row.input, 200000), context: context(row.context), messages: (Array.isArray(row.messages) ? row.messages : []).map(message).filter(function (entry) { return entry.content; }).slice(-50), attachments: clone(Array.isArray(row.attachments) ? row.attachments.slice(0, 20) : []), createdAt: value(row.createdAt || new Date().toISOString(), 40) };
  }
  function conversation(raw) {
    var row = raw && typeof raw === 'object' ? raw : {}, now = new Date().toISOString();
    return { schema: 'sutra-assistant-conversation/1', id: value(row.id || id('chat'), 100), title: value(row.title || 'New chat', 90), messages: (Array.isArray(row.messages) ? row.messages : []).map(message).slice(-300), scope: clone(row.scope && typeof row.scope === 'object' ? row.scope : { type: 'workspace' }), createdAt: value(row.createdAt || now, 40), updatedAt: value(row.updatedAt || row.createdAt || now, 40), archived: row.archived === true, pinned: row.pinned === true };
  }
  function prepareMessageView(raw, options) {
    var opts = options || {}, normalized = message(raw), content = normalized.content;
    var split = { clean: content, thoughts: [] };
    if (typeof opts.splitContent === 'function') {
      try { split = opts.splitContent(content) || split; } catch (_) {}
    }
    var clean = value(split.clean != null ? split.clean : content, 200000);
    var actionResult = null;
    if (normalized.role === 'assistant' && typeof opts.parseActions === 'function') {
      try { actionResult = opts.parseActions(clean) || null; } catch (_) {}
    }
    var actions = actionResult && Array.isArray(actionResult.actions) ? clone(actionResult.actions) : [];
    var displayedContent = actions.length ? value(actionResult.cleanText, 200000) : clean;
    return {
      message: normalized,
      role: normalized.role,
      content: content,
      cleanContent: clean,
      displayedContent: displayedContent,
      thoughts: [],
      actions: actions,
      actionResult: actionResult,
      sources: normalized.sources,
      grounding: normalized.grounding,
      claimType: normalized.claimType,
      memoryUsedIds: normalized.memoryUsedIds,
      receipt: normalized.receipt
    };
  }
  function createController(options) {
    var opts = options || {}, state = { conversations: [], currentConversationId: '', inFlight: null }, listeners = new Set(), shells = new Map();
    function emit(event) {
      var snapshot = getState(); listeners.forEach(function (listener) { try { listener(snapshot, event || { type: 'change' }); } catch (_) {} });
      shells.forEach(function (renderer) { try { renderer(snapshot, event || { type: 'change' }); } catch (_) {} });
      if (typeof opts.persist === 'function') opts.persist(snapshot, event || { type: 'change' });
    }
    function getState() { return clone(state); }
    function current() { return state.conversations.find(function (row) { return row.id === state.currentConversationId; }) || null; }
    function load(input) { var rows = input && Array.isArray(input.conversations) ? input.conversations.map(conversation) : []; state.conversations = rows.length ? rows : [conversation()]; state.currentConversationId = value(input && input.currentConversationId) || state.conversations[0].id; if (!current()) state.currentConversationId = state.conversations[0].id; emit({ type: 'load' }); return getState(); }
    function addMessage(input, conversationId) { var target = state.conversations.find(function (row) { return row.id === (conversationId || state.currentConversationId); }); if (!target) return null; var next = message(input); target.messages.push(next); target.messages = target.messages.slice(-300); target.updatedAt = new Date().toISOString(); emit({ type: 'message', conversationId: target.id, messageId: next.id }); return clone(next); }
    function createConversation(input) { var next = conversation(input); state.conversations.unshift(next); state.currentConversationId = next.id; emit({ type: 'conversation-created', conversationId: next.id }); return clone(next); }
    function setCurrent(conversationId) { if (!state.conversations.some(function (row) { return row.id === conversationId; })) return false; state.currentConversationId = conversationId; emit({ type: 'conversation-selected', conversationId: conversationId }); return true; }
    function linkScope(scope) { var target = current(); if (!target) return false; target.scope = clone(scope || { type: 'workspace' }); target.updatedAt = new Date().toISOString(); emit({ type: 'scope', conversationId: target.id }); return true; }
    return { VERSION: VERSION, load: load, getState: getState, current: function () { return clone(current()); }, createConversation: createConversation, setCurrent: setCurrent, addMessage: addMessage, linkScope: linkScope, subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }, registerShell: function (name, renderer) { shells.set(String(name), renderer); renderer(getState(), { type: 'shell-registered' }); return function () { shells.delete(String(name)); }; }, setInFlight: function (requestValue) { state.inFlight = requestValue ? request(requestValue) : null; emit({ type: state.inFlight ? 'request-started' : 'request-ended' }); } };
  }
  var api = { VERSION: VERSION, normalizeSource: source, normalizeMessage: message, normalizeContext: context, normalizeRequest: request, normalizeConversation: conversation, prepareMessageView: prepareMessageView, createController: createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraAssistantCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
