# Mobile & Responsive Behavior

Sutra is a single workspace that adapts from a wide desktop down to a small phone.
This document describes how each area behaves across the supported viewport range and
what to check when verifying responsive work.

Sutra is **local-first** — the same static app runs on every screen size; there is no
separate mobile build, no app store, and no server.

## Supported viewport range

Sutra is designed to work across **1440px → 320px** wide. The layout reflows
progressively rather than at a single hard breakpoint; the most important transitions
cluster around:

| Width | What changes |
| --- | --- |
| ~1440–1025px | Full desktop layout: sidebar + main column + (where used) split view. |
| ~1024px | Tablet adjustments begin; some multi-column areas relax. |
| **768px** | **Primary mobile breakpoint** — navigation collapses into the mobile view menu; single-column layouts dominate. |
| 640px | Large-phone tuning (tighter cards, stacked controls). |
| 560px | The **Sutra Intelligence badge** switches to its compact layout (subtitle may wrap). |
| 480px | Phone tuning. |
| 360px / 320px | Small-phone tuning; everything must remain reachable with no horizontal overflow. |

There is also dedicated handling for **short landscape** phones (e.g. `max-width:
900px` and `max-height: 480px` in landscape).

## Global behaviors

- **Navigation collapse.** The horizontal view tabs become a **mobile view menu** at
  the primary breakpoint; the same destinations (Home, Timeline, Create, Homework,
  AP Study, Testing Hub, Review, College, Life, Projects & Work, Settings) remain
  reachable, including overflow items via the "More" menu.
- **Touch targets.** Primary controls target **≥44px**; controls in constrained rows
  target **≥40px**.
- **Software keyboard.** Input-bearing surfaces (assistant composer, modals, note
  title/body) stay usable with the on-screen keyboard open; primary actions remain
  reachable above mobile browser chrome.
- **Modals.** Modals **scroll their own content** internally and keep their **primary
  actions visible above** the browser's bottom chrome; they don't rely on the page
  scrolling behind them.
- **Overflow.** Content is width-capped to avoid horizontal page overflow on phones —
  notably the note editor and inline drawings are always full-width (never wider than
  the note), and long toolbars scroll horizontally rather than pushing the layout.
- **Reduced motion & no-JS.** Animations respect the OS "reduce motion" setting, and
  key fallbacks render a sensible final state when JavaScript is disabled.

---

## Per-area behavior

### Mobile navigation

The top view tabs collapse into a compact menu at ≤768px. The sidebar (notes tree and
workspace controls) becomes an overlay/menu rather than a fixed column; opening it
does not shift the main content under it on small screens. All primary destinations,
including those behind the "More" overflow, stay reachable.

### Home / Focused Home

Home uses a dedicated **mobile essentials shell** (`#todayMobileShell`) rather than
compressing the desktop dashboard. The phone hierarchy is: compact Sutra header and
notifications, greeting/date, one canonical Next Up action, up to three chronological
Home rows, Review, and local save/backup confidence. The desktop hero, card grid,
top tab strip, floating utility buttons, and storage taskbar are hidden while this
shell is active; their destinations remain reachable through the bottom navigation,
the notification button, and the save-confidence link. Quick Capture stays in the
fixed bottom navigation. Focused Home keeps the same single-column priority on
small screens.

### Timeline

The timeline reflows to a single column on phones; entries remain tappable and the
day/section structure stays legible. Horizontal density is reduced rather than
introducing a horizontal scroll of the whole view.

### Create

The notes list/tree and editor stack on mobile rather than sitting side by side. The
**editor is always full-width of the note**, so typed text, tables, images, and
drawings never cause horizontal page overflow. The formatting **toolbar scrolls
horizontally** when it can't fit, keeping all tools available without wrapping the
layout. The page title input and breadcrumbs collapse gracefully.
Page Setup keeps all six page types visible in a grid that follows the width
of its own column, including on tablets and at browser zoom. Each type remains
keyboard reachable, and Folder creation uses the same selection flow.

### Page Mode

Paginated "paper" pages (`.page-mode-page`, Letter/A4) scale down to fit narrow
screens — the page width is reduced and margins tighten so a full page is visible
without horizontal scrolling. Page breaks, headers, footers, and page numbers remain
rendered. Page Mode stays a faithful preview of the printed/exported layout.

### Split view

Side-by-side split editing is a **wide-screen feature**. On small screens the
secondary pane (`.notes-pane-secondary`) stacks below or is set aside rather than
squeezing two editors into a phone width, so each note stays readable. The
`body.notes-split-active` flag still applies for any custom styling.

