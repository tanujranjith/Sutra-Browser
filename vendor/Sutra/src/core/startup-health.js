/*
 * startup-health.js — runtime startup INTEGRITY guard + recovery affordance.
 *
 * Sutra already has reactive safety layers:
 *   - error-reporter.js  funnels thrown errors into diagnostics,
 *   - feature-guard.js   isolates a broken *feature* so the rest still boots,
 *   - issue-prompt.js    nudges the user to FILE AN ISSUE on an error/self-check,
 *   - SutraSafeStorage / SutraPersistenceHealth surface storage/save failures.
 *
 * What was missing is a single PROACTIVE check that answers: "did the app
 * actually come up healthy, and if a CRITICAL subsystem failed to initialize,
 * can the user RECOVER their data?" A catastrophic early throw in app.js (before
 * it wires save/export) leaves the user with a half-dead shell and no guidance.
 * This module watchdogs boot and, ONLY for genuine critical failures, shows a
 * small, non-blocking recovery banner offering Reload / Safe Mode / Emergency
 * export — the data-safety actions, not "file an issue".
 *
 * Design constraints (match the rest of the core safety layer):
 *   - Zero dependencies. Classic script, IIFE, ONE namespaced global.
 *   - Must NEVER throw and must NEVER block normal use (no alert/confirm).
 *   - DOM built with createElement/textContent ONLY (no innerHTML sink).
 *   - No storage writes, NO network, NO telemetry, never exposes workspace data.
 *   - False-alarm resistant: the banner appears only when a CRITICAL subsystem is
 *     actually absent AFTER boot has had a fair chance (watchdog + rechecks).
 *   - Lightweight: the checks are trivial global/DOM lookups; the watchdog only
 *     does real work if something is wrong, so healthy startup is untouched.
 */
