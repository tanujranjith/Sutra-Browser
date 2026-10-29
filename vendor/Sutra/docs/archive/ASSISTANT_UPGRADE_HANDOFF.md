# Sutra Assistant Upgrade — Handoff Report (2026-06-10)

End-to-end upgrade of Sutra Assistant: cross-workspace action harness, panel
redesign to the new mockup, deterministic daily briefing + recovery planning,
grade-aware Q&A, conversational reference resolution, API-key onboarding,
expanded in-app guide, persistence/privacy hardening, and regression coverage.

---

## 1. Implementation summary

The most important change: **the Assistant can now take real, reviewable
actions on existing workspace objects.** "What's overdue?" → "mark those as
complete" works end to end: a deterministic local listing primes reference
memory, the resolver maps "those" to concrete task refs across BOTH task
stores, a readable batch review card requests approval, the apply path mutates
the authoritative stores, refreshes every dependent surface, logs a reversible
Activity record with an exact-state undo payload, and "undo that" restores
everything. No model call is needed for any of it.

The panel was rebuilt to the redesign mockup: dynamic header subtitle +
overflow menu, WORKING FROM context card, per-view "What would you like to
do?" 2×2 grid, a Workspace Pulse card driven only by real
`deriveStudentContext()` signals, attachment chips above an elevated composer
with provider/context chips, and a key-onboarding card when no provider is
configured.

## 2. Feature checklist

| Area | Status |
|---|---|
| Centralized action registry (`window.SutraAssistantActions`) | ✅ |
| `update_task_status` complete/reopen/archive across planner + homework stores | ✅ |
| `reschedule_tasks`, `change_task_priority` | ✅ |
| Timeline `update/move/delete_timeline_block` with undo | ✅ |
| Notes `append_note_text`, `create_note_from_response` (undoable) | ✅ |
| `create_recovery_plan`, `schedule_review_session` | ✅ |
| Read-only grade actions (what-if, target solve, impact rank, risk explain) | ✅ |
| Reference resolver ("those", "all four", "first two", "the Chemistry one", "tomorrow's items") | ✅ |
| Ambiguity → clarifying question, never a guess | ✅ |
| Readable previews (what/where/why/undo/risk/conflicts); JSON under "Technical details" | ✅ |
| Activity records with risk, approval, affected ids, undo payload, source chat id | ✅ |
| State-restoring Undo (task status/dates/priority, block edits/deletes, note appends) | ✅ |
| "undo that" chat command | ✅ |
| Panel redesign (header/subtitle/overflow/working-from/grid/pulse/composer) | ✅ |
| Launcher hidden while panel open | ✅ |
| Deterministic daily briefing ("what should I do today") + plan_day proposal | ✅ |
| Recovery plan builder ("catch me up", "make a recovery plan") | ✅ |
| Schedule-conflict scan command | ✅ |
| Grade Q&A via natural language (deterministic local math) | ✅ |
| Planning preferences (latest time, block/break length, weekends, proactivity) | ✅ |
| Context editor: readable payload summary + depth/memory/selection/planning controls | ✅ |
| API-key onboarding card + central `SutraProviderMeta` registry | ✅ |
| "Continue without AI" path (local tools stay available) | ✅ |
| Expanded 9-section Assistant guide (provider rows from shared registry) | ✅ |
| Persistence schema for new prefs (+ export/restore parity) | ✅ |
| Homework mirror-task dedup in Assistant + Intelligence layers | ✅ (bug fix) |
| Local-timezone date handling in Assistant date math | ✅ (bug fix) |
| Regression spec (9 tests) + updated stale assertions | ✅ |

Deliberately **not** implemented (documented limitations, no fake buttons):
habit actions, pin/space organization actions, Testing Hub quiz creation as a
direct chat action (the existing Study Materials generator owns that pipeline),
School Schedule mutations from chat, model presets UI, chat search/pinning/
course-linking, and Semester Setup chat entry points beyond the existing
wizard/Smart Import. See §10.

## 3. Files created

- `src/…` — none (extended existing modules per "extend, don't duplicate")
- `tests/e2e/assistant-action-harness.spec.mjs` — 9 regression tests
- `scripts/qa-assistant-screens.mjs` — manual-QA screenshot capture
- `docs/ASSISTANT_UPGRADE_HANDOFF.md` — this report

## 4. Files modified

- `src/features/flow-assistant.js` (3,156 → ~5,300 lines): catalog +
  appliers + resolver + previews + briefing/recovery + grade helpers + empty
  state/pulse/onboarding renderers + `SutraAssistantActions` facade
