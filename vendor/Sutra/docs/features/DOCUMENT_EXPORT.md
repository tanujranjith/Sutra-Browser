# Document Export

Sutra can export the **current note** as a standalone document in several
formats. Every path is local and failure-tolerant. PDF export writes a real,
selectable PDF directly in the browser using Sutra's vendored local PDF
runtime; if that runtime cannot load, Sutra keeps the print-ready fallback.
No export path depends on a CDN or a server. This replaces an earlier pipeline
that loaded converters from a CDN and produced broken output (blank pages, text
on half the page, lost formatting, and failures when offline).

Export the current note from the editor's export menu or **Settings → Data →
Default export format**. (The full encrypted **`.sutra`** workspace backup and
the unencrypted **JSON** workspace export are separate — see
[`DATA_AND_BACKUPS.md`](../privacy-security/DATA_AND_BACKUPS.md).)

## Formats

| Format | Output | How it is produced |
| --- | --- | --- |
| **PDF** | `.pdf` (direct) | A local `pdf-lib` renderer creates a real, paginated PDF with selectable text. PNG/JPEG images, document backgrounds, headings, lists, code, tables, links, and explicit page breaks are supported. |
| **Word** | `.docx` | A genuine, local OOXML Word package. Sutra includes the sanitized, self-contained note HTML in the document so Microsoft Word can preserve rich note content without a server or CDN. |
| **Word 97-2003** | `.doc` | **Word-compatible HTML** with an MSO `@page Section1` full-page layout for older Word-compatible workflows. |
| **HTML** | `.html` | A clean, self-contained semantic HTML document, readable in any browser and full-page when printed. |
| **Markdown** | `.md` | A deterministic local HTML→Markdown converter (headings, nested lists, blockquotes, code blocks, tables, images, page breaks). |
| **RTF** | `.rtf` | A structure-preserving HTML→RTF converter (headings, bold/italic/underline, lists, blockquotes, code, basic tables). |
| **Plain text** | `.txt` | Visible text content, normalised whitespace. |

### Direct PDF export and the fidelity fallback

The primary PDF path performs deterministic layout into Letter-sized pages and
draws text as PDF text operators, so the downloaded file remains searchable and
selectable. It loads only the vendored `pdf-lib`, `fontkit`, and local document
fonts on an explicit export action. Remote image URLs and unsupported image
formats are skipped with a warning rather than fetched.

The browser print-ready view remains available as a fidelity fallback. It is
used automatically if the direct runtime or a content conversion fails, and it
can preserve browser-specific CSS or exotic embeds that the direct renderer
does not model exactly.

### Word formats are labeled by their actual extension

**Word (.docx)** creates a real OOXML `.docx` package using Sutra's local ZIP
library—no CDN, account, or server is involved. **Word 97-2003 (.doc)** remains
available for older workflows and contains Word-compatible HTML. The two menu
options now download exactly the extension shown in Sutra.

## Notes & limitations

- **Locked pages** must be unlocked before export.
- **Images** embedded in the note are inlined into the export where possible;
  any that cannot be embedded are reported in the export toast.
- **Document backgrounds**: included in direct PDF output when the current note
  has an active image background. Blur is reported as a warning because the
  direct PDF renderer preserves the image, cover fit, and dim overlay but does
  not reproduce CSS blur. HTML/PDF print fallback preserves browser styling;
  Markdown and plain text omit backgrounds cleanly.
- Markdown/HTML/RTF cover the block types the Notes editor produces; exotic
  embeds (e.g. sandboxed HTML embeds) degrade gracefully.

## Verification

`tests/e2e/document-export.spec.mjs` asserts each builder produces correct,
non-empty output (full-page Word layout, selectable multi-page direct PDF,
print fallback, deterministic Markdown/RTF) and that the runtime uses only
local export dependencies rather than the old CDN libraries (`html2pdf`,
`html-docx-js`, `turndown`).