(function () {
  'use strict';

  // --- tuning -----------------------------------------------------------------
  // Boot, even on a heavy/slow machine, wires its critical globals well within
  // this window. We only act once boot has had a fair chance, so a slow-but-
  // healthy startup never trips the recovery banner.
  var WATCHDOG_MS = 12000;
  var RECHECK_MS = 4000;     // gap between confirmation rechecks
  var MAX_RECHECKS = 2;      // total confirmations before we believe a failure

  // --- state ------------------------------------------------------------------
  var lastReport = null;
  var bannerEl = null;
  var watchdogDone = false;

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  // --- the check battery ------------------------------------------------------
  // severity 'critical' => data at risk / app unusable => offer recovery.
  // severity 'warning'  => degraded but usable => recorded only, never blocks.
  var CHECKS = [
    {
      name: 'app-runtime', label: 'Workspace runtime (save/export wiring)', severity: 'critical',
      fn: function () {
        return typeof window.saveWorkspaceLocally === 'function'
          && typeof window.serializeWorkspace === 'function';
      }
    },
    {
      name: 'safe-storage', label: 'Safe storage wrapper', severity: 'critical',
      fn: function () {
        return !!(window.SutraSafeStorage && typeof window.SutraSafeStorage.set === 'function');
      }
    },
    {
      name: 'persistence-pipeline', label: 'Persistence-health pipeline', severity: 'critical',
      fn: function () {
        return !!(window.SutraPersistenceHealth && typeof window.SutraPersistenceHealth.getState === 'function');
      }
    },
    {
      name: 'app-shell', label: 'Application shell DOM', severity: 'critical',
      fn: function () {
        try { return !!document.querySelector('.app-container'); } catch (e) { return false; }
      }
    },
    {
      name: 'dom-safety', label: 'DOM sanitize layer', severity: 'warning',
      fn: function () {
        return !!(window.SutraDOMSafety && typeof window.SutraDOMSafety.setText === 'function');
      }
    },
    {
      name: 'migrations', label: 'Workspace migration registry', severity: 'warning',
      fn: function () {
        return !!(window.SutraMigrations && typeof window.SutraMigrations.migrateWorkspace === 'function');
      }
    },
    {
      name: 'feature-health', label: 'Feature isolation', severity: 'warning',
      fn: function () {
        try {
          if (window.SutraFeatureGuard && typeof window.SutraFeatureGuard.isDegraded === 'function') {
            return !window.SutraFeatureGuard.isDegraded();
          }
        } catch (e) { /* unknown */ }
        return true; // unknown == don't false-alarm
      }
    },
    {
      name: 'storage-health', label: 'Browser storage availability', severity: 'warning',
      fn: function () {
        try {
          if (window.SutraSafeStorage && typeof window.SutraSafeStorage.isDegraded === 'function') {
            return !window.SutraSafeStorage.isDegraded();
          }
        } catch (e) { /* unknown */ }
        return true;
      }
    }
  ];

  /**
   * run(opts) — execute the check battery and return a structured report.
   *   opts.silent          : never render, even on critical (default false)
   *   opts.simulateMissing : array of check names to force-fail (test hook only)
   * Returns { ok, criticalCount, warningCount, checks:[{name,label,severity,ok}], at }.
   * Renders the recovery banner iff (!silent && criticalCount > 0).
   */
  function run(opts) {
    opts = opts || {};
    var simulate = {};
    if (opts.simulateMissing && opts.simulateMissing.length) {
      for (var s = 0; s < opts.simulateMissing.length; s++) simulate[opts.simulateMissing[s]] = true;
    }
    var checks = [];
    var criticalCount = 0;
    var warningCount = 0;
    for (var i = 0; i < CHECKS.length; i++) {
      var c = CHECKS[i];
      var ok;
      if (simulate[c.name]) {
        ok = false;
      } else {
        try { ok = !!c.fn(); } catch (e) { ok = false; }
      }
      checks.push({ name: c.name, label: c.label, severity: c.severity, ok: ok });
      if (!ok) {
        if (c.severity === 'critical') criticalCount++;
        else warningCount++;
      }
    }
    var report = {
      ok: criticalCount === 0,
      criticalCount: criticalCount,
      warningCount: warningCount,
      checks: checks,
      at: nowIso()
    };
    lastReport = report;

    if (criticalCount > 0) {
      // Record to diagnostics WITHOUT triggering the issue-prompt "file an issue"
      // nudge (it skips entries carrying a userMessage). The recovery banner is
      // the single, data-safety-focused surface for a critical boot failure.
      try {
        if (typeof window.SutraReportError === 'function') {
          var failed = checks.filter(function (x) { return !x.ok && x.severity === 'critical'; })
            .map(function (x) { return x.label; }).join('; ');
          window.SutraReportError(
            new Error('Startup health: critical subsystem(s) unavailable: ' + failed),
            { where: 'startup-health', userMessage: 'Sutra could not finish starting up.' },
            'critical'
          );
        }
      } catch (e) { /* never throw from the health layer */ }
      if (!opts.silent) {
        try { renderRecovery(report); } catch (e) { /* never throw */ }
      }
    }
    return report;
  }

  // --- recovery banner --------------------------------------------------------

  function canEmergencyExport() {
    try {
      return (window.SutraPersistenceHealth && typeof window.SutraPersistenceHealth.exportEmergencyBackup === 'function')
        || typeof window.exportWorkspaceAsAtelier === 'function';
    } catch (e) { return false; }
  }

  function triggerEmergencyExport() {
    try {
      if (window.SutraPersistenceHealth && typeof window.SutraPersistenceHealth.exportEmergencyBackup === 'function') {
        window.SutraPersistenceHealth.exportEmergencyBackup();
        return;
      }
      if (typeof window.exportWorkspaceAsAtelier === 'function') window.exportWorkspaceAsAtelier();
    } catch (e) { /* surfaced elsewhere; never throw here */ }
  }

  function enterSafeMode() {
    try {
      if (window.SutraRecoveryMode && typeof window.SutraRecoveryMode.enter === 'function') {
        window.SutraRecoveryMode.enter('startup-health');
        return;
      }
      var url = new URL(window.location.href);
      url.searchParams.set('sutraRecoveryMode', '1');
      window.location.href = url.toString();
    } catch (e) {
      try {
        var sep = window.location.href.indexOf('?') === -1 ? '?' : '&';
        window.location.href = window.location.href + sep + 'sutraSafeMode=1';
      } catch (err) { /* give up quietly */ }
    }
  }

  function makeButton(label, className, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.style.cssText =
      'border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;min-height:36px;';
    try { b.addEventListener('click', onClick); } catch (e) { /* noop */ }
    return b;
  }

  function renderRecovery(report) {
    if (!document.body) return null;
    if (bannerEl && bannerEl.isConnected) return bannerEl;

    var el = document.createElement('div');
    el.id = 'sutraStartupHealthBanner';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-label', 'Sutra could not finish starting up');
    el.style.cssText =
      'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;'
      + 'max-width:min(620px,94vw);background:#5b1717;color:#fff;border:1px solid #c0504d;'
      + 'border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px rgba(0,0,0,.5);'
      + 'font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;';

    var title = document.createElement('div');
    title.textContent = 'Sutra didn’t finish starting up';
    title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px;';

    var msg = document.createElement('div');
    msg.id = 'sutraStartupHealthMessage';
    var failed = (report.checks || []).filter(function (x) { return !x.ok && x.severity === 'critical'; })
      .map(function (x) { return x.label; });
    msg.textContent = 'A core part of the workspace did not load ('
      + (failed.join(', ') || 'core runtime')
      + '). Your saved data is still on this device — don’t clear site data. Try the steps below.';
    msg.style.cssText = 'margin-bottom:12px;';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    actions.appendChild(makeButton('Reload', 'sutra-health-reload', function () {
      try { window.location.reload(); } catch (e) { /* noop */ }
    }));
    actions.appendChild(makeButton('Open Safe Mode', 'sutra-health-safemode', enterSafeMode));
    var reloadBtn = actions.firstChild;
    if (reloadBtn) reloadBtn.style.cssText += 'background:#fff;color:#5b1717;';
    var safeBtn = actions.childNodes[1];
    if (safeBtn) safeBtn.style.cssText += 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.55);';

    if (canEmergencyExport()) {
      var exp = makeButton('Export emergency backup', 'sutra-health-export', triggerEmergencyExport);
      exp.style.cssText += 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.55);';
      actions.appendChild(exp);
    }

    var dismiss = makeButton('Dismiss', 'sutra-health-dismiss', dismissRecovery);
    dismiss.setAttribute('aria-label', 'Dismiss startup warning');
    dismiss.style.cssText += 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35);';
    actions.appendChild(dismiss);

    el.appendChild(title);
    el.appendChild(msg);
    el.appendChild(actions);
    document.body.appendChild(el);
    bannerEl = el;

    // Gentle, non-trapping focus for keyboard users.
    try {
      if (reloadBtn && typeof reloadBtn.focus === 'function') reloadBtn.focus({ preventScroll: true });
    } catch (e) { /* noop */ }
    return el;
  }

  function dismissRecovery() {
    try {
      if (bannerEl) { bannerEl.remove(); bannerEl = null; }
    } catch (e) { /* noop */ }
  }

  function isRecoveryVisible() {
    return !!(bannerEl && bannerEl.isConnected);
  }

  // --- watchdog ---------------------------------------------------------------
  // Once boot has had a fair chance, verify the critical subsystems came up. A
  // healthy boot (globals present) records an ok report and renders nothing. A
  // failed boot is CONFIRMED with a couple of rechecks (so a merely-slow boot
  // that finishes late does not false-alarm) before the recovery banner shows.

  function watchdogTick(attempt) {
    if (watchdogDone) return;
    var report = run({ silent: true });
    if (report.ok) { watchdogDone = true; return; }
    if (attempt < MAX_RECHECKS) {
      try { window.setTimeout(function () { watchdogTick(attempt + 1); }, RECHECK_MS); } catch (e) { /* noop */ }
      return;
    }
    // Confirmed critical failure after boot + rechecks → offer recovery.
    watchdogDone = true;
    run({ silent: false });
  }

  function armWatchdog() {
    try { window.setTimeout(function () { watchdogTick(0); }, WATCHDOG_MS); } catch (e) { /* noop */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', armWatchdog);
  } else {
    armWatchdog();
  }

  // --- public surface (also the test hook) ------------------------------------
  window.SutraStartupHealth = {
    run: run,
    renderRecovery: renderRecovery,
    dismissRecovery: dismissRecovery,
    isRecoveryVisible: isRecoveryVisible,
    getReport: function () { return lastReport; },
    listChecks: function () {
      return CHECKS.map(function (c) { return { name: c.name, label: c.label, severity: c.severity }; });
    }
  };
})();
