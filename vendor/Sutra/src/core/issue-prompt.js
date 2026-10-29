/*
 * issue-prompt.js — runtime self-checks + "file an issue" nudge.
 *
 * Loaded after app.js so the DOM, window.showToast and window.openGoogleFeedbackModal
 * exist. Its job is to make failures actionable for the user instead of silent:
 *
 *   1. SELF-CHECKS ("more tests") — a small battery of runtime health checks that
 *      run shortly after boot (and on demand). Each failed check is funnelled
 *      through window.SutraReportError so it lands in diagnostics like any other error.
 *   2. ERROR LISTENER — subscribes to the existing error funnel
 *      (`sutra:error-reported`, from error-reporter.js) and to feature
 *      degradation (`sutra:feature-degraded`, from feature-guard.js). When a real
 *      error/critical surfaces, it shows a non-blocking prompt asking the user to
 *      file an issue via the feedback ("issue") button, and HIGHLIGHTS that button.
 *
 * Design constraints (match the rest of the safety layer):
 *   - Zero dependencies. Classic script, IIFE, attaches one namespaced global.
 *   - Must never throw and must never block (no alert()).
 *   - DOM built with createElement/textContent only (no innerHTML sink).
 *   - In-memory state only (no storage writes).
 *   - Non-annoying: the banner is throttled; benign/handled errors are ignored.
 */
