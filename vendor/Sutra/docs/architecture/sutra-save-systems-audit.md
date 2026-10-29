# NoteFlow Atelier — Save Systems Audit (Local Persistence + `.atelier` Export/Import)

_Last updated: 2026-05-29. Audit performed by reading the live implementation in
`src/core/app.js` (~48k lines), `src/features/*.js`, and the verification scripts,
then exercising the running app in a browser (Stage 1 + Stage 2 round-trips)._

---

## 1. Executive summary

NoteFlow Atelier already has a **mature, deliberately-engineered persistence and
portability layer**. Local state is a single `appData` object in IndexedDB,
hydrated through one merge/normalize path and exported/imported through one
serializer/deserializer pair. A static parity check (`scripts/round-trip-check.mjs`)
already guards field drift across save/export/import.

The audit inventoried **every user-changeable data category** and verified each
across (a) browser refresh, (b) IndexedDB save/load, and (c) full `.atelier`
export → wipe → import → reload. The overwhelming majority **PASS**.

**One genuine silent-data-loss bug was found and fixed:** course-file attachment
**binaries** could be dropped from an export when the in-memory attachment cache
was cold (e.g. exporting shortly after a reload without opening Course Hub). The
synchronous export snapshot reads blob bytes only from the in-memory
`courseAttachmentCache`; the only thing that loads them from the attachments
IndexedDB (`warmCourseAttachmentCache()`) ran fire-and-forget and was never
awaited before an export. Fixed by awaiting the warm on all three export entry
points, plus a new static guard so the regression cannot silently return.

Several other items flagged during the sweep were investigated and found to be
**false positives** (see §18). They are documented so the analysis is auditable.

**Verdict:** local persistence and `.atelier` portability are sound. After the
fix, a rich workspace survives all eight required steps (normal edit → refresh →
reopen → in-memory clear → export → wipe storage → import → refresh).

---

### 2026-06 encrypted-backup and Drive-sync update

Sutra's canonical serializer/package builder is still the single source of
truth. New `.sutra` exports now build the same internal ZIP package described
below, then wrap those bytes in a password-encrypted `SUTRAENC` envelope using
Web Crypto AES-GCM-256 and PBKDF2-HMAC-SHA-256. Legacy unencrypted `.sutra` and
`.atelier` packages still import through the same package parser, manifest
validator, checksum validator, asset rehydration, pre-import safety snapshot,
workspace validator, and atomic restore path.

Optional Google Drive sync reuses the same canonical package bytes and encrypted
envelope with `purpose: "google-drive-sync"`. It stores encrypted snapshots in
Drive `appDataFolder` only, requests only the `drive.appdata` OAuth scope, keeps
OAuth access tokens and derived keys in memory, and persists only non-secret
device-local sync metadata at `sutra:googleDriveSync:v1`. That key is explicitly
excluded from `ATELIER_RAW_LOCALSTORAGE_KEYS` and from the machine-readable
persistence inventory.

---

## 2. Actual current save architecture

### Primary store — one object, one IndexedDB key
- **DB:** `noteflow_atelier_db` · **store:** `workspace` · **key:** `root`
  (`APP_DB_NAME`/`APP_DB_STORE`/`APP_DB_KEY`, app.js:2068–2070).
- **Schema version:** `APP_SCHEMA_VERSION = 2` (app.js:2071), written to
  `appData.version` on every save.
- **Save:** `persistAppData()` (app.js:5388) copies every runtime collection into
  `appData`, then `scheduleAppSave()` (app.js:4978) debounces a `writeAppData()`
  by 250 ms. `flushAppSaveNow()` / `flushAppSaveOnLifecycle()` force a synchronous
  flush on page-hide/`beforeunload`.
- **Load/hydrate:** `initAppData()` (app.js:5260) → `readAppData()`; if present,
  `mergeAppDataDefaults(stored)` (app.js:5017) deep-merges stored data over fresh
  defaults and runs every per-feature normalizer; if absent,
  `migrateLegacyData()` (one-time migration from old localStorage keys) runs.

### Secondary stores
- **Course attachments:** separate IndexedDB `noteflow_attachments_db` / store
  `blobs` keyed by `blobKey`, with an in-memory `courseAttachmentCache` Map
  (app.js:20701–20768). Only blob **bytes** live here; file **metadata** lives in
  `appData.courseWorkspace.files[]`.
- **Homework:** localStorage `hwCourses:v2` / `hwTasks:v2` (+ legacy `:v1`). This
  is the homework module's source of truth; it is **mirrored** into
  `appData.homeworkWorkspace` at save time and restored to localStorage on import.
