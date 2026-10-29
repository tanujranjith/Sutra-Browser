/* ==========================================================================
   Sutra Grade Planner — grade forecasting & GPA scenario planning
   ==========================================================================
   Deterministic, local calculation engine for course grades:
   - Weighted grading categories with assignment-level scores
   - Missing / pending / excused work handling (+ N lowest drops)
   - Target grades and "what do I need on the final?" solving
   - Missing-work impact ranking ("which item moves my grade most?")
   - Weighted & unweighted GPA estimates across courses

   All math runs on-device and never touches an AI model. Sutra Intelligence
   may *describe* these numbers, but it never computes them.

   State lives in appData.gradePlanner (full .sutra backup coverage) and the
   summary (current %, letter, category weights) is written through to the
   Course Hub course record so existing surfaces stay in sync.
   ========================================================================== */

/* global window, document */

(function (global) {
    'use strict';

    var ENTRY_STATUSES = ['graded', 'missing', 'pending', 'excused'];
    var COURSE_LEVELS = ['regular', 'honors', 'ap'];
    // A single course can legitimately carry more than three credits in some
    // block, vocational, dual-enrollment, and international programs. Eight is
    // a generous per-course ceiling that still rejects malformed huge weights.
    var MAX_COURSE_CREDITS = 8;

    var DEFAULT_LETTER_SCALE = [
        ['A+', 97], ['A', 93], ['A-', 90],
        ['B+', 87], ['B', 83], ['B-', 80],
        ['C+', 77], ['C', 73], ['C-', 70],
        ['D+', 67], ['D', 63], ['D-', 60],
        ['F', 0]
    ];
    var GPA_POINTS = {
        'A+': 4.0, 'A': 4.0, 'A-': 3.7,
        'B+': 3.3, 'B': 3.0, 'B-': 2.7,
        'C+': 2.3, 'C': 2.0, 'C-': 1.7,
        'D+': 1.3, 'D': 1.0, 'D-': 0.7,
        'F': 0.0
    };

    function uid(prefix) {
        return (prefix || 'gp') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    function round1(n) { return Math.round(n * 10) / 10; }
    function round2(n) { return Math.round(n * 100) / 100; }

    // ---- Normalization -------------------------------------------------------
    function getDefaultGradePlanner() {
        return {
            schemaVersion: 1,
            courses: {},
            settings: {
                gpaScale: '4.0',
                honorsBoost: 0.5,
                apBoost: 1.0,
                missingCountsAsZero: true
            }
        };
    }

    function normalizeCategory(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        if (!name) return null;
        var weight = Number(raw.weight);
        var drops = Math.max(0, Math.min(10, Math.round(Number(raw.drops) || 0)));
        return {
            id: String(raw.id || uid('cat')),
            name: name,
            weight: Number.isFinite(weight) ? Math.max(0, Math.min(100, weight)) : 0,
            drops: drops
        };
    }

    function normalizeEntry(raw, categoryIds) {
        if (!raw || typeof raw !== 'object') return null;
        var title = String(raw.title || '').trim();
        if (!title) return null;
        var status = ENTRY_STATUSES.indexOf(String(raw.status)) !== -1 ? String(raw.status) : 'graded';
        var score = Number(raw.score);
        var maxScore = Number(raw.maxScore);
        var categoryId = String(raw.categoryId || '');
        if (categoryIds && categoryIds.length && categoryIds.indexOf(categoryId) === -1) {
            categoryId = '';
        }
        return {
            id: String(raw.id || uid('ge')),
            categoryId: categoryId,
            title: title,
            score: Number.isFinite(score) ? Math.max(0, score) : 0,
            maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100,
            status: status,
            date: String(raw.date || '').trim(),
            homeworkTaskId: String(raw.homeworkTaskId || '').trim()
        };
    }

    function normalizeCourseGrades(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        var categories = Array.isArray(source.categories)
            ? source.categories.map(normalizeCategory).filter(Boolean) : [];
        var categoryIds = categories.map(function (c) { return c.id; });
        var entries = Array.isArray(source.entries)
            ? source.entries.map(function (e) { return normalizeEntry(e, categoryIds); }).filter(Boolean) : [];
        // Number(null) === 0, which would invent a 0% target and make every
        // target-less course read "safe" (computeGradeRisk guards this, but the
        // normalizer must not manufacture the 0 in the first place).
        var target = (source.targetPercent === null || source.targetPercent === undefined || source.targetPercent === '')
            ? NaN : Number(source.targetPercent);
        var gpaMeta = source.gpa && typeof source.gpa === 'object' ? source.gpa : {};
        var credits = Number(gpaMeta.credits);
        return {
            categories: categories,
            entries: entries,
            targetPercent: Number.isFinite(target) ? Math.max(0, Math.min(110, target)) : null,
            gpa: {
                credits: Number.isFinite(credits) && credits > 0 ? Math.min(MAX_COURSE_CREDITS, credits) : 1,
                level: COURSE_LEVELS.indexOf(String(gpaMeta.level)) !== -1 ? String(gpaMeta.level) : 'regular',
                includeInGpa: gpaMeta.includeInGpa !== false
            }
        };
    }

    function normalizeGradePlanner(raw) {
        var out = getDefaultGradePlanner();
        if (!raw || typeof raw !== 'object') return out;
        var courses = raw.courses && typeof raw.courses === 'object' ? raw.courses : {};
        Object.keys(courses).forEach(function (courseId) {
            var key = String(courseId || '').trim();
            if (!key) return;
            out.courses[key] = normalizeCourseGrades(courses[key]);
        });
        var st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
        var honorsBoost = Number(st.honorsBoost);
        var apBoost = Number(st.apBoost);
        out.settings = {
            gpaScale: '4.0',
            honorsBoost: Number.isFinite(honorsBoost) ? Math.max(0, Math.min(2, honorsBoost)) : 0.5,
            apBoost: Number.isFinite(apBoost) ? Math.max(0, Math.min(2, apBoost)) : 1.0,
            missingCountsAsZero: st.missingCountsAsZero !== false
        };
        return out;
    }

    // ---- Deterministic grade math ---------------------------------------------
    function letterFromPercent(percent) {
        if (!Number.isFinite(percent)) return '';
        for (var i = 0; i < DEFAULT_LETTER_SCALE.length; i++) {
            if (percent >= DEFAULT_LETTER_SCALE[i][1]) return DEFAULT_LETTER_SCALE[i][0];
        }
        return 'F';
    }

    function countableEntries(entries, options) {
        var missingAsZero = !options || options.missingCountsAsZero !== false;
        return entries.filter(function (e) {
            if (!e || typeof e !== 'object') return false;
            if (e.status === 'graded') return true;
            if (e.status === 'missing') return missingAsZero;
            return false; // pending + excused never count
        }).map(function (e) {
            return {
                id: e.id,
                categoryId: e.categoryId,
                title: e.title,
                score: e.status === 'missing' ? 0 : e.score,
                maxScore: e.maxScore,
                status: e.status
            };
        });
    }

    function applyDrops(list, drops) {
        if (!drops || list.length <= drops) return drops ? [] : list;
        var sorted = list.slice().sort(function (a, b) {
            return (a.score / a.maxScore) - (b.score / b.maxScore);
        });
        var dropped = {};
        sorted.slice(0, drops).forEach(function (e) { dropped[e.id] = true; });
        return list.filter(function (e) { return !dropped[e.id]; });
    }

    /**
     * Compute the course grade from categories + entries.
     * Returns { percent, letter, mode, byCategory: [...], missingCount, gradedCount, pendingCount, excusedCount }.
     * percent is null when there is no countable work yet.
     */
    function computeCourseGrade(courseData, options) {
        var data = courseData || { categories: [], entries: [] };
        var opts = options || {};
        var entries = countableEntries(Array.isArray(data.entries) ? data.entries : [], opts);
        var allEntries = (Array.isArray(data.entries) ? data.entries : []).filter(function (e) { return e && typeof e === 'object'; });
        var missingCount = allEntries.filter(function (e) { return e.status === 'missing'; }).length;
        var gradedCount = allEntries.filter(function (e) { return e.status === 'graded'; }).length;
        var pendingCount = allEntries.filter(function (e) { return e.status === 'pending'; }).length;
        var excusedCount = allEntries.filter(function (e) { return e.status === 'excused'; }).length;
        var categories = (Array.isArray(data.categories) ? data.categories : []).filter(function (c) { return c && c.weight > 0; });

        var result = {
            percent: null,
            letter: '',
            mode: categories.length ? 'weighted' : 'points',
            byCategory: [],
            missingCount: missingCount,
            gradedCount: gradedCount,
            pendingCount: pendingCount,
            excusedCount: excusedCount
        };

        if (!categories.length) {
            // Points mode — pool everything.
            var earned = 0;
            var possible = 0;
            entries.forEach(function (e) { earned += e.score; possible += e.maxScore; });
            if (possible > 0) result.percent = round2((earned / possible) * 100);
            result.letter = letterFromPercent(result.percent);
            return result;
        }

        var weightWithData = 0;
        var weightedSum = 0;
        categories.forEach(function (cat) {
            var inCat = applyDrops(entries.filter(function (e) { return e.categoryId === cat.id; }), cat.drops);
            var earned = 0;
            var possible = 0;
            inCat.forEach(function (e) { earned += e.score; possible += e.maxScore; });
            var pct = possible > 0 ? (earned / possible) * 100 : null;
            result.byCategory.push({
                id: cat.id,
                name: cat.name,
                weight: cat.weight,
                percent: pct === null ? null : round2(pct),
                earned: round2(earned),
                possible: round2(possible),
                entryCount: inCat.length,
                missingCount: allEntries.filter(function (e) { return e.categoryId === cat.id && e.status === 'missing'; }).length
            });
            if (pct !== null) {
                weightWithData += cat.weight;
                weightedSum += cat.weight * pct;
            }
        });
        if (weightWithData > 0) {
            result.percent = round2(weightedSum / weightWithData);
        }
        result.letter = letterFromPercent(result.percent);
        return result;
    }

    /**
     * Solve the score needed on a hypothetical new entry to hit targetPercent.
     * The overall grade is affine in the hypothetical score, so two evaluations
     * give an exact solution. Returns { possible, neededScore, neededPercent,
     * achievable, currentPercent }.
     */
    function scoreNeededForTarget(courseData, hypo, options) {
        var maxScore = Number(hypo && hypo.maxScore) > 0 ? Number(hypo.maxScore) : 100;
        var target = Number(hypo && hypo.targetPercent);
        var categoryId = String(hypo && hypo.categoryId || '');
        var current = computeCourseGrade(courseData, options);
        if (!Number.isFinite(target)) return { possible: false, currentPercent: current.percent };

        var evalWith = function (score) {
            var clone = {
                categories: courseData.categories,
                entries: (courseData.entries || []).concat([{
                    id: '__hypo__', categoryId: categoryId, title: 'hypothetical',
                    score: score, maxScore: maxScore, status: 'graded', date: '', homeworkTaskId: ''
                }])
            };
            var g = computeCourseGrade(clone, options);
            return g.percent === null ? null : g.percent;
        };

        var f0 = evalWith(0);
        var fMax = evalWith(maxScore);
        if (f0 === null || fMax === null || fMax === f0) {
            return { possible: false, currentPercent: current.percent };
        }
        var needed = (target - f0) / (fMax - f0) * maxScore;
        return {
            possible: true,
            currentPercent: current.percent,
            neededScore: round1(needed),
            neededPercent: round1((needed / maxScore) * 100),
            achievable: needed <= maxScore + 1e-9,
            alreadyMet: needed <= 0,
            projectedAtFull: round2(fMax),
            projectedAtZero: round2(f0)
        };
    }

    /** Projected grade if a hypothetical entry scores `score`. */
    function whatIfScore(courseData, hypo, options) {
        var clone = {
            categories: courseData.categories,
            entries: (courseData.entries || []).concat([{
                id: '__hypo__',
                categoryId: String(hypo && hypo.categoryId || ''),
                title: 'hypothetical',
                score: Number(hypo && hypo.score) || 0,
                maxScore: Number(hypo && hypo.maxScore) > 0 ? Number(hypo.maxScore) : 100,
                status: 'graded', date: '', homeworkTaskId: ''
            }])
        };
        return computeCourseGrade(clone, options);
    }

    /**
     * Rank open items (missing or pending) by how much completing them at 100%
     * would move the course grade. Returns sorted [{entryId, title, delta...}].
     */
    function rankImpact(courseData, options) {
        var entries = Array.isArray(courseData.entries) ? courseData.entries : [];
        var current = computeCourseGrade(courseData, options);
        var out = [];
        entries.forEach(function (e) {
            if (e.status !== 'missing' && e.status !== 'pending') return;
            var cloneEntries = entries.map(function (x) {
                if (x.id !== e.id) return x;
                return { id: x.id, categoryId: x.categoryId, title: x.title, score: x.maxScore, maxScore: x.maxScore, status: 'graded', date: x.date, homeworkTaskId: x.homeworkTaskId };
            });
            var g = computeCourseGrade({ categories: courseData.categories, entries: cloneEntries }, options);
            if (g.percent === null) return;
            var base = current.percent === null ? 0 : current.percent;
            out.push({
                entryId: e.id,
                title: e.title,
                status: e.status,
                delta: round2(g.percent - base),
                projected: g.percent
            });
        });
        out.sort(function (a, b) { return b.delta - a.delta; });
        return out;
    }

    /**
     * Grade Risk Radar scenarios. Upcoming assessments are pending entries or
     * explicit rows shaped as { id, title, categoryId, maxScore }. Every output
     * carries assumptions so incomplete gradebook data is never presented as a
     * precise prediction.
     */
    function projectGradeScenarios(courseData, scenario, options) {
        var data = normalizeCourseGrades(courseData);
        var settings = options || {};
        var input = scenario || {};
        var current = computeCourseGrade(data, settings);
        var upcoming = Array.isArray(input.upcomingAssessments)
            ? input.upcomingAssessments.slice()
            : data.entries.filter(function (entry) { return entry.status === 'pending'; });
        upcoming = upcoming.map(function (entry, index) {
            return {
                id: String(entry.id || ('upcoming-' + index)),
                title: String(entry.title || 'Upcoming assessment'),
                categoryId: String(entry.categoryId || ''),
                maxScore: Number(entry.maxScore) > 0 ? Number(entry.maxScore) : 100,
                date: String(entry.date || '')
            };
        });

        var assumptions = [];
        var categoryWeight = data.categories.reduce(function (sum, category) { return sum + Number(category.weight || 0); }, 0);
        if (data.categories.length && Math.abs(categoryWeight - 100) > 0.01) assumptions.push('Category weights total ' + round1(categoryWeight) + '%, so populated categories are reweighted by the current calculator.');
        if (data.targetPercent === null) assumptions.push('No target grade is set; risk uses absolute letter-grade thresholds.');
        if (current.percent === null) assumptions.push('No countable scores exist; the expected scenario uses the selected fallback score.');
        if (!upcoming.length) assumptions.push('No pending assessments with point values are entered; projected scenarios equal the current grade.');
        if (data.categories.length && upcoming.some(function (entry) { return !entry.categoryId; })) assumptions.push('At least one upcoming assessment has no grading category and may have no effect in weighted mode.');

        var expectedPercent = Number(input.expectedPercent);
        if (!Number.isFinite(expectedPercent)) expectedPercent = current.percent === null ? 75 : current.percent;
        expectedPercent = Math.max(0, Math.min(100, expectedPercent));

        function evaluate(percent) {
            var additions = upcoming.map(function (entry) {
                return {
                    id: '__scenario__' + entry.id,
                    categoryId: entry.categoryId,
                    title: entry.title,
                    score: entry.maxScore * percent / 100,
                    maxScore: entry.maxScore,
                    status: 'graded',
                    date: entry.date,
                    homeworkTaskId: ''
                };
            });
            return computeCourseGrade({ categories: data.categories, entries: data.entries.concat(additions) }, settings);
        }

        var worst = evaluate(0);
        var expected = evaluate(expectedPercent);
        var best = evaluate(100);
        var leverage = upcoming.map(function (entry) {
            var zero = whatIfScore(data, { categoryId: entry.categoryId, score: 0, maxScore: entry.maxScore }, settings);
            var full = whatIfScore(data, { categoryId: entry.categoryId, score: entry.maxScore, maxScore: entry.maxScore }, settings);
            return {
                id: entry.id,
                title: entry.title,
                categoryId: entry.categoryId,
                maxScore: entry.maxScore,
                date: entry.date,
                swing: zero.percent === null || full.percent === null ? null : round2(full.percent - zero.percent),
                projectedAtZero: zero.percent,
                projectedAtFull: full.percent
            };
        }).sort(function (a, b) { return Number(b.swing || 0) - Number(a.swing || 0); });

        var targetRequirement = null;
        if (data.targetPercent !== null && leverage.length) {
            targetRequirement = Object.assign({ assessmentId: leverage[0].id, title: leverage[0].title }, scoreNeededForTarget(data, {
                categoryId: leverage[0].categoryId,
                maxScore: leverage[0].maxScore,
                targetPercent: data.targetPercent
            }, settings));
        }
        return {
            current: current,
            risk: computeGradeRisk(data, settings),
            scenarios: {
                worst: { assumedScorePercent: 0, grade: worst },
                expected: { assumedScorePercent: round1(expectedPercent), grade: expected },
                best: { assumedScorePercent: 100, grade: best }
            },
            missingWorkImpact: rankImpact(data, settings),
            upcomingLeverage: leverage,
            targetRequirement: targetRequirement,
            assumptions: assumptions,
            confidence: assumptions.length === 0 ? 'high' : (assumptions.length <= 2 ? 'medium' : 'low')
        };
    }

    /**
     * GPA across courses. items: [{ percent, credits, level, includeInGpa }].
     * Returns { unweighted, weighted, totalCredits, courseCount }.
     */
    function computeGpa(items, settings) {
        var s = settings || getDefaultGradePlanner().settings;
        var totalCredits = 0;
        var unweightedSum = 0;
        var weightedSum = 0;
        var count = 0;
        (items || []).forEach(function (item) {
            if (!item || item.includeInGpa === false || !Number.isFinite(item.percent)) return;
            var letter = letterFromPercent(item.percent);
            var points = GPA_POINTS[letter];
            if (points === undefined) return;
            var rawCredits = Number(item.credits);
            var credits = Number.isFinite(rawCredits) && rawCredits > 0
                ? Math.min(MAX_COURSE_CREDITS, rawCredits) : 1;
            var boost = item.level === 'ap' ? s.apBoost : (item.level === 'honors' ? s.honorsBoost : 0);
            totalCredits += credits;
            unweightedSum += points * credits;
            weightedSum += (points + (points > 0 ? boost : 0)) * credits;
            count += 1;
        });
        if (!totalCredits) return { unweighted: null, weighted: null, totalCredits: 0, courseCount: 0 };
        return {
            unweighted: round2(unweightedSum / totalCredits),
            weighted: round2(weightedSum / totalCredits),
            totalCredits: totalCredits,
            courseCount: count
        };
    }

    /**
     * Deterministic risk classification for a course. Status is one of
     * safe | watch | risk | danger | unknown. When a target is set we measure
     * the gap to target; otherwise we fall back to absolute thresholds. Missing
     * work nudges the rating down. Returns { status, label, reason, percent,
     * target, delta, missingCount }. No AI — pure local math.
     */
    function computeGradeRisk(courseData, options) {
        var data = courseData || {};
        var grade = computeCourseGrade(data, options);
        var percent = grade.percent;
        // Guard against a non-numeric/NaN target (e.g. un-normalized Engine input):
        // an unguarded Number('A') = NaN would fall through every threshold and
        // mislabel a strong grade as "danger" with NaN in the reason. Note null/
        // undefined must stay null (Number(null) === 0 would invent a 0% target).
        var rawTarget = data.targetPercent;
        var target = (rawTarget === null || rawTarget === undefined || !Number.isFinite(Number(rawTarget)))
            ? null : Number(rawTarget);
        var missingCount = grade.missingCount || 0;
        if (percent === null) {
            return {
                status: 'unknown', label: 'No data',
                reason: missingCount ? (missingCount + ' item' + (missingCount === 1 ? '' : 's') + ' missing, but no graded work yet to compute a grade.') : 'No graded work entered yet — add scores to see your standing.',
                percent: null, target: target, delta: null, missingCount: missingCount
            };
        }
        var delta = target === null ? null : round2(percent - target);
        var status;
        if (target !== null) {
            if (delta >= 2) status = 'safe';
            else if (delta >= -1) status = 'watch';
            else if (delta >= -5) status = 'risk';
            else status = 'danger';
        } else {
            if (percent >= 90) status = 'safe';
            else if (percent >= 80) status = 'watch';
            else if (percent >= 70) status = 'risk';
            else status = 'danger';
        }
        // Missing work pulls an otherwise-comfortable grade down a notch.
        var order = ['safe', 'watch', 'risk', 'danger'];
        if (missingCount >= 2 && status === 'safe') status = 'watch';
        if (missingCount >= 4 && order.indexOf(status) < 2) status = order[Math.min(order.length - 1, order.indexOf(status) + 1)];

        var labels = { safe: 'On track', watch: 'Watch', risk: 'At risk', danger: 'Danger' };
        var bits = [percent.toFixed(1) + '%' + (grade.letter ? ' (' + grade.letter + ')' : '')];
        if (target !== null) bits.push(delta >= 0 ? ('+' + delta + ' vs target ' + target + '%') : (delta + ' vs target ' + target + '%'));
        if (missingCount) bits.push(missingCount + ' missing');
        return {
            status: status, label: labels[status] || 'Watch',
            reason: bits.join(' · '),
            percent: percent, target: target, delta: delta, missingCount: missingCount
        };
    }

    var Engine = {
        getDefaultGradePlanner: getDefaultGradePlanner,
        normalizeGradePlanner: normalizeGradePlanner,
        normalizeCourseGrades: normalizeCourseGrades,
        computeCourseGrade: computeCourseGrade,
        scoreNeededForTarget: scoreNeededForTarget,
        whatIfScore: whatIfScore,
        rankImpact: rankImpact,
        projectGradeScenarios: projectGradeScenarios,
        computeGradeRisk: computeGradeRisk,
        computeGpa: computeGpa,
        letterFromPercent: letterFromPercent
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Engine;
    }
    if (typeof window === 'undefined') return;

    // =========================================================================
    // Browser integration — Course Hub "Grades" tab
    // =========================================================================

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getPlanner() {
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.getGradePlanner === 'function') {
                return normalizeGradePlanner(global.SutraAcademicState.getGradePlanner());
            }
        } catch (e) { /* fall through */ }
        return getDefaultGradePlanner();
    }

    function setPlanner(next) {
        var normalized = normalizeGradePlanner(next);
        try {
            if (global.SutraAcademicState && typeof global.SutraAcademicState.setGradePlanner === 'function') {
                global.SutraAcademicState.setGradePlanner(normalized);
            }
        } catch (e) { console.warn('GradePlanner save failed', e); }
        return normalized;
    }

    function getCourseData(planner, courseId) {
        return normalizeCourseGrades(planner.courses[String(courseId)] || null);
    }

    /** Seed planner categories from a Course Hub course's legacy gradingCategories. */
    function seedFromCourse(courseId) {
        var planner = getPlanner();
        var key = String(courseId);
        if (planner.courses[key] && (planner.courses[key].categories.length || planner.courses[key].entries.length)) {
            return planner;
        }
        var course = null;
        try {
            if (global.courseHub && typeof global.courseHub.getCourseById === 'function') {
                course = global.courseHub.getCourseById(courseId);
            }
        } catch (e) { /* non-critical */ }
        var seeded = normalizeCourseGrades(null);
        if (course && Array.isArray(course.gradingCategories) && course.gradingCategories.length) {
            seeded.categories = course.gradingCategories.map(function (c) {
                return normalizeCategory({ id: c.id, name: c.name, weight: c.weight, drops: 0 });
            }).filter(Boolean);
        }
        var targetMatch = course && course.targetGrade ? String(course.targetGrade).match(/(\d{1,3}(?:\.\d+)?)\s*%/) : null;
        if (targetMatch) seeded.targetPercent = Number(targetMatch[1]);
        planner.courses[key] = seeded;
        return planner;
    }

    /** Write-through summary so the legacy course record + exports stay in sync. */
    function syncSummaryToCourse(courseId, courseData) {
        try {
            if (!global.courseHub || typeof global.courseHub.updateCourse !== 'function') return;
            var grade = computeCourseGrade(courseData, getPlanner().settings);
            var patch = {
                gradingCategories: courseData.categories.map(function (c, i) {
                    var byCat = null;
                    grade.byCategory.forEach(function (b) { if (b.id === c.id) byCat = b; });
                    return { id: c.id, name: c.name, weight: c.weight, currentPercent: byCat && byCat.percent !== null ? byCat.percent : null };
                })
            };
            if (grade.percent !== null) {
                patch.currentGrade = grade.letter + ' ' + grade.percent.toFixed(1) + '%';
            }
            if (courseData.targetPercent !== null) {
                patch.targetGrade = letterFromPercent(courseData.targetPercent) + ' ' + courseData.targetPercent + '%';
            }
            global.courseHub.updateCourse(courseId, patch);
        } catch (e) { /* non-critical */ }
    }

    function fmtPct(p) { return p === null || p === undefined ? '—' : (Math.round(p * 10) / 10) + '%'; }

    // ---- Grades tab rendering --------------------------------------------------
    function renderGradesTabHtml(course) {
        var planner = seedFromCourse(course.id);
        var data = getCourseData(planner, course.id);
        var grade = computeCourseGrade(data, planner.settings);
        var impact = rankImpact(data, planner.settings).slice(0, 5);

        var courseItems = collectGpaItems(planner);
        var gpa = computeGpa(courseItems, planner.settings);

        var deltaHtml = '';
        if (grade.percent !== null && data.targetPercent !== null) {
            var delta = round2(data.targetPercent - grade.percent);
            deltaHtml = delta <= 0
                ? '<span class="gp-delta gp-delta-good">Target met (+' + Math.abs(delta) + ')</span>'
                : '<span class="gp-delta gp-delta-gap">' + delta + ' pts to target</span>';
        }

        var risk = computeGradeRisk(data, planner.settings);
        var radar = projectGradeScenarios(data, null, planner.settings);
        var riskHtml = '<span class="gp-risk-badge gp-risk-' + risk.status + '" title="' + esc(risk.reason) + '">' + esc(risk.label) + '</span>';
        var radarScenarioHtml = ['worst', 'expected', 'best'].map(function (name) {
            var row = radar.scenarios[name];
            var label = name.charAt(0).toUpperCase() + name.slice(1);
            return '<div class="gp-radar-scenario gp-radar-' + name + '"><span>' + label + '</span><strong>'
                + (row.grade.percent === null ? '—' : row.grade.percent.toFixed(1) + '%')
                + '</strong><small>assumes ' + row.assumedScorePercent + '% on pending work</small></div>';
        }).join('');
        var radarAssumptionsHtml = radar.assumptions.length
            ? '<details class="gp-radar-assumptions"><summary>Assumptions (' + radar.assumptions.length + ')</summary><ul>'
                + radar.assumptions.map(function (assumption) { return '<li>' + esc(assumption) + '</li>'; }).join('') + '</ul></details>'
            : '<div class="gp-radar-confidence">High-confidence projection from complete entered data.</div>';
        var leverageTop = radar.upcomingLeverage[0];

        // Effort-vs-estimate signal: only when this COURSE has enough logged
        // times to calibrate (tier 'course'), and only when the ratio is
        // significant — same 0.15 threshold applyEffortCalibration uses.
        var effortHtml = '';
        try {
            var hw = global.SutraHomework;
            if (hw && typeof hw.getEffortCalibration === 'function') {
                var cal = hw.getEffortCalibration({ courseId: course.id });
                if (cal && cal.tier === 'course' && Math.abs(cal.ratio - 1) >= 0.15) {
                    var mult = (Math.round(cal.ratio * 10) / 10) + '×';
                    var slowAndRisky = cal.ratio > 1 && (risk.status === 'watch' || risk.status === 'risk' || risk.status === 'danger');
                    var effortTitle = cal.ratio > 1
                        ? 'Based on ' + cal.samples + ' logged times, work in this class takes about ' + mult + ' your estimates'
                          + (slowAndRisky ? ' — and this grade needs attention. Plan bigger blocks for it.' : '.')
                        : 'Based on ' + cal.samples + ' logged times, you finish this class’s work faster than you estimate (' + mult + ').';
                    effortHtml = '<span class="gp-effort-chip' + (slowAndRisky ? ' gp-effort-warn' : '') + '" title="' + esc(effortTitle) + '">Effort ' + mult + ' est.</span>';
                }
            }
        } catch (e) { /* non-critical */ }

        var categoryRows = data.categories.map(function (cat) {
            var byCat = null;
            grade.byCategory.forEach(function (b) { if (b.id === cat.id) byCat = b; });
            return '<div class="gp-cat-row" data-gp-cat="' + esc(cat.id) + '">'
                + '<input type="text" data-gp-field="cat-name" value="' + esc(cat.name) + '" aria-label="Category name">'
                + '<input type="number" min="0" max="100" data-gp-field="cat-weight" value="' + esc(cat.weight) + '" aria-label="Weight percent">'
                + '<input type="number" min="0" max="10" data-gp-field="cat-drops" value="' + esc(cat.drops) + '" aria-label="Lowest scores dropped" title="Drop N lowest">'
                + '<span class="gp-cat-pct">' + fmtPct(byCat ? byCat.percent : null)
                + (byCat && byCat.missingCount ? ' <span class="gp-missing-chip">' + byCat.missingCount + ' missing</span>' : '') + '</span>'
                + '<button type="button" class="gp-mini-btn danger" data-gp-action="remove-cat" aria-label="Remove category">&times;</button>'
                + '</div>';
        }).join('');

        var catOptions = function (selectedId) {
            var opts = data.categories.length ? [] : ['<option value="">All work</option>'];
            data.categories.forEach(function (c) {
                opts.push('<option value="' + esc(c.id) + '"' + (c.id === selectedId ? ' selected' : '') + '>' + esc(c.name) + '</option>');
            });
            return opts.join('');
        };

        var entryRows = data.entries.map(function (e) {
            return '<div class="gp-entry-row' + (e.status === 'missing' ? ' is-missing' : '') + '" data-gp-entry="' + esc(e.id) + '">'
                + '<input type="text" data-gp-field="entry-title" value="' + esc(e.title) + '" aria-label="Assignment title">'
                + '<select data-gp-field="entry-cat" aria-label="Category">' + catOptions(e.categoryId) + '</select>'
                + '<span class="gp-score-pair"><input type="number" min="0" step="0.5" data-gp-field="entry-score" value="' + esc(e.score) + '" aria-label="Score"'
                + (e.status !== 'graded' ? ' disabled' : '') + '>'
                + '<span>/</span><input type="number" min="1" step="0.5" data-gp-field="entry-max" value="' + esc(e.maxScore) + '" aria-label="Out of"></span>'
                + '<select data-gp-field="entry-status" aria-label="Status">'
                + ENTRY_STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === e.status ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'; }).join('')
                + '</select>'
                + '<button type="button" class="gp-mini-btn danger" data-gp-action="remove-entry" aria-label="Remove score">&times;</button>'
                + '</div>';
        }).join('');

        var impactHtml = impact.length
            ? impact.map(function (item) {
                return '<div class="gp-impact-row"><span class="gp-impact-title">' + esc(item.title) + '</span>'
                    + '<span class="gp-impact-chip' + (item.delta >= 1 ? ' is-big' : '') + '">+' + item.delta + ' pts if completed</span></div>';
            }).join('')
            : '<div class="gp-empty-line">No missing or pending work — nothing is dragging this grade.</div>';

        return '<section class="cw-panel cw-panel-full gp-panel">'
            + '<div class="cw-panel-head"><h3>Grade Forecast</h3>'
            + '<span class="gp-deterministic-note" title="All grade math runs locally and deterministically. AI never computes grades.">Calculated on-device — no AI</span></div>'

            + '<div class="gp-summary-row">'
            + '<div class="gp-summary-main"><span class="gp-grade-big">' + (grade.percent === null ? '—' : grade.percent.toFixed(1) + '%') + '</span>'
            + '<span class="gp-grade-letter">' + esc(grade.letter || 'No scores yet') + '</span>' + riskHtml + effortHtml + deltaHtml + '</div>'
            + '<label class="gp-target-field"><span>Target</span>'
            + '<input type="number" min="0" max="110" step="0.5" data-gp-field="target" value="' + (data.targetPercent === null ? '' : esc(data.targetPercent)) + '" placeholder="93"></label>'
            + '</div>'

            + '<div class="gp-risk-radar" aria-label="Grade Risk Radar">'
            + '<div class="gp-risk-radar-head"><strong>Grade Risk Radar</strong><span>Projection confidence: ' + esc(radar.confidence) + '</span></div>'
            + '<div class="gp-radar-scenarios">' + radarScenarioHtml + '</div>'
            + (leverageTop ? '<p class="gp-radar-leverage"><strong>Highest leverage:</strong> ' + esc(leverageTop.title) + (leverageTop.swing === null ? '' : ' could swing the course by ' + leverageTop.swing + ' points') + '.</p>' : '')
            + radarAssumptionsHtml
            + '</div>'

            + '<h4 class="cw-subhead">Weighted categories <span class="gp-head-hint">(weight % · drop lowest)</span></h4>'
            + '<div class="gp-cat-grid-head"><span>Category</span><span>Weight</span><span>Drops</span><span>Current</span><span></span></div>'
            + (categoryRows || '<div class="gp-empty-line">No categories — scores are pooled as total points.</div>')
            + '<button type="button" class="gp-mini-btn" data-gp-action="add-cat" data-gp-course="' + esc(course.id) + '">+ Add category</button>'

            + '<h4 class="cw-subhead">Scores</h4>'
            + (entryRows || '<div class="gp-empty-line">No scores yet. Add graded work, and mark anything unsubmitted as <strong>missing</strong> to see its real cost.</div>')
            + '<button type="button" class="gp-mini-btn" data-gp-action="add-entry" data-gp-course="' + esc(course.id) + '">+ Add score</button>'

            + '<h4 class="cw-subhead">Scenario planner</h4>'
            + '<div class="gp-scenario-box">'
            + '<div class="gp-scenario-inputs">'
            + '<select id="gpScenarioCategory" aria-label="Scenario category">' + catOptions('') + '</select>'
            + '<label class="gp-scn-field"><span>Worth</span><input type="number" id="gpScenarioMax" min="1" value="100" aria-label="Points possible"></label>'
            + '<button type="button" class="gp-mini-btn gp-scn-btn" data-gp-action="run-needed" data-gp-course="' + esc(course.id) + '">What do I need for my target?</button>'
            + '<label class="gp-scn-field"><span>If I score</span><input type="number" id="gpScenarioScore" min="0" value="85" aria-label="Hypothetical score"></label>'
            + '<button type="button" class="gp-mini-btn gp-scn-btn" data-gp-action="run-whatif" data-gp-course="' + esc(course.id) + '">Project my grade</button>'
            + '</div>'
            + '<div class="gp-scenario-result" id="gpScenarioResult" aria-live="polite">Pick a category and run a scenario — answers update instantly, fully offline.</div>'
            + '</div>'

            + '<h4 class="cw-subhead">Biggest wins</h4>'
            + impactHtml

            + '<h4 class="cw-subhead">GPA</h4>'
            + '<div class="gp-gpa-row">'
            + '<label class="gp-scn-field"><span>Credits</span><input type="number" min="0.5" max="8" step="0.5" data-gp-field="gpa-credits" value="' + esc(data.gpa.credits) + '"></label>'
            + '<label class="gp-scn-field"><span>Level</span><select data-gp-field="gpa-level">'
            + COURSE_LEVELS.map(function (l) { return '<option value="' + l + '"' + (l === data.gpa.level ? ' selected' : '') + '>' + (l === 'ap' ? 'AP / IB' : l.charAt(0).toUpperCase() + l.slice(1)) + '</option>'; }).join('')
            + '</select></label>'
            + '<label class="gp-scn-field gp-gpa-include"><input type="checkbox" data-gp-field="gpa-include"' + (data.gpa.includeInGpa ? ' checked' : '') + '><span>Count in GPA</span></label>'
            + '<div class="gp-gpa-summary">'
            + '<span>Unweighted: <strong>' + (gpa.unweighted === null ? '—' : gpa.unweighted.toFixed(2)) + '</strong></span>'
            + '<span>Weighted: <strong>' + (gpa.weighted === null ? '—' : gpa.weighted.toFixed(2)) + '</strong></span>'
            + '<span class="gp-gpa-meta">' + gpa.courseCount + ' course' + (gpa.courseCount === 1 ? '' : 's') + ' with scores</span>'
            + '</div></div>'
            + '<input type="hidden" id="gpActiveCourseId" value="' + esc(course.id) + '">'
            + '</section>';
    }

    function collectGpaItems(planner) {
        var items = [];
        var courses = [];
        try {
            if (global.courseHub && typeof global.courseHub.getCourses === 'function') {
                courses = global.courseHub.getCourses({ filter: 'active' }) || [];
            }
        } catch (e) { /* non-critical */ }
        courses.forEach(function (c) {
            var data = planner.courses[String(c.id)];
            if (!data) return;
            var normalized = normalizeCourseGrades(data);
            var grade = computeCourseGrade(normalized, planner.settings);
            if (grade.percent === null) return;
            items.push({
                courseId: c.id,
                percent: grade.percent,
                credits: normalized.gpa.credits,
                level: normalized.gpa.level,
                includeInGpa: normalized.gpa.includeInGpa
            });
        });
        return items;
    }

    // ---- DOM sync + actions ------------------------------------------------------
    function activeCourseId() {
        var el = document.getElementById('gpActiveCourseId');
        return el ? el.value : '';
    }

    function collectCourseDataFromDom(courseId) {
        var planner = getPlanner();
        var data = getCourseData(planner, courseId);
        var mount = document.getElementById('courseHubMount');
        if (!mount) return { planner: planner, data: data };

        var byId = {};
        data.categories.forEach(function (c) { byId[c.id] = c; });
        mount.querySelectorAll('.gp-cat-row').forEach(function (row) {
            var cat = byId[row.dataset.gpCat];
            if (!cat) return;
            var name = row.querySelector('[data-gp-field="cat-name"]');
            var weight = row.querySelector('[data-gp-field="cat-weight"]');
            var drops = row.querySelector('[data-gp-field="cat-drops"]');
            if (name) cat.name = name.value;
            if (weight) cat.weight = Number(weight.value) || 0;
            if (drops) cat.drops = Number(drops.value) || 0;
        });

        var entryById = {};
        data.entries.forEach(function (e) { entryById[e.id] = e; });
        mount.querySelectorAll('.gp-entry-row').forEach(function (row) {
            var entry = entryById[row.dataset.gpEntry];
            if (!entry) return;
            var title = row.querySelector('[data-gp-field="entry-title"]');
            var cat = row.querySelector('[data-gp-field="entry-cat"]');
            var score = row.querySelector('[data-gp-field="entry-score"]');
            var max = row.querySelector('[data-gp-field="entry-max"]');
            var status = row.querySelector('[data-gp-field="entry-status"]');
            if (title) entry.title = title.value;
            if (cat) entry.categoryId = cat.value;
            if (score) entry.score = Number(score.value) || 0;
            if (max) entry.maxScore = Number(max.value) || 100;
            if (status) entry.status = status.value;
        });

        var target = mount.querySelector('[data-gp-field="target"]');
        if (target) data.targetPercent = target.value === '' ? null : Number(target.value);
        var credits = mount.querySelector('[data-gp-field="gpa-credits"]');
        if (credits) data.gpa.credits = Number(credits.value) || 1;
        var level = mount.querySelector('[data-gp-field="gpa-level"]');
        if (level) data.gpa.level = level.value;
        var include = mount.querySelector('[data-gp-field="gpa-include"]');
        if (include) data.gpa.includeInGpa = include.checked;

        return { planner: planner, data: normalizeCourseGrades(data) };
    }

    function saveCourseData(courseId, data) {
        var planner = getPlanner();
        planner.courses[String(courseId)] = normalizeCourseGrades(data);
        setPlanner(planner);
        syncSummaryToCourse(courseId, planner.courses[String(courseId)]);
    }

    function rerenderGradesTab() {
        if (typeof global.cwSetCourseTab === 'function') {
            global.cwSetCourseTab('grades');
        }
    }

    function handleAction(btn) {
        var action = btn.dataset.gpAction;
        var courseId = btn.dataset.gpCourse || activeCourseId();
        if (!courseId) return;
        var collected = collectCourseDataFromDom(courseId);
        var data = collected.data;

        if (action === 'add-cat') {
            data.categories.push({ id: uid('cat'), name: 'New category', weight: 0, drops: 0 });
            saveCourseData(courseId, data);
            rerenderGradesTab();
        } else if (action === 'remove-cat') {
            var catRow = btn.closest('.gp-cat-row');
            if (catRow) {
                data.categories = data.categories.filter(function (c) { return c.id !== catRow.dataset.gpCat; });
                data.entries.forEach(function (e) { if (e.categoryId === catRow.dataset.gpCat) e.categoryId = ''; });
            }
            saveCourseData(courseId, data);
            rerenderGradesTab();
        } else if (action === 'add-entry') {
            data.entries.push({
                id: uid('ge'), categoryId: data.categories.length ? data.categories[0].id : '',
                title: 'New assignment', score: 0, maxScore: 100, status: 'pending', date: '', homeworkTaskId: ''
            });
            saveCourseData(courseId, data);
            rerenderGradesTab();
        } else if (action === 'remove-entry') {
            var entryRow = btn.closest('.gp-entry-row');
            if (entryRow) data.entries = data.entries.filter(function (e) { return e.id !== entryRow.dataset.gpEntry; });
            saveCourseData(courseId, data);
            rerenderGradesTab();
        } else if (action === 'run-needed' || action === 'run-whatif') {
            saveCourseData(courseId, data);
            var resultEl = document.getElementById('gpScenarioResult');
            var catSel = document.getElementById('gpScenarioCategory');
            var maxEl = document.getElementById('gpScenarioMax');
            var planner = getPlanner();
            var fresh = getCourseData(planner, courseId);
            if (!resultEl) return;
            if (action === 'run-needed') {
                if (fresh.targetPercent === null) {
                    resultEl.textContent = 'Set a target grade first (top right of this panel).';
                    return;
                }
                var solved = scoreNeededForTarget(fresh, {
                    categoryId: catSel ? catSel.value : '',
                    maxScore: maxEl ? Number(maxEl.value) || 100 : 100,
                    targetPercent: fresh.targetPercent
                }, planner.settings);
                if (!solved.possible) {
                    resultEl.textContent = 'Not enough graded work yet to project this scenario.';
                } else if (solved.alreadyMet) {
                    resultEl.innerHTML = 'You could score <strong>0</strong> and still hit ' + fresh.targetPercent + '% — target already locked in. 🎉';
                } else if (!solved.achievable) {
                    resultEl.innerHTML = 'You would need <strong>' + solved.neededScore + '</strong> (' + solved.neededPercent + '%) — above the maximum. Best possible finish: <strong>' + solved.projectedAtFull + '%</strong>. Consider what else can move the grade (see Biggest wins).';
                } else {
                    resultEl.innerHTML = 'You need <strong>' + solved.neededScore + ' / ' + (maxEl ? maxEl.value : 100) + '</strong> (' + solved.neededPercent + '%) to finish at ' + fresh.targetPercent + '%.';
                }
            } else {
                var scoreEl = document.getElementById('gpScenarioScore');
                var projected = whatIfScore(fresh, {
                    categoryId: catSel ? catSel.value : '',
                    score: scoreEl ? Number(scoreEl.value) || 0 : 0,
                    maxScore: maxEl ? Number(maxEl.value) || 100 : 100
                }, planner.settings);
                resultEl.innerHTML = projected.percent === null
                    ? 'Not enough graded work yet to project this scenario.'
                    : 'Projected course grade: <strong>' + projected.percent.toFixed(1) + '% (' + projected.letter + ')</strong>.';
            }
        }
    }

    var saveDebounce = null;
    function handleFieldChange() {
        var courseId = activeCourseId();
        if (!courseId) return;
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(function () {
            var collected = collectCourseDataFromDom(courseId);
            saveCourseData(courseId, collected.data);
            rerenderGradesTab();
        }, 600);
    }

    function init() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-gp-action]');
            if (btn) handleAction(btn);
        });
        document.addEventListener('change', function (e) {
            if (e.target.closest && e.target.closest('.gp-panel') && e.target.dataset && e.target.dataset.gpField) {
                handleFieldChange();
            }
        });
    }

    global.getDefaultGradePlanner = getDefaultGradePlanner;
    global.normalizeGradePlanner = normalizeGradePlanner;
    global.SutraGradePlanner = {
        VERSION: 1,
        engine: Engine,
        getPlanner: getPlanner,
        setPlanner: setPlanner,
        renderGradesTabHtml: renderGradesTabHtml,
        computeCourseGrade: computeCourseGrade,
        computeGradeRisk: computeGradeRisk,
        projectGradeScenarios: projectGradeScenarios,
        computeGpa: computeGpa,
        // Cumulative course grade after each dated score entry — a grade trend.
        computeGradeTrend: function (courseId) {
            var planner = getPlanner();
            var data = getCourseData(planner, courseId);
            if (!data) return [];
            var dated = (data.entries || []).filter(function (e) {
                return e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) && Number.isFinite(Number(e.score));
            }).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
            if (dated.length < 2) return [];
            var trend = [];
            for (var i = 0; i < dated.length; i += 1) {
                var g = computeCourseGrade({ categories: data.categories, entries: dated.slice(0, i + 1) });
                if (g && g.percent != null) trend.push({ date: dated[i].date, percent: Math.round(g.percent * 10) / 10 });
            }
            return trend;
        },
        addEntryForCourse: function (courseId, entry) {
            var planner = getPlanner();
            var data = getCourseData(planner, courseId);
            data.entries.push(normalizeEntry(entry, data.categories.map(function (c) { return c.id; })) || normalizeEntry({ title: 'Imported item' }));
            planner.courses[String(courseId)] = data;
            setPlanner(planner);
            syncSummaryToCourse(courseId, data);
        },
        setCategoriesForCourse: function (courseId, categories) {
            var planner = getPlanner();
            var data = getCourseData(planner, courseId);
            var normalized = (categories || []).map(normalizeCategory).filter(Boolean);
            if (normalized.length) data.categories = normalized;
            planner.courses[String(courseId)] = data;
            setPlanner(planner);
            syncSummaryToCourse(courseId, data);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

}(typeof window !== 'undefined' ? window : globalThis));
