/*
 * Sutra Editor vendored bundle entry.
 *
 * Bundles TipTap (ProseMirror) into a single self-contained IIFE exposed as
 * window.SutraEditor, so the app itself stays no-build (same pattern as
 * assets/vendor/jszip). Rebuild with `npm run build` in tools/editor-bundle.
 */
import {
    Editor,
    Extension,
    Node,
    Mark,
    mergeAttributes,
    InputRule,
    textInputRule,
    markInputRule,
    nodeInputRule,
    wrappingInputRule,
    posToDOMRect,
    isNodeSelection,
    findParentNode,
    NodeView,
    ResizableNodeView,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Placeholder, CharacterCount, Selection } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMParser as PMDOMParser, DOMSerializer as PMDOMSerializer } from '@tiptap/pm/model';

/* ------------------------------------------------------------------
 * Sutra house extensions — hand-rolled, no extra npm deps. These give
 * the notes editor the Docs/Word behaviours the classic editor had:
 * paragraph indentation (margin-left), block line spacing, Docs keyboard
 * shortcuts, and a decoration-based find/replace engine.
 * ---------------------------------------------------------------- */

// Block indent stored as inline `margin-left: Npx` so storage stays
// byte-compatible with the classic editor's applyParagraphIndent format.
const SutraIndent = Extension.create({
    name: 'sutraIndent',
    addOptions() {
        return { types: ['paragraph', 'heading'], step: 40, minIndent: 0, maxIndent: 400 };
    },
    addGlobalAttributes() {
        return [{
            types: this.options.types,
            attributes: {
                indent: {
                    default: 0,
                    parseHTML: (element) => {
                        const ml = parseInt(element.style.marginLeft, 10);
                        return Number.isFinite(ml) && ml > 0 ? ml : 0;
                    },
                    renderHTML: (attributes) => {
                        if (!attributes.indent) return {};
                        return { style: `margin-left: ${attributes.indent}px` };
                    },
                },
            },
        }];
    },
    addCommands() {
        const types = this.options.types;
        const step = this.options.step;
        const minIndent = this.options.minIndent;
        const maxIndent = this.options.maxIndent;
        const changeIndent = (delta) => ({ state, dispatch }) => {
            const { doc, selection, tr } = state;
            const { from, to } = selection;
            let changed = false;
            doc.nodesBetween(from, to, (node, pos) => {
                if (types.indexOf(node.type.name) === -1) return true;
                const cur = node.attrs.indent || 0;
                const next = Math.max(minIndent, Math.min(maxIndent, cur + delta));
                if (next !== cur) {
                    tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { indent: next }));
                    changed = true;
                }
                return true;
            });
            if (changed && dispatch) dispatch(tr);
            return changed;
        };
        return {
            indent: () => changeIndent(step),
            outdent: () => changeIndent(-step),
        };
    },
    addKeyboardShortcuts() {
        const inListOrTable = () =>
            this.editor.isActive('listItem') ||
            this.editor.isActive('taskItem') ||
            this.editor.isActive('table');
        return {
            // Let StarterKit's list keymap / TableKit handle Tab inside those.
            Tab: () => (inListOrTable() ? false : this.editor.commands.indent()),
            'Shift-Tab': () => (inListOrTable() ? false : this.editor.commands.outdent()),
            'Mod-]': () => this.editor.commands.indent(),
            'Mod-[': () => this.editor.commands.outdent(),
        };
    },
});

// Block-level line spacing (Docs "Line spacing" menu). Named *Block* to avoid
// colliding with TextStyleKit's inline span-based setLineHeight command.
const SutraLineHeight = Extension.create({
    name: 'sutraLineHeight',
    addOptions() {
        return { types: ['paragraph', 'heading'] };
    },
    addGlobalAttributes() {
        return [{
            types: this.options.types,
            attributes: {
                blockLineHeight: {
                    default: null,
                    parseHTML: (element) => element.style.lineHeight || null,
                    renderHTML: (attributes) => {
                        if (!attributes.blockLineHeight) return {};
                        return { style: `line-height: ${attributes.blockLineHeight}` };
                    },
                },
            },
        }];
    },
    addCommands() {
        const types = this.options.types;
        const setAll = (value) => ({ state, dispatch }) => {
            const { doc, selection, tr } = state;
            const { from, to } = selection;
            let changed = false;
            doc.nodesBetween(from, to, (node, pos) => {
                if (types.indexOf(node.type.name) === -1) return true;
                if ((node.attrs.blockLineHeight || null) === (value || null)) return true;
                tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { blockLineHeight: value }));
                changed = true;
                return true;
            });
            if (changed && dispatch) dispatch(tr);
            return changed;
        };
        return {
            setBlockLineHeight: (value) => setAll(value ? String(value) : null),
            unsetBlockLineHeight: () => setAll(null),
        };
    },
});

