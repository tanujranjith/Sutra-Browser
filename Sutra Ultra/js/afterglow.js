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
  window.setTimeout(() => input.focus(), 80);
})();
