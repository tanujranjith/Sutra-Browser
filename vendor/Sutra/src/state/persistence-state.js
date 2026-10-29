/*
 * persistence-state.js — pure persistence-health state policy, extracted from
 * src/core/app.js as part of the incremental decomposition of the global
 * runtime (see docs/architecture/SUTRA_ARCHITECTURE.md → staged extraction).
 *
 * Loaded as a classic <script> BEFORE app.js in Sutra.html, so these top-level
 * declarations live in the SAME shared global scope they did inside app.js —
 * every existing call site resolves unchanged. There is no DOM, no storage,
 * and no dependency on app.js internals here, so this seam is unit-testable
 * in isolation (tests/unit/persistence-state.test.mjs).
 *
 * Owns:
 *   - SUTRA_PERSISTENCE_HEALTH_VERSION  schema version of the health record
 *   - SUTRA_EXPORT_FAILURE_PHASES       failure phases a later save cannot clear
 *   - normalizePersistenceState(raw)    canonical shape of the health record
 *   - resolveConfirmedWorkspaceCheckpointHash(raw) checkpoint compatibility
 */

const SUTRA_PERSISTENCE_HEALTH_VERSION = 2;

function normalizeWorkspaceHash(value) {
    const hash = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{8}$/.test(hash) ? hash : null;
}

function canRecoverMissingCanonicalRoot(options) {
    const source = options && typeof options === 'object' ? options : {};
    if (source.revocationLocked === true || source.actualHash !== null) return false;
    const expectedHash = normalizeWorkspaceHash(source.expectedHash);
    const checkpointHash = normalizeWorkspaceHash(source.lastConfirmedWorkspaceHash);
    return !!expectedHash && checkpointHash === expectedHash;
}

function resolveConfirmedWorkspaceCheckpointHash(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const directHash = normalizeWorkspaceHash(source.lastConfirmedWorkspaceHash);
    if (directHash) return directHash;
    // Builds predating the dedicated checkpoint stored the same confirmed base
    // in this exact missing-root conflict shape. Reuse it only to fail closed on
    // upgrade; a different/non-null root never qualifies.
    const failure = source.lastFailure;
    const conflict = failure && failure.kind === 'conflict' && failure.conflict;
    return conflict && conflict.actualHash === null
        ? normalizeWorkspaceHash(conflict.expectedHash)
        : null;
}

// A successful workspace save does not restore a missing attachment or prove
// that a complete backup can be produced. Export-class failures stay visible
// until a complete encrypted export succeeds; routine autosaves may clear the
// rest. Owned here so exporters, importers, and the health UI agree on one list.
const SUTRA_EXPORT_FAILURE_PHASES = new Set(['attachment-export', 'cache-warming', 'sutra-export', 'emergency-export']);

function normalizePersistenceState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        version: SUTRA_PERSISTENCE_HEALTH_VERSION,
        lastConfirmedSaveAt: source.lastConfirmedSaveAt || null,
        // Device-local proof of the exact canonical root that completed write +
        // readback. If IndexedDB later loses only that root, the still-open tab
        // may safely recreate it without weakening stale-tab protection.
        lastConfirmedWorkspaceHash: normalizeWorkspaceHash(source.lastConfirmedWorkspaceHash),
        lastAttemptAt: source.lastAttemptAt || null,
        lastFailureAt: source.lastFailureAt || null,
        lastFailure: source.lastFailure && typeof source.lastFailure === 'object' ? source.lastFailure : null,
        lastSerializedBytes: Number(source.lastSerializedBytes) || 0,
        lastLocalStorageBytes: Number(source.lastLocalStorageBytes) || 0,
        lastAttachmentCount: Number(source.lastAttachmentCount) || 0,
        lastAttachmentBytes: Number(source.lastAttachmentBytes) || 0,
        lastAttachmentWarnings: Array.isArray(source.lastAttachmentWarnings) ? source.lastAttachmentWarnings.slice(0, 12) : [],
        backupState: String(source.backupState || 'No recent backup'),
        retryCount: Number(source.retryCount) || 0
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUTRA_PERSISTENCE_HEALTH_VERSION,
        SUTRA_EXPORT_FAILURE_PHASES,
        normalizePersistenceState,
        normalizeWorkspaceHash,
        canRecoverMissingCanonicalRoot,
        resolveConfirmedWorkspaceCheckpointHash
    };
}
