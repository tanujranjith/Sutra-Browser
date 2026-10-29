# Sutra Guidebook

A friendly, hands-on walkthrough of your **first session** with Sutra - from opening the app to saving your first backup. No required account, no setup files, local by default. Optional Google Drive sync is off unless you enable it.

> Prefer to be taught inside the app? Open the **Help & Docs** page at the top of your sidebar, or run the interactive overlay tour from `Settings -> Advanced`. This guide mirrors and expands them.

---

## Contents

1. [Open the app](#1-open-the-app)
2. [Sutra Setup (onboarding)](#2-sutra-setup-onboarding)
3. [Get your bearings: Today & the Daily Thread](#3-get-your-bearings-today--the-daily-thread)
4. [Capture your first note](#4-capture-your-first-note)
5. [Add homework (and import from your school portal)](#5-add-homework-and-import-from-your-school-portal)
6. [Set up AP Study](#6-set-up-ap-study)
7. [Start a Review deck](#7-start-a-review-deck)
8. [Plan time on the Timeline](#8-plan-time-on-the-timeline)
9. [Protect a block of time with Focus](#9-protect-a-block-of-time-with-focus)
10. [Meet the Sutra Assistant](#10-meet-the-sutra-assistant)
11. [Make it yours: themes & customization](#11-make-it-yours-themes--customization)
12. [Export a `.sutra` backup](#12-export-a-sutra-backup)
13. [Stay on top: All Due, Course Hub, Review Generator & Starter Packs](#13-stay-on-top-all-due-course-hub-review-generator--starter-packs)
14. [Your daily three-minute loop](#14-your-daily-three-minute-loop)

---

## 1. Open the app

Sutra is a single static web app - no installer, no account, no build step.

- **Easiest:** double-click **`Sutra.html`**. It opens in your default browser.
- **From the landing page:** double-click **`HomePage.html`** (or `index.html`, which redirects there) and click **Start your session**.
- **Optional local server** (nicer for some image-upload paths):

  ```bash
  python -m http.server 5173
  # then visit http://localhost:5173/Sutra.html
  ```

On first launch, Sutra creates a welcome page and a built-in **Help & Docs** page in your sidebar. Everything you do from here lives on this device only.

---

## 2. Sutra Setup (onboarding)

The first time you open Sutra, the **Sutra Setup** wizard appears. It follows your daily academic loop and is completely optional. It walks you through:

1. **Welcome** — choose how you'll use Sutra: as a student, for school & work, or just exploring.
2. **Classes** — type your class names (or import from your school portal later).
3. **Setup** — paste a syllabus or assignment list, or browse starter packs.
4. **Mode** — pick a focus: **Student** (homework, reviews, notes), **AP Crunch** (AP exam tracking), or **Writer** (notes-first workspace).
5. **Protect** — create an encrypted `.sutra` backup or defer for later.
6. **Finish** — land on **Today** and see your next step.

Skip any step with the **Skip** button. Close and return later from **Continue later**. To run setup again anytime: `Settings -> Advanced -> Restart Sutra Setup`.

> Everything here is local by default. Nothing leaves your browser unless you export it, send it to an AI provider, or explicitly enable encrypted Google Drive sync. Your completed setup is included in your `.sutra` backups.

**Choosing a Mode:** the mode you pick during setup sets your default surfaces and focus. Advanced features — AP Study, College planning, Life, Projects & Work, and the Assistant — stay **available from Settings → Feature packs** and never delete data when hidden.

---

## 3. Get your bearings: Today & the Daily Thread

**Today** is your home base. Three things to notice:

- **Daily Thread** - a summary card showing overdue / today / tomorrow / this-week counts, plus one **Next Step**: the single most useful thing to do right now, computed from your own data. You can run it directly.
- **Shape My Day** - sequences the priorities you've committed against your calendar. Open the *Recommended sequence* disclosure to see the plan, and apply it to the Timeline if you like it.
- **Deadline Radar** - opens a modal that gathers *every* deadline (tasks, homework, AP exams, college, timeline blocks, work) grouped by *overdue / today / tomorrow / this week / later*. Each row has **Open** and **Schedule this**.
- **Today customization** - use the Today toolbar or More actions to choose a calm, study, everything, or custom preset. Custom presets can reorder, hide, or resize existing cards; the compact phone shell remains optimized for small screens.
- **Weekly Review** - one screen for the week just ended and the week ahead: done / missed / overdue counts, **Grades** with per-course risk badges, week-over-week movement (▲/▼) and *"N missing - log scores?"* prompts, **Plan health** (a deterministic scan of the next 7 days for overlaps, missing buffers, overloaded days, and unscheduled priorities, with a **Repair my week** button), heavy days, and **Estimates vs reality** - once you log *"took about how long?"* after homework, it shows where your estimates run long or short per class. Sutra nudges you toward it on Sunday/Monday; you can also open it any time from Today or the Command Palette.

Add your first task right here: click **+ Task**, fill in a title (and optionally a due date, priority, and a linked note), and save. Commit a couple of priorities with one click, and the bar at the top of the panel reflects what you've committed.

Want to add a habit? Type a name in the *Add a habit...* input under the **Habits** card and press Enter. Tap it each day; streaks and weekly consistency track themselves.

> The fastest way to find anything is **Global Search**: press **Ctrl/Cmd+K** (anywhere outside an editor) and start typing. For commands and quick jumps, open the **Command Palette** with **Ctrl/Cmd+Shift+P**.

---

## 4. Capture your first note

Open **Notes** (or press `+ New Page` in the sidebar).

1. Click **+ New Page** and give it a title. Use `::` to nest - e.g. `Bio::Unit 3::Cell Energy`.
2. Pick a **template** (Blank, Study Notes, Daily Journal, Weekly Review, and more). Some templates can seed starter tasks - toggle that in the preview.
3. Click **Create**, and start writing.

The editor gives you:

- A **toolbar** (bold, italic, underline, strikethrough, H1-H3, lists, quote, code).
- An **insert** menu (link, table, image, video, audio, embed, checklist, collapsible section, page link).
- A **slash menu** - type `/` and pick a block. Type to filter.
- `Tab` / `Shift+Tab` to indent and outdent list items, and a live **word count**.
- **Autosave** - your note saves continuously; you don't need to think about it.

A few first-session things worth trying:

- **Page Mode** - a clean, document-style presentation of the note surface.
- **Document Background** - click the *Document Background* button in the toolbar to set a per-page background image (`.png`, `.jpg`, `.jpeg`, `.webp`, up to 6 MB). Tune the **Background Blur** (0-32 px) and **Dim Background** (0-80%) sliders so your text stays readable. The background rides along in your `.sutra` backup, and a *locked* page never shows its background behind the PIN screen.
- **Handwriting** - insert a handwriting block to sketch a diagram with your mouse, trackpad, touch, or stylus. Strokes are stored as vectors, so they stay crisp. (Full guide: [`docs/features/HANDWRITING_AND_DRAWING.md`](docs/features/HANDWRITING_AND_DRAWING.md).)
- **Split view** - open a second pane beside your note and use a preset like *Note + Assignment* or *Essay + Research*.

---

## 5. Add homework (and import from your school portal)

Open **Homework**. On first visit you'll see a *Set Up Your Classes* overlay - add your **classes** (chips) and any **activities** (chips), then **Save**. Each class becomes a **Subjects** lane; activities go in the **Activities** lane.

Add an assignment from the *+* control inside a lane. Each one carries a title, due date, due time, priority, difficulty, notes, and a done state. Watch the status chips: *no date / upcoming / due soon (<= 48 h) / overdue*.

### Import from School Portal

Already have your assignments listed in a school portal? Don't retype them.

1. Click **Import from School Portal** in the Homework header.
2. Paste a block of lines copied from the portal (pipe-, tab-, or dash-separated all work). **Canvas pastes work directly** - copy your course's Assignments page and Sutra pairs each title with its "Due ..." line and skips the points/status noise.
3. Sutra **previews** each parsed row, and marks anything **already in Sutra** (same title + due date) as skipped so re-pasting never doubles up. Correct any title / class / date / time / difficulty / priority before saving.
4. Save - your assignments land in the right lanes.

For one-click capture, open **"Importing from Canvas / an LMS?"** inside the import dialog and drag the **Send to Sutra** bookmarklet to your bookmarks bar. Clicking it on your LMS assignments page copies titles, due dates, *and links* to your clipboard - paste into the import box and every assignment keeps a **Source** link back to the original page. The bookmarklet runs only on the page you click it on and sends nothing anywhere.

Each assignment's **...** menu offers **Schedule this** (drop a prep block on the Timeline) and **Open class dashboard**. By default, homework also shows up in your Today task feed (toggle in `Settings -> Tasks`).

**When you finish an assignment**, Sutra asks (optionally) how long it really took. Answer a few times and every estimate in the app - homework chips, Quick Capture's "block focus time" nudge, All Due effort - adapts to how long *your* work actually takes. Deleted something by mistake? **Trash** (command palette → "Open Trash") keeps deleted pages, tasks, and assignments restorable for 30 days.

**Log grades as fast as you capture homework:** open Quick Capture and type `got 87/100 on chem test`. Sutra logs the score to that class's Grade Planner and shows your course grade move in place - and if the score was rough, it offers to turn your mistakes into review cards on the spot.

---

## 6. Set up AP Study

Open **AP Study**.

1. Press **+ Add subject**. Fill in the subject, exam date/time, target score, confidence, teacher, current unit, optional notes, and optionally **link a Homework class**.
2. In **Units**, add your units and topics. Flag any weak ones as you go.
3. In **Sessions**, schedule a study session by type (review, FRQ, MCQ, practice test, weak area, mixed).
4. In **Practice**, log score / max score / minutes / confidence-after for each run.
5. Check **Analytics** for coverage, weak-area trends, your study streak, and the exam countdown.

At the top of the workspace, the **AP Battle Plan** card auto-picks your soonest exam, weighs weak units, recent practice, confidence, and days-left, and recommends a concrete next session - with reasoning. From the card you can create a real AP session, open a linked unit note, log a task, or schedule a prep block.

> On the AP Study view, `Ctrl/Cmd+K` is reserved for **Add subject** rather than Global Search.

When you want to drill the material, the **Testing Hub** and **Cram** surfaces help you pin exams and run focused last-minute sessions.

---

## 7. Start a Review deck

**Review** is what keeps the material from leaking out between study sessions - spaced repetition and active recall, all local.

1. Open **Review** (top tab, or `Ctrl/Cmd+Shift+P -> Start review session`).
2. Hit **+ Deck** and name it (e.g. *"AP Bio * Unit 3"*).
3. In **Create review card**, pick the deck, write a prompt and an answer, optionally add tags, and pick a **source** - a note, an AP class, or a homework class.
4. Save. The card is due immediately and lands in the **Due queue**.

Run a session: **Start review session**, reveal the answer when ready, and grade **Again / Hard / Good / Easy**. Sutra reschedules each card with a local SM-2-lite algorithm - no AI, no backend. Try the other modes too: **Learn**, **Write**, **Test**, and **Match**.

A *Review due* card will start appearing on **Today** whenever cards are waiting.

---

## 8. Plan time on the Timeline

Open **Timeline** and pick a view - **Month**, **Planner**, **Week**, or **Day**.

1. Click an empty slot (or **+ Block**) to open the block modal.
2. Fill in name, start/end, category, color, recurrence (none / daily / weekdays / weekly / monthly), and an optional reference URL.
3. Save.

Active blocks light up the **Current Block** card with live progress, and the time-of-day surface tint shifts for morning / afternoon / evening / night.

You don't have to build the day by hand: nearly every dated row across Sutra - homework, AP prep, college deadlines, Deadline Radar items - has a **Schedule this** action that drops a Timeline block for you. **More -> Push time** can shift the schedule atomically with one-session undo. To bring in an outside calendar, use the local-preview ICS import from `More` or `Settings -> Packs & advanced -> Calendar data files`; imported events do not create Sutra reminders and older imported history stays out of deadline-driven surfaces.

---

## 9. Protect a block of time with Focus

The **Focus Timer** lives in the sidebar. Pick a quick preset (15 / 25 / 50 min) or set a custom duration, choose a ringtone and volume, and press play. A *finish at* preview shows when you'll be done, and a completion popup keeps the alarm going until you dismiss it.

Below the presets is a **Focus Templates** strip - reusable rituals like **Deep Work**, **AP Review**, **Homework Sprint**, **Reading Block**, **Project Build**, and **Review Focus**. Click a chip to load its duration and link the session to a subject, project, note, or review deck.

Separately, **Focus Mode** (`Alt+Shift+F`) strips the chrome away from the writing surface so it's just you and the words. Toggle it off the same way.

---

## 10. Meet the Sutra Assistant

The **Sutra Assistant** is the assistant icon button at the bottom-right. Its local notes/help experience is available by default. Connecting a remote model is optional and uses **your own API key** - Sutra runs no AI servers and proxies nothing.

### Connect a provider

1. Click the Sutra Assistant icon to open the panel.
2. Pick a provider: OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral AI, Together AI, DeepSeek, xAI, Perplexity, or a Custom OpenAI-Compatible Endpoint.
3. Enter the **exact Model ID** for that provider (a wrong ID fails at the provider, not in Sutra).
4. Open `Settings -> Assistant` (or the setup wizard), paste your key, and save. **Session-only storage is the default.** Local endpoint URLs are validated and device-local; neither raw keys nor endpoint settings are exported or synced.

### What it knows, and what it can do

Right under the panel header you'll see the **Powered by Sutra Intelligence** badge - *"Local signals from your workspace."* That's the local layer reading your overdue work, workload, schedule conflicts, weak areas, review backlog, and next steps to ground the assistant. It does not call any server itself.

You decide how much it sees with **Workspace Access**: *Current Screen Only*, *Current Area*, or *Full Workspace Context*. Choose **Single Request** or **Conversation Memory** for whether it remembers the thread.

When the assistant wants to *change* something - add a task, schedule a block, create a deck - it never does it silently. It renders **Apply / Decline** cards, and multi-action replies group into one **Proposed plan** card with per-step checkboxes, *Apply selected / Apply all*, a live "N of M applied" count, and a one-click **Undo all** that reverses the whole batch. **Confirm Before Applying Changes** keeps you in control. After a step applies you get a **receipt** - what changed, a link that jumps to the affected screen (*Open Homework*, *Open Timeline*, ...), and an inline **Undo**. Every applied action is also logged under **Assistant Activity** (single actions and whole batches can be undone from there too), and anything it creates is saved and backed up exactly like work you did by hand.

Try asking it to *plan my day*, *summarize this note*, or *make review cards from this note*.

### No API key? Use Local Help

You don't need a provider to get help. Type `help` (or use **Browse Local Help**
in the panel) to open a **click-through, multiple-choice** helper that works fully
offline. Pick an option and Sutra shows a **local answer** (badged *"Answered
locally — no API key required"*), step-by-step guidance, an **Open in Sutra**
button, and follow-up choices. Product questions like *"how do I make
flashcards?"* or *"does Sutra send my data to a server?"* are answered from a
verified knowledge base — never invented — and a provider is used only if you
explicitly pick **"Use provider instead."**

### Assistant Memory

Tell the assistant something worth keeping — *"remember that I study best in the
morning"* — and it saves a **long-term memory** to personalize future help. It's
**local and consent-first**, and it **never** saves passwords, keys, financial,
medical, precise-location, or locked/private content. Say *"what do you remember
about me?"* to review, *"forget that"* to delete, or open **Settings ▸ Assistant
▸ Manage Memory** to search, edit, enable/disable, or clear memories. Allowed
memories travel inside your encrypted `.sutra` backup; secrets never do. Memory
changes are logged in **Assistant Activity** and can be undone.

---

## 11. Make it yours: themes & customization

Open the **theme** panel from the top tab strip.

- **Pick a theme** - Default, Dark, Botanical, Editorial, Luxury, Sepia, Ocean, Sunrise, Graphite, Aurora, Rosewater, macOS 26, Windows 11, ChromeOS, Ubuntu, GitHub, Spotify, Netflix, Slack, Dune.
- **Apply mode** - current page / all pages / a custom subset (yes, per-page theming).
- **Custom themes** - build your own with a saturation/value canvas, hue slider, and HEX entry; import/export as JSON.
- **Typography & motion** - choose a font family, size, and line height, and set motion to full / reduced / off (it also honors your OS *prefers-reduced-motion*).

Power users can go further under `Settings -> Customization`:

- **CSS Overrides** - named CSS snippets with live preview, validation, reorder, and import/export. Custom CSS applies after themes and survives refresh.
- **Plugins** - install local plugin bundles. They run **sandboxed**, install **disabled**, and are **reviewed before they run**.

If a snippet or plugin ever misbehaves, load **Safe Mode** - add `?sutraSafeMode=1` to the URL, hold **Shift** while the app loads, or use the in-app Recovery button. Safe Mode skips all custom CSS and plugins and **never deletes anything**.

---

## 12. Export a `.sutra` backup

This is the single most important habit. Optional Google Drive sync can keep an encrypted cloud snapshot, but a `.sutra` backup you control is still your safety net.

`Settings -> Data` -> **Encrypted Workspace Backup (.sutra)**. Sutra asks for a backup password, then downloads a file named like `sutra_workspace_2026-06-05_21-18-42.sutra` (your local date and time) containing your notes, tasks, timeline, settings, themes, homework, AP, college, life, and work data - including document backgrounds and inline images. You can also choose the explicit optional **unencrypted .sutra export** or plain **Workspace JSON** for raw interchange; both are readable formats, and Assistant chats stay out of the unencrypted .sutra path unless you opt in.

To restore, import the file from the same screen. Sutra always writes a **pre-import safety snapshot** first, so if an import looks wrong you can roll back from `Settings -> Data -> Storage Health`.

A few things to know:

- Old unencrypted **`.sutra`** and **`.atelier`** backups still import - nothing is broken.
- **API keys are never in the backup.** Re-enter them after restoring on a new device.
- Sutra cannot recover a forgotten `.sutra` password.
- Optional Sutra Cloud/Google Drive backup lives under the save bar and **Settings -> Data & Backup**. It is off by default and uploads only encrypted snapshots. **Sutra Sync Beta** is a separate opt-in multi-device replication system; keep an encrypted .sutra backup even when Sync is enabled.

> Make a backup now, while your workspace is small. Then make one before any big change.
---

## 13. Stay on top: All Due, Course Hub, Review Generator & Starter Packs

As your workspace fills up, four surfaces keep it manageable:

- **All Due** is one command center for everything with a deadline — tasks, homework, assignment milestones, AP exams, review due, college deadlines, and timeline blocks. **Filter** (overdue / today / this week / high-risk / unscheduled / review / AP / college / course / timeline) and **sort** (Smart, Due date, Urgency, Importance, Grade risk, Effort, Unscheduled-first, Source). Every row tells you *why it's ranked here*, and you can open it, schedule it, start a focus session, make review cards, open/create a linked note, or mark it done — right from the row.
- **Course Hub** gives each class a dashboard (assignments, files, linked notes, linked decks, schedule, grade forecast) with a deterministic **"Do this next"** card.
- **Review Generator** turns a note (or an assignment) into review cards: it pulls candidates from your headings, *term: definition* lines, and bold terms, then shows an **editable preview** before anything saves. Find it in a note's menu (*Generate review cards*), in Assignment Studio, on an All Due row, or via the Assistant.
- **Starter Packs** set up a whole workspace in one step for a goal (AP season, college apps, SAT/ACT, robotics, senior year, research, freelancing, a personal life system). **Preview** what a pack creates, apply all or just the parts you want, and **undo** the whole batch if you change your mind. Open from `Settings → Integrations → Starter Packs` or the All Due empty state.

Canvas and Slides are first-class local Notes surfaces. Canvas supports visual boards, selection, drawing, shapes, connectors, groups, tables, layout tools, locking, and local export. Slides supports themes, layouts, speaker notes, presentation/printing, local images, and an experimental PPTX package. Both save through the owning note page and round-trip through encrypted backups and Sync; Assistant edits are previewed and undoable.

Big assignments can also expand into an **Assignment Studio** (milestones, subtasks, rubric, linked work) — its *Make focus plan* and *Make review cards* buttons tie straight into Timeline and Review.

## 14. Your daily three-minute loop

Once you're set up, the whole app collapses into a short daily rhythm:

1. Open **Today** - scan the **Daily Thread** and the *Review due* card.
2. Run the **Next Step**, or start a review session.
3. Commit 1-3 priorities.
4. Run **Shape My Day** and push it to the Timeline.
5. Pick a **Focus Template** and start the timer.

That's the core of Sutra. Everything else - College, Life, Projects & Work, the Assistant, customization - layers on top of those five steps whenever you need it.

---

## Where to next

- The in-app **Help & Docs** page (top of your sidebar) covers the same ground in shorter form, with deep links inside the app.
- The full feature inventory and architecture are in the [README](README.md).
- Moving from NoteFlow Atelier? See [Rebrand & Compatibility](docs/features/REBRAND_AND_COMPATIBILITY.md) - your data loads automatically.

Welcome to Sutra. One workspace, every thread.
