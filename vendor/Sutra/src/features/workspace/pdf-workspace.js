/* Sutra Native PDF Workspace — contextual reader/editor using vendored PDF.js + pdf-lib. */
(function (global) {
  'use strict';

  var PDFJS_URL = 'assets/vendor/pdfjs/build/pdf.min.mjs';
  var PDFJS_WORKER_URL = 'assets/vendor/pdfjs/build/pdf.worker.min.mjs';
  var PDFJS_CMAP_URL = 'assets/vendor/pdfjs/cmaps/';
  var PDFJS_FONT_URL = 'assets/vendor/pdfjs/standard_fonts/';
  var state = null;
  var openGeneration = 0;
  var pendingOpenEmbedded = false;
  var pendingOpenContextId = '';
  var pdfjsPromise = null;
  var assemblyRuntimePromise = null;
  var unicodeFontBytesPromise = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function button(label, action, title) {
    var node = el('button', 'pdfw-button', label);
    node.type = 'button';
    node.dataset.action = action;
    if (title) node.title = title;
    return node;
  }
  function clone(value, fallback) { return global.SutraPdfEngine.clone(value, fallback); }
  function message(text, kind) {
    if (!state || !state.status) return;
    state.status.textContent = String(text || '');
    state.status.dataset.kind = kind || 'info';
  }
  function report(error, feature) {
    try {
      if (typeof global.SutraReportError === 'function') global.SutraReportError(error, { feature: feature || 'pdf-workspace' }, 'warning');
      else console.warn(feature || 'pdf-workspace', error);
    } catch (_) { console.warn(error); }
  }
  function enabled() {
    try {
      return !!(global.SutraPdfData && typeof global.SutraPdfData.isEnabled === 'function' && global.SutraPdfData.isEnabled());
    } catch (_) { return false; }
  }
  function isCurrentWorkspace(owner) { return !!owner && !owner.destroyed && state === owner; }
  async function loadPdfJs() {
    if (global.pdfjsLib && typeof global.pdfjsLib.getDocument === 'function') return global.pdfjsLib;
    if (!pdfjsPromise) {
      pdfjsPromise = import(new URL(PDFJS_URL, document.baseURI).href).then(function (lib) {
        if (location.protocol !== 'file:' && lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER_URL, document.baseURI).href;
        return lib;
      });
    }
    return pdfjsPromise;
  }
  function loadLocalScript(source) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-sutra-pdf-runtime="' + source + '"]');
      if (existing && existing.dataset.loaded === 'true') { resolve(); return; }
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', function () { reject(new Error('A local PDF assembly dependency could not be loaded.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = source;
      script.async = true;
      script.dataset.sutraPdfRuntime = source;
      script.addEventListener('load', function () { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', function () { reject(new Error('A local PDF assembly dependency could not be loaded.')); }, { once: true });
      document.head.appendChild(script);
    });
  }
  async function loadAssemblyRuntime() {
    if (global.PDFLib && global.fontkit) return { PDFLib: global.PDFLib, fontkit: global.fontkit };
    if (!assemblyRuntimePromise) {
      assemblyRuntimePromise = loadLocalScript('assets/vendor/pdf-lib/pdf-lib.min.js?v=1.17.1')
        .then(function () { return loadLocalScript('assets/vendor/pdf-fontkit/fontkit.umd.min.js?v=1.1.1'); })
        .then(function () {
          if (!global.PDFLib) throw new Error('The local PDF assembly runtime is unavailable.');
          return { PDFLib: global.PDFLib, fontkit: global.fontkit };
        });
    }
    return assemblyRuntimePromise;
  }
  async function loadUnicodeFontBytes() {
    if (!unicodeFontBytesPromise) {
      unicodeFontBytesPromise = fetch(new URL('assets/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', document.baseURI).href, { credentials: 'same-origin' })
        .then(function (response) { if (!response.ok) throw new Error('Local PDF annotation font is unavailable.'); return response.arrayBuffer(); })
        .then(function (buffer) { return new Uint8Array(buffer); });
    }
    return unicodeFontBytesPromise;
  }
  async function getPdfDocument(bytes, options) {
    var lib = await loadPdfJs();
    options = options || {};
    var task = lib.getDocument({
      data: bytes.slice(),
      disableWorker: location.protocol === 'file:' || options.disableWorker === true,
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      cMapUrl: new URL(PDFJS_CMAP_URL, document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL(PDFJS_FONT_URL, document.baseURI).href
    });
    task.onPassword = function (updatePassword, reason) {
      var promptText = reason === lib.PasswordResponses.INCORRECT_PASSWORD ? 'That password was incorrect. Try again:' : 'Enter the PDF password:';
      var password = global.prompt(promptText, '');
      if (password == null) task.destroy(); else updatePassword(password);
    };
    var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('PDF worker timed out.')); }, 12000); });
    try { return await Promise.race([task.promise, timeout]); }
    catch (error) {
      try { if (typeof task.destroy === 'function') await task.destroy(); } catch (_) {}
      if (!options.disableWorker && location.protocol !== 'file:') return getPdfDocument(bytes, { disableWorker: true });
      throw error;
    }
  }
  async function releasePdf(pdf) {
    if (!pdf) return;
    if (typeof pdf.destroy === 'function') await pdf.destroy();
    else if (typeof pdf.cleanup === 'function') await pdf.cleanup();
  }
  function removeStaleWorkspaceChrome() {
    document.querySelectorAll('.pdfw-root').forEach(function (node) { node.remove(); });
    document.querySelectorAll('#view-notes .toolbar-wrapper > .pdfw-topbar, #view-notes .toolbar-wrapper > .pdfw-toolbar').forEach(function (node) { node.remove(); });
    document.querySelectorAll('#view-notes .toolbar-wrapper.pdf-toolbar-active').forEach(function (wrapper) {
      wrapper.classList.remove('pdf-toolbar-active');
      var notesToolbar = wrapper.querySelector('.toolbar');
      if (notesToolbar) notesToolbar.classList.remove('pdf-notes-toolbar-hidden');
    });
    document.documentElement.classList.remove('pdf-workspace-open');
    document.body.classList.remove('pdf-page-active');
  }
  function disposeWorkspace(owner) {
    if (!owner) { removeStaleWorkspaceChrome(); return; }
    owner.destroyed = true;
    owner.renderGeneration = (owner.renderGeneration || 0) + 1;
    [owner.observer, owner.thumbnailObserver].forEach(function (observer) {
      try { if (observer) observer.disconnect(); } catch (_) {}
    });
    try { (owner.renderTasks || []).forEach(function (task) { if (task && typeof task.cancel === 'function') task.cancel(); }); } catch (_) {}
    try { (owner.sourceUrls || []).forEach(function (url) { URL.revokeObjectURL(url); }); } catch (_) {}
    var notesToolbarWrapper = owner.notesToolbarWrapper;
    if (notesToolbarWrapper) {
      (owner.pdfToolbarNodes || []).forEach(function (node) { if (node && node.parentNode) node.remove(); });
      notesToolbarWrapper.classList.remove('pdf-toolbar-active');
    }
    if (owner.notesToolbar) owner.notesToolbar.classList.remove('pdf-notes-toolbar-hidden');
    if (owner.root) owner.root.querySelectorAll('dialog[open]').forEach(function (dialog) { try { dialog.close(); } catch (_) {} });
    if (owner.root) owner.root.remove();
    if (state === owner) state = null;
    document.documentElement.classList.remove('pdf-workspace-open');
    if (owner.embedded) document.body.classList.remove('pdf-page-active');
    var documents = new Set();
    Object.keys(owner.sources || {}).forEach(function (key) {
      var pdf = owner.sources[key] && owner.sources[key].pdf;
      if (pdf) documents.add(pdf);
    });
    (owner.retiredPdfs || []).forEach(function (pdf) { if (pdf) documents.add(pdf); });
    Promise.all(Array.from(documents).map(function (pdf) { return releasePdf(pdf); }))
      .catch(function (error) { report(error, 'pdf-workspace-cleanup'); });
    removeStaleWorkspaceChrome();
  }
  function close() {
    openGeneration += 1;
    pendingOpenEmbedded = false;
    pendingOpenContextId = '';
    disposeWorkspace(state);
  }
  function getContext() {
    if (!state) return null;
    return { documentId: state.documentRecord.id, fileId: state.file.id, pageId: state.activePageId, tool: state.tool, zoom: state.zoom };
  }
  function pushUndo(label) {
    if (!state) return;
    state.undo.push({ label: label, documentRecord: clone(state.documentRecord, {}), annotations: clone(state.annotations, []) });
    state.undo = state.undo.slice(-50);
    state.redo = [];
  }
  function persistDocument(record) {
    var prior = record && record.id ? global.SutraPdfData.getDocument(record.id) : null;
    var normalized = global.SutraPdfData.upsertDocument(record);
    var nextPageIds = new Set(normalized.pages.map(function (page) { return page.id; }));
    (prior && Array.isArray(prior.pages) ? prior.pages : []).forEach(function (page) {
      if (!nextPageIds.has(page.id)) global.SutraAttachments.unlink(page.sourceFileId, 'pdf_page_source', page.id);
    });
    normalized.pages.forEach(function (page) { global.SutraAttachments.link(page.sourceFileId, 'pdf_page_source', page.id); });
    return normalized;
  }
  async function restoreHistory(entry, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner) || !entry) return;
    owner.documentRecord = persistDocument(entry.documentRecord);
    var existing = global.SutraPdfData.listAnnotations(owner.documentRecord.id);
    existing.forEach(function (annotation) { global.SutraPdfData.removeAnnotation(annotation.id); });
    entry.annotations.forEach(function (annotation) { global.SutraPdfData.upsertAnnotation(annotation); });
    owner.annotations = global.SutraPdfData.listAnnotations(owner.documentRecord.id);
    await rebuildPages(owner);
  }
  async function undo(owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner) || !owner.undo.length) return;
    owner.redo.push({ label: 'Redo', documentRecord: clone(owner.documentRecord, {}), annotations: clone(owner.annotations, []) });
    await restoreHistory(owner.undo.pop(), owner);
  }
  async function redo(owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner) || !owner.redo.length) return;
    owner.undo.push({ label: 'Undo', documentRecord: clone(owner.documentRecord, {}), annotations: clone(owner.annotations, []) });
    await restoreHistory(owner.redo.pop(), owner);
  }
  function sourceKey(pageRecord) { return String(pageRecord.sourceFileId || '') + ':' + String(pageRecord.sourcePageIndex); }
  async function ensureSource(fileId, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return null;
    if (owner.sources[fileId]) return owner.sources[fileId];
    if (owner.sourcePromises[fileId]) return owner.sourcePromises[fileId];
    var pending = (async function () {
      var bytes = await global.SutraAttachments.readBytes(fileId);
      if (!isCurrentWorkspace(owner)) return null;
      if (!bytes) throw new Error('A source PDF is missing on this device.');
      var metadata = global.SutraAttachments.get(fileId);
      var pdf = await getPdfDocument(bytes);
      if (!isCurrentWorkspace(owner)) { await releasePdf(pdf); return null; }
      var source = { bytes: bytes, file: metadata, pdf: pdf };
      owner.sources[fileId] = source;
      return source;
    }());
    owner.sourcePromises[fileId] = pending;
    try { return await pending; }
    finally { if (owner.sourcePromises[fileId] === pending) delete owner.sourcePromises[fileId]; }
  }
  function currentAnnotations(pageId, owner) { owner = owner || state; return owner ? owner.annotations.filter(function (item) { return item.pageId === pageId; }) : []; }
  function pagePlan(pageId) { return state.documentRecord.pages.find(function (page) { return page.id === String(pageId); }) || { rotation: 0 }; }
  function storedGeometry(pageId, geometry) {
    var rotation = pagePlan(pageId).rotation;
    var source = geometry && typeof geometry === 'object' ? geometry : {};
    var rects = Array.isArray(source.rects) ? source.rects.map(function (rect) { return global.SutraPdfEngine.unrotateRect(rect, rotation); }) : [];
    var base = global.SutraPdfEngine.unrotateRect(source, rotation);
    base.rects = rects;
    if (source.point) base.point = global.SutraPdfEngine.unrotatePoint(source.point, rotation);
    return base;
  }
  function annotationLayer(pageId) {
    var shell = state.pageNodes[pageId];
    return shell && shell.querySelector('.pdfw-annotations');
  }
  function applyRectStyle(node, rect) {
    node.style.left = (rect.x * 100) + '%'; node.style.top = (rect.y * 100) + '%';
    node.style.width = (rect.width * 100) + '%'; node.style.height = (rect.height * 100) + '%';
  }
  function renderAnnotations(pageId) {
    var layer = annotationLayer(pageId);
    if (!layer) return;
    layer.replaceChildren();
    currentAnnotations(pageId).forEach(function (annotation) {
      var rotation = pagePlan(pageId).rotation;
      if (annotation.type === 'ink' || annotation.type === 'signature') {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 1000 1000'); svg.dataset.annotationId = annotation.id;
        annotation.inkPaths.forEach(function (path) {
          if (!path.length) return;
          var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', path.map(function (point) { var displayed = global.SutraPdfEngine.rotatePoint(point, rotation); return (displayed.x * 1000) + ',' + (displayed.y * 1000); }).join(' '));
          polyline.setAttribute('fill', 'none'); polyline.setAttribute('stroke', annotation.style.color);
          polyline.setAttribute('stroke-width', String(annotation.style.width * 1000));
          polyline.setAttribute('stroke-linecap', 'round'); polyline.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(polyline);
        });
        layer.appendChild(svg); return;
      }
      var rects = (annotation.geometry.rects.length ? annotation.geometry.rects : [annotation.geometry]).map(function (rect) { return global.SutraPdfEngine.rotateRect(rect, rotation); });
      rects.forEach(function (rect, index) {
        var mark = el('button', 'pdfw-annotation pdfw-annotation-' + annotation.type);
        mark.type = 'button'; mark.dataset.annotationId = annotation.id; mark.setAttribute('aria-label', annotation.type + (annotation.text ? ': ' + annotation.text : ''));
        applyRectStyle(mark, rect); mark.style.setProperty('--annotation-color', annotation.style.color); mark.style.setProperty('--annotation-opacity', annotation.style.opacity);
        if (index === 0 && ['text', 'comment', 'stamp'].includes(annotation.type)) mark.textContent = annotation.type === 'stamp' ? (annotation.text || 'APPROVED') : annotation.type === 'comment' ? '●' : annotation.text;
        layer.appendChild(mark);
      });
    });
  }
  function renderInspector() {
    if (!state) return;
    var panel = state.inspectorContent;
    panel.replaceChildren();
    var inspectorTop = el('div', 'pdfw-inspector-top'); inspectorTop.appendChild(el('h3', '', 'Document')); panel.appendChild(inspectorTop);
    var outlineHeading = el('h3', '', 'Outline'); panel.appendChild(outlineHeading);
    if (!state.outline.length) panel.appendChild(el('p', 'pdfw-muted', 'No document outline.'));
    state.outline.forEach(function (item) {
      var row = button(item.title || 'Untitled section', 'outline'); row.dataset.dest = JSON.stringify(item.dest || null); panel.appendChild(row);
    });
    panel.appendChild(el('h3', '', 'Bookmarks'));
    if (!state.documentRecord.bookmarks.length) panel.appendChild(el('p', 'pdfw-muted', 'No bookmarks yet.'));
    state.documentRecord.bookmarks.forEach(function (bookmark) { var row = button(bookmark.title || 'Bookmark', 'page'); row.dataset.pageId = bookmark.pageId; panel.appendChild(row); });
    panel.appendChild(el('h3', '', 'Comments'));
    var comments = state.annotations.filter(function (annotation) { return annotation.type === 'comment'; });
    if (!comments.length) panel.appendChild(el('p', 'pdfw-muted', 'No comments yet.'));
    comments.forEach(function (annotation, index) {
      var row = button((index + 1) + '. ' + (annotation.text || 'Comment'), 'jump-annotation'); row.dataset.pageId = annotation.pageId; panel.appendChild(row);
    });
    panel.appendChild(el('h3', '', 'Reading text'));
    var textPanel = el('div', 'pdfw-reading-text'); textPanel.tabIndex = 0; textPanel.setAttribute('aria-label', 'Accessible extracted PDF text');
    var page = state.textByPage[state.activePageId];
    textPanel.textContent = page || 'Open a rendered page to extract its reading text.'; panel.appendChild(textPanel);
  }
  async function renderTextLayer(pdfPage, viewport, shell, pageRecord, owner) {
    var textLayer = shell.querySelector('.pdfw-text-layer');
    textLayer.replaceChildren();
    var content = await pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: false });
    if (!isCurrentWorkspace(owner) || !textLayer.isConnected) return;
    owner.textByPage[pageRecord.id] = content.items.map(function (item) { return item.str || ''; }).join(' ').replace(/\s+/g, ' ').trim();
    var lib = await loadPdfJs();
    if (!isCurrentWorkspace(owner) || !textLayer.isConnected) return;
    content.items.forEach(function (item) {
      if (!item.str) return;
      var tx = lib.Util.transform(viewport.transform, item.transform);
      var fontHeight = Math.hypot(tx[2], tx[3]);
      var span = el('span', '', item.str);
      span.style.left = tx[4] + 'px'; span.style.top = (tx[5] - fontHeight) + 'px'; span.style.fontSize = fontHeight + 'px';
      span.style.transform = 'scaleX(' + Math.max(0.1, ((item.width || 1) * viewport.scale) / Math.max(1, span.textContent.length * fontHeight * 0.5)) + ')';
      span.style.transformOrigin = '0 0'; textLayer.appendChild(span);
    });
  }
  async function renderForms(pdfPage, viewport, shell, pageRecord, owner) {
    var layer = shell.querySelector('.pdfw-form-layer'); layer.replaceChildren();
    var annotations = await pdfPage.getAnnotations({ intent: 'display' });
    var lib = await loadPdfJs();
    if (!isCurrentWorkspace(owner) || !layer.isConnected) return;
    annotations.filter(function (item) { return item.subtype === 'Widget' && item.fieldName && item.rect; }).forEach(function (widget) {
      var first = [widget.rect[0], widget.rect[1]];
      var second = [widget.rect[2], widget.rect[3]];
      lib.Util.applyTransform(first, viewport.transform);
      lib.Util.applyTransform(second, viewport.transform);
      var rect = [first[0], first[1], second[0], second[1]];
      var left = Math.min(rect[0], rect[2]); var top = Math.min(rect[1], rect[3]);
      var width = Math.abs(rect[2] - rect[0]); var height = Math.abs(rect[3] - rect[1]);
      var input = widget.checkBox ? el('input', 'pdfw-form-field') : el('input', 'pdfw-form-field');
      input.type = widget.checkBox ? 'checkbox' : 'text'; input.name = widget.fieldName; input.setAttribute('aria-label', widget.alternativeText || widget.fieldName);
      var saved = owner.annotations.find(function (record) { return record.type === 'form' && record.pageId === pageRecord.id && record.fieldKey === widget.fieldName; });
      if (input.type === 'checkbox') input.checked = saved ? saved.value === true : !!widget.fieldValue;
      else input.value = saved ? String(saved.value || '') : String(widget.fieldValue || '');
      input.style.left = left + 'px'; input.style.top = top + 'px'; input.style.width = width + 'px'; input.style.height = height + 'px';
      input.addEventListener('change', function () {
        if (!isCurrentWorkspace(owner)) return;
        var record = saved || { id: global.SutraPdfEngine.id('pdfann_'), documentId: owner.documentRecord.id, pageId: pageRecord.id, type: 'form', geometry: storedGeometry(pageRecord.id, { x: left / viewport.width, y: top / viewport.height, width: width / viewport.width, height: height / viewport.height }), fieldKey: widget.fieldName };
        record.value = input.type === 'checkbox' ? input.checked : input.value; record.updatedAt = new Date().toISOString();
        var normalized = global.SutraPdfData.upsertAnnotation(record);
        var at = owner.annotations.findIndex(function (item) { return item.id === normalized.id; });
        if (at >= 0) owner.annotations[at] = normalized; else owner.annotations.push(normalized);
      });
      layer.appendChild(input);
    });
  }
  function preparePageCanvas(canvas, viewport) {
    canvas.width = Math.ceil(viewport.width * devicePixelRatio);
    canvas.height = Math.ceil(viewport.height * devicePixelRatio);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    var context = canvas.getContext('2d', { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return context;
  }
  async function renderPage(pageRecord, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var currentState = owner; var generation = currentState.renderGeneration || 0;
    var key = sourceKey(pageRecord) + ':' + pageRecord.id + ':' + currentState.zoom;
    if (currentState.rendered[key]) return currentState.rendered[key] === true ? undefined : currentState.rendered[key];
    var shell = currentState.pageNodes[pageRecord.id]; if (!shell) return;
    var job = (async function () {
      var source = await ensureSource(pageRecord.sourceFileId, currentState);
      if (!source || !isCurrentWorkspace(currentState) || currentState.renderGeneration !== generation) return;
      var pdfPage = await source.pdf.getPage(pageRecord.sourcePageIndex + 1);
      if (!isCurrentWorkspace(currentState) || currentState.renderGeneration !== generation) return;
      var needsSourceMetadata = currentState.sourceMetadataPending instanceof Set && currentState.sourceMetadataPending.has(pageRecord.id);
      if (needsSourceMetadata) pageRecord.rotation = Number(pdfPage.rotate || 0);
      var viewport = pdfPage.getViewport({ scale: currentState.zoom, rotation: pageRecord.rotation });
      pageRecord.width = viewport.width / currentState.zoom; pageRecord.height = viewport.height / currentState.zoom;
      if (needsSourceMetadata) {
        currentState.documentRecord = persistDocument(currentState.documentRecord);
        currentState.sourceMetadataPending.delete(pageRecord.id);
      }
      shell.style.width = viewport.width + 'px'; shell.style.height = viewport.height + 'px'; shell.dataset.pageId = pageRecord.id;
      var canvas = shell.querySelector('canvas'); var context = preparePageCanvas(canvas, viewport);
      var renderTask = pdfPage.render({ canvasContext: context, viewport: viewport, intent: 'display', background: 'rgb(255, 255, 255)' });
      currentState.renderTasks.add(renderTask);
      var timeoutId;
      var renderTimeout = new Promise(function (_, reject) { timeoutId = setTimeout(function () { reject(new Error('PDF page rendering timed out.')); }, 20000); });
      try { await Promise.race([renderTask.promise, renderTimeout]); }
      catch (renderError) {
        try { if (typeof renderTask.cancel === 'function') renderTask.cancel(); } catch (_) {}
        if (!isCurrentWorkspace(currentState) || currentState.renderGeneration !== generation) return;
        throw renderError;
      } finally { clearTimeout(timeoutId); currentState.renderTasks.delete(renderTask); }
      if (!isCurrentWorkspace(currentState) || currentState.renderGeneration !== generation) return;
      currentState.rendered[key] = true;
      message('Page ' + (currentState.documentRecord.pages.indexOf(pageRecord) + 1) + ' ready.');
      renderAnnotations(pageRecord.id); renderInspector();
      Promise.all([renderTextLayer(pdfPage, viewport, shell, pageRecord, currentState), renderForms(pdfPage, viewport, shell, pageRecord, currentState)])
        .then(function () { if (isCurrentWorkspace(currentState) && currentState.renderGeneration === generation) renderInspector(); })
        .catch(function (error) { if (isCurrentWorkspace(currentState)) report(error, 'pdf-page-text-layer'); });
    }());
    currentState.rendered[key] = job;
    try { await job; } catch (error) { if (currentState.rendered[key] === job) delete currentState.rendered[key]; throw error; }
  }
  async function renderThumbnail(pageRecord, canvas, owner) {
    owner = owner || state;
    if (!canvas || canvas.dataset.rendered === 'true' || !isCurrentWorkspace(owner)) return;
    var generation = owner.renderGeneration;
    var source = await ensureSource(pageRecord.sourceFileId, owner);
    if (!source || !isCurrentWorkspace(owner) || owner.renderGeneration !== generation) return;
    var pdfPage = await source.pdf.getPage(pageRecord.sourcePageIndex + 1);
    if (!isCurrentWorkspace(owner) || owner.renderGeneration !== generation || !canvas.isConnected) return;
    var base = pdfPage.getViewport({ scale: 1, rotation: pageRecord.rotation }); var scale = Math.min(0.22, 72 / Math.max(1, base.width));
    var viewport = pdfPage.getViewport({ scale: scale, rotation: pageRecord.rotation }); var context = preparePageCanvas(canvas, viewport);
    var renderTask = pdfPage.render({ canvasContext: context, viewport: viewport, intent: 'display', background: 'rgb(255, 255, 255)' });
    owner.renderTasks.add(renderTask);
    try {
      await renderTask.promise;
      if (isCurrentWorkspace(owner) && owner.renderGeneration === generation && canvas.isConnected) canvas.dataset.rendered = 'true';
    } finally { owner.renderTasks.delete(renderTask); }
  }
  function createPageShell(pageRecord, index) {
    var wrap = el('section', 'pdfw-page-wrap'); wrap.dataset.pageId = pageRecord.id; wrap.setAttribute('aria-label', 'Page ' + (index + 1));
    var label = el('div', 'pdfw-page-number', String(index + 1)); wrap.appendChild(label);
    var page = el('div', 'pdfw-page'); page.appendChild(document.createElement('canvas'));
    page.appendChild(el('div', 'pdfw-text-layer')); page.appendChild(el('div', 'pdfw-form-layer')); page.appendChild(el('div', 'pdfw-annotations'));
    wrap.appendChild(page); state.pageNodes[pageRecord.id] = page;
    return wrap;
  }
  function observePages(owner) {
    if (owner.observer) owner.observer.disconnect();
    owner.observer = new IntersectionObserver(function (entries) {
      if (!isCurrentWorkspace(owner)) return;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.dataset.pageId; var record = owner.documentRecord.pages.find(function (page) { return page.id === id; });
        if (record) { owner.activePageId = id; renderPage(record, owner).catch(function (error) { if (isCurrentWorkspace(owner)) { report(error, 'pdf-page-render'); message('Could not render a page.', 'error'); } }); }
      });
    }, { root: owner.reader, rootMargin: '1000px 0px', threshold: 0.01 });
    owner.reader.querySelectorAll('.pdfw-page-wrap').forEach(function (node) { owner.observer.observe(node); });
  }
  async function rebuildPages(owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    owner.renderGeneration = (owner.renderGeneration || 0) + 1;
    owner.renderTasks.forEach(function (task) { try { if (task && typeof task.cancel === 'function') task.cancel(); } catch (_) {} });
    owner.reader.replaceChildren(); owner.thumbnails.replaceChildren(); owner.pageNodes = {}; owner.rendered = {};
    owner.documentRecord.pages.forEach(function (record, index) {
      owner.reader.appendChild(createPageShell(record, index));
      var thumb = button('', 'page'); thumb.dataset.pageId = record.id; thumb.classList.add('pdfw-thumbnail'); var thumbCanvas = document.createElement('canvas'); thumb.appendChild(thumbCanvas); thumb.appendChild(el('span', '', String(index + 1))); owner.thumbnails.appendChild(thumb);
    });
    observePages(owner);
    if (owner.thumbnailObserver) owner.thumbnailObserver.disconnect();
    var generation = owner.renderGeneration;
    owner.thumbnailObserver = new IntersectionObserver(function (entries) {
      if (!isCurrentWorkspace(owner) || owner.renderGeneration !== generation) return;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var record = owner.documentRecord.pages.find(function (page) { return page.id === entry.target.dataset.pageId; });
        if (record) renderThumbnail(record, entry.target.querySelector('canvas'), owner).catch(function (error) { if (isCurrentWorkspace(owner)) report(error, 'pdf-thumbnail'); });
      });
    }, { root: owner.thumbnails, rootMargin: '300px 0px' });
    owner.thumbnails.querySelectorAll('.pdfw-thumbnail').forEach(function (node) { owner.thumbnailObserver.observe(node); });
    if (owner.documentRecord.pages[0]) await renderPage(owner.documentRecord.pages[0], owner);
    if (!isCurrentWorkspace(owner) || owner.renderGeneration !== generation) return;
    renderInspector();
  }
  function normalizedPoint(event, page) {
    var rect = page.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }
  function selectionGeometry(page) {
    var selection = global.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    var pageRect = page.getBoundingClientRect(); var rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(function (rect) { return rect.width && rect.height; }).map(function (rect) {
      return { x: (rect.left - pageRect.left) / pageRect.width, y: (rect.top - pageRect.top) / pageRect.height, width: rect.width / pageRect.width, height: rect.height / pageRect.height };
    });
    return rects.length ? { rects: rects } : null;
  }
  function captureSelectionDraft() {
    var selection = global.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.anchorNode) return null;
    var owner = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    var page = owner && owner.closest ? owner.closest('.pdfw-page') : null; if (!page) return null;
    var geometry = selectionGeometry(page); var selectedText = selection.toString().trim(); if (!geometry || !selectedText) return null;
    state.selectionDraft = { pageId: page.dataset.pageId, geometry: storedGeometry(page.dataset.pageId, geometry), text: selectedText.slice(0, 50000) };
    setSelectionActionsVisible(true);
    return state.selectionDraft;
  }
  function setSelectionActionsVisible(visible) {
    if (!state || !state.selectionActions) return;
    state.selectionActions.hidden = !visible;
  }
  function saveAnnotation(annotation) {
    var normalized = global.SutraPdfData.upsertAnnotation(annotation);
    var index = state.annotations.findIndex(function (record) { return record.id === normalized.id; });
    if (index >= 0) state.annotations[index] = normalized; else state.annotations.push(normalized);
    renderAnnotations(normalized.pageId); renderInspector(); return normalized;
  }
  function showInputDialog(options) {
    options = options || {};
    return new Promise(function (resolve) {
      if (!state || !state.root) { resolve(null); return; }
      var previous = document.activeElement;
      var dialog = el('dialog', 'pdfw-input-dialog');
      var title = el('h2', '', options.title || 'Add to PDF');
      var titleId = 'pdfw-input-title-' + String(Date.now()); title.id = titleId;
      var form = el('form'); form.method = 'dialog'; form.appendChild(title);
      if (options.help) form.appendChild(el('p', 'pdfw-input-help', options.help));
      var label = el('label', 'pdfw-input-label', options.label || 'Text');
      var field = document.createElement(options.multiline ? 'textarea' : 'input');
      field.className = 'pdfw-input-field'; field.name = 'value'; field.autocomplete = 'off';
      field.value = options.defaultValue || ''; field.placeholder = options.placeholder || '';
      if (options.multiline) { field.rows = 4; field.maxLength = 5000; } else { field.type = options.type || 'text'; field.maxLength = 5000; }
      label.appendChild(field); form.appendChild(label);
      var actions = el('div', 'pdfw-dialog-actions'); actions.appendChild(button('Cancel', 'cancel-input')); actions.appendChild(button(options.confirmLabel || 'Insert', 'confirm-input')); form.appendChild(actions);
      dialog.appendChild(form); dialog.setAttribute('aria-labelledby', titleId); dialog.setAttribute('aria-modal', 'true'); state.root.appendChild(dialog);
      var settled = false;
      function finish(value) {
        if (settled) return; settled = true; dialog.close(); dialog.remove();
        if (previous && typeof previous.focus === 'function') { try { previous.focus(); } catch (_) {} }
        resolve(value);
      }
      form.addEventListener('submit', function (event) { event.preventDefault(); finish(String(field.value || '').trim()); });
      dialog.addEventListener('close', function () { if (!settled) finish(null); });
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.addEventListener('click', function (event) {
        var action = event.target.closest('[data-action]'); if (!action) return;
        event.preventDefault(); finish(action.dataset.action === 'confirm-input' ? String(field.value || '').trim() : null);
      });
      dialog.showModal(); setTimeout(function () { field.focus(); if (field.select) field.select(); }, 0);
    });
  }
  function addSelectionAnnotation(type) {
    var draft = captureSelectionDraft() || state.selectionDraft; if (!draft) return false;
    pushUndo('Add ' + type); saveAnnotation({ documentId: state.documentRecord.id, pageId: draft.pageId, type: type, geometry: draft.geometry, text: draft.text, style: { color: state.color } });
    var selection = global.getSelection(); if (selection) selection.removeAllRanges(); return true;
  }
  async function addPointAnnotation(event, page, type, owner) {
    owner = owner || state;
    var point = normalizedPoint(event, page); var text = '';
    if (type === 'text') text = await showInputDialog({ title: 'Add text to PDF', label: 'Text box content', multiline: true, placeholder: 'Type the text you want to place on the page.' });
    if (type === 'comment') text = await showInputDialog({ title: 'Add comment', label: 'Comment', multiline: true, placeholder: 'Leave a note about this page.' });
    if (type === 'stamp') text = await showInputDialog({ title: 'Add stamp', label: 'Stamp text', defaultValue: 'APPROVED', placeholder: 'APPROVED' });
    if (!text || !isCurrentWorkspace(owner)) return;
    pushUndo('Add ' + type); saveAnnotation({ documentId: owner.documentRecord.id, pageId: page.dataset.pageId, type: type, geometry: storedGeometry(page.dataset.pageId, { x: point.x, y: point.y, width: type === 'comment' ? 0.035 : 0.24, height: type === 'comment' ? 0.035 : 0.06 }), text: text, style: { color: owner.color, opacity: 0.9 } });
  }
  function bindPageInput(owner) {
    owner.reader.addEventListener('pointerdown', function (event) {
      if (!isCurrentWorkspace(owner)) return;
      var annotation = event.target.closest('[data-annotation-id]');
      if (annotation && owner.tool === 'erase') {
        event.preventDefault(); pushUndo('Erase annotation'); var id = annotation.dataset.annotationId; var existing = state.annotations.find(function (item) { return item.id === id; });
        global.SutraPdfData.removeAnnotation(id); state.annotations = state.annotations.filter(function (item) { return item.id !== id; });
        if (existing) renderAnnotations(existing.pageId); renderInspector(); return;
      }
      var page = event.target.closest('.pdfw-page'); if (!page) return;
      if (['text', 'comment', 'stamp'].includes(owner.tool)) { event.preventDefault(); addPointAnnotation(event, page, owner.tool, owner).catch(function (error) { if (isCurrentWorkspace(owner)) report(error, 'pdf-annotation-dialog'); }); return; }
      if (!['ink', 'signature'].includes(owner.tool)) return;
      event.preventDefault(); page.setPointerCapture(event.pointerId); var path = [normalizedPoint(event, page)];
      function move(moveEvent) { path.push(normalizedPoint(moveEvent, page)); }
      function finish() {
        page.removeEventListener('pointermove', move); page.removeEventListener('pointerup', finish); page.removeEventListener('pointercancel', finish);
        if (!isCurrentWorkspace(owner) || path.length < 2) return; pushUndo('Add ink'); var rotation = pagePlan(page.dataset.pageId).rotation;
        saveAnnotation({ documentId: owner.documentRecord.id, pageId: page.dataset.pageId, type: owner.tool, geometry: {}, inkPaths: [path.map(function (point) { return global.SutraPdfEngine.unrotatePoint(point, rotation); })], style: { color: owner.color, width: owner.tool === 'signature' ? 0.003 : 0.004, opacity: 1 } });
      }
      page.addEventListener('pointermove', move); page.addEventListener('pointerup', finish); page.addEventListener('pointercancel', finish);
    });
    owner.reader.addEventListener('mouseup', function () { if (!isCurrentWorkspace(owner)) return; captureSelectionDraft(); if (['highlight', 'underline', 'strikeout'].includes(owner.tool)) addSelectionAnnotation(owner.tool); });
  }
  function goToPage(pageId) {
    var node = state.reader.querySelector('.pdfw-page-wrap[data-page-id="' + CSS.escape(String(pageId)) + '"]');
    if (node) { node.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); state.activePageId = pageId; renderInspector(); }
  }
  async function goToOutline(rawDestination, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var destination = rawDestination;
    var source = owner.sources[owner.file.id]; if (!source) return;
    if (typeof destination === 'string') destination = await source.pdf.getDestination(destination);
    if (!isCurrentWorkspace(owner)) return;
    if (!Array.isArray(destination) || !destination[0]) return;
    var pageIndex = typeof destination[0] === 'object' ? await source.pdf.getPageIndex(destination[0]) : Number(destination[0]);
    if (!isCurrentWorkspace(owner)) return;
    var planPage = owner.documentRecord.pages.find(function (page) { return page.sourceFileId === owner.file.id && page.sourcePageIndex === pageIndex; });
    if (planPage) goToPage(planPage.id);
  }
  async function applyPageCommand(type, pageId, payload, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    pushUndo(type + ' page'); global.SutraPdfData.checkpoint(owner.documentRecord.id, type + ' page');
    owner.documentRecord = global.SutraPdfEngine.applyPagePlan(owner.documentRecord, Object.assign({ type: type, pageId: pageId }, payload || {}));
    owner.documentRecord = persistDocument(owner.documentRecord); await rebuildPages(owner);
    if (isCurrentWorkspace(owner)) renderOrganizer();
  }
  async function storePageSource(file) {
    var sourceFile = file;
    if (/^image\/(?:png|jpeg)$/i.test(file.type)) {
      await loadAssemblyRuntime();
      var imageDocument = await global.PDFLib.PDFDocument.create(); var imageBytes = new Uint8Array(await file.arrayBuffer());
      var embedded = /png/i.test(file.type) ? await imageDocument.embedPng(imageBytes) : await imageDocument.embedJpg(imageBytes);
      var imagePage = imageDocument.addPage([embedded.width, embedded.height]); imagePage.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      sourceFile = new File([await imageDocument.save()], String(file.name || 'image').replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
    }
    var added = await global.SutraAttachments.addFiles([sourceFile], { source: 'pdf_page_insert' });
    if (!added[0]) throw new Error('A page source could not be stored.');
    return added[0];
  }
  async function insertFiles(files, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var list = Array.from(files || []); if (!list.length) return;
    pushUndo('Insert or merge files'); global.SutraPdfData.checkpoint(owner.documentRecord.id, 'Before inserting pages');
    for (var index = 0; index < list.length; index += 1) {
      if (!isCurrentWorkspace(owner)) return;
      if (!/application\/pdf/i.test(list[index].type) && !/\.pdf$/i.test(list[index].name) && !/^image\/(?:png|jpeg)$/i.test(list[index].type)) throw new Error('Insert supports PDF, PNG, and JPEG files.');
      var meta = await storePageSource(list[index]); if (!isCurrentWorkspace(owner)) return;
      var source = await ensureSource(meta.id, owner); if (!source || !isCurrentWorkspace(owner)) return;
      for (var pageIndex = 0; pageIndex < source.pdf.numPages; pageIndex += 1) {
        var sourcePage = await source.pdf.getPage(pageIndex + 1);
        if (!isCurrentWorkspace(owner)) return;
        owner.documentRecord.pages.push({ id: global.SutraPdfEngine.id('pdfpage_'), sourceFileId: meta.id, sourcePageIndex: pageIndex, order: owner.documentRecord.pages.length, rotation: Number(sourcePage.rotate || 0) });
      }
    }
    owner.documentRecord = persistDocument(owner.documentRecord); await rebuildPages(owner);
    if (!isCurrentWorkspace(owner)) return;
    renderOrganizer(owner); message('Pages inserted. The source attachments were verified and linked.', 'success');
  }
  async function splitAfter(pageId, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var index = owner.documentRecord.pages.findIndex(function (page) { return page.id === pageId; });
    if (index < 0 || index >= owner.documentRecord.pages.length - 1) return;
    var original = owner.documentRecord; var groups = [original.pages.slice(0, index + 1), original.pages.slice(index + 1)]; var created = [];
    try {
      for (var partIndex = 0; partIndex < groups.length; partIndex += 1) {
        if (!isCurrentWorkspace(owner)) return;
        owner.documentRecord = Object.assign({}, clone(original, {}), { pages: clone(groups[partIndex], []) });
        owner.documentRecord.pages.forEach(function (page, pageIndex) { page.order = pageIndex; });
        var bytes = await buildExportBytes({ mode: 'clean', includeForms: true, flattenForms: false, includeCommentSummary: false }, owner);
        if (!isCurrentWorkspace(owner)) return;
        var base = String(owner.file.name || 'document.pdf').replace(/\.pdf$/i, '');
        var splitFile = new File([bytes], base + '-part-' + (partIndex + 1) + '.pdf', { type: 'application/pdf' });
        var options = Object.assign({ source: 'pdf_split' }, owner.context && owner.context.entityType && owner.context.entityId ? { entityType: owner.context.entityType, entityId: owner.context.entityId } : {});
        var added = await global.SutraAttachments.addFiles([splitFile], options); if (added[0]) created.push(added[0]);
      }
    } finally { if (isCurrentWorkspace(owner)) owner.documentRecord = original; }
    if (!isCurrentWorkspace(owner)) return;
    if (created.length !== 2) throw new Error('Sutra could not verify both split PDF files.');
    message('Created two verified PDF attachments from this split.', 'success');
  }
  function renderOrganizer(owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var panel = owner.organizer; panel.replaceChildren();
    var top = el('div', 'pdfw-sheet-header'); top.appendChild(el('h2', '', 'Page organizer')); top.appendChild(button('Done', 'close-organizer')); panel.appendChild(top);
    var insert = button('Insert / merge PDF or images', 'insert-files'); panel.appendChild(insert);
    var input = el('input', 'pdfw-file-input'); input.type = 'file'; input.multiple = true; input.accept = 'application/pdf,image/png,image/jpeg'; input.hidden = true; panel.appendChild(input);
    input.addEventListener('change', async function () { try { await insertFiles(input.files, owner); } catch (error) { if (isCurrentWorkspace(owner)) { report(error, 'pdf-insert-pages'); message(error.message || 'Pages could not be inserted.', 'error'); } } });
    owner.documentRecord.pages.forEach(function (pageRecord, index) {
      var row = el('div', 'pdfw-organizer-row'); row.appendChild(el('span', '', 'Page ' + (index + 1)));
      var up = button('↑', 'move-up', 'Move page up'); up.dataset.pageId = pageRecord.id; up.disabled = index === 0; row.appendChild(up);
      var down = button('↓', 'move-down', 'Move page down'); down.dataset.pageId = pageRecord.id; down.disabled = index === owner.documentRecord.pages.length - 1; row.appendChild(down);
      var rotate = button('↻', 'rotate', 'Rotate page'); rotate.dataset.pageId = pageRecord.id; row.appendChild(rotate);
      var remove = button('Remove', 'remove-page'); remove.dataset.pageId = pageRecord.id; remove.disabled = owner.documentRecord.pages.length === 1; row.appendChild(remove); panel.appendChild(row);
      if (index < owner.documentRecord.pages.length - 1) { var split = button('Split after', 'split-after'); split.dataset.pageId = pageRecord.id; row.appendChild(split); }
    });
  }
  async function buildExportBytes(options, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
    if (options.mode === 'original') return owner.bytes.slice();
    await loadAssemblyRuntime();
    if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
    if (owner.security.encrypted) throw new Error('Edited export is unavailable for encrypted PDFs. Export the exact original instead.');
    var PDFDocument = global.PDFLib.PDFDocument; var degrees = global.PDFLib.degrees; var rgb = global.PDFLib.rgb; var loaded = {};
    var sourcePageCount = owner.sources[owner.file.id] && owner.sources[owner.file.id].pdf ? owner.sources[owner.file.id].pdf.numPages : 0;
    var preservesOriginalStructure = owner.documentRecord.pages.length === sourcePageCount && owner.documentRecord.pages.every(function (pageRecord, pageIndex) {
      return pageRecord.sourceFileId === owner.file.id && pageRecord.sourcePageIndex === pageIndex;
    });
    var output = preservesOriginalStructure
      ? await PDFDocument.load(owner.bytes, { ignoreEncryption: false, updateMetadata: false })
      : await PDFDocument.create();
    if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
    if (preservesOriginalStructure) {
      owner.documentRecord.pages.forEach(function (planPage, pageIndex) { output.getPage(pageIndex).setRotation(degrees(planPage.rotation || 0)); });
    } else {
      for (var index = 0; index < owner.documentRecord.pages.length; index += 1) {
        if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
        var planPage = owner.documentRecord.pages[index];
        if (!loaded[planPage.sourceFileId]) { var source = await ensureSource(planPage.sourceFileId, owner); if (!source || !isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.'); loaded[planPage.sourceFileId] = await PDFDocument.load(source.bytes, { ignoreEncryption: false, updateMetadata: false }); }
        var copied = await output.copyPages(loaded[planPage.sourceFileId], [planPage.sourcePageIndex]); var page = copied[0];
        if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
        page.setRotation(degrees(planPage.rotation || 0)); output.addPage(page);
      }
    }
    var annotationFont = null;
    try {
      if (global.fontkit && typeof output.registerFontkit === 'function') {
        output.registerFontkit(global.fontkit);
        annotationFont = await output.embedFont(await loadUnicodeFontBytes(), { subset: true });
      }
    } catch (fontError) { if (isCurrentWorkspace(owner)) report(fontError, 'pdf-unicode-font'); }
    if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
    var forms = owner.annotations.filter(function (annotation) { return annotation.type === 'form'; });
    if (preservesOriginalStructure) {
      try {
        var form = output.getForm();
        if (options.includeForms) forms.forEach(function (record) {
          try {
            var field = form.getField(record.fieldKey);
            if (field.constructor && /CheckBox/.test(field.constructor.name)) record.value ? field.check() : field.uncheck();
            else if (typeof field.select === 'function' && Array.isArray(record.value)) field.select(record.value);
            else if (typeof field.setText === 'function') field.setText(String(record.value || ''));
          } catch (_) { /* unsupported field type */ }
        });
        else form.getFields().forEach(function (field) {
          try {
            if (field.constructor && /CheckBox|RadioGroup/.test(field.constructor.name) && typeof field.uncheck === 'function') field.uncheck();
            else if (typeof field.clear === 'function') field.clear();
            else if (typeof field.setText === 'function') field.setText('');
          } catch (_) { /* unsupported field type */ }
        });
        if (annotationFont && typeof form.updateFieldAppearances === 'function') form.updateFieldAppearances(annotationFont);
        if (options.flattenForms) form.flatten();
      } catch (_) { /* no AcroForm */ }
    }
    if (options.mode === 'annotated') {
      var comments = [];
      owner.documentRecord.pages.forEach(function (planPage, pageIndex) {
        var page = output.getPage(pageIndex); var size = page.getSize();
        currentAnnotations(planPage.id, owner).filter(function (record) { return record.type !== 'form'; }).forEach(function (record) {
          var colorHex = record.style.color.replace('#', ''); var color = rgb(parseInt(colorHex.slice(0, 2), 16) / 255, parseInt(colorHex.slice(2, 4), 16) / 255, parseInt(colorHex.slice(4, 6), 16) / 255);
          var rects = record.geometry.rects.length ? record.geometry.rects : [record.geometry];
          if (['highlight', 'underline', 'strikeout'].includes(record.type)) rects.forEach(function (rect) {
            var y = size.height - ((rect.y + rect.height) * size.height);
            if (record.type === 'highlight') page.drawRectangle({ x: rect.x * size.width, y: y, width: rect.width * size.width, height: rect.height * size.height, color: color, opacity: record.style.opacity });
            else page.drawLine({ start: { x: rect.x * size.width, y: y + (record.type === 'strikeout' ? rect.height * size.height * 0.5 : 0) }, end: { x: (rect.x + rect.width) * size.width, y: y + (record.type === 'strikeout' ? rect.height * size.height * 0.5 : 0) }, thickness: Math.max(1, record.style.width * size.width), color: color, opacity: record.style.opacity });
          });
          if (record.type === 'ink' || record.type === 'signature') record.inkPaths.forEach(function (path) { for (var p = 1; p < path.length; p += 1) page.drawLine({ start: { x: path[p - 1].x * size.width, y: (1 - path[p - 1].y) * size.height }, end: { x: path[p].x * size.width, y: (1 - path[p].y) * size.height }, thickness: Math.max(1, record.style.width * size.width), color: color, opacity: record.style.opacity }); });
          if (record.type === 'text' || record.type === 'stamp') page.drawText(record.text || '', Object.assign({ x: record.geometry.x * size.width, y: (1 - record.geometry.y - record.geometry.height) * size.height, size: Math.max(8, record.style.fontSize * size.height), color: color, opacity: record.style.opacity, maxWidth: Math.max(20, record.geometry.width * size.width) }, annotationFont ? { font: annotationFont } : {}));
          if (record.type === 'comment') { comments.push({ number: comments.length + 1, page: pageIndex + 1, text: record.text }); page.drawCircle({ x: record.geometry.x * size.width, y: (1 - record.geometry.y) * size.height, size: 8, color: color }); page.drawText(String(comments.length), Object.assign({ x: record.geometry.x * size.width - 3, y: (1 - record.geometry.y) * size.height - 3, size: 7, color: rgb(1, 1, 1) }, annotationFont ? { font: annotationFont } : {})); }
        });
      });
      if (options.includeCommentSummary && comments.length) {
        var summary = output.addPage([612, 792]); summary.drawText('Sutra PDF comments', Object.assign({ x: 48, y: 744, size: 18 }, annotationFont ? { font: annotationFont } : {})); var cursor = 712;
        comments.forEach(function (comment) { if (cursor < 60) { summary = output.addPage([612, 792]); cursor = 744; } summary.drawText(comment.number + '. Page ' + comment.page + ': ' + String(comment.text || '').slice(0, 180), Object.assign({ x: 48, y: cursor, size: 10, maxWidth: 516, lineHeight: 13 }, annotationFont ? { font: annotationFont } : {})); cursor -= 32; });
      }
    }
    var outputBytes = new Uint8Array(await output.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: true }));
    if (!isCurrentWorkspace(owner)) throw new Error('The PDF workspace closed before export completed.');
    return outputBytes;
  }
  async function exportPdf(rawOptions, owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) throw new Error('No PDF is open.');
    var options = global.SutraPdfEngine.resolveExportOptions(rawOptions, owner.annotations.length);
    if (owner.security.signed && options.mode !== 'original') {
      if (!global.confirm('This PDF contains a digital signature. A modified copy will not validate that source signature. Continue?')) return null;
    }
    message('Building and validating export…'); var bytes = await buildExportBytes(options, owner);
    if (!isCurrentWorkspace(owner)) return null;
    var validation = global.SutraPdfEngine.validatePdfBytes(bytes); if (!validation.ok) throw new Error('Generated PDF failed signature validation.');
    if (options.mode === 'original' && (bytes.length !== owner.bytes.length || bytes.some(function (byte, index) { return byte !== owner.bytes[index]; }))) throw new Error('Exact-original verification failed.');
    if (options.mode !== 'original') {
      var validationDocument = await getPdfDocument(bytes);
      try { if (validationDocument.numPages < 1) throw new Error('Generated PDF could not be reopened.'); await validationDocument.getPage(1); }
      finally { await releasePdf(validationDocument); }
      if (!isCurrentWorkspace(owner)) return null;
    }
    var blob = new Blob([bytes], { type: 'application/pdf' }); var url = URL.createObjectURL(blob); var anchor = el('a'); anchor.href = url;
    var base = String(owner.file.originalName || owner.file.name || 'document.pdf').replace(/\.pdf$/i, ''); anchor.download = options.mode === 'original' ? base + '.pdf' : base + '-' + options.mode + '.pdf';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); message('Export verified and downloaded.', 'success'); return bytes;
  }
  function showExport(owner) {
    owner = owner || state;
    if (!isCurrentWorkspace(owner)) return;
    var dialog = el('dialog', 'pdfw-export-dialog'); var form = el('form'); form.method = 'dialog'; form.appendChild(el('h2', '', 'Export PDF'));
    var modes = [['original', 'Exact original bytes'], ['clean', 'Current page arrangement without annotations'], ['annotated', 'Current page arrangement with annotations']];
    var selected = owner.annotations.length ? 'annotated' : 'clean';
    modes.forEach(function (entry) { var label = el('label', 'pdfw-radio'); var input = el('input'); input.type = 'radio'; input.name = 'mode'; input.value = entry[0]; input.checked = entry[0] === selected; label.appendChild(input); label.appendChild(document.createTextNode(entry[1])); form.appendChild(label); });
    [['includeForms', 'Include form answers', true], ['flattenForms', 'Flatten form fields', false], ['includeCommentSummary', 'Append comment summary', true]].forEach(function (entry) { var label = el('label', 'pdfw-check'); var input = el('input'); input.type = 'checkbox'; input.name = entry[0]; input.checked = entry[2]; label.appendChild(input); label.appendChild(document.createTextNode(entry[1])); form.appendChild(label); });
    if (owner.security.encrypted) form.appendChild(el('p', 'pdfw-warning', 'Encrypted source: edited export is disabled. Exact original remains available.'));
    var actions = el('div', 'pdfw-dialog-actions'); actions.appendChild(button('Cancel', 'cancel-export')); actions.appendChild(button('Export', 'confirm-export')); form.appendChild(actions); dialog.appendChild(form); owner.root.appendChild(dialog);
    dialog.addEventListener('click', async function (event) {
      if (!isCurrentWorkspace(owner)) { dialog.remove(); return; }
      var action = event.target.closest('[data-action]'); if (!action) return;
      if (action.dataset.action === 'cancel-export') { dialog.close(); dialog.remove(); return; }
      if (action.dataset.action === 'confirm-export') { event.preventDefault(); var data = new FormData(form); var mode = String(data.get('mode')); if (owner.security.encrypted && mode !== 'original') { message('Choose Exact original for encrypted PDFs.', 'error'); return; }
        action.disabled = true; try { await exportPdf({ mode: mode, includeForms: data.has('includeForms'), flattenForms: data.has('flattenForms'), includeCommentSummary: data.has('includeCommentSummary') }, owner); if (!isCurrentWorkspace(owner)) return; dialog.close(); dialog.remove(); } catch (error) { if (isCurrentWorkspace(owner)) { action.disabled = false; report(error, 'pdf-export'); message(error.message || 'Export failed.', 'error'); } }
      }
    }); dialog.showModal();
  }
  function buildUi() {
    var root = el('section', 'pdfw-root' + (state.embedded ? ' pdfw-root-embedded' : ''));
    root.setAttribute('role', state.embedded ? 'region' : 'dialog');
    if (!state.embedded) root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Sutra PDF workspace');
    var topbar = el('header', 'pdfw-topbar'); var title = el('strong', 'pdfw-title', state.file.name || 'PDF'); topbar.appendChild(title);
    var search = el('input', 'pdfw-search'); search.type = 'search'; search.placeholder = 'Search PDF'; search.setAttribute('aria-label', 'Search PDF'); topbar.appendChild(search);
    topbar.appendChild(button('−', 'zoom-out', 'Zoom out')); var zoom = el('output', 'pdfw-zoom', '100%'); topbar.appendChild(zoom); topbar.appendChild(button('+', 'zoom-in', 'Zoom in'));
    topbar.appendChild(button('Print', 'print')); topbar.appendChild(button('Pages', 'organizer')); topbar.appendChild(button('Export', 'export')); topbar.appendChild(button(state.embedded ? 'Back to note' : 'Close', 'close'));
    var tools = el('nav', 'pdfw-toolbar'); tools.setAttribute('aria-label', 'PDF annotation tools');
    function group(label, className) { var node = el('div', 'pdfw-tool-group' + (className ? ' ' + className : '')); node.setAttribute('role', 'group'); node.setAttribute('aria-label', label); return node; }
    var primary = group('Markup tools', 'pdfw-tool-group-primary');
    [['select', 'Select'], ['highlight', 'Highlight'], ['underline', 'Underline'], ['strikeout', 'Strike'], ['ink', 'Ink'], ['text', 'Text'], ['comment', 'Comment'], ['erase', 'Erase']].forEach(function (entry) { primary.appendChild(button(entry[1], 'tool-' + entry[0])); });
    tools.appendChild(primary);
    var documentTools = group('Document tools', 'pdfw-tool-group-secondary');
    [['signature', 'Signature'], ['stamp', 'Stamp'], ['bookmark', 'Bookmark'], ['inspector', 'Comments'], ['undo', 'Undo'], ['redo', 'Redo']].forEach(function (entry) { documentTools.appendChild(button(entry[1], entry[0] === 'signature' || entry[0] === 'stamp' ? 'tool-' + entry[0] : entry[0])); });
    tools.appendChild(documentTools);
    tools.appendChild(el('span', 'pdfw-toolbar-divider'));
    var selectionActions = group('Actions for selected text', 'pdfw-tool-group-selection'); selectionActions.hidden = true;
    [['Copy selection', 'selection-copy'], ['Highlight selection', 'selection-highlight'], ['Comment selection', 'selection-comment'], ['Send to Note', 'selection-note'], ['Review card', 'selection-review'], ['Ask Assistant', 'selection-assistant']].forEach(function (entry) { selectionActions.appendChild(button(entry[0], entry[1])); });
    tools.appendChild(selectionActions);
    var colorGroup = group('Markup color', 'pdfw-tool-group-color'); var color = el('input', 'pdfw-color'); color.type = 'color'; color.value = state.color; color.setAttribute('aria-label', 'Annotation color'); colorGroup.appendChild(color); tools.appendChild(colorGroup);
    var toolbarWrapper = state.embedded && document.querySelector('#view-notes .toolbar-wrapper');
    var notesToolbar = toolbarWrapper && toolbarWrapper.querySelector('.toolbar');
    if (toolbarWrapper && notesToolbar) {
      notesToolbar.classList.add('pdf-notes-toolbar-hidden');
      toolbarWrapper.classList.add('pdf-toolbar-active');
      toolbarWrapper.appendChild(topbar); toolbarWrapper.appendChild(tools);
    } else { root.appendChild(topbar); root.appendChild(tools); }
    var body = el('div', 'pdfw-body'); var thumbs = el('aside', 'pdfw-thumbnails'); thumbs.setAttribute('aria-label', 'Page thumbnails'); body.appendChild(thumbs);
    var reader = el('main', 'pdfw-reader'); reader.tabIndex = 0; body.appendChild(reader);
    var inspector = el('aside', 'pdfw-inspector'); inspector.setAttribute('aria-label', 'PDF outline, bookmarks, comments, and reading text'); var inspectorContent = el('div'); inspector.appendChild(inspectorContent); body.appendChild(inspector); root.appendChild(body);
    var status = el('div', 'pdfw-status', 'Opening PDF…'); status.setAttribute('role', 'status'); root.appendChild(status);
    var organizer = el('section', 'pdfw-sheet pdfw-organizer'); organizer.hidden = true; organizer.setAttribute('role', 'dialog'); organizer.setAttribute('aria-label', 'Page organizer'); root.appendChild(organizer);
    Object.assign(state, { root: root, thumbnails: thumbs, reader: reader, inspector: inspector, inspectorContent: inspectorContent, status: status, organizer: organizer, zoomOutput: zoom, searchInput: search, colorInput: color, selectionActions: selectionActions, notesToolbarWrapper: toolbarWrapper, notesToolbar: notesToolbar, pdfToolbarNodes: toolbarWrapper ? [topbar, tools] : [] });
    var mount = state.embedded && document.getElementById('notesPrimaryPane');
    (mount || document.body).appendChild(root);
    document.documentElement.classList.add('pdf-workspace-open');
    if (state.embedded) document.body.classList.add('pdf-page-active');
    bindUi(state); bindPageInput(state);
  }
  function updateToolButtons(owner) {
    [owner.root].concat(owner.pdfToolbarNodes || []).forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('[data-action^="tool-"]').forEach(function (node) { node.setAttribute('aria-pressed', node.dataset.action === 'tool-' + owner.tool ? 'true' : 'false'); });
    });
  }
  function bindUi(owner) {
    var handleAction = async function (event) {
      if (!isCurrentWorkspace(owner)) return;
      var control = event.target.closest('[data-action]'); if (!control) return;
      var belongsToWorkspace = owner.root.contains(control) || (owner.pdfToolbarNodes || []).some(function (node) { return node && node.contains(control); });
      if (!belongsToWorkspace) return;
      var action = control.dataset.action;
      if (action === 'close') close();
      else if (action.indexOf('tool-') === 0) { owner.tool = action.slice(5); updateToolButtons(owner); }
      else if (action === 'zoom-in' || action === 'zoom-out') { owner.zoom = Math.min(3, Math.max(0.5, owner.zoom + (action === 'zoom-in' ? 0.25 : -0.25))); owner.zoomOutput.textContent = Math.round(owner.zoom * 100) + '%'; await rebuildPages(owner); }
      else if (action === 'undo') await undo(owner); else if (action === 'redo') await redo(owner); else if (action === 'export') showExport(owner);
      else if (action.indexOf('selection-') === 0) {
        var draft = captureSelectionDraft() || owner.selectionDraft;
        if (!draft) { message('Select PDF text first.', 'error'); return; }
        if (action === 'selection-copy') { await navigator.clipboard.writeText(draft.text); if (!isCurrentWorkspace(owner)) return; message('Selection copied.', 'success'); }
        else if (action === 'selection-highlight') addSelectionAnnotation('highlight');
        else if (action === 'selection-comment') { var comment = await showInputDialog({ title: 'Comment on selection', label: 'Comment', multiline: true, help: 'This comment will stay anchored to the selected PDF text.' }); if (!isCurrentWorkspace(owner)) return; if (comment) { pushUndo('Comment on selection'); var firstRect = draft.geometry.rects[0] || draft.geometry; saveAnnotation({ documentId: owner.documentRecord.id, pageId: draft.pageId, type: 'comment', geometry: { x: firstRect.x + firstRect.width, y: firstRect.y, width: 0.035, height: 0.035 }, text: comment, style: { color: owner.color, opacity: 1 } }); } }
        else if (action === 'selection-note') { var noteText = draft.text; close(); if (global.flowAtelier && global.flowAtelier.openQuickCaptureModal) global.flowAtelier.openQuickCaptureModal('note: ' + noteText); }
        else if (action === 'selection-review') { var reviewText = draft.text; close(); if (global.flowAtelier && global.flowAtelier.openQuickCaptureModal) global.flowAtelier.openQuickCaptureModal('review: ' + reviewText + ' | '); }
        else if (action === 'selection-assistant') { var assistantText = draft.text; close(); if (global.flowAssistant && typeof global.flowAssistant.askFlow === 'function') global.flowAssistant.askFlow('Help me understand this PDF selection:\n\n' + assistantText, { send: false }); }
      }
      else if (action === 'print') { var url = URL.createObjectURL(new Blob([owner.bytes], { type: 'application/pdf' })); owner.sourceUrls.push(url); var opened = global.open(url, '_blank', 'noopener,noreferrer'); if (!opened) message('Your browser blocked the print preview.', 'error'); }
      else if (action === 'organizer') { renderOrganizer(owner); owner.organizer.hidden = false; }
      else if (action === 'close-organizer') owner.organizer.hidden = true;
      else if (action === 'inspector') owner.inspector.classList.toggle('pdfw-inspector-open');
      else if (action === 'insert-files') { var picker = owner.organizer.querySelector('.pdfw-file-input'); if (picker) picker.click(); }
      else if (action === 'page' || action === 'jump-annotation') goToPage(control.dataset.pageId);
      else if (action === 'outline') { try { await goToOutline(JSON.parse(control.dataset.dest || 'null'), owner); } catch (error) { if (isCurrentWorkspace(owner)) report(error, 'pdf-outline'); } }
      else if (action === 'move-up' || action === 'move-down') { var pageIndex = owner.documentRecord.pages.findIndex(function (page) { return page.id === control.dataset.pageId; }); await applyPageCommand('move', control.dataset.pageId, { toIndex: pageIndex + (action === 'move-up' ? -1 : 1) }, owner); }
      else if (action === 'rotate') await applyPageCommand('rotate', control.dataset.pageId, { degrees: 90 }, owner);
      else if (action === 'remove-page' && global.confirm('Remove this page from the edited arrangement? The original stays unchanged.')) await applyPageCommand('remove', control.dataset.pageId, {}, owner);
      else if (action === 'split-after') { control.disabled = true; try { await splitAfter(control.dataset.pageId, owner); } catch (error) { if (isCurrentWorkspace(owner)) { report(error, 'pdf-split'); message(error.message || 'PDF split failed.', 'error'); } } finally { if (control.isConnected) control.disabled = false; } }
      else if (action === 'bookmark') { var id = owner.activePageId || (owner.documentRecord.pages[0] && owner.documentRecord.pages[0].id); if (id) { var bookmarkTitle = await showInputDialog({ title: 'Add bookmark', label: 'Bookmark title', defaultValue: 'Bookmark' }); if (!isCurrentWorkspace(owner) || !bookmarkTitle) return; pushUndo('Add bookmark'); owner.documentRecord.bookmarks.push({ id: global.SutraPdfEngine.id('pdfbm_'), pageId: id, title: bookmarkTitle, createdAt: new Date().toISOString() }); owner.documentRecord = persistDocument(owner.documentRecord); renderInspector(); } }
    };
    owner.root.addEventListener('click', handleAction);
    (owner.pdfToolbarNodes || []).forEach(function (node) { node.addEventListener('click', handleAction); });
    owner.colorInput.addEventListener('input', function (event) { if (isCurrentWorkspace(owner)) owner.color = event.target.value; });
    owner.searchInput.addEventListener('input', function () {
      if (!isCurrentWorkspace(owner)) return;
      var query = owner.searchInput.value.trim().toLowerCase(); owner.root.querySelectorAll('.pdfw-page-wrap').forEach(function (wrap) { wrap.classList.toggle('pdfw-search-match', !!query && String(owner.textByPage[wrap.dataset.pageId] || '').toLowerCase().includes(query)); });
      if (query) { var first = owner.documentRecord.pages.find(function (page) { return String(owner.textByPage[page.id] || '').toLowerCase().includes(query); }); if (first) goToPage(first.id); }
    });
    owner.root.addEventListener('keydown', function (event) { if (!isCurrentWorkspace(owner)) return; if (event.key === 'Escape' && owner.organizer.hidden) close(); else if (event.key === 'Escape') owner.organizer.hidden = true; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo(owner) : undo(owner); } });
    updateToolButtons(owner);
  }
  global.addEventListener('noteflow:view-changed', function (event) {
    if (event.detail && event.detail.view !== 'notes' && ((state && state.embedded) || pendingOpenEmbedded)) close();
  });
  global.addEventListener('sutra:note-page-loaded', function (event) {
    if (!event.detail || !event.detail.pageId) return;
    var pageId = String(event.detail.pageId);
    if (state && state.embedded && pageId !== String(state.context.entityId || '')) close();
    else if (pendingOpenEmbedded && pendingOpenContextId && pageId !== pendingOpenContextId) close();
  });
  async function createRecord(fileId, pdf, candidate) {
    var record = global.SutraPdfData.findByFile(fileId);
    if (!record || !Array.isArray(record.pages) || !record.pages.length) record = candidate && Array.isArray(candidate.pages) && candidate.pages.length ? candidate : global.SutraPdfEngine.makeDocument(fileId, pdf.numPages);
    return persistDocument(record);
  }
  async function open(fileId, context) {
    if (!global.SutraAttachments || !global.SutraPdfData || !global.SutraPdfEngine) throw new Error('The PDF workspace bridge is unavailable.');
    var generation = ++openGeneration;
    if (state) disposeWorkspace(state); else removeStaleWorkspaceChrome();
    var openContext = context || {};
    var fromNotesSurface = !!(document.body && document.body.getAttribute('data-view') === 'notes');
    pendingOpenEmbedded = fromNotesSurface;
    pendingOpenContextId = fromNotesSurface ? String(openContext.entityId || '') : '';
    var isOpenCurrent = function () { return generation === openGeneration; };
    var file = global.SutraAttachments.get(fileId); if (!file || file.kind !== 'pdf') { if (isOpenCurrent()) { pendingOpenEmbedded = false; pendingOpenContextId = ''; } throw new Error('The selected attachment is not a PDF.'); }
    var bytes;
    try { bytes = await global.SutraAttachments.readBytes(fileId); }
    catch (error) { if (isOpenCurrent()) { pendingOpenEmbedded = false; pendingOpenContextId = ''; } throw error; }
    if (!isOpenCurrent()) return null;
    if (!bytes) { pendingOpenEmbedded = false; pendingOpenContextId = ''; throw new Error('The PDF bytes are unavailable on this device.'); }
    var security = global.SutraPdfEngine.detectDocumentSecurity(bytes); var pdf;
    try { pdf = await getPdfDocument(bytes); }
    catch (error) { if (!isOpenCurrent()) return null; pendingOpenEmbedded = false; pendingOpenContextId = ''; report(error, 'pdf-open'); throw error; }
    if (!isOpenCurrent()) { await releasePdf(pdf); return null; }
    var existingDocument = global.SutraPdfData.findByFile(fileId);
    var owner = { file: file, bytes: bytes, security: security, sources: {}, sourcePromises: {}, sourceUrls: [], retiredPdfs: new Set(), renderTasks: new Set(), destroyed: false, documentRecord: existingDocument || global.SutraPdfEngine.makeDocument(fileId, pdf.numPages), sourceMetadataPending: !existingDocument, annotations: [], outline: [], pageNodes: {}, rendered: {}, renderGeneration: 0, textByPage: {}, activePageId: '', tool: 'select', color: '#facc15', zoom: innerWidth < 700 ? 0.75 : 1.15, undo: [], redo: [], context: openContext, embedded: fromNotesSurface, observer: null, thumbnailObserver: null, selectionDraft: null };
    owner.sources[fileId] = { file: file, bytes: bytes, pdf: pdf };
    owner.annotations = global.SutraPdfData.listAnnotations(owner.documentRecord.id);
    state = owner; pendingOpenEmbedded = false; pendingOpenContextId = '';
    try { buildUi(); }
    catch (error) { disposeWorkspace(owner); throw error; }
    if (!isCurrentWorkspace(owner)) return null;
    message('Preparing the first page…');
    var renderReady = true;
    try {
      owner.documentRecord = await createRecord(fileId, pdf, owner.documentRecord);
      if (!isCurrentWorkspace(owner)) return null;
      if (owner.sourceMetadataPending === true) owner.sourceMetadataPending = new Set(owner.documentRecord.pages.map(function (page) { return page.id; }));
      await rebuildPages(owner);
      if (!isCurrentWorkspace(owner)) return null;
    } catch (error) {
      if (!isCurrentWorkspace(owner)) return null;
      report(error, 'pdf-open-render');
      message('The first render needs a local retry…');
      try {
        var priorPdf = owner.sources[fileId] && owner.sources[fileId].pdf;
        var localPdf = await getPdfDocument(bytes, { disableWorker: true });
        if (!isCurrentWorkspace(owner)) { await releasePdf(localPdf); return null; }
        if (priorPdf) owner.retiredPdfs.add(priorPdf);
        owner.sources[fileId].pdf = localPdf;
        await rebuildPages(owner);
        if (!isCurrentWorkspace(owner)) return null;
      } catch (fallbackError) {
        if (!isCurrentWorkspace(owner)) return null;
        report(fallbackError, 'pdf-open-render-fallback');
        renderReady = false;
        message('PDF saved to Sutra, but this browser could not render its first page.', 'error');
        var errorPanel = el('div', 'pdfw-render-error'); errorPanel.appendChild(el('strong', '', 'This PDF is saved safely.')); errorPanel.appendChild(el('p', '', 'Try reloading the page or opening it again from the Notes list. The original bytes are unchanged.')); owner.reader.replaceChildren(errorPanel);
      }
    }
    if (!isCurrentWorkspace(owner)) return null;
    if (!renderReady) { renderInspector(); var errorFocus = owner.root.querySelector('[data-action="tool-select"]'); if (errorFocus) errorFocus.focus(); return getContext(); }
    try { owner.outline = await Promise.race([owner.sources[fileId].pdf.getOutline(), new Promise(function (resolve) { setTimeout(function () { resolve([]); }, 1500); })]) || []; } catch (_) { owner.outline = []; }
    if (!isCurrentWorkspace(owner)) return null;
    renderInspector(); owner.zoomOutput.textContent = Math.round(owner.zoom * 100) + '%'; message(security.signed ? 'Signed source detected. Saved to Sutra; cloud sync follows Sync settings. Original PDF is unchanged.' : 'Saved to Sutra. Device copy is ready; cloud sync follows Sync settings. Original PDF is unchanged.', security.signed ? 'warning' : 'success'); var initialFocus = owner.root.querySelector('[data-action="tool-select"]'); if (initialFocus) initialFocus.focus(); return getContext();
  }
  async function extractText(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []); var pdf = await getPdfDocument(bytes); var parts = [];
    for (var pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) { var page = await pdf.getPage(pageIndex); var content = await page.getTextContent(); parts.push('Page ' + pageIndex + '\n' + content.items.map(function (item) { return item.str || ''; }).join(' ').replace(/\s+/g, ' ').trim()); }
    await releasePdf(pdf); return parts.join('\n\n');
  }
  async function createFromFiles(files, options) {
    await loadAssemblyRuntime(); var list = Array.from(files || []); if (!list.length) return null;
    var output = await global.PDFLib.PDFDocument.create();
    for (var i = 0; i < list.length; i += 1) {
      var file = list[i]; var bytes = new Uint8Array(await file.arrayBuffer());
      if (global.SutraPdfEngine.validatePdfBytes(bytes).ok) { var source = await global.PDFLib.PDFDocument.load(bytes); var copied = await output.copyPages(source, source.getPageIndices()); copied.forEach(function (page) { output.addPage(page); }); }
      else if (/^image\/(png|jpeg)$/i.test(file.type)) { var image = /png/i.test(file.type) ? await output.embedPng(bytes) : await output.embedJpg(bytes); var page = output.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height }); }
      else throw new Error('Only PDF, PNG, and JPEG files can be assembled.');
    }
    var outputBytes = new Uint8Array(await output.save()); var validationPdf = await getPdfDocument(outputBytes); await validationPdf.getPage(1); await releasePdf(validationPdf);
    var name = options && options.name ? String(options.name) : 'Created PDF.pdf'; if (!/\.pdf$/i.test(name)) name += '.pdf'; var createdFile = new File([outputBytes], name, { type: 'application/pdf' });
    var added = await global.SutraAttachments.addFiles([createdFile], options || {}); if (!added[0]) throw new Error('The assembled PDF could not be stored.'); await open(added[0].id, options || {}); return added[0];
  }
  global.SutraPdfAdapter = { load: getPdfDocument, extractText: extractText };
  global.SutraPdfWorkspace = { open: open, createFromFiles: createFromFiles, export: exportPdf, getContext: getContext, close: close, isEnabled: enabled };
  try { global.dispatchEvent(new CustomEvent('sutra:pdf-workspace-ready')); } catch (_) {}
}(typeof window !== 'undefined' ? window : globalThis));
