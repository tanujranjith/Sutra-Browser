# Study & Review upgrades

This wave deepened Sutra's spaced-repetition Review surface with five additions.
Everything is local-first: no new runtime CDN dependency (KaTeX is vendored under
`assets/vendor/katex/`), no telemetry.

## 1. Math / LaTeX rendering

Write `$inline$` and `$$display$$` math in card prompts/answers and it renders via
**KaTeX** in the study view. KaTeX is vendored locally and **lazy-loaded** — it is
fetched only the first time math is encountered, so startup stays fast and it works
fully offline after first use (the service worker runtime-caches it).

- Module: `src/features/study/math-render.js` (`window.SutraMath`).
- Rendered with `output:'html'` and injected via `SutraDOMSafety.setTrustedHTML`
  (the user-HTML sanitizer strips `<math>`/`<svg>`, so HTML output is required).

## 2. Code syntax highlighting

Fenced code blocks (with a `language-xxx` class) are highlighted in the study view
by a compact, dependency-free tokenizer (`src/features/study/code-highlight.js`,
`window.SutraHighlight`). It escapes all text first, so there is no injection risk;
classes emitted: `tok-comment`, `tok-string`, `tok-number`, `tok-keyword` (styled
in `styles/base/styles.css`).

## 3. Cloze deletions

Put `{{double braces}}` around a term in a card prompt to make a fill-in-the-blank
card. The front shows a blank; the back reveals the term. No new UI — just type the
braces. Works alongside math and code.

## 4. Card media

Cards carry optional `imageUrl` and `audioUrl` fields. When present (and the source
is a safe `data:` / `https:` / `blob:` URL) the image renders on the front and the
audio player on the back. Fields round-trip through `.sutra` like the rest of a card.

## 5. Robust deck import

The **Bulk import** dialog now imports cleanly from **Quizlet**, **Anki text
exports**, and **CSV**:

- Separators auto-detected: Tab, `" - "`, `" = "`, comma, and **quoted CSV**.
- Anki plain-text **directive lines** (`#separator:tab`, `#html:true`, …) are skipped.
- Basic HTML entities (`&amp;`, `&lt;`, …) are decoded.
- `{{cloze}}` syntax is preserved, so imported cloze cards just work.
- Dialogs restore focus to the Review action that opened them, including
  pointer activation in Safari (which does not automatically focus buttons).

For Anki **`.apkg`** decks (a SQLite database, not text), export from Anki via
**File → Export → "Notes in Plain Text (.txt)"** and paste/import that.

## 6. Retention analytics

The Review → Analytics view adds, from existing SM-2 data (no new fields):

- **Retention** — share of graded cards recalled Good or Easy.
- **Review activity** — a 14-day inline-SVG bar chart of cards reviewed per day.
- **Upcoming review load** — a 7-day forecast of cards coming due, with an overdue
  callout.

## Verification

`tests/e2e/study-review-upgrades.spec.mjs` covers highlighting, KaTeX render +
same-origin vendoring, cloze front/back, import parsing (Quizlet/CSV/entities/Anki
`#` skip), and the analytics helper shapes.
