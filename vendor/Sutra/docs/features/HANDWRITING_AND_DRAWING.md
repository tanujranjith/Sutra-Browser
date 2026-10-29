# Handwriting & Drawing in Notes

Sutra notes support freehand handwriting and sketching directly inside a note,
using mouse, trackpad, touchscreen, or stylus. Drawings are stored as **vector
strokes** (not flattened images), so they stay crisp, scale with the note width,
and round-trip through backups.

## Entering drawing mode

1. Open any note.
2. In the editor toolbar, click the **pen** icon (next to *Insert image*) — or run
   **Insert handwriting / drawing** from the Command Palette.
3. A handwriting block is inserted at the cursor with the hint
   *"Write, sketch, or annotate here."* You can type normal text above and below it.

Each handwriting block is a self-contained canvas with its own compact toolbar.
You can add several blocks to one note and mix them freely with typed text.
In the Modern Editor, the canvas is a live node at the insertion point. It can
be moved or removed with the surrounding document, including undo and redo.

## Tools

| Tool | What it does |
| --- | --- |
| **Pen** | Solid freehand ink. |
| **Highlighter** | Translucent wide strokes that blend over content. |
| **Eraser** | Removes whole strokes you cross (stroke-based, undoable). |
| **Color & size** | Popover with pen/highlighter colors, three stroke widths, and the paper style. |
| **Undo / Redo** | Scoped to this drawing block — never disturbs typed-text undo. |
| **More ▸ Clear drawing** | Clears the canvas (with confirmation). Undoable. |
| **More ▸ Export as PNG** | Saves the current drawing as a PNG image. |
| **More ▸ Delete block** | Removes the handwriting block (confirmation if it has strokes). |

The active tool is shown with a filled highlight (not by color alone), every
icon-only control has an `aria-label` + tooltip, and controls keep a visible
keyboard focus ring.

### Paper styles

Blank, lined, grid, or dotted backgrounds are available in the **Color & size**
popover. The choice is saved with the drawing.

## Touch & stylus

- Drawing uses **Pointer Events**, so mouse, touch, and stylus all work.
- While you are actively drawing, scrolling and text selection are suppressed *only
  for that gesture* — the rest of the time the note scrolls normally.
- If your stylus reports **pressure**, it is used as a subtle enhancement; drawing
  still works fully when pressure is missing or unreliable.
- Resize a block's height with the handle at its bottom edge. Width is always 100%
  of the note, so a drawing never causes horizontal page overflow on phones.

## Theme-aware ink

The default pen color is **Ink (auto)** — it resolves to a dark or light ink based
on the surface under the canvas, so a default stroke is always visible on the
Default, Dark, Retro, and custom themes. Any explicit color you pick is preserved
as-is.

## Autosave & persistence

- Completed strokes are saved **after you lift the pen** (`pointerup`), not on every
  movement, and writes are debounced — so hundreds of strokes stay responsive and
  storage isn't spammed.
- In-progress work is flushed before you navigate away from a note.
- Drawings live on the note as structured blocks (`page.blocks`), so they:
  - survive refresh, navigation, and browser restart;
  - are included in **JSON backups** and **`.sutra`** (and legacy **`.atelier`**) export/import;
  - are captured by **Version History**;
  - remain attached to the correct note.
- Older workspaces that predate this feature load normally — drawings are simply
  absent, and malformed imported stroke data is normalized away safely.

## Current limitations

- Erasing is **stroke-based** (removes a whole stroke), not pixel-level.
- Strokes use **normalized coordinates**, so changing a block's aspect ratio
  scales the drawing with the box (this keeps drawings sharp as the note width
  changes).
- The static PNG used in exported/printed HTML is rasterized from the strokes; the
  live, editable canvas is always the source of truth.
