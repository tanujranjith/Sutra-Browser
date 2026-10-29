import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

const ROLE = 'help-docs';
const DEFAULT_ID = 'help_page';

function loadIsHelpDocsPage() {
  const extract = extractFunction(app, 'isHelpDocsPage');
  assert.ok(extract, 'isHelpDocsPage must be a top-level declaration');
  return new Function('HELP_PAGE_SYSTEM_ROLE', 'HELP_PAGE_DEFAULT_ID', `${extract.body}; return isHelpDocsPage;`)(ROLE, DEFAULT_ID);
}

test('a page is Help & Docs only when its identity marks it as the system resource', () => {
  const isHelpDocsPage = loadIsHelpDocsPage();
  assert.equal(isHelpDocsPage({ systemRole: ROLE }), true, 'systemRole identifies Help');
  assert.equal(isHelpDocsPage({ builtInId: ROLE }), true, 'builtInId identifies Help');
  assert.equal(isHelpDocsPage({ id: DEFAULT_ID }), true, 'the stable default id identifies Help');
  assert.equal(isHelpDocsPage({ title: 'Help & Docs', isSystemPage: true }), true, 'an explicitly system page titled Help & Docs counts');
  assert.equal(isHelpDocsPage({ title: 'Help & Docs' }), false, 'a user page merely titled Help & Docs is not the system resource');
  assert.equal(isHelpDocsPage({ id: 'my-notes', title: 'Biology', systemRole: '' }), false, 'ordinary notes are never Help');
  assert.equal(isHelpDocsPage(null), false, 'non-objects are rejected');
});

test('the identity markers are stable constants', () => {
  assert.match(app, /const HELP_PAGE_SYSTEM_ROLE = 'help-docs';/);
  assert.match(app, /const HELP_PAGE_DEFAULT_ID = 'help_page';/);
});

test('every import path restores one canonical Help page per space', () => {
  const extract = extractFunction(app, 'importWorkspacePayloadInner');
  assert.ok(extract, 'importWorkspacePayloadInner is a top-level declaration');
  assert.ok(extract.body.includes('ensureHelpPagesForAllSpaces()'), 'import restores Help pages after pages replacement');
  assert.match(extract.body, /generated local system resource and is excluded[\s\S]*from Sync records/);
  const ensure = extractFunction(app, 'ensureHelpPagesForAllSpaces');
  assert.ok(ensure, 'ensureHelpPagesForAllSpaces is a top-level declaration');
  assert.ok(ensure.body.includes('pages.filter(page => !isHelpDocsPage(page) || canonicalIds.has(page.id))'), 'Help identity determines which generated pages are deduplicated');
});

test('deleting the Help page is guarded and Help is never treated as ordinary content', () => {
  assert.ok(app.includes('isHelpDocsPage(page)'), 'the identity check is used across deletion and import paths');
  assert.ok(app.includes('HELP_PAGE_SYSTEM_ROLE'), 'the system role constant is referenced beyond its declaration');
});
