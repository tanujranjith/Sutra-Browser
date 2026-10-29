// Sutra Activation Funnel — window.SutraActivation
//
// Local-only, privacy-first activation tracking. Records WHEN this device
// first hit the moments that predict whether Sutra sticks (first capture,
// onboarding finished a real plan, came back on day 2, …) plus light usage
// counts. Nothing ever leaves the device: no network, no IDs, no content —
// only timestamps and counters. The panel exists so the builder can ask a
// pilot user "screenshot your activation panel" instead of guessing, and so
// a student can see their own streak of active days.
//
// Storage: one SutraSafeStorage key (device-local, not part of the workspace
// export — a restored backup should not overwrite THIS device's history).
(function (global) {
    'use strict';
    if (!global || typeof global.document === 'undefined') return;

    var KEY = 'sutra:activation:v1';
    var MAX_ACTIVE_DAYS = 120;

    var MILESTONES = [
        { id: 'firstRun', label: 'Opened Sutra' },
        { id: 'onboardingCompleted', label: 'Finished onboarding' },
        { id: 'firstCapture', label: 'Captured first assignment' },
        { id: 'firstImport', label: 'Imported assignments (LMS / paste)' },
        { id: 'firstPlan', label: 'Put a plan block on the timeline' },
        { id: 'firstReviewSession', label: 'Ran a review session' },
        { id: 'firstFocusSession', label: 'Started a focus session' },
        { id: 'day2Return', label: 'Came back on another day' }
    ];

    var COUNT_LABELS = {
        captures: 'Assignments captured',
        imports: 'Import runs',
        plans: 'Plan blocks applied',
        reviewSessions: 'Review sessions',
        focusSessions: 'Focus sessions'
    };

    function storage() { return global.SutraSafeStorage || null; }

    function todayKey() {
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function load() {
        var s = storage();
        var raw = s ? s.get(KEY, { fallback: null }) : null;
        var state = raw && typeof raw === 'object' ? raw : {};
        if (!state.milestones || typeof state.milestones !== 'object') state.milestones = {};
        if (!state.counts || typeof state.counts !== 'object') state.counts = {};
        if (!Array.isArray(state.activeDays)) state.activeDays = [];
        return state;
    }

    function save(state) {
        var s = storage();
        if (s) s.set(KEY, state, { label: 'Activation funnel' });
    }

    // Record a milestone (first time only) and/or bump a usage counter.
    // record('capture') → milestone firstCapture + counts.captures.
    var EVENTS = {
        capture: { milestone: 'firstCapture', count: 'captures' },
        import: { milestone: 'firstImport', count: 'imports' },
        plan: { milestone: 'firstPlan', count: 'plans' },
        review: { milestone: 'firstReviewSession', count: 'reviewSessions' },
        focus: { milestone: 'firstFocusSession', count: 'focusSessions' },
        onboarding: { milestone: 'onboardingCompleted' }
    };

    function record(eventName) {
        var spec = EVENTS[String(eventName || '')];
        if (!spec) return false;
        var state = load();
        var changed = false;
        if (spec.milestone && !state.milestones[spec.milestone]) {
            state.milestones[spec.milestone] = new Date().toISOString();
            changed = true;
        }
        if (spec.count) {
            state.counts[spec.count] = (Number(state.counts[spec.count]) || 0) + 1;
            changed = true;
        }
        if (changed) save(state);
        return changed;
    }

    function touchToday() {
        var state = load();
        var changed = false;
        if (!state.firstRunAt) {
            state.firstRunAt = new Date().toISOString();
            state.milestones.firstRun = state.firstRunAt;
            changed = true;
        }
        var tk = todayKey();
        if (state.activeDays[state.activeDays.length - 1] !== tk) {
            state.activeDays.push(tk);
            if (state.activeDays.length > MAX_ACTIVE_DAYS) {
                state.activeDays = state.activeDays.slice(-MAX_ACTIVE_DAYS);
            }
            changed = true;
        }
        if (!state.milestones.day2Return && state.firstRunAt && state.firstRunAt.slice(0, 10) !== tk) {
            state.milestones.day2Return = new Date().toISOString();
            changed = true;
        }
        if (changed) save(state);
    }

    // Retroactive derivation so the funnel is honest on devices that used
    // Sutra before this module existed: earliest homework task counts as the
    // first capture; a completed onboarding flag counts as onboarding done.
    function deriveFromWorkspace() {
        var state = load();
        var changed = false;
        try {
            var hw = global.SutraHomework;
            if (!state.milestones.firstCapture && hw && typeof hw.getTasks === 'function') {
                var earliest = '';
                hw.getTasks().forEach(function (t) {
                    var c = t && t.createdAt ? String(t.createdAt) : '';
                    if (c && (!earliest || c < earliest)) earliest = c;
                });
                if (earliest) { state.milestones.firstCapture = earliest; changed = true; }
            }
        } catch (e) { /* best effort */ }
        try {
            var ob = global.appSettings && global.appSettings.onboarding;
            if (!state.milestones.onboardingCompleted && ob && (ob.completed === true || ob.tourCompleted === true)) {
                state.milestones.onboardingCompleted = new Date().toISOString();
                changed = true;
            }
        } catch (e) { /* best effort */ }
        if (changed) save(state);
    }

    function formatDay(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function summaryText() {
        var state = load();
        var lines = ['Sutra activation (this device, local-only)'];
        MILESTONES.forEach(function (m) {
            var at = state.milestones[m.id];
            lines.push((at ? '[x] ' : '[ ] ') + m.label + (at ? ' — ' + formatDay(at) : ''));
        });
        lines.push('Active days (last ' + MAX_ACTIVE_DAYS + '): ' + state.activeDays.length);
        Object.keys(COUNT_LABELS).forEach(function (k) {
            var n = Number(state.counts[k]) || 0;
            if (n > 0) lines.push(COUNT_LABELS[k] + ': ' + n);
        });
        return lines.join('\n');
    }

    function openPanel() {
        var existing = document.getElementById('sutraActivationModal');
        if (existing) existing.remove();
        var state = load();

        var modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'sutraActivationModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Activation funnel');

        var content = document.createElement('div');
        content.className = 'modal-content';
        content.style.maxWidth = '460px';

        var head = document.createElement('div');
        head.className = 'modal-header';
        var title = document.createElement('h3');
        title.textContent = 'Activation funnel (local-only)';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('data-modal-close', '');
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        head.appendChild(title);
        head.appendChild(closeBtn);
        content.appendChild(head);

        var body = document.createElement('div');
        body.className = 'modal-body';

        var help = document.createElement('p');
        help.style.opacity = '0.75';
        help.style.fontSize = '0.85rem';
        help.textContent = 'Stored only on this device. Nothing is sent anywhere — screenshot or copy it if you want to share it.';
        body.appendChild(help);

        var list = document.createElement('div');
        MILESTONES.forEach(function (m) {
            var at = state.milestones[m.id];
            var row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.gap = '12px';
            row.style.padding = '5px 0';
            row.style.borderBottom = '1px solid color-mix(in srgb, var(--surface-border, #8884) 50%, transparent)';
            var label = document.createElement('span');
            label.textContent = (at ? '✅ ' : '⬜ ') + m.label;
            var when = document.createElement('span');
            when.style.opacity = '0.7';
            when.textContent = at ? formatDay(at) : '—';
            row.appendChild(label);
            row.appendChild(when);
            list.appendChild(row);
        });
        body.appendChild(list);

        var stats = document.createElement('p');
        stats.style.marginTop = '10px';
        var statBits = ['Active days: ' + state.activeDays.length];
        Object.keys(COUNT_LABELS).forEach(function (k) {
            var n = Number(state.counts[k]) || 0;
            if (n > 0) statBits.push(COUNT_LABELS[k].toLowerCase() + ': ' + n);
        });
        stats.textContent = statBits.join(' · ');
        body.appendChild(stats);

        var copyBtn = document.createElement('button');
        copyBtn.className = 'cc-btn cc-btn-ghost';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy summary';
        copyBtn.addEventListener('click', function () {
            var text = summaryText();
            var done = function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy summary'; }, 1500); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { global.prompt('Copy this summary:', text); });
            } else {
                global.prompt('Copy this summary:', text);
            }
        });
        body.appendChild(copyBtn);

        content.appendChild(body);
        modal.appendChild(content);

        var close = function () {
            modal.remove();
            try { if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open'); } catch (e) { /* non-critical */ }
        };
        closeBtn.addEventListener('click', close);
        modal.addEventListener('click', function (event) { if (event.target === modal) close(); });

        document.body.appendChild(modal);
        try { document.body.classList.add('modal-open'); } catch (e) { /* non-critical */ }
        return true;
    }

    global.SutraActivation = {
        record: record,
        touchToday: touchToday,
        deriveFromWorkspace: deriveFromWorkspace,
        summaryText: summaryText,
        openPanel: openPanel,
        getState: load
    };

    // Boot: mark today active, then (after the app settles) backfill from the
    // workspace so pre-existing users don't show an empty funnel.
    function boot() {
        try { touchToday(); } catch (e) { /* non-critical */ }
        setTimeout(function () {
            try { deriveFromWorkspace(); } catch (e) { /* non-critical */ }
        }, 4000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(typeof window !== 'undefined' ? window : this);