- `src/features/flow-intelligence.js`: homework-mirror dedup in `liveTasks()`
- `src/core/app.js`: `noteAssistantReply` hook in `appendMessage`, launcher
  hide + `refresh()` in `toggleChat`, `SutraProviderMeta`, expanded guide,
  preference schema (`assistant.planning`, `assistant.onboarding`), composer
  placeholder, key-banner suppression, fullscreen menu label
- `Sutra.html`: header (subtitle + overflow menu), composer (attach button +
  meta row), redesign CSS (~340 lines, theme-token driven)
- `scripts/smoke-check.mjs`: composer-placeholder assertion updated
- `scripts/sutra-network-check.mjs`: two provider docs URLs allowlisted
  (anchor links only)
- `tests/e2e/assistant-response-boundary.spec.mjs`: deterministic
  stream-completion wait (was racy against the streaming animation)
- `tests/e2e/encoding-and-symbols.spec.mjs`: brand-line anchors updated to the
  redesigned surfaces
- `docs/SUTRA_ASSISTANT.md`: new §14 documenting the harness

## 5. New global APIs

- `window.SutraAssistantActions` — `registerAction, getActionDefinition,
  listActions, validateAction, validateBatch, resolveReferences, classifyRisk,
  buildPreview, applyAction, applyBatch, undoAction, getUndoSupport,
  logActivity, getActivityLog, riskLevels`
- `window.SutraProviderMeta` — `list(), hasKey(p), hasAnyKey(),
  openKeySettings(p)` (booleans/metadata only; never key material)
- `window.flowAssistant` additions — `noteAssistantReply, resolveTargetPhrase,
  buildOverdueListMessage, buildDailyBriefing(+Message),
  buildRecoveryPlanMessage, buildReadableContextSummary, buildPreviewHtml,
  renderAssistantEmptyState, updateHeaderSubtitle, listOpenWorkspaceTasks`
- Preserved: `window.sutraAssistant`, `window.flowAssistant`,
  `window.getFlowAssistantContext`, `window.getSutraAssistantContext`

## 6. Registered action types (54)

Existing 41 retained. New: `update_task_status` (+aliases `complete_task(s)`,
`reopen_task(s)`, `archive_task(s)`, `mark_task(s)_complete`),
`reschedule_tasks` (+aliases `reschedule_task`, `set_task_due_date`,
`move_task`), `change_task_priority`, `update_timeline_block`
(+`move_timeline_block`), `delete_timeline_block`, `append_note_text`,
`create_note_from_response`, `create_recovery_plan`
(+`apply_recovery_schedule`, `create_catch_up_plan`),
`schedule_review_session`, `run_grade_what_if`, `solve_target_grade`,
`rank_missing_work_by_grade_impact`, `explain_grade_risk`. Spec aliases
normalize to existing types: `create_note→create_page`,
`rebalance_day/create_day_plan→plan_day`,
`rebalance_week/create_week_plan/schedule_open_tasks→plan_week`,
`schedule_study_block→create_timeline_block`,
`create_review_card→add_review_cards`, etc.

## 7. Risk policy

- `read_only` — runs immediately, renders local result, zero mutation (grade
  helpers).
- `low` — one clearly identified object (create note/task/card/block; complete
  or reopen ONE task; single priority change). Auto-apply only under the
  pre-existing `auto_low` confirmation mode, never in batches.
- `medium` — multi-task status changes, reschedules (always), decks,
  milestones, imports, multi-block plans, timeline edits. Preview + approval.
- `high` — `delete_timeline_block`, `replace_selection`, recovery plans, bulk
  workflows, course archive. Always explicit approval; auto-apply impossible.
- Invariants: no model output bypasses `validateAction`; multi-object batches
  always require approval; there is **no task-delete action**; archiving
  homework is rejected; archiving planner tasks preserves the object
  (`archived: true`, `isActive: false`).

## 8. Undo support matrix

| Action family | Undo | Mechanism |
|---|---|---|
| update_task_status / reschedule_tasks / change_task_priority | ✅ | `undoPayload {kind:'task_state'}` restores exact prior fields in both stores |
| delete_timeline_block | ✅ | full block snapshot re-inserted |
| update_timeline_block | ✅ | prior date/start/end/name restored |
| append_note_text / insert_text / replace_selection | ✅ | page content/body snapshot |
| create_* (task/homework/page/block/deck/plans/imports) | ✅ | created-object deletion (pre-existing) |
| navigate / open_* / start_focus / read-only grade actions | ❌ | "Undo is not available for this action." (nothing to revert) |

## 9. Provider registry / keys / privacy

- `SutraProviderMeta.list()` is the single metadata source (labels,
  descriptions, key dashboard + docs URLs, requiresKey) feeding the onboarding
  card and guide §4; only implemented providers are listed.
