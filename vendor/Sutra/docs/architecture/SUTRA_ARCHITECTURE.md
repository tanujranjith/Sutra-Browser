# Sutra Architecture

_A high-level map of how Sutra is put together — the entry points, the core, the
feature modules, and how persistence, export/import, and customization wrap
around them. This is a map, not a deep dive; follow the linked docs for detail._

Sutra is a **static web app**: no backend, no build server required to run it. It
loads from static hosting or directly from a local file.

---

## 1. Entry points

- **`Sutra.html`** — the **app shell**. This is the workspace itself (renamed
  from `NoteflowAtelier.html`). It hosts the markup, pulls in the styles and
  scripts, and is where the whole application runs.
- **`HomePage.html`** — the **landing page**. The marketing / introduction
  surface, including the thread-story scrollytelling section.
- **`index.html`** — a thin **redirect** to `HomePage.html`.

> Note: **NoteFlow Classic** is a separate legacy app and is **not** Sutra.

---

## 2. Core

- **`src/core/app.js`** — the **core**, a single large script that runs in
  **global scope**. It owns the data model (`appData`), persistence and
  hydration, the export/import pipeline, the Notes editor (including Document
  Backgrounds, locked pages, Page Mode, split view), and the wiring for most
  views.

  Because `app.js` runs at global scope, top-level names share one namespace —
  worth keeping in mind when reading or extending it.

### Core safety layer (loaded before everything else)

The safety layer also includes **`src/core/migrations.js`**
(`window.SutraMigrations`), a pure versioned workspace migration registry.
Hydration applies each registered `vN -> vN+1` step before defaults and feature
normalizers. Migrations preserve unknown fields so old backups and plugin-owned
data are not silently truncated.

These small, dependency-free classic scripts load right after `safe-storage.js`
in `Sutra.html`, before any feature module or `app.js`, so their globals exist
at first render and can capture boot-time failures. They are also the first
incremental **extraction** of cross-cutting utilities out of `app.js`:

- **`src/core/safe-storage.js`** — `window.SutraSafeStorage`: defensive wrapper
  around `localStorage`/`sessionStorage` (quota/security/serialize handling,
  durable degraded banner). The approved channel for non-canonical storage.
- **`src/core/error-reporter.js`** — `window.SutraReportError(error, context,
  severity)` plus global `error` / `unhandledrejection` nets and an exportable,
  in-memory diagnostics ring buffer (`window.SutraDiagnostics`). One funnel for
  "something went wrong" instead of bare `catch (e) {}`. Never blocks the user;
  toasts only when a `userMessage` is supplied.
- **`src/core/dom-safety.js`** — `window.SutraDOMSafety`: the central
  render/sanitize layer. `setText` (plain text), `setTrustedHTML` (audited,
  developer-only static markup), `sanitizeUserHTML` / `setUserHTML` (allowlist
  sanitizer for user/imported content), `isSafeUrl`, and `renderUserHTMLToFrame`
  (sandboxed-iframe isolation for canvas / htmlEmbed-style blocks). User-authored
  HTML is **never** injected raw — it is sanitized or sandboxed.
- **`src/core/feature-guard.js`** — `window.SutraFeatureGuard.run(name, fn)`:
  feature-level runtime isolation. A broken feature is reported and shown a small
  degraded badge; the rest of the app still boots. The `DOMContentLoaded` boot
  sequence in `app.js` runs each step through this guard.
- **`src/core/startup-health.js`** — `window.SutraStartupHealth`: proactive
  startup-integrity watchdog. After boot has had a fair chance it verifies that
  the *critical* subsystems came up (workspace save/serialize runtime, safe
  storage, persistence pipeline, app shell). For a genuine catastrophic boot
  failure — and only then — it shows one small, dismissible recovery banner with
  the data-safety actions (Reload / Safe Mode / emergency export), never "file an
  issue". It is false-alarm-resistant (watchdog + confirmation rechecks), makes
  no network/storage writes, exposes no workspace data, and never blocks normal
  use. Complements `issue-prompt.js` (which is reporting-oriented).

The app shell starts concealed and inert behind the neutral workspace startup
gate (`src/boot/workspace-startup.js`, `styles/features/workspace-startup.css`).
The gate is independent of the optional session intro. `app.js` releases it only
after the canonical IndexedDB workspace is confirmed, hydration completes, and
the initial core UI and routing render succeed. A failed read or first write
keeps placeholder Home data concealed and offers reload, Safe Mode, and
diagnostics without treating the workspace as empty.

