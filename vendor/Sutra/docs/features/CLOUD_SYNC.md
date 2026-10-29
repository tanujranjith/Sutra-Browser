# Sutra Cloud — encrypted sync and backups

**Sutra Sync** keeps one workspace identical across devices: record-level,
end-to-end-encrypted, offline-tolerant replication. It is **off by default**,
requires explicit setup, and is a **separate system from backups** — encrypted
`.sutra` exports, Sutra Cloud provider backups, and Google Drive snapshot sync
all keep working unchanged.

Open **Sutra Cloud → Sync · Beta** from its one-time in-app availability notice,
**Settings → Data & Backup**, or the **Sutra Cloud** button in the save bar. The
notice is informational and dismissible: opening Settings, signing in,
restoring a workspace, or acknowledging the notice does not enable Sync or
upload workspace data. Only **Turn on sync**, followed by the passphrase setup,
opts this device in. The explicit enable or disable choice survives reloads,
while an imported workspace can never force-enable Sync on this device.

The Cloud hub has Sync and Backups sections under one account/setup surface.
Its summary reports local saving, replication, and snapshots independently.
After enable/unlock, Sync automatically debounces confirmed saves (2.5 seconds),
retries after reconnect, checks when the app returns to the foreground, and
polls periodically while an engine is active. You do not need to press Sync now
after editing. The vault must be unlocked again each session. Closing the app
stops its timers; this is not an operating-system background service.

Backups remain separately encrypted `.sutra` snapshots, with their own session
passphrase and provider choice. Optional automatic backups default to daily
and run only while the app can reach a ready provider with a session password.
The app-hidden option is best effort, not a guarantee that an upload finishes
after closing the browser. Web Locks serialize scheduled uploads across tabs;
a durable receipt suppresses repeat uploads of the same confirmed workspace.
Browsers without Web Locks leave automatic backups paused and still support
manual backups. Sync's existing IndexedDB lease fallback is unchanged.

Before the first merge, Sutra downloads an encrypted
`sutra-before-sync-*.sutra` safety backup; setup stops if required attachment
bytes are missing. Normative technical spec:
[`docs/architecture/SYNC_PROTOCOL.md`](../architecture/SYNC_PROTOCOL.md).

## Beta safety boundary

Sutra Sync remains a beta while browser, installed-PWA, mobile, account-change,
offline, conflict, and revoke-and-wipe behavior continues to be validated on
real devices. Keep a recent encrypted `.sutra` backup in a separate location.
Revoked devices lose cloud access immediately, but an offline device can
process a requested local wipe only after it reconnects. Sync is useful for
replication, but it is not the only copy you should rely on for recovery.

## Three different guarantees

| Guarantee | Meaning | Where it comes from |
|---|---|---|
| **Saved locally** | Work is durably on THIS device | Always on; the canonical write→readback pipeline |
| **Synced to cloud** | Latest changes are encrypted + replicated for other devices | Sutra Sync (this feature) |
| **Backed up** | A restorable point-in-time snapshot exists | `.sutra` export / Sutra Cloud / Drive sync |

Switching backup destinations preserves an enabled incremental Sync account.
The shared account is signed out only by an explicit account sign-out or
backend change; backup-only connections retain their existing session behavior.

Sync replicates *changes* — including mistakes. Backups preserve *moments*.
Keep both.

## What syncs

Every portable user-created workspace contract syncs: notes and page history,
Canvas documents, Slides decks (including speaker notes and inline local
images), spaces, tasks/order/subtasks/dependencies, timeline and planning data, Homework
courses/assignments and their legacy mirrors, Review, AP Study, Testing Hub,
Course Hub, school/semester/grade data, Focus, college/life/work/portfolio,
custom tabs, trash, private vault documents, migration/compatibility recovery
data, supported settings/themes/preferences, notifications, Assistant
permissions and memory, and durable Assistant conversations (message order,
roles, content, timestamps, citations/sources, grounding, memory references,
and durable action receipts). User-created page version history also follows
the workspace.

