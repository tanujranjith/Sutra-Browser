# Sutra Sheets

Sutra Sheets is a local-first spreadsheet surface inside a normal Create page.
It is for grade trackers, lab tables, budgets, study logs, and compact class data—not a hosted collaboration product. Create a Sheets page from Create and the workbook is stored at `page.spreadsheet`; no account, network request, or second database is required.

## Durable model and privacy

Workbooks normalize to `version: 2` while retaining V1 and unknown-field compatibility. They contain ordered sheets, stable row and column IDs, sparse cells, styles, merge/filter/freeze metadata, conditional-format/chart space, import warnings, and named ranges. A cell's durable identity is `rowId:columnId`; A1 is derived from current row and column order. Empty cells are never stored.

Selection, clipboard, scroll position, formula-bar edit state, and undo/redo are session-only. Ordinary edits mutate the owning page, update `updatedAt`, and use `flowAtelier.persistAppData()`. This gives the workbook normal reload, page duplication, encrypted `.sutra` backup/restore, and JSON recovery parity.

Like every content-bearing Create mode, Sheets checks the canonical `isPageContentAuthorized` boundary before rendering or exposing a workbook. Locked workbooks are not mounted, so their cells and formulas cannot enter the grid, formula bar, clipboard, or the `window.SutraSheets` bridge.

## Engine

`src/features/workspace/sheets-engine.js` is DOM-independent and is safe to exercise from Node tests. It normalizes the sparse model, converts A1 notation, parses formulas without `eval`, evaluates formulas deterministically, detects circular references, supports cross-sheet references, and translates relative, absolute, and mixed references for fill/copy behavior.

The formula library covers arithmetic, `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, rounding, common logical/text/date functions, `COUNTIF`, `SUMIF`, `AVERAGEIF`, `MEDIAN`, sample variance/deviation, `INDEX`, `MATCH`, `XLOOKUP`, and a basic `VLOOKUP` path. Structural reference rewriting is available for row/column edits. It reports `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#N/A`, and `#CYCLE!` rather than executing arbitrary code.

## Editor and limitations

The native editor virtualizes the visible grid and a small overscan region; it does not create thousands of off-screen cells. It supports direct/formula-bar editing, arrows, Shift selection, Tab, Enter, Delete, F2, command copy/paste, session undo/redo, formula-aware row/column insertion and deletion, hiding, merge/unmerge, frozen rows and columns, fill-down with relative-reference translation, and adding, switching, and renaming sheets. Clipboard transport is TSV, so regular tabular paste from Excel or Google Sheets works offline.

Formatting applies to the full selected range and includes bold, italic, number/percent/currency/date formats, alignment, text and fill colors, and borders. The editor also provides row and column sizing/hiding, range sorting, value filters, local dropdown validation, basic threshold conditional formatting, named ranges, and simple persistent column charts. These controls operate directly on the V2 workbook rather than maintaining a second UI-only model.

V2 adds local CSV/TSV import, CSV export, and locally generated XLSX import/export through the vendored JSZip runtime. Supported XLSX data includes sheet names, values, formulas, row/column sizing and hiding, merges, frozen panes, named ranges, and exported Sutra fonts, colors, fills, borders, alignment, and common number formats. Imported style indexes/XML are retained for round-trip work. Macros fail explicitly; external connections, pivot tables, drawings/charts, and partially imported conditional formatting appear in an import report instead of disappearing silently. No Office path makes a CDN request.

Rich conditional-format authoring, pivot tables, macros, external data connections, complete Excel style semantics, and live collaboration remain out of scope. Sutra Sync carries the page record using its normal field-aware page merge path: non-overlapping spreadsheet leaf fields merge when the generic page merge can do so; concurrent edits of the same leaf remain a normal Sync conflict rather than live collaboration.
