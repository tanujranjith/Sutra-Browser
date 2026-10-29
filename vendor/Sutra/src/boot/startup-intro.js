/* ================================================================
   Sutra — Startup Intro  (src/boot/startup-intro.js)

   Shows a brief branded overlay once per browser session.
   Dismissed by: clicking, tapping, Escape, Enter, or the visible skip button.
   Auto-dismisses after TOTAL_MS milliseconds.

   Audio: synthesized via Web Audio API (no file required).
   ────────────────────────────────────────────────────────
   To swap in a custom audio file instead:
     1. Place a compressed MP3 at  assets/startup-sound.mp3
        (target ≤ 80 KB — approximately 1.5 s at 48 kbps).
     2. Replace the synthesizeStartupChime() call below with:
          var snd = new Audio('assets/startup-sound.mp3');
          snd.volume = 0.35;
          snd.play().catch(function() {}); // ignore autoplay block
   ────────────────────────────────────────────────────────
   Session key : 'sutra_intro_played'  in sessionStorage
   Sound flag  : 'sutra_startup_sound' in localStorage
                 absent / '0' = off   '1' = on
   ================================================================ */

(function () {
  'use strict';

  /* ── constants ──────────────────────────────────────────────── */

  var SESSION_KEY     = 'sutra_intro_played';
  var TOTAL_MS        = 2000;   // full sequence: animations + hold
  var REDUCED_MS      = 600;    // under prefers-reduced-motion
  var EXIT_MS         = 520;    // overlay fade-out (ms)
  var AUDIO_DELAY     = 280;    // ms after init before chime starts
  var RESUME_TIMEOUT  = 600;    // ms to wait for a suspended AudioContext
                                // before giving up (avoids post-dismiss sound)

  /* ── motion helpers ─────────────────────────────────────────── */

  function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  }

  function isMotionReduced() {
    var mi = (document.documentElement.dataset.motionintensity || '').toLowerCase();
    return prefersReducedMotion() || mi === 'off' || mi === 'reduced';
  }

  /* ── settings ───────────────────────────────────────────────── */

  /**
   * Read startup.playSound from localStorage.
   *
   * app.js writes 'sutra_startup_sound' = '1'|'0' whenever preferences are
   * applied (applyWorkspacePreferences), so the flag is available immediately
   * on the next page load — before app.js finishes async initialization.
   *
   *   Key absent  →  brand-new workspace  →  default OFF
   *   Key = '1'   →  explicitly enabled
   *   Key = '0'   →  explicitly disabled (returning user opted out)
   *
   * The startup chime is ON by default for new users. Returning users always
   * carry an explicit '0'/'1' (the app.js bridge writes it on every load), so a
   * user who turned it off stays silent. Playback still respects reduced-motion
   * and browser autoplay policy, so a blocked first-load play simply no-ops.
   */
  function isSoundEnabled() {
    try {
      // Never auto-play during automated runs (Playwright/WebDriver) — keeps the
      // e2e suite silent while the preference itself stays testable.
      if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
      return localStorage.getItem('sutra_startup_sound') === '1';
    } catch (_) {}
    return false;
  }

  /* ── audio synthesis ────────────────────────────────────────── */

  /**
   * Synthesize a soft two-note rising chime (E5 → B5, a perfect fifth).
   * Bell-like fast attack + natural exponential decay, master gain 0.22.
   * Total audible duration ≈ 0.75 s. To retune, edit the note table in
   * scheduleNotes() below (or swap in an audio file per the header notes).
   *
   * isDismissed — a function returning true once the intro has been
   *   dismissed; if it returns true by the time notes would schedule
   *   (after a suspended-context resume) we silently abandon playback
   *   so the chime never fires after the overlay is gone.
   *
   * Browser autoplay notes:
   *   • Chrome creates AudioContext in "suspended" state on page load
   *     unless the user has previously interacted with the site or the
   *     browser's Media Engagement Index is high enough.
   *   • ctx.resume() is attempted; if it resolves within RESUME_TIMEOUT
   *     AND the intro is still showing, the chime plays.
   *   • If blocked (first-ever Chrome visit with no prior interaction)
   *     the visual intro continues silently — no error thrown.
   *   • Firefox / Safari and localhost / repeat-visitor Chrome all work
   *     without restriction.
   */
  function synthesizeStartupChime(isDismissed) {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();

      function scheduleNotes() {
        /* Bail if the intro was dismissed while we waited for resume() */
        if (isDismissed && isDismissed()) {
          try { ctx.close(); } catch (_) {}
          return;
        }

        /* Soft master gain */
        var master = ctx.createGain();
        master.gain.setValueAtTime(0.22, ctx.currentTime);
        master.connect(ctx.destination);

        /* Two-note ascending chime: E5 then B5 (a perfect fifth apart).
           Bell-like fast attack → natural exponential decay. Total ≈ 0.75 s. */
        [[659.25, 0, 0.13], [987.77, 0.16, 0.10]].forEach(function (spec) {
          var freq = spec[0], delay = spec[1], peak = spec[2];
          var osc  = ctx.createOscillator();
          var env  = ctx.createGain();
          var t0   = ctx.currentTime + delay;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(peak, t0 + 0.012); /* fast bell attack */
          env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.72); /* smooth decay */
          osc.connect(env);
          env.connect(master);
          osc.start(t0);
          osc.stop(t0 + 0.75);
        });
      }

      if (ctx.state === 'suspended') {
        /* Hard timeout — if the browser hasn't resumed by RESUME_TIMEOUT,
           close the context and play nothing rather than risk the chime
           firing unexpectedly after the overlay is gone. */
        var resolved  = false;
        var giveUpTimer = setTimeout(function () {
          if (!resolved) {
            resolved = true;
            try { ctx.close(); } catch (_) {}
          }
        }, RESUME_TIMEOUT);

        ctx.resume().then(function () {
          if (resolved) return; // timed out already
          resolved = true;
          clearTimeout(giveUpTimer);
          scheduleNotes();
        }).catch(function () {
          resolved = true;
          clearTimeout(giveUpTimer);
        });
      } else {
        scheduleNotes();
      }
    } catch (_) {
      /* No Web Audio support — visual intro continues silently. */
    }
  }

  /* ── core ───────────────────────────────────────────────────── */

  function initStartupIntro() {
    /* Skip if already played during this browser session */
    if (window.SutraSafeStorage && window.SutraSafeStorage.sessionGet(SESSION_KEY)) return;

    var overlay = document.getElementById('sutraStartupIntro');
    if (!overlay) return;

    /* Mark immediately — prevents race-condition double-play on rapid reload */
    if (window.SutraSafeStorage) window.SutraSafeStorage.session(SESSION_KEY, '1');

    var reduced    = isMotionReduced();
    var totalMs    = reduced ? REDUCED_MS : TOTAL_MS;
    var dismissed  = false;
    var exitTimer  = null;
    var audioTimer = null;

    /* ── audio ── */
    if (!reduced && isSoundEnabled()) {
      audioTimer = setTimeout(function () {
        audioTimer = null;
        if (!dismissed) {
          synthesizeStartupChime(function () { return dismissed; });
        }
      }, AUDIO_DELAY);
    }

    /* ── dismiss logic ── */
    function dismiss(fast) {
      if (dismissed) return;
      dismissed = true;

      if (exitTimer  !== null) { clearTimeout(exitTimer);  exitTimer  = null; }
      if (audioTimer !== null) { clearTimeout(audioTimer); audioTimer = null; }

      overlay.removeEventListener('click',      onSkipClick);
      overlay.removeEventListener('touchstart', onSkipTouch);
      window.removeEventListener('keydown',     onKeySkip, true);

      var dur = fast ? 100 : EXIT_MS;
      overlay.style.transition = 'opacity ' + (dur / 1000).toFixed(2) +
                                 's cubic-bezier(0.22, 1, 0.36, 1)';
      overlay.classList.add('intro-exiting');

      setTimeout(function () {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        // Move focus into the app once the intro clears — but ONLY if focus is
        // currently lost (on body / the hidden overlay) and no modal is open.
        // The intro auto-dismisses on a timer, so by the time this fires the user
        // may already have opened the command palette, quick capture, or focused
        // something; stealing focus to the sidebar toggle there is a real bug.
        var active = document.activeElement;
        var focusLost = !active || active === document.body ||
                        active === document.documentElement || overlay.contains(active);
        var modalOpen = false;
        try {
          modalOpen = !!(window.SutraModalManager &&
                         typeof window.SutraModalManager.getActiveCount === 'function' &&
                         window.SutraModalManager.getActiveCount() > 0);
        } catch (_) { modalOpen = false; }
        if (focusLost && !modalOpen) {
          var target = document.querySelector(
            '#sidebarToggle, ' +
            '.app-container [tabindex="0"], ' +
            '.app-container button:not([disabled]):not([aria-hidden="true"])'
          );
          if (target) {
            try { target.focus({ preventScroll: true }); } catch (_) {}
          }
        }
      }, dur + 30);
    }

    /* ── skip handlers ── */
    function onSkipClick(e) {
      if (e && typeof e.button === 'number' && e.button !== 0) return;
      dismiss(false);
    }
    function onSkipTouch() { dismiss(false); }
    function onKeySkip(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation();
        dismiss(false);
      }
    }

    overlay.addEventListener('click',      onSkipClick);
    overlay.addEventListener('touchstart', onSkipTouch, { passive: true });
    window.addEventListener('keydown',     onKeySkip, true);

    exitTimer = setTimeout(function () { dismiss(false); }, totalMs);
  }

  /* ── boot ───────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStartupIntro);
  } else {
    initStartupIntro();
  }

  /* ── dev / test helper ──────────────────────────────────────── */

  /**
   * window.SutraStartupIntro.replay()
   * Run from the browser console to re-show the intro without reloading.
   * Also plays the chime (respects the startup-sound setting).
   */
  window.SutraStartupIntro = {
    replay: function () {
      if (window.SutraSafeStorage) window.SutraSafeStorage.sessionRemove(SESSION_KEY);
      var overlay = document.getElementById('sutraStartupIntro');
      if (!overlay) { console.warn('[SutraStartupIntro] overlay element not found'); return; }
      overlay.style.cssText = '';
      overlay.classList.remove('intro-exiting');
      overlay.setAttribute('aria-hidden', 'false');
      setTimeout(initStartupIntro, 0);
    },
    /** Quick sound-only test: plays the chime immediately regardless of settings. */
    testSound: function () {
      synthesizeStartupChime(function () { return false; });
    }
  };
})();
