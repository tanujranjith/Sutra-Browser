# All Due — Command Center

**All Due** (also surfaced as the Student Inbox) is one cross-workspace command
center for everything with a deadline or that needs attention: tasks, homework,
assignment milestones, AP exams/sessions, review due cards, college deadlines,
timeline blocks, work/project deadlines, and workspace signals (overloaded days,
conflicts, stale notes, review debt).

It reuses one **deterministic ranking engine** — no model call decides ordering.

## Filters

`All`, `Overdue`, `Today`, `This Week`, `High Risk`, `Unscheduled`, `Review`,
`AP`, `College`, `Course`, `Timeline`.

## Sort modes

A **Sort** selector controls ordering (persisted per workspace):

| Mode | Orders by |
|---|---|
| **Smart** (default) | the shared rank score (due proximity + priority + grade risk + type + unscheduled) |
| **Due date** | soonest due first |
| **Urgency** | urgency level, then due |
| **Importance** | task priority, then due |
| **Grade risk** | risk score, then due |
| **Effort** | estimated minutes (lightest first), then due |
| **Unscheduled first** | items not yet on the Timeline first |
| **Source** | grouped by source |

## Why it's ranked here

Every row shows a one-line **reason** for its placement — e.g. *"Overdue and high
priority"*, *"Exam in 3 days"*, *"Due today with high grade risk"*,
*"High priority and not scheduled yet"*. The same engine powers the Today
**Next Step** card, which explains its single pick in one sentence, so the two
never disagree.

## Per-item actions

- **Open source** — jump to the homework/task/AP/college/note it came from
- **Schedule this** — drop it onto the Timeline
- **Start focus session** — begin a focus timer seeded with the item
- **Make review cards** — open the Review Generator seeded with the item (or its
  linked note)
- **Open/create linked note** — open the item's note, or create one linked to it
- **Mark done** / **Defer** — for mutable items (homework, tasks, milestones)

## How ranking works (deterministic)

`computeDeadlineRank(item)` returns a score and a reason from:

- **Due proximity** — overdue (scaled by days) > due today > tomorrow > this week > later
- **Priority** — high adds, low subtracts
- **Grade risk** — high `riskScore` adds
- **Type** — exams/finals and major projects/essays add weight
- **Unscheduled** — important work not yet on the Timeline gets a nudge

Because it is a pure function of the data, the order is stable and reproducible.
AI can *explain* or *help*, but it never decides the ranking.

## Developer surface

`window.courseHub.getStudentInboxItems({ filter, courseId, search, sort })` returns
items annotated with `rankScore`, `rankReason`, and `effortMinutes`.
