import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles/base/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

test('homework paste import uses a self-contained, scroll-safe dialog card', () => {
  assert.match(shell, /id="homeworkPasteImportModal"[\s\S]*class="hw-paste-card glass-card"/);
  assert.match(styles, /\.hw-paste-card\s*\{[\s\S]*grid-template-rows: auto auto auto minmax\(80px, 1fr\) auto/);
  assert.match(styles, /\.hw-paste-card\s*\{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.hw-paste-card\s*\{[\s\S]*background: var\(--bg-primary\)/);
  assert.match(styles, /\.hw-paste-card\s*\{[\s\S]*backdrop-filter: none/);
});

test('homework paste import can resume the onboarding flow after cancellation', () => {
  assert.match(app, /function openHomeworkPasteImport\(prefillText, options\)/);
  assert.match(app, /modal\._onClose = options && typeof options\.onClose === 'function' \? options\.onClose : null/);
  assert.match(app, /modal\._onCancel = options && typeof options\.onCancel === 'function' \? options\.onCancel : null/);
  assert.match(app, /function closeHomeworkPasteImport\(reason\)[\s\S]*closeReason === 'imported'/);
  assert.match(app, /closeHomeworkPasteImport\('imported'\)/, 'successful imports are distinct from cancellation');
});
