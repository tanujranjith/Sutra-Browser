// Sutra Custom Tabs — user-composed tabs built from a palette of widgets.
// The core (app.js) owns persistence via window.SutraCustomTabsBridge
// (get/set travel through persistAppData → autosave, .sutra export, Drive
// sync). This module owns all UI: nav buttons, view sections, the widget
// grid, edit mode, and the add-widget picker.
//
// Hard rules honored here:
// - DOM is built exclusively with createElement/textContent (guardrail: zero
//   unsafe innerHTML sinks in this file).
// - No direct localStorage/sessionStorage access; all state rides the bridge.
// - Nav buttons are real `.view-tab[data-view="custom-<id>"]` elements so the
//   existing setActiveView(), overflow menu, and mobile bottom nav pick them
//   up without special cases. Clicks are handled via document-level
//   delegation so overflow-menu clones keep working.
(function () {
    'use strict';

    var MAX_TABS = 12;
    var MAX_WIDGETS_PER_TAB = 16;
    var TAB_ICON_CYCLE = ['fa-star', 'fa-compass', 'fa-layer-group', 'fa-seedling', 'fa-rocket', 'fa-heart', 'fa-fire', 'fa-cube'];

    var bridge = null;
    var rawBridgeSetTabs = null;
    var initialized = false;
    var editingTabs = {}; // tabId -> bool (session-only edit mode)
    var scratchpadTimers = {};
    // Live tick intervals for clock / stopwatch widgets, keyed "tabId:widgetId".
    // Cleared per-widget on re-render and wholesale on view change so hidden or
    // torn-down widgets never leak intervals.
    var liveTimers = {};

    // HTML widgets are intentionally much smaller than HTML Pages. This keeps
    // a dashboard card responsive and prevents a pasted page from becoming a
    // stealth second application inside a custom tab.
    var MAX_HTML_WIDGET_SOURCE_BYTES = 512 * 1024;
    var MAX_HTML_WIDGET_SOURCE_CHARS = 500000;
    var HTML_WIDGET_LOCAL_MODE = 'active-local';
    var HTML_WIDGET_NETWORK_MODE = 'network-embeds';

    var STICKY_COLORS = ['#ffd97d', '#a0e7a0', '#9ad0f0', '#f5a3c7', '#c9b6f5', '#ffb38a'];

    var BUILTIN_QUOTES = [
        { text: 'The secret of getting ahead is getting started.', by: 'Mark Twain' },
        { text: 'Discipline is choosing between what you want now and what you want most.', by: 'Abraham Lincoln' },
        { text: 'It always seems impossible until it’s done.', by: 'Nelson Mandela' },
        { text: 'Success is the sum of small efforts repeated day in and day out.', by: 'Robert Collier' },
        { text: 'Don’t watch the clock; do what it does. Keep going.', by: 'Sam Levenson' },
        { text: 'You don’t have to be great to start, but you have to start to be great.', by: 'Zig Ziglar' },
        { text: 'Little by little, one travels far.', by: 'J.R.R. Tolkien' },
        { text: 'The expert in anything was once a beginner.', by: 'Helen Hayes' },
        { text: 'Focus on being productive instead of busy.', by: 'Tim Ferriss' },
        { text: 'Study while others are sleeping; work while others are loafing.', by: 'William A. Ward' }
    ];

    // ---------- tiny DOM helpers (createElement/textContent only) ----------

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function btn(className, label, onClick, opts) {
        opts = opts || {};
        var b = el('button', className);
        b.type = 'button';
        if (opts.icon) b.appendChild(faIcon(opts.icon));
        if (label) b.appendChild(document.createTextNode((opts.icon ? ' ' : '') + label));
        if (opts.title) { b.title = opts.title; b.setAttribute('aria-label', opts.title); }
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function faIcon(name) {
        var i = el('i', 'fas ' + name);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }

    function clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
    }

    function normalizeHtmlWidgetConfig(raw) {
        var config = raw && typeof raw === 'object' ? raw : {};
        var source = typeof config.source === 'string'
            ? config.source
            : (typeof config.html === 'string' ? config.html : '');
        return {
            source: source,
            mode: config.mode === HTML_WIDGET_NETWORK_MODE ? HTML_WIDGET_NETWORK_MODE : HTML_WIDGET_LOCAL_MODE
        };
    }

    function htmlSourceByteLength(source) {
        try { return new Blob([String(source || '')]).size; } catch (e) { return String(source || '').length; }
    }

    function normalizeCustomTabsForFeature(tabs) {
        if (!Array.isArray(tabs)) return [];
        return tabs.map(function (tab) {
            if (!tab || !Array.isArray(tab.widgets)) return tab;
            var changed = false;
            var widgets = tab.widgets.map(function (widget) {
                if (!widget || widget.type !== 'html') return widget;
                var config = normalizeHtmlWidgetConfig(widget.config);
                var previous = widget.config && typeof widget.config === 'object' ? widget.config : {};
                if (previous.source !== config.source || previous.html !== undefined || previous.mode !== config.mode) changed = true;
                return Object.assign({}, widget, { config: config });
            });
            return changed ? Object.assign({}, tab, { widgets: widgets }) : tab;
        });
    }

    function makeId(prefix) {
        if (typeof window.generateId === 'function') {
            try { return prefix + '-' + window.generateId(); } catch (e) { /* fall through */ }
        }
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    // ---------- live tick timers (clock / stopwatch) ----------

    function timerKey(tabId, widgetId) { return tabId + ':' + widgetId; }

    function clearTimer(key) {
        if (liveTimers[key]) { clearInterval(liveTimers[key]); delete liveTimers[key]; }
    }

    function clearTimersForTab(tabId) {
        var prefix = tabId + ':';
        Object.keys(liveTimers).forEach(function (key) {
            if (key.indexOf(prefix) === 0) clearTimer(key);
        });
    }

    function clearAllTimers() {
        Object.keys(liveTimers).forEach(clearTimer);
    }

    function startTimer(tabId, widgetId, fn, ms) {
        var key = timerKey(tabId, widgetId);
        clearTimer(key);
        try { fn(); } catch (e) { /* non-critical */ }
        liveTimers[key] = setInterval(function () {
            try { fn(); } catch (e) { clearTimer(key); }
        }, ms);
    }

    // ---------- safe calculator evaluator (no eval / Function) ----------
    // Tokenizes digits, . and + - * / ( ) and evaluates with a shunting-yard
    // pass. Returns a number or null; never executes arbitrary code.

    function evalExpression(expr) {
        var tokens = String(expr).match(/(\d+\.?\d*|\.\d+|[+\-*/()])/g);
        if (!tokens) return null;
        var prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
        var output = [];
        var ops = [];
        var prevType = 'start';
        for (var i = 0; i < tokens.length; i += 1) {
            var t = tokens[i];
            if (/^(\d|\.)/.test(t)) {
                var n = Number(t);
                if (!isFinite(n)) return null;
                output.push(n);
                prevType = 'num';
            } else if (t === '(') {
                ops.push(t);
                prevType = 'op';
            } else if (t === ')') {
                while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
                if (!ops.length) return null;
                ops.pop();
                prevType = 'num';
            } else {
                // Unary minus: treat leading/after-operator '-' as 0 - x
                if (t === '-' && (prevType === 'start' || prevType === 'op')) output.push(0);
                while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) {
                    output.push(ops.pop());
                }
                ops.push(t);
                prevType = 'op';
            }
        }
        while (ops.length) {
            var op = ops.pop();
            if (op === '(') return null;
            output.push(op);
        }
        var stack = [];
        for (var j = 0; j < output.length; j += 1) {
            var tok = output[j];
            if (typeof tok === 'number') { stack.push(tok); continue; }
            var b = stack.pop();
            var a = stack.pop();
            if (a === undefined || b === undefined) return null;
            if (tok === '+') stack.push(a + b);
            else if (tok === '-') stack.push(a - b);
            else if (tok === '*') stack.push(a * b);
            else if (tok === '/') stack.push(b === 0 ? NaN : a / b);
        }
        if (stack.length !== 1) return null;
        var result = stack[0];
        return isFinite(result) ? result : null;
    }

    // ---------- dialogs (reuse the app's promise-based dialogs, degrade to native) ----------

    function promptText(options) {
        if (typeof window.showCustomPromptDialog === 'function') {
            try {
                var r = window.showCustomPromptDialog(options || {});
                if (r && typeof r.then === 'function') return r;
            } catch (e) { /* fall through */ }
        }
        var v = window.prompt((options && options.title) || 'Enter value', (options && options.defaultValue) || '');
        return Promise.resolve(v);
    }

    function confirmDialog(options) {
        if (typeof window.showCustomConfirmDialog === 'function') {
            try {
                var r = window.showCustomConfirmDialog(options || {});
                if (r && typeof r.then === 'function') return r;
            } catch (e) { /* fall through */ }
        }
        return Promise.resolve(window.confirm((options && options.message) || 'Are you sure?'));
    }

    // ---------- state via the core bridge ----------

    function getTabs() {
        try {
            var tabs = bridge && typeof bridge.getTabs === 'function' ? bridge.getTabs() : [];
            return normalizeCustomTabsForFeature(tabs);
        } catch (e) { return []; }
    }

    function saveTabs(nextTabs, opts) {
        opts = opts || {};
        try { bridge.setTabs(normalizeCustomTabsForFeature(nextTabs)); } catch (e) {
            console.warn('SutraCustomTabs: save failed', e);
            return;
        }
        if (opts.rerender !== false) rebuild();
    }

    function mutateTab(tabId, mutate, opts) {
        var tabs = clone(getTabs()) || [];
        var tab = null;
        for (var i = 0; i < tabs.length; i += 1) {
            if (tabs[i] && tabs[i].id === tabId) { tab = tabs[i]; break; }
        }
        if (!tab) return;
        mutate(tab, tabs);
        saveTabs(tabs, opts);
    }

    function findWidget(tab, widgetId) {
        var list = Array.isArray(tab.widgets) ? tab.widgets : [];
        for (var i = 0; i < list.length; i += 1) {
            if (list[i] && list[i].id === widgetId) return list[i];
        }
        return null;
    }

    // ---------- date helpers ----------

    function startOfDay(d) {
        var c = new Date(d.getTime());
        c.setHours(0, 0, 0, 0);
        return c;
    }

    function dayDiff(due, now) {
        return Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
    }

    function dueLabel(due, now) {
        if (!due) return 'No date';
        var diff = dayDiff(due, now);
        if (diff < 0) return Math.abs(diff) === 1 ? 'Overdue by 1 day' : 'Overdue by ' + Math.abs(diff) + ' days';
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff <= 13) return 'In ' + diff + ' days';
        return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function dueStatusKey(due, now) {
        if (!due) return 'undated';
        var diff = dayDiff(due, now);
        if (diff < 0) return 'overdue';
        if (diff === 0) return 'today';
        if (diff === 1) return 'tomorrow';
        return 'later';
    }

    // ---------- deadline data (shared universe via the core collector) ----------

    function getDeadlines() {
        try {
            var items = bridge && typeof bridge.getDeadlines === 'function' ? bridge.getDeadlines() : [];
            return Array.isArray(items) ? items : [];
        } catch (e) { return []; }
    }

    function sortByDue(items) {
        return items.slice().sort(function (a, b) {
            var ad = a && a.due instanceof Date ? a.due.getTime() : Infinity;
            var bd = b && b.due instanceof Date ? b.due.getTime() : Infinity;
            return ad - bd;
        });
    }

    // ---------- widget registry ----------

    var CATEGORIES = [
        { key: 'planning', label: 'Planning' },
        { key: 'academics', label: 'Academics' },
        { key: 'focus', label: 'Focus & Habits' },
        { key: 'notes', label: 'Notes' },
        { key: 'time', label: 'Time' },
        { key: 'tools', label: 'Tools' },
        { key: 'wellness', label: 'Wellness' },
        { key: 'reading', label: 'Reading & Review' },
        { key: 'overview', label: 'Overview & Trends' },
        { key: 'mini_os', label: 'College · Life · Business' },
        { key: 'connections', label: 'Connections' },
        { key: 'import_today', label: 'Today Page' },
        { key: 'import_academics', label: 'Academics Imports' },
        { key: 'import_calendar', label: 'Calendar / Timeline Imports' },
        { key: 'import_notes', label: 'Notes Imports' },
        { key: 'import_focus', label: 'Focus / Habits Imports' },
        { key: 'import_tasks', label: 'Workspace / Tasks Imports' }
    ];

    var WIDGET_TYPES = {
        // --- Planning ---
        nextup: {
            label: 'Next Up', icon: 'fa-bolt', cat: 'planning',
            desc: 'Your single most urgent item across everything.',
            render: renderNextUpWidget
        },
        deadlines: {
            label: 'Upcoming Deadlines', icon: 'fa-bell', cat: 'planning',
            desc: 'The next few things due, in order.',
            render: renderDeadlinesWidget
        },
        thisweek: {
            label: 'This Week', icon: 'fa-calendar-week', cat: 'planning',
            desc: 'Everything due in the next 7 days, by day.',
            render: renderThisWeekWidget
        },
        overdue: {
            label: 'Overdue', icon: 'fa-triangle-exclamation', cat: 'planning',
            desc: 'Only the things that are already late.',
            render: renderOverdueWidget
        },
        tasks: {
            label: 'Task Summary', icon: 'fa-list-ul', cat: 'planning',
            desc: 'Open tasks and how many you finished today.',
            render: renderTasksWidget
        },
        checklist: {
            label: 'Checklist', icon: 'fa-list-check', cat: 'planning',
            desc: 'A quick list that lives in this tab.',
            render: renderChecklistWidget
        },
        // --- Academics ---
        courses: {
            label: 'Course Grades', icon: 'fa-graduation-cap', cat: 'academics',
            desc: 'Your classes with current grades.',
            render: renderCoursesWidget
        },
        review: {
            label: 'Review Due', icon: 'fa-layer-group', cat: 'academics',
            desc: 'Flashcards due and reviewed this week.',
            render: renderReviewWidget
        },
        study: {
            label: 'Study Snapshot', icon: 'fa-book-open', cat: 'academics',
            desc: 'Subjects, next exam, and weak areas.',
            render: renderStudyWidget
        },
        // --- Focus & Habits ---
        focus: {
            label: 'Focus Timer', icon: 'fa-stopwatch', cat: 'focus',
            desc: 'Start a focus session in one click.',
            render: renderFocusWidget
        },
        focusstats: {
            label: 'Focus Stats', icon: 'fa-chart-column', cat: 'focus',
            desc: 'Minutes focused over the last 7 days.',
            render: renderFocusStatsWidget
        },
        habits: {
            label: 'Habits', icon: 'fa-circle-check', cat: 'focus',
            desc: "Today's habits with one-tap check-off.",
            render: renderHabitsWidget
        },
        streak: {
            label: 'Streak', icon: 'fa-fire', cat: 'focus',
            desc: 'Your current and best day streak.',
            render: renderStreakWidget
        },
        counter: {
            label: 'Tally Counter', icon: 'fa-plus-minus', cat: 'focus',
            desc: 'Count anything — water, pages, reps.',
            render: renderCounterWidget,
            setup: setupCounterWidget
        },
        progress: {
            label: 'Progress Goal', icon: 'fa-bullseye', cat: 'focus',
            desc: 'A progress bar toward a target you set.',
            render: renderProgressWidget,
            setup: setupProgressWidget
        },
        // --- Notes ---
        notes: {
            label: 'Recent Notes', icon: 'fa-file-lines', cat: 'notes',
            desc: 'Jump back into your latest notes.',
            render: renderNotesWidget
        },
        bookmarks: {
            label: 'Bookmarked Notes', icon: 'fa-bookmark', cat: 'notes',
            desc: 'Pin specific notes to this tab.',
            render: renderBookmarksWidget
        },
        scratchpad: {
            label: 'Scratchpad', icon: 'fa-pen-nib', cat: 'notes',
            desc: 'Free-form text; saves as you type.',
            render: renderScratchpadWidget
        },
        sticky: {
            label: 'Sticky Note', icon: 'fa-note-sticky', cat: 'notes',
            desc: 'A colored sticky note you can recolor.',
            render: renderStickyWidget
        },
        // --- Time ---
        clock: {
            label: 'Clock', icon: 'fa-clock', cat: 'time',
            desc: 'Live time and today’s date.',
            render: renderClockWidget
        },
        countdown: {
            label: 'Countdown', icon: 'fa-hourglass-half', cat: 'time',
            desc: 'Days until a date you choose.',
            render: renderCountdownWidget,
            setup: setupCountdownWidget
        },
        dayssince: {
            label: 'Days Since', icon: 'fa-calendar-day', cat: 'time',
            desc: 'Count up from a date that matters.',
            render: renderDaysSinceWidget,
            setup: setupDaysSinceWidget
        },
        stopwatch: {
            label: 'Stopwatch', icon: 'fa-stopwatch-20', cat: 'time',
            desc: 'A simple start/stop/reset stopwatch.',
            render: renderStopwatchWidget
        },
        // --- Tools ---
        calculator: {
            label: 'Calculator', icon: 'fa-calculator', cat: 'tools',
            desc: 'A basic calculator, right on your tab.',
            render: renderCalculatorWidget
        },
        links: {
            label: 'Quick Links', icon: 'fa-link', cat: 'tools',
            desc: 'Shortcuts to sites you use a lot.',
            render: renderLinksWidget
        },
        html: {
            label: 'Custom HTML', icon: 'fa-code', cat: 'tools',
            desc: 'Build a local HTML card, with optional approved remote embeds.',
            render: renderHtmlWidget,
            setup: setupHtmlWidget
        },
        quote: {
            label: 'Motivation', icon: 'fa-quote-left', cat: 'tools',
            desc: 'A rotating motivational quote.',
            render: renderQuoteWidget
        },
        heading: {
            label: 'Section Heading', icon: 'fa-heading', cat: 'tools',
            desc: 'A label to organize your widgets.',
            render: renderHeadingWidget,
            setup: setupHeadingWidget,
            fullWidth: true
        }
    };

    var IMPORTED_WIDGET_SPECS = [
        ['imp_today_brief', 'Daily Brief', 'fa-newspaper', 'import_today', 'Compact Today overview.'],
        ['imp_momentum_heatmap', 'Momentum Heatmap', 'fa-border-all', 'import_today', '30-day consistency heat map.'],
        ['imp_today_schedule', 'Today Schedule Snapshot', 'fa-calendar-day', 'import_today', 'Current and next blocks.'],
        ['imp_priority_queue', 'Priority Queue', 'fa-arrow-up-wide-short', 'import_today', 'Top tasks to do now.'],
        ['imp_review_card', 'Review Card', 'fa-layer-group', 'import_today', 'Today review status.'],
        ['imp_tracker_summary', 'Tracker Summary', 'fa-square-check', 'import_today', 'Habit and task progress.'],
        ['imp_student_hub', 'Student Hub Summary', 'fa-school', 'import_today', 'Readiness summary.'],
        ['imp_upcoming_radar', 'Upcoming Radar', 'fa-satellite-dish', 'import_today', 'What is coming up.'],
        ['imp_attention_cards', 'Attention Cards', 'fa-bullseye', 'import_today', 'Assignments, tasks, and calendar.'],
        ['imp_course_progress', 'Course Progress', 'fa-chart-simple', 'import_academics', 'Course status and grades.'],
        ['imp_grade_whatif', 'Grade What-If', 'fa-scale-balanced', 'import_academics', 'Grade projection sample.'],
        ['imp_gpa_projection', 'GPA Projection', 'fa-chart-line', 'import_academics', 'Projected GPA summary.'],
        ['imp_assignment_milestones', 'Assignment Milestones', 'fa-diagram-project', 'import_academics', 'Large assignment steps.'],
        ['imp_exam_countdown', 'Exam Countdown Ring', 'fa-circle-notch', 'import_academics', 'Next exam countdown.'],
        ['imp_weak_topics', 'Weak Topics', 'fa-triangle-exclamation', 'import_academics', 'Flagged weak areas.'],
        ['imp_ap_study_snapshot', 'AP Study Snapshot', 'fa-book-open-reader', 'import_academics', 'AP study status.'],
        ['imp_review_load', 'Review Load', 'fa-boxes-stacked', 'import_academics', 'Review queue depth.'],
        ['imp_current_block', 'Current Block', 'fa-location-dot', 'import_calendar', 'What you are in now.'],
        ['imp_next_block', 'Next Block', 'fa-forward-step', 'import_calendar', 'What starts next.'],
        ['imp_free_slots', 'Free Slot Finder', 'fa-magnifying-glass', 'import_calendar', 'Open time today.'],
        ['imp_day_strip', 'Day Strip', 'fa-timeline', 'import_calendar', 'Compact day timeline.'],
        ['imp_week_strip', 'Week Strip', 'fa-calendar-week', 'import_calendar', 'Compact week load.'],
        ['imp_event_density', 'Event Density', 'fa-chart-area', 'import_calendar', 'How packed your week is.'],
        ['imp_recent_notes_stack', 'Recent Notes Stack', 'fa-note-sticky', 'import_notes', 'Latest notes stack.'],
        ['imp_pinned_notes_board', 'Pinned Notes Board', 'fa-thumbtack', 'import_notes', 'Selected notes board.'],
        ['imp_linked_notes', 'Linked Notes', 'fa-link', 'import_notes', 'Notes connected to work.'],
        ['imp_random_note', 'Random Note', 'fa-shuffle', 'import_notes', 'Resurface an old note.'],
        ['imp_note_inbox', 'Note Inbox', 'fa-inbox', 'import_notes', 'Quick capture and triage.'],
        ['imp_habit_heatmap', 'Habit Heatmap', 'fa-table-cells', 'import_focus', 'Habit consistency grid.'],
        ['imp_streak_ribbon', 'Streak Ribbon', 'fa-fire-flame-curved', 'import_focus', 'Current and best streak.'],
        ['imp_pomodoro', 'Pomodoro', 'fa-hourglass-start', 'import_focus', 'Fixed 25/5 focus cycle.'],
        ['imp_session_log', 'Session Log', 'fa-clock-rotate-left', 'import_focus', 'Recent focus sessions.'],
        ['imp_overdue_recovery', 'Overdue Recovery', 'fa-life-ring', 'import_tasks', 'Recovery-first overdue list.'],
        ['imp_task_burndown', 'Task Burndown', 'fa-chart-column', 'import_tasks', 'Remaining work over time.'],
        ['imp_task_load', 'Task Load', 'fa-weight-hanging', 'import_tasks', 'Open task volume.'],
        ['imp_completion_trend', 'Completion Trend', 'fa-arrow-trend-up', 'import_tasks', 'Recent completion trend.']
    ];

    IMPORTED_WIDGET_SPECS.forEach(function (spec) {
        WIDGET_TYPES[spec[0]] = {
            label: spec[1],
            icon: spec[2],
            cat: spec[3],
            desc: spec[4],
            render: renderImportedWidget
        };
    });

    // Data-driven dashboard widgets — same declarative renderer as the imported
    // widgets (hero/stats/progress/list/bars via the core bridge), grouped into
    // their own scannable categories.
    var DASH_WIDGET_SPECS = [
        ['dash_semester', 'Semester Progress', 'fa-graduation-cap', 'overview', 'How far through the term you are.'],
        ['dash_month_compare', 'This Month vs Last', 'fa-not-equal', 'overview', 'Tasks and focus, month over month.'],
        ['dash_weekly_recap', 'Weekly Recap', 'fa-calendar-check', 'overview', 'Your week at a glance.'],
        ['dash_college_apps', 'Application Tracker', 'fa-building-columns', 'mini_os', 'College apps and deadlines.'],
        ['dash_expenses', 'Expense Tally', 'fa-wallet', 'mini_os', 'Spending vs budget this month.'],
        ['dash_projects', 'Project Pipeline', 'fa-diagram-project', 'mini_os', 'Business projects and task flow.'],
        ['dash_lms_sync', 'Sync Status', 'fa-rotate', 'connections', 'Last Canvas capture and counts.'],
        ['dash_recent_grades', 'Latest Grades', 'fa-clipboard-check', 'connections', 'Most recent graded scores.']
    ];

    DASH_WIDGET_SPECS.forEach(function (spec) {
        WIDGET_TYPES[spec[0]] = {
            label: spec[1],
            icon: spec[2],
            cat: spec[3],
            desc: spec[4],
            render: renderImportedWidget
        };
    });

    function emptyMsg(text) {
        return el('p', 'ctab-empty-msg', text);
    }

    function renderNextUpWidget(body) {
        var items = getDeadlines();
        var now = new Date();
        var pick = null;
        try {
            if (window.SutraTodayCenter && typeof window.SutraTodayCenter.getNextPriorityItem === 'function') {
                pick = window.SutraTodayCenter.getNextPriorityItem(items, { now: now });
            }
        } catch (e) { pick = null; }
        var item = pick && pick.item ? pick.item : (sortByDue(items)[0] || null);
        if (!item) {
            body.appendChild(emptyMsg('Nothing urgent — you’re clear.'));
            return;
        }
        var status = dueStatusKey(item.due instanceof Date ? item.due : null, now);
        var chip = el('span', 'ctab-due-chip is-' + status, dueLabel(item.due instanceof Date ? item.due : null, now));
        body.appendChild(chip);
        body.appendChild(el('h4', 'ctab-nextup-title', String(item.title || 'Untitled')));
        var meta = pick && pick.reason ? String(pick.reason) : (item.subtitle ? String(item.subtitle) : '');
        if (meta) body.appendChild(el('p', 'ctab-nextup-reason', meta));
    }

    function renderDeadlinesWidget(body, tab, widget) {
        var count = widget.config && widget.config.count ? Math.min(Math.max(parseInt(widget.config.count, 10) || 6, 3), 12) : 6;
        var now = new Date();
        var items = sortByDue(getDeadlines().filter(function (it) { return it && it.status !== 'done'; })).slice(0, count);
        if (!items.length) {
            body.appendChild(emptyMsg('No upcoming deadlines.'));
            return;
        }
        var list = el('ul', 'ctab-list');
        items.forEach(function (it) {
            var due = it.due instanceof Date ? it.due : null;
            var li = el('li', 'ctab-list-row');
            li.appendChild(el('span', 'ctab-dot is-' + dueStatusKey(due, now)));
            li.appendChild(el('span', 'ctab-list-title', String(it.title || 'Untitled')));
            li.appendChild(el('span', 'ctab-due-chip is-' + dueStatusKey(due, now), dueLabel(due, now)));
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    function renderHabitsWidget(body, tab, widget) {
        var habits = [];
        try { habits = bridge.getHabitsToday() || []; } catch (e) { habits = []; }
        if (!habits.length) {
            body.appendChild(emptyMsg('No habits yet — add some on the Home tab.'));
            return;
        }
        var list = el('ul', 'ctab-list');
        habits.forEach(function (h) {
            var li = el('li', 'ctab-list-row ctab-habit-row' + (h.done ? ' is-done' : ''));
            var toggle = btn('ctab-habit-toggle' + (h.done ? ' is-done' : ''), '', function () {
                try { bridge.toggleHabit(h.id); } catch (e) { /* non-critical */ }
                rerenderWidgetBody(tab.id, widget.id);
            }, { title: h.done ? 'Mark "' + h.name + '" not done' : 'Mark "' + h.name + '" done', icon: 'fa-check' });
            li.appendChild(toggle);
            li.appendChild(el('span', 'ctab-list-title', h.name));
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    function renderFocusWidget(body) {
        body.appendChild(el('p', 'ctab-focus-hint', 'Start a focus session:'));
        var row = el('div', 'ctab-focus-row');
        [15, 25, 50].forEach(function (mins) {
            row.appendChild(btn('ctab-focus-btn', mins + ' min', function () {
                try { bridge.startFocus(mins * 60); } catch (e) { console.warn('focus start failed', e); }
            }, { icon: 'fa-play' }));
        });
        body.appendChild(row);
    }

    function renderNotesWidget(body, tab, widget) {
        var count = widget.config && widget.config.count ? Math.min(Math.max(parseInt(widget.config.count, 10) || 5, 3), 10) : 5;
        var notes = [];
        try { notes = bridge.getRecentNotes(count) || []; } catch (e) { notes = []; }
        if (!notes.length) {
            body.appendChild(emptyMsg('No notes yet.'));
            return;
        }
        var list = el('ul', 'ctab-list');
        notes.forEach(function (n) {
            var li = el('li', 'ctab-list-row');
            var open = btn('ctab-note-link', String(n.title || 'Untitled'), function () {
                try { bridge.openNote(n.id); } catch (e) { /* non-critical */ }
            }, { icon: 'fa-file-lines' });
            li.appendChild(open);
            if (n.updatedAt) {
                var d = new Date(n.updatedAt);
                if (!isNaN(d)) li.appendChild(el('span', 'ctab-list-meta', d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
            }
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    function renderCoursesWidget(body) {
        var courses = [];
        try { courses = bridge.getCourses() || []; } catch (e) { courses = []; }
        if (!courses.length) {
            body.appendChild(emptyMsg('No courses yet — set them up in Homework or Courses.'));
            return;
        }
        var list = el('ul', 'ctab-list');
        courses.forEach(function (c) {
            var li = el('li', 'ctab-list-row');
            li.appendChild(el('span', 'ctab-list-title', c.name));
            if (c.grade) li.appendChild(el('span', 'ctab-grade-chip', c.grade + (c.target ? ' → ' + c.target : '')));
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    function setupCountdownWidget() {
        var config = { title: '', date: '' };
        return promptText({ title: 'Countdown title', label: 'What are you counting down to?', placeholder: 'e.g. AP Chem exam' })
            .then(function (title) {
                if (title == null) return null;
                config.title = String(title).trim().slice(0, 60) || 'Countdown';
                return promptText({ title: 'Countdown date', label: 'Date (YYYY-MM-DD)', placeholder: '2026-08-15', inputType: 'date' })
                    .then(function (date) {
                        if (date == null) return null;
                        var str = String(date).trim();
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
                        config.date = str;
                        return config;
                    });
            });
    }

    function renderCountdownWidget(body, tab, widget) {
        var config = widget.config || {};
        if (!config.date) {
            var setupBtn = btn('ctab-setup-btn', 'Set date', function () {
                setupCountdownWidget().then(function (cfg) {
                    if (!cfg) return;
                    mutateTab(tab.id, function (t) {
                        var w = findWidget(t, widget.id);
                        if (w) w.config = cfg;
                    }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                });
            }, { icon: 'fa-calendar-plus' });
            body.appendChild(emptyMsg('Pick a date to count down to.'));
            body.appendChild(setupBtn);
            return;
        }
        // Date-only target: local midnight so "days left" matches the calendar.
        var parts = String(config.date).split('-');
        var target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        var diff = dayDiff(target, new Date());
        body.appendChild(el('p', 'ctab-countdown-title', String(config.title || 'Countdown')));
        var big = diff < 0 ? 'Passed' : (diff === 0 ? 'Today!' : String(diff));
        body.appendChild(el('div', 'ctab-countdown-big' + (diff <= 3 && diff >= 0 ? ' is-soon' : ''), big));
        if (diff > 0) body.appendChild(el('p', 'ctab-countdown-sub', diff === 1 ? 'day left' : 'days left'));
        else if (diff < 0) body.appendChild(el('p', 'ctab-countdown-sub', target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    }

    function renderChecklistWidget(body, tab, widget) {
        var items = (widget.config && Array.isArray(widget.config.items)) ? widget.config.items : [];
        var list = el('ul', 'ctab-list ctab-checklist');
        items.forEach(function (item) {
            var li = el('li', 'ctab-list-row' + (item.done ? ' is-done' : ''));
            var label = el('label', 'ctab-check-label');
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = item.done === true;
            box.addEventListener('change', function () {
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w || !w.config || !Array.isArray(w.config.items)) return;
                    for (var i = 0; i < w.config.items.length; i += 1) {
                        if (w.config.items[i].id === item.id) { w.config.items[i].done = box.checked; break; }
                    }
                }, { rerender: false });
                li.classList.toggle('is-done', box.checked);
            });
            label.appendChild(box);
            label.appendChild(el('span', 'ctab-list-title', String(item.text || '')));
            li.appendChild(label);
            li.appendChild(btn('ctab-item-remove', '', function () {
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w || !w.config || !Array.isArray(w.config.items)) return;
                    w.config.items = w.config.items.filter(function (x) { return x.id !== item.id; });
                }, { rerender: false });
                rerenderWidgetBody(tab.id, widget.id);
            }, { title: 'Remove item', icon: 'fa-xmark' }));
            list.appendChild(li);
        });
        body.appendChild(list);
        var addRow = el('div', 'ctab-add-row');
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'ctab-add-input';
        input.placeholder = 'Add an item…';
        var commit = function () {
            var text = input.value.trim();
            if (!text) return;
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                if (!Array.isArray(w.config.items)) w.config.items = [];
                if (w.config.items.length >= 50) return;
                w.config.items.push({ id: makeId('ci'), text: text, done: false });
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id, { focusAdd: true });
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
        addRow.appendChild(input);
        addRow.appendChild(btn('ctab-add-btn', 'Add', commit, { icon: 'fa-plus' }));
        body.appendChild(addRow);
    }

    function renderScratchpadWidget(body, tab, widget) {
        var area = document.createElement('textarea');
        area.className = 'ctab-scratchpad';
        area.placeholder = 'Jot anything…';
        area.value = widget.config && typeof widget.config.text === 'string' ? widget.config.text : '';
        area.addEventListener('input', function () {
            var key = tab.id + ':' + widget.id;
            if (scratchpadTimers[key]) clearTimeout(scratchpadTimers[key]);
            scratchpadTimers[key] = setTimeout(function () {
                delete scratchpadTimers[key];
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w) return;
                    if (!w.config || typeof w.config !== 'object') w.config = {};
                    w.config.text = area.value;
                }, { rerender: false });
            }, 600);
        });
        body.appendChild(area);
    }

    function safeHttpUrl(raw) {
        try {
            var url = new URL(String(raw || '').trim(), window.location.href);
            if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
        } catch (e) { /* invalid */ }
        return null;
    }

    function renderLinksWidget(body, tab, widget) {
        var links = (widget.config && Array.isArray(widget.config.links)) ? widget.config.links : [];
        if (links.length) {
            var list = el('ul', 'ctab-list');
            links.forEach(function (lnk) {
                var href = safeHttpUrl(lnk.url);
                if (!href) return;
                var li = el('li', 'ctab-list-row');
                var a = el('a', 'ctab-link', String(lnk.label || href));
                a.href = href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                li.appendChild(faIcon('fa-arrow-up-right-from-square'));
                li.appendChild(a);
                li.appendChild(btn('ctab-item-remove', '', function () {
                    mutateTab(tab.id, function (t) {
                        var w = findWidget(t, widget.id);
                        if (!w || !w.config || !Array.isArray(w.config.links)) return;
                        w.config.links = w.config.links.filter(function (x) { return x.id !== lnk.id; });
                    }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                }, { title: 'Remove link', icon: 'fa-xmark' }));
                list.appendChild(li);
            });
            body.appendChild(list);
        } else {
            body.appendChild(emptyMsg('No links yet.'));
        }
        body.appendChild(btn('ctab-add-btn', 'Add link', function () {
            promptText({ title: 'Link label', label: 'Name for this link', placeholder: 'e.g. Canvas' }).then(function (label) {
                if (label == null) return;
                promptText({ title: 'Link URL', label: 'Address (https://…)', placeholder: 'https://' }).then(function (url) {
                    if (url == null) return;
                    var href = safeHttpUrl(url);
                    if (!href) return;
                    mutateTab(tab.id, function (t) {
                        var w = findWidget(t, widget.id);
                        if (!w) return;
                        if (!w.config || typeof w.config !== 'object') w.config = {};
                        if (!Array.isArray(w.config.links)) w.config.links = [];
                        if (w.config.links.length >= 20) return;
                        w.config.links.push({ id: makeId('lk'), label: String(label).trim().slice(0, 60) || href, url: href });
                    }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                });
            });
        }, { icon: 'fa-plus' }));
    }

    function statBlock(value, label) {
        var block = el('div', 'ctab-stat');
        block.appendChild(el('span', 'ctab-stat-value', String(value)));
        block.appendChild(el('span', 'ctab-stat-label', String(label)));
        return block;
    }

    // ---------- Planning widgets ----------

    function renderThisWeekWidget(body) {
        var now = new Date();
        var items = sortByDue(getDeadlines().filter(function (it) {
            if (!it || it.status === 'done' || !(it.due instanceof Date)) return false;
            var diff = dayDiff(it.due, now);
            return diff >= 0 && diff <= 6;
        }));
        if (!items.length) {
            body.appendChild(emptyMsg('Nothing due in the next 7 days.'));
            return;
        }
        var groups = {};
        var order = [];
        items.forEach(function (it) {
            var key = dayDiff(it.due, now);
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(it);
        });
        order.forEach(function (key) {
            var label = key === 0 ? 'Today' : (key === 1 ? 'Tomorrow' : groups[key][0].due.toLocaleDateString(undefined, { weekday: 'long' }));
            body.appendChild(el('div', 'ctab-week-day', label));
            var list = el('ul', 'ctab-list');
            groups[key].forEach(function (it) {
                var li = el('li', 'ctab-list-row');
                li.appendChild(el('span', 'ctab-dot is-' + dueStatusKey(it.due, now)));
                li.appendChild(el('span', 'ctab-list-title', String(it.title || 'Untitled')));
                list.appendChild(li);
            });
            body.appendChild(list);
        });
    }

    function renderOverdueWidget(body) {
        var now = new Date();
        var items = sortByDue(getDeadlines().filter(function (it) {
            return it && it.status !== 'done' && it.due instanceof Date && dayDiff(it.due, now) < 0;
        }));
        if (!items.length) {
            body.appendChild(emptyMsg('Nothing overdue — nice.'));
            return;
        }
        var list = el('ul', 'ctab-list');
        items.slice(0, 12).forEach(function (it) {
            var li = el('li', 'ctab-list-row');
            li.appendChild(el('span', 'ctab-dot is-overdue'));
            li.appendChild(el('span', 'ctab-list-title', String(it.title || 'Untitled')));
            li.appendChild(el('span', 'ctab-due-chip is-overdue', dueLabel(it.due, now)));
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    function renderTasksWidget(body) {
        var stats = {};
        try { stats = bridge.getTaskStats() || {}; } catch (e) { stats = {}; }
        var row = el('div', 'ctab-stat-row');
        row.appendChild(statBlock(stats.open || 0, 'open'));
        row.appendChild(statBlock(stats.completedToday || 0, 'done today'));
        row.appendChild(statBlock(stats.total || 0, 'total'));
        body.appendChild(row);
    }

    // ---------- Academics widgets ----------

    function renderReviewWidget(body) {
        var stats = null;
        try { stats = bridge.getReviewStats(); } catch (e) { stats = null; }
        if (!stats) {
            body.appendChild(emptyMsg('Review isn’t set up yet.'));
            return;
        }
        var row = el('div', 'ctab-stat-row');
        row.appendChild(statBlock(stats.due || 0, 'due'));
        row.appendChild(statBlock(stats.overdue || 0, 'overdue'));
        row.appendChild(statBlock(stats.reviewedThisWeek || 0, 'this week'));
        body.appendChild(row);
        if ((stats.due || 0) > 0) {
            body.appendChild(btn('ctab-add-btn', 'Start review', function () {
                try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); } catch (e) { /* non-critical */ }
            }, { icon: 'fa-play' }));
        }
    }

    function renderStudyWidget(body) {
        var stats = null;
        try { stats = bridge.getStudyStats(); } catch (e) { stats = null; }
        if (!stats) {
            body.appendChild(emptyMsg('No study data yet.'));
            return;
        }
        var row = el('div', 'ctab-stat-row');
        row.appendChild(statBlock(stats.subjectCount || 0, 'subjects'));
        row.appendChild(statBlock(stats.nextExamDays != null ? stats.nextExamDays : '—', 'days to exam'));
        row.appendChild(statBlock(stats.weakAreas || 0, 'weak areas'));
        body.appendChild(row);
        if (stats.nextExamCountdown) body.appendChild(el('p', 'ctab-nextup-reason', 'Next exam: ' + stats.nextExamCountdown));
    }

    // ---------- Focus & Habits widgets ----------

    function renderStreakWidget(body) {
        var s = { current: 0, best: 0 };
        try { s = bridge.getStreak() || s; } catch (e) { /* non-critical */ }
        body.appendChild(el('div', 'ctab-countdown-big' + (s.current > 0 ? ' is-soon' : ''), String(s.current)));
        body.appendChild(el('p', 'ctab-countdown-sub', 'day streak'));
        body.appendChild(el('p', 'ctab-list-meta', 'Best: ' + s.best + ' days'));
    }

    function renderFocusStatsWidget(body) {
        var stats = { totalMinutes: 0, series: [] };
        try { stats = bridge.getFocusStats(7) || stats; } catch (e) { /* non-critical */ }
        body.appendChild(el('div', 'ctab-countdown-big', String(stats.totalMinutes || 0)));
        body.appendChild(el('p', 'ctab-countdown-sub', 'minutes this week'));
        var series = Array.isArray(stats.series) ? stats.series : [];
        if (series.length) {
            var max = Math.max(1, Math.max.apply(null, series.map(function (p) { return Number(p.value) || 0; })));
            var chart = el('div', 'ctab-bars');
            series.forEach(function (p) {
                var col = el('div', 'ctab-bar-col');
                var bar = el('div', 'ctab-bar');
                var h = Math.round(((Number(p.value) || 0) / max) * 100);
                bar.style.height = Math.max(3, h) + '%';
                bar.title = p.label + ': ' + (Number(p.value) || 0) + ' min';
                col.appendChild(bar);
                col.appendChild(el('span', 'ctab-bar-label', String(p.label || '').slice(0, 2)));
                chart.appendChild(col);
            });
            body.appendChild(chart);
        }
    }

    function setupCounterWidget() {
        return promptText({ title: 'Counter label', label: 'What are you counting?', placeholder: 'e.g. Glasses of water' }).then(function (label) {
            if (label == null) return null;
            return { label: String(label).trim().slice(0, 40) || 'Count', value: 0, step: 1 };
        });
    }

    function adjustCounter(tab, widget, delta) {
        mutateTab(tab.id, function (t) {
            var w = findWidget(t, widget.id);
            if (!w) return;
            if (!w.config || typeof w.config !== 'object') w.config = {};
            var step = Number(w.config.step) || 1;
            w.config.value = Math.max(-99999, Math.min(99999, (Number(w.config.value) || 0) + delta * step));
        }, { rerender: false });
        rerenderWidgetBody(tab.id, widget.id);
    }

    function renderCounterWidget(body, tab, widget) {
        var cfg = widget.config || {};
        body.appendChild(el('p', 'ctab-countdown-title', String(cfg.label || 'Count')));
        var row = el('div', 'ctab-counter-row');
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustCounter(tab, widget, -1); }, { title: 'Decrease', icon: 'fa-minus' }));
        row.appendChild(el('span', 'ctab-counter-value', String(Number(cfg.value) || 0)));
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustCounter(tab, widget, 1); }, { title: 'Increase', icon: 'fa-plus' }));
        body.appendChild(row);
    }

    function setupProgressWidget() {
        var cfg = { label: '', current: 0, target: 100 };
        return promptText({ title: 'Goal label', label: 'What’s the goal?', placeholder: 'e.g. Pages read' }).then(function (label) {
            if (label == null) return null;
            cfg.label = String(label).trim().slice(0, 40) || 'Goal';
            return promptText({ title: 'Target', label: 'Target number', placeholder: '100', inputType: 'number' }).then(function (target) {
                if (target == null) return null;
                cfg.target = Math.max(1, Math.round(Number(target) || 100));
                return cfg;
            });
        });
    }

    function adjustProgress(tab, widget, delta) {
        mutateTab(tab.id, function (t) {
            var w = findWidget(t, widget.id);
            if (!w) return;
            if (!w.config || typeof w.config !== 'object') w.config = {};
            w.config.current = Math.max(0, Math.min(999999, (Number(w.config.current) || 0) + delta));
        }, { rerender: false });
        rerenderWidgetBody(tab.id, widget.id);
    }

    function renderProgressWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var current = Math.max(0, Number(cfg.current) || 0);
        var target = Math.max(1, Number(cfg.target) || 100);
        var pct = Math.min(100, Math.round((current / target) * 100));
        body.appendChild(el('p', 'ctab-countdown-title', String(cfg.label || 'Goal')));
        var track = el('div', 'ctab-progress-track');
        var fill = el('div', 'ctab-progress-fill');
        fill.style.width = pct + '%';
        track.appendChild(fill);
        body.appendChild(track);
        body.appendChild(el('p', 'ctab-progress-label', current + ' / ' + target + ' (' + pct + '%)'));
        var row = el('div', 'ctab-counter-row');
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustProgress(tab, widget, -1); }, { title: 'Minus one', icon: 'fa-minus' }));
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustProgress(tab, widget, 1); }, { title: 'Plus one', icon: 'fa-plus' }));
        body.appendChild(row);
    }

    // ---------- Notes widgets ----------

    function openNotePicker(tab, widget) {
        var notes = [];
        try { notes = bridge.getAllNotes() || []; } catch (e) { notes = []; }
        var previouslyFocused = document.activeElement;
        var overlay = el('div', 'ctab-picker-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Bookmark a note');
        var panel = el('div', 'ctab-picker-panel');
        var head = el('header', 'ctab-picker-head');
        head.appendChild(el('h3', 'ctab-picker-title', 'Bookmark a note'));
        var closeBtn = btn('ctab-picker-close', '', close, { title: 'Close', icon: 'fa-xmark' });
        closeBtn.setAttribute('data-modal-close', '');
        head.appendChild(closeBtn);
        panel.appendChild(head);

        if (!notes.length) {
            panel.appendChild(emptyMsg('You have no notes yet.'));
        } else {
            var search = document.createElement('input');
            search.type = 'text';
            search.className = 'ctab-add-input';
            search.placeholder = 'Search notes…';
            panel.appendChild(search);
            var list = el('ul', 'ctab-list ctab-note-picker-list');
            var renderList = function (filter) {
                while (list.firstChild) list.removeChild(list.firstChild);
                var f = String(filter || '').toLowerCase();
                notes.filter(function (n) { return !f || n.title.toLowerCase().indexOf(f) !== -1; }).slice(0, 100).forEach(function (n) {
                    var li = el('li', 'ctab-list-row');
                    li.appendChild(btn('ctab-note-link', n.title, function () { addBookmark(n.id); }, { icon: 'fa-file-lines' }));
                    list.appendChild(li);
                });
            };
            search.addEventListener('input', function () { renderList(search.value); });
            renderList('');
            panel.appendChild(list);
        }
        overlay.appendChild(panel);

        function onKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
        function close() {
            document.removeEventListener('keydown', onKeydown, true);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch (e) { /* non-critical */ }
            }
        }
        function addBookmark(id) {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                if (!Array.isArray(w.config.noteIds)) w.config.noteIds = [];
                if (w.config.noteIds.indexOf(id) === -1 && w.config.noteIds.length < 30) w.config.noteIds.push(id);
            }, { rerender: false });
            close();
            rerenderWidgetBody(tab.id, widget.id);
        }
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKeydown, true);
        document.body.appendChild(overlay);
        closeBtn.focus();
    }

    function renderBookmarksWidget(body, tab, widget) {
        var ids = (widget.config && Array.isArray(widget.config.noteIds)) ? widget.config.noteIds : [];
        if (ids.length) {
            var list = el('ul', 'ctab-list');
            ids.forEach(function (id) {
                var title = null;
                try { title = bridge.getNoteTitle(id); } catch (e) { title = null; }
                if (title == null) return; // note was deleted — skip silently
                var li = el('li', 'ctab-list-row');
                li.appendChild(btn('ctab-note-link', title, function () { try { bridge.openNote(id); } catch (e) { /* non-critical */ } }, { icon: 'fa-file-lines' }));
                li.appendChild(btn('ctab-item-remove', '', function () {
                    mutateTab(tab.id, function (t) {
                        var w = findWidget(t, widget.id);
                        if (!w || !w.config || !Array.isArray(w.config.noteIds)) return;
                        w.config.noteIds = w.config.noteIds.filter(function (x) { return x !== id; });
                    }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                }, { title: 'Remove', icon: 'fa-xmark' }));
                list.appendChild(li);
            });
            body.appendChild(list);
        } else {
            body.appendChild(emptyMsg('No bookmarked notes yet.'));
        }
        body.appendChild(btn('ctab-add-btn', 'Add note', function () { openNotePicker(tab, widget); }, { icon: 'fa-plus' }));
    }

    function renderStickyWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var color = cfg.color || STICKY_COLORS[0];
        var wrap = el('div', 'ctab-sticky');
        wrap.style.background = color;
        var area = document.createElement('textarea');
        area.className = 'ctab-sticky-text';
        area.placeholder = 'Sticky note…';
        area.value = typeof cfg.text === 'string' ? cfg.text : '';
        area.addEventListener('input', function () {
            var key = tab.id + ':' + widget.id;
            if (scratchpadTimers[key]) clearTimeout(scratchpadTimers[key]);
            scratchpadTimers[key] = setTimeout(function () {
                delete scratchpadTimers[key];
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w) return;
                    if (!w.config || typeof w.config !== 'object') w.config = {};
                    w.config.text = area.value;
                }, { rerender: false });
            }, 600);
        });
        wrap.appendChild(area);
        body.appendChild(wrap);
        var swatches = el('div', 'ctab-swatches');
        STICKY_COLORS.forEach(function (c) {
            var sw = el('button', 'ctab-swatch' + (c === color ? ' is-active' : ''));
            sw.type = 'button';
            sw.style.background = c;
            sw.title = 'Recolor note';
            sw.setAttribute('aria-label', 'Recolor note');
            sw.addEventListener('click', function () {
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w) return;
                    if (!w.config || typeof w.config !== 'object') w.config = {};
                    w.config.color = c;
                }, { rerender: false });
                rerenderWidgetBody(tab.id, widget.id);
            });
            swatches.appendChild(sw);
        });
        body.appendChild(swatches);
    }

    // ---------- Time widgets ----------

    function renderClockWidget(body, tab, widget) {
        var timeEl = el('div', 'ctab-clock-time', '');
        var dateEl = el('div', 'ctab-clock-date', '');
        body.appendChild(timeEl);
        body.appendChild(dateEl);
        startTimer(tab.id, widget.id, function () {
            var now = new Date();
            timeEl.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        }, 1000);
    }

    function setupDaysSinceWidget() {
        var cfg = { title: '', date: '' };
        return promptText({ title: 'Days since…', label: 'What happened?', placeholder: 'e.g. Started studying' }).then(function (title) {
            if (title == null) return null;
            cfg.title = String(title).trim().slice(0, 60) || 'Days since';
            return promptText({ title: 'Since date', label: 'Date (YYYY-MM-DD)', placeholder: '2026-01-01', inputType: 'date' }).then(function (date) {
                if (date == null) return null;
                var str = String(date).trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
                cfg.date = str;
                return cfg;
            });
        });
    }

    function renderDaysSinceWidget(body, tab, widget) {
        var cfg = widget.config || {};
        if (!cfg.date) {
            body.appendChild(emptyMsg('Set a date to count from.'));
            return;
        }
        var parts = String(cfg.date).split('-');
        var since = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        var diff = dayDiff(new Date(), since);
        body.appendChild(el('p', 'ctab-countdown-title', String(cfg.title || 'Days since')));
        body.appendChild(el('div', 'ctab-countdown-big', String(Math.max(0, diff))));
        body.appendChild(el('p', 'ctab-countdown-sub', Math.abs(diff) === 1 ? 'day' : 'days'));
    }

    function renderStopwatchWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var display = el('div', 'ctab-clock-time', '00:00');
        body.appendChild(display);

        function elapsedMs() {
            var acc = Number(cfg.accumulatedMs) || 0;
            if (cfg.running && cfg.startedAt) acc += Date.now() - Number(cfg.startedAt);
            return Math.max(0, acc);
        }
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        function fmt(ms) {
            var total = Math.floor(ms / 1000);
            var h = Math.floor(total / 3600);
            var m = Math.floor((total % 3600) / 60);
            var s = total % 60;
            return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
        }
        function paint() { display.textContent = fmt(elapsedMs()); }
        paint();
        if (cfg.running) startTimer(tab.id, widget.id, paint, 250);

        var row = el('div', 'ctab-focus-row');
        row.appendChild(btn('ctab-focus-btn', cfg.running ? 'Pause' : 'Start', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                if (w.config.running) {
                    w.config.accumulatedMs = (Number(w.config.accumulatedMs) || 0) + (w.config.startedAt ? Date.now() - Number(w.config.startedAt) : 0);
                    w.config.running = false;
                    w.config.startedAt = null;
                } else {
                    w.config.running = true;
                    w.config.startedAt = Date.now();
                }
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: cfg.running ? 'fa-pause' : 'fa-play' }));
        row.appendChild(btn('ctab-focus-btn', 'Reset', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                w.config = { running: false, startedAt: null, accumulatedMs: 0 };
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: 'fa-rotate-left' }));
        body.appendChild(row);
    }

    // ---------- Tools widgets ----------

    function renderHtmlWidget(body, tab, widget) {
        var config = normalizeHtmlWidgetConfig(widget.config);
        var source = config.source;
        if (!source.trim()) {
            body.appendChild(emptyMsg('This HTML widget is empty. Edit it to add markup.'));
            return;
        }
        if (htmlSourceByteLength(source) > MAX_HTML_WIDGET_SOURCE_BYTES) {
            body.appendChild(emptyMsg('This HTML widget is larger than the 512 KB safety limit. Edit or remove it.'));
            return;
        }

        var safety = window.SutraDOMSafety;
        if (!safety || typeof safety.renderUserHTMLToFrame !== 'function') {
            body.appendChild(emptyMsg('The HTML widget safety layer is unavailable.'));
            return;
        }

        var host = el('div', 'ctab-html-runtime');
        body.appendChild(host);
        try {
            safety.renderUserHTMLToFrame(host, source, {
                title: 'Custom HTML widget',
                mode: config.mode,
                capabilityAcknowledged: true,
                referrerPolicy: 'no-referrer',
                height: '240px'
            });
        } catch (error) {
            while (host.firstChild) host.removeChild(host.firstChild);
            host.appendChild(emptyMsg('This HTML widget could not be rendered safely.'));
            console.warn('SutraCustomTabs: HTML widget render failed', error);
        }
    }

    function setupHtmlWidget(existing) {
        var initial = normalizeHtmlWidgetConfig(existing);
        return new Promise(function (resolve) {
            var previouslyFocused = document.activeElement;
            var overlay = el('div', 'ctab-html-editor-overlay');
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            var titleId = makeId('html-widget-title');
            overlay.setAttribute('aria-labelledby', titleId);

            var panel = el('div', 'ctab-html-editor-panel');
            var header = el('header', 'ctab-html-editor-head');
            var title = el('h3', 'ctab-picker-title', existing ? 'Edit Custom HTML' : 'Add Custom HTML');
            title.id = titleId;
            header.appendChild(title);
            var closeButton = btn('ctab-picker-close', '', close, { title: 'Close', icon: 'fa-xmark' });
            header.appendChild(closeButton);
            panel.appendChild(header);

            var subtitle = el('p', 'ctab-html-editor-subtitle', 'Paste a small HTML card. It runs in an isolated iframe and cannot access Sutra or its workspace data.');
            panel.appendChild(subtitle);

            var editor = el('div', 'ctab-html-editor-layout');
            var sourceColumn = el('section', 'ctab-html-editor-source');
            var sourceId = makeId('html-widget-source');
            var sourceLabel = el('label', 'ctab-html-editor-label', 'HTML markup');
            sourceLabel.htmlFor = sourceId;
            sourceColumn.appendChild(sourceLabel);
            var textarea = document.createElement('textarea');
            textarea.id = sourceId;
            textarea.className = 'ctab-html-editor-input';
            textarea.rows = 12;
            textarea.maxLength = MAX_HTML_WIDGET_SOURCE_CHARS;
            textarea.spellcheck = false;
            textarea.autocomplete = 'off';
            textarea.placeholder = '<section><h2>My card</h2><p>...</p></section>';
            textarea.value = initial.source;
            sourceColumn.appendChild(textarea);
            sourceColumn.appendChild(el('p', 'ctab-html-editor-help', 'Scripts are allowed only inside the isolated frame. Forms, downloads, parent access, and app navigation stay blocked.'));

            var networkLabel = document.createElement('label');
            networkLabel.className = 'ctab-html-network-choice';
            var networkInput = document.createElement('input');
            networkInput.type = 'checkbox';
            networkInput.checked = initial.mode === HTML_WIDGET_NETWORK_MODE;
            networkLabel.appendChild(networkInput);
            networkLabel.appendChild(document.createTextNode(' Allow remote embeds and external images'));
            sourceColumn.appendChild(networkLabel);
            sourceColumn.appendChild(el('p', 'ctab-html-network-note', 'When enabled, approved providers such as Spotify, YouTube, Vimeo, and SoundCloud may load. Remote links open only from an explicit click; no network requests are made by Sutra itself.'));
            editor.appendChild(sourceColumn);

            var previewColumn = el('section', 'ctab-html-editor-preview');
            previewColumn.appendChild(el('div', 'ctab-html-editor-label', 'Preview'));
            var preview = el('div', 'ctab-html-preview-surface');
            previewColumn.appendChild(preview);
            editor.appendChild(previewColumn);
            panel.appendChild(editor);

            var status = el('p', 'ctab-html-editor-status');
            status.setAttribute('role', 'status');
            panel.appendChild(status);

            var footer = el('footer', 'ctab-html-editor-footer');
            var cancelButton = btn('ctab-action', 'Cancel', close);
            var confirmButton = btn('ctab-action is-active', existing ? 'Save widget' : 'Add widget', confirm);
            footer.appendChild(cancelButton);
            footer.appendChild(confirmButton);
            panel.appendChild(footer);
            overlay.appendChild(panel);

            function selectedMode() {
                return networkInput.checked ? HTML_WIDGET_NETWORK_MODE : HTML_WIDGET_LOCAL_MODE;
            }

            function renderPreview() {
                while (preview.firstChild) preview.removeChild(preview.firstChild);
                var source = String(textarea.value || '');
                if (!source.trim()) {
                    preview.appendChild(emptyMsg('Paste HTML to preview it.'));
                    return;
                }
                if (htmlSourceByteLength(source) > MAX_HTML_WIDGET_SOURCE_BYTES) {
                    preview.appendChild(emptyMsg('Preview unavailable above the 512 KB safety limit.'));
                    return;
                }
                var safety = window.SutraDOMSafety;
                if (!safety || typeof safety.renderUserHTMLToFrame !== 'function') {
                    preview.appendChild(emptyMsg('Preview safety layer unavailable.'));
                    return;
                }
                try {
                    safety.renderUserHTMLToFrame(preview, source, {
                        title: 'Custom HTML widget preview',
                        mode: selectedMode(),
                        capabilityAcknowledged: true,
                        referrerPolicy: 'no-referrer',
                        height: '220px'
                    });
                } catch (error) {
                    preview.appendChild(emptyMsg('Preview could not be rendered safely.'));
                    console.warn('SutraCustomTabs: HTML widget preview failed', error);
                }
            }

            function validate() {
                var source = String(textarea.value || '');
                var bytes = htmlSourceByteLength(source);
                confirmButton.disabled = !source.trim() || bytes > MAX_HTML_WIDGET_SOURCE_BYTES;
                if (!source.trim()) status.textContent = 'Add HTML markup to continue.';
                else if (bytes > MAX_HTML_WIDGET_SOURCE_BYTES) status.textContent = 'HTML is larger than the 512 KB safety limit.';
                else if (networkInput.checked) status.textContent = 'Remote capability enabled for this widget; external services may receive your IP address.';
                else status.textContent = 'Offline mode: no network requests from this widget.';
            }

            function onInput() { validate(); renderPreview(); }
            function onKeydown(event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    close();
                } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    confirm();
                }
            }

            function close() {
                textarea.removeEventListener('input', onInput);
                networkInput.removeEventListener('change', onInput);
                document.removeEventListener('keydown', onKeydown, true);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                document.body.classList.remove('ctab-html-editor-open');
                if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                    try { previouslyFocused.focus(); } catch (e) { /* non-critical */ }
                }
                resolve(null);
            }

            function confirm() {
                var source = String(textarea.value || '');
                if (!source.trim() || htmlSourceByteLength(source) > MAX_HTML_WIDGET_SOURCE_BYTES) return;
                closeWithResult({ source: source, mode: selectedMode() });
            }

            function closeWithResult(result) {
                textarea.removeEventListener('input', onInput);
                networkInput.removeEventListener('change', onInput);
                document.removeEventListener('keydown', onKeydown, true);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                document.body.classList.remove('ctab-html-editor-open');
                if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                    try { previouslyFocused.focus(); } catch (e) { /* non-critical */ }
                }
                resolve(result);
            }

            textarea.addEventListener('input', onInput);
            networkInput.addEventListener('change', onInput);
            document.addEventListener('keydown', onKeydown, true);
            document.body.appendChild(overlay);
            document.body.classList.add('ctab-html-editor-open');
            validate();
            renderPreview();
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
    }

    function editHtmlWidget(tabId, widgetId) {
        var tabs = getTabs();
        var tab = tabs.find(function (item) { return item && item.id === tabId; });
        var widget = tab && findWidget(tab, widgetId);
        if (!widget) return;
        setupHtmlWidget(widget.config).then(function (config) {
            if (config === null) return;
            mutateTab(tabId, function (nextTab) {
                var nextWidget = findWidget(nextTab, widgetId);
                if (nextWidget) nextWidget.config = config;
            });
        });
    }

    function renderCalculatorWidget(body) {
        var expr = '';
        var display = el('div', 'ctab-calc-display', '0');
        body.appendChild(display);
        var keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+', 'C'];
        var grid = el('div', 'ctab-calc-grid');
        keys.forEach(function (k) {
            var glyph = k === '*' ? '×' : (k === '/' ? '÷' : k);
            var key = el('button', 'ctab-calc-key' + (k === '=' ? ' is-eq' : '') + (k === 'C' ? ' is-clear' : ''), glyph);
            key.type = 'button';
            key.addEventListener('click', function () {
                if (k === 'C') { expr = ''; display.textContent = '0'; return; }
                if (k === '=') {
                    var r = evalExpression(expr);
                    if (r == null) { display.textContent = 'Error'; expr = ''; }
                    else { expr = String(Math.round(r * 1e9) / 1e9); display.textContent = expr; }
                    return;
                }
                if (expr.length >= 32) return;
                expr += k;
                display.textContent = expr;
            });
            grid.appendChild(key);
        });
        body.appendChild(grid);
    }

    function renderQuoteWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var bank = (window.SutraQuote && typeof window.SutraQuote.getAvailableQuotes === 'function')
            ? window.SutraQuote.getAvailableQuotes({ surface: 'custom-tab' })
            : BUILTIN_QUOTES.map(function (quote, fallbackIndex) {
                return { id: 'fallback-' + fallbackIndex, text: quote.text, author: quote.by, category: 'motivational' };
            });
        if (!bank.length) {
            body.appendChild(emptyMsg('No quotes are enabled for Custom Tabs. Choose a source or add a personal quote.'));
            if (window.SutraQuote && typeof window.SutraQuote.openManager === 'function') {
                body.appendChild(btn('ctab-add-btn', 'Manage quotes', function () { window.SutraQuote.openManager(); }, { icon: 'fa-quote-left' }));
            }
            return;
        }
        var idx = Number.isInteger(cfg.index) ? cfg.index : 0;
        idx = ((idx % bank.length) + bank.length) % bank.length;
        var q = bank[idx];
        body.appendChild(el('p', 'ctab-quote-text', '“' + q.text + '”'));
        body.appendChild(el('p', 'ctab-quote-by', '— ' + (q.author || q.by || 'Personal')));
        body.appendChild(btn('ctab-add-btn', 'New quote', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                w.config.index = (idx + 1) % bank.length;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: 'fa-rotate' }));
        if (window.SutraQuote && typeof window.SutraQuote.openManager === 'function') {
            body.appendChild(btn('ctab-add-btn ctab-quote-manage', 'Manage', function () { window.SutraQuote.openManager(); }, { icon: 'fa-sliders' }));
        }
    }

    function setupHeadingWidget() {
        return promptText({ title: 'Section heading', label: 'Heading text', placeholder: 'e.g. Morning routine' }).then(function (text) {
            if (text == null) return null;
            return { text: String(text).trim().slice(0, 60) || 'Section' };
        });
    }

    function renderHeadingWidget(body, tab, widget) {
        var cfg = widget.config || {};
        body.appendChild(el('h3', 'ctab-section-heading', String(cfg.text || 'Section')));
    }

    // ---------- imported page widgets ----------

    function getImportedData(widget) {
        try {
            if (!bridge || typeof bridge.getImportedWidgetData !== 'function') return null;
            return bridge.getImportedWidgetData(widget.type, widget.config || null) || null;
        } catch (e) { return null; }
    }

    function runImportedAction(action, payload) {
        try {
            if (bridge && typeof bridge.runImportedWidgetAction === 'function') {
                bridge.runImportedWidgetAction(action, payload || {});
            }
        } catch (e) { /* non-critical */ }
    }

    function appendImportedHero(body, hero) {
        if (!hero) return false;
        var wrap = el('div', 'ctab-import-hero');
        wrap.appendChild(el('strong', 'ctab-import-hero-value', String(hero.value != null ? hero.value : '')));
        if (hero.label) wrap.appendChild(el('span', 'ctab-import-hero-label', String(hero.label)));
        if (hero.meta) wrap.appendChild(el('span', 'ctab-import-hero-meta', String(hero.meta)));
        body.appendChild(wrap);
        return true;
    }

    function appendImportedStats(body, stats) {
        if (!Array.isArray(stats) || !stats.length) return false;
        var row = el('div', 'ctab-stat-row ctab-import-stats');
        stats.slice(0, 4).forEach(function (stat) {
            row.appendChild(statBlock(stat && stat.value != null ? stat.value : 0, stat && stat.label ? stat.label : ''));
        });
        body.appendChild(row);
        return true;
    }

    function appendImportedList(body, rows) {
        if (!Array.isArray(rows) || !rows.length) return false;
        var list = el('ul', 'ctab-list ctab-import-list');
        rows.slice(0, 8).forEach(function (row) {
            if (!row) return;
            var li = el('li', 'ctab-list-row ctab-import-list-row' + (row.tone ? ' is-' + String(row.tone) : ''));
            var title = row.title != null ? String(row.title) : 'Untitled';
            if (row.action) {
                li.appendChild(btn('ctab-import-row-btn', title, function () {
                    runImportedAction(row.action, row.payload || {});
                }, { icon: row.icon || 'fa-arrow-up-right-from-square' }));
            } else {
                li.appendChild(el('span', 'ctab-list-title', title));
            }
            if (row.meta) li.appendChild(el('span', 'ctab-list-meta', String(row.meta)));
            list.appendChild(li);
        });
        body.appendChild(list);
        return true;
    }

    function appendImportedActions(body, actions) {
        if (!Array.isArray(actions) || !actions.length) return false;
        var row = el('div', 'ctab-import-actions');
        actions.slice(0, 3).forEach(function (action) {
            if (!action) return;
            row.appendChild(btn('ctab-add-btn ctab-import-action', String(action.label || 'Open'), function () {
                runImportedAction(action.action, action.payload || {});
            }, { icon: action.icon || 'fa-arrow-up-right-from-square' }));
        });
        body.appendChild(row);
        return true;
    }

    function appendImportedHeatmap(body, points) {
        if (!Array.isArray(points) || !points.length) return false;
        var max = Math.max(1, Math.max.apply(null, points.map(function (p) { return Number(p && p.value) || 0; })));
        var grid = el('div', 'ctab-import-heatmap');
        points.forEach(function (point) {
            var v = Number(point && point.value) || 0;
            var cell = el('span', 'ctab-import-heat-cell level-' + Math.min(4, Math.ceil((v / max) * 4)));
            cell.title = (point && point.date ? point.date + ': ' : '') + v + ' activity';
            grid.appendChild(cell);
        });
        body.appendChild(grid);
        return true;
    }

    function appendImportedBars(body, bars) {
        if (!Array.isArray(bars) || !bars.length) return false;
        var max = Math.max(1, Math.max.apply(null, bars.map(function (p) { return Number(p && p.value) || 0; })));
        var chart = el('div', 'ctab-bars ctab-import-bars');
        bars.slice(0, 14).forEach(function (point) {
            var value = Number(point && point.value) || 0;
            var col = el('div', 'ctab-bar-col');
            var bar = el('div', 'ctab-bar');
            bar.style.height = Math.max(3, Math.round((value / max) * 100)) + '%';
            bar.title = String(point && point.label || '') + ': ' + value;
            col.appendChild(bar);
            col.appendChild(el('span', 'ctab-bar-label', String(point && point.label || '').slice(0, 2)));
            chart.appendChild(col);
        });
        body.appendChild(chart);
        return true;
    }

    function appendImportedTimeline(body, blocks) {
        if (!Array.isArray(blocks) || !blocks.length) return false;
        var min = 6 * 60;
        var max = 22 * 60;
        blocks.forEach(function (block) {
            if (!block) return;
            min = Math.min(min, Number(block.start) || min);
            max = Math.max(max, Number(block.end) || max);
        });
        if (max <= min) max = min + 60;
        var wrap = el('div', 'ctab-import-timeline');
        blocks.slice(0, 10).forEach(function (block) {
            var start = Number(block.start) || min;
            var end = Number(block.end) || start + 30;
            var seg = el('div', 'ctab-import-time-seg');
            seg.style.left = Math.max(0, Math.min(100, ((start - min) / (max - min)) * 100)) + '%';
            seg.style.width = Math.max(4, Math.min(100, ((end - start) / (max - min)) * 100)) + '%';
            seg.title = [block.title || 'Block', block.meta || ''].filter(Boolean).join(' - ');
            wrap.appendChild(seg);
        });
        body.appendChild(wrap);
        return true;
    }

    function appendImportedProgress(body, progress) {
        if (!progress || progress.pct == null) return false;
        var pct = Math.max(0, Math.min(100, Math.round(Number(progress.pct) || 0)));
        var track = el('div', 'ctab-progress-track');
        var fill = el('div', 'ctab-progress-fill ctab-import-progress-fill' + (progress.tone ? ' is-' + String(progress.tone) : ''));
        fill.style.width = pct + '%';
        track.appendChild(fill);
        body.appendChild(track);
        if (progress.label) body.appendChild(el('p', 'ctab-progress-label', String(progress.label)));
        return true;
    }

    function renderImportedWidget(body, tab, widget) {
        var data = getImportedData(widget);
        if (!data) {
            body.appendChild(emptyMsg('Imported widget data is unavailable.'));
            return;
        }
        var rendered = false;
        rendered = appendImportedHero(body, data.hero) || rendered;
        rendered = appendImportedStats(body, data.stats) || rendered;
        rendered = appendImportedProgress(body, data.progress) || rendered;
        rendered = appendImportedHeatmap(body, data.heatmap) || rendered;
        rendered = appendImportedBars(body, data.bars) || rendered;
        rendered = appendImportedTimeline(body, data.timeline) || rendered;
        rendered = appendImportedList(body, data.list) || rendered;
        if (!rendered && data.empty) body.appendChild(emptyMsg(String(data.empty)));
        else if (!rendered) body.appendChild(emptyMsg('Nothing to show yet.'));
        appendImportedActions(body, data.actions);
        if (widget.type === 'imp_pinned_notes_board') {
            body.appendChild(btn('ctab-add-btn ctab-import-action', 'Pin note', function () {
                openNotePicker(tab, widget);
            }, { icon: 'fa-plus' }));
        }
    }

    // ---------- interactive widgets (self-contained; state lives in widget.config) ----------

    function localDateKey(d) {
        var x = d || new Date();
        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }

    // --- Wellness: Water Tracker ---

    function setupWaterWidget() {
        return promptText({ title: 'Daily water goal', label: 'How many glasses a day?', placeholder: '8', inputType: 'number' }).then(function (val) {
            if (val == null) return null;
            var goal = Math.max(1, Math.min(50, Math.round(Number(val) || 8)));
            return { goal: goal, count: 0, dateKey: localDateKey() };
        });
    }

    function adjustWater(tab, widget, delta) {
        var todayK = localDateKey();
        mutateTab(tab.id, function (t) {
            var w = findWidget(t, widget.id);
            if (!w) return;
            if (!w.config || typeof w.config !== 'object') w.config = {};
            if (w.config.dateKey !== todayK) { w.config.dateKey = todayK; w.config.count = 0; }
            w.config.count = Math.max(0, Math.min(50, (Number(w.config.count) || 0) + delta));
        }, { rerender: false });
        rerenderWidgetBody(tab.id, widget.id);
    }

    function renderWaterWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var todayK = localDateKey();
        if (cfg.dateKey !== todayK) {
            // New day — reset the count so the tracker starts fresh.
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                w.config.dateKey = todayK;
                w.config.count = 0;
            }, { rerender: false });
            cfg = { goal: cfg.goal, count: 0, dateKey: todayK };
        }
        var goal = Math.max(1, Number(cfg.goal) || 8);
        var count = Math.max(0, Number(cfg.count) || 0);
        var pct = Math.min(100, Math.round((count / goal) * 100));
        body.appendChild(el('p', 'ctab-countdown-title', 'Water'));
        var track = el('div', 'ctab-progress-track');
        var fill = el('div', 'ctab-progress-fill');
        fill.style.width = pct + '%';
        track.appendChild(fill);
        body.appendChild(track);
        body.appendChild(el('p', 'ctab-progress-label', count + ' / ' + goal + ' glasses'));
        var row = el('div', 'ctab-counter-row');
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustWater(tab, widget, -1); }, { title: 'Remove a glass', icon: 'fa-minus' }));
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustWater(tab, widget, 1); }, { title: 'Add a glass', icon: 'fa-plus' }));
        body.appendChild(row);
    }

    // --- Wellness: 20-20-20 Break Reminder ---

    function renderEyeBreakWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var workMs = Math.max(1, Number(cfg.intervalMin) || 20) * 60000;
        var breakMs = 20000;
        var banner = el('div', 'ctab-break-banner');
        banner.style.display = 'none';
        var display = el('div', 'ctab-clock-time', '20:00');
        body.appendChild(banner);
        body.appendChild(display);

        function pad(n) { return (n < 10 ? '0' : '') + n; }
        function paint() {
            if (!cfg.running) {
                banner.style.display = 'none';
                var d = Math.floor(workMs / 1000);
                display.textContent = pad(Math.floor(d / 60)) + ':' + pad(d % 60);
                return;
            }
            var now = Date.now();
            if (!cfg.endsAt || now >= Number(cfg.endsAt)) {
                var nextPhase = cfg.phase === 'break' ? 'work' : 'break';
                var nextEnds = now + (nextPhase === 'break' ? breakMs : workMs);
                cfg.phase = nextPhase;
                cfg.endsAt = nextEnds;
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (w && w.config) { w.config.phase = nextPhase; w.config.endsAt = nextEnds; }
                }, { rerender: false });
            }
            var rem = Math.max(0, Math.floor((Number(cfg.endsAt) - now) / 1000));
            if (cfg.phase === 'break') {
                banner.style.display = '';
                banner.textContent = 'Look 20 ft away — ' + rem + 's';
                display.textContent = '00:' + pad(rem);
            } else {
                banner.style.display = 'none';
                display.textContent = pad(Math.floor(rem / 60)) + ':' + pad(rem % 60);
            }
        }
        paint();
        if (cfg.running) startTimer(tab.id, widget.id, paint, 1000);

        var row = el('div', 'ctab-focus-row');
        row.appendChild(btn('ctab-focus-btn', cfg.running ? 'Stop' : 'Start', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                if (w.config.running) { w.config.running = false; w.config.endsAt = null; w.config.phase = 'work'; }
                else { w.config.running = true; w.config.phase = 'work'; w.config.endsAt = Date.now() + workMs; }
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: cfg.running ? 'fa-stop' : 'fa-play' }));
        body.appendChild(row);
        body.appendChild(el('p', 'ctab-list-meta', 'Every 20 min, look 20 ft away for 20 sec.'));
    }

    // --- Wellness: Gratitude Prompt ---

    var GRATITUDE_PROMPTS = [
        'What went well today?',
        'Who are you grateful for right now?',
        'What is one small win from today?',
        'What made you smile recently?',
        'What are you looking forward to?',
        'What is something you have that others might wish for?'
    ];

    function renderGratitudeWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var len = GRATITUDE_PROMPTS.length;
        var idx = (((Number(cfg.promptIndex) || 0) % len) + len) % len;
        var todayK = localDateKey();
        var entries = (cfg.entries && typeof cfg.entries === 'object') ? cfg.entries : {};
        body.appendChild(el('p', 'ctab-quote-text', GRATITUDE_PROMPTS[idx]));
        var area = document.createElement('textarea');
        area.className = 'ctab-scratchpad ctab-gratitude-text';
        area.placeholder = 'Write a line…';
        area.value = typeof entries[todayK] === 'string' ? entries[todayK] : '';
        area.addEventListener('input', function () {
            var key = tab.id + ':' + widget.id;
            if (scratchpadTimers[key]) clearTimeout(scratchpadTimers[key]);
            scratchpadTimers[key] = setTimeout(function () {
                delete scratchpadTimers[key];
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w) return;
                    if (!w.config || typeof w.config !== 'object') w.config = {};
                    if (!w.config.entries || typeof w.config.entries !== 'object') w.config.entries = {};
                    w.config.entries[todayK] = area.value;
                }, { rerender: false });
            }, 600);
        });
        body.appendChild(area);
        body.appendChild(btn('ctab-add-btn', 'New prompt', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                w.config.promptIndex = (idx + 1) % len;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: 'fa-rotate' }));
    }

    // --- Reading: Currently Reading ---

    function setupReadingWidget() {
        var cfg = { title: '', currentPage: 0, totalPages: 0 };
        return promptText({ title: 'Currently reading', label: 'Book or material title', placeholder: 'e.g. The Great Gatsby' }).then(function (title) {
            if (title == null) return null;
            cfg.title = String(title).trim() || 'Reading';
            return promptText({ title: 'Total pages', label: 'How many pages?', placeholder: '180', inputType: 'number' }).then(function (pages) {
                if (pages == null) return null;
                cfg.totalPages = Math.max(1, Math.round(Number(pages) || 100));
                return cfg;
            });
        });
    }

    function adjustReading(tab, widget, delta) {
        mutateTab(tab.id, function (t) {
            var w = findWidget(t, widget.id);
            if (!w) return;
            if (!w.config || typeof w.config !== 'object') w.config = {};
            var total = Math.max(1, Number(w.config.totalPages) || 1);
            w.config.currentPage = Math.max(0, Math.min(total, (Number(w.config.currentPage) || 0) + delta));
        }, { rerender: false });
        rerenderWidgetBody(tab.id, widget.id);
    }

    function renderReadingWidget(body, tab, widget) {
        var cfg = widget.config || {};
        if (!cfg.totalPages) {
            body.appendChild(emptyMsg('Set a book to track your reading.'));
            body.appendChild(btn('ctab-setup-btn', 'Set book', function () {
                setupReadingWidget().then(function (c) {
                    if (!c) return;
                    mutateTab(tab.id, function (t) { var w = findWidget(t, widget.id); if (w) w.config = c; }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                });
            }, { icon: 'fa-book' }));
            return;
        }
        var total = Math.max(1, Number(cfg.totalPages) || 1);
        var cur = Math.max(0, Math.min(total, Number(cfg.currentPage) || 0));
        var pct = Math.round((cur / total) * 100);
        body.appendChild(el('p', 'ctab-countdown-title', String(cfg.title || 'Reading')));
        var track = el('div', 'ctab-progress-track');
        var fill = el('div', 'ctab-progress-fill');
        fill.style.width = pct + '%';
        track.appendChild(fill);
        body.appendChild(track);
        body.appendChild(el('p', 'ctab-progress-label', 'Page ' + cur + ' / ' + total + ' (' + pct + '%)'));
        var row = el('div', 'ctab-counter-row');
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustReading(tab, widget, -1); }, { title: 'Back a page', icon: 'fa-minus' }));
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustReading(tab, widget, 1); }, { title: 'Forward a page', icon: 'fa-plus' }));
        row.appendChild(btn('ctab-counter-btn', '', function () { adjustReading(tab, widget, 10); }, { title: 'Forward 10 pages', icon: 'fa-angles-right' }));
        body.appendChild(row);
    }

    // --- Reading: Flashcard of the Day ---

    function renderFlashcardWidget(body, tab, widget) {
        var card = null;
        try { card = bridge.getRandomReviewCard(); } catch (e) { card = null; }
        if (!card) {
            body.appendChild(emptyMsg('No review cards yet — create a deck in Review.'));
            return;
        }
        var cfg = widget.config || {};
        // The reveal is per-day: the card changes with the day-seed, so a sticky
        // boolean would spoil every future card after the first reveal.
        var todayK = localDateKey();
        var revealed = cfg.revealedOn === todayK;
        if (card.deck) body.appendChild(el('p', 'ctab-list-meta', card.deck));
        body.appendChild(el('p', 'ctab-flashcard-prompt', card.prompt || '(no prompt)'));
        if (revealed) {
            body.appendChild(el('p', 'ctab-flashcard-answer', card.answer || '(no answer)'));
        } else if (card.hint) {
            body.appendChild(el('p', 'ctab-list-meta', 'Hint: ' + card.hint));
        }
        var row = el('div', 'ctab-focus-row');
        row.appendChild(btn('ctab-focus-btn', revealed ? 'Hide' : 'Reveal', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                w.config.revealedOn = revealed ? '' : todayK;
                delete w.config.revealed; // retire the pre-2026-07-07 sticky flag
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: revealed ? 'fa-eye-slash' : 'fa-eye' }));
        row.appendChild(btn('ctab-focus-btn', 'Study', function () {
            try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); } catch (e) { /* non-critical */ }
        }, { icon: 'fa-layer-group' }));
        body.appendChild(row);
    }

    // --- Tools: Decision Spinner ---

    function renderDecisionWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var options = Array.isArray(cfg.options) && cfg.options.length ? cfg.options : ['Yes', 'No'];
        body.appendChild(el('div', 'ctab-countdown-big' + (cfg.last ? ' is-soon' : ''), cfg.last ? String(cfg.last) : '—'));
        body.appendChild(btn('ctab-add-btn ctab-decision-spin', 'Spin', function () {
            var pick = options[Math.floor(Math.random() * options.length)];
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = { options: options };
                w.config.last = pick;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: 'fa-dice' }));
        var list = el('div', 'ctab-decision-options');
        options.forEach(function (opt) {
            var chip = el('span', 'ctab-decision-chip');
            chip.appendChild(document.createTextNode(String(opt)));
            chip.appendChild(btn('ctab-item-remove', '', function () {
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w || !w.config || !Array.isArray(w.config.options)) return;
                    w.config.options = w.config.options.filter(function (x) { return x !== opt; });
                }, { rerender: false });
                rerenderWidgetBody(tab.id, widget.id);
            }, { title: 'Remove option', icon: 'fa-xmark' }));
            list.appendChild(chip);
        });
        body.appendChild(list);
        body.appendChild(btn('ctab-add-btn', 'Add option', function () {
            promptText({ title: 'Add option', label: 'Option text', placeholder: 'e.g. Maybe' }).then(function (val) {
                if (val == null) return;
                var text = String(val).trim().slice(0, 40);
                if (!text) return;
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (!w) return;
                    if (!w.config || typeof w.config !== 'object') w.config = { options: ['Yes', 'No'] };
                    if (!Array.isArray(w.config.options)) w.config.options = [];
                    if (w.config.options.length < 20) w.config.options.push(text);
                }, { rerender: false });
                rerenderWidgetBody(tab.id, widget.id);
            });
        }, { icon: 'fa-plus' }));
    }

    // --- Tools: Timer (plain countdown) ---

    function renderTimerWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var banner = el('div', 'ctab-break-banner');
        banner.style.display = 'none';
        var display = el('div', 'ctab-clock-time', '00:00');
        body.appendChild(banner);
        body.appendChild(display);

        function pad(n) { return (n < 10 ? '0' : '') + n; }
        function fmt(ms) {
            var s = Math.max(0, Math.floor(ms / 1000));
            var h = Math.floor(s / 3600);
            var m = Math.floor((s % 3600) / 60);
            var sec = s % 60;
            return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(sec);
        }
        function paint() {
            var rem = cfg.running && cfg.endsAt ? Number(cfg.endsAt) - Date.now() : (Number(cfg.durationMs) || 0);
            if (cfg.running && rem <= 0) {
                banner.style.display = '';
                banner.textContent = 'Time’s up! ⏰';
                display.textContent = '00:00';
                mutateTab(tab.id, function (t) {
                    var w = findWidget(t, widget.id);
                    if (w && w.config) { w.config.running = false; w.config.endsAt = null; }
                }, { rerender: false });
                clearTimer(timerKey(tab.id, widget.id));
                return;
            }
            display.textContent = fmt(rem);
        }
        paint();
        if (cfg.running) startTimer(tab.id, widget.id, paint, 250);

        if (cfg.running) {
            var stopRow = el('div', 'ctab-focus-row');
            stopRow.appendChild(btn('ctab-focus-btn', 'Stop', function () {
                mutateTab(tab.id, function (t) { var w = findWidget(t, widget.id); if (w && w.config) { w.config.running = false; w.config.endsAt = null; } }, { rerender: false });
                rerenderWidgetBody(tab.id, widget.id);
            }, { icon: 'fa-stop' }));
            body.appendChild(stopRow);
        } else {
            var presets = el('div', 'ctab-focus-row');
            [5, 10, 15, 25].forEach(function (min) {
                presets.appendChild(btn('ctab-focus-btn', min + 'm', function () {
                    var ms = min * 60000;
                    mutateTab(tab.id, function (t) {
                        var w = findWidget(t, widget.id);
                        if (!w) return;
                        if (!w.config || typeof w.config !== 'object') w.config = {};
                        w.config.durationMs = ms;
                        w.config.running = true;
                        w.config.endsAt = Date.now() + ms;
                    }, { rerender: false });
                    rerenderWidgetBody(tab.id, widget.id);
                }, { icon: 'fa-play' }));
            });
            body.appendChild(presets);
        }
    }

    // --- Tools: Unit Converter ---

    var UNIT_TABLES = {
        length: { label: 'Length', units: { m: 1, km: 1000, cm: 0.01, mi: 1609.344, ft: 0.3048, in: 0.0254 } },
        mass: { label: 'Mass', units: { kg: 1000, g: 1, lb: 453.592, oz: 28.3495 } },
        temp: { label: 'Temperature', units: { C: 'C', F: 'F', K: 'K' } }
    };

    function convertUnit(cat, value, from, to) {
        if (cat === 'temp') {
            var c = from === 'C' ? value : from === 'F' ? (value - 32) * 5 / 9 : value - 273.15;
            if (to === 'C') return c;
            if (to === 'F') return c * 9 / 5 + 32;
            return c + 273.15;
        }
        var table = UNIT_TABLES[cat].units;
        return value * table[from] / table[to];
    }

    function renderUnitConverterWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var cat = UNIT_TABLES[cfg.category] ? cfg.category : 'length';
        var catSel = document.createElement('select');
        catSel.className = 'ctab-unit-select';
        Object.keys(UNIT_TABLES).forEach(function (k) {
            var o = document.createElement('option');
            o.value = k;
            o.textContent = UNIT_TABLES[k].label;
            if (k === cat) o.selected = true;
            catSel.appendChild(o);
        });
        body.appendChild(catSel);

        var unitKeys = Object.keys(UNIT_TABLES[cat].units);
        var rowIn = el('div', 'ctab-unit-row');
        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'ctab-add-input ctab-unit-input';
        input.value = '1';
        var fromSel = document.createElement('select');
        fromSel.className = 'ctab-unit-select';
        unitKeys.forEach(function (u) { var o = document.createElement('option'); o.value = u; o.textContent = u; fromSel.appendChild(o); });
        rowIn.appendChild(input);
        rowIn.appendChild(fromSel);
        body.appendChild(rowIn);

        var rowOut = el('div', 'ctab-unit-row');
        var output = el('div', 'ctab-unit-output', '—');
        var toSel = document.createElement('select');
        toSel.className = 'ctab-unit-select';
        unitKeys.forEach(function (u) { var o = document.createElement('option'); o.value = u; o.textContent = u; toSel.appendChild(o); });
        if (unitKeys.length > 1) toSel.selectedIndex = 1;
        rowOut.appendChild(output);
        rowOut.appendChild(toSel);
        body.appendChild(rowOut);

        function recompute() {
            var v = Number(input.value);
            if (!isFinite(v)) { output.textContent = '—'; return; }
            var r = convertUnit(cat, v, fromSel.value, toSel.value);
            output.textContent = (Math.round(r * 1e6) / 1e6).toLocaleString();
        }
        input.addEventListener('input', recompute);
        fromSel.addEventListener('change', recompute);
        toSel.addEventListener('change', recompute);
        catSel.addEventListener('change', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                w.config.category = catSel.value;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        });
        recompute();
    }

    // --- Tools: Ask Sutra ---

    function renderAskSutraWidget(body) {
        body.appendChild(el('p', 'ctab-focus-hint', 'Ask Sutra something:'));
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'ctab-add-input';
        input.placeholder = 'e.g. What should I do next?';
        var send = function () {
            var q = input.value.trim();
            if (!q) return;
            var ok = false;
            try { ok = bridge.askAssistant(q); } catch (e) { ok = false; }
            if (ok) input.value = '';
            else input.placeholder = 'Assistant unavailable right now';
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
        var row = el('div', 'ctab-add-row');
        row.appendChild(input);
        row.appendChild(btn('ctab-add-btn', 'Ask', send, { icon: 'fa-paper-plane' }));
        body.appendChild(row);
    }

    // --- Focus: Streak Garden ---

    function streakPlant(days) {
        if (days <= 0) return '🌰';
        if (days < 3) return '🌱';
        if (days < 7) return '🌿';
        if (days < 14) return '🪴';
        if (days < 30) return '🌷';
        return '🌳';
    }

    function renderStreakGardenWidget(body) {
        var s = { current: 0, best: 0 };
        try { s = bridge.getStreak() || s; } catch (e) { /* non-critical */ }
        body.appendChild(el('div', 'ctab-streak-garden', streakPlant(s.current)));
        body.appendChild(el('div', 'ctab-countdown-big' + (s.current > 0 ? ' is-soon' : ''), String(s.current)));
        body.appendChild(el('p', 'ctab-countdown-sub', 'day streak'));
        body.appendChild(el('p', 'ctab-list-meta', 'Best: ' + s.best + ' days — keep it growing!'));
    }

    // --- Focus: Contribution Grid (custom metric) ---

    function setupContribGridWidget() {
        return promptText({ title: 'Contribution grid', label: 'What are you tracking?', placeholder: 'e.g. Practice sessions' }).then(function (label) {
            if (label == null) return null;
            return { label: String(label).trim().slice(0, 40) || 'Activity', log: {} };
        });
    }

    function renderContribGridWidget(body, tab, widget) {
        var cfg = widget.config || {};
        var log = (cfg.log && typeof cfg.log === 'object') ? cfg.log : {};
        body.appendChild(el('p', 'ctab-countdown-title', String(cfg.label || 'Activity')));
        var days = 35;
        var values = [];
        var total = 0;
        for (var i = days - 1; i >= 0; i -= 1) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var key = localDateKey(d);
            var v = Number(log[key]) || 0;
            total += v;
            values.push({ key: key, value: v });
        }
        var max = 1;
        values.forEach(function (p) { if (p.value > max) max = p.value; });
        var grid = el('div', 'ctab-import-heatmap ctab-contrib-heatmap');
        values.forEach(function (p) {
            var lvl = p.value === 0 ? 0 : Math.min(4, Math.ceil((p.value / max) * 4));
            var cell = el('span', 'ctab-import-heat-cell level-' + lvl);
            cell.title = p.key + ': ' + p.value;
            grid.appendChild(cell);
        });
        body.appendChild(grid);
        body.appendChild(el('p', 'ctab-progress-label', total + ' in 35 days'));
        var row = el('div', 'ctab-counter-row');
        row.appendChild(btn('ctab-add-btn', '+1 today', function () {
            var todayK = localDateKey();
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w) return;
                if (!w.config || typeof w.config !== 'object') w.config = {};
                if (!w.config.log || typeof w.config.log !== 'object') w.config.log = {};
                w.config.log[todayK] = (Number(w.config.log[todayK]) || 0) + 1;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { icon: 'fa-plus' }));
        row.appendChild(btn('ctab-counter-btn', '', function () {
            var todayK = localDateKey();
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (!w || !w.config || !w.config.log) return;
                var cur = Number(w.config.log[todayK]) || 0;
                if (cur <= 1) delete w.config.log[todayK]; else w.config.log[todayK] = cur - 1;
            }, { rerender: false });
            rerenderWidgetBody(tab.id, widget.id);
        }, { title: 'Undo one', icon: 'fa-minus' }));
        body.appendChild(row);
    }

    // Register the interactive widgets (function declarations above are hoisted).
    var INTERACTIVE_WIDGET_SPECS = [
        { type: 'water', label: 'Water Tracker', icon: 'fa-glass-water', cat: 'wellness', desc: 'Count glasses toward a daily goal.', render: renderWaterWidget, setup: setupWaterWidget },
        { type: 'eyebreak', label: '20-20-20 Breaks', icon: 'fa-eye', cat: 'wellness', desc: 'Eye-rest reminders while you work.', render: renderEyeBreakWidget },
        { type: 'gratitude', label: 'Gratitude Prompt', icon: 'fa-heart', cat: 'wellness', desc: 'One line a day, with a rotating prompt.', render: renderGratitudeWidget },
        { type: 'reading', label: 'Currently Reading', icon: 'fa-book-open', cat: 'reading', desc: 'Track pages through a book.', render: renderReadingWidget, setup: setupReadingWidget },
        { type: 'flashcard', label: 'Flashcard of the Day', icon: 'fa-clone', cat: 'reading', desc: 'One card from your decks to review.', render: renderFlashcardWidget },
        { type: 'decision', label: 'Decision Spinner', icon: 'fa-dice', cat: 'tools', desc: 'Let chance pick from your options.', render: renderDecisionWidget },
        { type: 'timer', label: 'Timer', icon: 'fa-hourglass-end', cat: 'tools', desc: 'A plain countdown with an alert.', render: renderTimerWidget },
        { type: 'unitconv', label: 'Unit Converter', icon: 'fa-ruler-combined', cat: 'tools', desc: 'Length, mass, and temperature.', render: renderUnitConverterWidget },
        { type: 'asksutra', label: 'Ask Sutra', icon: 'fa-wand-magic-sparkles', cat: 'tools', desc: 'Fire a quick question at the assistant.', render: renderAskSutraWidget },
        { type: 'streakgarden', label: 'Streak Garden', icon: 'fa-seedling', cat: 'focus', desc: 'A plant that grows with your streak.', render: renderStreakGardenWidget },
        { type: 'contribgrid', label: 'Contribution Grid', icon: 'fa-table-cells', cat: 'focus', desc: 'A tap-to-log GitHub-style grid.', render: renderContribGridWidget, setup: setupContribGridWidget }
    ];

    INTERACTIVE_WIDGET_SPECS.forEach(function (spec) {
        WIDGET_TYPES[spec.type] = {
            label: spec.label,
            icon: spec.icon,
            cat: spec.cat,
            desc: spec.desc,
            render: spec.render,
            setup: spec.setup
        };
    });

    // ---------- widget card frame + grid ----------

    function renderWidgetCard(tab, widget) {
        var spec = WIDGET_TYPES[widget.type];
        var wide = widget.wide === true || (spec && spec.fullWidth === true);
        var card = el('article', 'ctab-widget' + (wide ? ' is-wide' : ''));
        card.dataset.widgetId = widget.id;

        var head = el('header', 'ctab-widget-head');
        var title = el('span', 'ctab-widget-label');
        title.appendChild(faIcon(spec ? spec.icon : 'fa-puzzle-piece'));
        title.appendChild(document.createTextNode(' ' + (spec ? spec.label : 'Unavailable widget')));
        head.appendChild(title);

        var controls = el('span', 'ctab-widget-controls');
        if (widget.type === 'html') {
            controls.appendChild(btn('ctab-ctrl', '', function () {
                editHtmlWidget(tab.id, widget.id);
            }, { title: 'Edit HTML widget', icon: 'fa-pen' }));
        }
        controls.appendChild(btn('ctab-ctrl', '', function () { moveWidget(tab.id, widget.id, -1); }, { title: 'Move earlier', icon: 'fa-arrow-left' }));
        controls.appendChild(btn('ctab-ctrl', '', function () { moveWidget(tab.id, widget.id, 1); }, { title: 'Move later', icon: 'fa-arrow-right' }));
        controls.appendChild(btn('ctab-ctrl', '', function () {
            mutateTab(tab.id, function (t) {
                var w = findWidget(t, widget.id);
                if (w) w.wide = w.wide !== true;
            });
        }, { title: 'Toggle width', icon: 'fa-left-right' }));
        controls.appendChild(btn('ctab-ctrl is-danger', '', function () {
            mutateTab(tab.id, function (t) {
                t.widgets = (t.widgets || []).filter(function (w) { return w.id !== widget.id; });
            });
        }, { title: 'Remove widget', icon: 'fa-xmark' }));
        head.appendChild(controls);
        card.appendChild(head);

        var body = el('div', 'ctab-widget-body');
        card.appendChild(body);
        renderWidgetBody(body, tab, widget);
        return card;
    }

    function renderWidgetBody(body, tab, widget) {
        // Kill any live tick (clock/stopwatch) from the previous render of this
        // widget before we tear the body down and rebuild it.
        clearTimer(timerKey(tab.id, widget.id));
        while (body.firstChild) body.removeChild(body.firstChild);
        var spec = WIDGET_TYPES[widget.type];
        if (!spec) {
            // Forward compat: a widget type from a newer version — keep the data,
            // explain rather than crash or silently drop.
            body.appendChild(emptyMsg('This widget ("' + String(widget.type) + '") isn’t available in this version.'));
            return;
        }
        try {
            spec.render(body, tab, widget);
        } catch (e) {
            console.warn('SutraCustomTabs: widget render failed', widget.type, e);
            body.appendChild(emptyMsg('This widget hit an error.'));
        }
    }

    function rerenderWidgetBody(tabId, widgetId, opts) {
        var tabs = getTabs();
        var tab = null;
        for (var i = 0; i < tabs.length; i += 1) {
            if (tabs[i] && tabs[i].id === tabId) { tab = tabs[i]; break; }
        }
        if (!tab) return;
        var widget = findWidget(tab, widgetId);
        var section = document.getElementById('view-custom-' + tabId);
        if (!widget || !section) return;
        var card = section.querySelector('.ctab-widget[data-widget-id="' + widgetId + '"]');
        if (!card) return;
        var body = card.querySelector('.ctab-widget-body');
        if (!body) return;
        renderWidgetBody(body, tab, widget);
        if (opts && opts.focusAdd) {
            var input = body.querySelector('.ctab-add-input');
            if (input) input.focus();
        }
    }

    function moveWidget(tabId, widgetId, delta) {
        mutateTab(tabId, function (t) {
            var list = Array.isArray(t.widgets) ? t.widgets : [];
            var idx = -1;
            for (var i = 0; i < list.length; i += 1) {
                if (list[i] && list[i].id === widgetId) { idx = i; break; }
            }
            if (idx === -1) return;
            var next = idx + delta;
            if (next < 0 || next >= list.length) return;
            var tmp = list[idx];
            list[idx] = list[next];
            list[next] = tmp;
        });
    }

    // ---------- add-widget picker (modal contract: data-modal-close, Escape, focus restore) ----------

    function openWidgetPicker(tab) {
        var previouslyFocused = document.activeElement;
        var overlay = el('div', 'ctab-picker-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Add a widget');

        var panel = el('div', 'ctab-picker-panel');
        var head = el('header', 'ctab-picker-head');
        head.appendChild(el('h3', 'ctab-picker-title', 'Add a widget'));
        var closeBtn = btn('ctab-picker-close', '', close, { title: 'Close', icon: 'fa-xmark' });
        closeBtn.setAttribute('data-modal-close', '');
        head.appendChild(closeBtn);
        panel.appendChild(head);

        // Group widget options by category so a large palette stays scannable.
        CATEGORIES.forEach(function (category) {
            var types = Object.keys(WIDGET_TYPES).filter(function (type) { return WIDGET_TYPES[type].cat === category.key; });
            if (!types.length) return;
            panel.appendChild(el('h4', 'ctab-picker-cat', category.label));
            var grid = el('div', 'ctab-picker-grid');
            types.forEach(function (type) {
                var spec = WIDGET_TYPES[type];
                var option = btn('ctab-picker-option', '', function () { pick(type); });
                option.appendChild(faIcon(spec.icon));
                option.appendChild(el('strong', 'ctab-picker-option-label', spec.label));
                option.appendChild(el('span', 'ctab-picker-option-desc', spec.desc));
                grid.appendChild(option);
            });
            panel.appendChild(grid);
        });
        overlay.appendChild(panel);

        function onKeydown(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }

        function close() {
            document.removeEventListener('keydown', onKeydown, true);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch (e) { /* non-critical */ }
            }
        }

        function pick(type) {
            var spec = WIDGET_TYPES[type];
            var finish = function (config) {
                mutateTab(tab.id, function (t) {
                    if (!Array.isArray(t.widgets)) t.widgets = [];
                    if (t.widgets.length >= MAX_WIDGETS_PER_TAB) return;
                    t.widgets.push({ id: makeId('cw'), type: type, config: config || null, wide: false });
                });
            };
            close();
            if (spec.setup) {
                spec.setup().then(function (config) {
                    if (config === null) return; // user cancelled setup
                    finish(config);
                });
            } else {
                finish(null);
            }
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKeydown, true);
        document.body.appendChild(overlay);
        closeBtn.focus();
    }

    // ---------- tab CRUD ----------

    function createTab() {
        var tabs = getTabs();
        if (tabs.length >= MAX_TABS) {
            confirmDialog({ title: 'Tab limit reached', message: 'You can have up to ' + MAX_TABS + ' custom tabs. Delete one to make room.', confirmText: 'OK', cancelText: '', hideCancel: true });
            return;
        }
        promptText({ title: 'New tab', label: 'Name your tab', placeholder: 'e.g. Morning Dashboard' }).then(function (name) {
            if (name == null) return;
            var trimmed = String(name).trim().slice(0, 40);
            if (!trimmed) return;
            var next = clone(getTabs()) || [];
            var tab = {
                id: makeId('ct'),
                name: trimmed,
                icon: TAB_ICON_CYCLE[next.length % TAB_ICON_CYCLE.length],
                widgets: []
            };
            next.push(tab);
            saveTabs(next);
            if (typeof window.setActiveView === 'function') window.setActiveView('custom-' + tab.id);
        });
    }

    function renameTab(tabId) {
        var tabs = getTabs();
        var current = null;
        for (var i = 0; i < tabs.length; i += 1) {
            if (tabs[i] && tabs[i].id === tabId) { current = tabs[i]; break; }
        }
        if (!current) return;
        promptText({ title: 'Rename tab', label: 'Tab name', defaultValue: current.name }).then(function (name) {
            if (name == null) return;
            var trimmed = String(name).trim().slice(0, 40);
            if (!trimmed) return;
            mutateTab(tabId, function (t) { t.name = trimmed; });
        });
    }

    function deleteTab(tabId) {
        var tabs = getTabs();
        var current = null;
        for (var i = 0; i < tabs.length; i += 1) {
            if (tabs[i] && tabs[i].id === tabId) { current = tabs[i]; break; }
        }
        if (!current) return;
        confirmDialog({
            title: 'Delete tab',
            message: 'Delete "' + current.name + '" and its widgets? Your notes, tasks, and habits are NOT affected — only this tab layout.',
            confirmText: 'Delete Tab',
            cancelText: 'Keep Tab'
        }).then(function (confirmed) {
            if (!confirmed) return;
            var wasActive = document.body.dataset.view === 'custom-' + tabId;
            var next = (clone(getTabs()) || []).filter(function (t) { return t.id !== tabId; });
            saveTabs(next);
            if (wasActive && typeof window.setActiveView === 'function') window.setActiveView('today');
        });
    }

    // ---------- tab section rendering ----------

    function renderTabSection(section, tab) {
        // Any widgets we're about to tear down may own live intervals; clear the
        // whole tab's timers (covers removed widgets that won't re-register).
        clearTimersForTab(tab.id);
        while (section.firstChild) section.removeChild(section.firstChild);
        var editing = editingTabs[tab.id] === true;
        section.classList.toggle('is-editing', editing);

        var head = el('header', 'ctab-head');
        var title = el('h2', 'ctab-title');
        if (tab.icon) title.appendChild(faIcon(tab.icon));
        title.appendChild(document.createTextNode(' ' + tab.name));
        head.appendChild(title);

        var actions = el('div', 'ctab-actions');
        actions.appendChild(btn('ctab-action', 'Add widget', function () { openWidgetPicker(tab); }, { icon: 'fa-plus' }));
        actions.appendChild(btn('ctab-action' + (editing ? ' is-active' : ''), editing ? 'Done' : 'Edit', function () {
            editingTabs[tab.id] = !editing;
            renderTabSection(section, tab);
        }, { icon: editing ? 'fa-check' : 'fa-pen' }));
        actions.appendChild(btn('ctab-action', 'Rename', function () { renameTab(tab.id); }, { icon: 'fa-i-cursor' }));
        actions.appendChild(btn('ctab-action is-danger', 'Delete', function () { deleteTab(tab.id); }, { icon: 'fa-trash' }));
        head.appendChild(actions);
        section.appendChild(head);

        var widgets = Array.isArray(tab.widgets) ? tab.widgets : [];
        if (!widgets.length) {
            var zero = el('div', 'ctab-zero');
            zero.appendChild(el('p', 'ctab-zero-msg', 'This tab is a blank canvas. Add widgets to build your own dashboard.'));
            zero.appendChild(btn('ctab-zero-btn', 'Add your first widget', function () { openWidgetPicker(tab); }, { icon: 'fa-plus' }));
            section.appendChild(zero);
            return;
        }
        var grid = el('div', 'ctab-grid');
        widgets.forEach(function (widget) {
            grid.appendChild(renderWidgetCard(tab, widget));
        });
        section.appendChild(grid);
    }

    // ---------- nav + sections lifecycle ----------

    function rebuildNav() {
        document.querySelectorAll('.view-tab[data-custom-tab]').forEach(function (n) { n.parentNode.removeChild(n); });
        var oldAdd = document.getElementById('customTabAddBtn');
        if (oldAdd && oldAdd.parentNode) oldAdd.parentNode.removeChild(oldAdd);

        var row = document.querySelector('.view-tabs');
        if (!row) return;
        // Insert custom tabs just before the Settings tab so built-in ordering
        // stays stable and the overflow wrapper stays last.
        var anchor = row.querySelector('.view-tab[data-view="settings"]') || row.querySelector('.view-more');
        var activeCustom = String(document.body.dataset.view || '');

        getTabs().forEach(function (tab) {
            var tabBtn = el('button', 'view-tab' + (activeCustom === 'custom-' + tab.id ? ' active' : ''));
            tabBtn.type = 'button';
            tabBtn.dataset.view = 'custom-' + tab.id;
            tabBtn.dataset.customTab = tab.id;
            if (tab.icon) tabBtn.appendChild(faIcon(tab.icon));
            tabBtn.appendChild(document.createTextNode((tab.icon ? ' ' : '') + tab.name));
            if (anchor) row.insertBefore(tabBtn, anchor);
            else row.appendChild(tabBtn);
        });

        var addBtn = btn('view-tab-add', '', createTab, { title: 'New custom tab', icon: 'fa-plus' });
        addBtn.id = 'customTabAddBtn';
        if (anchor) row.insertBefore(addBtn, anchor);
        else row.appendChild(addBtn);
    }

    function rebuildSections() {
        var live = {};
        getTabs().forEach(function (tab) { live[tab.id] = tab; });
        document.querySelectorAll('section.view[data-custom-tab]').forEach(function (sec) {
            if (!live[sec.dataset.customTab]) sec.parentNode.removeChild(sec);
        });
        var anyView = document.querySelector('section.view');
        var host = anyView ? anyView.parentElement : null;
        if (!host) return;
        getTabs().forEach(function (tab) {
            var id = 'view-custom-' + tab.id;
            var sec = document.getElementById(id);
            if (!sec) {
                sec = document.createElement('section');
                sec.id = id;
                sec.className = 'view view-custom-tab';
                sec.dataset.customTab = tab.id;
                sec.style.display = 'none';
                host.appendChild(sec);
            }
            renderTabSection(sec, tab);
        });
    }

    function rebuild() {
        rebuildNav();
        rebuildSections();
        // If a custom tab is (or should be) active, re-run setActiveView so the
        // freshly-built section receives the .active/display state; if the tab
        // was deleted, land safely on Today.
        var current = String(document.body.dataset.view || '');
        if (current.indexOf('custom-') === 0) {
            var tabId = current.slice('custom-'.length);
            var exists = getTabs().some(function (t) { return t.id === tabId; });
            if (typeof window.setActiveView === 'function') {
                window.setActiveView(exists ? current : 'today');
            }
        }
        // Let the mobile bottom nav + overflow menu resync against the new tab row.
        try {
            window.dispatchEvent(new CustomEvent('noteflow:view-changed', { detail: { view: document.body.dataset.view || '' } }));
        } catch (e) { /* non-critical */ }
    }

    // ---------- init ----------

    function bindGlobalHandlers() {
        // Delegated so overflow-menu clones of custom tab buttons work too.
        document.addEventListener('click', function (e) {
            var target = e.target && e.target.closest ? e.target.closest('.view-tab[data-view^="custom-"]') : null;
            if (!target) return;
            if (typeof window.setActiveView === 'function') window.setActiveView(target.dataset.view);
        });
        // Refresh live-data widgets when the user lands on a custom tab.
        window.addEventListener('noteflow:view-changed', function (e) {
            var view = e && e.detail ? String(e.detail.view || '') : '';
            // Leaving any custom tab: stop every live tick so hidden clocks and
            // stopwatches don't keep firing intervals in the background. The
            // destination tab's render re-establishes only its own timers.
            clearAllTimers();
            if (view.indexOf('custom-') !== 0) return;
            var tabId = view.slice('custom-'.length);
            var section = document.getElementById('view-custom-' + tabId);
            var tabs = getTabs();
            for (var i = 0; i < tabs.length; i += 1) {
                if (tabs[i] && tabs[i].id === tabId && section) {
                    renderTabSection(section, tabs[i]);
                    break;
                }
            }
        });
        // Core signals a wholesale replacement (workspace import/restore).
        window.addEventListener('sutra:custom-tabs-changed', function () {
            editingTabs = {};
            rebuild();
        });
        window.addEventListener('sutra:quotes-changed', function () {
            rebuildSections();
        });
    }

    function init() {
        if (initialized) return;
        bridge = window.SutraCustomTabsBridge;
        if (!bridge || !document.querySelector('.view-tabs') || !document.querySelector('section.view')) return;
        if (typeof bridge.setTabs === 'function') {
            rawBridgeSetTabs = bridge.setTabs;
            bridge.setTabs = function (nextTabs) {
                return rawBridgeSetTabs.call(bridge, normalizeCustomTabsForFeature(nextTabs));
            };
        }
        initialized = true;
        bindGlobalHandlers();
        rebuildNav();
        rebuildSections();
        // If the last-active view was a custom tab, its section didn't exist when
        // the core restored the view at boot — re-activate it now that it does.
        var current = String(document.body.dataset.view || '');
        if (current.indexOf('custom-') === 0) {
            var tabId = current.slice('custom-'.length);
            var exists = getTabs().some(function (t) { return t.id === tabId; });
            if (typeof window.setActiveView === 'function') {
                window.setActiveView(exists ? current : 'today');
            }
        }
    }

    function waitForApp(attempt) {
        init();
        if (initialized) return;
        if (attempt > 100) {
            console.warn('SutraCustomTabs: core bridge never became available; custom tabs disabled this session.');
            return;
        }
        setTimeout(function () { waitForApp(attempt + 1); }, 200);
    }

    window.SutraCustomTabs = {
        refresh: rebuild,
        getWidgetTypes: function () {
            return Object.keys(WIDGET_TYPES).map(function (k) {
                return { type: k, label: WIDGET_TYPES[k].label, desc: WIDGET_TYPES[k].desc, cat: WIDGET_TYPES[k].cat };
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { waitForApp(0); });
    } else {
        waitForApp(0);
    }
})();
