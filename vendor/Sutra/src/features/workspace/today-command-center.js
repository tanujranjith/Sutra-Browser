/*
 * today-command-center.js — pure planning logic + Upcoming Radar renderer
 * for the redesigned Today view.
 *
 * Design contract:
 *   - Every helper here is a PURE function of (items, options). The clock is
 *     always injected via options.now so tests are deterministic; nothing in
 *     this file reads workspace state directly.
 *   - Items are the normalized deadline records produced by
 *     collectWorkspaceDeadlines() in app.js:
 *       { id, source, sourceId, title, subtitle?, due: Date|null,
 *         priority: 'high'|'medium'|'low', status, overdue }
 *     Undated items (due == null) are NEVER treated as upcoming — they only
 *     appear when the caller explicitly filters for them.
 *   - Rendering (renderRadar) builds DOM nodes with createElement/textContent
 *     only. No innerHTML anywhere in this module, so the guardrail sink
 *     budget for this file is 0.
 *
 * Prioritization (getNextPriorityItem) is deterministic and documented:
 *   1. Overdue beats everything; older overdue outranks newer overdue.
 *   2. Then due today, then tomorrow, then this week (sooner outranks later).
 *   3. Within the same day-distance: high priority > medium > low.
 *   4. Exams/tests get a bump over routine work at equal urgency.
 *   5. Stable tie-break on (due time, id) so renders never reorder randomly.
 * Callers may inject options.rank (app.js passes computeDeadlineRank) so the
 * Today card can never disagree with the All Due view's ranking engine.
 */