### Document backgrounds

Per-page document backgrounds render correctly on mobile and tablet, in the standard
editor, Page Mode, and split view. The image layer and dim overlay scale with the
note; the dim overlay keeps text readable on any theme. The **Document Background
modal** stacks its controls vertically **under 520px** (Upload/Replace/Remove,
preview, **Background Blur** 0–32px, **Dim Background** 0–80%, Reset, Done), and the
sliders are keyboard- and touch-accessible. Locked pages never reveal their
background behind the PIN screen on any screen size.

### Sutra Assistant + the badge

On phones the assistant **panel fits the viewport** (insetting from the edges rather
than overflowing), the **composer stays usable with the software keyboard open**, and
**Apply/Decline action cards stack** vertically. The launcher (the Sutra Assistant
icon button, bottom-right — a 56×56 tap target wrapping the 44px assistant icon)
repositions to avoid colliding with other floating buttons and the sidebar state.

The **Powered by Sutra Intelligence badge**
(`data-sutra-component="assistant-intelligence-badge"`) **stays compact** below the
panel header; at ≤560px it tightens its margins and the **subtitle may wrap** to a
second line. Its tooltip remains available on **tap, hover, and focus**, and the same
text is exposed as the `aria-label`.

### Homework

The assignment workspace keeps its summary cards in a horizontally scrollable row,
then stacks the assignment list, Extracurriculars, and Upcoming Deadlines in one
column. Semantic table rows become task cards on phones without duplicating the
underlying Homework records. Search, tabs, filters, sorting, quick completion, and
scheduling remain reachable at touch-target size. Add/edit flows open as modals that
scroll internally. In homework Quick Capture, “tonight” means today at 11:59 PM
unless a specific clock time is stated. **Import from School Portal** (paste import)
works on mobile via the same modal pattern.
Schedule, Complete, and More form one aligned action group. In unfiltered All
Assignments, open work appears first and completed assignments sit in a collapsed
section, regardless of due date. Overdue unfinished work stays in the main list
until it is marked complete. Its disclosure stays open for the current session;
searching or filtering shows matching work immediately.

### AP Study

AP Study reflows to a single column; study sets, battle-plan items, and progress
elements stack. Long content scrolls vertically; controls remain reachable at
touch-target sizes.

### Testing Hub

The Testing Hub dashboard (pinned exams and exam detail) reflows to a single column
on phones. The exam picker opens as a modal that scrolls internally. Exam-detail
cards stack vertically so the hero, the summary cards, and "More details" remain
legible without horizontal scrolling.

### Review

Review (spaced-repetition queues and review surfaces) presents one item at a time on
phones with full-width controls, so grading and navigation stay thumb-friendly.

### College

The College workspace reflows to a single column; application/task lists and any
multi-column sections collapse. Editing happens in internally-scrolling modals.

### Life

The Life workspace stacks its sections into a single column on phones; lists and
cards remain tappable, and any side-by-side panels collapse vertically.

### Projects & Work

Projects & Work (the renamed Business/Freelancer workspace, `#view-business`) reflows
its boards/lists to a single column on small screens; cards stack and controls remain
reachable at touch-target sizes.

### Settings

Settings becomes a single scrolling column on phones. Section groups stack; toggles,
selects, and inputs are full-width and sized for touch. Long settings panels scroll
the view, not the page behind a modal.

### Customization

The Customization screen (CSS Overrides, Plugins, Recovery & Developer Tools) stacks
to a single column. The CSS snippet editor remains usable on mobile — the monospace
field scrolls, and snippet cards (name, switch, actions, move ↑/↓) stack. The master
switches stay at the top. See [CSS_MODS_GUIDE.md](CSS_MODS_GUIDE.md) for shipping
mobile-only CSS.

### Plugin manager

The plugin list becomes single-column cards. Each card's controls (Enable/disable,
Export, Clear data, Uninstall, Review & trust, View manifest) stack and stay tappable.
The import **review dialog** scrolls internally so the permission list and the
confirm/cancel actions are always reachable above browser chrome.

### Backup / restore

Export and import controls are full-width on phones. File pickers use the device's
native picker. The import flow (`.sutra` / `.atelier`, and `.sutra-plugin` /
`.atelier-plugin` for plugins) and any progress/summary feedback render in
internally-scrolling surfaces so they work within mobile viewport limits.

### Onboarding

Onboarding / **Sutra Setup** runs as a full-screen, single-column flow on phones with
large tap targets and a clear primary action per step. Steps fit the viewport and
don't require horizontal scrolling; the keyboard does not obscure the primary button.

