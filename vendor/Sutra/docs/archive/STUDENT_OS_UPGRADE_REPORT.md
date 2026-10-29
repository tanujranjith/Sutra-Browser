# Student OS Upgrade Report

Date: 2026-06-16

## Scope Completed

Phase 1 was implemented against Sutra's current static, local-first architecture. The work keeps Sutra as a single static app, preserves the existing Homework localStorage keys, keeps Course Hub as the richer metadata layer over the existing homework course/task store, and routes new homework writes through `SutraSafeStorage`.

## Changes

- Added a unified All Due / Student Inbox in Course Hub that aggregates homework, planner tasks, Assignment Studio milestones, AP exams and prep signals, review debt, college deadlines, timeline items/conflicts, overloaded-day signals, stale-note signals, and work/project deadlines.
- Added inbox filters for all, overdue, today, this week, high risk, unscheduled, review, AP, college, course, and timeline.
- Added safe inbox actions: open source, schedule, mark done for mutable task types, defer/reschedule, and create study block.
- Expanded Course Hub overview into a central academic dashboard with next actions, assignments, files/resources, linked notes, review decks, AP linkage, school schedule periods, Grade Planner summary, and quick actions.
- Surfaced the deterministic Grade Planner engine inside Course Hub grade snapshots, including current score, target, missing-work count, and missing-work impact. Grade math remains local and deterministic; assistant actions can request local grade calculations but do not compute grades directly.
- Added an Assistant Action Review Center for multi-action batches with batch controls, risk labels, selected apply/decline, before/after summaries, high-risk confirmation, activity access, and grouped activity history.
- Added Backup Health / Data Safety cards in Settings for last export, storage health, degraded storage, Drive sync status, and quick export/restore/diagnostic actions.
- Expanded universal search coverage for courses, course resources, assistant activity, and settings/data-safety surfaces.
- Added Phase 1 UI styling for inbox filters/actions, course next-action cards, grade-engine notes, data-safety cards, and assistant review-center batches.

## Files Touched For This Pass

- `Sutra.html`
- `src/core/app.js`
- `src/features/flow-assistant.js`
- `styles/sutra-pro.css`
- `tests/e2e/student-os-phase1.spec.mjs`
- `docs/STUDENT_OS_UPGRADE_REPORT.md`

The working tree already contained broader uncommitted changes outside this pass, including academic command-center, glass styling, migration/check scripts, and other docs/tests. Those were not reverted.

## Tests Added

Added `tests/e2e/student-os-phase1.spec.mjs` covering:

- Student Inbox aggregation across homework, planner tasks, milestones, review, AP, college, timeline, business/work deadlines, filters, safe mark-done action, and `SutraSafeStorage` usage.
- Course Hub linking for assignments, resources, notes, review decks, next actions, school schedule, and deterministic Grade Planner math.
- Grade calculations for weighted categories, missing/pending/excused status, final-score solver, missing-work impact, and GPA projection.
- Assistant Action Review Center high-risk batch confirmation behavior and grouped activity/search coverage.
- Backup round-trip coverage for the new `courseWorkspace.settings.studentInboxFilter` persisted field.
- Mobile Student Inbox layout/action visibility.
- Expanded search indexing for course resources, review cards, assistant activity, and settings.

## Verification Pass (follow-up)

The initial Phase 1 pass could not run the gated checks. A follow-up pass ran them
to completion and fixed three real defects surfaced by the previously-unrunnable
checks/tests:

1. **Guardrail violations** (`npm run check:all` was failing). `flow-assistant.js`
   had 4 new `innerHTML` sinks over baseline and 6 unregistered `cw*` globals.
   - The 4 sinks are reviewed-safe (empty/static markup or `esc()`-escaped
     interpolation); added `// sutra-allow-html:` markers. This dropped the
     file's sink budget from 24 to 19.
   - Registered the 6 new namespaced `cw*` globals via `--update`; the ratchet
     also tightened several budgets downward (net improvement).
2. **Grade engine** (`computeCourseGrade`) returned `missingCount`/`gradedCount`
   but not `pendingCount`/`excusedCount`, which Course Hub and the spec rely on
   for the documented "missing/pending/excused" status. Added both counts.
   Math remains deterministic and local.
