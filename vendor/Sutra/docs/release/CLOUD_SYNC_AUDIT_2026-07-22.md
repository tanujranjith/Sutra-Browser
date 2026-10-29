# Cloud sync current-state audit — 2026-07-22

> Supabase backup-provider rollback repair verified 2026-07-23.

## Release decision

**The unattended release blocker is resolved.** Sutra Sync and its deployment
surface still pass the complete unattended gate, and the separate Supabase
*backup-provider* regression now has attempt-bound compensating rollback plus
focused browser coverage. Live Supabase/UI acceptance remains operator-pending;
that manual boundary does not weaken the verified mocked transaction behavior.

The repair followed the mandatory `src/core/app.js` workflow: the dirty primary
state was preserved in a local checkpoint, a clean `codex/*` candidate worktree
was created, a byte-identical ignored recovery copy was verified, and the core
runtime gate passed before broader validation. No GUI/manual-authentication
test, live Supabase request, migration execution, push, PR, deployment, reset,
clean, stash, or discard was performed.

## 1. Current architecture and ownership

- `Sutra.html` is the classic-script load-order authority. `src/core/app.js` is
  the composition root and owns `appData`, hydration, normalizers, export/import,
  the local confirmed-save seam, cloud backup controllers, and the sync bridge.
- Canonical workspace state is persisted in `noteflow_atelier_db`; attachment
  bytes are in `noteflow_attachments_db`. Homework retains its frozen
  `hwCourses:v2` / `hwTasks:v2` localStorage source and mirrors into the
  workspace deliberately.
- The pure protocol is in `src/sync/`: protocol/classification, projection,
  diff/outbox, crypto, field-aware merge, account-scoped store, Supabase-shaped
  transport, and cycle engine. `sutra_sync_db` contains operational state only.
- Remote apply enters the normal silent import/migration/normalization/readback
  path. An import guard prevents a stale editor buffer from overwriting the
  applied workspace.
- Notepad, Canvas, and Slides share one page record. Canvas owns `page.canvas`;
  Slides owns `page.slides`; neither has a second durable store.
- `appData.assistantChatHistory` is authoritative. Legacy chat localStorage keys
  are one-time migration inputs and canonical-to-legacy mirrors thereafter.
- The service worker caches only versioned same-origin static assets. Its
  temporary share-target database is included in verified revoke/wipe cleanup;
  Cache Storage contains no workspace data.

Applicable instructions were the root `AGENTS.md`; no nested instruction file
applied to the files changed in this audit. In particular: preserve the
local-first/off-by-default model, do not weaken backup or compatibility rules,
preserve classic-script order, inventory every durable field, use the normal
save/import seams, and do not directly edit `src/core/app.js` outside the clean
candidate workflow.

## 2. Working tree and change reconstruction

At audit start, `main` was three commits ahead of `origin/main` and already
dirty. Pre-existing changes were present in `AGENTS.md`, `Sutra.html`, generated
manifest/cache files, `src/features/workspace/slides.js`, four stylesheets,
`tests/e2e/hardening-regressions.spec.mjs`, and the untracked
`tests/unit/slides-mode-isolation.test.mjs`. Those edits were retained.

The sync checkpoint was followed by core-runtime recovery and the Slides
feature. The meaningful new portable contract was `pages[].slides`. Workspace
schema v7 also made Assistant history canonical; the everything-workspace
fixture was still forcing v6 and was corrected to exercise the current schema.

## 3. Integration defects found and disposition

1. **Slides whole-workspace restore on each edit — fixed.** Slides serialized a
   full workspace, mutated the clone, called `deserializeWorkspace`, then forced
   a save. It now mutates the canonical `flowAtelier.pages` object, stamps the
   page, and schedules `persistAppData`. Page creation uses the same bridge and
   current active space.
2. **Current-schema parity fixture stale — fixed.** The synthetic everything
   workspace and sync identity now use schema v7 and retain both v6 and v7
   migration records.
3. **Slides incremental evidence missing — fixed.** A focused test now proves
   slide text/notes/add/remove travel as the owning page upsert and do not alter
   ordinary note content. Wire-level E2E sentinels reject slide plaintext.
4. **Conflict E2E race — fixed.** Reconnect could let either device perform the
   merge; the test inspected only Device B's local conflict store. It now
   requires one unique deterministic conflict identity across both stores and
   retained branches. Three repeated runs and the full suite pass.
