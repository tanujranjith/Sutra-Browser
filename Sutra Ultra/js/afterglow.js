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
  const showFavorites = document.querySelector('#show-favorites');
  const showResume = document.querySelector('#show-resume');
  let privateWindow = false;
  let announcementGeneration = 0;
  let announcementTimer;
  const SETTINGS_KEY = "sutra.afterglow.settings";
  const PREV_SETTINGS_KEY = "zephyr.afterglow.settings";

  if (window.Sutra && Sutra.icons && Sutra.icons.search && searchIcon)
    searchIcon.innerHTML = Sutra.icons.search;

  function announce(message) {
    if (!live) return;
    const generation = ++announcementGeneration;
    clearTimeout(announcementTimer);
    live.textContent = "";
    window.setTimeout(() => {
      if (generation !== announcementGeneration) return;
      live.textContent = message;
      announcementTimer = window.setTimeout(() => {
        if (generation === announcementGeneration) live.textContent = '';
      }, 3200);
    }, 20);
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
    if (showFavorites) showFavorites.checked = settings.favorites !== false;
    if (showResume) showResume.checked = settings.resume !== false;
    updateSections();
  }

  function saveSettings() {
    const settings = { art: artMode.value, dock: dockPosition.value, favorites: showFavorites?.checked !== false, resume: showResume?.checked !== false };
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
    applySettings(readSettings());
    if (typeof dialog.showModal === "function") dialog.showModal();
  });

  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") saveSettings();
    else applySettings(readSettings());
  });

  reset.addEventListener("click", () => {
    const defaults = { art: "afterglow", dock: "lower-left" };
    try { localStorage.removeItem(SETTINGS_KEY); } catch (_) { /* private mode */ }
    applySettings(defaults);
    announce("Customize settings reset");
  });

  applySettings(readSettings());

  function updateSections() {
    const favorites = document.querySelector('#favorite-section');
    const resume = document.querySelector('#resume-section');
    if (favorites) favorites.hidden = privateWindow || showFavorites?.checked === false;
    if (resume) resume.hidden = privateWindow || showResume?.checked === false;
    const grid = document.querySelector('.dashboard-grid');
    if (grid) grid.hidden = (!favorites || favorites.hidden) && (!resume || resume.hidden);
    const note = document.querySelector('#private-note');
    if (note) note.hidden = !privateWindow;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function monogram(url) {
    const host = url.hostname.replace(/^www\./, '');
    const icon = element('span', 'site-monogram', host.slice(0, 2).toUpperCase());
    icon.setAttribute('aria-hidden', 'true');
    icon.dataset.tone = String([...host].reduce((total, char) => total + char.charCodeAt(0), 0) % 5);
    return icon;
  }

  function emptyState(parent, title, detail, bookmarks) {
    const empty = element('div', 'dashboard-empty');
    empty.append(element('strong', '', title), element('p', '', detail));
    if (bookmarks) {
      const button = element('button', '', 'Explore bookmarks'); button.type = 'button';
      button.addEventListener('click', () => {
        if (window.chrome?.webview) chrome.webview.postMessage({kind:'new-tab-action',action:'bookmarks'});
        else announce('Open Sutra to manage your bookmarks.');
      });
      empty.append(button);
    }
    parent.append(empty);
  }

  function renderDashboard(context) {
    privateWindow = context.privateWindow === true;
    updateSections();
    const status = document.querySelector('#session-status');
    if (status) status.textContent = privateWindow ? 'PRIVATE WINDOW' : 'ON THIS DEVICE';
    const favorites = document.querySelector('#favorite-grid');
    const resume = document.querySelector('#resume-grid');
    if (!favorites || !resume) return;
    favorites.replaceChildren(); resume.replaceChildren();
    const links = !privateWindow && Array.isArray(context.favorites) ? context.favorites.slice(0, 8) : [];
    for (const item of links) {
      const url = safeUrl(item?.url); if (!url) continue;
      const title = String(item.title || url.hostname).slice(0, 160);
      const button = element('button', 'favorite-tile'); button.type = 'button'; button.title = url.hostname;
      button.append(monogram(url), element('span', 'favorite-title', title));
      button.addEventListener('click', () => {
        if (window.chrome?.webview) chrome.webview.postMessage({kind:'open-url',url:url.href});
        else navigate(url.href);
      });
      favorites.append(button);
    }
    if (!favorites.children.length) emptyState(favorites, 'A few favorites go a long way.', "Bookmark the places you love. They'll be right here.", true);
    const tabs = !privateWindow && Array.isArray(context.tabs) ? context.tabs.slice(0, 6) : [];
    for (const item of tabs) {
      const url = safeUrl(item?.url);
      if (!url || typeof item.tabId !== 'string' || !/^[a-f0-9-]{36}$/i.test(item.tabId)) continue;
      const title = String(item.title || url.hostname).slice(0, 160);
      const button = element('button', 'resume-card'); button.type = 'button'; button.title = title;
      const copy = element('span', 'resume-copy');
      copy.append(element('span', 'resume-title', title), element('span', 'resume-origin', (item.sleeping ? 'Sleeping · ' : '') + url.hostname.replace(/^www\./, '')));
      button.append(monogram(url), copy);
      button.addEventListener('click', () => {
        if (window.chrome?.webview) chrome.webview.postMessage({kind:'new-tab-switch',tabId:item.tabId});
        else navigate(url.href);
      });
      resume.append(button);
    }
    const count = document.querySelector('#resume-count');
    if (count) count.textContent = resume.children.length ? `${resume.children.length} open` : '';
    if (!resume.children.length) emptyState(resume, 'Good ideas deserve a place to return.', 'Open another page and it will be waiting here.', false);
  }

  const dateLabel = document.querySelector('#canvas-date');
  if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  function receiveContext(context) {
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
    renderDashboard(context);
  }
  if (window.chrome?.webview) chrome.webview.addEventListener('message', event => receiveContext(event.data));
  window.addEventListener('sutra-dashboard', event => receiveContext(event.detail));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (window.chrome?.webview) chrome.webview.postMessage({ kind: 'new-tab-action', action: button.dataset.action });
    else announce('Open this page in Sutra to use your ' + button.textContent.trim().replace(/\s+/g, ' ') + '.');
  }));
  // Native Sutra focuses its address bar for every new tab.
  if (!window.chrome?.webview) window.setTimeout(() => input.focus(), 80);
})();
