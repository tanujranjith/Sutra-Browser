/* Typed assistant action registry and transactional executor. */
(function (global) {
  'use strict';

  var MAX_ACTION_BYTES = 256000;
  var MAX_PLAN_ACTIONS = 100;
  var MAX_TARGET_SNAPSHOT_BYTES = 32000;
  var definitions = Object.create(null);
  var journal = Object.create(null);

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function safeUrl(value) {
    try {
      var url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) { return false; }
  }
  function containsMaliciousMarkup(value) {
    return /<\s*(?:script|iframe|object|embed|svg|style)\b|\bon\w+\s*=|javascript:|vbscript:|data:text\/html|url\s*\(|expression\s*\(|@import\b/i.test(String(value || ''));
  }

  function schemaFromLegacyFields(fields) {
    var properties = { type: { type: 'string', minLength: 1, maxLength: 120 } };
    var required = ['type'];
    Object.keys(fields || {}).forEach(function (name) {
      var descriptor = String(fields[name] || 'string');
      var optional = descriptor.endsWith('?');
      descriptor = descriptor.replace(/\?$/, '');
      var schema;
      if (descriptor === 'boolean') schema = { type: 'boolean' };
      else if (descriptor === 'number') schema = { type: 'number', minimum: -1000000, maximum: 1000000 };
      else if (descriptor === 'YYYY-MM-DD') schema = { type: 'string', format: 'date', maxLength: 10 };
      else if (descriptor === 'HH:MM') schema = { type: 'string', format: 'time', maxLength: 5 };
      else if (descriptor === 'markdown') schema = { type: 'string', maxLength: 100000, format: 'safe-content' };
      else if (/^string\[\]$/.test(descriptor)) schema = { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 2000 } };
      else if (descriptor.startsWith('[')) schema = { type: 'array', maxItems: 200, items: descriptor.indexOf('{') >= 0 ? { type: 'object', maxProperties: 30, additionalProperties: true } : { type: 'string', maxLength: 4000 } };
      else if (descriptor.startsWith('{')) schema = { type: 'object', maxProperties: 50, additionalProperties: true };
      else if (descriptor.indexOf('|') >= 0) schema = { type: 'string', enum: descriptor.split('|'), maxLength: 120 };
      else schema = { type: 'string', minLength: optional ? 0 : 1, maxLength: /(?:body|text|note|content)/i.test(name) ? 100000 : 4000 };
      if (/url/i.test(name)) schema.format = 'url';
      else if (/(?:body|text|note|content|title)/i.test(name)) schema.format = 'safe-content';
      properties[name] = schema;
      if (!optional) required.push(name);
    });
    return { type: 'object', properties: properties, required: required, additionalProperties: true, maxProperties: 80 };
  }

  function validateSchema(value, schema, path, issues, seen, depth) {
    if (depth > 30) { issues.push(path + ': nesting is too deep'); return; }
    if (!schema) return;
    if (value === undefined) return;
    if (schema.type === 'object') {
      if (!isObject(value)) { issues.push(path + ': expected object'); return; }
      if (seen.has(value)) { issues.push(path + ': recursive objects are not allowed'); return; }
      seen.add(value);
      var keys = Object.keys(value);
      if (schema.maxProperties && keys.length > schema.maxProperties) issues.push(path + ': too many fields');
      (schema.required || []).forEach(function (key) { if (value[key] === undefined || value[key] === null || value[key] === '') issues.push(path + '.' + key + ': required'); });
      keys.forEach(function (key) {
        if (!schema.properties || !schema.properties[key]) {
          if (schema.additionalProperties === false) issues.push(path + '.' + key + ': unknown field');
          else validateLoose(value[key], path + '.' + key, issues, seen, depth + 1, key);
          return;
        }
        validateSchema(value[key], schema.properties[key], path + '.' + key, issues, seen, depth + 1);
      });
      seen.delete(value);
      return;
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) { issues.push(path + ': expected array'); return; }
      if (schema.maxItems != null && value.length > schema.maxItems) issues.push(path + ': too many items');
      value.forEach(function (item, index) { validateSchema(item, schema.items, path + '[' + index + ']', issues, seen, depth + 1); });
      return;
    }
    if (schema.type === 'string') {
      if (typeof value !== 'string') { issues.push(path + ': expected string'); return; }
      if (schema.minLength != null && value.trim().length < schema.minLength) issues.push(path + ': too short');
      if (schema.maxLength != null && value.length > schema.maxLength) issues.push(path + ': too long');
      if (schema.enum && schema.enum.indexOf(value) < 0) issues.push(path + ': invalid enum value');
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.push(path + ': expected YYYY-MM-DD');
      if (schema.format === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) issues.push(path + ': expected HH:MM');
      if (schema.format === 'url' && value && !safeUrl(value)) issues.push(path + ': unsafe URL');
      if (schema.format === 'safe-content' && containsMaliciousMarkup(value)) issues.push(path + ': active HTML/CSS is not allowed');
      return;
    }
    if (schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) { issues.push(path + ': expected finite number'); return; }
      if (schema.minimum != null && value < schema.minimum) issues.push(path + ': below minimum');
      if (schema.maximum != null && value > schema.maximum) issues.push(path + ': above maximum');
      return;
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') issues.push(path + ': expected boolean');
  }

  function validateLoose(value, path, issues, seen, depth, key) {
    if (depth > 30) { issues.push(path + ': nesting is too deep'); return; }
    if (typeof value === 'string') {
      if (value.length > 100000) issues.push(path + ': too long');
      if (/url/i.test(String(key || '')) && value && !safeUrl(value)) issues.push(path + ': unsafe URL');
      if (containsMaliciousMarkup(value)) issues.push(path + ': active HTML/CSS is not allowed');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 500) issues.push(path + ': too many items');
      value.forEach(function (item, index) { validateLoose(item, path + '[' + index + ']', issues, seen, depth + 1, key); });
      return;
    }
    if (isObject(value)) {
      if (seen.has(value)) { issues.push(path + ': recursive objects are not allowed'); return; }
      seen.add(value);
      Object.keys(value).forEach(function (child) { validateLoose(value[child], path + '.' + child, issues, seen, depth + 1, child); });
      seen.delete(value);
    }
  }

  function normalizeDefinition(definition) {
    if (!definition || !definition.type) throw new TypeError('Action definition requires a stable type.');
    if (definitions[definition.type] && definition.replace !== true) throw new Error('Duplicate action definition: ' + definition.type);
    var def = Object.assign({
      description: '',
      schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: false },
      normalize: function (value) { return Object.assign({}, value); },
      validate: function () { return { ok: true }; },
      permissions: [],
      affectedEntities: [],
      preview: function (action) { return { label: action.type }; },
      prepare: function (action) { return { action: action }; },
      commit: function (prepared, context) { return context.commit(prepared.action); },
      rollback: function (receipt, context) { return context.rollback ? context.rollback(receipt) : false; },
      undo: function (receipt, context) { return context.undo ? context.undo(receipt) : false; },
      persistence: { required: false, strategy: 'workspace' },
      confirmation: 'writes',
      limits: {},
      audit: function (action) { return { type: action.type }; },
      destructive: false,
      readOnly: false
    }, definition);
    ['normalize', 'validate', 'preview', 'prepare', 'commit', 'rollback', 'undo', 'audit'].forEach(function (name) {
      if (typeof def[name] !== 'function') throw new TypeError(def.type + '.' + name + ' must be a function.');
    });
    return Object.freeze(def);
  }

  function register(definition) {
    var def = normalizeDefinition(definition);
    definitions[def.type] = def;
    return def;
  }
  function get(type) { return definitions[String(type || '')] || null; }
  function list() { return Object.keys(definitions).sort(); }

  function validate(action, context) {
    if (!isObject(action)) return { ok: false, error: 'Action must be an object.', issues: ['$: expected object'] };
    var def = get(action.type);
    if (!def) return { ok: false, error: 'Unknown action type: ' + String(action.type || ''), issues: ['$.type: unknown action'] };
    var serialized;
    try { serialized = JSON.stringify(action); } catch (_) { return { ok: false, error: 'Action must be serializable.', issues: ['$: recursive or invalid object'] }; }
    if (serialized.length > (def.limits.maxBytes || MAX_ACTION_BYTES)) return { ok: false, error: 'Action payload is too large.', issues: ['$: oversized payload'] };
    var normalized;
    try { normalized = def.normalize(clone(action), context || {}); }
    catch (error) { return { ok: false, error: error.message || 'Normalization failed.', issues: ['$: normalization failed'] }; }
    var issues = [];
    validateSchema(normalized, def.schema, '$', issues, new Set(), 0);
    var custom = def.validate(normalized, context || {});
    if (custom === false) issues.push('$: action-specific validation failed');
    else if (custom && custom.ok === false) issues.push(custom.error || '$: action-specific validation failed');
    if (context && context.permissions) {
      var granted = context.permissions instanceof Set ? context.permissions : new Set(context.permissions);
      def.permissions.forEach(function (permission) { if (!granted.has(permission)) issues.push('$: missing permission ' + permission); });
    }
    return issues.length ? { ok: false, error: issues[0], issues: issues, definition: def } : { ok: true, value: normalized, definition: def, issues: [] };
  }

  function requiresConfirmation(def) { return def.confirmation === 'always' || def.confirmation === 'writes' || def.confirmation === 'destructive' || def.destructive; }

  function stableHash(value) {
    var text = JSON.stringify(value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizePlanRows(input) {
    var source = Array.isArray(input) ? input : (input && Array.isArray(input.actions) ? input.actions : []);
    return source.map(function (row, index) {
      var wrapped = isObject(row) && isObject(row.action);
      var action = clone(wrapped ? row.action : row);
      if (!wrapped && isObject(action)) {
        delete action.planActionId;
        delete action.dependsOn;
      }
      return {
        id: String((wrapped && row.id) || (!wrapped && row && row.planActionId) || ('step-' + (index + 1))),
        action: action,
        dependsOn: (Array.isArray(row && row.dependsOn) ? row.dependsOn : []).map(String),
        index: index
      };
    });
  }

  /**
   * Validate an entire assistant plan without mutating workspace state. The
   * result is suitable for a human review screen and is the only accepted
   * input to applyPlan(). Dependencies must reference an earlier step so the
   * displayed order is also the execution order.
   */
  function previewPlan(input, context) {
    var ctx = context || {};
    // A student must be able to inspect a proposed plan before granting write
    // or destructive permission. Permission enforcement belongs to Apply;
    // callers may opt into stricter preview-time enforcement explicitly.
    var validationContext = ctx;
    if (ctx.enforcePermissionsOnPreview !== true && Object.prototype.hasOwnProperty.call(ctx, 'permissions')) {
      validationContext = Object.assign({}, ctx);
      delete validationContext.permissions;
    }
    var rows = normalizePlanRows(input);
    if (!rows.length) return { ok: false, code: 'empty_plan', steps: [], issues: ['Plan has no actions.'] };
    if (rows.length > (ctx.maxActions || MAX_PLAN_ACTIONS)) return { ok: false, code: 'plan_too_large', steps: [], issues: ['Plan has too many actions.'] };
    var seenIds = new Set();
    var issues = [];
    var steps = rows.map(function (row, index) {
      if (!row.id || seenIds.has(row.id)) issues.push('Step ' + (index + 1) + ': duplicate or missing id.');
      row.dependsOn.forEach(function (dependency) {
        if (!seenIds.has(dependency)) issues.push('Step ' + (index + 1) + ': dependency "' + dependency + '" must reference an earlier step.');
      });
      seenIds.add(row.id);
      var checked = validate(row.action, validationContext);
      if (!checked.ok) issues.push('Step ' + (index + 1) + ': ' + checked.error);
      var def = checked.definition || get(row.action && row.action.type);
      var preview = null;
      var targetSnapshot = null;
      if (checked.ok && def) {
        try { preview = def.preview(checked.value, ctx); }
        catch (error) { issues.push('Step ' + (index + 1) + ': preview failed: ' + (error.message || String(error))); }
        if (typeof ctx.snapshot === 'function') {
          try {
            var rawSnapshot = ctx.snapshot(checked.value, { id: row.id, index: index, definition: def });
            targetSnapshot = rawSnapshot === undefined ? null : clone(rawSnapshot);
            if (JSON.stringify(targetSnapshot).length > MAX_TARGET_SNAPSHOT_BYTES) {
              targetSnapshot = null;
              issues.push('Step ' + (index + 1) + ': target snapshot is too large.');
            }
          } catch (error) {
            issues.push('Step ' + (index + 1) + ': target snapshot failed: ' + (error.message || String(error)));
          }
        }
      }
      return {
        id: row.id,
        index: index,
        type: String(row.action && row.action.type || ''),
        dependsOn: row.dependsOn.slice(),
        action: checked.ok ? checked.value : row.action,
        preview: preview || { label: String(row.action && row.action.type || 'Unknown action') },
        permissions: def ? def.permissions.slice() : [],
        affectedEntities: def ? def.affectedEntities.slice() : [],
        destructive: !!(def && def.destructive),
        requiresConfirmation: !!(def && requiresConfirmation(def)),
        targetSnapshot: targetSnapshot,
        valid: checked.ok
      };
    });
    var normalizedActions = steps.map(function (step) { return step.action; });
    var targetSnapshots = steps.map(function (step) { return [step.id, step.targetSnapshot]; });
    var stateFingerprint = stableHash(targetSnapshots);
    var previewId = 'plan_' + stableHash({ actions: normalizedActions, dependencies: steps.map(function (step) { return [step.id, step.dependsOn]; }), targetSnapshots: targetSnapshots });
    return {
      ok: issues.length === 0,
      code: issues.length ? 'validation_failed' : 'ready_for_review',
      previewId: previewId,
      steps: steps,
      issues: issues,
      affectedEntities: Array.from(new Set(steps.flatMap(function (step) { return step.affectedEntities; }))).sort(),
      permissions: Array.from(new Set(steps.flatMap(function (step) { return step.permissions; }))).sort(),
      destructive: steps.some(function (step) { return step.destructive; }),
      stateFingerprint: stateFingerprint,
      normalizedActions: normalizedActions
    };
  }

  function executeSync(action, context) {
    var ctx = context || {};
    var checked = validate(action, ctx);
    if (!checked.ok) return { ok: false, code: 'validation_failed', message: checked.error, issues: checked.issues };
    var def = checked.definition;
    if (requiresConfirmation(def) && ctx.confirmed !== true) return { ok: false, code: 'confirmation_required', message: 'Explicit confirmation is required.' };
    var key = String(ctx.idempotencyKey || '');
    if (key && journal[key] && journal[key].status === 'committed') return Object.assign({ repeated: true }, journal[key].result);
    var prepared;
    try {
      prepared = def.prepare(checked.value, ctx);
      var result = def.commit(prepared, ctx);
      if (result && typeof result.then === 'function') throw new Error('Async action used with executeSync.');
      if (!result || result.ok === false) throw new Error(result && (result.message || result.error) || 'Action commit failed.');
      if (def.persistence.required && typeof ctx.persist === 'function') ctx.persist(def.persistence.strategy);
      var receipt = { ok: true, result: result, prepared: prepared, definition: def, audit: def.audit(checked.value, ctx) };
      if (key) journal[key] = { status: 'committed', result: receipt };
      return receipt;
    } catch (error) {
      try { if (prepared) def.rollback({ error: error, prepared: prepared }, ctx); } catch (_) {}
      return { ok: false, code: 'commit_failed', message: error.message || String(error) };
    }
  }

  async function executePlan(actions, context) {
    var ctx = context || {};
    if (!Array.isArray(actions) || !actions.length) return { ok: false, code: 'empty_plan', outcomes: [] };
    if (actions.length > (ctx.maxActions || MAX_PLAN_ACTIONS)) return { ok: false, code: 'plan_too_large', outcomes: [] };
    var prepared = [];
    var committed = [];
    var outcomes = [];
    for (var i = 0; i < actions.length; i += 1) {
      var checked = validate(actions[i], ctx);
      if (!checked.ok) return { ok: false, code: 'validation_failed', failedIndex: i, outcomes: outcomes, issues: checked.issues };
      if (requiresConfirmation(checked.definition) && ctx.confirmed !== true) return { ok: false, code: 'confirmation_required', failedIndex: i, outcomes: outcomes };
      try { prepared.push({ checked: checked, value: await checked.definition.prepare(checked.value, ctx) }); }
      catch (error) { return { ok: false, code: 'prepare_failed', failedIndex: i, message: error.message, outcomes: outcomes }; }
    }
    try {
      for (var index = 0; index < prepared.length; index += 1) {
        var row = prepared[index];
        var result = await row.checked.definition.commit(row.value, ctx);
        if (!result || result.ok === false) throw Object.assign(new Error(result && (result.message || result.error) || 'Commit failed.'), { failedIndex: index });
        committed.push({ row: row, result: result, index: index });
        outcomes.push({ index: index, type: row.checked.value.type, status: 'committed', result: result });
      }
      if (typeof ctx.persist === 'function') await ctx.persist('assistant-action-plan');
      return { ok: true, code: 'committed', outcomes: outcomes, receipts: committed };
    } catch (error) {
      var rollbackFailures = [];
      for (var r = committed.length - 1; r >= 0; r -= 1) {
        try {
          await committed[r].row.checked.definition.rollback(committed[r], ctx);
          outcomes[committed[r].index].status = 'rolled_back';
        } catch (rollbackError) {
          outcomes[committed[r].index].status = 'rollback_failed';
          rollbackFailures.push({ index: committed[r].index, message: rollbackError.message || String(rollbackError) });
        }
      }
      var failedIndex = Number.isInteger(error.failedIndex) ? error.failedIndex : committed.length;
      outcomes.push({ index: failedIndex, type: actions[failedIndex] && actions[failedIndex].type, status: 'failed', message: error.message || String(error) });
      return { ok: false, code: rollbackFailures.length ? 'partial_rollback' : 'rolled_back', failedIndex: failedIndex, outcomes: outcomes, rollbackFailures: rollbackFailures };
    }
  }

  async function applyPlan(preview, context) {
    var ctx = context || {};
    if (!preview || preview.ok !== true || !preview.previewId || !Array.isArray(preview.normalizedActions)) {
      return { ok: false, code: 'invalid_preview', outcomes: [], warnings: ['Create a fresh valid preview before applying this plan.'] };
    }
    if (ctx.reviewed !== true) {
      return { ok: false, code: 'review_required', outcomes: [], warnings: ['Explicit review is required before applying assistant actions.'] };
    }
    var freshPreview = previewPlan(preview.steps.map(function (step) {
      return { id: step.id, action: step.action, dependsOn: step.dependsOn };
    }), ctx);
    if (!freshPreview.ok) {
      return { ok: false, code: 'validation_failed', outcomes: [], warnings: freshPreview.issues || ['The plan is no longer valid.'] };
    }
    if (freshPreview.previewId !== preview.previewId || freshPreview.stateFingerprint !== preview.stateFingerprint) {
      return { ok: false, code: 'stale_preview', outcomes: [], warnings: ['The plan changed after preview. Review it again before applying.'] };
    }
    for (var permissionIndex = 0; permissionIndex < preview.normalizedActions.length; permissionIndex += 1) {
      var permissionCheck = validate(preview.normalizedActions[permissionIndex], ctx);
      if (!permissionCheck.ok) {
        var missingPermission = (permissionCheck.issues || []).some(function (issue) { return /missing permission/.test(issue); });
        return {
          ok: false,
          code: missingPermission ? 'permission_denied' : 'validation_failed',
          outcomes: [],
          warnings: permissionCheck.issues || [permissionCheck.error || 'The plan is not authorized.']
        };
      }
    }
    var planKey = 'plan:' + preview.previewId;
    if (journal[planKey] && journal[planKey].status === 'committed') {
      return Object.assign({ repeated: true }, journal[planKey].result);
    }
    var executionContext = Object.assign({}, ctx, { confirmed: true });
    var result = await executePlan(preview.normalizedActions, executionContext);
    var changedIds = [];
    (result.outcomes || []).forEach(function (outcome) {
      var value = outcome && outcome.result;
      if (!value || typeof value !== 'object') return;
      ['id', 'changedId', 'createdId'].forEach(function (key) { if (value[key] != null) changedIds.push(String(value[key])); });
      if (Array.isArray(value.changedIds)) value.changedIds.forEach(function (id) { changedIds.push(String(id)); });
    });
    var planReceipt = Object.assign({}, result, {
      planId: preview.previewId,
      changedIds: Array.from(new Set(changedIds)),
      warnings: result.ok ? [] : ['The plan did not fully apply. Review the per-step outcomes.'],
      undo: result.ok ? { kind: 'assistant-plan', planId: preview.previewId, available: true } : { kind: 'assistant-plan', planId: preview.previewId, available: false },
      persistence: { status: result.ok ? 'persisted' : (result.code === 'partial_rollback' ? 'uncertain' : 'rolled_back') }
    });
    if (planReceipt.ok) journal[planKey] = { status: 'committed', result: planReceipt };
    return planReceipt;
  }

  async function rollbackPlan(receipt, context) {
    if (!receipt || receipt.ok !== true || !Array.isArray(receipt.receipts)) {
      return { ok: false, code: 'rollback_unavailable', outcomes: [], persistence: { status: 'unchanged' } };
    }
    var ctx = context || {};
    var outcomes = [];
    for (var i = receipt.receipts.length - 1; i >= 0; i -= 1) {
      var committed = receipt.receipts[i];
      try {
        await committed.row.checked.definition.rollback(committed, ctx);
        outcomes.push({ index: committed.index, type: committed.row.checked.value.type, status: 'rolled_back' });
      } catch (error) {
        outcomes.push({ index: committed.index, type: committed.row.checked.value.type, status: 'rollback_failed', message: error.message || String(error) });
      }
    }
    var ok = outcomes.every(function (row) { return row.status === 'rolled_back'; });
    if (ok && receipt.planId && journal['plan:' + receipt.planId]) journal['plan:' + receipt.planId].status = 'rolled_back';
    if (ok && typeof ctx.persist === 'function') {
      try { await ctx.persist('assistant-action-plan-rollback'); }
      catch (error) { return { ok: false, code: 'rollback_persistence_failed', outcomes: outcomes, message: error.message || String(error), persistence: { status: 'failed' } }; }
    }
    return {
      ok: ok,
      code: ok ? 'rolled_back' : 'partial_rollback',
      outcomes: outcomes.sort(function (a, b) { return a.index - b.index; }),
      changedIds: Array.isArray(receipt.changedIds) ? receipt.changedIds.slice() : [],
      warnings: ok ? [] : ['Some actions could not be rolled back.'],
      undo: { kind: 'assistant-plan', planId: receipt.planId || '', available: false },
      persistence: { status: ok ? 'persisted' : 'uncertain' }
    };
  }

  async function undoReceipt(receipt, context) {
    if (!receipt || !receipt.definition || typeof receipt.definition.undo !== 'function') return { ok: false, code: 'undo_unavailable' };
    try {
      var result = await receipt.definition.undo(receipt, context || {});
      return result && typeof result === 'object' ? result : { ok: result !== false };
    } catch (error) { return { ok: false, code: 'undo_failed', message: error.message || String(error) }; }
  }

  var api = { VERSION: '2.2.0', register: register, get: get, list: list, validate: validate, executeSync: executeSync, executePlan: executePlan, previewPlan: previewPlan, applyPlan: applyPlan, rollbackPlan: rollbackPlan, undo: undoReceipt, schemaFromLegacyFields: schemaFromLegacyFields, _journal: journal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraAssistantActionSystem = api;
}(typeof window !== 'undefined' ? window : globalThis));
