/*
 * dom-safety.js — central rendering / sanitization layer for Sutra.
 *
 * Loaded before every feature module (right after safe-storage.js) so
 * `window.SutraDOMSafety` is always available at first render. This module is
 * the ONE approved channel for putting markup into the DOM. It exists so that:
 *
 *   - User-authored or imported content is never injected as raw HTML. Note
 *     bodies, titles, task text, workspace fields, assistant output, and
 *     canvas / htmlEmbed-style blocks must flow through `sanitizeUserHTML`
 *     (aggressive allowlist) or `renderUserHTMLToFrame` (sandboxed iframe).
 *   - Developer-authored, static template markup has a single greppable,
 *     auditable entry point (`setTrustedHTML`) instead of hundreds of ad-hoc
 *     `el.innerHTML = ...` sites. The static guardrail
 *     (scripts/sutra-safe-dom-check.mjs) treats these helpers as the approved
 *     channel and fails CI when new raw `innerHTML =` sinks appear.
 *   - Plain text always has a zero-think safe path (`setText`).
 *
 * Design constraints (match safe-storage.js):
 *   - Zero dependencies. Classic script, IIFE, attaches to window.
 *   - Never throws out of a render path. A sanitizer failure must degrade to
 *     escaped text, never to raw markup and never to an exception that drops
 *     the surrounding UI update.
 *   - Works (defensively) when no DOM is present: in a non-browser context
 *     `sanitizeUserHTML` falls back to fully escaping its input, so the value
 *     can never carry active markup. The real allowlist parsing runs in the
 *     browser, where it is exercised by tests/e2e/dom-safety.spec.mjs.
 */
