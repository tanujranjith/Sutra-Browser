# Data and Backups

_How Sutra stores your workspace locally, and how the `.sutra` backup format
exports and restores it. For a verified, implementation-level audit of the
persistence and round-trip behavior, see the companion
[`sutra-save-systems-audit.md`](../architecture/sutra-save-systems-audit.md)._

---

## 1. Persistence architecture

Sutra keeps your workspace on your device in a small number of local stores.
Several store names are **legacy-named compatibility identifiers** — retained
unchanged across the rename to Sutra so existing installs keep working. The name
is only an identifier; the data is always local.

### Primary store — the workspace (IndexedDB)

Before defaults and feature normalizers run, stored workspaces pass through the
versioned registry in `src/core/migrations.js`. Each migration is pure and
lossless, preserves unknown fields, and is executed against old-workspace
fixtures by `npm run check:migrations`.

- Your entire workspace is a single `appData` object held in **IndexedDB**.
- **Database:** `noteflow_atelier_db` · **store:** `workspace` · **key:** `root`.
- It is hydrated through one merge/normalize path on load and written through one
  debounced save path. Page-hide / unload synchronously snapshots the active
  unlocked note into a bounded same-tab recovery journal while starting the
  normal verified IndexedDB flush; the journal is removed only after matching
  content is confirmed in IndexedDB. PIN-locked note plaintext is never copied
  into this session journal.
- Every accepted full-workspace replacement atomically keeps the previous
  meaningful root at `workspace-last-meaningful`. If startup finds that the
  canonical `root` is present but empty/default, it restores the local journal
  before the application can save. A legacy pre-IndexedDB workspace is used only
  when no meaningful journal exists; record count never outranks recency.
  The displaced empty root is retained at `workspace-empty-before-recovery` for
  diagnostics. Each accepted canonical commit also writes a compact
  `workspace-confirmed-root` data-presence marker in the same transaction, so a
  deliberately emptied and successfully saved workspace is never replaced by
  older data.
  These device-local recovery records are not separate cloud or portable backups.

### Attachments — binary files (IndexedDB)

- Course-file **binaries** live in a separate IndexedDB database,
  `noteflow_attachments_db`, store `blobs`, keyed per file.
- Only the **bytes** live here. Each file's **metadata** lives in the workspace
  (`appData.courseWorkspace.files[]`).
- Canonical `attachmentLinks[]` records connect one stored file to any number
  of courses, notes, homework items, assignments, private documents, or PDF
  page sources. Removing a file from one context removes that link only.
- Native PDF page plans (`pdfDocuments[]`) and Sutra-owned marks/form values
  (`pdfAnnotations[]`) are workspace records. The exact source bytes remain
  immutable. Source bytes may be deleted only after all links and PDF page
  source references have been removed.
- Required PDF/image sources use the same attachment completeness checks,
  encrypted backup packaging, content-addressed Sync assets, and restore
  verification as other canonical attachments. A backup is not reported as
  complete when a required source is missing.

### Homework — localStorage mirror

- Homework is the homework module's own source of truth in **localStorage**:
  `hwCourses:v2` and `hwTasks:v2` (with legacy `:v1` keys read for migration).
- It is **mirrored** into `appData.homeworkWorkspace` at save time and **restored
  to localStorage** on import, so it travels in backups while remaining the live
  source of truth at runtime.
- **Failure handling (storage hardening).** Homework writes go through the shared
  `SutraSafeStorage` wrapper. If a write fails (quota exhausted, private-mode
  security error, etc.), Homework **does not crash and does not lose your change
  in memory**: the new/edited item stays on screen and a **clear, durable warning
  banner** appears (`#sutraStorageWarningBanner`) offering an emergency backup.
  This is **separate** from the catastrophic core IndexedDB save-failure banner
  (`#sutraSaveFailureBanner`), which is reserved for the canonical workspace
  pipeline — a Homework/localStorage hiccup never falsely claims total workspace
  data loss. The warning clears automatically once a write succeeds again.

### Other local data

- A curated allow-list of standalone **localStorage preferences** is embedded in
  exports (focus-timer state, streak settings, AI provider/model **choices**, the
  Assistant Activity log, and a couple of feature flags).