5. **Canvas test expected stale object count — fixed.** The scenario added a
   sticky, then expected the prior count. It now proves both objects survive
   navigation and serialize/import.
6. **Deployment audit too generic — fixed.** The artifact checker now requires
   the revoke runtime, all eight sync scripts, Assistant, Slides, generated
   manifests and Slides CSS; rejects SQL, source maps and fixtures; and verifies
   the intended public Supabase URL/key while rejecting secret-shaped config.
7. **Supabase backup object/index rollback overwritten — fixed.** Repository
   history at `2fa88ba` contained the compensating DELETE. The later corrupted
   runtime checkpoint removed that block, and runtime recovery restored an
   older provider body without it. The current adapter again deletes the exact
   newly uploaded object if `backup_index` insertion fails, treats 404 as
   already-clean, keeps index failure primary when DELETE also fails, creates no
   success state on failure, and uses a random attempt suffix plus no-overwrite
   upload so concurrent/retried attempts cannot target each other. This remains
   backup-provider integrity, not incremental Sutra Sync behavior.

## 4. Current portable-data parity matrix

Legend: **Y** = covered; **P** = inherited through its parent record/atomic
section; **N/A** = intentionally not applicable; **Local** = never remote.

| Current category | Local authority | `.sutra` / import | Snapshot | Incremental / merge | Delete semantics | Wipe / account scope | Remote crypto |
|---|---|---:|---:|---|---|---|---:|
| Notes, folders, hierarchy, page order, versions, links/references | `pages[]` + `o/pages` | Y/Y | Y | Y, page field-aware + HTML block merge | Page tombstone; nested values by page upsert | Y / `auth.uid()` vault | Y |
| Canvas documents | `page.canvas` | P/P | P | P, keyed nested arrays | Parent page upsert/tombstone | Y / parent page | Y |
| Slides, speaker notes, elements, slide order | `page.slides` | P/P | P | P, keyed nested arrays; tested add/edit/remove | Nested removal is page upsert; page delete tombstone | Y / parent page | Y |
| Inline note/background/handwriting/slide images | Encrypted page record | P/P | P | P | Parent page semantics | Y / parent page | Y |
| Spaces | `appData.spaces` atomic | Y/Y | Y | Y, atomic three-way | Empty/replacement atomic value | Y / vault | Y |
| Tasks, assignments, subtasks, order | `tasks[]`, `taskOrder` | Y/Y | Y | Y, record + order docs | Record tombstone | Y / vault | Y |
| Homework courses and assignments | `hw*:v2`, confirmed workspace mirror | Y/Y | Y | Y, course/task records + rest | Record tombstone | Y / vault | Y |
| Courses, exams, grade planner, semester setup | `courseWorkspace`, `academicWorkspace`, `gradePlanner`, `semesterSetup` | Y/Y | Y | Y, atomic | Empty/replacement atomic value | Y / vault | Y |
| Calendar/timeline events and time blocks | `timeBlocks[]`, schedules | Y/Y | Y | Y, record/order + atomic schedule | Record tombstone / atomic replacement | Y / vault | Y |
| AP Study, Review, Testing Hub, study/mastery/confidence | Named workspace fields | Y/Y | Y | Y, review records/rest; others atomic | Record tombstone or empty atomic | Y / vault | Y |
| Focus sessions/templates and planning state | Named workspace fields | Y/Y | Y | Y, atomic | Empty/replacement atomic value | Y / vault | Y |
| College, extracurricular, life, work, portfolio, archive-like durable state | Named atomic workspace fields | Y/Y | Y | Y, atomic | Empty/replacement atomic value | Y / vault | Y |
| Assistant conversations/messages/citations/receipts | `appData.assistantChatHistory` | Y/Y | Y | Y, conversation records/order/rest | Conversation tombstone; empty is real | Y / vault | Y |
| Assistant portable permissions/memory/model choices | Canonical fields + allowlisted mirrors | Y/Y | Y | Y, atomic | Replacement/empty atomic | Y / vault | Y |
| Files, PDFs, private-document bytes | `courseWorkspace` metadata + attachment DB bytes | Y/Y | Y | Metadata op + hash-addressed encrypted asset | Metadata update/tombstone; content hash lifecycle | Y / exact user/hash path | Y |
| Settings, themes, custom tabs/customization | `settings`, `globalTheme`, `customTabs` | Y/Y | Y | Y; device-local descendants stripped | Atomic/record semantics | Y / vault | Y |
| Migration/compatibility/quarantine/unknown fields | Canonical recovery containers | Y/Y | Y | Y, redacted then encrypted | Record/atomic semantics | Y / vault | Y |
| Conflicts awaiting review | `sutra_sync_db.conflicts` | Intentionally no | N/A | Device-local branch store; resolution marker syncs via `syncAuditLog` | Resolved tombstone | Wiped / account namespace | Branch arrived encrypted |
| Outbox, cursor, baseline, Lamport, device/wrapped-key/asset status | `sutra_sync_db` | Intentionally no | N/A | Operational only | Vault/device operations | Wiped / strict account namespace | Wrapped key/envelopes only |
| UI, panes, scroll, active view, transient editor selection | workspace/session UI stores | Backup policy only or no | No | No | Local lifecycle | Wiped where user data; otherwise transient | N/A |
| API/OAuth tokens, passphrases, recovery/unwrapped keys | session or account-scoped secret stores/in memory | Never | Never | Never as workspace content | Explicit sign-out/revoke lifecycle | Wiped; exact account/session binding | N/A |

