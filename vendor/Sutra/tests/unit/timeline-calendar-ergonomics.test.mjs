import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/features/workspace/timeline-calendar.js'), 'utf8');

test('Timeline workbench keeps keyboard planning on the canonical block bridge', () => {
    assert.match(source, /function nextOpenSlot\(/);
    assert.match(source, /function shortcutHandler\(root\)/);
    assert.match(source, /openBlock\(null, key\(selected\), nextOpenSlot\(selected, 45\)\)/);
    assert.match(source, /data-block-id/);
    assert.match(source, /timeline-drop-zone/);
});

test('Timeline workbench remains local-first and respects text controls', () => {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /localStorage\s*\./);
    assert.match(source, /INPUT\|TEXTAREA\|SELECT\|BUTTON/);
  assert.match(source, /Press question mark for keyboard shortcuts/);
});

test('Day time views use a distinct class from Month day cells', () => {
    assert.match(source, /sutra-calendar-time-view sutra-calendar-time-' \+ mode/);
    assert.doesNotMatch(source, /sutra-calendar-time-view sutra-calendar-' \+ mode/);
});