- **Secrets** (AI provider API keys) use **`sessionStorage` by default** and are never exported. If the user explicitly enables “Remember API keys on this device,” Sutra stores them as AES-GCM encrypted records in `sutra_credentials_db`; the vault is device-local and excluded from exports and Sync. This protects against casual database inspection and export leakage, but it is not a passphrase vault: code already executing in Sutra's origin, or anyone able to use that browser profile, can ask Sutra to use remembered credentials. The optional Local AI endpoint (`baseUrl`, model, and vision flag) is device-local too: it is not included in JSON, plaintext, or encrypted `.sutra` exports and is preserved on the receiving device during restore.

---

## 2. The encrypted `.sutra` package

**`.sutra`** is the **default** backup format. Exporting produces a single file
named:

```
sutra_workspace_<YYYY-MM-DD>_<HH-mm-ss>.sutra
```

The date and time are taken from your computer's local timezone (24-hour clock,
zero-padded, hyphens instead of colons so the name is valid on Windows). The
second-level timestamp means repeated exports on the same day no longer collide
or pick up OS-added ` (1)` suffixes.

New exports are not plaintext ZIP files. They are password-encrypted binary
envelopes with this outer format:

```
SUTRAENC                         # 8-byte magic
envelopeVersion                  # 1 byte, currently 1
headerLength                     # 4-byte big-endian unsigned integer
UTF-8 JSON header                # authenticated as AES-GCM additional data
ciphertext                       # AES-GCM ciphertext plus 128-bit tag
```

The outer header contains only decryption metadata: format/version, purpose,
PBKDF2-HMAC-SHA-256 parameters, salt, AES-GCM parameters, IV, tag length, and
payload content type (`application/zip`). It does **not** contain note titles,
asset filenames, course names, settings, counts, or user content.

Encryption parameters:

- AES-GCM with a 256-bit key.
- 128-bit authentication tag.
- Fresh 12-byte IV for every export/upload.
- PBKDF2-HMAC-SHA-256 with 600,000 iterations.
- Fresh 16-byte salt for every manual `.sutra` export.
- `crypto.getRandomValues()` for salt and IV generation.
- The exact encoded header bytes are AES-GCM additional authenticated data.

The ciphertext contains the existing internal ZIP package:

```
manifest.json                     # identifies and describes the backup
workspace.json                    # the full serialized workspace payload
assets/                           # extracted binary/inline assets (deduped)
  <asset files>
metadata/
  export-summary.json             # human-readable summary of what was exported
  checksums.json                  # checksums for integrity verification
```

How assets are handled inside the encrypted package: inline `data:` assets in your workspace — inline note
images and **Document Background** images — are extracted out of the JSON into
the `assets/` folder (deduplicated by content), each with a **checksum**, and
referenced from `workspace.json`. Course-file binaries from the attachments
database are likewise carried in the package. On import the assets are rehydrated
back into the workspace. This keeps the JSON lean and gives every binary an
integrity check.

### Internal manifest fields

`manifest.json` identifies the package as Sutra's and records its format. The
identifying fields include:

```json
{
  "product": "Sutra",
  "format": "sutra-workspace",
  "formatVersion": 1,
  "legacyCompatible": true,
  "appName": "Sutra"
}
```

along with export metadata and a content summary (per-section counts plus asset
and warning counts) and the asset list with per-asset checksum information.

---

## 3. Export vs. import flows

### Export

From **Settings → Data** you can export either:

- **`.sutra`** — the encrypted package described above (default), or
- **JSON** — a single-file projection of the same workspace payload with assets
  inlined (no zip dependency). JSON is unencrypted and should be treated as an
  advanced/recovery format.

Both export paths build the workspace payload **with secrets stripped**: API
keys and other secret-shaped fields are redacted, so credentials are never
written to a backup. Provider/model **choices** (not secrets) are included.

### Import

Importing a backup rebuilds every runtime collection from the file, restores the
course-file binaries into the attachments database, restores the homework
localStorage snapshot, re-applies your theme and preferences, **re-renders every
view**, and writes the result straight back to IndexedDB so the import is durable
across the next reload.

