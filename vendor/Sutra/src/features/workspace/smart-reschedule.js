/** Review-first Smart Reschedule UI over the canonical deterministic planner. */
;(function (global) {
    'use strict';
    var undoStack = [];

    function clone(value) { try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); } }
    function text(value) { return String(value == null ? '' : value); }
    function dateKey(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
    function localIso(date, time) { var d = new Date(String(date) + 'T' + String(time || '00:00') + ':00'); return Number.isFinite(d.getTime()) ? d.toISOString() : ''; }
    function legacyBlockToCanonical(block) {
        if (block.startAt && block.endAt) return block;
        return Object.assign({}, block, { startAt: localIso(block.date, block.start), endAt: localIso(block.date, block.end) });
    }
    function isoToLocalParts(value) {
        var d = new Date(value);
        return { date: dateKey(d), time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
    }
    function toast(message) {
        if (typeof global.showToast === 'function') global.showToast(message);
        else if (global.SutraToast && typeof global.SutraToast.show === 'function') global.SutraToast.show(message);
    }
    function workspaceSnapshot() {
        var fa = global.flowAtelier || {};
        var homework = {};
        try { homework = global.SutraHomeworkStore && global.SutraHomeworkStore.getSnapshot ? global.SutraHomeworkStore.getSnapshot() : (fa.homeworkWorkspace || {}); } catch (_) {}
        return {
            tasks: clone(fa.tasks || global.tasks || []),
            homeworkWorkspace: homework,
            testingHub: clone(fa.testingHub || {}),
            reviewWorkspace: clone(fa.reviewWorkspace || {}),
            collegeAppWorkspace: clone(fa.collegeAppWorkspace || {}),
            collegeTracker: clone(fa.collegeTracker || {}),
            taskDependencies: clone(fa.taskDependencies || []),
            studentDecisionState: clone(fa.studentDecisionState || {})
        };
    }
    function milestoneActions(homework) {
        var rows = [];
        (homework.tasks || []).forEach(function (task) {
            var milestones = task && task.studio && Array.isArray(task.studio.milestones) ? task.studio.milestones : [];
            milestones.forEach(function (milestone) {
                if (!milestone || milestone.done || ['done', 'completed'].indexOf(String(milestone.status || '').toLowerCase()) >= 0) return;
                rows.push({
                    id: 'milestone:' + milestone.id, sourceType: 'milestone', sourceId: milestone.id,
                    title: milestone.title || ('Milestone for ' + (task.title || 'assignment')),
                    dueAt: milestone.dueDate || task.dueDate || '', priority: task.priority,
                    estimatedMinutes: milestone.estimateMinutes || task.estimateMinutes || 30,
                    courseId: task.courseId || '', raw: milestone
                });
            });
        });
        return rows;
    }
    function collectReschedulableItems(options) {
        var ws = workspaceSnapshot();
        var rows = global.SutraStudentEngine && typeof global.SutraStudentEngine.getInbox === 'function'
            ? global.SutraStudentEngine.getInbox(ws, { now: options && options.now || new Date().toISOString() }) : [];
        var milestones = milestoneActions(ws.homeworkWorkspace);
        if (global.SutraStudentEngine && typeof global.SutraStudentEngine.rankActions === 'function') {
            milestones = global.SutraStudentEngine.rankActions(ws, milestones, { now: options && options.now || new Date().toISOString() });
        }
        return rows.concat(milestones).filter(function (row) { return !row.hidden && !row.completed; });
    }
    function protectedTime(options) {
        return Array.isArray(options && options.protectedTime) ? options.protectedTime : [];
    }
    function proposeSchedule(items, options) {
        if (!global.SutraPlanner || typeof global.SutraPlanner.proposeSchedule !== 'function') {
            return { proposals: [], unscheduled: [], warnings: ['The canonical planning engine is unavailable.'], impossibleWorkload: true, reviewed: false };
        }
        return global.SutraPlanner.proposeSchedule({
            actions: Array.isArray(items) ? items : collectReschedulableItems(options),
            existingBlocks: (global.timeBlocks || []).map(legacyBlockToCanonical),
            protectedTime: protectedTime(options)
        }, options || {});
    }
    async function persist(reason) {
        if (typeof global.flushAppSaveNow === 'function') return global.flushAppSaveNow(reason);
        if (typeof global.persistAppData === 'function') return Promise.resolve(global.persistAppData());
        throw new Error('Workspace persistence is unavailable.');
    }
    function refreshAffectedViews() {
        ['renderTimeline', 'renderTaskViews', 'renderTodayStudentHub', 'renderHomeworkWorkspace', 'refreshCurrentBlockIndicator', 'refreshNotifications'].forEach(function (name) {
            try { if (typeof global[name] === 'function') global[name](); } catch (_) {}
        });
        try { global.dispatchEvent(new CustomEvent('sutra:schedule-changed')); } catch (_) {}
    }
    async function applyProposals(proposals, selectedIds) {
        var selected = Array.isArray(selectedIds) ? new Set(selectedIds.map(String)) : null;
        var before = clone(global.timeBlocks || []);
        var applied = [];
        try {
            (proposals || []).forEach(function (proposal) {
                if (!proposal || proposal.status !== 'proposed' || (selected && !selected.has(String(proposal.actionId)))) return;
                var start = isoToLocalParts(proposal.startAt);
                var end = isoToLocalParts(proposal.endAt);
                if (proposal.operation === 'update' && proposal.linkedBlockId) {
                    var existing = (global.timeBlocks || []).find(function (block) { return String(block.id) === String(proposal.linkedBlockId); });
                    if (existing) {
                        existing.date = start.date; existing.start = start.time; existing.end = end.time;
                        existing.updatedAt = Date.now(); applied.push({ id: existing.id, operation: 'update' }); return;
                    }
                }
                var payload = {
                    date: start.date, start: start.time, end: end.time, name: proposal.title,
                    category: 'study', source: proposal.sourceType || 'smart_reschedule', sourceType: proposal.sourceType,
                    sourceId: proposal.sourceId, sourceKey: proposal.sourceKey, courseId: proposal.courseId,
                    priority: proposal.priority, dueAt: proposal.dueAt, createdAt: Date.now()
                };
                var id = global.flowAtelier && typeof global.flowAtelier.addCalendarBlockForTemplate === 'function'
                    ? global.flowAtelier.addCalendarBlockForTemplate(payload)
                    : (typeof global.addCalendarBlockForTemplate === 'function' ? global.addCalendarBlockForTemplate(payload) : null);
                if (!id) {
                    payload.id = 'smart_' + Date.now().toString(36) + '_' + applied.length;
                    if (!global.timeBlocks) global.timeBlocks = [];
                    global.timeBlocks.push(payload); id = payload.id;
                }
                applied.push({ id: id, operation: 'create' });
            });
            if (!applied.length) return { ok: false, code: 'nothing_selected', applied: [] };
            await persist('smart-reschedule');
            undoStack.push({ before: before, applied: clone(applied) });
            refreshAffectedViews();
            return { ok: true, code: 'applied', applied: applied };
        } catch (error) {
            global.timeBlocks = before;
            try { if (global.SutraReportError) global.SutraReportError(error, { where: 'smart-reschedule.apply' }, 'error'); } catch (_) {}
            refreshAffectedViews();
            return { ok: false, code: 'persistence_failed', applied: [], error: error };
        }
    }
    async function undoLastApply() {
        var receipt = undoStack.pop();
        if (!receipt) { toast('Nothing to undo.'); return { ok: false, code: 'nothing_to_undo' }; }
        var current = clone(global.timeBlocks || []);
        global.timeBlocks = clone(receipt.before);
        try {
            await persist('smart-reschedule-undo');
            refreshAffectedViews(); toast('Undid the last reschedule.');
            return { ok: true, code: 'undone' };
        } catch (error) {
            global.timeBlocks = current;
            refreshAffectedViews();
            return { ok: false, code: 'undo_persistence_failed', error: error };
        }
    }

    function showRescheduleModal(options) {
        var result = proposeSchedule(null, options || {});
        if (!result.proposals.length && !result.unscheduled.length) { toast('No eligible work needs rescheduling.'); return null; }
        var overlay = document.createElement('div');
        overlay.className = 'sutra-modal-overlay sutra-reschedule-overlay';
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Smart Reschedule proposal');
        var card = document.createElement('div'); card.className = 'sutra-modal-card sutra-reschedule-card';
        var heading = document.createElement('h3'); heading.textContent = 'Review Smart Reschedule'; card.appendChild(heading);
        var summary = document.createElement('p'); summary.textContent = result.proposals.length + ' can be placed; ' + result.unscheduled.length + ' cannot fit without breaking a rule.'; card.appendChild(summary);
        result.proposals.forEach(function (proposal) {
            var row = document.createElement('label'); row.className = 'sutra-reschedule-row';
            var check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.dataset.actionId = proposal.actionId;
            var copy = document.createElement('span'); copy.textContent = proposal.title + ' — ' + new Date(proposal.startAt).toLocaleString() + '. ' + proposal.reason;
            row.appendChild(check); row.appendChild(copy); card.appendChild(row);
        });
        result.unscheduled.forEach(function (item) { var row = document.createElement('p'); row.className = 'sutra-reschedule-unplaced'; row.textContent = item.title + ': ' + item.reason; card.appendChild(row); });
        var live = document.createElement('div'); live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.textContent = summary.textContent; card.appendChild(live);
        var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
        var apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply selected';
        cancel.addEventListener('click', function () { overlay.remove(); });
        apply.addEventListener('click', async function () {
            apply.disabled = true;
            var ids = Array.from(card.querySelectorAll('input[data-action-id]:checked')).map(function (input) { return input.dataset.actionId; });
            var receipt = await applyProposals(result.proposals, ids);
            toast(receipt.ok ? 'Schedule changes saved. Undo is available.' : 'Schedule changes were not saved.');
            if (receipt.ok) overlay.remove(); else apply.disabled = false;
        });
        card.appendChild(cancel); card.appendChild(apply); overlay.appendChild(card); document.body.appendChild(overlay); cancel.focus();
        return overlay;
    }
    function init() { global.openSmartReschedule = showRescheduleModal; global.undoSmartReschedule = undoLastApply; }
    var api = { collectReschedulableItems: collectReschedulableItems, proposeSchedule: proposeSchedule, applyProposals: applyProposals, undoLastApply: undoLastApply, showRescheduleModal: showRescheduleModal };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.SutraSmartReschedule = api;
    if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
}(typeof window !== 'undefined' ? window : globalThis));