Course/private-document files use content-addressed encrypted asset blobs.
Inline note images, document backgrounds, and embedded handwriting bytes travel
inside encrypted page operations and snapshots. A remote attachment reference
is not treated as complete until its bytes decrypt, hash-verify, and persist in
`noteflow_attachments_db`.

Deliberately device-local or excluded: the sync enable flag/endpoint,
per-device UI state (`ui`, active pane, scroll/layout), persistence-health and
cross-tab save stamps, the generated Help page, an untouched generated blank
Assistant thread, API keys, provider credentials, OAuth/Supabase tokens,
passphrases, recovery/vault/derived keys, sync queues/cursors/baselines,
in-flight/streaming Assistant state, and regenerable caches. The exhaustive
machine-readable decision matrix is
[`persistence-inventory.json`](../architecture/persistence-inventory.json).
Because Help & Docs is a generated system resource, snapshot absence is never
treated as deletion: Sutra preserves or deterministically restores exactly one
canonical Help page per space after bootstrap, import, remote apply, migration,
account transitions, and reload without creating Sync operations for it.

## Merge behavior

- Independent changes (different records) merge automatically.
- Identical concurrent changes converge silently.
- Non-overlapping fields on the same record merge automatically: rename versus
  body edit, move versus edit, and reorder versus edit preserve both actions.
- Note HTML is compared semantically and merged at validated top-level block or
  paragraph boundaries. Changes to different blocks merge automatically.
- Incompatible edits to the same block create exactly one item under
  **Sync → Conflicts**. The original note stays in its normal location; no
  automatic “conflict copy” is added to the sidebar. Both complete versions and
  the overlapping paths remain available for review.
- **Keep merged**, **Keep local**, **Keep remote**, and **Keep both as pages**
  are explicit resolution actions. Only Keep both creates another page. A
  stable encrypted resolution marker clears the review item on every device.
- A delete never destroys a newer edit — the edit wins and the record
  resurrects.
- Offline edits queue in a local outbox and upload on reconnect; pushes are
  idempotent (safe against retries and lost acks).
- If a defect would create eight novel conflicts within one minute, Sutra
  pauses cloud sync before applying or pushing more conflict output. Local saves
  continue and queued edits remain intact.

This is conservative sync-time three-way merging, not simultaneous
character-by-character collaboration. A future CRDT/OT editor could replace the
note-content seam, but Sutra does not claim Google Docs-style live co-editing.

## Security model

- A random 256-bit **vault master key** encrypts every change, snapshot, and
  attachment (AES-GCM-256, fresh IV per envelope, routing metadata bound as
  AAD).
- The master key is wrapped by **your sync passphrase**
  (PBKDF2-HMAC-SHA-256, 600k iterations). Only the wrapped blob is stored —
  locally and server-side for new-device bootstrap.
- The server sees ciphertext plus bounded routing metadata: op/device ids,
  record keys (section names + opaque record ids), sizes, and edit timing.
  That metadata boundary is the honest limit of "the server cannot read your
  data" — content, titles, grades, keys, and passphrases are never visible.
- **Lost passphrase + lost recovery kit = permanently unrecoverable synced
  data.** Export the recovery kit (Sync → Security & maintenance) and store it
  safely.
- The wrapped blob includes an authenticated fingerprint of the master key.
  Initial creation and passphrase changes use server-side compare-and-swap, so
  a differing vault key is never overwritten.
- Changing the passphrase rewraps the master key only (fast, no re-encryption).
- **Sign out this device** ends authentication, clears in-memory vault material,
  and pauses sync while keeping the local workspace.
