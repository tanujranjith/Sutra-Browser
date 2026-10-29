import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../../styles/base/styles.css', import.meta.url), 'utf8');

test('locked pages offer normal-PIN-gated setup and a local duress explainer', () => {
  const render = extractFunction(appSource, 'renderLockedPageScreen');
  assert.ok(render, 'locked-page screen renderer exists');
  assert.match(render.body, /id="lockScreenDuressSetupBtn"/);
  assert.match(render.body, /Enter your normal PIN, then set a separate 6/);
  assert.match(render.body, /id="lockScreenDuressExplainerBtn"/);
  assert.doesNotMatch(render.body, /https:\/\//);
  assert.match(render.body, /setupDuressAfterUnlock = true/);
  assert.match(render.body, /form\.requestSubmit\(\)/);
  assert.match(render.body, /openSetLockModal\(page\.id, \{ openDuress: true \}\)/);
  assert.match(render.body, /showCustomAlertDialog\(\{/);
  assert.match(render.body, /does not unlock the page or contact anyone/);
  assert.match(render.body, /local workspace snapshots/);
  assert.match(stylesSource, /\.lock-screen-duress-btn/);
  assert.match(stylesSource, /\.lock-screen-duress-link/);
  assert.match(stylesSource, /white-space: pre-wrap/);
});

test('direct duress setup still requires an unlocked page and opens the existing destructive form', () => {
  const modal = extractFunction(appSource, 'openSetLockModal');
  assert.ok(modal, 'page-lock modal opener exists');
  assert.match(modal.body, /unlockedPageIds\.has\(pageId\)/);
  assert.match(modal.body, /options\.openDuress === true/);
  assert.match(modal.body, /_showLockModalView\(options\.openDuress === true \? 'duress' : 'manage'\)/);
});
