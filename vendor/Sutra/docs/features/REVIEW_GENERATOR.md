# Review Generator

Turn existing work into review cards. The Review Generator extracts candidate
front/back pairs from a note (or pasted text, or a homework assignment's linked
note), shows them in the **preview/edit table** before anything saves, and links
each saved card back to its source.

## Deterministic extraction (no AI required)

`window.SutraReviewGenerator.extractPairs(html)` pulls candidates with simple,
deterministic rules:

- **Headings → body** — an `<h1>`–`<h4>` becomes a prompt; the text until the
  next heading becomes the answer.
- **Term lists** — list/paragraph lines shaped like `Term: definition`,
  `Term - definition`, or `Term = definition`.
- **Bold cloze** — a sentence containing a `<strong>`/`<b>` term becomes a cloze:
  the term is blanked (`_____`) in the prompt and is the answer.

Candidates are de-duplicated by prompt and capped. If a note is sparse, the
generator supplements with the existing line-based parser.

## Preview before save

Generation always opens the existing **create-set editor** (`openGenerator`),
where you can edit every card, drop flagged duplicates, choose the deck name,
subject, and source, then confirm. Nothing is written until you confirm.

## Source backlinks

Cards carry the existing `sourceNoteId` / `sourceApClassId` /
`sourceAssignmentId` fields, so a generated card links back to the note, AP unit,
or homework it came from. No new persisted fields — the `.sutra` round-trip is
unchanged.

## Where to start a generation

- **Notes** — page menu → *Generate review cards*
- **Homework / Assignment Studio** — *Make review cards*
- **All Due** — the *Make review cards* row action
- **Assistant** — the *Turn this note into review* plan template / *Generate
  review cards* quick action (routes through the explicit AI send-disclosure
  boundary when a provider is used)

## Optional AI generation

Deterministic generation needs no network. When you want richer cards, the
Assistant's `create_review_deck` / `add_review_cards` actions can generate them —
and those go through Sutra's existing **explicit AI send-disclosure** gate
(`ensureAiSendDisclosure`) and the reviewable-action flow, so data is only sent
after you confirm and cards are previewed before saving.

## Developer surface

`window.SutraReviewGenerator`:
- `extractPairs(html, opts)` → `[{ q, a }]` (pure)
- `buildTsv(content, opts)` → tab-separated prompt/answer text
- `fromNoteId(noteId, opts)` — generate from a note
- `fromHomeworkTask(taskId, opts)` — generate from an assignment (+ linked note)
- `fromText(text, opts)` / `fromInboxItem(item)`
