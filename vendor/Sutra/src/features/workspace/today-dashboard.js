/*
 * today-dashboard.js — customizable composition for the Today command center.
 *
 * The module owns presentation preferences only. Existing Today renderers keep
 * owning every card's data and actions; this controller reorders the canonical
 * DOM nodes and applies visibility/size classes. Persistence is injected by
 * app.js so dashboard choices travel through the normal workspace save, export,
 * backup, and Sync paths.
 */
(function () {
    'use strict';

    var VERSION = 3;
    var SIZE_KEYS = ['compact', 'standard', 'wide'];

    var WIDGETS = [
        { id: 'next-up', label: 'Next up', description: 'Your single best next action and deadline counts.', group: 'hero', selector: '.today-nextup-card', container: '.today-hero-row', sizes: ['standard', 'wide'] },
        { id: 'upcoming-radar', label: 'Upcoming Radar', description: 'A visual scan of work coming due.', group: 'hero', selector: '.today-radar-card', container: '.today-hero-row', sizes: ['standard', 'wide'] },
        { id: 'today-plan', label: "Today's Plan", description: 'Scheduled blocks and the day timeline.', group: 'glance', selector: '#tccPlanCard', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'assignments', label: 'Assignments', description: 'Upcoming homework and coursework.', group: 'glance', selector: '#tccAttentionAssignments', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'calendar', label: 'Calendar', description: 'Events and time blocks scheduled today.', group: 'glance', selector: '#tccAttentionCalendar', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'tasks', label: 'Tasks', description: 'Open tasks from across the workspace.', group: 'glance', selector: '#tccAttentionTasks', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'review', label: 'Review', description: 'Review cards due today.', group: 'glance', selector: '#todayReviewCard', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'tests', label: 'Tests & quizzes', description: 'Upcoming assessments and study entry points.', group: 'glance', selector: '#tccUpcomingTests', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'tonight', label: 'Tonight plan', description: 'Evening availability for a study block.', group: 'glance', selector: '#tccTonightPlan', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'backup', label: 'Save & backup', description: 'Local save and backup confidence.', group: 'glance', selector: '#tccBackupHealth', container: '.today-info-grid', sizes: SIZE_KEYS },
        { id: 'priorities', label: 'Priorities', description: 'Committed work and Shape My Day controls.', group: 'glance', selector: '.today-plan-section', container: '.today-info-grid', sizes: ['wide'] },
        { id: 'habits', label: 'Habits', description: 'Daily routines alongside schoolwork.', group: 'signals', selector: '.today-panel-habits', container: '.today-signals-grid', sizes: ['standard', 'wide'] },
        { id: 'tracker', label: 'Tracker summary', description: 'A compact summary of life trackers.', group: 'signals', selector: '#todayTrackerSummary', container: '.today-signals-grid', sizes: ['standard', 'wide'] },
        { id: 'completed', label: 'Completed today', description: 'A collapsible record of finished work.', group: 'fixed', selector: '.today-completed-strip', container: '.today-signals-section', sizes: ['standard'], movable: false },
        { id: 'life-signals', label: 'Life signals', description: 'Cross-workspace activity and readiness metrics.', group: 'advanced', selector: '#todayJumpCollapsible', container: '.today-cc-layout', sizes: ['wide'] },
        { id: 'academic-planner', label: 'Academic Planner', description: 'Detailed deadlines and coursework tools.', group: 'advanced', selector: '#todayAcademicCollapsible', container: '.today-cc-layout', sizes: ['wide'] },
        { id: 'momentum', label: 'Momentum', description: 'Completion, streak, and category analytics.', group: 'advanced', selector: '#todayAnalyticsCollapsible', container: '.today-cc-layout', sizes: ['wide'] }
    ];

    var WIDGET_IDS = WIDGETS.map(function (widget) { return widget.id; });
    var WIDGET_BY_ID = WIDGETS.reduce(function (map, widget) {
        map[widget.id] = widget;
        return map;
    }, {});

    var PRESETS = {
        calm: {
            label: 'Calm',
            description: 'Next up, Radar, priorities, quick task capture, and save confidence without duplicate cards.',
            order: WIDGET_IDS.slice(),
            hidden: ['today-plan', 'assignments', 'calendar', 'review', 'tests', 'tonight', 'habits', 'tracker', 'completed', 'life-signals', 'academic-planner', 'momentum'],
            sizes: { 'next-up': 'standard', 'upcoming-radar': 'standard', 'priorities': 'wide' }
        },
        study: {
            label: 'Study',
            description: 'Assignments, review, tests, and planning lead the page.',
            order: ['next-up', 'upcoming-radar', 'assignments', 'review', 'tests', 'today-plan', 'calendar', 'priorities', 'tasks', 'backup', 'tonight', 'habits', 'tracker', 'completed', 'life-signals', 'academic-planner', 'momentum'],
            hidden: ['tasks', 'tonight', 'habits', 'tracker', 'completed', 'life-signals', 'academic-planner', 'momentum'],
            sizes: { assignments: 'wide', review: 'standard', tests: 'standard', priorities: 'wide' }
        },
        everything: {
            label: 'Everything',
            description: 'Show every Home widget and advanced section.',
            order: WIDGET_IDS.slice(),
            hidden: [],
            sizes: { priorities: 'wide' }
        }
    };

    var options = {};
    var initialized = false;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function uniqueKnownIds(values) {
        var seen = {};
        return (Array.isArray(values) ? values : []).reduce(function (result, value) {
            var id = String(value || '');
            if (!WIDGET_BY_ID[id] || seen[id]) return result;
            seen[id] = true;
            result.push(id);
            return result;
        }, []);
    }

    function normalizedOrder(values, fallback) {
        var order = uniqueKnownIds(Array.isArray(values) ? values : fallback);
        WIDGET_IDS.forEach(function (id) {
            if (order.indexOf(id) === -1) order.push(id);
        });
        return order;
    }

    function normalizeSizes(rawSizes, fallbackSizes) {
        var source = rawSizes && typeof rawSizes === 'object' ? rawSizes : {};
        var fallback = fallbackSizes && typeof fallbackSizes === 'object' ? fallbackSizes : {};
        return WIDGETS.reduce(function (result, widget) {
            var allowed = Array.isArray(widget.sizes) && widget.sizes.length ? widget.sizes : ['standard'];
            var requested = String(source[widget.id] || fallback[widget.id] || allowed[0]);
            result[widget.id] = allowed.indexOf(requested) !== -1 ? requested : allowed[0];
            return result;
        }, {});
    }

    function getPresetPreferences(name) {
        var key = Object.prototype.hasOwnProperty.call(PRESETS, name) ? name : 'calm';
        var preset = PRESETS[key];
        return {
            version: VERSION,
            preset: key,
            order: normalizedOrder(preset.order, WIDGET_IDS),
            hidden: uniqueKnownIds(preset.hidden),
            sizes: normalizeSizes(preset.sizes, {})
        };
    }

    function getDefaultPreferences() {
        return getPresetPreferences('calm');
    }

    function normalizePreferences(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        var presetKey = Object.prototype.hasOwnProperty.call(PRESETS, source.preset) ? source.preset : (source.preset === 'custom' ? 'custom' : 'calm');
        // Calm is a named preset, not a user-customized layout. When the
        // default composition changes, migrate an older saved Calm snapshot
        // to the new essentials-only composition. Custom layouts retain every
        // explicit user choice, including hidden widgets and ordering.
        if (presetKey === 'calm' && Number(source.version) < VERSION) return getPresetPreferences('calm');
        var base = getPresetPreferences(presetKey === 'custom' ? 'calm' : presetKey);
        return {
            version: VERSION,
            preset: presetKey,
            order: normalizedOrder(source.order, base.order),
            hidden: Array.isArray(source.hidden) ? uniqueKnownIds(source.hidden) : base.hidden.slice(),
            sizes: normalizeSizes(source.sizes, base.sizes)
        };
    }

    function currentPreferences() {
        var fallback = getDefaultPreferences();
        if (typeof options.getPreferences !== 'function') return fallback;
        try { return normalizePreferences(options.getPreferences()); }
        catch (error) { return fallback; }
    }

    function persist(next, announcement) {
        var normalized = normalizePreferences(next);
        if (typeof options.setPreferences === 'function') options.setPreferences(normalized);
        applyPreferences(normalized);
        renderCustomizer(normalized);
        if (announcement) announce(announcement);
        return normalized;
    }

    function announce(message) {
        var live = typeof document !== 'undefined' ? document.getElementById('todayDashboardLive') : null;
        if (live) live.textContent = String(message || '');
        if (typeof options.announce === 'function') options.announce(String(message || ''));
    }

    function resolveWidget(widget) {
        var view = document.getElementById('view-today');
        return view ? view.querySelector(widget.selector) : null;
    }

    function applyPreferences(raw) {
        if (typeof document === 'undefined') return normalizePreferences(raw);
        var preferences = normalizePreferences(raw || currentPreferences());
        var hidden = {};
        preferences.hidden.forEach(function (id) { hidden[id] = true; });

        var grouped = {};
        preferences.order.forEach(function (id) {
            var widget = WIDGET_BY_ID[id];
            if (!widget || widget.movable === false) return;
            if (!grouped[widget.group]) grouped[widget.group] = [];
            grouped[widget.group].push(widget);
        });

        Object.keys(grouped).forEach(function (group) {
            grouped[group].forEach(function (widget) {
                var node = resolveWidget(widget);
                var container = document.querySelector('#view-today ' + widget.container);
                if (node && container && node.parentElement === container) container.appendChild(node);
            });
        });

        WIDGETS.forEach(function (widget) {
            var node = resolveWidget(widget);
            if (!node) return;
            node.setAttribute('data-today-widget-id', widget.id);
            node.classList.toggle('today-widget-hidden', !!hidden[widget.id]);
            if (hidden[widget.id]) {
                node.setAttribute('aria-hidden', 'true');
                node.setAttribute('inert', '');
            } else {
                node.removeAttribute('aria-hidden');
                node.removeAttribute('inert');
            }
            SIZE_KEYS.forEach(function (size) { node.classList.remove('today-widget-size-' + size); });
            node.classList.add('today-widget-size-' + preferences.sizes[widget.id]);
        });

        var summary = document.getElementById('todayDashboardSummary');
        if (summary) {
            var visibleCount = WIDGET_IDS.length - preferences.hidden.length;
            var presetLabel = PRESETS[preferences.preset] ? PRESETS[preferences.preset].label : 'Custom';
            summary.textContent = presetLabel + ' layout · ' + visibleCount + ' widgets shown';
        }
        document.querySelectorAll('[data-today-dashboard-preset]').forEach(function (button) {
            var active = button.getAttribute('data-today-dashboard-preset') === preferences.preset;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        return preferences;
    }

    function createButton(className, label, title) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        if (title) button.title = title;
        return button;
    }

    function renderCustomizer(raw) {
        if (typeof document === 'undefined') return;
        var mount = document.getElementById('todayDashboardWidgetList');
        if (!mount) return;
        var preferences = normalizePreferences(raw || currentPreferences());
        var hidden = {};
        preferences.hidden.forEach(function (id) { hidden[id] = true; });
        while (mount.firstChild) mount.removeChild(mount.firstChild);

        var groupLabels = { hero: 'Start here', glance: 'At a glance', signals: 'Signals', fixed: 'Progress', advanced: 'Advanced' };
        ['hero', 'glance', 'signals', 'fixed', 'advanced'].forEach(function (group) {
            var ids = preferences.order.filter(function (id) { return WIDGET_BY_ID[id] && WIDGET_BY_ID[id].group === group; });
            if (!ids.length) return;
            var section = document.createElement('section');
            section.className = 'today-dashboard-group';
            var heading = document.createElement('h3');
            heading.textContent = groupLabels[group];
            section.appendChild(heading);

            ids.forEach(function (id, index) {
                var widget = WIDGET_BY_ID[id];
                var row = document.createElement('div');
                row.className = 'today-dashboard-widget-row';
                row.setAttribute('data-widget-id', id);

                var visibility = document.createElement('label');
                visibility.className = 'today-dashboard-widget-visibility';
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !hidden[id];
                checkbox.setAttribute('data-widget-visibility', id);
                var copy = document.createElement('span');
                copy.className = 'today-dashboard-widget-copy';
                var name = document.createElement('strong');
                name.textContent = widget.label;
                var description = document.createElement('small');
                description.textContent = widget.description;
                copy.appendChild(name);
                copy.appendChild(description);
                visibility.appendChild(checkbox);
                visibility.appendChild(copy);
                row.appendChild(visibility);

                var controls = document.createElement('div');
                controls.className = 'today-dashboard-widget-controls';
                if (widget.sizes.length > 1) {
                    var select = document.createElement('select');
                    select.setAttribute('data-widget-size', id);
                    select.setAttribute('aria-label', widget.label + ' width');
                    widget.sizes.forEach(function (size) {
                        var option = document.createElement('option');
                        option.value = size;
                        option.textContent = size.charAt(0).toUpperCase() + size.slice(1);
                        option.selected = preferences.sizes[id] === size;
                        select.appendChild(option);
                    });
                    controls.appendChild(select);
                }
                if (widget.movable !== false) {
                    var up = createButton('today-dashboard-move', '↑', 'Move ' + widget.label + ' earlier');
                    up.setAttribute('aria-label', 'Move ' + widget.label + ' earlier');
                    up.setAttribute('data-widget-move', id);
                    up.setAttribute('data-direction', '-1');
                    up.disabled = index === 0;
                    controls.appendChild(up);
                    var down = createButton('today-dashboard-move', '↓', 'Move ' + widget.label + ' later');
                    down.setAttribute('aria-label', 'Move ' + widget.label + ' later');
                    down.setAttribute('data-widget-move', id);
                    down.setAttribute('data-direction', '1');
                    down.disabled = index === ids.length - 1;
                    controls.appendChild(down);
                }
                row.appendChild(controls);
                section.appendChild(row);
            });
            mount.appendChild(section);
        });
    }

    function setVisibility(id, visible) {
        var current = currentPreferences();
        var hidden = current.hidden.filter(function (widgetId) { return widgetId !== id; });
        if (!visible) hidden.push(id);
        current.hidden = hidden;
        current.preset = 'custom';
        persist(current, (visible ? 'Showing ' : 'Hiding ') + WIDGET_BY_ID[id].label + '.');
    }

    function setSize(id, size) {
        var current = currentPreferences();
        current.sizes[id] = size;
        current.preset = 'custom';
        persist(current, WIDGET_BY_ID[id].label + ' set to ' + size + ' width.');
    }

    function moveWidget(id, direction) {
        var current = currentPreferences();
        var widget = WIDGET_BY_ID[id];
        if (!widget || widget.movable === false) return;
        var sameGroup = current.order.filter(function (candidate) {
            return WIDGET_BY_ID[candidate] && WIDGET_BY_ID[candidate].group === widget.group;
        });
        var index = sameGroup.indexOf(id);
        var targetId = sameGroup[index + direction];
        if (!targetId) return;
        var first = current.order.indexOf(id);
        var second = current.order.indexOf(targetId);
        current.order[first] = targetId;
        current.order[second] = id;
        current.preset = 'custom';
        persist(current, widget.label + ' moved ' + (direction < 0 ? 'earlier.' : 'later.'));
    }

    function openCustomizer(trigger) {
        var modal = document.getElementById('todayDashboardModal');
        if (!modal) return;
        renderCustomizer();
        modal.__sutraReturnFocus = trigger || document.activeElement;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('active');
        if (window.SutraModalManager && typeof window.SutraModalManager.sync === 'function') window.SutraModalManager.sync();
    }

    function closeCustomizer() {
        var modal = document.getElementById('todayDashboardModal');
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        modal.hidden = true;
        if (window.SutraModalManager && typeof window.SutraModalManager.sync === 'function') window.SutraModalManager.sync();
    }

    function bindDom() {
        document.querySelectorAll('[data-open-today-dashboard]').forEach(function (button) {
            if (button.getAttribute('data-today-dashboard-bound') === 'true') return;
            button.setAttribute('data-today-dashboard-bound', 'true');
            button.addEventListener('click', function () { openCustomizer(button); });
        });
        document.querySelectorAll('[data-close-today-dashboard]').forEach(function (button) {
            if (button.getAttribute('data-today-dashboard-bound') === 'true') return;
            button.setAttribute('data-today-dashboard-bound', 'true');
            button.addEventListener('click', closeCustomizer);
        });
        var modal = document.getElementById('todayDashboardModal');
        if (modal && modal.getAttribute('data-today-dashboard-bound') !== 'true') {
            modal.setAttribute('data-today-dashboard-bound', 'true');
            modal.addEventListener('click', function (event) { if (event.target === modal) closeCustomizer(); });
            modal.addEventListener('change', function (event) {
                var visibilityId = event.target && event.target.getAttribute('data-widget-visibility');
                if (visibilityId && WIDGET_BY_ID[visibilityId]) setVisibility(visibilityId, !!event.target.checked);
                var sizeId = event.target && event.target.getAttribute('data-widget-size');
                if (sizeId && WIDGET_BY_ID[sizeId]) setSize(sizeId, event.target.value);
            });
            modal.addEventListener('click', function (event) {
                var presetButton = event.target && event.target.closest ? event.target.closest('[data-today-dashboard-preset]') : null;
                if (presetButton) {
                    var presetName = presetButton.getAttribute('data-today-dashboard-preset');
                    persist(getPresetPreferences(presetName), PRESETS[presetName].label + ' layout applied.');
                    return;
                }
                var moveButton = event.target && event.target.closest ? event.target.closest('[data-widget-move]') : null;
                if (moveButton) moveWidget(moveButton.getAttribute('data-widget-move'), Number(moveButton.getAttribute('data-direction')) || 0);
                var resetButton = event.target && event.target.closest ? event.target.closest('[data-reset-today-dashboard]') : null;
                if (resetButton) persist(getDefaultPreferences(), 'Home reset to the calm layout.');
            });
        }
    }

    function init() {
        if (initialized || typeof document === 'undefined') return;
        initialized = true;
        bindDom();
        applyPreferences();
        window.addEventListener('noteflow:view-changed', function (event) {
            if (!event.detail || event.detail.view === 'today') {
                var apply = function () { applyPreferences(); };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply); else setTimeout(apply, 0);
            }
        });
    }

    function configure(nextOptions) {
        options = nextOptions && typeof nextOptions === 'object' ? nextOptions : {};
        return window.SutraTodayDashboard;
    }

    window.SutraTodayDashboard = {
        VERSION: VERSION,
        WIDGETS: WIDGETS.map(function (widget) {
            return { id: widget.id, label: widget.label, group: widget.group, sizes: widget.sizes.slice(), movable: widget.movable !== false };
        }),
        PRESETS: Object.keys(PRESETS).map(function (key) { return { key: key, label: PRESETS[key].label, description: PRESETS[key].description }; }),
        getDefaultPreferences: getDefaultPreferences,
        getPresetPreferences: getPresetPreferences,
        normalizePreferences: normalizePreferences,
        getPreferences: currentPreferences,
        configure: configure,
        init: init,
        applyPreferences: applyPreferences,
        openCustomizer: openCustomizer,
        closeCustomizer: closeCustomizer
    };
})();
