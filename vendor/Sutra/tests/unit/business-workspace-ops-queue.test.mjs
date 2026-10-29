import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/features/workspace/business-workspace.js'), 'utf8');

test('Business derives a bounded operating queue from canonical local signals', () => {
    assert.match(source, /const queuePriority = \{ overdue: 120/);
    assert.match(source, /const nextActions = Array\.from\(queued\.values\(\)\)/);
    assert.match(source, /healthByProject\.get\(project\.id\)/);
    assert.match(source, /slice\(0, 6\)/);
    assert.match(source, /nextActions,/);
});

test('Business queue opens canonical records and does not add a network or storage path', () => {
    assert.match(source, /function renderOperatingQueue\(model\)/);
    assert.match(source, /data-biz-action="select-detail"/);
    assert.match(source, /data-biz-action="mark-complete"/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /localStorage\s*\./);
});