3. **Mobile Student Inbox CSS blowout.** The inbox row reuses the `.ad-row`
   class and inherited the legacy `.ad-row` mobile child `grid-column`
   placements, forcing an implicit 2nd column; the `.ad-main-grid` track also
   let the panel overflow below its min-content. Reset inbox child placements in
   the mobile breakpoint and added `min-width: 0` to `.ad-main-grid` items so
   wide tables wrap instead of overflowing.

## Checks Run

- `npm run check:syntax` — passed (92 JS files validated).
- `npm run check:all` — **passed** (syntax, app-shell, migrations, smoke,
  round-trip, version-history, rebrand, compat, CSP, persistence, modal-a11y,
  network, encoding, responsive, brand, docbg, academic engines, guardrail
  self-test, architecture guardrails).
- `npx playwright test --project=chromium tests/e2e/student-os-phase1.spec.mjs`
  — **4 passed** (Student Inbox aggregation/guarded storage, Course Hub linking +
  deterministic grade math, Assistant Action Review Center high-risk gating +
  search, backup round-trip + mobile inbox layout).

## Phase 2 — #8 Generate Review Deck (implemented)

Implemented the Generate Review Deck workflow end-to-end on top of the existing
`review.js` create-set editor (no new persisted fields — generated cards reuse
the card model's existing `sourceType`/`sourceId`/`sourceNoteId`/`sourceApClassId`/
`sourceProjectId` fields, so the `.sutra` round-trip is unchanged).

