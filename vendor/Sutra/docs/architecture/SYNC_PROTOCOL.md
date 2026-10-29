# Sutra Sync Protocol v1

Status: normative. This document is the source of truth for Sutra's incremental,
end-to-end-encrypted multi-device sync ("Sutra Sync"). The machine-readable copy
of the record classification lives in `src/sync/sync-protocol.js`
(`CLASSIFICATION`); a unit test asserts this document's table and the code agree
with `docs/architecture/persistence-inventory.json`.

Sutra Sync is a **separate system from backups**. Encrypted `.sutra` backups,
Sutra Cloud provider backups, and Google Drive snapshot sync are unchanged and
independent recovery mechanisms. Sync replicates *changes*; backups preserve
*moments*.

## 1. Goals / non-goals

Goals:
- Local-first: Sutra stays fully usable with sync disabled; disabled sync makes
  **zero** network requests.
- Changes made on one device appear on others automatically; offline changes
  queue and upload later.
- Record-level three-way merge: independent changes merge automatically;
  concurrent edits to the same record never silently destroy either version.
- The server stores **ciphertext only** plus bounded routing metadata.
- Local persistence remains authoritative while the app runs; sync failures never
  block or corrupt local saving.

Non-goals (v1):
- Real-time character-by-character collaborative editing (no CRDT or OT). Sync
  performs a conservative block-level three-way merge after durable saves.
- Shared/multi-user vaults (one private vault per Supabase auth user).
- Syncing device-local operational state (tokens, caches, scroll positions).

## 2. Identity

- **deviceId** — random UUID generated when sync is enabled on a device; stored
  only in the local sync database. Never appears in workspace exports.
- **lamport** — per-device monotonic counter, incremented for every op the device
  creates. Persisted locally; never decreases.
- **opId** — `"<deviceId>:<lamport>"`. Globally unique, idempotency key.
- **clientTime** — ISO timestamp on each op, **informational only**. Ordering and
  conflict resolution never use wall-clock time (clocks skew and move backward).
- **server cursor** — a server-assigned, monotonically increasing sequence number
  (bigserial). The authoritative pull position. Clients store the last cursor
  they have fully applied.

## 3. Record model

The unit of sync is a **record**, addressed by a record key:

- `c/<collection>/<id>` — one entity in an id-keyed collection.
- `a/<section>` — an atomic section synced as one document.
- `a/<section>.__rest` — the leftover keys of a section whose collections were
  extracted (e.g. `homeworkWorkspace` minus `courses`/`tasks`).
- `o/<name>` — an ordering document (array of ids).

`<id>` segments are encoded with `encodeURIComponent` so `/` in ids cannot forge
keys.

### 3.1 Projection

The **sync projection** is a deterministic flat map `recordKey → value` built
from the dedicated sensitive-stripped sync payload
(`buildWorkspaceExportPayload({mode:'sync',
includeSensitiveSettings:false})`). Sync mode is intentionally distinct from
plaintext JSON recovery: durable Assistant conversations always enter the
encrypted sync payload when chat history is enabled, regardless of the user's
separate plaintext-recovery preference. Determinism rules:

- Values are canonicalized with `stableStringify` (recursively sorted object
  keys; arrays keep their order; `undefined` properties dropped; no NaN/Infinity
  — they serialize as `null` like JSON).
- Each record's **hash** is SHA-256 (hex) of its `stableStringify` form.
- Collection entries missing a usable string `id` fold into the owning section's
  `__rest` record — never dropped, never a crash.
