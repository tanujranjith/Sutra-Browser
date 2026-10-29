/*
 * feature-guard.js — feature-level runtime isolation for Sutra.
 *
 * Loaded after error-reporter.js (depends on window.SutraReportError) and before
 * app.js / feature modules. Wraps feature initialization and rendering so that
 * one broken feature cannot white-screen the whole app: the failure is
 * reported, the rest of boot continues, and a small, dismissible degraded-state
 * badge is shown for the affected feature.
 *
 * Usage:
 *   SutraFeatureGuard.run('timeline', initTimeline);          // sync
 *   SutraFeatureGuard.run('review', () => initReview(), { label: 'Review' });
 *   const safeInit = SutraFeatureGuard.wrap('focus', initFocusTimer);
 *
 * Returns fn()'s value on success (so wrapping is behavior-preserving), or
 * opts.fallback (undefined by default) on failure. For an async fn the returned
 * promise is DERIVED, not the original: a rejection is reported and degraded,
 * then the returned promise settles with opts.fallback instead of rejecting.
 * A caller that ignores the promise therefore cannot cause an unhandled
 * rejection, and a caller that awaits it observes the fallback contract the
 * header promises. With opts.rethrow the reported error is rethrown through
 * that same returned promise (an awaiting caller catches it there; ignoring a
 * rethrow-enabled rejection remains the caller's explicit choice).
 *
 * Zero hard dependencies (degrades gracefully if SutraReportError is missing).
 * Classic script, IIFE, attaches to window. Must never throw.
 */
