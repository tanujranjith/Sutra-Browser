/* ============================================================
   SUTRA ULTRA — main
   Grid rendering, FLIP reflow, pointer drag/resize, keyboard
   layout ops, dialogs, search suggestions, refresh loop.
   ============================================================ */

(function () {
  "use strict";
  const { $, $$, h, clamp, debounce, esc } = Sutra.utils;
  const I = Sutra.icons;
  const store = Sutra.store;
  const grid = Sutra.grid;
  const state = store.state();

  const registry = window.SutraWidgets.registry;
  const defOf = (id) => registry.find((d) => d.id === id);

  const gridEl = $("#grid");
  const cards = new Map();          // id -> {card, body, def, data, tick, lastRun}
  const mobileMq = window.matchMedia("(max-width: 760px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let ghost = null;

  const announceEl = h("div", {
    style: "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap",
    "aria-live": "polite",
  });
  document.body.append(announceEl);
  const announce = (msg) => { announceEl.textContent = ""; setTimeout(() => { announceEl.textContent = msg; }, 30); };

  /* ---------------- rendering ---------------- */

  function cardFor(id) {
    const def = defOf(id);
    if (!def || cards.has(id)) return cards.get(id);
    const data = store.getWidget(id);

    const head = h("div", { class: "w-head", title: "Drag to move · double-click to configure" },
      h("div", { class: "w-title" },
        h("span", { html: I[def.icon] || I.gear }),
        h("span", { class: "t-name", text: def.name })
      ),
      h("span", { class: "w-actions" },
        h("button", { class: "w-act", type: "button", title: "Configure " + def.name,
            "aria-label": "Configure " + def.name, onclick: () => openConfig(id) },
          h("span", { html: I.gear })),
        h("button", { class: "w-act", type: "button", title: "Remove " + def.name,
            "aria-label": "Remove " + def.name, onclick: () => removeWidget(id) },
          h("span", { html: I.trash }))
      )
    );
    const body = h("div", { class: "w-body" });
    const resize = h("div", { class: "w-resize", role: "separator", "aria-orientation": "diagonal",
      "aria-label": "Resize " + def.name, title: "Drag to resize" });

    const card = h("div", {
      class: "w-card", tabindex: "0", role: "group",
      "aria-label": def.name + " widget",
    }, head, body, resize);

    const ctx = {
      id,
      update: () => rerender(id),
      openConfig: () => openConfig(id),
      showError: (msg) => showWidgetError(id, msg),
    };

    const entry = { id, card, body, def, data, tick: null, lastRun: 0 };
    cards.set(id, entry);

    wireDrag(card, entry);
    wireResize(resize, entry);
    card.addEventListener("dblclick", (e) => {
      if (!e.target.closest("button")) openConfig(id);
    });
    card.addEventListener("keydown", (e) => onCardKey(e, entry));

    gridEl.append(card);
    entry.tick = def.render(body, data, ctx) || null;
    return entry;
  }

  function rerender(id) {
    const e = cards.get(id);
    if (!e) return;
    e.body.innerHTML = "";
    e.tick = e.def.render(e.body, e.data, {
      id, update: () => rerender(id),
      openConfig: () => openConfig(id),
      showError: (msg) => showWidgetError(id, msg),
    }) || null;
  }

  function showWidgetError(id, msg) {
    const e = cards.get(id);
    if (!e) return;
    e.body.innerHTML = "";
    e.body.append(
      h("div", { class: "w-error" },
        h("div", { html: I.refresh }),
        h("span", { text: msg }),
        h("button", { class: "w-retry", type: "button", text: "Try again",
          onclick: () => rerender(id) })
      )
    );
  }

  /* ---------------- layout / FLIP ---------------- */

  function isMobile() { return mobileMq.matches; }
  function isResponsiveGrid() { return window.innerWidth <= 1100; }

  function applyRects(animated) {
    grid.measureMetrics();
    const sane = grid.sanitizeLayout(state.layout, state.order);
    if (sane.changed) {
      state.layout = sane.layout;
      store.save();
    }
    const rects = state.layout;
    let rows = 0;
    for (const [id, r] of Object.entries(rects)) {
      const e = cards.get(id);
      if (!e) continue;
      const px = grid.cellToRect(r.x, r.y, r.w, r.h);
      rows = Math.max(rows, r.y + r.h);
      if (isResponsiveGrid()) {
        e.card.classList.add("animated");
        e.card.style.position = "";
        e.card.style.left = ""; e.card.style.top = "";
        e.card.style.width = ""; e.card.style.height = "";
        e.card.style.gridColumn = isMobile() ? "1" : "span 1";
        e.card.style.gridRow = "auto";
      } else if (animated) {
        e.card.classList.add("animated");
        const old = { l: e.card.offsetLeft, t: e.card.offsetTop };
        const dx = old.l - px.x, dy = old.t - px.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          e.card.style.transform = "translate(" + dx + "px," + dy + "px)";
          requestAnimationFrame(() => {
            e.card.style.transform = "";
            e.card.style.left = px.x + "px";
            e.card.style.top = px.y + "px";
          });
        }
      }
      if (!isResponsiveGrid()) {
        e.card.style.position = "absolute";
        e.card.style.left = px.x + "px";
        e.card.style.top = px.y + "px";
        e.card.style.width = px.w + "px";
        e.card.style.height = px.h + "px";
      }
      if (reduced.matches) e.card.classList.remove("animated");
    }
    if (animated) setTimeout(() => $$(".animated", gridEl).forEach((c) => c.classList.remove("animated")), 300);
    gridEl.style.height = isResponsiveGrid() ? "" : (rows > 0 ? grid.gridHeight(rects) : 0) + "px";
    $("#grid-empty").hidden = Object.keys(rects).length > 0;
    gridEl.hidden = Object.keys(rects).length === 0;
  }

  function commitLayout(next, id, announceMsg) {
    state.layout = next;
    store.save();
    applyRects(true);
    if (announceMsg) announce(announceMsg);
  }

  /* move/resize a widget with keyboard-friendly animation */
  function moveTo(id, col, row, opts) {
    opts = opts || {};
    const r = state.layout[id];
    if (!r) return;
    const min = defOf(id).min;
    const w = clamp(opts.w != null ? opts.w : r.w, min.w, grid.COLS);
    const h = clamp(opts.h != null ? opts.h : r.h, min.h, 40);
    const rect = {
      x: clamp(col, 0, grid.COLS - w),
      y: Math.max(0, row),
      w, h,
    };
    const next = grid.pack(state.layout, state.order, { [id]: rect });
    commitLayout(next, id, opts.msg);
  }

  /* ---------------- pointer drag ---------------- */

  function cellFromEvent(e) {
    const gb = gridEl.getBoundingClientRect();
    return grid.pxToCell(e.clientX - gb.left, e.clientY - gb.top);
  }

  function makeGhost(rect) {
    if (!ghost) {
      ghost = h("div", { class: "grid-ghost" });
      gridEl.append(ghost);
    }
    const px = grid.cellToRect(rect.x, rect.y, rect.w, rect.h);
    ghost.style.left = px.x + "px";
    ghost.style.top = px.y + "px";
    ghost.style.width = px.w + "px";
    ghost.style.height = px.h + "px";
  }
  function removeGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
  }

  function wireDrag(card, entry) {
    const head = $(".w-head", card);
    let start = null, dragging = false, cur = null;
    let cancel = null;

    const cancelDrag = () => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      card.style.transform = "";
      removeGhost();
      window.removeEventListener("keydown", cancel);
    };

    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return;
      start = { x: e.clientX, y: e.clientY };
      cur = null;
      dragging = false;
      head.setPointerCapture(e.pointerId);
    });

    head.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < 5) return;
      if (!dragging) {
        dragging = true;
        card.classList.add("dragging");
        document.body.classList.add("is-dragging");
        announce(entry.def.name + ": dragging");
        cancel = (ce) => {
          if (ce.key === "Escape") {
            ce.preventDefault();
            cancelDrag();
            announce(entry.def.name + ": move cancelled");
          }
        };
        window.addEventListener("keydown", cancel);
      }
      const r = state.layout[entry.id] || entry.def.def;
      const c = cellFromEvent(e);
      cur = c;
      card.style.transform = "translate(" + dx + "px," + dy + "px)";
      makeGhost({ x: c.col, y: c.row, w: r.w, h: r.h });
    });

    const end = (e) => {
      if (!start) return;
      start = null;
      if (dragging) {
        window.removeEventListener("keydown", cancel);
        dragging = false;
        card.classList.remove("dragging");
        document.body.classList.remove("is-dragging");
        card.style.transform = "";
        removeGhost();
        if (cur) moveTo(entry.id, cur.col, cur.row, { msg: entry.def.name + " moved" });
      }
      head.releasePointerCapture && head.releasePointerCapture(e.pointerId);
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  /* ---------------- pointer resize ---------------- */

  function wireResize(handle, entry) {
    let start = null, size = null;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, w: entry.def.def.w, h: entry.def.def.h };
      size = null;
      entry.card.classList.add("is-resizing");
      document.body.classList.add("is-dragging");
      handle.setPointerCapture(e.pointerId);
      announce(entry.def.name + ": resizing");
    });

    handle.addEventListener("pointermove", (e) => {
      if (!start) return;
      const c = cellFromEvent(e);
      const r = state.layout[entry.id] || entry.def.def;
      const min = entry.def.min;
      size = {
        w: clamp(c.col - r.x + 1, min.w, grid.COLS),
        h: clamp(c.row - r.y + 1, min.h, 40),
      };
      makeGhost({ x: r.x, y: r.y, w: size.w, h: size.h });
    });

    const end = (e) => {
      if (!start) return;
      start = null;
      entry.card.classList.remove("is-resizing");
      document.body.classList.remove("is-dragging");
      removeGhost();
      if (size) {
        const r = state.layout[entry.id] || entry.def.def;
        moveTo(entry.id, r.x, r.y, {
          w: size.w, h: size.h, msg: entry.def.name + " resized",
        });
      }
      handle.releasePointerCapture && handle.releasePointerCapture(e.pointerId);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /* ---------------- keyboard layout ops ---------------- */

  function onCardKey(e, entry) {
    if (!e.altKey) return;
    const r = state.layout[entry.id];
    if (!r) return;
    const shift = e.shiftKey;
    const dirs = { ArrowLeft: [shift ? "w-" : "x-", 1], ArrowRight: [shift ? "w+" : "x+", 1],
                   ArrowUp: [shift ? "h-" : "y-", 1], ArrowDown: [shift ? "h+" : "y+", 1] };
    const d = dirs[e.key];
    if (!d) { e.preventDefault(); return; }
    e.preventDefault();
    e.stopPropagation();
    const [op, n] = d;
    let { x, y, w, h } = r;
    const min = entry.def.min;
    const move = (v, dlt) => clamp(v + dlt, 0, Math.max(0, grid.COLS - w)) ;
    const grow = (v, dlt) => clamp(v + dlt, min.w, grid.COLS);
    if (op === "x-") x = move(x, -n);
    if (op === "x+") x = move(x, n);
    if (op === "y-") y = Math.max(0, y - n);
    if (op === "y+") y += n;
    if (op === "w-") w = grow(w, -n);
    if (op === "w+") w = grow(w, n);
    if (op === "h-") h = clamp(h - n, min.h, 40);
    if (op === "h+") h = clamp(h + n, min.h, 40);
    moveTo(entry.id, x, y, { w, h, msg: entry.def.name + " adjusted" });
  }

  /* ---------------- widget lifecycle ---------------- */

  function removeWidget(id, silent) {
    const snap = {
      layout: JSON.parse(JSON.stringify(state.layout)),
      order: state.order.slice(),
      widgets: JSON.parse(JSON.stringify(state.widgets)),
    };
    store.removeLayout(id);
    const e = cards.get(id);
    if (e) {
      e.card.classList.add("removing");
      setTimeout(() => { e.card.remove(); cards.delete(id); applyRects(false); }, reduced.matches ? 0 : 200);
    } else applyRects(false);
    if (!silent) {
      Sutra.ui.toast("Removed " + (defOf(id) ? defOf(id).name : "widget"), {
        action: "Undo",
        onAction: () => {
          state.layout = snap.layout;
          state.order = snap.order;
          state.widgets = snap.widgets;
          store.save();
          renderAll();
          Sutra.ui.toast("Restored");
        },
      });
    }
  }

  function renderAll() {
    $$(".w-card", gridEl).forEach((c) => c.remove());
    cards.clear();
    for (const id of state.order) if (state.layout[id]) cardFor(id);
    applyRects(false);
  }

  function addWidgetFromPalette(id) {
    const def = defOf(id);
    if (!def || state.layout[id]) return;
    grid.measureMetrics();
    const rect = grid.firstFree(def.def.w, def.def.h, Object.values(state.layout));
    store.addWidget(id, rect);
    cardFor(id);
    applyRects(true);
    Sutra.ui.toast(def.name + " added");
  }

  /* ---------------- dialogs ---------------- */

  const dlgPalette = $("#dlg-palette");
  const dlgConfig = $("#dlg-config");
  const cfgBody = $("#dlg-config-body");
  let cfgWidgetId = null;

  function openConfig(id) {
    const def = defOf(id);
    if (!def) return;
    cfgWidgetId = id;
    cfgBody.innerHTML = "";
    $("#dlg-config-title").textContent = def.name;
    $("#dlg-config-kicker").textContent = "Configure";
    $("#cfg-remove").hidden = false;
    def.config(cfgBody, store.getWidget(id), {
      update: () => rerender(id),
      openConfig: () => openConfig(id),
    });
    dlgConfig.showModal();
    const first = $("input,select,button:not(.dlg-close):not(#cfg-remove)", cfgBody);
    if (first) setTimeout(() => first.focus(), 30);
  }

  $("#cfg-save").addEventListener("click", () => {
    if (!cfgWidgetId) return;
    const def = defOf(cfgWidgetId);
    const data = store.getWidget(cfgWidgetId);
    def.apply(data, cfgBody);
    store.save();
    rerender(cfgWidgetId);
    Sutra.ui.toast("Saved");
    dlgConfig.close();
  });

  $("#cfg-remove").addEventListener("click", () => {
    const id = cfgWidgetId;
    dlgConfig.close();
    removeWidget(id);
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  function openPalette() {
    const list = $("#palette-list");
    list.innerHTML = "";
    registry.forEach((def) => {
      const present = !!state.layout[def.id];
      list.append(h("div", { class: "palette-item" + (present ? " disabled" : ""), role: "listitem" },
        h("span", { class: "palette-ico", html: I[def.icon] }),
        h("span", { class: "palette-meta" },
          h("strong", { text: def.name }),
          h("span", { text: def.desc })),
        h("span", { class: "palette-size", text: def.def.w + "×" + def.def.h }),
        h("button", { class: "palette-add", type: "button", "aria-label": "Add " + def.name,
            disabled: present, onclick: () => {
              addWidgetFromPalette(def.id);
              openPalette();
            } }, h("span", { html: I.plus }))
      ));
    });
    dlgPalette.showModal();
    const first = $(".palette-item:not(.disabled) .palette-add");
    setTimeout(() => (first || $("#dlg-palette .dlg-close")).focus(), 30);
  }

  /* ---------------- settings chrome ---------------- */

  const themes = ["auto", "light", "dark"];
  const themeLabels = { auto: "Auto", light: "Light", dark: "Dark" };

  function applyChrome() {
    const s = state.settings;
    Sutra.ui.applyTheme();
    document.documentElement.setAttribute("data-density", s.density);
    $("#theme-label").textContent = themeLabels[s.theme] || "Auto";
    $("#btn-theme").setAttribute("aria-pressed", String(s.theme !== "auto"));
    $("#btn-theme").title = "Theme: " + (themeLabels[s.theme] || "Auto") + " — click to change";
    $("#density-label").textContent = s.density === "compact" ? "Compact" : "Comfy";
    $("#btn-density").setAttribute("aria-pressed", String(s.density === "compact"));
  }

  $("#btn-theme").addEventListener("click", () => {
    const next = themes[(themes.indexOf(state.settings.theme) + 1) % themes.length];
    store.setSetting("theme", next);
    applyChrome();
  Sutra.ui.toast("Theme: " + themeLabels[next]);
  });

  $("#btn-density").addEventListener("click", () => {
    const next = state.settings.density === "comfy" ? "compact" : "comfy";
    store.setSetting("density", next);
    applyChrome();
    applyRects(true);
  Sutra.ui.toast("Density: " + (next === "compact" ? "Compact" : "Comfy"));
  });

  $("#btn-palette").addEventListener("click", openPalette);

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Reset Sutra Ultra to its default layout, widgets and preferences?\nThis cannot be undone.")) return;
    try { localStorage.removeItem("sutra.ultra.v1"); localStorage.removeItem("zephyr.ultra.v1"); localStorage.removeItem("luma.ultra.v1"); } catch (e) {}
    location.reload();
  });

  if (mobileMq.addEventListener) {
    mobileMq.addEventListener("change", () => { applyRects(false); });
  }

  window.addEventListener("resize", debounce(() => { applyRects(false); }, 120));

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(debounce(() => { applyRects(false); }, 100));
    ro.observe(gridEl);
  }
  window.addEventListener("load", () => setTimeout(() => applyRects(false), 250));

  /* ---------------- search: suggestions + chips ---------------- */

  const searchInput = $("#search-input");
  const suggEl = $("#suggestions");
  const tbmInput = $("#search-tbm");
  const form = $("#search-form");
  let sugItems = [];
  let sugToken = 0;
  let sugTimer = null;

  const SUGGEST_URL = "https://suggestqueries.google.com/complete/search?client=firefox&hl=" +
    encodeURIComponent((navigator.language || "en").replace("-", "_")) + "&q=";

  function hideSug() {
    sugTimer = null;
    sugItems = [];
    suggEl.hidden = true;
    searchInput.removeAttribute("aria-activedescendant");
  }

  function showSug(items, q) {
    sugItems = items;
    suggEl.innerHTML = "";
    items.forEach((it, i) => {
      suggEl.append(h("button", {
        type: "button", class: "s-suggest-item", role: "option", id: "sug-" + i,
        onclick: () => { searchInput.value = it.t; hideSug(); form.requestSubmit(); },
      },
        h("span", { html: I.search }),
        h("span", { class: "s-term", text: it.t }),
        h("span", { class: "s-type", text: it.k })));
    });
    if (items.length) {
      suggEl.append(h("div", { class: "s-suggest-note",
        text: "Enter to search Google — " + (sugItems.length) + " suggestions" }));
    }
    suggEl.hidden = false;
  }

  function pickSug(dir) {
    if (!sugItems.length) return;
    const cur = parseInt(searchInput.getAttribute("aria-activedescendant"), 10);
    const next = clamp((isNaN(cur) ? -1 : cur) + dir, 0, sugItems.length - 1);
    searchInput.setAttribute("aria-activedescendant", "sug-" + next);
    $$(".s-suggest-item", suggEl).forEach((b, i) =>
      b.setAttribute("data-active", String(i === next)));
    searchInput.value = sugItems[next].t;
  }

  window.__sutraSuggest = (token) => (data) => {
    if (token !== sugToken || !data || !Array.isArray(data[1])) return;
    const q = searchInput.value.trim().toLowerCase();
    const items = data[1].map((t) => {
      const isNav = /^https?:\/\//i.test(t);
      return { t, k: isNav ? "site" : (data[4] && data[4][data[1].indexOf(t)] === "N" ? "navigate" : "search") };
    }).filter((x) => x.t.toLowerCase().startsWith(q)).slice(0, 6);
    showSug(items, q);
  };

  function fetchSuggest(q) {
    const token = ++sugToken;
    const s = document.createElement("script");
    s.src = SUGGEST_URL + encodeURIComponent(q) + "&jsonp=" + "__sutraSuggest_" + token;
    window["__sutraSuggest_" + token] = window.__sutraSuggest(token);
    s.onerror = () => { delete window["__sutraSuggest_" + token]; hideSug(); };
    document.head.append(s);
    setTimeout(() => { delete window["__sutraSuggest_" + token]; s.remove(); }, 4000);
  }

  searchInput.addEventListener("input", debounce(() => {
    const q = searchInput.value.trim();
    if (q.length < 2) { hideSug(); return; }
    fetchSuggest(q);
  }, 140));

  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim().length >= 2) fetchSuggest(searchInput.value.trim());
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); pickSug(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pickSug(-1); }
    else if (e.key === "Escape") hideSug();
  });

  searchInput.addEventListener("blur", () => setTimeout(hideSug, 150));

  $("#s-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".s-chip");
    if (!b) return;
    $$(".s-chip", $("#s-chips")).forEach((x) => x.setAttribute("aria-current", String(x === b)));
    tbmInput.value = b.dataset.tbm;
  });

  /* ---------------- refresh loop ---------------- */

  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    for (const [id, e] of cards) {
      if (!e.def.interval) continue;
      if (now - e.lastRun < e.def.interval) continue;
      e.lastRun = now;
      if (e.def.interval <= 1000 && e.tick) e.tick();
      else if (e.def.refresh) e.def.refresh(e.data, {
        id, update: () => rerender(id),
        openConfig: () => openConfig(id),
        showError: (msg) => showWidgetError(id, msg),
      });
    }
  }, 1000);

  /* ---------------- boot ---------------- */

  applyChrome();
  renderAll();
  if (!mobileMq.matches && window.matchMedia("(pointer: fine)").matches) {
    setTimeout(() => searchInput.focus(), 60);
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
})();
