(function (global) {
  'use strict';
  var activePageId = '';
  var activeSlideId = '';
  var selectedElementId = '';
  var root = null;
  var undoStack = [];
  var redoStack = [];
  var elementClipboard = null;
  var dragState = null;
  var themes = {
    sutra: { bg: '#fbfaf5', ink: '#173d2b', accent: '#635bdf' },
    nature: { bg: '#fbfaf5', ink: '#1f4d38', accent: '#3f7c52' },
    midnight: { bg: '#18222d', ink: '#f3f5f7', accent: '#8b82ff' },
    paper: { bg: '#ffffff', ink: '#243141', accent: '#4169a8' }
  };

  function id() { return 'slide_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function appBridge() {
    var bridge = global.flowAtelier;
    if (!bridge || !Array.isArray(bridge.pages) || typeof bridge.persistAppData !== 'function') {
      throw new Error('Slides requires the canonical Sutra workspace bridge.');
    }
    return bridge;
  }
  function workspace() {
    var bridge = appBridge();
    return { pages: bridge.pages, ui: { lastOpenedPageId: bridge.currentPageId || '' } };
  }
  function pageFrom(data) { var page = (data.pages || []).find(function (item) { return item && item.id === activePageId; }) || null; return page && pageContentAuthorized(page) ? page : null; }
  function deckFor(page) { return page && page.slides && Array.isArray(page.slides.slides) ? page.slides : null; }
  function pageContentAuthorized(page) {
    var bridge = appBridge();
    if (typeof bridge.isPageContentAuthorized === 'function') return bridge.isPageContentAuthorized(page);
    var unlocked = bridge.unlockedPageIds;
    return !!(page && !(page.isLocked && page.lockHash && !(unlocked && unlocked.has && unlocked.has(page.id))));
  }
  function activeSlide(deck) { return deck && deck.slides.find(function (slide) { return slide.id === activeSlideId; }) || (deck && deck.slides[0]) || null; }
  function setEditorVisible(visible) {
    if (!root) return;
    root.hidden = !visible;
    root.toggleAttribute('inert', !visible);
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }
  function scheduleSave() { appBridge().persistAppData(); }
  function escapeText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function escapeHtml(value) { return escapeText(value).replace(/[&<>"']/g, function (character) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]; }); }
  function makeElement(type, fields) { return Object.assign({ id: id(), type: type, x: 10, y: 12, width: type === 'text' ? 42 : 24, height: type === 'text' ? 12 : 20, text: '', fontSize: 3, fontWeight: 'normal', fill: 'transparent', color: '#173d2b', borderColor: '#d7d3c7', borderWidth: 0, assetFileId: '' }, fields || {}); }
  function makeSlide(layout, title) {
    var elements = [];
    if (layout === 'title') {
      elements.push(makeElement('text', { x: 9, y: 25, width: 56, height: 24, text: title || 'Untitled presentation', fontSize: 8, fontWeight: 'bold' }));
      elements.push(makeElement('text', { x: 10, y: 49, width: 48, height: 8, text: 'Add a concise subtitle or guiding question.', fontSize: 3 }));
    } else if (layout === 'three-card') {
      elements.push(makeElement('text', { x: 8, y: 7, width: 80, height: 16, text: title || 'Untitled slide', fontSize: 6, fontWeight: 'bold' }));
      ['First idea', 'Why it matters', 'Key detail'].forEach(function (text, index) { var x = 8 + index * 30; elements.push(makeElement('shape', { x: x, y: 31, width: 25, height: 38, fill: '#ffffff', borderWidth: 1 })); elements.push(makeElement('text', { x: x + 3, y: 38, width: 19, height: 8, text: text, fontWeight: 'bold' })); });
    } else {
      elements.push(makeElement('text', { x: 8, y: 8, width: 80, height: 16, text: title || 'New slide', fontSize: 6, fontWeight: 'bold' }));
      elements.push(makeElement('text', { x: 10, y: 25, width: 62, height: 40, text: layout === 'two-column' ? 'First idea\n\nSecond idea' : '• Add your first point\n• Keep each point focused\n• Use notes for detail', fontSize: 3 }));
    }
    return { id: id(), layout: layout || 'title-body', title: title || 'New slide', speakerNotes: '', elements: elements };
  }
  function normalizeDeck(raw, title) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var slides = (Array.isArray(source.slides) ? source.slides : []).map(function (rawSlide) {
      var slide = rawSlide && typeof rawSlide === 'object' ? rawSlide : {};
      return Object.assign({}, slide, {
        id: String(slide.id || id()),
        layout: String(slide.layout || 'blank'),
        title: String(slide.title || 'Untitled slide').slice(0, 500),
        speakerNotes: String(slide.speakerNotes || '').slice(0, 50000),
        background: typeof slide.background === 'string' ? slide.background.slice(0, 128) : '',
        elements: (Array.isArray(slide.elements) ? slide.elements : []).map(function (rawElement) {
          var element = rawElement && typeof rawElement === 'object' ? rawElement : {};
          return Object.assign({}, element, {
            id: String(element.id || id()), type: ['text', 'shape', 'image', 'chart', 'table'].indexOf(element.type) >= 0 ? element.type : 'text',
            x: Math.max(0, Math.min(100, Number(element.x) || 0)), y: Math.max(0, Math.min(100, Number(element.y) || 0)),
            width: Math.max(1, Math.min(100, Number(element.width) || 20)), height: Math.max(1, Math.min(100, Number(element.height) || 10)),
            zIndex: Number(element.zIndex) || 0, text: String(element.text || '').slice(0, 20000),
            textAlign: ['left', 'center', 'right'].indexOf(element.textAlign) >= 0 ? element.textAlign : 'left',
            imageFit: ['contain', 'cover'].indexOf(element.imageFit) >= 0 ? element.imageFit : 'contain'
          });
        })
      });
    });
    if (!slides.length) slides = [makeSlide('title', title || 'Untitled presentation')];
    return Object.assign({}, source, { version: 2, size: source.size === 'standard' ? 'standard' : 'widescreen', theme: themes[source.theme] ? source.theme : 'sutra', slides: slides, importWarnings: Array.isArray(source.importWarnings) ? source.importWarnings.map(String).slice(0, 100) : [] });
  }
  function ensureDeck(page) {
    if (!page.slides || !Array.isArray(page.slides.slides) || page.slides.version !== 2) page.slides = normalizeDeck(page.slides, page.title);
    if (!page.slides.slides.length) page.slides.slides.push(makeSlide('title', page.title || 'Untitled presentation'));
    return page.slides;
  }
  function button(label, icon, action, title) { var b = document.createElement('button'); b.type = 'button'; b.className = 'slides-toolbar-btn'; b.title = title || label; b.setAttribute('aria-label', label); if (icon) { var glyph = document.createElement('i'); glyph.className = 'fas ' + icon; glyph.setAttribute('aria-hidden', 'true'); b.appendChild(glyph); var labelNode = document.createElement('span'); labelNode.textContent = label; b.appendChild(labelNode); } else b.textContent = label; b.addEventListener('click', action); return b; }
  function addElement(type) { mutate(function (deck) { var slide = activeSlide(deck); var element = type === 'chart' ? makeElement('chart', { x: 32, y: 30, width: 38, height: 35, text: 'Chart', chart: { labels: ['A', 'B', 'C'], values: [5, 8, 4] } }) : type === 'table' ? makeElement('table', { x: 12, y: 28, width: 76, height: 42, text: 'Header 1\tHeader 2\nValue 1\tValue 2', rows: [['Header 1', 'Header 2'], ['Value 1', 'Value 2']], fill: '#ffffff', borderWidth: 1 }) : makeElement(type, type === 'shape' ? { x: 35, y: 35, width: 24, height: 18, text: 'Shape', fill: '#e9e6db', borderWidth: 1 } : { x: 15, y: 35, text: 'Add text', fontSize: 4 }); slide.elements.push(element); selectedElementId = element.id; }); }
  function duplicateSlide() { mutate(function (deck) { var current = activeSlide(deck); var copy = JSON.parse(JSON.stringify(current)); copy.id = id(); copy.title = (copy.title || 'Slide') + ' copy'; copy.elements.forEach(function (element) { element.id = id(); }); deck.slides.splice(deck.slides.indexOf(current) + 1, 0, copy); activeSlideId = copy.id; }); }
  function deleteSlide() { mutate(function (deck) { if (deck.slides.length < 2) { showToast('A deck needs at least one slide.'); return; } var i = deck.slides.indexOf(activeSlide(deck)); deck.slides.splice(i, 1); activeSlideId = deck.slides[Math.max(0, i - 1)].id; }); }
  function chooseImage() { var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.addEventListener('change', function () { var file = input.files && input.files[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) { showToast('Slide images must be 10MB or smaller.'); return; } var reader = new FileReader(); reader.onload = function () { mutate(function (deck) { activeSlide(deck).elements.push(makeElement('image', { x: 54, y: 15, width: 37, height: 57, dataUrl: reader.result, alt: file.name })); }); }; reader.readAsDataURL(file); }); input.click(); }
  function printPdf() { var data = workspace(); var page = pageFrom(data); if (!page) return; var popup = global.open('', '_blank', 'noopener,noreferrer'); if (!popup) { showToast('Allow pop-ups to print Slides as PDF.'); return; } var deck = deckFor(page); popup.document.write('<!doctype html><title>' + escapeHtml(page.title) + '</title><style>@page{size:landscape;margin:0}.slide{width:13.333in;height:7.5in;page-break-after:always;padding:.5in;box-sizing:border-box;font-family:Arial;white-space:pre-wrap}</style>' + deck.slides.map(function (slide) { return '<section class="slide" style="background:' + escapeHtml(slide.background || themes[deck.theme].bg) + '">' + slide.elements.filter(function (element) { return element.type !== 'image'; }).map(function (element) { return '<div style="font-size:' + Math.max(8, Math.min(72, Number(element.fontSize || 3) * 7)) + 'pt">' + escapeHtml(element.text) + '</div>'; }).join('') + '</section>'; }).join('') + '<script>addEventListener("load",function(){print()})<\/script>'); popup.document.close(); } // sutra-allow-html: printable document is built from escaped deck text and bounded numeric styles.
  async function exportPptx() { var page = pageFrom(workspace()); if (!page || !global.SutraOfficeInterop) { showToast('PPTX export is unavailable in this browser.'); return false; } try { await global.SutraOfficeInterop.downloadPptx(deckFor(page), page.title || 'presentation'); showToast('PowerPoint file exported.'); return true; } catch (error) { showToast(error && error.message || 'PPTX export failed.'); return false; } }
  async function importPptx(file) { var page = pageFrom(workspace()); if (!page || !file || !global.SutraOfficeInterop) return { ok: false, error: 'Choose a PPTX file to import.' }; try { var imported = await global.SutraOfficeInterop.importPptx(file); mutate(function (_, currentPage) { currentPage.slides = normalizeDeck(imported.deck, currentPage.title); activeSlideId = currentPage.slides.slides[0].id; selectedElementId = ''; }); var warnings = imported.report && imported.report.warnings || []; if (warnings.length) global.alert('Presentation imported with warnings:\n\n• ' + warnings.join('\n• ')); else showToast('PowerPoint file imported.'); return { ok: true, deck: imported.deck, report: imported.report }; } catch (error) { showToast(error && error.message || 'PPTX import failed.'); return { ok: false, error: error && error.message || 'PPTX import failed.' }; } }
  function getContext() {
    var data = workspace(); var page = pageFrom(data); var deck = page && deckFor(page);
    if (!page || !deck) return null;
    return {
      id: page.id, title: page.title || 'Untitled presentation', type: 'slides',
      theme: deck.theme || 'sutra', size: deck.size || 'widescreen', slideCount: deck.slides.length,
      slides: deck.slides.slice(0, 10).map(function (slide) {
        return {
          id: slide.id, title: String(slide.title || '').slice(0, 300), layout: slide.layout || 'blank',
          background: String(slide.background || '').slice(0, 64), speakerNotes: String(slide.speakerNotes || '').slice(0, 500),
          elements: (Array.isArray(slide.elements) ? slide.elements : []).slice(0, 10).map(function (element) {
            return {
              id: element.id, type: element.type, x: Number(element.x) || 0, y: Number(element.y) || 0,
              width: Number(element.width) || 0, height: Number(element.height) || 0, zIndex: Number(element.zIndex) || 0,
              fontSize: Number(element.fontSize) || 0, fontWeight: String(element.fontWeight || '').slice(0, 32),
              fill: String(element.fill || '').slice(0, 64), color: String(element.color || '').slice(0, 64),
              borderColor: String(element.borderColor || '').slice(0, 64), borderWidth: Number(element.borderWidth) || 0,
              text: String(element.text || '').slice(0, 240), alt: String(element.alt || '').slice(0, 160),
              chart: element.type === 'chart' && element.chart ? {
                labels: (element.chart.labels || []).slice(0, 12).map(function (label) { return String(label).slice(0, 100); }),
                values: (element.chart.values || []).slice(0, 12).map(Number)
              } : undefined
            };
          })
        };
      })
    };
  }
  function assistantEngine() { return global.SutraSurfaceAssistantActions || null; }
  function validateAssistantOperations(operations, options) {
    var engine = assistantEngine();
    if (!engine || typeof engine.applySlides !== 'function') return { ok: false, error: 'Slides Assistant engine is unavailable.' };
    var page = pageFrom(workspace());
    var deck = options && options.create ? { version: 2, size: 'widescreen', theme: 'sutra', slides: [] } : (page && deckFor(page));
    if (!deck) return { ok: false, error: 'Open an unlocked Slides deck first.' };
    var sequence = 0;
    return engine.applySlides(deck, operations, { idFactory: function () { sequence += 1; return 'slides-preview-' + sequence; }, now: 'preview' });
  }
  function createAssistantDeck(spec) {
    var input = spec && typeof spec === 'object' ? spec : {};
    var engine = assistantEngine();
    if (!engine || typeof engine.applySlides !== 'function') return { ok: false, error: 'Slides Assistant engine is unavailable.' };
    var operations = (Array.isArray(input.slides) ? input.slides : []).map(function (slide) { return Object.assign({}, slide, { type: 'add_slide' }); });
    if (input.theme) operations.push({ type: 'theme', theme: input.theme });
    if (input.size) operations.push({ type: 'size', size: input.size });
    var applied = engine.applySlides({ version: 2, size: 'widescreen', theme: 'sutra', slides: [] }, operations, { idFactory: id, now: new Date().toISOString() });
    if (!applied.ok) return applied;
    var page = createPage(String(input.title || 'Presentation').slice(0, 180), { deck: applied.model });
    return { ok: !!page, page: page, slideCount: applied.model.slides.length };
  }
  function applyAssistantOperations(operations) {
    var page = pageFrom(workspace());
    var engine = assistantEngine();
    if (!page || !deckFor(page)) return { ok: false, error: 'Open an unlocked Slides deck first.' };
    if (!engine || typeof engine.applySlides !== 'function') return { ok: false, error: 'Slides Assistant engine is unavailable.' };
    var applied = engine.applySlides(page.slides, operations, { idFactory: id, now: new Date().toISOString() });
    if (!applied.ok) return applied;
    page.slides = applied.model;
    page.updatedAt = new Date().toISOString();
    applied.undo.pageId = page.id;
    if (applied.createdSlideIds.length) activeSlideId = applied.createdSlideIds[applied.createdSlideIds.length - 1];
    scheduleSave();
    render();
    return Object.assign(applied, { pageId: page.id });
  }
  function undoAssistantMutation(payload) {
    var engine = assistantEngine();
    if (!engine || typeof engine.undoSlides !== 'function' || !payload || !payload.pageId) return { ok: false, error: 'Slides undo is unavailable.' };
    var bridge = appBridge();
    var page = bridge.pages.find(function (item) { return item && item.id === payload.pageId; }) || null;
    if (!page || !pageContentAuthorized(page) || !deckFor(page)) return { ok: false, error: 'Unlock the Slides deck before undoing this edit.' };
    var restored = engine.undoSlides(page.slides, payload);
    if (!restored.ok) return restored;
    page.slides = restored.model;
    page.updatedAt = new Date().toISOString();
    bridge.persistAppData();
    if (page.id === activePageId) render();
    if (typeof bridge.renderPagesList === 'function') bridge.renderPagesList();
    return { ok: true, pageId: page.id };
  }
  function refresh() {
    var data;
    try { data = workspace(); } catch (error) { return; }
    var pageId = data.ui && data.ui.lastOpenedPageId || '';
    var page = (data.pages || []).find(function (item) { return item && item.id === pageId; });
    activePageId = pageId;
    var visible = !!(page && pageContentAuthorized(page) && page.slides && Array.isArray(page.slides.slides));
    if (visible) { if (page.slides.version !== 2) { page.slides = normalizeDeck(page.slides, page.title); appBridge().persistAppData(); } mount(); render(); } else setEditorVisible(false);
    document.body.classList.toggle('slides-page-active', visible);
  }
  function createPage(title, options) { var bridge = appBridge(); var now = new Date().toISOString(); var deck = options && options.deck && Array.isArray(options.deck.slides) ? normalizeDeck(options.deck, title) : { version: 2, size: 'widescreen', theme: 'sutra', slides: [makeSlide('title', title || 'Untitled presentation')] }; var page = { id: id(), title: title || 'Presentation', type: 'note', content: '', blocks: [], icon: '🖼️', spaceId: bridge.getActiveSpaceId ? bridge.getActiveSpaceId() : 'default', createdAt: now, updatedAt: now, slides: deck }; bridge.pages.push(page); bridge.persistAppData(); if (typeof bridge.renderPagesList === 'function') bridge.renderPagesList(); if (typeof global.loadPage === 'function') global.loadPage(page.id); return page; }
  function cloneDeck(deck) { return JSON.parse(JSON.stringify(deck)); }
  function createFromNewPageDialog() { var titleInput = document.getElementById('newPageName'); var title = titleInput && titleInput.value || 'Presentation'; var modal = document.getElementById('newPageModal'); if (modal) modal.classList.remove('active'); createPage(title); }

  // Workbench layer: session undo/redo, direct object manipulation, and a focused
  // inspector. It stays within the canonical page.slides record; no second store.
  function historySnapshot(page) { return { pageId: page.id, deck: cloneDeck(ensureDeck(page)) }; }
  function pushHistory(page) { undoStack.push(historySnapshot(page)); if (undoStack.length > 80) undoStack.shift(); redoStack = []; }
  function mutate(change, rerender, options) {
    var data = workspace(); var page = pageFrom(data); if (!page || !pageContentAuthorized(page)) return;
    var deck = ensureDeck(page); if (!options || options.history !== false) pushHistory(page);
    change(deck, page); page.updatedAt = new Date().toISOString(); scheduleSave(); if (rerender !== false) render();
  }
  function restoreHistory(from, to) {
    var page = pageFrom(workspace()); if (!page || !from.length) return false;
    var entry = from.pop(); if (!entry || entry.pageId !== page.id) return false;
    to.push(historySnapshot(page)); page.slides = cloneDeck(entry.deck); page.updatedAt = new Date().toISOString(); scheduleSave();
    var deck = ensureDeck(page); if (!deck.slides.some(function (slide) { return slide.id === activeSlideId; })) activeSlideId = deck.slides[0].id;
    selectedElementId = ''; render(); return true;
  }
  function slidesUndo() { if (!restoreHistory(undoStack, redoStack)) showToast('Nothing to undo in this deck.'); }
  function slidesRedo() { if (!restoreHistory(redoStack, undoStack)) showToast('Nothing to redo in this deck.'); }
  function selectedElement(deck) { var slide = activeSlide(deck); return slide && (slide.elements || []).find(function (element) { return element.id === selectedElementId; }) || null; }
  function updateSelectedElement(patch, options) { mutate(function (deck) { var element = selectedElement(deck); if (element) Object.assign(element, patch || {}); }, true, options); }
  function duplicateElement() { mutate(function (deck) { var slide = activeSlide(deck); var element = selectedElement(deck); if (!slide || !element) { showToast('Select a slide object first.'); return; } var copy = JSON.parse(JSON.stringify(element)); copy.id = id(); copy.x = Math.min(94 - Number(copy.width || 0), Number(copy.x || 0) + 3); copy.y = Math.min(94 - Number(copy.height || 0), Number(copy.y || 0) + 3); copy.zIndex = Math.max.apply(Math, slide.elements.map(function (item) { return Number(item.zIndex || 0); }).concat([0])) + 1; slide.elements.push(copy); selectedElementId = copy.id; }); }
  function deleteElement() { mutate(function (deck) { var slide = activeSlide(deck); if (!slide || !selectedElementId) { showToast('Select a slide object first.'); return; } slide.elements = slide.elements.filter(function (element) { return element.id !== selectedElementId; }); selectedElementId = ''; }); }
  function copyElement() { var page = pageFrom(workspace()); var deck = page && deckFor(page); var element = deck && selectedElement(deck); if (!element) { showToast('Select a slide object first.'); return false; } elementClipboard = JSON.parse(JSON.stringify(element)); showToast('Slide object copied'); return true; }
  function pasteElement() { if (!elementClipboard) { showToast('Slide clipboard is empty.'); return false; } mutate(function (deck) { var slide = activeSlide(deck); var copy = JSON.parse(JSON.stringify(elementClipboard)); copy.id = id(); copy.x = Math.min(94 - Number(copy.width || 0), Number(copy.x || 0) + 4); copy.y = Math.min(94 - Number(copy.height || 0), Number(copy.y || 0) + 4); copy.zIndex = Math.max.apply(Math, slide.elements.map(function (item) { return Number(item.zIndex || 0); }).concat([0])) + 1; slide.elements.push(copy); selectedElementId = copy.id; }); return true; }
  function shiftElementLayer(direction) { mutate(function (deck) { var slide = activeSlide(deck); var element = selectedElement(deck); if (!slide || !element) return; var ordered = slide.elements.slice().sort(function (a, b) { return Number(a.zIndex || 0) - Number(b.zIndex || 0); }); var index = ordered.indexOf(element); var target = Math.max(0, Math.min(ordered.length - 1, index + direction)); if (target === index) return; var moved = ordered.splice(index, 1)[0]; ordered.splice(target, 0, moved); ordered.forEach(function (item, i) { item.zIndex = i + 1; }); }); }
  function moveSlide(direction) { mutate(function (deck) { var current = activeSlide(deck); var index = deck.slides.indexOf(current); var target = Math.max(0, Math.min(deck.slides.length - 1, index + direction)); if (target === index) return; deck.slides.splice(index, 1); deck.slides.splice(target, 0, current); }); }
  function nudgeElement(dx, dy) { var page = pageFrom(workspace()); var deck = page && deckFor(page); var element = deck && selectedElement(deck); if (!element) return; updateSelectedElement({ x: Math.max(0, Math.min(100, Number(element.x || 0) + dx)), y: Math.max(0, Math.min(100, Number(element.y || 0) + dy)) }); }
  function beginElementDrag(event, element, mode) {
    var stage = root && root.querySelector('.slides-stage'); if (!stage) return;
    var rect = stage.getBoundingClientRect(); selectedElementId = element.id;
    dragState = { id: element.id, mode: mode, startX: event.clientX, startY: event.clientY, original: { x: Number(element.x || 0), y: Number(element.y || 0), width: Number(element.width || 1), height: Number(element.height || 1) }, rect: rect, changed: false, history: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* no-op */ }
  }
  function snapSlidePosition(value, size) { var bounded = Math.max(0, Math.min(100 - size, value)); var targets = [0, (100 - size) / 2, 100 - size]; var nearest = targets.reduce(function (best, target) { return Math.abs(target - bounded) < Math.abs(best - bounded) ? target : best; }, targets[0]); return Math.abs(nearest - bounded) <= 1.25 ? nearest : Math.round(bounded * 4) / 4; }
  function moveElementDrag(event) {
    if (!dragState) return; var page = pageFrom(workspace()); var deck = page && deckFor(page); var element = deck && selectedElement(deck); if (!element || element.id !== dragState.id) return;
    var dx = (event.clientX - dragState.startX) / Math.max(1, dragState.rect.width) * 100; var dy = (event.clientY - dragState.startY) / Math.max(1, dragState.rect.height) * 100;
    if (Math.abs(dx) + Math.abs(dy) < 0.1) return; if (!dragState.history) { pushHistory(page); dragState.history = true; } dragState.changed = true;
    if (dragState.mode === 'resize') { element.width = Math.max(4, Math.min(100 - dragState.original.x, dragState.original.width + dx)); element.height = Math.max(4, Math.min(100 - dragState.original.y, dragState.original.height + dy)); }
    else { element.x = snapSlidePosition(dragState.original.x + dx, dragState.original.width); element.y = snapSlidePosition(dragState.original.y + dy, dragState.original.height); }
    var node = root.querySelector('[data-slide-element-id="' + element.id + '"]'); if (node) { node.style.left = element.x + '%'; node.style.top = element.y + '%'; node.style.width = element.width + '%'; node.style.height = element.height + '%'; }
  }
  function endElementDrag() { if (!dragState) return; var changed = dragState.changed; dragState = null; if (changed) { var page = pageFrom(workspace()); if (page) { page.updatedAt = new Date().toISOString(); scheduleSave(); } } render(); }
  function renderElement(element, deck, options) {
    var readonly = options && options.readonly; var node = document.createElement('div'); node.className = 'slides-element slides-element-' + element.type + (element.id === selectedElementId && !readonly ? ' selected' : ''); node.dataset.slideElementId = element.id;
    node.style.cssText = 'left:' + element.x + '%;top:' + element.y + '%;width:' + element.width + '%;height:' + element.height + '%;font-size:' + (element.fontSize || 3) + 'cqw;color:' + (element.color || themes[deck.theme].ink) + ';background:' + (element.fill || 'transparent') + ';border:' + (element.borderWidth || 0) + 'px solid ' + (element.borderColor || '#d7d3c7') + ';z-index:' + (element.zIndex || 0) + ';';
    if (element.type === 'image') { var image = document.createElement('img'); image.src = element.dataUrl || ''; image.alt = element.alt || 'Slide image'; image.style.objectFit = element.imageFit || 'contain'; node.appendChild(image); }
    else if (element.type === 'chart') { var chart = document.createElement('div'); chart.className = 'slides-chart'; var values = element.chart && element.chart.values || [5, 8, 4]; var max = Math.max.apply(Math, values.concat([1])); values.forEach(function (value) { var bar = document.createElement('span'); bar.style.height = Math.max(6, value / max * 100) + '%'; chart.appendChild(bar); }); node.appendChild(chart); }
    else if (element.type === 'table') { var table = document.createElement('table'); var tableRows = Array.isArray(element.rows) && element.rows.length ? element.rows : String(element.text || '').split(/\r?\n/).map(function (line) { return line.split('\t'); }); tableRows.forEach(function (values, rowIndex) { var tr = document.createElement('tr'); values.forEach(function (value, colIndex) { var cell = document.createElement(rowIndex === 0 ? 'th' : 'td'); cell.textContent = value; cell.contentEditable = readonly ? 'false' : 'true'; if (!readonly) cell.addEventListener('input', function () { mutate(function (currentDeck) { var found = activeSlide(currentDeck).elements.find(function (item) { return item.id === element.id; }); if (!found) return; if (!Array.isArray(found.rows)) found.rows = tableRows.map(function (row) { return row.slice(); }); if (!Array.isArray(found.rows[rowIndex])) found.rows[rowIndex] = []; found.rows[rowIndex][colIndex] = cell.textContent.slice(0, 2000); found.text = found.rows.map(function (row) { return row.join('\t'); }).join('\n'); }, false, { history: false }); }); tr.appendChild(cell); }); table.appendChild(tr); }); node.appendChild(table); }
    else { var text = document.createElement('div'); text.className = 'slides-element-text'; text.style.textAlign = element.textAlign || 'left'; text.contentEditable = readonly ? 'false' : 'true'; text.textContent = element.text || (element.type === 'shape' ? 'Shape' : 'Add text'); if (!readonly) text.addEventListener('input', function () { mutate(function (currentDeck) { var found = activeSlide(currentDeck).elements.find(function (item) { return item.id === element.id; }); if (found) found.text = text.textContent.slice(0, 8000); }, false, { history: false }); }); node.appendChild(text); }
    if (!readonly) { var resize = document.createElement('button'); resize.type = 'button'; resize.className = 'slides-element-resize'; resize.setAttribute('aria-label', 'Resize selected object'); node.appendChild(resize); node.addEventListener('pointerdown', function (event) { if (event.target.isContentEditable) return; event.preventDefault(); beginElementDrag(event, element, event.target.closest('.slides-element-resize') ? 'resize' : 'move'); node.classList.add('selected'); }); node.addEventListener('pointermove', moveElementDrag); node.addEventListener('pointerup', endElementDrag); node.addEventListener('pointercancel', endElementDrag); }
    return node;
  }
  function syncElementInspector(deck) {
    var panel = root.querySelector('[data-element-inspector]'); var element = selectedElement(deck); if (!panel) return; panel.hidden = !element; if (!element) return;
    panel.querySelector('[data-element-name]').textContent = element.type === 'image' ? (element.alt || 'Image') : (element.text || element.type);
    panel.querySelector('[data-element-font]').value = Math.max(1, Math.min(10, Number(element.fontSize || 3)));
    panel.querySelector('[data-element-bold]').checked = element.fontWeight === 'bold';
    panel.querySelector('[data-element-align]').value = element.textAlign || 'left';
    panel.querySelector('[data-element-fit]').value = element.imageFit || 'contain';
    panel.querySelector('[data-element-fit]').closest('label').hidden = element.type !== 'image';
    panel.querySelector('[data-element-fill]').value = /^#[0-9a-f]{6}$/i.test(element.fill || '') ? element.fill : '#ffffff';
    panel.querySelector('[data-element-color]').value = /^#[0-9a-f]{6}$/i.test(element.color || '') ? element.color : '#173d2b';
  }
  function alignElement(position) { mutate(function (deck) { var element = selectedElement(deck); if (!element) { showToast('Select a slide object first.'); return; } if (position === 'left') element.x = 0; if (position === 'center') element.x = Math.max(0, (100 - element.width) / 2); if (position === 'right') element.x = Math.max(0, 100 - element.width); if (position === 'top') element.y = 0; if (position === 'middle') element.y = Math.max(0, (100 - element.height) / 2); if (position === 'bottom') element.y = Math.max(0, 100 - element.height); }); }
  function render() {
    if (!root || !activePageId) return; var data = workspace(); var page = pageFrom(data); var deck = page && deckFor(page); if (!deck) { setEditorVisible(false); return; }
    if (!activeSlideId || !deck.slides.some(function (slide) { return slide.id === activeSlideId; })) activeSlideId = deck.slides[0].id;
    var slide = activeSlide(deck); var theme = themes[deck.theme] || themes.sutra; setEditorVisible(true); root.dataset.size = deck.size; root.querySelector('[data-theme]').value = deck.theme; root.querySelector('[data-layout]').value = slide.layout || 'blank'; root.querySelector('[data-size]').value = deck.size || 'widescreen'; root.querySelector('[data-slide-background]').value = /^#[0-9a-f]{6}$/i.test(slide.background || '') ? slide.background : theme.bg; root.querySelector('[data-count]').textContent = (deck.slides.indexOf(slide) + 1) + ' of ' + deck.slides.length + ' slides';
    var list = root.querySelector('.slides-thumbnail-list'); list.replaceChildren(); deck.slides.forEach(function (item, index) { var thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'slides-thumbnail' + (item.id === slide.id ? ' active' : ''); thumb.textContent = (index + 1) + '  ' + (item.title || item.elements[0] && item.elements[0].text || 'Untitled slide'); thumb.addEventListener('click', function () { activeSlideId = item.id; selectedElementId = ''; render(); }); list.appendChild(thumb); });
    var stage = root.querySelector('.slides-stage'); stage.replaceChildren(); stage.style.background = slide.background || theme.bg; stage.style.color = theme.ink; stage.setAttribute('aria-label', 'Editable slide ' + (deck.slides.indexOf(slide) + 1) + ' of ' + deck.slides.length); slide.elements.slice().sort(function (a, b) { return (a.zIndex || 0) - (b.zIndex || 0); }).forEach(function (element) { stage.appendChild(renderElement(element, deck)); }); stage.onclick = function (event) { if (event.target === stage) { selectedElementId = ''; render(); } };
    root.querySelector('.slides-notes-panel textarea').value = slide.speakerNotes || ''; syncElementInspector(deck);
  }
  function present() {
    var data = workspace(); var page = pageFrom(data); var deck = page && deckFor(page); if (!deck) return; var overlay = document.createElement('div'); overlay.className = 'slides-present-overlay'; var stage = document.createElement('div'); stage.className = 'slides-present-stage'; stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', 'Presentation slide'); var notes = document.createElement('aside'); notes.className = 'slides-present-notes'; var close = document.createElement('button'); close.type = 'button'; close.textContent = 'Exit presentation'; overlay.append(stage, notes, close); document.body.appendChild(overlay); var index = deck.slides.indexOf(activeSlide(deck)); var showNotes = true;
    function draw() { var slide = deck.slides[index]; stage.replaceChildren(); stage.style.background = slide.background || (themes[deck.theme] || themes.sutra).bg; stage.style.color = (themes[deck.theme] || themes.sutra).ink; slide.elements.forEach(function (element) { stage.appendChild(renderElement(Object.assign({}, element), deck, { readonly: true })); }); notes.hidden = !showNotes; notes.textContent = slide.speakerNotes || 'No speaker notes for this slide.'; }
    function key(event) { if (event.key === 'Escape') close.click(); if ((event.key === 'ArrowRight' || event.key === ' ') && index < deck.slides.length - 1) { index++; draw(); event.preventDefault(); } if (event.key === 'ArrowLeft' && index > 0) { index--; draw(); event.preventDefault(); } if (String(event.key || '').toLowerCase() === 'n') { showNotes = !showNotes; draw(); } }
    close.onclick = function () { document.removeEventListener('keydown', key, true); overlay.remove(); }; document.addEventListener('keydown', key, true); draw(); close.focus();
  }
  function mount() {
    if (root) return root;
    root = document.createElement('section'); root.id = 'slidesEditor'; root.className = 'slides-editor'; root.hidden = true; root.setAttribute('inert', ''); root.setAttribute('aria-hidden', 'true'); root.setAttribute('aria-label', 'Slides editor');
    root.innerHTML = '<div class="slides-mode-tabs" role="tablist" aria-label="Create mode"><span>Notepad</span><span>Canvas</span><strong aria-selected="true">Slides</strong></div><div class="slides-toolbar" role="toolbar"><div class="slides-toolbar-main"></div><div class="slides-toolbar-end"></div></div><div class="slides-workspace"><aside class="slides-thumbnails" aria-label="Slides"><div class="slides-thumbnail-list"></div><button type="button" class="slides-add-thumbnail" aria-label="Add slide"><i class="fas fa-plus" aria-hidden="true"></i></button></aside><main class="slides-center"><div class="slides-stage" tabindex="0" aria-label="Editable current slide"></div><section class="slides-notes-panel"><label><i class="fas fa-note-sticky" aria-hidden="true"></i> Speaker notes</label><textarea aria-label="Speaker notes"></textarea></section></main><aside class="slides-inspector"><h3>Design</h3><label>Theme<select data-theme><option value="sutra">Sutra</option><option value="nature">Sutra Nature</option><option value="midnight">Midnight</option><option value="paper">Paper</option></select></label><label>Layout<select data-layout><option value="title">Title</option><option value="title-body">Title &amp; body</option><option value="two-column">Two column</option><option value="three-card">Title &amp; three cards</option><option value="image-caption">Image &amp; caption</option><option value="blank">Blank</option></select></label><label>Slide size<select data-size><option value="widescreen">16:9 (Widescreen)</option><option value="standard">4:3 (Standard)</option></select></label><label>Background<input type="color" data-slide-background></label><label class="slides-toggle"><input type="checkbox" data-notes checked> Show speaker notes</label><section class="slides-element-inspector" data-element-inspector hidden><h3>Selected object</h3><p data-element-name></p><label>Text size<input type="range" min="1" max="10" step=".5" data-element-font></label><label class="slides-toggle"><input type="checkbox" data-element-bold> Bold text</label><label>Text alignment<select data-element-align><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Image fit<select data-element-fit><option value="contain">Fit</option><option value="cover">Crop to fill</option></select></label><label>Text color<input type="color" data-element-color></label><label>Fill color<input type="color" data-element-fill></label><div class="slides-inspector-grid"><button type="button" data-element-back>Send back</button><button type="button" data-element-forward>Bring forward</button><button type="button" data-element-copy>Copy object</button><button type="button" data-element-duplicate>Duplicate object</button><button type="button" data-element-delete>Delete object</button></div></section><button type="button" data-export-pdf>Print / PDF</button><button type="button" data-import-pptx>Import PPTX</button><button type="button" data-export-pptx>Export PPTX</button><input type="file" data-import-pptx-file accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden></aside></div><div class="slides-status"><span data-count></span><span>Saved locally</span><button type="button" data-present><i class="fas fa-play" aria-hidden="true"></i> Present</button></div>'; // sutra-allow-html: reviewed static Slides workbench chrome; deck content is assigned with textContent.
    var container = document.getElementById('notesPrimaryPane'); if (container) container.appendChild(root);
    var toolbar = root.querySelector('.slides-toolbar-main'); toolbar.append(button('New Slide', 'fa-plus', function () { mutate(function (deck) { var next = makeSlide('title-body', 'New slide'); deck.slides.push(next); activeSlideId = next.id; }); })); toolbar.append(button('Undo', 'fa-undo', slidesUndo)); toolbar.append(button('Redo', 'fa-redo', slidesRedo)); toolbar.append(button('Text', 'fa-font', function () { addElement('text'); })); toolbar.append(button('Shape', 'fa-shapes', function () { addElement('shape'); })); toolbar.append(button('Image', 'fa-image', chooseImage)); toolbar.append(button('Table', 'fa-table', function () { addElement('table'); })); toolbar.append(button('Chart', 'fa-chart-bar', function () { addElement('chart'); }));
    var end = root.querySelector('.slides-toolbar-end'); end.append(button('Slide up', 'fa-arrow-up', function () { moveSlide(-1); })); end.append(button('Slide down', 'fa-arrow-down', function () { moveSlide(1); })); end.append(button('Duplicate', 'fa-copy', duplicateSlide)); end.append(button('Delete', 'fa-trash', deleteSlide)); end.append(button('Present', 'fa-play', present));
    root.querySelector('.slides-add-thumbnail').addEventListener('click', function () { mutate(function (deck) { var next = makeSlide('title-body', 'New slide'); deck.slides.push(next); activeSlideId = next.id; }); }); root.querySelector('[data-theme]').addEventListener('change', function (event) { mutate(function (deck) { deck.theme = event.target.value; }); }); root.querySelector('[data-layout]').addEventListener('change', function (event) { mutate(function (deck) { var slide = activeSlide(deck); var replacement = makeSlide(event.target.value, slide.title || 'Slide'); replacement.id = slide.id; replacement.speakerNotes = slide.speakerNotes; var i = deck.slides.indexOf(slide); deck.slides[i] = replacement; }); }); root.querySelector('[data-size]').addEventListener('change', function (event) { mutate(function (deck) { deck.size = event.target.value; }); }); root.querySelector('[data-slide-background]').addEventListener('input', function (event) { mutate(function (deck) { activeSlide(deck).background = event.target.value; }, true, { history: false }); }); root.querySelector('[data-notes]').addEventListener('change', function (event) { root.querySelector('.slides-notes-panel').hidden = !event.target.checked; }); root.querySelector('.slides-notes-panel textarea').addEventListener('input', function (event) { mutate(function (deck) { activeSlide(deck).speakerNotes = event.target.value.slice(0, 20000); }, false, { history: false }); }); root.querySelector('[data-present]').addEventListener('click', present); root.querySelector('[data-export-pdf]').addEventListener('click', printPdf); root.querySelector('[data-import-pptx]').addEventListener('click', function () { root.querySelector('[data-import-pptx-file]').click(); }); root.querySelector('[data-import-pptx-file]').addEventListener('change', function (event) { importPptx(event.target.files && event.target.files[0]); event.target.value = ''; }); root.querySelector('[data-export-pptx]').addEventListener('click', exportPptx);
    root.querySelector('[data-element-font]').addEventListener('input', function (event) { updateSelectedElement({ fontSize: Number(event.target.value) }, { history: false }); }); root.querySelector('[data-element-bold]').addEventListener('change', function (event) { updateSelectedElement({ fontWeight: event.target.checked ? 'bold' : 'normal' }); }); root.querySelector('[data-element-color]').addEventListener('input', function (event) { updateSelectedElement({ color: event.target.value }, { history: false }); }); root.querySelector('[data-element-fill]').addEventListener('input', function (event) { updateSelectedElement({ fill: event.target.value }, { history: false }); }); root.querySelector('[data-element-back]').addEventListener('click', function () { shiftElementLayer(-1); }); root.querySelector('[data-element-forward]').addEventListener('click', function () { shiftElementLayer(1); }); root.querySelector('[data-element-copy]').addEventListener('click', copyElement); root.querySelector('[data-element-duplicate]').addEventListener('click', duplicateElement); root.querySelector('[data-element-delete]').addEventListener('click', deleteElement);
    root.querySelector('[data-element-align]').addEventListener('change', function (event) { updateSelectedElement({ textAlign: event.target.value }); }); root.querySelector('[data-element-fit]').addEventListener('change', function (event) { updateSelectedElement({ imageFit: event.target.value }); });
    var alignGrid = root.querySelector('.slides-inspector-grid'); [['Align left', 'left'], ['Center horizontally', 'center'], ['Align right', 'right'], ['Align top', 'top'], ['Center vertically', 'middle'], ['Align bottom', 'bottom']].forEach(function (item) { var alignButton = document.createElement('button'); alignButton.type = 'button'; alignButton.textContent = item[0]; alignButton.addEventListener('click', function () { alignElement(item[1]); }); alignGrid.appendChild(alignButton); });
    root.addEventListener('keydown', function (event) { var target = event.target; if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return; var command = event.ctrlKey || event.metaKey; var key = String(event.key || '').toLowerCase(); if (command && key === 'z' && !event.shiftKey) { event.preventDefault(); slidesUndo(); } else if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); slidesRedo(); } else if (command && key === 'c') { event.preventDefault(); copyElement(); } else if (command && key === 'v') { event.preventDefault(); pasteElement(); } else if (command && key === 'd') { event.preventDefault(); duplicateElement(); } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteElement(); } else if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeElement(event.shiftKey ? -2 : -0.5, 0); } else if (event.key === 'ArrowRight') { event.preventDefault(); nudgeElement(event.shiftKey ? 2 : 0.5, 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); nudgeElement(0, event.shiftKey ? -2 : -0.5); } else if (event.key === 'ArrowDown') { event.preventDefault(); nudgeElement(0, event.shiftKey ? 2 : 0.5); } else if (event.key === 'PageUp') { event.preventDefault(); moveSlide(-1); } else if (event.key === 'PageDown') { event.preventDefault(); moveSlide(1); } });
    return root;
  }
  // Lifecycle (audit remediation): refresh on the canonical note-page signal
  // that the core now actually dispatches from loadPage()/imports, plus the
  // cross-tab commit notice — no polling interval.
  global.addEventListener('sutra:note-page-loaded', refresh);
  global.addEventListener('sutra:workspace-remote-commit', refresh);
  global.SutraSlides = { createPage: createPage, createFromNewPageDialog: createFromNewPageDialog, getCurrentPage: function () { return pageFrom(workspace()); }, getContext: getContext, addSlide: function () { mutate(function (deck) { var slide = makeSlide('title-body', 'New slide'); deck.slides.push(slide); activeSlideId = slide.id; }); }, undo: slidesUndo, redo: slidesRedo, duplicateSelectedElement: duplicateElement, deleteSelectedElement: deleteElement, copySelectedElement: copyElement, pasteElement: pasteElement, moveSlide: moveSlide, validateAssistantOperations: validateAssistantOperations, createAssistantDeck: createAssistantDeck, applyAssistantOperations: applyAssistantOperations, undoAssistantMutation: undoAssistantMutation, present: present, exportPdf: printPdf, exportPptx: exportPptx, importPptx: importPptx, normalizeDeck: normalizeDeck };
}(window));