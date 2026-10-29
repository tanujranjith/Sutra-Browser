# Timeline Calendar

Timeline is Sutra's local, canonical schedule surface. It renders the existing
`timeBlocks` collection; it does not own a second event store.

## Calendar views

- **Month** is a continuous seven-column local-date grid with adjacent-month
  dates, compact event rows, and a `+N more` path into the focused Day view.
  On phones, event rows become legible count indicators and the full day cell
  opens the focused Day view; creation remains available through **+ Block**.
- **Week** and **Day** use the same vertical time-grid primitive. Blocks are
  positioned from their existing `start` and `end` fields, and simultaneous
  blocks receive deterministic side-by-side lanes.
- **Planner** remains the deliberate execution-board view for task context and
  daily planning.

The date field remains the centered-date compatibility control. Today, previous,
and next navigation keep their local date semantics: Day moves one day, Week
moves seven days, and Month moves one calendar month.

## Fast calendar controls

When the calendar itself has focus, its keyboard controls keep planning fast
without creating another scheduler or bypassing the canonical block modal:

- **Left/Right** or **[/]** move by the visible view's natural step.
- **T** returns to today; **D**, **W**, and **M** select Day, Week, or Month.
- **N** opens the established block form at the next local 45-minute opening
  on the focused date (falling back to 9:00 AM when the displayed day is full).
- **?** announces the available shortcuts for screen-reader users.

Text fields, selects, and buttons retain their normal keyboard behavior. The
calendar's live status area announces navigation and creation intent; it does
not persist any additional UI state.

## Scheduling contracts

The calendar keeps the existing `window.SutraTimelineDrag` contract intact:

- Time-grid day columns remain `.timeline-drop-zone` elements with
  `data-drop-date`.
- Hour rows remain `.timeline-hour-row` elements, so canonical 15-minute drag
  placement continues to use rendered row height.
- Event controls preserve `data-block-id` and `data-block-name` for editing and
  drag rescheduling.
- Coarse-pointer devices do not mark event controls as draggable. A tap opens
  the same canonical edit form, avoiding accidental drags while scrolling.

Creation, edit, delete, conflict detection, undo, linked Homework/Task source
identity, persistence rollback, and `sutra:schedule-changed` remain owned by
the existing Timeline adapter and app runtime.

## iCalendar import

**More > Import calendar (.ics)** and **Settings > Packs & advanced > Calendar
data files** use the same local parser and mandatory preview. No calendar text
is uploaded. Common `VEVENT` fields map into canonical `timeBlocks`, including
`TZID`/UTC/floating timestamps, `DTEND` or `DURATION`, all-day and multi-day
events, location, description, safe HTTP(S) URLs, categories, colors, and the
supported daily/weekly recurrence subset. `EXDATE`, finite `COUNT`, `UNTIL`,
`RDATE`, and moved instances identified by `RECURRENCE-ID` are retained where
the Timeline model can represent them. Unsupported recurrence intervals or
frequencies import once and produce a review warning instead of silently
creating an inaccurate repeating schedule.

Each file is source-scoped by its filename and each event is keyed by calendar
UID plus recurrence identity. Re-importing the same filename updates that
calendar and removes events that disappeared from that file only; it cannot
delete blocks imported from a different `.ics` file. A valid preview must be
approved before changes are applied, and persistence failure restores the
complete prior Timeline state. Imported calendar entries remain visible as
schedule context, but do not create Sutra notification-center reminders or
overdue alerts. By default, only the most recent five local calendar days of
an imported file can enter Today, All Due, Recovery, or the upcoming radar;
older events remain Timeline history. Manually created Timeline blocks retain
their existing reminder behavior. An overdue Timeline block can be marked
complete from Today → Recover; it remains visible in Timeline with its
completion state, but leaves deadline-driven surfaces.

## Push time

**More > Push time** moves every canonical Timeline block forward or backward
by one shared minute or hour offset. The dialog previews the affected count and
sample before/after times before applying the change. The operation preserves
block duration, source links, colors, notes, and unknown compatibility fields,
then flushes the complete change through canonical workspace persistence.

Push time is all-or-nothing: if any block has invalid timing, lacks a date when
a day change is required, or would span midnight, no blocks move. Whole blocks
may move to an adjacent date, including the corresponding recurrence weekday.
The latest successful Push time operation can be undone from the Timeline More
menu during the current browser session; the undo is persisted atomically too.
The maximum shift is seven days.

## Data and privacy

This is a rendering and interaction change only. No schema, migration,
IndexedDB, localStorage, export/import, cloud-sync, or backup format changed.
Timeline stays local-first and makes no network request to render a calendar.