- Unknown/extra fields inside records are preserved verbatim (older clients must
  not strip fields they don't understand).

### 3.2 Classification (v1)

| Workspace field | Class | Record keys |
|---|---|---|
| `pages` | collection | `c/pages/<id>` + `o/pages` |
| `tasks` | collection | `c/tasks/<id>` + `o/tasks` |
| `taskOrder` | ordering | `o/taskOrder` (the field's array value) |
| `timeBlocks` | collection | `c/timeBlocks/<id>` + `o/timeBlocks` |
| `homeworkWorkspace` | collections + rest | `c/homeworkCourses/<id>` + `o/homeworkCourses` (`.courses`), `c/homeworkTasks/<id>` + `o/homeworkTasks` (`.tasks`), `a/homeworkWorkspace.__rest` (schemaVersion, revision, quarantine, …) |
| `reviewWorkspace` | collections + rest | `c/reviewDecks/<id>` + `o/reviewDecks` (`.decks`), `c/reviewItems/<id>` + `o/reviewItems` (`.items`, flat SRS cards with `deckId` refs), `a/reviewWorkspace.__rest` (sessions, settings) |
| `assistantChatHistory` | collections + rest | `c/assistantConversations/<id>` + `o/assistantConversations` (`.conversations`), `a/assistantChatHistory.__rest` (version, currentChatId, legacyMigrationComplete) |
| `customTabs` | collection | `c/customTabs/<id>` + `o/customTabs` |
| `trash` | collection | `c/trash/<id>` + `o/trash` |
| `privateDocuments` | collection | `c/privateDocuments/<id>` + `o/privateDocuments` |
| `attachmentLinks` | collection | `c/attachmentLinks/<id>` + `o/attachmentLinks` |
| `pdfDocuments` | collection | `c/pdfDocuments/<id>` + `o/pdfDocuments` |
| `pdfAnnotations` | collection | `c/pdfAnnotations/<id>` + `o/pdfAnnotations` |
| `syncAuditLog` | collection | `c/syncAuditLog/<id>` + `o/syncAuditLog` |
| `migrationHistory` | collection | `c/migrationHistory/<id>` + `o/migrationHistory` |
| `spaces`, `streaks`, `habitTracker`, `collegeTracker`, `academicWorkspace`, `collegeAppWorkspace`, `lifeWorkspace`, `businessWorkspace`, `apStudyWorkspace`, `courseWorkspace`, `schoolSchedule`, `gradePlanner`, `semesterSetup`, `cramSessions`, `focusSessions`, `focusTemplates`, `testingHub`, `pinnedPages`, `notificationsState`, `protectedTime`, `taskDependencies`, `studySessions`, `masteryRecords`, `confidenceObservations`, `studentDecisionState`, `assistantPermissions`, `assistantMemory`, `sharedStudySessions`, `operatingManual`, `portfolioWorkspace`, `settings`, `globalTheme`, `migrationDiagnostics`, `compatibility`, `localStorageSnapshot`, `schema`, `unknownWorkspaceFields` | atomic | `a/<field>` |
| `version` | reconstructed | travels as `schemaVersion` on every op; the receiver writes its supported version |
| `exportedAt` | ephemeral | export timestamp, never canonical sync state |
| `workspaceMeta`, `ui`, `splitPaneContexts` | excluded | device-local save coordination and browser UI state |

`c/pages/<id>` owns every durable page surface. This includes Notepad content,
Canvas state, the versioned `page.slides` deck (slide order, elements,
speaker notes, and bounded inline local image data). Adding, editing, reordering,
or removing a nested slide, or any versioned `page.spreadsheet` workbook change,
produces an upsert for its owning page; deleting the
page produces the normal page-record tombstone. Snapshot and incremental paths
therefore project the same Slides and Canvas state without editor-specific
stores or operations.

Every collection emits an `o/<collection>` ordering doc capturing its array
order (ids in sequence). Collection entries lacking a usable string `id` fold
into an `a/<field>.__rest` record (`{ orphans: [...] }` for top-level arrays)
so nothing is silently dropped.

The generated Help & Docs page (`help_page` / `systemRole: "help-docs"`) is
excluded at record level because every runtime reconstructs it. Projection
reassembly preserves the receiving device's local generated copy even when a
remote snapshot omits it, contains a stale delete/tombstone, or reuses its
stable id; the standard import/hydration path then reconciles exactly one
canonical Help page per space. User-created
pages—including their version history—travel. The exact top-level, nested,
localStorage, asset, secret, compatibility, and ephemeral decisions are
machine-readable in `persistence-inventory.json`; `round-trip-check.mjs`
fails if defaults, serializer/import, inventory, or protocol drift by name.

### 3.2.1 Record field policies

Some fields inside otherwise-synced records are per-device churn and get a
field-level policy (`CLASSIFICATION.recordFieldPolicies`):

- **hashVolatile** — carried in op payloads but excluded from the record
  hash, so a change to only these fields is not a change. `pages.updatedAt`
  is hashVolatile: the app bumps it on every save of the open page; without
  the policy, every device would forever conflict on whatever page is open.
  `assistantChatHistory.__rest.exportedAt` remains hashVolatile for backwards
  compatibility with older baselines; current sync-mode snapshots omit it.
- **localOnly** — never travel (stripped from payloads and hashes); on apply,
  the receiving device keeps its own values.
  `homeworkWorkspace.__rest.revision`, `updatedAt`, and `lastMutation`
  are localOnly bookkeeping. Page `versions` are durable user history and
  are synchronized.

On convergence (local hash == remote hash) the merge keeps the **local**
record value so hash-volatile metadata is not needlessly clobbered.

Additional exclusions stripped from within the `a/settings` record:
- **`settings.preferences.sync`** — the sync-enable flag and endpoint are
  device-local, and must never force-enable sync on another device.
- **`settings.preferences.assistant.localEndpoint`** — the machine-specific
  local AI endpoint (`baseUrl`, `model`, `visionCapable`) describes this
  device; one device's `192.168.x.x` or `localhost` address must never become
  another device's model configuration. It is also excluded from every
  workspace export/import path, so a backup restore preserves the receiving
  device's local endpoint instead of importing one from another device.
- **`settings.dataHealth`** — mutates on every local save
  (`lastSaveAttemptAt`); syncing it would keep the settings record permanently
  dirty and replicate device-local persistence-health stamps.

On apply, the receiving device re-injects its own current values for all
stripped paths so a remote apply never clobbers device-local state.

Course-file records sync metadata through the workspace projection, but
`_exportBlob`, `dataUrl`, and `missingBlob` are stripped. Actual bytes travel
only through the encrypted content-addressed asset channel. A newly referenced
remote file is marked missing until its bytes decrypt and pass the SHA-256
integrity check.

Native PDF state follows the same projection rules. Attachment relationships,
page plans, bookmarks, and annotations/form answers are independent stable-ID
records. PDF document and annotation `updatedAt` fields are hash-volatile.
Every `sourceFileId` referenced by a page plan is a required attachment asset;
the receiver must not report the PDF workspace complete until each source byte
object decrypts and verifies against its content hash.

Inline note images, document backgrounds, and embedded handwriting bytes travel
inside the encrypted page record/snapshot rather than the external asset
channel. Portable local mirrors—Assistant provider/model labels, Assistant
Memory and Activity, custom starter packs, and Homework countdown pins—travel
only through the allowlisted `localStorageSnapshot`; session keys, tokens,
provider configuration, sync state, and regenerable caches never enter it.

Ordering documents merge by stable item identity: concurrent inserts are
unioned, removals converge, and the greater authenticated operation determines
relative order when both sides reorder the same surviving items. Record content
remains separate, so reorder-versus-edit and move-versus-edit preserve both.

## 4. Op record

```
{
  opId:            "<deviceId>:<lamport>",
  deviceId:        string,
  lamport:         number,
  recordKey:       string,
  kind:            "upsert" | "delete",
  baseHash:        string | null,   // hash the edit was based on (null = created)
  hash:            string | null,   // hash of payload (null for delete)
  payload:         object | array | null,  // record value; null for delete
  schemaVersion:   number,          // APP_SCHEMA_VERSION of the writer
  protocolVersion: 1,
  clientTime:      ISO string       // informational only
}
```

Push is idempotent: the server dedupes on `opId` (unique constraint) and a
duplicate push acknowledges without appending. Pruning may remove the covered
operation row, so the device registry also retains the greatest accepted
Lamport for each device. A sequence at or below that durable high-water cannot
be accepted as fresh after pruning; this preserves replay protection without
retaining the operation ciphertext forever.

### 4.1 Versioning policy

- `protocolVersion` bumps on any incompatible change to op/envelope/record-key
  semantics. A client seeing a higher `protocolVersion` than it supports pauses
  sync with an "update Sutra" status; it never guesses.
- `schemaVersion` is the writer's workspace schema. On pull, remote payloads are
  merged and the merged workspace runs through `SutraMigrations.migrateWorkspace`
  before hydration. A client seeing `schemaVersion > APP_SCHEMA_VERSION` pauses
  sync ("update required") rather than writing state it cannot understand —
  mirroring the stale-asset skew guard philosophy.
- Unknown fields in payloads are preserved verbatim, never stripped.

## 5. Encryption

- **Vault master key**: 256 random bits, generated once per vault when sync is
  first enabled. Encrypts everything. Never leaves the client unwrapped.
- **Key wrapping**: the user's sync passphrase derives a wrapping key via
  PBKDF2-HMAC-SHA-256 (600,000 iterations, 16-byte random salt — matching the
  `.sutra` convention); the master key is AES-GCM-wrapped (fresh 12-byte IV,
  AAD `"sutra-sync-vault:v1:<keyId>"`). `keyId` is the SHA-256 fingerprint of
  the vault key: it authenticates the key identity without exposing the key.
  Only the **wrapped** blob + key id + public KDF params are stored (locally,
  and server-side for new-device bootstrap). A first writer may create the
  remote key; later writes use compare-and-swap. A different key id is a hard
  split-brain error and is never overwritten.
- **Op/snapshot envelopes**: AES-GCM-256 under the vault key, fresh 12-byte IV
  per envelope, 128-bit tag. Envelope:

```
{
  v: 1, alg: "A256GCM",
  iv: base64,
  ct: base64,                    // ciphertext of stableStringify(op)
  meta: { opId, deviceId, lamport, recordKey, kind, protocolVersion, schemaVersion }
}
```

  `meta` is the **only** plaintext the server sees, and it is bound as AAD
  (UTF-8 of `stableStringify(meta)`) — a server that reroutes or relabels an
  envelope causes decryption failure. Known metadata leak, accepted in v1: the
  server can see record keys (section names + opaque ids), op counts, sizes, and
  timing. It can never see note content, titles, tasks, grades, keys, or
  passphrases. (HMAC-blinded record keys are a possible v2 hardening.)
- **Passphrase change** rewraps the master key only; no re-encryption of ops.
  The remote compare-and-swap succeeds before the local wrapper is replaced.
- **Recovery kit**: an exportable file containing the wrapped key blob + KDF
  params + instructions. Without the passphrase or recovery kit the vault is
  permanently unrecoverable (the server cannot help; that is the point).
- Wrong passphrase and tampered blob are cryptographically indistinguishable
  (GCM auth failure) — both surface as a typed `SyncVaultUnlockError`.

Never stored anywhere: plaintext passphrase, unwrapped master key, derived
wrapping key, plaintext workspace content on the server.

## 6. Merge semantics

Three-way merge per record key: `base` (last acknowledged baseline), `local`
(current projection), `remote` (base + pulled ops).

| Local vs base | Remote vs base | Result |
|---|---|---|
| unchanged | changed | take remote |
| changed | unchanged | keep local (op stays queued) |
| changed | changed, same hash | converged; drop the queued op |
| changed | changed, different hash | **conflict** (below) |
| deleted | edited | **edit wins** — record resurrected, tombstone cleared |
| edited | deleted | edit wins — local upsert stands and pushes |
| deleted | deleted | deleted once; single tombstone |

Bootstrap-join precedence: a device with an **empty acknowledged baseline**
(joining the vault) reads every section as "changed" even when it holds
unedited boot defaults. For that device's first merge, the vault's
established **atomic and ordering** records win deterministically over the
local values (per-record collections still union), so lamport noise can never
let a joining device's empty defaults wipe vault data.

Field-aware resolution:
- Raw equality is not required. Page HTML comparison canonicalizes harmless
  browser serialization differences (attribute/class/style ordering,
  inter-tag whitespace, equivalent empty markup); tag sets and version-history
  checkpoints use semantic identity; timestamps and low-risk page metadata use
  explicit deterministic rules.
- Objects merge recursively. Id-keyed arrays merge by record id, set-like tags,
  links, references, and hashes union deterministically, and ordering documents
  use the rule above.
- Page `content`/`body` is split into validated top-level HTML blocks. Changes to
  different paragraphs/blocks merge automatically while preserving the chosen
  raw formatting. Incompatible edits to the same block are not concatenated or
  last-write-won.
- A true overlapping leaf chooses a deterministic displayed value by the
  greater `(lamport, deviceId)` operation, while one stable conflict record
  retains base, merged, local, remote, and overlapping paths for review. The
  record lives only in `sutra_sync_db`; it is never inserted into `c/pages/*`
  or `o/pages`, so it cannot flood the sidebar or recursively conflict.
- Conflict ids derive from the original record, sorted competing op ids, base
  hash, and field paths. Replay deduplicates them. A user resolution writes a
  stable `sync_conflict_resolution` entry in the encrypted `syncAuditLog`
  collection; every device then tombstones/suppresses the matching review item.
  That entry travels to every device, so it carries only opaque audit
  references — the content hash of each competing opId (`winnerAuditId` /
  `loserAuditId`) — never the raw opIds, which embed the originating device
  identity. Only the explicit **Keep both as pages** action creates a second
  normal page.
- Eight novel conflict ids within sixty seconds trips the `conflict-storm`
  circuit breaker before remote apply or push. Local saving and the durable
  outbox continue, but cloud sync pauses for review instead of creating a loop.
- Each unresolved alternate branch is written to the device-local conflict
  store before the selected merged value is applied or pushed. A rejected
  conflict-store transaction aborts the cycle; it is never treated as an
  advisory UI failure because doing so could discard the only retained branch.

Operation replay first honors a direct causal edge (`candidate.baseHash ==
prior.hash`). Truly concurrent operations use `(lamport, deviceId)`. Pulling a
remote operation raises the local Lamport high-water before any merged follow-up
operation is created, so a causal resolution cannot lose to its predecessor.

Tombstones: deletes are recorded locally with the deleting opId and pruned after
**90 days**. Tombstone retention prevents an offline device from resurrecting
data it never saw deleted; the delete-vs-edit rule still lets a *newer edit*
resurrect deliberately. The user-facing Trash feature is independent of
tombstones (trash entries are ordinary synced records).

Invariant: for op sets A and B, direction and replay order produce the same
canonical records and stable conflict ids. Enforced by seeded merge properties,
causal-reorder tests, and a long-running three-device engine test that asserts
quiescence after convergence.

## 7. Transport contract

Device registration and vault discovery are ordered safety boundaries. Tabs in
one browser profile atomically create/read one durable device ID. A structured
RPC failure is never normalized to a missing vault row. In particular,
`device-session-mismatch` ends the stale Supabase session and requires a fresh
sign-in without deleting the workspace, outbox, baseline, conflicts, or wrapped
vault key. A newly generated wrapped key becomes local authority only after the
create-only server RPC confirms it; failed creation leaves no local key behind.

```
pull({ cursor })        -> { ops: [envelope...], cursor }   // ops after cursor, ordered
push({ ops, cursor })   -> { ok: true, cursor }             // atomic append
                         | { ok: false, code: "stale-cursor" }
ping()                  -> { ok: true }
getVaultKey()           -> { wrapped } | null               // wrapped vault key blob
putVaultKey({ wrapped, expectedWrapped }) -> { ok: true }   // compare-and-swap
getSnapshot()           -> { snapshot: envelope, cursor } | null
putSnapshot({ snapshot, cursor }) -> { ok: true }
putAsset(hash, ciphertext) -> { ok: true }                  // idempotent
getAsset(hash)          -> ciphertext | null
hasAsset(hash)          -> boolean
listAssets()            -> [hash...]
listDevices() / touchDevice({ deviceId, label, cursor }) / revokeDevice(deviceId)
getDeviceStatus() / acknowledgeDeviceWipe()
deleteVault()
```

- `push` is atomic: the server checks the client's cursor equals the current
  head **for that vault**; on mismatch it returns `stale-cursor` and the client
  re-pulls, re-merges, and retries (bounded).
- Pull paging: servers may cap rows per pull; clients loop until the returned
  cursor stops advancing.
- Supabase mapping (v1 backend): RPCs `sync_pull` / `sync_push`, tables
  `sync_ops`, `sync_devices`, `sync_vault_keys`, `sync_snapshots`,
  `sync_asset_index` + private Storage bucket `sync-assets` — all isolated by
  `auth.uid()` and an active, non-revoked auth-session/device binding. Direct
  table grants are revoked; browser access is through the checked RPCs. Sync
  assets use exactly `<auth.uid()>/<lowercase-sha256>`; Storage RLS rejects
  cross-account, nested, and filename-shaped paths even when a client crafts
  one. The database event-trigger helper `public.rls_auto_enable()` is not a
  client RPC: `PUBLIC`, `anon`, and `authenticated` have no execute grant while
  the database owner retains it. See `supabase/sync-schema.sql` and the additive
  `supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql`.

## 8. Client storage — `sutra_sync_db` (IndexedDB, separate from the workspace DB)

| Store | Contents |
|---|---|
| `meta` | account-bound deviceId, lamport, wrapped vault key + KDF params, lastServerCursor, protocolVersion, auth session material for sync (device-local) |
| `baseline` | the last acknowledged projection (full values + hashes) tagged with its cursor — the merge base |
| `outbox` | pending ops (plaintext; encryption happens at the transport boundary), max one op per record key (coalesced) |
| `tombstones` | recordKey → { deletedAt, opId }, 90-day retention |
| `assets` | attachment upload/download state (content hash keyed) |
| `conflicts` | device-local encrypted-branch review records and resolved tombstones; never projected as pages |

None of this database is included in `.sutra` exports or any backup. Workspace
schema v6 added explicit portability containers (`schema`, `migrationHistory`,
`migrationDiagnostics`, `compatibility`, and unknown-field preservation).
Schema v7 makes `appData.assistantChatHistory` canonical. Existing legacy chat
localStorage is imported once, then becomes a canonical-to-legacy mirror; an
empty or stale mirror cannot erase synchronized history. Protocol v1 remains
compatible: schema version travels independently on every op.

Every account uses a logical namespace inside `sutra_sync_db`; an account-bound
store instance cannot enumerate or clear another account's device ID, baseline,
outbox, wrapped vault key, refresh token, asset state, or conflict records. A
non-secret local account hint is used only to select that namespace before a
refresh-token renewal. It is deleted by revoke-and-wipe and never enters a
workspace, export, or sync envelope. If an authenticated browser profile
changes accounts, the bridge clears the device's persisted enable flag, reports
Sync as off and account-change-blocked, and stops before any pull, push, unlock,
or enable attempt. It requires a separate profile and preserves local data
rather than merging two cloud identities or rebinding the former account's
operational namespace. A legacy profile that pre-dates namespaces and already has
sync enabled is also quarantined at its first post-update sign-in because the
old unscoped outbox has no trustworthy account binding. The user first creates
an encrypted local backup, then bootstraps the correct account in a fresh
profile; the bridge never guesses an owner for old operational state.

Baseline/cursor rules: the baseline advances **only** when (a) a push is
acknowledged, or (b) a pull-merge has been durably applied and verified by the
normal persistence readback. Crash between diff and ack re-diffs and re-pushes;
opId dedupe makes that safe.

## 9. Engine cycle

States: `disabled → locked → idle → syncing → idle`, plus `offline`
(exponential backoff 5s→5min with jitter and retry on `online`), `paused`,
`auth-expired`, `quota-exceeded`, `schema-mismatch`, `update-required`,
`revoked`, and `encryption-error`.

Multi-tab model: all tabs of one browser profile share one deviceId, one sync
database, and one workspace IndexedDB. Cycles are single-flight across tabs
via the `sutra-sync-cycle-v1` Web Lock (`ifAvailable`: a busy lock skips the
cycle rather than queueing). A tab whose live state is STALE — another tab
committed the workspace after its last save (the app's existing reload-toast
condition) — refuses to sync (`stale-tab` skip): pushing its outdated records
would ping-pong forever, because pulled-back ops from the shared deviceId are
treated as own echoes. The freshest-saved tab syncs; stale tabs resume after
the reload the app already prescribes. Status updates relay to every tab over
the `sutra-sync-events-v1` BroadcastChannel. Browsers without Web Locks use an
atomic expiring lease in `sutra_sync_db`; a heartbeat renews ownership and a
crashed tab's lease can be taken over. (A held leader lock was
deliberately rejected: the leader's live state goes stale the moment another
tab saves, so it would sync outdated data.)

Cycle:

1. Flush/confirm the durable local save (never apply over a mid-debounce
   keystroke), project it, diff it, and durably store the coalesced outbox
   before the first network request.
2. `pull` from lastServerCursor; decrypt + validate envelopes.
3. Raise Lamport from authenticated remote ops; run the field-aware three-way
   merge (§6), applying stable resolution markers and the conflict-storm guard.
4. If merged ≠ current: apply through the standard import path
   (`importWorkspacePayload` → migrations → normalizers → commit with readback
   verification), with echo suppression (reason `sync-remote-apply` + an
   applying-remote flag; baseline advance is the structural backstop).
5. Re-diff the merged state against the remote head → encrypt → `push`.
6. On push/pull completion: atomically commit the cursor + baseline locally and
   clear acked outbox entries. Only after that durable commit (including any
   remote workspace apply/readback) succeeds, acknowledge the incorporated
   cursor to the server with `touchDevice`; delivery alone never advances the
   pruning watermark.

Triggers: confirmed local save (debounced), regained connectivity, tab becoming
visible, manual "Sync now", periodic foreground interval. Sync errors surface in
sync's own status UI — **never** through the local persistence-failure banner.

## 10. Snapshots & new-device bootstrap

- After N ops (default 500) or on demand, the leader uploads an encrypted
  **compaction snapshot** (full projection) tagged with its cursor. Ops at or
  below a snapshot's cursor become prunable server-side; pruning must never
  remove ops above any active device's durably acknowledged cursor. When all
  covered ops are removed, the snapshot cursor remains part of the logical
  server head so later pushes continue from the same monotonic cursor.
- New device: sign in → fetch wrapped vault key → unlock with passphrase →
  download latest snapshot → replay ops after its cursor → validate → apply →
  readback-verify → mark synced. The replay cursor comes from the snapshot
  envelope's **AAD-authenticated** `meta.cursor`, never from the transport
  response — a hostile server cannot pair an old snapshot with an inflated
  cursor to hide ops. Records arriving purely from the snapshot that the
  device holds a live tombstone for are not resurrected. If the device already has local work, the user
  chooses: use cloud here / make this device the vault's initial state / merge
  local into cloud (local state diffs against an empty baseline and pushes
  through the normal merge). A pre-sync `.sutra` safety backup is always created
  first.
- A snapshot is not reported complete while any referenced attachment is
  pending upload/download or failed integrity verification.

## 11. Auth (Supabase backend)

Sync reuses the existing Sutra Cloud email-OTP sign-in. Deliberate deviation
from the backup convention: sync persists the Supabase **refresh token** in
`sutra_sync_db.meta` (IndexedDB, this-device-only, never in workspace data or
exports) so sync survives browser restarts; backups keep their
sessionStorage-only sessions. Every sync RPC binds the authenticated Supabase
`session_id` claim to one registered device row. Revoking that row blocks RPC
and `sync-assets` Storage access on the next request; direct table grants are
revoked so a device cannot bypass the check with PostgREST.

Every browser RPC derives ownership from `auth.uid()` and validates the caller
device against that user; no sync RPC accepts a `userId`/`user_id` ownership
argument. Direct PostgREST access to sync tables is denied even to the owning
authenticated user so device/session revocation cannot be bypassed. The public
browser transport strips accidental ownership hints before issuing an RPC; this
is defense in depth, not the authorization boundary. Real Account A/B REST,
RPC, Storage, and ciphertext inspection remains an operator-run gate described
in [`SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md`](../release/SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md).

### 11.1 Revoke and wipe

Ordinary sign-out and device revocation have different semantics. Sign-out
clears the Supabase session and in-memory vault material, pauses sync, and keeps
the local workspace. `sync_revoke_device` immediately sets `revoked_at`,
`revoked_by`, and `wipe_required`; every data/key/snapshot/asset path remains
denied through the existing active-device authorization.

A denied pull is not a wipe command. The target separately calls
`sync_get_device_status`; only the exact authenticated user + JWT `session_id` +
registered `deviceId` receives the bounded `sutra-device-status-v1` response.
The client additionally binds it to the configured Supabase project and accepts
only `DEVICE_REVOKED` with `wipeRequired: true`. HTTP 401/403, token refresh
failure, offline/DNS/timeout/CSP errors, malformed JSON, other origins, and
generic `revoked` errors remain locked/non-destructive.

After verification, all tabs block writes, cancel pending saves, clear vault
material, close IndexedDB handles, and coordinate over
`sutra-sync-events-v1`. The canonical wipe deletes this origin's local/session
storage plus `noteflow_atelier_db`, `noteflow_attachments_db`, `sutra_sync_db`,
`sutra-drive-sync-keys`, `sutra-fs-config`, and `sutra_share_target_db`, verifies
deletion, then calls `sync_acknowledge_device_wipe` and clears the remaining auth
session. Failure stays locked and unacknowledged. Offline/powered-off browsers
cannot be erased until they reconnect; service-worker app caches, downloaded
`.sutra` files, external backup-folder contents, and unrelated origins are not
deleted.

The principal browser workflow was manually verified against the configured
Supabase project on 2026-07-18: a controller revoked a second device, the target
kept its local data while offline, then wiped on its next verified connection;
reload did not resurrect the workspace and reuse required fresh authentication
and registration. Automated fail-closed, multi-tab, and hostile-account tests
remain required release evidence.