### Help & Docs

In-app help and documentation surfaces reflow to a single readable column on phones,
with comfortable line length and vertical scrolling.

### Scrollytelling mobile fallback (landing page)

The landing **thread-story** scrollytelling
(`data-sutra-component="thread-story"`) uses a **simplified vertical thread on
mobile** instead of the desktop pinned animation. It respects `prefers-reduced-motion`
(shows the final connected state with no pinned dead zones) and renders the **final
connected state with JavaScript disabled**. This lives on `HomePage.html`, separate
from the app workspace.

---

## Touch-target guidance

- **Primary controls: ≥44px** in the larger dimension (and ideally both) — main
  buttons, nav items, the assistant launcher, floating action buttons.
- **Constrained controls: ≥40px** — controls in dense rows where 44px doesn't fit,
  such as compact task-card actions.
- Keep adequate spacing between adjacent targets so they aren't easily mis-tapped.
- Don't shrink interactive controls below these floors with custom CSS; if you need a
  denser layout, reduce padding/typography instead.

## Software-keyboard behavior

- Text inputs (assistant composer, note title/body, modal fields) remain visible and
  usable while the on-screen keyboard is open.
- Primary actions stay reachable above the keyboard and above mobile browser chrome;
  the layout does not trap the submit/confirm button behind the keyboard.
- Assistant action cards and modal bodies scroll internally so the composer/actions
  aren't pushed off-screen.

## Modal behavior

- Modals **scroll their own content** rather than the page behind them.
- **Primary actions remain visible** above the browser's bottom chrome.
- Modals fit within the viewport on small screens; tall modals (plugin review, import
  summaries, Document Background controls) rely on internal scrolling, and the
  Document Background controls **stack under 520px**.

## Overflow handling

- The page itself should **never scroll horizontally** on phones.
- Wide content is contained: the editor and inline drawings are full-width-of-note
  (never wider), long toolbars scroll horizontally inside their own strip, and tables
  scroll within the editor rather than widening the page.
- Long lists scroll vertically.

---

## Responsive QA checklist

Run through the following at each width — **1440, 1280, 1024, 900, 768, 640, 480, 390,
360, 320** — using a browser's device toolbar. (You can also run
`node scripts/sutra-responsive-check.mjs` as a static guard; see
[TESTING_AND_RELEASE_CHECKLIST.md](../release/TESTING_AND_RELEASE_CHECKLIST.md).)

- [ ] **No horizontal page scroll** at any width.
- [ ] **Navigation** collapses to the mobile view menu ≤768px; every destination
      (including "More" overflow) is reachable.
- [ ] **Home** shows the mobile essentials shell with one Next Up action, a bounded
      agenda, Review, and save confidence; desktop dashboard chrome is not duplicated.
- [ ] **Timeline** is single-column and legible; entries tappable.
- [ ] **Create editor** is full-width-of-note; toolbar scrolls horizontally; no text,
      table, image, or drawing overflows the page.
- [ ] **Page Mode** pages fit the width (no horizontal scroll); breaks/headers/footers
      render.
- [ ] **Split view** is desktop/tablet only; the secondary pane stacks/sets aside on
      phones with both notes readable.
- [ ] **Document backgrounds** render in editor, Page Mode, and split; the modal
      controls stack under 520px; sliders work by touch and keyboard; locked pages
      hide their background behind the PIN.
- [ ] **Sutra Assistant** panel fits the viewport; composer usable with keyboard open;
      action cards stack.
- [ ] **Sutra Intelligence badge** stays compact ≤560px (subtitle may wrap); tooltip
      works on tap/hover/focus.
- [ ] **Homework / AP Study / Testing Hub / Review / College / Life / Projects &
      Work** each reflow to a single column with internally-scrolling edit modals.
- [ ] **Settings / Customization / plugin manager** stack to one column; snippet
      editor and plugin review dialogs scroll internally with actions reachable.
- [ ] **Backup/restore** controls and file pickers work; import summaries scroll.
- [ ] **Onboarding (Sutra Setup)** fits the viewport; primary action not hidden by the
      keyboard.
- [ ] **Touch targets** meet ≥44px (primary) / ≥40px (constrained).
- [ ] **Reduced motion** honored; **JS-disabled** landing shows the final connected
      thread state.
- [ ] **Short landscape phones** (e.g. 900×480 landscape) remain usable.
- [ ] **200% zoom** keeps the layout usable with visible focus and adequate contrast.