(function () {
  'use strict';

  // --- tuning -----------------------------------------------------------------
  var SELF_CHECK_DELAY_MS = 1200;   // let the app settle before probing
  var BANNER_COOLDOWN_MS = 30000;   // don't re-pop the banner more than this often
  var TRIGGER_SEVERITIES = { error: true, critical: true };

  // --- state ------------------------------------------------------------------
  var promptEl = null;
  var lastShownAt = 0;
  var lastError = null;            // last error detail that triggered a prompt
  var triggerCount = 0;           // how many eligible errors have fired this session

  function nowMs() { try { return Date.now(); } catch (e) { return 0; } }

  function getFeedbackFab() {
    try { return document.getElementById('feedbackFabBtn'); } catch (e) { return null; }
  }

  // --- issue button highlight -------------------------------------------------

  function highlightIssueButton() {
    var fab = getFeedbackFab();
    if (!fab) return;
    fab.classList.add('issue-attention');
    fab.setAttribute('data-issue-attention', 'true');
  }

  function clearIssueButtonHighlight() {
    var fab = getFeedbackFab();
    if (!fab) return;
    fab.classList.remove('issue-attention');
    fab.removeAttribute('data-issue-attention');
  }

  // --- opening the issue/feedback form ---------------------------------------

  function openIssueForm() {
    // The "issue button" opens the Google feedback form. Prefer the exposed
    // global; fall back to clicking the FAB so this keeps working if the global
    // name ever changes.
    try {
      if (typeof window.openGoogleFeedbackModal === 'function') {
        window.openGoogleFeedbackModal();
        return true;
      }
    } catch (e) { /* fall through */ }
    var fab = getFeedbackFab();
    if (fab) { try { fab.click(); return true; } catch (e) {} }
    return false;
  }

  // --- the prompt element -----------------------------------------------------

  function buildPrompt() {
    if (promptEl && promptEl.isConnected) return promptEl;

    var el = document.createElement('div');
    el.className = 'issue-prompt';
    el.id = 'sutraIssuePrompt';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', 'Something went wrong in Sutra');
    el.hidden = true;

    var icon = document.createElement('div');
    icon.className = 'issue-prompt-icon';
    icon.setAttribute('aria-hidden', 'true');
    var iconGlyph = document.createElement('i');
    iconGlyph.className = 'fas fa-triangle-exclamation';
    icon.appendChild(iconGlyph);

    var body = document.createElement('div');
    body.className = 'issue-prompt-body';

    var title = document.createElement('div');
    title.className = 'issue-prompt-title';
    title.textContent = 'Something went wrong';

    var message = document.createElement('div');
    message.className = 'issue-prompt-message';
    message.id = 'sutraIssuePromptMessage';
    message.textContent = 'Sutra hit an unexpected error. Help us fix it by filing a quick issue — it only takes a moment.';

    var actions = document.createElement('div');
    actions.className = 'issue-prompt-actions';

    var reportBtn = document.createElement('button');
    reportBtn.type = 'button';
    reportBtn.className = 'issue-prompt-report neumo-btn btn-primary';
    reportBtn.textContent = 'Report issue';
    reportBtn.addEventListener('click', function () {
      openIssueForm();
      // The user is acting on it — the highlight has done its job.
      clearIssueButtonHighlight();
      dismiss();
    });

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'issue-prompt-dismiss neumo-btn';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss error notification');
    dismissBtn.addEventListener('click', function () { dismiss(); });

    actions.appendChild(reportBtn);
    actions.appendChild(dismissBtn);

    body.appendChild(title);
    body.appendChild(message);
    body.appendChild(actions);

    el.appendChild(icon);
    el.appendChild(body);

    (document.body || document.documentElement).appendChild(el);
    promptEl = el;
    return el;
  }

  function isVisible() {
    return !!(promptEl && !promptEl.hidden && promptEl.classList.contains('is-visible'));
  }

  /**
   * show(detail) — surface the nudge + highlight the issue button.
   *   detail: { message?, severity?, where? } (optional, for the announced text)
   * Always highlights the issue button; the banner itself is throttled.
   */
  function show(detail) {
    try {
      lastError = detail || lastError;

      // The issue button is always (re)highlighted on a fresh error, even when
      // the banner is throttled — so attention is drawn to where to report.
      highlightIssueButton();

      var t = nowMs();
      if (isVisible()) return false;
      if (t - lastShownAt < BANNER_COOLDOWN_MS && lastShownAt !== 0) return false;
      lastShownAt = t;

      var el = buildPrompt();
      var msg = document.getElementById('sutraIssuePromptMessage');
      if (msg) {
        var extra = detail && detail.where ? ' (' + String(detail.where) + ')' : '';
        msg.textContent = 'Sutra hit an unexpected error' + extra
          + '. Help us fix it by filing a quick issue — it only takes a moment.';
      }
      el.hidden = false;
      // Force reflow so the entrance transition runs.
      void el.offsetWidth;
      el.classList.add('is-visible');

      // Gentle, non-trapping focus to the primary action for keyboard users.
      try {
        var btn = el.querySelector('.issue-prompt-report');
        if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
      } catch (e) {}

      return true;
    } catch (e) {
      return false;
    }
  }

  function dismiss() {
    try {
      if (promptEl) {
        promptEl.classList.remove('is-visible');
        // Hide after the exit transition; keep it cheap and safe.
        setTimeout(function () { try { if (promptEl && !promptEl.classList.contains('is-visible')) promptEl.hidden = true; } catch (e) {} }, 220);
      }
    } catch (e) {}
    // NOTE: the issue-button highlight intentionally PERSISTS after dismiss so the
    // user can still find where to report. It clears once they open the form.
  }

  // --- deciding whether an error should nudge ---------------------------------

  function shouldTrigger(entry) {
    if (!entry) return false;
    if (!TRIGGER_SEVERITIES[entry.severity]) return false;
    // If the app already showed the user a message for this error (graceful,
    // recoverable path), don't pile a second nudge on top of it.
    if (entry.context && entry.context.userMessage) return false;
    return true;
  }

  function handleReportedError(entry) {
    if (!shouldTrigger(entry)) return;
    triggerCount += 1;
    show({
      message: entry.message,
      severity: entry.severity,
      where: (entry.context && (entry.context.where || entry.context.feature)) || ''
    });
  }

  // --- self-checks ("more tests") ---------------------------------------------
  // Each returns true when healthy. A failure is funnelled through reportError so
  // it both lands in diagnostics and (via the listener below) drives the prompt.

  var CHECKS = [
    { name: 'core-layout', label: 'Core layout', fn: function () {
        return !!(document.querySelector('.main-content') && document.querySelector('.top-nav'));
      } },
    { name: 'issue-button', label: 'Feedback (issue) button', fn: function () {
        return !!getFeedbackFab();
      } },
    { name: 'feedback-form', label: 'Feedback form hook', fn: function () {
        return typeof window.openGoogleFeedbackModal === 'function';
      } },
    { name: 'safe-storage', label: 'Safe storage', fn: function () {
        return !!(window.SutraSafeStorage && typeof window.SutraSafeStorage.set === 'function');
      } },
    { name: 'toast', label: 'Toast subsystem', fn: function () {
        return typeof window.showToast === 'function';
      } },
    { name: 'feature-health', label: 'Feature health', fn: function () {
        try {
          if (window.SutraFeatureGuard && typeof window.SutraFeatureGuard.isDegraded === 'function') {
            return !window.SutraFeatureGuard.isDegraded();
          }
        } catch (e) {}
        return true; // unknown == don't false-alarm
      } }
  ];

  /**
   * runSelfChecks(opts) — run the health battery. opts.only = [names] to subset.
   * Returns [{ name, label, ok }]. Failures are reported (severity 'error') unless
   * opts.silent is true (used by tests to inspect without nudging).
   */
  function runSelfChecks(opts) {
    opts = opts || {};
    var results = [];
    var only = opts.only && opts.only.length ? opts.only : null;
    for (var i = 0; i < CHECKS.length; i++) {
      var check = CHECKS[i];
      if (only && only.indexOf(check.name) === -1) continue;
      var ok = false;
      try { ok = !!check.fn(); } catch (e) { ok = false; }
      results.push({ name: check.name, label: check.label, ok: ok });
      if (!ok && !opts.silent) {
        try {
          if (typeof window.SutraReportError === 'function') {
            window.SutraReportError(
              new Error('Self-check failed: ' + check.label),
              { where: 'self-check', feature: check.name },
              'error'
            );
          } else {
            // No funnel available — still nudge directly.
            show({ message: 'Self-check failed: ' + check.label, severity: 'error', where: check.name });
          }
        } catch (e) {}
      }
    }
    return results;
  }

  // --- wiring -----------------------------------------------------------------

  function init() {
    // 1) Catch boot-time errors that were buffered before this module loaded.
    try {
      if (window.SutraDiagnostics && typeof window.SutraDiagnostics.getEntries === 'function') {
        var buffered = window.SutraDiagnostics.getEntries();
        for (var i = 0; i < buffered.length; i++) {
          if (shouldTrigger(buffered[i])) { handleReportedError(buffered[i]); break; }
        }
      }
    } catch (e) {}

    // 2) Subscribe to the live error funnel.
    try {
      window.addEventListener('sutra:error-reported', function (ev) {
        handleReportedError(ev && ev.detail);
      });
    } catch (e) {}

    // 3) A feature failing to initialize is an "error found" too.
    try {
      window.addEventListener('sutra:feature-degraded', function (ev) {
        var label = (ev && ev.detail && (ev.detail.label || ev.detail.feature)) || '';
        triggerCount += 1;
        show({ message: 'Feature unavailable: ' + label, severity: 'error', where: label });
      });
    } catch (e) {}

    // 4) Run the self-check battery once the app has settled.
    try {
      setTimeout(function () { runSelfChecks(); }, SELF_CHECK_DELAY_MS);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // --- public surface (also the test hook) -----------------------------------
  window.SutraIssuePrompt = {
    show: show,
    dismiss: dismiss,
    isVisible: isVisible,
    runSelfChecks: runSelfChecks,
    highlightIssueButton: highlightIssueButton,
    clearIssueButtonHighlight: clearIssueButtonHighlight,
    openIssueForm: openIssueForm,
    getState: function () {
      return { lastShownAt: lastShownAt, triggerCount: triggerCount, lastError: lastError, visible: isVisible() };
    }
  };
})();
