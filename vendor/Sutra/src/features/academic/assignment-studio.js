/* ==========================================================================
   Sutra Assignment Studio — big assignments become real workspaces
   ==========================================================================
   Any Homework assignment can expand into a Studio: milestones, subtasks,
   rubric criteria, linked notes & course files, effort tracking, revision
   notes, progress, and Timeline scheduling for the remaining work.

   No parallel data model: the Studio payload lives on the homework task
   itself (canonical homework workspace → task.studio), so it rides the primary
   persistence system and encrypted .sutra backups.
   Milestones surface in All Due / notifications via collectWorkspaceDeadlines.
   ========================================================================== */

/* global window, document */

(function (global) {
    'use strict';

    var STUDIO_KINDS = ['essay', 'lab', 'research', 'presentation', 'engineering', 'project', 'other'];
    var MILESTONE_TYPES = ['research', 'outline', 'draft', 'revise', 'submit', 'study', 'rehearse', 'build', 'solve', 'review', 'other'];
    var MILESTONE_STATUSES = ['not_started', 'in_progress', 'done'];

    function uid(prefix) {
        return (prefix || 'st') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ---- Normalization (shared with homework.js via window.SutraAssignmentStudio) ----
    function normalizeMilestone(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var title = String(raw.title || '').trim();
        if (!title) return null;
        var estimate = Number(raw.estimateMinutes);
        // Status & done are reconciled so neither field's completion is ever lost:
        // a `done:true` from legacy/imported/assistant data still reads as done even
        // if `status` says otherwise, and `status:'done'` implies done. This keeps
        // computeProgress (which reads m.done) correct for any writer.
        var status = MILESTONE_STATUSES.indexOf(String(raw.status)) !== -1 ? String(raw.status) : '';
        var done = raw.done === true;
        if (!status) status = done ? 'done' : 'not_started';
        if (status === 'done') done = true;
        else if (done) status = 'done';
        var linkedBlockIds = (Array.isArray(raw.linkedBlockIds) ? raw.linkedBlockIds : [])
            .map(String).filter(Boolean).slice(0, 40);
        return {
            id: String(raw.id || uid('ms')),
            title: title,
            type: MILESTONE_TYPES.indexOf(String(raw.type)) !== -1 ? String(raw.type) : 'other',
            dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dueDate || '')) ? String(raw.dueDate) : '',
            dueTime: /^\d{2}:\d{2}$/.test(String(raw.dueTime || '')) ? String(raw.dueTime) : '',
            status: status,
            done: done,
            estimateMinutes: Number.isFinite(estimate) ? Math.max(0, Math.min(6000, Math.round(estimate))) : 0,
            linkedNoteId: String(raw.linkedNoteId || ''),
            linkedBlockIds: linkedBlockIds
        };
    }

    function normalizeSubtask(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var title = String(raw.title || '').trim();
        if (!title) return null;
        return { id: String(raw.id || uid('sub')), title: title, done: raw.done === true };
    }

    function normalizeRubricRow(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var criterion = String(raw.criterion || raw.title || '').trim();
        if (!criterion) return null;
        var points = Number(raw.points);
        return {
            id: String(raw.id || uid('rub')),
            criterion: criterion,
            points: Number.isFinite(points) ? Math.max(0, Math.min(1000, points)) : 0,
            met: raw.met === true
        };
    }

    function normalizeStudio(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var effort = raw.effort && typeof raw.effort === 'object' ? raw.effort : {};
        var estimate = Number(effort.estimateMinutes);
        var logged = Number(effort.loggedMinutes);
        var progressPct = Number(raw.progressPct);
        return {
            enabled: raw.enabled !== false,
            kind: STUDIO_KINDS.indexOf(String(raw.kind)) !== -1 ? String(raw.kind) : 'project',
            milestones: (Array.isArray(raw.milestones) ? raw.milestones : []).map(normalizeMilestone).filter(Boolean).slice(0, 60),
            subtasks: (Array.isArray(raw.subtasks) ? raw.subtasks : []).map(normalizeSubtask).filter(Boolean).slice(0, 120),
            rubric: (Array.isArray(raw.rubric) ? raw.rubric : []).map(normalizeRubricRow).filter(Boolean).slice(0, 60),
            linkedPageIds: (Array.isArray(raw.linkedPageIds) ? raw.linkedPageIds : []).map(String).filter(Boolean).slice(0, 40),
            linkedFileIds: (Array.isArray(raw.linkedFileIds) ? raw.linkedFileIds : []).map(String).filter(Boolean).slice(0, 40),
            effort: {
                estimateMinutes: Number.isFinite(estimate) ? Math.max(0, Math.round(estimate)) : 0,
                loggedMinutes: Number.isFinite(logged) ? Math.max(0, Math.round(logged)) : 0
            },
            progressMode: raw.progressMode === 'manual' ? 'manual' : 'auto',
            progressPct: Number.isFinite(progressPct) ? Math.max(0, Math.min(100, Math.round(progressPct))) : 0,
            revisions: (Array.isArray(raw.revisions) ? raw.revisions : []).filter(function (r) {
                return r && typeof r === 'object' && String(r.note || '').trim();
            }).map(function (r) {
                return { id: String(r.id || uid('rev')), at: r.at || new Date().toISOString(), note: String(r.note).trim() };
            }).slice(0, 100),
            updatedAt: raw.updatedAt || new Date().toISOString()
        };
    }

    function computeProgress(studio) {
        if (!studio) return 0;
        if (studio.progressMode === 'manual') return studio.progressPct;
        var total = 0;
        var done = 0;
        studio.milestones.forEach(function (m) { total += 2; if (m.done) done += 2; }); // milestones weigh double
        studio.subtasks.forEach(function (s) { total += 1; if (s.done) done += 1; });
        if (!total) return 0;
        return Math.round((done / total) * 100);
    }

    // ---- Deterministic milestone generation (no AI) ----------------------------
    // Each template entry: { title, type, weight } where weight biases how far
    // before the deadline it lands and a baseline estimate in minutes.
    var PLAN_TEMPLATES = {
        essay: [
            { title: 'Research & gather sources', type: 'research', estimateMinutes: 45 },
            { title: 'Outline', type: 'outline', estimateMinutes: 30 },
            { title: 'Rough draft', type: 'draft', estimateMinutes: 60 },
            { title: 'Revise', type: 'revise', estimateMinutes: 45 },
            { title: 'Final proofread', type: 'review', estimateMinutes: 20 },
            { title: 'Submit', type: 'submit', estimateMinutes: 10 }
        ],
        project: [
            { title: 'Define scope', type: 'outline', estimateMinutes: 30 },
            { title: 'Gather materials', type: 'research', estimateMinutes: 30 },
            { title: 'Build', type: 'build', estimateMinutes: 90 },
            { title: 'Test', type: 'review', estimateMinutes: 30 },
            { title: 'Revise', type: 'revise', estimateMinutes: 45 },
            { title: 'Submit', type: 'submit', estimateMinutes: 10 }
        ],
        presentation: [
            { title: 'Outline', type: 'outline', estimateMinutes: 30 },
            { title: 'Build slides', type: 'build', estimateMinutes: 60 },
            { title: 'Speaker notes', type: 'draft', estimateMinutes: 30 },
            { title: 'Rehearse', type: 'rehearse', estimateMinutes: 30 },
            { title: 'Final polish', type: 'review', estimateMinutes: 20 }
        ],
        lab: [
            { title: 'Pre-lab', type: 'research', estimateMinutes: 30 },
            { title: 'Data collection', type: 'build', estimateMinutes: 60 },
            { title: 'Analysis', type: 'solve', estimateMinutes: 45 },
            { title: 'Write-up', type: 'draft', estimateMinutes: 45 },
            { title: 'Submit', type: 'submit', estimateMinutes: 10 }
        ],
        test: [
            { title: 'Review weak topics', type: 'study', estimateMinutes: 45 },
            { title: 'Practice questions', type: 'solve', estimateMinutes: 45 },
            { title: 'Error review', type: 'review', estimateMinutes: 30 },
            { title: 'Final review', type: 'study', estimateMinutes: 30 }
        ],
        reading: [
            { title: 'Read — first chunk', type: 'study', estimateMinutes: 40 },
            { title: 'Read — second chunk', type: 'study', estimateMinutes: 40 },
            { title: 'Take notes', type: 'draft', estimateMinutes: 25 },
            { title: 'Review', type: 'review', estimateMinutes: 20 }
        ],
        generic: [
            { title: 'First pass', type: 'build', estimateMinutes: 45 },
            { title: 'Check work', type: 'review', estimateMinutes: 20 },
            { title: 'Submit', type: 'submit', estimateMinutes: 10 }
        ]
    };

    // Map free-form assignment kinds/types to a template key.
    function resolvePlanKey(kind) {
        var k = String(kind || '').toLowerCase().trim();
        if (!k) return 'generic';
        if (/(essay|paper|writ|report)/.test(k)) return 'essay';
        if (/(present|slide|speech|talk)/.test(k)) return 'presentation';
        if (/lab/.test(k)) return 'lab';
        if (/(test|quiz|exam|midterm|final)/.test(k)) return 'test';
        if (/(read|chapter|textbook)/.test(k)) return 'reading';
        if (/(project|build|engineer|design|research)/.test(k)) return 'project';
        if (PLAN_TEMPLATES[k]) return k;
        return 'generic';
    }

    function generateMilestones(kind) {
        var key = resolvePlanKey(kind);
        return (PLAN_TEMPLATES[key] || PLAN_TEMPLATES.generic).map(function (t) {
            return { title: t.title, type: t.type, estimateMinutes: t.estimateMinutes };
        });
    }

    // ---- Work-backward scheduling ----------------------------------------------
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function toISODateLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parseISO(iso) { var d = new Date(String(iso) + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
    function addDaysISO(iso, n) {
        var d = parseISO(iso);
        if (!d) return '';
        d.setDate(d.getDate() + n);
        return toISODateLocal(d);
    }
    function daysBetweenISO(a, b) {
        var da = parseISO(a), db = parseISO(b);
        if (!da || !db) return 0;
        return Math.round((db.getTime() - da.getTime()) / 86400000);
    }

    /**
     * Spread milestones across the days leading up to (and ending on) dueDate,
     * working backward so the last item lands on the deadline and earlier items
     * are distributed before it. Returns { milestones, compressed, pressure }.
     *   - compressed: not enough days to give each milestone its own day.
     *   - pressure:   due date is today/past or only a day or two away.
     */
    function scheduleMilestonesBackward(milestones, dueDate, opts) {
        opts = opts || {};
        var list = (Array.isArray(milestones) ? milestones : []).map(function (m) {
            return normalizeMilestone(m) || normalizeMilestone({ title: 'Step', type: 'other' });
        }).filter(Boolean);
        var n = list.length;
        if (!n) return { milestones: [], compressed: false, pressure: false };
        var due = /^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || '')) ? String(dueDate) : '';
        if (!due) return { milestones: list, compressed: false, pressure: false };
        var start = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.startDate || '')) ? String(opts.startDate) : toISODateLocal(new Date());
        var available = daysBetweenISO(start, due);
        var compressed = available < n;
        var pressure = available <= 2;
        if (available <= 0) {
            // Due today or already past — compressed crunch plan, everything on the due date.
            list.forEach(function (m) { m.dueDate = due; });
            return { milestones: list, compressed: true, pressure: true };
        }
        for (var i = 0; i < n; i++) {
            var offset = Math.round(((i + 1) / n) * available);
            if (offset > available) offset = available;
            if (offset < 1 && i < n - 1) offset = 1; // never pile non-final milestones on the start day
            list[i].dueDate = addDaysISO(start, offset);
        }
        // Guarantee the final milestone lands exactly on the deadline.
        list[n - 1].dueDate = due;
        return { milestones: list, compressed: compressed, pressure: pressure };
    }

    /**
     * Full plan builder: pick a template from the assignment kind, then schedule
     * it backward from the due date. Pure — returns data only, persists nothing.
     */
    function buildPlan(opts) {
        opts = opts || {};
        var generated = generateMilestones(opts.kind);
        var scheduled = scheduleMilestonesBackward(generated, opts.dueDate, { startDate: opts.startDate });
        return {
            kind: resolvePlanKey(opts.kind),
            milestones: scheduled.milestones,
            compressed: scheduled.compressed,
            pressure: scheduled.pressure
        };
    }

    var Engine = {
        normalizeStudio: normalizeStudio,
        computeProgress: computeProgress,
        generateMilestones: generateMilestones,
        scheduleMilestonesBackward: scheduleMilestonesBackward,
        buildPlan: buildPlan,
        resolvePlanKey: resolvePlanKey,
        MILESTONE_TYPES: MILESTONE_TYPES,
        MILESTONE_STATUSES: MILESTONE_STATUSES
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    if (typeof window === 'undefined') return;

    // ---- Canonical homework store access --------------------------------------
    function homeworkSnapshot() {
        try {
            return global.SutraHomeworkStore && typeof global.SutraHomeworkStore.getSnapshot === 'function'
                ? global.SutraHomeworkStore.getSnapshot()
                : { courses: [], tasks: [] };
        } catch (e) { return { courses: [], tasks: [] }; }
    }
    function readTasks() {
        var rows = homeworkSnapshot().tasks;
        return Array.isArray(rows) ? rows : [];
    }
    function readCourses() {
        var rows = homeworkSnapshot().courses;
        return Array.isArray(rows) ? rows : [];
    }
    function getTask(taskId) {
        var tasks = readTasks();
        for (var i = 0; i < tasks.length; i++) {
            if (String(tasks[i].id) === String(taskId)) return tasks[i];
        }
        return null;
    }

    function updateTaskStudio(taskId, mutate) {
        var found = false;
        try {
            if (!global.SutraHomeworkStore || typeof global.SutraHomeworkStore.transact !== 'function') {
                throw new Error('Canonical homework store is unavailable.');
            }
            // Locate and mutate the task inside the canonical transaction. A
            // snapshot taken before transact() can overwrite reminder, Timeline,
            // Homework, or Assistant edits that land between read and commit.
            global.SutraHomeworkStore.transact(function (draft) {
                var rows = Array.isArray(draft.tasks) ? draft.tasks : [];
                for (var i = 0; i < rows.length; i++) {
                    if (String(rows[i].id) !== String(taskId)) continue;
                    var studio = normalizeStudio(rows[i].studio) || normalizeStudio({ enabled: true });
                    mutate(studio, rows[i]);
                    studio.updatedAt = new Date().toISOString();
                    rows[i].studio = studio;
                    rows[i].updatedAt = new Date().toISOString();
                    found = true;
                    break;
                }
            }, { reason: 'assignment-studio-update' });
        } catch (error) {
            if (typeof global.SutraReportError === 'function') {
                global.SutraReportError(error, { where: 'assignment-studio.updateTaskStudio' }, 'error');
            }
            return false;
        }
        if (found) { try { global.dispatchEvent(new CustomEvent('homework:updated')); } catch (e) { /* non-critical */ } }
        return found;
    }

    // ---- Deadlines bridge: milestones become first-class deadlines -------------
    function getMilestoneDeadlines() {
        var out = [];
        var courses = {};
        readCourses().forEach(function (c) { if (c && c.id) courses[String(c.id)] = c.name || 'Class'; });
        readTasks().forEach(function (task) {
            if (!task || task.done) return;
            var studio = normalizeStudio(task.studio);
            if (!studio || !studio.enabled) return;
            studio.milestones.forEach(function (m) {
                if (m.done || !m.dueDate) return;
                var due = new Date(m.dueDate + 'T' + (m.dueTime || '23:59') + ':00');
                if (isNaN(due.getTime())) return;
                out.push({
                    id: 'milestone:' + task.id + ':' + m.id,
                    source: 'milestone',
                    sourceId: String(task.id),
                    milestoneId: m.id,
                    sourceCourseId: String(task.courseId || ''),
                    title: m.title,
                    subtitle: (task.title || 'Assignment') + (task.courseId && courses[String(task.courseId)] ? ' · ' + courses[String(task.courseId)] : ''),
                    due: due,
                    dueDate: m.dueDate,
                    dueTime: m.dueTime || '',
                    priority: 'medium',
                    status: 'open',
                    overdue: due < new Date()
                });
            });
        });
        return out;
    }

    /** Programmatic milestone add — used by the Sutra Assistant action. */
    function addMilestones(taskId, milestones) {
        var added = 0;
        var ok = updateTaskStudio(taskId, function (studio) {
            (Array.isArray(milestones) ? milestones : []).forEach(function (raw) {
                var m = normalizeMilestone(raw);
                if (m) { studio.milestones.push(m); added += 1; }
            });
        });
        return ok ? added : 0;
    }

    /**
     * Generate a structured, work-backward plan for an existing homework task and
     * write the milestones onto its Studio. Returns the plan metadata (or null).
     * options.kind overrides the inferred type; options.replace clears existing
     * generated milestones first. Used by the UI "Generate plan" button and the
     * Sutra Assistant create_assignment_plan action.
     */
    function applyPlanToTask(taskId, options) {
        options = options || {};
        var task = getTask(taskId);
        if (!task) return null;
        var existing = normalizeStudio(task.studio);
        var kind = options.kind || (existing && existing.kind) || task.type || task.title || 'generic';
        var plan = buildPlan({ kind: kind, dueDate: options.dueDate || task.dueDate, startDate: options.startDate });
        var ok = updateTaskStudio(taskId, function (studio) {
            if (options.replace) studio.milestones = [];
            plan.milestones.forEach(function (m) { studio.milestones.push(normalizeMilestone(m)); });
            studio.milestones = studio.milestones.slice(0, 60);
            if (STUDIO_KINDS.indexOf(plan.kind) !== -1) studio.kind = plan.kind;
        });
        if (!ok) return null;
        return { kind: plan.kind, count: plan.milestones.length, compressed: plan.compressed, pressure: plan.pressure };
    }

    // ---- UI ---------------------------------------------------------------------
    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var activeTaskId = null;
    // Which tab of the studio modal is showing. Survives rerender() (every
    // field edit rebuilds the body) but resets to the plan on a fresh open().
    var activeStudioTab = 'plan';

    function ensureModal() {
        var modal = document.getElementById('assignmentStudioModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'assignmentStudioModal';
        modal.className = 'sutra-academic-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="sutra-academic-card studio-card" role="dialog" aria-modal="true" aria-labelledby="assignmentStudioTitle">'
            + '<div class="sutra-academic-head">'
            + '<h3 id="assignmentStudioTitle">Assignment Studio</h3>'
            + '<button type="button" class="sutra-academic-close" data-studio-close aria-label="Close">&times;</button>'
            + '</div>'
            + '<div class="sutra-academic-body" id="assignmentStudioBody"></div>'
            + '</div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) { close(); return; }
            if (e.target.closest('[data-studio-close]')) { close(); return; }
            var tabBtn = e.target.closest('[data-studio-tab]');
            if (tabBtn) { switchStudioTab(tabBtn.getAttribute('data-studio-tab')); return; }
            var btn = e.target.closest('[data-studio-action]');
            if (btn) handleAction(btn);
        });
        modal.addEventListener('change', function (e) {
            if (e.target && e.target.dataset && e.target.dataset.studioUpload !== undefined) {
                uploadAssignmentFiles(e.target.files).catch(function (error) {
                    toast(error && error.message ? error.message : 'The attachment could not be stored.');
                });
                e.target.value = '';
                return;
            }
            var field = e.target && e.target.dataset ? e.target.dataset.studioField : '';
            if (field) handleFieldChange(e.target, field);
        });
        return modal;
    }

    function open(taskId) {
        var task = getTask(taskId);
        if (!task) {
            toast('That assignment could not be found.');
            return;
        }
        activeTaskId = String(taskId);
        activeStudioTab = 'plan';
        if (!task.studio) {
            updateTaskStudio(taskId, function () { /* initialize empty studio */ });
            task = getTask(taskId);
        }
        ensureStudioAttachmentLinks(task);
        var modal = ensureModal();
        renderBody(task);
        modal.__sutraReturnFocus = document.activeElement;
        modal.hidden = false;
        modal.classList.add('is-visible');
        syncModalManager();
    }

    function close() {
        var modal = document.getElementById('assignmentStudioModal');
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove('is-visible');
        activeTaskId = null;
        syncModalManager();
    }

    function syncModalManager() {
        if (global.SutraModalManager && typeof global.SutraModalManager.sync === 'function') {
            try { global.SutraModalManager.sync(); } catch (e) { /* non-critical */ }
        }
    }

    function toast(message) {
        if (typeof global.showToast === 'function') { global.showToast(message); return; }
        console.log('[AssignmentStudio]', message);
    }

    function courseNameFor(task) {
        if (!task.courseId) return '';
        var courses = readCourses();
        for (var i = 0; i < courses.length; i++) {
            if (String(courses[i].id) === String(task.courseId)) return courses[i].name || '';
        }
        return '';
    }

    function pagesForLinking() {
        try {
            var fa = global.flowAtelier;
            if (fa && Array.isArray(fa.pages)) {
                return fa.pages.map(function (p) {
                    return { id: String(p.id), title: String(p.title || 'Untitled note'), isCanvas: p.pageMode === 'canvas' };
                });
            }
        } catch (e) { /* non-critical */ }
        return [];
    }

    function filesForTask(task) {
        var found = [];
        try {
            if (task.courseId && global.courseHub && typeof global.courseHub.getFilesForCourse === 'function') {
                found = found.concat(global.courseHub.getFilesForCourse(task.courseId) || []);
            }
        } catch (e) { /* non-critical */ }
        try {
            if (global.SutraAttachments && typeof global.SutraAttachments.listForEntity === 'function') {
                found = found.concat(global.SutraAttachments.listForEntity('assignment', task.id) || []);
            }
        } catch (e) { /* non-critical */ }
        var seen = {};
        return found.filter(function (file) {
            var id = String(file && file.id || '');
            if (!id || seen[id]) return false;
            seen[id] = true;
            return true;
        });
    }

    function ensureStudioAttachmentLinks(task) {
        if (!task || !task.studio || !global.SutraAttachments || typeof global.SutraAttachments.link !== 'function') return;
        var studio = normalizeStudio(task.studio);
        if (!studio) return;
        studio.linkedFileIds.forEach(function (fileId) {
            try { global.SutraAttachments.link(fileId, 'assignment', task.id); } catch (e) { /* compatibility backfill is best effort */ }
        });
    }

    async function uploadAssignmentFiles(fileList) {
        if (!activeTaskId || !global.SutraAttachments || typeof global.SutraAttachments.addFiles !== 'function') {
            throw new Error('Attachment storage is unavailable.');
        }
        var files = Array.from(fileList || []);
        if (!files.length) return;
        var added = await global.SutraAttachments.addFiles(files, { entityType: 'assignment', entityId: activeTaskId, source: 'assignment_studio_upload' });
        updateTaskStudio(activeTaskId, function (studio) {
            added.forEach(function (file) {
                if (studio.linkedFileIds.indexOf(String(file.id)) === -1) studio.linkedFileIds.push(String(file.id));
            });
        });
        toast(added.length === 1 ? 'Attachment saved for this assignment.' : added.length + ' attachments saved for this assignment.');
        rerender();
    }

    function renderBody(task) {
        var body = document.getElementById('assignmentStudioBody');
        if (!body) return;
        var studio = normalizeStudio(task.studio) || normalizeStudio({});
        var progress = computeProgress(studio);
        var courseName = courseNameFor(task);
        var pages = pagesForLinking();
        var files = filesForTask(task);
        var pageById = {};
        pages.forEach(function (p) { pageById[p.id] = p; });
        var fileById = {};
        files.forEach(function (f) { fileById[String(f.id)] = f; });

        var typeOptions = function (sel) {
            return MILESTONE_TYPES.map(function (t) {
                return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
            }).join('');
        };
        var milestonesHtml = studio.milestones.map(function (m) {
            return '<div class="studio-ms-row' + (m.done ? ' is-done' : '') + '" data-milestone="' + esc(m.id) + '">'
                + '<input type="checkbox" data-studio-field="ms-done"' + (m.done ? ' checked' : '') + ' aria-label="Milestone done">'
                + '<input type="text" data-studio-field="ms-title" value="' + esc(m.title) + '" aria-label="Milestone title">'
                + '<select data-studio-field="ms-type" aria-label="Milestone type" title="Type">' + typeOptions(m.type) + '</select>'
                + '<input type="date" data-studio-field="ms-date" value="' + esc(m.dueDate) + '" aria-label="Milestone due date">'
                + '<input type="number" min="0" step="15" data-studio-field="ms-estimate" value="' + (m.estimateMinutes || '') + '" placeholder="min" aria-label="Estimated minutes" title="Estimated minutes">'
                + '<button type="button" class="studio-mini-btn" data-studio-action="schedule-milestone" data-milestone-id="' + esc(m.id) + '" title="Schedule on Timeline" aria-label="Schedule milestone">📅</button>'
                + '<button type="button" class="studio-mini-btn danger" data-studio-action="remove-milestone" data-milestone-id="' + esc(m.id) + '" aria-label="Remove milestone">&times;</button>'
                + '</div>';
        }).join('');

        var subtasksHtml = studio.subtasks.map(function (s) {
            return '<div class="studio-sub-row' + (s.done ? ' is-done' : '') + '" data-subtask="' + esc(s.id) + '">'
                + '<input type="checkbox" data-studio-field="sub-done"' + (s.done ? ' checked' : '') + ' aria-label="Subtask done">'
                + '<input type="text" data-studio-field="sub-title" value="' + esc(s.title) + '" aria-label="Subtask title">'
                + '<button type="button" class="studio-mini-btn danger" data-studio-action="remove-subtask" data-subtask-id="' + esc(s.id) + '" aria-label="Remove subtask">&times;</button>'
                + '</div>';
        }).join('');

        var rubricHtml = studio.rubric.map(function (r) {
            return '<div class="studio-rubric-row" data-rubric="' + esc(r.id) + '">'
                + '<input type="checkbox" data-studio-field="rub-met"' + (r.met ? ' checked' : '') + ' aria-label="Criterion satisfied">'
                + '<input type="text" data-studio-field="rub-criterion" value="' + esc(r.criterion) + '" aria-label="Rubric criterion">'
                + '<input type="number" min="0" data-studio-field="rub-points" value="' + (r.points || '') + '" placeholder="pts" aria-label="Points">'
                + '<button type="button" class="studio-mini-btn danger" data-studio-action="remove-rubric" data-rubric-id="' + esc(r.id) + '" aria-label="Remove criterion">&times;</button>'
                + '</div>';
        }).join('');

        var linkedNotesHtml = studio.linkedPageIds.map(function (pid) {
            var page = pageById[pid];
            return '<div class="studio-link-row" data-page-link="' + esc(pid) + '">'
                + '<span>' + (page ? (page.isCanvas ? '🗺️ ' : '📝 ') + esc(page.title) : 'Missing note (' + esc(pid) + ')') + '</span>'
                + '<span class="studio-link-actions">'
                + (page ? '<button type="button" class="studio-mini-btn" data-studio-action="open-note" data-page-id="' + esc(pid) + '">Open</button>' : '')
                + '<button type="button" class="studio-mini-btn danger" data-studio-action="unlink-note" data-page-id="' + esc(pid) + '" aria-label="Unlink note">&times;</button>'
                + '</span></div>';
        }).join('');

        var linkedFilesHtml = studio.linkedFileIds.map(function (fid) {
            var file = fileById[fid];
            return '<div class="studio-link-row" data-file-link="' + esc(fid) + '">'
                + '<span>📎 ' + (file ? esc(file.name) : 'Missing file (' + esc(fid) + ')') + '</span>'
                + '<span class="studio-link-actions">'
                + (file ? '<button type="button" class="studio-mini-btn" data-studio-action="open-file" data-file-id="' + esc(fid) + '">Open</button>' : '')
                + '<button type="button" class="studio-mini-btn danger" data-studio-action="unlink-file" data-file-id="' + esc(fid) + '" aria-label="Unlink file">&times;</button>'
                + '</span>'
                + '</div>';
        }).join('');

        var pageOptions = ['<option value="">Link a note…</option>'].concat(pages
            .filter(function (p) { return studio.linkedPageIds.indexOf(p.id) === -1; })
            .slice(0, 200)
            .map(function (p) { return '<option value="' + esc(p.id) + '">' + (p.isCanvas ? '🗺️ ' : '') + esc(p.title) + '</option>'; })).join('');

        var fileOptions = ['<option value="">Link a course file…</option>'].concat(files
            .filter(function (f) { return studio.linkedFileIds.indexOf(String(f.id)) === -1; })
            .slice(0, 200)
            .map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; })).join('');

        var revisionsHtml = studio.revisions.slice(0, 8).map(function (r) {
            return '<div class="studio-rev-row"><span class="studio-rev-date">' + esc(new Date(r.at).toLocaleDateString()) + '</span>'
                + '<span>' + esc(r.note) + '</span></div>';
        }).join('');

        body.innerHTML = ''
            + '<div class="studio-header-block">'
            + '<div class="studio-title-row"><strong class="studio-task-title">' + esc(task.title || 'Assignment') + '</strong>'
            + '<select data-studio-field="kind" aria-label="Work type">'
            + STUDIO_KINDS.map(function (k) { return '<option value="' + k + '"' + (k === studio.kind ? ' selected' : '') + '>' + k.charAt(0).toUpperCase() + k.slice(1) + '</option>'; }).join('')
            + '</select></div>'
            + '<div class="studio-meta-row">' + (courseName ? esc(courseName) + ' · ' : '') + (task.dueDate ? 'Due ' + esc(task.dueDate) + (task.dueTime ? ' ' + esc(task.dueTime) : '') : 'No due date') + '</div>'
            + '<div class="studio-progress-wrap" role="progressbar" aria-valuenow="' + progress + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress">'
            + '<div class="studio-progress-bar" style="width:' + progress + '%"></div></div>'
            + '<div class="studio-progress-meta"><span>' + progress + '% complete</span>'
            + '<label class="studio-inline-check"><input type="checkbox" data-studio-field="progress-manual"' + (studio.progressMode === 'manual' ? ' checked' : '') + '> Set manually</label>'
            + (studio.progressMode === 'manual' ? '<input type="number" min="0" max="100" data-studio-field="progress-pct" value="' + studio.progressPct + '" aria-label="Progress percent">' : '')
            + '</div></div>'

            + renderStudioTabBar(studio)

            + '<div class="studio-tab-panel" data-studio-panel="plan"' + (activeStudioTab === 'plan' ? '' : ' hidden') + '>'
            + '<section class="studio-section"><h4>Milestones</h4>'
            + (milestonesHtml || '<div class="studio-empty-line">Break this into milestones — drafts, builds, rehearsals, submissions.</div>')
            + '<div class="studio-add-row">'
            + '<input type="text" id="studioNewMilestone" placeholder="e.g. Finish first draft" aria-label="New milestone">'
            + '<input type="date" id="studioNewMilestoneDate" aria-label="New milestone date">'
            + '<button type="button" class="studio-mini-btn" data-studio-action="add-milestone">Add</button>'
            + '</div>'
            + '<div class="studio-section-actions">'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="generate-plan">' + (studio.milestones.length ? '↻ Regenerate plan' : '✨ Generate plan') + '</button>'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="schedule-remaining">Schedule remaining work</button>'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="make-focus-plan">Make focus plan</button>'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="make-review-cards">Make review cards</button>'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="ask-assistant">Ask Sutra to break this down</button>'
            + '</div>'
            + '<div class="studio-empty-line studio-plan-hint">A plan splits the work into dated milestones working back from ' + (task.dueDate ? 'your ' + esc(task.dueDate) + ' due date' : 'the due date') + ' — review and edit before scheduling.</div>'
            + '</section></div>'

            + '<div class="studio-tab-panel" data-studio-panel="checklist"' + (activeStudioTab === 'checklist' ? '' : ' hidden') + '>'
            + '<section class="studio-section"><h4>Checklist</h4>'
            + (subtasksHtml || '<div class="studio-empty-line">Small steps that don’t deserve a date.</div>')
            + '<div class="studio-add-row">'
            + '<input type="text" id="studioNewSubtask" placeholder="Add a step…" aria-label="New subtask">'
            + '<button type="button" class="studio-mini-btn" data-studio-action="add-subtask">Add</button>'
            + '</div></section></div>'

            + '<div class="studio-tab-panel" data-studio-panel="rubric"' + (activeStudioTab === 'rubric' ? '' : ' hidden') + '>'
            + '<section class="studio-section"><h4>Rubric</h4>'
            + (rubricHtml || '<div class="studio-empty-line">Copy the grading criteria here and check them off before submitting.</div>')
            + '<div class="studio-add-row">'
            + '<input type="text" id="studioNewRubric" placeholder="e.g. Thesis is clearly stated" aria-label="New rubric criterion">'
            + '<button type="button" class="studio-mini-btn" data-studio-action="add-rubric">Add</button>'
            + '</div></section></div>'

            + '<div class="studio-tab-panel" data-studio-panel="links"' + (activeStudioTab === 'links' ? '' : ' hidden') + '>'
            + '<section class="studio-section"><h4>Linked work</h4>'
            + (linkedNotesHtml || '')
            + (linkedFilesHtml || '')
            + ((!linkedNotesHtml && !linkedFilesHtml) ? '<div class="studio-empty-line">Connect notes, canvases, and course files so everything lives one click away.</div>' : '')
            + '<div class="studio-add-row">'
            + '<select data-studio-field="link-note" aria-label="Link a note">' + pageOptions + '</select>'
            + (files.length ? '<select data-studio-field="link-file" aria-label="Link a course file">' + fileOptions + '</select>' : '')
            + '<input type="file" data-studio-upload multiple accept="application/pdf,.pdf,image/png,image/jpeg" hidden>'
            + '<button type="button" class="studio-mini-btn" data-studio-action="upload-file">Attach PDF or image</button>'
            + '</div></section></div>'

            + '<div class="studio-tab-panel" data-studio-panel="effort"' + (activeStudioTab === 'effort' ? '' : ' hidden') + '>'
            + '<section class="studio-section"><h4>Effort</h4>'
            + '<div class="studio-effort-row">'
            + '<label class="studio-inline-field"><span>Estimated</span><input type="number" min="0" step="15" data-studio-field="effort-estimate" value="' + (studio.effort.estimateMinutes || '') + '" placeholder="min"></label>'
            + '<label class="studio-inline-field"><span>Logged</span><input type="number" min="0" step="15" data-studio-field="effort-logged" value="' + (studio.effort.loggedMinutes || '') + '" placeholder="min"></label>'
            + '<button type="button" class="studio-mini-btn" data-studio-action="log-25">+25 min</button>'
            + '<button type="button" class="neumo-btn studio-action-btn" data-studio-action="start-focus">Start focus session</button>'
            + '</div></section>'

            + '<section class="studio-section"><h4>Revision log</h4>'
            + (revisionsHtml || '<div class="studio-empty-line">Track drafts and review passes.</div>')
            + '<div class="studio-add-row">'
            + '<input type="text" id="studioNewRevision" placeholder="e.g. Draft 2 — tightened intro, added sources" aria-label="New revision note">'
            + '<button type="button" class="studio-mini-btn" data-studio-action="add-revision">Log</button>'
            + '</div></section></div>';
    }

    function renderStudioTabBar(studio) {
        var msDone = studio.milestones.filter(function (m) { return m.done; }).length;
        var subDone = studio.subtasks.filter(function (s) { return s.done; }).length;
        var rubMet = studio.rubric.filter(function (r) { return r.met; }).length;
        var linkCount = studio.linkedPageIds.length + studio.linkedFileIds.length;
        var tabs = [
            { id: 'plan', label: 'Plan', badge: studio.milestones.length ? (msDone + '/' + studio.milestones.length) : '' },
            { id: 'checklist', label: 'Checklist', badge: studio.subtasks.length ? (subDone + '/' + studio.subtasks.length) : '' },
            { id: 'rubric', label: 'Rubric', badge: studio.rubric.length ? (rubMet + '/' + studio.rubric.length) : '' },
            { id: 'links', label: 'Links', badge: linkCount ? String(linkCount) : '' },
            { id: 'effort', label: 'Effort & log', badge: '' }
        ];
        return '<div class="studio-tabs" role="tablist" aria-label="Assignment plan sections">'
            + tabs.map(function (t) {
                var active = t.id === activeStudioTab;
                return '<button type="button" class="studio-tab' + (active ? ' is-active' : '') + '"'
                    + ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '"'
                    + ' data-studio-tab="' + t.id + '">' + t.label
                    + (t.badge ? '<span class="studio-tab-badge">' + t.badge + '</span>' : '')
                    + '</button>';
            }).join('')
            + '</div>';
    }

    function switchStudioTab(tabId) {
        if (!tabId || tabId === activeStudioTab) return;
        activeStudioTab = tabId;
        var body = document.getElementById('assignmentStudioBody');
        if (!body) return;
        // Cheap toggle — tab switches change no data, so don't rebuild the DOM
        // (a rebuild would drop focus and reset scroll).
        body.querySelectorAll('[data-studio-tab]').forEach(function (b) {
            var active = b.getAttribute('data-studio-tab') === tabId;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        body.querySelectorAll('.studio-tab-panel').forEach(function (p) {
            p.hidden = p.getAttribute('data-studio-panel') !== tabId;
        });
    }

    function rerender() {
        if (!activeTaskId) return;
        var task = getTask(activeTaskId);
        if (task) renderBody(task);
    }

    function handleFieldChange(el, field) {
        if (!activeTaskId) return;
        var row;
        updateTaskStudio(activeTaskId, function (studio) {
            if (field === 'kind') studio.kind = el.value;
            else if (field === 'progress-manual') {
                studio.progressMode = el.checked ? 'manual' : 'auto';
                if (el.checked && !studio.progressPct) studio.progressPct = computeProgress({ ...studio, progressMode: 'auto' });
            } else if (field === 'progress-pct') studio.progressPct = Number(el.value) || 0;
            else if (field === 'effort-estimate') studio.effort.estimateMinutes = Number(el.value) || 0;
            else if (field === 'effort-logged') studio.effort.loggedMinutes = Number(el.value) || 0;
            else if (field === 'link-note' && el.value) {
                if (studio.linkedPageIds.indexOf(el.value) === -1) studio.linkedPageIds.push(el.value);
            } else if (field === 'link-file' && el.value) {
                if (studio.linkedFileIds.indexOf(el.value) === -1) studio.linkedFileIds.push(el.value);
                if (global.SutraAttachments && typeof global.SutraAttachments.link === 'function') global.SutraAttachments.link(el.value, 'assignment', activeTaskId);
            } else if (field.indexOf('ms-') === 0) {
                row = el.closest('.studio-ms-row');
                if (!row) return;
                studio.milestones.forEach(function (m) {
                    if (m.id !== row.dataset.milestone) return;
                    if (field === 'ms-done') { m.done = el.checked; m.status = el.checked ? 'done' : 'not_started'; }
                    if (field === 'ms-title') m.title = el.value;
                    if (field === 'ms-type') m.type = el.value;
                    if (field === 'ms-date') m.dueDate = el.value;
                    if (field === 'ms-estimate') m.estimateMinutes = Number(el.value) || 0;
                });
            } else if (field.indexOf('sub-') === 0) {
                row = el.closest('.studio-sub-row');
                if (!row) return;
                studio.subtasks.forEach(function (s) {
                    if (s.id !== row.dataset.subtask) return;
                    if (field === 'sub-done') s.done = el.checked;
                    if (field === 'sub-title') s.title = el.value;
                });
            } else if (field.indexOf('rub-') === 0) {
                row = el.closest('.studio-rubric-row');
                if (!row) return;
                studio.rubric.forEach(function (r) {
                    if (r.id !== row.dataset.rubric) return;
                    if (field === 'rub-met') r.met = el.checked;
                    if (field === 'rub-criterion') r.criterion = el.value;
                    if (field === 'rub-points') r.points = Number(el.value) || 0;
                });
            }
        });
        rerender();
    }

    function handleAction(btn) {
        if (!activeTaskId) return;
        var action = btn.dataset.studioAction;
        var task = getTask(activeTaskId);
        if (!task) return;

        if (action === 'add-milestone') {
            var titleEl = document.getElementById('studioNewMilestone');
            var dateEl = document.getElementById('studioNewMilestoneDate');
            var title = titleEl ? titleEl.value.trim() : '';
            if (!title) return;
            updateTaskStudio(activeTaskId, function (studio) {
                studio.milestones.push(normalizeMilestone({ title: title, dueDate: dateEl ? dateEl.value : '' }));
            });
            rerender();
        } else if (action === 'remove-milestone') {
            updateTaskStudio(activeTaskId, function (studio) {
                studio.milestones = studio.milestones.filter(function (m) { return m.id !== btn.dataset.milestoneId; });
            });
            rerender();
        } else if (action === 'schedule-milestone') {
            var milestone = null;
            (normalizeStudio(task.studio) || { milestones: [] }).milestones.forEach(function (m) {
                if (m.id === btn.dataset.milestoneId) milestone = m;
            });
            if (milestone && global.flowAtelier && typeof global.flowAtelier.scheduleGenericItemAsBlock === 'function') {
                global.flowAtelier.scheduleGenericItemAsBlock({
                    title: milestone.title + ' — ' + (task.title || 'Assignment'),
                    dueDate: milestone.dueDate || task.dueDate,
                    dueTime: milestone.dueTime || '',
                    category: 'study'
                });
            } else {
                toast('Scheduling is not available.');
            }
        } else if (action === 'generate-plan') {
            var existingStudio = normalizeStudio(task.studio);
            var hadMilestones = existingStudio && existingStudio.milestones.length > 0;
            if (hadMilestones && typeof global.confirm === 'function'
                && !global.confirm('Replace the current milestones with a freshly generated plan?')) {
                return;
            }
            var planResult = applyPlanToTask(activeTaskId, { replace: hadMilestones });
            if (planResult) {
                var msg = 'Generated a ' + planResult.count + '-step ' + planResult.kind + ' plan.';
                if (planResult.pressure) msg += ' Heads up — the deadline is close, so this is a compressed plan.';
                toast(msg);
                rerender();
            } else {
                toast('Could not generate a plan for this assignment.');
            }
        } else if (action === 'schedule-remaining') {
            scheduleRemaining(task);
        } else if (action === 'make-focus-plan') {
            makeFocusPlan(task);
        } else if (action === 'make-review-cards') {
            makeReviewCards(task);
        } else if (action === 'ask-assistant') {
            askAssistantToBreakDown(task);
        } else if (action === 'add-subtask') {
            var subEl = document.getElementById('studioNewSubtask');
            var subTitle = subEl ? subEl.value.trim() : '';
            if (!subTitle) return;
            updateTaskStudio(activeTaskId, function (studio) {
                studio.subtasks.push(normalizeSubtask({ title: subTitle }));
            });
            rerender();
        } else if (action === 'remove-subtask') {
            updateTaskStudio(activeTaskId, function (studio) {
                studio.subtasks = studio.subtasks.filter(function (s) { return s.id !== btn.dataset.subtaskId; });
            });
            rerender();
        } else if (action === 'add-rubric') {
            var rubEl = document.getElementById('studioNewRubric');
            var criterion = rubEl ? rubEl.value.trim() : '';
            if (!criterion) return;
            updateTaskStudio(activeTaskId, function (studio) {
                studio.rubric.push(normalizeRubricRow({ criterion: criterion }));
            });
            rerender();
        } else if (action === 'remove-rubric') {
            updateTaskStudio(activeTaskId, function (studio) {
                studio.rubric = studio.rubric.filter(function (r) { return r.id !== btn.dataset.rubricId; });
            });
            rerender();
        } else if (action === 'open-note') {
            if (global.flowAtelier && typeof global.flowAtelier.loadPage === 'function') {
                close();
                global.flowAtelier.setActiveView('notes');
                global.flowAtelier.loadPage(btn.dataset.pageId);
            }
        } else if (action === 'unlink-note') {
            updateTaskStudio(activeTaskId, function (studio) {
                studio.linkedPageIds = studio.linkedPageIds.filter(function (id) { return id !== btn.dataset.pageId; });
            });
            rerender();
        } else if (action === 'unlink-file') {
            if (global.SutraAttachments && typeof global.SutraAttachments.unlink === 'function') global.SutraAttachments.unlink(btn.dataset.fileId, 'assignment', activeTaskId);
            updateTaskStudio(activeTaskId, function (studio) {
                studio.linkedFileIds = studio.linkedFileIds.filter(function (id) { return id !== btn.dataset.fileId; });
            });
            rerender();
        } else if (action === 'open-file') {
            var linked = global.SutraAttachments && global.SutraAttachments.get ? global.SutraAttachments.get(btn.dataset.fileId) : null;
            if (linked && linked.kind === 'pdf' && global.SutraPdfWorkspace && global.SutraPdfWorkspace.isEnabled()) {
                var assignmentId = activeTaskId;
                close();
                global.SutraPdfWorkspace.open(linked.id, { entityType: 'assignment', entityId: assignmentId }).catch(function (error) { toast(error.message || 'The PDF could not be opened.'); });
            } else if (global.SutraAttachments && typeof global.SutraAttachments.download === 'function') global.SutraAttachments.download(btn.dataset.fileId);
        } else if (action === 'upload-file') {
            var picker = document.querySelector('#assignmentStudioBody [data-studio-upload]');
            if (picker) picker.click();
        } else if (action === 'log-25') {
            updateTaskStudio(activeTaskId, function (studio) {
                studio.effort.loggedMinutes += 25;
            });
            rerender();
        } else if (action === 'start-focus') {
            if (global.flowAtelier && typeof global.flowAtelier.startFocusSession === 'function') {
                close();
                global.flowAtelier.startFocusSession(null, { label: task.title });
            } else {
                toast('Focus sessions are not available.');
            }
        } else if (action === 'add-revision') {
            var revEl = document.getElementById('studioNewRevision');
            var note = revEl ? revEl.value.trim() : '';
            if (!note) return;
            updateTaskStudio(activeTaskId, function (studio) {
                studio.revisions.unshift({ id: uid('rev'), at: new Date().toISOString(), note: note });
            });
            rerender();
        }
    }

    /** Schedule unfinished milestones as study blocks before the deadline. */
    function scheduleRemaining(task) {
        var studio = normalizeStudio(task.studio);
        if (!studio) return;
        var pending = studio.milestones.filter(function (m) { return !m.done; });
        if (!pending.length) {
            toast('No remaining milestones to schedule.');
            return;
        }
        if (!global.flowAtelier || typeof global.flowAtelier.scheduleGenericItemAsBlock !== 'function') {
            toast('Scheduling is not available.');
            return;
        }
        var scheduled = 0;
        pending.forEach(function (m) {
            var dueDate = m.dueDate || task.dueDate;
            if (!dueDate) return;
            global.flowAtelier.scheduleGenericItemAsBlock({
                title: m.title + ' — ' + (task.title || 'Assignment'),
                dueDate: dueDate,
                dueTime: m.dueTime || '',
                category: 'study'
            });
            scheduled += 1;
        });
        toast(scheduled
            ? 'Opened scheduling for ' + scheduled + ' milestone' + (scheduled === 1 ? '' : 's') + '.'
            : 'Give milestones due dates first, then schedule them.');
    }

    /** Schedule remaining milestones as focus blocks, then start a focus session
     *  on the first pending milestone so the student can begin right away. */
    function makeFocusPlan(task) {
        var studio = normalizeStudio(task.studio);
        if (!studio) return;
        var pending = studio.milestones.filter(function (m) { return !m.done; });
        if (!pending.length) {
            toast('No remaining milestones — add or generate a plan first.');
            return;
        }
        var scheduled = 0;
        if (global.flowAtelier && typeof global.flowAtelier.scheduleGenericItemAsBlock === 'function') {
            pending.forEach(function (m) {
                var dueDate = m.dueDate || task.dueDate;
                if (!dueDate) return;
                global.flowAtelier.scheduleGenericItemAsBlock({
                    title: m.title + ' — ' + (task.title || 'Assignment'),
                    dueDate: dueDate,
                    dueTime: m.dueTime || '',
                    category: 'focus'
                });
                scheduled += 1;
            });
        }
        if (global.flowAtelier && typeof global.flowAtelier.startFocusSession === 'function') {
            close();
            global.flowAtelier.startFocusSession(null, { label: pending[0].title + ' — ' + (task.title || 'Assignment') });
            toast('Focus plan ready' + (scheduled ? ' (' + scheduled + ' block' + (scheduled === 1 ? '' : 's') + ' scheduled)' : '') + ' — session started.');
        } else {
            toast(scheduled ? 'Focus plan scheduled ' + scheduled + ' block' + (scheduled === 1 ? '' : 's') + '.' : 'Give milestones due dates first.');
        }
    }

    /** Turn this assignment (and its linked note, if any) into review cards via
     *  the deterministic Review Generator, which opens the preview/edit editor. */
    function makeReviewCards(task) {
        if (global.SutraReviewGenerator && typeof global.SutraReviewGenerator.fromHomeworkTask === 'function') {
            close();
            global.SutraReviewGenerator.fromHomeworkTask(task.id, { title: 'Review: ' + (task.title || 'Assignment') });
            return;
        }
        toast('Review generation is not available.');
    }

    function askAssistantToBreakDown(task) {
        var prompt = 'Break my assignment "' + (task.title || 'this assignment') + '"'
            + (task.dueDate ? ' (due ' + task.dueDate + ')' : '')
            + ' into 3-6 milestones with due dates spaced before the deadline, and propose them with the add_assignment_milestones action (homeworkTaskId: ' + task.id + ').';
        close();
        try {
            if (typeof global.toggleChat === 'function') {
                var panel = document.getElementById('chatbotPanel');
                if (!panel || !panel.classList.contains('open')) global.toggleChat();
            }
            var input = document.getElementById('chatInput');
            if (input) {
                input.value = prompt;
                input.focus();
                input.dispatchEvent(new Event('input', { bubbles: true }));
                toast('Prompt ready — press send to ask Sutra.');
                return;
            }
        } catch (e) { /* fall through */ }
        toast('Open Sutra Assistant and ask it to break this assignment into milestones.');
    }

    // ---- Entry points -------------------------------------------------------------
    function init() {
        // Delegated "Open Studio" triggers rendered by homework.js / Course Hub.
        document.addEventListener('click', function (e) {
            var trigger = e.target.closest('[data-studio-open]');
            if (trigger) {
                e.preventDefault();
                open(trigger.getAttribute('data-studio-open'));
            }
        });
    }

    global.SutraAssignmentStudio = {
        VERSION: 2,
        engine: Engine,
        normalizeStudio: normalizeStudio,
        computeProgress: computeProgress,
        open: open,
        close: close,
        addMilestones: addMilestones,
        generateMilestones: generateMilestones,
        scheduleMilestonesBackward: scheduleMilestonesBackward,
        buildPlan: buildPlan,
        applyPlanToTask: applyPlanToTask,
        getMilestoneDeadlines: getMilestoneDeadlines
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

}(typeof window !== 'undefined' ? window : globalThis));