The machine-readable exhaustive source remains
`docs/architecture/persistence-inventory.json`. Its 53 top-level workspace
fields are checked against defaults, serializer, import, projection and protocol
classification. Snapshot bootstrap and reverse incremental parity use the same
projection.

## 5. Protocol, security, and wipe findings

- Operation IDs are stable device/Lamport identities; server dedupe and
  same-device sequence collision checks make retries and lost acknowledgements
  safe. Baseline/cursor/outbox commit atomically after durable apply or ack.
- Stale cursor causes a re-pull; Lamport high-water advances from authenticated
  remote operations. Idle settles to zero operations. Disabled sync opens no
  sync DB and makes zero sync requests.
- Merge is deterministic record-level three-way. Non-overlapping fields and
  top-level note blocks merge; overlap creates a deterministic review record.
  Delete-versus-edit preserves the edit. This is not CRDT/OT or live
  character-level collaboration.
- Envelopes use fresh-IV AES-GCM with routing metadata as AAD. Snapshots and
  attachment bytes follow equivalent authenticated encryption. Wire tests reject
  note, Assistant, attachment, and Slides plaintext. The server still sees
  bounded routing metadata: account/device/op IDs, record keys, schema/protocol,
  cursor, timestamps, sizes and content hashes.
- SQL revokes direct table access, enables RLS, grants authenticated-only
  security-definer RPCs with a fixed search path, derives ownership from
  `auth.uid()`, binds active device auth sessions, and restricts Storage to
  `<user-id>/<64-lowercase-hex-hash>`. The 2026-07-30 reconciliation also
  revokes `rls_auto_enable()` execution from `PUBLIC`, `anon`, and
  `authenticated`, retaining database-owner access without changing Sync RPCs.
- Revoke/wipe accepts only the exact authenticated
  `sutra-device-status-v1`/`DEVICE_REVOKED` response bound to configured project,
  user, session and device. Generic 401, network failure, malformed response or
  wrong project remains fail-closed without deletion.
- Verified wipe deletes all six current Sutra IndexedDB databases, localStorage,
  then sessionStorage after acknowledgement; closes handles, stops timers and
  BroadcastChannels, clears live workspace/editor/Assistant state, and survives
  reload. Static Cache Storage is retained because it contains application
  assets only. Ordinary sign-out preserves the local workspace.

## 6. Backup/import and migration inventory

Encrypted `.sutra`, emergency export, legacy plaintext `.sutra`/`.atelier`, JSON
recovery, attachment completeness checks, Canvas, Slides and Assistant fields
remain on the canonical serializer/import path. Unknown fields and migration
quarantine survive. Secrets and sync operational state are excluded.

Manual SQL order:

- **Fresh empty project:** run `supabase/schema.sql`, then
  `supabase/sync-schema.sql`. The current sync schema already includes the later
  revoke/wipe and exact Storage-path definitions.
- **Existing older sync project:** safely apply/re-run
  `supabase/migrations/20260716_device_revoke_wipe.sql`, then
  `supabase/migrations/20260718_sync_account_isolation.sql`, then
  `supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql`.
- **Already-current project:** no schema reset. Confirm both contracts or safely
  rerun the three additive migrations in that order. Never run a destructive reset.