Encrypted `.sutra` import first detects the `SUTRAENC` magic prefix, asks for the
password, derives the key, decrypts with AES-GCM, and only then hands the
recovered internal ZIP bytes to the existing package parser. Package structure,
manifest version, checksums, asset paths, workspace schema, pre-import safety
snapshot, persistence, and render verification all still run. Wrong passwords,
tampered headers, tampered ciphertext, truncated files, and unsupported envelope
versions fail before the current workspace is mutated.

### Legacy `.atelier` import

Older unencrypted **`.sutra`** and **`.atelier`** backups still import. The import
validator accepts **both** the new `sutra-workspace` manifest **and** the legacy
`noteflow_atelier_project` manifest, and the import dispatcher routes legacy
`.sutra` and `.atelier` files to the **same package importer**. Old backups are
never broken.

Plugins follow the same pattern: the new export extension is **`.sutra-plugin`**,
and legacy **`.atelier-plugin`** bundles still import.

---

## 4. Storage Health

> Public-beta hardening note: the app now treats this as **Storage Health**.
> It includes last confirmed save, approximate workspace/localStorage size,
> attachment counts and cached bytes, warnings, and backup state. If a save
> cannot be confirmed, Sutra shows a non-dismissible banner with Retry,
> Emergency `.sutra` Export, Technical Details, last-confirmed-save time, and
> attachment warnings. The live in-memory workspace is preserved; do not close
> the tab until a save recovers or an emergency backup downloads.

After a verified write and readback, Storage Health also keeps a compact
device-local hash of that exact canonical workspace. If the IndexedDB `root`
record later disappears while the page remains open, Sutra may recreate it only
when this independent hash still matches the page's last confirmed base. A
different existing root is never overwritten, and startup fails closed when a
previously confirmed root is missing.

Full `.sutra` packaging uses the vendored local JSZip build in
`assets/vendor/jszip/`, so core backups do not require a CDN request. If a
required attachment blob is missing or cannot be warmed from IndexedDB, Sutra
refuses the `.sutra` export instead of creating a partial backup.

