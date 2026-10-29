#!/usr/bin/env node
/* ==========================================================================
   check-daily-lock-in-quotes.js
   Validates the daily-lock-in-quotes.js data file for:
   - Minimum verified quote count
   - Unique IDs
   - Non-empty text, author, source
   - Valid categories
   - Maximum rendered length
   - No duplicate normalized quote text
   - ASCII-safe punctuation (no smart quotes, em dashes, malformed chars)
   - No accidental HTML
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

// ---- Load the quote bank --------------------------------------------------
const quotesPath = path.resolve(__dirname, '../src/data/daily-lock-in-quotes.js');
if (!fs.existsSync(quotesPath)) {
    console.error('FAIL: src/data/daily-lock-in-quotes.js not found');
    process.exit(1);
}

// Evaluate the file in a sandboxed context
const src = fs.readFileSync(quotesPath, 'utf-8');
const context = { window: {} };
try {
    const fn = new Function('window', src);
    fn(context.window);
} catch (e) {
    console.error('FAIL: Could not evaluate daily-lock-in-quotes.js:', e.message);
    process.exit(1);
}

const QUOTES = context.window.SutraQuoteBank;
if (!Array.isArray(QUOTES)) {
    console.error('FAIL: window.SutraQuoteBank is not an array');
    process.exit(1);
}

// ---- Validation rules -----------------------------------------------------
const VALID_CATEGORIES = new Set([
    'focus', 'discipline', 'persistence', 'resilience', 'courage', 'learning',
    'craft', 'ambition', 'action', 'failure', 'patience', 'responsibility',
    'preparation', 'consistency'
]);

const MIN_COUNT = 120;
const MAX_TEXT_CHARS = 170;
const MAX_AUTHOR_CHARS = 45;

// Patterns that flag ASCII-unsafe content
const SMART_QUOTE_RE = /[‘’“”]/;
const EM_DASH_RE = /[–—]/;
const MOJIBAKE_RE = /[\uFFFD\xc2\xc3\x80-\x9f]/;
const HTML_TAG_RE = /<[a-z/]/i;
const ELLIPSIS_CHAR_RE = /…/;

let fails = [];
let warns = [];

// ---- Check minimum count --------------------------------------------------
if (QUOTES.length < MIN_COUNT) {
    fails.push(`Quote count ${QUOTES.length} is below minimum of ${MIN_COUNT}`);
} else {
    console.log(`  OK  Quote count: ${QUOTES.length} (min ${MIN_COUNT})`);
}

// ---- Check uniqueness ------------------------------------------------------
const seenIds = new Set();
const seenTexts = new Set();

QUOTES.forEach((q, i) => {
    const loc = `quotes[${i}] id="${q.id}"`;

    // Required fields
    if (!q.id || typeof q.id !== 'string') fails.push(`${loc}: missing or non-string id`);
    if (!q.text || typeof q.text !== 'string' || !q.text.trim()) fails.push(`${loc}: missing text`);
    if (!q.author || typeof q.author !== 'string' || !q.author.trim()) fails.push(`${loc}: missing author`);
    if (!q.source || typeof q.source !== 'string' || !q.source.trim()) fails.push(`${loc}: missing source`);

    // ID uniqueness
    if (seenIds.has(q.id)) fails.push(`${loc}: duplicate id "${q.id}"`);
    seenIds.add(q.id);

    // Text uniqueness (normalized)
    const normText = (q.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenTexts.has(normText)) fails.push(`${loc}: duplicate quote text "${q.text.slice(0, 40)}..."`);
    seenTexts.add(normText);

    // Category
    if (q.category && !VALID_CATEGORIES.has(q.category)) {
        warns.push(`${loc}: unknown category "${q.category}"`);
    }

    // Length
    if (q.text && q.text.length > MAX_TEXT_CHARS) {
        fails.push(`${loc}: text is ${q.text.length} chars (max ${MAX_TEXT_CHARS}): "${q.text.slice(0, 60)}..."`);
    }
    if (q.author && q.author.length > MAX_AUTHOR_CHARS) {
        fails.push(`${loc}: author is ${q.author.length} chars (max ${MAX_AUTHOR_CHARS}): "${q.author}"`);
    }

    // ASCII safety
    if (q.text && SMART_QUOTE_RE.test(q.text)) fails.push(`${loc}: smart quotes in text`);
    if (q.text && EM_DASH_RE.test(q.text)) fails.push(`${loc}: em/en dash in text`);
    if (q.text && MOJIBAKE_RE.test(q.text)) fails.push(`${loc}: mojibake/replacement char in text`);
    if (q.text && HTML_TAG_RE.test(q.text)) fails.push(`${loc}: HTML tag in text`);
    if (q.text && ELLIPSIS_CHAR_RE.test(q.text)) fails.push(`${loc}: Unicode ellipsis char in text (use "...")`);

    if (q.author && SMART_QUOTE_RE.test(q.author)) fails.push(`${loc}: smart quotes in author`);
    if (q.author && EM_DASH_RE.test(q.author)) fails.push(`${loc}: em/en dash in author`);
});

// ---- Check no adjacent duplicate authors in rotation ----------------------
// (day-number permutation using seed 0 as a reference rotation)
function seededShuffle(arr, seed) {
    const a = arr.slice();
    const n = a.length;
    let s = (seed >>> 0) + 1;
    for (let i = n - 1; i > 0; i--) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const j = s % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const shuffled = seededShuffle(QUOTES, 0);
let adjacentDupAuthor = false;
for (let i = 0; i < shuffled.length - 1; i++) {
    if (shuffled[i].author === shuffled[i + 1].author) {
        warns.push(`Adjacent same author in seed-0 rotation at positions ${i}/${i+1}: "${shuffled[i].author}"`);
        adjacentDupAuthor = true;
    }
}
if (!adjacentDupAuthor) {
    console.log('  OK  No adjacent duplicate authors in reference rotation');
}

// ---- Report ---------------------------------------------------------------
if (warns.length > 0) {
    console.warn('\nWarnings:');
    warns.forEach(w => console.warn('  WARN', w));
}

if (fails.length > 0) {
    console.error('\nFailures:');
    fails.forEach(f => console.error('  FAIL', f));
    console.error(`\ncheck-daily-lock-in-quotes: ${fails.length} failure(s). Fix before shipping.`);
    process.exit(1);
} else {
    console.log(`\ncheck-daily-lock-in-quotes: PASSED (${QUOTES.length} quotes, ${warns.length} warning(s))`);
    process.exit(0);
}
