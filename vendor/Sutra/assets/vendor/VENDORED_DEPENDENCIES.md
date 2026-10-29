# Vendored Runtime Dependencies

Sutra deliberately vendors every runtime dependency that executes in the
privileged page origin (or that core recovery depends on). Vendoring keeps
fresh startup and offline operation free of third-party requests, and it makes
the exact executable bytes part of the reviewed deploy artifact.

This file is the inventory required by the 2026-08 audit: package, version,
license, source, and review notes for each vendored runtime. When you add or
upgrade a vendored library, update this table **and** re-run the deploy
artifact checks.

| Directory | Library | Pinned version | License | Reviewed artifact SHA-256 | Upstream | Used by |
|---|---|---|---|---|---|---|
| `assets/vendor/jszip/` | JSZip | 3.x (`jszip.min.js`) | MIT/GPLv3 dual | — | github.com/Stuk/jszip | `.sutra` / legacy backup packaging + restore, DOCX/OOXML fallback parsing |
| `assets/vendor/pdfjs/` | PDF.js (build, worker, cmaps, standard fonts) | 6.1.200 (`?v=` stamp) | Apache-2.0 | — | github.com/mozilla/pdf.js | Native PDF workspace rendering |
| `assets/vendor/pdf-lib/` | pdf-lib | 1.17.1 | MIT | — | github.com/Hopding/pdf-lib | Page assembly + exact/modified export |
| `assets/vendor/pdf-fontkit/` | fontkit (UMD) | 1.1.1 | MIT | — | github.com/foliojs/fontkit | Font embedding for pdf-lib export |
| `assets/vendor/katex/` | KaTeX | 0.16.11 | MIT | — | github.com/KaTeX/KaTeX | Notes math rendering |
| `assets/vendor/editor/` | Sutra Notes Editor v2 bundle | 3.27.3 upstream TipTap/M Pro deps, locally built | Reviewed bundle (MIT-family) | — | internal build from tiptap.dev pro/free packages | `editor.editorV2Enabled` flagged editor |
| `assets/vendor/office/` | Mammoth (`mammoth.browser.min.js`) | 1.8.0 | BSD-2-Clause | `deb07bf230d1cb3e190bc5adc6743f35c6531b6571d1e5469b24f452a7f0f4ab` | npm `mammoth@1.8.0` / github.com/mwilliamson/mammoth.js | DOCX import (on demand, same-origin) |
| `assets/vendor/office/` | SheetJS Community (`xlsx.full.min.js`) | 0.18.5 | Apache-2.0 | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` | npm `xlsx@0.18.5` / sheetjs.com | XLSX/XLS import/export (on demand, same-origin) |

## Rules

1. **Pin exact versions.** Dynamic ranges or floating CDN URLs are not allowed
   for code executing in the page origin. The Mammoth unpkg load removed in the
   2026-08 remediation is the cautionary example.
2. **Same-origin only at runtime.** `script-src` no longer approves any CDN
   script origin; new libraries must be vendored like these.
3. **Offline integrity.** Anything the daily loop, document import, or recovery
   needs must be reachable offline: critical assets, including the on-demand
   Office parsers, are precached through the generated asset manifest. Advanced
   parsers use the non-blocking install tier so they cannot prevent core offline
   readiness when an individual parser response fails.
4. **Review the bytes.** Upgrades replace reviewed files — check the diff of
   the minified artifact, not just the version number, then bump its `?v=`
   stamp (see `scripts/cache-stamp-lock.json`).
