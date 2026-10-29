/*
 * Sutra Command Center — shared UI foundation for the College, Life, and
 * Business "mini operating system" tabs.
 *
 * This module owns NO application data. It provides reusable, theme-aware,
 * accessible UI primitives that app.js (and business-workspace.js) compose:
 *   - signal cards / intelligence dashboard grid (pure HTML builders)
 *   - a single reusable detail/profile drawer with focus trapping, Escape,
 *     reduced-motion support and ARIA wiring
 *   - small date / money / tone helpers used by all three tabs
 *
 * It is loaded BEFORE app.js so the core can call window.SutraCommandCenter
 * through *Safe() wrappers. Every browser API touch is guarded so a load
 * failure can never take down the host app. The pure helpers are also exported
 * for Node so the engines check + e2e fixtures can exercise them headlessly.
 */
(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Pure helpers (safe in Node + browser; no DOM access)
    // ---------------------------------------------------------------------

    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    }

    function toPercent(part, whole) {
        const p = Number(part);
        const w = Number(whole);
        if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
        return Math.max(0, Math.min(100, Math.round((p / w) * 100)));
    }

    // Parse a 'YYYY-MM-DD' (local) or ISO timestamp into a Date at local
    // midnight for day-granularity math. Returns null for empty/invalid input.
    function parseLocalDate(value) {
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return null;
        const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (ymd) {
            const y = Number(ymd[1]);
            const m = Number(ymd[2]) - 1;
            const d = Number(ymd[3]);
            const dt = new Date(y, m, d);
            return Number.isNaN(dt.getTime()) ? null : dt;
        }
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    function startOfToday(now) {
        const base = now instanceof Date ? now : new Date();
        return new Date(base.getFullYear(), base.getMonth(), base.getDate());
    }

    // Whole-day delta from today to the given date. Negative = past.
    function daysUntil(value, now) {
        const target = parseLocalDate(value);
        if (!target) return null;
        const today = startOfToday(now);
        return Math.round((target.getTime() - today.getTime()) / 86400000);
    }

    // A coarse tone bucket for a deadline, used for chip colouring.
    // 'overdue' | 'today' | 'soon' (<=3d) | 'near' (<=14d) | 'far' | 'none'
    function deadlineTone(value, now) {
        const d = daysUntil(value, now);
        if (d === null) return 'none';
        if (d < 0) return 'overdue';
        if (d === 0) return 'today';
        if (d <= 3) return 'soon';
        if (d <= 14) return 'near';
        return 'far';
    }

    function relativeDayLabel(value, now) {
        const d = daysUntil(value, now);
        if (d === null) return '';
        if (d === 0) return 'Today';
        if (d === 1) return 'Tomorrow';
        if (d === -1) return 'Yesterday';
        if (d < 0) return `${Math.abs(d)}d ago`;
        if (d <= 30) return `In ${d}d`;
        if (d <= 60) return 'In ~1mo';
        const months = Math.round(d / 30);
        return `In ~${months}mo`;
    }

    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function formatShortDate(value) {
        const d = parseLocalDate(value);
        if (!d) return '';
        return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    }

    function formatMoney(amount, currency) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '';
        const code = String(currency || 'USD').toUpperCase();
        const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', INR: '₹' };
        const symbol = symbols[code] || '';
        const rounded = Math.round(n);
        const grouped = rounded.toLocaleString('en-US');
        return symbol ? `${symbol}${grouped}` : `${grouped} ${code}`;
    }

    function escapeHtml(value) {
        if (typeof globalThis !== 'undefined' && typeof globalThis.escapeHtml === 'function' && globalThis.escapeHtml !== escapeHtml) {
            try { return globalThis.escapeHtml(value); } catch (_) { /* fall through */ }
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------------------
    // Signal cards — the intelligence dashboard grid (pure HTML builders)
    // ---------------------------------------------------------------------
    //
    // A signal:
    //   { id, icon, label, value, meta, tone, progress, action, target,
    //     ariaLabel, hint }
    // Actionable signals (with `action`) render as <button> so they are
    // natively keyboard-operable; the host's delegated click handler reacts to
    // [data-cc-action] / [data-cc-target]. Non-actionable signals render as
    // <div role="group">.

    const TONES = new Set(['neutral', 'positive', 'warn', 'danger', 'info', 'accent']);
    function normalizeTone(tone) {
        const t = String(tone || 'neutral').toLowerCase();
        return TONES.has(t) ? t : 'neutral';
    }

    function signalCardHtml(signal) {
        if (!signal || typeof signal !== 'object') return '';
        const tone = normalizeTone(signal.tone);
        const icon = signal.icon ? `<span class="cc-signal-icon" aria-hidden="true"><i class="fas ${escapeHtml(signal.icon)}"></i></span>` : '';
        const label = signal.label ? `<span class="cc-signal-label">${escapeHtml(signal.label)}</span>` : '';
        const value = (signal.value !== undefined && signal.value !== null && signal.value !== '')
            ? `<span class="cc-signal-value">${escapeHtml(signal.value)}</span>`
            : '<span class="cc-signal-value cc-signal-value-empty">—</span>';
        const meta = signal.meta ? `<span class="cc-signal-meta">${escapeHtml(signal.meta)}</span>` : '';
        let progress = '';
        if (isFiniteNumber(Number(signal.progress)) && signal.progress !== '' && signal.progress !== null && signal.progress !== undefined) {
            const pct = clampNumber(signal.progress, 0, 100, 0);
            progress = `<span class="cc-signal-progress" role="presentation"><span class="cc-signal-progress-fill" style="width:${pct}%"></span></span>`;
        }
        const actionable = !!signal.action;
        const dataAttrs = [
            signal.action ? `data-cc-action="${escapeHtml(signal.action)}"` : '',
            signal.target ? `data-cc-target="${escapeHtml(signal.target)}"` : '',
            signal.id ? `data-cc-signal="${escapeHtml(signal.id)}"` : ''
        ].filter(Boolean).join(' ');
        const aria = signal.ariaLabel
            ? `aria-label="${escapeHtml(signal.ariaLabel)}"`
            : '';
        const title = signal.hint ? `title="${escapeHtml(signal.hint)}"` : '';
        const inner = `${icon}<span class="cc-signal-body">${label}${value}${meta}${progress}</span>`;
        if (actionable) {
            return `<button type="button" class="cc-signal-card cc-tone-${tone}" ${dataAttrs} ${aria} ${title}>${inner}<span class="cc-signal-go" aria-hidden="true"><i class="fas fa-chevron-right"></i></span></button>`;
        }
        return `<div class="cc-signal-card cc-tone-${tone}" role="group" ${dataAttrs} ${aria} ${title}>${inner}</div>`;
    }

    function signalGridHtml(signals, options) {
        const opts = options || {};
        const list = Array.isArray(signals) ? signals.filter(Boolean) : [];
        if (!list.length) {
            if (opts.emptyHtml) return opts.emptyHtml;
            return '';
        }
        const cls = ['cc-signal-grid'];
        if (opts.dense) cls.push('cc-signal-grid-dense');
        if (opts.className) cls.push(opts.className);
        return `<div class="${cls.join(' ')}">${list.map(signalCardHtml).join('')}</div>`;
    }

    // Empty-state block: { icon, title, message, actionLabel, action, target }
    function emptyStateHtml(config) {
        const c = config || {};
        const icon = c.icon ? `<div class="cc-empty-icon" aria-hidden="true"><i class="fas ${escapeHtml(c.icon)}"></i></div>` : '';
        const title = c.title ? `<div class="cc-empty-title">${escapeHtml(c.title)}</div>` : '';
        const message = c.message ? `<div class="cc-empty-message">${escapeHtml(c.message)}</div>` : '';
        let action = '';
        if (c.actionLabel && c.action) {
            const target = c.target ? `data-cc-target="${escapeHtml(c.target)}"` : '';
            action = `<button type="button" class="cc-empty-action neumo-btn" data-cc-action="${escapeHtml(c.action)}" ${target}><i class="fas fa-plus" aria-hidden="true"></i> ${escapeHtml(c.actionLabel)}</button>`;
        }
        return `<div class="cc-empty-state">${icon}${title}${message}${action}</div>`;
    }

    // Small status pill — { label, tone }
    function pillHtml(label, tone) {
        return `<span class="cc-pill cc-tone-${normalizeTone(tone)}">${escapeHtml(label)}</span>`;
    }

    // ---------------------------------------------------------------------
    // Reusable detail / profile drawer (browser only)
    // ---------------------------------------------------------------------

    const hasDom = (typeof document !== 'undefined' && document && typeof document.createElement === 'function');

    const Drawer = (function () {
        let overlayEl = null;
        let panelEl = null;
        let titleEl = null;
        let eyebrowEl = null;
        let bodyEl = null;
        let footerEl = null;
        let closeBtnEl = null;
        let lastFocus = null;
        let currentConfig = null;
        let boundChange = null;
        let boundClick = null;
        let boundInput = null;
        let open = false;

        function prefersReducedMotion() {
            try {
                return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            } catch (_) { return false; }
        }

        function ensureDom() {
            if (!hasDom || overlayEl) return;
            overlayEl = document.createElement('div');
            overlayEl.className = 'cc-drawer-overlay';
            overlayEl.setAttribute('hidden', 'hidden');
            overlayEl.innerHTML = [
                '<div class="cc-drawer" role="dialog" aria-modal="true" aria-labelledby="ccDrawerTitle" tabindex="-1">',
                '  <header class="cc-drawer-head">',
                '    <div class="cc-drawer-head-text">',
                '      <div class="cc-drawer-eyebrow" id="ccDrawerEyebrow"></div>',
                '      <h2 class="cc-drawer-title" id="ccDrawerTitle"></h2>',
                '    </div>',
                '    <button type="button" class="cc-drawer-close" aria-label="Close panel"><i class="fas fa-times" aria-hidden="true"></i></button>',
                '  </header>',
                '  <div class="cc-drawer-body" id="ccDrawerBody"></div>',
                '  <footer class="cc-drawer-foot" id="ccDrawerFoot" hidden></footer>',
                '</div>'
            ].join('');
            document.body.appendChild(overlayEl);
            panelEl = overlayEl.querySelector('.cc-drawer');
            titleEl = overlayEl.querySelector('#ccDrawerTitle');
            eyebrowEl = overlayEl.querySelector('#ccDrawerEyebrow');
            bodyEl = overlayEl.querySelector('#ccDrawerBody');
            footerEl = overlayEl.querySelector('#ccDrawerFoot');
            closeBtnEl = overlayEl.querySelector('.cc-drawer-close');

            closeBtnEl.addEventListener('click', () => close());
            overlayEl.addEventListener('mousedown', (e) => {
                if (e.target === overlayEl) close();
            });
            overlayEl.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
                if (e.key === 'Tab') trapFocus(e);
            });
        }

        function focusables() {
            if (!panelEl) return [];
            return Array.from(panelEl.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                .filter(el => el.offsetParent !== null || el === document.activeElement);
        }

        function trapFocus(e) {
            const items = focusables();
            if (!items.length) { e.preventDefault(); panelEl.focus(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        function detachHandlers() {
            if (!bodyEl) return;
            if (boundChange) { bodyEl.removeEventListener('change', boundChange); boundChange = null; }
            if (boundClick) { bodyEl.removeEventListener('click', boundClick); boundClick = null; }
            if (boundInput) { bodyEl.removeEventListener('input', boundInput); boundInput = null; }
        }

        function setBody(html) {
            ensureDom();
            if (!bodyEl) return;
            bodyEl.innerHTML = typeof html === 'string' ? html : '';
        }

        function setFooter(html) {
            ensureDom();
            if (!footerEl) return;
            if (html) { footerEl.innerHTML = html; footerEl.hidden = false; }
            else { footerEl.innerHTML = ''; footerEl.hidden = true; }
        }

        function setTitle(title, eyebrow) {
            ensureDom();
            if (titleEl) titleEl.textContent = title == null ? '' : String(title);
            if (eyebrowEl) {
                const e = eyebrow == null ? '' : String(eyebrow);
                eyebrowEl.textContent = e;
                eyebrowEl.hidden = !e;
            }
        }

        function openDrawer(config) {
            if (!hasDom) return null;
            ensureDom();
            currentConfig = config || {};
            lastFocus = document.activeElement;

            panelEl.classList.toggle('cc-drawer-lg', currentConfig.width === 'lg');
            setTitle(currentConfig.title || '', currentConfig.eyebrow || '');
            setBody(currentConfig.bodyHtml || '');
            setFooter(currentConfig.footerHtml || '');

            detachHandlers();
            if (typeof currentConfig.onChange === 'function') {
                boundChange = (e) => currentConfig.onChange(e);
                bodyEl.addEventListener('change', boundChange);
            }
            if (typeof currentConfig.onClick === 'function') {
                boundClick = (e) => currentConfig.onClick(e);
                bodyEl.addEventListener('click', boundClick);
            }
            if (typeof currentConfig.onInput === 'function') {
                boundInput = (e) => currentConfig.onInput(e);
                bodyEl.addEventListener('input', boundInput);
            }

            overlayEl.removeAttribute('hidden');
            if (prefersReducedMotion()) overlayEl.classList.add('cc-no-motion');
            else overlayEl.classList.remove('cc-no-motion');
            // Force reflow so the open transition runs.
            void overlayEl.offsetWidth;
            overlayEl.classList.add('cc-drawer-open');
            document.body.classList.add('cc-drawer-active');
            open = true;

            // Move focus into the panel.
            window.setTimeout(() => {
                const initial = currentConfig.initialFocus && panelEl.querySelector(currentConfig.initialFocus);
                if (initial && typeof initial.focus === 'function') initial.focus();
                else if (closeBtnEl) closeBtnEl.focus();
                else panelEl.focus();
            }, prefersReducedMotion() ? 0 : 30);

            // Enhance any date/select inputs the host relies on.
            try {
                if (typeof window.enhanceDateInputsIn === 'function') window.enhanceDateInputsIn(bodyEl);
                if (typeof window.enhanceSelectsIn === 'function') window.enhanceSelectsIn(bodyEl);
            } catch (_) { /* enhancement is best-effort */ }

            return { close, setBody: refreshBody, setFooter, setTitle, getPanel: () => panelEl };
        }

        // Re-render the body for the currently open drawer (used after inline
        // edits) while keeping handlers + focus context intact.
        function refreshBody(html) {
            if (!open) return;
            setBody(html);
            try {
                if (typeof window.enhanceDateInputsIn === 'function') window.enhanceDateInputsIn(bodyEl);
                if (typeof window.enhanceSelectsIn === 'function') window.enhanceSelectsIn(bodyEl);
            } catch (_) { /* best effort */ }
        }

        function close() {
            if (!open || !overlayEl) return;
            open = false;
            overlayEl.classList.remove('cc-drawer-open');
            document.body.classList.remove('cc-drawer-active');
            const cfg = currentConfig;
            currentConfig = null;
            detachHandlers();
            const finalize = () => {
                if (!open) overlayEl.setAttribute('hidden', 'hidden');
            };
            if (prefersReducedMotion()) finalize();
            else window.setTimeout(finalize, 220);
            if (lastFocus && typeof lastFocus.focus === 'function') {
                try { lastFocus.focus(); } catch (_) { /* ignore */ }
            }
            lastFocus = null;
            if (cfg && typeof cfg.onClose === 'function') {
                try { cfg.onClose(); } catch (_) { /* ignore */ }
            }
        }

        return {
            open: openDrawer,
            close,
            setBody: refreshBody,
            setFooter,
            setTitle,
            isOpen: () => open,
            getPanel: () => panelEl,
            getBody: () => bodyEl
        };
    })();

    // ---------------------------------------------------------------------
    // Saved views / smart filter helpers (pure)
    // ---------------------------------------------------------------------
    //
    // A normalized saved view: { id, name, filters:{}, sort:'' }. These helpers
    // keep the shape consistent across tabs; the host owns persistence.

    function normalizeSavedView(view, makeId) {
        const v = view && typeof view === 'object' ? view : {};
        const id = v.id || (typeof makeId === 'function' ? makeId() : `view-${Math.abs(hashString(JSON.stringify(v.filters || {}) + (v.name || '')))}`);
        return {
            id: String(id),
            name: String(v.name || 'Saved view').slice(0, 80),
            filters: v.filters && typeof v.filters === 'object' ? { ...v.filters } : {},
            sort: String(v.sort || '')
        };
    }

    function hashString(str) {
        let h = 0;
        const s = String(str || '');
        for (let i = 0; i < s.length; i += 1) {
            h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        }
        return h;
    }

    // ---------------------------------------------------------------------
    // Public surface
    // ---------------------------------------------------------------------

    const api = {
        version: 1,
        // pure helpers
        clampNumber,
        toPercent,
        parseLocalDate,
        daysUntil,
        deadlineTone,
        relativeDayLabel,
        formatShortDate,
        formatMoney,
        escapeHtml,
        hashString,
        normalizeSavedView,
        // html builders
        signalCardHtml,
        signalGridHtml,
        emptyStateHtml,
        pillHtml,
        // drawer (no-ops in Node)
        drawer: Drawer,
        openDrawer: Drawer.open,
        closeDrawer: Drawer.close
    };

    if (typeof window !== 'undefined') {
        window.SutraCommandCenter = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