The final SQL was applied manually to production before the repository
reconciliation. This unattended repository pass did not connect to Supabase or
execute any remote migration.

## 7. Automated evidence

- Focused sync/persistence/security suite: **187/187 passed**.
- `npm run check:all`: passed in **109.9 s**.
- `npm run test:unit`: **324/324 passed** in **15.8 s**.
- Conflict scenario after race repair: **3/3 repeated runs passed**.
- Canvas: **2/2 passed** after correcting stale expectations.
- `npm run test:e2e:sync`: **14/14 passed** in **214.1 s**.
- `npm run build:deploy && npm run check:deploy`: passed; **200 files,
  17.09 MB**. Sixteen critical runtime source/artifact SHA-256 comparisons had
  zero mismatches; forbidden SQL/map/spec/fixture count was zero.
- `npm run verify`: passed in **565.7 s**, including all static checks, 324 unit
  tests, artifact build/check, **59/59** smoke/backup E2E, and **14/14** sync E2E.
- The original focused rollback regression reproduced the defect before repair:
  expected `CloudBackupRolledBackError`, received generic `Error`.
- Post-repair focused rollback: **1/1 passed**; focused Supabase backup matrix:
  **6/6 passed**.
- Full provider suite: **24/24 passed**, including Supabase
  upload/list/restore/delete/retention plus unchanged Google Drive, OneDrive,
  Dropbox, WebDAV, Custom HTTP, and Box behavior.
- Independent encrypted-backup, Google Drive snapshot, and persistence batch:
  **26/26 passed**.
- Post-repair `npm run check:all`: passed; `npm run test:unit`: **324/324
  passed**; `npm run build:deploy` and `npm run check:deploy`: passed.
- Post-repair `npm run verify`: passed in **726.3 s**, including all static
  checks, **324/324** unit tests, artifact build/check, **59/59** smoke/backup
  E2E, and **14/14** incremental Sync E2E.

An earlier sync command was killed by a 120-second command-runner limit and is
not counted. A subsequent pre-fix full run was 13/14 because of the conflict
store attribution race; the isolated scenario passed, the repaired scenario
passed three repetitions, and the final full/integrated runs passed.

## 8. Deployment artifact findings

The staged artifact contains **200 files / 17.08 MB** and matches source for the
shell, service worker, generated manifests, repaired core app, revoke runtime,
all eight sync modules, Assistant runtime, Slides runtime and CSS. Direct
SHA-256 comparisons for `src/core/app.js`, `Sutra.html`, `sw.js`, and both
generated asset manifests matched. Script ordering remains protocol → crypto →
projection → diff → merge → store → transport → engine before the core bridge.
The core cache identity is `20260723-supabaseRollback1`; artifact source contains
the typed rollback paths and non-upsert upload. No tests, fixtures, SQL, source
maps, package metadata, internal docs, or elevated credentials are staged. Only
the intended public Supabase URL and publishable key are present.

## 9. Manual acceptance checklist

These steps are operator-only. Use synthetic markers and never save tokens,
OTPs, passphrases, recovery material, ciphertext bodies or user content in the
evidence record.

