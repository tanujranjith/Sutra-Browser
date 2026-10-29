# Canvas And Timed Habits

This note documents the June 2026 Sutra hardening pass for first-class Canvas
pages and timed daily commitments.

## Canvas Architecture

Canvas pages are normal Notes-tree pages with `type: "canvas"`. They keep their
state in the existing page record:

```json
{
  "id": "page_id",
  "title": "Essay Brainstorm",
  "type": "canvas",
  "spaceId": "space_id",
  "canvas": {
    "version": 1,
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "background": "grid",
    "snapToGrid": true,
    "gridVisible": true,
    "objects": [],
    "connections": [],
    "groups": []
  }
}
```

Objects, connections, groups, pinned-page references, linked Sutra note cards,
and Assistant context all use stable IDs. Canvas state is normalized during page
hydration and travels through local persistence plus `.sutra` export/restore
because it lives in `appData.pages`.

The renderer is a local structured DOM/SVG layer rather than a bundled canvas
SDK. That keeps Sutra static-file compatible, avoids remote dependencies, and
lets the app reuse existing page, space, pinning, search, export, restore, theme,
Assistant, and modal systems.

## Workbench editing

The Canvas workbench now provides marquee and grouped selection, keyboard
nudging, internal copy/paste that preserves connections and complete groups,
alignment, distribution, tidy-grid layout, layer ordering, explicit object
locking, and 16-pixel snapping. Locked objects remain selectable so they can be
unlocked, but cannot be moved, resized, deleted, arranged, or nudged while
locked. Selection and clipboard state remain editor-session data; they are not
written into the durable page model.

Viewport navigation includes cursor-centered wheel zoom, trackpad pan, fit all,
fit selection, a clickable minimap, and a compact live board status. These use
the pure geometry helpers in `src/features/workspace/canvas-workbench.js` while
the adapter in `src/core/app.js` owns canonical saves, undo snapshots, and page
rendering. Background and snap controls continue to modify the existing Canvas
model rather than introducing a second preferences store.

Keyboard behavior while Canvas is active:

- `Ctrl/Cmd+A`, `C`, `V`, and `D` select, copy, paste, and duplicate.
- Arrow keys nudge by one pixel; Shift+Arrow nudges by ten.
- `Ctrl/Cmd+G` groups and `Ctrl/Cmd+Shift+G` ungroups.
- `V`, `H`, and `P` select the pointer, hand, and pen tools.
- `F` fits all content; `Shift+F` fits the selection; `0` resets the viewport.
- Space temporarily activates hand panning without changing the chosen tool.

## Product Research

Reviewed official/current primary sources:

- Apple Freeform support for diagrams and connector behavior:
  https://support.apple.com/en-ca/guide/ipad/ipad06d8aa1d/ipados
- Obsidian Canvas help and JSON Canvas:
  https://obsidian.md/help/plugins/canvas
  https://jsoncanvas.org/
- Microsoft Whiteboard support:
  https://support.microsoft.com/en-us/whiteboard/getting-started-with-microsoft-whiteboard
- Miro Help Center shortcuts and embeds:
  https://help.miro.com/hc/en-us/articles/360017731033-Shortcuts-and-hotkeys
  https://help.miro.com/hc/en-us/articles/360017730993-Embed-integrations-on-a-Miro-board
- Excalidraw project/docs:
  https://github.com/excalidraw/excalidraw
  https://excalidraw-excalidraw.mintlify.app/guides/export
- tldraw persistence and assets docs:
  https://tldraw.dev/docs/persistence
  https://tldraw.dev/sdk-features/assets

Adopted patterns:

- Open spatial workspace with pan, zoom, zoom reset, and viewport persistence.
- Compact tool strip for selection, pan, pen, text, sticky notes, shapes,
  connectors, tables, linked Sutra notes, undo, redo, and zoom controls.
- Structured objects with stable IDs, explicit geometry, and separate connector
  records.
- Link cards for existing Sutra content rather than duplicating note bodies.
- Bounded Assistant context that includes visible text/card metadata without
  dumping unlimited Canvas content.
- Local JSON-style persistence with migration-safe defaults.
- Local export controls for PNG, a practical single-page PDF rendition, and a
  Sutra-specific JSON model export.

Excluded for this pass:

- Real-time collaboration, presence, share links, and remote embeds.
- Heavy SDK bundling or remote CDN loading.
- Full JSON Canvas import/export parity.
- Advanced plugin-level object schemas, custom shape SDKs, and server-backed
  asset stores.

Those exclusions fit Sutra's local-first static architecture and avoid adding
opaque dependencies or network requirements.

## Assistant operations

The Assistant can create a Canvas through `canvas_create_board` and can apply a
bounded batch to the current unlocked board through `canvas_edit_board`. A batch
may add safe local text, sticky, shape, frame, or table objects; update existing
objects; arrange them in a row, column, or grid; connect or group them; and change
the board background. New objects may use short action-local `clientId` values so
later operations in the same reviewed batch can connect or group them without
inventing durable IDs.

The pure operation engine is
`src/features/workspace/surface-assistant-actions.js`; `window.SutraCanvas`
adapts its result to the canonical page save/render path. Validation completes
before the live page changes, the whole batch commits atomically, and Activity
stores a field-level undo patch. Undo refuses to overwrite a touched object that
changed again after the Assistant edit. Locked pages and locked Canvas objects
remain outside the mutation boundary.

## Timed Daily Commitments

Timed commitments extend the existing habit tracker with `type: "timed"` and
fields for target duration, schedule, reminder times, completion history, and
streak evaluation. Starting a timer never completes the habit. The user must
confirm completion for the local calendar date; duplicate confirmations are
blocked, future dates are rejected by the local-date gate, unscheduled days are
ignored, and missed scheduled days reset the streak once.

Habit summaries and display reads do not create missing day records. They read
existing completion state without changing it, so merely rendering Home cannot
add empty records and change Sync parity. Habit mutations retain their existing
canonical save and normalization path.

Timed reminders are derived through the existing notification center as
`source: "timedHabit"` notifications and respect read/dismissed state.
