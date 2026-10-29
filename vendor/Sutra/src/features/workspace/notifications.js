/* ==========================================================================
   Sutra Notification Center — local-first, no backend
   ==========================================================================
   Surfaces upcoming deadlines, events, and workspace alerts.
   State (read, dismissed, snoozed, prefs) persists in localStorage.
   Works under file:// and served origins alike.
   Designed for graceful degradation when workspace data is unavailable.
   ========================================================================== */

/* global window, document, SutraSafeStorage */

(function (global) {
    'use strict';

    // ---- Storage key -------------------------------------------------------
    var STORAGE_KEY = 'sutraNotifications:v1';
    var MAX_TOASTS = 4;
    var MAX_DISMISSED_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    // ---- Default preferences -----------------------------------------------
    var DEFAULT_PREFS = {
        enabled: true,
        browserNotificationsEnabled: false,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        dailyDigestEnabled: false,
        missedReplayEnabled: true,
        // Category toggles
        categories: {
            tasks: true,
            homework: true,
            timeline: true,
            apexam: true,
            college: true,
            review: false,
            business: true,
            release: true,
            timedHabit: true,
            milestone: true,
            schedule: true
        },
        // Lead-time thresholds (in hours)
        thresholds: {
            tasks:    [168, 72, 24, 0],     // 7d, 3d, 1d, today
            homework: [168, 72, 24, 0],
            timeline: [24, 1, 0.25],        // 24h, 1h, 15min
            apexam:   [720, 336, 168, 72, 24], // 30d, 14d, 7d, 3d, 1d
            college:  [720, 336, 168, 72, 24, 0],
            business: [168, 72, 24, 0],
            milestone: [72, 24, 0]          // assignment-studio milestones
        },
        // Per-course reminder rules. Each rule: { id, courseId (required,
        // hwCourses:v2 id), source ('' = any category), leadHours: [hours...],
        // mute: bool }. A matching rule overrides the category thresholds for
        // that course's deadline reminders; mute suppresses them entirely.
        rules: []
    };

    var MAX_REMINDER_RULES = 50;
    var MAX_LEAD_TIMES = 8;
    var MAX_LEAD_HOURS = 2160; // 90 days

    var CATEGORY_LABELS = {
        tasks: 'Tasks',
        homework: 'Homework',
        timeline: 'Timeline events',
        apexam: 'AP exams',
        college: 'College deadlines',
        review: 'Review due cards',
        business: 'Projects & work',
        release: 'Release notes',
        timedHabit: 'Timed habits',
        milestone: 'Assignment milestones',
        schedule: 'Class schedule'
    };

    // ---- In-memory state ---------------------------------------------------
    var _state = {
        prefs: null,        // loaded from storage
        dismissed: {},      // notifKey -> dismissedAt timestamp
        snoozed: {},        // notifKey -> snoozeUntil timestamp
        read: {},           // notifKey -> true
        lastDigest: 0,
        lastActiveAt: 0,    // last time this device saw the app open (missed-reminder replay)
        lastWeeklyReviewAt: 0,  // when the weekly review modal last ran (nudge suppression)
        lastWeeklyNudge: 0      // when the Sunday "run your weekly review" nudge last showed
    };
    var _missedKeys = {};            // keys that fired while Sutra was closed (this session)
    var _browserNotifiedKeys = {};   // OS-notification dedupe (in-memory, per session)

    var _notifications = [];    // current derived list
    var _panelOpen = false;
    var _panelReturnFocus = null;
    var _filterMode = 'all';    // 'all' | 'unread'
    var _initialized = false;
    var _checkInterval = null;
    var _startupGraceDone = false;

    // ---- Storage helpers ---------------------------------------------------
    function _loadState() {
        try {
            var raw;
            if (typeof SutraSafeStorage !== 'undefined' && SutraSafeStorage.get) {
                raw = SutraSafeStorage.get(STORAGE_KEY);
            } else {
                raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            }
            if (raw && typeof raw === 'object') {
                _state.prefs = Object.assign({}, DEFAULT_PREFS, raw.prefs || {});
                _state.prefs.categories = Object.assign({}, DEFAULT_PREFS.categories, (_state.prefs.categories || {}));
                _state.prefs.thresholds = Object.assign({}, DEFAULT_PREFS.thresholds, (_state.prefs.thresholds || {}));
                _state.prefs.rules = _sanitizeRules(_state.prefs.rules);
                _state.dismissed = raw.dismissed || {};
                _state.snoozed = raw.snoozed || {};
                _state.read = raw.read || {};
                _state.lastDigest = raw.lastDigest || 0;
                _state.lastActiveAt = raw.lastActiveAt || 0;
                _state.lastWeeklyReviewAt = raw.lastWeeklyReviewAt || 0;
                _state.lastWeeklyNudge = raw.lastWeeklyNudge || 0;
            } else {
                _state.prefs = Object.assign({}, DEFAULT_PREFS);
            }
        } catch (e) {
            _state.prefs = Object.assign({}, DEFAULT_PREFS);
        }
    }

    function _revocationWriteLocked() {
        var wipe = global.SutraRevocationWipe;
        if (!wipe || typeof wipe.readGuard !== 'function') return false;
        try {
            return !!wipe.readGuard();
        } catch (e) {
            if (typeof global.SutraReportError === 'function') global.SutraReportError(e, { where: 'notifications._revocationWriteLocked' }, 'warning');
            return true;
        }
    }

    function _saveState() {
        if (_revocationWriteLocked()) return;
        try {
            var payload = {
                prefs: _state.prefs,
                dismissed: _state.dismissed,
                snoozed: _state.snoozed,
                read: _state.read,
                lastDigest: _state.lastDigest,
                lastActiveAt: _state.lastActiveAt,
                lastWeeklyReviewAt: _state.lastWeeklyReviewAt,
                lastWeeklyNudge: _state.lastWeeklyNudge
            };
            if (typeof SutraSafeStorage !== 'undefined' && SutraSafeStorage.set) {
                SutraSafeStorage.set(STORAGE_KEY, payload);
            } else {
                throw new Error('SutraSafeStorage is unavailable.');
            }
        } catch (e) {
            if (typeof global.SutraReportError === 'function') global.SutraReportError(e, { where: 'notifications._saveState' }, 'warning');
        }
    }

    // ---- Reminder rules ----------------------------------------------------
    function _sanitizeLeadHours(raw) {
        if (!Array.isArray(raw)) return [];
        var seen = {};
        var out = [];
        for (var i = 0; i < raw.length && out.length < MAX_LEAD_TIMES; i++) {
            var n = Number(raw[i]);
            if (!isFinite(n) || n < 0) continue;
            n = Math.min(n, MAX_LEAD_HOURS);
            var k = String(n);
            if (seen[k]) continue;
            seen[k] = true;
            out.push(n);
        }
        out.sort(function (a, b) { return b - a; });
        return out;
    }

    function _sanitizeRules(raw) {
        if (!Array.isArray(raw)) return [];
        var out = [];
        var seenIds = {};
        for (var i = 0; i < raw.length && out.length < MAX_REMINDER_RULES; i++) {
            var r = raw[i];
            if (!r || typeof r !== 'object') continue;
            var courseId = String(r.courseId || '');
            if (!courseId) continue;
            var id = String(r.id || '');
            if (!id || seenIds[id]) id = 'rule_' + Date.now().toString(36) + '_' + i;
            seenIds[id] = true;
            var source = String(r.source || '');
            if (source && !DEFAULT_PREFS.thresholds[source]) source = '';
            var leadHours = _sanitizeLeadHours(r.leadHours);
            var mute = r.mute === true;
            if (!mute && !leadHours.length) continue; // rule does nothing
            out.push({ id: id, courseId: courseId, source: source, leadHours: leadHours, mute: mute });
        }
        return out;
    }

    // First matching rule wins; rules that name a category are more specific
    // than any-category rules for the same course.
    function _resolveReminderRule(item, source, prefs) {
        var rules = prefs.rules;
        if (!Array.isArray(rules) || !rules.length) return null;
        var courseId = String(item.sourceCourseId || '');
        if (!courseId) return null;
        var anyCat = null;
        for (var i = 0; i < rules.length; i++) {
            var r = rules[i];
            if (r.courseId !== courseId) continue;
            if (r.source === source) return r;
            if (!r.source && !anyCat) anyCat = r;
        }
        return anyCat;
    }

    // "7d, 3d, 24h, 30m, 0" -> [168, 72, 24, 0.5, 0]; null when unparseable.
    function _parseLeadTimes(str) {
        var tokens = String(str || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
        if (!tokens.length) return null;
        var hours = [];
        for (var i = 0; i < tokens.length; i++) {
            var m = /^(\d+(?:\.\d+)?)(d|h|m)?$/.exec(tokens[i]);
            if (!m) return null;
            var n = parseFloat(m[1]);
            if (!isFinite(n) || n < 0) return null;
            if (m[2] === 'd') n *= 24;
            else if (m[2] === 'm') n /= 60;
            hours.push(n);
        }
        var clean = _sanitizeLeadHours(hours);
        return clean.length ? clean : null;
    }

    function _leadLabel(h) {
        if (h === 0) return 'on the day';
        if (h < 1) return Math.round(h * 60) + 'm';
        if (h >= 24 && h % 24 === 0) return (h / 24) + 'd';
        return h + 'h';
    }

    function _formatLeadTimes(hours) {
        return (Array.isArray(hours) ? hours : []).map(function (h) {
            return h === 0 ? '0' : _leadLabel(h);
        }).join(', ');
    }

    function _pruneOldDismissed() {
        var cutoff = Date.now() - MAX_DISMISSED_AGE_MS;
        Object.keys(_state.dismissed).forEach(function (k) {
            if (_state.dismissed[k] < cutoff) delete _state.dismissed[k];
        });
    }

    // ---- Priority helpers --------------------------------------------------
    function _getPriority(hoursUntilDue, source) {
        if (hoursUntilDue < 0) return 'overdue';
        if (hoursUntilDue < 1) return 'urgent';
        if (hoursUntilDue < 24) return 'important';
        if (hoursUntilDue < 72) return 'upcoming';
        return 'info';
    }

    function _priorityOrder(p) {
        var map = { overdue: 0, urgent: 1, important: 2, upcoming: 3, info: 4 };
        return map[p] !== undefined ? map[p] : 5;
    }

    function _sourceIcon(source) {
        var icons = {
            task: 'fa-check-square',
            homework: 'fa-book',
            timeline: 'fa-calendar',
            apexam: 'fa-graduation-cap',
            college: 'fa-university',
            review: 'fa-cards-blank',
            business: 'fa-briefcase',
            release: 'fa-sparkles',
            syncBeta: 'fa-rotate',
            timedHabit: 'fa-stopwatch',
            milestone: 'fa-flag-checkered',
            schedule: 'fa-school'
        };
        return icons[source] || 'fa-bell';
    }

    function _deriveReleaseNotifications(now, prefs) {
        if (!prefs.categories.release) return [];
        var api = global.SutraReleaseNotes || {};
        var notes = Array.isArray(api.notes) ? api.notes : [];
        if (!notes.length) return [];
        return notes.reduce(function (acc, note) {
            if (!note || !note.version) return acc;
            var key = 'release:' + String(note.version);
            if (_state.dismissed[key] || _state.read[key]) return acc;
            var sections = note.sections && typeof note.sections === 'object' ? note.sections : {};
            var sectionNames = Object.keys(sections);
            var firstItems = sectionNames.reduce(function (items, section) {
                return items.concat((Array.isArray(sections[section]) ? sections[section] : []).slice(0, 1));
            }, []).slice(0, 2);
            acc.push({
                key: key,
                sourceKey: key,
                source: 'release',
                title: 'Sutra release notes',
                subtitle: (note.version ? String(note.version) + ' - ' : '') + (firstItems.join(' ') || 'See what changed in this version.'),
                due: new Date(now),
                hoursUntil: 0,
                relativeTime: 'new',
                priority: 'info',
                icon: _sourceIcon('release'),
                read: false,
                overdue: false,
                sourceId: String(note.version),
                sourceCourseId: ''
            });
            return acc;
        }, []);
    }

    function _deriveSyncBetaNotifications(now, prefs) {
        if (!prefs.categories.release) return [];
        var api = global.SutraSync;
        if (!api || typeof api.status !== 'function' || typeof api.open !== 'function') return [];
        var status;
        try { status = api.status(); } catch (e) { return []; }
        if (status && status.enabled === true) return [];
        var key = 'sync-beta:2026-08-opt-in';
        if (_state.dismissed[key] || _state.read[key]) return [];
        return [{
            key: key,
            sourceKey: key,
            source: 'syncBeta',
            title: 'Sutra Sync Beta is available',
            subtitle: 'Optional end-to-end encrypted device sync. It is currently off and will not upload anything unless you enable it.',
            due: new Date(now),
            hoursUntil: 0,
            relativeTime: 'optional · currently off',
            priority: 'info',
            icon: _sourceIcon('syncBeta'),
            read: false,
            overdue: false,
            sourceId: '2026-08-opt-in',
            sourceCourseId: ''
        }];
    }

    function _deriveTimedHabitNotifications(now, prefs) {
        if (!prefs.categories.timedHabit) return [];
        try {
            if (!global.SutraTimedHabits || typeof global.SutraTimedHabits.getNotifications !== 'function') return [];
            return (global.SutraTimedHabits.getNotifications({ now: new Date(now) }) || []).map(function (item) {
                var key = String(item.key || item.id || ('timed-habit:' + item.sourceId + ':' + (item.kind || 'notice')));
                if (_state.dismissed[key] || _state.read[key]) return null;
                var due = item.due ? new Date(item.due) : null;
                if ((!due || isNaN(due.getTime())) && item.date) {
                    due = new Date(String(item.date) + 'T' + String(item.time || '09:00'));
                }
                if (!due || isNaN(due.getTime())) due = new Date(now);
                return {
                    key: key,
                    sourceKey: item.sourceId || item.id || key,
                    source: 'timedHabit',
                    title: item.title || 'Timed habit',
                    subtitle: item.subtitle || item.message || '',
                    due: due,
                    hoursUntil: (due.getTime() - now) / 3600000,
                    relativeTime: item.relativeTime || _relativeTime(due),
                    priority: item.priority === 'high' ? 'important' : (item.priority || 'info'),
                    icon: item.icon || _sourceIcon('timedHabit'),
                    read: !!_state.read[key],
                    overdue: item.priority === 'overdue',
                    sourceId: item.sourceId || item.id || '',
                    sourceCourseId: ''
                };
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    function _deriveScheduleNotifications(now, prefs) {
        if (!prefs.categories.schedule) return [];
        try {
            if (!global.SutraSchoolSchedule || typeof global.SutraSchoolSchedule.getNotifications !== 'function') return [];
            return (global.SutraSchoolSchedule.getNotifications({ now: new Date(now) }) || []).map(function (item) {
                var key = String(item.key || ('schedule:' + item.sourceId));
                if (_state.dismissed[key]) return null;
                var snoozeUntil = _state.snoozed[key];
                if (snoozeUntil && now < snoozeUntil) return null;
                var due = item.due ? new Date(item.due) : new Date(now);
                return {
                    key: key,
                    sourceKey: item.sourceId || key,
                    source: 'schedule',
                    title: item.title || 'Class',
                    subtitle: item.subtitle || '',
                    due: due,
                    hoursUntil: (due.getTime() - now) / 3600000,
                    relativeTime: _relativeTime(due),
                    priority: item.priority === 'urgent' ? 'urgent' : 'important',
                    icon: item.icon || _sourceIcon('schedule'),
                    read: !!_state.read[key],
                    overdue: false,
                    sourceId: item.sourceId || '',
                    sourceCourseId: ''
                };
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    // ---- Relative time label -----------------------------------------------
    function _relativeTime(due) {
        var ms = due - Date.now();
        var hours = ms / 3600000;
        if (ms < 0) {
            var agoH = Math.abs(hours);
            if (agoH < 1) return 'just overdue';
            if (agoH < 24) return Math.round(agoH) + 'h overdue';
            return Math.round(agoH / 24) + 'd overdue';
        }
        if (hours < 1) return Math.round(hours * 60) + 'min';
        if (hours < 24) return Math.round(hours) + 'h';
        var days = Math.round(hours / 24);
        if (days === 1) return 'tomorrow';
        if (days < 8) return days + ' days';
        return Math.round(days / 7) + ' weeks';
    }

    // ---- Quiet hours check -------------------------------------------------
    function _inQuietHours() {
        if (!_state.prefs.quietHoursEnabled) return false;
        try {
            var now = new Date();
            var h = now.getHours();
            var m = now.getMinutes();
            var current = h * 60 + m;
            var startParts = (_state.prefs.quietHoursStart || '22:00').split(':');
            var endParts = (_state.prefs.quietHoursEnd || '07:00').split(':');
            var start = parseInt(startParts[0]) * 60 + parseInt(startParts[1] || 0);
            var end = parseInt(endParts[0]) * 60 + parseInt(endParts[1] || 0);
            if (start <= end) return current >= start && current < end;
            return current >= start || current < end;  // overnight
        } catch (e) {
            return false;
        }
    }

    // ---- Derive notifications from workspace data --------------------------
    function _deriveNotifications() {
        var out = [];
        var now = Date.now();
        var prefs = _state.prefs;

        if (!prefs.enabled) return out;

        // Collect deadlines via the existing bridge
        var deadlines = [];
        try {
            if (global.flowAtelier && typeof global.flowAtelier.collectWorkspaceDeadlines === 'function') {
                deadlines = global.flowAtelier.collectWorkspaceDeadlines({ includeBusiness: true }) || [];
            } else if (typeof global.collectWorkspaceDeadlines === 'function') {
                deadlines = global.collectWorkspaceDeadlines({ includeBusiness: true }) || [];
            }
        } catch (e) { /* bridge not ready */ }

        deadlines.forEach(function (item) {
            // Imported external calendar entries are schedule context. They
            // must not become overdue Sutra reminders simply because the file
            // includes historical events.
            if (!item || item.notificationEligible === false) return;
            var source = item.source || 'task';
            if (!prefs.categories[source]) return;

            var dueMs = item.due instanceof Date ? item.due.getTime() : new Date(item.due).getTime();
            if (isNaN(dueMs)) return;

            var hoursUntil = (dueMs - now) / 3600000;
            var rule = _resolveReminderRule(item, source, prefs);
            if (rule && rule.mute) return;
            var thresholds = (rule && rule.leadHours.length)
                ? rule.leadHours
                : (prefs.thresholds[source] || [168, 72, 24, 0]);

            // Show the most-specific notification that applies.
            // Only one notification per item at any given time.
            var matchedThreshold = null;
            for (var i = 0; i < thresholds.length; i++) {
                var thr = thresholds[i];
                if (hoursUntil <= thr + 0.5 || item.overdue) {
                    matchedThreshold = thr;
                    break;
                }
            }
            if (matchedThreshold === null && !item.overdue) return;

            var suffix = item.overdue ? 'overdue' : ('thr-' + String(matchedThreshold));
            var key = item.id + ':' + suffix;

            // Check dismissed / snoozed
            if (_state.dismissed[key]) return;
            var snoozeUntil = _state.snoozed[key];
            if (snoozeUntil && now < snoozeUntil) return;

            var priority = _getPriority(hoursUntil, source);

            out.push({
                key: key,
                sourceKey: item.id,
                source: source,
                title: item.title || 'Upcoming item',
                subtitle: item.subtitle || '',
                due: new Date(dueMs),
                hoursUntil: hoursUntil,
                relativeTime: _relativeTime(new Date(dueMs)),
                priority: priority,
                icon: _sourceIcon(source),
                read: !!_state.read[key],
                overdue: !!item.overdue,
                sourceId: item.sourceId || '',
                sourceCourseId: item.sourceCourseId || ''
            });
        });

        out = out.concat(_deriveSyncBetaNotifications(now, prefs));
        out = out.concat(_deriveReleaseNotifications(now, prefs));
        out = out.concat(_deriveTimedHabitNotifications(now, prefs));
        out = out.concat(_deriveScheduleNotifications(now, prefs));

        // Flag reminders that fired while Sutra was closed ("While you were away").
        out.forEach(function (n) {
            if (_missedKeys[n.key]) n.missedWhileAway = true;
        });

        // Sort: overdue first, then by due date
        out.sort(function (a, b) {
            var pa = _priorityOrder(a.priority);
            var pb = _priorityOrder(b.priority);
            if (pa !== pb) return pa - pb;
            return a.due - b.due;
        });

        return out;
    }

    // ---- Render the panel --------------------------------------------------
    function _getList() {
        return document.getElementById('notifList');
    }

    function _renderPanel() {
        var list = _getList();
        if (!list) return;

        var toShow = _filterMode === 'unread'
            ? _notifications.filter(function (n) { return !n.read; })
            : _notifications;

        if (toShow.length === 0) {
            list.innerHTML = '<div class="notif-empty">'
                + '<div class="notif-empty-icon"><i class="fas fa-bell" aria-hidden="true"></i></div>'
                + '<div class="notif-empty-title">All clear</div>'
                + '<div class="notif-empty-sub">No upcoming deadlines or alerts right now.</div>'
                + '<button class="notif-empty-action" type="button" onclick="if(typeof setActiveView===\'function\') setActiveView(\'today\')">Open Home →</button>'
                + '</div>';
        } else {
            var missed = toShow.filter(function (n) { return n.missedWhileAway && !n.read; });
            var rest = toShow.filter(function (n) { return missed.indexOf(n) === -1; });
            var missedHtml = missed.length
                ? '<div class="notif-group-head"><i class="fas fa-moon" aria-hidden="true"></i> While you were away</div>'
                    + missed.map(_renderRow).join('')
                    + (rest.length ? '<div class="notif-group-head">Up next</div>' : '')
                : '';
            list.innerHTML = missedHtml + rest.map(_renderRow).join('');
        }

        _updateBadge();
        _updateMarkAllBtn();
        _updatePanelCount();
    }

    function _renderRow(n) {
        return '<div class="notif-row' + (n.read ? ' read' : ' unread') + '" '
                    + 'data-key="' + _esc(n.key) + '" '
                    + 'data-source="' + _esc(n.source) + '" '
                    + 'data-source-id="' + _esc(n.sourceId) + '" '
                    + 'role="article" '
                    + 'tabindex="0" '
                    + 'aria-label="' + _esc(n.title) + ', ' + _esc(n.relativeTime) + '">'
                    + '<div class="notif-row-icon priority-' + _esc(n.priority) + '">'
                    + '<i class="fas ' + _esc(n.icon) + '" aria-hidden="true"></i></div>'
                    + '<div class="notif-row-body">'
                    + '<div class="notif-row-title">' + _esc(n.title) + '</div>'
                    + (n.subtitle ? '<div class="notif-row-subtitle">' + _esc(n.subtitle) + '</div>' : '')
                    + '<div class="notif-row-time">' + _esc(n.relativeTime) + '</div>'
                    + '</div>'
                    + '<div class="notif-row-actions">'
                    + '<button class="notif-action-btn" data-action="snooze-menu" data-key="' + _esc(n.key) + '" '
                    + 'title="Snooze" aria-label="Snooze ' + _esc(n.title) + '" aria-haspopup="menu" aria-expanded="false">'
                    + '<i class="fas fa-clock" aria-hidden="true"></i></button>'
                    + '<button class="notif-action-btn" data-action="dismiss" data-key="' + _esc(n.key) + '" '
                    + 'title="Dismiss" aria-label="Dismiss ' + _esc(n.title) + '">'
                    + '<i class="fas fa-times" aria-hidden="true"></i></button>'
                    + '</div>'
                    + '<div class="notif-snooze-menu" data-snooze-menu="' + _esc(n.key) + '" role="menu" hidden>'
                    + '<button type="button" role="menuitem" data-action="snooze" data-hours="1" data-key="' + _esc(n.key) + '">1 hour</button>'
                    + '<button type="button" role="menuitem" data-action="snooze" data-hours="3" data-key="' + _esc(n.key) + '">3 hours</button>'
                    + '<button type="button" role="menuitem" data-action="snooze" data-hours="tomorrow" data-key="' + _esc(n.key) + '">Tomorrow 8 AM</button>'
                    + '</div>'
                    + '</div>';
    }

    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _updateBadge() {
        var bell = document.getElementById('notifBellBtn');
        if (!bell) return;
        var badge = bell.querySelector('.notif-bell-badge');
        if (!badge) return;
        var unread = _notifications.filter(function (n) { return !n.read; }).length;
        badge.textContent = unread > 99 ? '99+' : String(unread || '');
        badge.setAttribute('data-count', String(unread));
        var label = unread > 0
            ? 'Notifications (' + unread + ' unread)'
            : 'Notifications';
        bell.setAttribute('aria-label', label);
    }

    function _updateMarkAllBtn() {
        var btn = document.getElementById('notifMarkAllBtn');
        if (!btn) return;
        var hasUnread = _notifications.some(function (n) { return !n.read; });
        btn.style.display = hasUnread ? '' : 'none';
    }

    function _updatePanelCount() {
        var el = document.getElementById('notifPanelCount');
        if (!el) return;
        var unread = _notifications.filter(function (n) { return !n.read; }).length;
        el.textContent = unread > 0 ? String(unread) : '';
        el.setAttribute('data-count', String(unread));
    }

    // ---- Panel open / close ------------------------------------------------
    function openPanel() {
        var panel = document.getElementById('notifPanel');
        var overlay = document.getElementById('notifOverlay');
        var bell = document.getElementById('notifBellBtn');
        if (!panel) return;

        if (!_panelOpen) {
            var active = document.activeElement;
            _panelReturnFocus = active && active !== document.body ? active : bell;
        }
        _panelOpen = true;
        _renderPanel();
        panel.classList.add('notif-panel--open');
        panel.removeAttribute('hidden');
        panel.setAttribute('aria-hidden', 'false');
        if (document.body) document.body.classList.add('notif-panel-open');
        if (overlay) {
            overlay.classList.add('notif-overlay--visible');
        }
        if (bell) bell.setAttribute('aria-expanded', 'true');

        // Focus first focusable element
        setTimeout(function () {
            var first = panel.querySelector('button:not([disabled])');
            if (first) try { first.focus(); } catch (e) {}
        }, 60);
    }

    function closePanel() {
        var panel = document.getElementById('notifPanel');
        var overlay = document.getElementById('notifOverlay');
        var bell = document.getElementById('notifBellBtn');
        if (!panel) return;

        _panelOpen = false;
        panel.classList.remove('notif-panel--open');
        panel.setAttribute('aria-hidden', 'true');
        if (document.body) document.body.classList.remove('notif-panel-open');
        if (overlay) overlay.classList.remove('notif-overlay--visible');
        if (bell) {
            bell.setAttribute('aria-expanded', 'false');
        }
        // The mobile Today bell proxies the canonical notification control.
        // Restore focus to the actual trigger instead of the hidden desktop bell.
        var returnTarget = _panelReturnFocus && document.contains(_panelReturnFocus)
            ? _panelReturnFocus
            : bell;
        _panelReturnFocus = null;
        setTimeout(function () {
            if (returnTarget && typeof returnTarget.focus === 'function') {
                try { returnTarget.focus(); } catch (e) {}
            }
        }, 60);
    }

    function togglePanel() {
        if (_panelOpen) closePanel();
        else openPanel();
    }

    // ---- Actions -----------------------------------------------------------
    function markRead(key) {
        _state.read[key] = true;
        var notif = _notifications.find(function (n) { return n.key === key; });
        if (notif) notif.read = true;
        _saveState();
        _updateBadge();
        _updateMarkAllBtn();
        _updatePanelCount();
        // Update DOM row
        var row = document.querySelector('.notif-row[data-key="' + key + '"]');
        if (row) { row.classList.remove('unread'); row.classList.add('read'); }
    }

    function markAllRead() {
        _notifications.forEach(function (n) {
            _state.read[n.key] = true;
            n.read = true;
        });
        _saveState();
        _renderPanel();
    }

    function dismiss(key) {
        _state.dismissed[key] = Date.now();
        _notifications = _notifications.filter(function (n) { return n.key !== key; });
        _saveState();
        // Animate removal
        var row = document.querySelector('.notif-row[data-key="' + key + '"]');
        if (row) {
            row.classList.add('notif-row--removing');
            setTimeout(function () {
                _renderPanel();
            }, 220);
        } else {
            _renderPanel();
        }
    }

    function snooze(key, hours) {
        var label;
        if (hours === 'tomorrow') {
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(8, 0, 0, 0);
            _state.snoozed[key] = tomorrow.getTime();
            label = 'until tomorrow 8 AM';
        } else {
            hours = Number(hours) || 1;
            _state.snoozed[key] = Date.now() + hours * 3600000;
            label = 'for ' + hours + ' hour' + (hours > 1 ? 's' : '');
        }
        _notifications = _notifications.filter(function (n) { return n.key !== key; });
        _saveState();
        var row = document.querySelector('.notif-row[data-key="' + key + '"]');
        if (row) {
            row.classList.add('notif-row--removing');
            setTimeout(function () { _renderPanel(); }, 220);
        } else {
            _renderPanel();
        }
        showToast({
            title: 'Snoozed ' + label,
            icon: 'fa-clock',
            duration: 2500
        });
    }

    // ---- Open source item --------------------------------------------------
    function _openSourceItem(source, sourceId) {
        try {
            var fa = global.flowAtelier;
            if (!fa) return;
            var viewMap = {
                task: 'today',
                homework: 'homework',
                timeline: 'timeline',
                apexam: 'apstudy',
                college: 'collegeapp',
                review: 'review',
                business: 'business',
                timedHabit: 'life',
                milestone: 'homework',
                schedule: 'today'
            };
            if (source === 'release') {
                if (global.SutraReleaseNotes && typeof global.SutraReleaseNotes.open === 'function') {
                    global.SutraReleaseNotes.open();
                }
                return;
            }
            if (source === 'syncBeta') {
                if (global.SutraSync && typeof global.SutraSync.open === 'function') {
                    global.SutraSync.open();
                }
                return;
            }
            var view = viewMap[source] || 'today';
            if (fa.setActiveView) fa.setActiveView(view);
        } catch (e) { /* non-critical */ }
    }

    // ---- Toast queue -------------------------------------------------------
    var _toastQueue = [];
    var _toastVisible = [];

    function showToast(opts) {
        opts = opts || {};
        var container = document.getElementById('notifToastContainer');
        if (!container) return;

        var toast = document.createElement('div');
        toast.className = 'notif-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.innerHTML = '<div class="notif-toast-icon"><i class="fas ' + _esc(opts.icon || 'fa-bell') + '" aria-hidden="true"></i></div>'
            + '<div class="notif-toast-body">'
            + '<div class="notif-toast-title">' + _esc(opts.title || '') + '</div>'
            + (opts.subtitle ? '<div class="notif-toast-subtitle">' + _esc(opts.subtitle) + '</div>' : '')
            + '</div>'
            + '<button class="notif-toast-dismiss" aria-label="Dismiss notification">'
            + '<i class="fas fa-times" aria-hidden="true"></i></button>';

        // Remove if stack too large
        while (_toastVisible.length >= MAX_TOASTS) {
            var old = _toastVisible.shift();
            _hideToast(old);
        }

        container.appendChild(toast);
        _toastVisible.push(toast);

        var dismissBtn = toast.querySelector('.notif-toast-dismiss');
        if (dismissBtn) dismissBtn.addEventListener('click', function (e) { e.stopPropagation(); _hideToast(toast); });
        toast.addEventListener('click', function () {
            if (opts.onClick) opts.onClick();
            _hideToast(toast);
        });

        // Animate in
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                toast.classList.add('notif-toast--visible');
            });
        });

        // Auto-dismiss
        var duration = opts.duration || (opts.urgent ? 6000 : 4000);
        setTimeout(function () { _hideToast(toast); }, duration);
    }

    function _hideToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.add('notif-toast--hiding');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            _toastVisible = _toastVisible.filter(function (t) { return t !== toast; });
        }, 200);
    }

    // ---- Refresh notifications ---------------------------------------------
    function refresh() {
        var prev = _notifications;
        _notifications = _deriveNotifications();

        if (_panelOpen) {
            _renderPanel();
        } else {
            _updateBadge();
        }

        // Show toasts for newly-urgent items (after startup grace period)
        if (_startupGraceDone && !_inQuietHours()) {
            _showNewUrgentToasts(prev, _notifications);
        }
    }

    function _showNewUrgentToasts(prev, current) {
        var prevKeys = new Set(prev.map(function (n) { return n.key; }));
        current.forEach(function (n) {
            if (!prevKeys.has(n.key) && (n.priority === 'urgent' || n.priority === 'overdue')) {
                showToast({
                    title: n.title,
                    subtitle: n.relativeTime,
                    icon: n.icon,
                    urgent: true,
                    onClick: function () {
                        markRead(n.key);
                        _openSourceItem(n.source, n.sourceId);
                        openPanel();
                    }
                });
                _sendBrowserNotification(n);
            }
        });
    }

    // ---- OS / browser notifications (only while Sutra is open) ----------------
    function _sendBrowserNotification(n) {
        try {
            if (!_state.prefs.browserNotificationsEnabled) return;
            if (!('Notification' in global) || Notification.permission !== 'granted') return;
            if (_browserNotifiedKeys[n.key]) return;
            _browserNotifiedKeys[n.key] = true;
            var notification = new Notification(n.title, {
                body: (n.subtitle ? n.subtitle + ' · ' : '') + n.relativeTime,
                tag: 'sutra-' + n.key
            });
            notification.onclick = function () {
                try { global.focus(); } catch (e) { /* non-critical */ }
                markRead(n.key);
                _openSourceItem(n.source, n.sourceId);
            };
        } catch (e) { /* notification constructor can throw on some platforms */ }
    }

    // ---- Missed-reminder replay -------------------------------------------------
    // Browsers cannot run Sutra in the background, so reminders that "fired"
    // while the tab was closed are REPLAYED on the next open instead of lost.
    function _computeMissedReplay() {
        if (!_state.prefs.missedReplayEnabled) return;
        var last = Number(_state.lastActiveAt) || 0;
        var now = Date.now();
        if (!last || now - last < 10 * 60 * 1000) return; // closed < 10 min — not "away"
        _notifications = _deriveNotifications();
        var missed = _notifications.filter(function (n) {
            if (n.read || n.source === 'release') return false;
            var dueMs = n.due instanceof Date ? n.due.getTime() : 0;
            return dueMs >= last && dueMs <= now;
        });
        missed.forEach(function (n) { _missedKeys[n.key] = true; });
        if (!missed.length) return;
        setTimeout(function () {
            showToast({
                title: missed.length === 1
                    ? 'While you were away: ' + missed[0].title
                    : missed.length + ' reminders fired while Sutra was closed',
                subtitle: 'Open the bell to review them',
                icon: 'fa-moon',
                duration: 7000,
                onClick: function () { openPanel(); }
            });
        }, 4500);
    }

    // ---- Daily digest --------------------------------------------------------------
    function _maybeShowDailyDigest() {
        try {
            if (!_state.prefs.dailyDigestEnabled || _inQuietHours()) return;
            var today = new Date();
            var lastDigestDay = _state.lastDigest ? new Date(_state.lastDigest).toDateString() : '';
            if (lastDigestDay === today.toDateString()) return;
            var dueToday = _notifications.filter(function (n) {
                return n.due instanceof Date && n.due.toDateString() === today.toDateString() && n.source !== 'release';
            });
            var overdue = _notifications.filter(function (n) { return n.overdue; });
            // Smart nudges from the local intelligence layer (review backlog,
            // unscheduled priorities, weak focus area) — reads only the workspace.
            var nudges = [];
            try {
                var intel = window.sutraIntelligence || window.flowIntelligence;
                var ctx = intel && typeof intel.deriveStudentContext === 'function' ? intel.deriveStudentContext() : null;
                if (ctx) {
                    var rd = (ctx.reviewDebt && (ctx.reviewDebt.overdue || ctx.reviewDebt.due)) || 0;
                    if (rd > 0) nudges.push(rd + ' review card' + (rd === 1 ? '' : 's') + ' to clear');
                    var hp = Array.isArray(ctx.unscheduledHighPriority) ? ctx.unscheduledHighPriority.length : 0;
                    if (hp > 0) nudges.push(hp + ' high-priority item' + (hp === 1 ? '' : 's') + ' unscheduled');
                    var weak = (Array.isArray(ctx.lowConfidenceApSubjects) ? ctx.lowConfidenceApSubjects : [])[0];
                    if (weak && weak.name) nudges.push('focus area: ' + weak.name);
                }
            } catch (e) { /* nudges are best-effort */ }
            if (!dueToday.length && !overdue.length && !nudges.length) return;
            _state.lastDigest = Date.now();
            _saveState();
            var parts = [];
            if (overdue.length) parts.push(overdue.length + ' overdue');
            if (dueToday.length) parts.push(dueToday.length + ' due today');
            if (!parts.length) parts.push('a few things to stay ahead of');
            var previewBits = dueToday.slice(0, 2).map(function (n) { return n.title; });
            var subtitle = previewBits.concat(nudges).slice(0, 3).join(' · ');
            showToast({
                title: 'Daily digest: ' + parts.join(', '),
                subtitle: subtitle,
                icon: 'fa-newspaper',
                duration: 9000,
                onClick: function () { openPanel(); }
            });
        } catch (e) { /* non-critical */ }
    }

    // ---- Weekly review nudge -------------------------------------------------------
    // The weekly review modal exists but nothing invoked it on a cadence. On
    // Sundays (or Monday if Sunday was missed), if the student hasn't run a
    // review in the last 5 days, show one quiet toast that opens it. Same
    // quiet-hours + once-per-day discipline as the daily digest.
    function _maybeShowWeeklyReviewNudge() {
        try {
            if (_inQuietHours()) return;
            var now = new Date();
            var day = now.getDay();
            if (day !== 0 && day !== 1) return;
            var fiveDays = 5 * 24 * 3600 * 1000;
            if (_state.lastWeeklyReviewAt && (now.getTime() - _state.lastWeeklyReviewAt) < fiveDays) return;
            // Monday is a fallback for a MISSED Sunday only — one nudge per
            // weekend. A same-day check alone re-nudged Monday everyone who
            // saw Sunday's toast and chose to ignore it.
            var threeDays = 3 * 24 * 3600 * 1000;
            if (_state.lastWeeklyNudge && (now.getTime() - _state.lastWeeklyNudge) < threeDays) return;
            _state.lastWeeklyNudge = now.getTime();
            _saveState();
            showToast({
                title: 'Time for your weekly review',
                subtitle: 'Your week, grades, and next week — on one screen',
                icon: 'fa-rotate-left',
                duration: 9000,
                onClick: function () {
                    try { global.dispatchEvent(new CustomEvent('sutra:open-weekly-review')); } catch (e) { /* non-critical */ }
                }
            });
        } catch (e) { /* non-critical */ }
    }

    // Called by app.js whenever the weekly review modal actually opens, so the
    // nudge stays quiet for students who already review on their own schedule.
    function markWeeklyReviewDone() {
        _state.lastWeeklyReviewAt = Date.now();
        _saveState();
    }

    // ---- Calendar handoff (.ics with alarms) -----------------------------------------
    // The honest path for "remind me even when the browser is closed": hand the
    // reminders to the device calendar, which CAN alert in the background.
    function exportRemindersToCalendar() {
        var icsEscape = function (v) {
            return String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
        };
        var fmtUtc = function (d) {
            return d.getUTCFullYear()
                + String(d.getUTCMonth() + 1).padStart(2, '0')
                + String(d.getUTCDate()).padStart(2, '0') + 'T'
                + String(d.getUTCHours()).padStart(2, '0')
                + String(d.getUTCMinutes()).padStart(2, '0') + '00Z';
        };
        var now = new Date();
        var horizon = now.getTime() + 45 * 24 * 3600 * 1000;
        var items = _deriveNotifications().filter(function (n) {
            return n.due instanceof Date && !n.overdue && n.source !== 'release' && n.source !== 'schedule'
                && n.due.getTime() <= horizon;
        });
        // One VEVENT per source item (not per threshold) — dedupe on sourceKey.
        var seen = {};
        var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sutra//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Sutra Reminders'];
        var count = 0;
        items.forEach(function (n) {
            if (seen[n.sourceKey]) return;
            seen[n.sourceKey] = true;
            count += 1;
            lines.push('BEGIN:VEVENT');
            lines.push('UID:sutra-reminder-' + n.sourceKey.replace(/[^A-Za-z0-9:_-]/g, '') + '@sutra');
            lines.push('DTSTAMP:' + fmtUtc(now));
            lines.push('DTSTART:' + fmtUtc(n.due));
            lines.push('DTEND:' + fmtUtc(new Date(n.due.getTime() + 15 * 60000)));
            lines.push('SUMMARY:' + icsEscape(n.title));
            if (n.subtitle) lines.push('DESCRIPTION:' + icsEscape(n.subtitle));
            lines.push('BEGIN:VALARM');
            lines.push('ACTION:DISPLAY');
            lines.push('DESCRIPTION:' + icsEscape(n.title));
            lines.push('TRIGGER:-PT30M');
            lines.push('END:VALARM');
            // Second alarm the evening BEFORE (5pm local). A 30-min lead on a
            // 11:59pm deadline is too late to act on — the evening-before ping
            // is the one that actually changes behavior. Absolute trigger so it
            // lands at a sane hour regardless of the due time.
            var eveBefore = new Date(n.due.getTime());
            eveBefore.setDate(eveBefore.getDate() - 1);
            eveBefore.setHours(17, 0, 0, 0);
            if (eveBefore.getTime() > now.getTime() && eveBefore.getTime() < n.due.getTime()) {
                lines.push('BEGIN:VALARM');
                lines.push('ACTION:DISPLAY');
                lines.push('DESCRIPTION:' + icsEscape('Due tomorrow: ' + n.title));
                lines.push('TRIGGER;VALUE=DATE-TIME:' + fmtUtc(eveBefore));
                lines.push('END:VALARM');
            }
            lines.push('END:VEVENT');
        });
        lines.push('END:VCALENDAR');
        if (!count) {
            showToast({ title: 'No upcoming reminders to export', icon: 'fa-calendar', duration: 3000 });
            return 0;
        }
        try {
            var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            var d = new Date();
            link.download = 'sutra_reminders_' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.ics';
            link.click();
            URL.revokeObjectURL(url);
            showToast({ title: count + ' reminders exported', subtitle: 'Import into Google/Apple/Outlook calendar for background alerts', icon: 'fa-calendar-check', duration: 5000 });
        } catch (e) { /* non-critical */ }
        return count;
    }

    // ---- Panel event wiring ------------------------------------------------
    function _wirePanel() {
        var panel = document.getElementById('notifPanel');
        var bell = document.getElementById('notifBellBtn');
        var overlay = document.getElementById('notifOverlay');
        var markAllBtn = document.getElementById('notifMarkAllBtn');
        var closeBtn = document.getElementById('notifCloseBtn');
        var settingsLink = document.getElementById('notifSettingsLink');
        var filterAll = document.getElementById('notifFilterAll');
        var filterUnread = document.getElementById('notifFilterUnread');

        if (bell) {
            bell.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePanel();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', function () { closePanel(); });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function () { closePanel(); });
        }

        if (markAllBtn) {
            markAllBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                markAllRead();
            });
        }

        if (settingsLink) {
            settingsLink.addEventListener('click', function () {
                closePanel();
                try {
                    if (global.flowAtelier && global.flowAtelier.setActiveView) {
                        global.flowAtelier.setActiveView('settings');
                        setTimeout(function () {
                            var navBtn = document.querySelector('[data-settings-nav="notifications"]');
                            if (navBtn) navBtn.click();
                        }, 300);
                    }
                } catch (e) { /* non-critical */ }
            });
        }

        if (filterAll) {
            filterAll.addEventListener('click', function () {
                _filterMode = 'all';
                filterAll.classList.add('active');
                if (filterUnread) filterUnread.classList.remove('active');
                _renderPanel();
            });
        }

        if (filterUnread) {
            filterUnread.addEventListener('click', function () {
                _filterMode = 'unread';
                filterUnread.classList.add('active');
                if (filterAll) filterAll.classList.remove('active');
                _renderPanel();
            });
        }

        // Delegated click on notification rows
        if (panel) {
            panel.addEventListener('click', function (e) {
                var actionBtn = e.target.closest('[data-action]');
                if (actionBtn) {
                    e.stopPropagation();
                    var action = actionBtn.getAttribute('data-action');
                    var key = actionBtn.getAttribute('data-key');
                    if (action === 'dismiss') dismiss(key);
                    else if (action === 'snooze-menu') {
                        var menu = panel.querySelector('[data-snooze-menu="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
                        panel.querySelectorAll('.notif-snooze-menu').forEach(function (m) { if (m !== menu) m.hidden = true; });
                        if (menu) {
                            menu.hidden = !menu.hidden;
                            actionBtn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
                        }
                    } else if (action === 'snooze') {
                        var hoursAttr = actionBtn.getAttribute('data-hours') || '1';
                        snooze(key, hoursAttr === 'tomorrow' ? 'tomorrow' : Number(hoursAttr));
                    }
                    return;
                }

                var row = e.target.closest('.notif-row');
                if (row) {
                    var k = row.getAttribute('data-key');
                    var source = row.getAttribute('data-source');
                    var sourceId = row.getAttribute('data-source-id');
                    if (k) markRead(k);
                    _openSourceItem(source, sourceId);
                    closePanel();
                }
            });

            // Keyboard handler
            panel.addEventListener('keydown', function (e) {
                var keyboardRow = e.target.closest && e.target.closest('.notif-row');
                if (keyboardRow && !e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    keyboardRow.click();
                    return;
                }
                if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
                if (e.key !== 'Tab') return;
                var focusable = Array.prototype.slice.call(panel.querySelectorAll(
                    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )).filter(function (node) {
                    return !node.hidden && node.offsetParent !== null;
                });
                if (!focusable.length) {
                    e.preventDefault();
                    panel.focus();
                    return;
                }
                var first = focusable[0];
                var last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            });
        }

        // Global Escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && _panelOpen) {
                e.preventDefault();
                closePanel();
            }
        });

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!_panelOpen) return;
            var panel2 = document.getElementById('notifPanel');
            var bell2 = document.getElementById('notifBellBtn');
            if (!panel2 || !bell2) return;
            if (!panel2.contains(e.target) && !bell2.contains(e.target)) {
                closePanel();
            }
        });
    }

    // ---- Tab visibility check ----------------------------------------------
    function _onVisibilityChange() {
        if (!document.hidden) refresh();
    }

    // Register a Periodic Background Sync so the service worker can post a daily
    // "open Sutra" reminder even when the app is closed (Chrome/Edge installed-PWA
    // only; a no-op everywhere else). This is the honest local-first path to
    // background reminders — there is no Sutra push server. While the app is open,
    // exact due-item OS notifications already fire via _sendBrowserNotification;
    // the .ics calendar handoff remains the cross-device "remind me when closed".
    function registerBackgroundReminders() {
        try {
            if (!_state.prefs || !_state.prefs.browserNotificationsEnabled) return;
            if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
            navigator.serviceWorker.ready.then(function (reg) {
                if (!reg || !reg.periodicSync) return;
                var doRegister = function () {
                    reg.periodicSync.register('sutra-daily-reminder', { minInterval: 22 * 60 * 60 * 1000 }).catch(function () { /* unsupported / not installed */ });
                };
                if (navigator.permissions && navigator.permissions.query) {
                    navigator.permissions.query({ name: 'periodic-background-sync' })
                        .then(function (status) { if (status.state === 'granted') doRegister(); })
                        .catch(doRegister);
                } else {
                    doRegister();
                }
            }).catch(function () { /* no SW */ });
        } catch (e) { /* unsupported */ }
    }

    // ---- Public: browser notifications -------------------------------------
    function requestBrowserPermission(callback) {
        if (!('Notification' in global)) {
            if (callback) callback('unsupported');
            return;
        }
        if (Notification.permission === 'granted') {
            registerBackgroundReminders();
            if (callback) callback('granted');
            return;
        }
        if (Notification.permission === 'denied') {
            if (callback) callback('denied');
            return;
        }
        Notification.requestPermission().then(function (perm) {
            if (perm === 'granted') registerBackgroundReminders();
            if (callback) callback(perm);
        });
    }

    // ---- Preferences -------------------------------------------------------
    function getPreferences() {
        return Object.assign({}, _state.prefs);
    }

    function updatePreferences(delta) {
        if (!_state.prefs) _state.prefs = Object.assign({}, DEFAULT_PREFS);
        Object.assign(_state.prefs, delta);
        if (delta.categories) {
            _state.prefs.categories = Object.assign({}, DEFAULT_PREFS.categories, _state.prefs.categories, delta.categories);
        }
        if (delta.thresholds) {
            _state.prefs.thresholds = Object.assign({}, DEFAULT_PREFS.thresholds, _state.prefs.thresholds, delta.thresholds);
        }
        if (delta.rules) {
            _state.prefs.rules = _sanitizeRules(delta.rules);
        }
        _saveState();
        if (delta.browserNotificationsEnabled) registerBackgroundReminders();
        refresh();
        _renderNotificationSettingsUI();
    }

    // ---- Settings section UI -----------------------------------------------
    function _renderNotificationSettingsUI() {
        var root = document.getElementById('settings-notifications-dynamic');
        if (!root || !_state.prefs) return;
        var p = _state.prefs;

        root.innerHTML = '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">In-app notifications</span>'
            + '<span class="cc-row-sub">Show upcoming deadlines in the notification panel</span></div>'
            + '<label class="cc-switch" aria-label="Enable in-app notifications">'
            + '<input type="checkbox" id="notifPrefEnabled"' + (p.enabled ? ' checked' : '') + '>'
            + '<div class="cc-switch-track"><div class="cc-switch-thumb"></div></div></label></div>'

            + '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">Quiet hours</span>'
            + '<span class="cc-row-sub">Suppress toasts during these hours</span></div>'
            + '<label class="cc-switch" aria-label="Enable quiet hours">'
            + '<input type="checkbox" id="notifPrefQuiet"' + (p.quietHoursEnabled ? ' checked' : '') + '>'
            + '<div class="cc-switch-track"><div class="cc-switch-thumb"></div></div></label></div>'

            + '<div class="cc-row cc-row--indent" id="notifQuietHoursRow" style="' + (p.quietHoursEnabled ? '' : 'display:none') + '">'
            + '<div class="cc-row-label"><span class="cc-row-title">Quiet from</span></div>'
            + '<div style="display:flex;gap:8px;align-items:center">'
            + '<input type="time" class="modal-input" id="notifQuietStart" value="' + _esc(p.quietHoursStart || '22:00') + '" style="width:110px">'
            + '<span style="color:var(--text-muted);font-size:.8rem">to</span>'
            + '<input type="time" class="modal-input" id="notifQuietEnd" value="' + _esc(p.quietHoursEnd || '07:00') + '" style="width:110px">'
            + '</div></div>'

            + '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">Browser notifications</span>'
            + '<span class="cc-row-sub">Optional — only if you grant permission</span></div>'
            + '<button type="button" class="cc-btn cc-btn-quiet" id="notifBrowserPermBtn" style="font-size:.78rem">'
            + (_getBrowserPermLabel()) + '</button></div>'

            + '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">Replay missed reminders</span>'
            + '<span class="cc-row-sub">When Sutra reopens, show what fired while it was closed</span></div>'
            + '<label class="cc-switch" aria-label="Replay missed reminders">'
            + '<input type="checkbox" id="notifPrefReplay"' + (p.missedReplayEnabled !== false ? ' checked' : '') + '>'
            + '<div class="cc-switch-track"><div class="cc-switch-thumb"></div></div></label></div>'

            + '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">Daily digest</span>'
            + '<span class="cc-row-sub">One morning summary of overdue + due-today items</span></div>'
            + '<label class="cc-switch" aria-label="Daily digest">'
            + '<input type="checkbox" id="notifPrefDigest"' + (p.dailyDigestEnabled ? ' checked' : '') + '>'
            + '<div class="cc-switch-track"><div class="cc-switch-thumb"></div></div></label></div>'

            + '<div class="cc-row">'
            + '<div class="cc-row-label"><span class="cc-row-title">Send reminders to my calendar</span>'
            + '<span class="cc-row-sub">Export upcoming reminders (.ics with alarms) for alerts that work when the browser is closed</span></div>'
            + '<button type="button" class="cc-btn cc-btn-quiet" id="notifExportIcsBtn" style="font-size:.78rem">Export .ics</button></div>'

            + '<div class="cc-row" style="display:block">'
            + '<div class="cc-row-label" style="max-width:none"><span class="cc-row-title">What Sutra can and can’t do</span>'
            + '<span class="cc-row-sub">Sutra is local-first with no server, so reminders fire <strong>while Sutra is open</strong> (toasts, and OS notifications if permitted). '
            + 'Browsers do not let pages run in the background, and OS notifications are unavailable when Sutra runs directly from a file. '
            + 'Anything missed is replayed when you come back, and the calendar export above is the reliable path for closed-browser alerts.</span></div></div>'

            + '<div class="cc-row" style="border-top:1px solid var(--cc-divider);margin-top:8px;padding-top:14px">'
            + '<div class="cc-row-label"><span class="cc-row-title">Categories</span>'
            + '<span class="cc-row-sub">Choose which types of items trigger notifications</span></div></div>'

            + _renderCategoryToggles(p)

            + '<div class="cc-row" style="border-top:1px solid var(--cc-divider);margin-top:8px;padding-top:14px">'
            + '<div class="cc-row-label"><span class="cc-row-title">Reminder timing</span>'
            + '<span class="cc-row-sub">Lead times before due, comma-separated — d days, h hours, m minutes, 0 = on the day (e.g. “7d, 3d, 1d, 0”)</span></div>'
            + '<button type="button" class="cc-btn cc-btn-quiet" id="notifThrResetBtn" style="font-size:.78rem">Reset to defaults</button></div>'

            + _renderThresholdRows(p)

            + '<div class="cc-row" style="border-top:1px solid var(--cc-divider);margin-top:8px;padding-top:14px">'
            + '<div class="cc-row-label"><span class="cc-row-title">Course rules</span>'
            + '<span class="cc-row-sub">Override the timing — or mute reminders — for one class. Rules apply to deadline reminders; category toggles above still win.</span></div></div>'

            + _renderReminderRuleRows(p)
            + _renderReminderRuleForm()

            + '<div class="cc-row" style="border-top:1px solid var(--cc-divider);margin-top:8px;padding-top:14px">'
            + '<div class="cc-row-label"><span class="cc-row-title">Test notification</span>'
            + '<span class="cc-row-sub">Preview a notification toast</span></div>'
            + '<button type="button" class="cc-btn cc-btn-quiet" id="notifTestBtn" style="font-size:.78rem">Send test</button></div>';

        // Wire events
        var enabledEl = document.getElementById('notifPrefEnabled');
        if (enabledEl) enabledEl.addEventListener('change', function () {
            updatePreferences({ enabled: this.checked });
        });

        var quietEl = document.getElementById('notifPrefQuiet');
        var quietRow = document.getElementById('notifQuietHoursRow');
        if (quietEl) quietEl.addEventListener('change', function () {
            updatePreferences({ quietHoursEnabled: this.checked });
            if (quietRow) quietRow.style.display = this.checked ? '' : 'none';
        });

        var quietStart = document.getElementById('notifQuietStart');
        if (quietStart) quietStart.addEventListener('change', function () {
            updatePreferences({ quietHoursStart: this.value });
        });

        var quietEnd = document.getElementById('notifQuietEnd');
        if (quietEnd) quietEnd.addEventListener('change', function () {
            updatePreferences({ quietHoursEnd: this.value });
        });

        var permBtn = document.getElementById('notifBrowserPermBtn');
        if (permBtn) permBtn.addEventListener('click', function () {
            requestBrowserPermission(function (perm) {
                permBtn.textContent = _getBrowserPermLabel(perm);
                if (perm === 'granted') updatePreferences({ browserNotificationsEnabled: true });
            });
        });

        var replayEl = document.getElementById('notifPrefReplay');
        if (replayEl) replayEl.addEventListener('change', function () {
            updatePreferences({ missedReplayEnabled: this.checked });
        });

        var digestEl = document.getElementById('notifPrefDigest');
        if (digestEl) digestEl.addEventListener('change', function () {
            updatePreferences({ dailyDigestEnabled: this.checked });
        });

        var exportIcsBtn = document.getElementById('notifExportIcsBtn');
        if (exportIcsBtn) exportIcsBtn.addEventListener('click', function () {
            exportRemindersToCalendar();
        });

        var testBtn = document.getElementById('notifTestBtn');
        if (testBtn) testBtn.addEventListener('click', function () {
            showToast({
                title: 'Test notification',
                subtitle: 'Sutra notifications are working',
                icon: 'fa-bell',
                duration: 4000
            });
        });

        // Category toggles
        Object.keys(DEFAULT_PREFS.categories).forEach(function (cat) {
            var el = document.getElementById('notifCat-' + cat);
            if (el) el.addEventListener('change', function () {
                var cats = Object.assign({}, _state.prefs.categories);
                cats[cat] = this.checked;
                updatePreferences({ categories: cats });
            });
        });

        // Reminder timing per category
        Object.keys(DEFAULT_PREFS.thresholds).forEach(function (cat) {
            var el = document.getElementById('notifThr-' + cat);
            if (el) el.addEventListener('change', function () {
                var parsed = _parseLeadTimes(this.value);
                if (!parsed) {
                    showToast({
                        title: 'Couldn’t read that timing',
                        subtitle: 'Use comma-separated lead times like “7d, 3d, 1d, 0”',
                        icon: 'fa-bell',
                        duration: 5000
                    });
                    _renderNotificationSettingsUI(); // revert to the saved value
                    return;
                }
                var thr = Object.assign({}, _state.prefs.thresholds);
                thr[cat] = parsed;
                updatePreferences({ thresholds: thr });
            });
        });

        var thrResetBtn = document.getElementById('notifThrResetBtn');
        if (thrResetBtn) thrResetBtn.addEventListener('click', function () {
            var fresh = {};
            Object.keys(DEFAULT_PREFS.thresholds).forEach(function (k) {
                fresh[k] = DEFAULT_PREFS.thresholds[k].slice();
            });
            updatePreferences({ thresholds: fresh });
        });

        // Course rules: remove + add
        root.querySelectorAll('[data-rule-del]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.getAttribute('data-rule-del');
                updatePreferences({
                    rules: (_state.prefs.rules || []).filter(function (r) { return r.id !== id; })
                });
            });
        });

        var ruleAddBtn = document.getElementById('notifRuleAddBtn');
        if (ruleAddBtn) ruleAddBtn.addEventListener('click', function () {
            var courseEl = document.getElementById('notifRuleCourse');
            var sourceEl = document.getElementById('notifRuleSource');
            var timingEl = document.getElementById('notifRuleTiming');
            var muteEl = document.getElementById('notifRuleMute');
            var courseId = courseEl ? courseEl.value : '';
            var mute = !!(muteEl && muteEl.checked);
            var timingRaw = timingEl ? timingEl.value.trim() : '';
            if (!courseId) return;
            var leadHours = [];
            if (timingRaw) {
                var parsed = _parseLeadTimes(timingRaw);
                if (!parsed) {
                    showToast({
                        title: 'Couldn’t read that timing',
                        subtitle: 'Use comma-separated lead times like “7d, 1d, 0” — or check Mute',
                        icon: 'fa-bell',
                        duration: 5000
                    });
                    return;
                }
                leadHours = parsed;
            }
            if (!mute && !leadHours.length) {
                showToast({
                    title: 'Rule needs a timing or Mute',
                    subtitle: 'Enter lead times (e.g. “7d, 1d, 0”) or check Mute',
                    icon: 'fa-bell',
                    duration: 5000
                });
                return;
            }
            var rule = {
                id: 'rule_' + Date.now().toString(36),
                courseId: courseId,
                source: sourceEl ? sourceEl.value : '',
                leadHours: leadHours,
                mute: mute
            };
            // Newest first so it wins over an older same-specificity rule.
            updatePreferences({ rules: [rule].concat(_state.prefs.rules || []) });
        });
    }

    function _getBrowserPermLabel(perm) {
        var p = perm || (('Notification' in global) ? Notification.permission : 'unsupported');
        if (p === 'unsupported') return 'Not supported';
        if (p === 'granted') return 'Enabled';
        if (p === 'denied') return 'Blocked (check browser)';
        return 'Enable browser alerts';
    }

    function _renderCategoryToggles(prefs) {
        var cats = CATEGORY_LABELS;
        return Object.keys(cats).map(function (key) {
            var checked = prefs.categories && prefs.categories[key] !== false;
            return '<div class="cc-row cc-row--indent">'
                + '<div class="cc-row-label"><span class="cc-row-title">' + _esc(cats[key]) + '</span></div>'
                + '<label class="cc-switch" aria-label="' + _esc(cats[key]) + ' notifications">'
                + '<input type="checkbox" id="notifCat-' + _esc(key) + '"' + (checked ? ' checked' : '') + '>'
                + '<div class="cc-switch-track"><div class="cc-switch-thumb"></div></div></label></div>';
        }).join('');
    }

    function _renderThresholdRows(prefs) {
        return Object.keys(DEFAULT_PREFS.thresholds).map(function (key) {
            var hours = (prefs.thresholds && prefs.thresholds[key]) || DEFAULT_PREFS.thresholds[key];
            return '<div class="cc-row cc-row--indent">'
                + '<div class="cc-row-label"><span class="cc-row-title">' + _esc(CATEGORY_LABELS[key] || key) + '</span></div>'
                + '<input type="text" class="modal-input" id="notifThr-' + _esc(key) + '"'
                + ' value="' + _esc(_formatLeadTimes(hours)) + '"'
                + ' aria-label="' + _esc(CATEGORY_LABELS[key] || key) + ' reminder timing"'
                + ' style="width:210px;font-size:.78rem"></div>';
        }).join('');
    }

    function _listCoursesSafe() {
        try {
            if (global.SutraHomework && typeof global.SutraHomework.getCourses === 'function') {
                return (global.SutraHomework.getCourses() || []).filter(function (c) { return c && c.id && c.name; });
            }
        } catch (e) { /* homework module unavailable */ }
        return [];
    }

    function _courseNameById(courseId) {
        var courses = _listCoursesSafe();
        for (var i = 0; i < courses.length; i++) {
            if (String(courses[i].id) === String(courseId)) return String(courses[i].name);
        }
        return 'Removed class';
    }

    function _renderReminderRuleRows(prefs) {
        var rules = Array.isArray(prefs.rules) ? prefs.rules : [];
        if (!rules.length) {
            return '<div class="cc-row cc-row--indent">'
                + '<div class="cc-row-label"><span class="cc-row-sub">No course rules yet.</span></div></div>';
        }
        return rules.map(function (r) {
            var what = r.source ? (CATEGORY_LABELS[r.source] || r.source) : 'All categories';
            var when = r.mute ? 'Muted' : _formatLeadTimes(r.leadHours).replace(/\b0\b/, 'on the day');
            return '<div class="cc-row cc-row--indent">'
                + '<div class="cc-row-label"><span class="cc-row-title">' + _esc(_courseNameById(r.courseId)) + '</span>'
                + '<span class="cc-row-sub">' + _esc(what) + ' — ' + _esc(when) + '</span></div>'
                + '<button type="button" class="cc-btn cc-btn-quiet" data-rule-del="' + _esc(r.id) + '" style="font-size:.78rem">Remove</button></div>';
        }).join('');
    }

    function _renderReminderRuleForm() {
        var courses = _listCoursesSafe();
        if (!courses.length) {
            return '<div class="cc-row cc-row--indent">'
                + '<div class="cc-row-label"><span class="cc-row-sub">Add classes in Homework to create course rules.</span></div></div>';
        }
        var courseOpts = courses.map(function (c) {
            return '<option value="' + _esc(String(c.id)) + '">' + _esc(String(c.name)) + '</option>';
        }).join('');
        var catOpts = '<option value="">All categories</option>' + Object.keys(DEFAULT_PREFS.thresholds).map(function (key) {
            return '<option value="' + _esc(key) + '">' + _esc(CATEGORY_LABELS[key] || key) + '</option>';
        }).join('');
        return '<div class="cc-row cc-row--indent" style="flex-wrap:wrap;gap:8px">'
            + '<select class="modal-input" id="notifRuleCourse" aria-label="Rule class" style="width:150px;font-size:.78rem">' + courseOpts + '</select>'
            + '<select class="modal-input" id="notifRuleSource" aria-label="Rule category" style="width:140px;font-size:.78rem">' + catOpts + '</select>'
            + '<input type="text" class="modal-input" id="notifRuleTiming" placeholder="7d, 1d, 0" aria-label="Rule timing" style="width:110px;font-size:.78rem">'
            + '<label style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--text-muted)">'
            + '<input type="checkbox" id="notifRuleMute">Mute</label>'
            + '<button type="button" class="cc-btn cc-btn-quiet" id="notifRuleAddBtn" style="font-size:.78rem">Add rule</button></div>';
    }

    // ---- Init --------------------------------------------------------------
    function init() {
        if (_initialized) return;
        _initialized = true;

        _loadState();
        _pruneOldDismissed();

        // Replay reminders that fired while Sutra was closed (delayed so the
        // workspace bridges are hydrated before we derive deadlines).
        setTimeout(_computeMissedReplay, 1200);
        _state.lastActiveAt = Date.now();
        _saveState();

        // Initial notification calculation
        refresh();

        // Wire up panel events
        _wirePanel();

        // Render settings UI if already on settings view
        _renderNotificationSettingsUI();

        // Listen for workspace state changes
        global.addEventListener('homework:updated', function () { setTimeout(refresh, 200); });
        global.addEventListener('sutra:school-schedule-updated', function () { setTimeout(refresh, 200); });
        global.addEventListener('sutra:sync-status', function () { setTimeout(refresh, 0); });

        // Tab visibility
        document.addEventListener('visibilitychange', _onVisibilityChange);

        // Check every minute; heartbeat powers missed-reminder replay.
        _checkInterval = setInterval(function () {
            _pruneOldDismissed();
            _state.lastActiveAt = Date.now();
            _saveState();
            refresh();
            _maybeShowDailyDigest();
            _maybeShowWeeklyReviewNudge();
        }, 60000);
        setTimeout(_maybeShowDailyDigest, 6000);
        setTimeout(_maybeShowWeeklyReviewNudge, 9000);

        // Grace period: don't show toasts for the first 4 seconds
        // so startup doesn't flood the user
        setTimeout(function () {
            _startupGraceDone = true;
        }, 4000);

        // Listen for settings view navigation to render settings section
        document.addEventListener('click', function (e) {
            var navBtn = e.target.closest('[data-settings-nav="notifications"]');
            if (navBtn) setTimeout(_renderNotificationSettingsUI, 80);
        });
    }

    // ---- Export for .sutra round-trip -------------------------------------------
    // The main app.js export/import hooks read window.SutraNotifications.exportState()
    // and call window.SutraNotifications.importState(state) during workspace backup.
    function exportState() {
        return {
            prefs: _state.prefs,
            dismissed: _state.dismissed,
            snoozed: _state.snoozed,
            read: _state.read,
            lastDigest: _state.lastDigest,
            lastActiveAt: _state.lastActiveAt,
            lastWeeklyReviewAt: _state.lastWeeklyReviewAt,
            lastWeeklyNudge: _state.lastWeeklyNudge
        };
    }

    function importState(raw) {
        if (!raw || typeof raw !== 'object') return;
        if (raw.prefs) {
            _state.prefs = Object.assign({}, DEFAULT_PREFS, raw.prefs);
            _state.prefs.categories = Object.assign({}, DEFAULT_PREFS.categories, (_state.prefs.categories || {}));
            _state.prefs.thresholds = Object.assign({}, DEFAULT_PREFS.thresholds, (_state.prefs.thresholds || {}));
            _state.prefs.rules = _sanitizeRules(_state.prefs.rules);
        }
        if (raw.dismissed) _state.dismissed = Object.assign({}, raw.dismissed);
        if (raw.snoozed) _state.snoozed = Object.assign({}, raw.snoozed);
        if (raw.read) _state.read = Object.assign({}, raw.read);
        if (Object.prototype.hasOwnProperty.call(raw, 'lastDigest')) _state.lastDigest = raw.lastDigest;
        if (Object.prototype.hasOwnProperty.call(raw, 'lastActiveAt')) _state.lastActiveAt = raw.lastActiveAt;
        if (Object.prototype.hasOwnProperty.call(raw, 'lastWeeklyReviewAt')) _state.lastWeeklyReviewAt = raw.lastWeeklyReviewAt;
        if (Object.prototype.hasOwnProperty.call(raw, 'lastWeeklyNudge')) _state.lastWeeklyNudge = raw.lastWeeklyNudge;
        _saveState();
        refresh();
    }

    // ---- Public API --------------------------------------------------------
    global.SutraNotifications = {
        init: init,
        refresh: refresh,
        getNotifications: function () { return _notifications.slice(); },
        markRead: markRead,
        markAllRead: markAllRead,
        dismiss: dismiss,
        snooze: snooze,
        openPanel: openPanel,
        closePanel: closePanel,
        showToast: showToast,
        requestBrowserPermission: requestBrowserPermission,
        registerBackgroundReminders: registerBackgroundReminders,
        getPreferences: getPreferences,
        updatePreferences: updatePreferences,
        exportState: exportState,
        importState: importState,
        exportRemindersToCalendar: exportRemindersToCalendar,
        markWeeklyReviewDone: markWeeklyReviewDone,
        renderSettingsUI: _renderNotificationSettingsUI
    };

    // ---- Auto-init ---------------------------------------------------------
    function _autoInit() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(init, 200);
            });
        } else {
            setTimeout(init, 200);
        }
    }

    _autoInit();

}(typeof window !== 'undefined' ? window : this));
