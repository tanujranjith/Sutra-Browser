/* ==========================================================================
   Sutra School Schedule — rotating school days, periods & calendar subscriptions
   ==========================================================================
   Local-first engine + UI for real school schedules:
   - A/B days, N-day cycles, plain weekly timetables
   - Bell schedules (periods), term dates, holidays, special days
   - Read-only calendar subscriptions (cached locally; refresh is explicit and
     fails gracefully — the last successful import keeps working offline)
   - Today view strip (current school day, current/next period)
   - Busy windows feed Shape My Day so plans avoid class time.

   State lives in appData.schoolSchedule (full .sutra backup coverage).
   The deterministic engine is pure and also exported for Node-based tests.
   ========================================================================== */

/* global window, document */

(function (global) {
    'use strict';

    var DAY_MS = 24 * 60 * 60 * 1000;
    var WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var OVERRIDE_KINDS = ['holiday', 'special', 'early_dismissal', 'override_label'];
    var MAX_CYCLE = 10;

    // ---- Small utils (no DOM) ----------------------------------------------
    function pad2(n) { return String(n).padStart(2, '0'); }
    function toDateKey(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    function parseDateKey(key) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').trim());
        if (!m) return null;
        var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
    }
    function timeToMinutes(value) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
        if (!m) return null;
        var mins = Number(m[1]) * 60 + Number(m[2]);
        return (mins >= 0 && mins <= 24 * 60) ? mins : null;
    }
    function uid(prefix) {
        return (prefix || 'ss') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ---- Normalization (defaults live here; app.js calls these) ------------
    function getDefaultSchoolSchedule() {
        return {
            schemaVersion: 1,
            enabled: false,
            term: { name: '', startDate: '', endDate: '' },
            rotation: {
                type: 'weekly',          // 'weekly' | 'ab' | 'cycle'
                cycleLength: 2,
                labels: ['A', 'B'],
                anchorDate: '',
                anchorIndex: 0,
                skipWeekends: true,
                skipNoSchoolDays: true
            },
            schedules: [],               // [{ id, name, periods: [{id,label,start,end}] }]
            defaultScheduleId: '',
            dayTemplates: {},            // labelKey -> { scheduleId, assignments: { periodId: courseId } }
            overrides: [],               // [{ id, date, kind, label, scheduleId, note }]
            subscriptions: [],           // [{ id, name, url, addedAt, lastRefreshAt, lastRefreshStatus, lastEventCount }]
            settings: {
                showTodayStrip: true,
                classReminders: true,
                classReminderLeadMinutes: 5
            }
        };
    }

    function normalizePeriod(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var label = String(raw.label || raw.name || '').trim();
        var start = String(raw.start || '').trim();
        var end = String(raw.end || '').trim();
        if (!label && !start) return null;
        return {
            id: String(raw.id || uid('per')),
            label: label || 'Period',
            start: timeToMinutes(start) !== null ? start : '',
            end: timeToMinutes(end) !== null ? end : ''
        };
    }

    function normalizeBellSchedule(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        var periods = Array.isArray(raw.periods) ? raw.periods.map(normalizePeriod).filter(Boolean) : [];
        if (!name && !periods.length) return null;
        return { id: String(raw.id || uid('sched')), name: name || 'Schedule', periods: periods };
    }

    function normalizeOverride(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var date = String(raw.date || '').trim();
        if (!parseDateKey(date)) return null;
        var kind = OVERRIDE_KINDS.indexOf(String(raw.kind)) !== -1 ? String(raw.kind) : 'holiday';
        return {
            id: String(raw.id || uid('ovr')),
            date: date,
            kind: kind,
            label: String(raw.label || '').trim(),
            scheduleId: String(raw.scheduleId || '').trim(),
            note: String(raw.note || '').trim()
        };
    }

    function normalizeSubscription(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        var url = String(raw.url || '').trim();
        if (!name && !url) return null;
        return {
            id: String(raw.id || uid('sub')),
            name: name || 'School calendar',
            url: url,
            addedAt: raw.addedAt || new Date().toISOString(),
            lastRefreshAt: raw.lastRefreshAt || null,
            lastRefreshStatus: ['ok', 'failed', 'never'].indexOf(String(raw.lastRefreshStatus)) !== -1
                ? String(raw.lastRefreshStatus) : 'never',
            lastRefreshError: String(raw.lastRefreshError || ''),
            lastEventCount: Number.isFinite(Number(raw.lastEventCount)) ? Number(raw.lastEventCount) : 0
        };
    }

    function normalizeSchoolSchedule(raw) {
        var d = getDefaultSchoolSchedule();
        if (!raw || typeof raw !== 'object') return d;
        var out = d;
        out.enabled = raw.enabled === true;
        var term = raw.term && typeof raw.term === 'object' ? raw.term : {};
        out.term = {
            name: String(term.name || '').trim(),
            startDate: parseDateKey(term.startDate) ? String(term.startDate) : '',
            endDate: parseDateKey(term.endDate) ? String(term.endDate) : ''
        };
        var rot = raw.rotation && typeof raw.rotation === 'object' ? raw.rotation : {};
        var type = ['weekly', 'ab', 'cycle'].indexOf(String(rot.type)) !== -1 ? String(rot.type) : 'weekly';
        var cycleLength = Math.max(2, Math.min(MAX_CYCLE, Math.round(Number(rot.cycleLength) || 2)));
        if (type === 'ab') cycleLength = 2;
        var labels = Array.isArray(rot.labels) ? rot.labels.map(function (l) { return String(l || '').trim(); }) : [];
        labels = labels.filter(Boolean).slice(0, cycleLength);
        while (labels.length < cycleLength) {
            labels.push(String.fromCharCode(65 + labels.length)); // A, B, C...
        }
        out.rotation = {
            type: type,
            cycleLength: cycleLength,
            labels: labels,
            anchorDate: parseDateKey(rot.anchorDate) ? String(rot.anchorDate) : '',
            anchorIndex: Math.max(0, Math.min(cycleLength - 1, Math.round(Number(rot.anchorIndex) || 0))),
            skipWeekends: rot.skipWeekends !== false,
            skipNoSchoolDays: rot.skipNoSchoolDays !== false
        };
        out.schedules = Array.isArray(raw.schedules) ? raw.schedules.map(normalizeBellSchedule).filter(Boolean) : [];
        out.defaultScheduleId = out.schedules.some(function (s) { return s.id === String(raw.defaultScheduleId); })
            ? String(raw.defaultScheduleId)
            : (out.schedules.length ? out.schedules[0].id : '');
        var templates = raw.dayTemplates && typeof raw.dayTemplates === 'object' ? raw.dayTemplates : {};
        out.dayTemplates = {};
        Object.keys(templates).forEach(function (key) {
            var t = templates[key];
            if (!t || typeof t !== 'object') return;
            var assignments = {};
            var rawAssignments = t.assignments && typeof t.assignments === 'object' ? t.assignments : {};
            Object.keys(rawAssignments).forEach(function (pid) {
                var cid = String(rawAssignments[pid] || '').trim();
                if (cid) assignments[String(pid)] = cid;
            });
            out.dayTemplates[String(key)] = {
                scheduleId: String(t.scheduleId || '').trim(),
                assignments: assignments
            };
        });
        out.overrides = Array.isArray(raw.overrides) ? raw.overrides.map(normalizeOverride).filter(Boolean) : [];
        out.subscriptions = Array.isArray(raw.subscriptions) ? raw.subscriptions.map(normalizeSubscription).filter(Boolean) : [];
        var st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
        out.settings = {
            showTodayStrip: st.showTodayStrip !== false,
            classReminders: st.classReminders !== false,
            classReminderLeadMinutes: Math.max(0, Math.min(60, Math.round(Number(st.classReminderLeadMinutes) || 5)))
        };
        return out;
    }

    function cloneSchedule(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function scheduleFingerprint(value) {
        return JSON.stringify(normalizeSchoolSchedule(value));
    }

    function createDraftSession(persisted) {
        var baseline = normalizeSchoolSchedule(persisted);
        var draft = cloneSchedule(baseline);
        var baselineFingerprint = scheduleFingerprint(baseline);
        return {
            persisted: cloneSchedule(baseline),
            draft: draft,
            isDirty: function (candidate) { return scheduleFingerprint(candidate || draft) !== baselineFingerprint; },
            commitValue: function (candidate) { return normalizeSchoolSchedule(candidate || draft); }
        };
    }

    // ---- Deterministic rotation engine --------------------------------------
    function getOverrideForDate(ws, dateKey) {
        var list = Array.isArray(ws.overrides) ? ws.overrides : [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].date === dateKey) return list[i];
        }
        return null;
    }

    function isNoSchoolDay(ws, date) {
        var key = toDateKey(date);
        var override = getOverrideForDate(ws, key);
        if (override && override.kind === 'holiday') return true;
        if (ws.rotation.skipWeekends && (date.getDay() === 0 || date.getDay() === 6)) return true;
        if (ws.term.startDate && key < ws.term.startDate) return true;
        if (ws.term.endDate && key > ws.term.endDate) return true;
        return false;
    }

    // Count school days strictly between anchor and target (signed).
    function countSchoolDaysFromAnchor(ws, anchorKey, targetKey) {
        var anchor = parseDateKey(anchorKey);
        var target = parseDateKey(targetKey);
        if (!anchor || !target) return null;
        if (anchorKey === targetKey) return 0;
        var step = target > anchor ? 1 : -1;
        var count = 0;
        var cursor = new Date(anchor.getTime());
        var guard = 0;
        while (toDateKey(cursor) !== targetKey && guard < 1500) {
            cursor = new Date(cursor.getTime() + step * DAY_MS);
            guard += 1;
            if (ws.rotation.skipNoSchoolDays || ws.rotation.skipWeekends) {
                if (isNoSchoolDay(ws, cursor)) continue;
            }
            count += step;
        }
        return guard >= 1500 ? null : count;
    }

    function getScheduleById(ws, id) {
        var list = Array.isArray(ws.schedules) ? ws.schedules : [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === String(id)) return list[i];
        }
        return null;
    }

    function lookupCourseName(courseId) {
        try {
            if (global.courseHub && typeof global.courseHub.getCourseById === 'function') {
                var c = global.courseHub.getCourseById(courseId);
                if (c) return c.shortName || c.name || '';
            }
        } catch (e) { /* non-critical */ }
        return '';
    }

    /**
     * Resolve everything Sutra knows about a school date.
     * Pure given (ws, dateKey); course names are looked up lazily by the UI.
     */
    function resolveDayInfo(ws, dateKey) {
        var info = {
            dateKey: dateKey,
            enabled: !!(ws && ws.enabled),
            isSchoolDay: false,
            dayLabel: '',
            labelKey: '',
            scheduleId: '',
            scheduleName: '',
            periods: [],
            override: null,
            reason: ''
        };
        if (!info.enabled) { info.reason = 'disabled'; return info; }
        var date = parseDateKey(dateKey);
        if (!date) { info.reason = 'invalid_date'; return info; }

        var override = getOverrideForDate(ws, dateKey);
        if (override) info.override = override;
        if (override && override.kind === 'holiday') {
            info.reason = 'holiday';
            info.dayLabel = override.label || 'No school';
            return info;
        }
        if (ws.term.startDate && dateKey < ws.term.startDate) { info.reason = 'before_term'; return info; }
        if (ws.term.endDate && dateKey > ws.term.endDate) { info.reason = 'after_term'; return info; }
        if (ws.rotation.skipWeekends && (date.getDay() === 0 || date.getDay() === 6)) {
            info.reason = 'weekend';
            return info;
        }

        info.isSchoolDay = true;
        var labelKey = '';
        if (ws.rotation.type === 'weekly') {
            labelKey = WEEKDAY_KEYS[date.getDay()];
            info.dayLabel = WEEKDAY_LABELS[date.getDay()];
        } else {
            if (!ws.rotation.anchorDate) {
                info.reason = 'no_anchor';
                info.dayLabel = 'Rotation not anchored';
            } else {
                var offset = countSchoolDaysFromAnchor(ws, ws.rotation.anchorDate, dateKey);
                if (offset === null) {
                    info.reason = 'anchor_too_far';
                } else {
                    var len = ws.rotation.cycleLength;
                    var idx = ((ws.rotation.anchorIndex + offset) % len + len) % len;
                    labelKey = ws.rotation.labels[idx] || '';
                    info.dayLabel = labelKey ? (labelKey + ' Day') : '';
                }
            }
        }
        if (override && override.kind === 'override_label' && override.label) {
            labelKey = override.label;
            info.dayLabel = override.label + ' Day';
        }
        info.labelKey = labelKey;

        var template = (ws.dayTemplates && ws.dayTemplates[labelKey]) || null;
        var scheduleId = '';
        if (override && (override.kind === 'special' || override.kind === 'early_dismissal') && override.scheduleId) {
            scheduleId = override.scheduleId;
        } else if (template && template.scheduleId) {
            scheduleId = template.scheduleId;
        } else {
            scheduleId = ws.defaultScheduleId;
        }
        var schedule = getScheduleById(ws, scheduleId);
        if (schedule) {
            info.scheduleId = schedule.id;
            info.scheduleName = schedule.name;
            info.periods = schedule.periods.map(function (p) {
                var courseId = template && template.assignments ? (template.assignments[p.id] || '') : '';
                return {
                    id: p.id,
                    label: p.label,
                    start: p.start,
                    end: p.end,
                    startMinutes: timeToMinutes(p.start),
                    endMinutes: timeToMinutes(p.end),
                    courseId: courseId,
                    courseName: courseId ? lookupCourseName(courseId) : ''
                };
            });
        }
        if (override && override.kind === 'early_dismissal' && !override.scheduleId) {
            info.dayLabel = (info.dayLabel ? info.dayLabel + ' · ' : '') + (override.label || 'Early dismissal');
        } else if (override && override.kind === 'special' && override.label) {
            info.dayLabel = (info.dayLabel ? info.dayLabel + ' · ' : '') + override.label;
        }
        return info;
    }

    /** Busy minute-windows for a date (class periods). Used by Shape My Day. */
    function getBusyWindowsForDate(ws, dateKey) {
        var info = resolveDayInfo(ws, dateKey);
        if (!info.isSchoolDay) return [];
        return info.periods
            .filter(function (p) { return p.startMinutes !== null && p.endMinutes !== null && p.endMinutes > p.startMinutes; })
            .map(function (p) { return { start: p.startMinutes, end: p.endMinutes }; });
    }

    /** Free study windows for a date between the school day bounds and evening. */
    function getStudyWindowsForDate(ws, dateKey, options) {
        options = options || {};
        var dayStart = Number.isFinite(options.dayStart) ? options.dayStart : 6 * 60;
        var dayEnd = Number.isFinite(options.dayEnd) ? options.dayEnd : 22 * 60;
        var busy = getBusyWindowsForDate(ws, dateKey).slice().sort(function (a, b) { return a.start - b.start; });
        var free = [];
        var cursor = dayStart;
        busy.forEach(function (win) {
            if (win.start > cursor) free.push({ start: cursor, end: Math.min(win.start, dayEnd) });
            cursor = Math.max(cursor, win.end);
        });
        if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
        return free.filter(function (w) { return w.end - w.start >= 20; });
    }

    var Engine = {
        getDefaultSchoolSchedule: getDefaultSchoolSchedule,
        normalizeSchoolSchedule: normalizeSchoolSchedule,
        resolveDayInfo: resolveDayInfo,
        countSchoolDaysFromAnchor: countSchoolDaysFromAnchor,
        getBusyWindowsForDate: getBusyWindowsForDate,
        getStudyWindowsForDate: getStudyWindowsForDate,
        timeToMinutes: timeToMinutes,
        createDraftSession: createDraftSession,
        scheduleFingerprint: scheduleFingerprint
    };

    // Node export for deterministic engine tests (browser script tags skip this).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Engine;
    }
    if (typeof window === 'undefined') return;

    // =========================================================================
    // Browser integration
    // =========================================================================

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getState() {
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.getSchoolSchedule === 'function') {
                return normalizeSchoolSchedule(global.SutraAcademicState.getSchoolSchedule());
            }
        } catch (e) { /* fall through */ }
        return getDefaultSchoolSchedule();
    }

    function setState(next, opts) {
        var normalized = normalizeSchoolSchedule(next);
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.setSchoolSchedule === 'function') {
                global.SutraAcademicState.setSchoolSchedule(normalized);
            }
        } catch (e) { console.warn('SchoolSchedule save failed', e); }
        if (!opts || opts.render !== false) {
            renderTodayStrip();
            try { global.dispatchEvent(new CustomEvent('sutra:school-schedule-updated')); } catch (e) { /* non-critical */ }
        }
        return normalized;
    }

    function fmtTime12(value) {
        var mins = timeToMinutes(value);
        if (mins === null) return value || '';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        var suffix = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 || 12;
        return h12 + ':' + pad2(m) + ' ' + suffix;
    }

    // ---- Today strip ---------------------------------------------------------
    function renderTodayStrip() {
        var strip = document.getElementById('sutraSchoolDayStrip');
        if (!strip) return;
        var ws = getState();
        if (!ws.settings.showTodayStrip) { strip.hidden = true; return; }
        var todayKey = toDateKey(new Date());
        var info = resolveDayInfo(ws, todayKey);

        if (!ws.enabled) {
            strip.hidden = false;
            strip.innerHTML = '<div class="ssched-strip-row">'
                + '<span class="ssched-strip-icon"><i class="fas fa-school" aria-hidden="true"></i></span>'
                + '<span class="ssched-strip-main">Tell Sutra about your real school schedule — A/B days, periods, and holidays power smarter plans.</span>'
                + '<button type="button" class="neumo-btn today-hero-ghost ssched-strip-btn" data-ssched-open>Set up schedule</button>'
                + '</div>';
            bindStrip(strip);
            return;
        }

        var nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        var current = null;
        var next = null;
        info.periods.forEach(function (p) {
            if (p.startMinutes === null || p.endMinutes === null) return;
            if (nowMinutes >= p.startMinutes && nowMinutes < p.endMinutes && !current) current = p;
            if (p.startMinutes > nowMinutes && (!next || p.startMinutes < next.startMinutes)) next = p;
        });
        var pieces = [];
        if (info.isSchoolDay) {
            pieces.push('<strong>' + esc(info.dayLabel || 'School day') + '</strong>'
                + (info.scheduleName ? ' · ' + esc(info.scheduleName) : ''));
            if (current) {
                pieces.push('Now: ' + esc(current.courseName || current.label)
                    + ' (until ' + esc(fmtTime12(current.end)) + ')');
            }
            if (next) {
                pieces.push('Next: ' + esc(next.courseName || next.label)
                    + ' at ' + esc(fmtTime12(next.start)));
            }
            if (!current && !next && info.periods.length) pieces.push('School day is done — your evening is open.');
            if (!info.periods.length) pieces.push('No bell schedule mapped for this day yet.');
        } else {
            var reasonLabel = info.reason === 'holiday'
                ? (info.dayLabel || 'No school')
                : (info.reason === 'weekend' ? 'No school today (weekend)' : 'No school today');
            pieces.push('<strong>' + esc(reasonLabel) + '</strong>');
            var windows = getStudyWindowsForDate(ws, todayKey);
            if (windows.length) pieces.push('Open day — good time for deep work.');
        }
        strip.hidden = false;
        strip.innerHTML = '<div class="ssched-strip-row">'
            + '<span class="ssched-strip-icon"><i class="fas fa-school" aria-hidden="true"></i></span>'
            + '<span class="ssched-strip-main">' + pieces.join(' <span class="ssched-strip-sep">·</span> ') + '</span>'
            + '<button type="button" class="neumo-btn today-hero-ghost ssched-strip-btn" data-ssched-open aria-label="Manage school schedule">Schedule</button>'
            + '</div>';
        bindStrip(strip);
    }

    function bindStrip(strip) {
        var btn = strip.querySelector('[data-ssched-open]');
        if (btn) btn.addEventListener('click', function () { openManager(); });
    }

    // ---- Manager modal -------------------------------------------------------
    var managerDraft = null;
    var managerDraftSession = null;
    var managerRemovedSubscriptionIds = null;
    var discardPrompt = null;

    function ensureModal() {
        var modal = document.getElementById('schoolScheduleModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'schoolScheduleModal';
        modal.className = 'sutra-academic-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="sutra-academic-card" role="dialog" aria-modal="true" aria-labelledby="schoolScheduleTitle">'
            + '<div class="sutra-academic-head">'
            + '<h3 id="schoolScheduleTitle">School Schedule</h3>'
            + '<button type="button" class="sutra-academic-close" data-ssched-close aria-label="Close">&times;</button>'
            + '</div>'
            + '<div class="sutra-academic-body" id="schoolScheduleBody"></div>'
            + '<div class="sutra-academic-foot">'
            + '<span class="ssched-foot-note">Everything stays on this device and rides inside .sutra backups.</span>'
            + '<div class="sutra-academic-foot-actions">'
            + '<button type="button" class="neumo-btn" data-ssched-close>Cancel</button>'
            + '<button type="button" class="neumo-btn btn-primary" data-ssched-save>Save schedule</button>'
            + '</div></div></div>';
        document.body.appendChild(modal);

        modal.addEventListener('click', function (e) {
            if (e.target === modal) requestCloseManager();
            var closeBtn = e.target.closest('[data-ssched-close]');
            if (closeBtn) { requestCloseManager(); return; }
            var saveBtn = e.target.closest('[data-ssched-save]');
            if (saveBtn) { saveManager(); return; }
            handleManagerClick(e);
        });
        modal.addEventListener('change', handleManagerChange);
        modal.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !discardPrompt) { e.preventDefault(); requestCloseManager(); }
        });
        return modal;
    }

    function openManager() {
        var modal = ensureModal();
        managerDraftSession = createDraftSession(getState());
        managerDraft = managerDraftSession.draft;
        managerRemovedSubscriptionIds = new Set();
        renderManagerBody();
        modal.__sutraReturnFocus = document.activeElement;
        modal.hidden = false;
        modal.classList.add('is-visible');
        syncModalManager();
        var firstInput = modal.querySelector('input, select, button.sutra-academic-close');
        if (firstInput) setTimeout(function () { try { firstInput.focus(); } catch (e) {} }, 40);
    }

    function closeManagerNow() {
        var modal = document.getElementById('schoolScheduleModal');
        if (!modal) return;
        var returnFocus = modal.__sutraReturnFocus;
        modal.hidden = true;
        modal.classList.remove('is-visible');
        managerDraft = null;
        managerDraftSession = null;
        managerRemovedSubscriptionIds = null;
        syncModalManager();
        if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) {
            setTimeout(function () { try { returnFocus.focus(); } catch (e) {} }, 0);
        }
    }

    function hasUnsavedManagerDraft() {
        if (!managerDraft || !managerDraftSession) return false;
        syncDraftFromDom();
        return managerDraftSession.isDirty(managerDraft);
    }

    function closeDiscardPrompt() {
        if (!discardPrompt) return;
        var prompt = discardPrompt;
        discardPrompt = null;
        prompt.remove();
        var modal = document.getElementById('schoolScheduleModal');
        var closeButton = modal && modal.querySelector('[data-ssched-close]');
        if (closeButton) closeButton.focus();
    }

    function showDiscardPrompt() {
        if (discardPrompt) return discardPrompt;
        var overlay = document.createElement('div');
        overlay.className = 'sutra-academic-modal is-visible ssched-discard-overlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'sschedDiscardTitle');
        overlay.setAttribute('aria-describedby', 'sschedDiscardCopy');
        var card = document.createElement('div'); card.className = 'sutra-academic-card ssched-discard-card';
        var title = document.createElement('h3'); title.id = 'sschedDiscardTitle'; title.textContent = 'Discard schedule changes?';
        var copy = document.createElement('p'); copy.id = 'sschedDiscardCopy'; copy.textContent = 'Your unsaved school schedule edits will be lost.';
        var actions = document.createElement('div'); actions.className = 'sutra-academic-foot-actions';
        var keep = document.createElement('button'); keep.type = 'button'; keep.className = 'neumo-btn'; keep.textContent = 'Keep editing';
        var discard = document.createElement('button'); discard.type = 'button'; discard.className = 'neumo-btn btn-danger'; discard.textContent = 'Discard changes';
        actions.appendChild(keep); actions.appendChild(discard); card.appendChild(title); card.appendChild(copy); card.appendChild(actions); overlay.appendChild(card);
        document.body.appendChild(overlay); discardPrompt = overlay;
        keep.addEventListener('click', closeDiscardPrompt);
        discard.addEventListener('click', function () { closeDiscardPrompt(); closeManagerNow(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDiscardPrompt(); });
        overlay.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closeDiscardPrompt(); return; }
            if (e.key !== 'Tab') return;
            if (e.shiftKey && document.activeElement === keep) { e.preventDefault(); discard.focus(); }
            else if (!e.shiftKey && document.activeElement === discard) { e.preventDefault(); keep.focus(); }
        });
        keep.focus();
        return overlay;
    }

    function requestCloseManager() {
        if (!hasUnsavedManagerDraft()) { closeManagerNow(); return true; }
        showDiscardPrompt();
        return false;
    }

    function syncModalManager() {
        if (global.SutraModalManager && typeof global.SutraModalManager.sync === 'function') {
            try { global.SutraModalManager.sync(); } catch (e) { /* non-critical */ }
        }
    }

    function getCourses() {
        try {
            if (global.courseHub && typeof global.courseHub.getCourses === 'function') {
                return global.courseHub.getCourses({ filter: 'active' }) || [];
            }
        } catch (e) { /* non-critical */ }
        return [];
    }

    function courseOptionsHtml(selectedId) {
        var options = ['<option value="">— Free / none —</option>'];
        getCourses().forEach(function (c) {
            options.push('<option value="' + esc(c.id) + '"' + (String(c.id) === String(selectedId) ? ' selected' : '') + '>'
                + esc(c.shortName || c.name) + '</option>');
        });
        return options.join('');
    }

    function renderManagerBody() {
        var body = document.getElementById('schoolScheduleBody');
        if (!body || !managerDraft) return;
        var ws = managerDraft;
        var rot = ws.rotation;

        var scheduleOptions = function (selectedId, allowEmpty) {
            var opts = allowEmpty ? ['<option value="">— Default —</option>'] : [];
            ws.schedules.forEach(function (s) {
                opts.push('<option value="' + esc(s.id) + '"' + (s.id === selectedId ? ' selected' : '') + '>' + esc(s.name) + '</option>');
            });
            return opts.join('');
        };

        var schedulesHtml = ws.schedules.map(function (s) {
            var rows = s.periods.map(function (p) {
                return '<div class="ssched-period-row" data-schedule="' + esc(s.id) + '" data-period="' + esc(p.id) + '">'
                    + '<input type="text" data-ss-field="period-label" value="' + esc(p.label) + '" aria-label="Period name" placeholder="Period 1">'
                    + '<input type="time" data-ss-field="period-start" value="' + esc(p.start) + '" aria-label="Start time">'
                    + '<input type="time" data-ss-field="period-end" value="' + esc(p.end) + '" aria-label="End time">'
                    + '<button type="button" class="ssched-mini-btn danger" data-ss-action="remove-period" aria-label="Remove period">&times;</button>'
                    + '</div>';
            }).join('');
            return '<div class="ssched-schedule-card" data-schedule="' + esc(s.id) + '">'
                + '<div class="ssched-schedule-head">'
                + '<input type="text" data-ss-field="schedule-name" value="' + esc(s.name) + '" aria-label="Bell schedule name">'
                + '<label class="ssched-default-label"><input type="radio" name="sschedDefault" data-ss-field="default-schedule" value="' + esc(s.id) + '"'
                + (ws.defaultScheduleId === s.id ? ' checked' : '') + '> Default</label>'
                + '<button type="button" class="ssched-mini-btn danger" data-ss-action="remove-schedule" aria-label="Remove bell schedule">Remove</button>'
                + '</div>'
                + '<div class="ssched-period-grid-head"><span>Period</span><span>Starts</span><span>Ends</span><span></span></div>'
                + rows
                + '<button type="button" class="ssched-mini-btn" data-ss-action="add-period">+ Add period</button>'
                + '</div>';
        }).join('');

        var labelsForTemplates = rot.type === 'weekly' ? ['mon', 'tue', 'wed', 'thu', 'fri'] : rot.labels;
        var labelTitle = function (key) {
            if (rot.type !== 'weekly') return key + ' Day';
            var idx = WEEKDAY_KEYS.indexOf(key);
            return idx >= 0 ? WEEKDAY_LABELS[idx] : key;
        };
        var templatesHtml = labelsForTemplates.map(function (labelKey) {
            var template = ws.dayTemplates[labelKey] || { scheduleId: '', assignments: {} };
            var schedule = getScheduleById(ws, template.scheduleId || ws.defaultScheduleId);
            var assignRows = schedule ? schedule.periods.map(function (p) {
                return '<div class="ssched-assign-row">'
                    + '<span class="ssched-assign-period">' + esc(p.label) + (p.start ? ' · ' + esc(fmtTime12(p.start)) : '') + '</span>'
                    + '<select data-ss-field="assignment" data-label="' + esc(labelKey) + '" data-period="' + esc(p.id) + '" aria-label="Class for ' + esc(p.label) + '">'
                    + courseOptionsHtml(template.assignments[p.id] || '')
                    + '</select></div>';
            }).join('') : '<div class="ssched-empty-line">Add a bell schedule first.</div>';
            return '<details class="ssched-template" data-label="' + esc(labelKey) + '">'
                + '<summary>' + esc(labelTitle(labelKey)) + '</summary>'
                + '<label class="ssched-inline-field"><span>Bell schedule</span>'
                + '<select data-ss-field="template-schedule" data-label="' + esc(labelKey) + '">' + scheduleOptions(template.scheduleId, true) + '</select></label>'
                + '<div class="ssched-assign-list">' + assignRows + '</div>'
                + '</details>';
        }).join('');

        var overridesHtml = ws.overrides
            .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
            .map(function (o) {
                return '<div class="ssched-override-row" data-override="' + esc(o.id) + '">'
                    + '<span class="ssched-override-date">' + esc(o.date) + '</span>'
                    + '<span class="ssched-override-kind">' + esc(o.kind.replace('_', ' ')) + '</span>'
                    + '<span class="ssched-override-label">' + esc(o.label || (o.scheduleId ? (getScheduleById(ws, o.scheduleId) || {}).name || '' : '')) + '</span>'
                    + '<button type="button" class="ssched-mini-btn danger" data-ss-action="remove-override" aria-label="Remove special day">&times;</button>'
                    + '</div>';
            }).join('');

        var subsHtml = ws.subscriptions.map(function (sub) {
            var status = sub.lastRefreshStatus === 'ok'
                ? ('Updated ' + new Date(sub.lastRefreshAt).toLocaleDateString() + ' · ' + sub.lastEventCount + ' events cached')
                : (sub.lastRefreshStatus === 'failed' ? ('Last refresh failed — cached events still available') : 'Not refreshed yet');
            return '<div class="ssched-sub-row" data-sub="' + esc(sub.id) + '">'
                + '<div class="ssched-sub-main"><strong>' + esc(sub.name) + '</strong>'
                + (sub.url ? '<span class="ssched-sub-url">' + esc(sub.url) + '</span>' : '')
                + '<span class="ssched-sub-status">' + esc(status) + '</span></div>'
                + '<div class="ssched-sub-actions">'
                + '<button type="button" class="ssched-mini-btn" data-ss-action="refresh-sub">Refresh</button>'
                + '<button type="button" class="ssched-mini-btn" data-ss-action="refresh-sub-file">From file…</button>'
                + '<button type="button" class="ssched-mini-btn danger" data-ss-action="remove-sub" aria-label="Remove subscription">&times;</button>'
                + '</div></div>';
        }).join('');

        body.innerHTML = ''
            + '<section class="ssched-section">'
            + '<label class="ssched-enable-row"><input type="checkbox" data-ss-field="enabled"' + (ws.enabled ? ' checked' : '') + '>'
            + '<span><strong>Use a school schedule</strong><br><small>Today, Shape My Day, and reminders become school-aware.</small></span></label>'
            + '<div class="ssched-grid-3">'
            + '<label class="ssched-inline-field"><span>Term name</span><input type="text" data-ss-field="term-name" value="' + esc(ws.term.name) + '" placeholder="Fall semester"></label>'
            + '<label class="ssched-inline-field"><span>Starts</span><input type="date" data-ss-field="term-start" value="' + esc(ws.term.startDate) + '"></label>'
            + '<label class="ssched-inline-field"><span>Ends</span><input type="date" data-ss-field="term-end" value="' + esc(ws.term.endDate) + '"></label>'
            + '</div></section>'

            + '<section class="ssched-section"><h4>Rotation</h4>'
            + '<div class="ssched-grid-3">'
            + '<label class="ssched-inline-field"><span>Type</span><select data-ss-field="rotation-type">'
            + '<option value="weekly"' + (rot.type === 'weekly' ? ' selected' : '') + '>Same every week</option>'
            + '<option value="ab"' + (rot.type === 'ab' ? ' selected' : '') + '>A/B days</option>'
            + '<option value="cycle"' + (rot.type === 'cycle' ? ' selected' : '') + '>Cycle days</option>'
            + '</select></label>'
            + (rot.type === 'cycle'
                ? '<label class="ssched-inline-field"><span>Cycle length</span><input type="number" min="2" max="' + MAX_CYCLE + '" data-ss-field="cycle-length" value="' + rot.cycleLength + '"></label>'
                : '')
            + (rot.type !== 'weekly'
                ? '<label class="ssched-inline-field"><span>Known date</span><input type="date" data-ss-field="anchor-date" value="' + esc(rot.anchorDate) + '"></label>'
                + '<label class="ssched-inline-field"><span>That date was</span><select data-ss-field="anchor-index">'
                + rot.labels.map(function (l, i) { return '<option value="' + i + '"' + (i === rot.anchorIndex ? ' selected' : '') + '>' + esc(l) + ' Day</option>'; }).join('')
                + '</select></label>'
                : '')
            + '</div>'
            + (rot.type !== 'weekly'
                ? '<p class="ssched-hint">Rotation advances on school days only — weekends' + (rot.skipNoSchoolDays ? ' and holidays' : '') + ' don’t consume a cycle day.</p>'
                : '')
            + '</section>'

            + '<section class="ssched-section"><h4>Bell schedules</h4>'
            + (schedulesHtml || '<div class="ssched-empty-line">No bell schedule yet.</div>')
            + '<button type="button" class="ssched-mini-btn" data-ss-action="add-schedule">+ Add bell schedule</button>'
            + '</section>'

            + '<section class="ssched-section"><h4>Day plans</h4>'
            + '<p class="ssched-hint">Map each rotation day to a bell schedule and your classes.</p>'
            + (templatesHtml || '<div class="ssched-empty-line">Configure rotation first.</div>')
            + '</section>'

            + '<section class="ssched-section"><h4>Holidays &amp; special days</h4>'
            + (overridesHtml || '<div class="ssched-empty-line">No special days yet.</div>')
            + '<div class="ssched-add-override">'
            + '<input type="date" id="sschedNewOverrideDate" aria-label="Date">'
            + '<select id="sschedNewOverrideKind" aria-label="Kind">'
            + '<option value="holiday">Holiday / no school</option>'
            + '<option value="special">Special schedule</option>'
            + '<option value="early_dismissal">Early dismissal</option>'
            + '<option value="override_label">Force day label</option>'
            + '</select>'
            + '<input type="text" id="sschedNewOverrideLabel" placeholder="Label (e.g. Spring Break, Pep Rally, B)" aria-label="Label">'
            + '<select id="sschedNewOverrideSchedule" aria-label="Bell schedule for special day">' + scheduleOptions('', true) + '</select>'
            + '<button type="button" class="ssched-mini-btn" data-ss-action="add-override">Add</button>'
            + '</div></section>'

            + '<section class="ssched-section"><h4>Calendar subscriptions</h4>'
            + '<p class="ssched-hint">Track a school calendar (.ics). Sutra keeps the latest successful import cached locally, so everything keeps working offline. Direct URL refresh is often blocked by this app’s strict network policy — “From file” re-import always works.</p>'
            + (subsHtml || '<div class="ssched-empty-line">No subscriptions yet.</div>')
            + '<div class="ssched-add-sub">'
            + '<input type="text" id="sschedNewSubName" placeholder="Name (e.g. District calendar)" aria-label="Subscription name">'
            + '<input type="url" id="sschedNewSubUrl" placeholder="https://…/calendar.ics (optional)" aria-label="Subscription URL">'
            + '<button type="button" class="ssched-mini-btn" data-ss-action="add-sub">Add</button>'
            + '</div></section>'

            + '<section class="ssched-section"><h4>Display</h4>'
            + '<label class="ssched-enable-row"><input type="checkbox" data-ss-field="show-strip"' + (ws.settings.showTodayStrip ? ' checked' : '') + '><span>Show school-day strip on Home</span></label>'
            + '<label class="ssched-enable-row"><input type="checkbox" data-ss-field="class-reminders"' + (ws.settings.classReminders ? ' checked' : '') + '><span>Class reminders (' + ws.settings.classReminderLeadMinutes + ' min before each period)</span></label>'
            + '</section>';
    }

    // Collect free-form field edits into the draft before structural re-renders.
    function syncDraftFromDom() {
        var modal = document.getElementById('schoolScheduleModal');
        if (!modal || !managerDraft) return;
        var ws = managerDraft;
        var q = function (sel) { return modal.querySelector(sel); };
        var enabled = q('[data-ss-field="enabled"]');
        if (enabled) ws.enabled = enabled.checked;
        var termName = q('[data-ss-field="term-name"]');
        if (termName) ws.term.name = termName.value;
        var termStart = q('[data-ss-field="term-start"]');
        if (termStart) ws.term.startDate = termStart.value;
        var termEnd = q('[data-ss-field="term-end"]');
        if (termEnd) ws.term.endDate = termEnd.value;
        var rotType = q('[data-ss-field="rotation-type"]');
        if (rotType) ws.rotation.type = rotType.value;
        var cycleLength = q('[data-ss-field="cycle-length"]');
        if (cycleLength) ws.rotation.cycleLength = Number(cycleLength.value) || 2;
        if (ws.rotation.type === 'ab') { ws.rotation.cycleLength = 2; ws.rotation.labels = ['A', 'B']; }
        var anchorDate = q('[data-ss-field="anchor-date"]');
        if (anchorDate) ws.rotation.anchorDate = anchorDate.value;
        var anchorIndex = q('[data-ss-field="anchor-index"]');
        if (anchorIndex) ws.rotation.anchorIndex = Number(anchorIndex.value) || 0;
        var defaultRadio = modal.querySelector('[data-ss-field="default-schedule"]:checked');
        if (defaultRadio) ws.defaultScheduleId = defaultRadio.value;
        var showStrip = q('[data-ss-field="show-strip"]');
        if (showStrip) ws.settings.showTodayStrip = showStrip.checked;
        var classReminders = q('[data-ss-field="class-reminders"]');
        if (classReminders) ws.settings.classReminders = classReminders.checked;

        modal.querySelectorAll('.ssched-schedule-card').forEach(function (card) {
            var schedule = getScheduleById(ws, card.dataset.schedule);
            if (!schedule) return;
            var nameInput = card.querySelector('[data-ss-field="schedule-name"]');
            if (nameInput) schedule.name = nameInput.value;
            card.querySelectorAll('.ssched-period-row').forEach(function (row) {
                var period = null;
                schedule.periods.forEach(function (p) { if (p.id === row.dataset.period) period = p; });
                if (!period) return;
                var label = row.querySelector('[data-ss-field="period-label"]');
                var start = row.querySelector('[data-ss-field="period-start"]');
                var end = row.querySelector('[data-ss-field="period-end"]');
                if (label) period.label = label.value;
                if (start) period.start = start.value;
                if (end) period.end = end.value;
            });
        });

        modal.querySelectorAll('[data-ss-field="template-schedule"]').forEach(function (sel) {
            var key = sel.dataset.label;
            if (!ws.dayTemplates[key]) ws.dayTemplates[key] = { scheduleId: '', assignments: {} };
            ws.dayTemplates[key].scheduleId = sel.value;
        });
        modal.querySelectorAll('[data-ss-field="assignment"]').forEach(function (sel) {
            var key = sel.dataset.label;
            var pid = sel.dataset.period;
            if (!ws.dayTemplates[key]) ws.dayTemplates[key] = { scheduleId: '', assignments: {} };
            if (sel.value) ws.dayTemplates[key].assignments[pid] = sel.value;
            else delete ws.dayTemplates[key].assignments[pid];
        });
    }

    function handleManagerChange(e) {
        var field = e.target && e.target.dataset ? e.target.dataset.ssField : '';
        if (['rotation-type', 'cycle-length', 'template-schedule', 'anchor-index'].indexOf(field) !== -1) {
            syncDraftFromDom();
            managerDraft = normalizeSchoolSchedule(managerDraft);
            renderManagerBody();
        }
    }

    function handleManagerClick(e) {
        var btn = e.target.closest('[data-ss-action]');
        if (!btn || !managerDraft) return;
        var action = btn.dataset.ssAction;
        syncDraftFromDom();
        var ws = managerDraft;

        if (action === 'add-schedule') {
            ws.schedules.push({
                id: uid('sched'),
                name: ws.schedules.length ? 'Special schedule' : 'Regular',
                periods: [
                    { id: uid('per'), label: 'Period 1', start: '08:00', end: '08:50' },
                    { id: uid('per'), label: 'Period 2', start: '09:00', end: '09:50' }
                ]
            });
            if (!ws.defaultScheduleId) ws.defaultScheduleId = ws.schedules[0].id;
        } else if (action === 'remove-schedule') {
            var cardEl = btn.closest('.ssched-schedule-card');
            var sid = cardEl ? cardEl.dataset.schedule : '';
            ws.schedules = ws.schedules.filter(function (s) { return s.id !== sid; });
            if (ws.defaultScheduleId === sid) ws.defaultScheduleId = ws.schedules.length ? ws.schedules[0].id : '';
        } else if (action === 'add-period') {
            var card = btn.closest('.ssched-schedule-card');
            var schedule = getScheduleById(ws, card ? card.dataset.schedule : '');
            if (schedule) {
                var last = schedule.periods[schedule.periods.length - 1];
                var lastEnd = last ? timeToMinutes(last.end) : null;
                var start = lastEnd !== null ? Math.min(lastEnd + 10, 23 * 60) : 8 * 60;
                schedule.periods.push({
                    id: uid('per'),
                    label: 'Period ' + (schedule.periods.length + 1),
                    start: pad2(Math.floor(start / 60)) + ':' + pad2(start % 60),
                    end: pad2(Math.floor((start + 50) / 60)) + ':' + pad2((start + 50) % 60)
                });
            }
        } else if (action === 'remove-period') {
            var row = btn.closest('.ssched-period-row');
            var sch = getScheduleById(ws, row ? row.dataset.schedule : '');
            if (sch && row) sch.periods = sch.periods.filter(function (p) { return p.id !== row.dataset.period; });
        } else if (action === 'add-override') {
            var date = (document.getElementById('sschedNewOverrideDate') || {}).value || '';
            var kind = (document.getElementById('sschedNewOverrideKind') || {}).value || 'holiday';
            var label = (document.getElementById('sschedNewOverrideLabel') || {}).value || '';
            var schedId = (document.getElementById('sschedNewOverrideSchedule') || {}).value || '';
            if (parseDateKey(date)) {
                ws.overrides.push({ id: uid('ovr'), date: date, kind: kind, label: label, scheduleId: schedId, note: '' });
            }
        } else if (action === 'remove-override') {
            var ovRow = btn.closest('.ssched-override-row');
            if (ovRow) ws.overrides = ws.overrides.filter(function (o) { return o.id !== ovRow.dataset.override; });
        } else if (action === 'add-sub') {
            var name = (document.getElementById('sschedNewSubName') || {}).value || '';
            var url = (document.getElementById('sschedNewSubUrl') || {}).value || '';
            if (name.trim() || url.trim()) {
                ws.subscriptions.push(normalizeSubscription({ name: name, url: url }));
            }
        } else if (action === 'remove-sub') {
            var subRow = btn.closest('.ssched-sub-row');
            if (subRow) {
                if (managerRemovedSubscriptionIds) managerRemovedSubscriptionIds.add(subRow.dataset.sub);
                ws.subscriptions = ws.subscriptions.filter(function (s) { return s.id !== subRow.dataset.sub; });
            }
        } else if (action === 'refresh-sub') {
            var rRow = btn.closest('.ssched-sub-row');
            if (rRow) { refreshSubscriptionFromUrl(rRow.dataset.sub); return; }
        } else if (action === 'refresh-sub-file') {
            var fRow = btn.closest('.ssched-sub-row');
            if (fRow) { refreshSubscriptionFromFile(fRow.dataset.sub); return; }
        } else {
            return;
        }
        managerDraft = normalizeSchoolSchedule(ws);
        renderManagerBody();
    }

    function saveManager() {
        if (!managerDraft) return;
        syncDraftFromDom();
        var ws = normalizeSchoolSchedule(managerDraft);
        // Auto-enable when the user has built a usable schedule.
        setState(ws);
        if (managerRemovedSubscriptionIds) {
            managerRemovedSubscriptionIds.forEach(function (subId) { removeSubscriptionBlocks(subId); });
        }
        closeManagerNow();
        toast(ws.enabled ? 'School schedule saved.' : 'School schedule saved (disabled).');
        try {
            if (global.SutraNotifications && typeof global.SutraNotifications.refresh === 'function') {
                global.SutraNotifications.refresh();
            }
        } catch (e) { /* non-critical */ }
    }

    function toast(message) {
        if (typeof global.showToast === 'function') { global.showToast(message); return; }
        if (global.flowAtelier && typeof global.flowAtelier.showToast === 'function') { global.flowAtelier.showToast(message); return; }
        console.log('[SchoolSchedule]', message);
    }

    // ---- Calendar subscriptions ---------------------------------------------
    function getSubscription(ws, subId) {
        for (var i = 0; i < ws.subscriptions.length; i++) {
            if (ws.subscriptions[i].id === subId) return ws.subscriptions[i];
        }
        return null;
    }

    function applyIcsTextToSubscription(subId, icsText) {
        var bridge = global.sutraIcs;
        var fa = global.flowAtelier;
        if (!bridge || !fa) { toast('Calendar import is not available yet.'); return 0; }
        var events = bridge.parseIcsEvents(icsText) || [];
        var blocks = fa.timeBlocks;
        if (!Array.isArray(blocks)) { toast('Timeline is not ready.'); return 0; }

        var existingByUid = {};
        blocks.forEach(function (b) {
            if (b && b.subscriptionId === subId && b.sourceUid) existingByUid[b.sourceUid] = b;
        });

        var seenUids = {};
        var created = 0;
        var updated = 0;
        events.forEach(function (evt, idx) {
            var summary = String(evt.SUMMARY || '').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim()
                || ('Event ' + (idx + 1));
            var startInfo = bridge.parseIcsDateTimeInfo(evt.DTSTART, evt.DTSTART_PARAMS);
            if (!startInfo || !startInfo.dateKey) return;
            var endInfo = bridge.parseIcsDateTimeInfo(evt.DTEND, evt.DTEND_PARAMS);
            var startTime = startInfo.time || '09:00';
            var startMins = timeToMinutes(startTime) || 9 * 60;
            var endMins = endInfo && endInfo.time ? timeToMinutes(endInfo.time) : null;
            if (endMins === null || endMins <= startMins) endMins = Math.min(startMins + 60, 23 * 60 + 59);
            var sourceUid = subId + '::' + (bridge.buildCalendarSourceUid ? bridge.buildCalendarSourceUid(evt) : (String(evt.UID || '') || ('idx' + idx)));
            seenUids[sourceUid] = true;
            var next = {
                name: summary,
                start: pad2(Math.floor(startMins / 60)) + ':' + pad2(startMins % 60),
                end: pad2(Math.floor(endMins / 60)) + ':' + pad2(endMins % 60),
                category: 'work',
                color: '#4f8cff',
                recurrence: 'none',
                preserveRecurrence: false,
                date: startInfo.dateKey,
                weeklyDays: [],
                notes: null,
                source: 'calendar_ics',
                subscriptionId: subId,
                sourceUid: sourceUid,
                updatedAt: Date.now()
            };
            var existing = existingByUid[sourceUid];
            if (existing) { Object.assign(existing, next); updated += 1; }
            else {
                blocks.push(Object.assign({ id: 'ics_sub_' + Math.random().toString(36).slice(2, 10), createdAt: Date.now() }, next));
                created += 1;
            }
        });

        // Remove blocks that disappeared from this subscription only.
        for (var i = blocks.length - 1; i >= 0; i--) {
            var b = blocks[i];
            if (b && b.subscriptionId === subId && b.sourceUid && !seenUids[b.sourceUid]) blocks.splice(i, 1);
        }

        fa.saveTimeBlocks();
        fa.persistAppData();
        try { fa.renderTimeline(); } catch (e) { /* non-critical */ }
        return created + updated;
    }

    function recordRefreshResult(subId, ok, count, errorMessage) {
        var ws = getState();
        var sub = getSubscription(ws, subId);
        if (!sub) return;
        sub.lastRefreshAt = new Date().toISOString();
        sub.lastRefreshStatus = ok ? 'ok' : 'failed';
        sub.lastRefreshError = ok ? '' : String(errorMessage || 'Refresh failed');
        if (ok) sub.lastEventCount = count;
        setState(ws, { render: false });
        if (managerDraft) { managerDraft = getState(); renderManagerBody(); }
    }

    function refreshSubscriptionFromUrl(subId) {
        var ws = managerDraft || getState();
        var sub = getSubscription(ws, subId);
        if (!sub) return;
        if (!sub.url) { refreshSubscriptionFromFile(subId); return; }
        toast('Refreshing "' + sub.name + '"…');
        // NOTE: Sutra's strict CSP allowlist usually blocks arbitrary calendar
        // hosts. We try anyway (works for allowlisted/local hosts) and fail
        // gracefully — the previously cached events remain untouched.
        fetch(sub.url, { method: 'GET', mode: 'cors' }).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.text();
        }).then(function (text) {
            var count = applyIcsTextToSubscription(subId, text);
            recordRefreshResult(subId, true, count);
            toast('Calendar refreshed — ' + count + ' events cached locally.');
        }).catch(function (err) {
            recordRefreshResult(subId, false, 0, err && err.message);
            toast('Could not reach that calendar (offline or blocked by the privacy policy). Cached events are unchanged — use "From file" to update.');
        });
    }

    function refreshSubscriptionFromFile(subId) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ics,text/calendar';
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var count = applyIcsTextToSubscription(subId, String(reader.result || ''));
                    recordRefreshResult(subId, true, count);
                    toast('Calendar updated from file — ' + count + ' events cached locally.');
                } catch (err) {
                    recordRefreshResult(subId, false, 0, err && err.message);
                    toast('That file could not be imported.');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    function removeSubscriptionBlocks(subId) {
        var fa = global.flowAtelier;
        if (!fa || !Array.isArray(fa.timeBlocks)) return;
        var blocks = fa.timeBlocks;
        var removed = 0;
        for (var i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i] && blocks[i].subscriptionId === subId) { blocks.splice(i, 1); removed += 1; }
        }
        if (removed) { fa.saveTimeBlocks(); fa.persistAppData(); try { fa.renderTimeline(); } catch (e) {} }
    }

    // ---- Notifications bridge (class reminders) -------------------------------
    function getNotifications(opts) {
        var now = opts && opts.now ? new Date(opts.now) : new Date();
        var ws = getState();
        if (!ws.enabled || !ws.settings.classReminders) return [];
        var todayKey = toDateKey(now);
        var info = resolveDayInfo(ws, todayKey);
        if (!info.isSchoolDay) return [];
        var nowMinutes = now.getHours() * 60 + now.getMinutes();
        var lead = ws.settings.classReminderLeadMinutes;
        var out = [];
        info.periods.forEach(function (p) {
            if (p.startMinutes === null) return;
            var minutesUntil = p.startMinutes - nowMinutes;
            if (minutesUntil < -5 || minutesUntil > lead) return;
            var due = new Date(now.getTime());
            due.setHours(Math.floor(p.startMinutes / 60), p.startMinutes % 60, 0, 0);
            out.push({
                key: 'schedule:' + todayKey + ':' + p.id,
                sourceId: p.id,
                source: 'schedule',
                title: (p.courseName || p.label) + ' starts ' + (minutesUntil <= 0 ? 'now' : 'in ' + minutesUntil + ' min'),
                subtitle: info.dayLabel + (p.end ? ' · until ' + fmtTime12(p.end) : ''),
                due: due,
                priority: minutesUntil <= 0 ? 'urgent' : 'important',
                icon: 'fa-school'
            });
        });
        return out;
    }

    // ---- Public API ------------------------------------------------------------
    global.getDefaultSchoolSchedule = getDefaultSchoolSchedule;
    global.normalizeSchoolSchedule = normalizeSchoolSchedule;
    global.SutraSchoolSchedule = {
        VERSION: 1,
        engine: Engine,
        getState: getState,
        setState: setState,
        resolveDayInfo: function (dateKey) { return resolveDayInfo(getState(), dateKey); },
        getBusyWindowsForDate: function (dateKey) { return getBusyWindowsForDate(getState(), dateKey); },
        getStudyWindowsForDate: function (dateKey, options) { return getStudyWindowsForDate(getState(), dateKey, options); },
        getNotifications: getNotifications,
        openManager: openManager,
        hasUnsavedDraft: hasUnsavedManagerDraft,
        requestCloseManager: requestCloseManager,
        renderTodayStrip: renderTodayStrip,
        applyIcsTextToSubscription: applyIcsTextToSubscription
    };

    // ---- Init ------------------------------------------------------------------
    function init() {
        renderTodayStrip();
        global.addEventListener('noteflow:view-changed', function (e) {
            var view = e && e.detail ? e.detail.view : '';
            if (view === 'today') renderTodayStrip();
        });
        // Keep "current period" fresh.
        setInterval(function () {
            var view = document.body && document.body.dataset ? document.body.dataset.view : '';
            if (!view || view === 'today') renderTodayStrip();
        }, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 250); });
    } else {
        setTimeout(init, 250);
    }

}(typeof window !== 'undefined' ? window : globalThis));
