/*
 * Sutra Sync engine — the state machine that runs the
 * pull → decrypt → merge → apply → diff → encrypt → push cycle against an
 * injected store, transport, vault key, and app bridge. No DOM, no direct
 * app.js references: everything arrives through the constructor, so the
 * whole engine runs headless in Node tests.
 * Spec: docs/architecture/SYNC_PROTOCOL.md §9.
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var protocolApi = isNode ? require('./sync-protocol.js') : global.SutraSyncProtocol;
  var projectionApi = isNode ? require('./sync-projection.js') : global.SutraSyncProjection;
  var diffApi = isNode ? require('./sync-diff.js') : global.SutraSyncDiff;
  var mergeApi = isNode ? require('./sync-merge.js') : global.SutraSyncMerge;
  var cryptoApi = isNode ? require('./sync-crypto.js') : global.SutraSyncCrypto;

  var BACKOFF_BASE_MS = 5000;
  var BACKOFF_MAX_MS = 5 * 60 * 1000;
  var LOCAL_CHANGE_DEBOUNCE_MS = 2500;
  var MAX_STALE_CURSOR_RETRIES = 3;
  var MAX_PULL_PAGES = 40;
  var COMPACT_EVERY_OPS = 500;
  var CONFLICT_STORM_LIMIT = 8;
  var CONFLICT_STORM_WINDOW_MS = 60 * 1000;

  function create(options) {
    var config = options || {};
    var store = config.store;
    var transport = config.transport;
    var bridge = config.bridge || {};
    var identity = config.identity || {};
    if (!store) throw new Error('SutraSyncEngine requires a store.');
    if (!transport) throw new Error('SutraSyncEngine requires a transport.');
    if (!identity.deviceId) throw new Error('SutraSyncEngine requires identity.deviceId.');
    if (typeof bridge.getWorkspaceSnapshot !== 'function') throw new Error('bridge.getWorkspaceSnapshot is required.');
    if (typeof bridge.applyMergedWorkspace !== 'function') throw new Error('bridge.applyMergedWorkspace is required.');

    var timers = config.timers || {};
    var nowFn = typeof timers.now === 'function' ? timers.now : function () { return Date.now(); };
    var randomFn = typeof timers.random === 'function' ? timers.random : function () { return Math.random(); };
    var setTimeoutFn = typeof timers.setTimeout === 'function' ? timers.setTimeout : function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimeoutFn = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : function (handle) { return clearTimeout(handle); };
    // Optional cross-tab single-flight guard: async (work) => ran:boolean.
    var acquireCycleLock = typeof config.acquireCycleLock === 'function'
      ? config.acquireCycleLock
      : function (work) { return work().then(function () { return true; }); };

    var vaultKey = config.vaultKey || null;
    var schemaVersion = Number(identity.schemaVersion) || 0;

    var status = {
      state: vaultKey ? 'idle' : 'locked',
      lastError: null,
      lastSyncAt: null,
      lastCursor: 0,
      outboxDepth: 0,
      conflictsPending: 0,
      assetsPending: 0,
      cycles: 0
    };
    var running = false;
    var dirty = false;
    var stopped = false;
    var paused = false;
    var debounceHandle = null;
    var retryHandle = null;
    var backoffAttempts = 0;

    function setState(state, error) {
      status.state = state;
      status.lastError = error ? String(error && error.message ? error.message : error) : null;
      if (typeof bridge.onStatusChange === 'function') {
        try { bridge.onStatusChange(getStatus()); } catch (callbackError) { /* status is advisory */ }
      }
    }

    function getStatus() {
      return {
        state: status.state,
        lastError: status.lastError,
        lastSyncAt: status.lastSyncAt,
        lastCursor: status.lastCursor,
        outboxDepth: status.outboxDepth,
        conflictsPending: status.conflictsPending,
        assetsPending: status.assetsPending,
        cycles: status.cycles
      };
    }

    function setVaultKey(key) {
      vaultKey = key || null;
      if (vaultKey && status.state === 'locked') setState('idle');
      if (!vaultKey) setState('locked');
    }

    function scheduleRetry() {
      if (stopped || paused) return;
      var baseDelay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, backoffAttempts));
      // ±20% jitter prevents many tabs/devices reconnecting in a request wave.
      var jitter = 0.8 + (Math.max(0, Math.min(1, Number(randomFn()) || 0)) * 0.4);
      var delay = Math.max(1000, Math.round(baseDelay * jitter));
      backoffAttempts += 1;
      if (retryHandle) clearTimeoutFn(retryHandle);
      retryHandle = setTimeoutFn(function () {
        retryHandle = null;
        runCycle();
      }, delay);
    }

    function noteLocalChange() {
      if (stopped || paused || !vaultKey) return;
      if (debounceHandle) clearTimeoutFn(debounceHandle);
      debounceHandle = setTimeoutFn(function () {
        debounceHandle = null;
        runCycle();
      }, Number(config.debounceMs) >= 0 ? Number(config.debounceMs) : LOCAL_CHANGE_DEBOUNCE_MS);
    }

    async function decryptPulledOps(envelopes) {
      var ops = [];
      for (var i = 0; i < envelopes.length; i += 1) {
        var meta = envelopes[i] && envelopes[i].meta ? envelopes[i].meta : {};
        if (Number(meta.protocolVersion) > protocolApi.PROTOCOL_VERSION) {
          var protocolError = new Error('A newer Sutra on another device uses sync protocol v' + meta.protocolVersion + '. Update Sutra to keep syncing.');
          protocolError.code = 'update-required';
          throw protocolError;
        }
        if (Number(meta.schemaVersion) > schemaVersion) {
          var schemaError = new Error('Another device syncs a newer workspace format (v' + meta.schemaVersion + '). Update Sutra on this device to continue.');
          schemaError.code = 'update-required';
          throw schemaError;
        }
        ops.push(await cryptoApi.decryptOpEnvelope(vaultKey, envelopes[i]));
      }
      return ops;
    }

    async function pullAll(cursor) {
      var all = [];
      var current = Number(cursor) || 0;
      for (var page = 0; page < MAX_PULL_PAGES; page += 1) {
        var result = await transport.pull({ cursor: current });
        if (!result || result.ok === false) {
          var pullError = new Error('Sync pull failed' + (result && result.code ? ' (' + result.code + ')' : '.'));
          pullError.code = result && result.code ? result.code : 'transport';
          throw pullError;
        }
        var ops = Array.isArray(result.ops) ? result.ops : [];
        for (var i = 0; i < ops.length; i += 1) all.push(ops[i]);
        var nextCursor = Number(result.cursor) || current;
        if (!ops.length || nextCursor <= current) return { ops: all, cursor: nextCursor > current ? nextCursor : current };
        current = nextCursor;
      }
      var pageError = new Error('The sync operation log is too large to pull safely without a newer snapshot.');
      pageError.code = 'snapshot-required';
      throw pageError;
    }

    async function performCycle() {
      status.cycles += 1;
      setState('syncing');

      var meta = {
        lamport: Number(await store.getMeta('lamport')) || 0
      };
      var lamportCounter = meta.lamport;
      var identityForDiff = {
        deviceId: String(identity.deviceId),
        schemaVersion: schemaVersion,
        clientTime: new Date(nowFn()).toISOString(),
        nextLamport: function () { lamportCounter += 1; return lamportCounter; }
      };

      for (var attempt = 0; attempt <= MAX_STALE_CURSOR_RETRIES; attempt += 1) {
        var storedBaseline = await store.getBaseline();
        var baseline = storedBaseline && storedBaseline.records && storedBaseline.hashes
          ? storedBaseline
          : { cursor: 0, records: {}, hashes: {} };
        var previousOutbox = await store.getOutbox();
        var tombstones = await store.getTombstones();

        // New-device bootstrap: no acknowledged baseline yet. Fetch the
        // encrypted compaction snapshot (if the vault has one) — it becomes
        // the REMOTE base (ops below its cursor may be pruned server-side),
        // while the acknowledged baseline stays empty so the merge unions
        // local state with the vault instead of diff-deleting either side.
        var remoteBaseRecords = null;
        var pullFromCursor = baseline.cursor;
        if (!storedBaseline && typeof transport.getSnapshot === 'function') {
          var snapshotResult = await transport.getSnapshot();
          if (snapshotResult && snapshotResult.ok !== false && snapshotResult.snapshot) {
            var snapshotValue = await cryptoApi.decryptSnapshotEnvelope(vaultKey, snapshotResult.snapshot);
            if (snapshotValue && snapshotValue.records && typeof snapshotValue.records === 'object') {
              remoteBaseRecords = snapshotValue.records;
              // The cursor comes from the envelope's AAD-authenticated meta —
              // never from the transport response, which a hostile server
              // could inflate to make the client skip ops after the snapshot.
              pullFromCursor = Number(snapshotResult.snapshot.meta && snapshotResult.snapshot.meta.cursor) || 0;
              await store.setMeta('lastSnapshotCursor', pullFromCursor);
            }
          }
        }

        // The app debounces autosaves; land any pending save BEFORE taking
        // the snapshot so the snapshot is the durable truth (and the cycle
        // never livelocks behind the debounce timer).
        if (typeof bridge.flushPendingSave === 'function') {
          await bridge.flushPendingSave();
        }
        var workspaceSnapshot = await bridge.getWorkspaceSnapshot();
        var currentProjection = projectionApi.buildProjection(workspaceSnapshot);
        var currentHashes = await projectionApi.hashProjection(currentProjection);

        var outbox = diffApi.computeOutbox({
          baseHashes: baseline.hashes,
          currentRecords: currentProjection.records,
          currentHashes: currentHashes,
          previousOutbox: previousOutbox,
          identity: identityForDiff
        });
        status.outboxDepth = outbox.ops.length;
        // Persist the lamport high-water mark BEFORE any push so a crash can
        // never reuse an opId with different content (opIds are the server's
        // idempotency key).
        if (lamportCounter !== meta.lamport) {
          await store.setMeta('lamport', lamportCounter);
          meta.lamport = lamportCounter;
        }
        // Persist BEFORE the first network request. A failed pull/reload keeps
        // stable opIds in the durable offline queue instead of regenerating
        // different operations on every retry.
        await store.replaceOutbox(outbox.ops);

        var pulled = await pullAll(pullFromCursor);
        var remoteOps = await decryptPulledOps(pulled.ops);

        // Lamport clocks advance when a device OBSERVES a remote operation.
        // Without this high-water update, a field-merged resolution could be
        // emitted with a smaller clock than the operation it incorporates;
        // another replay would then prefer the stale predecessor and reopen
        // the same conflict. Initial outbox ops above remain correctly
        // concurrent because they were created before this pull.
        for (var ro = 0; ro < remoteOps.length; ro += 1) {
          var observedLamport = Number(remoteOps[ro] && remoteOps[ro].lamport) || 0;
          if (observedLamport > lamportCounter) lamportCounter = observedLamport;
        }

        var mergeResult = await mergeApi.merge({
          baseRecords: baseline.records,
          baseHashes: baseline.hashes,
          localRecords: currentProjection.records,
          localHashes: currentHashes,
          remoteOps: remoteOps,
          remoteBaseRecords: remoteBaseRecords,
          localOps: outbox.ops,
          tombstones: tombstones,
          ownDeviceId: String(identity.deviceId),
          now: nowFn()
        });

        // Conflict artifacts are advisory records, never workspace pages.
        // Detect a rapid stream of NEW deterministic conflict ids before any
        // remote state is applied or pushed. This fail-closed circuit breaker
        // keeps local saving available while preventing a regression from
        // manufacturing dozens of review records in a loop.
        var resolvedConflictIds = {};
        var mergedRecordKeys = Object.keys(mergeResult.mergedRecords || {});
        for (var mr = 0; mr < mergedRecordKeys.length; mr += 1) {
          var mergedRecord = mergeResult.mergedRecords[mergedRecordKeys[mr]];
          if (mergedRecord && mergedRecord.kind === 'sync_conflict_resolution' && mergedRecord.conflictId) {
            resolvedConflictIds[String(mergedRecord.conflictId)] = String(mergedRecord.resolution || 'resolved');
          }
        }
        if (typeof store.resolveConflict === 'function') {
          var resolvedIds = Object.keys(resolvedConflictIds);
          for (var ri = 0; ri < resolvedIds.length; ri += 1) {
            await store.resolveConflict(resolvedIds[ri], resolvedConflictIds[resolvedIds[ri]]);
          }
        }
        var newConflicts = (mergeResult.conflicts || []).filter(function (conflict) {
          return !(conflict && conflict.id && resolvedConflictIds[String(conflict.id)]);
        });
        var storedConflicts = await store.listConflicts({ includeResolved: true });
        var storedConflictIds = {};
        for (var sc = 0; sc < storedConflicts.length; sc += 1) {
          if (storedConflicts[sc] && storedConflicts[sc].id) storedConflictIds[storedConflicts[sc].id] = true;
        }
        var uniqueConflictIds = {};
        var novelConflictCount = 0;
        for (var nc = 0; nc < newConflicts.length; nc += 1) {
          var nextConflict = newConflicts[nc];
          if (!nextConflict || !nextConflict.id || uniqueConflictIds[nextConflict.id]) continue;
          uniqueConflictIds[nextConflict.id] = true;
          if (!storedConflictIds[nextConflict.id]) novelConflictCount += 1;
        }
        if (novelConflictCount > 0) {
          var burst = await store.getMeta('conflictBurstV1');
          var burstNow = nowFn();
          if (!burst || !Number(burst.startedAt)
            || burstNow - Number(burst.startedAt) > CONFLICT_STORM_WINDOW_MS) {
            burst = { startedAt: burstNow, count: 0 };
          }
          burst.count = Number(burst.count || 0) + novelConflictCount;
          await store.setMeta('conflictBurstV1', burst);
          if (burst.count >= CONFLICT_STORM_LIMIT) {
            // Baseline and cursor deliberately remain unchanged. The durable
            // outbox already contains the user's edits and will retry only
            // after explicit Resume/Sync now recovery.
            var stormError = new Error('Sync paused after detecting an abnormal conflict loop. Local saving is still available; review conflicts, then resume sync.');
            stormError.code = 'conflict-storm';
            stormError.conflicts = burst.count;
            throw stormError;
          }
        }

        // A conflict record contains the only retained copy of an unresolved
        // alternate branch. Persist it BEFORE applying the chosen merged
        // workspace or pushing a resolution op. If IndexedDB rejects this
        // write, abort the cycle: the durable outbox and current local
        // workspace remain intact and the server cursor/baseline do not
        // advance. Treating this as advisory would be a data-loss path.
        for (var c = 0; c < newConflicts.length; c += 1) {
          var conflict = newConflicts[c];
          if (!conflict.id) {
            conflict.id = conflict.recordKey + '|' + (conflict.loserOpId || conflict.winnerOpId || 'undetermined');
          }
          await store.putConflict(conflict);
        }

        var mergedHashes = await projectionApi.hashProjection({ records: mergeResult.mergedRecords });
        var mergedDiffersFromLocal = protocolApi.stableStringify(mergedHashes) !== protocolApi.stableStringify(currentHashes);

        if (mergedDiffersFromLocal) {
          if (typeof bridge.isSaveIdle === 'function' && !bridge.isSaveIdle()) {
            // A save appeared during pull/merge (live typing). Try to land it
            // once; if the user is still mid-edit, defer to the next cycle.
            if (typeof bridge.flushPendingSave === 'function') {
              await bridge.flushPendingSave();
            }
            if (!bridge.isSaveIdle()) {
              setState('idle');
              noteLocalChange();
              return { applied: false, reason: 'save-busy' };
            }
            // The flushed save may have changed the projection: restart the
            // cycle so the merge sees the latest durable state.
            continue;
          }
          var mergedWorkspace = projectionApi.applyProjectionToWorkspace(
            workspaceSnapshot,
            { records: mergeResult.mergedRecords }
          );
          await bridge.applyMergedWorkspace(mergedWorkspace);
        }

        // Review records are already durable above. Notify the UI only after
        // the corresponding merged workspace has been applied successfully.
        if (newConflicts.length && typeof bridge.onConflicts === 'function') {
          try { bridge.onConflicts(newConflicts); } catch (conflictCallbackError) { /* advisory */ }
        }
        status.conflictsPending = (await store.listConflicts()).length;

        // Attachments: upload referenced blobs the server lacks BEFORE the
        // ops referencing them push; fetch referenced blobs missing locally
        // now that the merged records are applied.
        var assetStats = await syncAssets();
        status.assetsPending = assetStats.pending;

        // Re-diff the merged state against the server head → what still
        // needs pushing (local edits, conflict copies, resurrections).
        var postMergeOutbox = diffApi.computeOutbox({
          baseHashes: mergeResult.remoteHashes,
          currentRecords: mergeResult.mergedRecords,
          currentHashes: mergedHashes,
          previousOutbox: outbox.ops,
          identity: identityForDiff
        });
        if (lamportCounter !== meta.lamport) {
          await store.setMeta('lamport', lamportCounter);
          meta.lamport = lamportCounter;
        }
        status.outboxDepth = postMergeOutbox.ops.length;

        var finalCursor = pulled.cursor;
        var acknowledgedRecords;
        var acknowledgedHashes;

        if (postMergeOutbox.ops.length) {
          var envelopes = [];
          for (var e = 0; e < postMergeOutbox.ops.length; e += 1) {
            envelopes.push(await cryptoApi.encryptOpEnvelope(vaultKey, postMergeOutbox.ops[e]));
          }
          var pushResult = await transport.push({ ops: envelopes, cursor: pulled.cursor });
          if (!pushResult || pushResult.ok === false) {
            var code = pushResult && pushResult.code ? pushResult.code : 'transport';
            if (code === 'stale-cursor' && attempt < MAX_STALE_CURSOR_RETRIES) {
              // Someone pushed between our pull and push: persist the queue,
              // advance nothing, and go around (pull → merge → push again).
              await store.replaceOutbox(postMergeOutbox.ops);
              await store.setTombstones(mergeResult.tombstones);
              continue;
            }
            var pushError = new Error('Sync push failed (' + code + ').');
            pushError.code = code;
            throw pushError;
          }
          finalCursor = Number(pushResult.cursor) || pulled.cursor;
          // Server now holds merged state (remote head + our ops).
          acknowledgedRecords = mergeResult.mergedRecords;
          acknowledgedHashes = mergedHashes;
        } else {
          acknowledgedRecords = mergeResult.remoteRecords;
          acknowledgedHashes = mergeResult.remoteHashes;
        }

        await store.commitCycleState({
          baseline: { cursor: finalCursor, records: acknowledgedRecords, hashes: acknowledgedHashes },
          outboxOps: [],
          tombstones: mergeResult.tombstones,
          meta: { lastServerCursor: finalCursor, lamport: lamportCounter }
        });

        // `lastSeenCursor` is the server's pruning acknowledgement, not a
        // delivery receipt. Advance it only after the baseline/outbox commit
        // (and any remote workspace apply/readback above) is durable. A pull or
        // push response alone is insufficient: the tab can still crash or the
        // local commit can fail before incorporating those operations.
        if (typeof transport.touchDevice === 'function') {
          var touchResult = await transport.touchDevice({ cursor: finalCursor });
          if (!touchResult || touchResult.ok === false) {
            var touchCode = touchResult && touchResult.code ? touchResult.code : 'transport';
            var touchError = new Error('Sync cursor acknowledgement failed (' + touchCode + ').');
            touchError.code = touchCode;
            throw touchError;
          }
        }

        // Compaction: once enough ops accumulated past the last snapshot,
        // upload an encrypted full-projection snapshot at the acknowledged
        // cursor so new devices bootstrap fast and old ops become prunable.
        try {
          await maybeCompact(finalCursor, acknowledgedRecords, assetStats.pending);
        } catch (compactError) { /* compaction is opportunistic, never fatal */ }

        status.lastCursor = finalCursor;
        status.lastSyncAt = nowFn();
        status.outboxDepth = 0;
        backoffAttempts = 0;
        setState('idle');
        return {
          applied: mergedDiffersFromLocal,
          pushed: postMergeOutbox.ops.length,
          pulled: remoteOps.length,
          conflicts: newConflicts.length,
          cursor: finalCursor
        };
      }
      var staleError = new Error('Sync push kept losing the cursor race; will retry.');
      staleError.code = 'stale-cursor';
      throw staleError;
    }

    // Content-addressed attachment sync. Uploads every locally-present blob
    // the workspace references that the server lacks (BEFORE ops referencing
    // it push), and downloads every referenced blob missing locally (records
    // already applied show the app's missing-blob state until the bytes
    // arrive). Upload failures throw (the cycle retries); download failures
    // stay pending and retry on later cycles.
    async function syncAssets() {
      if (typeof bridge.getSyncAssetInventory !== 'function') return { uploaded: 0, downloaded: 0, pending: 0 };
      if (typeof transport.putAsset !== 'function' || typeof transport.getAsset !== 'function') return { uploaded: 0, downloaded: 0, pending: 0 };
      var inventory = await bridge.getSyncAssetInventory();
      var uploaded = 0;
      var downloaded = 0;
      var pending = 0;
      for (var i = 0; i < inventory.length; i += 1) {
        var ref = inventory[i];
          if (!ref || !ref.hash) continue;
        if (ref.present) {
          var assetState = await store.getAssetState(ref.hash);
          if (assetState && assetState.status === 'uploaded') continue;
          await store.setAssetState(ref.hash, { hash: ref.hash, status: 'pending-upload' });
          var remoteHas = await transport.hasAsset({ hash: ref.hash });
          if (remoteHas && remoteHas.ok === false) {
            var hasError = new Error('Sync asset lookup failed for ' + ref.hash.slice(0, 8) + '.');
            hasError.code = remoteHas.code || 'asset-lookup';
            throw hasError;
          }
          if (!remoteHas || remoteHas.present !== true) {
            var dataUrl = await bridge.readSyncAssetDataUrl(ref.hash);
            if (typeof dataUrl !== 'string' || !dataUrl) { pending += 1; continue; }
            var envelope = await cryptoApi.encryptAssetBytes(vaultKey, new TextEncoder().encode(dataUrl), ref.hash);
            var putResult = await transport.putAsset({ hash: ref.hash, envelope: envelope, size_bytes: dataUrl.length });
            if (!putResult || putResult.ok === false) {
              var uploadError = new Error('Sync asset upload failed for ' + ref.hash.slice(0, 8) + '.');
              uploadError.code = 'asset-upload';
              throw uploadError;
            }
            uploaded += 1;
          }
          await store.setAssetState(ref.hash, { hash: ref.hash, status: 'uploaded' });
        } else {
          await store.setAssetState(ref.hash, { hash: ref.hash, status: 'pending-download', blobKey: ref.blobKey });
          try {
            var got = await transport.getAsset({ hash: ref.hash });
            if (!got || !got.envelope) { pending += 1; continue; }
            var plainBytes = await cryptoApi.decryptAssetBytes(vaultKey, got.envelope);
            var text = new TextDecoder().decode(plainBytes);
            var checkHash = await protocolApi.hashText(text);
            if (checkHash !== ref.hash) {
              await store.setAssetState(ref.hash, { hash: ref.hash, status: 'failed-integrity', blobKey: ref.blobKey });
              pending += 1;
              continue;
            }
            await bridge.storeSyncAssetDataUrl(ref.blobKey, text);
            await store.setAssetState(ref.hash, { hash: ref.hash, status: 'uploaded' });
            downloaded += 1;
          } catch (downloadError) {
            await store.setAssetState(ref.hash, {
              hash: ref.hash,
              status: 'pending-download',
              blobKey: ref.blobKey,
              error: String(downloadError && downloadError.message ? downloadError.message : downloadError)
            });
            pending += 1; // record stays applied with the app's missing-blob state; retried next cycle
          }
        }
      }
      return { uploaded: uploaded, downloaded: downloaded, pending: pending };
    }

    async function uploadSnapshot(cursor, records) {
      if (typeof transport.putSnapshot !== 'function') return false;
      var envelope = await cryptoApi.encryptSnapshotEnvelope(vaultKey, { records: records }, {
        cursor: cursor,
        schemaVersion: schemaVersion
      });
      var result = await transport.putSnapshot({ snapshot: envelope, cursor: cursor });
      if (!result || result.ok === false) return false;
      await store.setMeta('lastSnapshotCursor', cursor);
      // Retention is best-effort. The server independently requires both this
      // snapshot and every active device's durable cursor acknowledgement.
      if (typeof transport.pruneOps === 'function') {
        try { await transport.pruneOps(); } catch (error) { /* next compaction retries */ }
      }
      return true;
    }

    async function maybeCompact(cursor, records, assetsPending) {
      if (Number(assetsPending) > 0) return false;
      var lastSnapshotCursor = Number(await store.getMeta('lastSnapshotCursor')) || 0;
      if (cursor - lastSnapshotCursor < COMPACT_EVERY_OPS) return false;
      return uploadSnapshot(cursor, records);
    }

    // Manual "Optimize sync": upload a snapshot at the current acknowledged
    // baseline regardless of the op threshold.
    async function compactNow() {
      if (!vaultKey) return { ok: false, reason: 'locked' };
      var baseline = await store.getBaseline();
      if (!baseline || !baseline.records) return { ok: false, reason: 'no-baseline' };
      var assets = await syncAssets();
      status.assetsPending = assets.pending;
      if (assets.pending > 0) return { ok: false, reason: 'assets-pending', pending: assets.pending };
      var ok = await uploadSnapshot(Number(baseline.cursor) || 0, baseline.records);
      return { ok: ok };
    }

    async function runCycle() {
      if (stopped || paused || running) {
        if (running) dirty = true;
        return { skipped: true };
      }
      if (!vaultKey) {
        setState('locked');
        return { skipped: true, reason: 'locked' };
      }
      // Multi-tab guard: when another tab has committed the workspace since
      // this tab's last save, this tab's LIVE state is stale — syncing it
      // would push outdated records (and, because tabs share one deviceId,
      // the own-echo rule would let both tabs ping-pong forever). The app
      // already asks the user to reload such a tab; sync respects that.
      if (typeof bridge.isTabStateStale === 'function' && bridge.isTabStateStale()) {
        setState('idle');
        return { skipped: true, reason: 'stale-tab' };
      }
      running = true;
      var outcome = { skipped: true, reason: 'lock-held' };
      try {
        await acquireCycleLock(async function () {
          outcome = await performCycle();
        });
      } catch (error) {
        // A deliberate pause (for example ordinary account sign-out) may land
        // while a network cycle is already in flight. Preserve that explicit
        // user state when the abandoned request later reports an auth error;
        // it must not relabel an intentional sign-out as an expired session.
        if (paused && status.state === 'paused') {
          outcome = { error: error };
        } else if (error && error.code === 'update-required') {
          setState('update-required', error);
        } else if (error && (error.code === 'auth-expired' || error.code === 'unauthorized')) {
          paused = true;
          setState('auth-expired', error);
        } else if (error && (error.code === 'quota-exceeded' || error.status === 413 || error.status === 507)) {
          paused = true;
          setState('quota-exceeded', error);
        } else if (error && (error.code === 'schema-mismatch' || error.code === 'snapshot-required')) {
          paused = true;
          setState('schema-mismatch', error);
        } else if (error && error.code === 'revoked') {
          paused = true;
          setState('revoked', error);
          // `revoked` from an ordinary guarded RPC only locks sync. The app
          // must perform a second, dedicated authenticated status check before
          // it may interpret revocation as a local wipe instruction.
          if (typeof bridge.onDeviceRevoked === 'function') {
            try { await bridge.onDeviceRevoked({ code: 'revoked' }); }
            catch (verificationError) { /* fail locked; never turn ambiguity into deletion */ }
          }
        } else if (error && error.name === 'SyncVaultUnlockError') {
          paused = true;
          setState('encryption-error', error);
        } else if (error && error.code === 'conflict-storm') {
          paused = true;
          setState('conflict-storm', error);
        } else {
          setState('offline', error);
          scheduleRetry();
        }
        outcome = { error: error };
      } finally {
        running = false;
      }
      if (dirty && !stopped && !paused) {
        dirty = false;
        noteLocalChange();
      }
      return outcome;
    }

    function pause() {
      paused = true;
      if (debounceHandle) { clearTimeoutFn(debounceHandle); debounceHandle = null; }
      if (retryHandle) { clearTimeoutFn(retryHandle); retryHandle = null; }
      setState('paused');
    }

    function resume() {
      paused = false;
      backoffAttempts = 0;
      setState(vaultKey ? 'idle' : 'locked');
      if (vaultKey) noteLocalChange();
    }

    function stop() {
      stopped = true;
      pause();
      setState('stopped');
    }

    return {
      noteLocalChange: noteLocalChange,
      syncNow: runCycle,
      compactNow: compactNow,
      getStatus: getStatus,
      setVaultKey: setVaultKey,
      pause: pause,
      resume: resume,
      stop: stop
    };
  }

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraSyncEngine = api;
}(typeof window !== 'undefined' ? window : globalThis));