// Google-Docs-style keyboard shortcuts on top of TipTap's defaults.
const SutraDocsKeymap = Extension.create({
    name: 'sutraDocsKeymap',
    addKeyboardShortcuts() {
        return {
            'Mod-Alt-0': () => this.editor.commands.setParagraph(),
            'Mod-Alt-1': () => this.editor.commands.toggleHeading({ level: 1 }),
            'Mod-Alt-2': () => this.editor.commands.toggleHeading({ level: 2 }),
            'Mod-Alt-3': () => this.editor.commands.toggleHeading({ level: 3 }),
            'Mod-Shift-7': () => this.editor.commands.toggleOrderedList(),
            'Mod-Shift-8': () => this.editor.commands.toggleBulletList(),
            'Mod-Shift-9': () => this.editor.commands.toggleTaskList(),
        };
    },
});

/* ---- Find & Replace via ProseMirror decorations ---- */
const sutraSearchKey = new PluginKey('sutraSearch');

function computeSearchMatches(doc, query, caseSensitive) {
    const matches = [];
    if (!query) return matches;
    const needle = caseSensitive ? query : query.toLowerCase();
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        const hay = caseSensitive ? node.text : node.text.toLowerCase();
        let idx = 0;
        while ((idx = hay.indexOf(needle, idx)) !== -1) {
            matches.push({ from: pos + idx, to: pos + idx + query.length });
            idx += query.length;
        }
    });
    return matches;
}

function searchDecorationSet(doc, matches, activeIndex, searchClass, currentClass) {
    if (!matches.length) return DecorationSet.empty;
    const decos = matches.map((m, i) =>
        Decoration.inline(m.from, m.to, { class: searchClass + (i === activeIndex ? ' ' + currentClass : '') }));
    return DecorationSet.create(doc, decos);
}

