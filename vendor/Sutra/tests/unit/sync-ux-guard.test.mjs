import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../src/features/workspace/audit-fixes.js', import.meta.url), 'utf8');

test('Sync success toasts are guarded when the first cloud decrypt fails', () => {
  assert.match(source, /function installSyncOutcomeGuard\(\)/);
  assert.match(source, /window\.SutraSync && typeof window\.SutraSync\.status === 'function'/);
  assert.match(source, /state\.state === 'encryption-error'/);
  assert.match(source, /Sync is paused: encrypted cloud data could not be verified\. See the recovery steps in Sync/);
  assert.match(source, /function renderSyncRecoveryGuidance\(\)/);
  assert.match(source, /sutraSyncRecoveryGuidance/);
  assert.match(source, /Do not create a new vault key/);
  assert.match(source, /sutraSyncRunningError/);
  assert.match(source, /text === 'Sync unlocked\.'/);
  assert.match(source, /text\.indexOf\('Sutra Sync is on\.'\) === 0/);
});