- Added a deterministic, AI-free generation engine in `src/features/review.js`:
  - `generateReviewCandidates(raw)` parses pasted material line-by-line,
    recognizing tab / ` - ` / ` = ` / `,` / `Term: definition` separators,
    stripping bullet and numbering prefixes, and de-duplicating within the batch.
  - `markDuplicateCandidates(candidates, {deckId})` flags candidates whose prompt
    already exists (defaults to scanning every deck; pass `deckId` to narrow).
  - `openReviewGenerator(opts)` opens the existing editable create-set table
    pre-filled with generated rows, duplicate badges, a generation banner, and a
    "Remove duplicates" action — nothing saves until the student confirms.
  - Extracted the shared `splitCardLine()` helper and refactored `bulkImportCards`
    to use it (identical legacy behavior; less duplication — goal #15).
- Public API: `window.SutraReviewGen = { generate, markDuplicates, openGenerator }`
  (namespaced, registered in the guardrail inventory) so the assistant and other
  surfaces can drive it.
- UI entry points: a "✨ Generate cards" button in the Review library and an
  in-view paste panel (`open-generate` / `create-generate-from-text`) that appends
  generated rows to the editable table, de-duping against the draft and saved decks.
- Styling in `styles/styles.css` for the paste panel, generation banner, and
  duplicate badge/row treatment.
- Tests: `tests/e2e/student-os-phase2-reviewgen.spec.mjs` (4 tests) covering
  mixed-format generation + intra-batch de-dupe, cross-deck duplicate detection,
  the editable review table + remove-duplicates + save + `.sutra` round-trip, and
  the visible library/paste entry point. All pass in Chromium.

Files touched this pass: `src/features/review.js`, `src/features/grade-planner.js`,
`src/features/flow-assistant.js`, `styles/styles.css`, `styles/sutra-pro.css`,
`scripts/guardrail-baseline.json`, `tests/e2e/student-os-phase2-reviewgen.spec.mjs`,
`docs/STUDENT_OS_UPGRADE_REPORT.md`.

## Incomplete Work

Remaining Phase 2 and Phase 3 work:

- First-run setup and school-portal import review upgrades (a student onboarding
  overlay already exists; the editable import review table is still pending).
- Stronger Assignment Studio project workspace fields and scheduling remaining work.
- Plan/Fix My Week proposals that respect school schedule and existing timeline blocks.
- Deeper School Schedule setup/Today polish.
- Full universal-search polish beyond the Phase 1 expanded sources.
- Mobile-first capture mode and compact mobile command rail.
- Capped object-level revision history.
- Full design-system pass and remaining visible "Liquid Glass" rename cleanup if any legacy copy remains in older surfaces.

## Phase 3 — Studio 2.0, Plan/Repair, Import Wizard, Grade Risk, PWA (implemented)

This pass added four deterministic engines (all Node-tested in
`scripts/sutra-academic-engines-check.mjs`) plus a minimal service worker, and
wired each into the UI and the assistant. No new top-level `appData` keys were
introduced, so `.sutra` export/import and the round-trip check are unchanged.

### Assignment Studio 2.0 (priority #3)
- Extended the milestone model in `src/features/assignment-studio.js` with
  `type` (research/outline/draft/revise/submit/study/rehearse/build/solve/
  review/other), `status` (not_started/in_progress/done, kept in lock-step with
  the legacy `done` boolean so old data and `computeProgress` are unaffected),
  `linkedNoteId`, and `linkedBlockIds[]`. Milestones ride `task.studio` inside
  `hwTasks:v2`, so the new fields round-trip through `.sutra` automatically
  (verified by `tests/e2e/student-os-phase3.spec.mjs`).
- Added a deterministic, AI-free plan generator: `generateMilestones(kind)`
  (essay/project/presentation/lab/test/reading/generic templates),
  `scheduleMilestonesBackward(milestones, dueDate)` (spreads work back from the
  deadline, never schedules past it, flags `compressed`/`pressure` crunch plans),
  and `buildPlan()`/`applyPlanToTask()`.
- UI: a "✨ Generate plan / ↻ Regenerate plan" button + per-milestone type
  selector in the Studio modal; a "Next: …" milestone chip on homework cards.
- Assistant: `create_assignment_plan` now attaches real Studio milestones
  (work-backward scheduled) instead of loose planner tasks, with a graceful
  fallback to tasks when Studio is unavailable.

### Conflict-aware Plan / Repair engine (priority #2)
- New module `src/features/planning-engine.js` — a pure core (`planWork`,
  `analyzePlan`) plus a browser adapter. `planWork` places non-overlapping
  study blocks into the day's free windows (carving each placed slot out so
  later blocks can't collide), respects a per-day block cap and inter-block
  buffer, never schedules past a due date, chunks large/hard work into
  milestone-sized pieces, ranks overdue/high-priority first, and gives every
  block a plain-language reason. `analyzePlan` flags overlaps, missing buffers,
  overloaded days, unscheduled high-priority work, AP exams within 21 days with
  no study, and review backlog with no session.
- The adapter gathers real free windows (`getFreeWindowsForDateKey`, now exposed
  on `flowAtelier`), school periods, and `deriveStudentContext` signals, then
  renders a **preview-before-apply** modal: nothing touches the timeline until
  the student approves a block (Add / Add all). The repair modal lists issues
  with suggested fixes.
- Today entry points: "Suggest plan", "Plan week", and "Check my plan" buttons.
- Assistant: new read-only `repair_plan` action runs the analysis locally and
  reports issues; the model never invents them. (`plan_day`/`plan_week` already
  existed.)

### Import wizard — multi-format parser (priority #4)
- `src/features/flow-intelligence.js` gains `parseAssignmentText(text)`: a
  deterministic parser for markdown/pipe tables, CSV/TSV with a header row
  (columns mapped by NAME, any order), dash/positional rows (splitting combined
  date+time tokens), and syllabus prose (one row per dated sentence). It feeds
  the existing `normalizeImportBatch` pipeline (confidence, ambiguity flags,
  suggested destinations, duplicate detection against homework/tasks/timeline).
  The module now exports for Node so the parser is engine-tested.
- The manual paste-import modal (`parseHomeworkPasteText`) now routes
  header-structured input through the new parser — gated strictly on a detected
  header (markdown separator row, named pipe header, or CSV/TSV header) so the
  legacy per-line behavior for plain `class | title | date` rows is unchanged.
  The rich editable review table with multi-destination checkboxes already
  exists for the assistant (`import_assignments`) path.

### Grade-risk classification (priority #6)
- `src/features/grade-planner.js` gains `computeGradeRisk(courseData, options)`,
  a deterministic classifier returning `safe | watch | risk | danger | unknown`
  (gap-to-target when a target is set, absolute thresholds otherwise; missing
  work pulls an otherwise-safe grade down a notch; no graded work → `unknown`,
  never a fabricated number). Surfaced as a colored "On track / Watch / At risk /
  Danger" badge with a "Why?" tooltip in the Grades tab. All grade math remains
  local and deterministic — the assistant never computes it.

### PWA / offline (priority #13)
- New `sw.js` (was none): versioned cache, **network-first navigations** (a
  freshly deployed `Sutra.html` is never shadowed by a stale cache), cache-first
  for versioned sub-assets, and **zero interception of cross-origin requests**
  so AI-provider and Google Drive traffic is untouched and never cached. Non-GET
  requests and `.sutra` downloads are never cached. No telemetry.
- `src/config/sw-register.js`: registration is **protocol-gated to http(s)** and
  skips `file://` entirely (so the "just open the file" path is unaffected),
  fails silently, and adds an in-app offline indicator.
- `scripts/sutra-sw-check.mjs` (wired into `npm run check:all`) asserts all of
  the above safety properties.

### Tests added this pass
- `scripts/sutra-academic-engines-check.mjs`: Studio 2.0 (extended-field
  backward-compat, per-type generation, work-backward scheduling incl. crunch
  and past-due cases), Planning engine (non-overlap, class avoidance, ordering,
  never-past-due, every-block-has-a-reason; repair overlap/no-buffer/AP/review
  detection + severity sort), Import parser (markdown/CSV/TSV/dash/syllabus +
  normalization ambiguity flags + title similarity), and Grade risk
  (safe/danger/unknown/no-target/missing-drag).
- `tests/e2e/student-os-phase3.spec.mjs` (3 tests, chromium green): Studio plan
  generation + extended-field round-trip through `hwTasks:v2`; planning globals
  wired + preview modal opens without auto-applying; import parser + grade-risk
  globals exposed in the browser.
- `scripts/sutra-sw-check.mjs` for the service worker.

### Commands run (Phase 3)
- `npm run check:all` — **passed** (EXIT 0), now including the new academic
  engine assertions and the service-worker safety check.
- `npx playwright test --project=chromium tests/e2e/student-os-phase3.spec.mjs`
  — **3 passed**.
- Regression: `academic-upgrade.spec.mjs` (**7 passed**) and
  `student-os-phase1.spec.mjs` (**4 passed**) still green.

### Already present from earlier passes (not re-implemented)
- #1 Academic Command Center engine + Course Hub academic dashboard + Today
  student hub; #5 `convert_note_to_study_system` + `SutraReviewGen`; #7/#9 Data
  Health metadata + Backup Health cards + emergency export; #10 Assistant Action
  Review Center + activity log + undo; #12 expanded universal search.

### Intentionally deferred (clear gaps, not claimed done)
- #8 Mobile "Right Now" mode — a dedicated phone-first action dashboard (the app
  is responsive and the Student Inbox is mobile-checked, but the bespoke
  Right-Now surface is not built).
