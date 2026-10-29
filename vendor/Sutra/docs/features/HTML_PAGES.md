# HTML Pages

HTML Pages are a dedicated Create surface for one local HTML source document. A page stores only:

```json
{
  "htmlDocument": {
    "version": 1,
    "source": "<!doctype html>…",
    "createdAt": "ISO timestamp",
    "updatedAt": "ISO timestamp"
  }
}
```

Selection, scroll position, preview DOM, and script runtime state are session-only. The document follows the normal page persistence, version-history, encrypted backup, restore, and Sutra Sync paths. Missing `htmlDocument` fields normalize to `null`, so existing pages need no migration.

The import boundary also recognizes early HTML Page records whose explicit page
type was `html`, `html-page`, or `html_page` and whose source was stored in the
legacy `content`, `html`, or `source` field. Those records are converted to the
canonical `htmlDocument` shape during migration; ordinary `note` pages are not
inferred from HTML-looking content.

## Editing and import

- New Page → HTML Page creates a normal page with starter HTML.
- Paste or type HTML, CSS, and JavaScript in the source editor.
- Import local `.html` and `.htm` files up to 4 MB.
- Desktop shows code and preview side by side; phones switch between Code and Preview tabs.
- Source changes use the canonical confirmed-save seam and keep editor text available if persistence fails.

## Preview security boundary

Preview rendering must always go through `SutraDOMSafety.renderUserHTMLToFrame` in acknowledged `active-local` mode. The iframe grants only `allow-scripts`; it never grants same-origin access, forms, popups, downloads, parent access, top navigation, external frames, or network connections. Data URLs remain local. Linked and remote assets are blocked and produce a visible warning.

HTML Pages use the canonical page authorization gate. Once a page is locked, the source textarea is cleared and the preview iframe is removed so neither remains exposed in the live DOM.

## Integration seam

`window.SutraHTMLPages` is the registered feature bridge. It creates and opens pages through `window.flowAtelier`, never through a second store or remote service.