(function () {
    'use strict';

    var MS_PER_DAY = 86400000;

    var HORIZONS = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later'];

    var HORIZON_LABELS = {
        overdue: 'Overdue',
        today: 'Today',
        tomorrow: 'Tomorrow',
        thisWeek: 'This Week',
        later: 'Later',
        undated: 'No date'
    };

    // Category filters offered by the radar dropdown. `match` is a predicate
    // over the normalized item.
    var RADAR_FILTERS = [
        { key: 'all', label: 'All Items', match: function () { return true; } },
        { key: 'tasks', label: 'Tasks', match: function (i) { return i.source === 'task'; } },
        {
            key: 'assignments', label: 'Assignments', match: function (i) {
                return i.source === 'homework' || i.source === 'milestone';
            }
        },
        {
            key: 'exams', label: 'Exams', match: function (i) {
                if (i.source === 'apexam') return true;
                var t = String(i.type || '') + ' ' + String(i.title || '');
                return /\b(exam|test|quiz|final|midterm)\b/i.test(t);
            }
        },
        { key: 'events', label: 'Events', match: function (i) { return i.source === 'timeline'; } },
        { key: 'review', label: 'Review', match: function (i) { return i.source === 'review'; } },
        { key: 'undated', label: 'No date', match: function () { return true; } }
    ];

    function startOfDay(date) {
        var d = new Date(date.getTime());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function toDate(value) {
        if (value instanceof Date && !isNaN(value.getTime())) return value;
        return null;
    }

    function safeItems(items) {
        return (Array.isArray(items) ? items : []).filter(function (i) { return !!i; });
    }

    // Days between "now" midnight and the item's due-date midnight.
    // Negative = overdue by that many days. Null when undated.
    function daysUntil(item, now) {
        var due = toDate(item && item.due);
        if (!due) return null;
        return Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / MS_PER_DAY);
    }

    /**
     * getUrgencyStatus(item, now) → {
     *   key: 'overdue'|'today'|'tomorrow'|'thisWeek'|'later'|'undated',
     *   label: human string ("Overdue by 59 days", "Due today", ...),
     *   daysUntil: number|null
     * }
     */
    function getUrgencyStatus(item, now) {
        now = toDate(now) || new Date();
        var d = daysUntil(item, now);
        if (d === null) return { key: 'undated', label: 'No due date', daysUntil: null };
        if (d < 0) {
            var over = Math.abs(d);
            return {
                key: 'overdue',
                label: over === 1 ? 'Overdue by 1 day' : 'Overdue by ' + over + ' days',
                daysUntil: d
            };
        }
        if (d === 0) return { key: 'today', label: 'Due today', daysUntil: 0 };
        if (d === 1) return { key: 'tomorrow', label: 'Due tomorrow', daysUntil: 1 };
        if (d < 7) return { key: 'thisWeek', label: 'Due in ' + d + ' days', daysUntil: d };
        return { key: 'later', label: 'Due in ' + d + ' days', daysUntil: d };
    }

    /**
     * groupItemsByTimeHorizon(items, now) →
     *   { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], undated: [] }
     * Buckets follow groupDeadlinesByTimeframe() in app.js: "this week" means
     * strictly within the next 7 days. Each bucket is sorted by (due, id) so
     * placement is stable across renders.
     */
    function groupItemsByTimeHorizon(items, now) {
        now = toDate(now) || new Date();
        var groups = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], undated: [] };
        safeItems(items).forEach(function (item) {
            groups[getUrgencyStatus(item, now).key].push(item);
        });
        Object.keys(groups).forEach(function (key) {
            groups[key].sort(function (a, b) {
                var ad = toDate(a.due), bd = toDate(b.due);
                var at = ad ? ad.getTime() : 0, bt = bd ? bd.getTime() : 0;
                if (at !== bt) return at - bt;
                return String(a.id).localeCompare(String(b.id));
            });
        });
        return groups;
    }

    function positiveNumber(value, fallback) {
        var n = Math.round(Number(value));
        return n > 0 ? n : (fallback || 0);
    }

    function effortMinutes(item) {
        return positiveNumber(item && (item.estimateMinutes || item.estimatedMinutes || item.effortMinutes), 0);
    }

    function formatMinutes(minutes) {
        var total = positiveNumber(minutes, 0);
        if (!total) return '';
        if (total < 60) return total + ' min';
        var hours = Math.floor(total / 60);
        var rest = total % 60;
        return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
    }

    function isTestOrQuiz(item) {
        var text = String(item && item.type || '') + ' ' + String(item && item.title || '');
        return item && item.source === 'apexam' || /\b(exam|test|quiz|final|midterm|frq|dbq)\b/i.test(text);
    }

    /**
     * rankStudentNextStep(item, { now, availableTonightMinutes })
     *
     * The shared, deterministic student ranking policy. It deliberately uses
     * only local workspace facts supplied on the normalized item—never an AI
     * request. Alongside urgency, it accounts for difficulty, effort, linked
     * notes, scheduling, review debt, upcoming tests, and whether the work can
     * fit in the student's remaining evening time.
     */
    function rankStudentNextStep(item, options) {
        options = options || {};
        var now = toDate(options.now) || new Date();
        var status = getUrgencyStatus(item, now);
        var score = 0;
        var d = status.daysUntil;
        if (status.key === 'overdue') score = 1000 + Math.min(Math.abs(d), 30) * 12;
        else if (status.key === 'today') score = 720;
        else if (status.key === 'tomorrow') score = 560;
        else if (d !== null && d < 7) score = Math.max(120, 480 - d * 40);
        else if (d !== null) score = Math.max(20, 200 - d * 3);
        var priority = String(item && item.priority || 'medium').toLowerCase();
        if (priority === 'high') score += 140;
        else if (priority === 'low') score -= 40;
        var text = String(item && item.type || '') + ' ' + String(item && item.title || '');
        var test = isTestOrQuiz(item);
        var major = /\b(project|essay|paper|portfolio|presentation|lab report|build)\b/i.test(text);
        if (test) score += d !== null && d <= 2 ? 145 : 110;
        else if (major) score += 60;

        var difficulty = String(item && item.difficulty || 'medium').toLowerCase();
        if (difficulty === 'hard') score += 28;
        else if (difficulty === 'easy') score -= 8;

        var scheduled = !!(item && (item.scheduled === true || item.status === 'scheduled'));
        var unscheduled = !!(item && (item.unscheduled === true || (item.flags && item.flags.unscheduled))) || !scheduled;
        if (unscheduled && (priority === 'high' || test || major || (d !== null && d <= 2))) score += 45;
        if (scheduled && item && item.source !== 'timeline') score -= 18;

        var linkedNote = !!(item && item.hasLinkedNote);
        if (linkedNote) score += 12;

        var reviewDue = positiveNumber(item && (item.reviewDueCount || item.reviewBacklog || item.reviewDue), 0);
        if (item && item.source === 'review') score += 150 + Math.min(reviewDue, 40);
        else if (test && reviewDue) score += 70 + Math.min(reviewDue, 30);

        var effort = effortMinutes(item);
        var tonight = positiveNumber(options.availableTonightMinutes, positiveNumber(item && item.availableTonightMinutes, 0));
        var fitsTonight = effort > 0 && tonight > 0 && effort <= tonight;
        if (fitsTonight && (d !== null && d <= 1 || test)) score += 36;
        else if (effort > 0 && tonight > 0 && effort > tonight && d !== null && d <= 1) score -= 24;

        var reason = status.label;
        if (status.key === 'overdue') {
            if (priority === 'high' && unscheduled) reason = status.label + ', high priority, and unscheduled';
            else if (priority === 'high') reason = status.label + ' and high priority';
        } else if (test && d !== null && d <= 1 && reviewDue) {
            reason = 'Test ' + (d === 0 ? 'is today' : 'is tomorrow') + ' and ' + reviewDue + ' review card' + (reviewDue === 1 ? '' : 's') + ' are due';
        } else if (fitsTonight && d !== null && d <= 1) {
            reason = status.label + ' · ' + formatMinutes(effort) + ' fits in your ' + formatMinutes(tonight) + ' tonight';
        } else if (test && d !== null && d <= 2) {
            reason = 'Upcoming test ' + (d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'this week');
        } else if (item && item.source === 'review' && reviewDue) {
            reason = reviewDue + ' review card' + (reviewDue === 1 ? '' : 's') + ' due';
        } else if (unscheduled && priority === 'high') {
            reason = 'High priority and not scheduled yet';
        } else if (linkedNote && d !== null && d <= 1) {
            reason = status.label + ' · linked notes are ready';
        } else if (difficulty === 'hard' && d !== null && d <= 2) {
            reason = status.label + ' · hard work';
        } else if (priority === 'high' && (status.key === 'today' || status.key === 'tomorrow')) {
            reason = status.label + ' · high priority';
        }
        return {
            score: Math.round(score),
            reason: reason,
            daysUntil: d,
            overdue: status.key === 'overdue',
            effortMinutes: effort,
            fitsTonight: fitsTonight
        };
    }

    // Built-in deterministic score, used when the caller does not inject a
    // ranking function. Mirrors the shape of app.js computeDeadlineRank.
    function defaultRank(item, now) {
        return rankStudentNextStep(item, { now: now });
    }

    /**
     * getNextPriorityItem(items, { now, rank }) →
     *   { item, reason, status } | null
     * Undated and completed items never win. Ties break on (due, id) so the
     * result is stable.
     */
    function getNextPriorityItem(items, options) {
        options = options || {};
        var now = toDate(options.now) || new Date();
        var rank = typeof options.rank === 'function' ? options.rank : defaultRank;
        var best = null;
        var bestScore = -Infinity;
        safeItems(items).forEach(function (item) {
            if (item.completed || item.status === 'done') return;
            if (!toDate(item.due)) return;
            var r = rank(item, now) || {};
            var score = Number(r.score) || 0;
            if (score > bestScore) {
                best = { item: item, reason: r.reason || '', status: getUrgencyStatus(item, now) };
                bestScore = score;
            } else if (score === bestScore && best) {
                var a = toDate(item.due).getTime();
                var b = toDate(best.item.due).getTime();
                if (a < b || (a === b && String(item.id) < String(best.item.id))) {
                    best = { item: item, reason: r.reason || '', status: getUrgencyStatus(item, now) };
                }
            }
        });
        return best;
    }

    /**
     * getTodaySummary(items, now) →
     *   { overdue, dueToday, dueTomorrow, dueThisWeek, later, undated, total }
     * "dueThisWeek" counts days 2..6 (i.e. after tomorrow, within 7 days) so
     * the three headline numbers never double-count.
     */
    function getTodaySummary(items, now) {
        var groups = groupItemsByTimeHorizon(items, now);
        return {
            overdue: groups.overdue.length,
            dueToday: groups.today.length,
            dueTomorrow: groups.tomorrow.length,
            dueThisWeek: groups.thisWeek.length,
            later: groups.later.length,
            undated: groups.undated.length,
            total: safeItems(items).length
        };
    }

    /**
     * getTodayAgenda({ blocks, items }, now) → chronologically sorted entries
     * for today only:
     *   { kind: 'block'|'deadline', title, startMinutes, endMinutes|null,
     *     timeLabel, category|source, ref }
     * blocks: timeline blocks ({ name, date: 'YYYY-MM-DD', start, end, category }).
     * items: deadline records; only ones due today with a real time are shown
     * (all-day deadlines already live in the counts, not the agenda).
     */
    function getTodayAgenda(input, now) {
        input = input || {};
        now = toDate(now) || new Date();
        var todayKey = localKey(now);
        var out = [];
        (Array.isArray(input.blocks) ? input.blocks : []).forEach(function (block) {
            if (!block || String(block.date || '') !== todayKey) return;
            var start = parseMinutes(block.start);
            if (start === null) return;
            out.push({
                kind: 'block',
                title: String(block.name || block.title || 'Scheduled block'),
                startMinutes: start,
                endMinutes: parseMinutes(block.end),
                timeLabel: formatMinutes(start),
                category: String(block.category || ''),
                ref: block
            });
        });
        safeItems(input.items).forEach(function (item) {
            var due = toDate(item.due);
            if (!due || localKey(due) !== todayKey) return;
            var mins = due.getHours() * 60 + due.getMinutes();
            if (isAllDayMinutes(mins)) return; // all-day deadline — counted, not scheduled
            out.push({
                kind: 'deadline',
                title: String(item.title || 'Due item'),
                startMinutes: mins,
                endMinutes: null,
                timeLabel: formatMinutes(mins),
                category: String(item.source || ''),
                ref: item
            });
        });
        out.sort(function (a, b) {
            if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
            return a.title.localeCompare(b.title);
        });
        return out;
    }

    function localKey(date) {
        return date.getFullYear() + '-'
            + String(date.getMonth() + 1).padStart(2, '0') + '-'
            + String(date.getDate()).padStart(2, '0');
    }

    function parseMinutes(hhmm) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
        if (!m) return null;
        var mins = Number(m[1]) * 60 + Number(m[2]);
        return mins >= 0 && mins < 1440 ? mins : null;
    }

    function formatMinutes(mins) {
        var h = Math.floor(mins / 60);
        var mm = String(mins % 60).padStart(2, '0');
        var suffix = h >= 12 ? 'PM' : 'AM';
        var hour12 = h % 12 === 0 ? 12 : h % 12;
        return hour12 + ':' + mm + ' ' + suffix;
    }

    // Midnight and 23:59 both mean "date-only deadline" (app.js normalizes
    // missing due times to end-of-day) — show no clock time for either.
    function isAllDayMinutes(mins) {
        return mins === 0 || mins === 1439;
    }

    // Short chip meta ("Jul 8", "Today, 12:00 PM", "Tomorrow").
    function chipTimeLabel(item, now) {
        var due = toDate(item.due);
        if (!due) return 'No date';
        var status = getUrgencyStatus(item, now);
        var mins = due.getHours() * 60 + due.getMinutes();
        var timePart = !isAllDayMinutes(mins) ? ', ' + formatMinutes(mins) : '';
        var label = '';
        if (status.key === 'overdue' || status.key === 'today') {
            label = (status.key === 'overdue' ? 'Overdue' : 'Today') + timePart;
        } else if (status.key === 'tomorrow') {
            label = 'Tomorrow' + timePart;
        } else {
            label = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
        return label + (item && item.scheduleSummary ? ' · ' + String(item.scheduleSummary) : '');
    }

    /**
     * getUpcomingRadarItems(items, { now, filter, maxPerZone }) →
     *   { zones: [{ key, label, items, overflow }], visibleCount, totalCount }
     * - Undated items appear ONLY when filter === 'undated' (spec: never treat
     *   undated work as "upcoming" by default).
     * - Overdue items render inside the Today band (they need action today)
     *   but keep their own status color/legend entry.
     * - Each zone is capped; extras are reported via `overflow`.
     */
    function getUpcomingRadarItems(items, options) {
        options = options || {};
        var now = toDate(options.now) || new Date();
        var filterKey = String(options.filter || 'all');
        var filterDef = null;
        for (var i = 0; i < RADAR_FILTERS.length; i++) {
            if (RADAR_FILTERS[i].key === filterKey) { filterDef = RADAR_FILTERS[i]; break; }
        }
        if (!filterDef) filterDef = RADAR_FILTERS[0];

        var caps = options.maxPerZone || { today: 4, tomorrow: 4, thisWeek: 5, later: 4 };
        var groups = groupItemsByTimeHorizon(items, now);

        if (filterKey === 'undated') {
            var undated = groups.undated.filter(function (it) { return !it.completed && it.status !== 'done'; });
            return {
                zones: [{ key: 'undated', label: HORIZON_LABELS.undated, items: undated.slice(0, 12), overflow: Math.max(0, undated.length - 12) }],
                visibleCount: Math.min(undated.length, 12),
                totalCount: undated.length
            };
        }

        var zones = [];
        var visible = 0;
        var total = 0;
        // Overdue merges into the today band for placement but items keep
        // status 'overdue' so chips get the red dot.
        var zonePlan = [
            { key: 'today', pool: groups.overdue.concat(groups.today) },
            { key: 'tomorrow', pool: groups.tomorrow },
            { key: 'thisWeek', pool: groups.thisWeek },
            { key: 'later', pool: groups.later }
        ];
        zonePlan.forEach(function (plan) {
            var pool = plan.pool.filter(function (it) {
                return !it.completed && it.status !== 'done' && filterDef.match(it);
            });
            var cap = Math.max(1, Number(caps[plan.key]) || 4);
            var kept = pool.slice(0, cap);
            zones.push({
                key: plan.key,
                label: HORIZON_LABELS[plan.key],
                items: kept,
                overflow: Math.max(0, pool.length - kept.length)
            });
            visible += kept.length;
            total += pool.length;
        });
        return { zones: zones, visibleCount: visible, totalCount: total };
    }

    /**
     * computeRadarLayout(radarData, { width, height, now }) → chips with stable
     * polar placement:
     *   { item|null, zone, statusKey, xPct, yPct, label, meta, overflowCount }
     * Geometry: quarter-of-ellipse fan anchored at bottom-center. Each zone is
     * a band at a fixed radius; items spread evenly across the arc in due
     * order, so the same data always lands in the same spot.
     */
    function computeRadarLayout(radarData, options) {
        options = options || {};
        var now = toDate(options.now) || new Date();
        var zoneRadius = { today: 0.32, tomorrow: 0.52, thisWeek: 0.72, later: 0.92 };
        var chips = [];
        (radarData && Array.isArray(radarData.zones) ? radarData.zones : []).forEach(function (zone) {
            var slots = zone.items.length + (zone.overflow > 0 ? 1 : 0);
            if (!slots) return;
            // Spread across 30°..150° (0° = east, measured from the bottom
            // anchor). Single chips sit at 90° (top of the arc).
            var startDeg = 32;
            var endDeg = 148;
            var step = slots > 1 ? (endDeg - startDeg) / (slots - 1) : 0;
            var radius = zoneRadius[zone.key] || 0.9;
            for (var s = 0; s < slots; s++) {
                var deg = slots === 1 ? 90 : startDeg + step * s;
                var rad = deg * Math.PI / 180;
                var x = 0.5 + (radius * 0.52) * Math.cos(rad) * -1; // mirror so earliest reads left→right
                var y = 1 - radius * 0.88 * Math.sin(rad);
                var isOverflow = s >= zone.items.length;
                if (isOverflow) {
                    chips.push({
                        item: null, zone: zone.key, statusKey: zone.key,
                        xPct: x * 100, yPct: y * 100,
                        label: '+' + zone.overflow + ' more', meta: '',
                        overflowCount: zone.overflow
                    });
                } else {
                    var item = zone.items[s];
                    var status = getUrgencyStatus(item, now);
                    chips.push({
                        item: item, zone: zone.key,
                        statusKey: zone.key === 'undated' ? 'undated' : status.key,
                        xPct: x * 100, yPct: y * 100,
                        label: String(item.title || 'Untitled'),
                        meta: chipTimeLabel(item, now),
                        overflowCount: 0
                    });
                }
            }
        });
        return chips;
    }

    /* ── Rendering ─────────────────────────────────────────────────────── */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';

    function svgEl(tag, attrs) {
        var node = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        return node;
    }

    // Background: concentric arc bands + zone labels, drawn once per render.
    function buildRadarBackdrop(width, height) {
        var svg = svgEl('svg', {
            class: 'radar-backdrop',
            viewBox: '0 0 ' + width + ' ' + height,
            preserveAspectRatio: 'none',
            'aria-hidden': 'true',
            focusable: 'false'
        });
        var cx = width / 2;
        var cy = height;
        var bands = [
            { key: 'today', r: 0.32 }, { key: 'tomorrow', r: 0.52 },
            { key: 'thisWeek', r: 0.72 }, { key: 'later', r: 0.92 }
        ];
        bands.forEach(function (band) {
            var rx = band.r * 0.52 * width;
            var ry = band.r * 0.88 * height;
            var path = svgEl('path', {
                class: 'radar-arc radar-arc-' + band.key,
                d: 'M ' + (cx - rx) + ' ' + cy + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + cy,
                fill: 'none'
            });
            svg.appendChild(path);
            var label = svgEl('text', {
                class: 'radar-zone-label',
                x: cx,
                y: cy - ry - 6,
                'text-anchor': 'middle'
            });
            label.textContent = (HORIZON_LABELS[band.key] || band.key).toUpperCase();
            svg.appendChild(label);
        });
        return svg;
    }

    function buildChipButton(chip, handlers) {
        var btn = el('button', 'radar-chip radar-chip-' + chip.statusKey + (chip.item ? '' : ' radar-chip-overflow'));
        btn.type = 'button';
        btn.style.left = chip.xPct.toFixed(2) + '%';
        btn.style.top = chip.yPct.toFixed(2) + '%';
        var dot = el('span', 'radar-chip-dot');
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
        var body = el('span', 'radar-chip-body');
        body.appendChild(el('span', 'radar-chip-title', chip.label));
        if (chip.meta) body.appendChild(el('span', 'radar-chip-meta', chip.meta));
        btn.appendChild(body);
        if (chip.item) {
            var statusText = chip.meta ? ' — ' + chip.meta : '';
            btn.setAttribute('aria-label', chip.label + statusText + '. Open source item.');
            btn.title = chip.label + (chip.item.subtitle ? ' · ' + chip.item.subtitle : '') + statusText;
            btn.addEventListener('click', function () {
                if (handlers.onOpen) handlers.onOpen(chip.item);
            });
        } else {
            btn.setAttribute('aria-label', chip.overflowCount + ' more items in the ' + (HORIZON_LABELS[chip.zone] || chip.zone) + ' zone. Open the full list.');
            btn.addEventListener('click', function () {
                if (handlers.onOverflow) handlers.onOverflow(chip.zone);
            });
        }
        return btn;
    }

    function buildLegend() {
        var legend = el('div', 'radar-legend');
        [
            ['overdue', 'Overdue'], ['today', 'Due Today'], ['tomorrow', 'Tomorrow'],
            ['thisWeek', 'This Week'], ['later', 'Later']
        ].forEach(function (pair) {
            var entry = el('span', 'radar-legend-item radar-legend-' + pair[0]);
            var dot = el('span', 'radar-legend-dot');
            dot.setAttribute('aria-hidden', 'true');
            entry.appendChild(dot);
            entry.appendChild(el('span', 'radar-legend-label', pair[1]));
            legend.appendChild(entry);
        });
        return legend;
    }

    // Vertical grouped list — the small-screen / fallback presentation of the
    // exact same radar data.
    function buildRadarList(radarData, now, handlers) {
        var wrap = el('div', 'radar-list');
        radarData.zones.forEach(function (zone) {
            if (!zone.items.length && !zone.overflow) return;
            var section = el('section', 'radar-list-zone radar-list-zone-' + zone.key);
            section.appendChild(el('h4', 'radar-list-zone-title', zone.label));
            zone.items.forEach(function (item) {
                var status = getUrgencyStatus(item, now);
                var row = el('button', 'radar-list-item radar-chip-' + (zone.key === 'undated' ? 'undated' : status.key));
                row.type = 'button';
                var dot = el('span', 'radar-chip-dot');
                dot.setAttribute('aria-hidden', 'true');
                row.appendChild(dot);
                var body = el('span', 'radar-chip-body');
                body.appendChild(el('span', 'radar-chip-title', String(item.title || 'Untitled')));
                body.appendChild(el('span', 'radar-chip-meta', chipTimeLabel(item, now) + (item.subtitle ? ' · ' + item.subtitle : '')));
                row.appendChild(body);
                row.addEventListener('click', function () {
                    if (handlers.onOpen) handlers.onOpen(item);
                });
                section.appendChild(row);
            });
            if (zone.overflow > 0) {
                var more = el('button', 'radar-list-item radar-chip-overflow');
                more.type = 'button';
                more.appendChild(el('span', 'radar-chip-title', '+' + zone.overflow + ' more'));
                more.addEventListener('click', function () {
                    if (handlers.onOverflow) handlers.onOverflow(zone.key);
                });
                section.appendChild(more);
            }
            wrap.appendChild(section);
        });
        if (!wrap.childNodes.length) {
            var empty = el('div', 'radar-empty');
            empty.appendChild(el('div', 'radar-empty-title', 'Nothing on the radar'));
            empty.appendChild(el('div', 'radar-empty-sub', 'Add a task or import assignments to see your week take shape.'));
            wrap.appendChild(empty);
        }
        return wrap;
    }

    /**
     * renderRadar(mount, items, opts) — renders the Upcoming Radar into
     * `mount`. opts:
     *   now          injected clock (Date)
     *   filter       radar filter key ('all' | 'tasks' | ... | 'undated')
     *   onOpen(item) open the underlying source
     *   onOverflow(zoneKey) open the full list (Deadline Radar modal)
     *   forceList    render the list fallback regardless of width
     */
    function renderRadar(mount, items, opts) {
        if (!mount) return;
        opts = opts || {};
        var now = toDate(opts.now) || new Date();
        var handlers = { onOpen: opts.onOpen, onOverflow: opts.onOverflow };
        var data = getUpcomingRadarItems(items, { now: now, filter: opts.filter });

        while (mount.firstChild) mount.removeChild(mount.firstChild);

        var useList = !!opts.forceList
            || opts.filter === 'undated'
            || (typeof mount.clientWidth === 'number' && mount.clientWidth > 0 && mount.clientWidth < 480);

        if (useList) {
            mount.appendChild(buildRadarList(data, now, handlers));
            mount.appendChild(buildLegend());
            return;
        }

        if (!data.visibleCount) {
            var empty = el('div', 'radar-empty');
            empty.appendChild(el('div', 'radar-empty-title', 'Nothing on the radar'));
            empty.appendChild(el('div', 'radar-empty-sub', 'Add a task or import assignments to see your week take shape.'));
            mount.appendChild(empty);
            mount.appendChild(buildLegend());
            return;
        }

        var stage = el('div', 'radar-stage');
        stage.setAttribute('role', 'group');
        stage.setAttribute('aria-label', 'Upcoming radar: items grouped by time horizon');
        var W = 700, H = 360;
        stage.appendChild(buildRadarBackdrop(W, H));
        computeRadarLayout(data, { now: now }).forEach(function (chip) {
            stage.appendChild(buildChipButton(chip, handlers));
        });
        mount.appendChild(stage);
        mount.appendChild(buildLegend());
    }

    window.SutraTodayCenter = {
        HORIZONS: HORIZONS,
        HORIZON_LABELS: HORIZON_LABELS,
        RADAR_FILTERS: RADAR_FILTERS.map(function (f) { return { key: f.key, label: f.label }; }),
        getUrgencyStatus: getUrgencyStatus,
        rankStudentNextStep: rankStudentNextStep,
        groupItemsByTimeHorizon: groupItemsByTimeHorizon,
        getNextPriorityItem: getNextPriorityItem,
        getTodaySummary: getTodaySummary,
        getTodayAgenda: getTodayAgenda,
        getUpcomingRadarItems: getUpcomingRadarItems,
        computeRadarLayout: computeRadarLayout,
        renderRadar: renderRadar
    };
})();
