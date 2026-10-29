import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const glass = readFileSync(new URL('../../styles/themes/glass.css', import.meta.url), 'utf8');
const macos = readFileSync(new URL('../../styles/themes/macos26-redesign.css', import.meta.url), 'utf8');
const contextualShell = readFileSync(new URL('../../styles/views/contextual-shell.css', import.meta.url), 'utf8');
const cohesion = readFileSync(new URL('../../styles/themes/theme-cohesion.css', import.meta.url), 'utf8');

test('Glass theme keeps canonical and legacy surfaces on the same rendering contract', () => {
  assert.match(glass, /body\[data-theme="glass"\] \.view,\s*body\[data-theme="liquidglass"\] \.view\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important/);
  assert.match(glass, /body\[data-theme="glass"\] \.view,[\s\S]*?body\[data-theme="liquidglass"\] \.view/);
  assert.match(macos, /blur\(var\(--glass-blur, var\(--liquid-glass-blur, 18px\)\)\)/);
  assert.doesNotMatch(macos, /blur\(var\(--liquid-glass-blur, 18px\)\)/);
  assert.match(cohesion, /var\(--glass-chrome-top/);
  assert.match(cohesion, /var\(--glass-blur, 24px\)/);
});

test('medium Notes keeps its toolbar below the global navigation without double offset', () => {
  assert.match(contextualShell, /@media \(min-width: 641px\) and \(max-width: 1024px\) \{[\s\S]*?body\[data-view="notes"\]:not\(\.notes-split-active\) #view-notes \.toolbar-wrapper \{[\s\S]*?top: 0 !important/);
});

test('Sutra loads the updated Glass integration layers', () => {
  assert.match(shell, /styles\/themes\/macos26-redesign\.css\?v=20260913-glass-surfaces1/);
  assert.match(shell, /styles\/themes\/glass\.css\?v=20260917-glass-cohesion1/);
  assert.match(shell, /styles\/views\/contextual-shell\.css\?v=20260930-drawer-layer/);
  assert.match(shell, /styles\/themes\/theme-cohesion\.css\?v=20260917-glass-cohesion4/);
});
