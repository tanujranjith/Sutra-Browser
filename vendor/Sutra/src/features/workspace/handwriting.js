/* ===========================================================================
 * NoteFlow Atelier — Handwriting & Drawing engine
 * ---------------------------------------------------------------------------
 * Pure, dependency-free, file://-safe module exposed as `window.AtelierHandwriting`.
 *
 * It owns ONLY the vector-stroke data model, theme-aware canvas rendering, and a
 * pointer-driven drawing controller. It deliberately knows NOTHING about pages,
 * persistence, IndexedDB or the editor — the app (src/core/app.js) wires this into
 * the note "drawing" block lifecycle and calls back into its own save path.
 *
 * Source of truth = structured vector strokes (never a raster snapshot). Each
 * stroke stores normalized coordinates (0..1) so a drawing scales cleanly when the
 * note width changes. Rasterization is used only as a live rendering target.
 *
 * Stroke shape:
 *   { id, tool, color, width, opacity, points:[{x,y,p}], createdAt }
 *     - tool   : 'pen' | 'highlighter' | 'eraser-marker' (eraser never persists)
 *     - color  : CSS color string OR the sentinel 'ink' (theme-aware default ink)
 *     - width  : stroke width in *normalized* units (fraction of canvas min-dim)
 *     - opacity: 0..1
 *     - points : ordered normalized points, optional pressure p (0..1)
 * ======================================================================== */
