/*
 * code-highlight.js — tiny, dependency-free syntax highlighter (window.SutraHighlight).
 *
 * Fenced code blocks store a `language-xxx` class but were never highlighted.
 * Rather than vendor a large highlighter, this is a compact, safe, offline
 * tokenizer: it escapes ALL text first via a single master regex that matches
 * comments, strings, numbers, and identifiers, wrapping recognised keywords.
 * It is intentionally language-approximate (one shared keyword set plus a few
 * per-language extras) — enough to make code readable, with zero risk of HTML
 * injection because every emitted piece is escaped.
 *
 * Classes emitted: tok-comment, tok-string, tok-number, tok-keyword. Styling
 * lives in styles/base/styles.css.
 */
(function () {
  'use strict';

  var COMMON = ('return if else for while do switch case break continue function ' +
    'const let var class new this typeof instanceof void delete in of try catch ' +
    'finally throw import export from default extends super async await yield ' +
    'public private protected static final void int float double char boolean ' +
    'string def elif lambda pass with as not and or is None True False null true ' +
    'false undefined struct enum interface type implements package func go defer ' +
    'select map range nil fn match use mod pub impl trait where self').split(/\s+/);

  var EXTRA = {
    python: 'print self elif lambda pass yield global nonlocal assert raise except'.split(/\s+/),
    py: 'print self elif lambda pass yield global nonlocal assert raise except'.split(/\s+/),
    sql: 'select from where insert update delete into values join left right inner outer group by order having limit distinct create table drop alter'.split(/\s+/),
    rust: 'fn let mut impl trait pub use mod match enum struct where dyn unsafe'.split(/\s+/)
  };

  function buildKeywordSet(lang) {
    var set = Object.create(null);
    COMMON.forEach(function (k) { set[k] = 1; });
    var key = String(lang || '').toLowerCase();
    if (EXTRA[key]) EXTRA[key].forEach(function (k) { set[k] = 1; });
    return set;
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  // Returns an HTML string with token spans. Input is plain code text.
  function highlight(code, lang) {
    var src = String(code || '');
    var kw = buildKeywordSet(lang);
    var re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b|\b0[xX][0-9a-fA-F]+\b)|([A-Za-z_$][\w$]*)/g;
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += '<span class="tok-comment">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tok-string">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tok-number">' + esc(m[3]) + '</span>';
      else if (m[4]) out += kw[m[4]] ? '<span class="tok-keyword">' + esc(m[4]) + '</span>' : esc(m[4]);
      last = re.lastIndex;
    }
    out += esc(src.slice(last));
    return out;
  }

  function langOf(codeEl) {
    var cls = (codeEl && codeEl.className) || '';
    var m = /language-([A-Za-z0-9_+-]+)/.exec(cls);
    return m ? m[1] : '';
  }

  // Highlight every <pre><code> under root that isn't already highlighted.
  function highlightInElement(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    if (!(window.SutraDOMSafety && window.SutraDOMSafety.setTrustedHTML)) return 0;
    var count = 0;
    var nodes = root.querySelectorAll('pre > code');
    for (var i = 0; i < nodes.length; i += 1) {
      var codeEl = nodes[i];
      if (codeEl.getAttribute('data-sutra-hl') === '1') continue;
      var html = highlight(codeEl.textContent || '', langOf(codeEl));
      window.SutraDOMSafety.setTrustedHTML(codeEl, html);
      codeEl.setAttribute('data-sutra-hl', '1');
      count += 1;
    }
    return count;
  }

  window.SutraHighlight = {
    highlight: highlight,
    highlightInElement: highlightInElement
  };
})();