New unsafe patterns (raw `innerHTML =`, direct `localStorage.setItem`,
unregistered `window.*`, un-inventoried workspace fields) are blocked in CI by
`scripts/sutra-guardrails-check.mjs` — see [section 9](#9-test-scripts).

---

## 3. Feature modules

Self-contained feature areas live in **`src/features/*.js`**:

- `flow-assistant.js` — **Sutra Assistant**, the contextual chat panel and its
  Suggested Actions / Apply-Decline change cards / Assistant Activity.
- `flow-intelligence.js` — **Sutra Intelligence**, the **local** signal layer
  (`deriveStudentContext`) that reads only your workspace; calls no server.
- `intelligence-diagnostics.js` — pure, dual-mode reliability + observability
  core (`window.SutraIntelligenceDiagnostics`) for the remote request path:
  HTTP error classification (incl. `context-length`), provider usage
  normalization, streaming-usage capture, retry/deadline policy, `Retry-After`
  parsing, reasoning-aware timeout scaling, and per-response/aggregate
  diagnostics. No DOM, no network. See
  [`SUTRA_ASSISTANT.md` §15](../features/SUTRA_ASSISTANT.md).
- `homework.js` — the Homework module (its own localStorage source of truth,
  mirrored into `appData`).
- `ap-study.js` — AP Study.
- `review.js` — Review / flashcards (spaced repetition).
- `business-workspace.js` — Projects & Work.
- `handwriting.js` — handwriting / drawing support.
- `customization.js` — the customization engine (themes, CSS overrides).
- `plugin-system.js` — the plugin loader and sandbox.
- `notifications.js` — the notification center (reminders, snooze, digest,
  missed-reminder replay, OS notifications, and `.ics` calendar handoff).
- `school-schedule.js` — the rotating **School Schedule** engine (A/B & cycle
  days, bell schedules, holidays, calendar subscriptions) + Today strip.
- `grade-planner.js` — deterministic **Grade Forecasting & GPA** engine inside
  the Course Hub Grades tab.
- `assignment-studio.js` — the **Assignment Studio** (milestones, subtasks,
  rubric, linked work) layered onto a Homework task.
- `semester-setup.js` — the **Semester Setup** syllabus/calendar importer.
- `workspace/starter-packs.data.js` — **Starter Packs** seed data
  (`window.SUTRA_STARTER_PACKS`), loaded before `app.js`. It is *data only*; the
  preview/apply/undo controller (`window.SutraStarterPacks`) lives in
  `src/core/app.js` so it can reuse the in-closure create functions (notes,
  courses, decks, blocks, tasks, college rows) — the same reason Sutra Cloud
  providers and the Review Generator (`window.SutraReviewGenerator`) live there.
- `domain/workspace-entity-registry.js` +
  `features/workspace/workspace-entity-adapters.js` — the canonical, derived
  `type:id` contract for records that can be found, opened, or acted on across
  feature boundaries. It owns no data and persists no index; see
  [`WORKSPACE_ENTITY_REGISTRY.md`](./WORKSPACE_ENTITY_REGISTRY.md).

The **All Due** ranking engine (`computeDeadlineRank`), the **Review Generator**
(`SutraReviewGenerator`), and the **Starter Packs** controller all live in
`src/core/app.js` for this in-closure-helper reason (see §15 landmine note).

See [`SUTRA_ASSISTANT.md`](../features/SUTRA_ASSISTANT.md) for the Assistant + Intelligence
split, and [`ACADEMIC_PLANNING.md`](../features/ACADEMIC_PLANNING.md) for the academic
planning layer (the last four modules above + reminders).

---

## 4. UI enhancers and styles

`npm run check:shell` blocks new large inline `<style>` blocks in `Sutra.html`
and ratchets the rest down. The ~2,900 lines of legacy inline CSS have been
**externalized** into `styles/legacy/` (loaded by `<link>`s at the same cascade
position, so the result is identical) — see `styles/README.md`.

- **`src/ui/*.js`** — UI helper / enhancer modules layered on top of the core.
- **`styles/`** — organized by cascade layer (folder ≠ cascade; **order in
  `Sutra.html` is the cascade**):
  - `base/` — `styles.css` (core tokens/components/layout), `microinteractions.css`.
  - `themes/` — `sutra-pro.css` (renamed from `atelier-pro.css`), `glass.css`, `macos26-redesign.css`.
  - `views/` — `focus-session.css`, `settings-redesign.css`.
  - `features/` — `sutra-intelligence.css`, `customization.css`, `command-center.css`, `academic-command-center.css`, `academic-planning.css`, `notifications.css`, `startup-intro.css`.
  - `responsive/` — `mobile.css` (loads late on purpose).
  - `legacy/` — large blocks extracted 1:1 from inline `<style>`; split down over time.

---

## 5. The window bridge globals

Feature modules expose canonical globals on `window` so the core and other
modules (and plugins) can reach them. The **legacy aliases point at the same
objects**, so code written against the old names keeps working:

| Canonical | Legacy alias | What it is |
|---|---|---|
| `window.sutraAssistant` | `window.flowAssistant` | Sutra Assistant API |
| `window.sutraIntelligence` | `window.flowIntelligence` | Local signal layer (`deriveStudentContext`) |
| `window.getSutraAssistantContext` | `window.getFlowAssistantContext` | Current assistant context |
| `window.SutraWorkspaceEntityRegistry` | — | Derived entity, deep-link, action, privacy, and invalidation registry |

The persistence/export/import layer also publishes canonical wrappers on
`window` (for serialize/deserialize, save/load locally, export `.sutra`/JSON,
import, and round-trip verification).

---

## 6. Customization engine + plugin sandbox

- The **customization engine** (`customization.js`) drives themes, density,
  motion, text size, and **CSS Overrides**.
- **Plugins** (`plugin-system.js`) are **local bundles only** — there is no
  marketplace. They run **sandboxed in an iframe** with an explicit permission
  allowlist, install **disabled**, and are **reviewed before they run** (review
  is forced on import). Export extension **`.sutra-plugin`**; legacy
  **`.atelier-plugin`** still imports.
- **Safe Mode** (`?sutraSafeMode=1`, legacy `?atelierSafeMode=1`, or hold
  **Shift** on load) **skips custom CSS and plugins** and **never deletes** data,
  CSS, plugins, or workspace — the safe way to recover from a bad customization.

---

## 7. How persistence, export, and import wrap together

At a glance (full detail in [`DATA_AND_BACKUPS.md`](../privacy-security/DATA_AND_BACKUPS.md)):

- **One workspace object** (`appData`) is the in-memory truth; it persists to
  **IndexedDB** (`noteflow_atelier_db`). Course-file binaries persist separately
  to `noteflow_attachments_db`; homework mirrors to localStorage.
- **One hydrate path** merges stored data over defaults and normalizes it on
  load; **one debounced save path** (with a lifecycle flush) writes it back.
- `src/persistence/workspace-db.js` deliberately reuses one IndexedDB connection,
  closes it on `versionchange`, rejects blocked upgrades, and exposes an explicit
  close/reopen seam so future schema upgrades cannot leak connections or hang.
- **One persistence-health pipeline** wraps core saves, localStorage mirrors,
  IndexedDB transactions, attachment cache warming, imports, backups, and
  emergency exports. It records the last confirmed save, classifies quota /
  serialization / transaction / attachment / partial-write failures, preserves
  unsaved in-memory state, and drives the non-dismissible save-failure banner
  plus the Settings -> Data -> Storage Health panel. Its compact device-local
  last-confirmed hash may authorize recreation only when the canonical root is
  absent and the live page still matches that exact confirmed base; a different
  root remains a hard conflict, and a missing prior root at startup fails closed.
- **One serializer/deserializer pair** drives every full-workspace transport:
  manual **`.sutra`**, optional Google Drive sync snapshots, legacy package
  import, and **JSON**. New `.sutra` exports wrap the existing internal ZIP
  (`manifest.json` / `workspace.json` / `assets/` / `metadata/` with checksums)
  in a password-encrypted `SUTRAENC` envelope. JSON remains unencrypted and is an
  advanced/recovery format. JSZip is vendored locally under
  `assets/vendor/jszip/` for core package creation/import.
- **Inline assets** — note images and **Document Backgrounds** — are extracted to
  `assets/` on `.sutra` export and rehydrated on import; **secrets are stripped**
  from every export.
- **Legacy unencrypted `.sutra` and `.atelier`** backups import through the same
  package importer.
- **Optional Google Drive sync** lives in `src/core/app.js` as an explicit sync
  controller. It requests only `https://www.googleapis.com/auth/drive.appdata`,
  stores `sutra-sync-current-v1.sutra` in Drive `appDataFolder`, keeps OAuth
  access tokens and derived keys in memory only, persists only non-secret
  device-local metadata at `sutra:googleDriveSync:v1`, and uses the same
  encrypted envelope with `purpose: "google-drive-sync"`.
- **Optional Sutra Sync** is a separate incremental replication system. Its
  pure dual-mode engine modules live under `src/sync/`; `src/core/app.js` is the
  bridge to confirmed durable saves, the portable sensitive-stripped
  projection, attachment storage, and silent verified imports. Operational
  state is isolated in account-scoped namespaces inside `sutra_sync_db`; the
  workspace IndexedDB remains the running source of truth. An authenticated
  account change fails closed before pull/push/unlock so one profile cannot
  reuse another account's queue, device ID, wrapped key, baseline, or refresh
  token. Disabled sync opens no sync database and makes no
  network request. Its merge is field-aware and deterministic: semantic
  equality, non-overlapping fields, moves/reorders, and non-overlapping note
  blocks converge automatically. Only incompatible overlapping content creates
  one dedicated conflict-review record; it never becomes a sidebar page.
  Resolution markers ride the encrypted `syncAuditLog`, and an abnormal-rate
  circuit breaker pauses sync without blocking local saves. This is sync-time
  block merging, not a CRDT/OT collaborative editor. The normative contract is
  [`SYNC_PROTOCOL.md`](./SYNC_PROTOCOL.md).
- **Workspace schema v7 makes sync portability and Assistant ownership explicit.** The classification
  in `persistence-inventory.json` covers all top-level fields, named nested
  durable contracts, localStorage mirrors, browser stores, assets, secrets, and
  deliberate exclusions. `appData.assistantChatHistory` owns durable
  conversations; legacy Assistant localStorage keys migrate once and thereafter
  mirror canonical state only. `mode: "sync"` is a dedicated encrypted projection:
  it includes durable Assistant conversations, private documents, page version
  history, compatibility/quarantine containers, and unknown non-secret fields;
  it excludes browser UI, sync operations, credentials, and generated records.
  The round-trip guard validates names and decisions, while the everything-
  workspace fixture compares field-level bootstrap and reverse incremental
  reconstruction after normal import/migration/normalization/readback.

Storage names like `noteflow_atelier_db` are **legacy-named compatibility
identifiers**, kept so existing installs keep working.

For the broader privacy stance, see
[`PRIVACY_AND_LOCAL_FIRST.md`](../privacy-security/PRIVACY_AND_LOCAL_FIRST.md).

---

## 8. Security and network policy

- `index.html`, `HomePage.html`, and `Sutra.html` ship CSP meta tags with
  explicit `script-src`, `connect-src`, `frame-src`, `form-action`, `img-src`,
  `media-src`, `worker-src`, and `object-src 'none'` coverage.
- `scripts/lib/csp-policy.mjs` is the canonical host-document policy. Run
  `npm run csp:generate` after changing it; CI rejects drift in HTML, Vercel,
  or the local server. The local static server used by Playwright adds the same CSP plus
  `frame-ancestors 'none'`. Production static hosts must set that directive as
  an HTTP response header because browsers ignore it in CSP meta tags.
- Fresh startup with sync disabled, manual encrypted `.sutra` backup, and JSON
  backup should make zero third-party requests. Remaining remote paths are user-triggered and
  limited to optional Google Drive OAuth/sync, configured AI providers,
  localhost/127.0.0.1 local endpoints, approved feedback/media embeds, AP
  Classroom/resource/help links, ChatGPT/Spotify shortcuts, and disclosed
  optional secondary import/export helpers.
- Custom CSS and local plugins remain local-first. Plugins run in sandboxed
  iframes with an explicit allowlist and are re-reviewed after import.

---

## 9. Test scripts

- `npm run check:shell` - blocks new large inline styles in `Sutra.html`.
- `npm run check:migrations` - executes old-workspace migration fixtures,
  idempotence, and unknown-field preservation.
- `npm run check:syntax` - checks first-party `src/`, `scripts/`, tests, and
  Playwright configs while excluding `.deploy`, build, coverage, vendor, and
  generated documentation output.

Run with Node from the project root:

- `npm run check:csp` - static CSP and hosting-header guard.
- `npm run check:persistence` - centralized persistence-health guard.
- `npm run check:modal` - modal accessibility primitive guard.
- `npm run check:network` - approved-origin and startup-network guard.
- `npm run check:startup-health` - asserts the runtime startup health layer
  (`src/core/startup-health.js`) is present, safe (no network/storage/unsafe
  sink), wired before `app.js`, and offers recovery actions.
- `npm run check:dom` - duplicate element-id + duplicate `<script src>` guard for
  the HTML entry points (`document.getElementById` returns only the first match,
  so a dup id silently mis-wires).
- `npm run verify` - the strongest practical local pass: `check:all` +
  `build:deploy` + `check:deploy` + a deterministic serial Chromium e2e smoke
  (`test:e2e:smoke`). The full browser matrix stays on `npm run test:e2e`.
- `npm run check:guardrails` - architecture guardrails: fails CI when a change
  adds a new raw `innerHTML =` / `insertAdjacentHTML` / `document.write`, a new
  direct `localStorage.setItem` / `sessionStorage.setItem`, an unregistered
  `window.*` global, or a top-level workspace field missing from
  `docs/persistence-inventory.json`. Baseline lives in
  `scripts/guardrail-baseline.json`; reviewed exceptions use an inline
  `// sutra-allow-html:` / `// sutra-allow-storage:` marker, or
  `npm run check:guardrails:update` to deliberately re-baseline.
  `npm run check:guardrails:selftest` proves the detectors fire on hostile
  fixtures (`scripts/sutra-guardrails.selftest.mjs`).
- `npm run test:e2e` - Chromium, Firefox, and WebKit Playwright matrix for
  persistence, CSP, modal keyboard, reduced-motion, offline-startup,
  encrypted backup/export and mocked Drive sync regressions, the central
  DOM-safety sanitizer against hostile payloads (`dom-safety.spec.mjs`), and
  feature-isolation / error-reporting (`error-isolation.spec.mjs`).

- `node scripts/smoke-check.mjs` — core invariants.
- `node scripts/round-trip-check.mjs` — exact save/export/import/sync-
  classification field parity, nested-contract coverage, secret redaction, the
  localStorage decision matrix, and cache-warming guards.
- `node scripts/version-history-check.mjs` — version-history invariants.
- `node scripts/sutra-docbg-check.mjs` — Document Background checks.
- `node scripts/sutra-rebrand-check.mjs` — rebrand guard.
- `node scripts/sutra-responsive-check.mjs` — responsive guard.
- `node --check <file>` — syntax-check each `src` JS file.

Browser QA harness: `scripts/sutra-persistence-qa.js` — paste into the console on
`Sutra.html` and run the round-trip (non-destructive, or full wipe→import). See
[`sutra-save-systems-audit.md`](./sutra-save-systems-audit.md).

---

## 10. Where to go next

| Topic | Doc |
|---|---|
| Assistant + local Intelligence | [`SUTRA_ASSISTANT.md`](../features/SUTRA_ASSISTANT.md) |
| Document Backgrounds | [`DOCUMENT_BACKGROUNDS.md`](../features/DOCUMENT_BACKGROUNDS.md) |
| Privacy / local-first | [`PRIVACY_AND_LOCAL_FIRST.md`](../privacy-security/PRIVACY_AND_LOCAL_FIRST.md) |
| Data + backups | [`DATA_AND_BACKUPS.md`](../privacy-security/DATA_AND_BACKUPS.md) |
| Verified persistence audit | [`sutra-save-systems-audit.md`](./sutra-save-systems-audit.md) |

---

## 11. Repository map (2026-06 restructure)

The repo was reorganized by **responsibility**, preserving the static / no-build /
local-first design. Per-folder READMEs explain what belongs where.

```
Sutra/
├─ index.html · HomePage.html · Sutra.html · 404.html   # entry points
├─ manifest.webmanifest · sw.js                          # PWA shell + service worker
├─ README.md · SUTRA_GUIDE.md · TUTORIAL.md · LICENSE · NOTICE · TRADEMARK.md
├─ src/
│  ├─ boot/        startup-intro.js, sw-register.js       # startup orchestration
│  ├─ core/        app.js (the runtime) + safety layer    # safe-storage, error-reporter,
│  │                                                       #   dom-safety, feature-guard, migrations
│  ├─ state/       workspace-normalizers.js               # pure state normalizers (extracted from app.js)
│  ├─ config/      sutra-runtime-config.js
│  ├─ features/    assistant/ academic/ study/            # feature modules, grouped by domain
│  │               customization/ workspace/              #   (see src/features/README.md)
│  ├─ ui/          date/time/select enhancers
│  ├─ components/  icons/
│  └─ data/        daily-lock-in-quotes, emoji-keywords.generated
├─ styles/         base/ themes/ views/ features/         # by cascade layer (see styles/README.md)
│                  responsive/ legacy/
├─ scripts/        Node checks/build/probes + lib/        # flat; see scripts/README.md
├─ tests/          e2e/ bench/ fixtures/                  # Playwright (see tests/README.md)
├─ docs/           architecture/ features/                # by topic (see docs/README.md)
│                  privacy-security/ release/ archive/
└─ assets/         brand/ vendor/ ss/
```

## 12. Sutra.html load order (load-bearing)

`Sutra.html` loads scripts and styles in a deliberate, **scattered** order. The
cascade and the global-scope execution order both depend on it. Do not reorder.

1. **`<head>`** — `assets/vendor/jszip` → core **safety layer** (`safe-storage` →
   `error-reporter` → `dom-safety` → `feature-guard` → `migrations`) →
   **`src/state/workspace-normalizers.js`** → `src/sync/*` in protocol-to-engine
   dependency order → `components/icons/*` →
   stylesheets `styles/features/startup-intro.css`, `styles/base/styles.css`,
   `styles/themes/sutra-pro.css`, `styles/features/sutra-intelligence.css` →
   `boot/startup-intro.js`, `ui/*` enhancers, `data/emoji-keywords`.
2. **mid-`<body>`** — a few `<link>`s and `study/homework.js` load inline where
   their markup lives. Several `styles/legacy/*.css` `<link>`s sit at the exact
   positions their inline `<style>` blocks used to.
3. **end-of-`<body>`** — the **feature bulk** (`features/**`,
   `config/sutra-runtime-config.js`) → **`src/core/app.js`** → `boot/sw-register.js`
   → remaining features → then the **late stylesheets**
   (`themes/macos26-redesign`, `themes/glass`, `base/microinteractions`,
   `responsive/mobile`, `views/settings-redesign`, `features/*`). `responsive/mobile.css`
   loads near the end on purpose.

Rule: a script whose **top-level code** reads a global must load *after* the
script that defines it. Function bodies run later, so call-time references across
scripts are always fine. Every `<script>`/`<link>` carries a `?v=` cache-busting
query the service worker relies on — keep it when you move a file.

## 13. Path-coupling map — what to update when you move a file

This repo's release gate hardcodes many paths. Moving a file means updating its
coupled references. `npm run check:links` + `npm run check:all` catch most
breakage; the items marked **(silent)** are prose/strings no check guards.

| Move a… | Also update |
|---|---|
| `src/**` runtime JS | `Sutra.html` `<script src>` (+ `?v=`) [link-check]; automatic first-party discovery in `scripts/sutra-guardrails-check.mjs` then deliberate `npm run check:guardrails:update`; `scripts/smoke-check.mjs` content asserts; `scripts/sutra-academic-engines-check.mjs` `require()` paths (academic); `scripts/sutra-{modal-a11y,network,compat,persistence-health}-check.mjs` reads; doc prose **(silent)** |
| `styles/**.css` | `Sutra.html` `<link href>` (+ `?v=`, **same position**) [link-check]; `scripts/{smoke,responsive,modal-a11y,app-shell}-check.mjs` + `sutra-deploy-artifact-check.mjs` path strings; doc prose **(silent)** |
| `docs/**` | inter-doc relative links [link-check]; root `README/TUTORIAL/SUTRA_GUIDE` links [link-check]; check scripts that `read('docs/…')` (`smoke`, `csp`, `network`, `guardrails`, `round-trip`); leave `archive/` historical paths **(silent, intentional)** |
| `scripts/**` | `package.json` (`check:*` + `check:all`) [link-check]; `__dirname`-derived repo root in the script; cross-imports; `playwright*.config.mjs`; ~50 doc run-instructions **(silent)** — this is why scripts stay flat (see §15) |
| `assets/**` | `Sutra.html`/`HomePage.html`/`404.html`/`index.html` refs + `manifest.webmanifest` + CSS `url()` [all link-check]; `scripts/sutra-brand-assets-check.mjs` |
| top-level workspace field in `app.js` | `docs/architecture/persistence-inventory.json` (guardrail parity check) |

Tooling: **`npm run check:links`** validates HTML attrs, CSS `url()`, manifest,
service-worker assets, markdown links, and `package.json` script paths across the
whole repo. Add it to any move's verification loop.

## 14. Where do I edit X?

| Task | Location |
|---|---|
| Boot sequence / SW registration | `src/boot/` |
| Workspace schema, defaults, enabled-view + shortcut normalizers | `src/state/` then `src/core/app.js` |
| App state, persistence, export/import, notes, timeline, most views, Drive sync | `src/core/app.js` |
| Safe storage / error funnel / DOM sanitize / feature isolation / migrations | `src/core/` safety layer |
| Assistant actions / local Intelligence | `src/features/assistant/` |
| Academic engines (schedule, grades, studio, semester, planner) | `src/features/academic/` |
| AP study / review / homework | `src/features/study/` |
| Themes, CSS overrides, plugins | `src/features/customization/` + `styles/themes/`, `styles/features/customization.css` |
| Notifications / Projects & Work / handwriting / daily quote | `src/features/workspace/` |
| Styling | `styles/<layer>/` (preserve `<link>` order) |
| A check / guardrail | `scripts/` (+ `package.json`) — see `scripts/README.md` |
| Tests | `tests/e2e/` |
| Docs | `docs/<topic>/` |

## 15. Staged extraction plan (remaining decomposition)

The Sutra Cloud coordinator remains beside the closure-bound provider and
Sync bridges in `src/core/app.js`. `window.SutraCloud` exposes locally derived
`getStatus()`, `open(section)`, `syncNow()`, `pauseSync()`, `resumeSync()`,
`backupNow()`, `restore()`, and `setAutoBackup({ enabled, frequency })`.
It emits `sutra:cloud-status` without replacing existing Sync events. Status
reads must not open the Sync database or request provider data. The existing
`SutraSync` and `SutraCloudSync` APIs retain their operational semantics;
their open actions select the corresponding section in the shared modal.
Sync scheduling stays inside its engine/bridge. Snapshot scheduling uses a
separate Web Lock and successful-upload receipt in version-2 device-local
Cloud metadata. The encryption helpers and provider registry stay in place.

The restructure deliberately **stopped at green checkpoints**. Remaining work,
in safe increments:

1. **`app.js` decomposition (begun).** `src/state/workspace-normalizers.js` is the
   first extraction. Next safe candidates are other *pure, non–check-asserted*
   top-level normalizers. ⚠️ **Landmine:** some top-level functions call helpers
   that are **nested inside app.js closures** (e.g. `generateId`,
   `normalizeExternalUrl` are not global). Before extracting a function, confirm
   every symbol it references is either global or moved with it, and that no check
   parses it by name from `app.js`. Target future homes: `src/state/` (normalizers,
   selectors, defaults), `src/persistence/` (serialize/deserialize, export/import,
   storage health), `src/views/` (per-view render once view code is teased out).
2. **`styles/legacy/*` split.** Migrate rules from each `legacy/*.css` into
   `base/themes/views/features/`, shrinking the legacy files toward zero. Update
   the selector assertions in `smoke`/`responsive`/`modal-a11y` checks as rules move.
3. **`scripts/` physical subfoldering (deferred, by judgment).** Grouping into
   `checks/ build/ probes/ lib/` is desirable but currently poor risk/reward:
   ~50 doc run-instructions reference `node scripts/<name>` (live **and**
   historical), no check guards prose paths, and ~14 scripts derive the repo root
   from `__dirname`. To do it safely: (a) standardize repo-root derivation to
   `process.cwd()`; (b) move with `git mv`; (c) update `package.json` +
   cross-imports + `playwright*.config.mjs`; (d) update **live** doc
   run-instructions only, leaving `archive/` + `CHANGELOG` historical; (e) extend
   `check-links` to optionally flag inline `scripts/<name>` mentions in live docs;
   (f) `npm run check:all` + `check:links` to verify. Until then `scripts/README.md`
   provides the categorization.
4. **Deeper per-feature folders.** The current grouping
   (`assistant/academic/study/customization/workspace`) can be split further if a
   group grows; each move follows the `src/**` row of the §13 coupling map.
