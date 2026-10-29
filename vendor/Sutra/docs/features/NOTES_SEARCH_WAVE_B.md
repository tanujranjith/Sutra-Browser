# Notes & Search — Wave B

## Math in the notes editor (`/math` block)

A new slash command **`/math`** inserts a LaTeX block into a note. It is stored as
`<span class="sutra-math-block" data-latex="…" contenteditable="false">` — the
`data-latex` is the source of truth and is re-rendered (via KaTeX) on every load,
so the saved note can never desync from the editable LaTeX. Math blocks survive
the editor sanitizer and export with their rendered output. (Inline `$…$` already
renders in review cards/assistant; this adds discrete math in note bodies.)

## Shareable self-contained deck export

The review deck view has a **Share** button that downloads a single
self-contained HTML file — an offline flashcard viewer (flip, prev/next, keyboard
shortcuts, cloze blanks, images) that anyone can open with no account and no app.
Cards travel as escaped JSON inside the file. (Notes already export as standalone
HTML via the rebuilt export pipeline.)

## Related notes ("see also")

The notes side panel now adds a **Related notes** section beneath Linked
references, surfacing other pages that share significant vocabulary
(`getRelatedNotes`, local keyword overlap, stopword-filtered, ≥2 shared terms).
Builds on the backlinks panel.

## Fuzzy + recent command palette

Ctrl/⌘+Shift+P now ranks commands with the shared fuzzy scorer (`sutraFuzzyScore`):
prefix > word-boundary > infix > subsequence (so `otl` finds "Open Timeline"). With
no query, recently-run commands float to the top (persisted via SutraSafeStorage).

## Verification

`tests/e2e/notes-search-wave-b.spec.mjs` covers fuzzy ranking + recents, related
notes, the shareable deck HTML, math-block rendering from `data-latex`, and the
`/math` command shipping in the bundle.
