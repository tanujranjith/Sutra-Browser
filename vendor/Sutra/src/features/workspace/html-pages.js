(function (global) {
  'use strict';

  var root = null;
  var activePageId = '';
  var saveTimer = 0;
  var previewTimer = 0;
  var lastPreviewSource = null;
  var MAX_SOURCE_BYTES = 4 * 1024 * 1024;

  function bridge() {
    var value = global.flowAtelier;
    if (!value || !Array.isArray(value.pages) || typeof value.persistAppData !== 'function') {
      throw new Error('HTML Pages requires the canonical Sutra workspace bridge.');
    }
    return value;
  }

  function id() {
    return 'html_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function authorized(page) {
    var value = bridge();
    return typeof value.isPageContentAuthorized === 'function'
      ? value.isPageContentAuthorized(page)
      : !!(page && !(page.isLocked && page.lockHash));
  }

  function normalizeDocument(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var now = new Date().toISOString();
    var createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now;
    return Object.assign({}, raw, {
      version: 1,
      source: typeof raw.source === 'string' ? raw.source : String(raw.source || ''),
      createdAt: createdAt,
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt
    });
  }

  function pageForCurrentRoute() {
    var value = bridge();
    var pageId = value.currentPageId || '';
    var page = value.pages.find(function (item) { return item && item.id === pageId; }) || null;
    return page && authorized(page) ? page : null;
  }

  function documentFor(page) {
    return page ? normalizeDocument(page.htmlDocument) : null;
  }

  function setVisible(visible) {
    if (!root) return;
    root.hidden = !visible;
    root.toggleAttribute('inert', !visible);
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
    document.body.classList.toggle('html-page-active', visible);
  }

  function setStatus(message, state) {
    if (!root) return;
    var output = root.querySelector('[data-html-save-status]');
    if (!output) return;
    output.textContent = message;
    output.dataset.state = state || '';
  }

  function sourceHasBlockedAssets(source) {
    var attr = /\b(?:src|href|poster|action)\s*=\s*(["'])(.*?)\1/gi;
    var match;
    while ((match = attr.exec(String(source || '')))) {
      var url = String(match[2] || '').trim();
      if (!url || url.charAt(0) === '#' || /^data:/i.test(url)) continue;
      return true;
    }
    var cssUrl = /\burl\(\s*(["']?)(.*?)\1\s*\)/gi;
    while ((match = cssUrl.exec(String(source || '')))) {
      var cssValue = String(match[2] || '').trim();
      if (cssValue && cssValue.charAt(0) !== '#' && !/^data:/i.test(cssValue)) return true;
    }
    return false;
  }

  function updateAssetWarning(source) {
    var warning = root && root.querySelector('[data-html-asset-warning]');
    if (!warning) return;
    warning.hidden = !sourceHasBlockedAssets(source);
  }

  function renderPreview(force) {
    if (!root || root.hidden) return;
    var page = pageForCurrentRoute();
    var model = documentFor(page);
    if (!model) return;
    if (!force && model.source === lastPreviewSource) return;
    lastPreviewSource = model.source;
    var host = root.querySelector('[data-html-preview]');
    updateAssetWarning(model.source);
    if (!host || !global.SutraDOMSafety || typeof global.SutraDOMSafety.renderUserHTMLToFrame !== 'function') {
      setStatus('Preview safety layer unavailable', 'error');
      return;
    }
    global.SutraDOMSafety.renderUserHTMLToFrame(host, model.source, {
      title: (page.title || 'HTML page') + ' preview',
      mode: 'active-local',
      capabilityAcknowledged: true,
      referrerPolicy: 'no-referrer',
      height: '100%'
    });
  }

  function schedulePreview() {
    global.clearTimeout(previewTimer);
    previewTimer = global.setTimeout(function () { renderPreview(false); }, 260);
  }

  function persistCurrentPage() {
    global.clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      var value = bridge();
      value.persistAppData();
      var result = typeof value.flushAppSaveNow === 'function' ? value.flushAppSaveNow('html-page-edit') : null;
      if (result && typeof result.then === 'function') {
        result.then(function () { setStatus('Saved locally', 'saved'); }).catch(function () {
          setStatus('Not saved — your code is still in the editor', 'error');
        });
      } else {
        setStatus('Saved locally', 'saved');
      }
    } catch (error) {
      setStatus('Not saved — your code is still in the editor', 'error');
    }
  }

  function updateSource(source) {
    var page = pageForCurrentRoute();
    if (!page || !page.htmlDocument) return false;
    var value = String(source == null ? '' : source);
    if (new Blob([value]).size > MAX_SOURCE_BYTES) {
      setStatus('HTML must be 4 MB or smaller', 'error');
      return false;
    }
    var now = new Date().toISOString();
    page.htmlDocument.source = value;
    page.htmlDocument.updatedAt = now;
    page.updatedAt = now;
    setStatus('Saving…', 'saving');
    global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(persistCurrentPage, 450);
    schedulePreview();
    return true;
  }

  function setMobilePanel(panel) {
    if (!root) return;
    var next = panel === 'preview' ? 'preview' : 'code';
    root.dataset.mobilePanel = next;
    root.querySelectorAll('[data-html-panel]').forEach(function (button) {
      var selected = button.dataset.htmlPanel === next;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    setSourceMode(next === 'code');
    if (next === 'preview') renderPreview(true);
  }

  function setSourceMode(open) {
    if (!root) return;
    var isOpen = open === true;
    root.dataset.sourceOpen = isOpen ? 'true' : 'false';
    var editButton = root.querySelector('[data-html-edit-source]');
    if (editButton) {
      editButton.textContent = isOpen ? 'Close source' : 'Edit source';
      editButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    if (isOpen) {
      root.dataset.mobilePanel = 'code';
      root.querySelectorAll('[data-html-panel]').forEach(function (button) {
        var selected = button.dataset.htmlPanel === 'code';
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      global.setTimeout(function () {
        var editor = root && root.querySelector('[data-html-source]');
        if (editor) editor.focus();
      }, 0);
    } else {
      root.dataset.mobilePanel = 'preview';
      root.querySelectorAll('[data-html-panel]').forEach(function (button) {
        var selected = button.dataset.htmlPanel === 'preview';
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }
  }

  function importFile(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name || '')) {
      setStatus('Choose an .html or .htm file', 'error');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus('HTML must be 4 MB or smaller', 'error');
      return;
    }
    file.text().then(function (source) {
      var editor = root && root.querySelector('[data-html-source]');
      if (editor && updateSource(source)) {
        editor.value = source;
        setStatus('Imported — saving…', 'saving');
        renderPreview(true);
      }
    }).catch(function () {
      setStatus('Could not read that HTML file', 'error');
    });
  }

  function mount() {
    if (root) return root;
    root = document.createElement('section');
    root.id = 'htmlPageEditor';
    root.className = 'html-page-editor';
    root.hidden = true;
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('aria-label', 'HTML Page editor');
    root.innerHTML = '<header class="html-page-toolbar"><div class="html-page-mode"><span>Create</span><strong>HTML Page</strong></div><div class="html-page-mobile-tabs" role="tablist" aria-label="HTML Page view"><button type="button" data-html-panel="code" role="tab" aria-selected="false">Code</button><button type="button" data-html-panel="preview" role="tab" aria-selected="true" class="active">Preview</button></div><div class="html-page-actions"><button type="button" data-html-edit-source aria-expanded="false">Edit source</button><button type="button" data-html-refresh>Refresh preview</button><span class="html-page-local-status" role="status"><span class="html-page-local-dot" aria-hidden="true"></span>Local preview</span></div></header><div class="html-page-warning" data-html-asset-warning role="note" hidden>Linked or remote assets are blocked in this local preview. Embed assets as data URLs to keep them available offline.</div><div class="html-page-workspace"><section class="html-page-code" aria-label="HTML source"><div class="html-page-source-toolbar"><label for="sutraHtmlPageSource">HTML, CSS, and JavaScript</label><label class="html-page-import"><input type="file" accept=".html,.htm,text/html" data-html-import>Import HTML</label></div><textarea id="sutraHtmlPageSource" data-html-source spellcheck="false" autocomplete="off" aria-describedby="htmlPageSafetyNote"></textarea><p id="htmlPageSafetyNote">Scripts run only inside an isolated offline sandbox. Network requests, forms, popups, downloads, parent access, and top navigation are blocked.</p></section><section class="html-page-preview" aria-label="Live preview"><div data-html-preview></div></section></div><footer class="html-page-status"><span>Device-local active preview</span><output data-html-save-status role="status" aria-live="polite">Saved locally</output></footer>'; // sutra-allow-html: reviewed static editor chrome; authored HTML only enters the sandbox helper.
    var container = document.getElementById('notesPrimaryPane');
    if (container) container.appendChild(root);
    root.querySelector('[data-html-source]').addEventListener('input', function (event) { updateSource(event.target.value); });
    root.querySelector('[data-html-edit-source]').addEventListener('click', function () { setSourceMode(root.dataset.sourceOpen !== 'true'); });
    root.querySelector('[data-html-refresh]').addEventListener('click', function () { renderPreview(true); });
    root.querySelector('[data-html-import]').addEventListener('change', function (event) { importFile(event.target.files && event.target.files[0]); event.target.value = ''; });
    root.querySelectorAll('[data-html-panel]').forEach(function (button) { button.addEventListener('click', function () { setMobilePanel(button.dataset.htmlPanel); }); });
    return root;
  }

  function refresh() {
    var page;
    try { page = pageForCurrentRoute(); } catch (error) { return; }
    var model = documentFor(page);
    var show = !!(page && model);
    if (!show) {
      activePageId = '';
      lastPreviewSource = null;
      if (root) {
        var sourceEditor = root.querySelector('[data-html-source]');
        var previewHost = root.querySelector('[data-html-preview]');
        if (sourceEditor) sourceEditor.value = '';
        if (previewHost) previewHost.replaceChildren();
        setVisible(false);
      }
      else document.body.classList.remove('html-page-active');
      return;
    }
    mount();
    var changedPage = activePageId !== page.id;
    activePageId = page.id;
    if (!page.htmlDocument || page.htmlDocument.version !== 1) page.htmlDocument = model;
    setVisible(true);
    if (changedPage || root.querySelector('[data-html-source]').value !== model.source) {
      root.querySelector('[data-html-source]').value = model.source;
      lastPreviewSource = null;
      setStatus('Saved locally', 'saved');
      setSourceMode(false);
      renderPreview(true);
    }
  }

  function createPage(title, options) {
    var value = bridge();
    var now = new Date().toISOString();
    var source = options && typeof options.source === 'string' ? options.source : '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My Sutra page</title>\n  <style>\n    body { font-family: system-ui, sans-serif; padding: 2rem; }\n  </style>\n</head>\n<body>\n  <h1>Hello, Sutra!</h1>\n  <p>Edit this HTML and see the preview update.</p>\n</body>\n</html>';
    if (new Blob([source]).size > MAX_SOURCE_BYTES) throw new Error('HTML must be 4 MB or smaller.');
    var page = {
      id: id(),
      title: String(title || 'HTML Page').trim() || 'HTML Page',
      type: 'note',
      content: '',
      blocks: [],
      icon: '🌐',
      spaceId: value.getActiveSpaceId ? value.getActiveSpaceId() : 'default',
      createdAt: now,
      updatedAt: now,
      htmlDocument: { version: 1, source: source, createdAt: now, updatedAt: now }
    };
    value.pages.push(page);
    value.persistAppData();
    if (typeof value.renderPagesList === 'function') value.renderPagesList();
    if (typeof global.loadPage === 'function') global.loadPage(page.id);
    global.setTimeout(refresh, 0);
    return page;
  }

  function createFromNewPageDialog() {
    var input = document.getElementById('newPageName');
    var modal = document.getElementById('newPageModal');
    if (modal) modal.classList.remove('active');
    return createPage(input && input.value || 'HTML Page');
  }

global.addEventListener('sutra:note-page-loaded', refresh);
global.addEventListener('sutra:workspace-remote-commit', refresh);
  global.SutraHTMLPages = {
    createPage: createPage,
    createFromNewPageDialog: createFromNewPageDialog,
    getCurrentPage: pageForCurrentRoute,
    getDocument: function () { return documentFor(pageForCurrentRoute()); },
    normalizeDocument: normalizeDocument,
    renderPreview: function () { renderPreview(true); }
  };
}(window));
