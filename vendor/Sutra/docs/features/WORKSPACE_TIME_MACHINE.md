# Workspace Time Machine

Sutra keeps local safety nets so you can recover earlier work without restoring a
whole backup. Today this is built on **per-page version history**; this doc also
records the planned additions (see `docs/FEATURE_WAVE_PROGRESS.md`).

## Page version history (available today)

- Every note keeps up to **20 snapshots** in `page.versions`, captured on save
  with a **5-minute throttle**, plus a forced **"Before restore"** checkpoint so
  restoring is itself reversible.
- Open **Version history** from a note to browse snapshots (newest first) with
  timestamps and a content preview, and **restore** any one. Restore replaces
  **only that note** — never the whole workspace — and is title-hierarchy aware
  (it restores the leaf, keeps the parent path).
- Snapshots are **secret-safe by construction**: they capture only editable
  content fields (`title`, `content`, `icon`, `tags`, layout, comments,
  footnotes, citations, blocks). Identity (`id`, `spaceId`, timestamps) and
  security fields (`isLocked`, `lockHash`, `lockSalt`, `lockDuressVerifier`) are
  **never** captured.
- History survives the `.sutra` round-trip. Invariants are enforced by
  `npm run check:versions` (`scripts/version-history-check.mjs`).

## Whole-workspace snapshots (available today)

- **Snapshot browser** — command palette → "Workspace snapshots"
  (`openSnapshotBrowserModal`). Create/restore/delete up to 3 in-app restore
  points (2.5 MB cap per snapshot; larger workspaces are pointed to `.sutra`
  export). Restoring saves a "Before restore" snapshot first, then replaces the
  workspace and reloads.
- **Diff** — each snapshot can show a summary-level diff (pages/tasks/cards/…
  counts) against the current workspace.
- **Single-note restore (2026-07-07)** — "Notes…" on a snapshot lists the pages
  it holds; "Restore copy" brings one back as a **new** page titled
  "&lt;title&gt; (from snapshot)" — non-destructive, fresh id, lock fields kept
  verbatim so a locked note stays locked.
- **Trash (2026-07-01)** — deleted pages, planner tasks, and homework
  assignments restore from the Trash modal (30-day age purge on top of the
  50-item cap).

## Planned additions (tracked, not yet shipped)

- **Compare view** — a textual diff between two versions of one note (the
  snapshot diff is count-level only).
- **Storage Health settings** — cleanup controls (snapshot cap / age trim) on
  top of the existing `navigator.storage.estimate()` readout.

## Privacy

Nothing here leaves the device. Snapshots are local and, like the rest of the
workspace, only ever exported inside an **encrypted** `.sutra` backup — never to a
network endpoint on their own.