Sutra surfaces a small **Storage Health** readout (formerly "Local Data
Health") so you can see your backup posture at a glance:

- **Last Backup** — when you last exported your workspace.
- **Last Restore** — when you last imported a backup.

Use it as a reminder to take fresh encrypted `.sutra` backups periodically.
Optional Google Drive sync is a convenience layer, not a replacement for a
backup you control.

---

## 5. Optional encrypted Google Drive sync

Google Drive sync is optional and disabled by default. Sutra remains local-first:
IndexedDB/localStorage is the working copy, and local saving does not depend on
Drive availability.

When enabled, Sutra requests only:

`https://www.googleapis.com/auth/drive.appdata`

It uses Google Identity Services in the browser and direct Drive REST API calls.
The sync file lives in Drive's hidden application-data folder, not the user's
visible My Drive:

- File name: `sutra-sync-current-v1.sutra`
- Parent: `appDataFolder`
- App properties: `{ "sutraRole": "sync-current", "sutraSyncFormat": "1" }`
- Discovery: `files.list` with `spaces=appDataFolder` and a narrow fields
  projection (`id,name,version,modifiedTime,headRevisionId,size,appProperties`).

Drive receives the same encrypted envelope as manual `.sutra` export, with
`purpose: "google-drive-sync"` and a `vaultId`. The vault salt is stable for that
sync vault so Sutra can keep a derived AES key in memory while the page is open;
every uploaded snapshot still gets a fresh random 12-byte AES-GCM IV.

The cloud-sync password, derived key, OAuth access token, and decrypted package
bytes are never stored. The access token and derived key live in memory only.
Device-local non-secret sync metadata is stored at `sutra:googleDriveSync:v1`
and is deliberately excluded from `.sutra` backups and cloud snapshots.

Conflict behavior is explicit. If this device and the Drive copy both changed,
Sutra enters a conflict state and offers snapshot-level choices: keep this
device, use the Drive version here, download this device backup, download the
Drive backup, or cancel. Sutra does not perform blind last-write-wins merging.
Manual, debounced-save, and online/focus Drive cycles are serialized; once a
conflict is established, queued uploads remain blocked until the user chooses
one of those resolution actions. A clean remote pull also records the local
mutation revision it inspected. If a confirmed local save lands while the
encrypted Drive snapshot is downloading or being opened, the pull is no longer
allowed to restore automatically and becomes an explicit conflict instead.

Direct `file://` launch remains fully local but may not support Google OAuth.
Use the hosted HTTPS app or localhost for Drive sync. Deployment setup is
documented in [`GOOGLE_DRIVE_SYNC_SETUP.md`](../features/GOOGLE_DRIVE_SYNC_SETUP.md).

---

## 5b. Optional encrypted Sutra Cloud backup (provider-based)

Cloud is now one hub with Sync and Backups sections. The save bar has one
Sutra Cloud entry; legacy Sync actions route into that hub. Its status model
keeps confirmed local saves, encrypted replication, and point-in-time backup
receipts distinct. Opening either section is local-only; listing, connecting,
restoring and manual uploads remain explicit actions.

**Sutra Cloud** is a second optional, consent-first backup layer. It is
**provider-based**; Supabase is one advanced adapter, not a required Sutra
backend. It is **off by default** and lives in the save bar (not first-run
onboarding — onboarding only *describes* it). Sutra stays local-first:
IndexedDB/localStorage is the working copy and never depends on cloud backup.

It is intentionally a **manual backup/restore** model (with an opt-in auto layer),
**not** continuous sync. "Cross-device" means: back up here, restore there.

- **Provider-based (device-local choice):** Sutra Cloud is a provider-adapter
  system — the active destination is stored at `sutra:cloudActiveProvider:v1` and
  per-provider config at `sutra:cloudProvider:<id>:v1` (via `SutraSafeStorage`,
  never inside a `.sutra` backup). **Manual encrypted-file export to a synced
  folder** is the simplest recommendation; **Google Drive** is recommended once
  configured and working. **OneDrive, Dropbox, WebDAV, S3-compatible, Supabase,
  and Custom HTTP** are advanced; S3 is explicitly preview-only. **Supabase is
  one advanced provider, not the central backend.** All providers share the same
  encryption/passphrase/retention/restore behavior; only the destination differs.
  Switching destinations ends the current provider's session, resets shared backup
  status, leaves remote backups + the local workspace untouched, and requires
  connecting the new destination. The hosted CSP allows the approved
  `*.supabase.co` wildcard, so **any Supabase project (official or your own)
  works in the hosted build**; other custom destinations (WebDAV/S3/Custom
  HTTP) still need a self-hosted build with their origin added to
  `scripts/lib/csp-policy.mjs` (then `npm run csp:generate`); the panel detects
  a CSP-blocked origin and says so. Sutra **rejects `service_role` / root / admin
  keys** where detectable. Full provider list:
  [`SUTRA_CLOUD_PROVIDERS.md`](../SUTRA_CLOUD_PROVIDERS.md).
- **Account:** authentication is provider-specific. The Supabase adapter uses a
  passwordless email **one-time code**; other providers use their own configured
  OAuth or app-password flow. The destination sees your sign-in identity, never
  the plaintext workspace or backup passphrase.
- **Each backup is a standard encrypted `.sutra` envelope**, produced by the same
  `createEncryptedSutraBackupBlob` pipeline as manual export (PBKDF2 600k +
  AES-GCM-256, fresh salt + IV per backup), uploaded to a **private** Storage
  bucket at
  `backups/<auth.uid()>/<timestamp>-<label>-<random-attempt-id>.sutra`. The
  server stores **only ciphertext** plus a tiny `backup_index` row (path, label,
  size, device, time) — never plaintext, never the passphrase. Object creation
  never overwrites an existing path. If index creation fails after upload,
  Sutra best-effort deletes exactly that attempt's object. A 404 means cleanup
  is already complete; any other cleanup failure is secondary diagnostic
  context while the original backup failure remains visible and no success
  timestamp is written.
- **Supabase-specific isolation:** Row Level Security isolates every user to
  their own `<uid>/` folder and index rows (see
  [`supabase/schema.sql`](../../supabase/schema.sql)). Other adapters rely on
  the access controls of the account or server you configure.
- **Secrets:** the account session token is device-local
  (`sutra:supabaseSession:v1`); the backup **passphrase is in memory only**
  (session-scoped, to allow optional auto-backup) and is **never persisted or
  sent**. Non-secret settings live at `sutra:supabaseCloud:v1`, excluded from
  `.sutra` backups.
- **Retention:** the most recent **10** backups per user; older ones are pruned
  after each successful upload.
- **Restore replaces** the current workspace (confirmed first) and runs through
  the same decrypt → `importAtelierPackage` → safety-snapshot → apply path as a
  local `.sutra` import.
- **Optional auto-backup** is off by default. When enabled it runs only while
  signed in, with the passphrase cached for the session, on the chosen trigger
  (app hidden / once a day / on significant change). Turning it off stops it
  immediately.
  A cross-tab Web Lock and persisted successful-upload hash prevent duplicate
  scheduled snapshots. Without Web Locks, automatic backups pause visibly.
  Metadata remains at the compatibility key `sutra:supabaseCloud:v1`, now
  versioned with `schemaVersion: 2`; migration preserves existing opt-in,
  cadence and unknown fields. No Sync database, vault, backup format or
  credential migration is involved.
- **Password recovery:** because backups are end-to-end encrypted, a lost
  passphrase means the cloud copy is unrecoverable — so the passphrase modals are
  wired to let your **browser's password manager** save and autofill it.

Configuration (public URL + anon key) and the SQL/RLS migration are documented in
[`supabase/README.md`](../../supabase/README.md). Sutra Cloud requires the hosted
HTTPS app or localhost (Web Crypto + fetch); a cold boot with no saved session
makes **zero** Sutra Cloud requests.

---

## 5c. Optional encrypted Sutra Sync (multi-device sync)

**Sutra Sync** is true incremental multi-device synchronization — a separate
system from every backup layer above, with its own spec
([`docs/architecture/SYNC_PROTOCOL.md`](../architecture/SYNC_PROTOCOL.md)) and
user guide ([`docs/features/CLOUD_SYNC.md`](../features/CLOUD_SYNC.md)). It is
**off by default**, lives behind the save bar's **Sync** button, and never
replaces backups: sync replicates *changes*, backups preserve *moments*.

The three guarantees are distinct and the Sync panel reports each one:

1. **Saved locally** — always on; the canonical IndexedDB write→readback
   pipeline, untouched by sync. A sync failure can never block local saving,
   and cloud errors never surface through the local save-failure banner.
2. **Synced to cloud** — end-to-end-encrypted record-level changes replicated
   through the configured Supabase project (`supabase/sync-schema.sql`:
   append-only op log, RLS per user, wrapped vault key, compaction snapshot,
   content-addressed encrypted attachments in the private `sync-assets`
   bucket). Direct table access is denied; RPC/Storage access also requires an
   active, non-revoked auth-session/device binding. Storage object names are
   exactly `<auth.uid()>/<64 lowercase hexadecimal SHA-256>`; original
   filenames, labels, device ids, and extra path components are never used.
   The internal `rls_auto_enable()` event-trigger helper is not executable by
   browser roles.
3. **Backed up** — `.sutra` exports / Sutra Cloud / Drive snapshots, unchanged.

Privacy properties: a random vault master key encrypts every change (AES-GCM-
256, AAD-bound routing metadata); the key is wrapped by the user's sync
passphrase (PBKDF2 600k) and only the wrapped blob, authenticated vault-key
fingerprint, and public KDF parameters ever leave the device; creation and
passphrase rewrap use compare-and-swap so a differing vault key is never
overwritten. The
server sees ciphertext plus bounded routing metadata (op/device ids, record
keys, sizes) and can never read content. Merging is deterministic three-way:
independent records, non-overlapping structured fields, moves/reorders, and
non-overlapping validated note blocks merge automatically. True overlapping
content keeps both full values in a dedicated local conflict-review record; it
never creates an automatic sidebar page. Stable resolution markers are ordinary
encrypted sync records, and only an explicit Keep both action creates a second
page. An abnormal conflict rate pauses sync before apply/push while local saving
continues. Legacy exact-copy cleanup requires a fresh encrypted `.sutra` backup
and never removes unique, ambiguous, or nested content. As before,
deletes never destroy newer edits, and offline edits queue locally before the
first network request. Sync operational state (device id, cursor, outbox, wrapped key, the
Supabase refresh token that keeps sync alive across restarts) lives in the
dedicated `sutra_sync_db` IndexedDB — **never** inside `.sutra` exports.
Disabled sync makes zero network requests. Enabling first downloads a complete
encrypted `.sutra` safety backup; incomplete required attachments block setup
and also block a supposedly complete compaction snapshot.

**Verified revocation boundary (2026-07-18):** the project operator manually
verified that server-side revocation blocks a second browser immediately and,
once that browser reconnects, the authenticated device-status response triggers
origin-local Sutra data removal. Reload did not restore the data and reuse
required fresh sign-in/device registration. This browser-origin cleanup cannot
erase downloaded backups, external files, service-worker application caches, or
an offline browser before it reconnects.

The synchronized portable workspace is the schema-v7 `mode: "sync"` payload,
not the plaintext JSON-recovery payload. It includes all classified durable user
content: notes and version history, tasks/planning/Homework, academic/study/
college/life/work data, custom tabs, trash, private documents, supported
settings/preferences, migration/compatibility recovery data, Assistant
permissions/memory, durable visible Assistant conversations, and the explicit
portable localStorage mirrors. Conversations retain order, message ids/roles/
content/timestamps, citations and grounding, memory references, and durable
action receipts. Syncing chat history is independent of the separate
“include chats in plaintext recovery JSON” choice.

Course and private-document file bytes travel as fresh-IV encrypted,
content-addressed assets with post-decryption SHA-256 verification. Inline note
images, document backgrounds, and embedded handwriting travel inside encrypted
page records/snapshots. A file reference remains pending/missing until required
bytes are durably present in `noteflow_attachments_db`; replacing bytes under
an existing local blob key changes the content hash and forces a verified
download on the other device.

Sync deliberately excludes credentials and secrets, the publishable runtime
configuration, browser/session UI, persistence-health/cross-tab stamps,
generated Help/untouched blank-Assistant seeds, sync queues/cursors/baselines/
device state, in-flight Assistant buffers and diagnostics, and regenerable
caches. The non-secret local `sutra:syncAccountHint:v1` only selects this
browser's account-scoped sync operational namespace; it is neither exported
nor synchronized. See the exhaustive executable decision matrix in
`docs/architecture/persistence-inventory.json`.

---

## 6. Pre-import safety snapshot

Importing replaces your current workspace, so before applying a **manual** import
or restore Sutra first offers to save an **encrypted `.sutra` safety snapshot**
of your existing data (you choose the password). If an import is not what you
expected, this snapshot is your fallback — the import is not a one-way door that
discards your prior state with no recourse.

Two deliberate details:

- The safety snapshot is always **encrypted**. Restoring never silently writes
  an unencrypted copy of your workspace to disk as a side effect.
- Background restores (for example a Google Drive clean pull) do not download
  files behind your back. Their rollback guarantee is the canonical workspace
  database's built-in recovery journal: every confirmed write keeps the previous
  root in the same transaction, so the prior workspace stays recoverable even
  when no external file was created.

---

## 7. What travels vs. what's excluded

**Travels in a backup (`.sutra` and JSON):**

- All notes (content, structure, inline images, **Document Backgrounds**, locked-
  page lock data including an optional opaque duress verifier), spaces, pinned
  pages. Raw normal or duress PINs are never stored or exported.
- Tasks, time blocks, homework (courses + assignments), Course Hub metadata
  **and file binaries**.
- Testing Hub, AP Study, Review, College, Academic, Life, Projects & Work data.
- Streaks, habits, cram sessions, focus templates, split-view contexts.
- Settings, themes and custom themes, onboarding state.
- Assistant **preferences** and **provider/model choices**; the **Assistant
  Activity** log (`sutra:activityLog:v1`, migrated from `flow:activityLog:v1`) —
  not a secret, so it travels.
- Optional visible Assistant conversations when **Save chat history** is enabled:
  encrypted `.sutra` backups include them by default; plaintext JSON recovery
  includes them only when you explicitly opt in.

**Excluded by design:**

- **AI provider API keys / secrets** — session-only by default, or encrypted in the optional device-local credential vault; excluded from every export and sync snapshot.
- **Backup passwords, Google Drive sync passwords, OAuth access tokens, refresh
  tokens, client secrets, and derived encryption keys** — never exported.
- **Google Drive sync operational metadata** (`sutra:googleDriveSync:v1`) —
  device-local only.
- **Assistant chat history from a backup** when its encrypted/plaintext backup
  setting is off. This backup preference does not suppress encrypted Sutra Sync:
  when durable chat history is enabled, visible conversations synchronize.
  - **Regenerable caches** and ephemeral UI state (e.g. scroll position, the
  in-session unlocked-page set) — not exported; locked pages correctly require
  the PIN again after a reload.

An intentionally used duress deletion PIN removes the protected page tree from
the active browser workspace, Sutra Trash, and local in-app workspace snapshots.
It cannot erase downloaded exports, cloud or device backups, browser-profile
backups, or stale copies on an offline device; those copies remain subject to
their own retention and synchronization behavior.

---

## 8. Round-trip guarantees

Sutra's persistence and `.sutra`/`.atelier` portability are designed and verified
to round-trip a rich workspace. As documented in the
[save-systems audit](../architecture/sutra-save-systems-audit.md), a full destructive cycle —
**edit → refresh → reopen → clear in-memory state → export → wipe all storage →
import → refresh** — restores notes, inline images, tasks and their note links,
course files **and their binaries**, homework, and the rest of the workspace,
with cross-feature relationships (IDs and links) preserved. Static parity checks
guard against silent field drift, and a behavioral QA harness exercises the live
round-trip in a browser.

---

## 9. Recovery

- **Lost or corrupted workspace:** import your most recent `.sutra` (or JSON, or
  legacy `.atelier`) backup from Settings → Data.
- **Unexpected import:** fall back to the encrypted **pre-import safety
  snapshot** you accepted before the import, or use Sutra's canonical local
  recovery journal. A browser download request cannot be verified by the app;
  confirm the file finished downloading before relying on it.
- **App misbehaving (CSS/plugins), data intact:** load in **Safe Mode**
  (`?sutraSafeMode=1`, legacy `?atelierSafeMode=1`, or hold **Shift** on load),
  which skips custom CSS and plugins and **never deletes** anything.
- **Fully offline:** both **JSON** and core **`.sutra`** backup paths are designed
  to work without third-party requests.
  Core `.sutra` backup uses the vendored JSZip library under
  `assets/vendor/jszip/`, so it should not require a third-party request.

---

## 10. Storage names quick reference

| Store | Type | Holds | Note |
|---|---|---|---|
| `noteflow_atelier_db` (store `workspace`, key `root`) | IndexedDB | The whole `appData` workspace | Legacy-named compatibility identifier |
| `noteflow_atelier_db` recovery keys | IndexedDB | Last meaningful root, displaced empty candidate, and confirmed-root marker | Device-local recovery journal and commit marker; not exported separately |
| `noteflow_attachments_db` (store `blobs`) | IndexedDB | Course-file binaries | Legacy-named compatibility identifier |
| `hwCourses:v2`, `hwTasks:v2` | localStorage | Homework (source of truth) | Mirrored into `appData.homeworkWorkspace` |
| Curated preference keys | localStorage | Focus timer, streak settings, provider/model choices, Assistant Activity | Embedded in exports |
| `sutra:googleDriveSync:v1` | localStorage | Non-secret Drive sync metadata | Device-local only; not exported |
| API keys | sessionStorage (default), encrypted `sutra_credentials_db` when remembered | Provider credentials | Never exported |
| `appData.assistantChatHistory` | canonical IndexedDB workspace | Optional visible conversations, ids/order/citations/receipts | Encrypted sync and encrypted backup by default; plaintext recovery opt-in |
| Managed Assistant chat localStorage keys | localStorage compatibility mirror | One-time legacy import, then canonical-to-mirror only | Never authoritative after migration; stale/empty values cannot erase canonical history |

For the authoritative, line-referenced behavior and the verification scripts,
read [`sutra-save-systems-audit.md`](../architecture/sutra-save-systems-audit.md).
