# SutraEditor vendored bundle

`sutra-editor.min.js` is a pre-built, self-contained IIFE bundling
[TipTap](https://tiptap.dev) v3.27.3 (ProseMirror) plus the extension set Sutra's
notes editor v2 uses. It is exposed as `window.SutraEditor` and loaded from a plain
`<script>` tag in `Sutra.html`, so the app itself stays no-build (same pattern as
`assets/vendor/jszip`).

**Do not edit `sutra-editor.min.js` by hand.** To change the extension set or
upgrade TipTap:

```
cd tools/editor-bundle
npm install
npm run build   # rewrites assets/vendor/editor/sutra-editor.min.js
```

Then bump the `?v=` cache-bust on the script tag in `Sutra.html` (after the last
edit of the batch — the service worker is cache-first).

## Included extensions

- StarterKit (paragraph, headings 1–3, bold/italic/strike/underline, code +
  code block, blockquote, lists + list keymap, link, horizontal rule, hard break,
  undo/redo, dropcursor, gapcursor, trailing node)
- TableKit (resizable tables), TaskList/TaskItem (nested)
- Image (base64 allowed), Typography, TextStyleKit (color, font size, …)
- Highlight (multicolor), TextAlign, Subscript/Superscript
- Placeholder, CharacterCount, Selection

## API surface

`SutraEditor.create(element, options)` → TipTap `Editor`.
Also exported: `buildExtensions`, `Editor`, `Extension`, `Node`, `Mark`,
`mergeAttributes`, input-rule helpers, `Plugin`/`PluginKey`, PM DOM parser/serializer,
`version`.

## License

TipTap and ProseMirror are MIT licensed (© überdosis GmbH; © Marijn Haverbeke and
contributors). License texts are preserved inline in the bundle
(`legalComments: 'inline'`).
