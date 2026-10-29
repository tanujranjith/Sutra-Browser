/* Sutra calendar-first Timeline surface.  This script is deliberately a DOM
 * renderer only: app.js remains the owner of Timeline state, persistence, and
 * the public renderTimeline entry point. */
;(function registerSutraCalendarSurface(global) {
    'use strict';
    var rootId = 'timelineLegacyCalendar';
    var rendering = false;

    function text(value) { return String(value == null ? '' : value); }
    function key(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
    function localDate(value) {
        var parts = text(value).slice(0, 10).split('-').map(Number);
        return parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
    }
    function add(date, days) { var next = new Date(date.getFullYear(), date.getMonth(), date.getDate()); next.setDate(next.getDate() + days); return next; }
    function minutes(value) { var match = /^(\d{1,2}):(\d{2})$/.exec(text(value)); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
    function time(value) { var total = Math.max(0, Math.min(1439, Math.round(value))); return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'); }
    function displayTime(value) { var raw = text(value); var total = minutes(raw); if (total === null) return raw; var formatSelect = document.getElementById('timeFormatSelect'); if (formatSelect && formatSelect.value === '24') return time(total); var formatter = global.SutraTimeUtils && global.SutraTimeUtils.formatClockTime; return typeof formatter === 'function' ? formatter(time(total)) : raw; }
    function blocks() { return global.flowAtelier && Array.isArray(global.flowAtelier.timeBlocks) ? global.flowAtelier.timeBlocks : []; }
    function occur(block, date) {
        if (!block) return false;
        var target = key(date); var base = text(block.date).slice(0, 10); var recurrence = text(block.recurrence || 'none').toLowerCase();
        if (base && target < base) return false;
        if (block.recurrenceUntil && target > text(block.recurrenceUntil).slice(0, 10)) return false;
        if (Array.isArray(block.recurrenceExceptions) && block.recurrenceExceptions.indexOf(target) >= 0) return false;
        if (block.source === 'calendar_ics' && block.preserveRecurrence !== true) return base === target;
        if (recurrence === 'daily') return true;
        if (recurrence === 'weekdays') return date.getDay() > 0 && date.getDay() < 6;
        if (recurrence === 'weekly') return Array.isArray(block.weeklyDays) ? block.weeklyDays.indexOf(date.getDay()) >= 0 : (!base || localDate(base).getDay() === date.getDay());
        return !base || base === target;
    }
    function forDay(date) { return blocks().filter(function (block) { return occur(block, date) && minutes(block.start) !== null && minutes(block.end) !== null; }).sort(function (a, b) { return minutes(a.start) - minutes(b.start); }); }
    function el(tag, className, content) { var node = document.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node; }
    function source(block) { var value = text(block.source); if (value === 'calendar_ics' || value === 'calendar_google') return 'Imported calendar'; if (value === 'ap_study_session') return 'AP Study'; if (value === 'hw_due' || value === 'homework') return 'Homework'; return 'Sutra'; }
    function color(block) { var names = { study: '#6f8dff', homework: '#8b70f5', task: '#2eaf91', review: '#a970d6', exam: '#e07878', break: '#8995a8', personal: '#d58c55' }; return /^#[0-9a-f]{6}$/i.test(text(block.color)) ? block.color : (names[text(block.category || block.sourceType || block.source).toLowerCase()] || '#6386d8'); }
    function centeredDate() { var input = document.getElementById('timelineDateInput'); return localDate(input && input.value); }
    function currentMode() { var active = document.querySelector('[data-timeline-view-mode].active'); return active ? text(active.getAttribute('data-timeline-view-mode')) : 'week'; }
    function dateInput(value) { var input = document.getElementById('timelineDateInput'); if (!input) return; input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
    function openBlock(block, date, start) {
        if (block && typeof global.openBlockModal === 'function') { global.openBlockModal(block); return; }
        var input = document.getElementById('timelineDateInput'); if (date && input) dateInput(date);
        var modal = document.getElementById('blockModal');
        if (typeof global.openBlockModal === 'function') global.openBlockModal(null);
        setTimeout(function () {
            var dateField = document.getElementById('blockDateInput'); var startField = document.getElementById('blockStartInput'); var endField = document.getElementById('blockEndInput');
            if (dateField && date) {
                dateField.value = date;
                if (typeof global.refreshCustomDates === 'function') global.refreshCustomDates(dateField);
            }
            if (startField && start != null) startField.value = time(start);
            if (endField && start != null) endField.value = time(Math.min(1439, start + 60));
            if (modal && !modal.classList.contains('active') && typeof global.openBlockModal !== 'function') modal.classList.add('active');
        }, 0);
    }
    function eventButton(block, date, style, expanded) {
        var button = el('button', 'sutra-calendar-event'); button.type = 'button';
        button.draggable = !(global.matchMedia && global.matchMedia('(hover: none) and (pointer: coarse)').matches);
        button.setAttribute('data-block-id', text(block.id)); button.setAttribute('data-block-name', text(block.name || 'Untitled'));
        button.setAttribute('aria-label', text(block.name || 'Untitled') + ', ' + date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ', ' + displayTime(block.start) + ' to ' + displayTime(block.end) + ', ' + source(block));
        button.style.setProperty('--sutra-calendar-event-color', color(block)); Object.keys(style || {}).forEach(function (name) { button.style[name] = style[name]; });
        // A 30-45 minute item can be shorter than its time + title stack. Show
        // the title (the useful scanning signal) rather than clipping both;
        // the complete time remains available through the accessible label.
        // A phone uses a taller hour grid than desktop, so the same 45-minute
        // block can be 45px instead of 33px. Both are too short for the time
        // plus title stack once theme padding is applied. Keep a desktop
        // one-hour block expansive: its 45px height can fit time and title.
        var compactLimit = global.innerWidth <= 640 ? 48 : 42;
        var compact = style && Number.parseFloat(style.height) <= compactLimit;
        if (compact) button.classList.add('is-compact');
        else button.appendChild(el('span', 'sutra-calendar-event-time', displayTime(block.start) + ' - ' + displayTime(block.end)));
        button.appendChild(el('span', 'sutra-calendar-event-title', text(block.name || 'Untitled')));
        if (expanded && !compact) button.appendChild(el('span', 'sutra-calendar-event-source', source(block) + (block.courseId ? ' · ' + block.courseId : '')));
        button.addEventListener('click', function (event) { event.stopPropagation(); openBlock(block); }); return button;
    }
    function month(root, view) {
        var first = new Date(view.getFullYear(), view.getMonth(), 1); var last = new Date(view.getFullYear(), view.getMonth() + 1, 0); var start = add(first, -first.getDay());
        var count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7; var today = key(new Date()); var selected = key(view);
        var grid = el('div', 'sutra-calendar-month'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
        var weekdays = el('div', 'sutra-calendar-weekdays'); ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (label) { var cell = el('div', '', label); cell.setAttribute('role', 'columnheader'); weekdays.appendChild(cell); }); grid.appendChild(weekdays);
        var days = el('div', 'sutra-calendar-month-grid');
        for (var i = 0; i < count; i += 1) {
            (function (date) {
                var dateKey = key(date); var cell = el('div', 'sutra-calendar-day' + (date.getMonth() !== view.getMonth() ? ' is-outside' : '') + (dateKey === today ? ' is-today' : '') + (dateKey === selected ? ' is-selected' : ''));
                cell.tabIndex = 0; cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
                var daily = forDay(date);
                function openDay() { dateInput(dateKey); var dayTab = document.querySelector('[data-timeline-view-mode="day"]'); if (dayTab) dayTab.click(); }
                var dayButton = el('button', 'sutra-calendar-day-number', String(date.getDate())); dayButton.type = 'button';
                dayButton.setAttribute('aria-label', 'Open ' + cell.getAttribute('aria-label') + (daily.length ? ', ' + daily.length + ' scheduled item' + (daily.length === 1 ? '' : 's') : ', no scheduled items'));
                dayButton.addEventListener('click', function (event) { event.stopPropagation(); openDay(); }); cell.appendChild(dayButton);
                var eventList = el('div', 'sutra-calendar-month-events'); eventList.setAttribute('data-event-count', String(daily.length)); daily.slice(0, 3).forEach(function (block) { var item = el('button', 'sutra-calendar-month-event'); item.type = 'button'; item.style.setProperty('--sutra-calendar-event-color', color(block)); item.textContent = displayTime(block.start) + ' ' + text(block.name || 'Untitled'); item.addEventListener('click', function (event) { event.stopPropagation(); openBlock(block); }); eventList.appendChild(item); });
                if (daily.length > 3) { var more = el('button', 'sutra-calendar-more', '+' + (daily.length - 3) + ' more'); more.type = 'button'; more.addEventListener('click', function (event) { event.stopPropagation(); dayButton.click(); }); eventList.appendChild(more); }
                cell.appendChild(eventList); cell.addEventListener('click', function () { if (global.matchMedia && global.matchMedia('(max-width: 480px)').matches) openDay(); else openBlock(null, dateKey); }); cell.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (global.matchMedia && global.matchMedia('(max-width: 480px)').matches) openDay(); else openBlock(null, dateKey); } }); days.appendChild(cell);
            }(add(start, i)));
        }
        grid.appendChild(days); root.replaceChildren(grid);
    }
    function layout(dayBlocks) {
        var rows = dayBlocks.map(function (block) { return { block: block, start: minutes(block.start), end: Math.max(minutes(block.end), minutes(block.start) + 15), column: 0, columns: 1 }; });
        var groups = []; rows.sort(function (a, b) { return a.start - b.start || a.end - b.end; }).forEach(function (row) { var group = groups[groups.length - 1]; if (!group || row.start >= group.end) groups.push({ end: row.end, rows: [row] }); else { group.end = Math.max(group.end, row.end); group.rows.push(row); } });
        groups.forEach(function (group) { var laneEnds = []; group.rows.forEach(function (row) { var lane = laneEnds.findIndex(function (end) { return end <= row.start; }); if (lane < 0) { lane = laneEnds.length; laneEnds.push(row.end); } else laneEnds[lane] = row.end; row.column = lane; }); group.rows.forEach(function (row) { row.columns = laneEnds.length; }); }); return rows;
    }
    function timeGrid(root, mode, view) {
        var dates = mode === 'day' ? [view] : Array.from({ length: 7 }, function (_, i) { return add(add(view, -view.getDay()), i); }); var eventMins = dates.flatMap(forDay).flatMap(function (block) { return [minutes(block.start), minutes(block.end)]; }).filter(Number.isFinite);
        var min = Math.max(0, Math.min(360, eventMins.length ? Math.min.apply(null, eventMins) - 60 : 360)); var max = Math.min(1440, Math.max(1320, eventMins.length ? Math.max.apply(null, eventMins) + 60 : 1320)); min = Math.floor(min / 60) * 60; max = Math.ceil(max / 60) * 60; var hourHeight = window.innerWidth <= 640 ? 64 : 48; var height = (max - min) / 60 * hourHeight;
        var viewRoot = el('div', 'sutra-calendar-time-view sutra-calendar-time-' + mode); var scroller = el('div', 'sutra-calendar-time-scroll'); var grid = el('div', 'sutra-calendar-time-grid'); grid.style.setProperty('--sutra-calendar-day-count', dates.length); scroller.appendChild(grid); viewRoot.appendChild(scroller);
        grid.appendChild(el('div', 'sutra-calendar-time-gutter sutra-calendar-time-header', 'Time'));
        dates.forEach(function (date) { var head = el('div', 'sutra-calendar-time-header' + (key(date) === key(new Date()) ? ' is-today' : '')); head.appendChild(el('span', '', date.toLocaleDateString('en-US', { weekday: 'short' }))); head.appendChild(el('strong', '', String(date.getDate()))); grid.appendChild(head); });
        var labels = el('div', 'sutra-calendar-time-gutter sutra-calendar-time-labels'); labels.style.height = height + 'px'; for (var minute = min; minute <= max; minute += 60) { var label = el('span', '', global.SutraTimeUtils && global.SutraTimeUtils.formatClockTime ? global.SutraTimeUtils.formatClockTime(time(minute)) : time(minute)); label.style.top = ((minute - min) / 60 * hourHeight - 8) + 'px'; labels.appendChild(label); } grid.appendChild(labels);
        dates.forEach(function (date) { var dateKey = key(date); var column = el('div', 'sutra-calendar-time-column timeline-drop-zone'); column.setAttribute('data-drop-date', dateKey); column.style.height = height + 'px'; var lines = el('div', 'sutra-calendar-time-lines'); for (var minute = min; minute <= max; minute += 60) { var line = el('div', 'timeline-hour-row'); line.style.top = ((minute - min) / 60 * hourHeight) + 'px'; lines.appendChild(line); } column.appendChild(lines); layout(forDay(date)).forEach(function (row) { var top = (row.start - min) / 60 * hourHeight; var duration = Math.max(24, (row.end - row.start) / 60 * hourHeight - 3); column.appendChild(eventButton(row.block, date, { top: top + 'px', height: duration + 'px', left: 'calc(' + (row.column / row.columns * 100) + '% + 2px)', width: 'calc(' + (100 / row.columns) + '% - 4px)' }, mode === 'day')); });
            if (dateKey === key(new Date())) { var now = new Date(); var nowMinutes = now.getHours() * 60 + now.getMinutes(); if (nowMinutes >= min && nowMinutes <= max) { var nowLine = el('div', 'sutra-calendar-now-line'); nowLine.style.top = ((nowMinutes - min) / 60 * hourHeight) + 'px'; nowLine.appendChild(el('span', '', 'Now')); column.appendChild(nowLine); } }
            column.addEventListener('click', function (event) { if (event.target.closest('[data-block-id]')) return; var rect = column.getBoundingClientRect(); var slot = min + Math.round(Math.max(0, event.clientY - rect.top) / hourHeight * 4) * 15; openBlock(null, dateKey, slot); }); grid.appendChild(column);
        }); root.replaceChildren(viewRoot);
    }
    function updateCurrent() { var card = document.getElementById('currentBlockCard'); if (!card) return; card.style.display = 'block'; var now = new Date(); var upcoming = blocks().filter(function (block) { var date = localDate(block.date || key(now)); var start = minutes(block.start); return occur(block, now) && start !== null; }).sort(function (a, b) { return minutes(a.start) - minutes(b.start); }); var info = document.getElementById('currentBlockInfo'); if (!info) return; var current = upcoming.find(function (block) { return minutes(block.start) <= now.getHours() * 60 + now.getMinutes() && minutes(block.end) > now.getHours() * 60 + now.getMinutes(); }); var next = current || upcoming.find(function (block) { return minutes(block.start) > now.getHours() * 60 + now.getMinutes(); }); info.textContent = next ? text(next.name || 'Untitled') + ' · ' + text(next.start) + '–' + text(next.end) : 'No active block right now'; var heading = document.getElementById('currentBlockCardHeading'); if (heading) heading.textContent = current ? 'Current' : next ? 'Next' : 'Current / Next'; }
    function nextOpenSlot(date, minimumMinutes) {
        var duration = Math.max(15, Number(minimumMinutes) || 45); var occupied = forDay(date).map(function (block) { return { start: minutes(block.start), end: Math.max(minutes(block.end), minutes(block.start) + 15) }; }).filter(function (slot) { return slot.start !== null && slot.end !== null; }).sort(function (a, b) { return a.start - b.start; });
        var now = new Date(); var cursor = Math.max(480, Math.ceil((date.toDateString() === now.toDateString() ? now.getHours() * 60 + now.getMinutes() + 15 : 480) / 15) * 15);
        for (var i = 0; i < occupied.length; i += 1) { if (cursor + duration <= occupied[i].start) return cursor; cursor = Math.max(cursor, occupied[i].end); }
        return cursor + duration <= 1320 ? cursor : 540;
    }
    function announce(value) { var status = document.getElementById('timelineSourceStatus'); if (status) status.textContent = value; }
    function shortcutHandler(root) {
        root.addEventListener('keydown', function (event) {
            var target = event.target; if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/i.test(target.tagName)) return;
            var keyName = text(event.key).toLowerCase(); var mode = currentMode(); var date = centeredDate(); var direction = keyName === '[' || keyName === 'arrowleft' ? -1 : (keyName === ']' || keyName === 'arrowright' ? 1 : 0);
            if (direction) { event.preventDefault(); if (mode === 'month') date.setMonth(date.getMonth() + direction); else date.setDate(date.getDate() + direction * (mode === 'week' ? 7 : 1)); dateInput(key(date)); announce('Showing ' + date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })); return; }
            if (keyName === 't') { event.preventDefault(); dateInput(key(new Date())); announce('Showing today.'); return; }
            if (keyName === 'd' || keyName === 'w' || keyName === 'm') { var view = keyName === 'd' ? 'day' : keyName === 'w' ? 'week' : 'month'; var tab = document.querySelector('[data-timeline-view-mode="' + view + '"]'); if (tab) { event.preventDefault(); tab.click(); announce('Showing ' + view + ' view.'); } return; }
            if (keyName === 'n') { event.preventDefault(); var selected = centeredDate(); openBlock(null, key(selected), nextOpenSlot(selected, 45)); announce('Creating a new time block.'); return; }
            if (keyName === '?') { event.preventDefault(); announce('Timeline shortcuts: left and right move the calendar; T is today; D, W, and M change the view; N creates a new block.'); }
        });
    }
    function render() { var root = document.getElementById(rootId); if (!root || rendering || currentMode() === 'planner' || root.querySelector('.sutra-calendar-month,.sutra-calendar-time-view')) return; rendering = true; try { var mode = currentMode(); var view = centeredDate(); if (mode === 'month') month(root, view); else if (mode === 'week' || mode === 'day') timeGrid(root, mode, view); updateCurrent(); } finally { rendering = false; } }
    function navigation() { ['timelineStepPrev', 'timelineStepNext'].forEach(function (id) { var button = document.getElementById(id); if (!button) return; button.addEventListener('click', function (event) { event.preventDefault(); event.stopImmediatePropagation(); var mode = currentMode(); var date = centeredDate(); if (mode === 'month') date.setMonth(date.getMonth() + (id === 'timelineStepPrev' ? -1 : 1)); else date.setDate(date.getDate() + (mode === 'week' ? 7 : 1) * (id === 'timelineStepPrev' ? -1 : 1)); dateInput(key(date)); }, true); }); var today = document.getElementById('timelineTodayBtn'); if (today) today.addEventListener('click', function (event) { event.preventDefault(); event.stopImmediatePropagation(); dateInput(key(new Date())); }, true); }
    function init() { var root = document.getElementById(rootId); if (!root) return; root.tabIndex = 0; root.setAttribute('aria-label', 'Timeline calendar. Press question mark for keyboard shortcuts.'); new MutationObserver(function () { requestAnimationFrame(render); }).observe(root, { childList: true, subtree: false }); navigation(); shortcutHandler(root); document.addEventListener('sutra:schedule-changed', function () { var original = global.renderTimeline; if (typeof original === 'function') original(); }); requestAnimationFrame(render); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}(window));