- Keys remain **session-only** (`sessionStorage`, legacy localStorage values
  migrated then removed — pre-existing mechanism, unchanged). `hasKey`
  returns booleans only. Keys are never rendered, exported, logged, or placed
  in prompts; the JSON/.sutra export paths and round-trip check are unchanged
  and re-verified (automated test asserts a seeded fake key is absent from
  `serializeWorkspace` output).
- The deterministic command layer (overdue, briefing, recovery, grade math,
  status changes, undo) performs **zero network requests** — asserted by a
  route-interception test.

## 10. New preferences & persisted state

- `assistant.planning.{latestWorkTime, blockMinutes, breakMinutes, weekends,
  gradeImpactFirst, includeReviewDebt, proactivity}` and
  `assistant.onboarding.continueWithoutAi` — added to BOTH the preference
  defaults and `normalizeWorkspacePreferences` (the normalizer drops unknown
  keys, so schema registration is required). They persist via
  `appSettings.preferences`, ride `.sutra`/JSON exports, and normalize on
  restore like every other preference.
- Activity records gained `undoPayload`, `affected`, `risk`, `approved`,
  `sourceChatId` fields in `sutra:activityLog:v1` (already included in
  exports/restore; verified by test).
- Migration: none required — new fields default safely; old activity records
  without `undoPayload` keep their previous undo behavior.

## 11. Known limitations

- Habits, note pinning, spaces, School Schedule edits, Testing Hub quiz
  creation, College application plans, and Semester Setup imports are NOT
  chat actions; the existing dedicated UIs own those flows (Study Materials
  generator for quizzes, Semester Setup wizard, Smart Import). The system
  prompt does not advertise them.
- Model presets (Phase 9) and chat search/pinning/course-linking (Phase 10)
  were not implemented; the existing provider/model picker and history panel
  are unchanged.
- Proactivity preference is stored and editable but only the briefing/pulse
  consume it; no background prompt scheduler was added (and no background
  model calls, by design).
- "Rebalance Tuesday"-style requests route to the model (`plan_day` proposal)
  rather than a local rebalancer.
- Reference memory is in-session (module state); after a reload, "those"
  requires re-asking "what's overdue?" first — the clarification message
  explains this.
- Full multi-browser e2e (firefox/webkit) was not run; chromium + responsive
  projects were (see §12). The repo's known Windows batch flakiness applies
  (two modal-focus tests can fail under heavy sequential load but pass
  standalone/batched).

## 12. Commands run & outcomes (final state)

- `npm run check:all` — **passed** (all 15 check scripts: syntax across 103 JS
  files, smoke, round-trip, version-history, rebrand, compat, CSP,
  persistence-health, modal-a11y, network, encoding, responsive, brand,
  docbg, academic engines).
- `npm run build:deploy` — **passed** (79 files, 11.29 MB staged).
- `npm run check:deploy` — **passed**.
- `npx playwright test tests/e2e/assistant-action-harness.spec.mjs
  --project=chromium` — **9/9 passed** (final run after all polish changes).
- `npx playwright test --project=chromium --project=mobile-chromium
  --project=tablet --project=narrow-desktop` (full suite, 149 tests) —
  **145 passed, 3 skipped, 1 failed** (`encrypted-backups.spec.mjs:196`); that
  spec then **passed 7/7 standalone**, matching the repo's documented
  Windows full-batch flakiness (two other tests showed the same
  fail-in-batch / pass-standalone pattern during development and also passed
  in smaller batches).
- Firefox/webkit projects were not run in this session.

## 13. Manual QA & screenshots

Browser QA was performed live (preview server): clean workspace boot, panel
open without key (onboarding card), overdue listing, "mark those as complete"
batch approval, store verification, undo, "complete the first two", ambiguity
clarification, "move my overdue work to tomorrow", archive guardrails, daily
briefing, recovery plan, grade what-if/rank/target, timeline
create/update/delete/undo, note append/undo, note-from-response, overflow
menu, composer disabled/enabled states, provider popover from composer chip,
key-banner suppression, zero console errors.

Screenshots: `.tmp/assistant-qa-screens/01…18` (empty-state onboarding,
working-from + grid, pulse, overdue conversation, completion proposal,
applied, activity+undo, context editor, briefing, grade what-if, reschedule,
recovery plan, attachment chips incl. blocked archive, guide, overflow menu,
study-material generator, dark theme, mobile layout).

## 14. Readiness

Ready for beta. The core product change — transparent, validated,
approval-based workspace actions with working undo — is implemented through
the authoritative stores, covered by automated regression tests, and verified
in-browser. Remaining phases above are scoped and documented, not silently
half-shipped.