- **Standalone localStorage preferences:** a curated allow-list
  `ATELIER_RAW_LOCALSTORAGE_KEYS` (app.js:35831) is embedded in exports.
- **Secrets:** AI provider API keys use **sessionStorage only by default**
  (`readSensitiveValue`/`writeSensitiveValue`). An explicit “Remember API keys on
  this device” opt-in stores them encrypted in `sutra_credentials_db`; they are
  never included in workspace persistence, exports, or sync.

### Export / import
- **Serializer:** `buildWorkspaceExportPayload({mode, includeSensitiveSettings})`
  (app.js:35906). `mode:'json'` returns a flat JSON projection; `mode:'full'`
  returns the same plus packaging metadata. Sensitive settings stripped via
  `stripSensitiveSettingFields` when `includeSensitiveSettings:false`.
- **`.atelier` package:** `exportWorkspaceAsAtelierPackage()` (app.js:36256) builds
  the payload, extracts inline `data:` assets into a `assets/` folder
  (`prepareWorkspaceForAtelierPackage`), and writes a JSZip containing
  `manifest.json`, `workspace.json`, `assets/*`, `metadata/export-summary.json`,
  `metadata/checksums.json`. Filename `noteflow_project_<date>.atelier`.
- **Deserializer:** `importWorkspacePayload(data)` (app.js:37805) rebuilds every
  runtime collection, restores course-file blobs, restores the localStorage
  snapshot, re-applies theme/preferences, **re-renders every view**, and calls
  `persistAppData()` so the import is written straight back to IndexedDB.
- **Canonical wrappers** (app.js:38066+, all on `window`): `serializeWorkspace`,
  `deserializeWorkspace`, `saveWorkspaceLocally`, `loadWorkspaceLocally`,
  `exportWorkspaceAsAtelier`, `exportWorkspaceAsJson`, `importWorkspaceFile`,
  `verifyWorkspaceRoundTrip`.

---

## 3. Stage 1 — local browser persistence results

Verified in a real browser by writing representative data, calling
`saveWorkspaceLocally()`, then `loadWorkspaceLocally()` (a fresh IndexedDB read),
and confirming the data returned. The built-in `verifyWorkspaceRoundTrip()`
reported **`ok:true`, 19 top-level fields preserved, 0 differences**.

| Result | Evidence |
|---|---|
| Notes (incl. inline `data:` image), tasks, and a Course Hub file all reloaded from IndexedDB | live `loadWorkspaceLocally()` returned `pages`/`tasks`/`courseWorkspace.files` containing the test records |
| Every top-level collection is copied into `appData` by `persistAppData()` | app.js:5404–5439 |
| Hydration merges stored data over defaults without wiping user data | `mergeAppDataDefaults` app.js:5017–5111 |
| Debounced autosave + lifecycle flush | app.js:4978, 4990, 4999 |

**Conclusion:** Stage 1 PASSES. All user-changeable categories persist to
IndexedDB and rehydrate on reload.

---

## 4. Stage 2 — `.atelier` export/import results

Verified in a real browser with the full destructive cycle:

1. Serialize current workspace (`mode:'full'`) — contained the note image and the
   course-file binary (`_exportBlob`).
2. **Wipe everything:** `localStorage.clear()` + cleared `noteflow_atelier_db/workspace`
   + cleared `noteflow_attachments_db/blobs`. Confirmed `loadWorkspaceLocally()` → `null`.
3. Import the payload (`deserializeWorkspace`).
4. Re-serialize and inspect: **page ✓, image data-URL intact ✓, task ✓,
   task→note link ✓, course file ✓, course-file binary re-embedded ✓,
   `missingBlob:false` ✓.**
5. `loadWorkspaceLocally()` after import: data present → **persists after refresh ✓.**

No console errors at any point.

**Conclusion:** Stage 2 PASSES end-to-end after the course-attachment fix.

---

## 5. Complete persistence inventory

Legend: **R** = survives refresh / IndexedDB reload · **X** = in export payload ·
**I** = restored + re-rendered on import.

