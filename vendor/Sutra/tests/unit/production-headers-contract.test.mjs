import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const checker = readFileSync(new URL('scripts/check-production-headers.mjs', root), 'utf8');
const headerDocs = readFileSync(new URL('docs/security-headers.md', root), 'utf8');
const releaseDocs = readFileSync(new URL('docs/release/TESTING_AND_RELEASE_CHECKLIST.md', root), 'utf8');

test('deployed response-header verification uses an HTTPS HEAD request', () => {
  assert.match(checker, /url\.protocol !== 'https:'/);
  assert.match(checker, /method:\s*'HEAD'/);
  assert.match(checker, /cache:\s*'no-store'/);
});

test('GitHub Pages limitation and verification evidence stay in release guidance', () => {
  assert.match(headerDocs, /tanujranjith\.github\.io\/Sutra\/Sutra\.html/);
  assert.match(headerDocs, /2026-09-13 returned `200`/);
  assert.match(headerDocs, /Strict-Transport-Security/);
  assert.match(headerDocs, /Content-Security-Policy/);
  assert.match(headerDocs, /frame-ancestors/);
  assert.match(releaseDocs, /Production response-header verification/);
  assert.match(releaseDocs, /HTTPS `HEAD`/);
  assert.match(releaseDocs, /separate deployment decision/);
});
