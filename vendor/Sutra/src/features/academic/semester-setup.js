/* ==========================================================================
   Sutra Semester Setup — syllabus & school-calendar importer
   ==========================================================================
   A semester-start wizard: paste portal text or drop syllabi / .ics / .csv
   files, and Sutra extracts likely classes, teachers, assignments, exams,
   grading weights, recurring meetings, and no-school days — then shows a
   review-and-approve screen before anything is written to the workspace.

   Privacy model:
   - Every file is parsed LOCALLY first. Local parsing never leaves the device.
   - "Improve with AI" is optional, per-draft, uses the provider the user
     already configured, and routes through the app's single intelligence
     core (with its explicit send-disclosure). Nothing is sent silently.
   - Nothing is written without explicit approval on the review screen.

   Approved items flow into the EXISTING systems (no parallel stores):
   courses → Course Hub · assignments/exams → Homework · grading weights →
   Grade Planner · one-off events → Timeline · no-school days → School
   Schedule overrides. Draft state lives in appData.semesterSetup.
   ========================================================================== */

/* global window, document, localStorage */

(function (global) {
    'use strict';

    var ITEM_KINDS = ['course', 'assignment', 'exam', 'event', 'recurring_class', 'grading_category', 'no_school'];
    var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var DAY_TOKENS = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 0 };

    function uid(prefix) {
        return (prefix || 'sem') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    function pad2(n) { return String(n).padStart(2, '0'); }

    // ---- Normalization ---------------------------------------------------------
    function getDefaultSemesterSetup() {
        return { schemaVersion: 1, drafts: [], lastCompletedAt: null };
    }

    function normalizeItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var kind = ITEM_KINDS.indexOf(String(raw.kind)) !== -1 ? String(raw.kind) : '';
        var title = String(raw.title || '').trim();
        if (!kind || !title) return null;
        return {
            id: String(raw.id || uid('item')),
            kind: kind,
            title: title,
            courseName: String(raw.courseName || '').trim(),
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : '',
            time: /^\d{2}:\d{2}$/.test(String(raw.time || '')) ? String(raw.time) : '',
            endTime: /^\d{2}:\d{2}$/.test(String(raw.endTime || '')) ? String(raw.endTime) : '',
            days: Array.isArray(raw.days) ? raw.days.filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; }) : [],
            weight: Number.isFinite(Number(raw.weight)) ? Math.max(0, Math.min(100, Number(raw.weight))) : null,
            teacher: String(raw.teacher || '').trim(),
            teacherEmail: String(raw.teacherEmail || '').trim(),
            room: String(raw.room || '').trim(),
            details: String(raw.details || '').trim(),
            confidence: ['high', 'medium', 'low'].indexOf(String(raw.confidence)) !== -1 ? String(raw.confidence) : 'medium',
            provenance: raw.provenance === 'ai' ? 'ai' : 'local',
            sourceId: String(raw.sourceId || ''),
            sourceSnippet: String(raw.sourceSnippet || '').slice(0, 240),
            duplicate: raw.duplicate === true,
            approved: raw.approved !== false,
            applied: raw.applied === true
        };
    }

    function normalizeDraft(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return {
            id: String(raw.id || uid('draft')),
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
            status: ['in_review', 'applied', 'discarded'].indexOf(String(raw.status)) !== -1 ? String(raw.status) : 'in_review',
            sources: (Array.isArray(raw.sources) ? raw.sources : []).filter(function (s) { return s && typeof s === 'object'; }).map(function (s) {
                return {
                    id: String(s.id || uid('src')),
                    name: String(s.name || 'Pasted text').slice(0, 160),
                    fileType: ['text', 'ics', 'csv'].indexOf(String(s.fileType)) !== -1 ? String(s.fileType) : 'text',
                    textChars: Number(s.textChars) || 0,
                    text: String(s.text || '').slice(0, 400000),
                    aiUsed: s.aiUsed === true,
                    addedAt: s.addedAt || new Date().toISOString()
                };
            }).slice(0, 12),
            items: (Array.isArray(raw.items) ? raw.items : []).map(normalizeItem).filter(Boolean).slice(0, 400),
            appliedAt: raw.appliedAt || null,
            appliedCounts: raw.appliedCounts && typeof raw.appliedCounts === 'object' ? raw.appliedCounts : null
        };
    }

    function normalizeSemesterSetup(raw) {
        var out = getDefaultSemesterSetup();
        if (!raw || typeof raw !== 'object') return out;
        out.drafts = (Array.isArray(raw.drafts) ? raw.drafts : []).map(normalizeDraft).filter(Boolean).slice(-5);
        out.lastCompletedAt = raw.lastCompletedAt || null;
        return out;
    }

    // ---- Local extraction engine (pure; testable in Node) ------------------------
    function inferYear(month, day) {
        var now = new Date();
        var candidate = new Date(now.getFullYear(), month, day, 12);
        // Academic heuristic: dates more than ~5 months in the past belong to next year.
        if (candidate.getTime() < now.getTime() - 150 * 24 * 3600 * 1000) {
            candidate = new Date(now.getFullYear() + 1, month, day, 12);
        }
        return candidate;
    }

    function parseDateToken(text) {
        var t = String(text || '').trim();
        var m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1] + '-' + m[2] + '-' + m[3];
        m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
        if (m) {
            var month = Number(m[1]) - 1;
            var day = Number(m[2]);
            if (month < 0 || month > 11 || day < 1 || day > 31) return '';
            var date;
            if (m[3]) {
                var year = Number(m[3]);
                if (year < 100) year += 2000;
                date = new Date(year, month, day, 12);
            } else {
                date = inferYear(month, day);
            }
            return isNaN(date.getTime()) ? '' : date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
        }
        m = t.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
        if (m) {
            var monthIdx = -1;
            MONTHS.forEach(function (name, i) { if (name.indexOf(m[1] === 'sept' ? 'sep' : m[1]) === 0) monthIdx = i; });
            if (monthIdx === -1) return '';
            var d2 = m[3] ? new Date(Number(m[3]), monthIdx, Number(m[2]), 12) : inferYear(monthIdx, Number(m[2]));
            return isNaN(d2.getTime()) ? '' : d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());
        }
        return '';
    }

    function parseTimeToken(text) {
        var m = String(text || '').toLowerCase().match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
        if (!m) {
            m = String(text || '').toLowerCase().match(/\b(\d{1,2})\s*(am|pm)\b/);
            if (!m) return '';
            var hour = Number(m[1]) % 12 + (m[2] === 'pm' ? 12 : 0);
            return pad2(hour) + ':00';
        }
        var h = Number(m[1]);
        var min = Number(m[2]);
        if (m[3] === 'pm' && h < 12) h += 12;
        if (m[3] === 'am' && h === 12) h = 0;
        if (h > 23 || min > 59) return '';
        return pad2(h) + ':' + pad2(min);
    }

    function parseDayTokens(text) {
        var days = [];
        var lower = String(text || '').toLowerCase();
        // "MWF" / "TTh" compact forms — scan word tokens that decode fully
        // into day letters (m/t/w/th/f), e.g. "mwf", "tth", "mtwf".
        var compactMap = { m: 1, t: 2, w: 3, f: 5 };
        (lower.match(/\b[mtwhf]{2,6}\b/g) || []).some(function (word) {
            var decoded = [];
            var rest = word;
            while (rest.length) {
                if (rest.indexOf('th') === 0) { decoded.push(4); rest = rest.slice(2); continue; }
                var d = compactMap[rest[0]];
                if (d === undefined) { decoded = null; break; }
                if (decoded.indexOf(d) === -1) decoded.push(d);
                rest = rest.slice(1);
            }
            if (decoded && decoded.length >= 2) { days = decoded; return true; }
            return false;
        });
        Object.keys(DAY_TOKENS).forEach(function (token) {
            var re = new RegExp('\\b' + token + '[a-z]*\\b', 'i');
            if (re.test(lower) && days.indexOf(DAY_TOKENS[token]) === -1) days.push(DAY_TOKENS[token]);
        });
        return days.sort();
    }

    var EXAM_RE = /\b(exam|test|quiz|midterm|final|assessment)\b/i;
    var ASSIGNMENT_RE = /\b(due|assignment|homework|hw|essay|project|lab(?:\s+report)?|read(?:ing)?|worksheet|problem set|pset|draft|presentation|paper)\b/i;
    var NO_SCHOOL_RE = /\b(no school|holiday|break|day off|teacher work\s?day|in-?service|staff development|closed)\b/i;
    var COURSE_LINE_RE = /^(?:[Pp]eriod\s*(\d+)\s*[:\-–]\s*)?([A-Z][A-Za-z0-9&\/\- ]+?)(?:\s*[—\-–:]\s*(?:Mr\.?|Mrs\.?|Ms\.?|Mx\.?|Dr\.?|Prof\.?)\s*([A-Za-z'\- ]+?))?\s*(?:\(?\s*(?:[Rr]oom|[Rr][Mm]|ROOM)\.?\s*#?\s*([A-Za-z0-9\-]+)\s*\)?)?\s*$/;
    var GRADING_RE = /^([A-Za-z][A-Za-z &\/\-]+?)\s*[:\-–]?\s*(\d{1,3})\s*%/;
    var TEACHER_EMAIL_RE = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

    /**
     * Parse free text (syllabus, portal copy, school handout) into draft items.
     * Pure — no DOM, no storage. Returns { items, stats }.
     */
    function parseSourceText(text, source) {
        var sourceId = source && source.id ? source.id : '';
        var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 1200);
        var items = [];
        var currentCourse = '';
        var inGradingSection = false;

        lines.forEach(function (line) {
            var lower = line.toLowerCase();
            var snippet = line.slice(0, 200);
            var date = parseDateToken(line);
            var time = parseTimeToken(line);

            // Section headers steer interpretation.
            if (/^grad(e|ing)/i.test(line) || /grade\s*breakdown|grading\s*(policy|scale|weights)/i.test(lower)) {
                inGradingSection = true;
            } else if (/^[A-Z][^a-z]{0,3}[A-Za-z ]+:$/.test(line) && !GRADING_RE.test(line)) {
                inGradingSection = /grad/i.test(line);
            }

            // Grading weights: "Tests — 40%".
            var grading = line.match(GRADING_RE);
            if (grading && (inGradingSection || /weight|grade|category/i.test(lower) || Number(grading[2]) <= 100)) {
                var weight = Number(grading[2]);
                if (weight > 0 && weight <= 100 && !/\bsave\b|\boff\b|\bdiscount\b/.test(lower)) {
                    items.push(normalizeItem({
                        kind: 'grading_category', title: grading[1].trim(), weight: weight,
                        courseName: currentCourse, confidence: inGradingSection ? 'high' : 'medium',
                        sourceId: sourceId, sourceSnippet: snippet
                    }));
                    return;
                }
            }

            // No-school days.
            if (NO_SCHOOL_RE.test(lower) && date) {
                items.push(normalizeItem({
                    kind: 'no_school', title: line.replace(/\s+/g, ' '), date: date,
                    confidence: 'high', sourceId: sourceId, sourceSnippet: snippet
                }));
                return;
            }

            // Exams.
            if (EXAM_RE.test(lower) && date) {
                items.push(normalizeItem({
                    kind: 'exam', title: line.replace(/\s+/g, ' '), date: date, time: time,
                    courseName: currentCourse, confidence: 'high', sourceId: sourceId, sourceSnippet: snippet
                }));
                return;
            }

            // Assignments.
            if (ASSIGNMENT_RE.test(lower) && date) {
                items.push(normalizeItem({
                    kind: 'assignment', title: line.replace(/\s+/g, ' '), date: date, time: time,
                    courseName: currentCourse, confidence: EXAM_RE.test(lower) ? 'medium' : 'high',
                    sourceId: sourceId, sourceSnippet: snippet
                }));
                return;
            }

            // Recurring class meetings: "Class meets MWF 10:00–10:50".
            var days = parseDayTokens(line);
            if (days.length >= 1 && time && /\b(meet|class|period|lecture|section|every)\b/i.test(lower)) {
                var endTime = '';
                var range = line.match(/(\d{1,2}:\d{2})\s*(?:am|pm)?\s*[-–to]+\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
                if (range) endTime = parseTimeToken(range[2]);
                items.push(normalizeItem({
                    kind: 'recurring_class', title: (currentCourse || 'Class') + ' meeting',
                    courseName: currentCourse, days: days, time: time, endTime: endTime,
                    confidence: currentCourse ? 'high' : 'medium', sourceId: sourceId, sourceSnippet: snippet
                }));
                return;
            }

            // Course headers: "AP Biology — Mr. Smith (Room 204)".
            var courseMatch = line.match(COURSE_LINE_RE);
            var email = line.match(TEACHER_EMAIL_RE);
            var looksLikeCourse = courseMatch && (
                /\b(AP|IB|Honors|Period)\b/.test(line)
                || courseMatch[3]
                || courseMatch[4]
                || /\b(biology|chem|physics|history|math|calc|algebra|geometry|english|literature|spanish|french|german|latin|economics|gov|computer|science|art|music|band|orchestra|psych)\w*\b/i.test(lower)
            );
            if (looksLikeCourse && !date && !/[.!?]$/.test(line)) {
                currentCourse = courseMatch[2].trim();
                inGradingSection = false;
                items.push(normalizeItem({
                    kind: 'course', title: currentCourse,
                    teacher: courseMatch[3] ? courseMatch[3].trim() : '',
                    teacherEmail: email ? email[1] : '',
                    room: courseMatch[4] ? courseMatch[4].trim() : '',
                    confidence: (courseMatch[3] || courseMatch[4]) ? 'high' : 'medium',
                    sourceId: sourceId, sourceSnippet: snippet
                }));
                return;
            }
            if (email && currentCourse) {
                // Attach stray teacher emails to the last seen course.
                for (var i = items.length - 1; i >= 0; i--) {
                    if (items[i] && items[i].kind === 'course' && items[i].title === currentCourse && !items[i].teacherEmail) {
                        items[i].teacherEmail = email[1];
                        break;
                    }
                }
            }
        });

        // De-dupe courses + grading categories by (kind, title, courseName).
        var seen = {};
        var deduped = items.filter(Boolean).filter(function (item) {
            var key = item.kind + '|' + item.title.toLowerCase() + '|' + item.courseName.toLowerCase() + '|' + item.date;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
        return {
            items: deduped,
            stats: { lines: lines.length, extracted: deduped.length }
        };
    }

    /** Parse an .ics source into event/exam/no_school items (local, no network). */
    function parseIcsSource(text, source) {
        var bridge = global.sutraIcs;
        if (!bridge || typeof bridge.parseIcsEvents !== 'function') return { items: [], stats: { lines: 0, extracted: 0 } };
        var events = bridge.parseIcsEvents(text) || [];
        var items = [];
        events.slice(0, 500).forEach(function (evt) {
            var summary = String(evt.SUMMARY || '').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
            var startInfo = bridge.parseIcsDateTimeInfo(evt.DTSTART, evt.DTSTART_PARAMS);
            if (!summary || !startInfo || !startInfo.dateKey) return;
            var lower = summary.toLowerCase();
            var kind = NO_SCHOOL_RE.test(lower) ? 'no_school' : (EXAM_RE.test(lower) ? 'exam' : (ASSIGNMENT_RE.test(lower) ? 'assignment' : 'event'));
            items.push(normalizeItem({
                kind: kind, title: summary, date: startInfo.dateKey,
                time: startInfo.time || '', confidence: 'high', provenance: 'local',
                sourceId: source && source.id, sourceSnippet: summary.slice(0, 200)
            }));
        });
        return { items: items.filter(Boolean), stats: { lines: events.length, extracted: items.length } };
    }

    var Engine = {
        getDefaultSemesterSetup: getDefaultSemesterSetup,
        normalizeSemesterSetup: normalizeSemesterSetup,
        parseSourceText: parseSourceText,
        parseDateToken: parseDateToken,
        parseTimeToken: parseTimeToken,
        parseDayTokens: parseDayTokens
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    if (typeof window === 'undefined') return;

    // =========================================================================
    // Browser wizard
    // =========================================================================

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function toast(message) {
        if (typeof global.showToast === 'function') { global.showToast(message); return; }
        console.log('[SemesterSetup]', message);
    }

    function getWorkspaceState() {
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.getSemesterSetup === 'function') {
                return normalizeSemesterSetup(global.SutraAcademicState.getSemesterSetup());
            }
        } catch (e) { /* fall through */ }
        return getDefaultSemesterSetup();
    }
    function setWorkspaceState(next) {
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.setSemesterSetup === 'function') {
                global.SutraAcademicState.setSemesterSetup(normalizeSemesterSetup(next));
            }
        } catch (e) { console.warn('SemesterSetup save failed', e); }
    }

    var activeDraftId = null;
    var activeStep = 'sources'; // 'sources' | 'review' | 'done'
    var aiImproving = false;     // true while an "Improve with AI" request is in flight
    var aiStatus = null;         // { kind: 'ok'|'info'|'error', text } — last AI result, shown in-modal

    function getActiveDraft() {
        var ws = getWorkspaceState();
        var draft = null;
        ws.drafts.forEach(function (d) { if (d.id === activeDraftId) draft = d; });
        return draft;
    }

    function saveDraft(draft) {
        var ws = getWorkspaceState();
        var found = false;
        draft.updatedAt = new Date().toISOString();
        ws.drafts = ws.drafts.map(function (d) {
            if (d.id === draft.id) { found = true; return draft; }
            return d;
        });
        if (!found) ws.drafts.push(draft);
        setWorkspaceState(ws);
    }

    // ---- Modal scaffolding ---------------------------------------------------
    function ensureModal() {
        var modal = document.getElementById('semesterSetupModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'semesterSetupModal';
        modal.className = 'sutra-academic-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="sutra-academic-card semsetup-card" role="dialog" aria-modal="true" aria-labelledby="semesterSetupTitle">'
            + '<div class="sutra-academic-head">'
            + '<h3 id="semesterSetupTitle">Semester Setup</h3>'
            + '<button type="button" class="sutra-academic-close" data-sem-close aria-label="Close">&times;</button>'
            + '</div>'
            + '<div class="sutra-academic-body" id="semesterSetupBody"></div>'
            + '</div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) { closeWizard(); return; }
            if (e.target.closest('[data-sem-close]')) { closeWizard(); return; }
            var btn = e.target.closest('[data-sem-action]');
            if (btn) handleAction(btn);
        });
        modal.addEventListener('change', function (e) {
            var el = e.target;
            if (!el || !el.dataset) return;
            if (el.dataset.semItemField) handleItemFieldChange(el);
        });
        return modal;
    }

    function openWizard() {
        var modal = ensureModal();
        var ws = getWorkspaceState();
        var draft = null;
        ws.drafts.forEach(function (d) { if (d.status === 'in_review') draft = d; });
        if (!draft) {
            draft = normalizeDraft({ id: uid('draft'), status: 'in_review', sources: [], items: [] });
            saveDraft(draft);
        }
        activeDraftId = draft.id;
        activeStep = draft.items.length ? 'review' : 'sources';
        aiImproving = false;
        aiStatus = null;
        render();
        modal.__sutraReturnFocus = document.activeElement;
        modal.hidden = false;
        modal.classList.add('is-visible');
        syncModalManager();
    }

    function closeWizard() {
        var modal = document.getElementById('semesterSetupModal');
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove('is-visible');
        syncModalManager();
    }

    function syncModalManager() {
        if (global.SutraModalManager && typeof global.SutraModalManager.sync === 'function') {
            try { global.SutraModalManager.sync(); } catch (e) { /* non-critical */ }
        }
    }

    // ---- Rendering --------------------------------------------------------------
    function render() {
        var body = document.getElementById('semesterSetupBody');
        var draft = getActiveDraft();
        if (!body || !draft) return;
        var steps = [['sources', '1 · Add materials'], ['review', '2 · Review & approve'], ['done', '3 · Done']];
        var stepNav = '<div class="semsetup-steps" role="tablist">' + steps.map(function (s) {
            return '<span class="semsetup-step' + (s[0] === activeStep ? ' is-active' : '') + '">' + esc(s[1]) + '</span>';
        }).join('') + '</div>';

        if (activeStep === 'sources') body.innerHTML = stepNav + renderSourcesStep(draft);
        else if (activeStep === 'review') body.innerHTML = stepNav + renderReviewStep(draft);
        else body.innerHTML = stepNav + renderDoneStep(draft);

        var fileInput = document.getElementById('semSourceFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', function () {
                handleFilesSelected(fileInput.files);
                fileInput.value = '';
            });
        }
    }

    function renderSourcesStep(draft) {
        var aiAvailable = !!(global.SutraIntelligenceBridge && global.SutraIntelligenceBridge.isConfigured && global.SutraIntelligenceBridge.isConfigured());
        var sourcesHtml = draft.sources.map(function (s) {
            return '<div class="semsetup-source-row">'
                + '<span class="semsetup-source-icon">' + (s.fileType === 'ics' ? '📅' : '📄') + '</span>'
                + '<span class="semsetup-source-main"><strong>' + esc(s.name) + '</strong>'
                + '<small>' + s.textChars.toLocaleString() + ' characters · parsed locally on this device'
                + (s.aiUsed ? ' · AI-assisted (sent to your provider with your approval)' : '') + '</small></span>'
                + '<button type="button" class="semsetup-mini-btn danger" data-sem-action="remove-source" data-source-id="' + esc(s.id) + '" aria-label="Remove source">&times;</button>'
                + '</div>';
        }).join('');

        return '<section class="semsetup-section">'
            + '<p class="semsetup-lede">Drop in whatever you have — syllabi, the school calendar, copied portal pages, class handouts. Sutra reads them <strong>locally</strong> and proposes your semester. Nothing is created until you approve it.</p>'
            + (sourcesHtml || '<div class="semsetup-empty">No materials yet.</div>')
            + '<div class="semsetup-add-grid">'
            + '<label class="semsetup-add-card" for="semSourceFileInput">'
            + '<i class="fas fa-file-arrow-up" aria-hidden="true"></i><strong>Upload files</strong>'
            + '<small>.txt · .md · .csv · .ics — read locally, never uploaded</small>'
            + '<input id="semSourceFileInput" type="file" multiple accept=".txt,.md,.markdown,.csv,.ics,text/plain,text/markdown,text/csv,text/calendar" class="semsetup-file-input">'
            + '</label>'
            + '<div class="semsetup-add-card semsetup-paste-card">'
            + '<strong>Paste text</strong>'
            + '<textarea id="semPasteArea" rows="5" placeholder="Paste a syllabus, portal page, or schedule here…" aria-label="Paste semester materials"></textarea>'
            + '<button type="button" class="neumo-btn btn-primary semsetup-btn" data-sem-action="add-paste">Add pasted text</button>'
            + '</div></div>'
            + '<div class="semsetup-privacy-note"><i class="fas fa-shield-halved" aria-hidden="true"></i> '
            + 'Local parsing never leaves this device. The optional “Improve with AI” step on the next screen sends the text to <em>your chosen AI provider only</em>, and always asks first.'
            + (aiAvailable ? '' : ' (No AI provider is configured — local parsing still works fully.)')
            + '</div>'
            + '<div class="semsetup-foot-actions">'
            + '<button type="button" class="neumo-btn btn-primary semsetup-btn" data-sem-action="to-review"' + (draft.sources.length ? '' : ' disabled') + '>Extract &amp; review →</button>'
            + '</div></section>';
    }

    var KIND_META = {
        course: { label: 'Classes', icon: 'fa-graduation-cap', target: 'Course Hub' },
        recurring_class: { label: 'Class meetings', icon: 'fa-clock', target: 'Course schedule' },
        grading_category: { label: 'Grading weights', icon: 'fa-percent', target: 'Grade Planner' },
        assignment: { label: 'Assignments', icon: 'fa-list-check', target: 'Homework' },
        exam: { label: 'Tests & exams', icon: 'fa-file-pen', target: 'Homework (high priority)' },
        event: { label: 'Events', icon: 'fa-calendar-day', target: 'Timeline' },
        no_school: { label: 'No-school days', icon: 'fa-umbrella-beach', target: 'School Schedule' }
    };

    function renderReviewStep(draft) {
        var aiAvailable = !!(global.SutraIntelligenceBridge && global.SutraIntelligenceBridge.isConfigured && global.SutraIntelligenceBridge.isConfigured());
        var groups = {};
        ITEM_KINDS.forEach(function (k) { groups[k] = []; });
        draft.items.forEach(function (item) { if (groups[item.kind]) groups[item.kind].push(item); });

        var groupsHtml = ITEM_KINDS.map(function (kind) {
            var list = groups[kind];
            if (!list.length) return '';
            var meta = KIND_META[kind];
            var rows = list.map(function (item) {
                var fields = '<input type="text" data-sem-item-field="title" data-item-id="' + esc(item.id) + '" value="' + esc(item.title) + '" aria-label="Title">';
                if (kind !== 'course' && kind !== 'grading_category' && kind !== 'recurring_class') {
                    fields += '<input type="date" data-sem-item-field="date" data-item-id="' + esc(item.id) + '" value="' + esc(item.date) + '" aria-label="Date">';
                }
                if (kind === 'grading_category') {
                    fields += '<input type="number" min="0" max="100" data-sem-item-field="weight" data-item-id="' + esc(item.id) + '" value="' + (item.weight === null ? '' : esc(item.weight)) + '" aria-label="Weight %" placeholder="%">';
                }
                if (kind !== 'course' && kind !== 'no_school' && kind !== 'event') {
                    fields += '<input type="text" class="semsetup-course-input" data-sem-item-field="courseName" data-item-id="' + esc(item.id) + '" value="' + esc(item.courseName) + '" placeholder="Class" aria-label="Class">';
                }
                if (kind === 'course') {
                    fields += '<input type="text" data-sem-item-field="teacher" data-item-id="' + esc(item.id) + '" value="' + esc(item.teacher) + '" placeholder="Teacher" aria-label="Teacher">';
                }
                return '<div class="semsetup-item-row' + (item.approved ? '' : ' is-skipped') + (item.duplicate ? ' is-duplicate' : '') + '">'
                    + '<label class="semsetup-approve"><input type="checkbox" data-sem-item-field="approved" data-item-id="' + esc(item.id) + '"' + (item.approved ? ' checked' : '') + ' aria-label="Approve item"></label>'
                    + '<div class="semsetup-item-fields">' + fields + '</div>'
                    + '<span class="semsetup-conf semsetup-conf-' + item.confidence + '" title="Source: ' + esc(item.sourceSnippet) + '">'
                    + (item.provenance === 'ai' ? 'AI · ' : '') + item.confidence
                    + (item.duplicate ? ' · possible duplicate' : '') + '</span>'
                    + '</div>';
            }).join('');
            return '<details class="semsetup-group" open>'
                + '<summary><i class="fas ' + meta.icon + '" aria-hidden="true"></i> ' + meta.label
                + ' <span class="semsetup-group-count">' + list.length + '</span>'
                + ' <span class="semsetup-group-target">→ ' + meta.target + '</span></summary>'
                + rows + '</details>';
        }).join('');

        var approvedCount = draft.items.filter(function (i) { return i.approved; }).length;

        var aiStatusHtml = '';
        if (aiImproving) {
            aiStatusHtml = '<div class="semsetup-ai-status is-busy" role="status" aria-live="polite"><span class="semsetup-ai-spinner" aria-hidden="true"></span> Reading your materials with AI…</div>';
        } else if (aiStatus && aiStatus.text) {
            aiStatusHtml = '<div class="semsetup-ai-status is-' + esc(aiStatus.kind || 'info') + '" role="status" aria-live="polite">' + esc(aiStatus.text) + '</div>';
        }

        return '<section class="semsetup-section">'
            + '<div class="semsetup-review-head">'
            + '<p class="semsetup-lede">Found <strong>' + draft.items.length + '</strong> item' + (draft.items.length === 1 ? '' : 's') + '. Uncheck anything you don’t want. Nothing is written until you click Apply.</p>'
            + '<div class="semsetup-review-tools">'
            + '<button type="button" class="semsetup-mini-btn" data-sem-action="back-to-sources">← Materials</button>'
            + (aiAvailable
                ? '<button type="button" class="semsetup-mini-btn semsetup-ai-btn" data-sem-action="improve-ai"' + (aiImproving ? ' disabled' : '') + ' title="Sends your pasted/uploaded text to the AI provider you configured. Sutra asks before sending.">' + (aiImproving ? '✨ Thinking…' : '✨ Improve with AI') + '</button>'
                : '')
            + '</div></div>'
            + aiStatusHtml
            + (groupsHtml || '<div class="semsetup-empty">Nothing extracted yet — go back and add materials, or use Improve with AI.</div>')
            + '<div class="semsetup-foot-actions">'
            + '<span class="semsetup-apply-note">' + approvedCount + ' item' + (approvedCount === 1 ? '' : 's') + ' will be created</span>'
            + '<button type="button" class="neumo-btn btn-primary semsetup-btn" data-sem-action="apply"' + (approvedCount ? '' : ' disabled') + '>Apply to workspace</button>'
            + '</div></section>';
    }

    function renderDoneStep(draft) {
        var counts = draft.appliedCounts || {};
        var lines = Object.keys(KIND_META).map(function (kind) {
            if (!counts[kind]) return '';
            return '<li>' + counts[kind] + ' → ' + KIND_META[kind].target + '</li>';
        }).join('');
        return '<section class="semsetup-section semsetup-done">'
            + '<div class="semsetup-done-icon"><i class="fas fa-circle-check" aria-hidden="true"></i></div>'
            + '<h4>Semester is set up</h4>'
            + '<ul class="semsetup-done-list">' + (lines || '<li>Nothing was applied.</li>') + '</ul>'
            + '<p class="semsetup-lede">Every change is listed in Assistant Activity. Next steps that make this even better:</p>'
            + '<div class="semsetup-done-actions">'
            + '<button type="button" class="neumo-btn semsetup-btn" data-sem-action="open-schedule">Set up rotation &amp; periods</button>'
            + '<button type="button" class="neumo-btn semsetup-btn" data-sem-action="open-courses">Open Course Hub</button>'
            + '<button type="button" class="neumo-btn btn-primary semsetup-btn" data-sem-close>Done</button>'
            + '</div></section>';
    }

    // ---- Source handling -----------------------------------------------------------
    function addSource(name, fileType, text) {
        var draft = getActiveDraft();
        if (!draft) return;
        var source = {
            id: uid('src'), name: name, fileType: fileType,
            textChars: text.length, text: text.slice(0, 400000),
            aiUsed: false, addedAt: new Date().toISOString()
        };
        draft.sources.push(source);
        // Local extraction happens immediately — and only locally.
        var result = fileType === 'ics' ? parseIcsSource(text, source) : parseSourceText(text, source);
        result.items.forEach(function (item) {
            if (isDuplicateOfExisting(item, draft.items)) return;
            item.duplicate = checkWorkspaceDuplicate(item);
            draft.items.push(item);
        });
        saveDraft(draft);
        render();
        toast('Parsed locally — found ' + result.items.length + ' item' + (result.items.length === 1 ? '' : 's') + ' in "' + name + '".');
    }

    function isDuplicateOfExisting(item, items) {
        return items.some(function (other) {
            return other.kind === item.kind
                && other.title.toLowerCase() === item.title.toLowerCase()
                && other.date === item.date
                && other.courseName.toLowerCase() === item.courseName.toLowerCase();
        });
    }

    function checkWorkspaceDuplicate(item) {
        try {
            var intel = global.sutraIntelligence || global.flowIntelligence;
            if (intel && typeof intel.detectDuplicate === 'function' && (item.kind === 'assignment' || item.kind === 'exam')) {
                var dup = intel.detectDuplicate({ title: item.title, dueDate: item.date });
                return !!(dup && (dup.isDuplicate || dup.duplicate || dup.match));
            }
            if (item.kind === 'course' && global.courseHub && typeof global.courseHub.getCourses === 'function') {
                return (global.courseHub.getCourses({ filter: 'all' }) || []).some(function (c) {
                    return String(c.name || '').toLowerCase() === item.title.toLowerCase();
                });
            }
        } catch (e) { /* non-critical */ }
        return false;
    }

    function handleFilesSelected(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        files.slice(0, 6).forEach(function (file) {
            var lowerName = file.name.toLowerCase();
            var isIcs = /\.ics$/.test(lowerName);
            var isSupported = isIcs || /\.(txt|md|markdown|csv)$/.test(lowerName)
                || /^text\//.test(file.type || '');
            if (!isSupported) {
                toast('"' + file.name + '" isn’t supported here yet — paste its text instead. (PDFs: copy the text out, or attach them to a course in Course Hub.)');
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                addSource(file.name, isIcs ? 'ics' : (/\.csv$/.test(lowerName) ? 'csv' : 'text'), String(reader.result || ''));
            };
            reader.readAsText(file);
        });
    }

    // ---- AI assist -------------------------------------------------------------------
    var AI_SYSTEM_PROMPT = 'You are an academic-document extraction engine inside Sutra, a local-first student workspace. '
        + 'Read the user\'s school materials (syllabi, portal text, calendars) and return ONLY a JSON object — no prose — shaped exactly like: '
        + '{"courses":[{"title":"","teacher":"","teacherEmail":"","room":""}],'
        + '"gradingCategories":[{"title":"","weight":40,"courseName":""}],'
        + '"assignments":[{"title":"","date":"YYYY-MM-DD","courseName":""}],'
        + '"exams":[{"title":"","date":"YYYY-MM-DD","courseName":""}],'
        + '"events":[{"title":"","date":"YYYY-MM-DD","time":"HH:MM"}],'
        + '"recurringClasses":[{"courseName":"","days":[1,3,5],"time":"HH:MM","endTime":"HH:MM"}],'
        + '"noSchoolDays":[{"title":"","date":"YYYY-MM-DD"}]}. '
        + 'days uses 0=Sunday..6=Saturday. Omit anything you are not reasonably sure about. Dates must be ISO. Use the current or upcoming school year for missing years.';

    function improveWithAi() {
        if (aiImproving) return; // already in flight — ignore double-clicks
        var draft = getActiveDraft();
        if (!draft || !draft.sources.length) return;
        var bridge = global.SutraIntelligenceBridge;
        if (!bridge || typeof bridge.extractStructured !== 'function') {
            aiStatus = { kind: 'error', text: 'AI assist needs a configured provider in Settings.' };
            render();
            toast(aiStatus.text);
            return;
        }
        var combined = draft.sources.map(function (s) {
            return '=== SOURCE: ' + s.name + ' ===\n' + s.text;
        }).join('\n\n').slice(0, 120000);

        // Show progress IN the modal — toasts render behind it, so the wizard
        // must surface its own status or the action looks like it did nothing.
        aiImproving = true;
        aiStatus = null;
        render();
        toast('Asking your AI provider to re-read the materials…');

        var finish = function (status) {
            aiImproving = false;
            aiStatus = status;
            render();
            if (status && status.text) toast(status.text);
        };

        bridge.extractStructured({
            kind: 'semester-setup',
            systemPrompt: AI_SYSTEM_PROMPT,
            userText: combined,
            maxTokens: 4096
        }).then(function (result) {
            if (!result || !result.ok) {
                finish({
                    kind: result && result.cancelled ? 'info' : 'error',
                    text: result && result.cancelled ? 'Cancelled — nothing was sent.' : ('AI extraction failed: ' + (result && result.errorMessage ? result.errorMessage : 'unknown error'))
                });
                return;
            }
            var added = mergeAiResult(result.value);
            var current = getActiveDraft();
            if (current) {
                current.sources.forEach(function (s) { s.aiUsed = true; });
                saveDraft(current);
            }
            finish({
                kind: added ? 'ok' : 'info',
                text: added ? ('AI found ' + added + ' additional item' + (added === 1 ? '' : 's') + '.') : 'AI didn’t find anything new beyond the local parse.'
            });
        }).catch(function (e) {
            if (typeof global.SutraReportError === 'function') global.SutraReportError(e, { where: 'semester-setup.improveWithAi' }, 'error');
            finish({ kind: 'error', text: 'AI request failed — nothing was changed.' });
        });
    }

    function mergeAiResult(value) {
        var draft = getActiveDraft();
        if (!draft || !value || typeof value !== 'object') return 0;
        var added = 0;
        var push = function (raw, kind) {
            var item = normalizeItem(Object.assign({}, raw, {
                kind: kind,
                title: raw.title || raw.courseName || '',
                provenance: 'ai',
                confidence: 'medium'
            }));
            if (!item) return;
            if (isDuplicateOfExisting(item, draft.items)) return;
            item.duplicate = checkWorkspaceDuplicate(item);
            draft.items.push(item);
            added += 1;
        };
        (Array.isArray(value.courses) ? value.courses : []).forEach(function (c) { push(c, 'course'); });
        (Array.isArray(value.gradingCategories) ? value.gradingCategories : []).forEach(function (g) { push(g, 'grading_category'); });
        (Array.isArray(value.assignments) ? value.assignments : []).forEach(function (a) { push(a, 'assignment'); });
        (Array.isArray(value.exams) ? value.exams : []).forEach(function (x) { push(x, 'exam'); });
        (Array.isArray(value.events) ? value.events : []).forEach(function (ev) { push(ev, 'event'); });
        (Array.isArray(value.recurringClasses) ? value.recurringClasses : []).forEach(function (r) {
            push(Object.assign({}, r, { title: (r.courseName || 'Class') + ' meeting' }), 'recurring_class');
        });
        (Array.isArray(value.noSchoolDays) ? value.noSchoolDays : []).forEach(function (n) { push(n, 'no_school'); });
        saveDraft(draft);
        return added;
    }

    // ---- Apply ------------------------------------------------------------------------
    function createHomeworkTask(item, isExam) {
        try {
            var store = global.SutraHomeworkStore;
            if (!store || typeof store.transact !== 'function') throw new Error('Canonical homework store is unavailable.');
            var now = new Date().toISOString();
            store.transact(function (workspace) {
                var name = String(item.courseName || '').trim();
                var course = workspace.courses.find(function (candidate) {
                    return String(candidate.name || '').toLowerCase() === name.toLowerCase();
                });
                if (!course && name) {
                    course = { id: uid('hwc'), name: name, type: 'class', createdAt: now, updatedAt: now };
                    workspace.courses.push(course);
                }
                workspace.tasks.push({
                    id: uid('hw'),
                    courseId: course ? course.id : '',
                    title: item.title,
                    text: item.title,
                    done: false,
                    dueDate: item.date,
                    dueTime: item.time || '',
                    due: item.date,
                    priority: isExam ? 'high' : 'medium',
                    difficulty: isExam ? 'hard' : 'medium',
                    recurrence: 'none',
                    notes: 'Imported by Semester Setup' + (item.sourceSnippet ? ' — “' + item.sourceSnippet.slice(0, 120) + '”' : ''),
                    createdAt: now,
                    updatedAt: now
                });
            }, { reason: 'semester-setup-import' });
            return true;
        } catch (e) {
            if (typeof global.SutraReportError === 'function') global.SutraReportError(e, { where: 'semester-setup.createHomeworkTask' }, 'error');
            return false;
        }
    }

    function applyDraft() {
        var draft = getActiveDraft();
        if (!draft) return;
        var approved = draft.items.filter(function (i) { return i.approved && !i.applied; });
        if (!approved.length) return;

        var counts = {};
        var courseIdByName = {};
        var createdIds = [];

        // 1) Courses first so later items can attach to them.
        approved.filter(function (i) { return i.kind === 'course'; }).forEach(function (item) {
            try {
                if (!global.courseHub || typeof global.courseHub.createCourse !== 'function') return;
                var existing = (global.courseHub.getCourses({ filter: 'all' }) || []).find(function (c) {
                    return String(c.name || '').toLowerCase() === item.title.toLowerCase();
                });
                var course = existing || global.courseHub.createCourse({
                    name: item.title,
                    type: /\bAP\b/.test(item.title) ? 'ap' : 'class',
                    teacherName: item.teacher,
                    teacherEmail: item.teacherEmail,
                    room: item.room,
                    syllabusSummary: item.details,
                    source: 'semester_setup'
                });
                if (course) {
                    courseIdByName[item.title.toLowerCase()] = String(course.id);
                    if (!existing) { counts.course = (counts.course || 0) + 1; createdIds.push({ kind: 'course', id: String(course.id) }); }
                    item.applied = true;
                }
            } catch (e) { console.warn('Semester setup: course create failed', e); }
        });

        var resolveCourseId = function (courseName) {
            var key = String(courseName || '').trim().toLowerCase();
            if (!key) return '';
            if (courseIdByName[key]) return courseIdByName[key];
            try {
                var match = (global.courseHub && global.courseHub.getCourses({ filter: 'all' }) || []).find(function (c) {
                    return String(c.name || '').toLowerCase() === key;
                });
                if (match) { courseIdByName[key] = String(match.id); return String(match.id); }
            } catch (e) { /* non-critical */ }
            return '';
        };

        // 2) Recurring class meetings → course.schedule entries.
        approved.filter(function (i) { return i.kind === 'recurring_class'; }).forEach(function (item) {
            var courseId = resolveCourseId(item.courseName);
            if (!courseId || !global.courseHub || typeof global.courseHub.updateCourse !== 'function') return;
            try {
                var course = global.courseHub.getCourseById(courseId);
                if (!course) return;
                var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                var schedule = Array.isArray(course.schedule) ? course.schedule.slice() : [];
                (item.days.length ? item.days : [1]).forEach(function (d) {
                    schedule.push({ day: dayNames[d], startTime: item.time, endTime: item.endTime || '', location: item.room || '' });
                });
                global.courseHub.updateCourse(courseId, { schedule: schedule });
                counts.recurring_class = (counts.recurring_class || 0) + 1;
                item.applied = true;
            } catch (e) { console.warn('Semester setup: schedule update failed', e); }
        });

        // 3) Grading categories → Grade Planner (grouped per course).
        var gradingByCourse = {};
        approved.filter(function (i) { return i.kind === 'grading_category'; }).forEach(function (item) {
            var key = String(item.courseName || '').trim().toLowerCase();
            if (!gradingByCourse[key]) gradingByCourse[key] = [];
            gradingByCourse[key].push(item);
        });
        Object.keys(gradingByCourse).forEach(function (key) {
            var courseId = resolveCourseId(key);
            if (!courseId || !global.SutraGradePlanner) return;
            try {
                global.SutraGradePlanner.setCategoriesForCourse(courseId, gradingByCourse[key].map(function (item) {
                    return { name: item.title, weight: item.weight === null ? 0 : item.weight, drops: 0 };
                }));
                gradingByCourse[key].forEach(function (item) {
                    item.applied = true;
                    counts.grading_category = (counts.grading_category || 0) + 1;
                });
            } catch (e) { console.warn('Semester setup: grading categories failed', e); }
        });

        // 4) Assignments + exams → Homework.
        approved.filter(function (i) { return i.kind === 'assignment' || i.kind === 'exam'; }).forEach(function (item) {
            if (createHomeworkTask(item, item.kind === 'exam')) {
                counts[item.kind] = (counts[item.kind] || 0) + 1;
                item.applied = true;
            }
        });
        try { global.dispatchEvent(new CustomEvent('homework:updated')); } catch (e) { /* non-critical */ }

        // 5) One-off events → Timeline blocks.
        approved.filter(function (i) { return i.kind === 'event'; }).forEach(function (item) {
            try {
                var fa = global.flowAtelier;
                if (!fa || !Array.isArray(fa.timeBlocks)) return;
                var start = item.time || '09:00';
                var startMins = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))) || 540;
                var endMins = Math.min(startMins + 60, 23 * 60 + 59);
                fa.timeBlocks.push({
                    id: 'semevt_' + Math.random().toString(36).slice(2, 10),
                    name: item.title,
                    date: item.date,
                    start: start,
                    end: pad2(Math.floor(endMins / 60)) + ':' + pad2(endMins % 60),
                    category: 'general',
                    recurrence: 'none',
                    source: 'semester_import',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
                fa.saveTimeBlocks();
                counts.event = (counts.event || 0) + 1;
                item.applied = true;
            } catch (e) { console.warn('Semester setup: event failed', e); }
        });

        // 6) No-school days → School Schedule overrides.
        var noSchool = approved.filter(function (i) { return i.kind === 'no_school'; });
        if (noSchool.length && global.SutraSchoolSchedule) {
            try {
                var ws = global.SutraSchoolSchedule.getState();
                noSchool.forEach(function (item) {
                    var exists = ws.overrides.some(function (o) { return o.date === item.date && o.kind === 'holiday'; });
                    if (!exists) {
                        ws.overrides.push({ id: uid('ovr'), date: item.date, kind: 'holiday', label: item.title, scheduleId: '', note: 'Semester Setup import' });
                    }
                    counts.no_school = (counts.no_school || 0) + 1;
                    item.applied = true;
                });
                global.SutraSchoolSchedule.setState(ws);
            } catch (e) { console.warn('Semester setup: overrides failed', e); }
        }

        draft.status = 'applied';
        draft.appliedAt = new Date().toISOString();
        draft.appliedCounts = counts;
        saveDraft(draft);

        var wsState = getWorkspaceState();
        wsState.lastCompletedAt = draft.appliedAt;
        setWorkspaceState(wsState);

        // Audit trail in the existing Assistant Activity log (undo-friendly record).
        try {
            var intel = global.sutraIntelligence || global.flowIntelligence;
            if (intel && typeof intel.logActivity === 'function') {
                intel.logActivity({
                    actionType: 'semester_setup_import',
                    summary: 'Semester Setup applied ' + Object.keys(counts).map(function (k) { return counts[k] + ' ' + k.replace('_', ' '); }).join(', '),
                    provider: draft.sources.some(function (s) { return s.aiUsed; }) ? 'mixed-local-ai' : 'local',
                    createdObjectIds: createdIds,
                    reversible: false,
                    status: 'applied'
                });
            }
        } catch (e) { /* non-critical */ }

        // Refresh dependent surfaces.
        try { if (typeof global.renderCourseHubView === 'function') global.renderCourseHubView(); } catch (e) { /* non-critical */ }
        try { if (global.flowAtelier) { global.flowAtelier.renderTimeline(); global.flowAtelier.persistAppData(); } } catch (e) { /* non-critical */ }
        try { if (global.SutraNotifications) global.SutraNotifications.refresh(); } catch (e) { /* non-critical */ }
        try { if (global.SutraSchoolSchedule) global.SutraSchoolSchedule.renderTodayStrip(); } catch (e) { /* non-critical */ }

        activeStep = 'done';
        render();
        toast('Semester applied — everything is in your workspace.');
    }

    // ---- Field + action handlers ---------------------------------------------------
    function handleItemFieldChange(el) {
        var draft = getActiveDraft();
        if (!draft) return;
        var itemId = el.dataset.itemId;
        var field = el.dataset.semItemField;
        draft.items.forEach(function (item) {
            if (item.id !== itemId) return;
            if (field === 'approved') item.approved = el.checked;
            else if (field === 'weight') item.weight = el.value === '' ? null : Number(el.value);
            else if (field === 'title' || field === 'date' || field === 'courseName' || field === 'teacher') item[field] = el.value;
        });
        saveDraft(draft);
        if (field === 'approved') render();
    }

    function handleAction(btn) {
        var action = btn.dataset.semAction;
        var draft = getActiveDraft();
        if (action === 'add-paste') {
            var area = document.getElementById('semPasteArea');
            var text = area ? area.value.trim() : '';
            if (!text) { toast('Paste some text first.'); return; }
            addSource('Pasted text (' + new Date().toLocaleTimeString() + ')', 'text', text);
        } else if (action === 'remove-source') {
            if (!draft) return;
            var sid = btn.dataset.sourceId;
            draft.sources = draft.sources.filter(function (s) { return s.id !== sid; });
            draft.items = draft.items.filter(function (i) { return i.sourceId !== sid; });
            saveDraft(draft);
            render();
        } else if (action === 'to-review') {
            activeStep = 'review';
            render();
        } else if (action === 'back-to-sources') {
            activeStep = 'sources';
            aiStatus = null;
            render();
        } else if (action === 'improve-ai') {
            improveWithAi();
        } else if (action === 'apply') {
            applyDraft();
        } else if (action === 'open-schedule') {
            closeWizard();
            if (global.SutraSchoolSchedule) global.SutraSchoolSchedule.openManager();
        } else if (action === 'open-courses') {
            closeWizard();
            if (global.flowAtelier) global.flowAtelier.setActiveView('courses');
        }
    }

    // ---- Public API ------------------------------------------------------------------
    global.getDefaultSemesterSetup = getDefaultSemesterSetup;
    global.normalizeSemesterSetup = normalizeSemesterSetup;
    global.SutraSemesterSetup = {
        VERSION: 1,
        engine: Engine,
        open: openWizard,
        close: closeWizard,
        parseSourceText: parseSourceText
    };

}(typeof window !== 'undefined' ? window : globalThis));
