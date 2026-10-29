/*
 * Sutra Notes Editor v2 — TipTap/ProseMirror integration glue.
 *
 * The engine itself is the vendored bundle assets/vendor/editor/sutra-editor.min.js
 * (window.SutraEditor). This module adapts it to Sutra's notes pipeline:
 *
 *  - The document model (ProseMirror schema) is the source of truth while
 *    editing; invalid states (double list markers, phantom <li>, dirty paste)
 *    cannot be produced.
 *  - page.content stays the SAME sanitized-HTML storage format as the classic
 *    editor: on every change v2 serializes back to storage form and mirrors it
 *    into the hidden legacy #editor element, so every existing save / export /
 *    version-history / assistant path keeps reading the DOM it always read.
 *  - HTML embeds and drawings use live NodeViews backed by page.blocks while
 *    serializing to their original positional anchors. Other media and widgets
 *    retain their compatible preserved-node representation.
 *  - Legacy checklists (<div class="checklist-item">) convert to real TipTap
 *    task items on the way in and BACK to the legacy markup on the way out,
 *    so storage format never forks.
 *
 * app.js talks to this module only through window.SutraNotesEditorV2 and
 * always behind typeof guards; if the vendor bundle is missing the classic
 * editor keeps working untouched.
 */
(function () {
    'use strict';

    if (window.SutraNotesEditorV2) return;

    function createEditorInstance() {
    var state = {
        editor: null,        // TipTap Editor instance
        hostEl: null,        // element the editor is mounted into
        mirrorEl: null,      // hidden legacy #editor kept in sync for save paths
        callbacks: {},       // { onUserEdit, onSelectionChange }
        placeholder: '',     // retained when a page load rebuilds the editor
        applyingExternal: 0, // >0 while setContent runs (suppresses onUpdate)
        mirrorTimer: null,
        selectionTimer: null,
        extensionsCache: null,
        blockBridge: null
    };

    var MIRROR_DEBOUNCE_MS = 150;

    function engine() {
        return window.SutraEditor || null;
    }

    function isAvailable() {
        var eng = engine();
        return !!(eng && typeof eng.create === 'function');
    }

    function isMounted() {
        return !!state.editor;
    }

    /* ------------------------------------------------------------------
     * HTML helpers (single annotated trusted sink; input is either the
     * already-sanitized stored note HTML or TipTap's own serialized output)
     * ---------------------------------------------------------------- */
    function parseHtmlToTemplate(html) {
        var tpl = document.createElement('template');
        if (window.SutraDOMSafety && typeof window.SutraDOMSafety.setTrustedHTML === 'function') {
            window.SutraDOMSafety.setTrustedHTML(tpl, String(html == null ? '' : html));
        } else {
            tpl.innerHTML = String(html == null ? '' : html); // sutra-allow-html: parsing already-sanitized editor content into a detached template
        }
        return tpl;
    }

    function writeTrustedHtml(el, html) {
        if (!el) return;
        if (window.SutraDOMSafety && typeof window.SutraDOMSafety.setTrustedHTML === 'function') {
            window.SutraDOMSafety.setTrustedHTML(el, String(html == null ? '' : html));
        } else {
            el.innerHTML = String(html == null ? '' : html); // sutra-allow-html: mirroring TipTap-serialized storage HTML into the hidden legacy editor buffer
        }
    }

    /* ------------------------------------------------------------------
     * Legacy HTML <-> v2 transforms (storage format stays legacy-compatible)
     * ---------------------------------------------------------------- */

    // Consecutive <div class="checklist-item"><input …><span>…</span></div>
    // runs become one taskList so they parse into real TipTap task items.
    function convertLegacyChecklistsIn(root) {
        var items = Array.prototype.slice.call(root.querySelectorAll('div.checklist-item'));
        if (!items.length) return;
        items.forEach(function (item) {
            if (!item.parentNode) return; // already consumed by an earlier run
            var run = [item];
            var next = item.nextElementSibling;
            while (next && next.classList && next.classList.contains('checklist-item')) {
                run.push(next);
                next = next.nextElementSibling;
            }
            var list = document.createElement('ul');
            list.setAttribute('data-type', 'taskList');
            item.parentNode.insertBefore(list, item);
            run.forEach(function (entry) {
                var li = document.createElement('li');
                li.setAttribute('data-type', 'taskItem');
                var checkbox = entry.querySelector('input[type="checkbox"]');
                li.setAttribute('data-checked', checkbox && checkbox.checked ? 'true' : 'false');
                var label = entry.querySelector('span');
                var p = document.createElement('p');
                if (label) {
                    while (label.firstChild) p.appendChild(label.firstChild);
                } else {
                    p.textContent = entry.textContent || '';
                }
                li.appendChild(p);
                list.appendChild(li);
                entry.parentNode.removeChild(entry);
            });
        });
    }

    // execCommand-era <font color="…" size="…"> → styled spans so the Color /
    // TextStyle marks pick the formatting up instead of dropping it.
    var LEGACY_FONT_SIZE_MAP = { 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };
    function convertLegacyFontTagsIn(root) {
        var fonts = Array.prototype.slice.call(root.querySelectorAll('font'));
        fonts.forEach(function (font) {
            var span = document.createElement('span');
            var css = '';
            var color = font.getAttribute('color');
            var face = font.getAttribute('face');
            var size = font.getAttribute('size');
            if (color) css += 'color:' + color + ';';
            if (face) css += 'font-family:' + face + ';';
            if (size && LEGACY_FONT_SIZE_MAP[size]) css += 'font-size:' + LEGACY_FONT_SIZE_MAP[size] + ';';
            if (css) span.setAttribute('style', css);
            while (font.firstChild) span.appendChild(font.firstChild);
            font.parentNode.replaceChild(span, font);
        });
    }

    // Storage/paste HTML → HTML the v2 schema understands losslessly.
    function normalizeLegacyHtml(html) {
        var tpl = parseHtmlToTemplate(html);
        var root = tpl.content;
        convertLegacyChecklistsIn(root);
        convertLegacyFontTagsIn(root);
        var out = document.createElement('div');
        out.appendChild(root.cloneNode(true));
        return out.innerHTML;
    }

    // TipTap task lists → legacy checklist markup so page.content keeps the
    // exact format the classic editor / exports / LMS import already speak.
    function convertTaskListsToLegacy(root) {
        var lists = Array.prototype.slice.call(root.querySelectorAll('ul[data-type="taskList"]'));
        // Deepest-first so nested task lists resolve before their parents.
        lists.reverse().forEach(function (list) {
            var frag = document.createDocumentFragment();
            Array.prototype.slice.call(list.children).forEach(function (li) {
                if (!li.matches || !li.matches('li[data-type="taskItem"]')) return;
                var item = document.createElement('div');
                item.className = 'checklist-item';
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                if (li.getAttribute('data-checked') === 'true') checkbox.setAttribute('checked', '');
                var span = document.createElement('span');
                span.setAttribute('contenteditable', 'true');
                // TipTap renders <li><label><input><span></span></label><div><p>text</p></div></li>
                var content = li.querySelector(':scope > div');
                var nestedLegacyItems = [];
                if (content) {
                    var paragraphs = Array.prototype.slice.call(content.children).filter(function (child) {
                        if (child.classList && child.classList.contains('checklist-item')) {
                            nestedLegacyItems.push(child);
                            return false;
                        }
                        return true;
                    });
                    paragraphs.forEach(function (para, index) {
                        if (index > 0) span.appendChild(document.createElement('br'));
                        while (para.firstChild) span.appendChild(para.firstChild);
                    });
                    if (!paragraphs.length) span.textContent = content.textContent || '';
                } else {
                    span.textContent = li.textContent || '';
                }
                item.appendChild(checkbox);
                item.appendChild(span);
                frag.appendChild(item);
                nestedLegacyItems.forEach(function (nestedItem) {
                    frag.appendChild(nestedItem);
                });
            });
            list.parentNode.replaceChild(frag, list);
        });
    }

    /* ------------------------------------------------------------------
     * Preserved Sutra components — verbatim atom nodes
     * ---------------------------------------------------------------- */
    var PRESERVED_BLOCK_SELECTORS = [
        // Structured embeds and drawings have dedicated live nodes below.
        // Widget/media wrappers and other non-editable components.
        'div.media-wrapper',
        'div.atelier-page-break',
        'div[contenteditable="false"]',
        'iframe', 'video', 'audio', 'canvas', 'form', 'details'
    ];

    var PRESERVED_INLINE_SELECTORS = [
        'span.sutra-math-block[data-latex]',
        'span[data-countdown]',
        'span[contenteditable="false"]'
    ];

    // Render KaTeX into a stored math span for live display. This only touches
    // the on-screen NodeView DOM — the node's `html` attribute (and therefore
    // getStorageHtml / the byte-compatible round-trip) is never modified.
    function renderMathInto(el) {
        if (!el || !el.getAttribute) return;
        var mathEl = el.matches && el.matches('.sutra-math-block[data-latex]') ? el
            : (el.querySelector ? el.querySelector('.sutra-math-block[data-latex]') : null);
        if (!mathEl) return;
        var latex = mathEl.getAttribute('data-latex') || '';
        var doRender = function () {
            try {
                if (window.SutraMath && typeof window.SutraMath.renderToHtml === 'function') {
                    var html = window.SutraMath.renderToHtml(latex, /\n|\\\\|\\begin/.test(latex));
                    if (html) writeTrustedHtml(mathEl, html);
                }
            } catch (e) { /* non-critical */ }
        };
        if (window.SutraMath && typeof window.SutraMath.ensure === 'function') {
            window.SutraMath.ensure().then(doRender).catch(doRender);
        } else {
            doRender();
        }
    }

    var INTERACTIVE_MEDIA_TAGS = { VIDEO: 1, AUDIO: 1, IFRAME: 1, CANVAS: 1, DETAILS: 1, SUMMARY: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1 };
    function isInteractiveTarget(target) {
        var node = target;
        while (node && node.nodeType === 1) {
            if (INTERACTIVE_MEDIA_TAGS[node.tagName]) return true;
            node = node.parentNode;
        }
        return false;
    }

    function preservedElementFromAttrs(html, inline) {
        var tpl = parseHtmlToTemplate(html || '');
        var el = tpl.content.firstElementChild;
        if (el) return el.cloneNode(true);
        var fallback = document.createElement(inline ? 'span' : 'div');
        fallback.setAttribute('data-sutra-preserved-empty', 'true');
        return fallback;
    }

    function buildStructuredNodes(eng) {
        return [
            { name: 'sutraHtmlEmbed', type: 'htmlEmbed', kind: 'html-embed', selectors: ['div.html-embed-anchor[data-block-id]', 'div.html-embed-block[data-block-id]', 'div[data-note-block-type="html-embed"][data-block-id]'] },
            { name: 'sutraDrawing', type: 'drawing', kind: 'drawing', selectors: ['div.drawing-anchor[data-block-id]', 'div.drawing-block[data-block-id]', 'div[data-note-block-type="drawing"][data-block-id]'] }
        ].map(function (definition) {
            return eng.Node.create({
                name: definition.name,
                group: 'block',
                atom: true,
                selectable: true,
                draggable: true,
                addAttributes: function () { return { id: { default: '' }, payload: { default: null } }; },
                parseHTML: function () {
                    return definition.selectors.map(function (selector) {
                        return { tag: selector, priority: 1100, getAttrs: function (dom) {
                            var id = dom.getAttribute('data-block-id') || '';
                            var bridge = state.blockBridge;
                            return { id: id, payload: bridge && bridge.getBlock ? bridge.getBlock(definition.type, id) : null };
                        } };
                    });
                },
                renderHTML: function (props) {
                    var anchor = document.createElement('div');
                    anchor.className = definition.kind + '-anchor';
                    anchor.setAttribute('data-note-block-type', definition.kind);
                    anchor.setAttribute('data-block-id', props.node.attrs.id || '');
                    anchor.setAttribute('contenteditable', 'false');
                    return anchor;
                },
                addNodeView: function () {
                    return function (props) {
                        var node = props.node;
                        var root = document.createElement('div');
                        root.className = 'editor-v2-structured-block';
                        var ownChange = false;
                        var view = null;
                        function updatePayload(payload) {
                            if (!state.editor || typeof props.getPos !== 'function') return;
                            var pos = props.getPos();
                            if (typeof pos !== 'number') return;
                            ownChange = true;
                            var tr = state.editor.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { payload: payload }));
                            state.editor.view.dispatch(tr);
                        }
                        function removeNode() {
                            if (!state.editor || typeof props.getPos !== 'function') return;
                            var pos = props.getPos();
                            if (typeof pos !== 'number') return;
                            state.editor.view.dispatch(state.editor.state.tr.delete(pos, pos + node.nodeSize));
                        }
                        function render() {
                            var bridge = state.blockBridge;
                            if (view && view.dispose) view.dispose();
                            view = bridge && bridge.createView ? bridge.createView(definition.type, node.attrs.id, node.attrs.payload, updatePayload, removeNode) : null;
                            root.replaceChildren(view && view.dom ? view.dom : document.createTextNode(definition.type === 'drawing' ? 'Handwriting block unavailable' : 'HTML embed unavailable'));
                        }
                        render();
                        return {
                            dom: root,
                            update: function (next) {
                                if (next.type !== node.type || next.attrs.id !== node.attrs.id) return false;
                                var previousPayload = node.attrs.payload;
                                node = next;
                                if (previousPayload !== next.attrs.payload && (!ownChange || definition.type === 'htmlEmbed')) render();
                                ownChange = false;
                                return true;
                            },
                            stopEvent: function (event) { return !!(event.target && event.target.closest && event.target.closest('.html-embed-block, .drawing-block')); },
                            ignoreMutation: function () { return true; },
                            destroy: function () { if (view && view.dispose) view.dispose(); }
                        };
                    };
                }
            });
        });
    }

    function buildPreservedNodes(eng) {
        var PreservedBlock = eng.Node.create({
            name: 'sutraPreservedBlock',
            group: 'block',
            atom: true,
            selectable: true,
            draggable: true,
            addAttributes: function () {
                return { html: { default: '' } };
            },
            parseHTML: function () {
                return PRESERVED_BLOCK_SELECTORS.map(function (selector) {
                    return {
                        tag: selector,
                        priority: 1000,
                        getAttrs: function (dom) {
                            return { html: dom.outerHTML };
                        }
                    };
                });
            },
            // renderHTML stays byte-identical (used by getStorageHtml) — the
            // NodeView below only changes the on-screen presentation.
            renderHTML: function (props) {
                return preservedElementFromAttrs(props.node.attrs.html, false);
            },
            addNodeView: function () {
                return function (props) {
                    var dom = preservedElementFromAttrs(props.node.attrs.html, false);
                    renderMathInto(dom);
                    return {
                        dom: dom,
                        // The rendered media/embeds live inside an atom; keep PM
                        // from treating in-element clicks as node drags/selection
                        // so videos, audio and iframes stay interactive.
                        stopEvent: function (event) { return isInteractiveTarget(event.target); },
                        ignoreMutation: function () { return true; }
                    };
                };
            }
        });

        var PreservedInline = eng.Node.create({
            name: 'sutraPreservedInline',
            group: 'inline',
            inline: true,
            atom: true,
            selectable: true,
            addAttributes: function () {
                return { html: { default: '' } };
            },
            parseHTML: function () {
                return PRESERVED_INLINE_SELECTORS.map(function (selector) {
                    return {
                        tag: selector,
                        priority: 1000,
                        getAttrs: function (dom) {
                            return { html: dom.outerHTML };
                        }
                    };
                });
            },
            renderHTML: function (props) {
                return preservedElementFromAttrs(props.node.attrs.html, true);
            },
            addNodeView: function () {
                return function (props) {
                    var dom = preservedElementFromAttrs(props.node.attrs.html, true);
                    renderMathInto(dom);
                    return {
                        dom: dom,
                        ignoreMutation: function () { return true; }
                    };
                };
            }
        });

        return [PreservedBlock, PreservedInline];
    }

    /* ------------------------------------------------------------------
     * Mount / unmount / content flow
     * ---------------------------------------------------------------- */
    function scheduleMirrorFlush() {
        if (state.mirrorTimer) clearTimeout(state.mirrorTimer);
        state.mirrorTimer = setTimeout(function () {
            state.mirrorTimer = null;
            flushToMirror();
            if (typeof state.callbacks.onUserEdit === 'function') {
                try { state.callbacks.onUserEdit(); } catch (e) { /* non-critical */ }
            }
        }, MIRROR_DEBOUNCE_MS);
    }

    // Page switches and Split View teardown are document boundaries. Complete
    // the pending edit against the old page before its context changes.
    function flushPendingEdit() {
        if (!state.editor || !state.mirrorTimer) return false;
        clearTimeout(state.mirrorTimer);
        state.mirrorTimer = null;
        flushToMirror();
        if (typeof state.callbacks.onUserEdit === 'function') state.callbacks.onUserEdit();
        return true;
    }

    function getStructuredBlocks() {
        var blocks = [];
        if (!state.editor) return blocks;
        state.editor.state.doc.descendants(function (node) {
            if (node.type.name !== 'sutraHtmlEmbed' && node.type.name !== 'sutraDrawing') return;
            blocks.push({ type: node.type.name === 'sutraHtmlEmbed' ? 'htmlEmbed' : 'drawing', id: node.attrs.id, payload: node.attrs.payload });
        });
        return blocks;
    }

    function normalizeStructuredIds() {
        if (!state.editor || !state.blockBridge || !state.blockBridge.newId) return false;
        var seen = Object.create(null);
        var tr = state.editor.state.tr;
        state.editor.state.doc.descendants(function (node, pos) {
            if (node.type.name !== 'sutraHtmlEmbed' && node.type.name !== 'sutraDrawing') return;
            var id = String(node.attrs.id || '');
            if (id && !seen[id]) { seen[id] = true; return; }
            var type = node.type.name === 'sutraHtmlEmbed' ? 'htmlEmbed' : 'drawing';
            var nextId = state.blockBridge.newId(type);
            var payload = Object.assign({}, node.attrs.payload || {}, { id: nextId });
            tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { id: nextId, payload: payload }));
            seen[nextId] = true;
        });
        if (!tr.docChanged) return false;
        tr.setMeta('addToHistory', false);
        state.editor.view.dispatch(tr);
        return true;
    }

    function mount(options) {
        options = options || {};
        if (!isAvailable()) return false;
        if (state.editor) destroy();
        var host = options.host;
        if (!host) return false;

        state.hostEl = host;
        state.mirrorEl = options.mirror || null;
        state.blockBridge = options.blockBridge || null;
        state.callbacks = {
            onUserEdit: options.onUserEdit,
            onSelectionChange: options.onSelectionChange
        };
        state.placeholder = options.placeholder || 'Start writing\u2026';

        var eng = engine();
        try {
            state.editor = eng.create(host, {
                placeholder: state.placeholder,
                content: Object.prototype.hasOwnProperty.call(options, 'content')
                    ? normalizeLegacyHtml(options.content || '')
                    : '',
                extraExtensions: buildStructuredNodes(eng).concat(buildPreservedNodes(eng)),
                editorProps: {
                    transformPastedHTML: stripForeignPasteStyles,
                    handlePaste: handleImagePaste,
                    handleDrop: handleImageDrop,
                    handleDOMEvents: { contextmenu: handleTableContextMenu }
                },
                onUpdate: function () {
                    if (state.applyingExternal > 0) return;
                    if (normalizeStructuredIds()) return;
                    polishPreservedCards();
                    scheduleSelectionState();
                    scheduleMirrorFlush();
                },
                onSelectionUpdate: function () {
                    scheduleSelectionState();
                },
                onTransaction: function () {
                    scheduleSelectionState();
                },
                onFocus: function () {
                    scheduleSelectionState();
                },
                onBlur: function () {
                    scheduleSelectionState();
                },
                onCreate: function () {
                    polishPreservedCards();
                    scheduleSelectionState();
                }
            });
        } catch (err) {
            if (typeof window.SutraReportError === 'function') {
                try { window.SutraReportError('notes-editor-v2 mount failed', err); } catch (e) { /* noop */ }
            }
            state.editor = null;
            return false;
        }
        polishPreservedCards();
        scheduleSelectionState();
        attachContextualListeners();
        return true;
    }

    function destroy() {
        detachContextualListeners();
        if (state.mirrorTimer) {
            clearTimeout(state.mirrorTimer);
            state.mirrorTimer = null;
        }
        if (state.selectionTimer) {
            try { (window.cancelAnimationFrame || clearTimeout)(state.selectionTimer); } catch (e) { /* non-critical */ }
            state.selectionTimer = null;
        }
        if (state.editor) {
            try { state.editor.destroy(); } catch (e) { /* non-critical */ }
        }
        state.editor = null;
        state.hostEl = null;
        state.mirrorEl = null;
        state.blockBridge = null;
        state.callbacks = {};
        state.placeholder = '';
    }

    // Load storage-format HTML (already sanitized by app.js) into the editor.
    function setContent(html) {
        if (!state.editor) return;
        state.applyingExternal++;
        try {
            state.editor.commands.setContent(normalizeLegacyHtml(html || ''), { emitUpdate: false });
            // Baseline the mirror immediately so save paths never see stale content.
            flushToMirror();
            polishPreservedCards();
            scheduleSelectionState();
        } finally {
            state.applyingExternal--;
        }
    }

    // Loading another note is a document boundary, not an editable transaction.
    // Recreate TipTap with the incoming document as its initial state so its
    // undo stack cannot reach content that belonged to the previously open note.
    function loadDocument(html) {
        if (!state.editor || !state.hostEl) return false;
        var options = {
            host: state.hostEl,
            mirror: state.mirrorEl,
            placeholder: state.placeholder || 'Start writing\u2026',
            onUserEdit: state.callbacks.onUserEdit,
            onSelectionChange: state.callbacks.onSelectionChange,
            blockBridge: state.blockBridge,
            content: html || ''
        };
        if (!mount(options)) return false;
        // Baseline the legacy mirror immediately for the canonical save path.
        flushToMirror();
        polishPreservedCards();
        scheduleSelectionState();
        return true;
    }

    // Serialize the current document back to legacy storage format.
    function getStorageHtml() {
        if (!state.editor) return '';
        var html = '';
        try { html = state.editor.getHTML(); } catch (e) { return ''; }
        var tpl = parseHtmlToTemplate(html);
        convertTaskListsToLegacy(tpl.content);
        var out = document.createElement('div');
        out.appendChild(tpl.content.cloneNode(true));
        return out.innerHTML;
    }

    function flushToMirror() {
        if (!state.editor || !state.mirrorEl) return;
        writeTrustedHtml(state.mirrorEl, getStorageHtml());
    }

    // Word / Google-Docs paste tends to encode structure as inline styles
    // (font-weight:700 instead of <strong>, mso-list paragraphs instead of
    // <ul>). Recover the semantics BEFORE the attribute-strip pass throws the
    // styles away, so bold/italic/lists survive a paste from those apps.
    function isForeignPreserved(el) {
        return !!(el.matches && el.matches('.html-embed-anchor, .drawing-anchor, [data-note-block-type][data-block-id]'));
    }

    function applyInlineStyleAsSemantics(el) {
        if (isForeignPreserved(el)) return;
        var style = (el.getAttribute && el.getAttribute('style')) || '';
        if (!style) return;
        var lower = style.toLowerCase();
        var wraps = [];
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(lower)) wraps.push('strong');
        if (/font-style\s*:\s*italic/.test(lower)) wraps.push('em');
        if (/text-decoration[^;]*underline/.test(lower)) wraps.push('u');
        if (/text-decoration[^;]*line-through/.test(lower)) wraps.push('s');
        if (!wraps.length) return;
        var node = document.createDocumentFragment();
        while (el.firstChild) node.appendChild(el.firstChild);
        for (var i = 0; i < wraps.length; i++) {
            var w = document.createElement(wraps[i]);
            w.appendChild(node);
            node = w;
        }
        el.appendChild(node);
    }

    function unwrapDocsWrapper(root) {
        var wrappers = Array.prototype.slice.call(root.querySelectorAll('b[id^="docs-internal-guid"], b[style*="font-weight:normal"], b[style*="font-weight: normal"]'));
        wrappers.forEach(function (b) {
            var parent = b.parentNode;
            if (!parent) return;
            while (b.firstChild) parent.insertBefore(b.firstChild, b);
            parent.removeChild(b);
        });
    }

    function wordListMarker(p) {
        return p.querySelector('span[style*="mso-list"]');
    }
    function isWordListItem(p) {
        var cls = String(p.className || '');
        var style = String(p.getAttribute('style') || '').toLowerCase();
        return /msolist/i.test(cls) || style.indexOf('mso-list') !== -1;
    }
    function wordListIsOrdered(p) {
        var marker = wordListMarker(p);
        return marker ? /\d/.test(marker.textContent || '') : false;
    }
    function convertWordLists(root) {
        var paras = Array.prototype.slice.call(root.querySelectorAll('p'));
        var i = 0;
        while (i < paras.length) {
            if (!isWordListItem(paras[i]) || !paras[i].parentNode) { i++; continue; }
            var ordered = wordListIsOrdered(paras[i]);
            var list = document.createElement(ordered ? 'ol' : 'ul');
            paras[i].parentNode.insertBefore(list, paras[i]);
            var j = i;
            while (j < paras.length && paras[j].parentNode && isWordListItem(paras[j]) && wordListIsOrdered(paras[j]) === ordered) {
                var li = document.createElement('li');
                var marker = wordListMarker(paras[j]);
                if (marker && marker.parentNode) marker.parentNode.removeChild(marker);
                while (paras[j].firstChild) li.appendChild(paras[j].firstChild);
                list.appendChild(li);
                paras[j].parentNode.removeChild(paras[j]);
                j++;
            }
            i = j;
        }
    }

    function preprocessForeignPaste(root) {
        Array.prototype.slice.call(root.querySelectorAll('o\\:p, o\\:P, w\\:sdt, o\\:smarttagtype')).forEach(function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        unwrapDocsWrapper(root);
        convertWordLists(root);
        Array.prototype.slice.call(root.querySelectorAll('span, p, li, td, th, div, h1, h2, h3')).forEach(applyInlineStyleAsSemantics);
    }

    function stripForeignPasteStyles(html) {
        var tpl = parseHtmlToTemplate(html);
        var root = tpl.content;
        Array.prototype.slice.call(root.querySelectorAll('script, style, meta, link, xml')).forEach(function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        preprocessForeignPaste(root);
        Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function (el) {
            var tag = String(el.tagName || '').toLowerCase();
            var isSutraPreserved = !!(el.matches && el.matches('.html-embed-anchor, .drawing-anchor, [data-note-block-type][data-block-id]'));
            if (tag === 'font') {
                var span = document.createElement('span');
                while (el.firstChild) span.appendChild(el.firstChild);
                el.parentNode.replaceChild(span, el);
                el = span;
            }

            var textAlign = '';
            try { textAlign = el.style && el.style.textAlign ? String(el.style.textAlign).toLowerCase() : ''; } catch (e) { textAlign = ''; }
            Array.prototype.slice.call(el.attributes || []).forEach(function (attr) {
                var name = String(attr.name || '').toLowerCase();
                if (name === 'href' || name === 'src' || name === 'alt' || name === 'title' ||
                    name === 'colspan' || name === 'rowspan' || name === 'data-type' || name === 'data-checked' ||
                    (isSutraPreserved && (name === 'class' || name === 'data-block-id' || name === 'data-note-block-type' || name === 'contenteditable'))) {
                    return;
                }
                el.removeAttribute(attr.name);
            });
            if (/^(left|center|right|justify)$/.test(textAlign)) {
                el.setAttribute('style', 'text-align: ' + textAlign + ';');
            } else {
                el.removeAttribute('style');
            }
        });
        var out = document.createElement('div');
        out.appendChild(root.cloneNode(true));
        return normalizeLegacyHtml(out.innerHTML);
    }

    function polishPreservedCards() {
        if (!state.hostEl) return;
        Array.prototype.slice.call(state.hostEl.querySelectorAll('.page-link[data-page-id]')).forEach(function (el) {
            var pageId = String(el.getAttribute('data-page-id') || '').trim();
            var label = String(el.getAttribute('aria-label') || '').trim();
            if (!label) {
                label = 'Open linked page ' + String(el.textContent || '').replace(/^\s*\u{1F4C4}\s*/u, '').trim();
            }
            el.setAttribute('role', 'link');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', label.trim());
            el.setAttribute('title', label.trim());
            if (!pageId) {
                el.setAttribute('aria-disabled', 'true');
                el.classList.add('page-link-broken');
            }
        });
    }

    function active(name, attrs) {
        if (!state.editor || typeof state.editor.isActive !== 'function') return false;
        try {
            return attrs ? !!state.editor.isActive(name, attrs) : !!state.editor.isActive(name);
        } catch (e) {
            return false;
        }
    }

    function activeAttrs(attrs) {
        if (!state.editor || typeof state.editor.isActive !== 'function') return false;
        try { return !!state.editor.isActive(attrs); } catch (e) { return false; }
    }

    function markAttr(name, key) {
        if (!state.editor || typeof state.editor.getAttributes !== 'function') return '';
        try {
            var attrs = state.editor.getAttributes(name) || {};
            return attrs[key] != null ? attrs[key] : '';
        } catch (e) {
            return '';
        }
    }

    function blockAttr(key) {
        if (!state.editor) return '';
        try {
            var sel = state.editor.state.selection;
            var node = sel && sel.$from ? sel.$from.parent : null;
            return node && node.attrs && node.attrs[key] != null ? node.attrs[key] : '';
        } catch (e) {
            return '';
        }
    }

    function getToolbarState() {
        if (!state.editor) return {};
        var alignCenter = activeAttrs({ textAlign: 'center' });
        var alignRight = activeAttrs({ textAlign: 'right' });
        var alignJustify = activeAttrs({ textAlign: 'justify' });
        var alignLeft = activeAttrs({ textAlign: 'left' }) || (!alignCenter && !alignRight && !alignJustify);
        return {
            bold: active('bold'),
            italic: active('italic'),
            underline: active('underline'),
            strike: active('strike'),
            subscript: active('subscript'),
            superscript: active('superscript'),
            h1: active('heading', { level: 1 }),
            h2: active('heading', { level: 2 }),
            h3: active('heading', { level: 3 }),
            paragraph: active('paragraph'),
            blockquote: active('blockquote'),
            codeblock: active('codeBlock'),
            bulletList: active('bulletList'),
            orderedList: active('orderedList'),
            taskList: active('taskList'),
            alignLeft: alignLeft,
            alignCenter: alignCenter,
            alignRight: alignRight,
            alignJustify: alignJustify,
            link: active('link'),
            inTable: active('table'),
            // Current-value fields for toolbar dropdowns.
            fontFamily: markAttr('textStyle', 'fontFamily'),
            fontSize: markAttr('textStyle', 'fontSize'),
            color: markAttr('textStyle', 'color'),
            highlight: markAttr('highlight', 'color'),
            lineHeight: blockAttr('blockLineHeight'),
            focused: isFocused()
        };
    }

    /* ------------------------------------------------------------------
     * Find & Replace bridge (drives the decoration-based SutraSearch
     * extension so the legacy panel works over the ProseMirror document
     * instead of the hidden mirror).
     * ---------------------------------------------------------------- */
    function searchStore() {
        if (!state.editor || !state.editor.storage) return { query: '', matches: [], activeIndex: -1 };
        return state.editor.storage.sutraSearch || { query: '', matches: [], activeIndex: -1 };
    }

    var searchBridge = {
        set: function (query, options) {
            if (!state.editor) return { count: 0, index: -1 };
            state.editor.commands.setSearchQuery(query, options || {});
            return searchBridge.getState();
        },
        next: function () {
            if (state.editor) state.editor.commands.findNext();
            return searchBridge.getState();
        },
        prev: function () {
            if (state.editor) state.editor.commands.findPrev();
            return searchBridge.getState();
        },
        replaceOne: function (text) {
            if (state.editor) {
                var store = searchStore();
                var q = store.query;
                var opts = { caseSensitive: store.caseSensitive };
                state.editor.commands.replaceCurrent(text);
                // Re-run the query on the mutated doc so match positions and
                // highlights stay valid (also repaints decorations).
                state.editor.commands.setSearchQuery(q, opts);
                scheduleMirrorFlush();
            }
            return searchBridge.getState();
        },
        replaceAll: function (text) {
            if (state.editor) {
                state.editor.commands.replaceAllMatches(text);
                // Every match consumed — drop the highlight.
                state.editor.commands.clearSearch();
                scheduleMirrorFlush();
            }
            return searchBridge.getState();
        },
        clear: function () {
            if (state.editor) state.editor.commands.clearSearch();
            return searchBridge.getState();
        },
        getState: function () {
            var store = searchStore();
            return {
                count: (store.matches && store.matches.length) || 0,
                index: typeof store.activeIndex === 'number' ? store.activeIndex : -1,
                query: store.query || ''
            };
        }
    };

    function emitSelectionState() {
        state.selectionTimer = null;
        polishPreservedCards();
        if (typeof state.callbacks.onSelectionChange === 'function') {
            try { state.callbacks.onSelectionChange(getToolbarState()); } catch (e) { /* non-critical */ }
        }
        updateContextualUI();
    }

    /* ==================================================================
     * Contextual editing UX (Phase 3): selection bubble menu, slash-command
     * insert menu, and block drag handles. All hand-rolled floating UI —
     * the vendored bundle exposes posToDOMRect / NodeSelection etc. so we do
     * not need any paid TipTap Pro extensions.
     * ================================================================== */
    var ctx = {
        bubble: null,
        slash: null,
        handle: null,
        slashOpen: false,
        slashFilter: '',
        slashItems: [],
        slashActiveIndex: 0,
        keydownBound: null,
        mousemoveBound: null,
        scrollBound: null,
        drag: null
    };

    function mkBtn(html, label, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'editor-v2-mini-btn';
        b.setAttribute('aria-label', label);
        b.title = label;
        writeTrustedHtml(b, html); // sutra-allow-html: static icon markup, no user input
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
        return b;
    }

    /* ---- Selection bubble menu ---- */
    function ensureBubble() {
        if (ctx.bubble) return ctx.bubble;
        var el = document.createElement('div');
        el.className = 'editor-v2-bubble';
        el.setAttribute('role', 'toolbar');
        el.style.display = 'none';
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.appendChild(mkBtn('<i class="fas fa-bold"></i>', 'Bold', function () { exec('bold'); }));
        el.appendChild(mkBtn('<i class="fas fa-italic"></i>', 'Italic', function () { exec('italic'); }));
        el.appendChild(mkBtn('<i class="fas fa-underline"></i>', 'Underline', function () { exec('underline'); }));
        el.appendChild(mkBtn('<i class="fas fa-strikethrough"></i>', 'Strikethrough', function () { exec('strike'); }));
        el.appendChild(mkBtn('<i class="fas fa-link"></i>', 'Link', function () {
            if (typeof window.insertLink === 'function') window.insertLink();
        }));
        el.appendChild(mkBtn('<i class="fas fa-highlighter"></i>', 'Highlight', function () { exec('highlight', '#ffe066'); }));
        el.appendChild(mkBtn('<i class="fas fa-comment"></i>', 'Comment', function () {
            if (typeof window.addCommentFromSelection === 'function') window.addCommentFromSelection();
        }));
        document.body.appendChild(el);
        ctx.bubble = el;
        return el;
    }

    function hideBubble() {
        if (ctx.bubble) ctx.bubble.style.display = 'none';
    }

    function updateBubble() {
        if (!state.editor || !state.editor.isFocused) return hideBubble();
        if (window.innerWidth < 640) return hideBubble();
        var sel = state.editor.state.selection;
        var eng = engine();
        if (sel.empty) return hideBubble();
        if (eng && eng.isNodeSelection && eng.isNodeSelection(sel)) return hideBubble();
        if (ctx.slashOpen) return hideBubble();
        var rect;
        try { rect = eng.posToDOMRect(state.editor.view, sel.from, sel.to); } catch (e) { return hideBubble(); }
        if (!rect || (!rect.width && !rect.height)) return hideBubble();
        var el = ensureBubble();
        // Reflect active marks.
        var st = getToolbarState();
        var kinds = ['bold', 'italic', 'underline', 'strike'];
        Array.prototype.forEach.call(el.querySelectorAll('.editor-v2-mini-btn'), function (b, i) {
            if (i < kinds.length) b.classList.toggle('active', !!st[kinds[i]]);
        });
        el.style.display = 'flex';
        el.style.position = 'fixed';
        var top = rect.top - el.offsetHeight - 8;
        var left = rect.left + (rect.width / 2) - (el.offsetWidth / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8));
        if (top < 4) top = rect.bottom + 8;
        el.style.top = top + 'px';
        el.style.left = left + 'px';
    }

    /* ---- Table structure menu (shown when the caret is in a table) ---- */
    function ensureTableMenu() {
        if (ctx.tableMenu) return ctx.tableMenu;
        var el = document.createElement('div');
        el.className = 'editor-v2-table-menu';
        el.setAttribute('role', 'toolbar');
        el.style.display = 'none';
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.appendChild(mkBtn('<i class="fas fa-arrow-up"></i><i class="fas fa-plus"></i>', 'Insert row above', function () { exec('addRowBefore'); }));
        el.appendChild(mkBtn('<i class="fas fa-arrow-down"></i><i class="fas fa-plus"></i>', 'Insert row below', function () { exec('addRowAfter'); }));
        el.appendChild(mkBtn('<i class="fas fa-arrow-left"></i><i class="fas fa-plus"></i>', 'Insert column left', function () { exec('addColumnBefore'); }));
        el.appendChild(mkBtn('<i class="fas fa-arrow-right"></i><i class="fas fa-plus"></i>', 'Insert column right', function () { exec('addColumnAfter'); }));
        el.appendChild(mkBtn('<i class="fas fa-object-group"></i>', 'Merge cells', function () { exec('mergeCells'); }));
        el.appendChild(mkBtn('<i class="fas fa-object-ungroup"></i>', 'Split cell', function () { exec('splitCell'); }));
        el.appendChild(mkBtn('<i class="fas fa-heading"></i>', 'Toggle header row', function () { exec('toggleHeaderRow'); }));
        el.appendChild(mkBtn('<i class="fas fa-minus"></i>', 'Delete row', function () { exec('deleteRow'); }));
        el.appendChild(mkBtn('<i class="fas fa-minus"></i>', 'Delete column', function () { exec('deleteColumn'); }));
        el.appendChild(mkBtn('<i class="fas fa-trash"></i>', 'Delete table', function () { exec('deleteTable'); }));
        document.body.appendChild(el);
        ctx.tableMenu = el;
        return el;
    }
    function hideTableMenu() { if (ctx.tableMenu) ctx.tableMenu.style.display = 'none'; }
    function tableDomFromSelection() {
        if (!state.editor) return null;
        try {
            var at = state.editor.view.domAtPos(state.editor.state.selection.from);
            var node = at.node && at.node.nodeType === 1 ? at.node : (at.node ? at.node.parentElement : null);
            return node && node.closest ? node.closest('table') : null;
        } catch (e) { return null; }
    }
    function updateTableMenu() {
        if (!state.editor || !state.editor.isFocused || !active('table') || ctx.slashOpen) return hideTableMenu();
        var table = tableDomFromSelection();
        if (!table) return hideTableMenu();
        var rect = table.getBoundingClientRect();
        var el = ensureTableMenu();
        el.style.display = 'flex';
        el.style.position = 'fixed';
        var top = rect.top - el.offsetHeight - 6;
        if (top < 4) top = rect.top + 4;
        el.style.top = top + 'px';
        el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
    }

    /* ---- Image toolbar (shown when a single image node is selected) ---- */
    function selectedImageNode() {
        if (!state.editor) return null;
        var sel = state.editor.state.selection;
        var eng = engine();
        if (eng && eng.isNodeSelection && eng.isNodeSelection(sel) && sel.node && sel.node.type.name === 'image') return sel;
        return null;
    }
    function ensureImageMenu() {
        if (ctx.imageMenu) return ctx.imageMenu;
        var el = document.createElement('div');
        el.className = 'editor-v2-bubble editor-v2-image-menu';
        el.setAttribute('role', 'toolbar');
        el.style.display = 'none';
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.appendChild(mkBtn('<i class="fas fa-align-left"></i>', 'Align left', function () { exec('imageAlign', 'left'); }));
        el.appendChild(mkBtn('<i class="fas fa-align-center"></i>', 'Align center', function () { exec('imageAlign', 'center'); }));
        el.appendChild(mkBtn('<i class="fas fa-align-right"></i>', 'Align right', function () { exec('imageAlign', 'right'); }));
        el.appendChild(mkBtn('<i class="fas fa-compress"></i>', 'Reset width', function () { exec('imageWidth', null); }));
        document.body.appendChild(el);
        ctx.imageMenu = el;
        return el;
    }
    function hideImageMenu() { if (ctx.imageMenu) ctx.imageMenu.style.display = 'none'; }
    function updateImageMenu() {
        var sel = selectedImageNode();
        if (!sel || !state.editor.isFocused) return hideImageMenu();
        var eng = engine();
        var rect;
        try { rect = eng.posToDOMRect(state.editor.view, sel.from, sel.to); } catch (e) { return hideImageMenu(); }
        var el = ensureImageMenu();
        el.style.display = 'flex';
        el.style.position = 'fixed';
        var top = rect.top - el.offsetHeight - 8;
        if (top < 4) top = rect.bottom + 8;
        var left = rect.left + (rect.width / 2) - (el.offsetWidth / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8));
        el.style.top = top + 'px';
        el.style.left = left + 'px';
    }

    /* ---- Slash-command insert menu ---- */
    function slashItemDefs() {
        return [
            { label: 'Heading 1', icon: 'fa-heading', run: function () { if (window.formatBlock) window.formatBlock('h1'); } },
            { label: 'Heading 2', icon: 'fa-heading', run: function () { if (window.formatBlock) window.formatBlock('h2'); } },
            { label: 'Heading 3', icon: 'fa-heading', run: function () { if (window.formatBlock) window.formatBlock('h3'); } },
            { label: 'Bulleted list', icon: 'fa-list-ul', run: function () { exec('bulletList'); } },
            { label: 'Numbered list', icon: 'fa-list-ol', run: function () { exec('orderedList'); } },
            { label: 'Checklist', icon: 'fa-tasks', run: function () { if (window.insertChecklist) window.insertChecklist(); else exec('taskList'); } },
            { label: 'Quote', icon: 'fa-quote-left', run: function () { exec('blockquote'); } },
            { label: 'Code block', icon: 'fa-code', run: function () { exec('codeblock'); } },
            { label: 'Divider', icon: 'fa-grip-lines', run: function () { exec('horizontalRule'); } },
            { label: 'Table', icon: 'fa-table', run: function () { exec('table', { rows: 3, cols: 3 }); } },
            { label: 'Image', icon: 'fa-image', run: function () { if (window.insertImage) window.insertImage(); } },
            { label: 'Equation', icon: 'fa-square-root-alt', run: function () { if (window.insertEquation) window.insertEquation(); } },
            { label: 'Page break', icon: 'fa-grip-lines', run: function () { if (window.insertPageBreak) window.insertPageBreak(); } },
            { label: 'Page link', icon: 'fa-file-alt', run: function () { if (window.insertPageLink) window.insertPageLink(); } },
            { label: 'Video', icon: 'fa-video', run: function () { if (window.insertVideo) window.insertVideo(); } },
            { label: 'Web embed', icon: 'fa-globe', run: function () { if (window.insertEmbed) window.insertEmbed(); } },
            { label: 'Collapsible section', icon: 'fa-chevron-down', run: function () { if (window.insertCollapsible) window.insertCollapsible(); } },
            { label: 'Footnote', icon: 'fa-asterisk', run: function () { if (window.insertFootnote) window.insertFootnote(); } },
            { label: 'Citation', icon: 'fa-quote-right', run: function () { if (window.insertCitation) window.insertCitation(); } }
        ];
    }

    function ensureSlashMenu() {
        if (ctx.slash) return ctx.slash;
        var el = document.createElement('div');
        el.className = 'editor-v2-slash-menu';
        el.setAttribute('role', 'listbox');
        el.style.display = 'none';
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        document.body.appendChild(el);
        ctx.slash = el;
        return el;
    }

    function closeSlash() {
        if (!ctx.slashOpen) return;
        ctx.slashOpen = false;
        ctx.slashFilter = '';
        ctx.slashItems = [];
        if (ctx.slash) ctx.slash.style.display = 'none';
    }

    function renderSlashMenu() {
        var el = ensureSlashMenu();
        writeTrustedHtml(el, ''); // clear
        ctx.slashItems.forEach(function (item, idx) {
            var row = document.createElement('button');
            row.type = 'button';
            row.className = 'editor-v2-slash-item' + (idx === ctx.slashActiveIndex ? ' active' : '');
            row.setAttribute('role', 'option');
            var icon = document.createElement('i');
            icon.className = 'fas ' + item.icon;
            var label = document.createElement('span');
            label.textContent = item.label;
            row.appendChild(icon);
            row.appendChild(label);
            row.addEventListener('mousedown', function (e) { e.preventDefault(); });
            row.addEventListener('click', function (e) { e.preventDefault(); chooseSlashItem(idx); });
            el.appendChild(row);
        });
        el.style.display = ctx.slashItems.length ? 'block' : 'none';
    }

    function positionSlashMenu() {
        if (!state.editor || !ctx.slash) return;
        var eng = engine();
        var pos = state.editor.state.selection.from;
        var rect;
        try { rect = eng.posToDOMRect(state.editor.view, pos, pos); } catch (e) { return; }
        var el = ctx.slash;
        el.style.position = 'fixed';
        var top = rect.bottom + 6;
        var left = rect.left;
        // clamp
        var maxTop = window.innerHeight - el.offsetHeight - 8;
        if (top > maxTop) top = Math.max(8, rect.top - el.offsetHeight - 6);
        left = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8));
        el.style.top = top + 'px';
        el.style.left = left + 'px';
    }

    function maybeSlash() {
        if (!state.editor || !state.editor.isFocused) return closeSlash();
        var sel = state.editor.state.selection;
        if (!sel.empty) return closeSlash();
        var $from = sel.$from;
        var parent = $from.parent;
        if (!parent || parent.type.name !== 'paragraph') return closeSlash();
        var text = parent.textContent;
        var m = /^\/([a-zA-Z]*)$/.exec(text);
        if (!m) return closeSlash();
        if ($from.parentOffset !== parent.content.size) return closeSlash();
        ctx.slashFilter = m[1].toLowerCase();
        var items = slashItemDefs().filter(function (it) {
            return !ctx.slashFilter || it.label.toLowerCase().indexOf(ctx.slashFilter) !== -1;
        });
        if (!items.length) return closeSlash();
        ctx.slashItems = items;
        if (!ctx.slashOpen) ctx.slashActiveIndex = 0;
        else ctx.slashActiveIndex = Math.min(ctx.slashActiveIndex, items.length - 1);
        ctx.slashOpen = true;
        renderSlashMenu();
        positionSlashMenu();
    }

    function chooseSlashItem(index) {
        if (!state.editor) return;
        var item = ctx.slashItems[index];
        if (!item) return;
        var $from = state.editor.state.selection.$from;
        var start = $from.start();
        var end = $from.pos;
        closeSlash();
        // Delete the "/filter" trigger text, then run the insert on the now-empty block.
        try { state.editor.chain().focus().deleteRange({ from: start, to: end }).run(); } catch (e) { /* non-critical */ }
        try { item.run(); } catch (e) { /* non-critical */ }
        scheduleMirrorFlush();
    }

    function onEditorKeydown(event) {
        if (!ctx.slashOpen) return;
        var handled = true;
        if (event.key === 'ArrowDown') {
            ctx.slashActiveIndex = (ctx.slashActiveIndex + 1) % ctx.slashItems.length;
            renderSlashMenu();
        } else if (event.key === 'ArrowUp') {
            ctx.slashActiveIndex = (ctx.slashActiveIndex - 1 + ctx.slashItems.length) % ctx.slashItems.length;
            renderSlashMenu();
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            chooseSlashItem(ctx.slashActiveIndex);
        } else if (event.key === 'Escape') {
            closeSlash();
        } else {
            handled = false;
        }
        if (handled) {
            // Capture phase — stop ProseMirror's own keydown handler from also
            // acting on the navigation keys while the slash menu owns them.
            event.preventDefault();
            event.stopPropagation();
        }
    }

    /* ---- Block drag handle (pointer-based reorder of top-level blocks) ---- */
    function ensureHandle() {
        if (ctx.handle) return ctx.handle;
        var el = document.createElement('div');
        el.className = 'editor-v2-drag-handle';
        el.dataset.editorV2Owner = state.hostEl ? state.hostEl.id : '';
        el.setAttribute('aria-hidden', 'true');
        writeTrustedHtml(el, '<i class="fas fa-grip-vertical"></i>'); // sutra-allow-html: static icon
        el.style.display = 'none';
        el.addEventListener('mousedown', onHandleMouseDown);
        document.body.appendChild(el);
        ctx.handle = el;
        return el;
    }

    function topLevelInfoAtCoords(clientX, clientY) {
        if (!state.editor) return null;
        var view = state.editor.view;
        var found = view.posAtCoords({ left: clientX, top: clientY });
        if (!found) return null;
        var doc = view.state.doc;
        // A top-level atom resolves at depth 0, unlike a paragraph. Prefer
        // posAtCoords.inside so its hover still exposes the block move handle.
        var inside = typeof found.inside === 'number' && found.inside >= 0 ? found.inside : found.pos;
        var $pos = doc.resolve(Math.min(inside, doc.content.size));
        var index = $pos.index(0);
        if (index < 0 || index >= doc.childCount) return null;
        var before = 0;
        for (var i = 0; i < index; i++) before += doc.child(i).nodeSize;
        var node = doc.child(index);
        var dom = view.nodeDOM(before);
        return { index: index, pos: before, node: node, dom: dom && dom.nodeType === 1 ? dom : null };
    }

    function onEditorMouseMove(event) {
        if (!state.editor || ctx.drag) return;
        if (window.innerWidth < 768) { if (ctx.handle) ctx.handle.style.display = 'none'; return; }
        var info = topLevelInfoAtCoords(event.clientX, event.clientY);
        if (!info || !info.dom) { if (ctx.handle) ctx.handle.style.display = 'none'; return; }
        var rect = info.dom.getBoundingClientRect();
        var el = ensureHandle();
        el.style.display = 'flex';
        el.style.position = 'fixed';
        el.style.top = (rect.top + 2) + 'px';
        el.style.left = Math.max(2, rect.left - 22) + 'px';
        ctx.handleIndex = info.index;
    }

    function onHandleMouseDown(event) {
        event.preventDefault();
        if (!state.editor) return;
        var view = state.editor.view;
        ctx.drag = { fromIndex: ctx.handleIndex, indicator: null };
        var ind = document.createElement('div');
        ind.className = 'editor-v2-drop-indicator';
        ind.style.position = 'fixed';
        ind.style.display = 'none';
        document.body.appendChild(ind);
        ctx.drag.indicator = ind;
        document.addEventListener('mousemove', onDragMove, true);
        document.addEventListener('mouseup', onDragEnd, true);
    }

    function dropTargetIndex(clientY) {
        var doc = state.editor.state.doc;
        var view = state.editor.view;
        var count = doc.childCount;
        var before = 0;
        for (var i = 0; i < count; i++) {
            var dom = view.nodeDOM(before);
            before += doc.child(i).nodeSize;
            if (!dom || dom.nodeType !== 1) continue;
            var rect = dom.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return { index: i, y: rect.top };
        }
        // After the last block.
        var lastDom = view.nodeDOM(before - doc.child(count - 1).nodeSize);
        var lastRect = lastDom && lastDom.nodeType === 1 ? lastDom.getBoundingClientRect() : null;
        return { index: count, y: lastRect ? lastRect.bottom : 0 };
    }

    function onDragMove(event) {
        if (!ctx.drag || !state.editor) return;
        var target = dropTargetIndex(event.clientY);
        ctx.drag.toIndex = target.index;
        var ind = ctx.drag.indicator;
        if (ind && state.hostEl) {
            var hostRect = state.hostEl.getBoundingClientRect();
            ind.style.display = 'block';
            ind.style.top = target.y + 'px';
            ind.style.left = hostRect.left + 'px';
            ind.style.width = hostRect.width + 'px';
        }
    }

    function onDragEnd() {
        document.removeEventListener('mousemove', onDragMove, true);
        document.removeEventListener('mouseup', onDragEnd, true);
        var drag = ctx.drag;
        ctx.drag = null;
        if (drag && drag.indicator && drag.indicator.parentNode) drag.indicator.parentNode.removeChild(drag.indicator);
        if (!drag || !state.editor || typeof drag.fromIndex !== 'number' || typeof drag.toIndex !== 'number') return;
        moveTopLevelBlock(drag.fromIndex, drag.toIndex);
    }

    function moveTopLevelBlock(fromIndex, toIndex) {
        if (!state.editor) return;
        var view = state.editor.view;
        var doc = view.state.doc;
        if (fromIndex === toIndex || fromIndex === toIndex - 1) return; // no-op
        if (fromIndex < 0 || fromIndex >= doc.childCount) return;
        var node = doc.child(fromIndex);
        var fromPos = 0;
        for (var i = 0; i < fromIndex; i++) fromPos += doc.child(i).nodeSize;
        var tr = view.state.tr;
        tr.delete(fromPos, fromPos + node.nodeSize);
        var insertIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        var mdoc = tr.doc;
        var insertPos = 0;
        for (var j = 0; j < insertIndex && j < mdoc.childCount; j++) insertPos += mdoc.child(j).nodeSize;
        try { tr.insert(insertPos, node); view.dispatch(tr); } catch (e) { /* non-critical */ }
        scheduleMirrorFlush();
    }

    // Drop image files straight into the document as base64 <img> nodes.
    function handleImageDrop(view, event) {
        var dt = event.dataTransfer;
        if (!dt || !dt.files || !dt.files.length) return false;
        var files = Array.prototype.slice.call(dt.files).filter(function (f) { return /^image\//.test(f.type || ''); });
        if (!files.length) return false;
        event.preventDefault();
        var posInfo = view.posAtCoords({ left: event.clientX, top: event.clientY });
        var pos = posInfo ? posInfo.pos : view.state.selection.from;
        var imgType = view.state.schema.nodes.image;
        if (!imgType) return false;
        files.forEach(function (file) {
            var reader = new FileReader();
            reader.onload = function () {
                var src = String(reader.result || '');
                if (!src) return;
                try { view.dispatch(view.state.tr.insert(pos, imgType.create({ src: src }))); } catch (e) { /* non-critical */ }
                scheduleMirrorFlush();
            };
            reader.readAsDataURL(file);
        });
        return true;
    }

    function reportImagePasteFailure(error) {
        if (typeof window.SutraReportError !== 'function') return;
        try {
            window.SutraReportError(error, {
                feature: 'notes-editor-v2',
                where: 'image-paste',
                userMessage: 'That image could not be pasted.'
            }, 'warning');
        } catch (reportError) { /* diagnostics must not interrupt editor input */ }
    }

    function insertPastedImage(view, file, onComplete) {
        var reader = new FileReader();
        reader.onload = function () {
            var src = String(reader.result || '');
            if (!/^data:image\//i.test(src)) {
                reportImagePasteFailure(new Error('Clipboard image did not produce an image data URL.'));
                if (typeof onComplete === 'function') onComplete();
                return;
            }
            try {
                if (!view || view.destroyed || !view.state) return;
                var imageType = view.state.schema.nodes.image;
                if (!imageType) throw new Error('The notes editor image node is unavailable.');
                var image = imageType.create({
                    src: src,
                    alt: file && file.name ? String(file.name) : 'Pasted image'
                });
                view.dispatch(view.state.tr.replaceSelectionWith(image).scrollIntoView());
            } catch (error) {
                reportImagePasteFailure(error);
            } finally {
                if (typeof onComplete === 'function') onComplete();
            }
        };
        reader.onerror = function () {
            reportImagePasteFailure(new Error('Unable to read the pasted image.'));
            if (typeof onComplete === 'function') onComplete();
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            reportImagePasteFailure(error);
            if (typeof onComplete === 'function') onComplete();
        }
    }

    function handleImagePaste(view, event) {
        var data = event && event.clipboardData;
        if (!data) return false;

        var files = [];
        var items = data.items;
        if (items && items.length) {
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!item || item.kind !== 'file' || !/^image\//i.test(item.type || '')) continue;
                var itemFile = item.getAsFile && item.getAsFile();
                if (itemFile) files.push(itemFile);
            }
        }
        if (!files.length && data.files && data.files.length) {
            files = Array.prototype.slice.call(data.files).filter(function (file) {
                return file && /^image\//i.test(file.type || '');
            });
        }
        if (!files.length) return false;

        event.preventDefault();
        var index = 0;
        var insertNext = function () {
            if (index >= files.length) return;
            var file = files[index++];
            insertPastedImage(view, file, insertNext);
        };
        insertNext();
        return true;
    }

    // Right-click inside a table surfaces the same structure menu.
    function handleTableContextMenu(view, event) {
        var target = event.target;
        var table = target && target.closest ? target.closest('table') : null;
        if (!table || !state.hostEl || !state.hostEl.contains(table)) return false;
        event.preventDefault();
        var el = ensureTableMenu();
        el.style.display = 'flex';
        el.style.position = 'fixed';
        el.style.top = Math.min(event.clientY, window.innerHeight - 80) + 'px';
        el.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - el.offsetWidth - 8)) + 'px';
        return true;
    }

    function updateContextualUI() {
        try { maybeSlash(); } catch (e) { /* non-critical */ }
        try { updateImageMenu(); } catch (e) { /* non-critical */ }
        try { updateTableMenu(); } catch (e) { /* non-critical */ }
        try { updateBubble(); } catch (e) { /* non-critical */ }
    }

    function attachContextualListeners() {
        if (!state.editor) return;
        var dom = state.editor.view.dom;
        ctx.keydownBound = onEditorKeydown;
        dom.addEventListener('keydown', ctx.keydownBound, true);
        ctx.mousemoveBound = onEditorMouseMove;
        dom.addEventListener('mousemove', ctx.mousemoveBound);
        dom.addEventListener('mouseleave', function () { if (ctx.handle && !ctx.drag) ctx.handle.style.display = 'none'; });
        ctx.scrollBound = function () {
            hideBubble();
            hideTableMenu();
            hideImageMenu();
            if (ctx.slashOpen) positionSlashMenu();
        };
        window.addEventListener('scroll', ctx.scrollBound, true);
    }

    function detachContextualListeners() {
        if (ctx.keydownBound && state.editor) {
            try { state.editor.view.dom.removeEventListener('keydown', ctx.keydownBound, true); } catch (e) { /* noop */ }
        }
        if (ctx.mousemoveBound && state.editor) {
            try { state.editor.view.dom.removeEventListener('mousemove', ctx.mousemoveBound); } catch (e) { /* noop */ }
        }
        if (ctx.scrollBound) {
            try { window.removeEventListener('scroll', ctx.scrollBound, true); } catch (e) { /* noop */ }
        }
        closeSlash();
        hideBubble();
        hideTableMenu();
        hideImageMenu();
        document.removeEventListener('mousemove', onDragMove, true);
        document.removeEventListener('mouseup', onDragEnd, true);
        if (ctx.drag && ctx.drag.indicator && ctx.drag.indicator.parentNode) ctx.drag.indicator.parentNode.removeChild(ctx.drag.indicator);
        ctx.drag = null;
        if (ctx.handle && ctx.handle.parentNode) ctx.handle.parentNode.removeChild(ctx.handle);
        ctx.handle = null;
        ctx.keydownBound = ctx.mousemoveBound = ctx.scrollBound = null;
    }

    function scheduleSelectionState() {
        if (state.selectionTimer) return;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        state.selectionTimer = raf(emitSelectionState);
    }

    function insertHtml(html) {
        if (!state.editor) return false;
        try {
            state.editor.chain().focus().insertContent(normalizeLegacyHtml(html || ''), { parseOptions: { preserveWhitespace: false } }).run();
        } catch (e) {
            return false;
        }
        polishPreservedCards();
        scheduleSelectionState();
        scheduleMirrorFlush();
        return true;
    }

    function focus() {
        if (state.editor) {
            try { state.editor.commands.focus(); } catch (e) { /* non-critical */ }
            scheduleSelectionState();
        }
    }

    function isFocused() {
        return !!(state.editor && state.editor.isFocused);
    }

    /* ------------------------------------------------------------------
     * Command bridge (toolbar / shortcuts)
     * ---------------------------------------------------------------- */
    var COMMANDS = {
        bold: function (c) { return c.toggleBold(); },
        italic: function (c) { return c.toggleItalic(); },
        underline: function (c) { return c.toggleUnderline(); },
        strike: function (c) { return c.toggleStrike(); },
        h1: function (c) { return c.toggleHeading({ level: 1 }); },
        h2: function (c) { return c.toggleHeading({ level: 2 }); },
        h3: function (c) { return c.toggleHeading({ level: 3 }); },
        paragraph: function (c) { return c.setParagraph(); },
        blockquote: function (c) { return c.toggleBlockquote(); },
        codeblock: function (c) { return c.toggleCodeBlock(); },
        bulletList: function (c) { return c.toggleBulletList(); },
        orderedList: function (c) { return c.toggleOrderedList(); },
        taskList: function (c) { return c.toggleTaskList(); },
        alignLeft: function (c) { return c.setTextAlign('left'); },
        alignCenter: function (c) { return c.setTextAlign('center'); },
        alignRight: function (c) { return c.setTextAlign('right'); },
        undo: function (c) { return c.undo(); },
        redo: function (c) { return c.redo(); },
        clearFormatting: function (c) { return c.unsetAllMarks().clearNodes(); },
        horizontalRule: function (c) { return c.setHorizontalRule(); },
        link: function (c, url) { return c.extendMarkRange('link').setLink({ href: String(url || '') }); },
        unlink: function (c) { return c.extendMarkRange('link').unsetLink(); },
        color: function (c, value) { return value ? c.setColor(String(value)) : c.unsetColor(); },
        highlight: function (c, value) { return value ? c.setHighlight({ color: String(value) }) : c.unsetHighlight(); },
        indent: function (c) { return c.indent(); },
        outdent: function (c) { return c.outdent(); },
        lineHeight: function (c, value) { return value ? c.setBlockLineHeight(String(value)) : c.unsetBlockLineHeight(); },
        fontFamily: function (c, value) { return value ? c.setFontFamily(String(value)) : c.unsetFontFamily(); },
        fontSize: function (c, value) { return value ? c.setFontSize(String(value)) : c.unsetFontSize(); },
        subscript: function (c) { return c.toggleSubscript(); },
        superscript: function (c) { return c.toggleSuperscript(); },
        table: function (c, size) {
            var rows = size && size.rows ? size.rows : 3;
            var cols = size && size.cols ? size.cols : 3;
            return c.insertTable({ rows: rows, cols: cols, withHeaderRow: true });
        },
        // Table structure (TableKit provides these commands).
        addRowBefore: function (c) { return c.addRowBefore(); },
        addRowAfter: function (c) { return c.addRowAfter(); },
        addColumnBefore: function (c) { return c.addColumnBefore(); },
        addColumnAfter: function (c) { return c.addColumnAfter(); },
        deleteRow: function (c) { return c.deleteRow(); },
        deleteColumn: function (c) { return c.deleteColumn(); },
        deleteTable: function (c) { return c.deleteTable(); },
        mergeCells: function (c) { return c.mergeCells(); },
        splitCell: function (c) { return c.splitCell(); },
        mergeOrSplit: function (c) { return c.mergeOrSplit(); },
        toggleHeaderRow: function (c) { return c.toggleHeaderRow(); },
        toggleHeaderColumn: function (c) { return c.toggleHeaderColumn(); },
        // Image alignment / width.
        imageAlign: function (c, value) { return c.updateAttributes('image', { align: value || null }); },
        imageWidth: function (c, value) { return c.updateAttributes('image', { width: value || null }); }
    };

    function exec(kind, arg) {
        if (!state.editor) return false;
        var command = COMMANDS[kind];
        if (!command) return false;
        var ok = false;
        try {
            ok = command(state.editor.chain().focus(), arg).run();
        } catch (e) {
            ok = false;
        }
        polishPreservedCards();
        scheduleSelectionState();
        scheduleMirrorFlush();
        return ok;
    }

    return {
        isAvailable: isAvailable,
        isMounted: isMounted,
        mount: mount,
        destroy: destroy,
        setContent: setContent,
        loadDocument: loadDocument,
        getStorageHtml: getStorageHtml,
        flushToMirror: flushToMirror,
        flushPendingEdit: flushPendingEdit,
        insertHtml: insertHtml,
        getStructuredBlocks: getStructuredBlocks,
        exec: exec,
        focus: focus,
        isFocused: isFocused,
        getToolbarState: getToolbarState,
        search: searchBridge,
        // Exposed for tests.
        _normalizeLegacyHtml: normalizeLegacyHtml
    };
    }
    var primaryEditor = createEditorInstance();
    primaryEditor.createInstance = createEditorInstance;
    window.SutraNotesEditorV2 = primaryEditor;
})();
