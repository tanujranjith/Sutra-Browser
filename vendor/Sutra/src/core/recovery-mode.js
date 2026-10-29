/* Minimal recovery boot controller. Loaded before optional feature modules. */
(function (global) {
  'use strict';

  var SESSION_KEY = 'sutra:recoveryMode:v1';
  var failures = [];
  var active = readRequestedState();

  function readSession() {
    try {
      if (global.SutraSafeStorage && typeof global.SutraSafeStorage.sessionGet === 'function') return global.SutraSafeStorage.sessionGet(SESSION_KEY, { parseJson: true, fallback: null });
      return JSON.parse(global.sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (_) { return null; }
  }
  function writeSession(value) {
    try {
      if (global.SutraSafeStorage && typeof global.SutraSafeStorage.session === 'function') return global.SutraSafeStorage.session(SESSION_KEY, value);
      global.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); // sutra-allow-storage: emergency fallback when SutraSafeStorage failed to load
    } catch (_) { /* recovery must work without storage */ }
  }
  function clearSession() {
    try {
      if (global.SutraSafeStorage && typeof global.SutraSafeStorage.sessionRemove === 'function') return global.SutraSafeStorage.sessionRemove(SESSION_KEY);
      global.sessionStorage.removeItem(SESSION_KEY);
    } catch (_) { /* non-critical */ }
  }
  function readRequestedState() {
    try {
      var requested = new URL(global.location.href).searchParams.get('sutraRecoveryMode') === '1';
      var saved = readSession();
      return requested || !!(saved && saved.active);
    } catch (_) { return false; }
  }
  function navigate(activeValue) {
    try {
      var url = new URL(global.location.href);
      if (activeValue) url.searchParams.set('sutraRecoveryMode', '1');
      else url.searchParams.delete('sutraRecoveryMode');
      global.location.href = url.toString();
    } catch (_) { try { global.location.reload(); } catch (error) {} }
  }
  function enter(reason) {
    active = true;
    writeSession({ active: true, reason: String(reason || 'manual'), enteredAt: new Date().toISOString(), failures: failures.slice(-20) });
    navigate(true);
  }
  function exit() { active = false; clearSession(); navigate(false); }
  function noteOptionalFailure(feature, detail) {
    failures.push({ feature: String(feature || 'optional-feature'), detail: String(detail || ''), at: new Date().toISOString() });
    failures = failures.slice(-20);
    var saved = readSession() || {};
    if (!saved.active) writeSession({ active: false, recommended: true, failures: failures.slice() });
  }
  function makeButton(label, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'min-height:40px;padding:8px 12px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;font-weight:650;cursor:pointer;';
    button.addEventListener('click', action);
    return button;
  }
  function mountBanner() {
    if (!active || !document.body) return null;
    document.body.setAttribute('data-sutra-recovery-mode', '1');
    var existing = document.getElementById('sutraRecoveryModeBanner');
    if (existing) return existing;
    var style = document.createElement('style');
    style.id = 'sutraRecoveryModeStyles';
    style.textContent = 'body[data-sutra-recovery-mode="1"] .view-tab[data-view]:not([data-view="notes"]):not([data-view="settings"]),body[data-sutra-recovery-mode="1"] .view-more,body[data-sutra-recovery-mode="1"] .view-tab-theme{display:none!important}';
    document.head.appendChild(style);
    var banner = document.createElement('section');
    banner.id = 'sutraRecoveryModeBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:sticky;top:0;z-index:2147483000;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:#4b2611;color:#fff3df;border-bottom:2px solid #d79a45;font:14px/1.4 system-ui,sans-serif;';
    var text = document.createElement('div');
    text.style.flex = '1 1 300px';
    text.textContent = 'Recovery Mode is active. Optional student, AI, and customization systems are paused; Notes, persistence, backups, and diagnostics remain available.';
    banner.appendChild(text);
    banner.appendChild(makeButton('Emergency backup', function () {
      try {
        if (global.SutraPersistenceHealth && typeof global.SutraPersistenceHealth.exportEmergencyBackup === 'function') global.SutraPersistenceHealth.exportEmergencyBackup();
        else if (typeof global.exportWorkspaceAsAtelier === 'function') global.exportWorkspaceAsAtelier();
      } catch (_) {}
    }));
    banner.appendChild(makeButton('Download diagnostics', function () { try { if (global.SutraDiagnostics && typeof global.SutraDiagnostics.download === 'function') global.SutraDiagnostics.download(); } catch (_) {} }));
    banner.appendChild(makeButton('Exit Recovery Mode', exit));
    document.body.insertBefore(banner, document.body.firstChild);
    return banner;
  }

  var api = { VERSION: '1.0.0', isActive: function () { return active; }, enter: enter, exit: exit, noteOptionalFailure: noteOptionalFailure, getFailures: function () { return failures.slice(); }, shouldLoadOptionalFeature: function () { return !active; }, mountBanner: mountBanner };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SutraRecoveryMode = api;
}(typeof window !== 'undefined' ? window : globalThis));
