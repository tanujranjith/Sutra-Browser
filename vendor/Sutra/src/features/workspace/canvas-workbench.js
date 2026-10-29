(function canvasWorkbenchFactory(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  // Register through the supported `globalThis.*` alias form so the
  // architecture guardrail inventory sees and ratchets this window API
  // (the bare `root.*` form is invisible to the guardrail scan).
  if (typeof globalThis !== 'undefined') globalThis.SutraCanvasWorkbench = api;
  else if (root) root.SutraCanvasWorkbench = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildCanvasWorkbench() {
  'use strict';

  var VERSION = '1.0.0';
  var GRID_SIZE = 16;

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanIds(ids) {
    return Array.from(new Set((Array.isArray(ids) ? ids : [ids]).map(function (id) {
      return String(id || '').trim();
    }).filter(Boolean)));
  }

  function selectedObjects(objects, ids, includeLocked) {
    var selected = new Set(cleanIds(ids));
    return (Array.isArray(objects) ? objects : []).filter(function (object) {
      return object && selected.has(String(object.id || '')) && (includeLocked || object.locked !== true);
    });
  }

  function objectRect(object) {
    var x = finite(object && object.x, 0);
    var y = finite(object && object.y, 0);
    var width = Math.max(1, finite(object && object.width, 1));
    var height = Math.max(1, finite(object && object.height, 1));
    return { x: x, y: y, width: width, height: height, right: x + width, bottom: y + height };
  }

  function getBounds(objects, ids) {
    var list = ids == null ? (Array.isArray(objects) ? objects.filter(Boolean) : []) : selectedObjects(objects, ids, true);
    if (!list.length) return null;
    var first = objectRect(list[0]);
    var left = first.x;
    var top = first.y;
    var right = first.right;
    var bottom = first.bottom;
    list.slice(1).forEach(function (object) {
      var rect = objectRect(object);
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    });
    return { x: left, y: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
  }

  function fitViewport(objects, viewportSize, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var bounds = getBounds(objects, opts.ids == null ? null : opts.ids);
    var width = Math.max(1, finite(viewportSize && viewportSize.width, 1));
    var height = Math.max(1, finite(viewportSize && viewportSize.height, 1));
    if (!bounds) return { x: 0, y: 0, zoom: 1, bounds: null };
    var padding = Math.max(0, finite(opts.padding, 72));
    var usableWidth = Math.max(1, width - padding * 2);
    var usableHeight = Math.max(1, height - padding * 2);
    var minZoom = Math.max(0.05, finite(opts.minZoom, 0.2));
    var maxZoom = Math.max(minZoom, finite(opts.maxZoom, 2));
    var zoom = Math.min(usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height));
    zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    return {
      x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom: zoom,
      bounds: bounds
    };
  }

  function normalizeRect(rect) {
    var x1 = finite(rect && rect.x, 0);
    var y1 = finite(rect && rect.y, 0);
    var x2 = rect && rect.right != null ? finite(rect.right, x1) : x1 + finite(rect && rect.width, 0);
    var y2 = rect && rect.bottom != null ? finite(rect.bottom, y1) : y1 + finite(rect && rect.height, 0);
    var left = Math.min(x1, x2);
    var top = Math.min(y1, y2);
    var right = Math.max(x1, x2);
    var bottom = Math.max(y1, y2);
    return { x: left, y: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
  }

  function selectInRect(objects, rect, options) {
    var area = normalizeRect(rect);
    var contain = options && options.mode === 'contain';
    return (Array.isArray(objects) ? objects : []).filter(function (object) {
      if (!object) return false;
      var item = objectRect(object);
      if (contain) return item.x >= area.x && item.y >= area.y && item.right <= area.right && item.bottom <= area.bottom;
      return item.right >= area.x && item.x <= area.right && item.bottom >= area.y && item.y <= area.bottom;
    }).map(function (object) { return object.id; });
  }

  function snapValue(value, size) {
    var grid = Math.max(1, finite(size, GRID_SIZE));
    return Math.round(finite(value, 0) / grid) * grid;
  }

  function nudge(objects, ids, dx, dy, options) {
    var next = clone(Array.isArray(objects) ? objects : []);
    var selected = new Set(cleanIds(ids));
    var snap = options && options.snapToGrid === true;
    var grid = options && options.gridSize;
    var changed = [];
    next.forEach(function (object) {
      if (!object || !selected.has(object.id) || object.locked === true) return;
      var x = finite(object.x, 0) + finite(dx, 0);
      var y = finite(object.y, 0) + finite(dy, 0);
      object.x = snap ? snapValue(x, grid) : x;
      object.y = snap ? snapValue(y, grid) : y;
      changed.push(object.id);
    });
    return { objects: next, changedIds: changed };
  }

  function arrange(objects, ids, command, options) {
    var next = clone(Array.isArray(objects) ? objects : []);
    var items = selectedObjects(next, ids, false);
    if (!items.length) return { ok: false, error: 'Select at least one unlocked object.', objects: next, changedIds: [] };
    var bounds = getBounds(items);
    var gap = Math.max(0, finite(options && options.gap, 24));
    var changed = [];
    function touch(object) { if (changed.indexOf(object.id) < 0) changed.push(object.id); }
    if (command === 'align-left') items.forEach(function (object) { object.x = bounds.x; touch(object); });
    else if (command === 'align-center') items.forEach(function (object) { object.x = bounds.x + (bounds.width - finite(object.width, 0)) / 2; touch(object); });
    else if (command === 'align-right') items.forEach(function (object) { object.x = bounds.right - finite(object.width, 0); touch(object); });
    else if (command === 'align-top') items.forEach(function (object) { object.y = bounds.y; touch(object); });
    else if (command === 'align-middle') items.forEach(function (object) { object.y = bounds.y + (bounds.height - finite(object.height, 0)) / 2; touch(object); });
    else if (command === 'align-bottom') items.forEach(function (object) { object.y = bounds.bottom - finite(object.height, 0); touch(object); });
    else if (command === 'distribute-horizontal') {
      if (items.length < 3) return { ok: false, error: 'Select at least three unlocked objects to distribute.', objects: next, changedIds: [] };
      items.sort(function (a, b) { return finite(a.x, 0) - finite(b.x, 0); });
      var totalWidth = items.reduce(function (sum, object) { return sum + finite(object.width, 0); }, 0);
      var horizontalGap = Math.max(0, (bounds.width - totalWidth) / (items.length - 1));
      var cursorX = bounds.x;
      items.forEach(function (object) { object.x = cursorX; cursorX += finite(object.width, 0) + horizontalGap; touch(object); });
    } else if (command === 'distribute-vertical') {
      if (items.length < 3) return { ok: false, error: 'Select at least three unlocked objects to distribute.', objects: next, changedIds: [] };
      items.sort(function (a, b) { return finite(a.y, 0) - finite(b.y, 0); });
      var totalHeight = items.reduce(function (sum, object) { return sum + finite(object.height, 0); }, 0);
      var verticalGap = Math.max(0, (bounds.height - totalHeight) / (items.length - 1));
      var cursorY = bounds.y;
      items.forEach(function (object) { object.y = cursorY; cursorY += finite(object.height, 0) + verticalGap; touch(object); });
    } else if (command === 'tidy-grid') {
      var columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
      var cellWidth = items.reduce(function (max, object) { return Math.max(max, finite(object.width, 0)); }, 0) + gap;
      var cellHeight = items.reduce(function (max, object) { return Math.max(max, finite(object.height, 0)); }, 0) + gap;
      items.sort(function (a, b) { return finite(a.y, 0) - finite(b.y, 0) || finite(a.x, 0) - finite(b.x, 0); });
      items.forEach(function (object, index) {
        object.x = bounds.x + (index % columns) * cellWidth;
        object.y = bounds.y + Math.floor(index / columns) * cellHeight;
        touch(object);
      });
    } else return { ok: false, error: 'Unknown arrangement command.', objects: next, changedIds: [] };
    return { ok: true, objects: next, changedIds: changed };
  }

  function changeLayer(objects, ids, command) {
    var next = clone(Array.isArray(objects) ? objects : []);
    var selected = new Set(cleanIds(ids));
    var ordered = next.slice().sort(function (a, b) { return finite(a.zIndex, 0) - finite(b.zIndex, 0); });
    var selectedItems = ordered.filter(function (object) { return selected.has(object.id) && object.locked !== true; });
    if (!selectedItems.length) return { ok: false, error: 'Select at least one unlocked object.', objects: next, changedIds: [] };
    var selectedSet = new Set(selectedItems.map(function (object) { return object.id; }));
    var others = ordered.filter(function (object) { return !selectedSet.has(object.id); });
    if (command === 'front') ordered = others.concat(selectedItems);
    else if (command === 'back') ordered = selectedItems.concat(others);
    else if (command === 'forward') {
      for (var i = ordered.length - 2; i >= 0; i -= 1) {
        if (selectedSet.has(ordered[i].id) && !selectedSet.has(ordered[i + 1].id)) {
          var forward = ordered[i]; ordered[i] = ordered[i + 1]; ordered[i + 1] = forward;
        }
      }
    } else if (command === 'backward') {
      for (var j = 1; j < ordered.length; j += 1) {
        if (selectedSet.has(ordered[j].id) && !selectedSet.has(ordered[j - 1].id)) {
          var backward = ordered[j]; ordered[j] = ordered[j - 1]; ordered[j - 1] = backward;
        }
      }
    } else return { ok: false, error: 'Unknown layer command.', objects: next, changedIds: [] };
    var byId = new Map(next.map(function (object) { return [object.id, object]; }));
    ordered.forEach(function (object, index) { byId.get(object.id).zIndex = index + 1; });
    return { ok: true, objects: next, changedIds: selectedItems.map(function (object) { return object.id; }) };
  }

  function toggleLocked(objects, ids, locked) {
    var next = clone(Array.isArray(objects) ? objects : []);
    var selected = new Set(cleanIds(ids));
    var changed = [];
    var value = locked;
    if (value == null) {
      var selectedList = next.filter(function (object) { return object && selected.has(object.id); });
      value = selectedList.some(function (object) { return object.locked !== true; });
    }
    next.forEach(function (object) {
      if (!object || !selected.has(object.id)) return;
      object.locked = value === true;
      changed.push(object.id);
    });
    return { objects: next, changedIds: changed, locked: value === true };
  }

  function copySelection(model, ids) {
    var source = model && typeof model === 'object' ? model : {};
    var selected = new Set(cleanIds(ids));
    var objects = (Array.isArray(source.objects) ? source.objects : []).filter(function (object) { return object && selected.has(object.id); });
    var present = new Set(objects.map(function (object) { return object.id; }));
    return {
      version: 1,
      objects: clone(objects),
      connections: clone((Array.isArray(source.connections) ? source.connections : []).filter(function (connection) { return present.has(connection.fromId) && present.has(connection.toId); })),
      groups: clone((Array.isArray(source.groups) ? source.groups : []).filter(function (group) { return Array.isArray(group.objectIds) && group.objectIds.every(function (id) { return present.has(id); }); }))
    };
  }

  function pasteSelection(model, clipboard, options) {
    var source = clone(model && typeof model === 'object' ? model : {});
    source.objects = Array.isArray(source.objects) ? source.objects : [];
    source.connections = Array.isArray(source.connections) ? source.connections : [];
    source.groups = Array.isArray(source.groups) ? source.groups : [];
    var clip = clipboard && typeof clipboard === 'object' ? clipboard : {};
    if (!Array.isArray(clip.objects) || !clip.objects.length) return { ok: false, error: 'Canvas clipboard is empty.', model: source, selectedIds: [] };
    var idFactory = options && typeof options.idFactory === 'function' ? options.idFactory : function () { return 'canvas-' + Math.random().toString(36).slice(2); };
    var offset = finite(options && options.offset, 28);
    var idMap = new Map();
    var groupMap = new Map();
    (Array.isArray(clip.groups) ? clip.groups : []).forEach(function (group) { groupMap.set(group.id, idFactory()); });
    var created = clip.objects.map(function (raw) {
      var object = clone(raw);
      var newId = idFactory();
      idMap.set(raw.id, newId);
      object.id = newId;
      object.x = finite(object.x, 0) + offset;
      object.y = finite(object.y, 0) + offset;
      object.groupId = object.groupId && groupMap.has(object.groupId) ? groupMap.get(object.groupId) : '';
      object.locked = false;
      return object;
    });
    source.objects = source.objects.concat(created);
    source.connections = source.connections.concat((Array.isArray(clip.connections) ? clip.connections : []).map(function (raw) {
      var connection = clone(raw);
      connection.id = idFactory();
      connection.fromId = idMap.get(raw.fromId);
      connection.toId = idMap.get(raw.toId);
      return connection;
    }).filter(function (connection) { return connection.fromId && connection.toId; }));
    source.groups = source.groups.concat((Array.isArray(clip.groups) ? clip.groups : []).map(function (raw) {
      var group = clone(raw);
      group.id = groupMap.get(raw.id) || idFactory();
      group.objectIds = (Array.isArray(raw.objectIds) ? raw.objectIds : []).map(function (id) { return idMap.get(id); }).filter(Boolean);
      group.locked = false;
      return group;
    }).filter(function (group) { return group.objectIds.length; }));
    return { ok: true, model: source, selectedIds: created.map(function (object) { return object.id; }) };
  }

  return Object.freeze({
    VERSION: VERSION,
    GRID_SIZE: GRID_SIZE,
    getBounds: getBounds,
    fitViewport: fitViewport,
    selectInRect: selectInRect,
    snapValue: snapValue,
    nudge: nudge,
    arrange: arrange,
    changeLayer: changeLayer,
    toggleLocked: toggleLocked,
    copySelection: copySelection,
    pasteSelection: pasteSelection
  });
}));
