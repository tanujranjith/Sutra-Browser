/* Deterministic, review-first academic import engine. */
(function (global) {
  'use strict';

  var MAX_SOURCE_CHARS = 1000000;
  var MAX_ITEMS = 1200;
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  var IcsEngine = global && global.sutraIcs;
  if (!IcsEngine && typeof require === 'function') {
    try { IcsEngine = require('./icalendar.js'); } catch (error) { IcsEngine = null; }
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function clean(value, max) {
    var normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return max == null ? normalized : normalized.slice(0, max);
  }
  function keyText(value) { return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function hash(value) {
    var text = typeof value === 'string' ? value : JSON.stringify(value);
    var out = 2166136261;
    for (var i = 0; i < text.length; i += 1) { out ^= text.charCodeAt(i); out = Math.imul(out, 16777619); }
    return (out >>> 0).toString(36);
  }
  function isoDate(year, month, day) {
    var date = new Date(Number(year), Number(month), Number(day), 12);
    if (isNaN(date.getTime()) || date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) || date.getDate() !== Number(day)) return '';
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function parseDate(value, now) {
    var text = clean(value, 300).toLowerCase();
    var match = text.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/);
    if (match) return isoDate(match[1], Number(match[2]) - 1, match[3]);
    match = text.match(/\b([01]?\d)\/([0-3]?\d)(?:\/(\d{2,4}))?\b/);
    if (match) {
      var year = match[3] ? Number(match[3]) : new Date(now || Date.now()).getFullYear();
      if (year < 100) year += 2000;
      return isoDate(year, Number(match[1]) - 1, match[2]);
    }
    match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?/);
    if (!match) return '';
    var base = new Date(now || Date.now());
    var candidate = isoDate(match[3] || base.getFullYear(), MONTHS[match[1]], match[2]);
    if (!match[3] && candidate && new Date(candidate + 'T12:00:00').getTime() < base.getTime() - 150 * 86400000) candidate = isoDate(base.getFullYear() + 1, MONTHS[match[1]], match[2]);
    return candidate;
  }
  function parseTime(value) {
    var match = clean(value, 300).toLowerCase().match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/);
    if (!match) match = clean(value, 300).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!match) return '';
    var hour = Number(match[1]), minute = Number(match[2] || 0);
    if (match[3] === 'pm' && hour < 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
    if (hour > 23) return '';
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  function parseCsvLine(line, delimiter) {
    var cells = [], value = '', quoted = false;
    for (var i = 0; i < line.length; i += 1) {
      var ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) { cells.push(value); value = ''; }
      else value += ch;
    }
    cells.push(value);
    // The complete source is bounded by MAX_SOURCE_CHARS; do not impose a
    // second silent per-cell truncation on authored assignment details.
    return cells.map(function (cell) { return clean(cell); });
  }
  function normalizeKind(value, title) {
    var raw = keyText(value || title).replace(/ /g, '_');
    if (/exam|test|quiz|midterm|final/.test(raw)) return 'exam';
    if (/reading|chapter/.test(raw)) return 'reading';
    if (/grade|weight|category/.test(raw)) return 'grading_category';
    if (/office_hour/.test(raw)) return 'office_hours';
    if (/late_policy/.test(raw)) return 'late_policy';
    if (/feedback|rubric_comment/.test(raw)) return 'teacher_feedback';
    if (/course|class/.test(raw)) return 'course';
    if (/meeting|recurring/.test(raw)) return 'recurring_class';
    if (/event|holiday|no_school/.test(raw)) return 'event';
    return 'assignment';
  }
  function makeItem(raw, source, index) {
    var item = {
      id: 'import_item_' + hash([source.sourceId, index, raw.kind, raw.title, raw.date]),
      kind: normalizeKind(raw.kind, raw.title),
      title: clean(raw.title || raw.summary || raw.feedback || 'Untitled imported item'),
      courseName: clean(raw.courseName || raw.course || raw.className),
      date: parseDate(raw.date || raw.due || raw.title, source.now),
      time: parseTime(raw.time || raw.start || raw.title),
      endTime: parseTime(raw.endTime || raw.end),
      weight: Number.isFinite(Number(raw.weight)) && raw.weight !== '' ? Math.max(0, Math.min(100, Number(raw.weight))) : null,
      teacher: clean(raw.teacher),
      details: clean(raw.details || raw.description || raw.feedback),
      sourceRef: { sourceId: source.sourceId, sourceName: source.name, format: source.format, row: index + 1 },
      provenance: source.provenance || 'local_deterministic',
      confidence: Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0.78,
      confidenceReasons: Array.isArray(raw.confidenceReasons) ? raw.confidenceReasons.map(function (reason) { return clean(reason, 240); }) : []
    };
    item.importIdentity = 'sutra-import:' + hash([item.kind, keyText(item.courseName), keyText(item.title), item.date, source.sourceId]);
    return item;
  }
  function parseCsv(text, source) {
    var lines = text.split(/\r?\n/).filter(function (line) { return line.trim(); });
    if (!lines.length) return [];
    var delimiter = lines[0].split('\t').length > lines[0].split(',').length ? '\t' : ',';
    var headers = parseCsvLine(lines[0], delimiter).map(keyText);
    var aliases = { kind: ['kind', 'type'], title: ['title', 'assignment', 'name', 'summary'], courseName: ['course', 'class', 'course name'], date: ['date', 'due', 'due date', 'deadline'], time: ['time', 'start', 'start time'], endTime: ['end', 'end time'], weight: ['weight', 'percent', 'grade weight'], teacher: ['teacher', 'instructor'], details: ['details', 'description', 'notes', 'feedback'] };
    function indexFor(field) { return headers.findIndex(function (header) { return aliases[field].indexOf(header) >= 0; }); }
    return lines.slice(1).map(function (line, index) {
      var cells = parseCsvLine(line, delimiter), raw = {};
      Object.keys(aliases).forEach(function (field) { var column = indexFor(field); if (column >= 0) raw[field] = cells[column]; });
      raw.confidence = 0.94; raw.confidenceReasons = ['Recognized column headers'];
      return makeItem(raw, source, index + 1);
    }).filter(function (item) { return item.title; });
  }
  function icsValue(block, key) {
    var match = block.match(new RegExp('(?:^|\\n)' + key + '(?:;[^:]*)?:([^\\r\\n]*)', 'i'));
    return match ? match[1].replace(/\\n/gi, ' ').replace(/\\,/g, ',').trim() : '';
  }
  function parseIcs(text, source) {
    if (IcsEngine && typeof IcsEngine.parse === 'function') {
      var parsedCalendar = IcsEngine.parse(text);
      if (!parsedCalendar.ok) return [];
      return parsedCalendar.events.map(function (entry, index) {
        var start = IcsEngine.parseDateTime(entry.DTSTART, entry.DTSTART_PARAMS);
        if (!start || !start.dateKey) return null;
        var summary = IcsEngine.decodeText(entry.SUMMARY || '').trim() || 'Calendar event';
        var item = makeItem({
          kind: /exam|test|quiz|midterm|final/i.test(summary) ? 'exam' : (entry.RRULE ? 'recurring_class' : 'event'),
          title: summary,
          date: start.dateKey,
          time: start.time || '',
          details: IcsEngine.decodeText(entry.DESCRIPTION || ''),
          confidence: 0.98,
          confidenceReasons: ['Structured calendar event']
        }, source, index);
        item.importIdentity = 'ics:' + hash(IcsEngine.buildCalendarSourceUid(entry));
        return item;
      }).filter(Boolean);
    }
    var blocks = text.replace(/\r?\n[ \t]/g, '').split(/BEGIN:VEVENT/i).slice(1).map(function (part) { return part.split(/END:VEVENT/i)[0]; });
    return blocks.map(function (block, index) {
      var summary = icsValue(block, 'SUMMARY'), start = icsValue(block, 'DTSTART'), uid = icsValue(block, 'UID');
      var item = makeItem({ kind: /exam|test|quiz|midterm|final/i.test(summary) ? 'exam' : (/RRULE:/i.test(block) ? 'recurring_class' : 'event'), title: summary || 'Calendar event', date: start.slice(0, 4) + '-' + start.slice(4, 6) + '-' + start.slice(6, 8), time: start.length >= 13 ? start.slice(9, 11) + ':' + start.slice(11, 13) : '', details: icsValue(block, 'DESCRIPTION'), confidence: 0.98, confidenceReasons: ['Structured calendar event'] }, source, index);
      if (uid) item.importIdentity = 'ics:' + hash(uid);
      return item;
    });
  }
  function parseText(text, source, mode) {
    var lines = text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).slice(0, MAX_ITEMS), courseName = '', items = [];
    lines.forEach(function (line, index) {
      var date = parseDate(line, source.now), lower = line.toLowerCase(), raw = null;
      if (mode === 'teacher_feedback' && (/^[-*•]/.test(line) || /\b(feedback|comment|rubric)\b/i.test(line))) raw = { kind: 'teacher_feedback', title: line.replace(/^[-*•]\s*/, ''), details: line, courseName: courseName, confidence: 0.88, confidenceReasons: ['Feedback import mode'] };
      else if (/\blate\b.*\b(policy|penalty|deduct|accepted|days?)\b/i.test(line)) raw = { kind: 'late_policy', title: 'Late work policy', details: line, courseName: courseName, confidence: 0.92, confidenceReasons: ['Late-policy language'] };
      else if (/\boffice hours?\b/i.test(line)) raw = { kind: 'office_hours', title: 'Office hours', details: line, courseName: courseName, time: parseTime(line), confidence: 0.92, confidenceReasons: ['Office-hours label'] };
      else {
        var grading = line.match(/^([A-Za-z][A-Za-z &\/-]{2,50})\s*[:–—-]?\s*(\d{1,3})\s*%/);
        if (grading && Number(grading[2]) <= 100) raw = { kind: 'grading_category', title: grading[1], weight: Number(grading[2]), courseName: courseName, confidence: 0.93, confidenceReasons: ['Recognized grade percentage'] };
      }
      if (!raw && date) raw = { kind: /exam|test|quiz|midterm|final/i.test(lower) ? 'exam' : (/read|chapter/i.test(lower) ? 'reading' : 'assignment'), title: line, courseName: courseName, date: date, time: parseTime(line), confidence: /assignment|homework|essay|paper|project|lab|exam|test|quiz|read|chapter/i.test(lower) ? 0.9 : 0.7, confidenceReasons: ['Recognized date', 'Inferred item type from line text'] };
      if (!raw && /^(?:course|class)\s*[:–—-]/i.test(line)) { courseName = clean(line.replace(/^(?:course|class)\s*[:–—-]\s*/i, ''), 160); raw = { kind: 'course', title: courseName, confidence: 0.86, confidenceReasons: ['Explicit course label'] }; }
      if (raw) items.push(makeItem(raw, source, index));
    });
    return items;
  }
  function comparable(item) { return JSON.stringify([item.kind, keyText(item.title), keyText(item.courseName), item.date || '', item.time || '', item.weight, keyText(item.details)]); }
  function matchExisting(items, existing) {
    var records = Array.isArray(existing) ? existing : [];
    return items.map(function (item) {
      var exact = records.find(function (record) { return clean(record.importIdentity || (record.sourceRef && record.sourceRef.importIdentity), 300) === item.importIdentity; });
      var fuzzy = exact || records.find(function (record) { return normalizeKind(record.kind || record.type, record.title) === item.kind && keyText(record.title) === keyText(item.title) && keyText(record.courseName || record.course) === keyText(item.courseName) && clean(record.date || record.dueDate || record.dueAt, 10) === item.date; });
      var same = fuzzy && comparable(fuzzy) === comparable(item);
      item.match = fuzzy ? { action: same ? 'duplicate' : 'update', targetId: String(fuzzy.id || ''), reason: exact ? 'Stable import identity' : 'Matching type, title, course, and date' } : { action: 'create', targetId: '', reason: 'No matching workspace record' };
      item.review = { approved: item.match.action !== 'duplicate' && item.confidence >= 0.55, required: true };
      return item;
    });
  }
  function normalizeSource(input, options) {
    var source = typeof input === 'string' ? { text: input } : (input || {}), text = String(source.text || '').slice(0, MAX_SOURCE_CHARS);
    var format = clean(source.format || (text.indexOf('BEGIN:VCALENDAR') >= 0 ? 'ics' : 'text'), 20).toLowerCase();
    if (format === 'tsv') format = 'csv';
    return { text: text, format: format, name: clean(source.name || 'Imported material', 180), sourceId: clean(source.sourceId || ('source_' + hash(text)), 180), provenance: clean(source.provenance || 'local_deterministic', 80), now: options && options.now };
  }
  function batchCore(batch) { return { source: batch.source, items: batch.items }; }
  function preview(input, options) {
    var opts = options || {}, source = normalizeSource(input, opts);
    var parsed = source.format === 'ics' ? parseIcs(source.text, source) : source.format === 'csv' ? parseCsv(source.text, source) : parseText(source.text, source, opts.mode);
    var items = matchExisting(parsed.slice(0, MAX_ITEMS), opts.existingRecords);
    var result = { source: { sourceId: source.sourceId, name: source.name, format: source.format, chars: source.text.length }, items: items };
    return { ok: items.length > 0, code: items.length ? 'ready_for_review' : 'no_items', batchId: 'import_' + hash(result), source: result.source, items: items, summary: { total: items.length, creates: items.filter(function (item) { return item.match.action === 'create'; }).length, updates: items.filter(function (item) { return item.match.action === 'update'; }).length, duplicates: items.filter(function (item) { return item.match.action === 'duplicate'; }).length, lowConfidence: items.filter(function (item) { return item.confidence < 0.7; }).length }, warnings: source.text.length >= MAX_SOURCE_CHARS ? ['Source was truncated at the local safety limit.'] : [] };
  }
  function verifyBatch(batch) { return !!(batch && Array.isArray(batch.items) && batch.batchId === 'import_' + hash(batchCore(batch))); }
  async function applyReviewedBatch(batch, review, context) {
    var ctx = context || {};
    if (!verifyBatch(batch)) return { ok: false, code: 'invalid_or_changed_preview', changedIds: [], warnings: ['Create a fresh import preview.'], persistence: { status: 'unchanged' } };
    if (!review || review.reviewed !== true) return { ok: false, code: 'review_required', changedIds: [], warnings: ['Review is mandatory before import.'], persistence: { status: 'unchanged' } };
    if (typeof ctx.apply !== 'function') return { ok: false, code: 'adapter_unavailable', changedIds: [], warnings: ['No workspace import adapter is available.'], persistence: { status: 'unchanged' } };
    var decisions = review.decisions && typeof review.decisions === 'object' ? review.decisions : {};
    var selected = batch.items.filter(function (item) { var decision = decisions[item.id]; return decision ? decision.approved === true : item.review.approved === true; });
    var applied = [], changedIds = [], warnings = batch.warnings ? batch.warnings.slice() : [];
    try {
      for (var i = 0; i < selected.length; i += 1) {
        var item = clone(selected[i]), decision = decisions[item.id] || {};
        if (decision.edits && typeof decision.edits === 'object') Object.assign(item, clone(decision.edits));
        var result = await ctx.apply(item, item.match.action);
        if (!result || result.ok === false) throw Object.assign(new Error(result && (result.message || result.error) || 'Import item failed.'), { failedItemId: item.id });
        applied.push({ item: item, result: result });
        if (result.id != null) changedIds.push(String(result.id));
        if (Array.isArray(result.changedIds)) result.changedIds.forEach(function (id) { changedIds.push(String(id)); });
        if (Array.isArray(result.warnings)) warnings.push.apply(warnings, result.warnings);
      }
      if (typeof ctx.persist === 'function') await ctx.persist('reviewed-import');
      return { ok: true, code: 'applied', batchId: batch.batchId, changedIds: Array.from(new Set(changedIds)), warnings: warnings, outcomes: applied.map(function (row) { return { itemId: row.item.id, kind: row.item.kind, action: row.item.match.action, status: 'applied', result: row.result }; }), undo: { kind: 'import-batch', batchId: batch.batchId, available: typeof ctx.rollback === 'function', entries: applied }, persistence: { status: 'persisted' } };
    } catch (error) {
      var rollbackFailures = [];
      if (typeof ctx.rollback === 'function') for (var r = applied.length - 1; r >= 0; r -= 1) { try { await ctx.rollback(applied[r]); } catch (rollbackError) { rollbackFailures.push({ itemId: applied[r].item.id, message: rollbackError.message || String(rollbackError) }); } }
      return { ok: false, code: rollbackFailures.length ? 'partial_rollback' : 'rolled_back', failedItemId: error.failedItemId || '', changedIds: [], warnings: [error.message || String(error)], rollbackFailures: rollbackFailures, undo: { kind: 'import-batch', batchId: batch.batchId, available: false }, persistence: { status: rollbackFailures.length ? 'uncertain' : 'rolled_back' } };
    }
  }
  async function rollback(receipt, context) {
    var ctx = context || {}, entries = receipt && receipt.undo && Array.isArray(receipt.undo.entries) ? receipt.undo.entries : [];
    if (!entries.length || typeof ctx.rollback !== 'function') return { ok: false, code: 'undo_unavailable', persistence: { status: 'unchanged' } };
    var failures = [];
    for (var i = entries.length - 1; i >= 0; i -= 1) { try { await ctx.rollback(entries[i]); } catch (error) { failures.push({ itemId: entries[i].item.id, message: error.message || String(error) }); } }
    if (!failures.length && typeof ctx.persist === 'function') await ctx.persist('reviewed-import-undo');
    return { ok: failures.length === 0, code: failures.length ? 'partial_rollback' : 'rolled_back', changedIds: receipt.changedIds || [], warnings: failures.map(function (row) { return row.message; }), persistence: { status: failures.length ? 'uncertain' : 'persisted' } };
  }

  var api = { VERSION: '1.0.0', preview: preview, applyReviewedBatch: applyReviewedBatch, rollback: rollback, _parseDate: parseDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraImport = api;
}(typeof window !== 'undefined' ? window : globalThis));
