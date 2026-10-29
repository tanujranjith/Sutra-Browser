# Planning & Assistant upgrades

Three improvements to how Sutra plans your time and what the Assistant can do
without an API key. All deterministic and local-first.

## 1. Keyless local commands (no API key)

The Assistant already runs a set of **deterministic local commands** with no
provider key — daily briefing, overdue triage, grade math, recovery plans, plan
repair, and task commands. This wave connects the **auto study planner** to that
keyless surface:

- Type **"plan my week"**, **"build a study plan"**, or **"schedule my work"** (or
  use the **Build study plan** quick action on Homework) and Sutra opens an
  approve-block-by-block plan preview — **without any API key**.
- Free-form model Q&A still needs a provider key; these planning/briefing/grade
  commands do not.

## 2. Exam- & deadline-aware auto study planner (reverse scheduling)

The planning engine (`src/features/academic/planning-engine.js`) now:

- **Spreads work across days (anti-clustering).** A multi-session item fans out
  across the free days before its due date instead of piling into the earliest
  slots. Controlled by the `spread` preference (on by default).
- **Reverse-schedules study before exams.** `expandExamPrep()` turns each upcoming
  exam into session-sized study chunks (more sessions for more runway / lower
  confidence) that the planner distributes across the days *before* the exam.

It continues to respect your free windows (classes and existing timeline blocks
are avoided), per-day block caps, buffers between blocks, and due-time caps — and
still writes nothing until you approve each block.

## 3. Daily digest + smart nudges

The daily digest (Notifications → enable "Daily digest") now adds **smart nudges**
from the local intelligence layer alongside the overdue/due-today counts:

- review backlog ("N review cards to clear"),
- unscheduled high-priority work,
- a weak focus area (lowest-confidence AP subject).

It still respects quiet hours and shows at most once per day.

## Verification

- `scripts/sutra-academic-engines-check.mjs` (`npm run check:academic`) unit-checks
  spread (distinct days) and `expandExamPrep` (session chunks, all before the exam).
- `tests/e2e/planning-assistant-upgrades.spec.mjs` verifies the engine + keyless
  planner entry points in the browser.
