/* Local, permission-aware index and retrieval for Sutra notes. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_CHUNK_SIZE = 1200;
  var DEFAULT_OVERLAP = 160;
  var STOP_WORDS = new Set(('a an and are as at be been but by can did do does for from had has have how i if in into is it its may more my no not of on or our should so than that the their then there these they this to up was we were what when where which who why will with would you your').split(' '));

  function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function text(value) { return String(value == null ? '' : value); }
  function decodeEntities(value) {
    var entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (_, key) {
      var lower = key.toLowerCase();
      if (entities[lower] != null) return entities[lower];
      if (lower.charAt(0) === '#') {
        var hex = lower.charAt(1) === 'x';
        var code = parseInt(lower.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ' ';
    });
  }
  function htmlToText(value) {
    return decodeEntities(text(value)
      .replace(/<\s*(script|style|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|blockquote|pre|tr|section|article)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n'))
      .trim();
  }
  function normalize(value) {
    return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function tokens(value) {
    return normalize(value).split(/\s+/).filter(function (token) { return token.length > 1 && !STOP_WORDS.has(token); });
  }
  function unique(values) { return Array.from(new Set(values)); }
  function safetyFlags(value) {
    var source = text(value);
    var flags = [];
    if (/ignore\s+(?:all\s+)?(?:previous|prior|system|developer)(?:\s+\w+){0,3}\s+instructions/i.test(source)) flags.push('prompt_injection_language');
    if (/(?:reveal|print|repeat|show)\s+(?:the\s+)?(?:(?:hidden\s+)?system prompt|hidden instructions|developer message)/i.test(source)) flags.push('prompt_exfiltration_language');
    if (/(?:flow-actions|sutra-actions)|<\/?(?:system|assistant|developer)>/i.test(source)) flags.push('action_or_role_spoofing');
    return flags;
  }
  function bounded(value, max) { var out = text(value); return out.length > max ? out.slice(0, max) : out; }
  function timestamp(value) { var parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }
  function isUnlocked(note, options) {
    if (!note || note.isLocked !== true) return true;
    var opts = options || {};
    if (opts.allowLocked !== true) return false;
    var ids = opts.unlockedNoteIds;
    if (ids instanceof Set) return ids.has(note.id) || ids.has(String(note.id));
    return Array.isArray(ids) && ids.map(String).indexOf(String(note.id)) >= 0;
  }
  function noteTags(note) {
    return unique((Array.isArray(note.tags) ? note.tags : []).map(function (tag) {
      return bounded(typeof tag === 'object' && tag ? (tag.name || tag.label || tag.id) : tag, 120).trim();
    }).filter(Boolean));
  }
  function noteFolder(note) {
    return bounded(note.folderId || note.folder || note.spaceId || note.parentId || note.activeSpaceId || '', 160);
  }
  function extractLinks(value) {
    var source = text(value), refs = [], match;
    var idPattern = /sutra:\/\/(?:page|note)\/([^\s)"'<>]+)/gi;
    while ((match = idPattern.exec(source))) refs.push({ type: 'id', value: match[1] });
    var wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    while ((match = wikiPattern.exec(source))) refs.push({ type: 'title', value: match[1].trim() });
    return refs.slice(0, 300);
  }
  function headingSections(raw, plain) {
    var sections = [];
    var headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>|^(#{1,6})\s+(.+)$/gim;
    var match, headings = [];
    while ((match = headingRegex.exec(raw))) {
      var label = htmlToText(match[2] || match[4] || '').trim();
      if (label) headings.push({ level: Number(match[1] || match[3].length), label: bounded(label, 240) });
    }
    if (!headings.length) return [{ headingPath: [], start: 0, end: plain.length }];
    var cursor = 0, path = [];
    headings.forEach(function (heading, index) {
      var found = plain.toLowerCase().indexOf(heading.label.toLowerCase(), cursor);
      if (found < 0) found = cursor;
      if (sections.length) sections[sections.length - 1].end = found;
      path = path.slice(0, Math.max(0, heading.level - 1));
      path[heading.level - 1] = heading.label;
      path = path.filter(Boolean);
      sections.push({ headingPath: path.slice(), start: found, end: plain.length, ordinal: index });
      cursor = Math.min(plain.length, found + heading.label.length);
    });
    if (sections[0].start > 0) sections.unshift({ headingPath: [], start: 0, end: sections[0].start, ordinal: -1 });
    return sections.filter(function (section) { return section.end > section.start; });
  }
  function splitRange(content, start, end, maxSize, overlap) {
    var ranges = [], cursor = start;
    while (cursor < end) {
      var target = Math.min(end, cursor + maxSize), finish = target;
      if (target < end) {
        var floor = Math.max(cursor + Math.floor(maxSize * 0.55), cursor);
        var paragraph = content.lastIndexOf('\n\n', target);
        var sentence = Math.max(content.lastIndexOf('. ', target), content.lastIndexOf('? ', target), content.lastIndexOf('! ', target));
        var boundary = Math.max(paragraph, sentence);
        if (boundary >= floor) finish = boundary + (boundary === paragraph ? 2 : 1);
      }
      if (finish <= cursor) finish = target;
      ranges.push({ start: cursor, end: finish });
      if (finish >= end) break;
      cursor = Math.max(cursor + 1, finish - overlap);
    }
    return ranges;
  }
  function buildIndex(notes, options) {
    var opts = options || {}, maxSize = Math.max(300, Number(opts.chunkSize) || DEFAULT_CHUNK_SIZE);
    var overlap = Math.max(0, Math.min(Math.floor(maxSize / 3), Number(opts.overlap) || DEFAULT_OVERLAP));
    var source = Array.isArray(notes) ? notes : [], titleToId = new Map(), noteIds = new Set();
    source.forEach(function (note) {
      if (!note || note.id == null) return;
      noteIds.add(String(note.id));
      var titleKey = normalize(note.title || 'Untitled');
      if (titleKey && !titleToId.has(titleKey)) titleToId.set(titleKey, String(note.id));
    });
    var chunks = [], excluded = [], backlinks = Object.create(null);
    source.forEach(function (note) {
      if (!note || note.id == null) return;
      var id = String(note.id);
      if (!isUnlocked(note, opts)) { excluded.push({ noteId: id, reason: 'locked' }); return; }
      if (String(note.type || '').toLowerCase() === 'canvas' && !note.content && !note.body) return;
      var raw = text(note.content || note.body || note.text || '');
      var attachmentSources = (Array.isArray(note.attachmentSources) ? note.attachmentSources : []).filter(function (source) {
        return source && source.extractedText;
      });
      if (attachmentSources.length) {
        raw += attachmentSources.map(function (source) {
          return '\n\n## Attachment: ' + bounded(source.name || 'File', 240) + '\n' + bounded(source.extractedText, 400000);
        }).join('');
      }
      var plain = htmlToText(raw);
      var title = bounded(note.title || 'Untitled', 300), tags = noteTags(note), folder = noteFolder(note);
      var links = extractLinks(raw).map(function (ref) {
        if (ref.type === 'id' && noteIds.has(String(ref.value))) return String(ref.value);
        if (ref.type === 'title') return titleToId.get(normalize(ref.value)) || '';
        return '';
      }).filter(Boolean);
      links.forEach(function (target) {
        if (!backlinks[target]) backlinks[target] = [];
        if (backlinks[target].indexOf(id) < 0) backlinks[target].push(id);
      });
      if (!plain && !title && !tags.length) return;
      var sections = headingSections(raw, plain || title);
      sections.forEach(function (section, sectionIndex) {
        splitRange(plain || title, section.start, section.end, maxSize, overlap).forEach(function (range, partIndex) {
          var chunkText = (plain || title).slice(range.start, range.end).trim();
          if (!chunkText && sectionIndex > 0) return;
          var normalizedText = normalize([title, section.headingPath.join(' '), tags.join(' '), chunkText].join(' '));
          chunks.push({
            id: id + ':' + sectionIndex + ':' + partIndex,
            noteId: id,
            blockId: bounded(note.blockId || note.id + ':section:' + sectionIndex, 200),
            title: title,
            headingPath: section.headingPath.slice(),
            tags: tags.slice(),
            folder: folder,
            backlinks: [],
            outgoingLinks: links.slice(),
            attachmentSourceIds: attachmentSources.map(function (source) { return text(source.id); }).filter(Boolean),
            createdAt: text(note.createdAt || ''),
            updatedAt: text(note.updatedAt || note.modifiedAt || note.createdAt || ''),
            version: text(note.versionId || note.version || (Array.isArray(note.versions) ? note.versions.length : '')),
            sourceOffsets: { start: range.start, end: range.end },
            text: chunkText,
            normalizedText: normalizedText,
            tokenSet: unique(tokens(normalizedText)),
            locked: false
          });
        });
      });
      if (opts.includeVersions === true && Array.isArray(note.versions)) {
        note.versions.slice(-50).forEach(function (versionRow) {
          var state = versionRow && versionRow.state && typeof versionRow.state === 'object' ? versionRow.state : versionRow;
          var versionContent = state && (state.content == null ? state.body : state.content);
          if (versionContent == null) return;
          var versionId = text(versionRow.id || versionRow.versionId || versionRow.createdAt || 'snapshot');
          var versionIndex = buildIndex([Object.assign({}, note, {
            content: versionContent,
            body: '',
            versions: [],
            versionId: versionId,
            updatedAt: versionRow.createdAt || versionRow.updatedAt || note.updatedAt
          })], Object.assign({}, opts, { includeVersions: false }));
          versionIndex.chunks.forEach(function (chunk) {
            chunk.id += ':version:' + versionId;
            chunk.historical = true;
            chunk.version = versionId;
            chunks.push(chunk);
          });
        });
      }
    });
    chunks.forEach(function (chunk) { chunk.backlinks = (backlinks[chunk.noteId] || []).slice(); });
    return {
      schema: 'sutra-notes-index/1', version: VERSION, builtAt: new Date().toISOString(),
      chunks: chunks, excluded: excluded, noteCount: unique(chunks.map(function (chunk) { return chunk.noteId; })).length,
      backlinks: backlinks
    };
  }
  function diceCoefficient(a, b) {
    if (a === b) return 1;
    if (!a || !b || a.length < 2 || b.length < 2) return 0;
    var pairs = new Map(), hits = 0;
    for (var i = 0; i < a.length - 1; i += 1) { var pair = a.slice(i, i + 2); pairs.set(pair, (pairs.get(pair) || 0) + 1); }
    for (var j = 0; j < b.length - 1; j += 1) { var next = b.slice(j, j + 2), count = pairs.get(next) || 0; if (count) { hits += 1; pairs.set(next, count - 1); } }
    return (2 * hits) / (a.length + b.length - 2);
  }
  function quoteFor(chunk, queryTokens, maxLength) {
    var value = chunk.text || chunk.title, lower = normalize(value), best = -1;
    queryTokens.forEach(function (token) { var found = lower.indexOf(token); if (found >= 0 && (best < 0 || found < best)) best = found; });
    var length = Math.max(80, Number(maxLength) || 280);
    if (value.length <= length) return value;
    var start = Math.max(0, best < 0 ? 0 : best - Math.floor(length * 0.3));
    var end = Math.min(value.length, start + length);
    return (start ? '…' : '') + value.slice(start, end).trim() + (end < value.length ? '…' : '');
  }
  function passesScope(chunk, scope, index) {
    var value = scope || { type: 'all' }, type = value.type || 'all';
    if (type === 'all' || type === 'workspace') return true;
    if (type === 'current' || type === 'note') return String(chunk.noteId) === String(value.noteId || value.id || '');
    if (type === 'folder' || type === 'project') return String(chunk.folder) === String(value.folderId || value.projectId || value.id || '');
    if (type === 'tag') return chunk.tags.map(normalize).indexOf(normalize(value.tag || value.id || '')) >= 0;
    if (type === 'notes') return (value.noteIds || []).map(String).indexOf(String(chunk.noteId)) >= 0;
    if (type === 'linked') {
      var root = String(value.noteId || value.id || ''), linked = new Set([root]);
      ((index && index.backlinks && index.backlinks[root]) || []).forEach(function (id) { linked.add(String(id)); });
      (index.chunks || []).filter(function (row) { return row.noteId === root; }).forEach(function (row) { row.outgoingLinks.forEach(function (id) { linked.add(String(id)); }); });
      return linked.has(String(chunk.noteId));
    }
    return true;
  }
  function search(index, query, options) {
    var opts = options || {}, normalizedQuery = normalize(query), queryTokens = unique(tokens(query));
    var limit = Math.max(1, Math.min(50, Number(opts.limit) || 8)), now = Number(opts.now) || Date.now();
    var excludedSourceIds = new Set((Array.isArray(opts.excludedSourceIds) ? opts.excludedSourceIds : []).map(String));
    var excludedNoteIds = new Set((Array.isArray(opts.excludedNoteIds) ? opts.excludedNoteIds : []).map(String));
    var rows = (index && Array.isArray(index.chunks) ? index.chunks : []).filter(function (chunk) {
      if (excludedSourceIds.has(String(chunk.id)) || excludedNoteIds.has(String(chunk.noteId))) return false;
      if (chunk.historical && opts.includeVersions !== true) return false;
      if (opts.versionId && String(chunk.version) !== String(opts.versionId)) return false;
      return passesScope(chunk, opts.scope, index);
    }).map(function (chunk) {
      var reasons = [], score = 0, matched = 0;
      if (normalizedQuery && chunk.normalizedText.indexOf(normalizedQuery) >= 0) { score += 18; reasons.push('exact_phrase'); }
      queryTokens.forEach(function (token) {
        if (chunk.tokenSet.indexOf(token) >= 0) { matched += 1; score += 3; }
        else {
          var fuzzy = chunk.tokenSet.some(function (candidate) {
            return candidate.length > 3 && token.charAt(0) === candidate.charAt(0)
              && Math.abs(token.length - candidate.length) <= 2
              && diceCoefficient(token, candidate) >= 0.9;
          });
          if (fuzzy) { matched += 0.55; score += 1.1; if (reasons.indexOf('fuzzy_match') < 0) reasons.push('fuzzy_match'); }
        }
      });
      if (matched) reasons.push(matched >= queryTokens.length && queryTokens.length ? 'all_terms' : 'term_match');
      var titleNorm = normalize(chunk.title), headingNorm = normalize(chunk.headingPath.join(' '));
      queryTokens.forEach(function (token) {
        if (titleNorm.split(' ').indexOf(token) >= 0) { score += 4; if (reasons.indexOf('title_match') < 0) reasons.push('title_match'); }
        if (headingNorm.split(' ').indexOf(token) >= 0) { score += 3; if (reasons.indexOf('heading_match') < 0) reasons.push('heading_match'); }
        if (chunk.tags.map(normalize).indexOf(token) >= 0) { score += 3; if (reasons.indexOf('tag_match') < 0) reasons.push('tag_match'); }
      });
      var hasQueryMatch = score > 0;
      if (hasQueryMatch && opts.currentNoteId && chunk.backlinks.indexOf(String(opts.currentNoteId)) >= 0) { score += 2.5; reasons.push('backlink'); }
      if (hasQueryMatch && String(chunk.noteId) === String(opts.currentNoteId || '')) { score += 1.5; reasons.push('current_note'); }
      var ageDays = chunk.updatedAt ? Math.max(0, (now - timestamp(chunk.updatedAt)) / 86400000) : Infinity;
      if (hasQueryMatch && ageDays <= 7) { score += 1.2; reasons.push('recent'); }
      else if (hasQueryMatch && ageDays <= 30) score += 0.5;
      if (!normalizedQuery && opts.allowEmptyQuery === true) score += ageDays <= 7 ? 2 : 0.1;
      return { chunk: chunk, score: score, reasons: unique(reasons), ageDays: ageDays };
    }).filter(function (row) { return row.score > 0; });
    rows.sort(function (a, b) { return b.score - a.score || timestamp(b.chunk.updatedAt) - timestamp(a.chunk.updatedAt) || a.chunk.id.localeCompare(b.chunk.id); });
    var seen = new Set(), results = [];
    rows.some(function (row) {
      var key = row.chunk.noteId + ':' + row.chunk.sourceOffsets.start;
      if (seen.has(key)) return false;
      seen.add(key);
      var confidence = row.score >= 9 ? 'high' : row.score >= 6 ? 'medium' : 'low';
      results.push({
        id: row.chunk.id, kind: 'note', noteId: row.chunk.noteId, blockId: row.chunk.blockId,
        title: row.chunk.title, headingPath: row.chunk.headingPath.slice(), quote: quoteFor(row.chunk, queryTokens, opts.quoteLength),
        href: 'sutra://page/' + encodeURIComponent(row.chunk.noteId), updatedAt: row.chunk.updatedAt,
        version: row.chunk.version, sourceOffsets: clone(row.chunk.sourceOffsets), score: Number(row.score.toFixed(3)),
        historical: row.chunk.historical === true,
        confidence: confidence, reasonCodes: row.reasons, stale: Number.isFinite(row.ageDays) && row.ageDays > (Number(opts.staleAfterDays) || 180),
        safetyFlags: safetyFlags(row.chunk.text),
        metadata: { tags: row.chunk.tags.slice(), folder: row.chunk.folder, backlinks: row.chunk.backlinks.slice(), attachmentSourceIds: row.chunk.attachmentSourceIds.slice() }
      });
      return results.length >= limit;
    });
    return {
      schema: 'sutra-note-retrieval/1', query: text(query), scope: clone(opts.scope || { type: 'all' }),
      sources: results, evidenceStatus: results.length ? (results.some(function (r) { return r.confidence === 'high'; }) ? 'supported' : 'limited') : 'missing',
      excludedCount: index && Array.isArray(index.excluded) ? index.excluded.length : 0
    };
  }
  function create(options) {
    var current = buildIndex([], options);
    return {
      rebuild: function (notes, nextOptions) { current = buildIndex(notes, Object.assign({}, options || {}, nextOptions || {})); return clone(current); },
      search: function (query, searchOptions) { return search(current, query, searchOptions); },
      snapshot: function () { return clone(current); }
    };
  }

  var api = { VERSION: VERSION, htmlToText: htmlToText, safetyFlags: safetyFlags, buildIndex: buildIndex, search: search, create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraNotesKnowledgeCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
