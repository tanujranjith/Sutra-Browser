# Sutra - User Tutorial

A practical, step-by-step guide to using Sutra from your first launch through your first full week. This is the long-form companion to the in-app **Help & Docs** page and **Interactive Tutorial**.

> If you'd rather watch the app teach itself, open `Settings -> Advanced -> Tutorial & Onboarding -> Start Interactive Tutorial`. The walkthrough that follows mirrors and expands that overlay tour.

---

## Contents

1. [Open the app for the first time](#1-open-the-app-for-the-first-time)
2. [Get oriented in 30 seconds](#2-get-oriented-in-30-seconds)
3. [Pick a Workspace Mode](#3-pick-a-workspace-mode)
4. [Run Student Setup (or skip it)](#4-run-student-setup-or-skip-it)
5. [Make your first note](#5-make-your-first-note)
6. [Add your first task and habit](#6-add-your-first-task-and-habit)
7. [Use the Daily Thread and Shape My Day](#7-use-the-daily-thread-and-shape-my-day)
8. [Block time on the Timeline](#8-block-time-on-the-timeline)
9. [Set up Homework](#9-set-up-homework)
10. [Set up AP Study and the AP Battle Plan](#10-set-up-ap-study-and-the-ap-battle-plan)
11. [Set up the College Workspace](#11-set-up-the-college-workspace)
12. [Use the Life trackers](#12-use-the-life-trackers)
13. [Use the Business / Freelance workspace](#13-use-the-business--freelance-workspace)
14. [Master the Command Palette, Quick Capture, and Global Search](#14-master-the-command-palette-quick-capture-and-global-search)
14a. [Use the Review tab (spaced repetition)](#14a-use-the-review-tab-spaced-repetition)
14b. [Reuse focus rituals with Focus Templates](#14b-reuse-focus-rituals-with-focus-templates)
14c. [Today on phone: Mobile Today Mode](#14c-today-on-phone-mobile-today-mode)
15. [Split-screen and Focus Mode](#15-split-screen-and-focus-mode)
16. [Connect the Sutra Assistant (AI)](#16-connect-the-sutra-assistant-ai)
17. [Personalize themes, fonts, and motion](#17-personalize-themes-fonts-and-motion)
18. [Tune Settings](#18-tune-settings)
19. [Back up with `.sutra` (and restore safely)](#19-back-up-with-sutra-and-restore-safely)
20. [Import external calendar events (.ics)](#20-import-external-calendar-events-ics)
21. [Use Sutra on phone or tablet](#21-use-sutra-on-phone-or-tablet)
22. [Build a weekly review habit](#22-build-a-weekly-review-habit)
23. [Tutorial recap & cheat sheet](#23-tutorial-recap--cheat-sheet)

---

## 1. Open the app for the first time

Sutra is a single static web app - no installer, no account, no build step.

- **Easy way:** double-click `Sutra.html`. It opens in your default browser.
- **Marketing landing:** double-click `index.html` (it redirects to `HomePage.html`) and click **Start your session**.
- **Hosted version:** anywhere the repository is deployed as a static site (e.g. GitHub Pages).
- **Optional local server** (nicer for OAuth-based features):

  ```bash
  python -m http.server 5173
  # then visit http://localhost:5173/Sutra.html
  ```

The first launch creates a *Welcome to Sutra* page and a built-in *Help & Docs* page in your sidebar.

---

## 2. Get oriented in 30 seconds

You'll see three regions:

- **Sidebar (left)** - page tree, sidebar search, tag filter, focus timer, page actions, *New Page* button.
- **Top bar** - brand, view tabs (Today / Timeline / Notes / College / Life / Business / Homework / AP Study / Settings), clock widget, integrations dock (Spotify, ChatGPT, custom shortcuts), theme button, mobile menu toggle.
- **Main area** - the active view.

The very bottom of the app has a **save bar** with quick *Save Locally*, *Export*, and *Import* buttons. Most workflows don't need it because the app autosaves continuously.

Press **Ctrl/Cmd+K** at any time (outside an editor field) to open **Global Search** - your fastest way to find anything. Press **Ctrl/Cmd+Shift+P** for the **Command Palette**.

---

## 3. Pick a Sutra Mode

Sutra Modes promote the views you actually use. They never delete data - hidden views with content stay reachable through the overflow `More` menu.

Open `Settings -> Data & Backups` and pick a mode:

| Mode | Best for |
| --- | --- |
| **Standard** | "Show me everything." |
| **Student** | High school / college student with classes, AP, college apps, life. *(Business hidden.)* |
| **AP Crunch** | Days/weeks before an AP exam - Today, AP Study, Homework, Timeline, Notes only. |
| **College Apps** | Senior fall - College, Notes, Today, Timeline, Homework. |
| **Writing** | Notes-first; Today + Timeline as planning aids. |
| **Life** | Habits, sleep, journal, spending, goals. |
| **Business / Freelancer** | Full operations dashboard. |

Click **Save & Apply** at the top of Settings to commit the change.

---

## 4. Run Student Setup (or skip it)

A first-launch wizard offers to:

1. Name your **classes**.
2. Add your **AP subjects**.
3. Decide whether to enable **College App** tools.
4. Pick a **Workspace Mode**.
5. Export an immediate `.sutra` backup.
6. Open Today.

You can skip steps, finish later, or rerun the wizard anytime: `Settings -> Advanced -> Tutorial & Onboarding -> Rerun Student Setup`.

> Setup is local by default. Nothing leaves your browser unless you export it, send it to an AI provider, or explicitly enable encrypted Google Drive sync. The completed setup is included in your `.sutra` backups.

---

## 5. Make your first note

1. Click `+ New Page` in the sidebar.
2. Give it a title. Use `::` to nest, e.g. `Projects::Website::Launch`.
3. Pick a **template** (Blank, Meeting Notes, 1:1 Check-In, Project Plan, To-Do List, Daily Journal, Weekly Review, Study Notes, Research Brief, Sprint Planner, Roadmap Plan, Client Brief, Content Brief, or Decision Log). Templates can optionally seed starter tasks - toggle this in the preview panel.
4. Click **Create**.

Now write. The editor supports:

- A **toolbar** with bold, italic, underline, strikethrough, H1-H3, bullets, numbered lists, quote, and code block.
- An **insert** menu for link, table, image, video, audio, embed, embed HTML, checklist, collapsible section, and page link.
- A **slash menu** - type `/` and pick from H1/H2/H3, bullet, numbered, to-do, toggle, quote, divider, code, table, image, video, audio, embed, embed HTML, markdown, link, link to page, callout. Type to filter.
- `Tab` and `Shift+Tab` to indent and outdent list items.
- `Ctrl/Cmd+Shift+M` to toggle the markdown shortcut on the current selection.
- A live **word count** in the page header.
- **Autosave** every 1 s by default (configurable in `Settings -> Editor`).

Try assigning the page an emoji icon (page row icon menu), tagging it (tags input near the title), or marking it favorite for quick access.

### Handwrite or sketch in a note

1. In the editor toolbar, click the **pen** icon (next to *Insert image*) - a handwriting
   block appears with the hint *"Write, sketch, or annotate here."*
2. Draw with your mouse, trackpad, touchscreen, or stylus. Switch between **pen**,
   **highlighter**, and **eraser**; open **Color & size** to change ink color, stroke
   width, or paper (blank / lined / grid / dotted).
3. **Undo / redo** affect only the drawing. Use **More > Clear drawing** (asks to
   confirm), **Export as PNG**, or **Delete block**. Drag the bottom handle to resize.
4. Type above and below the block normally. Drawings autosave as vector strokes and are
   included in JSON and `.sutra` backups. Full guide:
   [`docs/features/HANDWRITING_AND_DRAWING.md`](docs/features/HANDWRITING_AND_DRAWING.md).

### Temporary pages

If you need a scratch page that disposes of itself, mark it temporary. Set the default expiration in `Settings -> Advanced -> Temporary Pages` (minutes / hours / days).

---

## 6. Add your first task and habit

From **Today**:

1. Click **+ Task** in the header.
2. Fill in title, optional notes, schedule (`once` / `daily` / `weekly` with weekday picker), due date, category, optional linked note, urgency, difficulty, and reference URL.
3. Save.

Tasks appear under **Focus / What matters today**. Commit a few priorities (one click) and the bar at the top of the panel reflects how many you've committed.

To add a habit:

- Type a name in the *Add a habit...* input under the **Habits** card and press Enter.
- Tap the habit each day to mark it done. Streaks, weekly consistency, and freezes are tracked automatically.

To see all tasks (committed, due, overdue, completed) open the **All tasks** drawer from the Today header.

Tweak how tasks behave in `Settings -> Tasks`: sort strategy (urgency / easy / due / alpha), completion style (strike / fade / minimal), density, due-date display (relative / absolute / both), include homework, include AP Study, show completed.

---

## 7. Use the Daily Thread and Shape My Day

The **Daily Thread** card on Today summarizes: overdue, today, tomorrow, and this-week counts, plus one **Next Step** computed deterministically from your data.

- **Open Deadline Radar** - a modal with every deadline (tasks, homework, AP exams, college, timeline blocks, business deadlines) grouped by *overdue / today / tomorrow / this week / later*. Each row gives you **Open** and **Schedule this** to drop a prep block on Timeline.
- **Shape My Day** - sequences your committed priorities against the calendar. Open the *Recommended sequence* disclosure to see the plan, and pick **Apply plan to calendar** from the header overflow to materialize it as Timeline blocks.
- **Auto-block events** - toggle in the Today header overflow to auto-create blocks from new calendar events going forward.

Use the **Capture** button to fire **Quick Capture**: type *"Chem essay due Friday hard"* or *"AP Physics FRQ practice tomorrow 6pm"* and the parser routes the result into the right surface.

---

## 8. Block time on the Timeline

Open the **Timeline** tab.

1. Pick a view from the mode switcher: **Month**, **Planner**, **Week**, **Day**, or **Year**.
   *(Older "3-Day" data folds into Day.)*
2. Click an empty slot or press **+ Block** to open the block modal.
4. Fill in name, start/end, category, color, recurrence (none / daily / weekdays / weekly / monthly), one-time date, and optional reference URL.
5. Save.

Active blocks light up the **Current Block** card with live progress. The **Time Mode** selector tints the surface for morning / afternoon / evening / night.

To use Timeline as a portable calendar:

- `Settings -> Advanced -> Calendar Data Files -> Export Calendar (.ics)` - share with another calendar app.
- **Import Calendar (.ics)** - bring external events in as imported blocks.
- **Clear Imported Calendar Data** - remove imported entries when you no longer need them.

---

## 9. Set up Homework

Open the **Homework** tab. On first visit you'll see the **Set Up Your Classes** overlay.

1. Add **classes** (chips) and any **misc / extracurricular activities** (chips).
2. Click **Save**.

Each class becomes a **subject lane**; activities go in the parallel **Activities lane**. Add an assignment from the *+* control inside a lane:

- Title
- Due date
- Due time
- Priority
- Difficulty
- Notes
- Done state

Status chips show *no date / upcoming / due soon (<= 48 h) / overdue*. Use the **...** menu on any assignment for **Schedule this** (creates a Timeline block) and **Open class dashboard** (drawer with open homework, upcoming class deadlines, linked notes, and any matching AP subject).

### Paste import from a school portal

Click **Paste Import** in the Homework header to paste a block of text copied from your school portal. The app parses pipe-, tab-, or dash-separated rows, previews them, and lets you correct title / class / date / time / difficulty / priority before saving. JSON import/export is still available from the same header.

By default, homework items show up in your Today task feed. Toggle this in `Settings -> Tasks -> Include homework tasks`.

---

## 10. Set up AP Study and the AP Battle Plan

Open the **AP Study** tab.

1. Press **+ Add subject**. Fill in subject name, exam date/time, target score, confidence, teacher, current unit, optional notes, and optionally **link to a Homework class**.
2. In the **Units** section, add your units and topics. Mark any units as weak as you go.
3. In **Sessions**, schedule a session by type: review, FRQ, MCQ, practice test, weak area, or mixed.
4. In **Practice**, log score / max score / minutes / confidence-after / weak flag for each practice run.
5. Watch **Analytics** for coverage, weak-area trends, study streak, and the exam countdown.

The **AP Battle Plan card** at the top of the workspace auto-picks the soonest exam, weighs weak units, recent practice scores, confidence, and days-left, and recommends a concrete next session with reasoning. From the card you can:

- Create a real AP Study **session** for the recommended subject.
- Create or open a **linked AP unit note**.
- Log a regular **task**.
- Schedule a **prep block** on Timeline.

> On the AP Study view, `Ctrl/Cmd+K` is reserved for **Add subject** (it does not open Global Search).

---

## 11. Set up the College Workspace

Open the **College** tab. The dashboard shows summary cards (Application Completion %, Upcoming Deadlines (30d), Scholarship Pipeline ($), SAT Countdown) and a button grid into:

- **College Tracker** - schools you're applying to.
- **Essay Organizer** - essay drafts, statuses, links to draft notes.
- **Score Tracker** - SAT / ACT / subject scores.
- **Award / Honors Tracker**.
- **Scholarship Tracker**.
- **Decision Matrix** - score colleges with weighted criteria; podium card highlights the top three.
- **Major Deciding Matrix** - same model for choosing a major.
- **Application Sheets** - a per-school workspace with Research, Checklist, Deadlines, Essay Plan, and Essay Prompts subviews.

Most rows expose a **Schedule this** action so applications, scholarships, and essay milestones become Timeline blocks. Essay rows can create or reopen a draft note directly from the table.

College deadlines and essay milestones with dates also appear in the Deadline Radar.

---

## 12. Use the Life trackers

Open the **Life** tab. The dashboard shows the primary trackers up front:

- **SMART Goals** - write goals in SMART format, set status, due dates, and schedule.
- **Habits** - same data as Today's habit tracker.
- **Sleep** - log nightly. Eight analytics cards: last night, 7-day average, 30-day average, goal progress %, trend, consistency / streak, sleep quality, bedtime / wake-time average.
- **Spending** - ledger with monthly total, transaction count, average per transaction, and top category.
- **Journal** - dated entries.

Secondary trackers under **More Life Tools**: Skills, Fitness, Calories, Calculator, Books.

---

## 13. Use the Business / Freelance workspace

The Business tab is hidden in Student / AP Crunch / College Apps / Writing / Life modes if it has no data, and dimmed (still reachable) if it does. Switch to **Standard** or **Business / Freelancer** mode to use it day-to-day.

Modules:

- **Overview** - KPI cards (active projects, projects at risk, total clients, open invoices, overdue invoices, monthly income, pipeline value).
- **Analytics** - historical metrics.
- **Projects**, **Opportunities**, **Clients**, **Invoices**, **Finance**, **Meetings**, **Tasks**, **Proposals/Contracts**, **Notes**, **Documents/Assets**, **Goals/Targets**.

Highlights:

- **Quick actions strip** for one-click create across projects, clients, invoices, meetings, proposals, follow-ups, notes.
- **Quick business notes** with autosave drafts, templates (proposal draft, invoice follow-up), pinning, and filters.
- **Deadlines aggregation** across projects, milestones, invoices, follow-ups, meetings, proposals, and tasks - surfaced into the global Deadline Radar.
- **Detail panels** with summary / links / activity tabs that cross-reference linked entities.
- **Global business search/filter** with status filters (open / due-soon / overdue / paid / draft / etc.).

---

## 14. Master the Command Palette, Quick Capture, and Global Search

These three shortcuts will save you the most time:

### Global Search - `Ctrl/Cmd+K`

Opens a centered, workspace-wide search modal. Type to find **Pages**, **Notes** (note content), **Homework**, **Tasks**, **Timeline events**, and **Attachments** - with filter chips, contextual snippets, highlighted matches, and due dates. `Shift+Ctrl/Cmd+F` opens the same modal.

- **All** also covers Courses, **AP Study** subjects, **Review** decks and cards, **Trackers** (habits, goals, reading list), Assistant activity, and settings shortcuts.
- `↑` / `↓` move the selection, `Enter` opens the result, `Esc` closes.
- The empty state lists your **recent searches** - click any one to re-run it. Recent searches are stored in `settings.recentSearches` and travel through every backup path.
- PIN-locked pages match by title only - their contents never appear in search until you unlock them.

### Quick Capture

Open from the Today header `Capture` button or the Command Palette. Examples:

- *"Lab report due Friday hard"* -> Homework.
- *"Read CS 241 Ch 5"* -> Task.
- *"AP Physics FRQ practice tomorrow 6pm"* -> AP session.
- *"Block deep work 10-12 weekdays"* -> Timeline block.
- *"Common App essay revise"* -> College essay row.

If you have multiple AP subjects, Quick Capture asks you to pick the destination subject before saving.

### Command Palette - `Ctrl/Cmd+Shift+P`

Opens a centered command list. Type to filter. Use it to:

- Jump to any view.
- Run **Quick Capture**.
- **Export `.sutra`** backup.
- **Create a Weekly Review note** (templated 7-day summary).
- **Rerun Student Setup**.
- **Open a class dashboard** by typing the class name.
- And many more workspace actions.

> The AP Study view repurposes `Ctrl/Cmd+K` for **Add subject**, so Global Search stays out of the way there.

---

## 14a. Use the Review tab (spaced repetition)

**Review** is Atelier's spaced-repetition + active-recall center. Notes capture, AP organizes, Today prioritizes, Focus protects time - Review is what keeps the knowledge from leaking out.

### Open Review

- Click **Review** in the top tab bar.
- Or press `Ctrl/Cmd+Shift+P` and run **Open Review** / **Start review session**.
- Or click **Start session** on the Today *Review due* card.

### Make a deck and a few cards

1. Hit **+ Deck** in the Decks panel and give it a name (e.g. *"AP Bio * Unit 3"*).
2. In **Create review card**, pick the deck, write a prompt and an answer, optionally add tags, and pick a source - a note, an AP class, or a homework class.
3. Save. The card is due immediately and shows up in the **Due queue**.

### Run a session

1. Click **Start review session** in the Due queue (or **Study** on a single deck).
2. Reveal the answer when ready.
3. Grade **Again / Hard / Good / Easy**:
   - **Again** = you forgot. Card resets to interval 1, lapses goes up.
   - **Hard** = struggled. Interval grows slightly.
   - **Good** = normal. Interval grows by your ease.
   - **Easy** = trivial. Interval grows aggressively.

When the queue is empty, click **Save session** to log it.

### What Review surfaces elsewhere

- **Today** shows a *Review due* card and a *Tracker summary* card with cards-due count.
- **Global Search** indexes deck names and card prompts/answers.
- **Focus Templates** ships with a *Review Focus* preset that links the next focus session to the deck you're studying.
- **AP / Notes / Homework** can be the *source* of a card so the same topic stays connected across tabs.

### Settings

`reviewWorkspace.settings` carries your daily limit, new-cards-per-day cap, deck interleaving, and reveal mode. They travel with every export.

---

## 14b. Reuse focus rituals with Focus Templates

The sidebar Focus Timer now has a **templates strip** below the 15m / 25m / 50m presets.

### Defaults that ship out of the box

- **Deep Work** - 50m, single hard task.
- **AP Review** - 25m, active recall on an AP unit.
- **Homework Sprint** - 30m, knock out one assignment.
- **Reading Block** - 40m, steady reading + light notes.
- **Project Build** - 60m, ship a chunk of a project.
- **Review Focus** - 20m, clear the review queue.

### Use a template

1. Click the gear in the Focus Timer to expand the settings panel.
2. Click a chip in the **Focus templates** strip.
3. The duration loads, and the next session is linked to that template (with optional project, AP class, review deck, or note).
4. Press the play button to start.

### Why this matters

Templates give focus minutes a *category*. The active template id and link metadata persist on `settings.focusTimer.activeTemplateId`, so future analytics or reports can attribute focus minutes to a class, project, or deck. The templates themselves live in `focusTemplates` and survive every backup path.

---

## 14c. Today on phone: Mobile Today Mode

When the viewport is narrow (or `settings.mobileTodayMode` is `on`), Today switches to a mobile-first layout.

You see, in order:

1. **Status card** - date * due count * habits done * review cards.
2. **Quick actions** - `+ Task`, `+ Note`, **Focus**, **Review** (each a 48px touch target).
3. **Due today** - short list of tasks due on the current date.
4. **Review chip** - visible only when cards are due, with a one-tap *Start review*.
5. **Focus chip** - first focus template, one-tap launch.
6. **Tiny capture** - single text input that routes through Quick Capture.

The desktop Today view is **untouched** - only narrow viewports get the simplified shell.

### Override the auto-detect

`settings.mobileTodayMode` accepts:

- `auto` *(default)* - switch based on viewport width.
- `on` - always use the simplified layout.
- `off` - always use the desktop layout.

The setting is stored in your settings object and travels through JSON/`.atelier` exports + reset hydration.

---

## 15. Split-screen and Focus Mode

### Split-screen

In **Notes**, click the split toggle to open a second pane.

- A second-page picker selects the right-hand note.
- The **Presets** button (grid icon) snaps the second pane to a context: Note + Assignment, Note + AP Unit, Essay + Research, Today Plan + Notes, or Calendar + Note.
- Use **Swap** to flip primary/secondary, and **Close** to dismiss the right pane.

### Pane context (deeper than tab choice)

Split View remembers more than just left/right *tab* choice - it remembers **what is selected inside each pane**. The top-level `splitPaneContexts` object stores:

- `leftView` / `rightView` (e.g. `notes`, `review`, `apstudy`)
- `leftContext` / `rightContext`, each with `selectedNoteId`, `selectedReviewDeckId`, `selectedReviewItemId`, `selectedApClassId`, `selectedAssignmentId`, `selectedProjectId`, `selectedCalendarDate`, `selectedFocusPreset`, `scrollPosition`, and `filters`.
- `lastUpdatedAt`.

Today the Notes split is the only layout that draws both panes side by side, but the data model is ready for cross-tab pairings (Notes + Review, AP + Review, Today + Calendar, Focus + Notes). On phones, Split View degrades gracefully into stacked panes.

Default split-view behavior is configurable in `Settings -> Editor -> Split view default`.

### Focus Mode

`Alt+Shift+F` (or the floating quick toggle) hides chrome and centers the editor for distraction-free writing. Toggle off the same way.

`Settings -> Editor -> Focus mode default` makes Focus Mode the default for every new note.

---

## 16. Connect the Sutra Assistant (AI)

The Sutra Assistant is **opt-in** and uses your own API key. It is **contextual** - it sees the active view, the open note, your focused tasks, etc. - and it can **propose local app changes** (tasks, blocks, notes, review cards) that you approve one card at a time.

### Connect a provider

1. Open the **mascot button** (bottom-right) to reveal the panel.
2. Expand the **Provider & Model** shell at the bottom.
3. Pick a provider: **Groq**, **OpenAI**, **Anthropic Claude**, **Google Gemini**, or **OpenRouter**.
4. Enter the **exact** model ID for that provider (typos fail at the provider's API, not in Sutra).
5. Open `Settings -> Assistant -> API keys`, paste your key, and press **Save Keys**.
6. Send a message.

### Use the contextual quick actions

The panel header shows a **context chip** - e.g. *Context: notes*. If you have text selected in the editor, a *Using selection* flag appears. Above the input, a row of **adaptive quick actions** changes per view: *Shape my day*, *Summarize*, *Make outline*, *Selection -> tasks*, *Generate review cards*, *Schedule open tasks*, etc.

Every major view also gets a small **"Ask Sutra" pill row** at the top with view-relevant prompts (e.g. *Break down assignment* in Homework, *Outline essay* in College).

### Approve actions, never auto-applied

When the assistant wants to change app state - add a task, schedule a block, create a deck - it returns a JSON proposal block. Sutra hides the JSON from the message bubble and renders **action cards** with **Apply** / **Decline** buttons (and **Apply all** for multi-action replies). Every action you approve flows through the same autosave path as anything you'd create by hand, so it survives `.sutra` and JSON export/import.

Supported actions: `insert_text`, `replace_selection`, `create_task`, `create_homework`, `create_timeline_block`, `create_page`, `create_review_deck`, `add_review_cards`, `create_cram_session`, `create_college_task`, `navigate`.

### Settings to know (`Settings -> Assistant`)

- **Enable Sutra Assistant** - the master switch.
- **Panel default** - open or closed at app launch.
- **Insert button in replies** - toggle the Insert / Save-as-note / Create-task row under assistant replies.
- **Auto suggestions** - show the adaptive quick-actions row.
- **Context depth** - minimal / current view *(default)* / workspace-aware. Bigger context = richer answers + more tokens.
- **Show action previews** - expand the JSON details inside action cards.
- **Require confirmation** - keep this on (recommended). Action cards always need Apply.

### Privacy

- API keys live in **sessionStorage** for this browser session only.
- Keys are **never** written into `.sutra` or JSON exports.
- Image / vision upload is **not** offered - paste text from screenshots instead.
- Requests go directly from your browser to the provider you chose. Sutra does not proxy them.

### Command Palette shortcuts

`Ctrl/Cmd+Shift+P` opens the palette. Type `sutra` or `flow` to see:

- *Ask Sutra...*
- *Ask Sutra about current note*
- *Sutra: Shape my day*
- *Sutra: Create review cards from current note*
- *Sutra: Schedule my open tasks*
- *Sutra: Import assignments from pasted text*
- *Sutra: Change context depth...*

---

## 17. Personalize themes, fonts, and motion

### Themes

Click the **palette** button in the top tab strip to open the floating theme panel.

- Built-in presets: Default, Dark, Botanical, Editorial, Luxury, Sepia, Ocean, Sunrise, Graphite, Aurora, Rosewater, macOS 26, Windows 11, ChromeOS, Ubuntu, GitHub, Spotify, Netflix, Slack, Dune.
- **Apply mode**: current page / all pages / custom subset (per-page theming).
- **Custom themes**: create / edit / delete with a saturation/value canvas, hue slider, and HEX entry. Import/export themes as JSON.

### Typography

The same panel lets you pick font family (Inter, Manrope, Sora, Source Sans 3, Source Sans Pro, Open Sans, Roboto, Montserrat, Comfortaa, Fira Sans, Playfair Display, IBM Plex Mono, JetBrains Mono), font size, and line height.

### Motion

`Settings -> Appearance -> Motion` chooses **full**, **reduced**, or **off**. The app also honors your OS *prefers-reduced-motion* setting.

---

## 18. Tune Settings

Open **Settings**. The view is split into 13 categories. Most controls **stage** as drafts until you press **Save & Apply**; integrations and assistant-provider controls apply immediately.

Quick wins for new users:

- `Layout -> Default start view` - open straight into Today, Notes, or Timeline.
- `Editor -> Autosave` - pick a cadence between 300 ms and 8000 ms.
- `Editor -> Writing width` - narrow / standard / wide / full.
- `Tasks -> Sort strategy` - urgency / easy / due / alpha.
- `Calendar -> Default view` and `Default source`.
- `Calendar -> Day start / end hour`.
- `Notifications -> Mode` - quiet / balanced / high.
- `Accessibility -> Larger touch targets` - for tablet/phone.

There's a **Reset** button on each section, and a **Reset all categories** button at the bottom of the Settings sidebar.

The right rail shows a **live preview** that updates as you change appearance / layout / task choices. Press **Revert** to discard the staged draft.

---

## 19. Back up with `.sutra` (and restore safely)

The single most important habit is exporting a password-encrypted **`.sutra`** backup before big changes. Optional Google Drive sync can help while Sutra is open and authorized, but a backup file you control is still the cleanest recovery path.

### Export

`Settings -> Data & Backups -> Encrypted Workspace Backup (.sutra)` asks for a backup password and writes a `.sutra` file containing the complete workspace inside an encrypted `SUTRAENC` envelope:

- Notes, tasks, timeline blocks, settings, themes.
- Homework, AP Study, College, Life, Projects & Work workspaces.
- Document backgrounds, inline images, handwriting vectors, and course attachment bytes.
- A snapshot of relevant non-secret `localStorage` keys.
- Internal manifest metadata and checksums.

Sutra cannot recover a forgotten `.sutra` password. You can also export plain **Workspace JSON** for raw data interchange; JSON is unencrypted.

### Optional Google Drive sync

`Settings -> Data -> Google Drive Sync` is off by default. If you connect it, Sutra requests only Drive app-data access, asks for a cloud sync password, encrypts snapshots in the browser, and stores `sutra-sync-current-v1.sutra` in Drive `appDataFolder`. Sync runs while the app is open, online, unlocked, and authorized.

### Per-note exports

From the editor, export the active note as DOCX, DOC (legacy), PDF, HTML, Markdown, plain text, or RTF. Set the default in `Settings -> Data -> Default export format`.

### Import

`Settings -> Data & Backups -> Import Workspace / Docs` accepts:

`.sutra`, legacy `.atelier`, `.json`, `.txt`, `.md`, `.markdown`, `.html`, `.htm`, `.csv`, `.tsv`, `.rtf`, `.pdf`, `.docx`, `.doc`, `.odt`, `.xlsx`, `.xls`, `.pptx`, `.epub`, `.xml`, `.yaml`, `.yml`, `.log`, `.zip`.

Behavior:

- Encrypted `.sutra` backups ask for the password, decrypt in the browser, then run the existing internal package validation and checksums.
- Older unencrypted `.sutra`, legacy `.atelier`, and workspace `.json` payloads **replace** workspace state - but Sutra writes a **pre-import safety snapshot** first.
- Document and image imports become new Notes in the active Space, titled from the filename without its extension.
- `.doc` (legacy Word) is best-effort in-browser; convert to `.docx` or `.pdf` if it looks off.

### Recover from a bad import

`Settings -> Data -> Storage Health -> Download local safety snapshot` exports the snapshot Sutra saved just before your last import. Re-import that to roll back.

> API keys, backup passwords, cloud sync passwords, OAuth tokens, and derived keys are never exported. Legacy `.atelier` backups still import.
---

## 20. Import external calendar events (.ics)

Sutra supports standard `.ics` files for bringing events from other calendars into the Timeline.

`Settings -> Advanced -> Calendar data files`:

1. Click **Import calendar (.ics)** and select a `.ics` file exported from Google Calendar, Apple Calendar, Outlook, or any compatible app.
2. Imported events appear in Timeline as calendar-sourced blocks.
3. Use **Clear imported data** to remove all imported calendar blocks if you want a clean slate.
4. Use **Export calendar (.ics)** to share your Sutra time blocks with other calendar apps.

> For cross-device workspace backup, use `.sutra` exports instead.

---

## 21. Use Sutra on phone or tablet

Sutra ships responsive styles for 1024 / 768 / 640 px breakpoints.

- The sidebar collapses behind a button and a tap-overlay.
- The top tab strip becomes a single **current view** dropdown that expands the full tab list.
- Overflowing tabs slide into a `More` menu.
- Modals stack to a single column under 640 px.
- Turn on `Settings -> Accessibility -> Larger touch targets` to enlarge tap zones.

Workflows that especially shine on a phone:

- Quick Capture from the Today header.
- Habit checkmarks during the day.
- Reading notes in Focus Mode.

---

## 21a. Customize with mods (advanced, optional)

For power users only - the calm defaults need none of this. Open
`Settings -> Mods & Customization`.

1. **CSS Overrides** - click **Add snippet**, type some CSS, hit **Preview** to see it
   live, then **Save**. Toggle, duplicate, reorder (cascade order), or export snippets.
   Custom CSS applies after themes and persists across theme changes and refresh.
2. **Plugins** - **Import plugin...** and choose a local `.atelier-plugin` file (try
   [`examples/plugins/study-helper.atelier-plugin`](examples/plugins/study-helper.atelier-plugin)).
   Review its permissions, install (it starts **disabled**), then enable it. Runtime
   plugins run sandboxed with no network or host access.
3. **If something breaks** - open **Recovery**, or launch **Safe Mode**
   (`?atelierSafeMode=1`, or hold <kbd>Shift</kbd> while the app loads) to skip all
   mods without losing data, then fix or disable the offending snippet/plugin.

See [`docs/features/MODS_AND_CUSTOMIZATION.md`](docs/features/MODS_AND_CUSTOMIZATION.md) and
[`docs/features/PLUGIN_SDK.md`](docs/features/PLUGIN_SDK.md).

---

## 22. Build a weekly review habit

End-of-week ritual:

1. Open the **Command Palette** with `Ctrl/Cmd+Shift+P`.
2. Run **Create Weekly Review note**. Sutra creates a templated note summarizing the past 7 days (completed and missed) and next-week deadlines.
3. Fill in wins / misses / what changes next week.
4. Open **Deadline Radar** from Today and **Schedule this** on every prep item that needs a calendar slot.
5. Export a **`.sutra`** backup.
6. Optionally, rerun **Shape My Day** for Monday.

Pair this with a Workspace Mode change if your priorities shift week to week (for example: switch to **AP Crunch** the week before an exam).

---

## 23. Tutorial recap & cheat sheet

**Keyboard:**

| Shortcut | What it does |
| --- | --- |
| `Ctrl/Cmd+K` | Global Search (AP Study uses it for Add subject). |
| `Ctrl/Cmd+Shift+P` | Command Palette. |
| `Shift+Ctrl/Cmd+F` | Global Search panel. |
| `Alt+Shift+F` | Toggle Focus Mode. |
| `Ctrl/Cmd+Shift+M` | Toggle markdown shortcut on selection. |
| `Tab` / `Shift+Tab` | Indent / outdent list items. |
| `/` (in editor) | Slash command menu. |

**Most-used surfaces:**

- **Today** - Daily Thread, Shape My Day, Habits, Schedule snapshot, Review-due card, Tracker summary.
- **Timeline** - Day / Week / Month / Year / Planner views.
- **Notes** - slash menu, split-screen presets, Focus Mode, templates.
- **Homework** - paste import, due-state chips, class dashboard.
- **AP Study** - units, sessions, practice, AP Battle Plan.
- **Review** - decks, cards, due queue, sessions, weak-card list, history.
- **Focus Timer** - presets + focus templates strip (Deep Work, AP Review, Homework Sprint, Reading Block, Project Build, Review Focus).
- **Settings -> Data** - Sutra Modes + `.sutra` backup (older `.atelier` files still import).

**Connected-productivity additions persist through every backup path:** `reviewWorkspace`, `focusTemplates`, `splitPaneContexts`, `settings.mobileTodayMode`, `settings.recentSearches`. Round-trip checks now verify 19 workspace fields end-to-end.

**Daily 3-minute loop:**

1. Open Today - scan the Daily Thread, the Review-due card, and the Tracker summary.
2. Click Next Step or Start review session.
3. Commit 1-3 priorities.
4. Shape My Day, push to calendar.
5. Pick a focus template and start.

That is the entire app. Everything else is layered on top of those five steps.

---

## Where to next

- The in-app **Help & Docs** page is always available at the top of your sidebar - it covers the same ground in shorter form, with deep links inside the app.
- The interactive overlay tour is at `Settings -> Advanced -> Tutorial & Onboarding -> Start Interactive Tutorial` and is the best way to *see* the controls.
- The full feature inventory and architecture details are in the [README](README.md).

If something looks different from this guide, the codebase is the source of truth - check the README's *Project Structure* section and follow the file paths.
