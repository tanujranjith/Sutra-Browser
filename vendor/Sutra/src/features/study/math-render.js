/*
 * math-render.js — local LaTeX/Math rendering for Sutra (window.SutraMath).
 *
 * Wraps the locally-vendored KaTeX build (assets/vendor/katex/) and renders
 * `$...$` (inline) and `$$...$$` (display) math found in note bodies, review
 * cards, and assistant/markdown output. KaTeX is loaded LAZILY — only the first
 * time math is actually encountered — so startup stays fast and the ~0.5 MB of
 * KaTeX + fonts is never fetched for users who never write math. Everything is
 * served same-origin from the vendor folder, so it works fully offline after
 * first use (the service worker runtime-caches it).
 *
 * KaTeX output is injected via SutraDOMSafety.setTrustedHTML: KaTeX is rendered
 * with output:'html' (span-based, no <math>/<svg> — which the user-HTML
 * sanitizer would strip) and trust:false, so the LaTeX->HTML transform itself is
 * the sanitizer (no scripts/handlers can be emitted).
 *
 * Zero dependencies, classic script, attaches to window — matches the other
 * core helpers' style.
 */
(function () {
  'use strict';

  var VERSION = '20260620';
  var KATEX_JS = 'assets/vendor/katex/katex.min.js?v=' + VERSION;
  var KATEX_CSS = 'assets/vendor/katex/katex.min.css?v=' + VERSION;
  var loadPromise = null;
  var cssInjected = false;

  function injectCss() {
    if (cssInjected || typeof document === 'undefined') return;
    cssInjected = true;
    try {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = KATEX_CSS;
      document.head.appendChild(link);
    } catch (e) { /* non-critical */ }
  }

  function ensureKatex() {
    if (typeof window !== 'undefined' && window.katex) { injectCss(); return Promise.resolve(window.katex); }
    if (loadPromise) return loadPromise;
    if (typeof document === 'undefined') return Promise.resolve(null);
    injectCss();
    loadPromise = new Promise(function (resolve, reject) {
      try {
        var s = document.createElement('script');
        s.src = KATEX_JS;
        s.async = true;
        s.onload = function () { resolve(window.katex || null); };
        s.onerror = function () { loadPromise = null; reject(new Error('KaTeX failed to load')); };
        document.head.appendChild(s);
      } catch (e) { loadPromise = null; reject(e); }
    });
    return loadPromise;
  }

  function renderToHtml(tex, displayMode) {
    if (typeof window === 'undefined' || !window.katex) return null;
    try {
      return window.katex.renderToString(String(tex || ''), {
        displayMode: !!displayMode,
        throwOnError: false,
        output: 'html',
        strict: 'ignore'
      });
    } catch (e) { return null; }
  }

  function hasMath(text) {
    return /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(String(text || ''));
  }

  var SKIP_TAGS = { CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };

  // Asynchronously render any math inside `root` (a DOM element). Lazy-loads
  // KaTeX on first use. Resolves true if anything was rendered.
  function renderInElement(root) {
    if (!root || typeof document === 'undefined') return Promise.resolve(false);
    if (!hasMath(root.textContent || '')) return Promise.resolve(false);
    return ensureKatex().then(function () {
      if (!window.katex) return false;
      processNode(root);
      return true;
    }).catch(function () { return false; });
  }

  function processNode(node) {
    var children = [];
    var c = node.firstChild;
    while (c) { children.push(c); c = c.nextSibling; }
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child.nodeType === 1) {
        var tag = child.tagName ? child.tagName.toUpperCase() : '';
        if (SKIP_TAGS[tag]) continue;
        if (child.classList && (child.classList.contains('katex') || child.classList.contains('sutra-math'))) continue;
        processNode(child);
      } else if (child.nodeType === 3) {
        replaceInTextNode(child);
      }
    }
  }

  function replaceInTextNode(textNode) {
    var text = textNode.nodeValue || '';
    if (text.indexOf('$') === -1) return;
    var segments = splitMath(text);
    if (segments.length === 1 && segments[0].type === 'text') return;
    var frag = document.createDocumentFragment();
    segments.forEach(function (seg) {
      if (seg.type === 'text') {
        frag.appendChild(document.createTextNode(seg.value));
        return;
      }
      var html = renderToHtml(seg.value, seg.display);
      if (html === null) {
        frag.appendChild(document.createTextNode(seg.raw));
        return;
      }
      var span = document.createElement('span');
      span.className = 'sutra-math';
      if (window.SutraDOMSafety && window.SutraDOMSafety.setTrustedHTML) {
        window.SutraDOMSafety.setTrustedHTML(span, html);
      } else {
        span.textContent = seg.raw;
      }
      frag.appendChild(span);
    });
    if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
  }

  // Split text into text/math segments: block ($$...$$) first, then inline.
  function splitMath(text) {
    var blockRe = /\$\$([\s\S]+?)\$\$/g;
    var inlineRe = /\$([^$\n]+?)\$/g;
    var blockPass = [];
    var last = 0;
    var m;
    while ((m = blockRe.exec(text)) !== null) {
      if (m.index > last) blockPass.push({ type: 'text', value: text.slice(last, m.index) });
      blockPass.push({ type: 'math', value: m[1], raw: m[0], display: true });
      last = blockRe.lastIndex;
    }
    if (last < text.length) blockPass.push({ type: 'text', value: text.slice(last) });

    var result = [];
    blockPass.forEach(function (seg) {
      if (seg.type !== 'text') { result.push(seg); return; }
      var t = seg.value;
      var li = 0;
      var im;
      inlineRe.lastIndex = 0;
      while ((im = inlineRe.exec(t)) !== null) {
        if (im.index > li) result.push({ type: 'text', value: t.slice(li, im.index) });
        result.push({ type: 'math', value: im[1], raw: im[0], display: false });
        li = inlineRe.lastIndex;
      }
      if (li < t.length) result.push({ type: 'text', value: t.slice(li) });
    });
    return result.length ? result : [{ type: 'text', value: text }];
  }

  window.SutraMath = {
    ensure: ensureKatex,
    renderToHtml: renderToHtml,
    renderInElement: renderInElement,
    hasMath: hasMath
  };
})();
