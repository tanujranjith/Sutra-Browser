# Document Backgrounds

_A Document Background is a per-page image that sits behind a note's writing
surface - a subtle texture, a photo, a colour wash - without ever interfering
with the text you write on top of it. Like everything in Sutra, it lives on your
device._

---

## 1. Purpose

Document Backgrounds let you give an individual note a distinct look: a paper
texture, a faint photograph, a colour field. The image is purely visual - it
renders on a dedicated layer **behind** the note surface, and the text always
stays crisp and readable on top, in light, dark, and custom themes alike.

A background belongs to **one page**. Setting a background on one note does not
affect any other note. Duplicating a page copies its background along with it.

---

## 2. Supported formats and size limits

- **Formats:** `.png`, `.jpg`, `.jpeg`, `.webp`.
- **Validation:** both the file's **MIME type** and its **size** are checked
  before the image is accepted.
- **Maximum size:** **6 MB**.
- **Auto-downscale:** images larger than **2048 px on the longest side** are
  automatically downscaled to fit. If canvas optimization ever fails, it **fails
  safe to the original** image rather than dropping it.
- **Rejected non-destructively:** zero-byte, non-image, or corrupt files are
  refused with a toast, and your existing background (if any) is left untouched.

---

## 3. Setting, replacing, and removing a background

Document Backgrounds are managed from the Notes editor.

1. In the Notes editor toolbar, click the **Document Background** button (the
   landscape icon).
2. The **Document Background** modal opens, with a live preview thumbnail and
   the current filename.
3. Use the controls:
   - **Upload Image** - choose a `.png` / `.jpg` / `.jpeg` / `.webp` file.
   - **Replace Image** - swap in a different image.
   - **Remove Background** - clear the background from this page.
4. Click **Done** to close the modal.

The modal is **keyboard- and touch-accessible**, and its controls **stack
vertically under 520 px** of width so they stay usable on narrow screens.

---

## 4. Background Blur and Dim Background

Two sliders tune how the image reads behind your text. Both show a numeric value.

- **Background Blur** - **0-32 px** (default **0**, step **1**). Blur is applied
  **only to the image**, never to the text. Use it to push a busy photo into the
  background so words stay legible.
- **Dim Background** - **0-80%** (default **25%**). This lays a tint over the
  image. Crucially, the dim overlay tints **toward the editor surface colour**,
  so the effect keeps text readable whether you are in a light, dark, or custom
  theme - it darkens a light theme's surface and lightens against a dark one as
  appropriate, rather than always going black.

Additional modal controls:

- **Reset to Default** - return blur and dim to their defaults.
- **Done** - apply and close.

---

## 5. Where backgrounds appear

A Document Background renders consistently across the editing surfaces:

- **Standard editor** - behind the normal note surface.
- **Page Mode** - preserved behind the page layout.
- **Split view** - shown for the relevant page in the split.
- **Mobile and tablet** - renders responsively at smaller sizes.
- **Light / dark / custom themes**, and **custom CSS** - supported; the dim
  overlay adapts to the active surface colour so text contrast holds.

**Duplicating a page copies its background.**

### Locked-page privacy

A **locked page never shows its background behind the PIN screen.** Until the
page is unlocked, the background is suppressed - this is enforced both in
JavaScript (gated on the page's lock state) and with a CSS backstop, so the
image cannot leak past the lock.

---

## 6. How backgrounds are stored (local persistence)

A Document Background is stored as a **data URL on `page.documentBackground`** -
exactly the same model Sutra already uses for **inline note images**. There is
no separate blob lifecycle and no object-URL to leak.

The stored shape is:

```js
page.documentBackground = {
  enabled,        // whether the background is shown
  dataUrl,        // the image, inline as a data URL
  blurPx,         // Background Blur, 0-32
  overlayOpacity, // Dim Background, 0-0.80 (25% default)
  name,           // original filename
  mimeType,       // validated MIME type
  fit: 'cover',
  position: 'center'
}
```

These values are **normalized and clamped on hydrate**, so an out-of-range or
malformed value loaded from storage is brought back into valid bounds rather
than rendering incorrectly.

Because it rides on the page like an inline image, a background **survives
refresh, close/reopen**, a full `.sutra` **export -> wipe -> restore -> reload**,
and **page duplication**.

---

## 7. Backups and export behavior

### `.sutra` backups

Document Background images travel inside `.sutra` packages. During export,
Sutra recursively walks the workspace for inline `data:` assets (which includes
`page.documentBackground.dataUrl`), **extracts each one into the package's
`assets/` folder with a checksum**, and references it from the workspace JSON.
On import the asset is rehydrated back to its data URL. So a background is
preserved through a complete backup-and-restore cycle.

### Legacy `.atelier` backups

Backgrounds also restore from legacy **`.atelier`** backups - the importer
routes `.atelier` files through the same package importer, so older archives
that contain a background bring it back intact.

### JSON export/import

The plain **JSON** export/import path carries the background too: because the
image is an inline data URL on the page, it is part of the JSON projection and
round-trips without any zip packaging.

### Note-document export (PDF / HTML / DOCX / Markdown / plain text)

When you export an individual **note document** (as opposed to a workspace
backup), background handling depends on the target format:

- **HTML** - the background is included where feasible.
- **PDF** - the background is preserved where the browser's printing allows.
- **Markdown** and **plain text** - the background is **omitted cleanly** (these
  are text-only formats).
- **DOCX / RTF** - background support is **a known limitation**; do not rely on
  the background appearing in these formats.

---

## 8. Privacy implications

A Document Background is **image data stored locally on your device**, inline on
the page, with everything else in your workspace. It only leaves this browser if
**you** export a backup or note document that includes it, or if you explicitly
enable encrypted Google Drive sync. In Drive sync, the complete workspace
snapshot is encrypted in the browser before upload. And, as in section 5, a **locked
page's background is never revealed behind the PIN screen**. See
[`PRIVACY_AND_LOCAL_FIRST.md`](../privacy-security/PRIVACY_AND_LOCAL_FIRST.md) for the full
local-first model.

---

## 9. Troubleshooting

**My image was rejected.**
Check the format (`.png` / `.jpg` / `.jpeg` / `.webp` only) and that the file is
under **6 MB** and is a valid, non-empty image. Zero-byte and corrupt files are
refused with a toast; your current background is left as-is.

**A large photo looks soft.**
Images over **2048 px** on the longest side are auto-downscaled. If you need
maximum sharpness, start from an image at or below that size.

**Text is hard to read over the image.**
Increase **Dim Background** and/or **Background Blur**. The dim overlay tints
toward your theme's surface colour, so raising it improves contrast in any theme.

**My locked note shows no background.**
That is intentional. A locked page hides its background until you unlock it, so
nothing leaks behind the PIN screen.

**The background didn't appear in my exported Word/Markdown file.**
Markdown and plain text omit backgrounds by design; DOCX/RTF support is a known
limitation. Use HTML or PDF export if you need the background to carry over.

**Did my background survive the backup?**
Yes - it is packaged as an `assets/` file (with a checksum) inside `.sutra` and
restored on import; the JSON path carries it inline. It also survives refresh,
reopen, and page duplication.

---

## 10. Developer notes (stable hooks)

The background renders on a dedicated layer behind the note surface, with these
stable component hooks:

- `data-sutra-component="document-background-layer"` - the image layer.
- `data-sutra-component="document-background-overlay"` - the dim overlay.
- `data-sutra-component="document-background-controls"` - the modal controls.

Implementation lives in `src/core/app.js`
(`normalizeDocumentBackground`, the `documentBackgroundModal` handlers, and the
background render path).