(function () {
  'use strict';

  var hasDom = typeof document !== 'undefined' && !!document.createElement;
  var hasDomParser = typeof DOMParser !== 'undefined';

  // ---- Plain-text escaping --------------------------------------------------

  var ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, function (ch) {
      return ESCAPE_MAP[ch];
    });
  }

  // ---- Allowlists for sanitizeUserHTML -------------------------------------
  // Conservative by design. Anything not on the tag allowlist is unwrapped
  // (children kept, element dropped) so text survives but structure/behavior
  // cannot smuggle script. Attributes default-deny: only the named globals and
  // per-tag entries survive, and URL-bearing attributes are re-validated.

  var ALLOWED_TAGS = {
    A: 1, ABBR: 1, ADDRESS: 1, AUDIO: 1, B: 1, BLOCKQUOTE: 1, BR: 1, CAPTION: 1,
    CITE: 1, CODE: 1, COL: 1, COLGROUP: 1, DD: 1, DEL: 1, DETAILS: 1, DFN: 1,
    DIV: 1, DL: 1, DT: 1, EM: 1, FIGCAPTION: 1, FIGURE: 1, H1: 1, H2: 1, H3: 1,
    H4: 1, H5: 1, H6: 1, HR: 1, I: 1, IMG: 1, INS: 1, KBD: 1, LI: 1, MARK: 1,
    OL: 1, P: 1, PICTURE: 1, PRE: 1, Q: 1, S: 1, SAMP: 1, SECTION: 1, SMALL: 1,
    SOURCE: 1, SPAN: 1, STRONG: 1, SUB: 1, SUMMARY: 1, SUP: 1, TABLE: 1,
    TBODY: 1, TD: 1, TFOOT: 1, TH: 1, THEAD: 1, TIME: 1, TR: 1, U: 1, UL: 1,
    VAR: 1, VIDEO: 1, WBR: 1
  };

  // Tags whose entire subtree is dangerous and must be removed wholesale
  // (not merely unwrapped) — their text content is not meaningful and may
  // carry executable payloads.
  var DROP_SUBTREE_TAGS = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, BASE: 1, META: 1,
    LINK: 1, NOSCRIPT: 1, TEMPLATE: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1,
    SELECT: 1, OPTION: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, SVG: 1, MATH: 1
  };

  var GLOBAL_ATTRS = {
    'class': 1, 'id': 1, 'title': 1, 'dir': 1, 'lang': 1,
    'alt': 1, 'width': 1, 'height': 1, 'align': 1, 'valign': 1
  };

  // Per-tag attribute allowlist (in addition to GLOBAL_ATTRS + aria-*/data-*).
  var TAG_ATTRS = {
    A: { href: 1, target: 1, rel: 1 },
    IMG: { src: 1, srcset: 1, loading: 1, decoding: 1 },
    SOURCE: { src: 1, srcset: 1, type: 1, media: 1, sizes: 1 },
    VIDEO: { src: 1, poster: 1, controls: 1, muted: 1, loop: 1, preload: 1, playsinline: 1 },
    AUDIO: { src: 1, controls: 1, muted: 1, loop: 1, preload: 1 },
    TD: { colspan: 1, rowspan: 1, headers: 1 },
    TH: { colspan: 1, rowspan: 1, headers: 1, scope: 1 },
    COL: { span: 1 },
    COLGROUP: { span: 1 },
    OL: { start: 1, reversed: 1, type: 1 },
    TIME: { datetime: 1 },
    DETAILS: { open: 1 },
    BLOCKQUOTE: { cite: 1 },
    Q: { cite: 1 }
  };

  // Attributes that carry a URL and must be re-validated against a scheme
  // allowlist regardless of which tag they appear on.
  var URL_ATTRS = { href: 1, src: 1, poster: 1, cite: 1, 'xlink:href': 1 };

  var SAFE_NAVIGATION_SCHEME = /^(?:https?:|mailto:|tel:|sms:)/i;
  var SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);(?:base64,|charset=[^,]+,)/i;
  // Script-bearing or origin-smuggling schemes. data:/blob:/file: are blocked
  // for generic URL attributes; image data URLs are allowed separately.
  var DANGEROUS_SCHEME = /^(?:javascript|vbscript|data|blob|file):/i;

  // Chars a URL parser ignores when resolving a scheme. DOMParser already
  // decoded HTML entities in attribute values, so the only residual obfuscation
  // is embedded control chars / unicode whitespace, e.g. "java\tscript:".
  var URL_NOISE = /[\u0000-\u0020\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g;

  function normalizeUrlForCheck(raw) {
    return String(raw || '').replace(URL_NOISE, '');
  }

  function isSafeUrl(raw, opts) {
    var url = normalizeUrlForCheck(raw);
    if (!url) return false;
    if (opts && opts.allowImageData && SAFE_IMAGE_DATA_URL.test(url)) return true;
    if (DANGEROUS_SCHEME.test(url)) return false;
    if (SAFE_NAVIGATION_SCHEME.test(url)) return !(opts && opts.allowNetwork === false);
    // Fragment / query / relative path with no scheme.
    if (url.indexOf(':') === -1 && url.indexOf('//') !== 0) return !(opts && opts.allowRelative === false);
    return false;
  }

  var SAFE_STYLE_PROPERTIES = {
    color: 1, 'background-color': 1,
    'font-family': 1, 'font-size': 1, 'font-style': 1, 'font-weight': 1,
    'letter-spacing': 1, 'line-height': 1,
    'text-align': 1, 'text-decoration': 1, 'text-indent': 1, 'text-transform': 1,
    'white-space': 1, 'word-break': 1, 'overflow-wrap': 1,
    'border-color': 1, 'border-style': 1, 'border-width': 1, 'border-radius': 1,
    margin: 1, 'margin-top': 1, 'margin-right': 1, 'margin-bottom': 1, 'margin-left': 1,
    padding: 1, 'padding-top': 1, 'padding-right': 1, 'padding-bottom': 1, 'padding-left': 1,
    width: 1, height: 1, 'max-width': 1, 'max-height': 1
  };

  function isUnsafeStyleValue(value) {
    var css = String(value || '');
    return !css || css.length > 240 || /url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|@import|javascript:|vbscript:|data:|var\s*\(|\\[0-9a-f]{1,6}\s?/i.test(css);
  }

  function hasExtremeCssNumber(property, value) {
    var matches = String(value || '').match(/-?\d+(?:\.\d+)?/g) || [];
    var colorProperty = property === 'color' || property === 'background-color' || property === 'border-color';
    var allowsNegative = property.indexOf('margin') === 0 || property === 'text-indent' || property === 'letter-spacing';
    var maximum = colorProperty ? 360 : 4096;
    if (property === 'font-weight') maximum = 1000;
    if (property === 'line-height') maximum = 20;
    for (var i = 0; i < matches.length; i += 1) {
      var number = Number(matches[i]);
      if (!Number.isFinite(number) || (!allowsNegative && number < 0) || Math.abs(number) > maximum) return true;
    }
    return false;
  }

  function sanitizeInlineStyle(value) {
    if (!hasDom || isUnsafeStyleValue(value)) return '';
    var probe = document.createElement('span');
    probe.style.cssText = String(value || '');
    var safe = [];
    for (var i = 0; i < probe.style.length; i += 1) {
      var property = String(probe.style[i] || '').toLowerCase();
      var propertyValue = String(probe.style.getPropertyValue(property) || '').trim();
      if (!SAFE_STYLE_PROPERTIES[property] || property.indexOf('--') === 0) continue;
      if (isUnsafeStyleValue(propertyValue) || hasExtremeCssNumber(property, propertyValue)) continue;
      safe.push(property + ': ' + propertyValue);
    }
    return safe.join('; ');
  }

  // ---- Core allowlist sanitizer --------------------------------------------

  function sanitizeUserHTML(rawHtml, options) {
    options = options || {};
    if (rawHtml === null || rawHtml === undefined) return '';
    var source = String(rawHtml);
    if (!source) return '';

    // No DOM (e.g. Node-side usage): cannot safely parse, so escape everything.
    if (!hasDom || !hasDomParser) return escapeHtml(source);

    var parsed;
    try {
      parsed = new DOMParser().parseFromString(source, 'text/html');
    } catch (e) {
      return escapeHtml(source);
    }
    if (!parsed || !parsed.body) return escapeHtml(source);

    var container = document.createElement('div');
    var child = parsed.body.firstChild;
    while (child) {
      var next = child.nextSibling;
      container.appendChild(child); // adopt into our scratch container
      child = next;
    }

    try {
      sanitizeNode(container, options);
      namespaceUserIdentifiers(container, options);
    } catch (e) {
      // Any unexpected failure: fall back to fully-escaped text, never raw.
      return escapeHtml(source);
    }

    return container.innerHTML;
  }

  // Recursively sanitize a node's element children in place.
  function sanitizeNode(parent, options) {
    var nodes = [];
    var n = parent.firstChild;
    while (n) {
      nodes.push(n);
      n = n.nextSibling;
    }

    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.nodeType === 8 /* comment */) {
        parent.removeChild(node);
        continue;
      }
      if (node.nodeType !== 1 /* element */) continue; // text nodes kept verbatim

      var tag = node.tagName ? node.tagName.toUpperCase() : '';

      if (DROP_SUBTREE_TAGS[tag] && !(tag === 'IFRAME' && options.allowTrustedIframes)) {
        parent.removeChild(node);
        continue;
      }

      if (tag === 'IFRAME' && options.allowTrustedIframes) {
        if (!sanitizeIframe(node, options)) {
          parent.removeChild(node);
        }
        continue;
      }

      if (!ALLOWED_TAGS[tag]) {
        // Unknown / disallowed but harmless tag: unwrap — keep sanitized
        // children, drop the wrapper. This preserves text without trusting
        // the element.
        sanitizeNode(node, options);
        unwrap(node, parent);
        continue;
      }

      sanitizeAttributes(node, tag, options);
      sanitizeNode(node, options); // recurse into kept element
    }
  }

  function sanitizeAttributes(node, tag, options) {
    var attrs = node.attributes;
    if (!attrs) return;
    var tagAttrs = TAG_ATTRS[tag] || {};
    // Iterate over a static copy — we mutate during the loop.
    var list = [];
    for (var i = 0; i < attrs.length; i += 1) list.push(attrs[i]);

    for (var j = 0; j < list.length; j += 1) {
      var attr = list[j];
      var name = String(attr.name || '').toLowerCase();
      var value = String(attr.value || '');
      if (!name) {
        node.removeAttribute(attr.name);
        continue;
      }

      // Event handlers (on*) are always out.
      if (name.indexOf('on') === 0) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'srcdoc') {
        node.removeAttribute(attr.name);
        continue;
      }

      var allowed =
        GLOBAL_ATTRS[name] === 1 ||
        tagAttrs[name] === 1 ||
        name === 'style' ||
        name.indexOf('aria-') === 0 ||
        (options.allowDataAttributes === true && name.indexOf('data-') === 0);

      if (!allowed) {
        node.removeAttribute(attr.name);
        continue;
      }

      if (URL_ATTRS[name]) {
        var allowImageData = tag === 'IMG' || tag === 'SOURCE' || name === 'poster';
        var isNavigation = name === 'href' && tag === 'A';
        if (!isSafeUrl(value, {
          allowImageData: allowImageData,
          allowNetwork: isNavigation || options.allowNetworkResources === true,
          allowRelative: isNavigation || options.allowNetworkResources === true
        })) {
          node.removeAttribute(attr.name);
          continue;
        }
      }

      if (name === 'srcset' && !isSafeSrcset(value, options)) {
        node.removeAttribute(attr.name);
        continue;
      }

      if (name === 'target') {
        var normalizedTarget = value.toLowerCase();
        if (tag !== 'A' || (normalizedTarget !== '_blank' && normalizedTarget !== '_self')) node.removeAttribute(attr.name);
      }

      if ((name === 'width' || name === 'height') && (!/^\d{1,4}$/.test(value) || Number(value) > 4096)) {
        node.removeAttribute(attr.name);
      }

      if (name === 'style') {
        var safeStyle = sanitizeInlineStyle(value);
        if (safeStyle) node.setAttribute('style', safeStyle);
        else node.removeAttribute('style');
      }
    }

    // Harden anchors that open new tabs.
    if (tag === 'A') {
      var target = String(node.getAttribute('target') || '').toLowerCase();
      if (target === '_blank') node.setAttribute('rel', 'noopener noreferrer');
    }
  }

  function isSafeSrcset(value, options) {
    // srcset is a comma-separated list of "url descriptor" pairs.
    var parts = String(value || '').split(',');
    for (var i = 0; i < parts.length; i += 1) {
      var url = parts[i].trim().split(/\s+/)[0];
      if (url && !isSafeUrl(url, { allowImageData: true, allowNetwork: !!(options && options.allowNetworkResources), allowRelative: !!(options && options.allowNetworkResources) })) return false;
    }
    return true;
  }

  function sanitizeIframe(node, options) {
    var src = normalizeUrlForCheck(node.getAttribute('src') || '');
    var ok = typeof options.isTrustedIframeSrc === 'function'
      ? !!options.isTrustedIframeSrc(src)
      : false;
    if (!ok) return false;
    // Strip everything except a minimal, safe attribute set.
    var keep = { src: 1, width: 1, height: 1, title: 1, loading: 1 };
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i += 1) attrs.push(node.attributes[i]);
    for (var j = 0; j < attrs.length; j += 1) {
      var name = String(attrs[j].name || '').toLowerCase();
      if (!keep[name]) node.removeAttribute(attrs[j].name);
    }
    node.setAttribute('src', src);
    node.removeAttribute('srcdoc');
    node.setAttribute('loading', 'lazy');
    node.setAttribute('sandbox', '');
    node.setAttribute('referrerpolicy', 'no-referrer');
    return true;
  }

  var identifierSequence = 0;
  function namespaceUserIdentifiers(container, options) {
    identifierSequence += 1;
    var prefix = String(options.idPrefix || ('sutra-user-' + identifierSequence + '-'))
      .replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    var idMap = Object.create(null);
    var nodes = container.querySelectorAll('[id], [class]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var oldId = String(node.getAttribute('id') || '');
      if (oldId) {
        var safeId = prefix + oldId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
        idMap[oldId] = safeId;
        node.setAttribute('id', safeId);
      }
      var classes = String(node.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (classes.length) {
        node.setAttribute('class', classes.slice(0, 40).map(function (name) {
          return prefix + 'class-' + name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
        }).join(' '));
      }
    }
    var anchors = container.querySelectorAll('a[href^="#"]');
    for (var j = 0; j < anchors.length; j += 1) {
      var href = String(anchors[j].getAttribute('href') || '');
      var target = href.slice(1);
      if (idMap[target]) anchors[j].setAttribute('href', '#' + idMap[target]);
      else anchors[j].removeAttribute('href');
    }
  }

  function unwrap(node, parent) {
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }

  // ---- DOM write helpers ----------------------------------------------------

  function setText(el, value) {
    if (!el) return el;
    el.textContent = value === null || value === undefined ? '' : String(value);
    return el;
  }

  // Developer-authored, static template markup ONLY. This is the audited,
  // greppable replacement for ad-hoc `el.innerHTML = <static template>`. Do
  // NOT pass user/imported content here — use setUserHTML / sanitizeUserHTML.
  function setTrustedHTML(el, html) {
    if (!el) return el;
    el.innerHTML = html === null || html === undefined ? '' : String(html); // sutra-allow-html: this IS the audited trusted-HTML channel
    return el;
  }

  function setUserHTML(el, html, options) {
    if (!el) return el;
    el.innerHTML = sanitizeUserHTML(html, options); // sutra-allow-html: value is allowlist-sanitized first
    return el;
  }

  // ---- Sandboxed iframe rendering for fully-untrusted markup ----------------
  // For canvas / htmlEmbed-style blocks where the user may legitimately author
  // scripts/styles: render inside an isolated, sandboxed iframe instead of the
  // host document. The frame gets a locked-down CSP and a restrictive sandbox
  // by default.

  var FRAME_CAPABILITIES = Object.freeze({
    passive: {
      sandbox: '',
      warning: '',
      csp: "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; navigate-to 'none'"
    },
    'active-local': {
      sandbox: 'allow-scripts',
      warning: 'Active embedded content is running in an isolated, offline sandbox.',
      csp: "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; navigate-to 'none'"
    },
    'network-embeds': {
      sandbox: 'allow-scripts allow-popups',
      warning: 'Remote images, links, and approved embeds can contact external services. No app data is shared with them.',
      csp: "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; media-src https:; connect-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com https://w.soundcloud.com https://docs.google.com https://codepen.io https://www.figma.com https://embed.figma.com https://codesandbox.io; child-src 'none'; form-action 'none'; navigate-to https:"
    },
    'network-media': {
      sandbox: '',
      warning: 'This embedded content may load remote images or media. Your IP address may be shared with those hosts.',
      csp: "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src 'none'; media-src https:; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; navigate-to 'none'"
    },
    interactive: {
      sandbox: 'allow-scripts allow-forms',
      warning: 'Interactive embedded content can run scripts, make HTTPS requests, and submit forms inside an isolated sandbox.',
      csp: "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline'; img-src data: https:; font-src https: data:; media-src https:; connect-src https:; frame-src 'none'; child-src 'none'; form-action https:; navigate-to 'none'"
    }
  });

  function getFrameCapability(options) {
    var requested = String(options && options.mode || 'passive');
    if (!FRAME_CAPABILITIES[requested]) requested = 'passive';
    if (requested !== 'passive' && (!options || options.capabilityAcknowledged !== true)) return FRAME_CAPABILITIES.passive;
    return FRAME_CAPABILITIES[requested];
  }

  function buildFrameDocument(markup, options) {
    options = options || {};
    var capability = getFrameCapability(options);
    var csp = '<meta http-equiv="Content-Security-Policy" content="' + capability.csp + '">';
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      csp +
      '<style>html,body{margin:0;padding:0}*{box-sizing:border-box;max-width:100%}</style>' +
      '</head><body>' + String(markup || '') + '</body></html>';
  }

  function renderUserHTMLToFrame(container, markup, options) {
    if (!container || !hasDom) return null;
    options = options || {};
    var frame = document.createElement('iframe');
    frame.setAttribute('title', options.title || 'Embedded content');
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.display = 'block';
    if (options.height) frame.style.height = options.height;
    var capability = getFrameCapability(options);
    // The sandbox attribute is always present. No mode grants same-origin,
    // popups, top navigation, downloads, presentation, or pointer lock.
    frame.setAttribute('sandbox', capability.sandbox);
    frame.setAttribute('referrerpolicy', options.referrerPolicy || 'no-referrer');
    frame.srcdoc = buildFrameDocument(markup, options);
    container.innerHTML = ''; // sutra-allow-html: clearing host before appending the sandboxed frame
    if (capability.warning) {
      var warning = document.createElement('div');
      warning.className = 'sutra-embed-capability-warning';
      warning.setAttribute('role', 'note');
      warning.textContent = capability.warning;
      container.appendChild(warning);
    }
    container.appendChild(frame);
    return frame;
  }

  window.SutraDOMSafety = {
    escapeHtml: escapeHtml,
    setText: setText,
    setTrustedHTML: setTrustedHTML,
    setUserHTML: setUserHTML,
    sanitizeUserHTML: sanitizeUserHTML,
    isSafeUrl: isSafeUrl,
    renderUserHTMLToFrame: renderUserHTMLToFrame,
    // Exposed for the embed/editor paths that want the frame document shell.
    buildFrameDocument: buildFrameDocument,
    frameCapabilities: FRAME_CAPABILITIES,
    _internal: { hasDom: hasDom, hasDomParser: hasDomParser }
  };

  // Back-compat / convenience alias. `escapeHtml` is referenced widely; expose
  // a global only if nothing else has claimed it, to avoid clobbering the
  // in-app definitions during the incremental extraction.
  if (typeof window.sutraEscapeHtml !== 'function') {
    window.sutraEscapeHtml = escapeHtml;
  }
})();
