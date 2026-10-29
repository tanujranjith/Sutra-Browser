# Modern Notes Editor

The Modern Editor is the default rich-text surface for Create notes. The classic
editor remains available in Settings as a compatibility choice. Both surfaces
read and save the same note content and structured block records.

## HTML embeds and drawings

Insert an HTML embed or handwriting block at the caret. Each appears as a live
node inside the Modern Editor, so surrounding text and other blocks keep their
document order. HTML previews use Sutra's existing sanitizer and sandboxed
renderer. The embed menu edits its source or removes it; drag handles resize it. Drawing blocks
use the existing handwriting tools and save vector strokes.

`page.content` contains a lightweight anchor for each structured node, while
`page.blocks` holds its data. Inserting, moving, removing, and undoing a node
reconciles those two records before save. The records use the existing page
schema, history, backup, and Sync paths. Do not store editor-only UI state in
the page. A locked page must not mount a live node until it is unlocked.

## Split View

Each Notes pane owns an editor instance and its own selection, history, and
page context. Toolbar actions apply to the active pane. Leaving a pane disposes
its node views and flushes its page before the next page is loaded.

The text-colour and highlight toolbar controls offer preset swatches in the
native colour picker and still allow a custom colour. These choices format the
current selection and do not add editor-only state to the page.

## Compatibility

Stored anchors and block records remain readable in the classic editor. Keep
the classic toggle available for older content and recovery. No new persistent
workspace fields are required for the live nodes.
