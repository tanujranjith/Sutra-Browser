import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const source = name => extractFunction(app, name).body;

test('automatic backup controls require independent session credentials and explicit opt-in', () => {
  const meta = { autoBackup: { enabled: false, frequency: 'daily' } };
  const runtime = { backupPassphrase: '' };
  let scheduled = 0;
  const set = new Function('sutraCloudRuntime', 'loadSutraCloudMeta', 'getActiveSutraCloudProvider',
    'persistSutraCloudMeta', 'updateSutraCloudUi', 'maybeSutraCloudAutoBackup', `
      let sutraCloudAutoTimer = null;
      ${source('setSutraCloudAutoBackup')}
      return setSutraCloudAutoBackup;
    `)(runtime, () => meta, () => ({ supportsAutoBackup: true, getSetupStatus: () => ({ ready: true }) }),
      () => {}, () => {}, () => scheduled++);
  assert.throws(() => set({ enabled: true }), /encrypted backup first/);
  assert.equal(meta.autoBackup.enabled, false);
  assert.equal(scheduled, 0);
  runtime.backupPassphrase = 'separate-backup-password';
  assert.deepEqual(set({ enabled: true }), { enabled: true, frequency: 'daily' });
  assert.equal(scheduled, 1);
  assert.throws(() => set({ enabled: true, frequency: 'invalid' }), /Unknown/);
  runtime.backupPassphrase = '';
  assert.deepEqual(set({ enabled: false, frequency: 'close' }), { enabled: false, frequency: 'close' });
  assert.equal(scheduled, 1, 'disabling requires no password and schedules no work');
});

test('Cloud metadata upgrades in place without losing unknown fields or enabling backups', () => {
  for (const old of [null, { deviceId: 'legacy', extra: { keep: true }, autoBackup: { enabled: false, frequency: 'unexpected' } },
    { deviceId: 'enabled', autoBackup: { enabled: true, frequency: 'close', future: 3 } }]) {
    let value = old;
    let writes = 0;
    const storage = { get: () => value, set: (_key, next) => { value = structuredClone(next); writes++; } };
    const read = new Function('SutraSafeStorage', 'randomSutraId', `
      const SUTRA_CLOUD_META_KEY = 'sutra:supabaseCloud:v1';
      let sutraCloudMeta = null;
      ${source('getDefaultSutraCloudMeta')}
      ${source('persistSutraCloudMeta')}
      ${source('loadSutraCloudMeta')}
      return () => { sutraCloudMeta = null; return loadSutraCloudMeta(); };
    `)(storage, () => 'new-device');
    const migrated = read();
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.autoBackup.enabled, old?.autoBackup?.enabled === true);
    assert.equal(migrated.autoBackup.frequency, old?.autoBackup?.frequency === 'close' ? 'close' : 'daily');
    if (old?.extra) assert.deepEqual(migrated.extra, old.extra);
    if (old?.autoBackup?.future) assert.equal(migrated.autoBackup.future, 3);
    assert.deepEqual(read(), migrated);
    assert.equal(writes, 1, 'migration is idempotent');
  }
});

test('Cloud status keeps local save, locked Sync and backup failures independent', () => {
  const status = new Function('getSutraSyncStatus', 'loadSutraCloudMeta', 'getActiveSutraCloudProvider',
    'sutraPersistenceState', 'sutraCloudRuntime', 'navigator', 'persistenceWritesBlocked',
    'appSettings', 'sutraSyncStateLabel', source('getSutraCloudStatus') + '; return getSutraCloudStatus;')(
      () => ({ state: 'locked', enabled: true, outboxDepth: 2 }),
      () => ({ autoBackup: { enabled: false, frequency: 'daily' }, lastError: 'Upload failed' }),
      () => ({ id: 'supabase' }), { lastConfirmedSaveAt: '2026-09-15' }, {},
      { onLine: true }, false, {}, state => state
    )();
  assert.equal(status.local.savedAt, '2026-09-15');
  assert.equal(status.local.error, null);
  assert.equal(status.sync.state, 'locked');
  assert.equal(status.sync.outboxDepth, 2);
  assert.equal(status.backups.error, 'Upload failed');
  assert.equal(status.backups.lastBackupAt, null);
});