(function () {
  'use strict';

  var degraded = Object.create(null); // name -> { label, at, count }
  var badgeWrap = null;

  function report(error, context, severity) {
    try {
      if (typeof window.SutraReportError === 'function') {
        window.SutraReportError(error, context, severity);
        return;
      }
    } catch (e) { /* fall through to console */ }
    try { (console.error || console.log).call(console, '[Sutra:feature-guard]', context, error); } catch (e) {}
  }

  function humanLabel(name, opts) {
    if (opts && opts.label) return opts.label;
    // "initGradePlanner" / "grade-planner" -> "Grade Planner"
    var s = String(name || 'feature')
      .replace(/^init/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
    if (!s) return 'Feature';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function markDegraded(name, opts) {
    var label = humanLabel(name, opts);
    var existing = degraded[name];
    degraded[name] = { label: label, at: nowSafe(), count: (existing ? existing.count : 0) + 1 };
    if (!opts || opts.badge !== false) renderBadges();
    try {
      if (document.body) document.body.setAttribute('data-sutra-feature-degraded', '1');
    } catch (e) { /* noop */ }
    try {
      window.dispatchEvent(new CustomEvent('sutra:feature-degraded', { detail: { feature: name, label: label } }));
    } catch (e) { /* noop */ }
    try {
      if (window.SutraRecoveryMode && typeof window.SutraRecoveryMode.noteOptionalFailure === 'function') window.SutraRecoveryMode.noteOptionalFailure(name, label + ' failed');
    } catch (e) { /* recovery remains optional */ }
  }

  function nowSafe() {
    try { return Date.now(); } catch (e) { return 0; }
  }

  function ensureBadgeWrap() {
    if (badgeWrap && badgeWrap.isConnected) return badgeWrap;
    if (!document.body) return null;
    badgeWrap = document.createElement('div');
    badgeWrap.id = 'sutraFeatureDegradedBadges';
    badgeWrap.setAttribute('role', 'status');
    badgeWrap.setAttribute('aria-live', 'polite');
    badgeWrap.style.cssText =
      'position:fixed;right:14px;bottom:14px;z-index:2147483645;display:flex;flex-direction:column;' +
      'gap:6px;max-width:min(320px,86vw);pointer-events:none;';
    document.body.appendChild(badgeWrap);
    return badgeWrap;
  }

  function renderBadges() {
    var wrap = ensureBadgeWrap();
    if (!wrap) return;
    // Rebuild from state (small N).
    wrap.textContent = '';
    Object.keys(degraded).forEach(function (name) {
      var info = degraded[name];
      var chip = document.createElement('div');
      chip.setAttribute('data-feature', name);
      chip.style.cssText =
        'pointer-events:auto;display:flex;align-items:center;gap:8px;background:#3a2a12;color:#ffe9c7;' +
        'border:1px solid #7a5a2a;border-radius:10px;padding:7px 10px;box-shadow:0 8px 24px rgba(0,0,0,.4);' +
        'font:12px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;';

      var text = document.createElement('span');
      text.style.flex = '1';
      // textContent only — never interpolate names into innerHTML.
      text.textContent = '⚠ ' + info.label + ' is unavailable this session.';
      chip.appendChild(text);

      if (window.SutraRecoveryMode && typeof window.SutraRecoveryMode.enter === 'function') {
        var recover = document.createElement('button');
        recover.type = 'button';
        recover.textContent = 'Recovery mode';
        recover.style.cssText = 'background:transparent;border:1px solid #b78a4a;border-radius:6px;color:#ffe9c7;cursor:pointer;padding:3px 6px;font-size:11px;';
        recover.addEventListener('click', function () { window.SutraRecoveryMode.enter('feature:' + name); });
        chip.appendChild(recover);
      }

      var close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss ' + info.label + ' notice');
      close.textContent = '×';
      close.style.cssText =
        'background:transparent;border:0;color:#ffe9c7;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;';
      close.addEventListener('click', function () { clear(name); });
      chip.appendChild(close);

      wrap.appendChild(chip);
    });
    if (!Object.keys(degraded).length && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap);
      badgeWrap = null;
    }
  }

  function clear(name) {
    if (degraded[name]) delete degraded[name];
    renderBadges();
    if (!Object.keys(degraded).length) {
      try { if (document.body) document.body.removeAttribute('data-sutra-feature-degraded'); } catch (e) {}
    }
  }

  /**
   * run(name, fn, opts) — execute fn with isolation.
   *   opts.label    — human label for the badge (default derived from name)
   *   opts.phase    — 'init' | 'render' | ... (context only)
   *   opts.severity — reportError severity (default 'error')
   *   opts.badge    — false to suppress the visible badge (still reported)
   *   opts.fallback — value returned on failure (default undefined)
   *   opts.rethrow  — true to propagate the reported error to the caller:
   *                    thrown synchronously for sync fns, rejected through
   *                    the returned promise for async fns
   */
  function run(name, fn, opts) {
    opts = opts || {};
    if (typeof fn !== 'function') return opts.fallback;
    var result;
    try {
      result = fn();
    } catch (e) {
      handleFailure(name, e, opts);
      if (opts.rethrow) throw e;
      return opts.fallback;
    }
    // Async isolation: derive (do not return) the promise so a rejection is
    // reported + degraded and then settles with opts.fallback. Attaching the
    // handler here keeps both branches on one chain: no detached rejection,
    // and an ignoring caller cannot produce an unhandled rejection.
    var then;
    try {
      then = result && result.then;
    } catch (e) {
      handleFailure(name, e, opts);
      if (opts.rethrow) throw e;
      return opts.fallback;
    }
    if (typeof then === 'function') {
      // Assimilate arbitrary thenables ourselves. Accessing `then` or invoking
      // a malformed implementation can throw synchronously; both are still
      // feature failures and must follow the same fallback/rethrow contract.
      return new Promise(function (resolve, reject) {
        try { then.call(result, resolve, reject); }
        catch (e) { reject(e); }
      }).then(undefined, function (e) {
        handleFailure(name, e, opts);
        if (opts.rethrow) throw e;
        return opts.fallback;
      });
    }
    return result;
  }

  function handleFailure(name, error, opts) {
    report(error, {
      feature: name,
      where: 'feature:' + name,
      phase: opts.phase || 'init'
    }, opts.severity || 'error');
    markDegraded(name, opts);
  }

  function wrap(name, fn, opts) {
    return function () {
      var self = this;
      var args = arguments;
      return run(name, function () { return fn.apply(self, args); }, opts);
    };
  }

  window.SutraFeatureGuard = {
    run: run,
    wrap: wrap,
    markDegraded: markDegraded,
    clear: clear,
    isDegraded: function (name) { return name ? !!degraded[name] : Object.keys(degraded).length > 0; },
    getDegraded: function () {
      try { return JSON.parse(JSON.stringify(degraded)); } catch (e) { return {}; }
    }
  };
})();
