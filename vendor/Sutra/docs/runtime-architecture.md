# Runtime architecture and compatibility boundaries

Sutra remains a static, file-compatible application. No bundler is required: `Sutra.html` loads the core runtime in deterministic order, while optional packs are loaded from the generated asset manifest only after their setting is enabled.

## Current module boundaries

- `src/persistence/workspace-db.js` owns the IndexedDB connection and record adapter.
- `src/core/migrations.js` owns sequential persisted-schema transformations. Runtime defaulting remains separate in the application normalizers.
- `src/domain/homework-store.js` is the only writable homework authority. It commits whole workspace snapshots with revision and mutation metadata.
- `src/features/assistant/action-system.js` owns assistant action schemas, permissions, confirmation policy, transactional execution, rollback, persistence, undo receipts, and audit metadata.
- `src/features/feature-registry.js` owns lazy initialization and teardown state for optional packs; `src/config/feature-manifest.js` is the declarative source of pack assets and integrations.
- `src/compat/legacy-homework.js` is a read-only adapter for historical homework keys. Modern code must not write those keys.
- `src/core/dom-safety.js` is the trust boundary for untrusted HTML, URL, CSS, and iframe content.

`src/core/app.js` is still the composition root and contains substantial view and domain code. New persistence, homework, migration, optional-feature, security, and assistant-action behavior should be added through the modules above rather than reintroduced as globals. Further extractions should be small and covered by unit tests before callers are moved.

## Asset and deployment workflow

Run `npm run assets:generate` whenever application scripts or styles change. `npm run assets:check` fails if the checked-in generated manifest is stale. `npm run build:deploy` creates `.deploy` from that manifest, and `npm run check:deploy` verifies it.

To reproduce CI browser testing against the exact deploy artifact in PowerShell:

```powershell
npm ci
npm run check:all
npm run test:unit
npm run build:deploy
npm run check:deploy
$env:SUTRA_SERVE_ROOT = '.deploy'
npm run test:e2e:chromium
Remove-Item Env:SUTRA_SERVE_ROOT
```

The Pages workflow builds once, runs browser tests with `.deploy` as the server root, uploads that directory as the Pages artifact, and deploys without another checkout or rebuild.

## Compatibility retirement policy

Compatibility support is telemetry-free. Migration diagnostics stay in the local workspace or local console and are never transmitted.

Legacy readers may be retired only after all of the following are true:

1. at least two stable schema generations have shipped with the migration;
2. fixtures for the retired format remain readable by the standalone import path;
3. release notes provide a recovery/export path for users who skipped intermediate versions; and
4. new workspaces and backups have not written the deprecated format during that period.

Until then, compatibility adapters must remain read-only, idempotent, and isolated under `src/compat/`.