- #11 Course Resource Vault tabbed view — course objects already hold
  teacher/room/grading data and link to files/notes/decks, but the dedicated
  multi-tab vault UI is not built.
- #14 User-configurable reminder *rules* engine — `notifications.js` has
  category thresholds/quiet-hours/snooze, but a rule builder UI is not added.
- #15 Import-first onboarding upgrade — a student onboarding overlay exists; the
  full mode-picker + guided multi-step setup is not rebuilt.
- A dedicated multi-tab "Assignment Plan" modal (the Studio modal covers
  milestones/notes/effort/scheduling today).

## Bug-check / regression pass (post-implementation)

An adversarial bug-hunt across the new code and the systems it touches found and
fixed the following real defects (21 targeted regression tests added to
`scripts/sutra-academic-engines-check.mjs`):

- **CRITICAL — import date corruption.** `flow-intelligence.toISODate`/`parseDateOnly`
  fell back to `new Date('6/22')`, which V8 parses as the **year 2001**, silently
  corrupting any imported date lacking a 4-digit year — and flagging it as
  high-confidence/non-ambiguous. Rewrote the parser to handle ISO, M/D, M/D/Y,
  month-name, and relative words explicitly, with a year-guarded native fallback
  that can never invent a year. `tomorrow`/weekday names now resolve too.