- **Revoke & wipe another device** blocks that device's RPC, key, snapshot, and
  asset access immediately and marks a wipe pending. On its next verified
  connection, every Sutra tab in that browser deletes local workspace,
  attachments, Assistant history/memory, compatibility mirrors, sync/auth state,
  and other Sutra origin storage, then acknowledges completion. Unsynchronized
  work on that device is lost. A browser that stays offline or powered off cannot
  be remotely erased; downloaded backups/external files are not browser data.
- Sync persists the Supabase **refresh token** in its own account-scoped
  IndexedDB (device-local, never exported) so sync survives browser restarts;
  the vault still requires your passphrase each session. Backup-only Cloud
  sign-in remains session-only by default, but its setup offers an explicit
  “Remember me on this device” option that stores the refresh token encrypted
  in the separate `sutra_credentials_db` vault. Neither path places credentials
  in workspace backups or Sync payloads.
  Its device-local queue, baseline, device ID, wrapped key, assets, conflicts,
  and refresh token are namespace-scoped to the authenticated account. If a
  browser profile signs in as a different account, the persisted enable flag
  is cleared, the UI reports Sync as off and account-change-blocked, and cloud
  sync stops before any pull, push, unlock, or enable attempt. Sutra shows
  **Account change needs a separate profile** rather than exposing the former
  account's operational state as the new account. The local-first workspace is
  preserved; use another browser profile before syncing. This is deliberately
  fail-closed, not an automatic cross-account migration. As a
  one-time upgrade boundary, a browser that already had sync enabled before
  account namespaces existed is quarantined on its first post-update sign-in:
  make an encrypted `.sutra` backup of its preserved local workspace, then use
  a fresh profile and the correct account/vault to bootstrap. Sutra never
  guesses which account should receive an old unbound outbox.

## Backend

V1 syncs through the same Supabase project that powers Sutra Cloud backups
(official or bring-your-own). Setup for the project owner:

1. New project: run [`supabase/schema.sql`](../../supabase/schema.sql) (backups), then
   [`supabase/sync-schema.sql`](../../supabase/sync-schema.sql) (sync tables,
   RLS, RPCs). Both idempotent. Existing sync project: run only
   [`supabase/migrations/20260716_device_revoke_wipe.sql`](../../supabase/migrations/20260716_device_revoke_wipe.sql)
   to add revoke-and-wipe state/RPCs, then
   [`supabase/migrations/20260718_sync_account_isolation.sql`](../../supabase/migrations/20260718_sync_account_isolation.sql)
   to tighten `sync-assets` Storage paths, then
   [`supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql`](../../supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql)
   to reproduce the final production policy syntax and remove browser execution
   of `rls_auto_enable()`. All migrations preserve encrypted vault data and are
   safe to rerun. The final policy permits only the exact authenticated
   `<user-id>/<64-character-lowercase-hex-content-hash>` asset path.
2. Configure `supabaseUrl` + `supabaseAnonKey` in
   `src/config/sutra-runtime-config.js` (already done if Sutra Cloud works).
3. Users sign in with the existing email-OTP flow, then enable sync with a
   passphrase.

The client treats the backend as a dumb encrypted op log: append-only ops
keyed by a server cursor, a wrapped vault key, one compaction snapshot, and
content-addressed asset blobs in the private `sync-assets` bucket. Direct
table access is denied; authenticated RPCs and Storage policies require both
`auth.uid()` ownership and an active, non-revoked auth-session/device binding.
`rls_auto_enable()` remains available to the database owner/event-trigger path,
but it is not executable by `PUBLIC`, `anon`, or `authenticated`. Expected
advisor notices for deliberately authenticated, fixed-search-path `sync_*`
`SECURITY DEFINER` RPCs are not equivalent to an exposed internal helper.

## Multi-tab

All tabs of one browser share one sync identity. Cycles are single-flight via
Web Locks, with an expiring IndexedDB lease fallback; status travels over
BroadcastChannel. A tab made stale by another tab's save pauses its syncing
and the app shows its usual reload prompt. Keep one active tab per device.

