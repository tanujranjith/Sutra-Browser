import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const source = readFileSync(new URL('../../src/features/workspace/mobile-nav.js', import.meta.url), 'utf8');

function loadNavFunction(name, stubNames) {
  const extract = extractFunction(source, name);
  assert.ok(extract, `${name} must be a top-level declaration`);
  return new Function(...stubNames, `${extract.body}; return ${name};`);
}

test('phone navigation delegates to the canonical tab controls, never its own registry', () => {
  const clickTabForView = loadNavFunction('clickTabForView', ['document', 'vibrate']);
  let queried = null;
  const clicks = [];
  const fakeDocument = {
    querySelector: (selector) => { queried = selector; return { click: () => clicks.push(selector) }; }
  };
  clickTabForView(fakeDocument, () => {})('homework');
  assert.equal(queried, '.view-tab[data-view="homework"]', 'navigation routes through the canonical top tab');
  assert.deepEqual(clicks, ['.view-tab[data-view="homework"]'], 'the canonical tab handler is invoked');
  let vibrated = 0;
  clickTabForView(fakeDocument, () => { vibrated += 1; })('notes');
  assert.equal(vibrated, 1, 'tapping a section vibrates');
});

test('the All sections sheet keeps dialog semantics, focus containment, and Back handling', () => {
  const build = extractFunction(source, 'buildMoreSheet');
  assert.ok(build, 'buildMoreSheet is a top-level declaration');
  assert.ok(build.body.includes("setAttribute('role', 'dialog')"), 'the sheet declares dialog role');
  assert.ok(build.body.includes("setAttribute('aria-modal', 'true')"), 'the sheet is modal');
  assert.ok(build.body.includes("setAttribute('aria-labelledby', 'sutraMobileMoreTitle')"), 'the sheet has an accessible title');
  assert.ok(build.body.includes("addEventListener('popstate'"), 'browser Back closes the sheet');
  assert.ok(build.body.includes("event.key === 'Escape'"), 'Escape closes the sheet');
  assert.ok(build.body.includes('focusableWithin(morePanel)'), 'focus is contained within the sheet');
  assert.ok(build.body.includes('data-mobile-more-view'), 'the sheet derives destinations from data attributes');
});

test('the sheet clears its history entry before routing through the canonical tab', () => {
  const build = extractFunction(source, 'buildMoreSheet');
  assert.ok(build.body.includes("var view = button.getAttribute('data-mobile-more-view')"), 'the selected canonical view is captured before the sheet closes');
  assert.ok(build.body.includes('function navigateAfterSheetHistory()'), 'history-backed sheets defer navigation until their marker is popped');
  assert.ok(build.body.includes('clickTabForView(view)'), 'both history and non-history paths activate the canonical tab handler');
  assert.ok(build.body.includes('closeMore({ restoreFocus: false })'), 'the sheet closes without stealing focus from the destination');
});