| # | Exact action | Expected outcome | Evidence to retain | Blocking defect |
|---:|---|---|---|---|
| 1 | In Supabase SQL Editor, use the migration order in §6 for the project's actual state. | Scripts finish without reset/data loss; current RPCs/columns/policies exist. | Date, script names, success status, redacted schema/policy screenshot. | Error, destructive prompt, missing current contract, or lost rows/objects. |
| 2 | Export a password-encrypted `.sutra` safety backup before enabling/upgrading sync; verify file exists. | Export succeeds only with all required attachments. | Filename, size, timestamp; no password. | Export claims success with missing bytes or produces no usable file. |
| 3 | In a clean profile, sign in by email OTP. | Auth succeeds using only public config; no secret key requested. | Redacted signed-in UI and project hostname. | Secret credential request, wrong project, or failed authenticated session. |
| 4 | Create/unlock the vault with a test passphrase and export the recovery kit. | Correct passphrase unlocks; wrong one changes nothing. | Vault status and securely stored kit confirmation, not contents. | Key replacement, mutation on wrong passphrase, or plaintext key exposure. |
| 5 | Open a fresh second profile/device, sign in to the same account, unlock, and bootstrap. | Snapshot plus tail operations reconstruct the workspace and survive reload. | Before/after category counts and synced status. | Missing category, default data merged incorrectly, or reload loss. |
| 6 | Edit distinct records on A and B, sync in both directions. | Both edits converge; idle devices settle with no new ops. | IDs/counts, timestamps, final status. | Lost/duplicated data, endless ops, or echo loop. |
| 7 | Populate every row in §4 with unique synthetic values, sync A→B and B→A, then compare. | Snapshot and incremental paths produce semantic equality. | Redacted parity sheet/counts. | Any unexplained missing or altered portable field. |
| 8 | Create/rename/move/reorder nested notes and folders; edit note body/version history. | Hierarchy/order/content/history converge without duplicate pages. | Stable IDs and final tree screenshots. | Broken hierarchy, ID change, content loss, sidebar conflict copy. |
| 9 | Create/edit/complete/delete Homework and linked assignments on both devices. | Canonical Homework and connected task views agree after sync/reload. | Stable homework/course IDs and final statuses. | Mirror overwrites canonical state or duplicates/loss. |
| 10 | Create courses, exams/tests, grade/semester data and extracurricular entries. | All current academic fields converge and calculations remain deterministic. | Redacted field checklist and IDs. | Missing field, changed IDs, or sync altering deterministic calculations. |
| 11 | Add/reorder/edit/delete Timeline events, calendar blocks and schedule data. | Dates/times/order converge with no duplicate linked events. | Event IDs and screenshots. | Time/date corruption, duplicate event, or missing deletion. |
| 12 | Create Assistant threads including empty thread, citations and receipt; sync both directions and reload after seeding a stale legacy mirror. | Canonical history wins; order/provenance/empty state survive. | Thread/message ID counts. | Stale mirror erases/overwrites history or content missing. |
| 13 | Create two Canvas pages, add different objects, navigate, sync, reload and import backup. | Canvases remain isolated and preserve exact object sets. | Page IDs/object counts. | Cross-page contamination, missing objects, or note text leak. |
| 14 | Create a Slides deck; edit theme/layout/text/notes, add/reorder/delete slides, sync and reload. | Deck stays on its page; all changes converge; leaving Slides fully hides it. | Page/slide/element IDs and counts. | Whole workspace reset, lost ordinary note data, UI bleed, or missing slide changes. |
| 15 | Attach a PDF/file, inline note image, document background and local slide image; replace one attachment. | Bytes decrypt/hash/persist before reference is complete; filenames/content stay private remotely. | Hash/path shape, sizes and successful opens; no content dump. | Missing/corrupt bytes, stale replacement, plaintext name/path, false-complete reference. |
| 16 | Change portable theme/settings/custom tabs on A and device-local UI/sync settings on B. | Portable choices converge; sync enable/endpoint, panes and scroll remain device-local. | Side-by-side setting results. | Remote force-enables sync or overwrites device UI state. |
| 17 | Create archived school-year/portfolio/college/life/work data and round-trip it. | Durable archive-like data survives sync/export/import. | Category counts and stable IDs. | Omission or destructive normalization. |
| 18 | Delete collection records and clear an atomic collection; reconnect an offline device. | Tombstones/empty values propagate; deleted items do not resurrect after retention-safe replay. | Deleted IDs, cursor/status, reload result. | Resurrection, ignored empty state, or wrong-record deletion. |
| 19 | Make non-overlapping same-record edits, then overlapping same-block edits; resolve with each offered action. | First merges silently; second yields one deterministic Conflicts item; resolution syncs and stays resolved. | Conflict ID/path, resolution receipt, no sidebar copy. | Storm/duplicate, lost branch, reappearing resolution, or hidden data destruction. |
| 20 | Take both devices offline, edit different and overlapping data, reconnect in alternating order. | Outboxes survive; stale cursor retries; convergence occurs without duplicate delivery effects. | Offline status, op counts, final IDs. | Local save blocked, queue loss, duplicate data, or non-convergence. |
| 21 | In one disposable browser profile, sign out A then sign in B. | Local workspace remains, cloud enters account-change guard, and sends no A state under B. | Sync status and redacted request list. | Cross-account pull/push/unlock or local wipe. |
| 22 | Run the dedicated Account A/B checklist with two disposable accounts. | Direct tables denied; RPC/device/key/snapshot/op ownership stays inside `auth.uid()`. | Status/codes and account labels only. | Any B visibility/mutation of A or caller-supplied ownership accepted. |
| 23 | Inspect Network and authorized Dashboard rows for unique note/task/Assistant/Canvas/Slides markers. | Only bounded metadata, IV/tag/ciphertext/wrapped blobs are visible. | Redacted field-name screenshot. | Any title/body/prompt/filename/byte/passphrase/token/plaintext marker. |
| 24 | As B and anonymously, list/read/write/delete A's asset path; try nested and filename-shaped B paths. | All cross-account/malformed paths denied; only exact B user/hash path works for active session. | Method/path shape/status only. | Cross-account access or accepted malformed path. |
| 25 | Revoke B from A while B is offline; reconnect B; also test generic 401/network/wrong-project responses separately. | Offline B retains data; verified next contact wipes every tab/store and acknowledges; generic failures never wipe. | Redacted status contract, storage counts, ack, reload result. | Premature wipe, incomplete wipe, resurrection, or no wipe after exact verified response. |
| 26 | Install/update PWA with an older open client, deploy/test a newer local worker, accept safe reload, then test offline launch. | Old client is not activated underneath; new stamped assets load after consent; offline shell is current. | Worker/cache version and UI prompt screenshots. | Mixed runtime, stale sync script, partial precache, or user-data caching. |
| 27 | Serve `.deploy/` locally and exercise startup, save, Sync panel, Canvas, Slides and backup import/export. | Artifact behaves like source; no missing asset/console boot error. | Artifact hash/version and smoke results. | Source/artifact mismatch or missing runtime. |
| 28 | Publish the exact checked artifact to GitHub Pages/PWA only after blocker resolution; repeat startup/sync/backup smoke. | Hosted headers/CSP and relative paths work; no rebuild drift. | Deployment digest, URL, headers, test date. | Different artifact, weakened headers/CSP, or hosted-only failure. |
| 29 | On iPhone Safari, Android Chrome and a tablet, test portrait/landscape sync status, Notes/Canvas/Slides, backup picker, modals and reduced motion. | 44px targets, no document overflow, contained calendar scrolling, accessible sheets. | Device/OS/browser versions and screenshots. | Data-loss path, inaccessible control, trapped focus, overflow blocking primary action. |
| 30 | Repeat core flows in current Chromium, Firefox, WebKit/Safari and Edge. | Persistence, crypto, IndexedDB, service worker and import/export behave consistently. | Browser versions and per-flow result. | Any data corruption, crypto/import incompatibility, or unsupported critical flow. |
| 31 | In a disposable Supabase setup, keep Storage requests allowed but block only `POST /rest/v1/backup_index`; run **Back Up Now**, then unblock and retry. | First attempt fails visibly, its Storage POST and DELETE use the identical new path, no new object/row or success timestamp remains, and prior backups survive. Retry uses a different path, creates object + row, performs no DELETE, and records success. | Redacted methods/statuses and path equality/difference only; never retain tokens, passphrase, ciphertext, labels, or workspace content. | Missing/wrong DELETE, false success, orphan, prior-backup deletion, reused path, or DELETE on successful retry. |

## 10. Files changed by this audit

The audit changed the Slides canonical save integration and cache stamp,
generated asset manifests/lock, sync/Slides/Canvas/SQL/deployment tests, the
schema-v7 everything fixture, deployment checker, and current sync/Slides/
Supabase checklist documentation. Several of those files already had user edits;
the audit preserved them and made narrow overlapping changes. This report is
additive. `src/core/app.js` was inspected but not modified.

## 11. Remaining limitations

- Manually verify the repaired transaction against a disposable real Supabase
  project by blocking only `POST /rest/v1/backup_index`, confirming the matching
  Storage DELETE and absence of a new object/row, then retrying successfully
  with no DELETE. This requires operator-controlled authentication and is not
  claimed by the mocked browser suite.
- Live Supabase, Account A/B, Storage, OTP/vault, deployed artifact, mobile and
  cross-browser evidence remains operator-pending; older manual evidence is
  historical, not proof of this build.
- Slides v1 embeds bounded local image data in its page record; image-heavy decks
  need migration to the attachment database before being encouraged.
- Sync is conservative record/field/block three-way merge, not real-time CRDT/OT.
- Offline revoked devices cannot wipe until they reconnect; external downloaded
  backups are outside browser control.
