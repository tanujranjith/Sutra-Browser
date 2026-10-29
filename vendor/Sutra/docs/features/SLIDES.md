# Slides mode

Slides is a local Create surface for building short class presentations without
leaving Sutra. A Slides deck belongs to one normal Note page and is selected
from the New Page dialog. The deck lives at `page.slides`, which deliberately
keeps ordinary note content and unknown page fields intact.

## Durable model

`page.slides` normalizes to version 2 while retaining V1 and unknown-field compatibility. It contains the deck-wide `theme`,
`size`, and ordered `slides` list. Every slide and element has a stable local
ID. Elements use normalized percentage geometry and support text, basic shapes,
tables, inline local images, and simple charts. Speaker notes are stored on the slide.

The current interaction state—selected slide, selected element, inspector
visibility, and presenter position—is session-only. It is never persisted, so
opening a deck does not cause Sync churn.

## Workbench editing

The editor includes session-scoped undo/redo, direct drag and resize for text,
shapes, tables, charts, and local images, plus a selection inspector for text size,
weight, text alignment, image fit/crop-to-fill, text color, fill, layer order, copy, duplicate, and delete. Arrow keys
nudge the selected object; Shift increases the movement. `Ctrl/Cmd+C`, `V`,
`D`, `Z`, and `Y` copy, paste, duplicate, undo, and redo. Page Up/Down and the
toolbar reorder the active slide. Objects snap to slide edges and centers while
dragging, and the inspector can align a selected object to any slide edge or
center line. Table cells edit directly on the slide.

These interactions mutate only the owning `page.slides` record through the
canonical workspace bridge. Undo and clipboard data remain editor-session state
and do not become durable fields. Presentation mode uses read-only elements,
supports keyboard navigation, and lets a presenter toggle speaker notes with
`N`.

## Local-first behavior

The deck mutates its owning page through the canonical `flowAtelier.pages`
bridge and schedules the normal `persistAppData` save path. Ordinary slide
edits must never invoke whole-workspace serialize/import or restore behavior.
As a result, deck text, themes, layouts, notes, and inline image data
participate in normal reload, encrypted `.sutra` export/import, duplication,
and workspace Sync without a Slides-specific server or network request.

When Slides is the active Note page, Sutra Assistant receives a bounded local
deck context: slide titles, text/shape labels, chart labels and values, and
speaker notes. Locked pages remain excluded. Sync transports the complete
`pages[].slides` record with the existing page conflict handling, so slide
changes and inline image data use the same encrypted, deterministic path as
other Note content.

Slides uses only local image files chosen by the student. V1 stores those image
bytes in the page model so existing workspace backup and Sync transport retain
them. Moving those bytes to the course attachment store is a follow-up needed
before very large decks should be encouraged.

## Exports and presenter

The Design inspector opens browser printing for PDF output; it preserves slide
order and sets a landscape page size. The presenter uses the full viewport,
speaker notes, arrow/space navigation, and Escape to exit.

The PPTX command creates a standards-shaped, local PowerPoint package with a
presentation part, slide master and layout, theme, slide relationships, DrawingML
text and shapes, local image media, table content, and rendered chart bars. Sutra
also stores a private lossless deck part in the package so a PPTX exported by
Sutra can be re-imported without flattening its editable objects. Standard PPTX
files import text and basic positioning; complex themes, SmartArt, transitions,
animations, and unsupported PowerPoint objects are listed in an import warning
instead of being silently discarded. No PPTX path makes a network request.

PPTX remains an interoperability format rather than a backup. Use encrypted
`.sutra` export when the complete workspace and its history must be preserved.

## Public bridge

`window.SutraSlides` is the namespaced integration seam. It provides page
creation, current-deck lookup, add-slide, presenter launch, and local import/export
commands. No remote API or unscoped global is introduced.

The bridge also exposes the reviewed Assistant seam. `slides_create_deck`
creates a local deck from bounded slide specifications, while
`slides_edit_deck` applies up to 24 operations to the current unlocked deck.
Supported operations add or update slides, speaker notes, local text, shapes,
and charts; arrange elements; reorder slides; and change theme or size. The
Assistant cannot create or alter image elements and never accepts a remote image
URL or performs a network fetch.

Operations are validated by the pure
`src/features/workspace/surface-assistant-actions.js` engine before the page is
mutated. A batch commits through the normal page save path as one change and
records a field-level Activity undo patch. Undo is fingerprint-bound to the
touched slides/elements so it fails closed if the student changed them again.
