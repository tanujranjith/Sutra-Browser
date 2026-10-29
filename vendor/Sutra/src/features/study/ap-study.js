(function() {
    const AP_STATUSES = ['not_started', 'in_progress', 'reviewed', 'mastered', 'needs_review'];
    const AP_SECTIONS = ['overview', 'units', 'sessions', 'practice', 'analytics'];
    const AP_VIEW_MODES = ['home', 'detail'];
    const DEFAULT_VIEW_MODE = 'home';
    const STATUS_META = {
        not_started: { label: 'Not Started', progress: 0 },
        in_progress: { label: 'In Progress', progress: 0.35 },
        reviewed: { label: 'Reviewed', progress: 0.75 },
        mastered: { label: 'Mastered', progress: 1 },
        needs_review: { label: 'Needs Review', progress: 0.25 }
    };
    const SESSION_TYPE_META = {
        review: { label: 'Review', icon: 'fa-book-open' },
        frq: { label: 'FRQ Practice', icon: 'fa-pen-to-square' },
        mcq: { label: 'MCQ Set', icon: 'fa-list-check' },
        practice_test: { label: 'Practice Test', icon: 'fa-stopwatch' },
        weak_area: { label: 'Weak Area', icon: 'fa-triangle-exclamation' },
        mixed: { label: 'Mixed Session', icon: 'fa-layer-group' }
    };
    const PRACTICE_TYPE_META = {
        frq: { label: 'FRQ', icon: 'fa-pen-to-square' },
        mcq: { label: 'MCQ', icon: 'fa-list-check' },
        practice_test: { label: 'Practice Test', icon: 'fa-stopwatch' },
        review_session: { label: 'Review Session', icon: 'fa-book-open' }
    };
    const SUBJECT_COLORS = ['#ff7c8b', '#6fa7ff', '#44c7b1', '#f4b860', '#9a7cff', '#66c95f', '#e87bd6', '#5fc9f8'];
    const TASK_PREFIX = 'ap_session_';
    const SESSION_AUTO_KEY_PREFIX = 'apstudy:session:';
    const EXAM_AUTO_KEY_PREFIX = 'apstudy:exam:';
    const DEFAULT_SECTION = 'overview';
    let apStudyUiBound = false;
    let apStudyModalBound = false;
    let apStudySyncInProgress = false;
    let apStudyModalState = null;
    let apStudyModalReturnFocus = null;
    let apStudyExamCountdownTimer = null;
    let normalizedWorkspaceRef = null;

    function fallbackGenerateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function makeId(prefix) {
        try {
            if (typeof generateId === 'function') return `${prefix}_${generateId()}`;
        } catch (err) {
            console.warn('AP Study makeId fallback triggered', err);
        }
        return fallbackGenerateId(prefix);
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function cssEscapeValue(value) {
        const str = String(value == null ? '' : value);
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
        return str.replace(/(["\\])/g, '\\$1');
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function normalizeText(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeDateValue(value) {
        const raw = normalizeText(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
    }

    function normalizeTimeValue(value, fallback = '') {
        const raw = normalizeText(value);
        if (!raw) return fallback;
        return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
    }

    function normalizeNumberValue(value, fallback = 0, min = null, max = null) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        if (min != null && numeric < min) return min;
        if (max != null && numeric > max) return max;
        return numeric;
    }

    function normalizeConfidence(value, fallback = 3) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return clamp(Math.round(numeric), 1, 5);
    }

    function normalizeStatus(value) {
        const raw = normalizeText(value).toLowerCase();
        return AP_STATUSES.includes(raw) ? raw : 'not_started';
    }

    function normalizeSessionType(value) {
        const raw = normalizeText(value).toLowerCase();
        return Object.prototype.hasOwnProperty.call(SESSION_TYPE_META, raw) ? raw : 'review';
    }

    function normalizePracticeType(value) {
        const raw = normalizeText(value).toLowerCase();
        return Object.prototype.hasOwnProperty.call(PRACTICE_TYPE_META, raw) ? raw : 'review_session';
    }

    function normalizePriority(value) {
        if (typeof normalizePriorityValue === 'function') return normalizePriorityValue(value || 'medium');
        const raw = normalizeText(value).toLowerCase();
        return ['low', 'medium', 'high'].includes(raw) ? raw : 'medium';
    }

    function normalizeColor(value, index = 0) {
        const raw = normalizeText(value);
        if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
        return SUBJECT_COLORS[index % SUBJECT_COLORS.length];
    }

    function getDefaultApStudyWorkspace() {
        return {
            subjects: [],
            units: [],
            topics: [],
            sessions: [],
            practiceLogs: [],
            activity: [],
            settings: {
                activeSubjectId: null,
                activeSection: DEFAULT_SECTION,
                viewMode: DEFAULT_VIEW_MODE
            }
        };
    }

    const DEFAULT_QUICK_TASKS = [
        'Review formula sheet',
        'Complete one practice FRQ',
        'Do a timed MCQ set',
        'Review weak units'
    ];

    function normalizeQuickTasks(rawTasks) {
        if (!Array.isArray(rawTasks)) {
            return DEFAULT_QUICK_TASKS.map(text => ({
                id: makeId('apqtask'),
                text,
                done: false
            }));
        }
        return rawTasks
            .map(task => {
                const text = normalizeText(task && task.text);
                if (!text) return null;
                return {
                    id: normalizeText(task && task.id) || makeId('apqtask'),
                    text,
                    done: !!(task && task.done)
                };
            })
            .filter(Boolean);
    }

    function normalizeReadiness(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return clamp(Math.round(numeric), 0, 100);
    }

    function normalizeSubject(rawSubject, index) {
        const now = nowIso();
        const id = normalizeText(rawSubject && rawSubject.id) || makeId('apsubject');
        return {
            id,
            name: normalizeText(rawSubject && rawSubject.name) || `AP Subject ${index + 1}`,
            examDate: normalizeDateValue(rawSubject && rawSubject.examDate),
            examTime: normalizeTimeValue(rawSubject && rawSubject.examTime),
            teacherName: normalizeText(rawSubject && rawSubject.teacherName),
            currentUnit: normalizeText(rawSubject && rawSubject.currentUnit),
            totalUnitCount: normalizeNumberValue(rawSubject && rawSubject.totalUnitCount, 0, 0, 99),
            targetScore: clamp(normalizeNumberValue(rawSubject && rawSubject.targetScore, 3), 1, 5),
            confidenceLevel: normalizeConfidence(rawSubject && rawSubject.confidenceLevel, 3),
            readiness: normalizeReadiness(rawSubject && rawSubject.readiness),
            quickTasks: normalizeQuickTasks(rawSubject && rawSubject.quickTasks),
            description: normalizeText(rawSubject && rawSubject.description),
            noteId: normalizeText(rawSubject && rawSubject.noteId) || null,
            color: normalizeColor(rawSubject && rawSubject.color, index),
            homeworkCourseSource: normalizeText(rawSubject && rawSubject.homeworkCourseSource) || null,
            homeworkCourseId: normalizeText(rawSubject && rawSubject.homeworkCourseId) || null,
            homeworkCourseName: normalizeText(rawSubject && rawSubject.homeworkCourseName) || null,
            createdAt: normalizeText(rawSubject && rawSubject.createdAt) || now,
            updatedAt: normalizeText(rawSubject && rawSubject.updatedAt) || now
        };
    }

    function normalizeUnit(rawUnit, index, validSubjectIds) {
        const now = nowIso();
        const subjectId = normalizeText(rawUnit && rawUnit.subjectId);
        if (!validSubjectIds.has(subjectId)) return null;
        return {
            id: normalizeText(rawUnit && rawUnit.id) || makeId('apunit'),
            subjectId,
            title: normalizeText(rawUnit && rawUnit.title) || `Unit ${index + 1}`,
            order: normalizeNumberValue(rawUnit && rawUnit.order, index + 1, 1, 999),
            status: normalizeStatus(rawUnit && rawUnit.status),
            confidenceLevel: normalizeConfidence(rawUnit && rawUnit.confidenceLevel, 3),
            weakFlag: !!(rawUnit && rawUnit.weakFlag),
            noteId: normalizeText(rawUnit && rawUnit.noteId) || null,
            notes: normalizeText(rawUnit && rawUnit.notes),
            lastReviewedAt: normalizeText(rawUnit && rawUnit.lastReviewedAt) || null,
            createdAt: normalizeText(rawUnit && rawUnit.createdAt) || now,
            updatedAt: normalizeText(rawUnit && rawUnit.updatedAt) || now
        };
    }

    function normalizeTopic(rawTopic, index, unitMap, validSubjectIds) {
        const now = nowIso();
        const unitId = normalizeText(rawTopic && rawTopic.unitId);
        const unit = unitMap.get(unitId);
        const rawSubjectId = normalizeText(rawTopic && rawTopic.subjectId);
        const subjectId = unit ? unit.subjectId : rawSubjectId;
        if (!validSubjectIds.has(subjectId)) return null;
        return {
            id: normalizeText(rawTopic && rawTopic.id) || makeId('aptopic'),
            subjectId,
            // An explicit null represents a valid, visible unassigned topic.
            // Missing/deleted subject relationships remain invalid above.
            unitId: unit ? unit.id : null,
            title: normalizeText(rawTopic && rawTopic.title) || `Topic ${index + 1}`,
            order: normalizeNumberValue(rawTopic && rawTopic.order, index + 1, 1, 999),
            status: normalizeStatus(rawTopic && rawTopic.status),
            confidenceLevel: normalizeConfidence(rawTopic && rawTopic.confidenceLevel, 3),
            weakFlag: !!(rawTopic && rawTopic.weakFlag),
            noteId: normalizeText(rawTopic && rawTopic.noteId) || null,
            notes: normalizeText(rawTopic && rawTopic.notes),
            lastReviewedAt: normalizeText(rawTopic && rawTopic.lastReviewedAt) || null,
            createdAt: normalizeText(rawTopic && rawTopic.createdAt) || now,
            updatedAt: normalizeText(rawTopic && rawTopic.updatedAt) || now
        };
    }

    function normalizeSession(rawSession, index, subjectIds, unitMap, topicMap) {
        const now = nowIso();
        const subjectId = normalizeText(rawSession && rawSession.subjectId);
        if (!subjectIds.has(subjectId)) return null;
        const unitId = normalizeText(rawSession && rawSession.unitId) || null;
        const unit = unitId ? unitMap.get(unitId) : null;
        const topicId = normalizeText(rawSession && rawSession.topicId) || null;
        const topic = topicId ? topicMap.get(topicId) : null;
        return {
            id: normalizeText(rawSession && rawSession.id) || makeId('apsession'),
            subjectId,
            unitId: unit && unit.subjectId === subjectId ? unit.id : null,
            topicId: topic && topic.subjectId === subjectId ? topic.id : null,
            title: normalizeText(rawSession && rawSession.title) || `Study Session ${index + 1}`,
            date: normalizeDateValue(rawSession && rawSession.date),
            time: normalizeTimeValue(rawSession && rawSession.time, '17:00'),
            durationMinutes: normalizeNumberValue(rawSession && rawSession.durationMinutes, 60, 15, 480),
            priority: normalizePriority(rawSession && rawSession.priority),
            status: ['scheduled', 'completed', 'skipped'].includes(normalizeText(rawSession && rawSession.status).toLowerCase())
                ? normalizeText(rawSession && rawSession.status).toLowerCase()
                : 'scheduled',
            sessionType: normalizeSessionType(rawSession && rawSession.sessionType),
            noteId: normalizeText(rawSession && rawSession.noteId) || null,
            notes: normalizeText(rawSession && rawSession.notes),
            completedAt: normalizeText(rawSession && rawSession.completedAt) || null,
            createdAt: normalizeText(rawSession && rawSession.createdAt) || now,
            updatedAt: normalizeText(rawSession && rawSession.updatedAt) || now
        };
    }

    function normalizePracticeLog(rawLog, index, subjectIds, unitMap, topicMap) {
        const now = nowIso();
        const subjectId = normalizeText(rawLog && rawLog.subjectId);
        if (!subjectIds.has(subjectId)) return null;
        const unitId = normalizeText(rawLog && rawLog.unitId) || null;
        const unit = unitId ? unitMap.get(unitId) : null;
        const topicId = normalizeText(rawLog && rawLog.topicId) || null;
        const topic = topicId ? topicMap.get(topicId) : null;
        return {
            id: normalizeText(rawLog && rawLog.id) || makeId('appractice'),
            subjectId,
            unitId: unit && unit.subjectId === subjectId ? unit.id : null,
            topicId: topic && topic.subjectId === subjectId ? topic.id : null,
            title: normalizeText(rawLog && rawLog.title) || `Practice Log ${index + 1}`,
            type: normalizePracticeType(rawLog && rawLog.type),
            date: normalizeDateValue(rawLog && rawLog.date) || (typeof today === 'function' ? today() : ''),
            score: normalizeNumberValue(rawLog && rawLog.score, 0, 0, 100000),
            maxScore: normalizeNumberValue(rawLog && rawLog.maxScore, 0, 0, 100000),
            minutesSpent: normalizeNumberValue(rawLog && rawLog.minutesSpent, 0, 0, 600),
            confidenceAfter: normalizeConfidence(rawLog && rawLog.confidenceAfter, 3),
            markedWeak: !!(rawLog && rawLog.markedWeak),
            noteId: normalizeText(rawLog && rawLog.noteId) || null,
            notes: normalizeText(rawLog && rawLog.notes),
            createdAt: normalizeText(rawLog && rawLog.createdAt) || now,
            updatedAt: normalizeText(rawLog && rawLog.updatedAt) || now
        };
    }

    function normalizeApStudyWorkspace(rawWorkspace) {
        const workspace = rawWorkspace && typeof rawWorkspace === 'object' ? rawWorkspace : getDefaultApStudyWorkspace();
        const subjects = (Array.isArray(workspace.subjects) ? workspace.subjects : []).map(normalizeSubject);
        const seenSubjectIds = new Set();
        const uniqueSubjects = [];
        subjects.forEach((subject, index) => {
            let nextSubject = subject;
            if (seenSubjectIds.has(nextSubject.id)) {
                nextSubject = { ...nextSubject, id: makeId('apsubject'), color: normalizeColor(nextSubject.color, index) };
            }
            seenSubjectIds.add(nextSubject.id);
            uniqueSubjects.push(nextSubject);
        });

        const validSubjectIds = new Set(uniqueSubjects.map(subject => subject.id));
        const unitMap = new Map();
        const units = [];
        (Array.isArray(workspace.units) ? workspace.units : []).forEach((rawUnit, index) => {
            const normalized = normalizeUnit(rawUnit, index, validSubjectIds);
            if (!normalized) return;
            if (unitMap.has(normalized.id)) normalized.id = makeId('apunit');
            unitMap.set(normalized.id, normalized);
            units.push(normalized);
        });

        const topicMap = new Map();
        const topics = [];
        (Array.isArray(workspace.topics) ? workspace.topics : []).forEach((rawTopic, index) => {
            const normalized = normalizeTopic(rawTopic, index, unitMap, validSubjectIds);
            if (!normalized) return;
            if (topicMap.has(normalized.id)) normalized.id = makeId('aptopic');
            topicMap.set(normalized.id, normalized);
            topics.push(normalized);
        });

        const sessions = [];
        const sessionIds = new Set();
        (Array.isArray(workspace.sessions) ? workspace.sessions : []).forEach((rawSession, index) => {
            const normalized = normalizeSession(rawSession, index, validSubjectIds, unitMap, topicMap);
            if (!normalized) return;
            if (sessionIds.has(normalized.id)) normalized.id = makeId('apsession');
            sessionIds.add(normalized.id);
            sessions.push(normalized);
        });

        const practiceLogs = [];
        const practiceIds = new Set();
        (Array.isArray(workspace.practiceLogs) ? workspace.practiceLogs : []).forEach((rawLog, index) => {
            const normalized = normalizePracticeLog(rawLog, index, validSubjectIds, unitMap, topicMap);
            if (!normalized) return;
            if (practiceIds.has(normalized.id)) normalized.id = makeId('appractice');
            practiceIds.add(normalized.id);
            practiceLogs.push(normalized);
        });

        const activity = (Array.isArray(workspace.activity) ? workspace.activity : [])
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                id: normalizeText(item.id) || makeId('apactivity'),
                kind: normalizeText(item.kind) || 'update',
                message: normalizeText(item.message) || 'AP Study updated',
                subjectId: normalizeText(item.subjectId) || null,
                createdAt: normalizeText(item.createdAt) || nowIso()
            }))
            .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
            .slice(0, 120);

        const settings = workspace.settings && typeof workspace.settings === 'object'
            ? {
                activeSubjectId: validSubjectIds.has(normalizeText(workspace.settings.activeSubjectId))
                    ? normalizeText(workspace.settings.activeSubjectId)
                    : (uniqueSubjects[0] ? uniqueSubjects[0].id : null),
                activeSection: AP_SECTIONS.includes(normalizeText(workspace.settings.activeSection))
                    ? normalizeText(workspace.settings.activeSection)
                    : DEFAULT_SECTION,
                viewMode: AP_VIEW_MODES.includes(normalizeText(workspace.settings.viewMode))
                    ? normalizeText(workspace.settings.viewMode)
                    : DEFAULT_VIEW_MODE
            }
            : {
                activeSubjectId: uniqueSubjects[0] ? uniqueSubjects[0].id : null,
                activeSection: DEFAULT_SECTION,
                viewMode: DEFAULT_VIEW_MODE
            };

        return {
            subjects: uniqueSubjects,
            units,
            topics,
            sessions,
            practiceLogs,
            activity,
            settings
        };
    }

    function ensureWorkspace() {
        // Normalize only when hydration/import replaces the workspace object.
        // Feature mutations keep the same, already-normalized identity.
        if (!apStudyWorkspace || apStudyWorkspace !== normalizedWorkspaceRef) {
            apStudyWorkspace = normalizeApStudyWorkspace(apStudyWorkspace || getDefaultApStudyWorkspace());
            normalizedWorkspaceRef = apStudyWorkspace;
        }
        if (!AP_SECTIONS.includes(apStudyWorkspace.settings.activeSection)) {
            apStudyWorkspace.settings.activeSection = DEFAULT_SECTION;
        }
        if (!AP_VIEW_MODES.includes(apStudyWorkspace.settings.viewMode)) {
            apStudyWorkspace.settings.viewMode = DEFAULT_VIEW_MODE;
        }
        return apStudyWorkspace;
    }

    function getSubjectById(subjectId) {
        return ensureWorkspace().subjects.find(subject => subject.id === subjectId) || null;
    }

    function getUnitById(unitId) {
        return ensureWorkspace().units.find(unit => unit.id === unitId) || null;
    }

    function getTopicById(topicId) {
        return ensureWorkspace().topics.find(topic => topic.id === topicId) || null;
    }

    function getSessionById(sessionId) {
        return ensureWorkspace().sessions.find(session => session.id === sessionId) || null;
    }

    function getPracticeById(logId) {
        return ensureWorkspace().practiceLogs.find(log => log.id === logId) || null;
    }

    function getUnitsForSubject(subjectId) {
        return ensureWorkspace().units
            .filter(unit => unit.subjectId === subjectId)
            .sort((left, right) => (left.order - right.order) || left.title.localeCompare(right.title));
    }

    function getTopicsForUnit(unitId) {
        const normalizedUnitId = normalizeText(unitId) || null;
        return ensureWorkspace().topics
            .filter(topic => (topic.unitId || null) === normalizedUnitId)
            .sort((left, right) => (left.order - right.order) || left.title.localeCompare(right.title));
    }

    function getSessionsForSubject(subjectId) {
        return ensureWorkspace().sessions
            .filter(session => session.subjectId === subjectId)
            .sort(compareSessions);
    }

    function getPracticeLogsForSubject(subjectId) {
        return ensureWorkspace().practiceLogs
            .filter(log => log.subjectId === subjectId)
            .sort((left, right) => {
                const dateCompare = String(right.date || '').localeCompare(String(left.date || ''));
                if (dateCompare !== 0) return dateCompare;
                return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
            });
    }

    function getPagesForSelection() {
        return (Array.isArray(pages) ? pages : [])
            .filter(page => page && page.id !== 'help_page')
            .sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')));
    }

    function getNoteTitleById(noteId) {
        if (!noteId) return '';
        const page = (Array.isArray(pages) ? pages : []).find(item => item && item.id === noteId);
        return page ? String(page.title || '') : '';
    }

    function formatDateLabel(dateValue, options = {}) {
        const safe = normalizeDateValue(dateValue);
        if (!safe || typeof parseDate !== 'function') return options.fallback || 'No date';
        try {
            return parseDate(safe).toLocaleDateString('en-US', options.localeOptions || { month: 'short', day: 'numeric' });
        } catch (err) {
            return options.fallback || safe;
        }
    }

    function formatDateTimeLabel(dateValue, timeValue) {
        const dateLabel = formatDateLabel(dateValue, { fallback: 'No date', localeOptions: { month: 'short', day: 'numeric', weekday: 'short' } });
        const timeLabel = normalizeTimeValue(timeValue);
        if (!timeLabel) return dateLabel;
        if (typeof parseTimeToMinutes === 'function') {
            const minutes = parseTimeToMinutes(timeLabel);
            if (Number.isFinite(minutes)) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                const suffix = hours >= 12 ? 'PM' : 'AM';
                const displayHours = hours % 12 || 12;
                return `${dateLabel} • ${displayHours}:${String(mins).padStart(2, '0')} ${suffix}`;
            }
        }
        return `${dateLabel} • ${timeLabel}`;
    }

    function compareSessions(left, right) {
        const leftStamp = `${left.date || ''} ${left.time || ''}`;
        const rightStamp = `${right.date || ''} ${right.time || ''}`;
        return rightStamp.localeCompare(leftStamp);
    }

    function getStatusMeta(status) {
        return STATUS_META[normalizeStatus(status)] || STATUS_META.not_started;
    }

    function getStatusLabel(status) {
        return getStatusMeta(status).label;
    }

    function getStatusProgress(status) {
        return getStatusMeta(status).progress;
    }

    function getSessionDisplayTitle(session) {
        const subject = getSubjectById(session.subjectId);
        const unit = session.unitId ? getUnitById(session.unitId) : null;
        const topic = session.topicId ? getTopicById(session.topicId) : null;
        const raw = normalizeText(session.title);
        if (raw) return raw;
        const bits = [subject ? subject.name : 'AP Study'];
        if (topic) bits.push(topic.title);
        else if (unit) bits.push(unit.title);
        bits.push(SESSION_TYPE_META[session.sessionType].label);
        return bits.filter(Boolean).join(' • ');
    }

    function getSessionTaskTitle(session) {
        const subject = getSubjectById(session.subjectId);
        const unit = session.unitId ? getUnitById(session.unitId) : null;
        const topic = session.topicId ? getTopicById(session.topicId) : null;
        const baseTitle = normalizeText(session.title) || SESSION_TYPE_META[session.sessionType].label;
        const scope = topic ? topic.title : (unit ? unit.title : '');
        if (!subject) return scope ? `${baseTitle} • ${scope}` : baseTitle;
        return scope ? `${subject.name}: ${baseTitle} • ${scope}` : `${subject.name}: ${baseTitle}`;
    }

    function getSubjectUnitTargetCount(subject) {
        if (!subject) return 0;
        const trackedUnits = getUnitsForSubject(subject.id).length;
        const declaredUnits = normalizeNumberValue(subject.totalUnitCount, 0, 0, 99);
        return Math.max(trackedUnits, declaredUnits);
    }

    function calculateUnitProgress(unit) {
        const topics = getTopicsForUnit(unit.id);
        if (!topics.length) return Math.round(getStatusProgress(unit.status) * 100);
        const total = topics.reduce((sum, topic) => sum + getStatusProgress(topic.status), 0);
        return Math.round((total / topics.length) * 100);
    }

    function calculateSubjectProgress(subject) {
        const units = getUnitsForSubject(subject.id);
        const targetUnitCount = getSubjectUnitTargetCount(subject);
        if (!targetUnitCount) return 0;
        const total = units.reduce((sum, unit) => sum + calculateUnitProgress(unit), 0);
        return Math.round(total / targetUnitCount);
    }

    // Data-driven exam-readiness estimate (deterministic, local). Combines unit
    // review progress, recent practice scores, self-confidence, and a weak-area
    // penalty into a 0-100 readiness the student can adopt over the manual slider.
    function computeSuggestedReadiness(subject) {
        if (!subject) return null;
        const progress = clamp(calculateSubjectProgress(subject), 0, 100);
        const logs = getPracticeLogsForSubject(subject.id).slice(0, 5);
        let practiceAvg = null;
        if (logs.length) {
            const pts = logs.map(log => {
                const max = Number(log.maxScore) || 0;
                const sc = Number(log.score);
                return (max > 0 && Number.isFinite(sc)) ? clamp((sc / max) * 100, 0, 100) : null;
            }).filter(v => v !== null);
            if (pts.length) practiceAvg = pts.reduce((a, b) => a + b, 0) / pts.length;
        }
        const confidence = clamp((normalizeConfidence(subject.confidenceLevel, 3) / 5) * 100, 0, 100);
        const weak = countSubjectWeakItems(subject.id);
        const weakPenalty = clamp(weak * 3, 0, 25);
        let score;
        let hasSignal;
        if (practiceAvg !== null) {
            score = progress * 0.4 + practiceAvg * 0.4 + confidence * 0.2;
            hasSignal = true;
        } else {
            score = progress * 0.6 + confidence * 0.4;
            hasSignal = progress > 0 || getUnitsForSubject(subject.id).length > 0 || logs.length > 0;
        }
        score = clamp(Math.round(score - weakPenalty), 0, 100);
        return {
            score,
            hasSignal,
            basis: {
                progress: Math.round(progress),
                practiceAvg: practiceAvg === null ? null : Math.round(practiceAvg),
                confidence: Math.round(confidence),
                weak
            }
        };
    }

    function getRemainingReviewCount(subjectId) {
        const subject = getSubjectById(subjectId);
        if (!subject) return 0;
        const units = getUnitsForSubject(subjectId);
        const topics = ensureWorkspace().topics.filter(topic => topic.subjectId === subjectId);
        const unitNeeds = units.filter(unit => ['not_started', 'in_progress', 'needs_review'].includes(unit.status)).length;
        const topicNeeds = topics.filter(topic => ['not_started', 'in_progress', 'needs_review'].includes(topic.status)).length;
        const missingUnits = Math.max(0, getSubjectUnitTargetCount(subject) - units.length);
        return unitNeeds + topicNeeds + missingUnits;
    }

    function countSubjectIncompleteUnits(subjectId) {
        const subject = getSubjectById(subjectId);
        if (!subject) return 0;
        const units = getUnitsForSubject(subjectId);
        const completeUnits = units.filter(unit => calculateUnitProgress(unit) >= 100).length;
        const targetUnitCount = getSubjectUnitTargetCount(subject);
        return Math.max(0, targetUnitCount - completeUnits);
    }

    function countSubjectMasteredItems(subjectId) {
        const units = getUnitsForSubject(subjectId);
        const topics = ensureWorkspace().topics.filter(topic => topic.subjectId === subjectId);
        return units.filter(unit => unit.status === 'mastered').length + topics.filter(topic => topic.status === 'mastered').length;
    }

    function parseApExamDateTime(dateValue, timeValue, options = {}) {
        const requireTime = options.requireTime !== false;
        const normalizedDate = normalizeDateValue(dateValue);
        const normalizedTime = normalizeTimeValue(timeValue);
        if (!normalizedDate) {
            return { status: 'missing_date', dateTime: null, date: '', time: '', resolvedTime: '' };
        }
        if (requireTime && !normalizedTime) {
            return { status: 'missing_time', dateTime: null, date: normalizedDate, time: '', resolvedTime: '' };
        }
        const resolvedTime = normalizedTime || '09:00';
        const dateParts = normalizedDate.split('-').map(part => Number(part));
        const timeParts = resolvedTime.split(':').map(part => Number(part));
        const dateTime = new Date(
            dateParts[0],
            (dateParts[1] || 1) - 1,
            dateParts[2] || 1,
            timeParts[0] || 0,
            timeParts[1] || 0,
            0,
            0
        );
        if (Number.isNaN(dateTime.getTime())) {
            return { status: 'invalid', dateTime: null, date: normalizedDate, time: normalizedTime, resolvedTime };
        }
        return {
            status: normalizedTime ? 'ready' : 'default_time',
            dateTime,
            date: normalizedDate,
            time: normalizedTime,
            resolvedTime
        };
    }

    function getApExamCountdown(dateValue, timeValue, options = {}) {
        const parsed = parseApExamDateTime(dateValue, timeValue, options);
        if (parsed.status === 'missing_date') return { status: 'missing_date', parsed };
        if (parsed.status === 'missing_time') return { status: 'missing_time', parsed };
        if (!parsed.dateTime) return { status: 'invalid', parsed };

        const now = Date.now();
        const deltaMs = parsed.dateTime.getTime() - now;
        if (deltaMs <= 0) {
            return {
                status: 'passed',
                parsed,
                deltaMs,
                absMs: Math.abs(deltaMs),
                days: 0,
                hours: 0,
                minutes: 0,
                seconds: 0,
                dateTime: parsed.dateTime
            };
        }

        const totalSeconds = Math.floor(deltaMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return {
            status: 'counting',
            parsed,
            deltaMs,
            totalSeconds,
            days,
            hours,
            minutes,
            seconds,
            dateTime: parsed.dateTime
        };
    }

    function formatApExamDateTime(dateValue, timeValue) {
        const parsed = parseApExamDateTime(dateValue, timeValue, { requireTime: false });
        if (!parsed.dateTime) return 'Not scheduled';
        return parsed.dateTime.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatApExamCountdownLabel(countdown, options = {}) {
        const includeSeconds = options.includeSeconds !== false;
        if (!countdown || countdown.status === 'missing_date') return 'Set exam date';
        if (countdown.status === 'missing_time') return 'Add exam time';
        if (countdown.status === 'invalid') return 'Invalid exam date';
        if (countdown.status === 'passed') return 'Exam passed';
        const days = `${countdown.days}d`;
        const hours = `${String(countdown.hours).padStart(2, '0')}h`;
        const minutes = `${String(countdown.minutes).padStart(2, '0')}m`;
        const seconds = `${String(countdown.seconds).padStart(2, '0')}s`;
        return includeSeconds ? `${days} ${hours} ${minutes} ${seconds}` : `${days} ${hours} ${minutes}`;
    }

    function getApExamCountdownSortValue(subject) {
        if (!subject) return null;
        const parsed = parseApExamDateTime(subject.examDate, subject.examTime, { requireTime: false });
        return parsed.dateTime ? parsed.dateTime.getTime() : null;
    }

    function getNextExamSubject(subjects) {
        const now = Date.now();
        const candidates = (Array.isArray(subjects) ? subjects : [])
            .map(subject => ({ subject, sortValue: getApExamCountdownSortValue(subject) }))
            .filter(item => item.sortValue != null)
            .sort((left, right) => left.sortValue - right.sortValue);
        if (!candidates.length) return null;
        const upcoming = candidates.find(item => item.sortValue >= now);
        return upcoming ? upcoming.subject : candidates[0].subject;
    }

    function buildApExamCountdownMarkup(subject, options = {}) {
        const compact = options.compact === true;
        const dateValue = normalizeDateValue(subject && subject.examDate);
        const timeValue = normalizeTimeValue(subject && subject.examTime);
        const countdown = getApExamCountdown(dateValue, timeValue, { requireTime: true });
        if (compact) {
            return `<span class="ap-study-countdown ap-study-countdown-live" data-ap-exam-countdown data-ap-countdown-mode="compact" data-ap-exam-date="${escapeHtml(dateValue)}" data-ap-exam-time="${escapeHtml(timeValue)}">${escapeHtml(formatApExamCountdownLabel(countdown, { includeSeconds: true }))}</span>`;
        }
        return `
            <div class="ap-study-exam-countdown" data-ap-exam-countdown data-ap-countdown-mode="full" data-ap-exam-date="${escapeHtml(dateValue)}" data-ap-exam-time="${escapeHtml(timeValue)}">
                <div class="ap-study-exam-countdown-grid">
                    <div class="ap-study-exam-countdown-cell"><strong data-countdown-unit="days">--</strong><span>Days</span></div>
                    <div class="ap-study-exam-countdown-cell"><strong data-countdown-unit="hours">--</strong><span>Hours</span></div>
                    <div class="ap-study-exam-countdown-cell"><strong data-countdown-unit="minutes">--</strong><span>Minutes</span></div>
                    <div class="ap-study-exam-countdown-cell"><strong data-countdown-unit="seconds">--</strong><span>Seconds</span></div>
                </div>
                <div class="ap-study-exam-countdown-meta">
                    <span data-countdown-role="status">Add exam date and time</span>
                    <span data-countdown-role="datetime">Not scheduled</span>
                </div>
            </div>
        `;
    }

    function formatUrgency(days) {
        if (days === null || days === undefined || !Number.isFinite(days)) {
            return { label: 'Not scheduled', tone: 'dim' };
        }
        if (days < 0) return { label: 'Past', tone: 'dim' };
        if (days === 0) return { label: 'Today', tone: 'danger' };
        if (days === 1) return { label: 'Tomorrow', tone: 'danger' };
        if (days <= 7) return { label: `${days} days`, tone: 'danger' };
        if (days <= 30) return { label: `${days} days`, tone: 'warn' };
        return { label: `${days} days`, tone: 'accent' };
    }

    function buildCountdownRing(days, options = {}) {
        const size = Number(options.size) || 56;
        const stroke = Number(options.stroke) || 4;
        const radius = (size - stroke) / 2;
        const circumference = 2 * Math.PI * radius;
        const horizon = Number(options.horizon) || 90;
        let tone = 'accent';
        let progress = 0;
        let centerLabel = '';
        let centerUnit = '';
        if (!Number.isFinite(days) || days === null || days === undefined) {
            tone = 'dim';
            centerLabel = '-';
            centerUnit = '';
        } else if (days < 0) {
            tone = 'dim';
            progress = 1;
            centerLabel = '•';
            centerUnit = 'past';
        } else {
            if (days <= 7) tone = 'danger';
            else if (days <= 30) tone = 'warn';
            else tone = 'accent';
            const clampedDays = Math.min(horizon, Math.max(0, days));
            progress = 1 - (clampedDays / horizon);
            centerLabel = String(days);
            centerUnit = days === 1 ? 'day' : 'days';
        }
        const dashOffset = circumference * (1 - progress);
        return `
            <div class="ap-study-ring ap-study-ring--${tone}" aria-hidden="true">
                <svg class="ap-study-ring__svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
                    <circle class="ap-study-ring__track" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke-width="${stroke}"></circle>
                    <circle class="ap-study-ring__fill" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
                        stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}"
                        transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
                </svg>
                <div class="ap-study-ring__center">
                    <strong>${escapeHtml(centerLabel)}</strong>
                    ${centerUnit ? `<span>${escapeHtml(centerUnit)}</span>` : ''}
                </div>
            </div>
        `;
    }

    function updateApExamCountdownNode(node) {
        if (!node) return;
        const mode = normalizeText(node.dataset.apCountdownMode || 'compact').toLowerCase();
        const examDate = normalizeDateValue(node.dataset.apExamDate || '');
        const examTime = normalizeTimeValue(node.dataset.apExamTime || '');
        const countdown = getApExamCountdown(examDate, examTime, { requireTime: true });

        node.classList.toggle('is-live', countdown.status === 'counting');
        node.classList.toggle('is-passed', countdown.status === 'passed');
        node.classList.toggle('is-missing', ['missing_date', 'missing_time', 'invalid'].includes(countdown.status));

        if (mode === 'compact') {
            node.textContent = formatApExamCountdownLabel(countdown, { includeSeconds: true });
            return;
        }

        const values = countdown.status === 'counting'
            ? {
                days: String(countdown.days),
                hours: String(countdown.hours).padStart(2, '0'),
                minutes: String(countdown.minutes).padStart(2, '0'),
                seconds: String(countdown.seconds).padStart(2, '0')
            }
            : { days: '--', hours: '--', minutes: '--', seconds: '--' };
        Object.entries(values).forEach(([unit, value]) => {
            const unitEl = node.querySelector(`[data-countdown-unit="${unit}"]`);
            if (unitEl) unitEl.textContent = value;
        });

        const statusEl = node.querySelector('[data-countdown-role="status"]');
        if (statusEl) {
            if (countdown.status === 'counting') statusEl.textContent = 'Live countdown in progress';
            else if (countdown.status === 'passed') statusEl.textContent = 'Exam time passed - update for the next date';
            else if (countdown.status === 'missing_time' && examDate) statusEl.textContent = 'Exam date saved - add a time to start countdown';
            else statusEl.textContent = 'Add exam date and time';
        }

        const dateTimeEl = node.querySelector('[data-countdown-role="datetime"]');
        if (dateTimeEl) {
            if (countdown.status === 'counting' || countdown.status === 'passed') {
                dateTimeEl.textContent = formatApExamDateTime(examDate, examTime);
            } else if (examDate) {
                dateTimeEl.textContent = examTime
                    ? formatApExamDateTime(examDate, examTime)
                    : `${formatDateLabel(examDate, { fallback: 'No date' })} - time not set`;
            } else {
                dateTimeEl.textContent = 'Not scheduled';
            }
        }
    }

    function refreshApExamCountdownNodes() {
        const mount = document.getElementById('apStudyMount');
        if (!mount) return 0;
        const nodes = mount.querySelectorAll('[data-ap-exam-countdown]');
        nodes.forEach(updateApExamCountdownNode);
        return nodes.length;
    }

    function startApExamCountdownTicker() {
        if (apStudyExamCountdownTimer !== null) {
            window.clearInterval(apStudyExamCountdownTimer);
            apStudyExamCountdownTimer = null;
        }
        const nodeCount = refreshApExamCountdownNodes();
        if (!nodeCount) return;
        apStudyExamCountdownTimer = window.setInterval(() => {
            if (typeof activeView !== 'undefined' && activeView !== 'apstudy') return;
            const count = refreshApExamCountdownNodes();
            if (!count) {
                window.clearInterval(apStudyExamCountdownTimer);
                apStudyExamCountdownTimer = null;
            }
        }, 1000);
    }

    function getDaysUntilExam(subject) {
        if (!subject) return null;
        const countdown = getApExamCountdown(subject.examDate, subject.examTime, { requireTime: false });
        if (!countdown || ['missing_date', 'invalid'].includes(countdown.status)) return null;
        if (countdown.status === 'passed') return -Math.max(1, Math.ceil((countdown.absMs || 0) / 86400000));
        return Math.ceil((countdown.deltaMs || 0) / 86400000);
    }

    function getExamCountdownLabel(subject) {
        const countdown = getApExamCountdown(subject && subject.examDate, subject && subject.examTime, { requireTime: true });
        return formatApExamCountdownLabel(countdown, { includeSeconds: true });
    }

    function getPracticePercent(log) {
        const maxScore = Number(log && log.maxScore);
        const score = Number(log && log.score);
        if (!(maxScore > 0) || !Number.isFinite(score)) return null;
        return Math.round((score / maxScore) * 100);
    }

    function getEntityPriorityScore(entity, subject) {
        const examDays = getDaysUntilExam(subject);
        const examPressure = examDays == null ? 0 : clamp(60 - examDays, 0, 60);
        const statusBoost = entity.status === 'needs_review' ? 30 : entity.status === 'not_started' ? 18 : entity.status === 'in_progress' ? 12 : 0;
        const weakBoost = entity.weakFlag ? 28 : 0;
        const confidenceBoost = clamp((3 - normalizeConfidence(entity.confidenceLevel, 3)) * 8, 0, 24);
        const staleBoost = entity.lastReviewedAt ? 0 : 8;
        return examPressure + statusBoost + weakBoost + confidenceBoost + staleBoost;
    }

    function getWeakAreaItems(subjectId = null) {
        const workspace = ensureWorkspace();
        const items = [];
        const subjectFilter = subjectId ? String(subjectId) : null;
        workspace.units.forEach(unit => {
            if (subjectFilter && unit.subjectId !== subjectFilter) return;
            const subject = getSubjectById(unit.subjectId);
            const qualifies = unit.weakFlag || unit.status === 'needs_review' || unit.confidenceLevel <= 2;
            if (!qualifies) return;
            items.push({
                id: unit.id,
                entityType: 'unit',
                subjectId: unit.subjectId,
                unitId: unit.id,
                topicId: null,
                title: unit.title,
                subtitle: subject ? subject.name : '',
                status: unit.status,
                weakFlag: unit.weakFlag,
                confidenceLevel: unit.confidenceLevel,
                priorityScore: getEntityPriorityScore(unit, subject)
            });
        });
        workspace.topics.forEach(topic => {
            if (subjectFilter && topic.subjectId !== subjectFilter) return;
            const subject = getSubjectById(topic.subjectId);
            const unit = getUnitById(topic.unitId);
            const qualifies = topic.weakFlag || topic.status === 'needs_review' || topic.confidenceLevel <= 2;
            if (!qualifies) return;
            items.push({
                id: topic.id,
                entityType: 'topic',
                subjectId: topic.subjectId,
                unitId: topic.unitId,
                topicId: topic.id,
                title: topic.title,
                subtitle: [subject ? subject.name : '', unit ? unit.title : ''].filter(Boolean).join(' • '),
                status: topic.status,
                weakFlag: topic.weakFlag,
                confidenceLevel: topic.confidenceLevel,
                priorityScore: getEntityPriorityScore(topic, subject)
            });
        });
        return items.sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title));
    }

    function countSubjectWeakItems(subjectId) {
        return getWeakAreaItems(subjectId).length;
    }

    function shiftDate(dateValue, deltaDays) {
        if (!dateValue || typeof parseDate !== 'function' || typeof dateKey !== 'function') return dateValue || '';
        try {
            const next = parseDate(dateValue);
            next.setDate(next.getDate() + deltaDays);
            return dateKey(next);
        } catch (err) {
            return dateValue;
        }
    }

    function getUpcomingSessions(limit = 6, subjectId = null) {
        const todayKey = typeof today === 'function' ? today() : '';
        return ensureWorkspace().sessions
            .filter(session => session.status === 'scheduled')
            .filter(session => !subjectId || session.subjectId === subjectId)
            .filter(session => !session.date || session.date >= todayKey)
            .sort((left, right) => `${left.date || ''} ${left.time || ''}`.localeCompare(`${right.date || ''} ${right.time || ''}`))
            .slice(0, limit);
    }

    function getRecentActivity(limit = 8, subjectId = null) {
        return ensureWorkspace().activity
            .filter(item => !subjectId || item.subjectId === subjectId)
            .slice(0, limit);
    }

    function getRecentStudyMinutes(windowDays = 14, subjectId = null) {
        const todayKey = typeof today === 'function' ? today() : '';
        return ensureWorkspace().sessions.reduce((sum, session) => {
            if (subjectId && session.subjectId !== subjectId) return sum;
            if (session.status !== 'completed') return sum;
            if (todayKey && session.date && session.date < shiftDate(todayKey, -windowDays + 1)) return sum;
            return sum + (Number(session.durationMinutes) || 0);
        }, 0) + ensureWorkspace().practiceLogs.reduce((sum, log) => {
            if (subjectId && log.subjectId !== subjectId) return sum;
            if (todayKey && log.date && log.date < shiftDate(todayKey, -windowDays + 1)) return sum;
            return sum + (Number(log.minutesSpent) || 0);
        }, 0);
    }

    function getAllStudyActivityDates(subjectId = null) {
        const dateSet = new Set();
        ensureWorkspace().sessions.forEach(session => {
            if (subjectId && session.subjectId !== subjectId) return;
            if (session.status === 'completed' && session.date) dateSet.add(session.date);
        });
        ensureWorkspace().practiceLogs.forEach(log => {
            if (subjectId && log.subjectId !== subjectId) return;
            if (log.date) dateSet.add(log.date);
        });
        return Array.from(dateSet).sort();
    }

    function getStudyStreak(subjectId = null) {
        const dates = getAllStudyActivityDates(subjectId);
        if (!dates.length || typeof today !== 'function' || typeof parseDate !== 'function') return 0;
        const dateSet = new Set(dates);
        let cursor = parseDate(today());
        let streak = 0;
        while (true) {
            const key = typeof dateKey === 'function' ? dateKey(cursor) : '';
            if (!key || !dateSet.has(key)) break;
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
    }

    function pushActivity(kind, message, subjectId) {
        ensureWorkspace();
        apStudyWorkspace.activity.unshift({
            id: makeId('apactivity'),
            kind,
            message,
            subjectId: subjectId || null,
            createdAt: nowIso()
        });
        apStudyWorkspace.activity = apStudyWorkspace.activity.slice(0, 120);
    }

    function ensureSubjectSelection() {
        ensureWorkspace();
        const hasCurrent = apStudyWorkspace.subjects.some(subject => subject.id === apStudyWorkspace.settings.activeSubjectId);
        if (!hasCurrent) {
            apStudyWorkspace.settings.activeSubjectId = apStudyWorkspace.subjects[0] ? apStudyWorkspace.subjects[0].id : null;
        }
        return apStudyWorkspace.settings.activeSubjectId;
    }

    function ensureApStudyViewEnabled() {
        if (!appSettings || !appSettings.enabledViews) return;
        if (appSettings.enabledViews.apstudy === false) {
            appSettings.enabledViews.apstudy = true;
            if (typeof applyFeatureTabVisibility === 'function') applyFeatureTabVisibility();
        }
    }

    function syncApStudyTasks() {
        ensureWorkspace();
        const desiredMap = new Map();
        apStudyWorkspace.sessions.forEach(session => {
            if (session.status === 'skipped') return;
            const subject = getSubjectById(session.subjectId);
            if (!subject) return;
            const unit = session.unitId ? getUnitById(session.unitId) : null;
            const topic = session.topicId ? getTopicById(session.topicId) : null;
            const id = `${TASK_PREFIX}${session.id}`;
            desiredMap.set(id, {
                id,
                title: getSessionTaskTitle(session),
                notes: session.notes || `AP Study session • ${SESSION_TYPE_META[session.sessionType].label}`,
                scheduleType: 'once',
                weeklyDays: [],
                category: 'learning',
                priority: normalizePriority(session.priority),
                difficulty: session.sessionType === 'practice_test' ? 'hard' : 'medium',
                estimate: 0,
                dueDate: session.date || null,
                noteId: session.noteId || topic?.noteId || unit?.noteId || subject.noteId || null,
                isActive: session.status === 'scheduled',
                origin: 'ap_study',
                apStudySessionId: session.id,
                apStudySubjectId: session.subjectId,
                apStudyUnitId: session.unitId || null,
                apStudyTopicId: session.topicId || null,
                apStudySessionType: session.sessionType,
                createdAt: session.createdAt || nowIso()
            });
        });

        const existingTaskMap = new Map((Array.isArray(tasks) ? tasks : []).map(task => [String(task.id), task]));
        const existingApTasks = (Array.isArray(tasks) ? tasks : []).filter(task => task && task.origin === 'ap_study');
        let changed = false;

        existingApTasks.forEach(task => {
            if (desiredMap.has(String(task.id))) return;
            changed = true;
            taskOrder = (Array.isArray(taskOrder) ? taskOrder : []).filter(id => id !== task.id);
            if (typeof removeTaskReferencesFromDayStates === 'function') removeTaskReferencesFromDayStates(task.id);
            if (taskStreaks && typeof taskStreaks === 'object') delete taskStreaks[task.id];
        });

        if (changed) {
            tasks = (Array.isArray(tasks) ? tasks : []).filter(task => !(task && task.origin === 'ap_study' && !desiredMap.has(String(task.id))));
        }

        desiredMap.forEach((nextTask, id) => {
            const existing = existingTaskMap.get(id);
            if (!existing) {
                tasks.unshift({ ...nextTask });
                if (!taskOrder.includes(id)) taskOrder.unshift(id);
                changed = true;
                return;
            }

            let taskChanged = false;
            Object.keys(nextTask).forEach(key => {
                if (existing[key] !== nextTask[key]) {
                    existing[key] = nextTask[key];
                    taskChanged = true;
                }
            });
            if (!taskOrder.includes(id)) {
                taskOrder.unshift(id);
                taskChanged = true;
            }
            if (nextTask.isActive) {
                Object.values(dayStates || {}).forEach(day => {
                    if (!day || !Array.isArray(day.completedTaskIds)) return;
                    const before = day.completedTaskIds.length;
                    day.completedTaskIds = day.completedTaskIds.filter(taskId => taskId !== id);
                    if (day.completedTaskIds.length !== before) taskChanged = true;
                });
            }
            if (taskChanged) changed = true;
        });

        return changed;
    }

    function getApStudySessionBlockCandidate(session) {
        const subject = getSubjectById(session.subjectId);
        if (!subject || !session.date || !session.time) return null;
        const start = normalizeTimeValue(session.time, '17:00');
        const startMins = typeof parseTimeToMinutes === 'function' ? parseTimeToMinutes(start) : 17 * 60;
        const endMins = clamp((Number.isFinite(startMins) ? startMins : 17 * 60) + (Number(session.durationMinutes) || 60), 15, (23 * 60) + 59);
        const end = typeof minutesToTimeString === 'function' ? minutesToTimeString(endMins) : '18:00';
        return {
            name: getSessionTaskTitle(session),
            start,
            end,
            category: 'learning',
            color: subject.color,
            recurrence: 'none',
            date: session.date,
            referenceUrl: null,
            source: 'ap_study_session',
            autoSourceKey: `${SESSION_AUTO_KEY_PREFIX}${session.id}`,
            apStudySessionId: session.id,
            apStudySubjectId: session.subjectId,
            apStudyUnitId: session.unitId || null,
            apStudyTopicId: session.topicId || null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    function getApStudyExamBlockCandidate(subject) {
        if (!subject || !subject.examDate) return null;
        const start = normalizeTimeValue(subject.examTime, '09:00');
        const startMins = typeof parseTimeToMinutes === 'function' ? parseTimeToMinutes(start) : 9 * 60;
        const end = typeof minutesToTimeString === 'function'
            ? minutesToTimeString(clamp((Number.isFinite(startMins) ? startMins : 9 * 60) + 180, 15, (23 * 60) + 59))
            : '12:00';
        return {
            name: `${subject.name} Exam`,
            start,
            end,
            category: 'learning',
            color: subject.color,
            recurrence: 'none',
            date: subject.examDate,
            referenceUrl: null,
            source: 'ap_study_exam',
            autoSourceKey: `${EXAM_AUTO_KEY_PREFIX}${subject.id}`,
            apStudySubjectId: subject.id,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    function syncApStudyTimelineBlocks() {
        ensureWorkspace();
        const desiredMap = new Map();
        apStudyWorkspace.sessions.forEach(session => {
            if (session.status === 'skipped') return;
            const candidate = getApStudySessionBlockCandidate(session);
            if (candidate) desiredMap.set(candidate.autoSourceKey, candidate);
        });
        apStudyWorkspace.subjects.forEach(subject => {
            const candidate = getApStudyExamBlockCandidate(subject);
            if (candidate) desiredMap.set(candidate.autoSourceKey, candidate);
        });

        const existingBlocks = Array.isArray(timeBlocks) ? timeBlocks : [];
        const existingApBlocks = existingBlocks.filter(block => block && (block.source === 'ap_study_session' || block.source === 'ap_study_exam'));
        const existingBlockMap = new Map(existingBlocks.map(block => [String(block.autoSourceKey || ''), block]));
        let changed = false;

        existingApBlocks.forEach(block => {
            const key = String(block.autoSourceKey || '');
            if (!desiredMap.has(key)) changed = true;
        });
        if (changed) {
            timeBlocks = existingBlocks.filter(block => {
                if (!block) return false;
                if (block.source !== 'ap_study_session' && block.source !== 'ap_study_exam') return true;
                return desiredMap.has(String(block.autoSourceKey || ''));
            });
        }

        desiredMap.forEach((candidate, key) => {
            const existing = existingBlockMap.get(key);
            if (!existing) {
                timeBlocks.push({
                    id: typeof generateBlockId === 'function' ? generateBlockId() : fallbackGenerateId('block'),
                    ...candidate
                });
                changed = true;
                return;
            }

            let blockChanged = false;
            Object.keys(candidate).forEach(field => {
                if (existing[field] !== candidate[field]) {
                    existing[field] = candidate[field];
                    blockChanged = true;
                }
            });
            if (blockChanged) changed = true;
        });

        if (changed && typeof sortTimeBlocksByDateAndStart === 'function') {
            sortTimeBlocksByDateAndStart();
        }
        return changed;
    }

    function syncApStudySessionsIntoTaskStore(options = {}) {
        if (apStudySyncInProgress) return { tasksChanged: false, timelineChanged: false };
        apStudySyncInProgress = true;
        try {
            const tasksChanged = syncApStudyTasks();
            const timelineChanged = syncApStudyTimelineBlocks();
            const shouldPersist = options.persist !== false;
            if (shouldPersist) {
                if (timelineChanged && typeof saveTimeBlocks === 'function') {
                    saveTimeBlocks();
                } else if (tasksChanged && typeof persistAppData === 'function') {
                    persistAppData();
                }
            }
            return { tasksChanged, timelineChanged };
        } finally {
            apStudySyncInProgress = false;
        }
    }

    function renderDependents(options = {}) {
        const syncResult = syncApStudySessionsIntoTaskStore({ persist: true });
        if (options.skipApRender !== true && activeView === 'apstudy') {
            renderApStudyWorkspace();
        }
        if (options.skipTaskRender !== true && typeof renderTaskViews === 'function') {
            renderTaskViews();
        }
        if (syncResult.timelineChanged && activeView === 'timeline' && typeof renderTimeline === 'function') {
            renderTimeline();
        }
        if (typeof renderTodayStudentHub === 'function') {
            renderTodayStudentHub(typeof today === 'function' ? today() : '');
        }
    }

    function getApStudyTodayStats() {
        const subjects = ensureWorkspace().subjects;
        const upcomingSessions = getUpcomingSessions(99).length;
        const weakAreas = getWeakAreaItems().length;
        const nextExam = getNextExamSubject(subjects);
        const nextExamCountdown = nextExam
            ? formatApExamCountdownLabel(getApExamCountdown(nextExam.examDate, nextExam.examTime, { requireTime: true }), { includeSeconds: false })
            : '';
        return {
            subjectCount: subjects.length,
            upcomingSessions,
            weakAreas,
            nextExamDays: nextExam ? getDaysUntilExam(nextExam) : null,
            nextExamLabel: nextExam ? nextExam.name : '',
            nextExamCountdown,
            studyMinutes14d: getRecentStudyMinutes(14)
        };
    }

    function setActiveSubject(subjectId) {
        ensureWorkspace();
        if (subjectId && apStudyWorkspace.subjects.some(subject => subject.id === subjectId)) {
            apStudyWorkspace.settings.activeSubjectId = subjectId;
            apStudyWorkspace.settings.viewMode = 'detail';
        } else {
            apStudyWorkspace.settings.activeSubjectId = apStudyWorkspace.subjects[0] ? apStudyWorkspace.subjects[0].id : null;
        }
        if (typeof persistAppData === 'function') persistAppData();
        if (activeView === 'apstudy') renderApStudyWorkspace();
    }

    function setActiveSection(section) {
        ensureWorkspace();
        apStudyWorkspace.settings.activeSection = AP_SECTIONS.includes(section) ? section : DEFAULT_SECTION;
        apStudyWorkspace.settings.viewMode = 'detail';
        if (typeof persistAppData === 'function') persistAppData();
        if (activeView === 'apstudy') renderApStudyWorkspace();
    }

    function setApStudyViewMode(mode) {
        ensureWorkspace();
        apStudyWorkspace.settings.viewMode = AP_VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW_MODE;
        if (typeof persistAppData === 'function') persistAppData();
        if (activeView === 'apstudy') renderApStudyWorkspace();
    }

    function openLinkedNote(noteId) {
        if (!noteId) return;
        ensureApStudyViewEnabled();
        if (typeof loadPage === 'function') loadPage(noteId);
        if (typeof setActiveView === 'function') setActiveView('notes');
    }

    function buildEntityNoteTitle(entityType, entityId) {
        const entity = entityType === 'subject'
            ? getSubjectById(entityId)
            : entityType === 'unit'
                ? getUnitById(entityId)
                : entityType === 'topic'
                    ? getTopicById(entityId)
                    : entityType === 'session'
                        ? getSessionById(entityId)
                        : getPracticeById(entityId);
        if (!entity) return 'AP Study::Notes';
        if (entityType === 'subject') return `AP Study::${entity.name}::Review Hub`;
        if (entityType === 'unit') {
            const subject = getSubjectById(entity.subjectId);
            return `AP Study::${subject ? subject.name : 'Subject'}::${entity.title}`;
        }
        if (entityType === 'topic') {
            const subject = getSubjectById(entity.subjectId);
            const unit = getUnitById(entity.unitId);
            return `AP Study::${subject ? subject.name : 'Subject'}::${unit ? unit.title : 'Topics'}::${entity.title}`;
        }
        if (entityType === 'session') {
            const subject = getSubjectById(entity.subjectId);
            return `AP Study::${subject ? subject.name : 'Subject'}::Sessions::${getSessionDisplayTitle(entity)}`;
        }
        const subject = getSubjectById(entity.subjectId);
        return `AP Study::${subject ? subject.name : 'Subject'}::Practice::${entity.title}`;
    }

    function buildEntityNoteContent(entityType, entityId) {
        const title = buildEntityNoteTitle(entityType, entityId).split('::').pop();
        return `
            <h2>${escapeHtml(title)}</h2>
            <p>Linked from AP Study Mode inside Sutra.</p>
            <h3>Key Ideas</h3>
            <ul><li></li></ul>
            <h3>Weak Spots</h3>
            <ul><li></li></ul>
            <h3>Review Plan</h3>
            <ul><li></li></ul>
        `;
    }

    function assignEntityNoteId(entityType, entityId, noteId) {
        const entity = entityType === 'subject'
            ? getSubjectById(entityId)
            : entityType === 'unit'
                ? getUnitById(entityId)
                : entityType === 'topic'
                    ? getTopicById(entityId)
                    : entityType === 'session'
                        ? getSessionById(entityId)
                        : getPracticeById(entityId);
        if (!entity) return;
        entity.noteId = noteId || null;
        entity.updatedAt = nowIso();
        if (typeof persistAppData === 'function') persistAppData();
        if (activeView === 'apstudy') renderApStudyWorkspace();
    }

    function createLinkedNote(entityType, entityId) {
        const desiredTitle = buildEntityNoteTitle(entityType, entityId);
        let page = (Array.isArray(pages) ? pages : []).find(item => item && item.title === desiredTitle) || null;
        if (!page && typeof createImportedPage === 'function') {
            page = createImportedPage(desiredTitle, buildEntityNoteContent(entityType, entityId), '🧠');
        }
        if (!page) return;
        assignEntityNoteId(entityType, entityId, page.id);
        openLinkedNote(page.id);
    }

    function createActivityFromSessionCompletion(session, completed) {
        const subject = getSubjectById(session.subjectId);
        const subjectName = subject ? subject.name : 'AP subject';
        if (completed) {
            pushActivity('session_complete', `Completed ${subjectName} session: ${getSessionDisplayTitle(session)}`, session.subjectId);
            return;
        }
        pushActivity('session_reopen', `Reopened ${subjectName} session: ${getSessionDisplayTitle(session)}`, session.subjectId);
    }

    function applySessionCompletionEffects(session, completedAt) {
        const stamp = completedAt || nowIso();
        if (session.topicId) {
            const topic = getTopicById(session.topicId);
            if (topic) {
                topic.lastReviewedAt = stamp;
                if (topic.status === 'not_started' || topic.status === 'in_progress' || topic.status === 'needs_review') {
                    topic.status = 'reviewed';
                }
                topic.updatedAt = stamp;
            }
        }
        if (session.unitId) {
            const unit = getUnitById(session.unitId);
            if (unit) {
                unit.lastReviewedAt = stamp;
                if (unit.status === 'not_started' || unit.status === 'in_progress' || unit.status === 'needs_review') {
                    unit.status = 'reviewed';
                }
                unit.updatedAt = stamp;
            }
        }
    }

    function applyPracticeEffects(log) {
        const stamp = nowIso();
        const percent = getPracticePercent(log);
        const weak = !!log.markedWeak || (percent != null && percent < 70) || log.confidenceAfter <= 2;
        const strong = !weak && percent != null && percent >= 90 && log.confidenceAfter >= 4;

        if (log.topicId) {
            const topic = getTopicById(log.topicId);
            if (topic) {
                topic.lastReviewedAt = stamp;
                topic.updatedAt = stamp;
                if (weak) {
                    topic.weakFlag = true;
                    topic.status = 'needs_review';
                } else if (strong && topic.status !== 'mastered') {
                    topic.status = 'reviewed';
                    if (!topic.weakFlag) topic.confidenceLevel = Math.max(topic.confidenceLevel, log.confidenceAfter);
                }
            }
        }

        if (log.unitId) {
            const unit = getUnitById(log.unitId);
            if (unit) {
                unit.lastReviewedAt = stamp;
                unit.updatedAt = stamp;
                if (weak) {
                    unit.weakFlag = true;
                    if (unit.status !== 'mastered') unit.status = 'needs_review';
                } else if (strong && unit.status !== 'mastered') {
                    unit.status = 'reviewed';
                }
            }
        }
    }

    function handleApStudyTaskCompletion(task, done) {
        if (!task || task.origin !== 'ap_study') return;
        const sessionId = normalizeText(task.apStudySessionId) || String(task.id || '').replace(TASK_PREFIX, '');
        const session = getSessionById(sessionId);
        if (!session) return;
        session.status = done ? 'completed' : 'scheduled';
        session.completedAt = done ? nowIso() : null;
        session.updatedAt = nowIso();
        if (done) applySessionCompletionEffects(session, session.completedAt);
        createActivityFromSessionCompletion(session, done);
        if (activeView === 'apstudy') renderApStudyWorkspace();
        syncApStudySessionsIntoTaskStore({ persist: true });
        if (activeView === 'timeline' && typeof renderTimeline === 'function') renderTimeline();
        if (typeof renderTodayStudentHub === 'function') renderTodayStudentHub(typeof today === 'function' ? today() : '');
    }

    function deleteApStudyTaskInStore(task) {
        if (!task || task.origin !== 'ap_study') return;
        const sessionId = normalizeText(task.apStudySessionId) || String(task.id || '').replace(TASK_PREFIX, '');
        const session = getSessionById(sessionId);
        if (!session) return;
        apStudyWorkspace.sessions = apStudyWorkspace.sessions.filter(item => item.id !== session.id);
        pushActivity('session_delete', `Removed session: ${getSessionDisplayTitle(session)}`, session.subjectId);
        syncApStudySessionsIntoTaskStore({ persist: true });
        if (activeView === 'apstudy') renderApStudyWorkspace();
        if (activeView === 'timeline' && typeof renderTimeline === 'function') renderTimeline();
        if (typeof renderTodayStudentHub === 'function') renderTodayStudentHub(typeof today === 'function' ? today() : '');
    }

    function openApStudyForSubject(subjectId, section = null) {
        ensureApStudyViewEnabled();
        setActiveSubject(subjectId);
        if (section) setActiveSection(section);
        if (typeof setActiveView === 'function') setActiveView('apstudy');
    }

    function openApStudyFromTask(taskId) {
        const task = (Array.isArray(tasks) ? tasks : []).find(item => item && item.id === taskId && item.origin === 'ap_study');
        if (!task) return false;
        const sessionId = normalizeText(task.apStudySessionId) || String(task.id || '').replace(TASK_PREFIX, '');
        const session = getSessionById(sessionId);
        if (!session) return false;
        openApStudyForSubject(session.subjectId, 'sessions');
        return true;
    }

    function handleApStudyTaskOpen(taskId) {
        return openApStudyFromTask(taskId);
    }

    function handleApStudyBlockOpen(block) {
        if (!block || (block.source !== 'ap_study_session' && block.source !== 'ap_study_exam')) return false;
        if (block.source === 'ap_study_session') {
            const sessionId = normalizeText(block.apStudySessionId) || String(block.autoSourceKey || '').replace(SESSION_AUTO_KEY_PREFIX, '');
            const session = getSessionById(sessionId);
            if (!session) return false;
            openApStudyForSubject(session.subjectId, 'sessions');
            return true;
        }
        const subjectId = normalizeText(block.apStudySubjectId) || String(block.autoSourceKey || '').replace(EXAM_AUTO_KEY_PREFIX, '');
        if (!subjectId) return false;
        openApStudyForSubject(subjectId, 'overview');
        return true;
    }

    function getHomeworkCourseOptions() {
        const options = [];
        if (typeof readLocalArraySafe === 'function') {
            readLocalArraySafe('hwCourses:v2').forEach(course => {
                options.push({
                    key: `v2:${course.id}`,
                    source: 'v2',
                    id: String(course.id),
                    name: normalizeText(course.name) || 'Homework subject'
                });
            });
            readLocalArraySafe('homeworkCourses:v1').forEach(course => {
                options.push({
                    key: `v1:${course.id}`,
                    source: 'v1',
                    id: String(course.id),
                    name: normalizeText(course.name || course.subject) || 'Homework subject'
                });
            });
        }
        return options.sort((left, right) => left.name.localeCompare(right.name));
    }

    function getHomeworkItemsForSubject(subject) {
        if (!subject || !subject.homeworkCourseId || !subject.homeworkCourseSource || typeof readLocalArraySafe !== 'function') return [];
        if (subject.homeworkCourseSource === 'v2') {
            return readLocalArraySafe('hwTasks:v2')
                .filter(item => String(item && item.courseId) === String(subject.homeworkCourseId))
                .map(item => {
                    const dueParts = typeof getHomeworkDueParts === 'function' ? getHomeworkDueParts(item) : { dueDate: item.dueDate || '' };
                    return {
                        id: String(item.id),
                        title: normalizeText(item.text || item.task || item.title),
                        dueDate: dueParts.dueDate || '',
                        done: !!item.done
                    };
                });
        }
        return readLocalArraySafe('homeworkTasks:v1')
            .filter(item => String(item && item.courseId) === String(subject.homeworkCourseId))
            .map(item => {
                const dueParts = typeof getHomeworkDueParts === 'function' ? getHomeworkDueParts(item) : { dueDate: item.dueDate || '' };
                return {
                    id: String(item.id),
                    title: normalizeText(item.task || item.title || item.text),
                    dueDate: dueParts.dueDate || '',
                    done: !!item.done || !!item.completed
                };
            });
    }

    function buildSubjectHeader(subject) {
        const progress = calculateSubjectProgress(subject);
        const units = getUnitsForSubject(subject.id);
        const unitTargetCount = getSubjectUnitTargetCount(subject);
        const weakCount = countSubjectWeakItems(subject.id);
        const openHomework = getHomeworkItemsForSubject(subject).filter(item => !item.done).length;
        const noteTitle = getNoteTitleById(subject.noteId);
        return `
            <section class="glass-card ap-study-subject-hero" style="--ap-subject-color:${escapeHtml(subject.color)};">
                <div class="ap-study-subject-hero-main">
                    <div class="ap-study-kicker">AP Workspace</div>
                    <div class="ap-study-subject-title-row">
                        <h2>${escapeHtml(subject.name)}</h2>
                    </div>
                    <p class="ap-study-subject-description">${escapeHtml(subject.description || 'Track units, practice, and review pressure in one exam-prep workspace.')}</p>
                    <div class="ap-study-subject-tags">
                        <span class="ap-study-tag"><i class="fas fa-bullseye"></i> Target ${escapeHtml(String(subject.targetScore))}</span>
                        <span class="ap-study-tag"><i class="fas fa-signal"></i> Confidence ${escapeHtml(String(subject.confidenceLevel))}/5</span>
                        ${subject.teacherName ? `<span class="ap-study-tag"><i class="fas fa-user"></i> ${escapeHtml(subject.teacherName)}</span>` : ''}
                        ${subject.currentUnit ? `<span class="ap-study-tag"><i class="fas fa-layer-group"></i> In Class: ${escapeHtml(subject.currentUnit)}</span>` : ''}
                        ${openHomework > 0 ? `<span class="ap-study-tag"><i class="fas fa-book"></i> ${escapeHtml(String(openHomework))} homework items</span>` : ''}
                        ${noteTitle ? `<span class="ap-study-tag"><i class="fas fa-note-sticky"></i> ${escapeHtml(noteTitle.split('::').pop())}</span>` : ''}
                    </div>
                </div>
                <div class="ap-study-subject-hero-metrics">
                    <div class="ap-study-hero-metric ap-study-hero-countdown">
                        <span>Exam Countdown</span>
                        ${buildApExamCountdownMarkup(subject, { compact: false })}
                    </div>
                    <div class="ap-study-hero-metric">
                        <span>Coverage</span>
                        <strong>${progress}%</strong>
                        <small>${escapeHtml(String(units.length))} of ${escapeHtml(String(unitTargetCount || units.length || 0))} units mapped</small>
                    </div>
                    <div class="ap-study-hero-metric">
                        <span>Weak Areas</span>
                        <strong>${weakCount}</strong>
                        <small>${escapeHtml(String(getRemainingReviewCount(subject.id)))} review items remaining</small>
                    </div>
                    <div class="ap-study-hero-actions">
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="subject" data-ap-id="${escapeHtml(subject.id)}"><i class="fas fa-pen"></i> Edit Subject</button>
                        <button class="neumo-btn" type="button" data-ap-action="create-note" data-ap-entity="subject" data-ap-id="${escapeHtml(subject.id)}"><i class="fas fa-note-sticky"></i> ${subject.noteId ? 'Replace Note Link' : 'Create Note'}</button>
                        ${subject.noteId ? `<button class="neumo-btn" type="button" data-ap-action="open-note" data-ap-note-id="${escapeHtml(subject.noteId)}"><i class="fas fa-arrow-up-right-from-square"></i> Open Note</button>` : ''}
                        <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="subject" data-ap-id="${escapeHtml(subject.id)}"><i class="fas fa-trash"></i> Delete AP</button>
                    </div>
                </div>
            </section>
        `;
    }

    function buildGlobalSummaryCards() {
        const subjects = ensureWorkspace().subjects;
        const overallProgress = subjects.length
            ? Math.round(subjects.reduce((sum, subject) => sum + calculateSubjectProgress(subject), 0) / subjects.length)
            : 0;
        const upcomingSessions = getUpcomingSessions(99).length;
        const weakAreas = getWeakAreaItems().length;
        const minutes14d = getRecentStudyMinutes(14);
        const streak = getStudyStreak();
        const nextExam = getNextExamSubject(subjects);
        const nextExamLabel = nextExam
            ? `<span class="ap-study-inline-countdown"><strong>${escapeHtml(nextExam.name)}</strong>${buildApExamCountdownMarkup(nextExam, { compact: true })}</span>`
            : 'Set your exam dates to unlock countdowns';
        return `
            <section class="ap-study-summary-grid">
                <article class="glass-card ap-study-stat-card">
                    <span class="ap-study-stat-label">AP Portfolio</span>
                    <strong class="ap-study-stat-value">${escapeHtml(String(subjects.length))}</strong>
                    <span class="ap-study-stat-note">${nextExamLabel}</span>
                </article>
                <article class="glass-card ap-study-stat-card">
                    <span class="ap-study-stat-label">Coverage</span>
                    <strong class="ap-study-stat-value">${overallProgress}%</strong>
                    <span class="ap-study-stat-note">Average review completion across all APs</span>
                </article>
                <article class="glass-card ap-study-stat-card">
                    <span class="ap-study-stat-label">Upcoming Sessions</span>
                    <strong class="ap-study-stat-value">${escapeHtml(String(upcomingSessions))}</strong>
                    <span class="ap-study-stat-note">Scheduled AP blocks still ahead</span>
                </article>
                <article class="glass-card ap-study-stat-card">
                    <span class="ap-study-stat-label">Weak Areas</span>
                    <strong class="ap-study-stat-value">${escapeHtml(String(weakAreas))}</strong>
                    <span class="ap-study-stat-note">${escapeHtml(String(streak))}-day study streak - ${escapeHtml(String(minutes14d))} min in 14d</span>
                </article>
            </section>
        `;
    }

    function buildSubjectSidebar(subjects, activeSubjectId) {
        if (!subjects.length) {
            return `
                <aside class="glass-card ap-study-sidebar">
                    <div class="ap-study-sidebar-head">
                        <div>
                            <div class="ap-study-kicker">AP Dashboard</div>
                            <h3>Exam Portfolio</h3>
                        </div>
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="subject"><i class="fas fa-plus"></i> Add AP</button>
                    </div>
                    <div class="ap-study-empty-state">
                        <strong>No AP subjects yet</strong>
                        <p>Add your first AP course to start tracking units, practice, and study blocks.</p>
                        <button class="neumo-btn btn-primary ap-study-empty-cta" type="button" data-ap-action="open-modal" data-ap-entity="subject">
                            <i class="fas fa-plus"></i> Add Your First AP
                        </button>
                        <span class="ap-study-empty-hint">Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> while on this view.</span>
                    </div>
                </aside>
            `;
        }

        return `
            <aside class="glass-card ap-study-sidebar">
                <div class="ap-study-sidebar-head">
                    <div>
                        <div class="ap-study-kicker">AP Dashboard</div>
                        <h3>Exam Portfolio</h3>
                    </div>
                    <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="subject"><i class="fas fa-plus"></i> Add AP</button>
                </div>
                <div class="ap-study-subject-list">
                    ${subjects.map(subject => {
                        const progress = calculateSubjectProgress(subject);
                        const activeClass = subject.id === activeSubjectId ? ' is-active' : '';
                        const unitTargetCount = getSubjectUnitTargetCount(subject);
                        const days = getDaysUntilExam(subject);
                        const isPast = Number.isFinite(days) && days < 0;
                        const pastClass = isPast ? ' is-past' : '';
                        const urgency = formatUrgency(days);
                        const ring = buildCountdownRing(days, { size: 52, stroke: 4 });
                        const readiness = normalizeReadiness(subject.readiness);
                        return `
                            <button class="ap-study-subject-card${activeClass}${pastClass}" type="button" data-ap-action="select-subject" data-ap-subject-id="${escapeHtml(subject.id)}" style="--ap-subject-color:${escapeHtml(subject.color)};">
                                <div class="ap-study-subject-card-top">
                                    <div class="ap-study-subject-card-title">
                                        <strong>${escapeHtml(subject.name)}</strong>
                                        <span class="ap-study-urgency-pill ap-study-urgency-pill--${urgency.tone}">${escapeHtml(urgency.label)}</span>
                                    </div>
                                    ${ring}
                                </div>
                                <div class="ap-study-progress-track"><span style="width:${progress}%"></span></div>
                                <div class="ap-study-subject-card-meta">
                                    <span>${progress}% reviewed</span>
                                    <span>${readiness}% ready</span>
                                    <span>${escapeHtml(String(countSubjectWeakItems(subject.id)))} weak</span>
                                    <span>${escapeHtml(String(getUnitsForSubject(subject.id).length))}/${escapeHtml(String(unitTargetCount || 0))} units mapped</span>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
            </aside>
        `;
    }

    function buildReadinessAndTasks(subject) {
        const readiness = normalizeReadiness(subject.readiness);
        const tasks = Array.isArray(subject.quickTasks) ? subject.quickTasks : [];
        const doneCount = tasks.filter(task => task && task.done).length;
        return `
            <div class="ap-study-two-column ap-study-readiness-row">
                <div class="ap-study-nested-panel ap-study-readiness-panel">
                    <div class="ap-study-nested-head">
                        <h4>Readiness</h4>
                        <span class="ap-study-readiness-value" data-ap-readiness-display="${escapeHtml(subject.id)}">${readiness}%</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value="${readiness}"
                        class="ap-study-readiness-slider"
                        data-ap-readiness-input="${escapeHtml(subject.id)}"
                        aria-label="Exam readiness for ${escapeHtml(subject.name)}" />
                    ${(() => {
                        const sug = computeSuggestedReadiness(subject);
                        if (!sug || !sug.hasSignal) return '<p class="ap-study-readiness-hint">Self-rated confidence going into the exam. Updates live.</p>';
                        const b = sug.basis;
                        const parts = [`${b.progress}% reviewed`];
                        if (b.practiceAvg !== null) parts.push(`${b.practiceAvg}% practice`);
                        if (b.weak) parts.push(`${b.weak} weak`);
                        const same = sug.score === readiness;
                        return `<div class="ap-study-readiness-suggest">
                            <span class="ap-study-readiness-suggest-val" title="${escapeHtml(parts.join(' · '))}">Suggested: <strong>${sug.score}%</strong></span>
                            ${same ? '' : `<button type="button" class="ap-study-link-btn" data-ap-action="use-suggested-readiness" data-ap-subject-id="${escapeHtml(subject.id)}" data-ap-readiness-value="${sug.score}">Use ${sug.score}%</button>`}
                        </div>
                        <p class="ap-study-readiness-hint">Computed from review progress, recent practice, confidence, and weak areas (${escapeHtml(parts.join(' · '))}). The slider stays yours to override.</p>`;
                    })()}
                </div>
                <div class="ap-study-nested-panel ap-study-quick-tasks-panel">
                    <div class="ap-study-nested-head">
                        <h4>Quick prep tasks</h4>
                        <span>${doneCount}/${tasks.length} done</span>
                    </div>
                    ${tasks.length ? `
                        <ul class="ap-study-quick-tasks">
                            ${tasks.map(task => `
                                <li class="ap-study-quick-tasks__item${task.done ? ' is-done' : ''}">
                                    <label>
                                        <input type="checkbox" ${task.done ? 'checked' : ''}
                                            data-ap-quick-task-toggle
                                            data-ap-subject-id="${escapeHtml(subject.id)}"
                                            data-ap-task-id="${escapeHtml(task.id)}" />
                                        <span>${escapeHtml(task.text)}</span>
                                    </label>
                                    <button type="button" class="ap-study-link-btn ap-study-quick-tasks__remove"
                                        data-ap-action="remove-quick-task"
                                        data-ap-subject-id="${escapeHtml(subject.id)}"
                                        data-ap-task-id="${escapeHtml(task.id)}"
                                        aria-label="Remove task">
                                        <i class="fas fa-xmark"></i>
                                    </button>
                                </li>
                            `).join('')}
                        </ul>
                    ` : '<div class="ap-study-empty-inline">No quick tasks. Add one below.</div>'}
                    <form class="ap-study-quick-tasks__form"
                        data-ap-quick-task-form
                        data-ap-subject-id="${escapeHtml(subject.id)}">
                        <input type="text" name="text"
                            placeholder="Add a prep task..."
                            class="ap-study-quick-tasks__input modal-input" />
                        <button type="submit" class="neumo-btn" aria-label="Add task">
                            <i class="fas fa-plus"></i>
                        </button>
                    </form>
                </div>
            </div>
        `;
    }

    function buildOverviewPanel(subject) {
        const units = getUnitsForSubject(subject.id);
        const unitTargetCount = getSubjectUnitTargetCount(subject);
        const missingUnits = Math.max(0, unitTargetCount - units.length);
        const weakItems = getWeakAreaItems(subject.id).slice(0, 5);
        const upcomingSessions = getUpcomingSessions(4, subject.id);
        const activity = getRecentActivity(6, subject.id);
        const incompleteUnits = units.filter(unit => calculateUnitProgress(unit) < 100);
        const homeworkItems = getHomeworkItemsForSubject(subject).filter(item => !item.done).slice(0, 4);
        return `
            <section class="glass-card ap-study-panel">
                <div class="ap-study-panel-head">
                    <div>
                        <div class="ap-study-kicker">Overview</div>
                        <h3>Readiness snapshot</h3>
                    </div>
                    <div class="ap-study-inline-actions">
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="session" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-calendar-plus"></i> Plan Session</button>
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="practice" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-chart-line"></i> Log Practice</button>
                    </div>
                </div>
                <div class="ap-study-mini-metrics">
                    <article class="ap-study-mini-metric">
                        <span>Remaining Review</span>
                        <strong>${escapeHtml(String(getRemainingReviewCount(subject.id)))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Mastered Items</span>
                        <strong>${escapeHtml(String(countSubjectMasteredItems(subject.id)))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Study Streak</span>
                        <strong>${escapeHtml(String(getStudyStreak(subject.id)))}d</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Time (14d)</span>
                        <strong>${escapeHtml(String(getRecentStudyMinutes(14, subject.id)))}m</strong>
                    </article>
                </div>
                ${buildReadinessAndTasks(subject)}
                <div class="ap-study-two-column">
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Still to review</h4>
                            <span>${escapeHtml(String(countSubjectIncompleteUnits(subject.id)))} units</span>
                        </div>
                        ${incompleteUnits.length ? `
                            <div class="ap-study-checklist">
                                ${incompleteUnits.map(unit => `
                                    <div class="ap-study-checklist-row">
                                        <div>
                                            <strong>${escapeHtml(unit.title)}</strong>
                                            <span>${escapeHtml(getStatusLabel(unit.status))}</span>
                                        </div>
                                        <div class="ap-study-checklist-progress">${escapeHtml(String(calculateUnitProgress(unit)))}%</div>
                                    </div>
                                `).join('')}
                                ${missingUnits > 0 ? `
                                    <div class="ap-study-checklist-row">
                                        <div>
                                            <strong>${escapeHtml(String(missingUnits))} units not added yet</strong>
                                            <span>Add the remaining units to make coverage tracking exact</span>
                                        </div>
                                        <div class="ap-study-checklist-progress">0%</div>
                                    </div>
                                ` : ''}
                            </div>
                        ` : (missingUnits > 0
                            ? `<div class="ap-study-empty-inline">${escapeHtml(String(missingUnits))} units still have not been added to this AP workspace.</div>`
                            : '<div class="ap-study-empty-inline">Every tracked unit is fully reviewed or mastered.</div>')}
                    </div>
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Weak area queue</h4>
                            <span>${escapeHtml(String(weakItems.length))} priority items</span>
                        </div>
                        ${weakItems.length ? `
                            <div class="ap-study-weak-list">
                                ${weakItems.map(item => `
                                    <div class="ap-study-weak-item">
                                        <div>
                                            <strong>${escapeHtml(item.title)}</strong>
                                            <span>${escapeHtml(item.subtitle)}</span>
                                        </div>
                                        <button class="ap-study-link-btn" type="button" data-ap-action="schedule-weak-review" data-ap-subject-id="${escapeHtml(item.subjectId)}" data-ap-unit-id="${escapeHtml(item.unitId || '')}" data-ap-topic-id="${escapeHtml(item.topicId || '')}">Schedule</button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="ap-study-empty-inline">No weak areas flagged right now.</div>'}
                    </div>
                </div>
                <div class="ap-study-two-column">
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Upcoming sessions</h4>
                            <span>${escapeHtml(String(upcomingSessions.length))}</span>
                        </div>
                        ${upcomingSessions.length ? `
                            <div class="ap-study-list">
                                ${upcomingSessions.map(session => `
                                    <div class="ap-study-list-row">
                                        <div>
                                            <strong>${escapeHtml(getSessionDisplayTitle(session))}</strong>
                                            <span>${escapeHtml(formatDateTimeLabel(session.date, session.time))}</span>
                                        </div>
                                        <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="session" data-ap-id="${escapeHtml(session.id)}">Edit</button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="ap-study-empty-inline">No study blocks scheduled for this AP yet.</div>'}
                    </div>
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Homework bridge</h4>
                            <span>${escapeHtml(subject.homeworkCourseName || 'Not linked')}</span>
                        </div>
                        ${subject.homeworkCourseId ? `
                            <div class="ap-study-inline-actions">
                                <button class="ap-study-link-btn" type="button" data-ap-action="open-class-dashboard" data-ap-course-id="${escapeHtml(subject.homeworkCourseId)}">Open class dashboard</button>
                            </div>
                        ` : ''}
                        ${homeworkItems.length ? `
                            <div class="ap-study-list">
                                ${homeworkItems.map(item => `
                                    <div class="ap-study-list-row">
                                        <div>
                                            <strong>${escapeHtml(item.title)}</strong>
                                            <span>${escapeHtml(item.dueDate ? `Due ${item.dueDate}` : 'No due date')}</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `<div class="ap-study-empty-inline">${subject.homeworkCourseName ? 'No open homework items for the linked course.' : 'Link a homework course from Edit Subject to surface current assignments here.'}</div>`}
                    </div>
                </div>
                <div class="ap-study-nested-panel">
                    <div class="ap-study-nested-head">
                        <h4>Recent AP activity</h4>
                        <span>${escapeHtml(String(activity.length))} updates</span>
                    </div>
                    ${activity.length ? `
                        <div class="ap-study-activity-list">
                            ${activity.map(item => `
                                <div class="ap-study-activity-item">
                                    <strong>${escapeHtml(item.message)}</strong>
                                    <span>${escapeHtml(formatDateLabel(String(item.createdAt || '').slice(0, 10), { fallback: 'Recently' }))}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="ap-study-empty-inline">Your AP activity feed will appear here as you study.</div>'}
                </div>
            </section>
        `;
    }

    function buildUnitsPanel(subject) {
        const units = getUnitsForSubject(subject.id);
        const unassignedTopics = getTopicsForUnit(null).filter(topic => topic.subjectId === subject.id);
        return `
            <section class="glass-card ap-study-panel">
                <div class="ap-study-panel-head">
                    <div>
                        <div class="ap-study-kicker">Units & Topics</div>
                        <h3>Coverage map</h3>
                    </div>
                    <div class="ap-study-inline-actions">
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="unit" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-plus"></i> Add Unit</button>
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="topic" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-plus"></i> Add Topic</button>
                    </div>
                </div>
                ${units.length ? `
                    <div class="ap-study-unit-list">
                        ${units.map(unit => {
                            const topics = getTopicsForUnit(unit.id);
                            const noteTitle = getNoteTitleById(unit.noteId);
                            return `
                                <article class="ap-study-unit-card">
                                    <div class="ap-study-unit-head">
                                        <div>
                                            <strong>${escapeHtml(unit.title)}</strong>
                                            <span>${escapeHtml(String(calculateUnitProgress(unit)))}% complete • ${topics.length} topics</span>
                                        </div>
                                        <div class="ap-study-inline-actions">
                                            <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="topic" data-ap-subject-id="${escapeHtml(subject.id)}" data-ap-unit-id="${escapeHtml(unit.id)}"><i class="fas fa-plus"></i> Topic</button>
                                            <button class="ap-study-link-btn" type="button" data-ap-action="generate-cards" data-ap-unit-id="${escapeHtml(unit.id)}" title="Build review cards from this unit's notes and topics"><i class="fas fa-layer-group"></i> Cards</button>
                                            <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="unit" data-ap-id="${escapeHtml(unit.id)}"><i class="fas fa-pen"></i> Edit</button>
                                            <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="unit" data-ap-id="${escapeHtml(unit.id)}">Delete</button>
                                        </div>
                                    </div>
                                    <div class="ap-study-unit-controls">
                                        <label>
                                            <span>Status</span>
                                            <select class="modal-input" data-ap-field="status" data-ap-entity-type="unit" data-ap-entity-id="${escapeHtml(unit.id)}">
                                                ${AP_STATUSES.map(status => `<option value="${escapeHtml(status)}"${status === unit.status ? ' selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                                            </select>
                                        </label>
                                        <label>
                                            <span>Confidence</span>
                                            <select class="modal-input" data-ap-field="confidenceLevel" data-ap-entity-type="unit" data-ap-entity-id="${escapeHtml(unit.id)}">
                                                ${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === unit.confidenceLevel ? ' selected' : ''}>${value}/5</option>`).join('')}
                                            </select>
                                        </label>
                                        <label class="ap-study-toggle-row">
                                            <input type="checkbox" data-ap-field="weakFlag" data-ap-entity-type="unit" data-ap-entity-id="${escapeHtml(unit.id)}"${unit.weakFlag ? ' checked' : ''}>
                                            <span>Flag weak</span>
                                        </label>
                                        <div class="ap-study-note-pill">
                                            ${noteTitle ? `<button class="ap-study-link-btn" type="button" data-ap-action="open-note" data-ap-note-id="${escapeHtml(unit.noteId)}"><i class="fas fa-note-sticky"></i> ${escapeHtml(noteTitle.split('::').pop())}</button>` : `<button class="ap-study-link-btn" type="button" data-ap-action="create-note" data-ap-entity="unit" data-ap-id="${escapeHtml(unit.id)}"><i class="fas fa-note-sticky"></i> Create note</button>`}
                                        </div>
                                    </div>
                                    <div class="ap-study-progress-track"><span style="width:${calculateUnitProgress(unit)}%"></span></div>
                                    ${topics.length ? `
                                        <div class="ap-study-topic-table">
                                            <div class="ap-study-topic-table-head">
                                                <span>Topic</span>
                                                <span>Status</span>
                                                <span>Confidence</span>
                                                <span>Weak</span>
                                                <span>Note</span>
                                                <span>Actions</span>
                                            </div>
                                            ${topics.map(topic => {
                                                const topicNoteTitle = getNoteTitleById(topic.noteId);
                                                return `
                                                    <div class="ap-study-topic-row">
                                                        <div class="ap-study-topic-title">
                                                            <strong>${escapeHtml(topic.title)}</strong>
                                                            <span>${escapeHtml(topic.lastReviewedAt ? `Last reviewed ${String(topic.lastReviewedAt).slice(0, 10)}` : 'Not reviewed yet')}</span>
                                                        </div>
                                                        <select class="modal-input" data-ap-field="status" data-ap-entity-type="topic" data-ap-entity-id="${escapeHtml(topic.id)}">
                                                            ${AP_STATUSES.map(status => `<option value="${escapeHtml(status)}"${status === topic.status ? ' selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                                                        </select>
                                                        <select class="modal-input" data-ap-field="confidenceLevel" data-ap-entity-type="topic" data-ap-entity-id="${escapeHtml(topic.id)}">
                                                            ${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === topic.confidenceLevel ? ' selected' : ''}>${value}/5</option>`).join('')}
                                                        </select>
                                                        <label class="ap-study-checkbox-inline">
                                                            <input type="checkbox" data-ap-field="weakFlag" data-ap-entity-type="topic" data-ap-entity-id="${escapeHtml(topic.id)}"${topic.weakFlag ? ' checked' : ''}>
                                                            <span>${topic.weakFlag ? 'Yes' : 'No'}</span>
                                                        </label>
                                                        <div>
                                                            ${topicNoteTitle ? `<button class="ap-study-link-btn" type="button" data-ap-action="open-note" data-ap-note-id="${escapeHtml(topic.noteId)}">${escapeHtml(topicNoteTitle.split('::').pop())}</button>` : `<button class="ap-study-link-btn" type="button" data-ap-action="create-note" data-ap-entity="topic" data-ap-id="${escapeHtml(topic.id)}">Create</button>`}
                                                        </div>
                                                        <div class="ap-study-inline-actions">
                                                            <button class="ap-study-link-btn" type="button" data-ap-action="schedule-weak-review" data-ap-subject-id="${escapeHtml(subject.id)}" data-ap-unit-id="${escapeHtml(unit.id)}" data-ap-topic-id="${escapeHtml(topic.id)}">Review</button>
                                                            <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="topic" data-ap-id="${escapeHtml(topic.id)}">Edit</button>
                                                            <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="topic" data-ap-id="${escapeHtml(topic.id)}">Delete</button>
                                                        </div>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    ` : '<div class="ap-study-empty-inline">No topics added yet. Break this unit into topics or subtopics to make review tracking sharper.</div>'}
                                </article>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="ap-study-empty-state compact"><strong>No units yet</strong><p>Add the unit structure for this AP to turn the workspace into a full review map.</p></div>'}
                ${unassignedTopics.length ? `
                    <div class="ap-study-nested-panel" data-ap-unassigned-topics="${escapeHtml(subject.id)}">
                        <div class="ap-study-nested-head"><h4>Unassigned topics</h4><span>${unassignedTopics.length} topic${unassignedTopics.length === 1 ? '' : 's'}</span></div>
                        <div class="ap-study-activity-list">
                            ${unassignedTopics.map(topic => `
                                <div class="ap-study-activity-item">
                                    <strong>${escapeHtml(topic.title)}</strong>
                                    <span>${escapeHtml(getStatusLabel(topic.status))} · confidence ${escapeHtml(String(topic.confidenceLevel))}/5</span>
                                    <div class="ap-study-inline-actions">
                                        <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="topic" data-ap-id="${escapeHtml(topic.id)}">Edit</button>
                                        <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="topic" data-ap-id="${escapeHtml(topic.id)}">Delete</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </section>
        `;
    }

    function buildSessionsPanel(subject) {
        const sessions = getSessionsForSubject(subject.id);
        const upcoming = sessions.filter(session => session.status === 'scheduled').sort((left, right) => `${left.date || ''} ${left.time || ''}`.localeCompare(`${right.date || ''} ${right.time || ''}`));
        const completed = sessions.filter(session => session.status === 'completed');
        return `
            <section class="glass-card ap-study-panel">
                <div class="ap-study-panel-head">
                    <div>
                        <div class="ap-study-kicker">Study Planner</div>
                        <h3>Planned review blocks</h3>
                    </div>
                    <div class="ap-study-inline-actions">
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="session" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-calendar-plus"></i> Add Session</button>
                        <button class="neumo-btn" type="button" data-ap-action="open-timeline"><i class="fas fa-calendar-days"></i> Open Timeline</button>
                    </div>
                </div>
                <div class="ap-study-mini-metrics">
                    <article class="ap-study-mini-metric">
                        <span>Scheduled</span>
                        <strong>${escapeHtml(String(upcoming.length))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Completed</span>
                        <strong>${escapeHtml(String(completed.length))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Next Block</span>
                        <strong>${escapeHtml(upcoming[0] ? formatDateLabel(upcoming[0].date) : 'None')}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Exam Countdown</span>
                        ${buildApExamCountdownMarkup(subject, { compact: true })}
                    </article>
                </div>
                ${sessions.length ? `
                    <div class="ap-study-session-list">
                        ${sessions.map(session => {
                            const unit = session.unitId ? getUnitById(session.unitId) : null;
                            const topic = session.topicId ? getTopicById(session.topicId) : null;
                            const typeMeta = SESSION_TYPE_META[session.sessionType];
                            const linkedNoteTitle = getNoteTitleById(session.noteId);
                            return `
                                <article class="ap-study-session-card ${session.status === 'completed' ? 'is-complete' : session.status === 'skipped' ? 'is-skipped' : ''}">
                                    <div class="ap-study-session-top">
                                        <div>
                                            <strong>${escapeHtml(getSessionDisplayTitle(session))}</strong>
                                            <span>${escapeHtml(formatDateTimeLabel(session.date, session.time))} • ${escapeHtml(String(session.durationMinutes))} min</span>
                                        </div>
                                        <span class="ap-study-session-type"><i class="fas ${escapeHtml(typeMeta.icon)}"></i> ${escapeHtml(typeMeta.label)}</span>
                                    </div>
                                    <div class="ap-study-session-meta">
                                        <span>${escapeHtml(session.priority)} priority</span>
                                        ${unit ? `<span>${escapeHtml(unit.title)}</span>` : ''}
                                        ${topic ? `<span>${escapeHtml(topic.title)}</span>` : ''}
                                        ${linkedNoteTitle ? `<span>${escapeHtml(linkedNoteTitle.split('::').pop())}</span>` : ''}
                                    </div>
                                    <div class="ap-study-session-actions">
                                        ${session.status !== 'completed' ? `<button class="ap-study-link-btn" type="button" data-ap-action="complete-session" data-ap-id="${escapeHtml(session.id)}"><i class="fas fa-check"></i> Complete</button>` : `<button class="ap-study-link-btn" type="button" data-ap-action="reopen-session" data-ap-id="${escapeHtml(session.id)}"><i class="fas fa-rotate-left"></i> Reopen</button>`}
                                        <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="session" data-ap-id="${escapeHtml(session.id)}"><i class="fas fa-pen"></i> Edit</button>
                                        ${session.noteId ? `<button class="ap-study-link-btn" type="button" data-ap-action="open-note" data-ap-note-id="${escapeHtml(session.noteId)}"><i class="fas fa-note-sticky"></i> Open Note</button>` : `<button class="ap-study-link-btn" type="button" data-ap-action="create-note" data-ap-entity="session" data-ap-id="${escapeHtml(session.id)}"><i class="fas fa-note-sticky"></i> Create Note</button>`}
                                        <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="session" data-ap-id="${escapeHtml(session.id)}"><i class="fas fa-trash"></i> Delete</button>
                                    </div>
                                </article>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="ap-study-empty-state compact"><strong>No sessions planned yet</strong><p>Create dated study blocks for units, FRQs, MCQ sets, or weak-area review so they flow into the timeline and task system.</p></div>'}
            </section>
        `;
    }

    function buildPracticePanel(subject) {
        const logs = getPracticeLogsForSubject(subject.id);
        const scoreLogs = logs.filter(log => getPracticePercent(log) != null);
        const avgPercent = scoreLogs.length
            ? Math.round(scoreLogs.reduce((sum, log) => sum + (getPracticePercent(log) || 0), 0) / scoreLogs.length)
            : 0;
        const recentWeak = logs.filter(log => log.markedWeak).length;
        return `
            <section class="glass-card ap-study-panel">
                <div class="ap-study-panel-head">
                    <div>
                        <div class="ap-study-kicker">Practice Center</div>
                        <h3>FRQs, MCQs, and mock tests</h3>
                    </div>
                    <div class="ap-study-inline-actions">
                        <button class="neumo-btn" type="button" data-ap-action="open-modal" data-ap-entity="practice" data-ap-subject-id="${escapeHtml(subject.id)}"><i class="fas fa-chart-line"></i> Log Practice</button>
                    </div>
                </div>
                <div class="ap-study-mini-metrics">
                    <article class="ap-study-mini-metric">
                        <span>Logs</span>
                        <strong>${escapeHtml(String(logs.length))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Avg Score</span>
                        <strong>${escapeHtml(String(avgPercent))}%</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Weak Flags</span>
                        <strong>${escapeHtml(String(recentWeak))}</strong>
                    </article>
                    <article class="ap-study-mini-metric">
                        <span>Minutes</span>
                        <strong>${escapeHtml(String(logs.reduce((sum, log) => sum + (Number(log.minutesSpent) || 0), 0)))}m</strong>
                    </article>
                </div>
                ${logs.length ? `
                    <div class="ap-study-practice-list">
                        ${logs.map(log => {
                            const typeMeta = PRACTICE_TYPE_META[log.type];
                            const unit = log.unitId ? getUnitById(log.unitId) : null;
                            const topic = log.topicId ? getTopicById(log.topicId) : null;
                            const percent = getPracticePercent(log);
                            const noteTitle = getNoteTitleById(log.noteId);
                            return `
                                <article class="ap-study-practice-card ${log.markedWeak ? 'is-weak' : ''}">
                                    <div class="ap-study-practice-top">
                                        <div>
                                            <strong>${escapeHtml(log.title)}</strong>
                                            <span>${escapeHtml(formatDateLabel(log.date))} • ${escapeHtml(typeMeta.label)}</span>
                                        </div>
                                        <span class="ap-study-practice-score">${percent == null ? 'No score' : `${percent}%`}</span>
                                    </div>
                                    <div class="ap-study-session-meta">
                                        ${unit ? `<span>${escapeHtml(unit.title)}</span>` : ''}
                                        ${topic ? `<span>${escapeHtml(topic.title)}</span>` : ''}
                                        <span>${escapeHtml(String(log.minutesSpent || 0))} min</span>
                                        <span>Confidence ${escapeHtml(String(log.confidenceAfter))}/5</span>
                                        ${log.markedWeak ? '<span>Flagged weak</span>' : ''}
                                        ${noteTitle ? `<span>${escapeHtml(noteTitle.split('::').pop())}</span>` : ''}
                                    </div>
                                    <div class="ap-study-session-actions">
                                        <button class="ap-study-link-btn" type="button" data-ap-action="open-modal" data-ap-entity="practice" data-ap-id="${escapeHtml(log.id)}"><i class="fas fa-pen"></i> Edit</button>
                                        ${log.noteId ? `<button class="ap-study-link-btn" type="button" data-ap-action="open-note" data-ap-note-id="${escapeHtml(log.noteId)}"><i class="fas fa-note-sticky"></i> Open Note</button>` : `<button class="ap-study-link-btn" type="button" data-ap-action="create-note" data-ap-entity="practice" data-ap-id="${escapeHtml(log.id)}"><i class="fas fa-note-sticky"></i> Create Note</button>`}
                                        ${log.markedWeak || (percent != null && percent < 70) ? `<button class="ap-study-link-btn" type="button" data-ap-action="schedule-weak-review" data-ap-subject-id="${escapeHtml(subject.id)}" data-ap-unit-id="${escapeHtml(log.unitId || '')}" data-ap-topic-id="${escapeHtml(log.topicId || '')}"><i class="fas fa-calendar-plus"></i> Revisit</button>` : ''}
                                        <button class="ap-study-link-btn danger" type="button" data-ap-action="delete-entity" data-ap-entity="practice" data-ap-id="${escapeHtml(log.id)}"><i class="fas fa-trash"></i> Delete</button>
                                    </div>
                                </article>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="ap-study-empty-state compact"><strong>No practice logs yet</strong><p>Start logging FRQs, MCQ sets, review drills, and full practice tests to surface weak spots and score trends.</p></div>'}
            </section>
        `;
    }

    function buildAnalyticsPanel(subject) {
        const units = getUnitsForSubject(subject.id);
        const practiceLogs = getPracticeLogsForSubject(subject.id);
        const weakItems = getWeakAreaItems(subject.id);
        return `
            <section class="glass-card ap-study-panel">
                <div class="ap-study-panel-head">
                    <div>
                        <div class="ap-study-kicker">Analytics</div>
                        <h3>Progress and pressure analysis</h3>
                    </div>
                </div>
                <div class="ap-study-two-column">
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Unit progress</h4>
                            <span>${escapeHtml(String(units.length))} tracked</span>
                        </div>
                        ${units.length ? `
                            <div class="ap-study-analytics-list">
                                ${units.map(unit => `
                                    <div class="ap-study-analytics-row">
                                        <div>
                                            <strong>${escapeHtml(unit.title)}</strong>
                                            <span>${escapeHtml(getStatusLabel(unit.status))}</span>
                                        </div>
                                        <div class="ap-study-analytics-score">${escapeHtml(String(calculateUnitProgress(unit)))}%</div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="ap-study-empty-inline">No units added yet.</div>'}
                    </div>
                    <div class="ap-study-nested-panel">
                        <div class="ap-study-nested-head">
                            <h4>Practice trend</h4>
                            <span>${escapeHtml(String(practiceLogs.length))} logs</span>
                        </div>
                        ${practiceLogs.length ? `
                            <div class="ap-study-analytics-list">
                                ${practiceLogs.slice(0, 6).map(log => `
                                    <div class="ap-study-analytics-row">
                                        <div>
                                            <strong>${escapeHtml(log.title)}</strong>
                                            <span>${escapeHtml(PRACTICE_TYPE_META[log.type].label)} • ${escapeHtml(formatDateLabel(log.date))}</span>
                                        </div>
                                        <div class="ap-study-analytics-score">${escapeHtml(getPracticePercent(log) == null ? '--' : `${getPracticePercent(log)}%`)}</div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="ap-study-empty-inline">Score trend unlocks as you log FRQs, MCQs, and mocks.</div>'}
                    </div>
                </div>
                <div class="ap-study-nested-panel">
                    <div class="ap-study-nested-head">
                        <h4>Priority queue</h4>
                        <span>${escapeHtml(String(weakItems.length))} items</span>
                    </div>
                    ${weakItems.length ? `
                        <div class="ap-study-priority-grid">
                            ${weakItems.map(item => `
                                <div class="ap-study-priority-card">
                                    <strong>${escapeHtml(item.title)}</strong>
                                    <span>${escapeHtml(item.subtitle)}</span>
                                    <div class="ap-study-priority-meta">
                                        <span>${escapeHtml(getStatusLabel(item.status))}</span>
                                        <span>Confidence ${escapeHtml(String(item.confidenceLevel))}/5</span>
                                    </div>
                                    <button class="ap-study-link-btn" type="button" data-ap-action="schedule-weak-review" data-ap-subject-id="${escapeHtml(item.subjectId)}" data-ap-unit-id="${escapeHtml(item.unitId || '')}" data-ap-topic-id="${escapeHtml(item.topicId || '')}">Schedule review</button>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="ap-study-empty-inline">No urgent weak areas are flagged right now.</div>'}
                </div>
            </section>
        `;
    }

    function buildRightRail(subjects, activeSubjectId) {
        const exams = subjects
            .map(subject => ({ subject, sortValue: getApExamCountdownSortValue(subject) }))
            .filter(item => item.sortValue != null)
            .sort((left, right) => left.sortValue - right.sortValue)
            .map(item => item.subject)
            .slice(0, 6);
        const upcomingSessions = getUpcomingSessions(6);
        const weakItems = getWeakAreaItems().slice(0, 6);
        return `
            <aside class="ap-study-rail">
                <section class="glass-card ap-study-sidecard">
                    <div class="ap-study-sidecard-head">
                        <h4>Exam Countdown</h4>
                        <span>${escapeHtml(String(exams.length))}</span>
                    </div>
                    ${exams.length ? exams.map(subject => `
                        <div class="ap-study-sidecard-row ${subject.id === activeSubjectId ? 'is-active' : ''}">
                            <div>
                                <strong>${escapeHtml(subject.name)}</strong>
                                <span>${escapeHtml(formatDateLabel(subject.examDate, { fallback: 'No date', localeOptions: { month: 'short', day: 'numeric' } }))}</span>
                            </div>
                            ${buildApExamCountdownMarkup(subject, { compact: true })}
                        </div>
                    `).join('') : '<div class="ap-study-empty-inline">Exam countdowns appear once AP subjects have dates.</div>'}
                </section>
                <section class="glass-card ap-study-sidecard">
                    <div class="ap-study-sidecard-head">
                        <h4>Upcoming Sessions</h4>
                        <span>${escapeHtml(String(upcomingSessions.length))}</span>
                    </div>
                    ${upcomingSessions.length ? upcomingSessions.map(session => {
                        const subject = getSubjectById(session.subjectId);
                        return `
                            <div class="ap-study-sidecard-row">
                                <div>
                                    <strong>${escapeHtml(subject ? subject.name : 'AP Study')}</strong>
                                    <span>${escapeHtml(getSessionDisplayTitle(session))}</span>
                                </div>
                                <span>${escapeHtml(formatDateLabel(session.date))}</span>
                            </div>
                        `;
                    }).join('') : '<div class="ap-study-empty-inline">No AP study blocks scheduled yet.</div>'}
                </section>
                <section class="glass-card ap-study-sidecard">
                    <div class="ap-study-sidecard-head">
                        <h4>Weak Area Radar</h4>
                        <span>${escapeHtml(String(weakItems.length))}</span>
                    </div>
                    ${weakItems.length ? weakItems.map(item => `
                        <div class="ap-study-sidecard-row">
                            <div>
                                <strong>${escapeHtml(item.title)}</strong>
                                <span>${escapeHtml(item.subtitle)}</span>
                            </div>
                            <button class="ap-study-link-btn" type="button" data-ap-action="schedule-weak-review" data-ap-subject-id="${escapeHtml(item.subjectId)}" data-ap-unit-id="${escapeHtml(item.unitId || '')}" data-ap-topic-id="${escapeHtml(item.topicId || '')}">Plan</button>
                        </div>
                    `).join('') : '<div class="ap-study-empty-inline">No weak areas are flagged.</div>'}
                </section>
            </aside>
        `;
    }

    function buildTabStrip(activeSection) {
        return `
            <div class="ap-study-tabs">
                ${AP_SECTIONS.map(section => `
                    <button class="ap-study-tab${section === activeSection ? ' is-active' : ''}" type="button" data-ap-action="select-section" data-ap-section="${escapeHtml(section)}">${escapeHtml(section.charAt(0).toUpperCase() + section.slice(1))}</button>
                `).join('')}
            </div>
        `;
    }

    function getActiveSectionMarkup(subject) {
        const section = ensureWorkspace().settings.activeSection || DEFAULT_SECTION;
        if (section === 'units') return buildUnitsPanel(subject);
        if (section === 'sessions') return buildSessionsPanel(subject);
        if (section === 'practice') return buildPracticePanel(subject);
        if (section === 'analytics') return buildAnalyticsPanel(subject);
        return buildOverviewPanel(subject);
    }

    function getSubjectsSortedByExam() {
        return ensureWorkspace().subjects.slice().sort((left, right) => {
            const leftValue = getApExamCountdownSortValue(left);
            const rightValue = getApExamCountdownSortValue(right);
            if (leftValue == null && rightValue == null) {
                return String(left.name || '').localeCompare(String(right.name || ''));
            }
            if (leftValue == null) return 1;
            if (rightValue == null) return -1;
            return leftValue - rightValue;
        });
    }

    function getApSubjectStatus(subject) {
        const days = getDaysUntilExam(subject);
        if (Number.isFinite(days) && days < 0) {
            return { key: 'passed', label: 'Exam Passed', tone: 'dim' };
        }
        const progress = calculateSubjectProgress(subject);
        const readiness = normalizeReadiness(subject.readiness);
        const weakCount = countSubjectWeakItems(subject.id);
        const units = getUnitsForSubject(subject.id);
        const upcoming = getUpcomingSessions(99, subject.id).length;
        const quickTasks = Array.isArray(subject.quickTasks) ? subject.quickTasks : [];
        const tasksDone = quickTasks.filter(task => task && task.done).length;
        const totalSignal = progress + readiness + units.length + upcoming + tasksDone;
        if (totalSignal === 0) {
            return { key: 'not_started', label: 'Not Started', tone: 'dim' };
        }
        if (Number.isFinite(days) && days <= 7 && readiness < 80) {
            return { key: 'urgent', label: 'Urgent', tone: 'danger' };
        }
        if (weakCount > 0 || readiness < 50) {
            return { key: 'needs_review', label: 'Needs Review', tone: 'warn' };
        }
        return { key: 'on_track', label: 'On Track', tone: 'accent' };
    }

    function formatExamDaysLabel(days) {
        if (!Number.isFinite(days)) return 'Set exam date';
        if (days < 0) {
            const past = Math.abs(days);
            return past === 1 ? '1 day ago' : `${past} days ago`;
        }
        if (days === 0) return 'Today';
        if (days === 1) return 'Tomorrow';
        return `${days} days left`;
    }

    function renderApSubjectCard(subject) {
        const days = getDaysUntilExam(subject);
        const isPast = Number.isFinite(days) && days < 0;
        const status = getApSubjectStatus(subject);
        const progress = calculateSubjectProgress(subject);
        const readiness = normalizeReadiness(subject.readiness);
        const weakCount = countSubjectWeakItems(subject.id);
        const upcomingSessions = getUpcomingSessions(99, subject.id).length;
        const quickTasks = Array.isArray(subject.quickTasks) ? subject.quickTasks : [];
        const tasksDone = quickTasks.filter(task => task && task.done).length;
        const examLabel = subject.examDate
            ? formatDateLabel(subject.examDate, { fallback: 'No exam date', localeOptions: { month: 'short', day: 'numeric', year: 'numeric' } })
            : 'No exam date';
        const daysLabel = formatExamDaysLabel(days);
        return `
            <button class="ap-study-class-card${isPast ? ' is-past' : ''} ap-study-class-card--${status.key}"
                    type="button"
                    data-ap-action="open-subject-detail"
                    data-ap-subject-id="${escapeHtml(subject.id)}"
                    style="--ap-subject-color:${escapeHtml(subject.color)};"
                    aria-label="Open ${escapeHtml(subject.name)} workspace">
                <div class="ap-study-class-card-head">
                    <div class="ap-study-class-card-title">
                        <strong>${escapeHtml(subject.name)}</strong>
                        <span class="ap-study-status-pill ap-study-status-pill--${status.tone}">${escapeHtml(status.label)}</span>
                    </div>
                    ${buildCountdownRing(days, { size: 56, stroke: 4 })}
                </div>
                <div class="ap-study-class-card-exam">
                    <span class="ap-study-class-card-date"><i class="fas fa-calendar"></i> ${escapeHtml(examLabel)}</span>
                    <span class="ap-study-class-card-days">${escapeHtml(daysLabel)}</span>
                </div>
                <div class="ap-study-progress-track"><span style="width:${progress}%"></span></div>
                <div class="ap-study-class-card-meta">
                    <div class="ap-study-class-card-meta-cell"><span>Readiness</span><strong>${readiness}%</strong></div>
                    <div class="ap-study-class-card-meta-cell"><span>Reviewed</span><strong>${progress}%</strong></div>
                    <div class="ap-study-class-card-meta-cell"><span>Weak</span><strong>${escapeHtml(String(weakCount))}</strong></div>
                    <div class="ap-study-class-card-meta-cell"><span>Sessions</span><strong>${escapeHtml(String(upcomingSessions))}</strong></div>
                    <div class="ap-study-class-card-meta-cell"><span>Quick tasks</span><strong>${escapeHtml(String(tasksDone))}/${escapeHtml(String(quickTasks.length))}</strong></div>
                </div>
            </button>
        `;
    }

    function renderApCountdownStrip(subjects) {
        const upcoming = subjects
            .map(subject => ({ subject, sortValue: getApExamCountdownSortValue(subject) }))
            .filter(item => item.sortValue != null)
            .sort((left, right) => left.sortValue - right.sortValue)
            .slice(0, 6);
        if (!upcoming.length) {
            return `
                <section class="glass-card ap-study-countdown-strip ap-study-countdown-strip--empty">
                    <div class="ap-study-countdown-strip-head">
                        <div class="ap-study-kicker">Exam Countdown</div>
                    </div>
                    <p class="ap-study-empty-inline">Add exam dates to your AP classes to see live countdowns here.</p>
                </section>
            `;
        }
        return `
            <section class="glass-card ap-study-countdown-strip">
                <div class="ap-study-countdown-strip-head">
                    <div class="ap-study-kicker">Exam Countdown</div>
                    <span class="ap-study-countdown-strip-meta">${escapeHtml(String(upcoming.length))} upcoming</span>
                </div>
                <div class="ap-study-countdown-strip-grid">
                    ${upcoming.map(({ subject }) => {
                        const days = getDaysUntilExam(subject);
                        const urgency = formatUrgency(days);
                        const dateLabel = formatDateLabel(subject.examDate, { fallback: 'No date', localeOptions: { month: 'short', day: 'numeric' } });
                        return `
                            <button class="ap-study-countdown-chip ap-study-countdown-chip--${urgency.tone}"
                                    type="button"
                                    data-ap-action="open-subject-detail"
                                    data-ap-subject-id="${escapeHtml(subject.id)}"
                                    style="--ap-subject-color:${escapeHtml(subject.color)};"
                                    aria-label="Open ${escapeHtml(subject.name)}">
                                <span class="ap-study-countdown-chip-name">${escapeHtml(subject.name)}</span>
                                <span class="ap-study-countdown-chip-date">${escapeHtml(dateLabel)}</span>
                                <span class="ap-study-countdown-chip-days">${escapeHtml(urgency.label)}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderApStudyHome() {
        const sortedSubjects = getSubjectsSortedByExam();
        const totalSubjects = sortedSubjects.length;
        const upcomingSessions = getUpcomingSessions(99).length;
        const weakAreas = getWeakAreaItems().length;
        const minutes14d = getRecentStudyMinutes(14);

        if (totalSubjects === 0) {
            return `
                <div class="ap-study-shell ap-study-shell--home ap-study-shell--empty">
                    <section class="glass-card ap-study-home-empty">
                        <div class="ap-study-home-empty-icon" aria-hidden="true">
                            <i class="fas fa-graduation-cap"></i>
                        </div>
                        <div class="eyebrow">AP Study</div>
                        <h2>Build your AP Classes home</h2>
                        <p>Add the first AP class you are studying for to start tracking units, sessions, practice, readiness, and exam countdowns. Each class becomes a card you can drill into.</p>
                        <div class="ap-study-inline-actions ap-study-home-empty-actions">
                            <button class="neumo-btn btn-primary" type="button" data-ap-action="open-modal" data-ap-entity="subject"><i class="fas fa-plus"></i> Add Your First AP</button>
                        </div>
                        <span class="ap-study-empty-hint">Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> and search "Add AP" to open the form fast.</span>
                    </section>
                </div>
            `;
        }

        const headerSection = `
            <header class="ap-study-home-bar">
                <div class="ap-study-home-bar-title">
                    <div class="eyebrow">AP Study</div>
                    <h2>AP Classes</h2>
                </div>
                <button class="neumo-btn btn-primary ap-study-home-bar-btn" type="button" data-ap-action="open-modal" data-ap-entity="subject"><i class="fas fa-plus"></i> Add AP Subject</button>
            </header>
        `;

        const gridSection = `
            <section class="ap-study-class-grid" aria-label="AP class cards">
                ${sortedSubjects.map(subject => renderApSubjectCard(subject)).join('')}
            </section>
        `;

        const statsStrip = renderApHomeStatsStrip({
            totalSubjects,
            upcomingSessions,
            weakAreas,
            minutes14d
        });

        const countdownStrip = renderApHomeCountdownStrip(sortedSubjects);

        return `
            <div class="ap-study-shell ap-study-shell--home ap-study-shell--populated">
                ${headerSection}
                ${statsStrip}
                ${countdownStrip}
                ${gridSection}
            </div>
        `;
    }

    function renderApHomeStatsStrip(stats) {
        const cell = (label, value) => `
            <article class="ap-study-strip-stat">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value))}</strong>
            </article>
        `;
        return `
            <section class="glass-card ap-study-home-stats-strip" aria-label="AP Study at a glance">
                ${cell('AP Classes', stats.totalSubjects)}
                ${cell('Upcoming', stats.upcomingSessions)}
                ${cell('Weak Areas', stats.weakAreas)}
                ${cell('Mins · 14d', `${stats.minutes14d}m`)}
            </section>
        `;
    }

    function renderApHomeCountdownStrip(subjects) {
        const upcomingExams = subjects
            .map(subject => ({ subject, sortValue: getApExamCountdownSortValue(subject) }))
            .filter(item => item.sortValue != null)
            .sort((left, right) => left.sortValue - right.sortValue)
            .slice(0, 8);

        if (!upcomingExams.length) {
            return `
                <section class="glass-card ap-study-home-countdown ap-study-home-countdown--empty">
                    <div class="ap-study-home-countdown-head">
                        <div class="ap-study-kicker">Exam Countdown</div>
                    </div>
                    <p class="ap-study-empty-inline">Add exam dates on your AP cards to see live countdowns.</p>
                </section>
            `;
        }

        return `
            <section class="glass-card ap-study-home-countdown" aria-label="Upcoming AP exams">
                <div class="ap-study-home-countdown-head">
                    <div class="ap-study-kicker">Exam Countdown</div>
                    <span class="ap-study-home-countdown-meta">${escapeHtml(String(upcomingExams.length))} upcoming</span>
                </div>
                <div class="ap-study-home-countdown-grid">
                    ${upcomingExams.map(({ subject }) => {
                        const days = getDaysUntilExam(subject);
                        const urgency = formatUrgency(days);
                        const dateLabel = formatDateLabel(subject.examDate, { fallback: 'No date', localeOptions: { month: 'short', day: 'numeric' } });
                        return `
                            <button class="ap-study-home-countdown-chip ap-study-home-countdown-chip--${urgency.tone}"
                                    type="button"
                                    data-ap-action="open-subject-detail"
                                    data-ap-subject-id="${escapeHtml(subject.id)}"
                                    style="--ap-subject-color:${escapeHtml(subject.color)};"
                                    aria-label="Open ${escapeHtml(subject.name)}">
                                <span class="ap-study-home-countdown-chip-text">
                                    <span class="ap-study-home-countdown-chip-name">${escapeHtml(subject.name)}</span>
                                    <span class="ap-study-home-countdown-chip-date">${escapeHtml(dateLabel)}</span>
                                </span>
                                <span class="ap-study-home-countdown-chip-live">${buildApExamCountdownMarkup(subject, { compact: true })}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderApSubjectHero(subject) {
        return buildSubjectHeader(subject);
    }

    function renderApStudyDetail(subject) {
        if (!subject) return '';
        const activeSection = ensureWorkspace().settings.activeSection || DEFAULT_SECTION;
        return `
            <div class="ap-study-shell ap-study-shell--detail">
                <div class="ap-study-detail-back">
                    <button class="ap-study-back-btn" type="button" data-ap-action="go-home" aria-label="Back to AP Classes">
                        <i class="fas fa-arrow-left"></i> All AP Classes
                    </button>
                </div>
                ${renderApSubjectHero(subject)}
                ${buildTabStrip(activeSection)}
                ${getActiveSectionMarkup(subject)}
            </div>
        `;
    }

    function renderApStudyWorkspace() {
        ensureWorkspace();
        const mount = document.getElementById('apStudyMount');
        if (!mount) return;

        const subjects = apStudyWorkspace.subjects;
        const settings = apStudyWorkspace.settings;
        let viewMode = AP_VIEW_MODES.includes(settings.viewMode) ? settings.viewMode : DEFAULT_VIEW_MODE;

        let activeSubject = null;
        if (viewMode === 'detail') {
            activeSubject = subjects.find(item => item.id === settings.activeSubjectId) || null;
            if (!activeSubject) {
                viewMode = 'home';
                settings.viewMode = 'home';
            }
        }
        if (subjects.length === 0) {
            viewMode = 'home';
            settings.viewMode = 'home';
        }

        const battlePlanCard = document.getElementById('apBattlePlanCard');
        if (battlePlanCard) {
            battlePlanCard.style.display = (viewMode === 'detail' || subjects.length === 0) ? 'none' : '';
        }

        if (viewMode === 'detail' && activeSubject) {
            mount.innerHTML = renderApStudyDetail(activeSubject);
        } else {
            mount.innerHTML = renderApStudyHome();
        }

        if (typeof refreshCustomSelects === 'function') refreshCustomSelects(mount);
        if (typeof refreshCustomDates === 'function') refreshCustomDates(mount);
        startApExamCountdownTicker();
    }

    function openApStudyModal(entityType, options = {}) {
        ensureWorkspace();
        if (entityType !== 'subject' && !apStudyWorkspace.subjects.length) {
            if (typeof showToast === 'function') showToast('Add an AP subject first');
            return;
        }
        const modal = document.getElementById('apStudyModal');
        if (!modal) return;
        // Remember what had focus so we can restore it when the modal closes.
        apStudyModalReturnFocus = document.activeElement;
        apStudyModalState = {
            entityType,
            id: options.id || null,
            subjectId: options.subjectId || null,
            unitId: options.unitId || null,
            topicId: options.topicId || null
        };
        renderApStudyModal();
        modal.classList.add('active');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        // Move focus into the modal for keyboard + screen-reader users.
        const firstField = modal.querySelector('input, select, textarea, button:not(.close-btn)');
        if (firstField && typeof firstField.focus === 'function') {
            try { firstField.focus(); } catch (e) { /* non-critical */ }
        }
    }

    function closeApStudyModal() {
        const modal = document.getElementById('apStudyModal');
        if (!modal) return;
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        apStudyModalState = null;
        // Restore focus to the control that opened the modal.
        if (apStudyModalReturnFocus && typeof apStudyModalReturnFocus.focus === 'function'
            && document.contains(apStudyModalReturnFocus)) {
            try { apStudyModalReturnFocus.focus(); } catch (e) { /* non-critical */ }
        }
        apStudyModalReturnFocus = null;
    }

    function getModalEntityRecord() {
        if (!apStudyModalState || !apStudyModalState.id) return null;
        if (apStudyModalState.entityType === 'subject') return getSubjectById(apStudyModalState.id);
        if (apStudyModalState.entityType === 'unit') return getUnitById(apStudyModalState.id);
        if (apStudyModalState.entityType === 'topic') return getTopicById(apStudyModalState.id);
        if (apStudyModalState.entityType === 'session') return getSessionById(apStudyModalState.id);
        if (apStudyModalState.entityType === 'practice') return getPracticeById(apStudyModalState.id);
        return null;
    }

    function buildNoteSelectOptions(selectedId) {
        const pagesForSelect = getPagesForSelection();
        return `
            <option value="">No linked note</option>
            ${pagesForSelect.map(page => `<option value="${escapeHtml(page.id)}"${page.id === selectedId ? ' selected' : ''}>${escapeHtml(page.title)}</option>`).join('')}
        `;
    }

    function buildHomeworkCourseOptions(selectedSource, selectedId) {
        const options = getHomeworkCourseOptions();
        const selectedKey = selectedSource && selectedId ? `${selectedSource}:${selectedId}` : '';
        return `
            <option value="">No homework link</option>
            ${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedKey ? ' selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
        `;
    }

    function buildSubjectOptions(selectedSubjectId) {
        const subjects = ensureWorkspace().subjects;
        return subjects.map(subject => `<option value="${escapeHtml(subject.id)}"${subject.id === selectedSubjectId ? ' selected' : ''}>${escapeHtml(subject.name)}</option>`).join('');
    }

    function buildUnitOptions(selectedSubjectId, selectedUnitId) {
        return `
            <option value="">No unit</option>
            ${getUnitsForSubject(selectedSubjectId).map(unit => `<option value="${escapeHtml(unit.id)}"${unit.id === selectedUnitId ? ' selected' : ''}>${escapeHtml(unit.title)}</option>`).join('')}
        `;
    }

    function buildTopicOptions(selectedUnitId, selectedTopicId) {
        return `
            <option value="">No topic</option>
            ${getTopicsForUnit(selectedUnitId).map(topic => `<option value="${escapeHtml(topic.id)}"${topic.id === selectedTopicId ? ' selected' : ''}>${escapeHtml(topic.title)}</option>`).join('')}
        `;
    }

    function getSubjectUnitCountInputValue(subject) {
        if (!subject) return '1';
        const trackedUnits = getUnitsForSubject(subject.id).length;
        const declaredUnits = normalizeNumberValue(subject.totalUnitCount, 0, 0, 99);
        return String(Math.max(1, trackedUnits, declaredUnits));
    }

    function renderApStudyModal() {
        const modal = document.getElementById('apStudyModal');
        const body = document.getElementById('apStudyModalBody');
        const title = document.getElementById('apStudyModalTitle');
        if (!modal || !body || !title || !apStudyModalState) return;

        const entity = getModalEntityRecord();
        const defaultSubjectId = apStudyModalState.subjectId || (entity && entity.subjectId) || ensureWorkspace().settings.activeSubjectId || '';

        if (apStudyModalState.entityType === 'subject') {
            title.textContent = entity ? 'Edit AP Subject' : 'Add AP Subject';
            body.innerHTML = `
                <form id="apStudyForm" class="ap-study-modal-form" data-ap-form-entity="subject">
                    <label><span>Subject name</span><input class="modal-input" name="name" value="${escapeHtml(entity ? entity.name : '')}" placeholder="AP Biology" required></label>
                    <div class="ap-study-form-grid two">
                        <label><span>Exam date</span><input class="modal-input" type="date" name="examDate" value="${escapeHtml(entity ? entity.examDate : '')}"></label>
                        <label><span>Exam time</span><input class="modal-input" type="time" name="examTime" value="${escapeHtml(entity ? entity.examTime : '')}"></label>
                    </div>
                    <div class="ap-study-form-grid two">
                        <label><span>Teacher name</span><input class="modal-input" name="teacherName" value="${escapeHtml(entity ? entity.teacherName : '')}" placeholder="Mr. Rivera"></label>
                        <label><span>Current class unit</span><input class="modal-input" name="currentUnit" value="${escapeHtml(entity ? entity.currentUnit : '')}" placeholder="Unit 6"></label>
                    </div>
                    <div class="ap-study-form-grid three">
                        <label><span>How many units are in this AP?</span><input class="modal-input" type="number" min="1" max="99" step="1" inputmode="numeric" name="totalUnitCount" value="${escapeHtml(getSubjectUnitCountInputValue(entity))}" placeholder="10" required></label>
                        <label><span>Target score</span><select class="modal-input" name="targetScore">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === (entity ? entity.targetScore : 4) ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label><span>Confidence</span><select class="modal-input" name="confidenceLevel">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === (entity ? entity.confidenceLevel : 3) ? ' selected' : ''}>${value}/5</option>`).join('')}</select></label>
                    </div>
                    <label><span>Homework link</span><select class="modal-input" name="homeworkCourseKey">${buildHomeworkCourseOptions(entity ? entity.homeworkCourseSource : '', entity ? entity.homeworkCourseId : '')}</select></label>
                    <label><span>Linked note</span><select class="modal-input" name="noteId">${buildNoteSelectOptions(entity ? entity.noteId : '')}</select></label>
                    <label><span>Description</span><textarea class="modal-input" name="description" rows="4" placeholder="What matters most for this AP?">${escapeHtml(entity ? entity.description : '')}</textarea></label>
                </form>
            `;
        } else if (apStudyModalState.entityType === 'unit') {
            title.textContent = entity ? 'Edit Unit' : 'Add Unit';
            const subjectId = defaultSubjectId || (ensureWorkspace().subjects[0] ? ensureWorkspace().subjects[0].id : '');
            body.innerHTML = `
                <form id="apStudyForm" class="ap-study-modal-form" data-ap-form-entity="unit">
                    <label><span>AP subject</span><select class="modal-input" name="subjectId" data-ap-modal-subject>${buildSubjectOptions(subjectId)}</select></label>
                    <div class="ap-study-form-grid two">
                        <label><span>Unit title</span><input class="modal-input" name="title" value="${escapeHtml(entity ? entity.title : '')}" placeholder="Unit 4: Chemical Reactions" required></label>
                        <label><span>Order</span><input class="modal-input" type="number" min="1" step="1" name="order" value="${escapeHtml(String(entity ? entity.order : (getUnitsForSubject(subjectId).length + 1)))}"></label>
                    </div>
                    <div class="ap-study-form-grid three">
                        <label><span>Status</span><select class="modal-input" name="status">${AP_STATUSES.map(status => `<option value="${escapeHtml(status)}"${status === (entity ? entity.status : 'not_started') ? ' selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}</select></label>
                        <label><span>Confidence</span><select class="modal-input" name="confidenceLevel">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === (entity ? entity.confidenceLevel : 3) ? ' selected' : ''}>${value}/5</option>`).join('')}</select></label>
                        <label class="ap-study-checkbox-field"><input type="checkbox" name="weakFlag"${entity && entity.weakFlag ? ' checked' : ''}><span>Flag weak area</span></label>
                    </div>
                    <label><span>Linked note</span><select class="modal-input" name="noteId">${buildNoteSelectOptions(entity ? entity.noteId : '')}</select></label>
                    <label><span>Notes</span><textarea class="modal-input" name="notes" rows="4" placeholder="Key reminders, common misses, or teacher emphasis.">${escapeHtml(entity ? entity.notes : '')}</textarea></label>
                </form>
            `;
        } else if (apStudyModalState.entityType === 'topic') {
            title.textContent = entity ? 'Edit Topic' : 'Add Topic / Subtopic';
            const subjectId = defaultSubjectId || (ensureWorkspace().subjects[0] ? ensureWorkspace().subjects[0].id : '');
            const unitId = apStudyModalState.unitId || (entity ? entity.unitId : '') || '';
            body.innerHTML = `
                <form id="apStudyForm" class="ap-study-modal-form" data-ap-form-entity="topic">
                    <label><span>AP subject</span><select class="modal-input" name="subjectId" data-ap-modal-subject>${buildSubjectOptions(subjectId)}</select></label>
                    <label><span>Unit</span><select class="modal-input" name="unitId" data-ap-modal-unit>${buildUnitOptions(subjectId, unitId)}</select></label>
                    <div class="ap-study-form-grid two">
                        <label><span>Topic title</span><input class="modal-input" name="title" value="${escapeHtml(entity ? entity.title : '')}" placeholder="Cell signaling pathways" required></label>
                        <label><span>Order</span><input class="modal-input" type="number" min="1" step="1" name="order" value="${escapeHtml(String(entity ? entity.order : (getTopicsForUnit(unitId).length + 1)))}"></label>
                    </div>
                    <div class="ap-study-form-grid three">
                        <label><span>Status</span><select class="modal-input" name="status">${AP_STATUSES.map(status => `<option value="${escapeHtml(status)}"${status === (entity ? entity.status : 'not_started') ? ' selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}</select></label>
                        <label><span>Confidence</span><select class="modal-input" name="confidenceLevel">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === (entity ? entity.confidenceLevel : 3) ? ' selected' : ''}>${value}/5</option>`).join('')}</select></label>
                        <label class="ap-study-checkbox-field"><input type="checkbox" name="weakFlag"${entity && entity.weakFlag ? ' checked' : ''}><span>Flag weak area</span></label>
                    </div>
                    <label><span>Linked note</span><select class="modal-input" name="noteId">${buildNoteSelectOptions(entity ? entity.noteId : '')}</select></label>
                    <label><span>Notes</span><textarea class="modal-input" name="notes" rows="4" placeholder="Add misconceptions, formulas, or review reminders.">${escapeHtml(entity ? entity.notes : '')}</textarea></label>
                </form>
            `;
        } else if (apStudyModalState.entityType === 'session') {
            title.textContent = entity ? 'Edit Study Session' : 'Plan Study Session';
            const subjectId = defaultSubjectId || (ensureWorkspace().subjects[0] ? ensureWorkspace().subjects[0].id : '');
            const unitId = apStudyModalState.unitId || (entity ? entity.unitId : '') || '';
            const topicId = apStudyModalState.topicId || (entity ? entity.topicId : '') || '';
            body.innerHTML = `
                <form id="apStudyForm" class="ap-study-modal-form" data-ap-form-entity="session">
                    <label><span>AP subject</span><select class="modal-input" name="subjectId" data-ap-modal-subject>${buildSubjectOptions(subjectId)}</select></label>
                    <div class="ap-study-form-grid two">
                        <label><span>Unit</span><select class="modal-input" name="unitId" data-ap-modal-unit>${buildUnitOptions(subjectId, unitId)}</select></label>
                        <label><span>Topic</span><select class="modal-input" name="topicId" data-ap-modal-topic>${buildTopicOptions(unitId, topicId)}</select></label>
                    </div>
                    <label><span>Session title</span><input class="modal-input" name="title" value="${escapeHtml(entity ? entity.title : '')}" placeholder="Review Unit 4 checkpoints"></label>
                    <div class="ap-study-form-grid four">
                        <label><span>Date</span><input class="modal-input" type="date" name="date" value="${escapeHtml(entity ? entity.date : (typeof today === 'function' ? today() : ''))}" required></label>
                        <label><span>Time</span><input class="modal-input" type="time" name="time" value="${escapeHtml(entity ? entity.time : '17:00')}" required></label>
                        <label><span>Duration</span><input class="modal-input" type="number" min="15" step="15" name="durationMinutes" value="${escapeHtml(String(entity ? entity.durationMinutes : 60))}"></label>
                        <label><span>Priority</span><select class="modal-input" name="priority">${['low', 'medium', 'high'].map(priority => `<option value="${priority}"${priority === (entity ? entity.priority : 'medium') ? ' selected' : ''}>${priority}</option>`).join('')}</select></label>
                    </div>
                    <div class="ap-study-form-grid two">
                        <label><span>Session type</span><select class="modal-input" name="sessionType">${Object.keys(SESSION_TYPE_META).map(type => `<option value="${escapeHtml(type)}"${type === (entity ? entity.sessionType : 'review') ? ' selected' : ''}>${escapeHtml(SESSION_TYPE_META[type].label)}</option>`).join('')}</select></label>
                        <label><span>Status</span><select class="modal-input" name="status">${['scheduled', 'completed', 'skipped'].map(status => `<option value="${status}"${status === (entity ? entity.status : 'scheduled') ? ' selected' : ''}>${escapeHtml(status.charAt(0).toUpperCase() + status.slice(1))}</option>`).join('')}</select></label>
                    </div>
                    <label><span>Linked note</span><select class="modal-input" name="noteId">${buildNoteSelectOptions(entity ? entity.noteId : '')}</select></label>
                    <label><span>Notes</span><textarea class="modal-input" name="notes" rows="4" placeholder="Prompt, materials, or exact review goals.">${escapeHtml(entity ? entity.notes : '')}</textarea></label>
                </form>
            `;
        } else if (apStudyModalState.entityType === 'practice') {
            title.textContent = entity ? 'Edit Practice Log' : 'Log Practice';
            const subjectId = defaultSubjectId || (ensureWorkspace().subjects[0] ? ensureWorkspace().subjects[0].id : '');
            const unitId = apStudyModalState.unitId || (entity ? entity.unitId : '') || '';
            const topicId = apStudyModalState.topicId || (entity ? entity.topicId : '') || '';
            body.innerHTML = `
                <form id="apStudyForm" class="ap-study-modal-form" data-ap-form-entity="practice">
                    <label><span>AP subject</span><select class="modal-input" name="subjectId" data-ap-modal-subject>${buildSubjectOptions(subjectId)}</select></label>
                    <div class="ap-study-form-grid two">
                        <label><span>Unit</span><select class="modal-input" name="unitId" data-ap-modal-unit>${buildUnitOptions(subjectId, unitId)}</select></label>
                        <label><span>Topic</span><select class="modal-input" name="topicId" data-ap-modal-topic>${buildTopicOptions(unitId, topicId)}</select></label>
                    </div>
                    <label><span>Title</span><input class="modal-input" name="title" value="${escapeHtml(entity ? entity.title : '')}" placeholder="MCQ Set 3" required></label>
                    <div class="ap-study-form-grid four">
                        <label><span>Date</span><input class="modal-input" type="date" name="date" value="${escapeHtml(entity ? entity.date : (typeof today === 'function' ? today() : ''))}" required></label>
                        <label><span>Type</span><select class="modal-input" name="type">${Object.keys(PRACTICE_TYPE_META).map(type => `<option value="${escapeHtml(type)}"${type === (entity ? entity.type : 'review_session') ? ' selected' : ''}>${escapeHtml(PRACTICE_TYPE_META[type].label)}</option>`).join('')}</select></label>
                        <label><span>Score</span><input class="modal-input" type="number" min="0" step="1" name="score" value="${escapeHtml(String(entity ? entity.score : 0))}"></label>
                        <label><span>Max score</span><input class="modal-input" type="number" min="0" step="1" name="maxScore" value="${escapeHtml(String(entity ? entity.maxScore : 0))}"></label>
                    </div>
                    <div class="ap-study-form-grid three">
                        <label><span>Minutes spent</span><input class="modal-input" type="number" min="0" step="5" name="minutesSpent" value="${escapeHtml(String(entity ? entity.minutesSpent : 45))}"></label>
                        <label><span>Confidence after</span><select class="modal-input" name="confidenceAfter">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === (entity ? entity.confidenceAfter : 3) ? ' selected' : ''}>${value}/5</option>`).join('')}</select></label>
                        <label class="ap-study-checkbox-field"><input type="checkbox" name="markedWeak"${entity && entity.markedWeak ? ' checked' : ''}><span>Flag this as weak</span></label>
                    </div>
                    <label><span>Linked note</span><select class="modal-input" name="noteId">${buildNoteSelectOptions(entity ? entity.noteId : '')}</select></label>
                    <label><span>Notes</span><textarea class="modal-input" name="notes" rows="4" placeholder="Missed concepts, timing issues, or next-step fixes.">${escapeHtml(entity ? entity.notes : '')}</textarea></label>
                </form>
            `;
        }

        if (typeof refreshCustomSelects === 'function') refreshCustomSelects(body);
        if (typeof refreshCustomDates === 'function') refreshCustomDates(body);
    }

    function refreshApStudyModalDependentOptions() {
        const form = document.getElementById('apStudyForm');
        if (!form) return;
        const subjectSelect = form.querySelector('[data-ap-modal-subject]');
        const unitSelect = form.querySelector('[data-ap-modal-unit]');
        const topicSelect = form.querySelector('[data-ap-modal-topic]');
        if (!subjectSelect || !unitSelect) return;
        const subjectId = subjectSelect.value;
        const currentUnitValue = unitSelect.value;
        unitSelect.innerHTML = buildUnitOptions(subjectId, currentUnitValue);
        const nextUnitId = unitSelect.value;
        if (topicSelect) {
            const currentTopicValue = topicSelect.value;
            topicSelect.innerHTML = buildTopicOptions(nextUnitId, currentTopicValue);
        }
        if (typeof refreshCustomSelects === 'function') refreshCustomSelects(form);
    }

    function saveSubjectFromForm(formData, entity) {
        const homeworkCourseKey = normalizeText(formData.get('homeworkCourseKey'));
        const linkedHomework = homeworkCourseKey ? getHomeworkCourseOptions().find(option => option.key === homeworkCourseKey) : null;
        const subject = entity || {
            id: makeId('apsubject'),
            createdAt: nowIso(),
            readiness: 0,
            quickTasks: normalizeQuickTasks(null)
        };
        subject.name = normalizeText(formData.get('name')) || 'AP Subject';
        subject.examDate = normalizeDateValue(formData.get('examDate'));
        subject.examTime = normalizeTimeValue(formData.get('examTime'));
        subject.teacherName = normalizeText(formData.get('teacherName'));
        subject.currentUnit = normalizeText(formData.get('currentUnit'));
        subject.totalUnitCount = normalizeNumberValue(formData.get('totalUnitCount'), Math.max(1, getUnitsForSubject(subject.id).length), 1, 99);
        subject.targetScore = clamp(normalizeNumberValue(formData.get('targetScore'), 3), 1, 5);
        subject.confidenceLevel = normalizeConfidence(formData.get('confidenceLevel'), 3);
        subject.description = normalizeText(formData.get('description'));
        subject.noteId = normalizeText(formData.get('noteId')) || null;
        subject.homeworkCourseSource = linkedHomework ? linkedHomework.source : null;
        subject.homeworkCourseId = linkedHomework ? linkedHomework.id : null;
        subject.homeworkCourseName = linkedHomework ? linkedHomework.name : null;
        subject.color = subject.color || normalizeColor('', ensureWorkspace().subjects.length);
        subject.updatedAt = nowIso();
        if (!entity) apStudyWorkspace.subjects.push(subject);
        pushActivity(entity ? 'subject_update' : 'subject_create', `${entity ? 'Updated' : 'Added'} ${subject.name}`, subject.id);
        ensureWorkspace().settings.activeSubjectId = subject.id;
    }

    function saveUnitFromForm(formData, entity) {
        const unit = entity || {
            id: makeId('apunit'),
            createdAt: nowIso()
        };
        unit.subjectId = normalizeText(formData.get('subjectId')) || ensureWorkspace().settings.activeSubjectId;
        unit.title = normalizeText(formData.get('title')) || 'New Unit';
        unit.order = normalizeNumberValue(formData.get('order'), getUnitsForSubject(unit.subjectId).length + 1, 1, 999);
        unit.status = normalizeStatus(formData.get('status'));
        unit.confidenceLevel = normalizeConfidence(formData.get('confidenceLevel'), 3);
        unit.weakFlag = !!formData.get('weakFlag');
        unit.noteId = normalizeText(formData.get('noteId')) || null;
        unit.notes = normalizeText(formData.get('notes'));
        unit.updatedAt = nowIso();
        if (!entity) apStudyWorkspace.units.push(unit);
        const subject = getSubjectById(unit.subjectId);
        pushActivity(entity ? 'unit_update' : 'unit_create', `${entity ? 'Updated' : 'Added'} unit ${unit.title}${subject ? ` in ${subject.name}` : ''}`, unit.subjectId);
        ensureWorkspace().settings.activeSubjectId = unit.subjectId;
        ensureWorkspace().settings.activeSection = 'units';
    }

    function saveTopicFromForm(formData, entity) {
        const topic = entity || {
            id: makeId('aptopic'),
            createdAt: nowIso()
        };
        const unit = getUnitById(normalizeText(formData.get('unitId')));
        const subjectId = unit ? unit.subjectId : (normalizeText(formData.get('subjectId')) || ensureWorkspace().settings.activeSubjectId);
        topic.subjectId = subjectId;
        topic.unitId = unit ? unit.id : null;
        topic.title = normalizeText(formData.get('title')) || 'New Topic';
        topic.order = normalizeNumberValue(formData.get('order'), getTopicsForUnit(topic.unitId).length + 1, 1, 999);
        topic.status = normalizeStatus(formData.get('status'));
        topic.confidenceLevel = normalizeConfidence(formData.get('confidenceLevel'), 3);
        topic.weakFlag = !!formData.get('weakFlag');
        topic.noteId = normalizeText(formData.get('noteId')) || null;
        topic.notes = normalizeText(formData.get('notes'));
        topic.updatedAt = nowIso();
        if (!entity) apStudyWorkspace.topics.push(topic);
        pushActivity(entity ? 'topic_update' : 'topic_create', `${entity ? 'Updated' : 'Added'} topic ${topic.title}`, topic.subjectId);
        ensureWorkspace().settings.activeSubjectId = topic.subjectId;
        ensureWorkspace().settings.activeSection = 'units';
    }

    function saveSessionFromForm(formData, entity) {
        const session = entity || {
            id: makeId('apsession'),
            createdAt: nowIso()
        };
        session.subjectId = normalizeText(formData.get('subjectId')) || ensureWorkspace().settings.activeSubjectId;
        session.unitId = normalizeText(formData.get('unitId')) || null;
        session.topicId = normalizeText(formData.get('topicId')) || null;
        session.title = normalizeText(formData.get('title'));
        session.date = normalizeDateValue(formData.get('date'));
        session.time = normalizeTimeValue(formData.get('time'), '17:00');
        session.durationMinutes = normalizeNumberValue(formData.get('durationMinutes'), 60, 15, 480);
        session.priority = normalizePriority(formData.get('priority'));
        session.status = ['scheduled', 'completed', 'skipped'].includes(normalizeText(formData.get('status')).toLowerCase())
            ? normalizeText(formData.get('status')).toLowerCase()
            : 'scheduled';
        session.sessionType = normalizeSessionType(formData.get('sessionType'));
        session.noteId = normalizeText(formData.get('noteId')) || null;
        session.notes = normalizeText(formData.get('notes'));
        session.completedAt = session.status === 'completed' ? (session.completedAt || nowIso()) : null;
        session.updatedAt = nowIso();
        if (!entity) apStudyWorkspace.sessions.push(session);
        if (session.status === 'completed') applySessionCompletionEffects(session, session.completedAt);
        pushActivity(entity ? 'session_update' : 'session_create', `${entity ? 'Updated' : 'Planned'} session ${getSessionDisplayTitle(session)}`, session.subjectId);
        ensureWorkspace().settings.activeSubjectId = session.subjectId;
        ensureWorkspace().settings.activeSection = 'sessions';
    }

    function savePracticeFromForm(formData, entity) {
        const log = entity || {
            id: makeId('appractice'),
            createdAt: nowIso()
        };
        log.subjectId = normalizeText(formData.get('subjectId')) || ensureWorkspace().settings.activeSubjectId;
        log.unitId = normalizeText(formData.get('unitId')) || null;
        log.topicId = normalizeText(formData.get('topicId')) || null;
        log.title = normalizeText(formData.get('title')) || 'Practice';
        log.type = normalizePracticeType(formData.get('type'));
        log.date = normalizeDateValue(formData.get('date')) || (typeof today === 'function' ? today() : '');
        log.score = normalizeNumberValue(formData.get('score'), 0, 0, 100000);
        log.maxScore = normalizeNumberValue(formData.get('maxScore'), 0, 0, 100000);
        log.minutesSpent = normalizeNumberValue(formData.get('minutesSpent'), 0, 0, 600);
        log.confidenceAfter = normalizeConfidence(formData.get('confidenceAfter'), 3);
        log.markedWeak = !!formData.get('markedWeak');
        log.noteId = normalizeText(formData.get('noteId')) || null;
        log.notes = normalizeText(formData.get('notes'));
        log.updatedAt = nowIso();
        if (!entity) apStudyWorkspace.practiceLogs.push(log);
        applyPracticeEffects(log);
        pushActivity(entity ? 'practice_update' : 'practice_create', `${entity ? 'Updated' : 'Logged'} ${PRACTICE_TYPE_META[log.type].label}: ${log.title}`, log.subjectId);
        ensureWorkspace().settings.activeSubjectId = log.subjectId;
        ensureWorkspace().settings.activeSection = 'practice';
    }

    function validateApStudyForm(form, entityType) {
        if (!form || entityType !== 'subject') return true;
        const unitCountInput = form.querySelector('[name="totalUnitCount"]');
        if (!unitCountInput) return true;
        const rawValue = String(unitCountInput.value || '').trim();
        const parsed = Number(rawValue);
        const valid = rawValue !== ''
            && Number.isFinite(parsed)
            && Number.isInteger(parsed)
            && parsed >= 1
            && parsed <= 99;
        if (valid) {
            unitCountInput.setCustomValidity('');
            return true;
        }
        unitCountInput.setCustomValidity('Enter a whole number from 1 to 99.');
        unitCountInput.reportValidity();
        if (typeof showToast === 'function') showToast('Enter a valid AP unit count (1-99).');
        return false;
    }

    function handleApStudyFormSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const entityType = form && form.dataset ? form.dataset.apFormEntity : '';
        if (!entityType) return;
        if (!validateApStudyForm(form, entityType)) return;
        ensureWorkspace();
        const formData = new FormData(form);
        const entity = getModalEntityRecord();

        if (entityType === 'subject') saveSubjectFromForm(formData, entity);
        if (entityType === 'unit') saveUnitFromForm(formData, entity);
        if (entityType === 'topic') saveTopicFromForm(formData, entity);
        if (entityType === 'session') saveSessionFromForm(formData, entity);
        if (entityType === 'practice') savePracticeFromForm(formData, entity);

        closeApStudyModal();
        renderDependents();
        if (typeof showToast === 'function') showToast('AP Study saved');
    }

    function deleteEntity(entityType, entityId) {
        if (!entityType || !entityId) return;
        ensureWorkspace();
        if (entityType === 'subject') {
            const subject = getSubjectById(entityId);
            if (!subject) return;
            const topicIds = new Set(apStudyWorkspace.topics.filter(topic => topic.subjectId === entityId).map(topic => topic.id));
            apStudyWorkspace.subjects = apStudyWorkspace.subjects.filter(item => item.id !== entityId);
            apStudyWorkspace.units = apStudyWorkspace.units.filter(unit => unit.subjectId !== entityId);
            apStudyWorkspace.topics = apStudyWorkspace.topics.filter(topic => topic.subjectId !== entityId);
            apStudyWorkspace.sessions = apStudyWorkspace.sessions.filter(session => session.subjectId !== entityId && !topicIds.has(session.topicId));
            apStudyWorkspace.practiceLogs = apStudyWorkspace.practiceLogs.filter(log => log.subjectId !== entityId && !topicIds.has(log.topicId));
            apStudyWorkspace.activity = apStudyWorkspace.activity.filter(item => item.subjectId !== entityId);
            ensureSubjectSelection();
            pushActivity('subject_delete', `Removed ${subject.name}`, null);
        }
        if (entityType === 'unit') {
            const unit = getUnitById(entityId);
            if (!unit) return;
            const topicIds = new Set(apStudyWorkspace.topics.filter(topic => topic.unitId === entityId).map(topic => topic.id));
            apStudyWorkspace.units = apStudyWorkspace.units.filter(item => item.id !== entityId);
            apStudyWorkspace.topics = apStudyWorkspace.topics.filter(topic => topic.unitId !== entityId);
            apStudyWorkspace.sessions = apStudyWorkspace.sessions.filter(session => session.unitId !== entityId && !topicIds.has(session.topicId));
            apStudyWorkspace.practiceLogs = apStudyWorkspace.practiceLogs.filter(log => log.unitId !== entityId && !topicIds.has(log.topicId));
            pushActivity('unit_delete', `Removed unit ${unit.title}`, unit.subjectId);
        }
        if (entityType === 'topic') {
            const topic = getTopicById(entityId);
            if (!topic) return;
            apStudyWorkspace.topics = apStudyWorkspace.topics.filter(item => item.id !== entityId);
            apStudyWorkspace.sessions = apStudyWorkspace.sessions.filter(session => session.topicId !== entityId);
            apStudyWorkspace.practiceLogs = apStudyWorkspace.practiceLogs.filter(log => log.topicId !== entityId);
            pushActivity('topic_delete', `Removed topic ${topic.title}`, topic.subjectId);
        }
        if (entityType === 'session') {
            const session = getSessionById(entityId);
            if (!session) return;
            apStudyWorkspace.sessions = apStudyWorkspace.sessions.filter(item => item.id !== entityId);
            pushActivity('session_delete', `Removed session ${getSessionDisplayTitle(session)}`, session.subjectId);
        }
        if (entityType === 'practice') {
            const practice = getPracticeById(entityId);
            if (!practice) return;
            apStudyWorkspace.practiceLogs = apStudyWorkspace.practiceLogs.filter(item => item.id !== entityId);
            pushActivity('practice_delete', `Removed practice log ${practice.title}`, practice.subjectId);
        }
        renderDependents();
        if (typeof showToast === 'function') showToast('Removed from AP Study');
    }

    async function confirmSubjectDeletion(subjectId) {
        const subject = getSubjectById(subjectId);
        if (!subject) return false;
        const unitCount = getUnitsForSubject(subject.id).length;
        const topicCount = ensureWorkspace().topics.filter(topic => topic.subjectId === subject.id).length;
        const sessionCount = ensureWorkspace().sessions.filter(session => session.subjectId === subject.id).length;
        const practiceCount = ensureWorkspace().practiceLogs.filter(log => log.subjectId === subject.id).length;
        const firstCheck = typeof showCustomConfirmDialog === 'function'
            ? await showCustomConfirmDialog({
                title: 'Delete AP Class',
                message: `Delete ${subject.name}? This removes ${unitCount} units, ${topicCount} topics, ${sessionCount} study sessions, ${practiceCount} practice logs, and the synced AP tasks and planner blocks tied to this class.`,
                confirmText: 'Continue',
                cancelText: 'Keep AP Class',
                confirmVariant: 'danger'
            })
            : false;
        if (!firstCheck) return false;
        const typedName = typeof showCustomPromptDialog === 'function'
            ? await showCustomPromptDialog({
                title: 'Final Delete Check',
                label: `Type "${subject.name}" to permanently delete this AP class.`,
                defaultValue: '',
                placeholder: subject.name,
                confirmText: 'Delete AP Class',
                cancelText: 'Cancel'
            })
            : null;
        if (typedName == null) return false;
        if (typedName !== subject.name) {
            if (typeof showToast === 'function') showToast('Type the exact AP class name to delete it');
            return false;
        }
        return true;
    }

    function handleQuickEntityFieldUpdate(target) {
        const entityType = normalizeText(target.dataset.apEntityType);
        const entityId = normalizeText(target.dataset.apEntityId);
        const field = normalizeText(target.dataset.apField);
        if (!entityType || !entityId || !field) return;
        const entity = entityType === 'unit' ? getUnitById(entityId) : getTopicById(entityId);
        if (!entity) return;
        if (field === 'weakFlag') {
            entity.weakFlag = !!target.checked;
            if (entity.weakFlag && entity.status === 'mastered') entity.status = 'needs_review';
        } else if (field === 'status') {
            entity.status = normalizeStatus(target.value);
            if (entity.status === 'mastered') entity.weakFlag = false;
        } else if (field === 'confidenceLevel') {
            entity.confidenceLevel = normalizeConfidence(target.value, entity.confidenceLevel || 3);
        }
        entity.updatedAt = nowIso();
        const subject = getSubjectById(entity.subjectId);
        pushActivity('entity_update', `Updated ${entityType} ${entity.title}${subject ? ` in ${subject.name}` : ''}`, entity.subjectId);
        renderDependents({ skipTaskRender: true });
    }

    function scheduleWeakReview(subjectId, unitId, topicId) {
        const subject = getSubjectById(subjectId);
        if (!subject) return;
        const defaultDate = typeof today === 'function' ? shiftDate(today(), 1) : '';
        openApStudyModal('session', { subjectId, unitId, topicId });
        const form = document.getElementById('apStudyForm');
        if (!form) return;
        const typeInput = form.querySelector('[name="sessionType"]');
        const titleInput = form.querySelector('[name="title"]');
        const dateInput = form.querySelector('[name="date"]');
        const priorityInput = form.querySelector('[name="priority"]');
        if (typeInput) typeInput.value = 'weak_area';
        if (titleInput) {
            const unit = unitId ? getUnitById(unitId) : null;
            const topic = topicId ? getTopicById(topicId) : null;
            titleInput.value = topic ? `Revisit ${topic.title}` : unit ? `Revisit ${unit.title}` : `Revisit ${subject.name} weak areas`;
        }
        if (dateInput && defaultDate) dateInput.value = defaultDate;
        if (priorityInput) priorityInput.value = 'high';
        if (typeof refreshCustomSelects === 'function') refreshCustomSelects(form);
        if (typeof refreshCustomDates === 'function') refreshCustomDates(form);
    }

    function completeSession(sessionId, completed) {
        const session = getSessionById(sessionId);
        if (!session) return;
        session.status = completed ? 'completed' : 'scheduled';
        session.completedAt = completed ? nowIso() : null;
        session.updatedAt = nowIso();
        if (completed) applySessionCompletionEffects(session, session.completedAt);
        createActivityFromSessionCompletion(session, completed);
        renderDependents();
    }

    async function handleApStudyAction(event) {
        const trigger = event.target.closest('[data-ap-action]');
        if (!trigger) return;
        const action = normalizeText(trigger.dataset.apAction);
        if (!action) return;

        if (action === 'select-subject') return void setActiveSubject(trigger.dataset.apSubjectId);
        if (action === 'open-subject-detail') return void setActiveSubject(trigger.dataset.apSubjectId);
        if (action === 'go-home') return void setApStudyViewMode('home');
        if (action === 'select-section') return void setActiveSection(trigger.dataset.apSection);
        if (action === 'open-modal') {
            return void openApStudyModal(trigger.dataset.apEntity, {
                id: trigger.dataset.apId || null,
                subjectId: trigger.dataset.apSubjectId || null,
                unitId: trigger.dataset.apUnitId || null,
                topicId: trigger.dataset.apTopicId || null
            });
        }
        if (action === 'delete-entity') {
            const entityType = trigger.dataset.apEntity;
            const entityId = trigger.dataset.apId;
            if (entityType && entityId) {
                const approved = entityType === 'subject'
                    ? await confirmSubjectDeletion(entityId)
                    : (typeof showCustomConfirmDialog === 'function'
                        ? await showCustomConfirmDialog({
                            title: 'Delete AP Study Item',
                            message: 'Delete this AP Study item?',
                            confirmText: 'Delete',
                            cancelText: 'Cancel',
                            confirmVariant: 'danger'
                        })
                        : false);
                if (approved) deleteEntity(entityType, entityId);
            }
            return;
        }
        if (action === 'create-note') return void createLinkedNote(trigger.dataset.apEntity, trigger.dataset.apId);
        if (action === 'open-note') return void openLinkedNote(trigger.dataset.apNoteId || '');
        if (action === 'open-class-dashboard') {
            if (trigger.dataset.apCourseId && typeof window.openClassDashboardDrawer === 'function') {
                window.openClassDashboardDrawer(trigger.dataset.apCourseId);
            }
            return;
        }
        if (action === 'generate-cards') {
            if (window.SutraReviewGenerator && typeof window.SutraReviewGenerator.fromApUnit === 'function') {
                window.SutraReviewGenerator.fromApUnit(trigger.dataset.apUnitId || '');
            }
            return;
        }
        if (action === 'schedule-weak-review') return void scheduleWeakReview(trigger.dataset.apSubjectId || '', trigger.dataset.apUnitId || '', trigger.dataset.apTopicId || '');
        if (action === 'complete-session') return void completeSession(trigger.dataset.apId || '', true);
        if (action === 'reopen-session') return void completeSession(trigger.dataset.apId || '', false);
        if (action === 'remove-quick-task') return void removeQuickTask(trigger.dataset.apSubjectId || '', trigger.dataset.apTaskId || '');
        if (action === 'use-suggested-readiness') return void setSubjectReadiness(trigger.dataset.apSubjectId || '', trigger.dataset.apReadinessValue || '0');
        if (action === 'open-timeline' && typeof setActiveView === 'function') setActiveView('timeline');
    }

    function toggleQuickTask(subjectId, taskId, checked) {
        const subject = getSubjectById(subjectId);
        if (!subject || !Array.isArray(subject.quickTasks)) return;
        const task = subject.quickTasks.find(item => item && item.id === taskId);
        if (!task) return;
        task.done = !!checked;
        subject.updatedAt = nowIso();
        if (typeof persistAppData === 'function') persistAppData();
        renderDependents({ skipTaskRender: true });
    }

    function addQuickTask(subjectId, text) {
        const subject = getSubjectById(subjectId);
        if (!subject) return;
        const trimmed = normalizeText(text);
        if (!trimmed) return;
        if (!Array.isArray(subject.quickTasks)) subject.quickTasks = [];
        subject.quickTasks.push({ id: makeId('apqtask'), text: trimmed, done: false });
        subject.updatedAt = nowIso();
        if (typeof persistAppData === 'function') persistAppData();
        renderDependents({ skipTaskRender: true });
    }

    function removeQuickTask(subjectId, taskId) {
        const subject = getSubjectById(subjectId);
        if (!subject || !Array.isArray(subject.quickTasks)) return;
        const before = subject.quickTasks.length;
        subject.quickTasks = subject.quickTasks.filter(task => task && task.id !== taskId);
        if (subject.quickTasks.length === before) return;
        subject.updatedAt = nowIso();
        if (typeof persistAppData === 'function') persistAppData();
        renderDependents({ skipTaskRender: true });
    }

    function setSubjectReadiness(subjectId, rawValue, options = {}) {
        const subject = getSubjectById(subjectId);
        if (!subject) return;
        const next = normalizeReadiness(rawValue);
        if (subject.readiness === next && !options.forcePersist) return;
        subject.readiness = next;
        subject.updatedAt = nowIso();
        if (options.persist !== false && typeof persistAppData === 'function') persistAppData();
        if (options.rerender !== false) renderDependents({ skipTaskRender: true });
    }

    function initApStudyWorkspaceUI() {
        if (apStudyUiBound) return;
        apStudyUiBound = true;
        const mount = document.getElementById('apStudyMount');
        if (mount) {
            mount.addEventListener('click', handleApStudyAction);
            mount.addEventListener('change', event => {
                const target = event.target;
                if (!target || !target.dataset) return;
                if (target.dataset.apField) {
                    handleQuickEntityFieldUpdate(target);
                    return;
                }
                if (target.hasAttribute && target.hasAttribute('data-ap-quick-task-toggle')) {
                    toggleQuickTask(target.dataset.apSubjectId || '', target.dataset.apTaskId || '', target.checked);
                    return;
                }
                if (target.hasAttribute && target.hasAttribute('data-ap-readiness-input')) {
                    setSubjectReadiness(target.dataset.apReadinessInput || '', target.value);
                    return;
                }
            });
            mount.addEventListener('input', event => {
                const target = event.target;
                if (!target || !target.hasAttribute || !target.hasAttribute('data-ap-readiness-input')) return;
                const subjectId = target.dataset.apReadinessInput || '';
                const nextValue = normalizeReadiness(target.value);
                const display = mount.querySelector(`[data-ap-readiness-display="${cssEscapeValue(subjectId)}"]`);
                if (display) display.textContent = `${nextValue}%`;
            });
            mount.addEventListener('submit', event => {
                const form = event.target;
                if (!form || !form.hasAttribute || !form.hasAttribute('data-ap-quick-task-form')) return;
                event.preventDefault();
                const subjectId = form.dataset.apSubjectId || '';
                const input = form.querySelector('input[name="text"]');
                const text = input ? input.value : '';
                addQuickTask(subjectId, text);
                if (input) input.value = '';
            });
        }

        if (!document.getElementById('apStudyModal')) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'apStudyModal';
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="modal-content glass-modal ap-study-modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title" id="apStudyModalTitle">AP Study</h3>
                        <button class="close-btn" type="button" id="apStudyModalClose" aria-label="Close">&times;</button>
                    </div>
                    <div class="modal-body" id="apStudyModalBody"></div>
                    <div class="modal-footer ap-study-modal-footer">
                        <button class="neumo-btn" type="button" id="apStudyModalCancel">Cancel</button>
                        <button class="neumo-btn btn-primary" type="button" id="apStudyModalSave">Save</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        if (!apStudyModalBound) {
            apStudyModalBound = true;
            const modal = document.getElementById('apStudyModal');
            if (modal) {
                modal.addEventListener('click', event => {
                    if (event.target === modal) closeApStudyModal();
                });
            }
            const closeBtn = document.getElementById('apStudyModalClose');
            const cancelBtn = document.getElementById('apStudyModalCancel');
            const saveBtn = document.getElementById('apStudyModalSave');
            if (closeBtn) closeBtn.addEventListener('click', closeApStudyModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeApStudyModal);
            // Escape closes the modal (only while it is open) for keyboard users.
            document.addEventListener('keydown', event => {
                if (event.key !== 'Escape') return;
                if (apStudyModalState && modal && modal.classList.contains('active')) {
                    event.preventDefault();
                    closeApStudyModal();
                }
            });
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    const form = document.getElementById('apStudyForm');
                    if (form) form.requestSubmit();
                });
            }
            document.addEventListener('submit', event => {
                const form = event.target;
                if (form && form.id === 'apStudyForm') handleApStudyFormSubmit(event);
            });
            document.addEventListener('change', event => {
                const form = event.target && event.target.closest ? event.target.closest('#apStudyForm') : null;
                if (!form) return;
                if (event.target.matches('[data-ap-modal-subject], [data-ap-modal-unit]')) {
                    refreshApStudyModalDependentOptions();
                }
            });
            window.addEventListener('homework:updated', () => {
                if (activeView === 'apstudy') renderApStudyWorkspace();
            });
        }
    }

    function hydrateApStudyWorkspaceState() {
        ensureWorkspace();
        syncApStudySessionsIntoTaskStore({ persist: true });
    }

    function openApStudyAddSubject() {
        try {
            if (typeof initApStudyWorkspaceUI === 'function') initApStudyWorkspaceUI();
            openApStudyModal('subject', {});
        } catch (err) {
            console.warn('openApStudyAddSubject failed', err);
        }
    }

    window.getDefaultApStudyWorkspace = getDefaultApStudyWorkspace;
    window.computeSuggestedExamReadiness = function (subjectId) {
        try { return computeSuggestedReadiness(getSubjectById(String(subjectId || ''))); } catch (e) { return null; }
    };
    window.normalizeApStudyWorkspace = normalizeApStudyWorkspace;
    window.hydrateApStudyWorkspaceState = hydrateApStudyWorkspaceState;
    window.initApStudyWorkspaceUI = initApStudyWorkspaceUI;
    window.renderApStudyWorkspace = renderApStudyWorkspace;
    window.openApStudyAddSubject = openApStudyAddSubject;
    window.closeApStudyModal = closeApStudyModal;
    window.syncApStudySessionsIntoTaskStore = syncApStudySessionsIntoTaskStore;
    window.handleApStudyTaskCompletion = handleApStudyTaskCompletion;
    window.deleteApStudyTaskInStore = deleteApStudyTaskInStore;
    window.openApStudyFromTask = openApStudyFromTask;
    window.handleApStudyTaskOpen = handleApStudyTaskOpen;
    window.handleApStudyBlockOpen = handleApStudyBlockOpen;
    window.getApStudyTodayStats = getApStudyTodayStats;
})();