## Troubleshooting

- **"Locked"** — enter your sync passphrase (per session, by design).
- **"Offline — changes queued"** — edits are safe in the local outbox; they
  upload on reconnect.
- **"Update Sutra to keep syncing"** — another device runs a newer Sutra and
  pushed data this version cannot understand yet. Update this device; nothing
  was changed locally.
- **"Sign in again"** — the account session expired; this never deletes local
  data. Sign in again when ready.
- **"Safely signed this browser out"** — the Supabase session was still bound
  to an older local device identity, usually after browser storage was cleared
  or two fresh tabs raced during initial setup. Sutra ends that stale session,
  clears its persisted refresh token, and leaves the local workspace and Sync
  state intact. Sign in again, then turn on or unlock Sync with the same
  passphrase. Sutra does not generate or save a replacement vault key from this
  error.
- **Revoked device** — cloud access is already blocked. If the owner selected
  Revoke & wipe, local deletion occurs only after Sutra receives the dedicated,
  identity-bound status response; ambiguous failures remain locked, not erased.
- **Quota/schema/encryption states** pause retries instead of creating a
  request storm; the Sync panel shows the specific action needed.
- **Wrong passphrase** — nothing is mutated; try again or use the recovery
  kit's wrapped key with your passphrase.
- **Encrypted cloud data could not be verified** — Sync pauses fail-closed when
  an operation, snapshot, or attachment cannot authenticate with this vault
  key. Your local workspace and outbox remain available. Keep an encrypted
  `.sutra` backup, confirm the same Sutra Cloud account, and use the original
  passphrase or recovery kit. If another trusted device still works, verify it
  before changing the cloud vault. Do not create a replacement key or delete
  the cloud vault just to make the warning disappear; deleting the vault is a
  permanent, all-device action that should only happen after a separate
  confirmed recovery copy exists.
- **Old conflict-copy pages** — use **Clean up old conflict copies**. Sutra first
  requires a fresh encrypted `.sutra` safety backup. It consolidates only
  verified exact semantic duplicates without children; unique or contained
  copies with a verified original move into **Sync > Conflicts** before leaving
  the sidebar. Ambiguous and child-bearing copies remain untouched.
- **Paused to prevent a conflict loop** — local saving still works and the
  outbox is intact. Review the listed conflicts, then resume sync. Do not delete
  unique legacy pages manually unless their content has been compared.

## Testing

- Unit: `node --test tests/unit/sync-*.test.mjs` (protocol, crypto,
  projection, diff, merge incl. seeded convergence property, store, transport,
  engine).
- E2E: `npm run test:e2e:sync` — two isolated browser contexts as two devices
  against a mocked Supabase-shaped backend (real Notes UI field/block merging,
  one hidden overlapping conflict, synchronized resolution, offline divergence,
  delete-vs-edit, bootstrap with reload, attachments,
  two-tab behavior, verified revoke-and-wipe, ordinary-sign-out preservation,
  zero-requests-when-disabled, full UI flow). Its canonical
  “everything workspace” scenario separately proves snapshot-only bootstrap,
  schema-v7 field-level parity for every classified record, Assistant runtime
  hydration, Canvas and Slides page payloads (including incremental Slides
  add/edit/remove behavior), local-mirror restoration, reverse incremental create/update/delete/reorder/
  empty operations, attachment replacement, ciphertext-only server state, and
  locked reload durability.
- Static/unit parity:
  `node scripts/round-trip-check.mjs` and
  `node tests/unit/sync-parity.test.mjs` fail on unclassified fields, omitted
  nested contracts, serializer/protocol drift, or a field-level semantic diff.

The automated E2E backend is Supabase-shaped but synthetic. It does not replace
an authenticated real-project two-account RLS audit or real-device/browser QA.
The operator-run [Account A/B isolation checklist](../release/SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md)
states the required direct REST, RPC, Storage, payload-boundary, anonymous, and
same-profile-account-switch checks without exposing browser credentials to the
test runner.

