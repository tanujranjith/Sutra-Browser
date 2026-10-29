import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mobileStyles = readFileSync(new URL('../../styles/responsive/mobile.css', import.meta.url), 'utf8');

test('Life dashboard reserves fixed phone chrome below its grid', () => {
  assert.match(mobileStyles, /37h\. Life is an active grid[\s\S]*?#view-life\.active \{[\s\S]*?padding-bottom: calc\(var\(--sutra-mobile-nav-height, 4\.75rem\) \+ 5rem\) !important;[\s\S]*?scroll-padding-bottom:/);
});
