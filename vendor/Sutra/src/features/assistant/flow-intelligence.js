// Flow Intelligence — local student-intelligence layer for NoteFlow Atelier.
//
// This module is the "thinking before the model" half of Flow Assistant. It
// reads the live workspace (through the same window.flowAtelier bridge that
// flow-assistant.js uses) and computes derived signals — overloaded days,
// overdue work, due-soon items, high-risk assignments, low-confidence AP
// subjects, stale notes, unscheduled high-priority work, review debt, missing
// exam study blocks, schedule conflicts, unrealistic back-to-backs, and a
// next-best-action candidate.
//
// It also owns the Assistant Activity store (localStorage key
// sutra:activityLog:v1; the legacy NoteFlow Atelier key flow:activityLog:v1 is
// read once and migrated forward). Both keys are in ATELIER_RAW_LOCALSTORAGE_KEYS
// in app.js so the log rides along with .sutra/.atelier and JSON export/import
// automatically. It holds no secret, so exporting it is safe.
//
// The module is a side-effect-free IIFE exposing window.flowIntelligence. It
// degrades gracefully when the bridge or optional feature modules are absent.
(function () {
    'use strict';

    const VERSION = '1.0.0';
    // Canonical post-rebrand key. The pre-rebrand "Flow" key is read once and
    // migrated forward (see getActivityLog); old .atelier backups still restore it.
    const ACTIVITY_LOG_KEY = 'sutra:activityLog:v1';
    const LEGACY_ACTIVITY_LOG_KEY = 'flow:activityLog:v1';
    const ACTIVITY_LOG_LIMIT = 200;

    // --------------------------------------------------------------
    // Tiny helpers
    // --------------------------------------------------------------
    function bridge() {
        return (typeof window !== 'undefined' && window.flowAtelier) ? window.flowAtelier : null;
    }

    function getPref(path, fallback) {
        try {
            if (typeof window.getWorkspacePreference === 'function') {
                return window.getWorkspacePreference(path, fallback);
            }
        } catch (e) { /* ignore */ }
        return fallback;
    }

    function arr(value) { return Array.isArray(value) ? value : []; }

    function startOfToday() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function mkLocalDate(y, mo, d) {
        if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
        const dt = new Date(y, mo - 1, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    // Deterministic, format-aware date parser. Deliberately does NOT fall back to
    // bare `new Date(str)` for ambiguous input — `new Date('6/22')` yields the
    // YEAR 2001 in V8, silently corrupting imported assignment dates. A native
    // parse is only used when the string carries an explicit 4-digit year that
    // the parsed result agrees with, so a year can never be invented.
    function parseDateOnly(value) {
        if (!value) return null;
        try {
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
            const s = String(value).trim();
            if (!s) return null;
            const now = new Date();
            let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // ISO (date prefix)
            if (m) return mkLocalDate(+m[1], +m[2], +m[3]);
            m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/); // M/D or M/D/Y
            if (m) {
                let yy = m[3] ? Number(m[3]) : now.getFullYear();
                if (yy < 100) yy += 2000;
                return mkLocalDate(yy, +m[1], +m[2]);
            }
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            m = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
            if (m) {                                                     // Month name D[, YYYY]
                const mi = months.indexOf(m[1].slice(0, 3));
                const yy = m[3] ? Number(m[3]) : now.getFullYear();
                return mkLocalDate(yy, mi + 1, +m[2]);
            }
            if (/\btoday\b/i.test(s)) return mkLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
            if (/\btomorrow\b/i.test(s)) { const t = new Date(now); t.setDate(t.getDate() + 1); return mkLocalDate(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
            const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const wm = s.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
            if (wm) {
                const target = weekdays.indexOf(wm[1]);
                const delta = ((target - now.getDay() + 7) % 7) || 7;
                const t = new Date(now); t.setDate(t.getDate() + delta);
                return mkLocalDate(t.getFullYear(), t.getMonth() + 1, t.getDate());
            }
            // Year-guarded native fallback (never invents a year for bare M/D).
            const ym = s.match(/\b(\d{4})\b/);
            if (ym) {
                const d2 = new Date(s);
                if (!Number.isNaN(d2.getTime()) && String(d2.getFullYear()) === ym[1]) {
                    return mkLocalDate(d2.getFullYear(), d2.getMonth() + 1, d2.getDate());
                }
            }
            return null;
        } catch (e) { return null; }
    }

    function toISODate(value) {
        const d = value instanceof Date ? value : parseDateOnly(value);
        if (!d || Number.isNaN(d.getTime())) return '';
        const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        return tzAdjusted.toISOString().slice(0, 10);
    }

    function daysBetween(from, to) {
        if (!from || !to) return null;
        return Math.round((to.getTime() - from.getTime()) / 86400000);
    }

    function minutesFromTime(value) {
        const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    }

    function truncate(str, max) {
        const s = String(str == null ? '' : str);
        if (s.length <= max) return s;
        return s.slice(0, max - 1).trimEnd() + '…';
    }

    function normalizeForMatch(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // Cheap token-overlap similarity (0..1) — good enough for dedupe.
    function titleSimilarity(a, b) {
        const ta = normalizeForMatch(a).split(' ').filter(Boolean);
        const tb = normalizeForMatch(b).split(' ').filter(Boolean);
        if (!ta.length || !tb.length) return 0;
        const setB = new Set(tb);
        let hits = 0;
        ta.forEach(t => { if (setB.has(t)) hits += 1; });
        return hits / Math.max(ta.length, tb.length);
    }

    // --------------------------------------------------------------
    // Data access (live workspace, read-only)
    // --------------------------------------------------------------
    function liveTasks() {
        const b = bridge();
        // Homework MIRROR tasks (synced copies of hwTasks:v2 rows) are excluded —
        // liveHomework() already counts the authoritative row, and counting both
        // double-reports the same assignment in overdue/due-soon/load signals.
        return arr(b ? b.tasks : (typeof window !== 'undefined' ? window.tasks : []))
            .filter(t => t && t.origin !== 'homework' && !t.homeworkSourceId);
    }
    function liveTimeBlocks() {
        const b = bridge();
        return arr(b ? b.timeBlocks : (typeof window !== 'undefined' ? window.timeBlocks : []));
    }
    function livePages() {
        const b = bridge();
        return arr(b ? b.pages : (typeof window !== 'undefined' ? window.pages : []));
    }
    function liveApStudy() {
        const b = bridge();
        const aps = b ? b.apStudyWorkspace : (typeof window !== 'undefined' ? window.apStudyWorkspace : null);
        return aps && typeof aps === 'object' ? aps : null;
    }
    function liveHomework() {
        try {
            const homework = window.SutraHomeworkStore && window.SutraHomeworkStore.getSnapshot
                ? window.SutraHomeworkStore.getSnapshot()
                : { courses: [], tasks: [] };
            const tasks = homework.tasks;
            const courses = homework.courses;
            const courseName = (id) => {
                const c = arr(courses).find(c => String(c.id) === String(id));
                return c ? c.name : '';
            };
            return arr(tasks).map(t => ({
                id: t.id,
                title: t.title || t.text || 'Assignment',
                course: courseName(t.courseId),
                courseId: t.courseId || '',
                dueDate: t.dueDate || '',
                priority: t.priority || '',
                difficulty: t.difficulty || '',
                done: !!t.done,
                raw: t
            }));
        } catch (e) { return []; }
    }

    function reviewStats() {
        try {
            if (typeof window.getReviewTodayStats === 'function') return window.getReviewTodayStats();
        } catch (e) { /* ignore */ }
        return null;
    }

    function collectDeadlines() {
        try {
            const b = bridge();
            if (b && typeof b.collectWorkspaceDeadlines === 'function') return arr(b.collectWorkspaceDeadlines());
            if (typeof window.collectWorkspaceDeadlines === 'function') return arr(window.collectWorkspaceDeadlines());
        } catch (e) { /* ignore */ }
        return [];
    }

    // --------------------------------------------------------------
    // Schedule helpers
    // --------------------------------------------------------------
    // Per-synchronous-frame schedule index. `isItemScheduled` used to run a
    // fuzzy titleSimilarity() over every timeline block for every task/homework
    // item — an O(items × blocks) scan that re-normalized every block name on
    // each comparison (~2M regex passes on a heavy workspace, ~13s per Today /
    // Timeline render because refresh() derives context several times). Building
    // the linked-id set and pre-normalizing block-name token sets ONCE per frame
    // makes each lookup an O(1) id check plus a cheap token-overlap pass with no
    // repeated normalization. Matching semantics are unchanged (same id fields,
    // same 0.6 overlap threshold). The cache clears on the next microtask so any
    // later data change recomputes from scratch.
    let __scheduleIndex = null;
    function getScheduleIndex() {
        if (__scheduleIndex) return __scheduleIndex;
        const blocks = liveTimeBlocks();
        const linkedIds = new Set();
        const named = [];
        blocks.forEach(b => {
            if (!b) return;
            [b.linkedTaskId, b.linkedHomeworkId, b.sourceId, b.taskId].forEach(v => {
                if (v != null && String(v).trim()) linkedIds.add(String(v));
            });
            if (b.name) {
                const toks = normalizeForMatch(b.name).split(' ').filter(Boolean);
                if (toks.length) named.push({ set: new Set(toks), len: toks.length });
            }
        });
        __scheduleIndex = { count: blocks.length, linkedIds, named };
        const clear = () => { __scheduleIndex = null; };
        if (typeof queueMicrotask === 'function') queueMicrotask(clear);
        else Promise.resolve().then(clear);
        return __scheduleIndex;
    }

    // Does any timeline block reference this object (by linked id, source id,
    // or fuzzy title match)? Used to detect "unscheduled" work.
    function isItemScheduled(item) {
        const idx = getScheduleIndex();
        if (!idx.count) return false;
        const id = item && item.id;
        if (id != null && String(id).trim() && idx.linkedIds.has(String(id))) return true;
        const title = item && item.title;
        if (!title) return false;
        const ta = normalizeForMatch(title).split(' ').filter(Boolean);
        if (!ta.length) return false;
        const named = idx.named;
        for (let i = 0; i < named.length; i += 1) {
            const nb = named[i];
            let hits = 0;
            for (let j = 0; j < ta.length; j += 1) if (nb.set.has(ta[j])) hits += 1;
            if (hits / Math.max(ta.length, nb.len) >= 0.6) return true;
        }
        return false;
    }

    function detectConflicts() {
        const blocks = liveTimeBlocks().filter(b => b && b.date && b.start && b.end);
        const byDate = {};
        blocks.forEach(b => {
            (byDate[b.date] = byDate[b.date] || []).push(b);
        });
        const conflicts = [];
        const backToBacks = [];
        Object.keys(byDate).forEach(date => {
            const day = byDate[date]
                .map(b => ({ b, s: minutesFromTime(b.start), e: minutesFromTime(b.end) }))
                .filter(x => x.s != null && x.e != null && x.e > x.s)
                .sort((a, b) => a.s - b.s);
            for (let i = 1; i < day.length; i += 1) {
                const prev = day[i - 1];
                const cur = day[i];
                if (cur.s < prev.e) {
                    conflicts.push({ date, a: truncate(prev.b.name, 50), b: truncate(cur.b.name, 50) });
                } else if (cur.s - prev.e === 0 && (prev.e - prev.s) >= 90 && (cur.e - cur.s) >= 90) {
                    backToBacks.push({ date, a: truncate(prev.b.name, 50), b: truncate(cur.b.name, 50) });
                }
            }
        });
        return { conflicts, backToBacks };
    }

    // Count "load" (due items + scheduled blocks) per day for the next N days.
    function computeDailyLoad(daysAhead) {
        const today = startOfToday();
        const map = {};
        const ensure = (key) => (map[key] = map[key] || { date: key, due: 0, blocks: 0, blockMinutes: 0 });
        const within = (d) => {
            if (!d) return false;
            const diff = daysBetween(today, d);
            return diff != null && diff >= 0 && diff <= daysAhead;
        };
        liveTasks().forEach(t => {
            if (!t || t.completed) return;
            const d = parseDateOnly(t.dueDate);
            if (within(d)) ensure(toISODate(d)).due += 1;
        });
        liveHomework().forEach(h => {
            if (h.done) return;
            const d = parseDateOnly(h.dueDate);
            if (within(d)) ensure(toISODate(d)).due += 1;
        });
        liveTimeBlocks().forEach(b => {
            if (!b || !b.date) return;
            const d = parseDateOnly(b.date);
            if (within(d)) {
                const slot = ensure(b.date);
                slot.blocks += 1;
                const s = minutesFromTime(b.start);
                const e = minutesFromTime(b.end);
                if (s != null && e != null && e > s) slot.blockMinutes += (e - s);
            }
        });
        return map;
    }

    // --------------------------------------------------------------
    // Derived student-intelligence context
    // --------------------------------------------------------------
    // A single Assistant refresh() derives context several times (quick actions,
    // context chip, header subtitle, empty state, view-flow rows). Each
    // derivation scans every task, homework row, timeline block and page. Cache
    // the no-options result for the current synchronous frame and clear it on the
    // next microtask so later data changes recompute. Callers never mutate the
    // returned object in place, so the shared reference is safe.
    let __studentContextCache = null;
    function deriveStudentContext(options) {
        const hasOptions = options && Object.keys(options).length > 0;
        if (!hasOptions && __studentContextCache) return __studentContextCache;
        const result = computeStudentContext(options);
        if (!hasOptions) {
            __studentContextCache = result;
            const clear = () => { __studentContextCache = null; };
            if (typeof queueMicrotask === 'function') queueMicrotask(clear);
            else Promise.resolve().then(clear);
        }
        return result;
    }

    function computeStudentContext(options) {
        const opts = options || {};
        const today = startOfToday();
        const todayKey = toISODate(today);
        const soonHorizon = 3; // days
        const tasks = liveTasks();
        const homework = liveHomework();
        const apStudy = liveApStudy();
        const pages = livePages();

        const out = {
            schema: 'flow-intel/1',
            now: new Date().toISOString(),
            today: todayKey
        };

        // Overdue + due-soon (tasks + homework unified).
        const overdue = [];
        const dueSoon = [];
        const unscheduledHighPriority = [];
        const highRisk = [];

        const consider = (kind, id, title, dueDate, priority, difficulty, extra) => {
            const d = parseDateOnly(dueDate);
            const diff = d ? daysBetween(today, d) : null;
            const item = { kind, id, title: truncate(title, 90), dueDate: toISODate(d), priority: priority || '', difficulty: difficulty || '', daysUntil: diff };
            if (diff != null && diff < 0) overdue.push(item);
            else if (diff != null && diff <= soonHorizon) dueSoon.push(item);

            const hp = String(priority || '').toLowerCase() === 'high';
            const hard = String(difficulty || '').toLowerCase() === 'hard';
            const scheduled = extra && extra.scheduled != null ? extra.scheduled : isItemScheduled({ id, title });
            if (hp && !scheduled && diff != null && diff >= 0 && diff <= 7) {
                unscheduledHighPriority.push(item);
            }
            // Risk score: closeness to due + difficulty + priority − scheduled.
            let risk = 0;
            if (diff != null) {
                if (diff < 0) risk += 3;
                else if (diff <= 1) risk += 3;
                else if (diff <= 3) risk += 2;
                else if (diff <= 7) risk += 1;
            }
            if (hard) risk += 2;
            if (hp) risk += 1;
            if (!scheduled) risk += 1;
            if (risk >= 4 && (diff == null || diff <= 7)) {
                highRisk.push(Object.assign({ risk }, item, { scheduled }));
            }
        };

        tasks.forEach(t => {
            if (!t || t.completed) return;
            consider('task', t.id, t.title, t.dueDate, t.priority, t.difficulty, {});
        });
        homework.forEach(h => {
            if (h.done) return;
            consider('homework', h.id, h.title, h.dueDate, h.priority, h.difficulty, {});
        });

        overdue.sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0));
        dueSoon.sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0));
        highRisk.sort((a, b) => b.risk - a.risk);

        out.overdue = overdue.slice(0, 15);
        out.overdueCount = overdue.length;
        out.dueSoon = dueSoon.slice(0, 15);
        out.dueSoonCount = dueSoon.length;
        out.unscheduledHighPriority = unscheduledHighPriority.slice(0, 10);
        out.highRiskAssignments = highRisk.slice(0, 8);

        // Overloaded days (next 7).
        const load = computeDailyLoad(7);
        const overloadThreshold = Number(getPref('studentPreferences.overloadThreshold', 5)) || 5;
        out.overloadedDays = Object.values(load)
            .filter(d => (d.due + d.blocks) >= overloadThreshold || d.blockMinutes >= 360)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(d => ({ date: d.date, dueItems: d.due, blocks: d.blocks, scheduledHours: Math.round(d.blockMinutes / 6) / 10 }));

        // Low-confidence AP subjects with an exam in the next 30 days.
        if (apStudy && Array.isArray(apStudy.subjects)) {
            out.lowConfidenceApSubjects = apStudy.subjects
                .map(s => {
                    const d = parseDateOnly(s.examDate);
                    const diff = d ? daysBetween(today, d) : null;
                    const conf = Number(s.confidenceLevel != null ? s.confidenceLevel : s.confidence);
                    return { name: s.name || '', examDate: toISODate(d), daysUntilExam: diff, confidence: Number.isFinite(conf) ? conf : null, id: s.id };
                })
                .filter(s => s.confidence != null && s.confidence <= 2 && s.daysUntilExam != null && s.daysUntilExam >= 0 && s.daysUntilExam <= 30)
                .sort((a, b) => (a.daysUntilExam || 0) - (b.daysUntilExam || 0));
            // Exams with no study block in the run-up.
            out.missingExamBlocks = apStudy.subjects
                .map(s => {
                    const d = parseDateOnly(s.examDate);
                    const diff = d ? daysBetween(today, d) : null;
                    return { name: s.name || '', examDate: toISODate(d), daysUntilExam: diff, id: s.id };
                })
                .filter(s => s.daysUntilExam != null && s.daysUntilExam >= 0 && s.daysUntilExam <= 21)
                .filter(s => !isItemScheduled({ title: s.name }))
                .sort((a, b) => (a.daysUntilExam || 0) - (b.daysUntilExam || 0));
        } else {
            out.lowConfidenceApSubjects = [];
            out.missingExamBlocks = [];
        }

        // Stale notes: pages linked to a class or with a deadline, untouched 14+ days.
        out.staleNotes = pages
            .filter(p => p && !p.isLocked && (p.classLinkId || p.dueDate || p.examDate))
            .map(p => {
                const updated = parseDateOnly(p.updatedAt) || parseDateOnly(p.createdAt);
                const age = updated ? daysBetween(updated, today) : null;
                return { id: p.id, title: truncate(p.title || 'Untitled', 70), ageDays: age };
            })
            .filter(p => p.ageDays != null && p.ageDays >= 14)
            .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))
            .slice(0, 8);

        // Review debt.
        const rev = reviewStats();
        if (rev) {
            out.reviewDebt = {
                due: rev.due || 0,
                overdue: rev.overdue || 0,
                reviewedThisWeek: rev.reviewedThisWeek || 0,
                decks: rev.decks || rev.totalDecks || 0
            };
        }

        // Schedule conflicts + unrealistic back-to-backs.
        const sched = detectConflicts();
        out.conflictingBlocks = sched.conflicts.slice(0, 8);
        out.unrealisticBackToBacks = sched.backToBacks.slice(0, 8);

        // Real school schedule (rotation day, classes, study windows) — a local
        // signal from the School Schedule module so plans respect class time.
        try {
            if (window.SutraSchoolSchedule && typeof window.SutraSchoolSchedule.resolveDayInfo === 'function') {
                const dayInfo = window.SutraSchoolSchedule.resolveDayInfo(todayKey);
                if (dayInfo && dayInfo.enabled) {
                    out.schoolDay = {
                        isSchoolDay: !!dayInfo.isSchoolDay,
                        dayLabel: dayInfo.dayLabel || '',
                        scheduleName: dayInfo.scheduleName || '',
                        periodCount: Array.isArray(dayInfo.periods) ? dayInfo.periods.length : 0,
                        classes: (dayInfo.periods || []).map(p => ({
                            label: p.label, start: p.start, end: p.end, courseName: p.courseName || ''
                        })).slice(0, 12),
                        studyWindows: (window.SutraSchoolSchedule.getStudyWindowsForDate(todayKey) || []).slice(0, 6)
                    };
                }
            }
        } catch (e) { /* non-critical */ }

        // Next-best-action candidate.
        out.nextBestAction = pickNextBestAction({ overdue, dueSoon, unscheduledHighPriority, highRisk, reviewDebt: out.reviewDebt });

        // Compact human summary the model can read at a glance.
        out.summary = buildSummaryLine(out);
        return out;
    }

    function pickNextBestAction(signals) {
        if (signals.overdue && signals.overdue.length) {
            const o = signals.overdue[0];
            return { reason: 'overdue', label: `Tackle overdue: ${o.title}`, ref: { kind: o.kind, id: o.id } };
        }
        if (signals.highRisk && signals.highRisk.length) {
            const h = signals.highRisk[0];
            return { reason: 'high_risk', label: `Schedule time for: ${h.title}`, ref: { kind: h.kind, id: h.id } };
        }
        if (signals.unscheduledHighPriority && signals.unscheduledHighPriority.length) {
            const u = signals.unscheduledHighPriority[0];
            return { reason: 'unscheduled_priority', label: `Block time for: ${u.title}`, ref: { kind: u.kind, id: u.id } };
        }
        if (signals.reviewDebt && (signals.reviewDebt.overdue || signals.reviewDebt.due >= 20)) {
            return { reason: 'review_debt', label: `Clear ${signals.reviewDebt.due} review cards due today`, ref: { kind: 'review' } };
        }
        if (signals.dueSoon && signals.dueSoon.length) {
            const d = signals.dueSoon[0];
            return { reason: 'due_soon', label: `Start soon: ${d.title}`, ref: { kind: d.kind, id: d.id } };
        }
        return null;
    }

    function buildSummaryLine(ctx) {
        const parts = [];
        if (ctx.overdueCount) parts.push(`${ctx.overdueCount} overdue`);
        if (ctx.dueSoonCount) parts.push(`${ctx.dueSoonCount} due soon`);
        if (ctx.overloadedDays && ctx.overloadedDays.length) parts.push(`${ctx.overloadedDays.length} overloaded day(s)`);
        if (ctx.highRiskAssignments && ctx.highRiskAssignments.length) parts.push(`${ctx.highRiskAssignments.length} high-risk item(s)`);
        if (ctx.reviewDebt && ctx.reviewDebt.due) parts.push(`${ctx.reviewDebt.due} review due`);
        if (ctx.lowConfidenceApSubjects && ctx.lowConfidenceApSubjects.length) parts.push(`${ctx.lowConfidenceApSubjects.length} shaky AP subject(s)`);
        return parts.length ? `Risk snapshot: ${parts.join(', ')}.` : 'No urgent risks detected.';
    }

    // --------------------------------------------------------------
    // Activity log + undo records
    // --------------------------------------------------------------
    function getActivityLog() {
        try {
            let raw = localStorage.getItem(ACTIVITY_LOG_KEY);
            if (raw === null || raw === undefined) {
                // One-time migration from the pre-rebrand Flow activity key.
                const legacy = localStorage.getItem(LEGACY_ACTIVITY_LOG_KEY);
                if (legacy !== null && legacy !== undefined) {
                    if (window.SutraSafeStorage && typeof window.SutraSafeStorage.set === 'function') {
                        window.SutraSafeStorage.set(ACTIVITY_LOG_KEY, legacy, { importance: 'important', label: 'Assistant Activity' });
                    }
                    raw = legacy;
                }
            }
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    }
    function writeActivityLog(list) {
        const trimmed = arr(list).slice(0, ACTIVITY_LOG_LIMIT);
        if (window.SutraSafeStorage && typeof window.SutraSafeStorage.set === 'function') {
            window.SutraSafeStorage.set(ACTIVITY_LOG_KEY, trimmed, { importance: 'important', label: 'Assistant Activity' });
            return;
        }
        if (typeof window.SutraReportError === 'function') {
            window.SutraReportError(new Error('SutraSafeStorage is unavailable.'), { where: 'flow-intelligence.writeActivityLog' }, 'error');
        }
    }
    // record: { actionType, summary, userPrompt, provider, model, confidence,
    //   createdObjectIds:[{kind,id}], beforeSnapshot, reversible, status, batchId }
    function redactActivityText(value) {
        if (typeof value !== 'string' || !value) return value;
        // Privacy boundaries fail CLOSED (audit remediation): if the safety
        // module is unavailable or throws, the free-text field is scrubbed
        // from the persisted record instead of being written unredacted. The
        // record itself survives so the action history stays intact.
        try {
            if (window.SutraAssistantSafety && typeof window.SutraAssistantSafety.redactText === 'function') {
                return window.SutraAssistantSafety.redactText(value);
            }
        } catch (e) { /* fall through to fail-closed placeholder */ }
        return '[redacted: safety module unavailable]';
    }
    function logActivity(record) {
        const list = getActivityLog();
        const entry = Object.assign({
            id: `flowact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            status: 'applied',
            reversible: true,
            createdObjectIds: []
        }, record || {});
        // The activity log persists to sutra:activityLog:v1 and rides along in
        // every export/import. A generic action prompt (unlike memory writes) is
        // not sensitivity-screened upstream, so scrub credential-shaped strings
        // from the free-text fields before they touch disk.
        if (typeof entry.userPrompt === 'string') entry.userPrompt = redactActivityText(entry.userPrompt);
        if (typeof entry.summary === 'string') entry.summary = redactActivityText(entry.summary);
        list.unshift(entry);
        writeActivityLog(list);
        return entry;
    }
    function updateActivityRecord(id, patch) {
        const list = getActivityLog();
        const idx = list.findIndex(r => r && r.id === id);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch || {});
        writeActivityLog(list);
        return list[idx];
    }
    function getActivityRecord(id) {
        return getActivityLog().find(r => r && r.id === id) || null;
    }
    function clearActivityLog() { writeActivityLog([]); }

    // --------------------------------------------------------------
    // Assignment import: normalization + dedupe
    // --------------------------------------------------------------
    const ASSIGNMENT_TYPES = ['homework', 'reading', 'project', 'essay', 'lab', 'quiz', 'test', 'exam', 'presentation', 'other'];

    function normalizeImportedAssignment(raw, index) {
        const r = raw || {};
        const pick = (...keys) => {
            for (const k of keys) {
                const v = r[k];
                if (typeof v === 'string' && v.trim()) return v.trim();
                if (typeof v === 'number') return String(v);
            }
            return '';
        };
        const title = pick('title', 'name', 'assignment', 'task', 'summary');
        const course = pick('course', 'class', 'className', 'subject', 'courseName');
        let dueDate = pick('dueDate', 'due', 'date', 'deadline');
        const isoDate = toISODate(dueDate);
        const dueTime = pick('dueTime', 'time');
        let type = pick('type', 'category').toLowerCase();
        if (!ASSIGNMENT_TYPES.includes(type)) type = guessType(title, type);
        const priority = normalizeChoice(pick('priority').toLowerCase(), ['low', 'medium', 'high'], '');
        const difficulty = normalizeChoice(pick('difficulty').toLowerCase(), ['easy', 'medium', 'hard'], '');
        const sourceText = pick('sourceText', 'source', 'original', 'line');
        let confidence = Number(r.confidence);
        if (!Number.isFinite(confidence)) confidence = title && isoDate ? 0.8 : (title ? 0.5 : 0.2);
        const ambiguity = [];
        if (!isoDate && dueDate) ambiguity.push('unparsed-date');
        if (!isoDate && !dueDate) ambiguity.push('no-date');
        if (!course) ambiguity.push('no-course');
        if (!title) ambiguity.push('no-title');

        return {
            rowId: `imp_${Date.now().toString(36)}_${index}`,
            title,
            course,
            dueDate: isoDate,
            dueDateRaw: dueDate,
            dueTime: /^\d{1,2}:\d{2}$/.test(dueTime) ? dueTime : '',
            type,
            priority,
            difficulty,
            sourceText: truncate(sourceText, 240),
            confidence: Math.round(confidence * 100) / 100,
            ambiguity,
            suggestedDestinations: suggestDestinations(type),
            destinations: suggestDestinations(type),
            duplicate: detectDuplicate({ title, course, dueDate: isoDate })
        };
    }

    function normalizeChoice(value, allowed, fallback) {
        return allowed.includes(value) ? value : fallback;
    }

    function guessType(title, fallback) {
        const t = normalizeForMatch(title);
        if (/\bessay|paper|write up|writeup\b/.test(t)) return 'essay';
        if (/\bread|chapter|pages?\b/.test(t)) return 'reading';
        if (/\bquiz\b/.test(t)) return 'quiz';
        if (/\btest|exam|midterm|final\b/.test(t)) return 'test';
        if (/\blab\b/.test(t)) return 'lab';
        if (/\bproject\b/.test(t)) return 'project';
        if (/\bpresent|slides|deck\b/.test(t)) return 'presentation';
        return ASSIGNMENT_TYPES.includes(fallback) ? fallback : 'homework';
    }

    function suggestDestinations(type) {
        switch (type) {
            case 'test':
            case 'exam':
            case 'quiz':
                return ['homework', 'timeline', 'review'];
            case 'essay':
            case 'project':
            case 'presentation':
                return ['homework', 'tasks', 'timeline', 'notes'];
            case 'reading':
                return ['homework', 'tasks'];
            default:
                return ['homework', 'tasks'];
        }
    }

    // Fuzzy duplicate detection against existing homework / tasks / timeline.
    function detectDuplicate(candidate) {
        const title = candidate.title;
        if (!title) return null;
        const sameWindow = (a, b) => {
            if (!a || !b) return true; // if either lacks a date, don't disqualify
            const da = parseDateOnly(a), db = parseDateOnly(b);
            if (!da || !db) return true;
            const diff = Math.abs(daysBetween(da, db) || 0);
            return diff <= 1;
        };
        const matches = [];
        liveHomework().forEach(h => {
            if (h.done) return;
            if (titleSimilarity(title, h.title) >= 0.7 && sameWindow(candidate.dueDate, h.dueDate)) {
                matches.push({ kind: 'homework', id: h.id, title: h.title });
            }
        });
        liveTasks().forEach(t => {
            if (!t || t.completed) return;
            if (titleSimilarity(title, t.title) >= 0.7 && sameWindow(candidate.dueDate, t.dueDate)) {
                matches.push({ kind: 'task', id: t.id, title: t.title });
            }
        });
        liveTimeBlocks().forEach(b => {
            if (!b || !b.name) return;
            if (titleSimilarity(title, b.name) >= 0.75 && sameWindow(candidate.dueDate, b.date)) {
                matches.push({ kind: 'timeline', id: b.id, title: b.name });
            }
        });
        return matches.length ? matches[0] : null;
    }

    function normalizeImportBatch(rawList) {
        return arr(rawList).map((raw, i) => normalizeImportedAssignment(raw, i));
    }

    // --------------------------------------------------------------
    // Multi-format text → raw import rows (deterministic, no AI).
    // Handles: markdown/pipe tables, CSV/TSV with a header, dash/pipe/tab
    // per-line rows, and syllabus-style paragraphs. The returned rows are
    // raw field bags; run them through normalizeImportBatch() to get
    // confidence, ambiguity flags, suggested destinations, and dedup.
    // --------------------------------------------------------------
    const HEADER_FIELD_PATTERNS = [
        ['title', /^(title|assignment|task|name|work|description|item|topic)$/],
        ['course', /^(course|class|subject|period|section)$/],
        ['dueTime', /^(time|due ?time|at)$/],
        ['dueDate', /^(due|due ?date|date|deadline|due on|when)$/],
        ['type', /^(type|category|kind)$/],
        ['priority', /^(priority|urgency)$/],
        ['difficulty', /^(difficulty|effort|level)$/]
    ];

    const WEEKDAY_DATE_RE = /^(due\s+|by\s+|on\s+)?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)\b\.?(\s+\d{1,2}(:\d{2})?\s*(?:am|pm)?)?$/i;
    function looksLikeDate(tok) {
        const s = String(tok || '');
        if (/\d{4}-\d{1,2}-\d{1,2}/.test(s)) return true;
        if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(s)) return true;
        if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i.test(s)) return true;
        // Weekday / relative words only count when they DOMINATE a short token, so
        // a real title like "The Wednesday Wars essay" or "Sunny day poem" — which
        // merely contains weekday letters — is never mistaken for a date.
        return s.trim().length <= 20 && WEEKDAY_DATE_RE.test(s.trim());
    }
    function looksLikeTime(tok) {
        return /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(tok) || /\b\d{1,2}\s*(am|pm)\b/i.test(tok);
    }
    function isTableSeparator(line) {
        return /^[\s|:\-–—]+$/.test(line) && /[-–—]/.test(line);
    }
    function splitDelim(line, delim) {
        let parts;
        if (delim === '|') {
            parts = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
        } else if (delim === '\t') {
            parts = line.split('\t');
        } else if (delim === ',') {
            // tolerate simple double-quoted cells with embedded commas
            parts = []; let cur = ''; let q = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { q = !q; continue; }
                if (ch === ',' && !q) { parts.push(cur); cur = ''; continue; }
                cur += ch;
            }
            parts.push(cur);
        } else {
            parts = line.split(delim);
        }
        return parts.map(p => p.trim());
    }
    function mapHeader(cells) {
        const map = {};
        cells.forEach((cell, idx) => {
            const norm = String(cell || '').toLowerCase().trim();
            for (const [field, re] of HEADER_FIELD_PATTERNS) {
                if (map[field] === undefined && re.test(norm)) { map[field] = idx; break; }
            }
        });
        return map;
    }
    function rowFromCells(cells, map, sourceLine) {
        const at = (f) => (map[f] !== undefined ? (cells[map[f]] || '').trim() : '');
        return {
            title: at('title'), course: at('course'),
            dueDate: at('dueDate'), dueTime: at('dueTime'),
            type: at('type').toLowerCase(), priority: at('priority').toLowerCase(),
            difficulty: at('difficulty').toLowerCase(),
            sourceText: sourceLine
        };
    }
    // Positional fallback when a line has delimiters but no header: pull out a
    // date and a time token, then the first remaining cell is the title and the
    // next (if any) is the course.
    function rowFromPositional(cells, sourceLine) {
        const remaining = [];
        let dueDate = '', dueTime = '';
        const timeRe = /\b\d{1,2}:\d{2}\s*(am|pm)?\b|\b\d{1,2}\s*(am|pm)\b/i;
        cells.forEach(c => {
            if (!dueDate && looksLikeDate(c)) {
                const tm = c.match(timeRe);
                if (tm) { if (!dueTime) dueTime = tm[0].trim(); dueDate = c.replace(timeRe, '').trim(); }
                else { dueDate = c; }
                return;
            }
            if (!dueTime && looksLikeTime(c)) { dueTime = c; return; }
            // A second date-like token is NOT the course — drop it rather than
            // filing "6/22" as the class name.
            if (dueDate && looksLikeDate(c)) return;
            if (c) remaining.push(c);
        });
        return {
            title: remaining[0] || '', course: remaining[1] || '',
            dueDate: dueDate, dueTime: dueTime, sourceText: sourceLine
        };
    }
    // Syllabus paragraph: split a free sentence on the first date phrase; text
    // before becomes the title, the date phrase is the due date.
    function rowFromSyllabusLine(line) {
        const dateRe = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)\b/i;
        const m = line.match(dateRe);
        if (!m) return null;
        let title = line.slice(0, m.index).replace(/[\s,:;\-–—(]*(due|deadline|on|by)?[\s,:;\-–—(]*$/i, '').trim();
        if (!title) title = line.replace(dateRe, '').replace(/\b(due|deadline|on|by)\b/ig, '').trim();
        return { title: title, course: '', dueDate: m[0], dueTime: (line.match(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i) || [''])[0], sourceText: line };
    }

    function parseAssignmentText(text) {
        const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
        if (!lines.length) return [];
        const rows = [];

        // 1) Pipe / markdown table — two or more lines containing '|'.
        const pipeLines = lines.filter(l => l.includes('|'));
        if (pipeLines.length >= 2) {
            const dataLines = pipeLines.filter(l => !isTableSeparator(l));
            const headerMap = mapHeader(splitDelim(dataLines[0], '|'));
            // First row is a header when it names at least two known columns; this
            // keeps the header (e.g. "Course | Due") out of the imported rows even
            // when no title column is present.
            const hasHeader = Object.keys(headerMap).length >= 2;
            dataLines.forEach((l, idx) => {
                if (hasHeader && idx === 0) return;
                const cells = splitDelim(l, '|');
                rows.push(hasHeader ? rowFromCells(cells, headerMap, l) : rowFromPositional(cells, l));
            });
            return rows.filter(r => r.title);
        }

        // 2) CSV / TSV with a recognizable header on the first line.
        const firstLine = lines[0].toLowerCase();
        const looksHeader = /(title|assignment|task)\b/.test(firstLine) && /(due|date|deadline|course|class)\b/.test(firstLine);
        const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : '');
        if (looksHeader && delim) {
            const headerMap = mapHeader(splitDelim(lines[0], delim));
            if (Object.keys(headerMap).length >= 2) {
                for (let i = 1; i < lines.length; i++) {
                    rows.push(rowFromCells(splitDelim(lines[i], delim), headerMap, lines[i]));
                }
                return rows.filter(r => r.title);
            }
        }

        // 3) Per-line: delimiter rows OR syllabus sentences.
        lines.forEach(l => {
            let lineDelim = '';
            if (l.includes('\t')) lineDelim = '\t';
            else if (l.includes('|')) lineDelim = '|';
            else if (/\s[-–—]\s/.test(l)) lineDelim = '__dash__';
            else if (l.includes(',') && l.split(',').length >= 3) lineDelim = ',';
            if (lineDelim) {
                const cells = lineDelim === '__dash__' ? l.split(/\s[-–—]\s/).map(s => s.trim()) : splitDelim(l, lineDelim);
                if (cells.filter(Boolean).length >= 2) { rows.push(rowFromPositional(cells, l)); return; }
            }
            // Syllabus prose: one line can hold several dated sentences.
            let produced = 0;
            l.split(/(?<=[.;])\s+/).forEach(sentence => {
                const syllabus = rowFromSyllabusLine(sentence.trim());
                if (syllabus && syllabus.title) { rows.push(syllabus); produced++; }
            });
            // A plain, short, dateless line (e.g. "Read chapter 5") is still a real
            // assignment — keep it as a titled, undated row rather than dropping it.
            const trimmed = l.trim();
            if (!produced && trimmed.length >= 3 && trimmed.length <= 100
                && /[a-z]/i.test(trimmed) && !/:$/.test(trimmed) && !looksLikeDate(trimmed)) {
                rows.push({ title: trimmed, course: '', dueDate: '', dueTime: '', sourceText: l });
            }
        });
        return rows.filter(r => r.title);
    }

    // --------------------------------------------------------------
    // Public surface
    // --------------------------------------------------------------
    const api = {
        VERSION,
        ACTIVITY_LOG_KEY,
        // intelligence
        deriveStudentContext,
        pickNextBestAction,
        // activity log + undo records
        getActivityLog,
        logActivity,
        updateActivityRecord,
        getActivityRecord,
        clearActivityLog,
        // import pipeline
        normalizeImportedAssignment,
        normalizeImportBatch,
        parseAssignmentText,
        detectDuplicate,
        ASSIGNMENT_TYPES,
        // small utilities reused by flow-assistant
        titleSimilarity,
        toISODate
    };

    if (typeof module !== 'undefined' && module.exports) {
        // Node export for engine tests (parser, normalization, similarity). The
        // browser globals below remain the canonical runtime surface.
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        // Canonical post-rebrand global. The legacy alias is retained so any
        // existing code or plugins referencing window.flowIntelligence keep working.
        window.sutraIntelligence = api;
        window.flowIntelligence = api;
    }
})();
