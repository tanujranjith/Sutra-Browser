/*
 * global-search-engine.js — pure, local ranking/normalization engine for
 * Sutra's workspace-wide search modal. No DOM, no storage, no network.
 *
 * Input: flat "records" collected from live canonical workspace state by
 * src/core/app.js (collectGlobalSearchRecords). The engine never reads
 * workspace state itself, so it stays deterministic and Node-testable.
 *
 * Privacy contract: a record flagged `locked: true` is searched by title
 * only. The engine additionally ignores `body` for locked records so a
 * misbehaving collector can never turn locked content into a snippet.
 *
 * Exposed as window.SutraGlobalSearchEngine (browser) / module.exports (Node).
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  var DEFAULT_LIMIT_ALL = 60;
  var DEFAULT_LIMIT_FILTERED = 40;
  var SNIPPET_LENGTH = 180;
  var SNIPPET_CONTEXT = 44;
  var MAX_RANGES = 12;
  var MAX_BODY_WORDS = 6;

  var TYPE_LABELS = {
    page: 'Page',
    note: 'Note',
    homework: 'Homework',
    task: 'Task',
    timeline: 'Timeline event',
    attachment: 'Attachment',
    course: 'Course',
    apstudy: 'AP Study',
    college: 'College',
    review: 'Review',
    tracker: 'Tracker',
    assistant: 'Assistant',
    setting: 'Setting'
  };

  // Filter chips. Pages = the page matched by title/location; Notes = the
  // page matched inside its note body. Both chips address the same Create
  // pages collection, so one page never appears twice within a view.
  // Each predicate receives the evaluated hit (record + match flags).
  var FILTERS = {
    all: null,
    pages: function (r) { return r.record.type === 'page' && r.titleMatched === true; },
    notes: function (r) { return r.record.type === 'page' && r.bodyMatched === true; },
    homework: function (r) { return r.record.type === 'homework'; },
    tasks: function (r) { return r.record.type === 'task'; },
    timeline: function (r) { return r.record.type === 'timeline'; },
    attachments: function (r) { return r.record.type === 'attachment'; }
  };

  function text(value) { return String(value == null ? '' : value); }

  function normalizeQuery(query) {
    var phrase = text(query).trim().toLowerCase();
    var words = phrase.split(/\s+/).filter(function (w) { return w.length > 0; });
    return { phrase: phrase, words: words };
  }

  // Score one field against one query word.
  // prefix > word-boundary > infix > in-order subsequence > no match.
  function scoreField(haystack, word) {
    var h = text(haystack).toLowerCase();
    if (!h || !word) return 0;
    var idx = h.indexOf(word);
    if (idx === 0) return 1000;
    if (idx > 0) {
      var prev = h.charAt(idx - 1);
      var boundary = !/[a-z0-9]/.test(prev);
      return (boundary ? 700 : 500) - Math.min(idx, 100);
    }
    // In-order subsequence so "apbio" still finds "AP Biology".
    var hi = 0, gaps = 0, matched = 0;
    for (var qi = 0; qi < word.length; qi += 1) {
      var found = h.indexOf(word.charAt(qi), hi);
      if (found < 0) return 0;
      if (found > hi) gaps += found - hi;
      hi = found + 1;
      matched += 1;
    }
    return Math.max(1, 120 - gaps - (h.length - matched));
  }

  function bestFieldScore(value, words) {
    var best = 0;
    for (var i = 0; i < words.length; i += 1) {
      var s = scoreField(value, words[i]);
      if (s > best) best = s;
    }
    return best;
  }

  function countFieldHits(value, words) {
    var h = text(value).toLowerCase();
    if (!h) return 0;
    var hits = 0;
    for (var i = 0; i < words.length; i += 1) {
      if (words[i] && h.indexOf(words[i]) >= 0) hits += 1;
    }
    return hits;
  }

  // A long query should not turn every record containing one common token
  // into a result. Keep single-token fuzzy matching, but require meaningful
  // literal token coverage once the user supplies a more specific query.
  function countCoveredWords(record, words, metadata) {
    return words.reduce(function (total, word) {
      var covered = countFieldHits(record.title, [word]) > 0
        || countFieldHits(record.breadcrumb, [word]) > 0
        || (!record.locked && countFieldHits(record.body, [word]) > 0)
        || (record.type !== 'page' && countFieldHits(metadata, [word]) > 0);
      return total + (covered ? 1 : 0);
    }, 0);
  }

  function requiredWordCoverage(wordCount) {
    if (wordCount <= 1) return 1;
    if (wordCount === 2) return 2;
    return Math.ceil(wordCount * 0.65);
  }

  // Earliest position (case-insensitive) of any query word inside text.
  function firstMatchPosition(value, words) {
    var h = text(value).toLowerCase();
    var best = -1;
    for (var i = 0; i < words.length; i += 1) {
      var found = words[i] ? h.indexOf(words[i]) : -1;
      if (found >= 0 && (best < 0 || found < best)) best = found;
    }
    return best;
  }

  // Bounded contextual snippet with non-overlapping [start, end) match
  // ranges relative to the returned snippet text.
  function buildSnippet(value, words, maxLength) {
    var source = text(value);
    var maxLen = Math.max(60, Number(maxLength) || SNIPPET_LENGTH);
    if (!source) return null;
    if (source.length <= maxLen) {
      return { text: source, ranges: collectRanges(source, words) };
    }
    var pos = firstMatchPosition(source, words);
    var start = pos < 0 ? 0 : Math.max(0, pos - SNIPPET_CONTEXT);
    var end = Math.min(source.length, start + maxLen);
    if (end - start < maxLen) start = Math.max(0, end - maxLen);
    var slice = source.slice(start, end);
    // Trim partial words at the edges when we cut mid-token.
    if (start > 0) {
      var firstSpace = slice.indexOf(' ');
      if (firstSpace > 0 && firstSpace < SNIPPET_CONTEXT) slice = slice.slice(firstSpace + 1);
    }
    if (end < source.length) {
      var lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > slice.length - SNIPPET_CONTEXT && lastSpace > 0) slice = slice.slice(0, lastSpace);
    }
    var prefix = start > 0 ? '…' : '';
    var suffix = (start + slice.length) < source.length ? '…' : '';
    var snippet = prefix + slice.trim() + suffix;
    return { text: snippet, ranges: collectRanges(snippet, words) };
  }

  // Collect non-overlapping [start, end) ranges for every query word inside
  // the final snippet text, so highlight offsets are correct by construction.
  function collectRanges(snippet, words) {
    var ranges = [];
    var lower = text(snippet).toLowerCase();
    for (var w = 0; w < words.length; w += 1) {
      var word = words[w];
      if (!word) continue;
      var from = 0;
      while (ranges.length < MAX_RANGES) {
        var found = lower.indexOf(word, from);
        if (found < 0) break;
        var end = found + word.length;
        var overlaps = ranges.some(function (r) { return found < r[1] && end > r[0]; });
        if (!overlaps) ranges.push([found, end]);
        from = end;
      }
    }
    return ranges.sort(function (a, b) { return a[0] - b[0]; });
  }

  function metadataText(record) {
    var meta = record && record.metadata;
    if (!meta || typeof meta !== 'object') return '';
    var parts = [];
    Object.keys(meta).forEach(function (key) {
      if (key === 'context' || key === 'locked') return;
      var value = meta[key];
      if (value == null || value === '' || typeof value === 'boolean') return;
      if (Array.isArray(value)) { parts.push(value.join(' ')); return; }
      if (typeof value === 'object') return;
      parts.push(text(value));
    });
    return parts.join(' ');
  }

  function recencyBonus(timestamp, now) {
    if (!timestamp) return 0;
    var ageDays = Math.max(0, (now - timestamp) / 86400000);
    if (ageDays <= 7) return 8;
    if (ageDays <= 30) return 4;
    return 0;
  }

  function urgencyBonus(record, now) {
    if (record.type !== 'homework' && record.type !== 'task') return 0;
    var meta = record.metadata || {};
    if (meta.completed === true || meta.done === true) return -15;
    var due = text(meta.due || meta.date);
    if (!due) return 0;
    var parsed = Date.parse(due.length === 10 ? due + 'T23:59:59' : due);
    if (!Number.isFinite(parsed)) return 0;
    var diffDays = (parsed - now) / 86400000;
    if (diffDays < 0) return 10;
    if (diffDays <= 2) return 6;
    if (diffDays <= 7) return 3;
    return 0;
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = text(raw.type);
    if (!TYPE_LABELS.hasOwnProperty(type)) return null;
    var id = text(raw.sourceId || raw.id);
    if (!id) return null;
    var locked = raw.locked === true;
    var title = text(raw.title).trim();
    if (!title) return null;
    return {
      sourceId: id,
      type: type,
      title: title,
      body: locked ? '' : text(raw.body),
      breadcrumb: text(raw.breadcrumb).trim(),
      metadata: (raw.metadata && typeof raw.metadata === 'object') ? raw.metadata : {},
      timestamp: Number(raw.timestamp) || 0,
      locked: locked,
      prematched: raw.prematched === true,
      action: typeof raw.action === 'function' ? raw.action : null
    };
  }

  function evaluateRecord(record, query, now) {
    var words = query.words;
    var phrase = query.phrase;
    var metadata = metadataText(record);
    var titleBest = bestFieldScore(record.title, words);
    var titleHits = countFieldHits(record.title, words);
    var pathBest = bestFieldScore(record.breadcrumb, words);
    var metaBest = bestFieldScore(metadata, words);
    var bodyHits = record.locked ? 0 : Math.min(countFieldHits(record.body, words), MAX_BODY_WORDS);
    var phraseInTitle = !!phrase && record.title.toLowerCase().indexOf(phrase) >= 0;
    var phraseInBody = !record.locked && !!phrase && record.body.toLowerCase().indexOf(phrase) >= 0;

    var titleMatched = titleBest > 0 || pathBest > 0 || phraseInTitle;
    var bodyMatched = bodyHits > 0 || phraseInBody;
    var metaMatched = metaBest > 0;

    if (record.prematched) {
      // Already filtered by the owning module; never dropped, never ranked
      // above a strong direct match.
      var preScore = 30 + Math.round(bestFieldScore(record.title, [phrase]) * 0.5);
      return {
        record: record,
        score: preScore,
        titleMatched: true,
        bodyMatched: false,
        matchKind: 'title',
        snippet: null
      };
    }

    // Qualification contract: pages qualify through title/location or note
    // body only (Pages=title/location, Notes=body). Other record types also
    // qualify through metadata alone — due dates, priority, category, time,
    // kind, MIME, and size are real search fields, not just ranking boosts.
    var qualified = titleMatched || bodyMatched || (record.type !== 'page' && metaMatched);
    if (!qualified) return null;

    var coveredWords = countCoveredWords(record, words, metadata);
    if (words.length > 1 && coveredWords < requiredWordCoverage(words.length)) return null;
    var allWords = coveredWords === words.length;

    var score = titleBest
      + (titleHits > 1 ? (titleHits - 1) * 40 : 0)
      + Math.min(pathBest * 0.35, 200)
      + Math.min(metaBest * 0.25, 150)
      + bodyHits * 22
      + (phraseInTitle ? 80 : 0)
      + (phraseInBody ? 25 : 0)
      + (allWords ? 45 : 0)
      + recencyBonus(record.timestamp, now)
      + urgencyBonus(record, now);

    var snippet = null;
    if (bodyMatched && !record.locked && record.body) {
      snippet = buildSnippet(record.body, words, SNIPPET_LENGTH);
    }

    return {
      record: record,
      score: Math.round(score),
      titleMatched: titleMatched,
      bodyMatched: bodyMatched,
      matchKind: titleMatched ? 'title' : (bodyMatched ? 'body' : 'meta'),
      snippet: snippet
    };
  }

  function labelFor(hit, filter) {
    var record = hit.record;
    if (record.type === 'page') {
      if (filter === 'notes') return TYPE_LABELS.note;
      if (filter === 'pages') return TYPE_LABELS.page;
      return hit.matchKind === 'body' ? TYPE_LABELS.note : TYPE_LABELS.page;
    }
    return TYPE_LABELS[record.type] || 'Result';
  }

  function search(records, query, options) {
    var opts = options || {};
    var filter = FILTERS.hasOwnProperty(opts.filter) ? opts.filter : 'all';
    var limitDefault = filter === 'all' ? DEFAULT_LIMIT_ALL : DEFAULT_LIMIT_FILTERED;
    var limit = Math.max(1, Math.min(200, Number(opts.limit) || limitDefault));
    var now = Number(opts.now) || Date.now();
    var parsedQuery = normalizeQuery(query);

    if (!parsedQuery.words.length) {
      return { query: text(query), filter: filter, total: 0, results: [], counts: {} };
    }

    var seen = Object.create(null);
    var evaluated = [];
    var counts = Object.create(null);
    var source = Array.isArray(records) ? records : [];

    for (var i = 0; i < source.length; i += 1) {
      var record = normalizeRecord(source[i]);
      if (!record) continue;
      var key = record.type + ':' + record.sourceId;
      if (seen[key]) continue;
      seen[key] = true;
      var hit = evaluateRecord(record, parsedQuery, now);
      if (!hit) continue;
      counts[record.type] = (counts[record.type] || 0) + 1;
      if (filter !== 'all' && !FILTERS[filter](hit)) continue;
      evaluated.push(hit);
    }

    evaluated.sort(function (a, b) {
      return b.score - a.score
        || (b.record.timestamp || 0) - (a.record.timestamp || 0)
        || a.record.title.localeCompare(b.record.title);
    });

    var results = evaluated.slice(0, limit).map(function (hit) {
      var record = hit.record;
      return {
        id: record.type + ':' + record.sourceId,
        sourceId: record.sourceId,
        type: record.type,
        typeLabel: labelFor(hit, filter),
        title: record.title,
        breadcrumb: record.breadcrumb,
        snippet: hit.snippet,
        metadata: record.metadata,
        score: hit.score,
        matchKind: hit.matchKind,
        locked: record.locked,
        prematched: record.prematched,
        timestamp: record.timestamp,
        action: record.action
      };
    });

    return { query: text(query), filter: filter, total: evaluated.length, results: results, counts: counts };
  }

  var api = {
    VERSION: VERSION,
    search: search,
    buildSnippet: buildSnippet,
    scoreField: scoreField,
    normalizeQuery: normalizeQuery,
    TYPE_LABELS: TYPE_LABELS,
    FILTERS: Object.keys(FILTERS)
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraGlobalSearchEngine = api;
}(typeof window !== 'undefined' ? window : globalThis));