(function (global) {
    'use strict';

    var TOOLS = Object.freeze({
        PEN: 'pen',
        HIGHLIGHTER: 'highlighter',
        ERASER: 'eraser'
    });

    var BACKGROUNDS = Object.freeze(['blank', 'lined', 'grid', 'dotted']);

    // Palette is intentionally small + legible across light/dark/retro surfaces.
    // 'ink' resolves at render time to a theme-aware default so a black pen never
    // disappears on a dark note surface.
    var PALETTE = Object.freeze([
        { id: 'ink', label: 'Ink (auto)', value: 'ink' },
        { id: 'blue', label: 'Blue', value: '#2f6df6' },
        { id: 'red', label: 'Red', value: '#e5484d' },
        { id: 'green', label: 'Green', value: '#30a46c' },
        { id: 'amber', label: 'Amber', value: '#f5a524' },
        { id: 'violet', label: 'Violet', value: '#8e4ec6' }
    ]);

    // Highlighter swatches carry their own translucent intent.
    var HIGHLIGHTERS = Object.freeze([
        { id: 'hl-yellow', label: 'Yellow', value: '#ffe066' },
        { id: 'hl-green', label: 'Green', value: '#9ae6b4' },
        { id: 'hl-pink', label: 'Pink', value: '#fbb6ce' },
        { id: 'hl-blue', label: 'Blue', value: '#90cdf4' }
    ]);

    // Normalized width presets (fraction of the canvas min dimension).
    var WIDTHS = Object.freeze({
        fine: 0.0045,
        medium: 0.009,
        bold: 0.018,
        highlighter: 0.05
    });

    var ERASER_RADIUS_NORM = 0.022; // hit-test radius in normalized units

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }

    function genId() {
        // Stable, collision-resistant enough for local stroke/block ids without
        // depending on the host app's id generator (file:// + no deps).
        var rnd = '';
        try {
            if (global.crypto && global.crypto.getRandomValues) {
                var a = new Uint32Array(2);
                global.crypto.getRandomValues(a);
                rnd = a[0].toString(36) + a[1].toString(36);
            }
        } catch (e) { /* ignore */ }
        if (!rnd) rnd = Math.floor((1 + (performance && performance.now ? performance.now() : 0)) * 1e6).toString(36) + 'x';
        return 'st_' + rnd;
    }

    function nowIso() {
        try { return new Date().toISOString(); } catch (e) { return ''; }
    }

    /* ---- Normalization (defensive; used on import + load) ----------------- */

    function normalizePoint(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var x = Number(raw.x);
        var y = Number(raw.y);
        if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
        var pt = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
        if (raw.p != null) {
            var p = Number(raw.p);
            if (isFiniteNum(p)) pt.p = clamp(p, 0, 1);
        }
        return pt;
    }

    function normalizeStroke(raw) {
        if (!raw || typeof raw !== 'object') return null;
        // Eraser is never a persisted stroke — it removes strokes. Drop any eraser
        // entry that somehow appears in imported data rather than silently drawing it.
        if (raw.tool === TOOLS.ERASER || raw.tool === 'eraser-marker') return null;
        var tool = (raw.tool === TOOLS.HIGHLIGHTER) ? TOOLS.HIGHLIGHTER : TOOLS.PEN;
        var points = [];
        var src = Array.isArray(raw.points) ? raw.points : [];
        for (var i = 0; i < src.length; i++) {
            var pt = normalizePoint(src[i]);
            if (pt) points.push(pt);
        }
        if (!points.length) return null;
        var width = Number(raw.width);
        if (!isFiniteNum(width) || width <= 0) width = tool === TOOLS.HIGHLIGHTER ? WIDTHS.highlighter : WIDTHS.medium;
        var opacity = Number(raw.opacity);
        if (!isFiniteNum(opacity)) opacity = tool === TOOLS.HIGHLIGHTER ? 0.35 : 1;
        var color = typeof raw.color === 'string' && raw.color ? raw.color : 'ink';
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
            tool: tool,
            color: color,
            width: clamp(width, 0.0008, 0.2),
            opacity: clamp(opacity, 0.05, 1),
            points: points,
            createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso()
        };
    }

    function normalizeStrokes(rawList) {
        var out = [];
        var src = Array.isArray(rawList) ? rawList : [];
        var seen = Object.create(null);
        for (var i = 0; i < src.length; i++) {
            var s = normalizeStroke(src[i]);
            if (!s) continue;
            if (seen[s.id]) s.id = genId();
            seen[s.id] = true;
            out.push(s);
        }
        return out;
    }

    function normalizeBackground(value) {
        return BACKGROUNDS.indexOf(value) >= 0 ? value : 'blank';
    }

    /* ---- Theme-aware color resolution ------------------------------------ */

    // Resolve the sentinel 'ink' against the current surface so the default
    // stroke colour always contrasts the note background. Explicit user colours
    // pass through untouched.
    function resolveColor(color, opts) {
        if (color && color !== 'ink') return color;
        var dark = !!(opts && opts.darkSurface);
        return dark ? '#f4f6fb' : '#1f2430';
    }

    // Estimate whether the surface under the canvas is dark, so 'ink' contrasts.
    function detectDarkSurface(el) {
        try {
            var node = el;
            for (var i = 0; node && i < 6; i++) {
                var bg = global.getComputedStyle(node).backgroundColor;
                var rgb = parseRgb(bg);
                if (rgb && rgb.a > 0.1) {
                    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
                    return lum < 128;
                }
                node = node.parentElement;
            }
        } catch (e) { /* ignore */ }
        // Fall back to the documented theme attribute.
        try {
            var key = (document.body.getAttribute('data-theme-key') || document.body.getAttribute('data-theme') || '').toLowerCase();
            if (key.indexOf('dark') >= 0 || key.indexOf('midnight') >= 0 || key.indexOf('retro') >= 0 || key === 'custom') {
                // For custom/unknown, sample the computed page bg.
            }
            var pageBg = parseRgb(global.getComputedStyle(document.body).backgroundColor);
            if (pageBg) return (0.299 * pageBg.r + 0.587 * pageBg.g + 0.114 * pageBg.b) < 128;
        } catch (e2) { /* ignore */ }
        return false;
    }

    function parseRgb(str) {
        if (!str) return null;
        var m = String(str).match(/rgba?\(([^)]+)\)/i);
        if (!m) return null;
        var parts = m[1].split(',').map(function (p) { return parseFloat(p); });
        if (parts.length < 3) return null;
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }

    /* ---- Rendering ------------------------------------------------------- */

    function drawBackgroundPattern(ctx, w, h, background, dark) {
        if (!background || background === 'blank') return;
        var line = dark ? 'rgba(255,255,255,0.10)' : 'rgba(40,50,70,0.12)';
        var gap = Math.max(18, Math.round(Math.min(w, h) / 22));
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = line;
        if (background === 'lined' || background === 'grid') {
            for (var y = gap; y < h; y += gap) {
                ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
            }
        }
        if (background === 'grid') {
            for (var x = gap; x < w; x += gap) {
                ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke();
            }
        }
        if (background === 'dotted') {
            ctx.fillStyle = line;
            for (var dy = gap; dy < h; dy += gap) {
                for (var dx = gap; dx < w; dx += gap) {
                    ctx.beginPath(); ctx.arc(dx, dy, 1.1, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    function strokePath(ctx, stroke, w, h, opts) {
        var pts = stroke.points;
        if (!pts.length) return;
        var minDim = Math.min(w, h);
        var lineWidth = Math.max(1, stroke.width * minDim);
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = stroke.opacity;
        ctx.strokeStyle = resolveColor(stroke.color, opts);
        if (stroke.tool === TOOLS.HIGHLIGHTER) {
            ctx.globalCompositeOperation = 'multiply';
        }

        if (pts.length === 1) {
            // A single tap renders as a dot.
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.arc(pts[0].x * w, pts[0].y * h, lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return;
        }

        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * w, pts[0].y * h);
        // Quadratic smoothing through midpoints for a natural ink feel.
        for (var i = 1; i < pts.length - 1; i++) {
            var cx = pts[i].x * w, cy = pts[i].y * h;
            var nx = (pts[i].x + pts[i + 1].x) / 2 * w;
            var ny = (pts[i].y + pts[i + 1].y) / 2 * h;
            ctx.quadraticCurveTo(cx, cy, nx, ny);
        }
        var last = pts[pts.length - 1];
        ctx.lineTo(last.x * w, last.y * h);
        ctx.stroke();
        ctx.restore();
    }

    // Render strokes onto a canvas. `opts.darkSurface` controls 'ink' resolution.
    // Handles devicePixelRatio so ink is crisp on high-density displays.
    function renderStrokesToCanvas(canvas, strokes, opts) {
        if (!canvas) return;
        opts = opts || {};
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        var cssW = opts.cssWidth || canvas.clientWidth || canvas.width || 1;
        var cssH = opts.cssHeight || canvas.clientHeight || canvas.height || 1;
        var dpr = clamp(opts.dpr || (global.devicePixelRatio || 1), 1, 3);
        if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        var dark = ('darkSurface' in opts) ? !!opts.darkSurface : detectDarkSurface(canvas);
        drawBackgroundPattern(ctx, cssW, cssH, opts.background, dark);
        var list = Array.isArray(strokes) ? strokes : [];
        for (var i = 0; i < list.length; i++) {
            strokePath(ctx, list[i], cssW, cssH, { darkSurface: dark });
        }
        return { width: cssW, height: cssH, dark: dark };
    }

    // Render to a standalone PNG data URL (used for export-as-PNG + static export).
    function strokesToPngDataUrl(strokes, width, height, opts) {
        opts = opts || {};
        var c = document.createElement('canvas');
        var dpr = clamp(opts.dpr || 2, 1, 3);
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        var ctx = c.getContext('2d');
        if (opts.fill) { ctx.save(); ctx.scale(dpr, dpr); ctx.fillStyle = opts.fill; ctx.fillRect(0, 0, width, height); ctx.restore(); }
        renderStrokesToCanvas(c, strokes, {
            cssWidth: width, cssHeight: height, dpr: dpr,
            background: opts.background, darkSurface: !!opts.darkSurface
        });
        try { return c.toDataURL('image/png'); } catch (e) { return ''; }
    }

    /* ---- Eraser hit-testing ---------------------------------------------- */

    function pointSegDist(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay;
        var len2 = dx * dx + dy * dy;
        if (len2 === 0) { var ex = px - ax, ey = py - ay; return Math.sqrt(ex * ex + ey * ey); }
        var t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
        var cx = ax + t * dx, cy = ay + t * dy;
        var qx = px - cx, qy = py - cy;
        return Math.sqrt(qx * qx + qy * qy);
    }

    // Returns the id of the topmost stroke hit by an eraser at normalized (x,y),
    // or null. Threshold scales with the stroke width so thick strokes are easy
    // to hit. Iterates back-to-front (topmost first).
    function strokeAt(strokes, x, y, radius) {
        radius = radius || ERASER_RADIUS_NORM;
        for (var i = strokes.length - 1; i >= 0; i--) {
            var s = strokes[i];
            var pts = s.points;
            var thresh = radius + s.width / 2;
            if (pts.length === 1) {
                var ddx = x - pts[0].x, ddy = y - pts[0].y;
                if (Math.sqrt(ddx * ddx + ddy * ddy) <= thresh) return s.id;
                continue;
            }
            for (var j = 0; j < pts.length - 1; j++) {
                if (pointSegDist(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= thresh) {
                    return s.id;
                }
            }
        }
        return null;
    }

    /* ---- Drawing controller ---------------------------------------------- */
    // Binds pointer events to a live <canvas> and manages tool state, the active
    // stroke, an undo/redo command history, and stroke-based erasing. Completed
    // strokes are committed on pointerup and surfaced via options.onCommit so the
    // host can debounce persistence (never per pointermove).
    function createController(canvas, options) {
        options = options || {};
        var strokes = normalizeStrokes(options.strokes || []);
        var undoStack = [];   // snapshots of stroke arrays (history)
        var redoStack = [];
        var HISTORY_CAP = 80;

        var state = {
            tool: TOOLS.PEN,
            color: 'ink',
            highlighterColor: HIGHLIGHTERS[0].value,
            width: WIDTHS.medium,
            highlighterWidth: WIDTHS.highlighter,
            background: normalizeBackground(options.background)
        };

        var active = null;          // in-progress stroke
        var drawing = false;
        var erasedDuringStroke = false;
        // `dark` may be null/undefined to mean "auto-detect from the surface each
        // render" (so theme-aware ink follows light/dark/retro themes). Only an
        // explicit boolean overrides detection.
        var dark = (typeof options.darkSurface === 'boolean') ? options.darkSurface : null;
        var destroyed = false;

        function snapshot() { return strokes.slice(); }
        function pushHistory() {
            undoStack.push(snapshot());
            if (undoStack.length > HISTORY_CAP) undoStack.shift();
            redoStack.length = 0;
        }

        function render() {
            if (destroyed) return;
            var opts = { background: state.background };
            // Pass darkSurface ONLY when explicitly set; otherwise let the renderer
            // auto-detect the surface so 'ink' contrasts the current theme.
            if (dark !== null) opts.darkSurface = dark;
            renderStrokesToCanvas(canvas, active ? strokes.concat([active]) : strokes, opts);
        }

        function notifyChange() {
            if (typeof options.onChange === 'function') {
                try { options.onChange(snapshot(), { background: state.background }); } catch (e) { /* ignore */ }
            }
        }
        function notifyCommit() {
            if (typeof options.onCommit === 'function') {
                try { options.onCommit(snapshot(), { background: state.background }); } catch (e) { /* ignore */ }
            }
        }

        function localPoint(ev) {
            var rect = canvas.getBoundingClientRect();
            var w = rect.width || 1, h = rect.height || 1;
            var pt = {
                x: clamp((ev.clientX - rect.left) / w, 0, 1),
                y: clamp((ev.clientY - rect.top) / h, 0, 1)
            };
            if (typeof ev.pressure === 'number' && ev.pressure > 0 && ev.pressure !== 0.5) {
                pt.p = clamp(ev.pressure, 0.05, 1);
            }
            return pt;
        }

        function currentColor() {
            return state.tool === TOOLS.HIGHLIGHTER ? state.highlighterColor : state.color;
        }
        function currentWidth() {
            return state.tool === TOOLS.HIGHLIGHTER ? state.highlighterWidth : state.width;
        }

        function onPointerDown(ev) {
            if (ev.button != null && ev.button !== 0 && ev.pointerType === 'mouse') return;
            ev.preventDefault();
            try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
            drawing = true;
            var pt = localPoint(ev);

            if (state.tool === TOOLS.ERASER) {
                erasedDuringStroke = false;
                eraseAt(pt.x, pt.y, true);
                return;
            }
            active = {
                id: genId(),
                tool: state.tool === TOOLS.HIGHLIGHTER ? TOOLS.HIGHLIGHTER : TOOLS.PEN,
                color: currentColor(),
                width: currentWidth(),
                opacity: state.tool === TOOLS.HIGHLIGHTER ? 0.32 : 1,
                points: [pt],
                createdAt: nowIso()
            };
            render();
        }

        function onPointerMove(ev) {
            if (!drawing) return;
            ev.preventDefault();
            // Coalesced events give smoother ink on capable browsers.
            var events = (typeof ev.getCoalescedEvents === 'function') ? ev.getCoalescedEvents() : null;
            if (state.tool === TOOLS.ERASER) {
                if (events && events.length) {
                    for (var e = 0; e < events.length; e++) { var p = localPoint(events[e]); eraseAt(p.x, p.y, false); }
                } else { var pp = localPoint(ev); eraseAt(pp.x, pp.y, false); }
                return;
            }
            if (!active) return;
            if (events && events.length) {
                for (var i = 0; i < events.length; i++) active.points.push(localPoint(events[i]));
            } else {
                active.points.push(localPoint(ev));
            }
            render();
        }

        function endStroke(ev) {
            if (!drawing) return;
            drawing = false;
            if (ev && ev.pointerId != null) { try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ } }
            if (state.tool === TOOLS.ERASER) {
                if (erasedDuringStroke) { notifyCommit(); }
                erasedDuringStroke = false;
                render();
                return;
            }
            if (active && active.points.length) {
                pushHistory();
                strokes.push(active);
                active = null;
                render();
                notifyCommit();
            } else {
                active = null;
                render();
            }
        }

        function eraseAt(x, y, isStart) {
            var id = strokeAt(strokes, x, y, ERASER_RADIUS_NORM);
            if (!id) { if (isStart) render(); return; }
            if (!erasedDuringStroke) { pushHistory(); erasedDuringStroke = true; }
            for (var i = 0; i < strokes.length; i++) {
                if (strokes[i].id === id) { strokes.splice(i, 1); break; }
            }
            render();
        }

        /* public command surface */
        function setTool(t) { if (t === TOOLS.PEN || t === TOOLS.HIGHLIGHTER || t === TOOLS.ERASER) state.tool = t; }
        function getTool() { return state.tool; }
        function setColor(c) {
            if (state.tool === TOOLS.HIGHLIGHTER) state.highlighterColor = c; else state.color = c;
        }
        function getColor() { return currentColor(); }
        function setWidth(w) {
            var n = Number(w);
            if (!isFiniteNum(n) || n <= 0) return;
            if (state.tool === TOOLS.HIGHLIGHTER) state.highlighterWidth = n; else state.width = n;
        }
        function setBackground(bg) { state.background = normalizeBackground(bg); render(); notifyChange(); notifyCommit(); }
        function getBackground() { return state.background; }

        function undo() {
            if (!undoStack.length) return false;
            redoStack.push(snapshot());
            strokes = undoStack.pop();
            active = null;
            render(); notifyCommit();
            return true;
        }
        function redo() {
            if (!redoStack.length) return false;
            undoStack.push(snapshot());
            strokes = redoStack.pop();
            active = null;
            render(); notifyCommit();
            return true;
        }
        function clear() {
            if (!strokes.length) return false;
            pushHistory();
            strokes = [];
            active = null;
            render(); notifyCommit();
            return true;
        }
        function canUndo() { return undoStack.length > 0; }
        function canRedo() { return redoStack.length > 0; }
        function isEmpty() { return strokes.length === 0; }
        function getStrokes() { return snapshot(); }
        function setDarkSurface(v) { dark = (typeof v === 'boolean') ? v : null; render(); }
        // Re-detect the surface (call after a theme change) so 'ink' updates.
        function refreshTheme() { if (dark === null) render(); }
        function refresh() { render(); }
        function exportPng(width, height) {
            var rect = canvas.getBoundingClientRect();
            return strokesToPngDataUrl(strokes, width || rect.width || 600, height || rect.height || 360, {
                background: state.background, darkSurface: dark, fill: dark ? '#11151c' : '#ffffff'
            });
        }

        var pointerHandlers = {
            pointerdown: onPointerDown,
            pointermove: onPointerMove,
            pointerup: endStroke,
            pointercancel: endStroke,
            pointerleave: function (ev) { if (drawing && state.tool === TOOLS.ERASER) endStroke(ev); }
        };
        Object.keys(pointerHandlers).forEach(function (k) {
            canvas.addEventListener(k, pointerHandlers[k], { passive: false });
        });

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            Object.keys(pointerHandlers).forEach(function (k) {
                canvas.removeEventListener(k, pointerHandlers[k]);
            });
        }

        render();

        return {
            setTool: setTool, getTool: getTool,
            setColor: setColor, getColor: getColor,
            setWidth: setWidth, setBackground: setBackground, getBackground: getBackground,
            undo: undo, redo: redo, clear: clear,
            canUndo: canUndo, canRedo: canRedo, isEmpty: isEmpty,
            getStrokes: getStrokes, setDarkSurface: setDarkSurface,
            refresh: refresh, refreshTheme: refreshTheme, exportPng: exportPng, destroy: destroy
        };
    }

    global.AtelierHandwriting = {
        TOOLS: TOOLS,
        BACKGROUNDS: BACKGROUNDS,
        PALETTE: PALETTE,
        HIGHLIGHTERS: HIGHLIGHTERS,
        WIDTHS: WIDTHS,
        normalizeStroke: normalizeStroke,
        normalizeStrokes: normalizeStrokes,
        normalizeBackground: normalizeBackground,
        renderStrokesToCanvas: renderStrokesToCanvas,
        strokesToPngDataUrl: strokesToPngDataUrl,
        strokeAt: strokeAt,
        detectDarkSurface: detectDarkSurface,
        createController: createController,
        genId: genId
    };
})(typeof window !== 'undefined' ? window : this);
