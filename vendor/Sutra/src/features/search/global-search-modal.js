/*
 * global-search-modal.js — presentation controller for Sutra's workspace-wide
 * search modal (#globalSearchPanel). DOM and events only: matching, ranking,
 * snippets, and filtering live in the pure engine
 * (src/features/search/global-search-engine.js); live workspace data is
 * injected by src/core/app.js through configure().
 *
 * Exposed as window.SutraGlobalSearchModal. Focus trapping, Escape, scroll
 * lock, and focus restoration are owned by SutraModalManager (src/core/app.js).
 */
(function (global) {
  'use strict';

  var DEBOUNCE_MS = 140;
  var MAX_RECENTS_SHOWN = 6;

  var state = {
    configured: false,
    open: false,
    collect: null,
    getRecents: null,
    trackRecent: null,
    quickActions: [],
    shortcutLabel: 'Ctrl K',
    filter: 'all',
    results: [],
    total: 0,
    activeIndex: -1,
    debounceTimer: null,
    bound: false,
    lastQuery: ''
  };

  function el(id) { return document.getElementById(id); }

  function panel() { return el('globalSearchPanel'); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Escape snippet text, then wrap precomputed engine ranges with <mark>.
  // Ranges are applied on the raw string BEFORE escaping so offsets stay valid.
  function highlightSnippet(snippet) {
    if (!snippet || !snippet.text) return '';
    var source = String(snippet.text);
    var ranges = Array.isArray(snippet.ranges) ? snippet.ranges : [];
    if (!ranges.length) return escapeHtml(source);
    var parts = [];
    var cursor = 0;
    ranges.forEach(function (range) {
      var start = Math.max(0, Math.min(source.length, range[0]));
      var end = Math.max(start, Math.min(source.length, range[1]));
      if (start > cursor) parts.push(escapeHtml(source.slice(cursor, start)));
      parts.push('<mark>' + escapeHtml(source.slice(start, end)) + '</mark>');
      cursor = end;
    });
    if (cursor < source.length) parts.push(escapeHtml(source.slice(cursor)));
    return parts.join('');
  }

  function highlightTitle(title, query) {
    var engine = global.SutraGlobalSearchEngine;
    if (!engine || !query) return escapeHtml(title);
    var parsed = engine.normalizeQuery(query);
    var snippet = engine.buildSnippet(String(title || ''), parsed.words, Math.max(60, String(title || '').length + 10));
    return highlightSnippet(snippet) || escapeHtml(title);
  }

  function typeIcon(type) {
    switch (type) {
      case 'page': return 'fa-file-lines';
      case 'note': return 'fa-file-lines';
      case 'homework': return 'fa-clipboard-list';
      case 'task': return 'fa-circle-check';
      case 'timeline': return 'fa-calendar-day';
      case 'attachment': return 'fa-paperclip';
      case 'course': return 'fa-book';
      case 'apstudy': return 'fa-graduation-cap';
      case 'college': return 'fa-building-columns';
      case 'review': return 'fa-layer-group';
      case 'tracker': return 'fa-seedling';
      case 'assistant': return 'fa-robot';
      case 'setting': return 'fa-gear';
      default: return 'fa-magnifying-glass';
    }
  }

  function formatMetadata(result) {
    var meta = result.metadata || {};
    var parts = [];
    if (meta.due) parts.push('Due ' + meta.due);
    else if (meta.date) parts.push(String(meta.date));
    else if (meta.updatedAt) {
      var parsed = Date.parse(meta.updatedAt);
      if (Number.isFinite(parsed)) parts.push('Edited ' + new Date(parsed).toLocaleDateString());
    }
    if (meta.kind === 'pdf' || String(meta.mimeType || '').indexOf('pdf') >= 0) parts.unshift('PDF');
    if (Number(meta.sizeBytes) > 0) {
      var kb = Number(meta.sizeBytes) / 1024;
      parts.push(kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB');
    }
    if (meta.locked === true) return 'Locked';
    if (meta.completed === true || meta.done === true) parts.unshift('Done');
    return parts.join(' · ');
  }

  function resultItemHtml(result, index, query) {
    var metaText = formatMetadata(result);
    var breadcrumb = result.breadcrumb ? '<span class="global-search-item-path">' + escapeHtml(result.breadcrumb) + '</span>' : '';
    var snippet = result.locked
      ? '<span class="global-search-item-snippet global-search-item-locked"><i class="fas fa-lock" aria-hidden="true"></i> Locked — unlock to search contents</span>'
      : (result.snippet && result.snippet.text
        ? '<span class="global-search-item-snippet">' + highlightSnippet(result.snippet) + '</span>'
        : (result.metadata && result.metadata.context
          ? '<span class="global-search-item-snippet">' + escapeHtml(result.metadata.context) + '</span>'
          : ''));
    return '<div class="global-search-item' + (index === state.activeIndex ? ' is-active' : '') + '" role="option" tabindex="-1" aria-selected="' + (index === state.activeIndex ? 'true' : 'false') + '" id="globalSearchResult-' + index + '" data-gs-index="' + index + '">' +
      '<span class="global-search-item-icon" data-gs-type="' + escapeHtml(result.type) + '" aria-hidden="true"><i class="fas ' + typeIcon(result.type) + (result.locked ? ' fa-lock global-search-icon-lock' : '') + '"></i></span>' +
      '<span class="global-search-item-main">' +
        '<span class="global-search-item-typelabel">' + escapeHtml(result.typeLabel) + '</span>' +
        '<span class="global-search-item-title">' + highlightTitle(result.title, query) + '</span>' +
        (breadcrumb || snippet ? '<span class="global-search-item-sub">' + breadcrumb + snippet + '</span>' : '') +
      '</span>' +
      (metaText ? '<span class="global-search-item-meta">' + escapeHtml(metaText) + '</span>' : '') +
    '</div>';
  }

  function renderResults(query, data) {
    var box = el('globalSearchResults');
    var count = el('globalSearchCount');
    if (!box) return;
    state.results = data.results;
    state.total = data.total;
    state.activeIndex = data.results.length ? 0 : -1;

    if (count) {
      count.textContent = data.total === 1 ? '1 result' : data.total + ' results';
      count.hidden = false;
    }

    if (!data.results.length) {
      setTrustedHtml(box,
        '<div class="global-search-empty">' +
        '<i class="fas fa-magnifying-glass" aria-hidden="true"></i>' +
        '<p>No matches for &ldquo;' + escapeHtml(truncate(query, 60)) + '&rdquo;</p>' +
        '<p class="global-search-empty-hint">' + (state.filter !== 'all' ? 'Try the All filter, or check your spelling.' : 'Try fewer or different words.') + '</p>' +
        '</div>');
      updateActiveDescendant();
      return;
    }

    var html = data.results.map(function (result, index) {
      return resultItemHtml(result, index, query);
    }).join('');
    if (data.total > data.results.length) {
      html += '<div class="global-search-more">Showing first ' + data.results.length + ' of ' + data.total + ' — refine your search to narrow it.</div>';
    }
    setTrustedHtml(box, html);
    updateActiveDescendant();
    scrollActiveIntoView(false);
  }

  function setTrustedHtml(node, html) {
    if (window.SutraDOMSafety && typeof window.SutraDOMSafety.setTrustedHTML === 'function') {
      window.SutraDOMSafety.setTrustedHTML(node, html);
      return;
    }
    node.innerHTML = html; // sutra-allow-html: trusted markup; dynamic values pass escapeHtml()
  }

  function truncate(value, max) {
    var s = String(value || '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function renderEmptyState() {
    var box = el('globalSearchResults');
    var count = el('globalSearchCount');
    if (!box) return;
    state.results = [];
    state.activeIndex = -1;
    if (count) count.hidden = true;
    var recents = safeRecents();
    var actions = Array.isArray(state.quickActions) ? state.quickActions.filter(function (a) { return a && a.label; }) : [];
    var recentsHtml = '';
    if (recents.length) {
      recentsHtml = '<div class="global-search-panel-block">' +
        '<div class="global-search-panel-block-head"><span><i class="fas fa-clock" aria-hidden="true"></i> Recent searches</span>' +
        '<button type="button" class="global-search-clear-recents" data-gs-clear-recents>Clear</button></div>' +
        '<div class="global-search-recent-list">' +
        recents.map(function (entry, idx) {
          return '<button type="button" class="global-search-recent" data-gs-recent="' + idx + '"><i class="fas fa-clock" aria-hidden="true"></i><span>' + escapeHtml(truncate(entry.query, 48)) + '</span></button>';
        }).join('') +
        '</div></div>';
    }
    var actionsHtml = '';
    if (actions.length) {
      actionsHtml = '<div class="global-search-panel-block">' +
        '<div class="global-search-panel-block-head"><span><i class="fas fa-bolt" aria-hidden="true"></i> Quick actions</span></div>' +
        '<div class="global-search-action-list">' +
        actions.map(function (action, idx) {
          return '<button type="button" class="global-search-action" data-gs-action="' + idx + '">' +
            '<i class="fas ' + escapeHtml(action.icon || 'fa-bolt') + '" aria-hidden="true"></i><span>' + escapeHtml(action.label) + '</span>' +
            '<i class="fas fa-chevron-right global-search-action-caret" aria-hidden="true"></i></button>';
        }).join('') +
        '</div></div>';
    }
    if (!recentsHtml && !actionsHtml) {
      setTrustedHtml(box, '<div class="global-search-empty"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><p>Type to search your whole workspace.</p></div>');
      updateActiveDescendant();
      return;
    }
    var blocks = (recentsHtml && actionsHtml)
      ? '<div class="global-search-panel-columns">' + recentsHtml + actionsHtml + '</div>'
      : (recentsHtml || actionsHtml);
    setTrustedHtml(box, blocks);
    updateActiveDescendant();

    box.querySelectorAll('[data-gs-recent]').forEach(function (node) {
      node.addEventListener('click', function () {
        var entry = safeRecents()[Number(node.getAttribute('data-gs-recent'))];
        if (!entry) return;
        var input = el('globalSearchInput');
        if (input) input.value = entry.query;
        syncClearButton();
        runSearch(true);
        refocusInput();
      });
    });
    var clearRecents = box.querySelector('[data-gs-clear-recents]');
    if (clearRecents) clearRecents.addEventListener('click', function () {
      if (typeof state.clearRecents === 'function') state.clearRecents();
      renderEmptyState();
    });
    box.querySelectorAll('[data-gs-action]').forEach(function (node) {
      node.addEventListener('click', function () {
        var action = (Array.isArray(state.quickActions) ? state.quickActions : [])[Number(node.getAttribute('data-gs-action'))];
        close();
        if (action && typeof action.run === 'function') {
          try { action.run(); } catch (err) { /* action owns its diagnostics */ }
        }
      });
    });
  }

  function safeRecents() {
    try {
      var list = typeof state.getRecents === 'function' ? state.getRecents() : [];
      return (Array.isArray(list) ? list : []).filter(function (e) { return e && e.query; }).slice(0, MAX_RECENTS_SHOWN);
    } catch (err) { return []; }
  }

  function runSearch(immediate) {
    var input = el('globalSearchInput');
    if (!input) return;
    var query = String(input.value || '').trim();
    state.lastQuery = query;
    if (state.debounceTimer) { clearTimeout(state.debounceTimer); state.debounceTimer = null; }
    if (!query) { renderEmptyState(); return; }
    var execute = function () {
      state.debounceTimer = null;
      if (!state.open) return;
      var current = el('globalSearchInput');
      if (!current || String(current.value || '').trim() !== query) return;
      var records = [];
      try { records = (typeof state.collect === 'function' ? state.collect(query) : []) || []; } catch (err) { records = []; }
      var engine = global.SutraGlobalSearchEngine;
      var data = engine
        ? engine.search(records, query, { filter: state.filter })
        : { results: [], total: 0 };
      renderResults(query, data);
    };
    if (immediate) execute();
    else state.debounceTimer = setTimeout(execute, DEBOUNCE_MS);
  }

  function refocusInput() {
    var input = el('globalSearchInput');
    if (input) { try { input.focus({ preventScroll: true }); } catch (err) { try { input.focus(); } catch (e) {} } }
  }

  function setActiveIndex(index, options) {
    var results = state.results;
    if (!results.length) { state.activeIndex = -1; updateActiveDescendant(); return; }
    var next = Math.max(0, Math.min(results.length - 1, Number(index) || 0));
    state.activeIndex = next;
    var box = el('globalSearchResults');
    if (box) {
      box.querySelectorAll('.global-search-item').forEach(function (node) {
        var idx = Number(node.getAttribute('data-gs-index'));
        var isActive = idx === next;
        node.classList.toggle('is-active', isActive);
        node.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
    updateActiveDescendant();
    if (!options || options.scroll !== false) scrollActiveIntoView(true);
  }

  function updateActiveDescendant() {
    var input = el('globalSearchInput');
    if (!input) return;
    if (state.activeIndex >= 0 && state.results.length) {
      input.setAttribute('aria-activedescendant', 'globalSearchResult-' + state.activeIndex);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function scrollActiveIntoView(smooth) {
    var box = el('globalSearchResults');
    if (!box || state.activeIndex < 0) return;
    var node = box.querySelector('[data-gs-index="' + state.activeIndex + '"]');
    if (!node || typeof node.scrollIntoView !== 'function') return;
    try {
      node.scrollIntoView({ block: 'nearest', behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
    } catch (err) { try { node.scrollIntoView(false); } catch (e) {} }
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function openResult(index) {
    var result = state.results[Number(index)];
    if (!result) return;
    if (typeof state.trackRecent === 'function' && state.lastQuery) {
      try { state.trackRecent(state.lastQuery); } catch (err) { /* non-critical */ }
    }
    close();
    if (typeof result.action === 'function') {
      try { result.action(); } catch (err) { /* action owns its diagnostics */ }
    }
  }

  function syncClearButton() {
    var input = el('globalSearchInput');
    var clear = el('globalSearchClear');
    if (!input || !clear) return;
    clear.hidden = !String(input.value || '').trim();
  }

  function bindOnce() {
    if (state.bound) return;
    var input = el('globalSearchInput');
    var box = el('globalSearchResults');
    var root = panel();
    if (!input || !box) return;
    state.bound = true;

    // Keep the fast keyboard workflow (the input still receives focus), but
    // do not show a focus ring merely because the modal opened. The ring
    // returns as soon as the student interacts with the search surface.
    var markUserInteraction = function () {
      if (root) root.classList.remove('is-auto-focused');
    };
    if (root) {
      root.addEventListener('pointerdown', markUserInteraction, true);
      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') markUserInteraction();
      }, true);
    }

    input.addEventListener('input', function () {
      markUserInteraction();
      syncClearButton();
      runSearch(false);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!state.results.length) return;
        var next = state.activeIndex + 1;
        setActiveIndex(next >= state.results.length ? 0 : next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!state.results.length) return;
        var prev = state.activeIndex - 1;
        setActiveIndex(prev < 0 ? state.results.length - 1 : prev);
      } else if (event.key === 'Home') {
        if (state.results.length) { event.preventDefault(); setActiveIndex(0); }
      } else if (event.key === 'End') {
        if (state.results.length) { event.preventDefault(); setActiveIndex(state.results.length - 1); }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (state.results.length && state.activeIndex >= 0) openResult(state.activeIndex);
      }
    });

    box.addEventListener('click', function (event) {
      var item = event.target && event.target.closest ? event.target.closest('.global-search-item') : null;
      if (item) { openResult(Number(item.getAttribute('data-gs-index'))); return; }
      var recent = event.target && event.target.closest ? event.target.closest('[data-gs-recent]') : null;
      if (recent) return; // handled by its own listener
    });
    box.addEventListener('mousemove', function (event) {
      var item = event.target && event.target.closest ? event.target.closest('.global-search-item') : null;
      if (!item) return;
      var idx = Number(item.getAttribute('data-gs-index'));
      if (Number.isFinite(idx) && idx !== state.activeIndex) setActiveIndex(idx, { scroll: false });
    });

    document.querySelectorAll('#globalSearchPanel [data-gs-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        setFilter(chip.getAttribute('data-gs-filter'));
      });
    });

    var clear = el('globalSearchClear');
    if (clear) clear.addEventListener('click', function () {
      markUserInteraction();
      var inputField = el('globalSearchInput');
      if (inputField) inputField.value = '';
      syncClearButton();
      setFilter('all');
      renderEmptyState();
      refocusInput();
    });
  }

  function setFilter(filter) {
    state.filter = filter || 'all';
    // Chips are ordinary toggle buttons: the announced state is aria-pressed
    // (matching the static markup), and every chip stays in the natural Tab
    // order — no roving tabindex, no aria-selected.
    document.querySelectorAll('#globalSearchPanel [data-gs-filter]').forEach(function (chip) {
      var isActive = chip.getAttribute('data-gs-filter') === state.filter;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    var input = el('globalSearchInput');
    if (input && String(input.value || '').trim()) runSearch(true);
  }

  function detectShortcutLabel() {
    var platform = '';
    try { platform = String(navigator.platform || navigator.userAgent || ''); } catch (err) { platform = ''; }
    return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
  }

  function configure(options) {
    var opts = options || {};
    if (typeof opts.collect === 'function') state.collect = opts.collect;
    if (typeof opts.getRecents === 'function') state.getRecents = opts.getRecents;
    if (typeof opts.trackRecent === 'function') state.trackRecent = opts.trackRecent;
    if (typeof opts.clearRecents === 'function') state.clearRecents = opts.clearRecents;
    if (Array.isArray(opts.quickActions)) state.quickActions = opts.quickActions;
    state.configured = !!(state.collect);
    return state.configured;
  }

  function open(initialQuery) {
    var root = panel();
    if (!root || !state.configured) return false;
    bindOnce();
    if (!state.open) root.__sutraReturnFocus = document.activeElement;
    state.open = true;
    state.filter = 'all';
    setFilter('all');

    var input = el('globalSearchInput');
    var label = el('globalSearchKbd');
    if (label) label.textContent = state.shortcutLabel;
    var sidebarLabel = el('sidebarSearchKbd');
    if (sidebarLabel) sidebarLabel.textContent = state.shortcutLabel;
    if (input) {
      input.value = String(initialQuery || '');
      input.setAttribute('placeholder', 'Search your workspace…');
    }
    syncClearButton();

    root.classList.add('is-auto-focused');
    root.classList.add('active');
    root.setAttribute('aria-hidden', 'false');
    if (global.SutraModalManager) global.SutraModalManager.sync();
    renderEmptyState();
    if (input && String(input.value || '').trim()) runSearch(true);

    // SutraModalManager also focuses [data-autofocus]; this is the immediate path.
    setTimeout(refocusInput, 0);
    if (input && String(input.value || '').trim()) {
      try { input.select(); } catch (err) {}
    }
    return true;
  }

  function close() {
    var root = panel();
    state.open = false;
    if (state.debounceTimer) { clearTimeout(state.debounceTimer); state.debounceTimer = null; }
    if (!root) return;
    root.classList.remove('active');
    root.classList.remove('is-auto-focused');
    root.setAttribute('aria-hidden', 'true');
    if (global.SutraModalManager) global.SutraModalManager.sync();
  }

  function isOpen() {
    return state.open;
  }

  state.shortcutLabel = detectShortcutLabel();

  var api = { configure: configure, open: open, close: close, isOpen: isOpen, setFilter: setFilter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraGlobalSearchModal = api;
}(typeof window !== 'undefined' ? window : globalThis));
