/* ===========================================================================
 * NoteFlow Atelier — Mods & Customization (CSS overrides + Safe Mode) engine
 * ---------------------------------------------------------------------------
 * Dependency-free, file://-safe module exposed as `window.AtelierCustomization`.
 *
 * Owns: the custom-CSS injection layer (deterministic <style> ids, applied AFTER
 * theme styles so overrides survive theme changes + refresh), snippet
 * normalization, live preview, lightweight validation, .css / JSON import-export
 * helpers, and Safe Mode detection.
 *
 * It does NOT own persistence — snippet data lives in appData.settings.customization
 * (managed by src/core/app.js). This module is the deterministic apply/remove
 * engine the app drives.
 *
 * Safety: Safe Mode (URL ?sutraSafeMode=1 or legacy ?atelierSafeMode=1, held Shift at load, or a sticky
 * session flag) bypasses ALL injection so imported/broken CSS can never create an
 * unrecoverable, hidden-interface startup loop. Data is never deleted by Safe Mode.
 * ======================================================================== */
(function (global) {
    'use strict';

    var ROOT_STYLE_ID = 'atelier-user-css';
    var SNIPPET_STYLE_PREFIX = 'atelier-user-css-snippet-';
    var PREVIEW_STYLE_ID = 'atelier-user-css-preview';
    var SAFE_MODE_SESSION_KEY = 'atelier_safe_mode';

    function uid() {
        var r = '';
        try {
            if (global.crypto && global.crypto.getRandomValues) {
                var a = new Uint32Array(2);
                global.crypto.getRandomValues(a);
                r = a[0].toString(36) + a[1].toString(36);
            }
        } catch (e) {}
        if (!r) r = Math.floor((1 + (typeof performance !== 'undefined' && performance.now ? performance.now() : 0)) * 1e6).toString(36);
        return 'css_' + r;
    }
    function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }
    function asString(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

    /* ---- Snippet normalization ------------------------------------------- */

    function normalizeSnippet(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        var css = asString(raw.css);
        var name = asString(raw.name).trim() || ('Snippet ' + (index + 1));
        return {
            id: (typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
            name: name.slice(0, 80),
            css: css,
            enabled: raw.enabled !== false,
            order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
            createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso()
        };
    }

    function normalizeSnippets(rawList) {
        var src = Array.isArray(rawList) ? rawList : [];
        var seen = Object.create(null);
        var out = [];
        for (var i = 0; i < src.length; i++) {
            var s = normalizeSnippet(src[i], i);
            if (!s) continue;
            if (seen[s.id]) s.id = uid();
            seen[s.id] = true;
            out.push(s);
        }
        out.sort(function (a, b) { return a.order - b.order; });
        out.forEach(function (s, idx) { s.order = idx; });
        return out;
    }

    function normalizeCustomization(raw) {
        var r = raw && typeof raw === 'object' ? raw : {};
        return {
            modsEnabled: r.modsEnabled !== false,
            customCssEnabled: r.customCssEnabled !== false,
            cssSnippets: normalizeSnippets(r.cssSnippets),
            installedPlugins: Array.isArray(r.installedPlugins) ? r.installedPlugins : [],
            // Plugins are a de-emphasized, experimental developer surface. The plugin
            // controls stay hidden (Settings ▸ Advanced ▸ Developer / Experimental)
            // until the user explicitly opts in. Default OFF; never touched by onboarding.
            pluginsExperimentalEnabled: r.pluginsExperimentalEnabled === true
        };
    }

    /* ---- Safe Mode -------------------------------------------------------- */

    function detectSafeMode() {
        try {
            var qs = (global.location && global.location.search) || '';
            // Canonical Sutra param + legacy NoteFlow Atelier param both honored.
            if (/[?&](?:sutra|atelier)SafeMode=1\b/.test(qs)) { setSafeModeSticky(true); return true; }
            if (/[?&](?:sutra|atelier)SafeMode=0\b/.test(qs)) { setSafeModeSticky(false); return false; }
        } catch (e) {}
        // Sticky session flag (set when entering recovery from the banner).
        try {
            if (global.sessionStorage && global.sessionStorage.getItem(SAFE_MODE_SESSION_KEY) === '1') return true;
        } catch (e) {}
        return false;
    }
    function setSafeModeSticky(on) {
        try {
            if (!global.sessionStorage) return;
            if (on) global.sessionStorage.setItem(SAFE_MODE_SESSION_KEY, '1');
            else global.sessionStorage.removeItem(SAFE_MODE_SESSION_KEY);
        } catch (e) {}
    }
    // Internal latch so a Shift-at-load can be recorded by the host very early.
    var _shiftSafeMode = false;
    function noteShiftHeld() { _shiftSafeMode = true; setSafeModeSticky(true); }
    function isSafeMode() {
        // Honor an early Shift-at-load flag set by the inline head listener.
        try { if (global.__atelierShiftSafeMode === true) _shiftSafeMode = true; } catch (e) {}
        return _shiftSafeMode || detectSafeMode();
    }

    /* ---- CSS injection ---------------------------------------------------- */

    function head() { return document.head || document.getElementsByTagName('head')[0] || document.documentElement; }

    function ensureRootMarker() {
        var el = document.getElementById(ROOT_STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = ROOT_STYLE_ID;
            el.setAttribute('data-atelier-user-css', 'root');
            el.textContent = '/* Sutra — user CSS overrides anchor. Per-snippet styles follow. */';
            head().appendChild(el);
        }
        return el;
    }

    function snippetStyleId(id) { return SNIPPET_STYLE_PREFIX + String(id || '').replace(/[^a-zA-Z0-9_-]/g, ''); }

    // Apply the full snippet set. Safe Mode or disabled flags => remove everything.
    // Order is preserved (cascade), each enabled snippet in its own deterministic
    // <style> appended AFTER the root marker so it wins over built-in + theme CSS.
    function applyCss(snippets, options) {
        options = options || {};
        removeAllCss();
        if (isSafeMode()) return { applied: 0, safeMode: true };
        if (options.modsEnabled === false || options.customCssEnabled === false) return { applied: 0 };
        var list = normalizeSnippets(snippets);
        var marker = ensureRootMarker();
        var applied = 0;
        var ref = marker;
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (!s.enabled || !s.css.trim()) continue;
            var el = document.createElement('style');
            el.id = snippetStyleId(s.id);
            el.setAttribute('data-atelier-user-css', 'snippet');
            el.setAttribute('data-snippet-id', s.id);
            el.textContent = s.css;
            // Insert right after the previous applied node to keep cascade order.
            if (ref.nextSibling) ref.parentNode.insertBefore(el, ref.nextSibling);
            else head().appendChild(el);
            ref = el;
            applied++;
        }
        return { applied: applied };
    }

    function removeAllCss() {
        var nodes = document.querySelectorAll('style[data-atelier-user-css]');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === PREVIEW_STYLE_ID) continue; // preview managed separately
            if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        }
    }

    /* ---- Live preview ----------------------------------------------------- */

    function previewCss(css) {
        var el = document.getElementById(PREVIEW_STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = PREVIEW_STYLE_ID;
            el.setAttribute('data-atelier-user-css', 'preview');
            head().appendChild(el);
        } else if (el.nextSibling) {
            // keep preview last so it visibly wins while previewing
            el.parentNode.appendChild(el);
        }
        el.textContent = asString(css);
    }
    function clearPreview() {
        var el = document.getElementById(PREVIEW_STYLE_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    function isPreviewing() { return !!document.getElementById(PREVIEW_STYLE_ID); }

    /* ---- Validation ------------------------------------------------------- */

    // Lightweight, dependency-free CSS sanity check. Reports unbalanced braces and
    // obviously truncated declarations. NOT a full parser — just enough to catch
    // the common mistakes that would silently break a snippet.
    function validateCss(css) {
        var text = asString(css);
        var depth = 0, line = 1, inString = false, strCh = '', inComment = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i], nx = text[i + 1];
            if (ch === '\n') line++;
            if (inComment) { if (ch === '*' && nx === '/') { inComment = false; i++; } continue; }
            if (inString) { if (ch === strCh && text[i - 1] !== '\\') inString = false; continue; }
            if (ch === '/' && nx === '*') { inComment = true; i++; continue; }
            if (ch === '"' || ch === "'") { inString = true; strCh = ch; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth < 0) return { valid: false, message: 'Unexpected "}" on line ' + line }; }
        }
        if (inString) return { valid: false, message: 'Unterminated string literal' };
        if (inComment) return { valid: false, message: 'Unterminated /* comment */' };
        if (depth > 0) return { valid: false, message: depth + ' unclosed "{" — add ' + depth + ' closing brace' + (depth > 1 ? 's' : '') };
        return { valid: true, message: 'Looks good.' };
    }

    /* ---- Import / export -------------------------------------------------- */

    function exportSnippetCss(snippet) {
        var s = normalizeSnippet(snippet, 0);
        if (!s) return '';
        return '/* ' + s.name.replace(/\*\//g, '* /') + ' — Sutra CSS snippet */\n' + s.css + '\n';
    }
    function exportAllJson(snippets, meta) {
        return JSON.stringify({
            format: 'noteflow_atelier_css',
            formatVersion: 1,
            exportedAt: (meta && meta.exportedAt) || '',
            snippets: normalizeSnippets(snippets).map(function (s) {
                return { name: s.name, css: s.css, enabled: s.enabled, order: s.order };
            })
        }, null, 2);
    }
    function importCssAsSnippet(text, name) {
        var css = asString(text);
        return normalizeSnippet({ name: asString(name).trim() || 'Imported CSS', css: css, enabled: false }, 0);
    }
    function importJson(text) {
        var data;
        try { data = JSON.parse(asString(text)); } catch (e) { return { ok: false, error: 'Not valid JSON.' }; }
        if (!data || typeof data !== 'object') return { ok: false, error: 'Unexpected file contents.' };
        // Format value stays 'noteflow_atelier_css' for backward compatibility with older CSS exports.
        if (data.format && data.format !== 'noteflow_atelier_css') return { ok: false, error: 'Not a valid Sutra CSS export.' };
        var list = Array.isArray(data.snippets) ? data.snippets : [];
        if (!list.length) return { ok: false, error: 'No snippets found in file.' };
        return { ok: true, snippets: normalizeSnippets(list) };
    }

    // A safe, disabled-by-default starter snippet for the empty state.
    function exampleSnippet() {
        return normalizeSnippet({
            name: 'Example: Compact sidebar',
            enabled: false,
            css: [
                '/* Example override — enable to apply. Tightens the sidebar. */',
                '.sidebar, .cc-sidebar { --sidebar-gap: 2px; }',
                '.sidebar-item, .cc-sidebar-item { padding-top: 5px; padding-bottom: 5px; }'
            ].join('\n')
        }, 0);
    }

    /* ---- Curated snippet gallery ----------------------------------------- */
    // A small, hand-vetted set of safe presets for the CSS Overrides gallery. Each
    // is CSS-only, reversible, targets documented tokens/selectors (see
    // docs/features/CSS_MODS_GUIDE.md), and never hides an interactive control.
    // These are DATA — the host renders them as one-click "add snippet" cards.
    function snippetGallery() {
        return [
            {
                id: 'compact-sidebar',
                name: 'Compact Sidebar',
                description: 'Narrower sidebar and tighter item spacing.',
                css: [
                    '/* Compact Sidebar — reads Sutra’s own width token, so it stays consistent. */',
                    ':root { --sidebar-width: 244px; }',
                    '.sidebar-item, .cc-sidebar-item { padding-top: 5px; padding-bottom: 5px; }'
                ].join('\n')
            },
            {
                id: 'bigger-editor-text',
                name: 'Bigger Editor Text',
                description: 'Larger, roomier body text in the note editor.',
                css: [
                    '/* Bigger Editor Text — scoped to the writing surface only. */',
                    '#view-notes .editor { font-size: 1.08em; line-height: 1.75; }'
                ].join('\n')
            },
            {
                id: 'minimal-today',
                name: 'Minimal Home View',
                description: 'Flatter, quieter Home panels — no controls hidden.',
                css: [
                    '/* Minimal Today View — removes card chrome; every control stays clickable. */',
                    '#view-today .today-panel {',
                    '  box-shadow: none;',
                    '  border: 1px solid var(--border, rgba(120,130,150,0.18));',
                    '  background: transparent;',
                    '}'
                ].join('\n')
            },
            {
                id: 'softer-cards',
                name: 'Softer Cards',
                description: 'Gentler shadows and rounder corners across surfaces.',
                css: [
                    '/* Softer Cards — token-only, theme-aware. */',
                    ':root {',
                    '  --shadow-soft: 0 8px 20px rgba(22, 30, 45, 0.05);',
                    '  --shadow-soft-lg: 0 16px 36px rgba(22, 30, 45, 0.08);',
                    '  --radius: 20px;',
                    '  --radius-lg: 30px;',
                    '}'
                ].join('\n')
            },
            {
                id: 'high-contrast',
                name: 'High Contrast',
                description: 'Stronger text and borders. Pairs best with a Dark theme.',
                css: [
                    '/* High Contrast — token-only. Tuned for dark themes; adjust for light. */',
                    ':root {',
                    '  --text-primary: #ffffff;',
                    '  --text-secondary: #e6e6e6;',
                    '  --text-muted: #c8c8c8;',
                    '  --border: rgba(255, 255, 255, 0.4);',
                    '  --surface-border: rgba(255, 255, 255, 0.4);',
                    '}'
                ].join('\n')
            },
            {
                id: 'calm-focus',
                name: 'Calm Focus Mode',
                description: 'Slower motion and quieter accent washes for calmer focus.',
                css: [
                    '/* Calm Focus Mode — softens motion + accent tints; nothing disabled. */',
                    ':root {',
                    '  --transition-fast: 220ms cubic-bezier(0.22, 1, 0.36, 1);',
                    '  --transition-base: 320ms cubic-bezier(0.22, 1, 0.36, 1);',
                    '  --accent-soft: rgba(var(--accent-rgb), 0.06);',
                    '}'
                ].join('\n')
            }
        ];
    }

    global.AtelierCustomization = {
        ROOT_STYLE_ID: ROOT_STYLE_ID,
        SNIPPET_STYLE_PREFIX: SNIPPET_STYLE_PREFIX,
        PREVIEW_STYLE_ID: PREVIEW_STYLE_ID,
        uid: uid,
        normalizeSnippet: normalizeSnippet,
        normalizeSnippets: normalizeSnippets,
        normalizeCustomization: normalizeCustomization,
        isSafeMode: isSafeMode,
        detectSafeMode: detectSafeMode,
        setSafeModeSticky: setSafeModeSticky,
        noteShiftHeld: noteShiftHeld,
        applyCss: applyCss,
        removeAllCss: removeAllCss,
        previewCss: previewCss,
        clearPreview: clearPreview,
        isPreviewing: isPreviewing,
        validateCss: validateCss,
        exportSnippetCss: exportSnippetCss,
        exportAllJson: exportAllJson,
        importCssAsSnippet: importCssAsSnippet,
        importJson: importJson,
        exampleSnippet: exampleSnippet,
        snippetGallery: snippetGallery
    };
})(typeof window !== 'undefined' ? window : this);
