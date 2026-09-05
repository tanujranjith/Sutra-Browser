/* ============================================================
   SUTRA ULTRA — core
   Utilities, icon set, persistence, grid engine with
   gravity-packing and minimal-movement reflow.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- utils ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style") node.style.cssText = v;
        else if (k.startsWith("on") && typeof v === "function")
          node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of (children || []).flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const debounce = (fn, ms) => {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- icon set (static, trusted strings) ---------- */

  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/></svg>',
    "arrow-up-right": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M12.5 13.5h2M8 17h2M12.5 17h2"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 3.5h14v17H5zM8.5 8h7M8.5 12h7M8.5 16h4"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5.5h13v13H4zM17 9h3v9.5"/><path d="M6.5 8.5h8M6.5 12h8M6.5 15.5h5"/></svg>',
    tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6.5 6 8.5 10 4.5" /><path d="M12.5 6h8M4 13.5l2 2 4-4M12.5 13h8M4 20.5l2 2 4-4M12.5 20h8"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="16" height="11"/><path d="M9 19h6M12 15v4M4 9h16"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 3.5v4h4"/></svg>',
    "chevron-l": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14.5 6 9 12l5.5 6"/></svg>',
    "chevron-r": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9.5 6 15 12l-5.5 6"/></svg>',
    "sun": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/></svg>',
    "moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    "sun-moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>',
    density: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke-dasharray="14 6 3 6 10 6"/></svg>',
    "wx-clear-d": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>',
    "wx-clear-n": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19.5 15.5A8 8 0 0 1 8.5 4.5 8 8 0 1 0 19.5 15.5z"/><path d="M16 4.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/></svg>',
    "wx-partly": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8" r="3.5"/><path d="M8.5 2.2v1.6M2.2 8h1.6M4.5 4.5l1.1 1.1M12.5 4.5l-1.1 1.1"/><path d="M6.5 13.5h8.8a3.7 3.7 0 0 0 .6-7.4A5 5 0 0 0 6.4 7"/><path d="M6 15.2A3.2 3.2 0 0 0 6.2 21.5H16a3 3 0 0 0 .4-6H16"/></svg>',
    "wx-cloud": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 16.5h9.5a3.6 3.6 0 0 0 .6-7.2A5.3 5.3 0 0 0 6.6 8.6a3.6 3.6 0 0 0-.1 7.9z"/></svg>',
    "wx-fog": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 8.5h10a3.4 3.4 0 0 0 .5-6.7A4.8 4.8 0 0 0 7.6 4.6 3.4 3.4 0 0 0 7 8.5zM5 12h14M6.5 15.5h11M8 19h8"/></svg>',
    "wx-drizzle": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7.5 7.5h9a3.3 3.3 0 0 0 .4-6.6A4.9 4.9 0 0 0 7.5 3.4 3.2 3.2 0 0 0 7.5 7.5z"/><path d="M8.5 13l-1.2 2.4M12.5 13l-1.2 2.4M16.5 13l-1.2 2.4M9.5 17.6 8.3 20M13.5 17.6l-1.2 2.4"/></svg>',
    "wx-rain": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 9h9.5a3.4 3.4 0 0 0 .5-6.7A5 5 0 0 0 7.4 4.8 3.3 3.3 0 0 0 7 9z"/><path d="M8 14.5 6.4 17.5M12.5 14.5 10.9 17.5M17 14.5 15.4 17.5M9.5 18.7 8 21.7M14 18.7l-1.6 3"/></svg>',
    "wx-snow": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 8.5h9.5a3.4 3.4 0 0 0 .5-6.7A5 5 0 0 0 7.4 4.3 3.3 3.3 0 0 0 7 8.5z"/><path d="M8.5 13.5l-2 1M15.5 13.5l2 1M8 18.5l-2 1M16 18.5l2 1M12 13.5l2 1M12 13.5l-2 1M12 18.5l2 1M12 18.5l-2 1"/></svg>',
    "wx-thunder": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 11h8.5a3.3 3.3 0 0 0 .4-6.5A4.8 4.8 0 0 0 6.6 6.4 3.2 3.2 0 0 0 6.5 11z"/><path d="M10.5 13 8 21.5M10.5 13l3.5-5.5M10.5 13h3l-1.8 8.5"/></svg>',
    "wx-wind": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12.5h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16.5h8a2 2 0 1 1-2 2"/></svg>',
    "loc": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 21s6.5-5.4 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.6 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.5"/></svg>',
    "battery": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="8" width="17" height="8"/><path d="M21.5 10.5v3"/></svg>',
    "cpu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="7" width="10" height="10"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg>',
    "wifi": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 9.5a14.5 14.5 0 0 1 19 0M5.5 13a10 10 0 0 1 13 0M8.5 16.5a5.5 5.5 0 0 1 7 0M12 20h.01"/></svg>',
    "globe": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.7 5.2 3.7 8.5s-1.2 6.2-3.7 8.5c-2.5-2.3-3.7-5.2-3.7-8.5S9.5 5.8 12 3.5z"/></svg>',
    "gem": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3.5h12l3.5 6-9.5 11L2.5 9.5zM2.5 9.5h19M12 3.5 8.7 9.5l3.3 11 3.3-11z"/></svg>',
  };

  /* ---------- store ---------- */

  const KEY = "sutra.ultra.v1";
  const PREV_KEY = "zephyr.ultra.v1";
  const LEGACY_KEY = "luma.ultra.v1";
  const LAYOUT_VERSION = 2;

  const WIDGET_DEFAULTS = {
    clock:    { tz: "auto" },
    weather:  { unit: "c", city: "", lat: null, lon: null, name: "", cached: null },
    notes:    { text: "" },
    bookmarks:{ items: [] },
    news:     { feed: "hn", cached: null },
    tasks:    { items: [] },
    calendar: { monthOffset: 0 },
    system:   {},
  };

  const DEFAULT_LAYOUT = {
    clock:     { x: 0, y: 0, w: 4, h: 3 },
    weather:   { x: 4, y: 0, w: 4, h: 3 },
    notes:     { x: 8, y: 0, w: 4, h: 3 },
    bookmarks: { x: 0, y: 3, w: 4, h: 3 },
    tasks:     { x: 4, y: 3, w: 4, h: 3 },
    calendar:  { x: 8, y: 3, w: 4, h: 3 },
    news:      { x: 0, y: 6, w: 4, h: 3 },
    system:    { x: 4, y: 6, w: 8, h: 3 },
  };

  const DEFAULT_ORDER = ["clock", "weather", "notes", "bookmarks", "tasks", "calendar", "news", "system"];

  let state = null;

  function deepMerge(base, over) {
    if (over == null) return base;
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
        out[k] = deepMerge(base[k], v);
      } else out[k] = v;
    }
    return out;
  }

  function defaults() {
    return {
      version: LAYOUT_VERSION,
      settings: { theme: "auto", density: "comfy" },
      layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
      order: DEFAULT_ORDER.slice(),
      widgets: JSON.parse(JSON.stringify(WIDGET_DEFAULTS)),
    };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(PREV_KEY) || localStorage.getItem(LEGACY_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      state = deepMerge(base, saved);
      // Migrate the original stock layout only. User-arranged dashboards are
      // left untouched so a visual refresh never destroys personal placement.
      const oldLayout = saved && saved.layout;
      const isStockV1Layout = saved && saved.version < LAYOUT_VERSION && oldLayout &&
        oldLayout.system && oldLayout.news && oldLayout.system.x === 0 && oldLayout.system.y === 6 &&
        oldLayout.system.w === 3 && oldLayout.news.x === 3 && oldLayout.news.y === 6 && oldLayout.news.w === 9;
      if (isStockV1Layout) {
        state.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
        state.order = DEFAULT_ORDER.slice();
      }
      state.version = LAYOUT_VERSION;
      save();
      for (const id of state.order) {
        if (!state.layout[id]) delete state.layout[id];
      }
      return state;
    } catch (e) {
      return base;
    }
  }

  function save() {
    if (!state) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  function getWidget(id) {
    if (!state.widgets[id]) state.widgets[id] = JSON.parse(JSON.stringify(WIDGET_DEFAULTS[id] || {}));
    return state.widgets[id];
  }

  function setWidget(id, patch) {
    state.widgets[id] = deepMerge(getWidget(id), patch);
    save();
    return state.widgets[id];
  }

  function setLayout(id, rect) {
    state.layout[id] = { ...rect };
    save();
  }

  function removeLayout(id) {
    delete state.layout[id];
    const i = state.order.indexOf(id);
    if (i >= 0) state.order.splice(i, 1);
    save();
  }

  function addWidget(id, rect) {
    state.layout[id] = { ...rect };
    if (!state.widgets[id]) state.widgets[id] = JSON.parse(JSON.stringify(WIDGET_DEFAULTS[id] || {}));
    if (!state.order.includes(id)) state.order.push(id);
    save();
  }

  function setOrder(id, from, to) {
    const i = state.order.indexOf(id);
    if (i < 0) return;
    state.order.splice(i, 1);
    state.order.splice(to, 0, id);
    save();
  }

  function setSetting(k, v) {
    state.settings[k] = v;
    save();
  }

  /* ---------- grid engine ---------- */

  const COLS = 12;
  let rowH = 96, gap = 12, gridWidth = 0;

  function measureMetrics() {
    const cs = getComputedStyle(document.documentElement);
    rowH = parseFloat(cs.getPropertyValue("--row-h")) || 96;
    gap = parseFloat(cs.getPropertyValue("--gap")) || 12;
    const g = $("#grid");
    gridWidth = g ? g.clientWidth : 1200;
    return { rowH, gap, cols: COLS, gridWidth };
  }

  const colW = () => (gridWidth - gap * (COLS - 1)) / COLS;

  function cellToRect(col, row, w, h) {
    const cw = colW();
    return {
      x: col * (cw + gap),
      y: row * (rowH + gap),
      w: w * cw + (w - 1) * gap,
      h: h * rowH + (h - 1) * gap,
    };
  }

  function pxToCell(px, py) {
    const cw = colW();
    return {
      col: clamp(Math.floor(px / (cw + gap)), 0, COLS - 1),
      row: Math.max(0, Math.floor(py / (rowH + gap))),
    };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function rectFits(rect, rects, id) {
    if (rect.w < 1 || rect.h < 1) return false;
    if (rect.x < 0 || rect.x + rect.w > COLS) return false;
    for (const r of rects) {
      if (r && overlaps(rect, r)) return false;
    }
    return true;
  }

  function firstFree(w, h, rects, startRow) {
    w = clamp(Math.round(w), 1, COLS);
    h = Math.max(1, Math.round(h));
    for (let row = startRow || 0; row < 200; row++) {
      for (let col = 0; col + w <= COLS; col++) {
        const r = { x: col, y: row, w, h };
        if (rectFits(r, rects)) return r;
      }
    }
    return { x: 0, y: 0, w, h };
  }

  /** gravity pack: keep each widget where it is if free, else first free slot */
  function pack(layout, order, fixed = {}) {
    const result = {};
    for (const [id, r] of Object.entries(fixed)) result[id] = { ...r };
    for (const id of order) {
      if (fixed[id]) continue;
      const r = layout[id];
      if (!r) continue;
      if (rectFits(r, Object.values(result))) {
        result[id] = { ...r };
      } else {
        result[id] = firstFree(r.w, r.h, Object.values(result));
      }
    }
    return result;
  }

  function gridHeight(layout) {
    let rows = 0;
    for (const r of Object.values(layout)) rows = Math.max(rows, r.y + r.h);
    return rows > 0 ? rows * rowH + (rows - 1) * gap : 0;
  }

  /**
   * Validate and normalize a stored layout: coerce every rect to finite,
   * in-bounds integers, then gravity-pack to remove overlaps. Returns
   * { layout, changed } — `changed` is true when anything was repaired.
   */
  function sanitizeLayout(layout, order) {
    const clamped = {};
    let changed = false;
    const clean = (v, d, lo, hi) => {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : d;
    };
    for (const id of order) {
      const r = layout[id];
      if (!r) continue;
      const w = clean(r.w, 3, 1, COLS);
      const h = clean(r.h, 3, 1, 40);
      const x = Math.min(clean(r.x, 0, 0, COLS - 1), COLS - w);
      const y = clean(r.y, 0, 0, 200);
      if (x !== r.x || y !== r.y || w !== r.w || h !== r.h) changed = true;
      clamped[id] = { x, y, w, h };
    }
    const packed = pack(clamped, order);
    for (const id of order) {
      const a = clamped[id];
      const b = packed[id];
      if (a && b && (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)) changed = true;
    }
    return { layout: packed, changed };
  }

  /* ---------- toast / live region ---------- */

  function toast(msg, opts) {
    opts = opts || {};
    const box = $("#live");
    const t = h("div", { class: "toast", role: "status", text: msg });
    box.append(t);
    requestAnimationFrame(() => t.classList.add("show"));
    const kill = () => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 320);
    };
    if (opts.action) {
      const b = h("button", { class: "btn", style: "margin-left:10px;border-color:currentColor;color:inherit;font-size:var(--fs-11);padding:4px 10px", text: opts.action });
      b.addEventListener("click", () => { opts.onAction && opts.onAction(); kill(); });
      t.append(b);
    }
    setTimeout(kill, opts.duration || 3400);
  }

  /* ---------- theme ---------- */

  const mqDark = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme() {
    const mode = state ? state.settings.theme : "auto";
    const dark = mode === "dark" || (mode === "auto" && mqDark.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#13120E" : "#F4F1E9");
  }

  /* ---------- public API ---------- */

  window.Sutra = {
    utils: { $, $$, h, clamp, debounce, esc },
    icons: I,
    store: {
      state: () => state,
      getWidget, setWidget, setLayout, removeLayout, addWidget, setOrder, setSetting, save, load,
      defaults, WIDGET_DEFAULTS, DEFAULT_LAYOUT, DEFAULT_ORDER,
    },
    grid: {
      COLS, measureMetrics, cellToRect, pxToCell, rectFits, firstFree, pack, gridHeight,
      sanitizeLayout,
      rowHeight: () => rowH, gapSize: () => gap,
    },
    ui: { toast, applyTheme },
  };

  state = load();
  Sutra.ui.applyTheme();
  Sutra.grid.measureMetrics();
})();
