import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mobileStyles = readFileSync(new URL('../../styles/responsive/mobile.css', import.meta.url), 'utf8');

test('Notes phone toolbar has one final viewport-anchored layout', () => {
  assert.match(mobileStyles, /37g\. Notes phone editor chrome[\s\S]*?body\[data-view="notes"\] #view-notes \.toolbar-wrapper \{[\s\S]*?position: fixed !important;[\s\S]*?top: calc\(env\(safe-area-inset-top, 0px\) \+ 8px\) !important;/);
  assert.match(mobileStyles, /body\[data-view="notes"\] #view-notes \.toolbar \{[\s\S]*?overflow-x: auto !important;/);
});

test('Notes phone editor reserves space for the toolbar and fixed bottom chrome', () => {
  assert.match(mobileStyles, /body\[data-view="notes"\] #view-notes \.editor-container,[\s\S]*?padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 124px\) !important;[\s\S]*?padding-bottom: calc\(var\(--sutra-mobile-nav-height, 4\.75rem\) \+ 5rem\) !important;/);
});
