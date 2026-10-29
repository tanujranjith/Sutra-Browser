# Feature-Upgrade Wave — Progress & TODO

Honest status of the 10-feature upgrade wave. "Complete" means shipped and
covered by checks/tests; "Partial" means a real, working increment landed with
remaining work listed; "Pre-existing" means it was already substantially built
in the repo before this wave.

Anchors below are by symbol name (line numbers drift in `src/core/app.js`).

| # | Feature | Status |
|---|---|---|
| 1 | Sutra Cloud Backup Hub | **Pre-existing + documented** |
| 2 | Unified All Due Command Center | **Complete (this wave)** |
| 3 | Course Hub 2.0 | **Partial** — deterministic "what next" card added |
| 4 | Assistant Action Plans | **Pre-existing harness + plan templates added** |
| 5 | Smart Review Generator | **Complete (deterministic core + entry points)** |
| 6 | Assignment Studio 2.0 | **Pre-existing + focus-plan/review-cards actions added** |
| 7 | College App Builder Mode | **Partial / mostly pre-existing** |
| 8 | Import Everything Wizard | **Partial / mostly pre-existing** |
| 9 | Workspace Time Machine | **Partial** — version history pre-exists; recovery extras TODO |
| 10 | Template & Starter Pack System | **Complete (this wave)** |

---

