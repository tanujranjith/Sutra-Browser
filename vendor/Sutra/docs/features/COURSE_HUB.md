# Course Hub

The Course Hub is the central dashboard for each class. A course carries its
metadata (teacher, room, schedule periods, color, term), grade categories, files,
linked notes, linked review decks, and its assignments (which live in the
Homework store and are bridged by `courseId`, never duplicated).

## Course dashboard tabs

`Overview`, `Assignments`, `Files`, `Notes`, `Study` (linked review decks),
`Calendar` (meeting periods), `Grades` (Grade Planner data), `Settings`
(teacher/contact, schedule, grade categories).

## What should I do next? (deterministic)

The **Overview** tab shows a deterministic *"Do this next"* card for the course:
the single highest-ranked item — pulled from the course's assignments, milestones,
review due, grade risk, and upcoming tests — with a one-line reason for why it's
on top, followed by the next few. It uses the same ranking engine as
[All Due](ALL_DUE_COMMAND_CENTER.md), so the recommendation is stable and
reproducible (no model call).

## Links (no duplication)

- **Notes** link to a course via the page's `classLinkId`; the course keeps a
  relationship record. Note content is never copied into the course.
- **Review decks** link via `courseWorkspace.relationships` (`entityType:
  'reviewDeck'`). Create one from the Study tab.
- **Assignments / Assignment Studio milestones** attach by `courseId` and surface
  in the course's upcoming deadlines and in All Due.

## Entry points

Open a course from Homework, All Due (course rows), the Course Hub list, linked
notes, and global search.

From Homework, the class/activity row and its dashboard both expose a confirmed
Remove action. Linked assignments are removed atomically with the lane and
placed in shared Trash so the workspace does not keep a stale Homework mirror
or silently recreate the removed class/activity.

## Persistence

The course object and its relationships live in `courseWorkspace`, a top-level
workspace field that round-trips through `.sutra`. File bytes live in an isolated
IndexedDB (`noteflow_attachments_db`) keyed by `blobKey`; only metadata is in
`courseWorkspace.files`.

## Status / follow-ups

Present today: the eight dashboard tabs, note/deck/assignment links, grade
forecast, schedule periods, teacher/contact, and the deterministic next-action
card. Tracked follow-ups (see `docs/FEATURE_WAVE_PROGRESS.md`): a dedicated
per-course Deadlines tab, an explicit "weak areas" model, and richer AP linkage
detail.
