import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const shell = fs.readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../../src/config/feature-manifest.js', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../../src/features/feature-registry.js', import.meta.url), 'utf8');

test('Assistant layout is available before optional pack hydration finishes', () => {
  const manifestHref = manifest.match(/['"](\.\/styles\/views\/assistant-view\.css\?v=[^'"]+)['"]/u)?.[1];
  assert.ok(manifestHref, 'Assistant manifest must declare its layout stylesheet');
  const shellHref = manifestHref.replace(/^\.\//u, '');
  assert.match(shell, new RegExp(`<link\\s+rel=["']stylesheet["']\\s+href=["']${shellHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'u'));
});

test('optional style loading reuses critical shell styles instead of duplicating them', () => {
  assert.match(registry, /querySelectorAll\(['"]link\[rel=["']stylesheet["']\]['"]\)/u);
  assert.match(registry, /findExistingStyle\(href\)/u);
});
