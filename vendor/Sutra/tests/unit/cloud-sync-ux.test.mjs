import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const shell = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

test('Cloud leads with encrypted multi-device Sync while preserving backup distinction', () => {
  assert.match(shell, /id="sutraCloudSyncFirstTitle">Use Sutra on another device/);
  assert.match(shell, /Sign in by email, set a Sync passphrase/);
  assert.match(shell, /Sync replicates changes; backups remain separate recovery points/);
  assert.match(shell, /id="sutraCloudOpenSyncBtn" onclick="window\.openSutraSyncModal\(\)"/);
  assert.match(shell, /<h4 class="sutra-cloud-h">Backup destinations<\/h4>/);
});

test('opening Cloud uses the shared section selector', () => {
  const open = extractFunction(app, 'openSutraCloudModal');
  assert.ok(open, 'openSutraCloudModal exists');
  assert.match(open.body, /selectSutraCloudSection\(section\)/);
  assert.equal((shell.match(/class="modal" id="sutraCloudModal"/g) || []).length, 1);
  assert.doesNotMatch(shell, /class="modal" id="sutraSyncModal"/);
  assert.doesNotMatch(shell, /id="sutraSyncOpenBtn"/);
});

test('legacy Sync navigation opens the same Cloud hub', () => {
  const open = extractFunction(app, 'openSutraSyncModal');
  assert.ok(open, 'openSutraSyncModal exists');
  assert.match(open.body, /openSutraCloudModal\('sync'\)/);
});

test('closing either sheet releases the scroll lock only when nothing else is open', () => {
  for (const name of ['closeSutraCloudModal']) {
    const close = extractFunction(app, name);
    assert.ok(close, `${name} exists`);
    assert.match(close.body, /modal\.classList\.remove\('active'\)/);
    const guard = close.body.indexOf("document.querySelector('.modal.active')");
    const release = close.body.indexOf("document.body.classList.remove('modal-open')");
    assert.ok(guard !== -1 && release !== -1,
      `${name} must condition the scroll-lock release on no other active modal`);
    assert.ok(guard < release,
      `${name} must check for another active modal before releasing the lock`);
  }
});
