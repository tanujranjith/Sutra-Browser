import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const backup = require('../../src/features/workspace/backup-confidence.js');
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const ago = (hours) => new Date(NOW - hours * 3600000).toISOString();

test('backup status never describes local saving as a backup', () => {
  const status = backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), online: true }, NOW);
  assert.equal(status.local.state, 'saved');
  assert.equal(status.manualBackup.state, 'none');
  assert.equal(status.cloud.state, 'not_configured');
  assert.equal(status.protectionState, 'saved_no_backup');
  assert.match(backup.getIndicatorText(status), /Saved locally — no backup yet/);
});

test('explicit states distinguish unsaved, failed, stale, recent, and incomplete protection', () => {
  assert.equal(backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(2), lastAttemptAt: ago(1) }, NOW).protectionState, 'unsaved_changes');
  assert.equal(backup.deriveConfidenceFromSignals({ lastFailure: 'Quota exceeded' }, NOW).protectionState, 'save_failed');
  assert.equal(backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), lastManualBackupAt: ago(8 * 24) }, NOW).protectionState, 'backup_stale');
  assert.equal(backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), lastManualBackupAt: ago(2) }, NOW).protectionState, 'saved_and_backed_up');
  assert.equal(backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), lastManualBackupAt: ago(2), attachmentWarnings: 1 }, NOW).protectionState, 'backup_incomplete');
});

test('cloud status separates configuration, auto-backup, success, failure, and offline state', () => {
  const configured = backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), cloudConfigured: true }, NOW);
  assert.equal(configured.cloud.state, 'configured_disabled');
  const enabled = backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), cloudConfigured: true, autoBackupEnabled: true }, NOW);
  assert.equal(enabled.cloud.state, 'enabled_never_completed');
  const recent = backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), cloudConfigured: true, autoBackupEnabled: true, lastCloudBackupAt: ago(1), lastAutoBackupAt: ago(1), online: false }, NOW);
  assert.equal(recent.cloud.state, 'recent_auto_enabled');
  assert.equal(recent.cloud.lastAutoSucceeded, true);
  assert.equal(recent.offline, true);
  const failed = backup.deriveConfidenceFromSignals({ lastConfirmedSaveAt: ago(1), cloudConfigured: true, cloudError: 'upload failed' }, NOW);
  assert.equal(failed.cloud.state, 'failed');
  assert.equal(failed.cloud.lastAutoSucceeded, false);
});
