/*
 * today-focus-timer.js — visible Today controls for the canonical focus timer.
 *
 * The Notes sidebar and full-screen Focus mode already use the timer bridge in
 * app.js. This controller only renders a Today entry point and sends the same
 * commands, so all three surfaces stay in lockstep and persistence remains
 * owned by the core timer.
 */
(function () {
    'use strict';

    var bound = false;
    var finishAtMs = null;
    var lastSnapshot = { durationSeconds: 25 * 60, remaining: 25 * 60, running: false };

    function formatTime(totalSeconds) {
        var seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var remainder = seconds % 60;
        var pad = function (value) { return String(value).padStart(2, '0'); };
        return hours > 0
            ? hours + ':' + pad(minutes) + ':' + pad(remainder)
            : pad(minutes) + ':' + pad(remainder);
    }

    function dispatchTimerCommand(action, seconds) {
        var detail = { action: action, seconds: seconds, result: null };
        try {
            document.dispatchEvent(new CustomEvent('sutra:focus-timer-command', { detail: detail }));
        } catch (error) {
            return null;
        }
        return detail.result;
    }

    function getElements() {
        return {
            card: document.getElementById('todayFocusTimerCard'),
            display: document.getElementById('todayFocusTimerDisplay'),
            status: document.getElementById('todayFocusTimerStatus'),
            finishAt: document.getElementById('todayFocusTimerFinishAt'),
            start: document.getElementById('todayFocusTimerStartBtn'),
            pause: document.getElementById('todayFocusTimerPauseBtn'),
            reset: document.getElementById('todayFocusTimerResetBtn'),
            edit: document.getElementById('todayFocusTimerEditBtn'),
            fullscreen: document.getElementById('todayFocusTimerFullscreenBtn'),
            settings: document.getElementById('todayFocusTimerSettings'),
            hours: document.getElementById('todayFocusTimerHours'),
            minutes: document.getElementById('todayFocusTimerMinutes'),
            seconds: document.getElementById('todayFocusTimerSeconds'),
            apply: document.getElementById('todayFocusTimerApplyBtn')
        };
    }

    function syncDurationInputs(snapshot) {
        var elements = getElements();
        var duration = Math.max(1, Math.floor(Number(snapshot && snapshot.durationSeconds) || 25 * 60));
        if (elements.hours) elements.hours.value = Math.floor(duration / 3600);
        if (elements.minutes) elements.minutes.value = Math.floor((duration % 3600) / 60);
        if (elements.seconds) elements.seconds.value = duration % 60;
    }

    function finishLabel() {
        if (!finishAtMs) return '';
        var date = new Date(finishAtMs);
        var hours = date.getHours();
        var minutes = date.getMinutes();
        return 'Finishes at ' + (hours % 12 || 12) + ':' + String(minutes).padStart(2, '0') + (hours >= 12 ? ' PM' : ' AM');
    }

    function render(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        var elements = getElements();
        if (!elements.card || !elements.display) return;

        var duration = Math.max(1, Math.floor(Number(snapshot.durationSeconds) || 25 * 60));
        var remaining = Math.max(0, Math.min(duration, Math.floor(Number(snapshot.remaining) || 0)));
        var running = !!snapshot.running;
        lastSnapshot = { durationSeconds: duration, remaining: remaining, running: running };

        if (running && !finishAtMs) finishAtMs = Date.now() + (remaining * 1000);
        if (!running) finishAtMs = null;

        elements.display.textContent = formatTime(remaining);
        elements.card.classList.toggle('is-running', running);
        if (elements.start) elements.start.hidden = running;
        if (elements.pause) elements.pause.hidden = !running;

        if (elements.status) {
            elements.status.textContent = running
                ? 'Stay with this block. You can pause any time.'
                : (remaining < duration ? 'Paused — resume when you are ready.' : 'Ready when you are.');
        }
        if (elements.finishAt) {
            var label = running ? finishLabel() : '';
            elements.finishAt.textContent = label;
            elements.finishAt.hidden = !label;
        }
    }

    function openSettings(open) {
        var elements = getElements();
        if (!elements.settings || !elements.edit) return;
        var next = typeof open === 'boolean' ? open : elements.settings.hidden;
        elements.settings.hidden = !next;
        elements.edit.setAttribute('aria-expanded', next ? 'true' : 'false');
        if (next) syncDurationInputs(lastSnapshot);
    }

    function setDurationFromInputs() {
        var elements = getElements();
        var hours = Math.max(0, Math.floor(Number(elements.hours && elements.hours.value) || 0));
        var minutes = Math.max(0, Math.min(59, Math.floor(Number(elements.minutes && elements.minutes.value) || 0)));
        var seconds = Math.max(0, Math.min(59, Math.floor(Number(elements.seconds && elements.seconds.value) || 0)));
        var total = (hours * 3600) + (minutes * 60) + seconds;
        if (total < 1) {
            if (elements.status) elements.status.textContent = 'Choose a duration of at least one second.';
            if (elements.minutes) elements.minutes.focus();
            return;
        }
        var snapshot = dispatchTimerCommand('set-duration', total);
        if (snapshot) render(snapshot);
        openSettings(true);
        try { if (typeof window.showToast === 'function') window.showToast('Timer updated'); } catch (error) { /* non-critical */ }
    }

    function bind() {
        if (bound) return;
        var elements = getElements();
        if (!elements.card) return;
        bound = true;

        if (elements.start) elements.start.addEventListener('click', function () {
            var snapshot = dispatchTimerCommand('start');
            if (snapshot) render(snapshot);
        });
        if (elements.pause) elements.pause.addEventListener('click', function () {
            var snapshot = dispatchTimerCommand('pause');
            if (snapshot) render(snapshot);
        });
        if (elements.reset) elements.reset.addEventListener('click', function () {
            var snapshot = dispatchTimerCommand('reset');
            if (snapshot) render(snapshot);
        });
        if (elements.edit) elements.edit.addEventListener('click', function () {
            openSettings();
        });
        if (elements.apply) elements.apply.addEventListener('click', setDurationFromInputs);
        if (elements.fullscreen) elements.fullscreen.addEventListener('click', function () {
            try {
                // Reuse a running timer as-is. When stopped, retain the normal
                // duration prompt for starting a fresh focus session.
                var options = lastSnapshot.running ? { skipPreflight: true } : { userInitiated: true };
                if (typeof window.startFocusSession === 'function') window.startFocusSession(null, options);
            } catch (error) { /* non-critical action */ }
        });

        elements.card.querySelectorAll('[data-today-timer-preset]').forEach(function (button) {
            button.addEventListener('click', function () {
                var minutes = Math.max(1, Math.floor(Number(button.getAttribute('data-today-timer-preset')) || 25));
                var snapshot = dispatchTimerCommand('set-duration', minutes * 60);
                if (snapshot) render(snapshot);
                openSettings(true);
            });
        });

        document.addEventListener('sutra:focus-timer-updated', function (event) {
            render(event && event.detail);
        });

        var initial = dispatchTimerCommand('snapshot');
        if (initial) {
            syncDurationInputs(initial);
            render(initial);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
}());
