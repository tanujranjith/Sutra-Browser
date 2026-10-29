/* Sutra direct note PDF export — local, selectable, and print-fallback safe. */
(function (global) {
  'use strict';

  if (!global || !global.document) return;

  var PDF_LIB_URL = 'assets/vendor/pdf-lib/pdf-lib.min.js?v=1.17.1';
  var FONTKIT_URL = 'assets/vendor/pdf-fontkit/fontkit.umd.min.js?v=1.1.1';
  var FONT_URLS = {
    regular: 'assets/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
    bold: 'assets/vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
    italic: 'assets/vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
    boldItalic: 'assets/vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf'
  };
  var runtimePromise = null;
  var PAGE_WIDTH = 612;
  var PAGE_HEIGHT = 792;
  var MARGINS = { top: 48, right: 48, bottom: 48, left: 48 };
  var DEFAULT_COLOR = { r: 0.08, g: 0.10, b: 0.15 };
  var BORDER_COLOR = { r: 0.78, g: 0.80, b: 0.84 };

  function loadLocalScript(source) {
    return new Promise(function (resolve, reject) {
      var existing = global.document.querySelector('script[data-sutra-direct-pdf-runtime="' + source + '"]');
      if (existing && existing.dataset.loaded === 'true') { resolve(); return; }
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', function () { reject(new Error('The local PDF export dependency could not be loaded.')); }, { once: true });
        return;
      }
      var script = global.document.createElement('script');
      script.src = source;
      script.async = true;
      script.dataset.sutraDirectPdfRuntime = source;
      script.addEventListener('load', function () { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', function () { reject(new Error('The local PDF export dependency could not be loaded.')); }, { once: true });
      global.document.head.appendChild(script);
    });
  }

  async function loadRuntime() {
    if (global.PDFLib && global.PDFLib.PDFDocument) return global.PDFLib;
    if (!runtimePromise) {
      runtimePromise = loadLocalScript(PDF_LIB_URL)
        // fontkit improves Unicode coverage but is not required for a valid
        // basic-Latin PDF; loadFonts() has a built-in-font fallback.
        .then(function () { return loadLocalScript(FONTKIT_URL).catch(function () {}); })
        .then(function () {
          if (!global.PDFLib || !global.PDFLib.PDFDocument) throw new Error('The local PDF writer is unavailable.');
          return global.PDFLib;
        });
    }
    return runtimePromise;
  }

  function warnOnce(state, text) {
    if (!state || !text || state.warnings.indexOf(text) !== -1) return;
    state.warnings.push(text);
  }

  function toRgb(PDFLib, value, fallback) {
    var source = String(value || '').trim();
    var match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(source);
    if (match) {
      var hex = match[1].length === 3 ? match[1].split('').map(function (part) { return part + part; }).join('') : match[1];
      return PDFLib.rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    }
    var rgb = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i.exec(source);
    if (rgb) return PDFLib.rgb(Math.min(255, Number(rgb[1])) / 255, Math.min(255, Number(rgb[2])) / 255, Math.min(255, Number(rgb[3])) / 255);
    var base = fallback || DEFAULT_COLOR;
    return PDFLib.rgb(base.r, base.g, base.b);
  }

  function cloneStyle(style) {
    return {
      fontKey: style.fontKey,
      size: style.size,
      color: style.color,
      underline: style.underline === true
    };
  }

  function elementStyle(PDFLib, element, parent) {
    var style = cloneStyle(parent);
    var tag = String(element.tagName || '').toLowerCase();
    var sizes = { h1: 24, h2: 18, h3: 15, h4: 13, h5: 12, h6: 11 };
    if (sizes[tag]) { style.size = sizes[tag]; style.fontKey = 'bold'; }
    if (tag === 'strong' || tag === 'b') style.fontKey = style.fontKey === 'italic' ? 'boldItalic' : 'bold';
    if (tag === 'em' || tag === 'i') style.fontKey = style.fontKey === 'bold' ? 'boldItalic' : 'italic';
    if (tag === 'u') style.underline = true;
    if (tag === 'code' || tag === 'pre') style.fontKey = 'mono';
    if (tag === 'a') { style.color = PDFLib.rgb(0.06, 0.25, 0.62); style.underline = true; }
    if (element.getAttribute) {
      var inline = String(element.getAttribute('style') || '');
      var color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(inline);
      if (color) style.color = toRgb(PDFLib, color[1], DEFAULT_COLOR);
      var fontSize = /(?:^|;)\s*font-size\s*:\s*([0-9.]+)\s*(px|pt)?/i.exec(inline);
      if (fontSize) {
        var parsedSize = Number(fontSize[1]) * (String(fontSize[2] || 'px').toLowerCase() === 'px' ? 0.75 : 1);
        if (Number.isFinite(parsedSize)) style.size = Math.max(7, Math.min(42, parsedSize));
      }
    }
    return style;
  }

  function decodeDataUrl(dataUrl) {
    var match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
    if (!match) return null;
    var binary = global.atob(match[2].replace(/\s+/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { mime: match[1].toLowerCase(), bytes: bytes };
  }

  async function embedImage(PDFLib, pdf, dataUrl, state, label) {
    var decoded = decodeDataUrl(dataUrl);
    if (!decoded) { warnOnce(state, 'An image could not be embedded because it was not a self-contained data URL.'); return null; }
    if (decoded.mime !== 'image/png' && decoded.mime !== 'image/jpeg' && decoded.mime !== 'image/jpg') {
      warnOnce(state, 'Some images use a format the direct PDF exporter cannot embed; the print fallback supports them.');
      return null;
    }
    var key = String(dataUrl);
    if (state.imageCache.has(key)) return state.imageCache.get(key);
    try {
      var image = decoded.mime === 'image/png' ? await pdf.embedPng(decoded.bytes) : await pdf.embedJpg(decoded.bytes);
      state.imageCache.set(key, image);
      return image;
    } catch (error) {
      warnOnce(state, 'Could not embed image' + (label ? ' "' + String(label).slice(0, 64) + '"' : '') + '; the print fallback supports it.');
      return null;
    }
  }

  async function loadFonts(PDFLib, pdf, state) {
    var fonts = {};
    try {
      if (!global.fontkit || typeof pdf.registerFontkit !== 'function') throw new Error('fontkit unavailable');
      pdf.registerFontkit(global.fontkit);
      var entries = Object.keys(FONT_URLS);
      for (var index = 0; index < entries.length; index += 1) {
        var key = entries[index];
        var response = await global.fetch(new URL(FONT_URLS[key], global.document.baseURI).href, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('font request failed');
        fonts[key] = await pdf.embedFont(new Uint8Array(await response.arrayBuffer()), { subset: true });
      }
    } catch (error) {
      warnOnce(state, 'The local document font was unavailable; direct PDF export used built-in PDF fonts for basic text.');
      fonts.regular = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
      fonts.bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
      fonts.italic = await pdf.embedFont(PDFLib.StandardFonts.HelveticaOblique);
      fonts.boldItalic = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique);
    }
    fonts.mono = await pdf.embedFont(PDFLib.StandardFonts.Courier);
    return fonts;
  }

  function cleanRoot(html) {
    var parsed = new global.DOMParser().parseFromString(String(html || ''), 'text/html');
    var root = parsed.body || parsed.documentElement;
    root.querySelectorAll('script,style,button,input,textarea,select,.media-action-btn,.resize-handle,.size-indicator,.page-break-label').forEach(function (node) { node.remove(); });
    return root;
  }

  function collectRuns(node, PDFLib, parentStyle, output) {
    Array.prototype.forEach.call(node.childNodes || [], function (child) {
      if (child.nodeType === 3) {
        var value = String(child.nodeValue || '').replace(/[\t\r ]+/g, ' ');
        if (value) output.push({ text: value, style: cloneStyle(parentStyle) });
        return;
      }
      if (child.nodeType !== 1) return;
      var tag = String(child.tagName || '').toLowerCase();
      if (tag === 'br') { output.push({ text: '\n', style: cloneStyle(parentStyle) }); return; }
      if (tag === 'ul' || tag === 'ol' || tag === 'img' || tag === 'svg' || tag === 'canvas' || tag === 'video') return;
      collectRuns(child, PDFLib, elementStyle(PDFLib, child, parentStyle), output);
    });
  }

  function textTokens(text) {
    return String(text || '').split(/(\n|\s+)/).filter(function (token) { return token !== ''; });
  }

  function safeText(value) {
    return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }

  function drawText(state, text, options) {
    var value = safeText(text);
    if (!value) return;
    try {
      state.page.drawText(value, options);
    } catch (error) {
      var fallback = value.replace(/[^\x20-\x7e\n\t\u00a0-\u00ff]/g, '?');
      state.page.drawText(fallback, options);
      warnOnce(state, 'Some characters could not be represented by the selected PDF font.');
    }
    state.hasContent = true;
  }

  function fontFor(state, key) { return state.fonts[key] || state.fonts.regular; }

  function newPage(state) {
    state.page = state.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    state.y = PAGE_HEIGHT - MARGINS.top;
    state.hasContent = false;
    if (state.backgroundImage) {
      var image = state.backgroundImage;
      var scale = Math.max(PAGE_WIDTH / image.width, PAGE_HEIGHT / image.height);
      var width = image.width * scale;
      var height = image.height * scale;
      state.page.drawImage(image, {
        x: (PAGE_WIDTH - width) / 2,
        y: (PAGE_HEIGHT - height) / 2,
        width: width,
        height: height,
        opacity: Math.max(0.2, 1 - state.backgroundOpacity)
      });
      if (state.backgroundOpacity > 0) {
        state.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: state.PDFLib.rgb(1, 1, 1), opacity: state.backgroundOpacity });
      }
    }
  }

  function ensureSpace(state, height) {
    if (state.y - height < MARGINS.bottom && state.hasContent) newPage(state);
  }

  function drawRuns(state, runs, options) {
    var indent = Number(options.indent || 0);
    var prefix = String(options.prefix || '');
    var baseStyle = options.style;
    var available = PAGE_WIDTH - MARGINS.left - MARGINS.right - indent;
    var lines = [];
    var current = [];
    var currentWidth = 0;
    var firstLine = true;
    var prefixFont = fontFor(state, baseStyle.fontKey);
    var prefixWidth = prefix ? prefixFont.widthOfTextAtSize(prefix, baseStyle.size) + 4 : 0;

    function lineLimit() { return available - (firstLine ? prefixWidth : 0); }
    function flush() {
      if (!current.length && lines.length) return;
      lines.push({ runs: current, first: firstLine });
      current = [];
      currentWidth = 0;
      firstLine = false;
    }

    runs.forEach(function (run) {
      var style = run.style || baseStyle;
      var font = fontFor(state, style.fontKey);
      textTokens(run.text).forEach(function (token) {
        if (token === '\n') { flush(); firstLine = true; return; }
        var whitespace = /^\s+$/.test(token);
        if (whitespace) {
          if (!current.length) return;
          token = ' ';
        }
        var tokenWidth = font.widthOfTextAtSize(token, style.size);
        if (!whitespace && tokenWidth > lineLimit() && current.length) flush();
        if (!whitespace && tokenWidth > lineLimit()) {
          for (var index = 0; index < token.length; index += 1) {
            var character = token[index];
            var characterWidth = font.widthOfTextAtSize(character, style.size);
            if (current.length && currentWidth + characterWidth > lineLimit()) flush();
            current.push({ text: character, style: style });
            currentWidth += characterWidth;
          }
          return;
        }
        if (current.length && currentWidth + tokenWidth > lineLimit()) flush();
        current.push({ text: token, style: style });
        currentWidth += tokenWidth;
      });
    });
    if (current.length || !lines.length) flush();

    var lineHeight = Math.max(11, Number(options.lineHeight || baseStyle.size * 1.45));
    lines.forEach(function (line) {
      ensureSpace(state, lineHeight);
      var x = MARGINS.left + indent;
      if (line.first && prefix) {
        drawText(state, prefix, { x: x, y: state.y - baseStyle.size, size: baseStyle.size, font: prefixFont, color: baseStyle.color });
        x += prefixWidth;
      } else if (prefix) {
        x += prefixWidth;
      }
      line.runs.forEach(function (run) {
        var style = run.style;
        var font = fontFor(state, style.fontKey);
        drawText(state, run.text, { x: x, y: state.y - style.size, size: style.size, font: font, color: style.color });
        if (style.underline) {
          var width = font.widthOfTextAtSize(run.text, style.size);
          state.page.drawLine({ start: { x: x, y: state.y - style.size - 1 }, end: { x: x + width, y: state.y - style.size - 1 }, thickness: 0.5, color: style.color });
        }
        x += font.widthOfTextAtSize(run.text, style.size);
      });
      state.y -= lineHeight;
    });
  }

  function paragraphStyle(PDFLib, tag, state) {
    var style = { fontKey: 'regular', size: 11, color: PDFLib.rgb(DEFAULT_COLOR.r, DEFAULT_COLOR.g, DEFAULT_COLOR.b), underline: false };
    if (/^h[1-6]$/.test(tag)) style = elementStyle(PDFLib, { tagName: tag, getAttribute: function () { return ''; } }, style);
    if (tag === 'blockquote') style.fontKey = 'italic';
    return style;
  }

  async function renderImageElement(element, state) {
    var src = element && element.getAttribute ? element.getAttribute('src') : '';
    var image = await embedImage(state.PDFLib, state.pdf, src, state, element && element.getAttribute('alt'));
    if (!image) return;
    var maxWidth = PAGE_WIDTH - MARGINS.left - MARGINS.right;
    var maxHeight = PAGE_HEIGHT - MARGINS.top - MARGINS.bottom - 20;
    var scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    var width = image.width * scale;
    var height = image.height * scale;
    ensureSpace(state, height + 14);
    state.page.drawImage(image, { x: MARGINS.left, y: state.y - height, width: width, height: height });
    state.hasContent = true;
    state.y -= height + 14;
  }

  async function renderParagraph(element, state, options) {
    var tag = String(element.tagName || '').toLowerCase();
    var style = paragraphStyle(state.PDFLib, tag, state);
    if (options && options.italic) style.fontKey = style.fontKey === 'bold' ? 'boldItalic' : 'italic';
    var runs = [];
    collectRuns(element, state.PDFLib, style, runs);
    var text = String(element.textContent || '').trim();
    var images = Array.prototype.slice.call(element.querySelectorAll ? element.querySelectorAll('img') : []);
    if (text || runs.length) drawRuns(state, runs, { style: style, indent: options && options.indent, prefix: options && options.prefix, lineHeight: style.size * 1.45 });
    if (images.length) for (var index = 0; index < images.length; index += 1) await renderImageElement(images[index], state);
    state.y -= options && options.tight ? 4 : (tag === 'h1' ? 14 : 9);
  }

  function plainLines(text, font, size, maxWidth) {
    var result = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (sourceLine) {
      var words = sourceLine.split(/\s+/).filter(Boolean);
      if (!words.length) { result.push(''); return; }
      var line = '';
      words.forEach(function (word) {
        var candidate = line ? line + ' ' + word : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { result.push(line); line = word; }
        else line = candidate;
      });
      if (line) result.push(line);
    });
    return result;
  }

  async function renderPre(element, state) {
    var font = fontFor(state, 'mono');
    var size = 9;
    var lines = plainLines(element.textContent || '', font, size, PAGE_WIDTH - MARGINS.left - MARGINS.right - 16);
    lines.forEach(function (line) {
      ensureSpace(state, 15);
      state.page.drawRectangle({ x: MARGINS.left, y: state.y - 14, width: PAGE_WIDTH - MARGINS.left - MARGINS.right, height: 15, color: state.PDFLib.rgb(0.96, 0.97, 0.98), opacity: 0.9 });
      drawText(state, line, { x: MARGINS.left + 8, y: state.y - 11, size: size, font: font, color: state.PDFLib.rgb(0.12, 0.14, 0.18) });
      state.y -= 15;
    });
    state.y -= 8;
  }

  async function renderTable(element, state) {
    var rows = Array.prototype.slice.call(element.querySelectorAll('tr')).map(function (row) {
      return Array.prototype.slice.call(row.children).filter(function (cell) { return /^(td|th)$/i.test(cell.tagName || ''); });
    }).filter(function (row) { return row.length; });
    if (!rows.length) return;
    var columns = rows.reduce(function (max, row) { return Math.max(max, row.length); }, 1);
    var tableWidth = PAGE_WIDTH - MARGINS.left - MARGINS.right;
    var columnWidth = tableWidth / columns;
    var font = fontFor(state, 'regular');
    var bold = fontFor(state, 'bold');
    var size = 9;
    var lineHeight = 11;
    var header = rows[0];

    function measureRow(row) {
      var lineSets = [];
      var height = 18;
      for (var index = 0; index < columns; index += 1) {
        var cell = row[index];
        var cellFont = cell && /^th$/i.test(cell.tagName || '') ? bold : font;
        var lines = plainLines(cell ? cell.textContent : '', cellFont, size, Math.max(20, columnWidth - 10));
        lineSets.push({ lines: lines, font: cellFont });
        height = Math.max(height, lines.length * lineHeight + 10);
      }
      return { height: height, cells: lineSets };
    }

    function drawRow(row, measured, top) {
      for (var index = 0; index < columns; index += 1) {
        var x = MARGINS.left + index * columnWidth;
        state.page.drawRectangle({ x: x, y: top - measured.height, width: columnWidth, height: measured.height, borderColor: state.PDFLib.rgb(BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b), borderWidth: 0.5, color: state.PDFLib.rgb(1, 1, 1), opacity: 0.82 });
        measured.cells[index].lines.forEach(function (line, lineIndex) {
          drawText(state, line, { x: x + 5, y: top - 5 - size - lineIndex * lineHeight, size: size, font: measured.cells[index].font, color: state.PDFLib.rgb(DEFAULT_COLOR.r, DEFAULT_COLOR.g, DEFAULT_COLOR.b), maxWidth: columnWidth - 10 });
        });
      }
    }

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var measured = measureRow(rows[rowIndex]);
      if (state.y - measured.height < MARGINS.bottom && state.hasContent) {
        newPage(state);
        if (rowIndex > 0) {
          var measuredHeader = measureRow(header);
          drawRow(header, measuredHeader, state.y);
          state.y -= measuredHeader.height;
        }
      }
      drawRow(rows[rowIndex], measured, state.y);
      state.hasContent = true;
      state.y -= measured.height;
    }
    state.y -= 10;
  }

  async function renderList(element, state, level, ordered) {
    var items = Array.prototype.slice.call(element.children).filter(function (child) { return String(child.tagName || '').toLowerCase() === 'li'; });
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      var style = paragraphStyle(state.PDFLib, 'p', state);
      var runs = [];
      collectRuns(item, state.PDFLib, style, runs);
      drawRuns(state, runs, { style: style, indent: level * 18, prefix: ordered ? (index + 1) + '. ' : '• ', lineHeight: 16 });
      state.y -= 3;
      var nested = Array.prototype.slice.call(item.children).filter(function (child) { return /^(ul|ol)$/i.test(child.tagName || ''); });
      for (var nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        await renderList(nested[nestedIndex], state, level + 1, String(nested[nestedIndex].tagName).toLowerCase() === 'ol');
      }
    }
    state.y -= 6;
  }

  async function renderBlocks(container, state) {
    var children = Array.prototype.slice.call(container.children || []);
    for (var index = 0; index < children.length; index += 1) {
      var element = children[index];
      var tag = String(element.tagName || '').toLowerCase();
      var className = typeof element.className === 'string' ? element.className : '';
      if (/atelier-page-break/.test(className)) { newPage(state); continue; }
      if (tag === 'img') { await renderImageElement(element, state); continue; }
      if (tag === 'pre') { await renderPre(element, state); continue; }
      if (tag === 'table') { await renderTable(element, state); continue; }
      if (tag === 'ul' || tag === 'ol') { await renderList(element, state, 0, tag === 'ol'); continue; }
      if (tag === 'blockquote') {
        var before = state.y;
        await renderParagraph(element, state, { indent: 14, italic: true, tight: true });
        var lineTop = before + 1;
        var lineBottom = Math.max(state.y + 4, MARGINS.bottom);
        state.page.drawLine({ start: { x: MARGINS.left + 4, y: lineTop }, end: { x: MARGINS.left + 4, y: lineBottom }, thickness: 2, color: state.PDFLib.rgb(0.72, 0.76, 0.84) });
        continue;
      }
      if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'hr') {
        if (tag === 'hr') {
          ensureSpace(state, 16);
          state.page.drawLine({ start: { x: MARGINS.left, y: state.y - 7 }, end: { x: PAGE_WIDTH - MARGINS.right, y: state.y - 7 }, thickness: 0.7, color: state.PDFLib.rgb(BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b) });
          state.y -= 16;
        } else await renderParagraph(element, state, null);
        continue;
      }
      var blockChildren = Array.prototype.slice.call(element.children || []).filter(function (child) { return /^(p|div|section|article|header|footer|h[1-6]|ul|ol|pre|table|blockquote|hr)$/i.test(child.tagName || ''); });
      if (blockChildren.length) await renderBlocks(element, state);
      else if (String(element.textContent || '').trim()) await renderParagraph(element, state, null);
    }
  }

  async function buildNotePdf(note) {
    var PDFLib = await loadRuntime();
    var warnings = [];
    var pdf = await PDFLib.PDFDocument.create();
    var state = {
      pdf: pdf,
      PDFLib: PDFLib,
      warnings: warnings,
      imageCache: new Map(),
      fonts: null,
      page: null,
      y: 0,
      hasContent: false,
      backgroundImage: null,
      backgroundOpacity: 0
    };
    state.fonts = await loadFonts(PDFLib, pdf, state);

    var background = note && note.documentBackground;
    if (background && background.enabled && background.dataUrl) {
      state.backgroundImage = await embedImage(PDFLib, pdf, background.dataUrl, state, background.name || 'document background');
      state.backgroundOpacity = Math.max(0, Math.min(0.8, Number(background.overlayOpacity) || 0));
      if (Number(background.blurPx) > 0) warnOnce(state, 'Document background blur is omitted from direct PDF output; use print fallback for exact visual fidelity.');
    }
    newPage(state);

    var title = String(note && note.title || 'Untitled Note');
    var titleStyle = { fontKey: 'bold', size: 24, color: PDFLib.rgb(DEFAULT_COLOR.r, DEFAULT_COLOR.g, DEFAULT_COLOR.b), underline: false };
    drawRuns(state, [{ text: title, style: titleStyle }], { style: titleStyle, lineHeight: 31 });
    state.y -= 12;
    state.page.drawLine({ start: { x: MARGINS.left, y: state.y }, end: { x: PAGE_WIDTH - MARGINS.right, y: state.y }, thickness: 0.7, color: PDFLib.rgb(BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b) });
    state.y -= 18;
    await renderBlocks(cleanRoot(note && note.html || ''), state);
    var bytes = new Uint8Array(await pdf.save({ useObjectStreams: true, addDefaultPage: false }));
    if (global.SutraPdfEngine && typeof global.SutraPdfEngine.validatePdfBytes === 'function') {
      var validation = global.SutraPdfEngine.validatePdfBytes(bytes);
      if (!validation.ok) throw new Error('Direct PDF output failed validation.');
    }
    return { bytes: bytes, pageCount: pdf.getPageCount(), warnings: warnings };
  }

  function readLiveDocumentBackground() {
    var layer = global.document.querySelector('.sutra-doc-bg-layer');
    if (!layer) return null;
    var backgroundImage = String(layer.style.backgroundImage || '');
    var imageMatch = /^url\(["']?(data:image\/[^"')]+)["']?\)$/i.exec(backgroundImage);
    if (!imageMatch) return null;
    var overlay = global.document.querySelector('.sutra-doc-bg-overlay');
    var overlayOpacity = overlay ? Number(overlay.style.opacity) : 0;
    var blurValue = layer.style.getPropertyValue('--sutra-docbg-blur');
    return {
      enabled: true,
      dataUrl: imageMatch[1],
      blurPx: Number.parseFloat(blurValue) || 0,
      overlayOpacity: Number.isFinite(overlayOpacity) ? overlayOpacity : 0
    };
  }

  var engine = global.SutraPdfEngine;
  if (!engine || typeof engine !== 'object') return;
  engine.buildNotePdf = buildNotePdf;

  var originalExport = global.exportCurrentNoteDocument;
  if (typeof originalExport !== 'function' || originalExport.__sutraDirectPdfWrapper) return;

  function requestedFormat(value) {
    var settings = global.document.getElementById('notesExportFormatSelect');
    var modal = global.document.getElementById('exportModalFormatSelect');
    var raw = value || (settings && settings.value) || (modal && modal.value) || 'docx';
    return typeof global.normalizeNoteExportFormat === 'function' ? global.normalizeNoteExportFormat(raw, 'docx') : String(raw).toLowerCase();
  }

  var wrappedExport = async function (format) {
    if (requestedFormat(format) !== 'pdf') return originalExport.apply(this, arguments);
    if (typeof global.getCurrentNoteForDocumentExport !== 'function' || typeof global.buildPreparedNoteExportContent !== 'function') return originalExport.apply(this, arguments);
    var rawNote = global.getCurrentNoteForDocumentExport();
    if (!rawNote) return;
    if (typeof global.showToast === 'function') global.showToast('Preparing direct PDF export...', { durationMs: 1800 });
    try {
      var prepared = await global.buildPreparedNoteExportContent(rawNote);
      var note = Object.assign({}, rawNote, {
        html: prepared.html,
        text: prepared.text,
        documentBackground: rawNote.documentBackground || readLiveDocumentBackground()
      });
      var result = await buildNotePdf(note);
      var blob = new Blob([result.bytes], { type: 'application/pdf' });
      if (typeof global.triggerBlobDownload !== 'function') throw new Error('The browser download bridge is unavailable.');
      await global.triggerBlobDownload(blob, note.baseName + '.pdf');
      var warnings = (Array.isArray(prepared.warnings) ? prepared.warnings : []).concat(result.warnings || []);
      if (typeof global.showExportToast === 'function') global.showExportToast('Current note downloaded as PDF.', warnings);
      return result;
    } catch (error) {
      console.warn('Direct PDF export unavailable; using print fallback.', error);
      if (typeof global.showToast === 'function') global.showToast('Direct PDF export unavailable — opening the print-ready fallback.');
      return originalExport.apply(this, arguments);
    }
  };
  wrappedExport.__sutraDirectPdfWrapper = true;
  global.exportCurrentNoteDocument = wrappedExport;
}(typeof window !== 'undefined' ? window : globalThis));