The latest repository-wide reconciliation, current parity matrix, unattended
evidence, release blocker, migration order, and 30-step operator checklist are
recorded in the [2026-07-22 cloud sync audit](../release/CLOUD_SYNC_AUDIT_2026-07-22.md).

### Verification boundary (2026-07-18)

- The current local validation run completed the named migration, round-trip
  (53-field matrix), persistence, network, CSP, guardrail, and link checks;
  `npm run test:unit` passed 312 tests; and `npm run test:e2e:sync` passed
  14 serialized Chromium scenarios. The focused sync suite now drives the real
  Notes UI through version-history churn, independent title/body edits,
  separate-paragraph edits, one same-block conflict, synchronized resolution,
  repeated pull, and reload.
- The Google Drive browser suite exposed two overlapping-cycle hazards. Drive
  cycles are now serialized/conflict-gated, and a clean pull rechecks the local
  mutation revision after downloading/decrypting before it may restore. The
  deterministic mid-pull-save regression test passed three repeated runs; the
  complete Drive suite passed 8/8.
- After the merge repair, the final `assets:generate`, cache-lock update, and
  `npm run verify` command chain completed successfully in 565.9 seconds: all
  static checks, 312 unit tests, the 196-file deploy artifact and its check, 57
  smoke/backup browser scenarios, and 14 focused sync browser scenarios
  passed. The staged artifact contains the Assistant ownership,
  revoke-and-wipe runtime, Drive repair, field-aware merge and conflict-review
  runtime, all eight sync scripts, and no SQL/test files.
- A normal browser and fresh Incognito profile were manually verified against
  the configured real Supabase project for email OTP, same-vault unlock,
  encrypted snapshot download, new-device workspace restoration, and successful
  synced status. This milestone was performed by the project operator before
  the parity repair and therefore does not by itself prove every newly covered
  field on the real backend.
- The project operator previously verified that publishable-key-only,
  unauthenticated sync-table and protected-RPC calls were denied. That result
  does not replace authenticated cross-account tests.
- The project operator applied the additive
  `20260716_device_revoke_wipe.sql` migration successfully and manually verified
  the principal real-browser workflow on 2026-07-18: Device A revoked Device B;
  Device B retained data while offline, then on reconnect received the verified
  revocation state, removed its local workspace, and required fresh
  authentication/device registration. Reload did not resurrect the revoked
  workspace. This is manual end-to-end evidence, not a substitute for the
  gated two-account REST/RPC/Storage hostile audit below.
- `tests/e2e/real-supabase-conflict-certification.spec.mjs` is an opt-in headed
  harness for the actual local Notes UI and real Supabase transport. It opens
  two isolated contexts, waits for operator-entered OTP/vault unlock, records
  runtime/cache/schema identity, and then checks idle stability, title/body and
  separate-block convergence, one hidden overlapping conflict, resolution,
  replay, and reload. The 2026-07-17 attempt timed out at the manual readiness
  gate before any merge assertion ran, so it is **not** recorded as a passed
  live-backend test.
- Still required before claiming complete real-backend certification:
  authenticated Account A/B direct REST/RPC/Storage isolation, real-vault
  execution of the everything-workspace bidirectional parity scenario after
  this repair, and authenticated network/database payload inspection. Those
  checks require user-controlled authenticated sessions; no token or privileged
  credential should be exported to a test runner.

The gated headed harness for those remaining checks is
`tests/e2e/real-supabase-certification.spec.mjs`. Set
`SUTRA_REAL_CERTIFY=1` and run it with one worker from an interactive desktop.
The operator enters OTPs and vault passphrases only in its labeled browser
windows; the harness compares identity digests and rewrites authenticated probe
requests entirely inside browser memory, so bearer tokens are never returned to
Node or printed.
