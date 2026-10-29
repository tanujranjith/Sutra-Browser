/* Pure PDF workspace data helpers. Browser UI lives in pdf-workspace.js. */
(function (global) {
  'use strict';

  var ANNOTATION_TYPES = ['highlight', 'underline', 'strikeout', 'ink', 'text', 'comment', 'stamp', 'signature', 'form'];
  var ENTITY_TYPES = ['course', 'note', 'homework', 'assignment', 'private_document', 'pdf_page_source'];
  var EXPORT_MODES = ['original', 'clean', 'annotated'];

  function text(value) { return String(value == null ? '' : value); }
  function number(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, number(value, min))); }
  function iso(value) { var parsed = Date.parse(text(value)); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }
  function id(prefix) {
    try { if (global.crypto && typeof global.crypto.randomUUID === 'function') return text(prefix || '') + global.crypto.randomUUID(); } catch (_) {}
    return text(prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function clone(value, fallback) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
  }
  function normalizedRect(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var x = clamp(source.x, 0, 1);
    var y = clamp(source.y, 0, 1);
    var width = clamp(source.width, 0, 1 - x);
    var height = clamp(source.height, 0, 1 - y);
    return Object.assign({}, source, { x: x, y: y, width: width, height: height });
  }
  function normalizeGeometry(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var out = normalizedRect(source);
    out.rects = Array.isArray(source.rects) ? source.rects.map(normalizedRect).filter(function (rect) { return rect.width > 0 && rect.height > 0; }).slice(0, 200) : [];
    if (source.point && typeof source.point === 'object') out.point = { x: clamp(source.point.x, 0, 1), y: clamp(source.point.y, 0, 1) };
    return out;
  }
  function normalizeStyle(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var color = /^#[0-9a-f]{6}$/i.test(text(source.color)) ? text(source.color) : '#facc15';
    return Object.assign({}, source, {
      color: color,
      opacity: clamp(source.opacity == null ? 0.42 : source.opacity, 0.05, 1),
      width: clamp(source.width == null ? 0.004 : source.width, 0.001, 0.08),
      fontSize: clamp(source.fontSize == null ? 0.025 : source.fontSize, 0.008, 0.15)
    });
  }
  function normalizeInkPaths(raw) {
    return (Array.isArray(raw) ? raw : []).map(function (path) {
      return (Array.isArray(path) ? path : []).map(function (point) {
        return { x: clamp(point && point.x, 0, 1), y: clamp(point && point.y, 0, 1), p: clamp(point && point.p == null ? 0.5 : point.p, 0, 1) };
      }).filter(function (_, index) { return index < 10000; });
    }).filter(function (path) { return path.length > 0; }).slice(0, 200);
  }
  function normalizeAnnotation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = ANNOTATION_TYPES.indexOf(text(raw.type)) >= 0 ? text(raw.type) : 'comment';
    var now = new Date().toISOString();
    return Object.assign({}, raw, {
      id: text(raw.id || id('pdfann_')),
      documentId: text(raw.documentId),
      pageId: text(raw.pageId),
      type: type,
      geometry: normalizeGeometry(raw.geometry),
      style: normalizeStyle(raw.style),
      text: text(raw.text).slice(0, 50000),
      inkPaths: normalizeInkPaths(raw.inkPaths),
      fieldKey: text(raw.fieldKey).slice(0, 500),
      value: raw.value == null ? '' : clone(raw.value, ''),
      createdAt: iso(raw.createdAt || now),
      updatedAt: iso(raw.updatedAt || now)
    });
  }
  function normalizePage(raw, index, fileId) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var rotation = Math.round(number(source.rotation, 0) / 90) * 90;
    rotation = ((rotation % 360) + 360) % 360;
    return Object.assign({}, source, {
      id: text(source.id || id('pdfpage_')),
      sourceFileId: text(source.sourceFileId || fileId),
      sourcePageIndex: Math.max(0, Math.floor(number(source.sourcePageIndex, index))),
      order: Math.max(0, Math.floor(number(source.order, index))),
      rotation: rotation,
      width: Math.max(1, number(source.width, 612)),
      height: Math.max(1, number(source.height, 792)),
      removed: source.removed === true
    });
  }
  function normalizeBookmark(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return Object.assign({}, raw, { id: text(raw.id || id('pdfbm_')), pageId: text(raw.pageId), title: text(raw.title || 'Bookmark').slice(0, 300), createdAt: iso(raw.createdAt) });
  }
  function normalizeDocument(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var fileId = text(raw.fileId);
    var now = new Date().toISOString();
    var pages = (Array.isArray(raw.pages) ? raw.pages : []).map(function (page, index) { return normalizePage(page, index, fileId); });
    pages.sort(function (a, b) { return a.order - b.order || a.sourcePageIndex - b.sourcePageIndex; });
    pages.forEach(function (page, index) { page.order = index; });
    return Object.assign({}, raw, {
      id: text(raw.id || id('pdfdoc_')),
      fileId: fileId,
      schemaVersion: Math.max(1, Math.floor(number(raw.schemaVersion, 1))),
      pages: pages,
      bookmarks: (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).map(normalizeBookmark).filter(Boolean),
      checkpoints: (Array.isArray(raw.checkpoints) ? raw.checkpoints : []).map(function (checkpoint) {
        if (!checkpoint || typeof checkpoint !== 'object') return null;
        return Object.assign({}, checkpoint, {
          id: text(checkpoint.id || id('pdfcheckpoint_')),
          label: text(checkpoint.label || 'Checkpoint').slice(0, 200),
          pages: (Array.isArray(checkpoint.pages) ? checkpoint.pages : []).map(function (page, index) { return normalizePage(page, index, fileId); }),
          createdAt: iso(checkpoint.createdAt)
        });
      }).filter(Boolean).slice(-10),
      createdAt: iso(raw.createdAt || now),
      updatedAt: iso(raw.updatedAt || now)
    });
  }
  function normalizeAttachmentLink(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var entityType = text(raw.entityType);
    if (!/^[a-z][a-z0-9_:-]{0,63}$/i.test(entityType)) return null;
    var fileId = text(raw.fileId); var entityId = text(raw.entityId);
    if (!fileId || !entityId) return null;
    return Object.assign({}, raw, { id: text(raw.id || id('attlink_')), fileId: fileId, entityType: entityType, entityId: entityId, createdAt: iso(raw.createdAt) });
  }
  function dedupeLinks(raw) {
    var seen = Object.create(null);
    return (Array.isArray(raw) ? raw : []).map(normalizeAttachmentLink).filter(function (link) {
      if (!link) return false;
      var key = link.fileId + '\n' + link.entityType + '\n' + link.entityId;
      if (seen[key]) return false;
      seen[key] = true; return true;
    });
  }
  function makeDocument(fileId, pageCount) {
    var count = Math.max(0, Math.min(10000, Math.floor(number(pageCount, 0))));
    return normalizeDocument({ fileId: text(fileId), pages: Array.from({ length: count }, function (_, index) { return { sourceFileId: text(fileId), sourcePageIndex: index, order: index }; }) });
  }
  function applyPagePlan(document, command) {
    var doc = normalizeDocument(document);
    if (!doc) return null;
    var op = command && text(command.type);
    var pageId = command && text(command.pageId);
    var index = doc.pages.findIndex(function (page) { return page.id === pageId; });
    if (op === 'remove' && index >= 0) doc.pages.splice(index, 1);
    if (op === 'rotate' && index >= 0) doc.pages[index].rotation = (doc.pages[index].rotation + number(command.degrees, 90) + 360) % 360;
    if (op === 'move' && index >= 0) {
      var target = Math.max(0, Math.min(doc.pages.length - 1, Math.floor(number(command.toIndex, index))));
      var moved = doc.pages.splice(index, 1)[0]; doc.pages.splice(target, 0, moved);
    }
    if (op === 'insert' && command.page) {
      var at = Math.max(0, Math.min(doc.pages.length, Math.floor(number(command.toIndex, doc.pages.length))));
      doc.pages.splice(at, 0, normalizePage(command.page, at, doc.fileId));
    }
    doc.pages.forEach(function (page, pageIndex) { page.order = pageIndex; });
    doc.updatedAt = new Date().toISOString();
    return doc;
  }
  function mergeDocuments(documents, fileId) {
    var pages = [];
    (Array.isArray(documents) ? documents : []).forEach(function (document) {
      var normalized = normalizeDocument(document);
      if (!normalized) return;
      normalized.pages.forEach(function (page) {
        var next = clone(page, {}); next.order = pages.length; pages.push(next);
      });
    });
    return normalizeDocument({ fileId: text(fileId || (pages[0] && pages[0].sourceFileId)), pages: pages });
  }
  function splitDocument(document, ranges) {
    var doc = normalizeDocument(document);
    if (!doc) return [];
    return (Array.isArray(ranges) ? ranges : []).map(function (range) {
      var start = Math.max(0, Math.floor(number(range && range.start, 0)));
      var end = Math.min(doc.pages.length, Math.floor(number(range && range.end, doc.pages.length)));
      if (end <= start) return null;
      return normalizeDocument({ fileId: doc.fileId, pages: doc.pages.slice(start, end).map(function (page) { return clone(page, {}); }) });
    }).filter(Boolean);
  }
  function resolveExportOptions(raw, annotationCount) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var fallback = number(annotationCount, 0) > 0 ? 'annotated' : 'clean';
    return {
      mode: EXPORT_MODES.indexOf(text(source.mode)) >= 0 ? text(source.mode) : fallback,
      includeForms: source.includeForms !== false,
      flattenForms: source.flattenForms === true,
      includeCommentSummary: source.includeCommentSummary !== false
    };
  }
  function validatePdfBytes(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (view.length < 8) return { ok: false, code: 'too-small' };
    var header = String.fromCharCode.apply(null, Array.prototype.slice.call(view, 0, 5));
    if (header !== '%PDF-') return { ok: false, code: 'invalid-signature' };
    return { ok: true, code: 'pdf' };
  }
  function detectDocumentSecurity(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var sample = '';
    try {
      var windowSize = Math.min(view.length, 2 * 1024 * 1024);
      var decoder = new TextDecoder('latin1');
      sample = decoder.decode(view.slice(0, windowSize));
      if (view.length > windowSize) sample += decoder.decode(view.slice(Math.max(windowSize, view.length - windowSize)));
    } catch (_) {}
    return { signed: /\/ByteRange\s*\[/.test(sample) && /\/Type\s*\/Sig\b/.test(sample), encrypted: /\/Encrypt\b/.test(sample), hasJavaScript: /\/JavaScript\b|\/JS\b/.test(sample) };
  }
  function unrotatePoint(point, rotation) {
    var p = { x: clamp(point && point.x, 0, 1), y: clamp(point && point.y, 0, 1) };
    var r = ((Math.round(number(rotation, 0) / 90) * 90) % 360 + 360) % 360;
    if (r === 90) return { x: p.y, y: 1 - p.x };
    if (r === 180) return { x: 1 - p.x, y: 1 - p.y };
    if (r === 270) return { x: 1 - p.y, y: p.x };
    return p;
  }
  function rotatePoint(point, rotation) {
    var p = { x: clamp(point && point.x, 0, 1), y: clamp(point && point.y, 0, 1) };
    var r = ((Math.round(number(rotation, 0) / 90) * 90) % 360 + 360) % 360;
    if (r === 90) return { x: 1 - p.y, y: p.x };
    if (r === 180) return { x: 1 - p.x, y: 1 - p.y };
    if (r === 270) return { x: p.y, y: 1 - p.x };
    return p;
  }
  function transformRect(rect, rotation, transformPoint) {
    var normalized = normalizedRect(rect);
    var points = [
      transformPoint({ x: normalized.x, y: normalized.y }, rotation),
      transformPoint({ x: normalized.x + normalized.width, y: normalized.y }, rotation),
      transformPoint({ x: normalized.x, y: normalized.y + normalized.height }, rotation),
      transformPoint({ x: normalized.x + normalized.width, y: normalized.y + normalized.height }, rotation)
    ];
    var xs = points.map(function (point) { return point.x; }); var ys = points.map(function (point) { return point.y; });
    return normalizedRect({ x: Math.min.apply(Math, xs), y: Math.min.apply(Math, ys), width: Math.max.apply(Math, xs) - Math.min.apply(Math, xs), height: Math.max.apply(Math, ys) - Math.min.apply(Math, ys) });
  }
  function unrotateRect(rect, rotation) { return transformRect(rect, rotation, unrotatePoint); }
  function rotateRect(rect, rotation) { return transformRect(rect, rotation, rotatePoint); }

  var api = {
    ANNOTATION_TYPES: ANNOTATION_TYPES.slice(), ENTITY_TYPES: ENTITY_TYPES.slice(), EXPORT_MODES: EXPORT_MODES.slice(),
    clamp: clamp, normalizedRect: normalizedRect, normalizeGeometry: normalizeGeometry,
    normalizeAnnotation: normalizeAnnotation, normalizeDocument: normalizeDocument,
    normalizeAttachmentLink: normalizeAttachmentLink, normalizeAttachmentLinks: dedupeLinks,
    makeDocument: makeDocument, applyPagePlan: applyPagePlan, mergeDocuments: mergeDocuments,
    splitDocument: splitDocument, resolveExportOptions: resolveExportOptions,
    validatePdfBytes: validatePdfBytes, detectDocumentSecurity: detectDocumentSecurity,
    unrotatePoint: unrotatePoint, rotatePoint: rotatePoint, unrotateRect: unrotateRect, rotateRect: rotateRect,
    clone: clone, id: id
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SutraPdfEngine = api;
}(typeof window !== 'undefined' ? window : globalThis));
