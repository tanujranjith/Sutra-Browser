/*
 * student-loop-actions.js — small DOM-only bindings for the student daily loop.
 *
 * Kept outside core/app.js so safe HTML event-handler cleanup does not make the
 * global runtime even larger. These actions call existing public APIs only and
 * therefore preserve file:// operation and local-first behavior.
 */
(function () {
    'use strict';

    function startFocus() {
        try {
            if (window.flowAtelier && typeof window.flowAtelier.startFocusSession === 'function') {
                window.flowAtelier.startFocusSession(null, {
                    plannedDurationSeconds: 50 * 60,
                    autostart: true,
                    userInitiated: true
                });
                return;
            }
            if (typeof window.startFocusSession === 'function') {
                window.startFocusSession(null, {
                    plannedDurationSeconds: 50 * 60,
                    autostart: true,
                    userInitiated: true
                });
            }
        } catch (err) { /* non-critical action */ }
    }

    function openCapture() {
        try {
            if (typeof window.openQuickCaptureModal === 'function') window.openQuickCaptureModal('');
        } catch (err) { /* non-critical action */ }
    }

    function bind() {
        var capture = document.getElementById('todayQuickCaptureBtn');
        if (capture && capture.dataset.bound !== 'true') {
            capture.dataset.bound = 'true';
            capture.addEventListener('click', openCapture);
        }
        var focus = document.getElementById('todayFocusBtn');
        if (focus && focus.dataset.bound !== 'true') {
            focus.dataset.bound = 'true';
            focus.addEventListener('click', startFocus);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();

    window.SutraStudentLoopActions = { openCapture: openCapture, startFocus: startFocus, bind: bind };
}());
