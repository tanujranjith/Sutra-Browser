# Workspace snapshot browser + diff — Wave D

Per-note version history and Trash already existed; this adds **whole-workspace**
restore points with a compare view.

- **Create snapshot** — captures the entire workspace (JSON projection) as a local
  restore point. Bounded to the 3 most recent; oldest is dropped. A size guard
  refuses snapshots over ~2.5 MB and points you to a full `.sutra` export instead
  (snapshots live in local storage, not in the backup, so they stay lightweight).
- **Restore** — replaces the current workspace, saving a **"Before restore"**
  snapshot first, then reloads. Reversible.
- **Diff** — compares a snapshot against the current workspace and shows
  collection-level deltas (e.g. `pages +2`, `tasks -1`, `reviewCards +10`).
- **Delete** — removes a snapshot.

Open via **Ctrl/⌘+Shift+P → Workspace snapshots** (or `window.openSnapshotBrowserModal()`).
APIs: `createWorkspaceSnapshot`, `getWorkspaceSnapshots`, `diffWorkspaceSnapshot`,
`restoreWorkspaceSnapshot`, `deleteWorkspaceSnapshot`.

## Verification

`tests/e2e/snapshot-browser-wave-d.spec.mjs` covers create + summary, diff deltas
after a change, the browser modal, and the cap (oldest dropped). Restore reloads
the app and is exercised manually.
