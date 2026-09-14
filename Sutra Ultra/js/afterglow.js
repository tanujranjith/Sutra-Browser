(function () {
  "use strict";

  const shell = document.querySelector(".afterglow-shell");
  const form = document.querySelector("#search-form");
  const input = document.querySelector("#search-input");
  const searchIcon = document.querySelector("#search-icon");
  const live = document.querySelector("#live");
  const customize = document.querySelector("#btn-customize");
  const dialog = document.querySelector("#customize-dialog");
  const artMode = document.querySelector("#art-mode");
  const dockPosition = document.querySelector("#dock-position");
  const reset = document.querySelector("#reset-settings");
  const SETTINGS_KEY = "sutra.afterglow.settings";
  const PREV_SETTINGS_KEY = "zephyr.afterglow.settings";

  if (window.Sutra && Sutra.icons && Sutra.icons.search && searchIcon)
    searchIcon.innerHTML = Sutra.icons.search;

  function announce(message) {
    if (!live) return;
    live.textContent = "";
    window.setTimeout(() => { live.textContent = message; }, 20);
  }

  function navigate(query) {
    const value = query.trim();
    if (!value) return;
    if (window.chrome && chrome.webview && typeof chrome.webview.postMessage === "function") {
      chrome.webview.postMessage({ kind: "new-tab-search", query: value });
      return;
    }
    const looksLikeUrl = /^(https?:\/\/|www\.|localhost(?::|\/)|127\.0\.0\.1(?::|\/))/i.test(value);
    window.location.assign(looksLikeUrl
      ? (value.startsWith("http") ? value : "https://" + value)
      : "https://www.google.com/search?q=" + encodeURIComponent(value));
  }

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(PREV_SETTINGS_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function applySettings(settings) {
    const art = settings.art === "quiet" ? "quiet" : "afterglow";
    const dock = settings.dock === "bottom-center" ? "bottom-center" : "lower-left";
    shell.dataset.art = art;
    shell.dataset.dock = dock;
    if (artMode) artMode.value = art;
    if (dockPosition) dockPosition.value = dock;
  }

  function saveSettings() {
    const settings = { art: artMode.value, dock: dockPosition.value };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ }
    applySettings(settings);
    announce("Customize settings saved");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(input.value);
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === "Escape" && document.activeElement === input) input.blur();
  });

  customize.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
  });

  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") saveSettings();
  });

  reset.addEventListener("click", () => {
    const defaults = { art: "afterglow", dock: "lower-left" };
    try { localStorage.removeItem(SETTINGS_KEY); } catch (_) { /* private mode */ }
    applySettings(defaults);
    announce("Customize settings reset");
  });

  applySettings(readSettings());
  const dateLabel = document.querySelector('#canvas-date');
  if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  if (window.chrome?.webview) chrome.webview.addEventListener('message', event => {
    const context = event.data;
    if (!context || context.kind !== 'sutra-context') return;
    document.documentElement.dataset.theme = context.theme === 'light' ? 'light' : 'dark';
    if (/^#[0-9a-f]{6}$/i.test(context.accent || '')) document.documentElement.style.setProperty('--accent', context.accent);
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow && context.privateWindow) eyebrow.textContent = '◆ PRIVATE WINDOW';
    else if (eyebrow && typeof context.profile === 'string' && context.profile !== 'Default') eyebrow.textContent = '◆ ' + context.profile.toUpperCase();
    if (context.privateWindow) {
      document.querySelector('.welcome-description').textContent = 'Your history and session are not saved in this window.';
      for (const action of ['history','notes','workspaces']) {
        const button = document.querySelector('[data-action="' + action + '"]');
        if (button) { button.disabled = true; button.title = 'Unavailable in private browsing'; }
      }
    }
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (window.chrome?.webview) chrome.webview.postMessage({ kind: 'new-tab-action', action: button.dataset.action });
    else announce('Open this page in Sutra Browser to use your ' + button.textContent.trim().replace(/\s+/g, ' ') + '.');
  }));
  window.setTimeout(() => input.focus(), 80);
})();