function scrollSearchMatchIntoView(editor, match) {
    if (!match) return;
    try {
        const found = editor.view.domAtPos(match.from);
        const el = found && found.node && found.node.nodeType === 1 ? found.node : (found && found.node ? found.node.parentElement : null);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { /* non-critical */ }
}

const SutraSearch = Extension.create({
    name: 'sutraSearch',
    addOptions() {
        return { searchClass: 'find-highlight', currentClass: 'current' };
    },
    addStorage() {
        return { query: '', matches: [], activeIndex: -1, caseSensitive: false };
    },
    addProseMirrorPlugins() {
        return [new Plugin({
            key: sutraSearchKey,
            state: {
                init() { return DecorationSet.empty; },
                apply(tr, old) {
                    const meta = tr.getMeta(sutraSearchKey);
                    if (meta && meta.decorations) return meta.decorations;
                    if (meta && meta.clear) return DecorationSet.empty;
                    if (old !== DecorationSet.empty && tr.docChanged) return old.map(tr.mapping, tr.doc);
                    return old;
                },
            },
            props: {
                decorations(state) { return this.getState(state); },
            },
        })];
    },
    addCommands() {
        const searchClass = this.options.searchClass;
        const currentClass = this.options.currentClass;
        const self = this;
        const paint = (editor, activeIndex) => {
            const store = self.storage;
            const decos = searchDecorationSet(editor.state.doc, store.matches, activeIndex, searchClass, currentClass);
            const tr = editor.state.tr.setMeta(sutraSearchKey, { decorations: decos });
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
        };
        const recompute = (editor) => {
            self.storage.matches = computeSearchMatches(editor.state.doc, self.storage.query, self.storage.caseSensitive);
        };
        return {
            setSearchQuery: (query, options) => ({ editor }) => {
                self.storage.query = query == null ? '' : String(query);
                self.storage.caseSensitive = !!(options && options.caseSensitive);
                recompute(editor);
                self.storage.activeIndex = self.storage.matches.length ? 0 : -1;
                paint(editor, self.storage.activeIndex);
                if (self.storage.activeIndex >= 0) scrollSearchMatchIntoView(editor, self.storage.matches[self.storage.activeIndex]);
                return true;
            },
            findNext: () => ({ editor }) => {
                const n = self.storage.matches.length;
                if (!n) return false;
                self.storage.activeIndex = (self.storage.activeIndex + 1) % n;
                paint(editor, self.storage.activeIndex);
                scrollSearchMatchIntoView(editor, self.storage.matches[self.storage.activeIndex]);
                return true;
            },
            findPrev: () => ({ editor }) => {
                const n = self.storage.matches.length;
                if (!n) return false;
                self.storage.activeIndex = (self.storage.activeIndex - 1 + n) % n;
                paint(editor, self.storage.activeIndex);
                scrollSearchMatchIntoView(editor, self.storage.matches[self.storage.activeIndex]);
                return true;
            },
            // Doc-changing commands MUST mutate the transaction the command
            // manager gives them (not dispatch a separate one) — otherwise the
            // manager's own trailing dispatch applies against a stale doc and
            // ProseMirror throws "Applying a mismatched transaction". The bridge
            // recomputes matches + repaints after the edit lands.
            replaceCurrent: (replacement) => ({ tr, dispatch }) => {
                const match = self.storage.matches[self.storage.activeIndex];
                if (!match) return false;
                if (dispatch) tr.insertText(replacement == null ? '' : String(replacement), match.from, match.to);
                return true;
            },
            replaceAllMatches: (replacement) => ({ tr, dispatch }) => {
                const matches = self.storage.matches;
                if (!matches.length) return false;
                if (dispatch) {
                    const text = replacement == null ? '' : String(replacement);
                    // Apply back-to-front so earlier match positions stay valid.
                    for (let i = matches.length - 1; i >= 0; i--) {
                        tr.insertText(text, matches[i].from, matches[i].to);
                    }
                }
                return true;
            },
            clearSearch: () => ({ editor }) => {
                self.storage.query = '';
                self.storage.matches = [];
                self.storage.activeIndex = -1;
                const tr = editor.state.tr.setMeta(sutraSearchKey, { clear: true });
                tr.setMeta('addToHistory', false);
                editor.view.dispatch(tr);
                return true;
            },
        };
    },
});

/* ---- Resizable / alignable image (Docs-grade image handling) ---- */
function normalizedWidth(width) {
    if (!width) return '';
    return /^\d+$/.test(String(width)) ? width + 'px' : String(width);
}

const SutraImage = Image.extend({
    draggable: true,
    addAttributes() {
        const parent = typeof this.parent === 'function' ? (this.parent() || {}) : {};
        return Object.assign({}, parent, {
            width: {
                default: null,
                parseHTML: (el) => (el.style && el.style.width) || el.getAttribute('width') || null,
                renderHTML: (attrs) => (attrs.width ? { style: 'width: ' + normalizedWidth(attrs.width) } : {}),
            },
            align: {
                default: null,
                parseHTML: (el) => el.getAttribute('data-align') || null,
                renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
            },
        });
    },
    addNodeView() {
        return function (props) {
            const editor = props.editor;
            const getPos = props.getPos;
            let current = props.node;

            const wrap = document.createElement('span');
            wrap.className = 'sutra-img-wrap';
            const img = document.createElement('img');
            const handle = document.createElement('span');
            handle.className = 'sutra-img-resize';
            handle.setAttribute('aria-hidden', 'true');

            function apply(node) {
                img.src = node.attrs.src || '';
                if (node.attrs.alt != null) img.alt = node.attrs.alt; else img.removeAttribute('alt');
                if (node.attrs.title != null) img.title = node.attrs.title; else img.removeAttribute('title');
                img.style.width = node.attrs.width ? normalizedWidth(node.attrs.width) : '';
                wrap.setAttribute('data-align', node.attrs.align || 'left');
            }
            apply(current);
            wrap.appendChild(img);
            wrap.appendChild(handle);

            let startX = 0;
            let startW = 0;
            function onMove(e) {
                const dx = e.clientX - startX;
                img.style.width = Math.max(40, Math.round(startW + dx)) + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup', onUp, true);
                const w = parseInt(img.style.width, 10);
                if (Number.isFinite(w) && typeof getPos === 'function') {
                    const pos = getPos();
                    if (pos != null) {
                        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined,
                            Object.assign({}, current.attrs, { width: w + 'px' })));
                    }
                }
            }
            handle.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();
                startX = e.clientX;
                startW = img.getBoundingClientRect().width;
                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('mouseup', onUp, true);
            });

            return {
                dom: wrap,
                update: function (node) {
                    if (node.type.name !== current.type.name) return false;
                    current = node;
                    apply(node);
                    return true;
                },
                selectNode: function () { wrap.classList.add('is-selected'); },
                deselectNode: function () { wrap.classList.remove('is-selected'); },
                stopEvent: function (e) { return e.target === handle; },
                ignoreMutation: function (m) { return m.type !== 'selection'; },
            };
        };
    },
});

