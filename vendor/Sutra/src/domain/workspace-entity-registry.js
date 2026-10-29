/*
 * Canonical, local-only workspace entity registry.
 *
 * This module does not persist or index workspace data. It gives Sutra one
 * contract for describing, resolving, opening, and acting on records that
 * remain owned by their existing canonical stores.
 */
(function (global) {
  'use strict';

  var REGISTRY_VERSION = 1;
  var ADAPTER_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
  var SENSITIVE_KEY_PATTERN = /(api.?key|access.?token|refresh.?token|secret|password|passphrase|credential|private.?key|wrapped.?key|oauth)/i;

  function asText(value, limit) {
    var text = value === undefined || value === null ? '' : String(value);
    text = text.replace(/\s+/g, ' ').trim();
    if (limit && text.length > limit) return text.slice(0, limit);
    return text;
  }

  function asId(value) {
    return asText(value, 240);
  }

  function asStringList(value, limit) {
    var rows = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    var seen = Object.create(null);
    var out = [];
    rows.forEach(function (entry) {
      var text = asText(entry, 240);
      var key = text.toLowerCase();
      if (!text || seen[key] || out.length >= (limit || 40)) return;
      seen[key] = true;
      out.push(text);
    });
    return out;
  }

  function sanitizeMetadata(value, depth) {
    if (depth > 3 || value === undefined || value === null) return null;
    if (typeof value === 'string') return asText(value, 1000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value.slice(0, 60).map(function (item) {
        return sanitizeMetadata(item, depth + 1);
      }).filter(function (item) { return item !== null; });
    }
    if (typeof value !== 'object') return null;
    var out = {};
    Object.keys(value).slice(0, 80).forEach(function (key) {
      if (SENSITIVE_KEY_PATTERN.test(key)) return;
      var clean = sanitizeMetadata(value[key], depth + 1);
      if (clean !== null) out[key] = clean;
    });
    return out;
  }

  function normalizePrivacy(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var locked = source.locked === true;
    var searchable = source.searchable !== false && !locked;
    return Object.freeze({
      searchable: searchable,
      locked: locked,
      private: source.private === true,
      reason: searchable ? '' : asText(source.reason || (locked ? 'locked' : 'unavailable'), 160)
    });
  }

  function normalizeDeepLink(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var view = asText(raw.view, 80);
    if (!view) return null;
    return Object.freeze({
      view: view,
      params: sanitizeMetadata(raw.params || {}, 0) || {}
    });
  }

  function normalizeEntity(raw, adapter) {
    if (!raw || typeof raw !== 'object') return null;
    var id = asId(raw.id);
    if (!id) return null;
    var type = adapter.id;
    var privacy = normalizePrivacy(raw.privacy);
    var title = privacy.searchable
      ? asText(raw.title || adapter.singularLabel || adapter.label || type, 500)
      : asText(raw.lockedTitle || adapter.lockedLabel || ('Locked ' + (adapter.singularLabel || adapter.label || 'item')), 160);
    var text = privacy.searchable ? asText(raw.text, 200000) : '';
    var keywords = privacy.searchable ? asStringList(raw.keywords, 80) : [];
    var dates = raw.dates && typeof raw.dates === 'object' ? raw.dates : {};
    var entity = {
      schemaVersion: REGISTRY_VERSION,
      key: type + ':' + id,
      type: type,
      id: id,
      title: title,
      text: text,
      keywords: Object.freeze(keywords),
      courseId: asId(raw.courseId),
      parentKey: asText(raw.parentKey, 320),
      status: asText(raw.status, 100),
      dates: Object.freeze({
        due: asText(dates.due || raw.due, 80),
        start: asText(dates.start || raw.start, 80),
        end: asText(dates.end || raw.end, 80),
        created: asText(dates.created || raw.createdAt, 80),
        updated: asText(dates.updated || raw.updatedAt, 80)
      }),
      deepLink: normalizeDeepLink(raw.deepLink),
      privacy: privacy,
      metadata: Object.freeze(sanitizeMetadata(raw.metadata || {}, 0) || {})
    };
    return Object.freeze(entity);
  }

  function normalizeRef(ref, maybeId) {
    if (typeof ref === 'string' && maybeId !== undefined) {
      return { type: asText(ref, 80), id: asId(maybeId) };
    }
    if (typeof ref === 'string') {
      var separator = ref.indexOf(':');
      if (separator > 0) return { type: ref.slice(0, separator), id: ref.slice(separator + 1) };
      return { type: '', id: asId(ref) };
    }
    if (ref && typeof ref === 'object') {
      return {
        type: asText(ref.type, 80),
        id: asId(ref.id),
        key: asText(ref.key, 320)
      };
    }
    return { type: '', id: '' };
  }

  function cloneAdapterSummary(adapter) {
    return Object.freeze({
      id: adapter.id,
      label: adapter.label,
      singularLabel: adapter.singularLabel,
      priority: adapter.priority,
      capabilities: Object.freeze({
        open: typeof adapter.open === 'function',
        actions: Object.freeze(Object.keys(adapter.actions || {}))
      })
    });
  }

  function createWorkspaceEntityRegistry(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var adapters = Object.create(null);
    var adapterOrder = [];
    var listeners = [];
    var revision = 0;

    function report(error, context) {
      if (typeof opts.onError === 'function') {
        try { opts.onError(error, context || {}); } catch (_) { /* diagnostics must not break the registry */ }
      }
    }

    function registerAdapter(definition, registerOptions) {
      var source = definition && typeof definition === 'object' ? definition : {};
      var id = asText(source.id || source.type, 80);
      if (!ADAPTER_ID_PATTERN.test(id)) throw new Error('Invalid workspace entity adapter id: ' + id);
      if (typeof source.collect !== 'function') throw new Error('Workspace entity adapter "' + id + '" requires collect().');
      var replace = registerOptions && registerOptions.replace === true;
      if (adapters[id] && !replace) throw new Error('Workspace entity adapter already registered: ' + id);

      var actions = Object.create(null);
      Object.keys(source.actions || {}).forEach(function (actionId) {
        var action = source.actions[actionId];
        if (!ADAPTER_ID_PATTERN.test(actionId) || !action || typeof action.run !== 'function') return;
        actions[actionId] = {
          id: actionId,
          label: asText(action.label || actionId, 120),
          kind: asText(action.kind || 'secondary', 40),
          available: typeof action.available === 'function' ? action.available : null,
          run: action.run
        };
      });

      var adapter = {
        id: id,
        label: asText(source.label || id, 120),
        singularLabel: asText(source.singularLabel || source.label || id, 120),
        lockedLabel: asText(source.lockedLabel, 120),
        priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 100,
        collect: source.collect,
        open: typeof source.open === 'function' ? source.open : null,
        actions: actions
      };

      if (!adapters[id]) adapterOrder.push(id);
      adapters[id] = adapter;
      adapterOrder.sort(function (left, right) {
        return adapters[left].priority - adapters[right].priority || left.localeCompare(right);
      });
      invalidate('adapter-registered', [id]);

      return function unregister() {
        if (adapters[id] !== adapter) return false;
        delete adapters[id];
        adapterOrder = adapterOrder.filter(function (entry) { return entry !== id; });
        invalidate('adapter-unregistered', [id]);
        return true;
      };
    }

    function listAdapters() {
      return adapterOrder.map(function (id) { return cloneAdapterSummary(adapters[id]); });
    }

    function collect(context, collectOptions) {
      var collectOpts = collectOptions && typeof collectOptions === 'object' ? collectOptions : {};
      var requestedTypes = Array.isArray(collectOpts.types)
        ? new Set(collectOpts.types.map(function (value) { return asText(value, 80); }))
        : null;
      var seen = Object.create(null);
      var out = [];

      adapterOrder.forEach(function (adapterId) {
        if (requestedTypes && !requestedTypes.has(adapterId)) return;
        var adapter = adapters[adapterId];
        var rows;
        try {
          rows = adapter.collect(context || {}, collectOpts);
        } catch (error) {
          report(error, { operation: 'collect', adapterId: adapterId });
          return;
        }
        if (!Array.isArray(rows)) return;
        rows.forEach(function (raw) {
          var entity;
          try {
            entity = normalizeEntity(raw, adapter);
          } catch (error) {
            report(error, { operation: 'normalize', adapterId: adapterId });
            return;
          }
          if (!entity || seen[entity.key]) return;
          if (collectOpts.searchableOnly === true && entity.privacy.searchable !== true) return;
          if (collectOpts.includePrivate === false && entity.privacy.private === true) return;
          seen[entity.key] = true;
          out.push(entity);
        });
      });
      return out;
    }

    function find(ref, context, findOptions) {
      var normalized = normalizeRef(ref);
      var key = normalized.key || (normalized.type && normalized.id ? normalized.type + ':' + normalized.id : '');
      if (!key) return null;
      var types = normalized.type ? [normalized.type] : null;
      var rows = collect(context, Object.assign({}, findOptions || {}, { types: types }));
      return rows.find(function (entity) { return entity.key === key; }) || null;
    }

    function getActions(ref, context) {
      var entity = ref && ref.key && ref.type && ref.id ? ref : find(ref, context);
      if (!entity) return [];
      var adapter = adapters[entity.type];
      if (!adapter) return [];
      var out = [];
      if (adapter.open) {
        out.push(Object.freeze({ id: 'open', label: 'Open', kind: 'primary', enabled: true }));
      }
      Object.keys(adapter.actions).forEach(function (actionId) {
        var action = adapter.actions[actionId];
        var enabled = true;
        if (action.available) {
          try { enabled = action.available(entity, context || {}) !== false; }
          catch (error) {
            enabled = false;
            report(error, { operation: 'action-availability', adapterId: entity.type, actionId: actionId });
          }
        }
        out.push(Object.freeze({ id: action.id, label: action.label, kind: action.kind, enabled: enabled }));
      });
      return out;
    }

    async function open(ref, context) {
      var entity = ref && ref.key && ref.type && ref.id ? ref : find(ref, context);
      if (!entity) return { ok: false, code: 'not_found' };
      var adapter = adapters[entity.type];
      if (!adapter || !adapter.open) return { ok: false, code: 'open_unavailable', entity: entity };
      try {
        var result = await adapter.open(entity, context || {});
        return { ok: result !== false, code: result === false ? 'open_failed' : 'opened', entity: entity };
      } catch (error) {
        report(error, { operation: 'open', adapterId: entity.type, entityKey: entity.key });
        return { ok: false, code: 'open_failed', entity: entity, error: error };
      }
    }

    async function runAction(ref, actionId, context) {
      var normalizedActionId = asText(actionId, 80);
      if (normalizedActionId === 'open') return open(ref, context);
      var entity = ref && ref.key && ref.type && ref.id ? ref : find(ref, context);
      if (!entity) return { ok: false, code: 'not_found' };
      var adapter = adapters[entity.type];
      var action = adapter && adapter.actions[normalizedActionId];
      if (!action) return { ok: false, code: 'action_unavailable', entity: entity };
      if (action.available) {
        try {
          if (action.available(entity, context || {}) === false) {
            return { ok: false, code: 'action_disabled', entity: entity };
          }
        } catch (error) {
          report(error, { operation: 'action-availability', adapterId: entity.type, actionId: normalizedActionId });
          return { ok: false, code: 'action_disabled', entity: entity };
        }
      }
      try {
        var result = await action.run(entity, context || {});
        return { ok: result !== false, code: result === false ? 'action_failed' : 'action_applied', entity: entity };
      } catch (error) {
        report(error, { operation: 'action', adapterId: entity.type, actionId: normalizedActionId, entityKey: entity.key });
        return { ok: false, code: 'action_failed', entity: entity, error: error };
      }
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (entry) { return entry !== listener; });
      };
    }

    function invalidate(reason, types) {
      revision += 1;
      var event = Object.freeze({
        revision: revision,
        reason: asText(reason || 'workspace-changed', 160),
        types: Object.freeze(asStringList(types, 80))
      });
      listeners.slice().forEach(function (listener) {
        try { listener(event); }
        catch (error) { report(error, { operation: 'invalidate-listener' }); }
      });
      return event;
    }

    return {
      version: REGISTRY_VERSION,
      registerAdapter: registerAdapter,
      listAdapters: listAdapters,
      collect: collect,
      collectSearchable: function (context, collectOptions) {
        return collect(context, Object.assign({}, collectOptions || {}, { searchableOnly: true }));
      },
      find: find,
      getActions: getActions,
      open: open,
      runAction: runAction,
      subscribe: subscribe,
      invalidate: invalidate,
      getRevision: function () { return revision; }
    };
  }

  var api = createWorkspaceEntityRegistry({
    onError: function (error, context) {
      if (global && typeof global.SutraReportError === 'function') {
        global.SutraReportError(error, { where: 'workspace-entity-registry', detail: context || {} }, 'warning');
      }
    }
  });
  api.createWorkspaceEntityRegistry = createWorkspaceEntityRegistry;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraWorkspaceEntityRegistry = api;
}(typeof window !== 'undefined' ? window : globalThis));
