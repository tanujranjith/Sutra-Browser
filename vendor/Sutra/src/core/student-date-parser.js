/*
 * student-date-parser.js — shared, local-first natural-language date/time parser.
 *
 * Sutra's quick entry points all need the same student vocabulary. Keeping this
 * pure module ahead of the feature scripts prevents Quick Capture, Homework
 * quick-add, and paste import from quietly disagreeing about "next Tuesday" or
 * "after school". It never reads storage or the DOM, and callers always pass a
 * clock when they need deterministic tests.
 */
(function (global) {
    'use strict';

    var WEEKDAYS = {
        sun: 0, sunday: 0,
        mon: 1, monday: 1,
        tue: 2, tues: 2, tuesday: 2,
        wed: 3, weds: 3, wednesday: 3,
        thu: 4, thur: 4, thurs: 4, thursday: 4,
        fri: 5, friday: 5,
        sat: 6, saturday: 6
    };
    var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var MONTH_ABBREVIATIONS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

    function validDate(value) {
        return value instanceof Date && !Number.isNaN(value.getTime()) ? new Date(value.getTime()) : new Date();
    }

    function localDateKey(value) {
        var d = validDate(value);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function startOfDay(value) {
        var d = validDate(value);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function addDays(base, count) {
        var d = startOfDay(base);
        d.setDate(d.getDate() + count);
        return d;
    }

    function monthIndex(name) {
        var normalized = String(name || '').toLowerCase().replace(/\.$/, '');
        var longIndex = MONTHS.indexOf(normalized);
        return longIndex >= 0 ? longIndex : MONTH_ABBREVIATIONS[normalized];
    }

    function inferredYear(base, month, day) {
        var today = startOfDay(base);
        var candidate = new Date(today.getFullYear(), month, day);
        if (candidate.getTime() < today.getTime() - 86400000) candidate.setFullYear(candidate.getFullYear() + 1);
        return candidate;
    }

    function weekdayDate(base, targetDay, modifier) {
        var today = startOfDay(base);
        var delta = (targetDay - today.getDay() + 7) % 7;
        // "next Friday" is intentionally the Friday in the following seven-day
        // period. Bare "Friday" remains the next occurrence (including today).
        if (modifier === 'next') delta = delta === 0 ? 7 : delta + 7;
        return addDays(today, delta);
    }

    function result(date, match, extra) {
        var out = { date: localDateKey(date), match: match };
        if (extra && extra.timeHint) out.timeHint = extra.timeHint;
        if (extra && extra.kind) out.kind = extra.kind;
        return out;
    }

    /**
     * Parse a date phrase without guessing when the phrase is absent. The
     * returned match is safe for callers to remove from a title verbatim.
     */
    function parseNaturalDate(text, options) {
        var input = String(text || '');
        var lower = input.toLowerCase();
        var base = validDate(options && options.now);
        if (!lower.trim()) return null;
        var match;

        if ((match = lower.match(/\b(after school|after class)\b/))) return result(base, match[0], { timeHint: '15:30', kind: 'after-school' });
        if ((match = lower.match(/\b(after dinner|after supper)\b/))) return result(base, match[0], { timeHint: '19:00', kind: 'after-dinner' });
        if ((match = lower.match(/\b(tonight|tn|eod|end of day)\b/))) return result(base, match[0], { timeHint: '19:00', kind: 'tonight' });
        if ((match = lower.match(/\b(today)\b/))) return result(base, match[0], { kind: 'today' });
        if ((match = lower.match(/\b(tomorrow|tmrw|tmro|tmr|tmw|tomo)\b/))) return result(addDays(base, 1), match[0], { kind: 'tomorrow' });

        if ((match = lower.match(/\bthis weekend\b/))) {
            return result(addDays(base, (6 - base.getDay() + 7) % 7), match[0], { kind: 'weekend' });
        }
        if ((match = lower.match(/\bnext weekend\b/))) {
            var nextSaturday = (6 - base.getDay() + 7) % 7;
            return result(addDays(base, nextSaturday + 7), match[0], { kind: 'next-weekend' });
        }
        if ((match = lower.match(/\bnext week\b/))) {
            var mondayOffset = ((1 - base.getDay() + 7) % 7) || 7;
            return result(addDays(base, mondayOffset), match[0], { kind: 'next-week' });
        }
        if ((match = lower.match(/\bin\s+(\d{1,3})\s*(days?|weeks?|months?)\b/))) {
            var amount = Number(match[1]);
            var unit = match[2];
            var shifted = startOfDay(base);
            if (unit.indexOf('month') === 0) shifted.setMonth(shifted.getMonth() + amount);
            else shifted = addDays(shifted, unit.indexOf('week') === 0 ? amount * 7 : amount);
            return result(shifted, match[0], { kind: 'relative' });
        }

        if ((match = lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
            var iso = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (iso.getMonth() === Number(match[2]) - 1 && iso.getDate() === Number(match[3])) return result(iso, match[0], { kind: 'iso' });
        }
        if ((match = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
            var month = Number(match[1]) - 1;
            var day = Number(match[2]);
            if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
                var year = match[3] ? Number(match[3]) : null;
                if (year !== null && year < 100) year += 2000;
                var numeric = year === null ? inferredYear(base, month, day) : new Date(year, month, day);
                if (numeric.getMonth() === month && numeric.getDate() === day) return result(numeric, match[0], { kind: 'numeric' });
            }
        }

        var monthNames = MONTHS.concat(Object.keys(MONTH_ABBREVIATIONS)).join('|');
        var monthFirst = new RegExp('\\b(' + monthNames + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b');
        if ((match = lower.match(monthFirst))) {
            var mfMonth = monthIndex(match[1]);
            var mfDay = Number(match[2]);
            var mfDate = match[3] ? new Date(Number(match[3]), mfMonth, mfDay) : inferredYear(base, mfMonth, mfDay);
            if (mfDate.getMonth() === mfMonth && mfDate.getDate() === mfDay) return result(mfDate, match[0], { kind: 'month-name' });
        }
        var dayFirst = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + monthNames + ')\\.?\\b');
        if ((match = lower.match(dayFirst))) {
            var dfMonth = monthIndex(match[2]);
            var dfDay = Number(match[1]);
            var dfDate = inferredYear(base, dfMonth, dfDay);
            if (dfDate.getMonth() === dfMonth && dfDate.getDate() === dfDay) return result(dfDate, match[0], { kind: 'month-name' });
        }

        var weekdayNames = Object.keys(WEEKDAYS).join('|');
        var weekday = new RegExp('\\b(next|this|on|by)?\\s*(' + weekdayNames + ')\\b', 'g');
        var weekdayMatch;
        while ((weekdayMatch = weekday.exec(lower)) !== null) {
            // "SAT" the College Board exam collides with "sat" = Saturday. Case is
            // lost in `lower`, so re-check the original text: an all-caps standalone
            // SAT is the exam, never a weekday — skip it so a real later weekday
            // word still parses and "SAT math practice" gets no spurious Saturday.
            if (weekdayMatch[2] === 'sat' && /\bSAT\b/.test(input.substr(weekdayMatch.index, weekdayMatch[0].length))) continue;
            return result(weekdayDate(base, WEEKDAYS[weekdayMatch[2]], String(weekdayMatch[1] || '').toLowerCase()), weekdayMatch[0].trim(), { kind: 'weekday' });
        }

        // Bare ordinals are deliberately last: they are useful for portal
        // pastes ("due the 14th") but too weak to override any clearer phrase.
        if ((match = lower.match(/\b(?:the\s+|by\s+)?(\d{1,2})(?:st|nd|rd|th)\b/))) {
            var ordinal = Number(match[1]);
            if (ordinal >= 1 && ordinal <= 31) {
                var ordinalDate = new Date(base.getFullYear(), base.getMonth(), ordinal);
                if (ordinalDate.getTime() < startOfDay(base).getTime()) ordinalDate.setMonth(ordinalDate.getMonth() + 1);
                if (ordinalDate.getDate() === ordinal) return result(ordinalDate, match[0], { kind: 'ordinal' });
            }
        }
        return null;
    }

    function parseNaturalTime(text) {
        var input = String(text || '');
        var lower = input.toLowerCase();
        var match;
        if ((match = lower.match(/\bnoon\b/))) return { time: '12:00', match: match[0], kind: 'noon' };
        if ((match = lower.match(/\bmidnight\b/))) return { time: '00:00', match: match[0], kind: 'midnight' };
        if ((match = input.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) {
            var hour = Number(match[1]);
            var minute = match[2] ? Number(match[2]) : 0;
            var suffix = String(match[3]).toLowerCase();
            if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
                if (suffix === 'pm' && hour < 12) hour += 12;
                if (suffix === 'am' && hour === 12) hour = 0;
                return { time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'), match: match[0], kind: 'clock' };
            }
        }
        if ((match = input.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
            return { time: String(Number(match[1])).padStart(2, '0') + ':' + match[2], match: match[0], kind: 'clock-24' };
        }
        if ((match = lower.match(/\b(after school|after class)\b/))) return { time: '15:30', match: match[0], kind: 'after-school' };
        if ((match = lower.match(/\b(after dinner|after supper|tonight)\b/))) return { time: '19:00', match: match[0], kind: 'evening' };
        return null;
    }

    function parseDurationMinutes(text) {
        var input = String(text || '');
        var match = input.match(/\bfor\s+(\d{1,3})\s*(minutes?|mins?|m)\b/i)
            || input.match(/\bfor\s+(\d{1,2}(?:\.5)?)\s*(hours?|hrs?|h)\b/i);
        if (!match) return null;
        var amount = Number(match[1]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var isHours = /hours?|hrs?|h/i.test(match[2]);
        var minutes = Math.round(amount * (isHours ? 60 : 1));
        if (minutes < 5 || minutes > 720) return null;
        return { minutes: minutes, match: match[0] };
    }

    global.SutraStudentDateParser = {
        localDateKey: localDateKey,
        startOfDay: startOfDay,
        parseNaturalDate: parseNaturalDate,
        parseNaturalTime: parseNaturalTime,
        parseDurationMinutes: parseDurationMinutes
    };
}(typeof window !== 'undefined' ? window : globalThis));
