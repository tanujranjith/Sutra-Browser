import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appSource = readFileSync(path.join(root, 'src', 'core', 'app.js'), 'utf8');
const inventory = JSON.parse(readFileSync(path.join(root, 'docs', 'architecture', 'persistence-inventory.json'), 'utf8'));

test('application bridge selects an account-scoped sync namespace and quarantines an account transition with opt-in reset', () => {
  assert.match(appSource, /SUTRA_SYNC_ACCOUNT_HINT_KEY = 'sutra:syncAccountHint:v1'/);
  assert.match(appSource, /function getSutraSyncStoreScope\(\)[\s\S]*?supabase:/);
  assert.match(appSource, /SutraSyncStore\.create\(\{ scope \}\)/);
  assert.match(appSource, /setWorkspacePreference\('sync\.enabled', false\)/);
  assert.match(appSource, /accountSwitchBlocked = \{[\s\S]*?from: prior \|\| 'unbound-existing-sync-state',[\s\S]*?to: current/);
  assert.match(appSource, /assertSutraSyncAccountIsSafe\(\)/);
  assert.match(appSource, /assertSutraSyncAccountIsSafe\(\);[\s\S]*?async function unlockSutraSync/);
  assert.match(appSource, /state: 'account-switch-blocked',[\s\S]*?enabled: false,[\s\S]*?reason: 'account-changed'/);
});

test('account transitions preserve the local workspace and its generated system resources', () => {
  const start = appSource.indexOf('function noteSutraSyncAuthenticatedAccount(');
  const end = appSource.indexOf('function assertSutraSyncAccountIsSafe(', start);
  assert.ok(start >= 0 && end > start, 'account transition boundary must be discoverable');
  const transition = appSource.slice(start, end);
  assert.match(transition, /Preserve the local-first workspace/);
  assert.match(transition, /setWorkspacePreference\('sync\.enabled', false\)/,
    'a different account must start with Sync disabled');
  assert.match(transition, /accountSwitchBlocked\s*=\s*\{/,
    'the new account must remain quarantined in this browser profile');
  assert.match(transition, /if \(!unboundExistingSync && !switchedAccount\) persistSutraSyncAccountHint\(current\)/,
    'an account transition must not rebind the former account namespace');
  assert.doesNotMatch(transition, /\bpages\s*=/, 'account switching must not replace local pages');
  assert.doesNotMatch(transition, /importWorkspacePayload|applySyncMergedWorkspace/,
    'account switching must fail closed before any remote workspace apply');
});

test('account routing hint and sync operational database are explicitly device-local exclusions', () => {
  const keys = inventory.localStorageClassifications;
  assert.equal(keys['sutra:syncAccountHint:v1'].category, 'deviceLocal');
  assert.equal(inventory.otherStorageClassifications.sutra_sync_db.category, 'deviceLocal');
  assert.match(inventory.otherStorageClassifications.sutra_sync_db.reason, /Account-scoped/i);
  assert.ok(inventory.deliberateExclusions.some(item => /sync queues.*device IDs/i.test(item)));
});

test('sync runtime does not contain plaintext logging sinks', () => {
  const syncDir = path.join(root, 'src', 'sync');
  for (const name of readdirSync(syncDir).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(path.join(syncDir, name), 'utf8');
    assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)\s*\(/,
      `${name} must not log sync payloads, keys, or user content`);
  }
});

test('explicit Sync disable waits for canonical persistence before returning', () => {
  assert.match(appSource,
    /async function disableSutraSync\(\)[\s\S]*?setWorkspacePreference\('sync\.enabled', false\);\s*persistAppData\(\);\s*await flushAppSaveNow\('sync-disable'\);/,
    'reload after a resolved disable must not revive the previous enabled preference');
});