| Feature area | Data | Store / field | R | X | I | Status |
|---|---|---|:--:|:--:|:--:|---|
| Notes/editor | content, title, order, icon, theme, timestamps, collapsed | `appData.pages[]` | ✓ | ✓ | ✓ | PASS |
| Notes/editor | page mode (size/margins), document layout (header/footer/page #), formatting | `pages[].pageMode/documentLayout/formatting` | ✓ | ✓ | ✓ | PASS |
| Notes/editor | locked pages (PIN hash/salt + optional duress verifier) | `pages[].isLocked/lockHash/lockSalt/lockDuressVerifier` | ✓ | ✓ | ✓ | PASS |
| Notes/editor | comments, suggestions, footnotes, citations, version history | `pages[].*` | ✓ | ✓ | ✓ | PASS |
| Notes/editor | **inline images** (pasted) | `data:` URI inside `pages[].content` | ✓ | ✓ (→ `assets/` in `.atelier`) | ✓ | PASS |
| Spaces/folders | space defs, page→space links | `appData.spaces`, `pages[].spaceId` | ✓ | ✓ | ✓ | PASS |
| Pinned pages | pinned set | `appData.pinnedPages` | ✓ | ✓ | ✓ | PASS |
| Tasks/Today | tasks, order, links (`noteId`), priority/difficulty/status | `appData.tasks`/`taskOrder` | ✓ | ✓ | ✓ | PASS |
| Calendar/timeline | time blocks | `appData.timeBlocks` | ✓ | ✓ | ✓ | PASS |
| Homework | courses + tasks (all fields incl. due/priority/recurrence/done) | localStorage `hwCourses:v2`/`hwTasks:v2` → mirrored to `appData.homeworkWorkspace` | ✓ | ✓ | ✓ | PASS |
| Courses/Course Hub | course metadata, links, resources, file **metadata** | `appData.courseWorkspace` | ✓ | ✓ | ✓ | PASS |
| Courses/Course Hub | file **binaries** | `noteflow_attachments_db/blobs` → base64 `_exportBlob` in export | ✓ | ✓ | ✓ | **PASS (fixed — see §11/§19)** |
| Testing Hub | exams, pinned, mistakes, practice, tasks, custom, scores, countdowns, active | `appData.testingHub` (normalizeTestingHub) | ✓ | ✓ | ✓ | PASS |
| AP study | subjects/units/topics/sessions/practiceLogs/activity/settings | `appData.apStudyWorkspace` | ✓ | ✓ | ✓ | PASS |
| Review/flashcards | decks, cards, SRS state, ratings, history | `appData.reviewWorkspace` | ✓ | ✓ | ✓ | PASS |
| College tracker | college list, status, deadlines, essays, filters | `appData.collegeTracker` | ✓ | ✓ | ✓ | PASS |
| College app | app tracker, essays, scores, awards, scholarships, visits, decision matrices | `appData.collegeAppWorkspace` | ✓ | ✓ | ✓ | PASS |
| Academic / Life / Business | full workspaces | `appData.academicWorkspace`/`lifeWorkspace`/`businessWorkspace` | ✓ | ✓ | ✓ | PASS |
| Streaks / Habits | dayStates, taskStreaks, streakState, habits | `appData.streaks`/`habitTracker` | ✓ | ✓ | ✓ | PASS |
| Cram Hub | sessions | `appData.cramSessions` | ✓ | ✓ | ✓ | PASS |
| Focus | templates | `appData.focusTemplates` | ✓ | ✓ | ✓ | PASS |
| Focus | timer settings/state | `appData.settings.focusTimer` + localStorage `noteflow_focus_timer` | ✓ | ✓ | ✓ | PASS |
| Split view | split-pane contexts, secondary page id | `appData.splitPaneContexts`, `settings.notesSplitSecondaryPageId` | ✓ | ✓ | ✓ | PASS |
| Settings | theme, atelierTheme, custom themes, accent/density/motion/text-size, sidebar, enabledViews, shortcuts | `appData.settings`, `globalTheme` | ✓ | ✓ | ✓ | PASS |
| Onboarding/tutorial | onboarding state, tutorial flags, feature selection | `appData.settings.onboarding/*` | ✓ | ✓ | ✓ | PASS |
| Sutra Assistant | preferences (enabled, contextDepth, chatMemoryMode, local endpoint config) | `appData.settings.preferences.assistant` | ✓ | ✓ | ✓ | PASS |
| Sutra Assistant | provider/model choices | localStorage `chat_provider`/`chat_model_by_provider`/`chat_custom_model_by_provider` | ✓ | ✓ | ✓ | PASS |
| Sutra Assistant | activity log | localStorage `flow:activityLog:v1` | ✓ | ✓ | ✓ | PASS |
| Sutra Assistant–created items | notes/tasks/timeline/homework/review decks | flow into the normal stores above | ✓ | ✓ | ✓ | PASS |
| AI secrets | provider API keys | sessionStorage by default; encrypted `sutra_credentials_db` when remembered | ✗ | ✗ (by design) | ✗ | INTENTIONALLY EXCLUDED FROM EXPORT/SYNC |
| Chat history | visible conversations | managed localStorage store + session compatibility copy | ✓ | encrypted `.sutra` default; plaintext recovery opt-in | ✓ | PASS |
| Caches | `chat_models_cache_<provider>`, `hwSchemaVersion` | localStorage | ✓ | ✗ (regenerable) | n/a | INTENTIONALLY EXCLUDED |
| UI scroll restore | scroll positions | sessionStorage | ✗ (session) | ✗ | ✗ | INTENTIONALLY EXCLUDED |

---

## 6. Storage keys & object stores discovered

**IndexedDB**
- `noteflow_atelier_db` → store `workspace` → key `root` (the entire `appData`).
- `noteflow_attachments_db` → store `blobs` → keyed by `blobKey` (course-file bytes).

**localStorage — exported (in `ATELIER_RAW_LOCALSTORAGE_KEYS`)**
`noteflow_focus_timer`, `streakApp:settings`, `chat_provider`,
`chat_model_by_provider`, `chat_custom_model_by_provider`,
`noteflow.feedback.googleEmbed.v1`, `flow:activityLog:v1`.

**localStorage — homework source of truth (exported via `homeworkWorkspace`)**
`hwCourses:v2`, `hwTasks:v2`, legacy `homeworkCourses:v1`, `homeworkTasks:v1`.

**localStorage — legacy one-time migration only (read by `migrateLegacyData`)**
`noteflow_pages`, `noteflow_todos`, `noteflow_theme_settings`,
`noteflow_font_settings`, `noteflow_sidebar_collapsed`, `noteflow_favorite_page`,
`noteflow_default_page`, `noteflow_animations`, `streakApp:v1`. _These are read
only when no `appData` exists; their data now lives in `appData` and travels via
the export. They are NOT separately exported and do not need to be._

**localStorage — device-local / intentionally not exported**
`chat_models_cache_<provider>`, `hwSchemaVersion`.

**sessionStorage — never exported (default credentials/ephemeral)**
`groq_api_key`, `openai_api_key`, `anthropic_api_key`, `gemini_api_key`,
`openrouter_api_key`, `deepseek_api_key`, `xai_api_key`,
`perplexity_api_key`, `nvidia_api_key`, `mistral_api_key`,
`together_api_key`, `local_api_key`, `chat_history`,
`noteflow_ui_scroll_state_v1`.

---

## 7. Data that survives reload
Everything in §5 marked **R = ✓**. Confirmed live via `loadWorkspaceLocally()`.

## 8. Data that failed local persistence before fixes
**None.** No category was found to be memory-only or to fail IndexedDB reload.
(Course-file binaries persisted across reload correctly; their bug was on the
**export** side only — see §11.)

## 9. `.atelier` schema summary
- `manifest.json`: `format` (`noteflow_atelier_project`), `formatVersion` (1),
  `schemaVersion` (1), `appSchemaVersion` (2), `appBuild`, `exportedAt`,
  `contentSummary` (per-section counts + asset/warning counts), `assets[]`
  (file/mime/byteLength/checksum), `compatibility` (min/max format & schema).
- `workspace.json`: the full serialized payload with inline `data:` assets
  rewritten to `atelier-asset://<file>` references.
- `assets/<hash>.<ext>`: raw asset bytes (deduped by content hash).
- `metadata/export-summary.json`, `metadata/checksums.json`.
- Validation: `validateAtelierManifest` rejects unknown formats and
  format/schema versions newer than supported. `migrateAtelierWorkspacePayload`
  is the migration hook (currently identity for v1).

## 10. Data that exports/imports correctly
Everything in §5 marked **X = ✓ and I = ✓**. Confirmed via the live wipe→import
round-trip in §4.

## 11. Data that failed `.atelier` round-trip before fixes
**Course-file attachment binaries (silent data loss).**
`buildCourseWorkspaceExportSnapshot()` (app.js:20782) reads each file's bytes only
from the in-memory `courseAttachmentCache`; if a blob was not in that Map it set
`missingBlob:true` and omitted the bytes. The only loader from the attachments
IndexedDB, `warmCourseAttachmentCache()` (app.js:20769), was invoked
fire-and-forget (app.js:20044) and **never awaited before an export**. So
exporting after a reload — before that background warm finished, or without ever
opening Course Hub — produced an `.atelier`/JSON file whose course files had
metadata but no binary. On import those files were flagged `missingBlob` and the
content was unrecoverable. **Fixed in §19.**

## 12. Asset & attachment handling
- **Note images:** pasted images are converted to `data:` base64 via
  `FileReader.readAsDataURL` before insertion (app.js:27481+), so they live inside
  `pages[].content` — portable across refresh and export. In `.atelier` they are
  extracted to `assets/` and rewritten to `atelier-asset://` refs, then rehydrated
  to `data:` on import. No persisted `blob:` object URLs were found in saved
  content. Export additionally inlines any live `<img>` whose `src` resolves
  (`inlineImagesForExport`), with warnings on unresolved sources.
- **Course files:** stored as data URLs in `noteflow_attachments_db`; embedded in
  exports as base64 `_exportBlob`; restored to the attachments DB on import by
  `restoreCourseFileBlobsFromImport` (app.js:20797). Files whose bytes genuinely
  cannot be located are flagged `missingBlob` (visible, non-silent).

## 13. Cross-feature relationship handling
IDs are preserved on import (tasks keep their `id`; `taskOrder` is rebuilt from
surviving ids; `noteId`/`courseId` links are carried verbatim). Verified live:
`qa-task-1.noteId === 'qa-page-1'` survived the round-trip. The Homework↔Course
bridge (`migrateAndBridgeCourses`) re-runs **after** the imported homework
snapshot is restored (app.js:37920) so links reconcile against final state. Page
`spaceId`s pointing at missing spaces are remapped to `default` (app.js:37910).

## 14. Security & secrets handling
- AI provider API keys are **session-only by default** and migrated out of any
  legacy raw localStorage location on read (`readSensitiveValue`). When the user
  opts in, the credential vault stores only encrypted values in
  `sutra_credentials_db`; they are never exported.
- Both export paths call `buildWorkspaceExportPayload({includeSensitiveSettings:false})`,
  which runs `stripSensitiveSettingFields` to redact any nested
  `apikey/token/secret/password/...` value and records the redacted paths in
  `exportDiagnostics` (enforced by `round-trip-check.mjs` §3).
- Portable, non-secret AI **preferences** (provider/model/endpoint config) DO
  travel, so a restored workspace keeps its setup and only needs the key re-entered.

## 15. Schema migration behavior
- App store: `APP_SCHEMA_VERSION = 2`; `mergeAppDataDefaults` is tolerant of older
  shapes (deep-merges over defaults, per-feature normalizers fill gaps). Newly
  added export fields fall back to safe defaults on older imports
  (app.js:37822–37834), so legacy `.json`/`.atelier` files import without crashing.
- `.atelier`: `validateAtelierManifest` + `migrateAtelierWorkspacePayload` provide
  versioned validation and a migration hook; files newer than supported are
  rejected with a clear message rather than partially applied.

## 16. Automated verification process
- **Static (CI-friendly, no browser):** `node scripts/round-trip-check.mjs`
  asserts save/export/import field parity, secret redaction, the localStorage
  allow-list, the canonical wrappers, and (new) that every export entry point
  warms the course-attachment cache **before** building the payload.
  `node scripts/smoke-check.mjs` covers additional invariants.
- **In-browser (full behavioral round-trip):** `scripts/sutra-persistence-qa.js`
  — paste into the console on `Sutra.html` and run `await AtelierQA.run()`
  (non-destructive) or `await AtelierQA.run({ wipe:true })` (full wipe→import).

## 17. Manual QA checklist
1. Create a note with text, a table, and a **pasted image**; add a task linked to it.
2. Add a class/course in Course Hub and **upload a file**; add homework with a due date.
3. Add Testing Hub / AP / Review / College data; change theme, accent, density.
4. **Refresh** → everything is still there (Stage 1).
5. Close and reopen the tab → still there.
6. Settings → Data → **Export `.atelier`**.
7. Clear site data (DevTools → Application → Clear storage) → app is empty/default.
8. **Import** the `.atelier` file → all data + the image + the course file reappear.
9. **Refresh again** → imported data persists.
10. Confirm AI provider keys are NOT in the exported file; provider/model choices ARE.

## 18. Issues found (incl. investigated-and-dismissed)
1. **Course-file binaries dropped from export on cold cache** — REAL. Fixed (§19).
2. _Homework export staleness_ — **false positive.** `buildWorkspaceExportPayload`
   calls `readHomeworkWorkspaceSnapshot()` which reads localStorage **fresh**
   (app.js:14851–14857), not a stale `appData` copy. Homework always exports
   current state.
3. _`streakApp:v1` not exported_ — **false positive.** It is a one-time legacy
   migration source (read only when no `appData` exists, app.js:5226) seeded into
   `appData.streaks`, which IS exported.
4. _Secondary editor not flushed on export_ — **false positive.** `savePage()`
   (called before every export) flushes the secondary pane via
   `saveSecondaryPageNow()` (app.js:33472).
5. _Homework subtasks/attachments/reminders/labels not persisted_ — **N/A.** The
   homework module exposes no such fields; the snapshot mirrors the full
   localStorage arrays verbatim, so whatever homework stores does round-trip.
6. _`blob:` URLs leaking into exports_ — **not observed.** Saved note content uses
   `data:` URIs; export converts resolvable live images and warns on the rest.
7. _Review items orphaned if their deck is deleted_ — only reachable by hand-editing
   an export file; normalizer filters them by design. Left as-is.

## 19. Fixes implemented
File: `src/core/app.js`
- `exportWorkspaceAsAtelierPackage()` — `await warmCourseAttachmentCache()` after
  `savePage()` and before `buildWorkspaceExportPayload()`.
- `exportToFile()` — made `async`; warms the cache before building the JSON payload.
- `createPreImportSafetySnapshot()` — made `async`; warms the cache before the
  pre-import safety backup.
- Updated the four call sites (`exportWorkspaceFromOptionsModal`,
  `exportCurrentNoteDocument`’s JSON branch, the settings snapshot button, and the
  two import-flow snapshot calls) to `await` the now-async functions.

File: `scripts/round-trip-check.mjs`
- New section 8: fails if `buildCourseWorkspaceExportSnapshot` stops reading the
  cache, or if any of `exportWorkspaceAsAtelierPackage`/`exportToFile`/
  `createPreImportSafetySnapshot` builds a payload without warming the cache first
  (or warms it after) — locks in the fix.

File: `scripts/sutra-persistence-qa.js` (new)
- Reusable in-browser round-trip harness (see §16).

## 20. Intentionally excluded data
- **AI provider API keys / secrets** — sessionStorage by default, or encrypted
  device-local vault storage after explicit opt-in; excluded for privacy.
  (Provider/model **choices** are exported.)
- **Chat history** — optional managed local conversations are included in
  encrypted backups by default; plaintext recovery is opt-in.
- **Regenerable caches** — `chat_models_cache_<provider>`, `hwSchemaVersion`.
- **Ephemeral UI state** — scroll-restore session, in-session unlocked-page set
  (`unlockedPageIds`): locked pages correctly require PIN re-entry after reload.
- **Legacy localStorage keys** — superseded by `appData`; migrated once, not
  re-exported.

## 21. Remaining risks / notes for human review
- **Cold-cache race not observable live:** in browser testing the background
  `warmCourseAttachmentCache()` completed during app-load before any manual export
  could be triggered, so the *pre-fix* cold-cache loss could not be reproduced
  on-demand. The fix is correct by construction (warm is awaited before the
  synchronous snapshot) and is enforced by the new static guard; the behavioral
  test confirms exports embed course-file binaries.
- **Resolved:** `.sutra` export/import uses the vendored local JSZip build under
  `assets/vendor/jszip/`, so core ZIP backups do not require a CDN request. The
  plain **JSON** export/import path remains available as a no-zip alternate path.
- **`drive`/`googleCalendar` settings** are deleted on merge/import and not in
  defaults (round-trip-check warns) — intentional removal of the old Google
  integrations; harmless.

## 22. Files changed
- `src/core/app.js` — course-attachment cache warming on all export entry points
  (+ async propagation to call sites).
- `scripts/round-trip-check.mjs` — new static guard (section 8).
- `scripts/sutra-persistence-qa.js` — **new** in-browser QA harness.
- `docs/sutra-save-systems-audit.md` — **new** (this document).

## 23. How to run the verification
```bash
# Static parity + security + cache-warming guards (no browser needed)
node scripts/round-trip-check.mjs
node scripts/smoke-check.mjs
```
```js
// Full behavioral round-trip — in the browser console on Sutra.html:
// (paste the contents of scripts/sutra-persistence-qa.js first)
await AtelierQA.run();              // non-destructive
await AtelierQA.run({ wipe: true }); // DESTRUCTIVE: wipes this profile, then re-imports
```
