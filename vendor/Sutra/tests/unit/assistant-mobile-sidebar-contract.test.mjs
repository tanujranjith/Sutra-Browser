import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appShell = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const assistantRuntime = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const assistantStyles = readFileSync(new URL('../../styles/views/assistant-view.css', import.meta.url), 'utf8');

test('Assistant chat sidebar includes a reachable phone close control', () => {
  assert.match(appShell, /id="asstSidebarClose"[^>]*aria-label="Hide chat list"/);
  assert.match(assistantStyles, /@media \(max-width: 760px\)[\s\S]*?\.asst-sidebar-close \{ display: inline-flex; \}/);
});

test('Assistant chat sidebar close control uses the canonical toggle state', () => {
  assert.match(assistantRuntime, /function asstSetSidebarOpen\(isOpen\)[\s\S]*?classList\.toggle\('show-sidebar', open\)/);
  assert.match(assistantRuntime, /sidebarClose: document\.getElementById\('asstSidebarClose'\)/);
  assert.match(assistantRuntime, /asstCache\.sidebarClose\.addEventListener\('click',[\s\S]*?asstSetSidebarOpen\(false\)[\s\S]*?asstCache\.sidebarToggle\?\.focus\(\)/);
});
