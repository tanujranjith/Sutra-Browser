/**
 * Canonical Timeline scheduling adapter.
 *
 * Dragging is only one input method. The same preview/apply primitive also
 * powers the keyboard/touch Schedule control and can be reused by legacy
 * "Schedule this" actions while preserving source identity.
 */
;(function registerTimelineScheduling(global) {
    'use strict';

    var dragData = null;
    var dragGhost = null;
    var undoStack = [];
    var pushUndoStack = [];
    var observer = null;

    function clone(value) {
        try { return structuredClone(value); }
        catch (_) { return JSON.parse(JSON.stringify(value)); }
    }

    function timeUtils() { return global.SutraTimeUtils || {}; }
    function hhmmToMinutes(value) {
        var helper = timeUtils().hhmmToMinutes;
        if (typeof helper === 'function') return helper(value);
        var match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
        if (!match) return null;
        var hours = Number(match[1]);
        var minutes = Number(match[2]);
        return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? (hours * 60) + minutes : null;
    }
    function minutesToHHMM(value) {
        var helper = timeUtils().minutesToHHMM;
        if (typeof helper === 'function') return helper(value);
        var total = Math.max(0, Math.min(1440, Math.round(Number(value) || 0)));
        return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    }
    function getToday() {
        var date = new Date();
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
    function validDate(value) {
        var raw = String(value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
        var parts = raw.split('-').map(Number);
        var date = new Date(parts[0], parts[1] - 1, parts[2]);
        return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2];
    }
    function generateBlockId() {
        var helper = timeUtils().generateBlockId;
        return typeof helper === 'function' ? helper() : 'block_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    function blocks() {
        var bridge = global.flowAtelier;
        if (bridge && Array.isArray(bridge.timeBlocks)) return bridge.timeBlocks;
        if (Array.isArray(global.timeBlocks)) return global.timeBlocks;
        global.timeBlocks = [];
        return global.timeBlocks;
    }
    function replaceBlocks(snapshot) {
        var target = blocks();
        target.splice.apply(target, [0, target.length].concat(clone(snapshot || [])));
    }
    function text(value) { return String(value == null ? '' : value); }
    function stableSourceType(value) {
        var source = text(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
        if (source === 'hw' || source === 'assignment') return 'homework';
        if (source === 'timeline_block') return 'timeline';
        return source || 'workspace';
    }
    function sourceKey(item) {
        return item.sourceId ? item.sourceType + ':' + item.sourceId : '';
    }

    function findHomeworkTask(id) {
        var snapshot = null;
        try {
            snapshot = global.SutraHomeworkStore && typeof global.SutraHomeworkStore.getSnapshot === 'function'
                ? global.SutraHomeworkStore.getSnapshot()
                : (global.flowAtelier && global.flowAtelier.homeworkWorkspace);
        } catch (_) {}
        return snapshot && Array.isArray(snapshot.tasks)
            ? snapshot.tasks.find(function (task) { return task && text(task.id) === text(id); })
            : null;
    }

    function enrichCanonicalSource(item) {
        var original = item || {};
        var sourceType = stableSourceType(original.sourceType || original.source);
        var sourceId = text(original.sourceId || original.id).replace(/^(?:task|hw):/, '');
        var canonical = null;
        if (sourceType === 'homework' && sourceId) canonical = findHomeworkTask(sourceId);
        if (sourceType === 'task' && sourceId) {
            var taskRows = global.flowAtelier && Array.isArray(global.flowAtelier.tasks) ? global.flowAtelier.tasks : [];
            canonical = taskRows.find(function (task) { return task && text(task.id) === sourceId; }) || null;
        }
        var merged = Object.assign({}, canonical || {}, original);
        var normalized = {
            title: text(merged.title || merged.name || merged.text || 'Scheduled item').trim() || 'Scheduled item',
            sourceType: sourceType,
            source: sourceType,
            sourceId: sourceId,
            courseId: text(merged.courseId),
            priority: text(merged.priority),
            dueAt: text(merged.dueAt || merged.dueDate || merged.due),
            effortMinutes: Math.max(0, Number(merged.effortMinutes || merged.estimatedMinutes || merged.estimateMinutes || 0) || 0),
            category: text(merged.category || (sourceType === 'homework' || sourceType === 'review' || sourceType === 'milestone' ? 'study' : 'general')),
            target: text(merged.target || 'timeline')
        };
        normalized.sourceKey = sourceKey(normalized);
        return normalized;
    }

    function linkedBlockFor(item, candidates) {
        if (!item || !item.sourceId) return null;
        var key = item.sourceKey || sourceKey(item);
        return (candidates || blocks()).find(function (block) {
            if (!block) return false;
            if (key && text(block.sourceKey) === key) return true;
            var type = stableSourceType(block.sourceType || block.source);
            if (type === item.sourceType && text(block.sourceId) === item.sourceId) return true;
            if (item.sourceType === 'homework') return text(block.homeworkId || block.assignmentId) === item.sourceId;
            if (item.sourceType === 'task') return text(block.taskId) === item.sourceId;
            return false;
        }) || null;
    }

    function findConflicts(date, startMin, endMin, excludeBlockId, candidates) {
        return (candidates || blocks()).filter(function (block) {
            if (!block || text(block.id) === text(excludeBlockId) || text(block.date) !== text(date)) return false;
            var blockStart = hhmmToMinutes(block.start);
            var blockEnd = hhmmToMinutes(block.end);
            return blockStart !== null && blockEnd !== null && startMin < blockEnd && endMin > blockStart;
        });
    }

    function previewSchedule(rawItem, slot, candidates) {
        var item = enrichCanonicalSource(rawItem);
        var date = text(slot && slot.date).slice(0, 10);
        var startMin = slot && slot.startMin != null ? Number(slot.startMin) : hhmmToMinutes(slot && slot.start);
        var requestedDuration = Number(slot && slot.durationMinutes || item.effortMinutes || 60);
        if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) requestedDuration = 60;
        var duration = Math.max(15, Math.min(720, Math.round(requestedDuration / 15) * 15));
        if (!validDate(date) || !Number.isFinite(startMin) || startMin < 0 || startMin >= 1440) {
            return { ok: false, code: 'invalid_slot', item: item, conflicts: [] };
        }
        var endMin = startMin + duration;
        if (endMin > 1440) return { ok: false, code: 'past_midnight', item: item, conflicts: [] };
        var linked = linkedBlockFor(item, candidates);
        var conflicts = findConflicts(date, startMin, endMin, linked && linked.id, candidates);
        return {
            ok: conflicts.length === 0,
            code: conflicts.length ? 'conflict' : 'ready',
            operation: linked ? 'update' : 'create',
            linkedBlockId: linked ? linked.id : '',
            item: item,
            date: date,
            start: minutesToHHMM(startMin),
            end: minutesToHHMM(endMin),
            startMin: startMin,
            endMin: endMin,
            durationMinutes: duration,
            conflicts: conflicts
        };
    }

    function blockPayload(preview, existing) {
        var item = preview.item;
        var payload = Object.assign({}, existing || {}, {
            id: existing && existing.id || generateBlockId(),
            date: preview.date,
            start: preview.start,
            end: preview.end,
            name: item.title,
            category: item.category,
            source: item.sourceType,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sourceKey: item.sourceKey,
            courseId: item.courseId,
            priority: item.priority,
            dueAt: item.dueAt,
            effortMinutes: item.effortMinutes || preview.durationMinutes,
            target: item.target || 'timeline',
            updatedAt: Date.now()
        });
        if (!existing) payload.createdAt = payload.updatedAt;
        if (item.sourceType === 'homework' && item.sourceId) {
            payload.homeworkId = item.sourceId;
            payload.assignmentId = item.sourceId;
        }
        if (item.sourceType === 'task' && item.sourceId) payload.taskId = item.sourceId;
        return payload;
    }

    async function persist(reason) {
        var bridge = global.flowAtelier || {};
        var saveResult;
        if (typeof bridge.saveTimeBlocks === 'function') saveResult = bridge.saveTimeBlocks();
        else if (typeof global.saveTimeBlocks === 'function') saveResult = global.saveTimeBlocks();
        if (saveResult && typeof saveResult.then === 'function') await saveResult;

        var flush = typeof bridge.flushAppSaveNow === 'function' ? bridge.flushAppSaveNow
            : (typeof global.flushAppSaveNow === 'function' ? global.flushAppSaveNow : null);
        if (flush) return flush(reason);
        var fallback = typeof bridge.persistAppData === 'function' ? bridge.persistAppData
            : (typeof global.persistAppData === 'function' ? global.persistAppData : null);
        if (!saveResult && fallback) return Promise.resolve(fallback(reason));
        if (!saveResult && !fallback) throw new Error('Workspace persistence is unavailable.');
        return saveResult;
    }

    function report(error, where) {
        try {
            if (typeof global.SutraReportError === 'function') global.SutraReportError(error, { where: where }, 'error');
        } catch (_) {}
    }
    function toast(message) {
        if (typeof global.showToast === 'function') global.showToast(message);
        else if (global.SutraToast && typeof global.SutraToast.show === 'function') global.SutraToast.show(message);
    }
    function refreshAffectedViews() {
        var bridge = global.flowAtelier || {};
        ['renderTimeline', 'renderTaskViews', 'renderTodayStudentHub', 'renderTodayView', 'renderHomeworkWorkspace', 'refreshCurrentBlockIndicator', 'refreshNotifications'].forEach(function (name) {
            try {
                if (typeof global[name] === 'function') global[name]();
                else if (typeof bridge[name] === 'function') bridge[name]();
            } catch (_) {}
        });
        try { global.dispatchEvent(new CustomEvent('sutra:schedule-changed')); } catch (_) {}
    }

    function ensureLiveRegion() {
        if (typeof document === 'undefined') return null;
        var region = document.getElementById('sutraTimelineScheduleStatus');
        if (!region) {
            region = document.createElement('div');
            region.id = 'sutraTimelineScheduleStatus';
            region.className = 'sr-only';
            region.setAttribute('aria-live', 'polite');
            region.setAttribute('aria-atomic', 'true');
            document.body.appendChild(region);
        }
        return region;
    }
    function announce(message, assertive) {
        var region = ensureLiveRegion();
        if (!region) return;
        region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
        region.textContent = '';
        setTimeout(function () { region.textContent = message; }, 0);
    }

    async function scheduleItemAt(rawItem, slot) {
        var before = clone(blocks());
        var preview = previewSchedule(rawItem, slot, before);
        if (!preview.ok) return preview;
        try {
            var target = blocks();
            var existing = preview.linkedBlockId
                ? target.find(function (block) { return text(block.id) === text(preview.linkedBlockId); })
                : null;
            var next = blockPayload(preview, existing);
            if (existing) Object.assign(existing, next);
            else target.push(next);
            await persist('timeline-schedule');
            undoStack.push({ before: before, blockId: next.id, operation: preview.operation });
            refreshAffectedViews();
            return Object.assign({}, preview, { ok: true, code: 'saved', block: clone(next) });
        } catch (error) {
            replaceBlocks(before);
            refreshAffectedViews();
            report(error, 'timeline-schedule.apply');
            return Object.assign({}, preview, { ok: false, code: 'persistence_failed', error: error });
        }
    }

    async function rescheduleBlock(blockId, newDate, newStartMin) {
        var block = blocks().find(function (candidate) { return text(candidate.id) === text(blockId); });
        if (!block) return { ok: false, code: 'block_not_found', conflicts: [] };
        var duration = Math.max(15, (hhmmToMinutes(block.end) || 0) - (hhmmToMinutes(block.start) || 0));
        var before = clone(blocks());
        var start = Number(newStartMin);
        var end = start + duration;
        var conflicts = findConflicts(newDate, start, end, blockId, before);
        if (!validDate(newDate) || !Number.isFinite(start) || start < 0 || end > 1440) return { ok: false, code: 'invalid_slot', conflicts: [] };
        if (conflicts.length) return { ok: false, code: 'conflict', conflicts: conflicts };
        try {
            block.date = newDate;
            block.start = minutesToHHMM(start);
            block.end = minutesToHHMM(end);
            block.updatedAt = Date.now();
            await persist('timeline-move');
            undoStack.push({ before: before, blockId: block.id, operation: 'move' });
            refreshAffectedViews();
            return { ok: true, code: 'saved', operation: 'move', block: clone(block), conflicts: [] };
        } catch (error) {
            replaceBlocks(before);
            refreshAffectedViews();
            report(error, 'timeline-schedule.move');
            return { ok: false, code: 'persistence_failed', error: error, conflicts: [] };
        }
    }

    async function undoLastSchedule() {
        var receipt = undoStack.pop();
        if (!receipt) return { ok: false, code: 'nothing_to_undo' };
        var current = clone(blocks());
        replaceBlocks(receipt.before);
        try {
            await persist('timeline-schedule-undo');
            refreshAffectedViews();
            announce('Undid the last Timeline schedule change.');
            return { ok: true, code: 'undone' };
        } catch (error) {
            replaceBlocks(current);
            refreshAffectedViews();
            return { ok: false, code: 'undo_persistence_failed', error: error };
        }
    }

    var MAX_PUSH_MINUTES = 7 * 24 * 60;

    function dateTimeStamp(dateValue, timeValue) {
        var rawDate = text(dateValue).slice(0, 10);
        var minuteValue = hhmmToMinutes(timeValue);
        if (!validDate(rawDate) || minuteValue === null) return null;
        var parts = rawDate.split('-').map(Number);
        return Date.UTC(parts[0], parts[1] - 1, parts[2], Math.floor(minuteValue / 60), minuteValue % 60);
    }

    function stampParts(stamp) {
        var date = new Date(stamp);
        return {
            date: date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0'),
            time: String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0')
        };
    }

    function shiftDateKey(value, dayDelta) {
        var stamp = dateTimeStamp(value, '00:00');
        return stamp === null ? text(value) : stampParts(stamp + (dayDelta * 86400000)).date;
    }

    function rotateWeekday(value, dayDelta) {
        var day = Number(value);
        if (!Number.isInteger(day) || day < 0 || day > 6) return null;
        return ((day + dayDelta) % 7 + 7) % 7;
    }

    function normalizePushRequest(options) {
        var input = options || {};
        var amount = Number(input.amount);
        var unit = text(input.unit || 'minutes').toLowerCase();
        var direction = text(input.direction || 'forward').toLowerCase();
        var multiplier = unit === 'hours' ? 60 : 1;
        var minutes = Math.round(amount * multiplier);
        if (!Number.isFinite(amount) || amount <= 0 || minutes <= 0 || minutes > MAX_PUSH_MINUTES || ['minutes', 'hours'].indexOf(unit) < 0 || ['forward', 'backward'].indexOf(direction) < 0) {
            return { ok: false, code: 'invalid_amount', deltaMinutes: 0 };
        }
        return { ok: true, code: 'ready', amount: amount, unit: unit, direction: direction, deltaMinutes: direction === 'backward' ? -minutes : minutes };
    }

    function shiftBlockForPush(block, deltaMinutes, now) {
        var start = hhmmToMinutes(block && block.start);
        var end = hhmmToMinutes(block && block.end);
        if (start === null || end === null || end <= start) {
            return { ok: false, code: 'invalid_time', block: block };
        }
        var rawDate = text(block && block.date).slice(0, 10);
        var hasDate = validDate(rawDate);
        var nextDate = rawDate;
        var nextStart;
        var nextEnd;
        var dayDelta = 0;

        if (hasDate) {
            var startStamp = dateTimeStamp(rawDate, block.start);
            var endStamp = dateTimeStamp(rawDate, block.end);
            var shiftedStart = stampParts(startStamp + (deltaMinutes * 60000));
            var shiftedEnd = stampParts(endStamp + (deltaMinutes * 60000));
            if (shiftedStart.date !== shiftedEnd.date) {
                return { ok: false, code: 'crosses_midnight', block: block };
            }
            nextDate = shiftedStart.date;
            nextStart = shiftedStart.time;
            nextEnd = shiftedEnd.time;
            dayDelta = Math.round((dateTimeStamp(nextDate, '00:00') - dateTimeStamp(rawDate, '00:00')) / 86400000);
        } else {
            var shiftedStartMinutes = start + deltaMinutes;
            var shiftedEndMinutes = end + deltaMinutes;
            var startDay = Math.floor(shiftedStartMinutes / 1440);
            var endDay = Math.floor(shiftedEndMinutes / 1440);
            if (startDay !== endDay) return { ok: false, code: 'crosses_midnight', block: block };
            if (startDay !== 0) return { ok: false, code: 'missing_date', block: block };
            nextStart = minutesToHHMM(((shiftedStartMinutes % 1440) + 1440) % 1440);
            nextEnd = minutesToHHMM(((shiftedEndMinutes % 1440) + 1440) % 1440);
        }

        var shifted = Object.assign({}, block, {
            start: nextStart,
            end: nextEnd,
            updatedAt: now
        });
        if (hasDate) shifted.date = nextDate;

        var recurrenceUntilDate = text(shifted.recurrenceUntil).slice(0, 10);
        if (dayDelta && validDate(recurrenceUntilDate)) {
            shifted.recurrenceUntil = shiftDateKey(recurrenceUntilDate, dayDelta);
        }
        var recurrence = text(shifted.recurrence || 'none').toLowerCase();
        if (dayDelta && recurrence === 'weekdays') {
            shifted.recurrence = 'weekly';
            shifted.weeklyDays = [1, 2, 3, 4, 5].map(function (day) { return rotateWeekday(day, dayDelta); });
        } else if (dayDelta && Array.isArray(shifted.weeklyDays)) {
            shifted.weeklyDays = shifted.weeklyDays.map(function (day) { return rotateWeekday(day, dayDelta); }).filter(function (day) { return day !== null; });
        }
        return { ok: true, code: 'ready', block: shifted, dayDelta: dayDelta };
    }

    function previewPushTime(options, candidates) {
        var request = normalizePushRequest(options);
        if (!request.ok) return Object.assign(request, { affectedCount: 0, blocked: [], changes: [] });
        var source = clone(Array.isArray(candidates) ? candidates : blocks());
        if (!source.length) return Object.assign(request, { ok: false, code: 'empty', affectedCount: 0, blocked: [], changes: [] });
        var now = Number(options && options.now) || Date.now();
        var blocked = [];
        var changes = [];
        var shiftedBlocks = source.map(function (block) {
            var result = shiftBlockForPush(block, request.deltaMinutes, now);
            if (!result.ok) {
                blocked.push({ id: text(block && block.id), name: text(block && (block.name || block.title) || 'Untitled block'), code: result.code });
                return block;
            }
            changes.push({
                id: text(block && block.id),
                name: text(block && (block.name || block.title) || 'Untitled block'),
                before: { date: text(block && block.date).slice(0, 10), start: text(block && block.start), end: text(block && block.end) },
                after: { date: text(result.block.date).slice(0, 10), start: text(result.block.start), end: text(result.block.end) }
            });
            return result.block;
        });
        if (blocked.length) {
            return Object.assign(request, { ok: false, code: 'blocked', affectedCount: changes.length, blocked: blocked, changes: changes, blocks: source });
        }
        return Object.assign(request, { ok: true, code: 'ready', affectedCount: changes.length, blocked: [], changes: changes, blocks: shiftedBlocks });
    }

    function updatePushUndoButton() {
        if (typeof document === 'undefined') return;
        var button = document.getElementById('timelineUndoPushTimeBtn');
        if (!button) return;
        button.hidden = pushUndoStack.length === 0;
        button.disabled = pushUndoStack.length === 0;
    }

    async function pushTime(options) {
        var before = clone(blocks());
        var preview = previewPushTime(options, before);
        if (!preview.ok) return preview;
        replaceBlocks(preview.blocks);
        try {
            await persist('timeline-push-time');
            pushUndoStack.push({ before: before, after: clone(preview.blocks), affectedCount: preview.affectedCount, deltaMinutes: preview.deltaMinutes });
            if (pushUndoStack.length > 10) pushUndoStack.shift();
            updatePushUndoButton();
            refreshAffectedViews();
            announce('Pushed ' + preview.affectedCount + ' Timeline block' + (preview.affectedCount === 1 ? '' : 's') + '.');
            return Object.assign({}, preview, { ok: true, code: 'saved' });
        } catch (error) {
            replaceBlocks(before);
            refreshAffectedViews();
            report(error, 'timeline-push-time.apply');
            return Object.assign({}, preview, { ok: false, code: 'persistence_failed', error: error });
        }
    }

    async function undoLastPushTime() {
        var receipt = pushUndoStack.pop();
        if (!receipt) return { ok: false, code: 'nothing_to_undo' };
        var current = clone(blocks());
        if (JSON.stringify(current) !== JSON.stringify(receipt.after)) {
            pushUndoStack.push(receipt);
            updatePushUndoButton();
            return { ok: false, code: 'calendar_changed' };
        }
        replaceBlocks(receipt.before);
        try {
            await persist('timeline-push-time-undo');
            updatePushUndoButton();
            refreshAffectedViews();
            announce('Undid the last Push time change.');
            return { ok: true, code: 'undone', affectedCount: receipt.affectedCount };
        } catch (error) {
            replaceBlocks(current);
            pushUndoStack.push(receipt);
            updatePushUndoButton();
            refreshAffectedViews();
            return { ok: false, code: 'undo_persistence_failed', error: error };
        }
    }

    function formatPushAmount(preview) {
        var value = preview.amount;
        var unit = preview.unit === 'hours' ? 'hour' : 'minute';
        return value + ' ' + unit + (value === 1 ? '' : 's');
    }

    function formatPushMoment(value) {
        var clock = text(value && value.start);
        try {
            if (global.SutraTimeUtils && typeof global.SutraTimeUtils.formatClockTime === 'function') clock = global.SutraTimeUtils.formatClockTime(clock);
        } catch (_) {}
        return [text(value && value.date), clock].filter(Boolean).join(' at ');
    }

    function closeTimelineMoreMenu() {
        if (typeof document === 'undefined') return;
        var menu = document.getElementById('timelineMoreMenu');
        var trigger = document.getElementById('timelineMoreBtn');
        if (menu) menu.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function openPushTimeDialog() {
        if (typeof document === 'undefined') return null;
        var existing = document.getElementById('sutraPushTimeOverlay');
        if (existing) existing.remove();
        closeTimelineMoreMenu();
        var previousFocus = document.activeElement;
        var overlay = document.createElement('div');
        overlay.id = 'sutraPushTimeOverlay';
        overlay.className = 'sutra-modal-overlay sutra-timeline-schedule-overlay sutra-push-time-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'sutraPushTimeTitle');
        var form = document.createElement('form');
        form.className = 'sutra-modal-card sutra-timeline-schedule-card sutra-push-time-card';
        var title = document.createElement('h3'); title.id = 'sutraPushTimeTitle'; title.textContent = 'Push time';
        var description = document.createElement('p'); description.className = 'sutra-push-time-description'; description.textContent = 'Move every Timeline block forward or backward by the same amount. Durations, links, colors, and notes stay unchanged.';
        var fields = document.createElement('div'); fields.className = 'sutra-push-time-fields';
        var directionLabel = document.createElement('label'); directionLabel.textContent = 'Direction';
        var direction = document.createElement('select'); direction.id = 'pushTimeDirection'; direction.className = 'neumo-input';
        [['forward', 'Forward'], ['backward', 'Backward']].forEach(function (row) { var option = document.createElement('option'); option.value = row[0]; option.textContent = row[1]; direction.appendChild(option); }); directionLabel.appendChild(direction);
        var amountLabel = document.createElement('label'); amountLabel.textContent = 'Amount';
        var amount = document.createElement('input'); amount.id = 'pushTimeAmount'; amount.type = 'number'; amount.min = '1'; amount.max = '168'; amount.step = '1'; amount.value = '30'; amount.required = true; amountLabel.appendChild(amount);
        var unitLabel = document.createElement('label'); unitLabel.textContent = 'Unit';
        var unit = document.createElement('select'); unit.id = 'pushTimeUnit'; unit.className = 'neumo-input';
        [['minutes', 'Minutes'], ['hours', 'Hours']].forEach(function (row) { var option = document.createElement('option'); option.value = row[0]; option.textContent = row[1]; unit.appendChild(option); }); unitLabel.appendChild(unit);
        fields.appendChild(directionLabel); fields.appendChild(amountLabel); fields.appendChild(unitLabel);
        var summary = document.createElement('p'); summary.id = 'pushTimeSummary'; summary.className = 'sutra-push-time-summary'; summary.setAttribute('aria-live', 'polite');
        var examples = document.createElement('ul'); examples.className = 'sutra-push-time-examples';
        var warning = document.createElement('p'); warning.className = 'sutra-push-time-warning'; warning.hidden = true;
        var actions = document.createElement('div'); actions.className = 'sutra-push-time-actions';
        var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = 'Cancel';
        var apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'btn btn-primary'; apply.id = 'applyPushTimeBtn'; apply.textContent = 'Push all blocks';
        actions.appendChild(cancel); actions.appendChild(apply);

        function close() {
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
        }
        function refreshPreview() {
            amount.max = unit.value === 'hours' ? '168' : String(MAX_PUSH_MINUTES);
            var preview = previewPushTime({ direction: direction.value, amount: amount.value, unit: unit.value });
            examples.replaceChildren(); warning.hidden = true; warning.textContent = '';
            if (preview.code === 'empty') {
                summary.textContent = 'There are no Timeline blocks to move.';
            } else if (preview.code === 'invalid_amount') {
                summary.textContent = 'Enter an amount between 1 minute and 168 hours.';
            } else if (preview.code === 'blocked') {
                summary.textContent = 'Nothing will move until every block can be shifted safely.';
                var names = preview.blocked.slice(0, 3).map(function (item) { return item.name; });
                warning.hidden = false;
                warning.textContent = preview.blocked.length + ' block' + (preview.blocked.length === 1 ? '' : 's') + ' would cross midnight or has an invalid/missing date: ' + names.join(', ') + (preview.blocked.length > names.length ? ', and more.' : '.');
            } else {
                summary.textContent = preview.affectedCount + ' block' + (preview.affectedCount === 1 ? '' : 's') + ' will move ' + preview.direction + ' by ' + formatPushAmount(preview) + '.';
                preview.changes.slice(0, 3).forEach(function (change) {
                    var item = document.createElement('li');
                    item.textContent = change.name + ': ' + formatPushMoment(change.before) + ' -> ' + formatPushMoment(change.after);
                    examples.appendChild(item);
                });
            }
            apply.disabled = !preview.ok;
            return preview;
        }
        [direction, amount, unit].forEach(function (control) { control.addEventListener('input', refreshPreview); control.addEventListener('change', refreshPreview); });
        cancel.addEventListener('click', close);
        overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key !== 'Tab') return;
            var focusable = Array.from(form.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            var first = focusable[0]; var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            var preview = refreshPreview();
            if (!preview.ok) return;
            apply.disabled = true;
            var result = await pushTime({ direction: direction.value, amount: amount.value, unit: unit.value });
            if (result.ok) {
                toast('Pushed ' + result.affectedCount + ' Timeline block' + (result.affectedCount === 1 ? '' : 's') + ' ' + result.direction + '. Undo is available in the Timeline menu.');
                close();
            } else {
                summary.textContent = result.code === 'persistence_failed' ? 'Push time could not be saved. Your calendar was restored.' : 'Push time could not be applied.';
                apply.disabled = false;
            }
        });
        form.appendChild(title); form.appendChild(description); form.appendChild(fields); form.appendChild(summary); form.appendChild(examples); form.appendChild(warning); form.appendChild(actions);
        overlay.appendChild(form); document.body.appendChild(overlay); refreshPreview(); amount.focus(); amount.select();
        return overlay;
    }

    function bindPushTimeControls() {
        if (typeof document === 'undefined') return;
        var pushButton = document.getElementById('timelinePushTimeBtn');
        if (pushButton && pushButton.dataset.bound !== 'true') {
            pushButton.dataset.bound = 'true';
            pushButton.addEventListener('click', function () { openPushTimeDialog(); });
        }
        var undoButton = document.getElementById('timelineUndoPushTimeBtn');
        if (undoButton && undoButton.dataset.bound !== 'true') {
            undoButton.dataset.bound = 'true';
            undoButton.addEventListener('click', async function () {
                closeTimelineMoreMenu(); undoButton.disabled = true;
                var result = await undoLastPushTime();
                toast(result.ok ? 'Undid the last Push time change.' : (result.code === 'calendar_changed' ? 'Undo was not applied because the calendar changed after Push time.' : 'The last Push time change could not be undone.'));
                updatePushUndoButton();
            });
        }
        updatePushUndoButton();
    }

    function itemFromElement(element) {
        return enrichCanonicalSource({
            title: element.getAttribute('data-drag-title') || element.textContent.trim(),
            source: element.getAttribute('data-drag-source') || 'workspace',
            sourceId: element.getAttribute('data-drag-source-id') || '',
            dueDate: element.getAttribute('data-drag-due-date') || '',
            courseId: element.getAttribute('data-drag-course-id') || '',
            priority: element.getAttribute('data-drag-priority') || '',
            effortMinutes: element.getAttribute('data-drag-effort-minutes') || '',
            target: element.getAttribute('data-drag-target') || 'timeline'
        });
    }

    function conflictMessage(result) {
        if (result.code === 'past_midnight') return 'This block would extend past midnight. Choose an earlier start or shorter duration.';
        if (result.code === 'invalid_slot') return 'Choose a valid date, start time, and duration.';
        if (result.code === 'persistence_failed') return 'The schedule change could not be saved. No Timeline changes were kept.';
        var names = (result.conflicts || []).map(function (block) { return block.name || 'another block'; });
        return names.length ? 'That time overlaps ' + names.join(', ') + '. Choose an open time.' : 'That schedule change is not available.';
    }

    function openScheduleDialog(rawItem, initial) {
        if (typeof document === 'undefined') return null;
        var item = enrichCanonicalSource(rawItem);
        var existing = linkedBlockFor(item);
        var previousFocus = document.activeElement;
        var overlay = document.createElement('div');
        overlay.className = 'sutra-modal-overlay sutra-timeline-schedule-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', existing ? 'Reschedule linked Timeline block' : 'Schedule on Timeline');
        var card = document.createElement('form');
        card.className = 'sutra-modal-card sutra-timeline-schedule-card';
        var heading = document.createElement('h3');
        heading.textContent = existing ? 'Reschedule on Timeline' : 'Schedule on Timeline';
        var description = document.createElement('p');
        description.textContent = item.title + (existing ? ' already has a linked block. Saving updates it instead of creating a duplicate.' : ' will remain linked to its original workspace item.');
        var dateLabel = document.createElement('label'); dateLabel.textContent = 'Date';
        var dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.required = true;
        dateInput.value = text(initial && initial.date || existing && existing.date || item.dueAt).slice(0, 10) || getToday(); dateLabel.appendChild(dateInput);
        var startLabel = document.createElement('label'); startLabel.textContent = 'Start time';
        var startInput = document.createElement('input'); startInput.type = 'time'; startInput.step = '900'; startInput.required = true;
        startInput.value = text(initial && initial.start || existing && existing.start || '18:00'); startLabel.appendChild(startInput);
        var durationLabel = document.createElement('label'); durationLabel.textContent = 'Duration (minutes)';
        var durationInput = document.createElement('input'); durationInput.type = 'number'; durationInput.min = '15'; durationInput.max = '720'; durationInput.step = '15';
        var existingDuration = existing ? (hhmmToMinutes(existing.end) - hhmmToMinutes(existing.start)) : 0;
        durationInput.value = String(initial && initial.durationMinutes || existingDuration || item.effortMinutes || 60); durationLabel.appendChild(durationInput);
        var status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
        var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
        var save = document.createElement('button'); save.type = 'submit'; save.textContent = existing ? 'Update block' : 'Schedule';
        function close() {
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
        }
        function currentPreview() {
            var result = previewSchedule(item, { date: dateInput.value, start: startInput.value, durationMinutes: durationInput.value });
            status.textContent = result.ok ? (result.operation === 'update' ? 'Ready to update the linked block.' : 'This time is open.') : conflictMessage(result);
            save.disabled = !result.ok;
            return result;
        }
        [dateInput, startInput, durationInput].forEach(function (input) { input.addEventListener('input', currentPreview); });
        cancel.addEventListener('click', close);
        overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key !== 'Tab') return;
            var focusable = Array.from(card.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            var first = focusable[0]; var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        card.addEventListener('submit', async function (event) {
            event.preventDefault();
            var preview = currentPreview();
            if (!preview.ok) return;
            save.disabled = true;
            var result = await scheduleItemAt(item, preview);
            if (result.ok) {
                var message = (result.operation === 'update' ? 'Updated' : 'Scheduled') + ' "' + item.title + '" at ' + result.start + '. Undo is available.';
                toast(message); announce(message); close();
            } else {
                status.textContent = conflictMessage(result); save.disabled = false;
            }
        });
        card.appendChild(heading); card.appendChild(description); card.appendChild(dateLabel); card.appendChild(startLabel);
        card.appendChild(durationLabel); card.appendChild(status); card.appendChild(cancel); card.appendChild(save);
        overlay.appendChild(card); document.body.appendChild(overlay); currentPreview(); dateInput.focus();
        return overlay;
    }

    function createDragGhost(label) {
        var ghost = document.createElement('div');
        ghost.className = 'timeline-drag-ghost'; ghost.textContent = label;
        document.body.appendChild(ghost); return ghost;
    }
    function findDropTimeFromY(container, clientY) {
        var rect = container.getBoundingClientRect();
        var relativeY = clientY - rect.top + container.scrollTop;
        var hour = container.querySelector('.timeline-hour-row');
        var hourHeight = hour && hour.offsetHeight || 60;
        return Math.max(0, Math.min(1425, Math.round(((relativeY / hourHeight) * 60) / 15) * 15));
    }
    function clearHighlights() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.timeline-drop-hover,.timeline-drop-invalid').forEach(function (element) {
            element.classList.remove('timeline-drop-hover', 'timeline-drop-invalid');
            element.removeAttribute('data-drop-invalid');
        });
    }
    function markInvalid(zone, message) {
        zone.classList.add('timeline-drop-invalid'); zone.setAttribute('data-drop-invalid', 'true');
        announce(message, true); toast(message);
    }
    function handleDragStart(event) {
        if (event.target.closest && event.target.closest('[data-timeline-schedule-trigger]')) return;
        var blockElement = event.target.closest && event.target.closest('[data-block-id]');
        var sourceElement = event.target.closest && event.target.closest('[draggable="true"]');
        if (!sourceElement) return;
        if (blockElement) {
            dragData = { blockId: blockElement.getAttribute('data-block-id'), title: blockElement.getAttribute('data-block-name') || blockElement.textContent.trim().slice(0, 80) };
            event.dataTransfer.setData('application/x-sutra-block-id', dragData.blockId);
        } else {
            dragData = { item: itemFromElement(sourceElement), title: itemFromElement(sourceElement).title };
        }
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragData.title);
        dragGhost = createDragGhost(dragData.title); event.dataTransfer.setDragImage(dragGhost, 0, 0);
        sourceElement.classList.add('timeline-dragging');
    }
    function handleDragEnd(event) {
        var element = event.target.closest && event.target.closest('[draggable="true"]');
        if (element) element.classList.remove('timeline-dragging');
        if (dragGhost) dragGhost.remove();
        dragGhost = null; dragData = null; clearHighlights();
    }
    async function handleDrop(event) {
        var zone = event.target.closest && event.target.closest('.timeline-drop-zone');
        if (!zone) return;
        event.preventDefault(); clearHighlights();
        var date = zone.getAttribute('data-drop-date') || getToday();
        var startMin = findDropTimeFromY(zone, event.clientY);
        var blockId = event.dataTransfer.getData('application/x-sutra-block-id') || (dragData && dragData.blockId);
        if (!blockId && !(dragData && dragData.item)) {
            markInvalid(zone, 'Only Sutra workspace items can be dropped onto the Timeline.');
            return;
        }
        var result = blockId
            ? await rescheduleBlock(blockId, date, startMin)
            : await scheduleItemAt(dragData && dragData.item || {}, { date: date, startMin: startMin, durationMinutes: 60 });
        if (result.ok) {
            var message = (result.operation === 'move' ? 'Moved' : result.operation === 'update' ? 'Updated' : 'Scheduled') + ' "' + (result.block.name || 'block') + '" at ' + result.block.start + '. Undo is available.';
            toast(message); announce(message);
        } else markInvalid(zone, conflictMessage(result));
        dragData = null;
    }

    function makeDraggable(element, options) {
        if (!element) return;
        element.setAttribute('draggable', 'true');
        var opts = options || {};
        [['title', 'data-drag-title'], ['source', 'data-drag-source'], ['sourceId', 'data-drag-source-id'], ['dueDate', 'data-drag-due-date'], ['courseId', 'data-drag-course-id'], ['priority', 'data-drag-priority'], ['effortMinutes', 'data-drag-effort-minutes']].forEach(function (pair) {
            if (opts[pair[0]] != null) element.setAttribute(pair[1], text(opts[pair[0]]));
        });
        enhanceSchedulingSources(element.parentNode || element);
    }
    function enhanceSchedulingSources(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        var rows = [];
        if (root.matches && root.matches('[data-drag-source-id]:not([data-block-id])')) rows.push(root);
        root.querySelectorAll('[data-drag-source-id]:not([data-block-id])').forEach(function (row) { rows.push(row); });
        rows.forEach(function (row) {
            // Homework renders its own schedule action inside a table cell. Appending
            // another button to a <tr> is invalid table markup, so browsers relocate
            // it outside the table and it can overlap adjacent panels.
            if (row.matches('tr') || row.closest('.hw-assignment-table')) return;
            if (row.querySelector('[data-timeline-schedule-trigger]')) return;
            var button = document.createElement('button'); button.type = 'button'; button.className = 'timeline-schedule-trigger';
            button.setAttribute('data-timeline-schedule-trigger', ''); button.textContent = 'Schedule';
            button.setAttribute('aria-label', 'Schedule ' + itemFromElement(row).title + ' on Timeline');
            button.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); openScheduleDialog(itemFromElement(row)); });
            row.appendChild(button);
        });
    }
    function init() {
        ensureLiveRegion(); enhanceSchedulingSources(document); bindPushTimeControls();
        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('dragend', handleDragEnd);
        document.addEventListener('dragover', function (event) {
            var zone = event.target.closest && event.target.closest('.timeline-drop-zone');
            if (!zone) return;
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; zone.classList.add('timeline-drop-hover');
        });
        document.addEventListener('dragleave', function (event) {
            var zone = event.target.closest && event.target.closest('.timeline-drop-zone'); if (zone) zone.classList.remove('timeline-drop-hover');
        });
        document.addEventListener('drop', handleDrop);
        document.addEventListener('keydown', function (event) {
            if (!(event.altKey && String(event.key).toLowerCase() === 's')) return;
            var row = event.target.closest && event.target.closest('[data-drag-source-id]:not([data-block-id])');
            if (!row) return;
            event.preventDefault(); openScheduleDialog(itemFromElement(row));
        });
        if (typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(function (records) { records.forEach(function (record) { record.addedNodes.forEach(enhanceSchedulingSources); }); });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    var api = {
        makeDraggable: makeDraggable,
        enrichCanonicalSource: enrichCanonicalSource,
        linkedBlockFor: linkedBlockFor,
        previewSchedule: previewSchedule,
        scheduleItemAt: scheduleItemAt,
        createBlockFromDrop: function (date, startMin, duration, title, source) { return scheduleItemAt({ title: title, source: source }, { date: date, startMin: startMin, durationMinutes: duration }); },
        rescheduleBlock: rescheduleBlock,
        undoLastSchedule: undoLastSchedule,
        previewPushTime: previewPushTime,
        pushTime: pushTime,
        undoLastPushTime: undoLastPushTime,
        openPushTimeDialog: openPushTimeDialog,
        openScheduleDialog: openScheduleDialog,
        findConflicts: findConflicts,
        findDropTimeFromY: findDropTimeFromY,
        generateBlockId: generateBlockId,
        minutesToHHMM: minutesToHHMM,
        hhmmToMinutes: hhmmToMinutes
    };
    global.SutraTimelineDrag = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
}(typeof window !== 'undefined' ? window : globalThis));
