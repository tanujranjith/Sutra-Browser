/* ============================================================
   SUTRA ULTRA — widget registry
   Each widget: render / config / apply / optional refresh.
   All user content is rendered via text nodes, never raw HTML.
   ============================================================ */

(function () {
  "use strict";
  const { h, $, $$, esc, debounce, clamp } = Sutra.utils;
  const I = Sutra.icons;
  const store = Sutra.store;

  /* ---------- shared field helpers ---------- */

  function field(labelText, control, hint) {
    const kids = [h("label", { text: labelText })];
    if (hint) kids.push(h("span", { class: "hint", text: hint }));
    return h("div", { class: "field" }, [control, ...kids]);
  }

  function segControl(name, options, value) {
    const seg = h("div", { class: "seg", role: "group", "aria-label": name });
    options.forEach((o) => {
      seg.append(
        h("button", {
          type: "button",
          text: o.label,
          "aria-pressed": String(o.value === value),
          dataset: { seg: name, val: o.value },
          class: "seg-btn",
        })
      );
    });
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-seg]");
      if (!b) return;
      $$("[data-seg]", seg).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      seg.dispatchEvent(new CustomEvent("segchange", { detail: b.dataset.val }));
    });
    return seg;
  }

  /* ---------- WMO weather codes ---------- */

  const WMO = {
    clear: [0],
    partly: [1, 2],
    cloud: [3],
    fog: [45, 48],
    drizzle: [51, 53, 55, 56, 57],
    rain: [61, 63, 65, 66, 67, 80, 81, 82],
    snow: [71, 73, 75, 77, 85, 86],
    thunder: [95, 96, 99],
  };
  function wmoType(code) {
    for (const [k, arr] of Object.entries(WMO)) if (arr.includes(code)) return k;
    return "cloud";
  }
  function wmoIcon(code, isDay) {
    const t = wmoType(code);
    if (t === "clear") return isDay ? "wx-clear-d" : "wx-clear-n";
    if (t === "partly") return isDay ? "wx-partly" : "wx-cloud";
    return "wx-" + t;
  }
  const wmoLabel = (code) =>
    ({
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle",
      55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
      61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain",
      67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
      77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers",
      85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm",
      96: "Storm, hail", 99: "Storm, heavy hail",
    }[code] || "Weather");

  /* ---------- registry ---------- */

  const registry = [];

  function reg(def) { registry.push(def); return def; }

  /* ============ CLOCK ============ */

  const TZ_LIST = [
    ["auto", "Local time"], ["America/New_York", "New York"],
    ["America/Chicago", "Chicago"], ["America/Denver", "Denver"],
    ["America/Los_Angeles", "Los Angeles"], ["America/Sao_Paulo", "São Paulo"],
    ["Europe/London", "London"], ["Europe/Paris", "Paris"],
    ["Europe/Berlin", "Berlin"], ["Europe/Moscow", "Moscow"],
    ["Africa/Cairo", "Cairo"], ["Asia/Dubai", "Dubai"],
    ["Asia/Karachi", "Karachi"], ["Asia/Kolkata", "Kolkata"],
    ["Asia/Kuala_Lumpur", "Kuala Lumpur"], ["Asia/Shanghai", "Shanghai"],
    ["Asia/Tokyo", "Tokyo"], ["Australia/Sydney", "Sydney"],
    ["Pacific/Auckland", "Auckland"],
  ];

  reg({
    id: "clock", name: "Clock", desc: "Time, date and greeting in any zone.",
    icon: "clock", min: { w: 3, h: 2 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const tz = data.tz && data.tz !== "auto" ? data.tz : undefined;
      const locale = navigator.language || "en-US";
      const parts = (date) =>
        new Intl.DateTimeFormat(locale, {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: data.h24 === false,
        }).formatToParts(date);

      const fmtDate = new Intl.DateTimeFormat(locale, {
        timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
      const tick = () => {
        const now = new Date();
        const p = Object.fromEntries(parts(now).map((x) => [x.type, x.value]));
        const tEl = $(".clock-time", body);
        if (tEl) tEl.innerHTML = "";
        if (tEl) {
          tEl.append(h("span", { text: p.hour + ":" + p.minute }));
          tEl.append(h("small", { text: p.dayPeriod ? p.dayPeriod.toUpperCase() : "" }));
        }
        const dEl = $(".clock-date", body);
        if (dEl) {
          dEl.innerHTML = "";
          const [w, monthDay, year] = fmtDate.format(now).split(",").map((s) => s.trim());
          dEl.append(h("strong", { text: w + "," }), h("span", { text: monthDay }),
            h("span", { class: "dot" }), h("span", { text: year }));
        }
        const hour = parseInt(p.hour, 10);
        const g = $(".clock-greet", body);
        if (g) {
          g.textContent = hour < 5 ? "Still up?" : hour < 12 ? "Good morning."
            : hour < 18 ? "Good afternoon." : "Good evening.";
        }
        const z = $(".clock-zone", body);
        if (z) {
          const label = data.tz === "auto" ? "Local time"
            : (TZ_LIST.find((t) => t[0] === data.tz) || [data.tz, data.tz])[1];
          z.textContent = label;
        }
      };
      body.append(
        h("div", { class: "clock-face" },
          h("div", { class: "clock-time" }),
          h("div", { class: "clock-date" }),
          h("div", { class: "clock-greet" }),
          h("div", { class: "clock-zone" })
        )
      );
      tick();
      return tick;
    },
    interval: 1000,
    config(form, data) {
      form.append(
        h("div", { class: "field-row" },
          field("Time zone",
            h("select", { id: "cfg-tz" },
              TZ_LIST.map(([v, l]) => h("option", { value: v, text: l, selected: v === data.tz || (v === "auto" && !data.tz) }))
            )),
          field("Format",
            segControl("clock-format",
              [{ label: "12h", value: "12" }, { label: "24h", value: "24" }],
              data.h24 === false ? "12" : "24"))
        )
      );
    },
    apply(data, form) {
      data.tz = $("#cfg-tz", form).value;
      data.h24 = !$("[data-seg='clock-format'][aria-pressed='true']", form).dataset.val;
    },
  });

  /* ============ WEATHER ============ */

  const WX_REFRESH_MS = 20 * 60 * 1000;

  async function resolveCity(data) {
    if (data.lat != null && data.lon != null) return true;
    if (data.city) {
      const r = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=" +
          encodeURIComponent(data.city)
      );
      const j = await r.json();
      if (j && j.results && j.results[0]) {
        data.lat = j.results[0].latitude;
        data.lon = j.results[0].longitude;
        data.name = j.results[0].name;
        return true;
      }
      return false;
    }
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
      data.lat = pos.coords.latitude;
      data.lon = pos.coords.longitude;
      data.name = "";
      try {
        const g = await fetch(
          "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
            pos.coords.latitude + "&longitude=" + pos.coords.longitude + "&localityLanguage=en"
        );
        const gj = await g.json();
        if (gj) data.name = gj.city || gj.locality || gj.principalSubdivision || "";
      } catch (e) { /* name stays empty */ }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function fetchWeather(data, ctx) {
    if (data._busy) return;
    data._busy = true;
    try {
      const ok = await resolveCity(data);
      if (!ok) {
        if (!data.cached) {
          ctx.showError("Weather needs a location. Add a city in settings, or allow location access.");
        }
        return;
      }
      const u = data.unit === "f" ? "fahrenheit" : "celsius";
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=" + data.lat +
          "&longitude=" + data.lon +
          "&current=weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,is_day" +
          "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
          "&forecast_days=6&timezone=auto&temperature_unit=" + u +
          "&wind_speed_unit=kmh"
      );
      const j = await r.json();
      data.cached = { ts: Date.now(), unit: data.unit, name: data.name, data: j };
      store.setWidget(ctx.id, { cached: data.cached });
      ctx.update();
    } catch (e) {
      if (!data.cached) ctx.showError("Couldn't reach the weather service.");
    } finally {
      data._busy = false;
    }
  }

  reg({
    id: "weather", name: "Weather", desc: "Current conditions and a six-day forecast, keyed to your location.",
    icon: "sun", min: { w: 3, h: 3 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const cached = data.cached && data.cached.data;
      const fresh = cached && Date.now() - data.cached.ts < WX_REFRESH_MS;
      if (cached && data.cached.unit !== data.unit) {
        data.cached = null;
        store.setWidget(ctx.id, { cached: null });
        return ctx.update();
      }
      if (!cached) {
        body.append(h("div", { class: "w-spinner" }));
        fetchWeather(data, ctx);
        return;
      }
      const j = cached;
      const c = j.current;
      const unit = data.unit === "f" ? "°F" : "°C";
      const dayAbbr = new Intl.DateTimeFormat(navigator.language || "en", { weekday: "short" });

      body.append(
        h("div", { class: "weather-main" },
          h("div", { class: "weather-ico", html: I[wmoIcon(c.weather_code, c.is_day === 1)] }),
          h("div",
            h("div", { class: "weather-temp", text: Math.round(c.temperature_2m) + unit }),
            h("div", { class: "weather-desc", text: wmoLabel(c.weather_code) + (cached.name ? " · " + cached.name : "") })
          )
        ),
        h("dl", { class: "weather-meta" },
          h("div", { class: "wx-row" },
            h("dt", { text: "Feels like" }), h("dd", { text: Math.round(c.apparent_temperature) + unit })),
          h("div", { class: "wx-row" },
            h("dt", { text: "Humidity" }), h("dd", { text: c.relative_humidity_2m + "%" })),
          h("div", { class: "wx-row" },
            h("dt", { text: "Wind" }), h("dd", { text: Math.round(c.wind_speed_10m) + " km/h" })),
          h("div", { class: "wx-row" },
            h("dt", { text: "Forecast" }), h("dd", { text: "6 days" }))
        ),
        h("div", { class: "weather-forecast" },
          (j.daily.time || []).slice(1, 6).map((t, i) =>
            h("div", { class: "wx-day" },
              h("abbr", { title: t, text: dayAbbr.format(new Date(t + "T12:00:00")) }),
              h("div", { class: "weather-ico mini", html: I[wmoIcon(j.daily.weather_code[i + 1], true)] }),
              h("div", { class: "hi", text: Math.round(j.daily.temperature_2m_max[i + 1]) + "°" }),
              h("div", { class: "lo", text: Math.round(j.daily.temperature_2m_min[i + 1]) + "°" })
            )
          )
        )
      );
      if (!fresh) fetchWeather(data, ctx);
    },
    interval: WX_REFRESH_MS,
    refresh(data, ctx) { fetchWeather(data, ctx); },
    config(form, data) {
      form.append(
        h("div", { class: "field-row" },
          field("Unit",
            segControl("wx-unit",
              [{ label: "°C", value: "c" }, { label: "°F", value: "f" }],
              data.unit || "c")),
          field("Location",
            h("input", { id: "cfg-wx-city", type: "text", placeholder: "City name", value: data.city || "",
              autocomplete: "off" }),
            "Leave empty to use your device location")
        ),
        h("div", { style: "margin-top:12px;display:flex;gap:8px" },
          h("button", { type: "button", class: "btn", id: "cfg-wx-locate", text: "Use my location" }),
          h("button", { type: "button", class: "btn", id: "cfg-wx-refresh", text: "Refresh now" })
        )
      );
      $("#cfg-wx-locate", form).addEventListener("click", () => {
        $("#cfg-wx-city", form).value = "";
        store.setWidget("weather", { city: "", lat: null, lon: null, name: "" });
      });
      $("#cfg-wx-refresh", form).addEventListener("click", () => {
        data.cached = null;
        store.setWidget("weather", { cached: null });
      });
    },
    apply(data, form) {
      const seg = $("[data-seg='wx-unit'][aria-pressed='true']", form);
      const city = $("#cfg-wx-city", form).value.trim();
      const unitChanged = data.unit !== seg.dataset.val;
      data.unit = seg.dataset.val;
      if (city !== (data.city || "")) {
        data.city = city;
        data.lat = null; data.lon = null; data.name = "";
      }
      if (unitChanged || city) {
        data.cached = null;
        store.setWidget("weather", { cached: null, unit: data.unit, city: data.city });
      }
    },
  });

  /* ============ NOTES ============ */

  reg({
    id: "notes", name: "Notes", desc: "A ruled scratchpad that saves as you type.",
    icon: "notes", min: { w: 2, h: 2 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const meta = h("div", { class: "notes-meta" },
        h("span", { class: "notes-count" }),
        h("span", { class: "notes-saved", text: "saved" })
      );
      const ta = h("textarea", { "aria-label": "Notes", placeholder: "Write something…" });
      ta.value = data.text || "";
      const paper = h("div", { class: "notes-paper" }, ta);
      const savedEl = $(".notes-saved", meta);

      const commit = debounce(() => {
        data.text = ta.value;
        store.setWidget("notes", { text: ta.value });
        savedEl.textContent = "saved";
      }, 700);

      ta.addEventListener("input", () => {
        savedEl.textContent = "…";
        $(".notes-count", meta).textContent =
          (ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0) + " words";
        commit();
      });
      window.addEventListener("beforeunload", () => {
        if (data.text !== ta.value) store.setWidget("notes", { text: ta.value });
      });

      $(".notes-count", meta).textContent =
        (data.text && data.text.trim() ? data.text.trim().split(/\s+/).length : 0) + " words";
      body.append(paper, meta);
    },
    config(form, data, ctx) {
      form.append(
        h("p", { class: "hint", style: "margin:0", text: "Notes save automatically as you type." }),
        h("div", { style: "margin-top:16px" },
          h("button", { type: "button", class: "btn danger", id: "cfg-notes-clear", text: "Clear notes" })
        )
      );
      $("#cfg-notes-clear", form).addEventListener("click", () => {
        store.setWidget("notes", { text: "" });
        ctx.update();
        Sutra.ui.toast("Notes cleared");
      });
    },
  });

  /* ============ BOOKMARKS ============ */

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  reg({
    id: "bookmarks", name: "Bookmarks", desc: "Your frequent destinations, in your own order.",
    icon: "bookmark", min: { w: 2, h: 2 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const list = h("div", { class: "bm-list", role: "list" });
      if (!data.items || !data.items.length) {
        list.append(
          h("div", { class: "bm-empty" },
            h("div", { html: I.bookmark }),
            h("span", { text: "No bookmarks yet." }),
            h("button", { class: "bm-add", text: "Add bookmark", onclick: () => ctx.openConfig() })
          )
        );
      } else {
        data.items.forEach((it, i) => {
          const host = hostOf(it.url);
          const fav = h("span", { class: "bm-fav", "aria-hidden": "true", text: (it.title || "?").slice(0, 1).toUpperCase() });
          const img = h("img", { alt: "", width: 14, height: 14, loading: "lazy",
            referrerpolicy: "no-referrer" });
          if (host) {
            img.src = "https://www.google.com/s2/favicons?domain=" + host + "&sz=64";
            img.addEventListener("error", () => img.remove());
            fav.append(img);
          }
          const row = h("a", {
            class: "bm-row", href: it.url, target: "_blank", rel: "noopener noreferrer",
            role: "listitem",
          },
            fav,
            h("span", { class: "bm-name", text: it.title || host }),
            host ? h("span", { class: "bm-host", text: host }) : null,
            h("span", { class: "bm-reorder", role: "group", "aria-label": "Reorder " + (it.title || host) },
              h("button", { class: "w-act", title: "Move up", "aria-label": "Move up", type: "button",
                  disabled: i === 0, onclick: (e) => { e.preventDefault(); move(i, -1); } },
                h("span", { html: I.up })),
              h("button", { class: "w-act", title: "Move down", "aria-label": "Move down", type: "button",
                  disabled: i === data.items.length - 1, onclick: (e) => { e.preventDefault(); move(i, 1); } },
                h("span", { html: I.down })),
              h("button", { class: "w-act", title: "Remove", "aria-label": "Remove", type: "button",
                  onclick: (e) => { e.preventDefault(); remove(i); } },
                h("span", { html: I.trash }))
            )
          );
          list.append(row);
        });
      }
      const move = (i, d) => {
        const items = data.items.slice();
        const [x] = items.splice(i, 1);
        items.splice(i + d, 0, x);
        store.setWidget("bookmarks", { items });
        ctx.update();
      };
      const remove = (i) => {
        const items = data.items.slice();
        items.splice(i, 1);
        store.setWidget("bookmarks", { items });
        ctx.update();
      };
      body.append(list);
    },
    config(form, data, ctx) {
      const wrap = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
      const addRow = () => {
        const id = "bm-" + Math.random().toString(36).slice(2, 8);
        const row = h("div", { class: "field-row", dataset: { id } },
          field("Title", h("input", { type: "text", placeholder: "Name" })),
          field("Address", h("input", { type: "url", placeholder: "https://example.com" })),
          h("div", { class: "field" },
            h("label", { text: " " }),
            h("button", { type: "button", class: "btn danger", "aria-label": "Remove row",
                onclick: () => row.remove() }, h("span", { html: I.trash }))
          )
        );
        wrap.append(row);
      };
      (data.items || []).forEach((it) => {
        const row = h("div", { class: "field-row", dataset: { id: it.id } },
          field("Title", h("input", { type: "text", value: it.title || "" })),
          field("Address", h("input", { type: "url", value: it.url || "" })),
          h("div", { class: "field" },
            h("label", { text: " " }),
            h("button", { type: "button", class: "btn danger", "aria-label": "Remove row",
                onclick: () => row.remove() }, h("span", { html: I.trash }))
          )
        );
        wrap.append(row);
      });
      form.append(
        wrap,
        h("div", { style: "margin-top:14px" },
          h("button", { type: "button", class: "btn", id: "cfg-bm-add", text: "Add bookmark" })
        )
      );
      $("#cfg-bm-add", form).addEventListener("click", addRow);
      form.__bmDraft = () => {
        const out = [];
        $$("[data-id]", wrap).forEach((row) => {
          const inputs = $$("input", row);
          const title = inputs[0].value.trim();
          const url = inputs[1].value.trim();
          if (!url) return;
          const host = hostOf(url);
          out.push({ id: row.dataset.id, title: title || host || url, url: host ? url : "https://" + url });
        });
        return out;
      };
    },
    apply(data, form) {
      const next = form.__bmDraft ? form.__bmDraft() : data.items;
      delete form.__bmDraft;
      store.setWidget("bookmarks", { items: next });
    },
  });

  /* ============ NEWS ============ */

  const NEWS_CACHE_MS = 10 * 60 * 1000;
  const NEWS_PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  ];
  const GN_RSS = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";

  async function fetchNews(data, ctx) {
    if (data._busy) return;
    data._busy = true;
    try {
      let items = null;
      if (data.feed === "hn") {
        const r = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10");
        const j = await r.json();
        items = (j.hits || []).map((x) => ({
          title: x.title || "", url: x.url || "https://news.ycombinator.com/item?id=" + x.objectID,
          src: "Hacker News", id: "hn-" + x.objectID,
        }));
      } else {
        const rss = await fetch(GN_RSS);
        const xml = await rss.text();
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        items = $$("item", doc).slice(0, 10).map((it) => ({
          title: $("title", it) ? $("title", it).textContent : "",
          url: $("link", it) ? $("link", it).textContent : "#",
          src: ($("source", it) ? $("source", it).textContent : "Google News").replace(/ - .*$/, ""),
          id: "gn-" + ($("guid", it) ? $("guid", it).textContent : Math.random()),
        }));
      }
      data.cached = { ts: Date.now(), feed: data.feed, items };
      store.setWidget("news", { cached: data.cached });
      ctx.update();
    } catch (e) {
      if (data.feed === "gnews") {
        for (const proxy of NEWS_PROXIES) {
          try {
            const r = await fetch(proxy(GN_RSS));
            const xml = await r.text();
            const doc = new DOMParser().parseFromString(xml, "text/xml");
            const items = $$("item", doc).slice(0, 10).map((it) => ({
              title: $("title", it) ? $("title", it).textContent : "",
              url: $("link", it) ? $("link", it).textContent : "#",
              src: ($("source", it) ? $("source", it).textContent : "Google News").replace(/ - .*$/, ""),
              id: "gn-p-" + ($("guid", it) ? $("guid", it).textContent : Math.random()),
            }));
            data.cached = { ts: Date.now(), feed: data.feed, items };
            store.setWidget("news", { cached: data.cached });
            ctx.update();
            return;
          } catch (e2) { /* try next proxy */ }
        }
      }
      if (!data.cached) ctx.showError("Couldn't fetch news. Check your connection and try again.");
    } finally {
      data._busy = false;
    }
  }

  reg({
    id: "news", name: "News", desc: "Top headlines — Google News or Hacker News.",
    icon: "news", min: { w: 3, h: 2 }, def: { w: 9, h: 4 },
    render(body, data, ctx) {
      const cached = data.cached;
      const fresh = cached && cached.feed === data.feed && Date.now() - cached.ts < NEWS_CACHE_MS;
      if (!cached || cached.feed !== data.feed) {
        body.append(h("div", { class: "w-spinner" }));
        fetchNews(data, ctx);
        return;
      }
      const list = h("div", { class: "news-list" });
      (cached.items || []).forEach((it, i) => {
        list.append(h("a", { class: "news-item", href: it.url, target: "_blank", rel: "noopener noreferrer" },
          h("span", { class: "news-idx", text: String(i + 1).padStart(2, "0") }),
          h("span", { class: "news-title", text: it.title }),
          h("span", { class: "news-src", text: it.src })
        ));
      });
      body.append(list);
      if (!fresh) fetchNews(data, ctx);
    },
    interval: NEWS_CACHE_MS,
    refresh(data, ctx) { fetchNews(data, ctx); },
    config(form, data) {
      form.append(
        field("Source",
          h("select", { id: "cfg-news-feed" },
            h("option", { value: "gnews", text: "Google News — top stories", selected: data.feed === "gnews" }),
            h("option", { value: "hn", text: "Hacker News — front page", selected: data.feed !== "gnews" })
          ),
          "Google News is fetched via a public relay; Hacker News connects directly.")
      );
    },
    apply(data, form) {
      const next = $("#cfg-news-feed", form).value;
      if (next !== data.feed) {
        data.feed = next;
        data.cached = null;
        store.setWidget("news", { feed: next, cached: null });
      }
    },
  });

  /* ============ TASKS ============ */

  reg({
    id: "tasks", name: "Tasks", desc: "A short list of what matters today.",
    icon: "tasks", min: { w: 2, h: 2 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const input = h("input", { type: "text", placeholder: "Add a task…", "aria-label": "New task",
        maxlength: 200 });
      const addBtn = h("button", { type: "button", "aria-label": "Add task", html: I.plus });
      const list = h("div", { class: "tasks-list", role: "list" });
      const foot = h("div", { class: "notes-meta" },
        h("span", { class: "tasks-count" }));

      const redraw = () => {
        list.innerHTML = "";
        if (!data.items.length) {
          list.append(h("div", { class: "tasks-empty", text: "Nothing on the list. Add your first task." }));
        } else {
          data.items.forEach((t, i) => {
            const row = h("div", { class: "task-row" + (t.done ? " done" : ""), role: "listitem" },
              h("input", { class: "task-check", type: "checkbox", checked: t.done,
                "aria-label": "Mark done: " + t.text,
                onchange: (e) => {
                  data.items[i].done = e.target.checked;
                  store.setWidget("tasks", { items: data.items });
                  row.classList.toggle("done", e.target.checked);
                  count();
                } }),
              h("span", { class: "task-label", text: t.text }),
              h("button", { class: "w-act task-del", title: "Delete", "aria-label": "Delete task",
                  type: "button", onclick: () => {
                    data.items.splice(i, 1);
                    store.setWidget("tasks", { items: data.items });
                    redraw();
                  } }, h("span", { html: I.trash }))
            );
            list.append(row);
          });
        }
        count();
      };
      const count = () => {
        const done = data.items.filter((t) => t.done).length;
        $(".tasks-count", foot).textContent =
          data.items.length ? done + " of " + data.items.length + " done" : "";
      };

      const add = () => {
        const text = input.value.trim();
        if (!text) return;
        data.items.push({ id: "t" + Math.random().toString(36).slice(2, 8), text, done: false });
        store.setWidget("tasks", { items: data.items });
        input.value = "";
        redraw();
        input.focus();
      };

      addBtn.addEventListener("click", add);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) add();
      });

      body.append(
        h("div", { class: "tasks-new" }, input, addBtn),
        list,
        foot
      );
      redraw();
    },
    config(form, data, ctx) {
      const done = data.items.filter((t) => t.done).length;
      form.append(
        h("p", { class: "hint", style: "margin:0",
          text: done ? done + " completed task" + (done > 1 ? "s" : "") + "." : "No completed tasks yet." }),
        h("div", { style: "margin-top:16px" },
          h("button", { type: "button", class: "btn danger", id: "cfg-tasks-clear", text: "Clear completed",
              disabled: !done })
        )
      );
      $("#cfg-tasks-clear", form).addEventListener("click", () => {
        store.setWidget("tasks", { items: data.items.filter((t) => !t.done) });
        ctx.update();
        Sutra.ui.toast("Completed tasks removed");
      });
    },
  });

  /* ============ CALENDAR ============ */

  reg({
    id: "calendar", name: "Calendar", desc: "The month at a glance.",
    icon: "calendar", min: { w: 3, h: 3 }, def: { w: 4, h: 3 },
    render(body, data, ctx) {
      const locale = navigator.language || "en-US";
      const today = new Date();
      const base = new Date(today.getFullYear(), today.getMonth() + data.monthOffset, 1);
      const months = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });

      const head = h("div", { class: "cal-head" },
        h("div", { class: "cal-title", text: months.format(base) }),
        h("span", { class: "cal-nav", role: "group", "aria-label": "Change month" },
          h("button", { class: "icon-btn", "aria-label": "Previous month", title: "Previous month",
              onclick: () => { store.setWidget("calendar", { monthOffset: data.monthOffset - 1 }); ctx.update(); } },
            h("span", { html: I["chevron-l"] })),
          h("button", { class: "icon-btn", "aria-label": "Next month", title: "Next month",
              onclick: () => { store.setWidget("calendar", { monthOffset: data.monthOffset + 1 }); ctx.update(); } },
            h("span", { html: I["chevron-r"] }))
        )
      );

      const firstDay = new Date(base.getFullYear(), base.getMonth(), 1).getDay();
      const mondayFirst = (firstDay + 6) % 7;
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const prevDays = new Date(base.getFullYear(), base.getMonth(), 0).getDate();
      const grid = h("div", { class: "cal-grid", role: "grid", "aria-label": months.format(base) });

      for (let i = 0; i < 42; i++) {
        let day, cls = "cal-cell", key = null;
        if (i < mondayFirst) { day = prevDays - mondayFirst + i + 1; cls += " out"; }
        else if (i >= mondayFirst + daysInMonth) { day = i - mondayFirst - daysInMonth + 1; cls += " out"; }
        else {
          day = i - mondayFirst + 1;
          key = base.getFullYear() + "-" + (base.getMonth() + 1) + "-" + day;
          if (key === today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate()) cls += " today";
          const dow = new Date(base.getFullYear(), base.getMonth(), day).getDay();
          if (dow === 0 || dow === 6) cls += " weekend";
        }
        grid.append(h("div", { class: cls, role: "gridcell", "aria-label": key },
          h("span", { text: String(day) })));
      }

      const foot = h("div", { class: "cal-foot" },
        h("span", { text: "Week " + Math.ceil((mondayFirst + daysInMonth) / 7) + " of the year · "
          + Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 864e5) + " days in" }),
        data.monthOffset ? h("button", { type: "button", text: "Today",
          onclick: () => { store.setWidget("calendar", { monthOffset: 0 }); ctx.update(); } }) : null
      );

      const dow = h("div", { class: "cal-dow", role: "row" },
        ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => h("span", { text: d })));

      body.append(head, dow, grid, foot);
    },
  });

  /* ============ SYSTEM ============ */

  const UA_PARSERS = [
    [/Edg\/([\d.]+)/, "Edge"], [/Chrome\/([\d.]+)/, "Chrome"],
    [/Firefox\/([\d.]+)/, "Firefox"], [/Safari\/([\d.]+)/, "Safari"],
  ];
  function browserName() {
    const ua = navigator.userAgent;
    for (const [re, name] of UA_PARSERS) if (re.test(ua)) return name;
    return "Browser";
  }

  reg({
    id: "system", name: "System", desc: "A quiet readout of your device.",
    icon: "system", min: { w: 2, h: 2 }, def: { w: 3, h: 3 },
    render(body, data, ctx) {
      const dl = h("dl", { class: "sys-grid" });
      const item = (k, v) => {
        const dd = h("dd", { text: v });
        dl.append(h("div", { class: "sys-item" }, h("dt", { text: k }), dd));
        return dd;
      };

      const mem = navigator.deviceMemory;
      item("Memory", mem ? mem + " GB" : "—");
      item("Cores", navigator.hardwareConcurrency || "—");
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      item("Network", conn ? (conn.effectiveType || "unknown").toUpperCase() : "—");

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
      item("Zone", tz.split("/").pop().replace(/_/g, " ") || tz);
      item("Screen", screen.width + "×" + screen.height);
      item("Engine", browserName());

      const uptimeEl = item("Session", "");
      const battWrap = item("Battery", "");

      const pad = (n) => String(n).padStart(2, "0");
      const fmtUptime = (ms) => {
        const m = Math.floor(ms / 60000);
        return m >= 1440 ? Math.floor(m / 1440) + "d " + Math.floor((m % 1440) / 60) + "h"
          : m >= 60 ? Math.floor(m / 60) + "h " + pad(m % 60) + "m"
          : m + "m";
      };
      const tick = () => { uptimeEl.textContent = fmtUptime(performance.now()); };

      const paintBattery = (b) => {
        battWrap.innerHTML = "";
        const pct = Math.round(b.level * 100);
        battWrap.append(
          h("span", { style: "font-weight:600", text: pct + "%" }),
          h("span", { class: "batt-bar", "aria-label": "Battery " + pct + "%" },
            h("span", { class: "fill" + (pct < 20 ? " crit" : pct < 40 ? " low" : ""), style: "width:" + pct + "%" }))
        );
        if (b.charging) battWrap.append(h("span", { text: "charging", style: "font-size:11px;color:var(--ok);margin-left:6px;text-transform:uppercase;letter-spacing:.08em" }));
      };
      if (navigator.getBattery) {
        navigator.getBattery().then((b) => {
          paintBattery(b);
          const upd = () => paintBattery(b);
          b.addEventListener("levelchange", upd);
          b.addEventListener("chargingchange", upd);
        }).catch(() => {});
      } else {
        battWrap.append(h("span", { text: "—" }));
      }

      body.append(dl);
      tick();
      return tick;
    },
    interval: 60000,
  });

  /* ---------- search hero state (shared with main) ---------- */

  window.SutraWidgets = { registry, segControl, field, wmoLabel, hostOf };
})();
