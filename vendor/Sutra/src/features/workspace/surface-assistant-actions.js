/* Pure, dual-mode Canvas/Slides operation engine for reviewed Assistant edits. */
(function (global) {
  'use strict';

  var MAX_OPERATIONS = 24;
  var MAX_CANVAS_OBJECTS = 1200;
  var MAX_CANVAS_CONNECTIONS = 1200;
  var MAX_CANVAS_GROUPS = 300;
  var CANVAS_TYPES = ['text', 'sticky', 'shape', 'frame', 'table'];
  var CANVAS_SHAPES = ['rectangle', 'rounded', 'ellipse', 'diamond', 'triangle'];
  var CANVAS_BACKGROUNDS = ['blank', 'grid', 'dots', 'dark-grid'];
  var SLIDE_LAYOUTS = ['title', 'title-body', 'two-column', 'three-card', 'image-caption', 'blank'];
  var SLIDE_THEMES = ['sutra', 'nature', 'midnight', 'paper'];
  var SLIDE_SIZES = ['widescreen', 'standard'];
  var SLIDE_ELEMENT_TYPES = ['text', 'shape', 'chart'];

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function text(value, max) { return String(value == null ? '' : value).slice(0, max || 8000); }
  function finite(value, fallback, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }
  function color(value, fallback) {
    var next = String(value || '').trim();
    if (!next) return fallback || '';
    if (/^#[0-9a-f]{3,8}$/i.test(next) || /^var\(--[a-z0-9_-]+\)$/i.test(next) || /^[a-z]+$/i.test(next)) return next.slice(0, 64);
    return fallback || '';
  }
  function validColor(value) {
    var next = String(value || '').trim();
    return !next || /^#[0-9a-f]{3,8}$/i.test(next) || /^var\(--[a-z0-9_-]+\)$/i.test(next) || /^[a-z]+$/i.test(next);
  }
  function uniqueIds(value, max) {
    var seen = Object.create(null);
    return (Array.isArray(value) ? value : []).slice(0, max || 60).map(function (id) { return text(id, 180).trim(); }).filter(function (id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce(function (out, key) { out[key] = stable(value[key]); return out; }, {});
  }
  function fingerprint(value) {
    var input = JSON.stringify(stable(value));
    var hash = 2166136261;
    for (var index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  function failure(message, index, code) { return { ok: false, code: code || 'invalid_operation', error: message, operationIndex: index }; }
  function optionsFor(options) {
    var opts = options || {};
    var sequence = 0;
    return {
      now: text(opts.now || new Date().toISOString(), 40),
      id: typeof opts.idFactory === 'function' ? opts.idFactory : function () { sequence += 1; return 'assistant_surface_' + sequence; }
    };
  }

  function ensureCanvas(model) {
    var source = model && typeof model === 'object' ? clone(model) : {};
    if (!Array.isArray(source.objects)) source.objects = [];
    if (!Array.isArray(source.connections)) source.connections = [];
    if (!Array.isArray(source.groups)) source.groups = [];
    if (CANVAS_BACKGROUNDS.indexOf(source.background) < 0) source.background = 'grid';
    return source;
  }
  function canvasObjectFields(raw, type, runtime, index) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var objectType = CANVAS_TYPES.indexOf(type) >= 0 ? type : 'text';
    var column = index % 3;
    var rowIndex = Math.floor(index / 3);
    var width = objectType === 'frame' ? 520 : (objectType === 'sticky' ? 220 : (objectType === 'table' ? 360 : 240));
    var height = objectType === 'frame' ? 320 : (objectType === 'sticky' ? 140 : (objectType === 'table' ? 220 : 120));
    var object = {
      id: text(runtime.id(), 180),
      type: objectType,
      x: finite(row.x, 80 + column * 270, -1000000, 1000000),
      y: finite(row.y, 80 + rowIndex * 180, -1000000, 1000000),
      width: finite(row.width, width, 24, 10000),
      height: finite(row.height, height, 24, 10000),
      rotation: finite(row.rotation, 0, -360, 360),
      zIndex: Math.round(finite(row.zIndex, 0, -10000, 10000)),
      locked: false,
      groupId: '',
      text: text(row.text, 8000),
      label: text(row.label, 500),
      color: color(row.color, ''),
      fill: color(row.fill, objectType === 'sticky' ? '#f6d56f' : ''),
      stroke: color(row.stroke, ''),
      strokeWidth: finite(row.strokeWidth, 2, 0, 64),
      createdAt: runtime.now,
      updatedAt: runtime.now,
      points: [],
      ref: null
    };
    if (objectType === 'shape') object.shape = CANVAS_SHAPES.indexOf(row.shape) >= 0 ? row.shape : 'rounded';
    if (objectType === 'table') {
      object.cells = (Array.isArray(row.cells) ? row.cells : [['Topic', 'Notes'], ['', '']]).slice(0, 20).map(function (cells) {
        return (Array.isArray(cells) ? cells : []).slice(0, 10).map(function (cell) { return text(cell, 500); });
      });
    }
    return object;
  }
  function canvasPatchRow(token, object) {
    var row = token.objectPatches.find(function (item) { return item.id === object.id; });
    if (!row) { row = { id: object.id, before: {} }; token.objectPatches.push(row); }
    return row;
  }
  function rememberCanvasFields(token, object, keys) {
    var row = canvasPatchRow(token, object);
    keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(row.before, key)) row.before[key] = clone(object[key]);
    });
  }
  function canvasStateForToken(model, token) {
    var objects = Array.isArray(model.objects) ? model.objects : [];
    var connections = Array.isArray(model.connections) ? model.connections : [];
    var groups = Array.isArray(model.groups) ? model.groups : [];
    return {
      patchedObjects: token.objectPatches.map(function (patch) {
        var object = objects.find(function (item) { return item && item.id === patch.id; });
        var values = {};
        Object.keys(patch.before).forEach(function (key) { values[key] = object ? clone(object[key]) : undefined; });
        return { id: patch.id, values: values };
      }),
      createdObjects: token.createdObjectIds.map(function (id) { return objects.find(function (item) { return item && item.id === id; }) || null; }),
      createdConnections: token.createdConnectionIds.map(function (id) { return connections.find(function (item) { return item && item.id === id; }) || null; }),
      createdGroups: token.createdGroupIds.map(function (id) { return groups.find(function (item) { return item && item.id === id; }) || null; }),
      background: token.beforeBackground !== undefined ? model.background : undefined
    };
  }
  function applyCanvas(model, operations, options) {
    var source = ensureCanvas(model);
    var draft = clone(source);
    var list = Array.isArray(operations) ? operations : [];
    if (!list.length) return failure('Canvas edits need at least one operation.', -1, 'empty_operations');
    if (list.length > MAX_OPERATIONS) return failure('Canvas edits are limited to 24 reviewed operations.', -1, 'too_many_operations');
    var runtime = optionsFor(options);
    var token = { kind: 'canvas_assistant_patch', version: 1, objectPatches: [], createdObjectIds: [], createdConnectionIds: [], createdGroupIds: [] };
    var clientIds = Object.create(null);
    function resolveCanvasId(value) { var id = text(value, 180).trim(); return clientIds[id] || id; }
    for (var index = 0; index < list.length; index += 1) {
      var operation = list[index] && typeof list[index] === 'object' ? list[index] : {};
      var type = String(operation.type || '').trim();
      if (type === 'add') {
        var objectType = String(operation.objectType || 'text').trim();
        if (CANVAS_TYPES.indexOf(objectType) < 0) return failure('Unsupported Canvas object type at step ' + (index + 1) + '.', index);
        if (draft.objects.length >= MAX_CANVAS_OBJECTS) return failure('This Canvas has reached its object limit.', index, 'surface_limit');
        if (['color', 'fill', 'stroke'].some(function (key) { return Object.prototype.hasOwnProperty.call(operation, key) && !validColor(operation[key]); })) return failure('Canvas colors must be named colors, hex values, or Sutra color tokens.', index);
        var object = canvasObjectFields(operation, objectType, runtime, draft.objects.length);
        if (draft.objects.some(function (item) { return item && item.id === object.id; })) return failure('Canvas generated a duplicate object id.', index);
        draft.objects.push(object);
        token.createdObjectIds.push(object.id);
        var clientId = text(operation.clientId, 80).trim();
        if (clientId) {
          if (clientIds[clientId] || source.objects.some(function (item) { return item && item.id === clientId; })) return failure('Canvas clientId values must be unique and cannot shadow existing object ids.', index);
          clientIds[clientId] = object.id;
        }
      } else if (type === 'update') {
        var targetId = resolveCanvasId(operation.objectId);
        var target = draft.objects.find(function (item) { return item && String(item.id) === targetId; });
        if (!target) return failure('Canvas object not found at step ' + (index + 1) + '.', index, 'target_missing');
        if (target.locked) return failure('Unlock the Canvas object before editing it.', index, 'target_locked');
        var patch = operation.patch && typeof operation.patch === 'object' ? operation.patch : {};
        var keys = ['text', 'label', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'fill', 'stroke', 'strokeWidth', 'shape'];
        var requested = keys.filter(function (key) { return Object.prototype.hasOwnProperty.call(patch, key); });
        if (!requested.length) return failure('Canvas update has no supported fields.', index);
        if (requested.indexOf('shape') >= 0 && target.type !== 'shape') return failure('Only shape objects accept a shape style.', index);
        if (['fill', 'stroke'].some(function (key) { return Object.prototype.hasOwnProperty.call(patch, key) && !validColor(patch[key]); })) return failure('Canvas colors must be named colors, hex values, or Sutra color tokens.', index);
        rememberCanvasFields(token, target, requested.concat(['updatedAt']));
        requested.forEach(function (key) {
          if (key === 'text') target.text = text(patch.text, 8000);
          else if (key === 'label') target.label = text(patch.label, 500);
          else if (key === 'x' || key === 'y') target[key] = finite(patch[key], target[key], -1000000, 1000000);
          else if (key === 'width' || key === 'height') target[key] = finite(patch[key], target[key], 24, 10000);
          else if (key === 'rotation') target.rotation = finite(patch.rotation, target.rotation, -360, 360);
          else if (key === 'zIndex') target.zIndex = Math.round(finite(patch.zIndex, target.zIndex, -10000, 10000));
          else if (key === 'fill' || key === 'stroke') target[key] = color(patch[key], target[key]);
          else if (key === 'strokeWidth') target.strokeWidth = finite(patch.strokeWidth, target.strokeWidth, 0, 64);
          else if (key === 'shape' && target.type === 'shape') target.shape = CANVAS_SHAPES.indexOf(patch.shape) >= 0 ? patch.shape : target.shape;
        });
        target.updatedAt = runtime.now;
      } else if (type === 'arrange') {
        var arrangeIds = uniqueIds(operation.objectIds, 40).map(resolveCanvasId);
        if (arrangeIds.length < 2) return failure('Canvas arrangement needs at least two object ids.', index);
        var arranged = arrangeIds.map(function (id) { return draft.objects.find(function (item) { return item && item.id === id; }); });
        if (arranged.some(function (item) { return !item; })) return failure('A Canvas arrangement target no longer exists.', index, 'target_missing');
        if (arranged.some(function (item) { return item.locked; })) return failure('Unlock every Canvas object before arranging it.', index, 'target_locked');
        var layout = ['row', 'column', 'grid'].indexOf(operation.layout) >= 0 ? operation.layout : 'grid';
        var gap = finite(operation.gap, 32, 0, 500);
        var startX = Math.min.apply(Math, arranged.map(function (item) { return Number(item.x) || 0; }));
        var startY = Math.min.apply(Math, arranged.map(function (item) { return Number(item.y) || 0; }));
        var cellWidth = Math.max.apply(Math, arranged.map(function (item) { return Number(item.width) || 220; })) + gap;
        var cellHeight = Math.max.apply(Math, arranged.map(function (item) { return Number(item.height) || 120; })) + gap;
        var columns = layout === 'grid' ? Math.ceil(Math.sqrt(arranged.length)) : (layout === 'row' ? arranged.length : 1);
        arranged.forEach(function (item, itemIndex) {
          rememberCanvasFields(token, item, ['x', 'y', 'updatedAt']);
          item.x = startX + (itemIndex % columns) * cellWidth;
          item.y = startY + Math.floor(itemIndex / columns) * cellHeight;
          item.updatedAt = runtime.now;
        });
      } else if (type === 'connect') {
        if (draft.connections.length >= MAX_CANVAS_CONNECTIONS) return failure('This Canvas has reached its connection limit.', index, 'surface_limit');
        var fromId = resolveCanvasId(operation.fromId);
        var toId = resolveCanvasId(operation.toId);
        if (!fromId || !toId || fromId === toId) return failure('Canvas connections need two different object ids.', index);
        if (Object.prototype.hasOwnProperty.call(operation, 'color') && !validColor(operation.color)) return failure('Canvas connection color is invalid.', index);
        if (!draft.objects.some(function (item) { return item && item.id === fromId; }) || !draft.objects.some(function (item) { return item && item.id === toId; })) return failure('A Canvas connection target no longer exists.', index, 'target_missing');
        var connection = { id: text(runtime.id(), 180), fromId: fromId, toId: toId, label: text(operation.label, 500), direction: ['none', 'forward', 'backward', 'both'].indexOf(operation.direction) >= 0 ? operation.direction : 'forward', color: color(operation.color, ''), strokeWidth: finite(operation.strokeWidth, 2, 1, 16), createdAt: runtime.now, updatedAt: runtime.now };
        draft.connections.push(connection);
        token.createdConnectionIds.push(connection.id);
      } else if (type === 'group') {
        if (draft.groups.length >= MAX_CANVAS_GROUPS) return failure('This Canvas has reached its group limit.', index, 'surface_limit');
        var groupIds = uniqueIds(operation.objectIds, 40).map(resolveCanvasId);
        if (groupIds.length < 2) return failure('Canvas grouping needs at least two object ids.', index);
        var grouped = groupIds.map(function (id) { return draft.objects.find(function (item) { return item && item.id === id; }); });
        if (grouped.some(function (item) { return !item; })) return failure('A Canvas group target no longer exists.', index, 'target_missing');
        if (grouped.some(function (item) { return item.locked; })) return failure('Unlock every Canvas object before grouping it.', index, 'target_locked');
        var groupId = text(runtime.id(), 180);
        var group = { id: groupId, label: text(operation.label || 'Group', 500), objectIds: groupIds, locked: false, createdAt: runtime.now, updatedAt: runtime.now };
        grouped.forEach(function (item) { rememberCanvasFields(token, item, ['groupId', 'updatedAt']); item.groupId = groupId; item.updatedAt = runtime.now; });
        draft.groups.push(group);
        token.createdGroupIds.push(groupId);
      } else if (type === 'background') {
        if (CANVAS_BACKGROUNDS.indexOf(operation.value) < 0) return failure('Unsupported Canvas background.', index);
        if (token.beforeBackground === undefined) token.beforeBackground = source.background;
        draft.background = operation.value;
      } else {
        return failure('Unknown Canvas operation at step ' + (index + 1) + '.', index);
      }
    }
    token.afterFingerprint = fingerprint(canvasStateForToken(draft, token));
    return { ok: true, model: draft, undo: token, operationCount: list.length, createdObjectIds: token.createdObjectIds.slice(), createdConnectionIds: token.createdConnectionIds.slice(), createdGroupIds: token.createdGroupIds.slice(), clientIds: clone(clientIds) };
  }
  function undoCanvas(model, token) {
    var draft = ensureCanvas(model);
    if (!token || token.kind !== 'canvas_assistant_patch') return failure('Invalid Canvas undo token.', -1, 'invalid_undo');
    if (fingerprint(canvasStateForToken(draft, token)) !== token.afterFingerprint) return failure('Canvas changed after the Assistant edit. Review the board before undoing.', -1, 'stale_surface');
    var createdObjects = new Set(token.createdObjectIds || []);
    var createdConnections = new Set(token.createdConnectionIds || []);
    var createdGroups = new Set(token.createdGroupIds || []);
    draft.objects = draft.objects.filter(function (item) { return !createdObjects.has(item.id); });
    draft.connections = draft.connections.filter(function (item) { return !createdConnections.has(item.id) && !createdObjects.has(item.fromId) && !createdObjects.has(item.toId); });
    draft.groups = draft.groups.filter(function (item) { return !createdGroups.has(item.id); }).map(function (group) { group.objectIds = group.objectIds.filter(function (id) { return !createdObjects.has(id); }); return group; }).filter(function (group) { return group.objectIds.length; });
    (token.objectPatches || []).forEach(function (patch) {
      var object = draft.objects.find(function (item) { return item && item.id === patch.id; });
      if (object) Object.keys(patch.before || {}).forEach(function (key) { object[key] = clone(patch.before[key]); });
    });
    if (token.beforeBackground !== undefined) draft.background = token.beforeBackground;
    return { ok: true, model: draft };
  }

  function ensureDeck(model) {
    var source = model && typeof model === 'object' ? clone(model) : {};
    source.version = Number(source.version) || 1;
    if (SLIDE_THEMES.indexOf(source.theme) < 0) source.theme = 'sutra';
    if (SLIDE_SIZES.indexOf(source.size) < 0) source.size = 'widescreen';
    if (!Array.isArray(source.slides)) source.slides = [];
    return source;
  }
  function slideElement(raw, runtime, index) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var requestedType = row.elementType || row.type || 'text';
    if (SLIDE_ELEMENT_TYPES.indexOf(requestedType) < 0 || row.dataUrl || row.url || row.src) return null;
    if (['fill', 'color', 'borderColor'].some(function (key) { return Object.prototype.hasOwnProperty.call(row, key) && !validColor(row[key]); })) return null;
    var type = requestedType;
    var element = { id: text(runtime.id(), 180), type: type, x: finite(row.x, 10 + (index % 3) * 28, 0, 96), y: finite(row.y, 18 + Math.floor(index / 3) * 24, 0, 94), width: finite(row.width, type === 'text' ? 42 : 24, 2, 100), height: finite(row.height, type === 'text' ? 12 : 20, 2, 100), zIndex: Math.round(finite(row.zIndex, index, -1000, 1000)), text: text(row.text, 8000), fontSize: finite(row.fontSize, type === 'text' ? 4 : 3, 1, 18), fontWeight: ['normal', 'bold'].indexOf(row.fontWeight) >= 0 ? row.fontWeight : 'normal', fill: color(row.fill, type === 'shape' ? '#e9e6db' : 'transparent'), color: color(row.color, '#173d2b'), borderColor: color(row.borderColor, '#d7d3c7'), borderWidth: finite(row.borderWidth, type === 'shape' ? 1 : 0, 0, 16), assetFileId: '' };
    if (type === 'chart') {
      var chart = row.chart && typeof row.chart === 'object' ? row.chart : {};
      element.chart = { labels: (Array.isArray(chart.labels) ? chart.labels : ['A', 'B', 'C']).slice(0, 12).map(function (label) { return text(label, 100); }), values: (Array.isArray(chart.values) ? chart.values : [5, 8, 4]).slice(0, 12).map(function (value) { return finite(value, 0, -1000000, 1000000); }) };
      if (element.chart.labels.length !== element.chart.values.length) return null;
    }
    return element;
  }
  function slideFor(raw, runtime, index) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var layout = SLIDE_LAYOUTS.indexOf(row.layout) >= 0 ? row.layout : 'title-body';
    var title = text(row.title || ('Slide ' + (index + 1)), 300);
    var rawElements = (Array.isArray(row.elements) ? row.elements : []).slice(0, 30);
    var elements = rawElements.map(function (element, elementIndex) { return slideElement(element, runtime, elementIndex); });
    if (elements.some(function (element) { return !element; })) return null;
    if (!elements.length && layout !== 'blank') {
      elements.push(slideElement({ elementType: 'text', x: 8, y: 8, width: 80, height: 16, text: title, fontSize: 6, fontWeight: 'bold' }, runtime, 0));
      if (layout !== 'title') elements.push(slideElement({ elementType: 'text', x: 10, y: 28, width: 72, height: 36, text: text(row.body || 'Add a focused supporting point.', 8000), fontSize: 3 }, runtime, 1));
    }
    return { id: text(runtime.id(), 180), layout: layout, title: title, background: color(row.background, ''), speakerNotes: text(row.speakerNotes, 20000), elements: elements };
  }
  function slidePatchRow(token, slide) {
    var row = token.slidePatches.find(function (item) { return item.id === slide.id; });
    if (!row) { row = { id: slide.id, before: {} }; token.slidePatches.push(row); }
    return row;
  }
  function elementPatchRow(token, slideId, element) {
    var row = token.elementPatches.find(function (item) { return item.slideId === slideId && item.id === element.id; });
    if (!row) { row = { slideId: slideId, id: element.id, before: {} }; token.elementPatches.push(row); }
    return row;
  }
  function rememberFields(row, target, keys) { keys.forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(row.before, key)) row.before[key] = clone(target[key]); }); }
  function slidesStateForToken(deck, token) {
    return {
      patchedSlides: token.slidePatches.map(function (patch) { var slide = deck.slides.find(function (item) { return item && item.id === patch.id; }); var values = {}; Object.keys(patch.before).forEach(function (key) { values[key] = slide ? clone(slide[key]) : undefined; }); return { id: patch.id, values: values }; }),
      patchedElements: token.elementPatches.map(function (patch) { var slide = deck.slides.find(function (item) { return item && item.id === patch.slideId; }); var element = slide && slide.elements.find(function (item) { return item && item.id === patch.id; }); var values = {}; Object.keys(patch.before).forEach(function (key) { values[key] = element ? clone(element[key]) : undefined; }); return { slideId: patch.slideId, id: patch.id, values: values }; }),
      createdSlides: token.createdSlideIds.map(function (id) { return deck.slides.find(function (item) { return item && item.id === id; }) || null; }),
      createdElements: token.createdElements.map(function (ref) { var slide = deck.slides.find(function (item) { return item && item.id === ref.slideId; }); return { slideId: ref.slideId, element: slide && slide.elements.find(function (item) { return item && item.id === ref.id; }) || null }; }),
      order: token.beforeOrder ? deck.slides.map(function (slide) { return slide.id; }) : undefined,
      theme: token.beforeTheme !== undefined ? deck.theme : undefined,
      size: token.beforeSize !== undefined ? deck.size : undefined
    };
  }
  function applySlides(model, operations, options) {
    var source = ensureDeck(model);
    var draft = clone(source);
    var list = Array.isArray(operations) ? operations : [];
    if (!list.length) return failure('Slides edits need at least one operation.', -1, 'empty_operations');
    if (list.length > MAX_OPERATIONS) return failure('Slides edits are limited to 24 reviewed operations.', -1, 'too_many_operations');
    var runtime = optionsFor(options);
    var token = { kind: 'slides_assistant_patch', version: 1, slidePatches: [], elementPatches: [], createdSlideIds: [], createdElements: [] };
    for (var index = 0; index < list.length; index += 1) {
      var operation = list[index] && typeof list[index] === 'object' ? list[index] : {};
      var type = String(operation.type || '').trim();
      if (type === 'add_slide') {
        var slide = slideFor(operation, runtime, draft.slides.length);
        if (!slide) return failure('Slides Assistant can create only local text, shape, and chart elements with safe colors.', index);
        var afterId = text(operation.afterSlideId, 180).trim();
        var insertion = afterId ? draft.slides.findIndex(function (item) { return item && item.id === afterId; }) + 1 : draft.slides.length;
        if (afterId && insertion === 0) return failure('The requested preceding slide no longer exists.', index, 'target_missing');
        draft.slides.splice(insertion, 0, slide);
        token.createdSlideIds.push(slide.id);
      } else if (type === 'update_slide') {
        var targetSlide = draft.slides.find(function (item) { return item && item.id === String(operation.slideId || ''); });
        if (!targetSlide) return failure('Slide not found at step ' + (index + 1) + '.', index, 'target_missing');
        var slideKeys = ['title', 'layout', 'background', 'speakerNotes'];
        var requestedSlideKeys = slideKeys.filter(function (key) { return Object.prototype.hasOwnProperty.call(operation, key); });
        if (!requestedSlideKeys.length) return failure('Slide update has no supported fields.', index);
        if (requestedSlideKeys.indexOf('background') >= 0 && !validColor(operation.background)) return failure('Slide background color is invalid.', index);
        rememberFields(slidePatchRow(token, targetSlide), targetSlide, requestedSlideKeys);
        requestedSlideKeys.forEach(function (key) {
          if (key === 'title') targetSlide.title = text(operation.title, 300);
          else if (key === 'speakerNotes') targetSlide.speakerNotes = text(operation.speakerNotes, 20000);
          else if (key === 'background') targetSlide.background = color(operation.background, targetSlide.background || '');
          else if (key === 'layout' && SLIDE_LAYOUTS.indexOf(operation.layout) >= 0) targetSlide.layout = operation.layout;
        });
      } else if (type === 'add_element') {
        var addSlide = draft.slides.find(function (item) { return item && item.id === String(operation.slideId || ''); });
        if (!addSlide) return failure('Slide not found for the new element.', index, 'target_missing');
        if (!Array.isArray(addSlide.elements)) addSlide.elements = [];
        var nextElement = slideElement(operation.element, runtime, addSlide.elements.length);
        if (!nextElement) return failure('Slides Assistant can add only local text, shape, and chart elements with valid data and safe colors.', index);
        addSlide.elements.push(nextElement);
        token.createdElements.push({ slideId: addSlide.id, id: nextElement.id });
      } else if (type === 'update_element') {
        var elementSlide = draft.slides.find(function (item) { return item && item.id === String(operation.slideId || ''); });
        var targetElement = elementSlide && Array.isArray(elementSlide.elements) ? elementSlide.elements.find(function (item) { return item && item.id === String(operation.elementId || ''); }) : null;
        if (!targetElement) return failure('Slide element not found at step ' + (index + 1) + '.', index, 'target_missing');
        if (SLIDE_ELEMENT_TYPES.indexOf(targetElement.type) < 0) return failure('Assistant edits cannot alter image elements.', index, 'unsupported_target');
        var elementPatch = operation.patch && typeof operation.patch === 'object' ? operation.patch : {};
        var elementKeys = ['text', 'x', 'y', 'width', 'height', 'zIndex', 'fontSize', 'fontWeight', 'fill', 'color', 'borderColor', 'borderWidth', 'chart'];
        var requestedElementKeys = elementKeys.filter(function (key) { return Object.prototype.hasOwnProperty.call(elementPatch, key); });
        if (!requestedElementKeys.length) return failure('Element update has no supported fields.', index);
        if (requestedElementKeys.indexOf('chart') >= 0 && targetElement.type === 'chart') {
          var proposedChart = elementPatch.chart && typeof elementPatch.chart === 'object' ? elementPatch.chart : {};
          if (!Array.isArray(proposedChart.labels) || !proposedChart.labels.length || !Array.isArray(proposedChart.values) || proposedChart.labels.length !== proposedChart.values.length || proposedChart.labels.length > 12) return failure('Chart labels and values must have matching lengths from 1 to 12.', index);
        }
        if (requestedElementKeys.indexOf('chart') >= 0 && targetElement.type !== 'chart') return failure('Only chart elements accept chart data.', index);
        if (['fill', 'color', 'borderColor'].some(function (key) { return Object.prototype.hasOwnProperty.call(elementPatch, key) && !validColor(elementPatch[key]); })) return failure('Slide element color is invalid.', index);
        rememberFields(elementPatchRow(token, elementSlide.id, targetElement), targetElement, requestedElementKeys);
        requestedElementKeys.forEach(function (key) {
          if (key === 'text') targetElement.text = text(elementPatch.text, 8000);
          else if (key === 'x' || key === 'y') targetElement[key] = finite(elementPatch[key], targetElement[key], 0, 96);
          else if (key === 'width' || key === 'height') targetElement[key] = finite(elementPatch[key], targetElement[key], 2, 100);
          else if (key === 'zIndex') targetElement.zIndex = Math.round(finite(elementPatch.zIndex, targetElement.zIndex, -1000, 1000));
          else if (key === 'fontSize') targetElement.fontSize = finite(elementPatch.fontSize, targetElement.fontSize, 1, 18);
          else if (key === 'fontWeight') targetElement.fontWeight = ['normal', 'bold'].indexOf(elementPatch.fontWeight) >= 0 ? elementPatch.fontWeight : targetElement.fontWeight;
          else if (key === 'fill' || key === 'color' || key === 'borderColor') targetElement[key] = color(elementPatch[key], targetElement[key]);
          else if (key === 'borderWidth') targetElement.borderWidth = finite(elementPatch.borderWidth, targetElement.borderWidth, 0, 16);
          else if (key === 'chart' && targetElement.type === 'chart') {
            var nextChart = elementPatch.chart && typeof elementPatch.chart === 'object' ? elementPatch.chart : {};
            var labels = (Array.isArray(nextChart.labels) ? nextChart.labels : []).slice(0, 12).map(function (label) { return text(label, 100); });
            var values = (Array.isArray(nextChart.values) ? nextChart.values : []).slice(0, 12).map(function (value) { return finite(value, 0, -1000000, 1000000); });
            if (!labels.length || labels.length !== values.length) return;
            targetElement.chart = { labels: labels, values: values };
          }
        });
      } else if (type === 'arrange_elements') {
        var arrangeSlide = draft.slides.find(function (item) { return item && item.id === String(operation.slideId || ''); });
        var elementIds = uniqueIds(operation.elementIds, 40);
        var arrangedElements = arrangeSlide && Array.isArray(arrangeSlide.elements) ? elementIds.map(function (id) { return arrangeSlide.elements.find(function (item) { return item && item.id === id; }); }) : [];
        if (elementIds.length < 2 || arrangedElements.some(function (item) { return !item; })) return failure('Slides arrangement needs at least two existing element ids.', index, 'target_missing');
        var slideLayout = ['row', 'column', 'grid'].indexOf(operation.layout) >= 0 ? operation.layout : 'grid';
        var slideGap = finite(operation.gap, 4, 0, 20);
        var slideColumns = slideLayout === 'grid' ? Math.ceil(Math.sqrt(arrangedElements.length)) : (slideLayout === 'row' ? arrangedElements.length : 1);
        var availableWidth = 84;
        var availableHeight = 68;
        var rows = Math.ceil(arrangedElements.length / slideColumns);
        var itemWidth = Math.max(6, (availableWidth - (slideColumns - 1) * slideGap) / slideColumns);
        var itemHeight = Math.max(6, (availableHeight - (rows - 1) * slideGap) / rows);
        arrangedElements.forEach(function (element, elementIndex) {
          rememberFields(elementPatchRow(token, arrangeSlide.id, element), element, ['x', 'y', 'width', 'height']);
          element.x = 8 + (elementIndex % slideColumns) * (itemWidth + slideGap);
          element.y = 18 + Math.floor(elementIndex / slideColumns) * (itemHeight + slideGap);
          element.width = itemWidth;
          element.height = itemHeight;
        });
      } else if (type === 'reorder_slides') {
        var order = uniqueIds(operation.slideIds, 100);
        var currentIds = draft.slides.map(function (slide) { return slide.id; });
        if (order.length !== currentIds.length || currentIds.some(function (id) { return order.indexOf(id) < 0; })) return failure('Slide reorder must include every current slide exactly once.', index);
        if (!token.beforeOrder) token.beforeOrder = currentIds;
        draft.slides = order.map(function (id) { return draft.slides.find(function (slide) { return slide.id === id; }); });
      } else if (type === 'theme') {
        if (SLIDE_THEMES.indexOf(operation.theme) < 0) return failure('Unsupported Slides theme.', index);
        if (token.beforeTheme === undefined) token.beforeTheme = source.theme;
        draft.theme = operation.theme;
      } else if (type === 'size') {
        if (SLIDE_SIZES.indexOf(operation.size) < 0) return failure('Unsupported Slides size.', index);
        if (token.beforeSize === undefined) token.beforeSize = source.size;
        draft.size = operation.size;
      } else {
        return failure('Unknown Slides operation at step ' + (index + 1) + '.', index);
      }
    }
    if (!draft.slides.length) return failure('A Slides deck needs at least one slide.', -1);
    token.afterFingerprint = fingerprint(slidesStateForToken(draft, token));
    return { ok: true, model: draft, undo: token, operationCount: list.length, createdSlideIds: token.createdSlideIds.slice(), createdElements: clone(token.createdElements) };
  }
  function undoSlides(model, token) {
    var draft = ensureDeck(model);
    if (!token || token.kind !== 'slides_assistant_patch') return failure('Invalid Slides undo token.', -1, 'invalid_undo');
    if (fingerprint(slidesStateForToken(draft, token)) !== token.afterFingerprint) return failure('Slides changed after the Assistant edit. Review the deck before undoing.', -1, 'stale_surface');
    var createdSlides = new Set(token.createdSlideIds || []);
    draft.slides = draft.slides.filter(function (slide) { return !createdSlides.has(slide.id); });
    (token.createdElements || []).forEach(function (ref) { var slide = draft.slides.find(function (item) { return item && item.id === ref.slideId; }); if (slide) slide.elements = slide.elements.filter(function (element) { return element.id !== ref.id; }); });
    (token.slidePatches || []).forEach(function (patch) { var slide = draft.slides.find(function (item) { return item && item.id === patch.id; }); if (slide) Object.keys(patch.before || {}).forEach(function (key) { slide[key] = clone(patch.before[key]); }); });
    (token.elementPatches || []).forEach(function (patch) { var slide = draft.slides.find(function (item) { return item && item.id === patch.slideId; }); var element = slide && slide.elements.find(function (item) { return item && item.id === patch.id; }); if (element) Object.keys(patch.before || {}).forEach(function (key) { element[key] = clone(patch.before[key]); }); });
    if (token.beforeOrder) { var byId = new Map(draft.slides.map(function (slide) { return [slide.id, slide]; })); draft.slides = token.beforeOrder.map(function (id) { return byId.get(id); }).filter(Boolean).concat(draft.slides.filter(function (slide) { return token.beforeOrder.indexOf(slide.id) < 0; })); }
    if (token.beforeTheme !== undefined) draft.theme = token.beforeTheme;
    if (token.beforeSize !== undefined) draft.size = token.beforeSize;
    if (!draft.slides.length) return failure('Slides undo would leave the deck empty.', -1, 'invalid_undo');
    return { ok: true, model: draft };
  }

  var api = { VERSION: '1.0.0', MAX_OPERATIONS: MAX_OPERATIONS, applyCanvas: applyCanvas, undoCanvas: undoCanvas, applySlides: applySlides, undoSlides: undoSlides, fingerprint: fingerprint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSurfaceAssistantActions = api;
}(typeof window !== 'undefined' ? window : globalThis));