- **HIGH — `looksLikeDate` over-greedy weekday match.** `(mon|tue|…|sun)[a-z]*`
  matched "Sunny", "Wednesday Wars", etc., so titles containing weekday letters
  were mis-parsed as dates (and the real title shifted into the course slot).
  Tightened to match weekday/relative words only when they dominate a short cell.
- **HIGH — two-word `Due Date` header false-negative routing.** The app.js manual
  import gate's pipe-header regex didn't match `due date` (with a space), so such
  tables fell to the legacy positional parser and swapped title/class. Gate now
  mirrors the full header vocabulary (`due date`, `deadline`, `when`, …).
- **HIGH — Studio `done`/`status` could drop a completion.** `done` was derived
  strictly from `status`, so an imported/assistant milestone with `done:true` but
  `status:'in_progress'` came back **not done** (corrupting `computeProgress`).
  The two fields are now reconciled so a completion from either is never lost.
- **HIGH — grade risk on a NaN target.** A non-numeric `targetPercent` (un-normalized
  Engine input) became `NaN` (since `Number('A')` is NaN, and `Number(null)` is 0),
  fell through every threshold, and mislabeled a strong grade as **danger** with
  `NaN` in the reason. Now guarded (null/undefined/non-finite → no target).
- **MAJOR — planner ignored due *time*.** `planWork` filtered candidate dates by
  due *date* only and could schedule a block after the assignment's due time on
  the due date. It now caps the slot end by the due time on the due date.
- **MEDIUM — Studio silent-success on failed write.** `writeTasks` never reported
  failure, so a degraded `SutraSafeStorage` write returned a false "saved". It now
  returns the real persist status (`{ok}` from SafeStorage), so callers don't claim
  success on a lost edit.
- **MEDIUM — import parser data-quality fixes:** a second date token is no longer
  filed as the course; a header row with no title column is no longer imported as
  a junk assignment (header detected when ≥2 columns are named); a valid dateless
  line (e.g. "Read chapter 5") is kept instead of silently dropped.
- **MINOR — planner block HH:MM/minute desync.** A free window ending at minute
  1440 produced `end:'23:59'` while `endMin:1440`; window bounds are now clamped
  into `[0, 1439]`. Overdue work placed after its past due date is now flagged
  `conflict:true` (catch-up, not on-time). Grade math hardened against `null`
  entries (no throw → `unknown`).

**Verified NON-bug:** undoing `create_assignment_plan` does not orphan milestones —
they live inside `task.studio` on the homework row, and `deleteObject('homework')`
removes the whole row (milestones included). Confirmed by reading `deleteObject`.

**Known minor items intentionally left as-is:** `cache.addAll` in `sw.js` is atomic
(a 404 on one core asset skips precaching the other) — mitigated because
network-first navigation re-caches on the next online load; `milestone.linkedBlockIds`
is a persisted-but-not-yet-populated field (scheduling creates the block but
doesn't store its id back yet); the SW safety check is a keyword/host tripwire,
not a behavioral proof.

### Bug-check commands run
- `npm run check:all` — **passed** (EXIT 0), now with 21 added regression assertions.
- `npx playwright test --project=chromium` over student-os-phase1/2/3, academic-upgrade,
  assistant-action-harness, sutra-intelligence-harness, encrypted-backups —
  **41 passed** (incl. "exports never contain API keys" and legacy
  `.atelier`/`.sutra`/JSON import round-trips).

## Known Risks

- The new e2e spec has parser coverage but could not be executed in Chromium because Playwright output cleanup was blocked by the sandbox and escalation was rejected by the usage-limit gate.
- `npm run check:all` could not complete after the new test was added for the same child-spawn sandbox reason. The targeted modified JS files parse cleanly, and a full syntax suite passed earlier before the final test file was added.
- Student Inbox depends on existing Sutra Intelligence signals when available. Base deadline aggregation still works without those signals, but stale-note, conflict, and overload quality follows the current intelligence heuristics.
- Course Hub grade summaries intentionally read Grade Planner data when present and fall back to legacy course-local grade fields when a course has no planner model.
