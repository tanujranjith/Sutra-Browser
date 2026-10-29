#!/usr/bin/env node
/*
 * sutra-capability-freshness-check.mjs  (Part 10 honesty layer)
 *
 * The Assistant only claims provider/model capabilities its in-repo adapter
 * actually implements. Those claims are dated in
 * model-capabilities.js → CAPABILITY_VERIFICATION. Provider APIs drift, so a
 * dated claim that has not been re-confirmed in a long time is a liability.
 *
 * Policy (explicit):
 *   - Every record must have a valid id, provider, capability, source, and an
 *     ISO YYYY-MM-DD `verifiedOn` that is not in the future.
 *   - WARN  when a record is older than WARN_MONTHS (review it soon).
 *   - FAIL  when a record is older than FAIL_MONTHS (must be re-verified).
 *
 * Run: node scripts/sutra-capability-freshness-check.mjs
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const WARN_MONTHS = 9;
const FAIL_MONTHS = 15;

const MC = require(resolve(repoRoot, 'src/features/assistant/model-capabilities.js'));
const records = Array.isArray(MC.CAPABILITY_VERIFICATION) ? MC.CAPABILITY_VERIFICATION : null;

let failures = 0;
let warnings = 0;
const now = new Date();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function monthsBetween(a, b) {
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12
        + (b.getUTCMonth() - a.getUTCMonth())
        + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1);
}

if (!records) {
    console.error('FAIL: model-capabilities.js does not export CAPABILITY_VERIFICATION');
    process.exit(1);
}
if (records.length === 0) {
    console.error('FAIL: CAPABILITY_VERIFICATION is empty — every capability claim must be dated');
    process.exit(1);
}

const seenIds = new Set();
records.forEach((r, i) => {
    const where = r && r.id ? r.id : `record[${i}]`;
    ['id', 'provider', 'capability', 'source'].forEach(f => {
        if (!r || typeof r[f] !== 'string' || !r[f].trim()) { failures += 1; console.error(`FAIL ${where}: missing ${f}`); }
    });
    if (r && r.id) {
        if (seenIds.has(r.id)) { failures += 1; console.error(`FAIL ${where}: duplicate id`); }
        seenIds.add(r.id);
    }
    if (!r || !ISO.test(String(r.verifiedOn || ''))) {
        failures += 1; console.error(`FAIL ${where}: verifiedOn must be ISO YYYY-MM-DD (got ${r && r.verifiedOn})`);
        return;
    }
    const d = new Date(r.verifiedOn + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) { failures += 1; console.error(`FAIL ${where}: unparseable verifiedOn ${r.verifiedOn}`); return; }
    if (d.getTime() > now.getTime()) { failures += 1; console.error(`FAIL ${where}: verifiedOn is in the future (${r.verifiedOn})`); return; }
    const age = monthsBetween(d, now);
    if (age >= FAIL_MONTHS) { failures += 1; console.error(`FAIL ${where}: verified ${age} months ago (>${FAIL_MONTHS}) — re-verify against ${r.source}`); }
    else if (age >= WARN_MONTHS) { warnings += 1; console.warn(`WARN ${where}: verified ${age} months ago (>${WARN_MONTHS}) — review against ${r.source}`); }
});

console.log(`\nCapability freshness: ${records.length} record(s), ${warnings} warning(s), ${failures} failure(s). Policy: warn>${WARN_MONTHS}mo, fail>${FAIL_MONTHS}mo.`);
if (failures > 0) process.exit(1);
console.log('Capability freshness check passed.');
