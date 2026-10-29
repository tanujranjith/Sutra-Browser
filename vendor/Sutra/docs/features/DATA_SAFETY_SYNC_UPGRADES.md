# Data-safety & Sync upgrades

## Trash / restore-deleted (recoverable deletes)

Deleting a page is no longer permanent. Deleted pages are captured into a
**Trash** collection that travels in your `.sutra`/JSON backups, and can be
restored or permanently purged.

- Open Trash via the Command Palette (Ctrl/⌘+Shift+P → **Open Trash**) or
  `window.openTrashModal()`.
- Restore puts the page back (with a fresh id if needed and a valid space);
  "Delete forever" purges one item; "Empty Trash" clears all (with confirm).
- Capacity: the 50 most-recent deletions are kept. Help pages are never trashed.
- New persisted top-level collection `trash`, wired through defaults → hydrate →
  persist → serialize → JSON → import → inventory (verified by round-trip).

## Focus session history + time-by-subject

Completed focus-timer sessions are logged to a `focusSessions` history (habit
timers are excluded). Aggregate your time by subject for the last N days:

- `Ctrl/⌘+Shift+P → Focus stats (this week)` shows total minutes, session count, and
  the top subjects.
- API: `recordFocusSession({minutes, subject, category})` and
  `getFocusStatsBySubject(days)`. New persisted `focusSessions` collection
  (round-trips like the rest of the workspace).
- **Focus Session** is the full-screen presentation of that same canonical
  timer: its duration, remaining time, and play/pause state always match the
  sidebar timer. An explicit shortcut such as **Start 50-min focus** first sets
  that one timer to 50 minutes, then opens it full-screen.

## Storage-usage gauge

**Settings → Data → Storage Health** now shows browser storage usage via
`navigator.storage.estimate()` (e.g. "12 MB of 2 GB (1%) used") where the browser
supports it — a quick read on how close a media-heavy workspace is to quota.

## Live calendar subscriptions (already supported)

Subscribing to a calendar by **ICS URL** with explicit refresh already exists in
**Settings → School schedule → Calendar subscriptions** (add a name + `.ics` URL,
refresh on demand; cached locally). No change needed.

## Cloud providers (scope note)

Sutra Cloud supports encrypted Manual file export, Supabase, WebDAV, Custom HTTP,
and configured Google Drive, OneDrive, and Dropbox connections. Manual encrypted
backup to a synced folder is the simplest default; OneDrive and Dropbox stay in
the **Advanced** group because each needs the student's own OAuth app setup.
Box remains self-host-only (a static browser app cannot safely hold its
confidential OAuth secret), and S3-compatible storage is explicitly **preview**
until SigV4 signing ships. The panel labels each provider's availability instead
of presenting setup-only or preview transports as finished.

## Verification

`tests/e2e/data-safety-upgrades.spec.mjs` covers trash capture/restore/purge,
the Trash modal, and focus-session recording + by-subject aggregation;
`scripts/round-trip-check.mjs` confirms `trash` and `focusSessions` persist.
