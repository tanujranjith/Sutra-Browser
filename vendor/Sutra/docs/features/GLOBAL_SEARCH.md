# Global Search (workspace-wide)

Global Search is Sutra's single workspace-wide search surface. It replaces the
old Create-sidebar page filter as the way to find anything, and opens as a
centered modal over the current screen.

## Entry points

- **Sidebar → Search** in Create (shows the platform shortcut badge).
- **`Ctrl+K`** (Windows/Linux) / **`Cmd+K`** (macOS) — everywhere except inside
  text fields and except on Testing Hub, which keeps `Ctrl+K` for add-subject.
  Inside the Notes Editor V2, `Ctrl/Cmd+K` remains Insert Link.
- **`Ctrl/Cmd+Shift+F`** — legacy alternate shortcut.
- Command palette → *Search everywhere…* (`Ctrl/Cmd+Shift+P` opens the palette).
- Assistant deep links and the interactive tutorial (`openGlobalSearchPanel`).

## What it searches

| Chip | Contents |
|---|---|
| **All** | Everything below, plus secondary surfaces: courses, AP Study subjects, College checklist, Review decks/cards, habits/goals/reading, Assistant activity history, and settings shortcuts. |
| **Pages** | Create pages whose **title or location** matches. |
| **Notes** | Create pages whose **note body** matches (the page is labeled *Note* with a content snippet). |
| **Homework** | Homework tasks: title, notes, course name, due date (`hwTasks:v2`). |
| **Tasks** | Home/Today tasks: title, notes, category, due date. |
| **Timeline** | Timeline blocks: name, notes, date/time. Opening one focuses that date. |
| **Attachments** | Course files: filename, description, summary, tags, kind, size, course (`courseWorkspace.files` metadata). |

A page that matches both title and body appears once, typed as *Page*; the
**Pages** and **Notes** chips narrow by match kind.

## Behavior

- Case-insensitive, partial-word, and in-order subsequence matching
  (`apbio` finds *AP Biology*). Title matches outrank breadcrumb, metadata,
  and deep body matches. Multi-word queries require meaningful token coverage
  (both words for two-word searches and at least 65% for longer searches), so
  a specific query does not fill the list with records matching one common
  word. Complete phrase matches still rank first; due-soon homework/tasks rank
  above far-out work and completed work ranks lower.
- Metadata alone qualifies non-page records: homework/tasks match by due date
  and priority, timeline by date/time/category, and attachments by kind, MIME
  type, and size. Pages still qualify only through title/location (Pages) or
  note body (Notes), never through metadata.
- Filter chips are ordinary toggle buttons (`aria-pressed`), all keyboard
  reachable; results follow the listbox/combobox keyboard model
  (`↑`/`↓`/`Home`/`End`/`Enter` with `aria-activedescendant`).
- Results are deduplicated per entity, capped (60 in All, 40 per filter), and
  rendered with contextual snippets and `<mark>`-highlighted matches.
- Input is debounced (140 ms). All data is read from in-memory canonical state
  — no IndexedDB reads, no network requests, no cloud service.
- **Recent searches** (last 25, stored in `appSettings.recentSearches`) show on
  the empty state, travel through backups, and can be cleared.
- Quick actions (New note, New task, Start focus timer, Export encrypted
  backup) are available from the empty state.

## Privacy: locked pages

PIN-locked pages that are not unlocked in this session are **title-only**: the
collector withholds their body text and the engine independently ignores the
body of any locked record (defense in depth), so locked content can never
appear as a snippet, preview, or highlight. Locked results show a lock badge
and a "Locked — unlock to search contents" hint. The contract is pinned by
`tests/unit/global-search-privacy-contract.test.mjs` and exercised in
`tests/e2e/global-search.spec.mjs`.

## Architecture

- `src/features/search/global-search-engine.js` — pure, dual-mode
  (`window.SutraGlobalSearchEngine` / `module.exports`): query normalization,
  field scoring, ranking, snippet + match-range computation, filter/dedupe.
  No DOM, storage, or network.
- `src/features/search/global-search-modal.js` — modal controller
  (`window.SutraGlobalSearchModal`): rendering, chips, keyboard navigation
  (↑/↓/Home/End/Enter, `aria-activedescendant` listbox), recents, quick
  actions. Data is injected via `configure()`.
- `src/core/app.js` — the bridge: `collectGlobalSearchRecords(query)` builds
  typed records from live canonical state (pages, tasks, homework, timeline,
  attachments, courses) and passes secondary surfaces through
  `globalSearchAll` as prematched records (one owner per source).
  `openGlobalSearchPanel`/`closeGlobalSearchPanel` delegate to the modal and
  fall back to the command palette if the module ever fails to load.
- Focus trapping, Escape, scroll lock, and focus restoration are owned by
  `SutraModalManager`; the modal registers `[aria-label="Close"]` and a
  `data-modal-close` backdrop for it. Opening captures the external trigger and
  synchronizes the manager before autofocus, preserving return focus in WebKit.
- The command palette still searches through `globalSearchAll` directly; the
  bench (`tests/bench/heavy-workspace.spec.mjs`) measures that path.

## Files

- `src/features/search/global-search-engine.js`
- `src/features/search/global-search-modal.js`
- `src/core/app.js` (collector, bridge, shortcuts)
- `Sutra.html` (modal markup, sidebar launcher, script/style wiring)
- `styles/features/global-search.css`
- `tests/unit/global-search-engine.test.mjs`
- `tests/unit/global-search-privacy-contract.test.mjs`
- `tests/e2e/global-search.spec.mjs`

## Limitations

- Attachment **contents** are not searched: Sutra has no durable text
  extraction/OCR layer to reuse, and adding one is out of scope. Filenames,
  descriptions, summaries, tags, and course context are searched.
- Review/Assistant/College/AP/trackers results are matched by their owning
  modules (literal substring of the full query); multi-word fuzzy matching
  applies to the core types only.
- Canvas pages are searched through their saved text model; Slides decks are
  reached via their owning page.
