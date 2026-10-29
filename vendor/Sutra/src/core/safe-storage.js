/*
 * safe-storage.js — defensive wrapper around localStorage / sessionStorage.
 *
 * Loaded before every feature module so `window.SutraSafeStorage` is always
 * available at write time. Feature code routes non-canonical browser-storage
 * writes through here so that a QuotaExceededError, a private-mode security
 * exception, a serialization failure, or storage being unavailable can NEVER:
 *   - throw out of a feature workflow (which would drop the in-memory change
 *     and leave the UI un-rendered), or
 *   - silently lose user-important data with no signal.
 *
 * Importance levels:
 *   'optional'  — preferences/caches; fail quietly (console only, no UI noise).
 *   'important' — user-authored data (e.g. Homework); show a clear, DURABLE
 *                 warning and keep the value in memory so the user can export
 *                 an emergency backup. Does NOT show the catastrophic core
 *                 IndexedDB save-failure banner — that is reserved for the
 *                 canonical workspace pipeline (recordPersistenceFailure).
 *   'critical'  — same UI as 'important'.
 *
 * This module deliberately has zero dependencies and never touches the
 * canonical IndexedDB save pipeline, API-key storage, or exports.
 */
(function () {
  'use strict';

  var WARN_DEDUPE_MS = 12000;
  var lastWarnAt = Object.create(null);
  var degraded = Object.create(null); // key -> { classification, importance, label, at }
  var bannerEl = null;

  function classify(error) {
    if (!error) return 'unknown';
    var name = error.name || '';
    if (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    ) {
      return 'quota';
    }
    if (name === 'SecurityError') return 'security';
    if (name === 'TypeError') return 'serialize';
    return 'unknown';
  }

  function storageAvailable(kind) {
    try {
      return !!(kind === 'session' ? window.sessionStorage : window.localStorage);
    } catch (e) {
      return false;
    }
  }

  function toast(message) {
    try {
      if (typeof window.showToast === 'function') window.showToast(message);
    } catch (e) {
      /* toast subsystem may not be ready yet; banner still shows */
    }
  }

  function humanMessage(classification, label) {
    switch (classification) {
      case 'quota':
        return 'Storage is full, so ' + label + ' could not be saved in this browser.';
      case 'security':
        return 'This browser blocked saving ' + label + ' (private mode or site data is disabled).';
      case 'serialize':
        return label + ' could not be prepared for saving.';
      case 'parse':
        return 'The stored ' + label + ' could not be read because it is damaged.';
      case 'unavailable':
        return 'Browser storage is unavailable, so ' + label + ' could not be saved.';
      default:
        return label + ' could not be saved in this browser.';
    }
  }

  function ensureBanner() {
    if (bannerEl && bannerEl.isConnected) return bannerEl;
    if (!document.body) return null;
    bannerEl = document.createElement('div');
    bannerEl.id = 'sutraStorageWarningBanner';
    bannerEl.setAttribute('role', 'alert');
    bannerEl.setAttribute('aria-live', 'assertive');
    bannerEl.style.cssText =
      'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;' +
      'max-width:min(560px,94vw);background:#7a1d1d;color:#fff;border:1px solid #c0504d;' +
      'border-radius:12px;padding:12px 14px;box-shadow:0 14px 36px rgba(0,0,0,.45);' +
      'font:14px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;gap:10px;align-items:flex-start;';

    var msg = document.createElement('div');
    msg.id = 'sutraStorageWarningMsg';
    msg.style.flex = '1';
    bannerEl.appendChild(msg);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;';

    var backupBtn = document.createElement('button');
    backupBtn.type = 'button';
    backupBtn.textContent = 'Export backup';
    backupBtn.style.cssText =
      'background:#fff;color:#7a1d1d;border:0;border-radius:8px;padding:6px 10px;font-weight:600;cursor:pointer;min-height:32px;';
    backupBtn.addEventListener('click', function () {
      try {
        if (typeof window.exportEmergencySutraBackup === 'function') window.exportEmergencySutraBackup();
        else if (typeof window.exportWorkspaceAsAtelier === 'function') window.exportWorkspaceAsAtelier();
        else toast('Open Settings ▸ Data to export a backup.');
      } catch (e) {
        toast('Could not start a backup export.');
      }
    });

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('aria-label', 'Dismiss storage warning');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText =
      'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:8px;padding:6px 10px;cursor:pointer;min-height:32px;';
    dismissBtn.addEventListener('click', hideBanner);

    actions.appendChild(backupBtn);
    actions.appendChild(dismissBtn);
    bannerEl.appendChild(actions);
    document.body.appendChild(bannerEl);
    return bannerEl;
  }

  function showBanner(message) {
    var el = ensureBanner();
    if (!el) return;
    var msg = el.querySelector('#sutraStorageWarningMsg');
    if (msg) msg.textContent = message;
    el.style.display = 'flex';
    try {
      document.body.setAttribute('data-sutra-storage-degraded', '1');
    } catch (e) {
      /* noop */
    }
  }

  function hideBanner() {
    if (bannerEl) bannerEl.style.display = 'none';
    try {
      if (document.body) document.body.removeAttribute('data-sutra-storage-degraded');
    } catch (e) {
      /* noop */
    }
  }

  function warn(key, classification, importance, label) {
    var now = Date.now();
    degraded[key] = { classification: classification, importance: importance, label: label || key, at: now };

    var human = humanMessage(classification, label || key);
    try {
      window.dispatchEvent(
        new CustomEvent('sutra:storage-warning', {
          detail: { key: key, classification: classification, importance: importance, label: label || key, message: human }
        })
      );
    } catch (e) {
      /* CustomEvent always available in supported browsers */
    }

    if (importance === 'important' || importance === 'critical') {
      // Always keep the durable banner current, but rate-limit transient toasts.
      showBanner(human + ' Your change is kept in memory for now — export a backup to be safe.');
      if (!lastWarnAt[key] || now - lastWarnAt[key] >= WARN_DEDUPE_MS) {
        lastWarnAt[key] = now;
        toast(human);
      }
    } else {
      try {
        console.warn('[SutraSafeStorage]', human);
      } catch (e) {
        /* noop */
      }
    }
  }

  function clearDegraded(key) {
    if (!degraded[key]) return;
    delete degraded[key];
    var anyImportant = Object.keys(degraded).some(function (k) {
      return degraded[k].importance === 'important' || degraded[k].importance === 'critical';
    });
    if (!anyImportant) hideBanner();
  }

  // Metadata-only mutation signal. The canonical workspace bridge listens for
  // explicitly classified portable mirror keys and schedules a normal
  // IndexedDB save; the event never exposes the stored value (which could be
  // sensitive for keys outside that allowlist).
  function publishMutation(key, operation) {
    try {
      window.dispatchEvent(new CustomEvent('sutra:safe-storage-mutated', {
        detail: { key: String(key || ''), operation: operation === 'remove' ? 'remove' : 'set' }
      }));
    } catch (e) {
      /* Advisory only; the localStorage write already succeeded. */
    }
  }

  function set(key, value, opts) {
    opts = opts || {};
    var importance = opts.importance || 'optional';
    var label = opts.label || key;
    var str;
    if (typeof value === 'string') {
      str = value;
    } else {
      try {
        str = JSON.stringify(value);
      } catch (e) {
        warn(key, 'serialize', importance, label);
        return { ok: false, error: e, classification: 'serialize' };
      }
    }
    if (!storageAvailable('local')) {
      warn(key, 'unavailable', importance, label);
      return { ok: false, classification: 'unavailable' };
    }
    try {
      window.localStorage.setItem(key, str); // sutra-allow-storage: this IS the SutraSafeStorage wrapper
      clearDegraded(key);
      publishMutation(key, 'set');
      return { ok: true };
    } catch (e) {
      var c = classify(e);
      warn(key, c, importance, label);
      return { ok: false, error: e, classification: c };
    }
  }

  function get(key, opts) {
    opts = opts || {};
    if (!storageAvailable('local')) return opts.fallback;
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return opts.fallback;
      if (opts.parseJson === false) return raw;
      // Documented parse contract (audit remediation):
      // - Default: stored JSON is parsed; a value that was stored as a plain
      //   string (set() stores strings verbatim) round-trips as that string.
      // - { expectJson: true }: unparseable content is treated as corruption
      //   and opts.fallback is returned (with an important-level warning),
      //   matching sessionGet({parseJson:true}). Callers that need a strict
      //   shape no longer have to defend against a bare string leaking back.
      try { return JSON.parse(raw); } catch (error) {
        if (opts.expectJson === true) {
          if (opts.importance === 'important' || opts.importance === 'critical') {
            warn(key, 'parse', opts.importance, opts.label || key);
          }
          return opts.fallback;
        }
        return raw;
      }
    } catch (e) {
      if (opts.importance === 'important' || opts.importance === 'critical') {
        warn(key, classify(e), opts.importance, opts.label || key);
      }
      return opts.fallback;
    }
  }

  function remove(key, opts) {
    opts = opts || {};
    if (!storageAvailable('local')) return { ok: false, classification: 'unavailable' };
    try {
      window.localStorage.removeItem(key);
      clearDegraded(key);
      publishMutation(key, 'remove');
      return { ok: true };
    } catch (e) {
      var c = classify(e);
      if (opts.importance === 'important' || opts.importance === 'critical') {
        warn(key, c, opts.importance, opts.label || key);
      }
      return { ok: false, error: e, classification: c };
    }
  }

  function session(key, value, opts) {
    opts = opts || {};
    var str;
    if (typeof value === 'string') {
      str = value;
    } else {
      try {
        str = JSON.stringify(value);
      } catch (e) {
        return { ok: false, error: e, classification: 'serialize' };
      }
    }
    if (!storageAvailable('session')) return { ok: false, classification: 'unavailable' };
    try {
      window.sessionStorage.setItem(key, str); // sutra-allow-storage: this IS the SutraSafeStorage wrapper
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e, classification: classify(e) };
    }
  }

  function sessionGet(key, opts) {
    opts = opts || {};
    if (!storageAvailable('session')) return opts.fallback;
    try {
      var raw = window.sessionStorage.getItem(key);
      if (raw === null) return opts.fallback;
      if (opts.parseJson !== true) return raw;
      try { return JSON.parse(raw); } catch (error) { return opts.fallback; }
    } catch (e) {
      return opts.fallback;
    }
  }

  function sessionRemove(key) {
    if (!storageAvailable('session')) return { ok: false, classification: 'unavailable' };
    try {
      window.sessionStorage.removeItem(key);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e, classification: classify(e) };
    }
  }

  window.SutraSafeStorage = {
    get: get,
    set: set,
    remove: remove,
    sessionGet: sessionGet,
    session: session,
    sessionRemove: sessionRemove,
    classify: classify,
    getDegraded: function () {
      try {
        return JSON.parse(JSON.stringify(degraded));
      } catch (e) {
        return {};
      }
    },
    isDegraded: function () {
      return Object.keys(degraded).length > 0;
    },
    clearWarning: function () {
      Object.keys(degraded).forEach(function (k) {
        delete degraded[k];
      });
      hideBanner();
    }
  };
})();
