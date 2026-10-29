/* Sutra iCalendar engine — deterministic, local-only RFC 5545 intake.
 *
 * The browser adapter in app.js owns review, persistence, and Timeline refresh.
 * This file only parses untrusted calendar text and maps supported VEVENT data
 * into canonical timeBlock-shaped records. It is dual-mode for Node tests.
 */
;(function registerSutraIcs(global) {
  'use strict';

  var MAX_SOURCE_CHARS = 2_000_000;
  var MAX_EVENTS = 5_000;
  var MAX_EVENT_DAYS = 366;
  var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  var DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function text(value) { return String(value == null ? '' : value); }
  function pad(value) { return String(value).padStart(2, '0'); }
  function hash(value) {
    var input = text(value), result = 2166136261;
    for (var index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }
  function unique(values) { return Array.from(new Set((values || []).filter(Boolean))); }
  function warn(list, code, message, eventIndex) {
    var item = { code: code, message: message };
    if (Number.isInteger(eventIndex)) item.eventIndex = eventIndex;
    list.push(item);
  }
  function decodeText(value) {
    var input = text(value), output = '';
    for (var index = 0; index < input.length; index += 1) {
      if (input[index] !== '\\' || index + 1 >= input.length) { output += input[index]; continue; }
      var next = input[index + 1];
      if (next === 'n' || next === 'N') output += '\n';
      else if (next === ',' || next === ';' || next === '\\') output += next;
      else output += next;
      index += 1;
    }
    return output;
  }
  function decodeParam(value) {
    return text(value).replace(/\^n/gi, '\n').replace(/\^'/g, '"').replace(/\^\^/g, '^');
  }
  function splitOutsideQuotes(value, delimiter) {
    var result = [], current = '', quoted = false, escaped = false;
    for (var index = 0; index < value.length; index += 1) {
      var char = value[index];
      if (escaped) { current += char; escaped = false; continue; }
      if (char === '\\') { current += char; escaped = true; continue; }
      if (char === '"') { quoted = !quoted; current += char; continue; }
      if (char === delimiter && !quoted) { result.push(current); current = ''; continue; }
      current += char;
    }
    result.push(current);
    return result;
  }
  function valueDelimiter(line) {
    var quoted = false, escaped = false;
    for (var index = 0; index < line.length; index += 1) {
      var char = line[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ':' && !quoted) return index;
    }
    return -1;
  }
  function parseContentLine(line) {
    var delimiter = valueDelimiter(line);
    if (delimiter < 1) return null;
    var head = splitOutsideQuotes(line.slice(0, delimiter), ';');
    var rawName = text(head.shift()).trim();
    var name = rawName.split('.').pop().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(name)) return null;
    var params = {};
    head.forEach(function (part) {
      var equals = part.indexOf('=');
      if (equals < 1) return;
      var key = part.slice(0, equals).trim().toUpperCase();
      var raw = part.slice(equals + 1).trim();
      if (raw[0] === '"' && raw[raw.length - 1] === '"') raw = raw.slice(1, -1);
      params[key] = splitOutsideQuotes(raw, ',').map(function (item) { return decodeParam(item.trim()); });
    });
    return { name: name, group: rawName.indexOf('.') >= 0 ? rawName.slice(0, rawName.lastIndexOf('.')) : '', params: params, value: line.slice(delimiter + 1) };
  }
  function paramsAsLegacy(params) {
    return Object.keys(params || {}).map(function (key) { return key + '=' + params[key].join(','); });
  }
  function eventCompatibility(properties, index) {
    var event = { _properties: properties, _index: index };
    Object.keys(properties).forEach(function (name) {
      var first = properties[name][0];
      event[name] = first.value;
      if (Object.keys(first.params || {}).length) event[name + '_PARAMS'] = paramsAsLegacy(first.params);
    });
    return event;
  }
  function firstProperty(record, name) {
    var rows = record && record._properties && record._properties[name];
    if (Array.isArray(rows) && rows.length) return rows[0];
    if (record && Object.prototype.hasOwnProperty.call(record, name)) {
      return { name: name, value: record[name], params: normalizeParams(record[name + '_PARAMS']) };
    }
    return null;
  }
  function allProperties(record, name) {
    var rows = record && record._properties && record._properties[name];
    if (Array.isArray(rows)) return rows;
    var first = firstProperty(record, name);
    return first ? [first] : [];
  }
  function normalizeParams(input) {
    if (!input) return {};
    if (!Array.isArray(input)) {
      var copied = {};
      Object.keys(input).forEach(function (key) {
        copied[String(key).toUpperCase()] = Array.isArray(input[key]) ? input[key].map(text) : [text(input[key])];
      });
      return copied;
    }
    var result = {};
    input.forEach(function (part) {
      var equals = text(part).indexOf('=');
      if (equals < 1) return;
      result[text(part).slice(0, equals).trim().toUpperCase()] = splitOutsideQuotes(text(part).slice(equals + 1), ',').map(function (item) { return item.replace(/^"|"$/g, ''); });
    });
    return result;
  }
  function parse(textInput, options) {
    var opts = options || {}, source = text(textInput), warnings = [], errors = [];
    var truncated = source.length > MAX_SOURCE_CHARS;
    if (truncated) { source = source.slice(0, MAX_SOURCE_CHARS); warn(warnings, 'source_truncated', 'Calendar text exceeded the 2 MB safety limit and was truncated.'); }
    source = source.replace(/\0/g, '');
    var rawLines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var lines = [];
    rawLines.forEach(function (line) {
      if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
      else lines.push(line);
    });
    var stack = [], calendarProperties = {}, events = [], current = null, sawCalendar = false, sawCalendarEnd = false;
    lines.forEach(function (line, lineIndex) {
      if (!line) return;
      var parsed = parseContentLine(line);
      if (!parsed) { if (line.trim()) warn(warnings, 'malformed_content_line', 'Ignored a malformed calendar line.', current ? current.index : undefined); return; }
      var valueUpper = parsed.value.trim().toUpperCase();
      if (parsed.name === 'BEGIN') {
        stack.push(valueUpper);
        if (valueUpper === 'VCALENDAR') sawCalendar = true;
        if (valueUpper === 'VEVENT') {
          if (events.length >= MAX_EVENTS) { current = null; warn(warnings, 'event_limit', 'Only the first 5,000 events were considered.'); return; }
          current = { properties: {}, index: events.length, startLine: lineIndex + 1 };
        }
        return;
      }
      if (parsed.name === 'END') {
        var active = stack.pop();
        if (active !== valueUpper) warn(warnings, 'component_mismatch', 'A calendar component ended out of order.', current ? current.index : undefined);
        if (valueUpper === 'VEVENT') {
          if (current) events.push(eventCompatibility(current.properties, current.index));
          current = null;
        }
        if (valueUpper === 'VCALENDAR') sawCalendarEnd = true;
        return;
      }
      if (!sawCalendar || stack[0] !== 'VCALENDAR') return;
      var activeComponent = stack[stack.length - 1];
      if (current && activeComponent === 'VEVENT') {
        if (!current.properties[parsed.name]) current.properties[parsed.name] = [];
        current.properties[parsed.name].push(parsed);
      } else if (!current && activeComponent === 'VCALENDAR') {
        if (!calendarProperties[parsed.name]) calendarProperties[parsed.name] = [];
        calendarProperties[parsed.name].push(parsed);
      }
    });
    if (!sawCalendar) errors.push({ code: 'not_icalendar', message: 'The file does not contain a VCALENDAR component.' });
    else if (!sawCalendarEnd) errors.push({ code: 'incomplete_calendar', message: 'The VCALENDAR component is incomplete.' });
    var calendar = eventCompatibility(calendarProperties, -1);
    return {
      ok: errors.length === 0,
      code: errors.length ? errors[0].code : (events.length ? 'parsed' : 'no_events'),
      calendar: calendar,
      events: events,
      warnings: warnings,
      errors: errors,
      stats: { lines: lines.length, events: events.length, truncated: truncated }
    };
  }

  function validDateParts(year, month, day) {
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    var date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function keyFromParts(year, month, day) { return year + '-' + pad(month) + '-' + pad(day); }
  function localDateFromKey(key, timeValue) {
    var parts = text(key).split('-').map(Number), clock = text(timeValue || '00:00').split(':').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], clock[0] || 0, clock[1] || 0, 0, 0);
  }
  function dateKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function timeKey(date) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); }
  function addDays(key, count) { var date = localDateFromKey(key); date.setDate(date.getDate() + count); return dateKey(date); }
  function zonedParts(epoch, timeZone) {
    var formatter = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var parts = {};
    formatter.formatToParts(new Date(epoch)).forEach(function (part) { if (part.type !== 'literal') parts[part.type] = Number(part.value); });
    return parts;
  }
  function zonedEpoch(parts, timeZone) {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone }).format(new Date());
    var target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0), guess = target;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      var actual = zonedParts(guess, timeZone);
      var represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
      var next = target - (represented - guess);
      if (next === guess) break;
      guess = next;
    }
    return guess;
  }
  function parseDateTime(raw, inputParams) {
    var value = text(raw).trim(), params = normalizeParams(inputParams), resultWarnings = [];
    if (!value) return null;
    var dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (dateOnly || (params.VALUE && params.VALUE.some(function (item) { return item.toUpperCase() === 'DATE'; }))) {
      if (!dateOnly) return null;
      var dateYear = Number(dateOnly[1]), dateMonth = Number(dateOnly[2]), dateDay = Number(dateOnly[3]);
      if (!validDateParts(dateYear, dateMonth, dateDay)) return null;
      return { raw: value, dateKey: keyFromParts(dateYear, dateMonth, dateDay), time: null, isAllDay: true, epochMs: null, timeZone: '', floating: true, warnings: resultWarnings };
    }
    var match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/.exec(value);
    if (!match) return null;
    var parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0) };
    if (!validDateParts(parts.year, parts.month, parts.day) || parts.hour > 23 || parts.minute > 59 || parts.second > 60) return null;
    var suffix = match[7] || '', epoch = null, timeZone = params.TZID && params.TZID[0] ? params.TZID[0].replace(/^\//, '') : '';
    if (suffix === 'Z') epoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, Math.min(parts.second, 59));
    else if (/^[+-]\d{4}$/.test(suffix)) {
      var sign = suffix[0] === '-' ? -1 : 1, offset = sign * (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(3, 5)));
      epoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, Math.min(parts.second, 59)) - offset * 60_000;
    } else if (timeZone) {
      try { epoch = zonedEpoch(parts, timeZone); }
      catch (error) { resultWarnings.push('Unsupported TZID "' + timeZone + '"; treated as local floating time.'); timeZone = ''; }
    }
    if (epoch !== null) {
      var local = new Date(epoch);
      return { raw: value, dateKey: dateKey(local), time: timeKey(local), isAllDay: false, epochMs: epoch, timeZone: timeZone || (suffix === 'Z' ? 'UTC' : suffix), floating: false, warnings: resultWarnings };
    }
    return { raw: value, dateKey: keyFromParts(parts.year, parts.month, parts.day), time: pad(parts.hour) + ':' + pad(parts.minute), isAllDay: false, epochMs: null, timeZone: '', floating: true, warnings: resultWarnings };
  }
  function parseDuration(raw) {
    var match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(text(raw).trim());
    if (!match) return null;
    var sign = match[1] === '-' ? -1 : 1;
    var milliseconds = (((Number(match[2] || 0) * 7 + Number(match[3] || 0)) * 24 + Number(match[4] || 0)) * 60 + Number(match[5] || 0)) * 60_000 + Number(match[6] || 0) * 1000;
    return sign * milliseconds;
  }
  function parseRrule(raw) {
    var result = {};
    text(raw).split(';').forEach(function (part) {
      var equals = part.indexOf('=');
      if (equals > 0) result[part.slice(0, equals).trim().toUpperCase()] = part.slice(equals + 1).trim().toUpperCase();
    });
    return result;
  }
  function byDay(rule) {
    return unique(text(rule && rule.BYDAY).split(',').map(function (token) { return token.replace(/^[+-]?\d+/, ''); }).filter(function (token) { return Object.prototype.hasOwnProperty.call(DAY_INDEX, token); }).map(function (token) { return DAY_INDEX[token]; }));
  }
  function countUntil(startKey, recurrence, weeklyDays, count) {
    if (!Number.isInteger(count) || count <= 1) return startKey;
    var date = localDateFromKey(startKey), seen = 1, guard = 0;
    while (seen < count && guard < 36600) {
      date.setDate(date.getDate() + 1);
      guard += 1;
      if (recurrence === 'daily' || (recurrence === 'weekdays' && date.getDay() > 0 && date.getDay() < 6) || (recurrence === 'weekly' && weeklyDays.indexOf(date.getDay()) >= 0)) seen += 1;
    }
    return dateKey(date);
  }
  function safeUrl(value) {
    var raw = decodeText(value).trim();
    if (!raw) return '';
    try { var url = new URL(raw); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''; }
    catch (error) { return ''; }
  }
  function firstWebUrl() {
    for (var index = 0; index < arguments.length; index += 1) {
      var direct = safeUrl(arguments[index]);
      if (direct) return direct;
      var match = decodeText(arguments[index]).match(/https?:\/\/[^\s<>"')]+/i);
      if (match) { var found = safeUrl(match[0]); if (found) return found; }
    }
    return '';
  }
  function eventUid(event) {
    var uid = firstProperty(event, 'UID');
    if (uid && decodeText(uid.value).trim()) return decodeText(uid.value).trim();
    var summary = firstProperty(event, 'SUMMARY'), start = firstProperty(event, 'DTSTART');
    return 'derived-' + hash((summary ? summary.value : '') + '|' + (start ? start.value : '') + '|' + event._index);
  }
  function eventRevision(event) {
    var sequence = Number((firstProperty(event, 'SEQUENCE') || {}).value || 0);
    var stamp = text((firstProperty(event, 'LAST-MODIFIED') || firstProperty(event, 'DTSTAMP') || {}).value);
    return { sequence: Number.isFinite(sequence) ? sequence : 0, stamp: stamp };
  }
  function newerEvent(left, right) {
    var a = eventRevision(left), b = eventRevision(right);
    return b.sequence > a.sequence || (b.sequence === a.sequence && b.stamp > a.stamp) ? right : left;
  }
  function propertyDateValues(event, name) {
    var output = [];
    allProperties(event, name).forEach(function (property) {
      splitOutsideQuotes(property.value, ',').forEach(function (raw) {
        var info = parseDateTime(raw, property.params);
        if (info) output.push(info);
      });
    });
    return output;
  }
  function recurrenceFor(event, startInfo, warnings) {
    var property = firstProperty(event, 'RRULE');
    if (!property) return { recurrence: 'none', weeklyDays: [], recurrenceUntil: null, preserveRecurrence: false, importedRecurrence: 'none' };
    var rule = parseRrule(property.value), interval = Math.max(1, Number(rule.INTERVAL || 1) || 1), recurrence = 'none', days = [];
    var supportedKeys = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'];
    var unsupportedKeys = Object.keys(rule).filter(function (key) { return supportedKeys.indexOf(key) < 0; });
    var count = rule.COUNT == null ? 0 : Number(rule.COUNT);
    var invalidCount = rule.COUNT != null && (!Number.isInteger(count) || count < 1);
    var untilInfo = rule.UNTIL ? parseDateTime(rule.UNTIL) : null;
    if (unsupportedKeys.length) warn(warnings, 'unsupported_recurrence_parts', 'A recurring event using unsupported ' + unsupportedKeys.join(', ') + ' rules was imported once.', event._index);
    else if (invalidCount) warn(warnings, 'invalid_recurrence_count', 'A recurring event with an invalid COUNT was imported once.', event._index);
    else if (rule.UNTIL && !untilInfo) warn(warnings, 'invalid_recurrence_until', 'A recurring event with an invalid UNTIL date was imported once.', event._index);
    else if (interval !== 1) warn(warnings, 'unsupported_recurrence_interval', 'An event with INTERVAL=' + interval + ' was imported once; Sutra currently supports interval 1.', event._index);
    else if (rule.FREQ === 'DAILY' && rule.BYDAY) {
      days = byDay(rule);
      if (!days.length) warn(warnings, 'invalid_recurrence_byday', 'A recurring event with an invalid BYDAY rule was imported once.', event._index);
      else recurrence = days.length === 5 && [1, 2, 3, 4, 5].every(function (day) { return days.indexOf(day) >= 0; }) ? 'weekdays' : 'weekly';
    } else if (rule.FREQ === 'DAILY') recurrence = 'daily';
    else if (rule.FREQ === 'WEEKLY') {
      days = byDay(rule);
      if (rule.BYDAY && !days.length) warn(warnings, 'invalid_recurrence_byday', 'A recurring event with an invalid BYDAY rule was imported once.', event._index);
      else {
        if (!days.length) days = [localDateFromKey(startInfo.dateKey).getDay()];
        recurrence = days.length === 5 && [1, 2, 3, 4, 5].every(function (day) { return days.indexOf(day) >= 0; }) ? 'weekdays' : 'weekly';
      }
    } else warn(warnings, 'unsupported_recurrence_frequency', 'A ' + (rule.FREQ || 'custom') + ' recurring event was imported once; only daily and weekly recurrence are supported.', event._index);
    var until = untilInfo && untilInfo.dateKey ? untilInfo.dateKey : null;
    if (recurrence !== 'none' && Number.isInteger(count) && count > 0) until = countUntil(startInfo.dateKey, recurrence, days, count);
    return { recurrence: recurrence, weeklyDays: days, recurrenceUntil: until, preserveRecurrence: recurrence !== 'none', importedRecurrence: recurrence, rawRrule: property.value };
  }
  function endForEvent(event, startInfo, warnings) {
    var endProperty = firstProperty(event, 'DTEND');
    var endInfo = endProperty ? parseDateTime(endProperty.value, endProperty.params) : null;
    if (endProperty && !endInfo) warn(warnings, 'invalid_dtend', 'An invalid DTEND was replaced with a one-hour duration.', event._index);
    if (endInfo) return endInfo;
    var durationProperty = firstProperty(event, 'DURATION');
    var duration = durationProperty ? parseDuration(durationProperty.value) : null;
    if (startInfo.isAllDay) {
      var days = duration && duration > 0 ? Math.max(1, Math.ceil(duration / 86_400_000)) : 1;
      return { dateKey: addDays(startInfo.dateKey, days), time: null, isAllDay: true, epochMs: null };
    }
    var startDate = startInfo.epochMs !== null ? new Date(startInfo.epochMs) : localDateFromKey(startInfo.dateKey, startInfo.time);
    var endDate = new Date(startDate.getTime() + (duration && duration > 0 ? duration : 3_600_000));
    return { dateKey: dateKey(endDate), time: timeKey(endDate), isAllDay: false, epochMs: endDate.getTime() };
  }
  function eventSegments(startInfo, endInfo, warnings, eventIndex) {
    var segments = [];
    if (startInfo.isAllDay) {
      var endExclusive = endInfo && endInfo.dateKey && endInfo.dateKey > startInfo.dateKey ? endInfo.dateKey : addDays(startInfo.dateKey, 1);
      for (var key = startInfo.dateKey, count = 0; key < endExclusive && count < MAX_EVENT_DAYS; key = addDays(key, 1), count += 1) segments.push({ date: key, start: '00:00', end: '23:59', isAllDay: true });
      if (segments.length >= MAX_EVENT_DAYS && addDays(segments[segments.length - 1].date, 1) < endExclusive) warn(warnings, 'multi_day_truncated', 'A multi-day event was limited to 366 days.', eventIndex);
      return segments;
    }
    var endKey = endInfo && endInfo.dateKey ? endInfo.dateKey : startInfo.dateKey;
    var endTime = endInfo && endInfo.time ? endInfo.time : '00:00';
    if (endKey < startInfo.dateKey || (endKey === startInfo.dateKey && endTime <= startInfo.time)) {
      var fallback = localDateFromKey(startInfo.dateKey, startInfo.time); fallback.setMinutes(fallback.getMinutes() + 60);
      return [{ date: startInfo.dateKey, start: startInfo.time, end: dateKey(fallback) === startInfo.dateKey ? timeKey(fallback) : '23:59', isAllDay: false }];
    }
    if (endKey === startInfo.dateKey) return [{ date: startInfo.dateKey, start: startInfo.time, end: endTime, isAllDay: false }];
    segments.push({ date: startInfo.dateKey, start: startInfo.time, end: '23:59', isAllDay: false });
    for (var day = addDays(startInfo.dateKey, 1), count = 1; day < endKey && count < MAX_EVENT_DAYS; day = addDays(day, 1), count += 1) segments.push({ date: day, start: '00:00', end: '23:59', isAllDay: true });
    if (endTime !== '00:00' && segments.length < MAX_EVENT_DAYS) segments.push({ date: endKey, start: '00:00', end: endTime, isAllDay: false });
    if (segments.length >= MAX_EVENT_DAYS) warn(warnings, 'multi_day_truncated', 'A multi-day event was limited to 366 days.', eventIndex);
    return segments;
  }
  function categoryFor(event) {
    var categories = allProperties(event, 'CATEGORIES').flatMap(function (property) { return splitOutsideQuotes(property.value, ',').map(function (item) { return decodeText(item).toLowerCase(); }); });
    var joined = categories.join(' ');
    if (/study|class|school|lecture|exam|quiz|test/.test(joined)) return 'study';
    if (/personal|family|health|appointment/.test(joined)) return 'personal';
    if (/break|holiday|vacation/.test(joined)) return 'break';
    return 'work';
  }
  function colorFor(event, category) {
    var color = decodeText((firstProperty(event, 'COLOR') || {}).value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    return { study: '#6f8dff', personal: '#d58c55', break: '#8995a8', work: '#4f8cff' }[category] || '#4f8cff';
  }
  function toTimeBlocks(textInput, options) {
    var opts = options || {}, parsed = parse(textInput, opts), warnings = parsed.warnings.slice();
    if (!parsed.ok) return { ok: false, code: parsed.code, calendar: parsed.calendar, blocks: [], warnings: warnings, errors: parsed.errors, stats: { parsed: parsed.events.length, importable: 0, skipped: parsed.events.length, cancelled: 0 } };
    var calendarName = decodeText((firstProperty(parsed.calendar, 'X-WR-CALNAME') || {}).value || '').trim() || text(opts.fileName || 'Imported calendar').replace(/\.ics$/i, '');
    var calendarIdentity = text(opts.sourceId || opts.fileName || calendarName || 'calendar').trim().toLowerCase();
    var calendarImportId = 'icsfile_' + hash(calendarIdentity);
    var deduped = new Map();
    parsed.events.forEach(function (event) {
      var recurrenceProperty = firstProperty(event, 'RECURRENCE-ID');
      var key = eventUid(event) + '::' + (recurrenceProperty ? recurrenceProperty.value : 'master');
      deduped.set(key, deduped.has(key) ? newerEvent(deduped.get(key), event) : event);
    });
    var events = Array.from(deduped.values()), exceptionDatesByUid = {};
    events.forEach(function (event) {
      var recurrenceProperty = firstProperty(event, 'RECURRENCE-ID');
      if (!recurrenceProperty) return;
      var info = parseDateTime(recurrenceProperty.value, recurrenceProperty.params);
      if (!info) return;
      var uid = eventUid(event);
      if (!exceptionDatesByUid[uid]) exceptionDatesByUid[uid] = [];
      exceptionDatesByUid[uid].push(info.dateKey);
    });
    var blocks = [], cancelled = 0, skipped = 0;
    events.forEach(function (event) {
      var status = decodeText((firstProperty(event, 'STATUS') || {}).value || '').trim().toUpperCase();
      if (status === 'CANCELLED') { cancelled += 1; return; }
      var startProperty = firstProperty(event, 'DTSTART');
      var startInfo = startProperty ? parseDateTime(startProperty.value, startProperty.params) : null;
      if (!startInfo) { skipped += 1; warn(warnings, 'missing_or_invalid_dtstart', 'Skipped an event without a valid DTSTART.', event._index); return; }
      (startInfo.warnings || []).forEach(function (message) { warn(warnings, 'timezone_fallback', message, event._index); });
      var summary = decodeText((firstProperty(event, 'SUMMARY') || {}).value || '').trim();
      if (!summary) { summary = 'Untitled calendar event'; warn(warnings, 'missing_summary', 'An event without SUMMARY was imported as “Untitled calendar event”.', event._index); }
      summary = summary.slice(0, 240);
      var description = decodeText((firstProperty(event, 'DESCRIPTION') || {}).value || '').trim();
      var location = decodeText((firstProperty(event, 'LOCATION') || {}).value || '').trim();
      var url = firstWebUrl((firstProperty(event, 'URL') || {}).value || '', description, location);
      var endInfo = endForEvent(event, startInfo, warnings);
      var segments = eventSegments(startInfo, endInfo, warnings, event._index);
      if (!segments.length) { skipped += 1; return; }
      var uid = eventUid(event), recurrenceProperty = firstProperty(event, 'RECURRENCE-ID');
      var recurrenceId = recurrenceProperty ? recurrenceProperty.value : '';
      var recurrence = recurrenceFor(event, startInfo, warnings);
      if (segments.length > 1 && recurrence.preserveRecurrence) {
        warn(warnings, 'multi_day_recurrence_flattened', 'A multi-day recurring event was imported as its visible base days only.', event._index);
        recurrence = { recurrence: 'none', weeklyDays: [], recurrenceUntil: null, preserveRecurrence: false, importedRecurrence: recurrence.importedRecurrence, rawRrule: recurrence.rawRrule };
      }
      var exceptions = propertyDateValues(event, 'EXDATE').map(function (info) { return info.dateKey; }).concat(exceptionDatesByUid[uid] || []);
      var category = categoryFor(event), now = Date.now();
      segments.forEach(function (segment, segmentIndex) {
        var identity = calendarImportId + '::' + uid + (recurrenceId ? '::' + recurrenceId : '') + (segments.length > 1 ? '::day:' + segment.date : '');
        blocks.push({
          id: 'ics_' + hash(identity),
          name: summary,
          start: segment.start,
          end: segment.end,
          category: category,
          color: colorFor(event, category),
          recurrence: segmentIndex === 0 ? recurrence.recurrence : 'none',
          importedRecurrence: recurrence.importedRecurrence,
          preserveRecurrence: segmentIndex === 0 && recurrence.preserveRecurrence,
          recurrenceUntil: segmentIndex === 0 ? recurrence.recurrenceUntil : null,
          weeklyDays: segmentIndex === 0 ? recurrence.weeklyDays : [],
          recurrenceExceptions: segmentIndex === 0 ? unique(exceptions).sort() : [],
          date: segment.date,
          isAllDay: segment.isAllDay,
          notes: [description, location ? 'Location: ' + location : ''].filter(Boolean).join('\n') || null,
          referenceUrl: url || null,
          source: 'calendar_ics',
          sourceUid: identity,
          calendarImportId: calendarImportId,
          calendarName: calendarName,
          calendarUid: uid,
          calendarRecurrenceId: recurrenceId || null,
          calendarTimeZone: startInfo.timeZone || null,
          calendarRrule: recurrence.rawRrule || null,
          createdAt: now,
          updatedAt: now
        });
      });
      propertyDateValues(event, 'RDATE').forEach(function (rdate, rdateIndex) {
        if (rdate.dateKey === startInfo.dateKey && rdate.time === startInfo.time) return;
        var startDate = rdate.isAllDay ? null : localDateFromKey(rdate.dateKey, rdate.time);
        var baseStart = startInfo.isAllDay ? null : localDateFromKey(startInfo.dateKey, startInfo.time);
        var baseEnd = endInfo.isAllDay ? null : localDateFromKey(endInfo.dateKey, endInfo.time);
        var duration = startDate && baseStart && baseEnd ? Math.max(900_000, baseEnd - baseStart) : 86_400_000;
        var rEnd = rdate.isAllDay ? { dateKey: addDays(rdate.dateKey, 1), isAllDay: true, time: null } : (function () { var date = new Date(startDate.getTime() + duration); return { dateKey: dateKey(date), time: timeKey(date), isAllDay: false }; }());
        eventSegments(rdate, rEnd, warnings, event._index).forEach(function (segment) {
          var identity = calendarImportId + '::' + uid + '::rdate:' + rdate.raw + ':' + rdateIndex + ':' + segment.date;
          blocks.push({ id: 'ics_' + hash(identity), name: summary, start: segment.start, end: segment.end, category: category, color: colorFor(event, category), recurrence: 'none', importedRecurrence: 'none', preserveRecurrence: false, recurrenceUntil: null, weeklyDays: [], recurrenceExceptions: [], date: segment.date, isAllDay: segment.isAllDay, notes: [description, location ? 'Location: ' + location : ''].filter(Boolean).join('\n') || null, referenceUrl: url || null, source: 'calendar_ics', sourceUid: identity, calendarImportId: calendarImportId, calendarName: calendarName, calendarUid: uid, calendarRecurrenceId: 'RDATE:' + rdate.raw, calendarTimeZone: rdate.timeZone || null, calendarRrule: null, createdAt: now, updatedAt: now });
        });
      });
    });
    return { ok: true, code: blocks.length ? 'ready_for_review' : 'no_importable_events', calendar: parsed.calendar, calendarName: calendarName, calendarImportId: calendarImportId, blocks: blocks, warnings: warnings, errors: [], stats: { parsed: parsed.events.length, importable: blocks.length, skipped: skipped, cancelled: cancelled, duplicatesCollapsed: parsed.events.length - events.length } };
  }

  var api = {
    VERSION: '1.0.0',
    parse: parse,
    parseIcsEvents: function (source) { var parsed = parse(source); return parsed.ok ? parsed.events : []; },
    parseDateTime: parseDateTime,
    parseUntilFromRrule: function (rrule) { var rule = parseRrule(rrule); var info = rule.UNTIL ? parseDateTime(rule.UNTIL) : null; return info ? info.dateKey : null; },
    parseByDayFromRrule: function (rrule) { return byDay(parseRrule(rrule)); },
    buildCalendarSourceUid: eventUid,
    toTimeBlocks: toTimeBlocks,
    decodeText: decodeText,
    _hash: hash
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.sutraIcs = Object.assign(global.sutraIcs || {}, api);
}(typeof window !== 'undefined' ? window : globalThis));
