import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync(new URL('../../src/features/search/global-search-modal.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles/features/global-search.css', import.meta.url), 'utf8');

test('global search keeps keyboard focus without showing an automatic focus treatment', () => {
  assert.match(modal, /is-auto-focused/);
  assert.match(modal, /root\.classList\.add\('is-auto-focused'\)/);
  assert.match(modal, /root\.classList\.remove\('is-auto-focused'\)/);
  assert.match(styles, /\.global-search-panel\.is-auto-focused \.global-search-inputrow:focus-within[\s\S]*?box-shadow:\s*none/);
});
