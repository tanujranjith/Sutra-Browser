/** Factual, derived backup and save protection status. No provider requests. */
;(function (global) {
    'use strict';

    var MANUAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;
    var CLOUD_STALE_MS = 3 * 24 * 60 * 60 * 1000;

    function timestamp(value) {
        var parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    function ageMs(value, now) {
        var stamp = timestamp(value);
        return stamp ? Math.max(0, now - stamp) : Infinity;
    }
    function formatAge(value, now) {
        var age = ageMs(value, now);
        if (!Number.isFinite(age)) return 'never';
        var minutes = Math.floor(age / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
    }

    function deriveConfidenceFromSignals(signals, nowValue) {
        var source = signals && typeof signals === 'object' ? signals : {};
        var now = Number(nowValue) || Date.now();
        var lastSave = String(source.lastConfirmedSaveAt || '');
        var lastAttempt = String(source.lastAttemptAt || '');
        var failure = String(source.lastFailure || '');
        var writesBlocked = source.writesBlocked === true;
        var dirty = source.dirty === true || (timestamp(lastAttempt) > timestamp(lastSave));
        var localState = failure || writesBlocked ? 'failed' : (!lastSave ? 'unconfirmed' : (dirty ? 'unsaved' : 'saved'));

        var manualAt = String(source.lastManualBackupAt || '');
        var manualState = !manualAt ? 'none' : (ageMs(manualAt, now) > MANUAL_STALE_MS ? 'stale' : 'recent');

        var cloudConfigured = source.cloudConfigured === true;
        var autoEnabled = source.autoBackupEnabled === true;
        var cloudAt = String(source.lastCloudBackupAt || '');
        var autoAt = String(source.lastAutoBackupAt || '');
        var cloudError = String(source.cloudError || '');
        var cloudState;
        if (!cloudConfigured) cloudState = 'not_configured';
        else if (cloudError) cloudState = 'failed';
        else if (!cloudAt) cloudState = autoEnabled ? 'enabled_never_completed' : 'configured_disabled';
        else if (ageMs(cloudAt, now) > CLOUD_STALE_MS) cloudState = 'stale';
        else cloudState = autoEnabled ? 'recent_auto_enabled' : 'recent_manual_only';

        var offline = source.online === false;
        var attachmentWarnings = Math.max(0, Number(source.attachmentWarnings) || 0);
        var missingAssets = Math.max(0, Number(source.missingAssets) || 0);
        var quotaRisk = source.quotaRisk === true;
        var snapshotAt = String(source.lastSnapshotAt || '');
        var restorePointCount = Math.max(0, Number(source.restorePointCount) || 0);
        var hasRecentBackup = manualState === 'recent' || /^recent_/.test(cloudState);

        var protectionState;
        if (localState === 'failed') protectionState = 'save_failed';
        else if (localState === 'unsaved') protectionState = 'unsaved_changes';
        else if (localState === 'unconfirmed') protectionState = 'save_unconfirmed';
        else if (attachmentWarnings || missingAssets) protectionState = 'backup_incomplete';
        else if (hasRecentBackup) protectionState = 'saved_and_backed_up';
        else if (manualState === 'stale' || cloudState === 'stale') protectionState = 'backup_stale';
        else protectionState = 'saved_no_backup';

        return {
            protectionState: protectionState,
            local: { state: localState, at: lastSave, age: formatAge(lastSave, now), failure: failure, writesBlocked: writesBlocked },
            manualBackup: { state: manualState, at: manualAt, age: formatAge(manualAt, now) },
            cloud: {
                state: cloudState, configured: cloudConfigured, autoEnabled: autoEnabled,
                at: cloudAt, age: formatAge(cloudAt, now), lastAutoAt: autoAt,
                lastAutoSucceeded: !!autoAt && !cloudError, error: cloudError
            },
            offline: offline,
            quotaRisk: quotaRisk,
            attachmentWarnings: attachmentWarnings,
            missingAssets: missingAssets,
            snapshot: { at: snapshotAt, age: formatAge(snapshotAt, now) },
            restorePointCount: restorePointCount
        };
    }

    function collectSignals() {
        var health = {};
        try {
            health = global.SutraPersistenceHealth && typeof global.SutraPersistenceHealth.getState === 'function'
                ? global.SutraPersistenceHealth.getState() || {} : {};
        } catch (_) {}
        var dataHealth = global.appSettings && global.appSettings.dataHealth || {};
        var cloudMeta = {};
        var cloudProvider = null;
        try {
            if (global.SutraCloudSync) {
                cloudMeta = typeof global.SutraCloudSync.getMeta === 'function' ? global.SutraCloudSync.getMeta() || {} : {};
                cloudProvider = typeof global.SutraCloudSync.getActiveProvider === 'function' ? global.SutraCloudSync.getActiveProvider() : null;
            }
        } catch (_) {}
        var degraded = {};
        try { degraded = global.SutraSafeStorage && global.SutraSafeStorage.getDegraded ? global.SutraSafeStorage.getDegraded() || {} : {}; } catch (_) {}
        var warningRows = Array.isArray(health.lastAttachmentWarnings) ? health.lastAttachmentWarnings : [];
        var failureText = String(health.lastFailure && (health.lastFailure.message || health.lastFailure) || '');
        return {
            lastConfirmedSaveAt: health.lastConfirmedSaveAt || dataHealth.lastConfirmedSaveAt,
            lastAttemptAt: health.lastAttemptAt || dataHealth.lastSaveAttemptAt,
            lastFailure: failureText,
            writesBlocked: health.writesBlocked === true,
            dirty: health.dirty === true,
            lastManualBackupAt: dataHealth.lastAtelierExportAt,
            cloudConfigured: !!(cloudProvider && cloudProvider.status && (cloudProvider.status.ready || cloudProvider.status.configured)),
            autoBackupEnabled: !!(cloudMeta.autoBackup && cloudMeta.autoBackup.enabled),
            lastCloudBackupAt: cloudMeta.lastBackupAt,
            lastAutoBackupAt: cloudMeta.lastAutoBackupAt,
            cloudError: cloudMeta.lastError,
            online: !global.navigator || global.navigator.onLine !== false,
            quotaRisk: /quota/i.test(failureText) || Object.keys(degraded).some(function (key) { return /quota/i.test(String(degraded[key] && degraded[key].classification || '')); }),
            attachmentWarnings: warningRows.length,
            missingAssets: warningRows.filter(function (row) { return /missing|unavailable/i.test(String(row && (row.message || row) || '')); }).length,
            lastSnapshotAt: dataHealth.lastPreImportSnapshotAt,
            restorePointCount: Number(dataHealth.workspaceSnapshotCount) || 0
        };
    }

    function deriveConfidence() { return deriveConfidenceFromSignals(collectSignals(), Date.now()); }

    var LABELS = {
        save_failed: 'Local save failed — export an emergency backup',
        unsaved_changes: 'Changes are not yet confirmed saved',
        save_unconfirmed: 'No confirmed local save yet',
        backup_incomplete: 'Saved, but backup assets need attention',
        saved_and_backed_up: 'Saved locally and recently backed up',
        backup_stale: 'Saved locally — backup is stale',
        saved_no_backup: 'Saved locally — no backup yet'
    };
    function getIndicatorText(status) { return LABELS[status.protectionState] || LABELS.save_unconfirmed; }
    function getIndicatorIcon(status) {
        if (/failed|incomplete/.test(status.protectionState)) return 'fa-triangle-exclamation';
        if (/unsaved|unconfirmed|stale|no_backup/.test(status.protectionState)) return 'fa-clock';
        return 'fa-shield-halved';
    }
    function getIndicatorColor(status) {
        if (/failed|incomplete/.test(status.protectionState)) return 'var(--danger, #e74c3c)';
        if (/unsaved|unconfirmed|stale|no_backup/.test(status.protectionState)) return 'var(--warning, #f39c12)';
        return 'var(--success, #27ae60)';
    }

    function appendStatusRow(parent, title, detail) {
        var row = document.createElement('div');
        row.className = 'tac-item';
        var heading = document.createElement('span');
        heading.className = 'tac-item-title';
        heading.textContent = title;
        var meta = document.createElement('span');
        meta.className = 'tac-item-meta';
        meta.textContent = detail;
        row.appendChild(heading);
        row.appendChild(meta);
        parent.appendChild(row);
    }

    function updateTodayBackupCard() {
        var badge = document.getElementById('tccBackupBadge');
        var list = document.getElementById('tccBackupList');
        if (!badge && !list) return;
        var status = deriveConfidence();
        if (badge) { badge.textContent = getIndicatorText(status); badge.style.color = getIndicatorColor(status); }
        if (list) {
            list.replaceChildren();
            appendStatusRow(list, 'Local save: ' + status.local.state.replace(/_/g, ' '), status.local.age);
            appendStatusRow(list, 'Manual backup: ' + status.manualBackup.state.replace(/_/g, ' '), status.manualBackup.age);
            appendStatusRow(list, 'Cloud backups: ' + status.cloud.state.replace(/_/g, ' '), status.cloud.error || status.cloud.age);
            if (status.offline) appendStatusRow(list, 'Offline', 'Local saving remains available; cloud backup cannot run.');
            if (status.attachmentWarnings || status.missingAssets) appendStatusRow(list, 'Backup completeness', status.attachmentWarnings + ' attachment warning(s)');
        }
    }

    function init() {
        ['sutra:persistence-health-changed', 'sutra:cloud-status', 'online', 'offline', 'visibilitychange'].forEach(function (name) {
            global.addEventListener(name, updateTodayBackupCard);
        });
        global.setInterval(updateTodayBackupCard, 300000);
        global.setTimeout(updateTodayBackupCard, 2000);
    }

    var api = {
        deriveConfidence: deriveConfidence,
        deriveConfidenceFromSignals: deriveConfidenceFromSignals,
        collectSignals: collectSignals,
        getIndicatorText: getIndicatorText,
        getIndicatorIcon: getIndicatorIcon,
        getIndicatorColor: getIndicatorColor,
        updateTodayBackupCard: updateTodayBackupCard,
        MANUAL_STALE_MS: MANUAL_STALE_MS,
        CLOUD_STALE_MS: CLOUD_STALE_MS
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.SutraBackupConfidence = api;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
}(typeof window !== 'undefined' ? window : globalThis));
