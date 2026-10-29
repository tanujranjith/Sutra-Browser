/**
 * Shared time and date primitives for Sutra timeline, scheduling, and planning.
 *
 * Canonical source — eliminates duplicated helpers across planning-engine.js,
 * smart-reschedule.js, timeline-drag.js, and app.js.
 *
 * All functions are pure and have zero closure dependencies.
 * Register on window for classic-script consumption.
 */
;(function registerSutraTimeUtils() {
    'use strict';

    const API = {};

    /**
     * Parse "HH:MM" to total minutes since midnight.
     * @param {string} value
     * @returns {number|null}
     */
    API.hhmmToMinutes = function hhmmToMinutes(value) {
        const [h, m] = String(value || '').split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return (h * 60) + m;
    };
    // Backward alias used by app.js
    API.parseTimeToMinutes = API.hhmmToMinutes;

    /**
     * Format total minutes since midnight to "HH:MM".
     * @param {number} totalMinutes
     * @returns {string}
     */
    API.minutesToHHMM = function minutesToHHMM(totalMinutes) {
        const clamped = Math.max(0, Math.min(1440, Math.round(totalMinutes)));
        const h = Math.floor(clamped / 60);
        const m = clamped % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    };

    /** Format an elapsed duration, never a time of day. */
    API.formatDurationMinutes = function formatDurationMinutes(totalMinutes) {
        const numeric = Number(totalMinutes);
        const minutes = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        if (!hours) return remainder + ' min';
        return hours + 'h' + (remainder ? ' ' + remainder + 'm' : '');
    };

    /** Format an HH:MM value as a 12-hour clock time, never a duration. */
    API.formatClockTime = function formatClockTime(value) {
        let hours;
        let minutes;
        if (value instanceof Date && Number.isFinite(value.getTime())) {
            hours = value.getHours();
            minutes = value.getMinutes();
        } else {
            const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
            if (!match) return '';
            hours = Number(match[1]);
            minutes = Number(match[2]);
        }
        if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
        const suffix = hours < 12 ? 'AM' : 'PM';
        const displayHour = hours % 12 || 12;
        return displayHour + ':' + String(minutes).padStart(2, '0') + ' ' + suffix;
    };

    /**
     * Get total duration of a time block in hours.
     * @param {{ start: string, end: string }} block
     * @returns {number}
     */
    API.getBlockDurationHours = function getBlockDurationHours(block) {
        const startMins = API.hhmmToMinutes(block && block.start);
        const endMins = API.hhmmToMinutes(block && block.end);
        if (startMins === null || endMins === null) return 0;
        return Math.max(0, endMins - startMins) / 60;
    };

    /**
     * Generate a unique timeline block identifier.
     * @returns {string}
     */
    API.generateBlockId = function generateBlockId() {
        return 'block_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    /**
     * Add days to a date, returning a new Date.
     * @param {Date} dateObj
     * @param {number} days
     * @returns {Date}
     */
    API.addDays = function addDays(dateObj, days) {
        const d = new Date(dateObj.getTime());
        d.setDate(d.getDate() + Number(days || 0));
        return d;
    };

    /**
     * Get start-of-week (Sunday) for a given date.
     * @param {Date} dateObj
     * @returns {Date}
     */
    API.getStartOfWeek = function getStartOfWeek(dateObj) {
        const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d;
    };

    /**
     * Normalize a date-like value to "YYYY-MM-DD" or null.
     * @param {string|Date|null} value
     * @returns {string|null}
     */
    API.normalizeBlockDate = function normalizeBlockDate(value) {
        if (!value) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
        const d = new Date(value);
        if (isNaN(d)) return null;
        if (typeof window !== 'undefined' && typeof window.dateKey === 'function') {
            return window.dateKey(d);
        }
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
    };

    /**
     * Format a Date as "YYYY-MM-DD".
     * @param {Date} dateObj
     * @returns {string}
     */
    API.toDateKey = function toDateKey(dateObj) {
        return dateObj.getFullYear() + '-' +
               String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
               String(dateObj.getDate()).padStart(2, '0');
    };

    if (typeof window !== 'undefined') {
        window.SutraTimeUtils = API;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    }
})();