## 1. Sutra Cloud — Pre-existing, documented
Provider abstraction (`makeSutraCloudAdapter`), 9-provider registry (Manual /
Supabase / WebDAV / Custom HTTP / Google Drive / OneDrive / Dropbox fully wired;
Box honestly scaffolded — its token exchange needs a confidential secret a
static app can't hold; S3 SigV4 preview), CSP enforcement, secret rejection,
encryption reuse, auto-backup, full Settings panel, e2e tests, and the
`docs/SUTRA_CLOUD_*.md` set were already present. Added
`docs/features/SUTRA_CLOUD.md`.
**Update 2026-07-01:** restore-time **conflict chooser** shipped — before a cloud
restore applies, Sutra compares this device vs the backup (page/task counts +
newest edit vs backup timestamp) and asks, warning when the device looks newer;
an empty device restores without interruption.
**Update 2026-07-02:** the chooser now gates **every** whole-workspace
replacement — it moved into `applyValidatedWorkspaceImport`
(`confirmWorkspaceRestoreConflict` in app.js), so file-based .sutra/JSON imports
and manual Drive restores get the same comparison; Drive's version-tracked
background pull passes `skipConflictCheck:true`. Backup timestamps flow through
via `options.backupTimestamp` (cloud row / Drive `modifiedTime`) with a fallback
to the payload's `exportedAt`.
**Update 2026-06-20:** OneDrive and Dropbox OAuth shipped as working in-app
destinations (user pastes their own public OAuth client ID / app key; browser
PKCE harness + same-origin `oauth-callback.html`). Box remains an honest
scaffold by design (confidential-secret token exchange).
**TODO:** S3 SigV4 signing.

## 2. All Due — Complete
- Shared deterministic ranking engine `computeDeadlineRank(item)` +
  `estimateItemEffortMinutes(item)`.
- `getStudentInboxItems` now annotates every item with `rankScore`,
  `rankReason`, `effortMinutes` and supports **sort modes**
  (`smart`/`due`/`urgency`/`importance`/`gradeRisk`/`effort`/`scheduled`/`source`)
  via the persisted `courseWorkspace.settings.studentInboxSort`.
- Rows show a one-line **"why it's ranked here"** reason; header has a **Sort**
  selector.
- New per-item actions: **start focus session**, **make review cards**,
  **open/create linked note** (`cwFocusInboxItem`, `cwReviewCardsForInboxItem`,
  `cwNoteForInboxItem`).
- `pickNextBestAction` (Today's **Next Step**) re-implemented on the same engine
  and keeps its one-sentence reason — the two never disagree.
- Tests: `tests/e2e/sutra-feature-wave.spec.mjs`. Docs:
  `docs/features/ALL_DUE_COMMAND_CENTER.md`.

## 3. Course Hub 2.0 — Partial
- `cwNextActionsHtml` upgraded to a deterministic **"Do this next"** card (top
  ranked item + reason, then the next few) using the shared engine.
- **TODO:** dedicated per-course **Deadlines** tab; explicit **weak-areas** model
  (e.g. low-mastery cards / missed rubric criteria per course); deeper **AP
  linkage** detail on the dashboard. Notes/decks/assignments already link by
  `classLinkId` / `courseWorkspace.relationships` / `courseId`.

## 4. Assistant Action Plans — Pre-existing harness + templates
The multi-action harness already exists: `window.SutraAssistantActions`
(`applyBatch`, `openActionReviewCenter` reviewable cards, apply-all/selected,
risk-gated confirm), the Activity log (`sutra:activityLog:v1`) with undo
(`UNDOABLE_TYPES`), context chips, and the AI send-disclosure gate
(`ensureAiSendDisclosure`).
- Added the five named **plan templates** (`PLAN_TEMPLATES` in
  `flow-assistant.js`): *Plan my week*, *Turn this note into review*, *Break down
  this assignment*, *Make an AP cram plan*, *Organize college application tasks* —
  injected into the contextual quick-action row by view. Each routes through the
  existing reviewable-card flow + activity log + undo.
- **TODO (optional):** an explicit ordered/sequential multi-step plan action type
  (`create_action_plan` with `steps[]`); today plans compose via batched and
  higher-level workflow actions rather than declared step sequencing.
- **Update 2026-07-02 — batch plan cards + receipts:** multi-action replies now
  render as one **"Proposed plan"** group with a live *"N of M applied"* count
  and a grouped **Undo all** button (`undoBatch(batchId)` in flow-assistant.js,
  exported on `window.flowAssistant`; also an **Undo batch** button per batch in
  the Activity modal). Every successful apply now renders a **receipt**
  (`buildReceiptEl`): what changed + created-object counts, a **deep link** to
  the affected surface (domain→view via `SutraCapabilityRegistry`, created notes
  open directly), and an **inline Undo** (the activity record id now returns
  through `applyActionLogged` as `result.activityId`). Verified in-browser on
  both apply paths; `student-os-phase1.spec.mjs` review-head assertion updated
  to the new title. The full **Weekly Review** build (grade ▲/▼ deltas +
  missing-score prompts, plan-health section via
  `SutraPlanningEngine.analyzeCurrent()` + "Repair my week", and
  estimates-vs-reality calibration notes) shipped the same day in
  `openWeeklyReviewModal`/`buildWeeklyReviewSummary` (app.js).

## 5. Smart Review Generator — Complete
- Deterministic extractor `sutraExtractReviewPairsFromHtml` (headings→body,
  `term: definition` lists, bold-term cloze) + `SutraReviewGenerator`
  (`fromNoteId` / `fromHomeworkTask` / `fromText` / `fromInboxItem`).
- Flows into the existing preview/edit table (`SutraReviewGen.openGenerator`);
  source backlinks ride existing card fields (no new persisted fields).
- Entry points: Notes page menu, Assignment Studio, All Due, Assistant.
- Tests + `docs/features/REVIEW_GENERATOR.md`.
- **Update 2026-07-07:** the two deterministic paths shipped.
  `SutraReviewGenerator.fromApUnit(unitId)` extracts Q/A pairs from the unit's
  linked note + every topic's linked note and scaffolds an answerless row per
  remaining topic ("Cards" button on each AP Study unit card).
  `SutraReviewGenerator.fromTestMistakes(examId)` turns every non-mastered
  Mistake-bank entry into a card (topic → correction; "Cards" button on the
  Mistake bank panel, `window.reviewCardsFromExamMistakes`). Both open the
  existing editable generator — nothing saves without review.

## 6. Assignment Studio 2.0 — Pre-existing + actions
`task.studio` already carries milestones, subtasks, rubric, linked notes/files,
effort, revisions, progress; milestones already surface in All Due / Timeline /
notifications via `getMilestoneDeadlines` → `collectWorkspaceDeadlines`.
- Added **Make focus plan** (schedule remaining milestones as focus blocks + start
  a focus session) and **Make review cards** (→ `SutraReviewGenerator`).
- **TODO:** richer in-studio note-link picker UI; effort→grade-planner signal.

## 7. College App Builder — Partial / mostly pre-existing
Already present: school tracker, essay organizer (essays open as linked notes via
`noteId`), score tracker, awards/honors, scholarships, decision matrices, visit
tracker, a deterministic per-school **readiness score**
(`getCollegeAppReadiness`), and college deadlines feeding Timeline/All Due via
`collectCollegeDeadlineItems`.
- **Update 2026-07-05:** structured **recommendation-request manager** shipped —
  `collegeAppWorkspace.recommenders` collection with a not_asked → requested →
  in_progress → submitted status board, feeding college deadlines. An **essay
  prompt bank** (13 paraphrased prompts) and an essay stage board also landed.
- **TODO:** dedicated **activities/extracurricular builder** (new
  `collegeAppWorkspace.activities` collection — wire through defaults → normalize
  → serialize → `.sutra` → migrations); Common App **templates** (activities,
  honors descriptions, why-major, why-school, additional-information); structured
  submission-readiness checklist rows.

## 8. Import Everything Wizard — Partial / mostly pre-existing
Smart Import already parses text / CSV / ICS / syllabus deterministically, shows
confidence + a review screen, supports duplicate detection, undo-last-import, and
logs to Activity. Targets today: homework, tasks, timeline, notes, review.
- **Update 2026-07-01:** Smart Import now targets **Grade Planner** (syllabus
  weight lines like "Homework 20%" → `grade category` proposals, applied via
  `SutraGradePlanner`) and **School Schedule** ("Chemistry MWF 9:00-9:50am" →
  `schedule period` proposals with weekday templates + course assignment;
  refuses to touch an existing A/B rotation). Courses were already a target
  (`class`). Both new types are covered by undo-last-import. Separately, the
  Homework paste importer gained an LMS path: Canvas assignment-page pastes
  (title + "Due …" pairing), a `#sutra-import` bookmarklet format that keeps a
  source URL per assignment (`task.sourceUrl`, shown as a Source link on
  cards), and title+due duplicate detection with pre-checked Skip.
- **TODO:** **JSON workspace-fragment** import (validated, allow-listed fields
  only); remaining mapping targets: AP Study, **College**; "manual course
  setup" step. Parsers to reuse: `parseIcsEvents`, `parseAssignmentText`.

## 9. Workspace Time Machine — Partial
Per-page version history is mature (20/page, throttled, "Before restore"
checkpoint, secret-safe, single-note restore, `check:versions` invariants). See
`docs/features/WORKSPACE_TIME_MACHINE.md`.
- **Update 2026-07-01:** the Trash now also holds deleted **planner tasks** and
  **homework assignments** (including all rows of a deleted subject), not just
  pages — restore/purge from the same Trash modal, with 30-day age-based
  auto-purge on top of the 50-item cap. Producer API: `window.SutraTrash.add`.
- **Update 2026-07-07:** the whole-workspace **snapshot browser** is live
  (command palette → "Workspace snapshots": create/restore/delete up to 3
  restore points with a count-level **diff** against the current workspace),
  and **single-note-from-snapshot restore** shipped — "Notes…" lists a
  snapshot's pages and restores any one as a non-destructive copy.
- **TODO:** per-note textual **compare/diff** view; **Storage Health** cleanup
  settings (snapshot cap / age trim) on top of the existing
  `navigator.storage.estimate()` readout.

## 10. Starter Packs — Complete
Local data (`src/features/workspace/starter-packs.data.js`,
`window.SUTRA_STARTER_PACKS`, 9 packs) + controller `window.SutraStarterPacks`
(`list`/`apply`/`undo`) with a preview-then-apply modal (apply all / apply
selected / cancel), per-batch **undo**, and custom-pack import/export
(device-local). Reuses existing create functions, so everything round-trips.
Entry points: Settings → Integrations, All Due empty state. Tests +
`docs/features/STARTER_PACKS.md`.

---

## Checks run (all green)
`npm run check:all` (syntax, app-shell, migrations, smoke, round-trip, versions,
rebrand, compat, csp, persistence, modal, network, encoding, responsive, brand,
docbg, academic, sw, guardrails self-test, guardrails, links) + the new
`tests/e2e/sutra-feature-wave.spec.mjs` (chromium). Guardrail baseline updated for
the intentional new globals.
