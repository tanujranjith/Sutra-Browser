/*
 * Audit follow-ups that intentionally live at the shell boundary.
 *
 * The main runtime is a large classic script with closure-owned state. Keep
 * these small UX repairs in a post-load bridge so they can be removed cleanly
 * when the corresponding core seams are extracted.
 */
(function () {
    'use strict';

    var originalSetActiveView = null;
    var originalStartFocusSession = null;
    var originalShowToast = null;
    var historyReady = false;
    var historyBound = false;
    var focusPreflightPending = false;
    var cueUpdating = false;
    var cueTaskId = '';

    function getTasks() {
        try {
            return window.flowAtelier && Array.isArray(window.flowAtelier.tasks)
                ? window.flowAtelier.tasks
                : [];
        } catch (_) { return []; }
    }

    function openTask(id) {
        try {
            if (typeof window.openTaskModal === 'function') window.openTaskModal(id);
            else if (window.flowAtelier && typeof window.flowAtelier.openTaskModal === 'function') window.flowAtelier.openTaskModal(id);
        } catch (_) { /* best effort */ }
    }

    function refreshUndatedTaskCue() {
        var host = document.getElementById('todayDailyBrief');
        if (!host || cueUpdating) return;
        var task = getTasks().find(function (item) {
            return item && !item.completed && item.isActive !== false && !item.dueDate;
        });
        var old = host.querySelector('.audit-undated-task-cue');
        if (!task) {
            if (old) old.remove();
            cueTaskId = '';
            return;
        }
        if (old && cueTaskId === String(task.id)) return;
        if (old) old.remove();
        cueUpdating = true;
        cueTaskId = String(task.id);
        var cue = document.createElement('div');
        cue.className = 'today-brief-nba audit-undated-task-cue tnu-body';
        cue.dataset.taskId = cueTaskId;
        var label = document.createElement('div');
        label.className = 'today-brief-nba-label tnu-eyebrow';
        label.textContent = 'Captured task';
        var title = document.createElement('div');
        title.className = 'today-brief-nba-title tnu-title';
        title.textContent = task.title || 'Untitled';
        var meta = document.createElement('p');
        meta.className = 'tnu-context';
        meta.textContent = 'Saved to Tasks. Add a due date when it matters, or open it to start.';
        var actions = document.createElement('div');
        actions.className = 'today-brief-actions tnu-actions';
        var open = document.createElement('button');
        open.type = 'button';
        open.className = 'neumo-btn tnu-primary';
        open.textContent = 'Open / edit';
        open.addEventListener('click', function () { openTask(task.id); });
        actions.appendChild(open);
        cue.append(label, title, meta, actions);
        host.appendChild(cue);
        cueUpdating = false;
    }

    function installOnboardingExit() {
        var panel = document.getElementById('onboardingMainPanel');
        if (!panel || panel.querySelector('.audit-explore-today')) return;
        var heading = panel.querySelector('#onboardingTitle');
        if (!heading || String(heading.textContent || '').indexOf('Welcome to Sutra') === -1) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'atelier-onboarding-btn ghost audit-explore-today';
        var icon = document.createElement('i');
        icon.className = 'fas fa-sun';
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, document.createTextNode(' Explore Home first'));
        button.addEventListener('click', function () {
            try {
                if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true);
                if (typeof window.setActiveView === 'function') window.setActiveView('today');
            } catch (_) { /* best effort */ }
        });
        var note = document.createElement('p');
        note.className = 'atelier-onboarding-explore-first-note';
        note.textContent = 'Skip setup for now. You can finish it later from Settings.';
        var wrap = document.createElement('div');
        wrap.className = 'atelier-onboarding-explore-first';
        wrap.append(button, note);
        panel.appendChild(wrap);
    }

    function installHistory() {
        if (historyBound || !window.history || typeof originalSetActiveView !== 'function') return;
        historyBound = true;
        function readView() {
            try {
                var match = String(window.location.hash || '').match(/(?:^#|&)view=([^&]+)/);
                return match ? decodeURIComponent(match[1]) : '';
            } catch (_) { return ''; }
        }
        window.setActiveView = function (view, options) {
            var next = String(view || 'today');
            var opts = options || {};
            if (historyReady && !opts.fromHistory && next !== String(window.flowAtelier && window.flowAtelier.activeView || '')) {
                try {
                    var url = new URL(window.location.href);
                    url.hash = 'view=' + encodeURIComponent(next);
                    window.history.pushState({ ...(window.history.state || {}), sutraView: next }, '', url.href);
                } catch (_) { /* progressive enhancement */ }
            }
            var result = originalSetActiveView(view, options);
            [0, 120, 260, 500, 700].forEach(function (delay) {
                window.setTimeout(function () {
                    try { syncGlassNotesClearance(); } catch (_) { /* layout repair is best effort */ }
                }, delay);
            });
            return result;
        };
        var initial = readView();
        if (initial && document.getElementById('view-' + initial)) originalSetActiveView(initial, { fromHistory: true, allowDisabled: true });
        try {
            var url = new URL(window.location.href);
            var active = String(window.flowAtelier && window.flowAtelier.activeView || initial || 'today');
            url.hash = 'view=' + encodeURIComponent(active);
            var state = { ...(window.history.state || {}), sutraView: active };
            var alreadyInside = window.history.state && window.history.state.sutraEntry === true;
            window.history.replaceState(state, '', url.href);
            if (!alreadyInside) window.history.pushState({ ...state, sutraEntry: true }, '', url.href);
        } catch (_) { /* progressive enhancement */ }
        historyReady = true;
        window.addEventListener('popstate', function (event) {
            var next = event && event.state && event.state.sutraView || readView() || 'today';
            if (document.getElementById('view-' + next)) originalSetActiveView(next, { fromHistory: true, allowDisabled: true });
        });
    }

    function installFocusPreflight() {
        if (typeof originalStartFocusSession !== 'function') return;
        window.startFocusSession = function (taskId, options) {
            var opts = options || {};
            if (opts.skipPreflight || (!opts.userInitiated && (opts.autostart || opts.plannedDurationSeconds)) || focusPreflightPending) {
                return originalStartFocusSession(taskId, opts);
            }
            focusPreflightPending = true;
            var task = getTasks().find(function (item) { return item && String(item.id) === String(taskId); });
            var fallback = task && Number(task.estimateMinutes) > 0 ? Number(task.estimateMinutes) : 25;
            var prompt = typeof window.showCustomPromptDialog === 'function'
                ? window.showCustomPromptDialog({
                    title: 'Plan your focus session',
                    label: task ? 'Minutes for “' + (task.title || 'this task') + '”' : 'Focus duration in minutes',
                    defaultValue: String(Math.max(5, Math.min(180, Math.round(fallback)))),
                    placeholder: '25',
                    confirmText: 'Open Focus',
                    cancelText: 'Cancel'
                })
                : Promise.resolve(String(fallback));
            Promise.resolve(prompt).then(function (value) {
                if (value === null) return;
                var minutes = Number(String(value).trim());
                if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) {
                    if (typeof window.showToast === 'function') window.showToast('Choose a focus duration from 5 to 180 minutes.');
                    return;
                }
                originalStartFocusSession(taskId, { ...opts, plannedDurationSeconds: Math.round(minutes) * 60, skipPreflight: true });
            }).finally(function () { focusPreflightPending = false; });
        };
        // Today and several workspace actions call the canonical bridge rather
        // than the window alias. Route that same entry point through the
        // preflight so every user-started session gets the same choice.
        try {
            if (window.flowAtelier && typeof window.flowAtelier.startFocusSession === 'function') {
                window.flowAtelier.startFocusSession = function (taskId, options) {
                    return window.startFocusSession(taskId, options);
                };
            }
        } catch (_) { /* bridge is optional during degraded startup */ }
    }

    function installSyncOutcomeGuard() {
        if (originalShowToast || typeof window.showToast !== 'function') return;
        originalShowToast = window.showToast;
        function renderSyncRecoveryGuidance() {
            var errorEl = document.getElementById('sutraSyncRunningError');
            if (!errorEl) return;
            errorEl.textContent = 'Sync is paused because encrypted cloud data could not be verified. Your local workspace and local saves remain available.';
            errorEl.hidden = false;
            var existing = document.getElementById('sutraSyncRecoveryGuidance');
            if (existing) return;
            var guidance = document.createElement('div');
            guidance.id = 'sutraSyncRecoveryGuidance';
            guidance.className = 'sutra-sync-panel sutra-sync-recovery-guidance';
            guidance.setAttribute('role', 'status');
            var heading = document.createElement('h5');
            heading.textContent = 'Safe recovery steps';
            var list = document.createElement('ol');
            [
                'Keep the encrypted .sutra backup you just made before changing Sync settings.',
                'Confirm this browser is signed in to the same Sutra Cloud account and use the original Sync passphrase or recovery kit.',
                'If another trusted device still syncs, leave its cloud history intact and verify the vault there before changing anything.',
                'Do not create a new vault key or keep retrying an unknown passphrase; Sync stays fail-closed to protect the workspace.',
                'Deleting the cloud vault is a last-resort, permanent action for every device. It is not required to preserve local work.'
            ].forEach(function (item) {
                var row = document.createElement('li');
                row.textContent = item;
                list.appendChild(row);
            });
            guidance.append(heading, list);
            errorEl.insertAdjacentElement('afterend', guidance);
        }
        window.addEventListener('sutra:sync-status', function (event) {
            var detail = event && event.detail;
            if (!detail || detail.state !== 'encryption-error') return;
            renderSyncRecoveryGuidance();
        });
        window.showToast = function (message, options) {
            var text = String(message || '');
            var isUnlockSuccess = text === 'Sync unlocked.' || text.indexOf('Sutra Sync is on.') === 0;
            var state = null;
            try {
                state = window.SutraSync && typeof window.SutraSync.status === 'function'
                    ? window.SutraSync.status()
                    : null;
            } catch (_) { state = null; }
            if (isUnlockSuccess && state && state.state === 'encryption-error') {
                renderSyncRecoveryGuidance();
                return originalShowToast(
                    'Sync is paused: encrypted cloud data could not be verified. See the recovery steps in Sync.',
                    { ...(options || {}), durationMs: 8000 }
                );
            }
            return originalShowToast(message, options);
        };
        try {
            if (window.SutraSync && typeof window.SutraSync.status === 'function'
                && window.SutraSync.status().state === 'encryption-error') renderSyncRecoveryGuidance();
        } catch (_) { /* status is optional during degraded startup */ }
    }

    function syncGlassNotesClearance() {
        if (window.innerWidth < 641 || window.innerWidth > 1024) return;
        var body = document.body;
        if (!body || body.dataset.view !== 'notes' || body.classList.contains('notes-split-active')) return;
        if (!body.matches('[data-theme="glass"], [data-theme="liquidglass"]')) return;
        var toolbar = document.querySelector('#view-notes .toolbar-wrapper');
        var editor = document.getElementById('notesEditorContainer');
        if (!toolbar || !editor) return;
        var toolbarStyle = window.getComputedStyle(toolbar);
        if (toolbarStyle.display === 'none' || toolbarStyle.visibility === 'hidden') return;
        if (toolbarStyle.position === 'fixed' || toolbarStyle.position === 'absolute') return;

        var toolbarRect = toolbar.getBoundingClientRect();
        var editorRect = editor.getBoundingClientRect();
        var visualOverlap = toolbarRect.bottom - editorRect.top;
        var baselinePadding = 26;
        var requiredPadding = visualOverlap > 0 ? Math.ceil(visualOverlap + 12) : baselinePadding;
        var nextPadding = Math.max(baselinePadding, requiredPadding);
        var editorPadding = parseFloat(window.getComputedStyle(editor).paddingTop) || 0;
        if (editorPadding + 0.5 < nextPadding) {
            editor.style.setProperty('padding-top', nextPadding + 'px', 'important');
        }
    }

    function installGlassNotesClearance() {
        var scheduled = false;
        var schedule = function () {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(function () {
                scheduled = false;
                try { syncGlassNotesClearance(); } catch (_) { /* layout repair is best effort */ }
            });
        };
        window.addEventListener('resize', schedule);
        document.addEventListener('animationend', function (event) {
            if (event && event.target && event.target.closest && event.target.closest('#view-notes')) schedule();
        });
        var body = document.body;
        if (body && typeof MutationObserver !== 'undefined') {
            new MutationObserver(schedule).observe(body, {
                attributes: true,
                attributeFilter: ['class', 'data-theme', 'data-theme-key', 'data-view']
            });
        }
        [0, 120, 260, 500, 700].forEach(function (delay) { window.setTimeout(schedule, delay); });
    }

    function install() {
        originalSetActiveView = window.setActiveView;
        originalStartFocusSession = window.startFocusSession;
        installSyncOutcomeGuard();
        installHistory();
        installFocusPreflight();
        installGlassNotesClearance();
        var overlay = document.getElementById('studentOnboardingOverlay');
        var panel = document.getElementById('onboardingMainPanel');
        if (panel) new MutationObserver(installOnboardingExit).observe(panel, { childList: true, subtree: true });
        if (overlay) new MutationObserver(installOnboardingExit).observe(overlay, { attributes: true, childList: true, subtree: true });
        var today = document.getElementById('todayDailyBrief');
        if (today) new MutationObserver(refreshUndatedTaskCue).observe(today, { childList: true, subtree: true });
        installOnboardingExit();
        refreshUndatedTaskCue();
        // NOTE: the startup-sound default repair that previously ran here (and
        // re-ran itself at 100/500/1200ms) is retired. The canonical default in
        // getDefaultWorkspacePreferences()/normalizeWorkspacePreferences() is
        // now silent-by-default, so no post-load repair passes are needed.
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
}());