/**
 * Build the default Sutra extension set. Callers can pass overrides:
 *   placeholder  – string shown on the empty document
 *   extraExtensions – array of additional TipTap extensions (e.g. embed NodeViews)
 */
function buildExtensions(options = {}) {
    const extensions = [
        StarterKit.configure({
            // Sutra styles heading levels 1-3 only.
            heading: { levels: [1, 2, 3] },
            link: {
                openOnClick: false, // Sutra handles link opening itself (Ctrl+Click)
                autolink: true,
                defaultProtocol: 'https',
            },
            // Keep the trailing paragraph so the caret can always leave a
            // table/image at the end of the document.
            trailingNode: { node: 'paragraph', notAfter: ['paragraph'] },
        }),
        TableKit.configure({
            table: { resizable: true, lastColumnResizable: true, allowTableNodeSelection: true },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        SutraImage.configure({ inline: false, allowBase64: true }),
        Typography,
        TextStyleKit,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Subscript,
        Superscript,
        Selection,
        CharacterCount,
        SutraIndent,
        SutraLineHeight,
        SutraDocsKeymap,
        SutraSearch,
        Placeholder.configure({
            placeholder: options.placeholder || 'Start writing…',
            includeChildren: true,
        }),
    ];
    if (Array.isArray(options.extraExtensions)) {
        extensions.push(...options.extraExtensions);
    }
    return extensions;
}

/**
 * Create a Sutra editor on `element`.
 * options: { content, editable, placeholder, extraExtensions, onUpdate,
 *            onSelectionUpdate, onTransaction, onFocus, onBlur, editorProps }
 */
function create(element, options = {}) {
    const config = {
        element,
        extensions: buildExtensions(options),
        content: options.content || '',
        editable: options.editable !== false,
        editorProps: options.editorProps || {},
    };
    // Only forward callbacks that are real functions — TipTap registers every
    // provided handler as an event listener, and an undefined listener crashes
    // emit() the first time that event fires.
    for (const key of ['onUpdate', 'onSelectionUpdate', 'onTransaction', 'onFocus', 'onBlur', 'onCreate']) {
        if (typeof options[key] === 'function') config[key] = options[key];
    }
    return new Editor(config);
}

export {
    create,
    buildExtensions,
    // Core classes for integration code (custom nodes / NodeViews / plugins).
    Editor,
    Extension,
    Node,
    Mark,
    mergeAttributes,
    InputRule,
    textInputRule,
    markInputRule,
    nodeInputRule,
    wrappingInputRule,
    Plugin,
    PluginKey,
    PMDOMParser,
    PMDOMSerializer,
    // Positioning / selection / decoration helpers for hand-rolled UI
    // (bubble menu, slash menu, drag handles, NodeViews).
    posToDOMRect,
    isNodeSelection,
    findParentNode,
    NodeView,
    ResizableNodeView,
    Decoration,
    DecorationSet,
    TextSelection,
    NodeSelection,
};

export const version = '3.27.3';
