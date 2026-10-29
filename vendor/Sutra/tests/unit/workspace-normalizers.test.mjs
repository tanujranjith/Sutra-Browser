import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const mod = require('../../src/state/workspace-normalizers.js');

test('STUDENT_DEFAULT_ENABLED_VIEWS has student daily-loop core surfaces', () => {
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('today'));
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('homework'));
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('notes'));
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('timeline'));
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('review'));
    assert.ok(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('cramhub'));
});

test('advanced surfaces are not in STUDENT_DEFAULT_ENABLED_VIEWS', () => {
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('college'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('collegeapp'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('life'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('business'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('courses'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('alldue'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('apstudy'), false);
    assert.equal(mod.STUDENT_DEFAULT_ENABLED_VIEWS.has('assistantview'), false);
});

test('getDefaultEnabledViews returns correct defaults', () => {
    const dv = mod.getDefaultEnabledViews();
    assert.equal(dv.today, true);
    assert.equal(dv.homework, true);
    assert.equal(dv.notes, true);
    assert.equal(dv.timeline, true);
    assert.equal(dv.review, true);
    assert.equal(dv.cramhub, true);
    assert.equal(dv.college, false);
    assert.equal(dv.life, false);
    assert.equal(dv.business, false);
    assert.equal(dv.assistantview, false);
});

test('normalizeEnabledViews uses defaults when raw is null or missing', () => {
    const dv = mod.normalizeEnabledViews(null);
    assert.equal(dv.today, true);
    assert.equal(dv.homework, true);
    assert.equal(dv.college, false);
    assert.equal(dv.life, false);
    assert.equal(dv.business, false);
    assert.equal(dv.assistantview, false);

    const dv2 = mod.normalizeEnabledViews(undefined);
    assert.equal(dv2.today, true);
});

test('normalizeEnabledViews merges stored prefs over defaults', () => {
    const stored = { college: true, today: false };
    const merged = mod.normalizeEnabledViews(stored);
    assert.equal(merged.college, true);
    assert.equal(merged.today, false);
    assert.equal(merged.homework, true);
    assert.equal(merged.life, false);
});

test('normalizeEnabledViews treats non-false as enabled for stored prefs', () => {
    const stored = { apstudy: 1, college: 'yes', life: false };
    const merged = mod.normalizeEnabledViews(stored);
    assert.equal(merged.apstudy, true);
    assert.equal(merged.college, true);
    assert.equal(merged.life, false);
});

test('OPTIONAL_FEATURE_VIEWS contains all optional views', () => {
    const all = mod.OPTIONAL_FEATURE_VIEWS;
    assert.ok(all.includes('today'));
    assert.ok(all.includes('timeline'));
    assert.ok(all.includes('notes'));
    assert.ok(all.includes('college'));
    assert.ok(all.includes('homework'));
    assert.ok(all.includes('courses'));
    assert.ok(all.includes('alldue'));
    assert.ok(all.includes('apstudy'));
    assert.ok(all.includes('collegeapp'));
    assert.ok(all.includes('life'));
    assert.ok(all.includes('business'));
    assert.ok(all.includes('review'));
    assert.ok(all.includes('cramhub'));
    assert.ok(all.includes('assistantview'));
});

test('SUTRA_FEATURE_PACKS contains expected packs with correct views', () => {
    const packs = mod.SUTRA_FEATURE_PACKS;
    assert.ok(packs.academic);
    assert.ok(packs.college);
    assert.ok(packs.life);
    assert.ok(packs.work);
    assert.ok(packs.assistant);
    assert.ok(packs.customization);
    assert.deepEqual([...packs.academic.views], ['courses', 'alldue', 'apstudy', 'review', 'cramhub']);
    assert.deepEqual([...packs.college.views], ['collegeapp', 'college']);
    assert.deepEqual([...packs.life.views], ['life']);
    assert.deepEqual([...packs.work.views], ['business']);
    assert.deepEqual([...packs.assistant.views], ['assistantview']);
    assert.deepEqual([...packs.customization.views], []);
});
