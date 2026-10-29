# Sutra

**Your academic life, woven into one private workspace.**
*One workspace. Every thread.*

Sutra is a private, **local-first workspace for students**. It brings structured notes, homework, AP exam prep, college applications, spaced-repetition review, focus tools, calendar planning, and life and work trackers behind one calm interface — with **no Sutra backend, no required account, and no telemetry**. Optional Google Drive sync is off by default and uploads only browser-encrypted snapshots to the user's own Drive app-data folder.

If you can open an HTML file, you can run Sutra.

> Eyebrow: `PRIVATE · LOCAL-FIRST · STUDENT-BUILT`. Built by Tanuj Ranjith.
>
> Sutra was previously released as **NoteFlow Atelier**. It is the same workspace, rebranded. Your existing data loads automatically — see [Rebrand & Compatibility](docs/features/REBRAND_AND_COMPATIBILITY.md). **NoteFlow Classic** is a *separate* legacy app and is not Sutra.

## Table of Contents

1. [What Sutra Is](#what-sutra-is)
2. [Who It's For](#who-its-for)
3. [Why the Name Sutra](#why-the-name-sutra)
4. [Local-First Philosophy](#local-first-philosophy)
5. [Quick Start](#quick-start)
6. [Static-App Architecture](#static-app-architecture)
7. [Product Map](#product-map)
8. [Sutra Assistant & Sutra Intelligence](#sutra-assistant--sutra-intelligence)
9. [Themes, Customization, CSS Overrides, Plugins, Safe Mode](#themes-customization-css-overrides-plugins-safe-mode)
10. [Backups & File Formats](#backups--file-formats)
11. [Mobile & Tablet Behavior](#mobile--tablet-behavior)
12. [Accessibility](#accessibility)
13. [Keyboard Shortcuts](#keyboard-shortcuts)
14. [Onboarding & Help](#onboarding--help)
15. [Privacy](#privacy)
16. [Troubleshooting](#troubleshooting)
17. [Limitations](#limitations)
18. [Release Checklist](#release-checklist)
19. [License & Attribution](#license--attribution)

---

## What Sutra Is

Sutra is one app for everything a student carries:

- **Notes** — hierarchical pages, a rich editor with slash commands, Page Mode, document backgrounds, handwriting, split view, and templates.
- **Planning** — a Today command center with a Daily Thread, Shape My Day, a deterministic Next Step, Deadline Radar, and a full Timeline calendar.
- **Homework** — class and activity lanes, due-state tracking, and Import from School Portal.
- **AP exam prep** — units, sessions, practice logs, weak-area tracking, exam countdowns, an automated AP Battle Plan, and a Testing Hub.
- **Review** — spaced repetition and active recall with five study modes.
- **College applications** — trackers, essays, scholarships, scores, and decision matrices.
- **Life** — habits, sleep, journal, spending, goals, books, fitness, calories, and more.
- **Projects & Work** — a local operations dashboard for projects, clients, invoices, and deadlines.
- **Focus** — a Pomodoro-style Focus Timer with reusable templates, plus a writing-only Focus Mode.
- **Sutra Assistant** — an optional, bring-your-own-key AI panel that reads your workspace and proposes changes you approve one card at a time.

Everything is stored on your device by default. If you explicitly enable Google Drive sync, Sutra encrypts workspace snapshots in your browser before uploading them to your Drive app-data folder.

## Who It's For

- **High-school and college students** juggling classes, AP exams, college apps, deadlines, extracurriculars, and a life.
- **Self-directed writers and planners** who want a Notion-style notebook without an account.
- **Solo operators and freelancers** who want a local CRM, invoice list, and deadline radar in the same workspace as their notes.
- Anyone who wants a single offline workspace they can carry between devices via one portable backup file.

## Why the Name Sutra

*Sutra* is Sanskrit for a **thread** or string — the line that holds separate beads together into one piece. That is the whole idea: your notes, assignments, exams, deadlines, and reviews are usually scattered across apps and tabs. Sutra runs a single thread through them so they read as one continuous workspace instead of a pile of fragments.

We use the thread metaphor sparingly. Inside the app, labels stay literal — *Today*, *Notes*, *Homework*, *Timeline*. The thread is the spirit of the product, not a costume on every button.

## Local-First Philosophy

- **Local-first.** Your workspace lives in browser storage on the device. No login. No telemetry. No required server.
- **One surface, many modes.** Sutra Modes promote the views you need now without deleting the others.
- **Calm by default.** Glass / neumorphic styling, configurable density, and a per-page theme system. Motion and contrast are tunable.
- **AI stays optional.** The local Assistant works without a key. Remote model features use a provider key you supply; session-only storage is the default, with optional user-secret encrypted storage on this device. Credentials are never exported.
- **Portable.** A single password-encrypted `.sutra` file is a complete backup of your workspace.

## Quick Start

1. Open **`Sutra.html`** directly (double-click is fine), or open the landing page **`HomePage.html`** and click **Start your session**. (`index.html` simply redirects to `HomePage.html`.)
2. On first launch, the **Sutra Setup** wizard walks you through Welcome, Classes, Setup, Mode, Protect, and Finish. Skip it if you prefer a blank slate.
3. Open **Today** to see the **Daily Thread** and one **Next Step**.
4. Press **Ctrl/⌘+K** to open **Global Search** and try a workspace-wide query, or **Ctrl/⌘+Shift+P** for the **Command Palette** with Quick Capture, *Create Weekly Review note*, or *Export backup*.
5. Open **Settings → Data** and save a password-encrypted **`.sutra`** backup as soon as your workspace feels real.

For a full walkthrough, see the [Sutra Guidebook](SUTRA_GUIDE.md).

Developers can use the built-in static server and Playwright matrix:

```bash
npm install
npm run serve
npm run check:all
npm run test:e2e
```

> If your browser blocks some features under `file://` (certain image-upload paths), serve the folder over HTTP with any static server — for example `python -m http.server 5173`, then visit `http://localhost:5173/Sutra.html`.

## Static-App Architecture

Sutra is a **plain static site**. There is no backend, no build step, no bundler, and no required server. The page you open *is* the app.

```
Sutra/
├─ index.html            # Tiny redirect to HomePage.html
├─ HomePage.html         # Landing page with the thread scrollytelling + "Start your session"
├─ Sutra.html            # The app shell (views, modals, structural markup)
├─ manifest.webmanifest · sw.js   # PWA manifest + offline service worker
├─ assets/               # Brand logos (assets/brand/sutra/), favicon, marketing imagery, vendored JSZip
├─ styles/               # Stylesheets by cascade layer (see styles/README.md)
│  ├─ base/              # styles.css (core tokens/components/layout), microinteractions.css
│  ├─ themes/            # sutra-pro.css, glass.css, macos26-redesign.css
│  ├─ views/             # focus-session.css, settings-redesign.css
│  ├─ features/          # per-feature CSS (assistant, customization, notifications, academic, …)
│  ├─ responsive/        # mobile.css (loads late on purpose)
│  └─ legacy/            # large blocks externalized 1:1 from inline <style> in Sutra.html
├─ src/                  # Application source — classic scripts, no build (see src/README.md)
│  ├─ boot/              # startup-intro.js, sw-register.js
│  ├─ core/              # app.js (the global runtime) + safety layer (safe-storage, dom-safety, …)
│  ├─ state/             # workspace-normalizers.js (pure state, extracted from app.js)
│  ├─ config/            # sutra-runtime-config.js
│  ├─ features/          # assistant/ academic/ study/ customization/ workspace/ (see src/features/README.md)
│  ├─ ui/                # date/time/select enhancers
│  ├─ components/icons/  # icon path data + fallback patcher
│  └─ data/              # daily-lock-in-quotes.js, emoji-keywords.generated.js
├─ scripts/              # Node checks/build/probes + lib/ (flat; see scripts/README.md)
├─ tests/                # Playwright: e2e/ bench/ fixtures/ (see tests/README.md)
├─ docs/                 # architecture/ features/ privacy-security/ release/ archive/ (see docs/README.md)
├─ examples/plugins/     # Example plugin bundle
├─ noteflow-classic/   # The separate legacy app (NoteFlow Classic)
├─ LICENSE / NOTICE      # Apache License 2.0
└─ TRADEMARK.md          # Brand usage guidelines
```

The core runtime in `src/core/app.js` is a single large **global-scope** script — feature modules attach to it rather than importing it as a module. That is why the app opens straight from a file with no module resolver.

> **Heads-up for contributors:** because `app.js` runs in global scope, top-level names live in one shared namespace. Watch for name collisions when adding new top-level functions or variables.

### Renamed files (this release)

| Old | New |
| --- | --- |
| `NoteflowAtelier.html` | `Sutra.html` |
| `styles/atelier-pro.css` | `styles/themes/sutra-pro.css` |
| `scripts/atelier-persistence-qa.js` | `scripts/sutra-persistence-qa.js` |
| `docs/atelier-save-systems-audit.md` | `docs/architecture/sutra-save-systems-audit.md` |

## Product Map

The top tab switcher exposes the workspace (visibility depends on the active Sutra Mode). All labels below are the literal names used in the app.

### Today

The default landing experience — your daily command center.

- **Daily Thread** — overdue / today / tomorrow / this-week counts plus a deterministic **Next Step** you can run directly.
- **Shape My Day** — sequences your committed priorities against the calendar; the result appears under a *Recommended sequence* disclosure, and you can apply it back to the Timeline.
- **Next Step** — the single most useful action computed from your data, runnable in one click.
- **Deadline Radar** — a modal grouping every deadline (tasks, homework, AP exams, college, timeline blocks, work deadlines) by *overdue / today / tomorrow / this week / later*. Each row offers **Open** and **Schedule this** to convert it into a Timeline block.
- **Quick Capture** — a natural-language modal (from the *Capture* button, mobile action, or Command Palette) that parses phrases like *"Chem lab due Friday"*, *"APUSH test next Tuesday"*, *"review bio chapter 12"*, and *"study chem for 45 min after dinner"* into the right local surface (task / homework / test or quiz / note / review deck / focus block / AP session / college item).
- Plus habits, a schedule snapshot, a completed-today strip, life signals, an academic planner, and **Momentum** (progress and analytics).

### Timeline

A calendar planner with **Month**, **Planner**, **Week**, and **Day** views; a time-block modal (name, start/end, category, color, recurrence, reference URL); a live *Current Block* card; a time-of-day surface tint; safe local ICS export/import; and atomic **Push time** with preview and undo. *Schedule this* actions across the app drop blocks here without retyping.

### Notes

Sutra's writing surface.

- **Page tree** — hierarchical titles using `::` (e.g. `Projects::Website::Launch`), with search, tag filter, drag-and-drop reordering, favorites, duplicate, rename, delete, emoji icons, and breadcrumbs. Temporary pages can self-expire. A built-in **Help & Docs** page always lives at the top of the tree.
- **Rich editor** — toolbar formatting (bold, italic, underline, strikethrough, H1–H3, lists, quote, code), an insert menu (link, table, image, video, audio, embed, checklist, collapsible section, page link), a slash menu (`/`), list indent with `Tab` / `Shift+Tab`, live word count, and configurable autosave.
- **Page Mode** — a document-style page presentation for the note surface.
- **Document Backgrounds** — a per-page background image set from the editor toolbar's *Document Background* button. Upload a `.png`, `.jpg`, `.jpeg`, or `.webp` (max 6 MB; large images auto-downscale), then tune a **Background Blur** slider (0–32 px) and a **Dim Background** slider (0–80%, default 25%). The dim overlay tints toward the editor surface so text stays readable in light, dark, and custom themes, and blur applies only to the image, never the text. Backgrounds work in the standard editor, Page Mode, split view, on mobile and tablet, and under custom CSS; they survive refresh, page duplication, and `.sutra` export/restore. **Locked pages never show their background behind the PIN screen.** See [Document Backgrounds](docs/features/DOCUMENT_BACKGROUNDS.md) and [CHANGELOG](docs/release/CHANGELOG.md).
- **Handwriting** — insert a handwriting block to write, sketch, or annotate with mouse, trackpad, touch, or stylus (pen, highlighter, eraser; blank / lined / grid / dotted paper). Strokes are stored as vectors and round-trip through backups. Full guide: [`docs/features/HANDWRITING_AND_DRAWING.md`](docs/features/HANDWRITING_AND_DRAWING.md).
- **Split view** — a second pane beside the current note, with split presets (Note + Assignment, Note + AP Unit, Essay + Research, Today Plan + Notes, Calendar + Note) and swap/close controls.
- **Locked pages** — PIN-protect any page (4–8 digits, stored as a salted SHA-256 hash, never as the raw PIN), with auto-lock options.
- **Canvas & Slides** — first-class local visual Notes surfaces. Canvas adds pan/zoom, a minimap, drawing, shapes, connectors, groups, tables, layout tools, locking, and local export. Slides adds themes, layouts, speaker notes, presentation/printing, local images, and experimental PPTX packaging. Both use the owning page's save/backup/Sync path.

### Homework

Two lanes — **Subjects** (your classes) and **Activities** (extracurriculars). Per-assignment fields cover title, due date/time, priority, difficulty, notes, and done state, with due-state chips (*no date / upcoming / due soon ≤ 48 h / overdue*). **Import from School Portal** pastes lines copied from a school portal (pipe-, tab-, or dash-separated), previews each parsed row, and lets you correct title / class / date / time / difficulty / priority before saving. JSON import/export is available, and each row's menu offers *Schedule this* and *Open class dashboard*. Any assignment can expand into an **Assignment Studio** (milestones, subtasks, rubric, linked notes/files, effort, revisions) whose milestones surface in All Due and Timeline — with *Schedule remaining*, *Make focus plan*, and *Make review cards* actions.

### All Due

One cross-workspace command center for everything with a deadline (tasks, homework, assignment milestones, AP exams, review due, college deadlines, timeline blocks, work, plus workspace signals). Filter by *overdue / today / this week / high-risk / unscheduled / review / AP / college / course / timeline*, and **sort** by *smart / due / urgency / importance / grade risk / effort / unscheduled-first / source*. Every row explains **why it's ranked here** (one line from the same deterministic engine that powers Today's **Next Step**) and offers *open source*, *schedule*, *start focus session*, *make review cards*, *open/create linked note*, *mark done*, and *defer*. See [All Due Command Center](docs/features/ALL_DUE_COMMAND_CENTER.md).

### Course Hub

A central dashboard per class — overview, assignments, files, linked notes, linked review decks, schedule periods, teacher/contact, and grade forecast. The overview shows a deterministic **"Do this next"** card (top-ranked item + reason) for that course. Notes/decks/assignments link by reference (`classLinkId` / relationships / `courseId`), never duplicated. See [Course Hub](docs/features/COURSE_HUB.md).

### AP Study

Sections: **Overview**, **Units**, **Sessions**, **Practice**, **Analytics**. Subjects carry exam date/time, target score, confidence, teacher, current unit, notes, and an optional linked Homework class. Units track topics, status, and weak-area flags; sessions come in types (review, FRQ, MCQ, practice test, weak area, mixed); practice logs capture score, max score, minutes, confidence-after, and a weak marker. On the AP Study view, `Ctrl/⌘+K` is reserved for **Add subject**.

### AP Battle Plan

A card at the top of AP Study that auto-picks the soonest exam, weighs weak units, recent practice, confidence, and days-left, and recommends a concrete next session with reasoning. From the card you can create a real AP session, create or open a linked AP unit note, log a task, or schedule a prep block on the Timeline.

### Testing Hub

A dashboard-first exam-prep hub for pinned exams, with a per-exam calm overview built from test profiles and an integration with AP Study.

### Cram

A focused Cram surface for last-minute sessions; the assistant can create Cram sessions on your approval.

### Review

Sutra's spaced-repetition and active-recall center. It stores **decks**, **review items** (prompt + answer + tags), and **review sessions**, each card carrying scheduling state and graded **Again / Hard / Good / Easy** with a local SM-2-lite algorithm (no backend, no AI). Five study modes:

| Mode | Description |
| --- | --- |
| Flashcards | Reveal the answer, then grade *Again / Hard / Good / Easy*. |
| Learn | Adaptive multiple-choice with mastery levels (*new → learning → familiar → mastered*). |
| Write | Type the answer; a fuzzy compare grades the attempt. |
| Test | Fixed-length mixed-format quiz with a final score and card-by-card review. |
| Match | Timed pair-up grid; best time is stored per deck. |

Review surfaces a *Review due* card on Today, indexes deck names and card text in global search, links to a Focus template, and can take its source from a note, AP class, or homework class. The **Review Generator** turns existing work into cards: deterministic extraction (headings→body, *term: definition* lists, bold-term cloze) from a note, assignment, or All Due item, shown in an editable preview before saving, with each card linked back to its source. Start it from a note's menu (*Generate review cards*), Assignment Studio, All Due, or the Assistant. See [Review Generator](docs/features/REVIEW_GENERATOR.md).

### College

A dashboard with summary metrics (Application Completion %, Upcoming Deadlines, Scholarship Pipeline, SAT Countdown) and a grid into College Tracker, Essay Organizer, Score Tracker, Award/Honors Tracker, Scholarship Tracker, Decision Matrix, Major Deciding Matrix, and Application Sheets (Research, Checklist, Deadlines, Essay Plan, Essay Prompts). Rows with dates expose *Schedule this*; essay rows can open a draft note.

### Life

A dashboard of primary trackers — Goals, Habits, Sleep, Spending, Journal — with a *More Life Tools* group for Skills, Fitness, Calories, Calculator, and Books.

### Projects & Work

A local-first operations dashboard (formerly the Business / Freelancer workspace): Overview, Analytics, Projects, Opportunities, Clients, Invoices, Finance, Meetings, Tasks, Proposals/Contracts, Notes, Documents/Assets, and Goals/Targets, with KPI cards, a quick-actions strip, quick notes, and a deadlines aggregation that feeds the global Deadline Radar.

### Focus

A compact **Focus Timer** in the sidebar (quick presets, custom durations, ringtones, alarm volume, a *finish at* preview, and reusable **Focus Templates** like Deep Work and AP Review that link a session to a subject, project, note, or deck). **Focus Mode** (`Alt+Shift+F`) is independent — it strips chrome from the writing surface for distraction-free writing.

### Sutra Modes

`Settings → Data` chooses which views are primary. Hidden-by-mode views are never deleted — a view that already contains data stays reachable through the overflow menu.

| Mode | Primary emphasis |
| --- | --- |
| **All Tools** | Everything visible. |
| Student | Today, Homework, Notes, Timeline, Review, Focus, and Data; advanced packs stay available from Settings. |
| AP Crunch | Today, AP Study, Homework, Timeline, Notes. |
| College Apps | Today, College, Notes, Timeline, Homework. |
| Writing | Notes, Today, Timeline. |
| Life | Today, Life, Notes, Timeline. |
| Projects & Work | Full operations dashboard. |

## Sutra Assistant & Sutra Intelligence

**Sutra Assistant** is available locally in a fresh workspace. Local Help, note retrieval, navigation, and deterministic workspace answers work without an API key; remote model calls remain opt-in and use a provider you choose. It can answer questions about your workspace with visible quoted note sources and **propose local changes** (tasks, timeline blocks, anchored note diffs, notes, review cards, and more) that you approve before they are applied.

**Sutra Intelligence** is the **local signal layer** behind it. It reads *only* your workspace — overdue work, workload, schedule conflicts, weak areas, review backlog, and next steps — to ground the assistant's answers. **It does not call any server itself.**

### Powered by Sutra Intelligence

A **Powered by Sutra Intelligence** badge sits directly under the panel header, with the subtitle *"Local signals from your workspace."* Hovering, tapping, or focusing it (the text is also the badge's aria-label) explains:

> *Sutra Intelligence analyzes local workspace signals such as overdue work, workload, schedule conflicts, weak areas, review backlog, and next steps. AI requests are sent only to the provider you choose.*

### How requests work

AI requests go **directly from your browser to the provider you choose** — Sutra runs no model servers and does not proxy anything. Supported providers:

- OpenAI
- Anthropic Claude
- Google Gemini
- Groq
- OpenRouter
- NVIDIA NIM
- Mistral AI
- Together AI
- DeepSeek
- xAI (Grok)
- Perplexity (Sonar)
- Custom OpenAI-Compatible Endpoint (a "Local endpoint")

You bring your own API key and the exact **Model ID**. Keys use **sessionStorage only** and clear with the browser session. They are never exported or included in sync snapshots; when you send a request, the key goes only to the selected provider.

DeepSeek, xAI, and Perplexity use Sutra's implemented OpenAI-compatible request
path. They are text-first: native image input is enabled only when the local
capability registry recognizes the selected model, and Sutra does not claim
native PDF, document, audio, video, or provider-specific reasoning controls for
them.

### Controls

- **Workspace Access** — *Current Screen Only* / *Current Area* / *Full Workspace Context*, plus selected-text awareness. Each certified action also declares the minimum access it needs.
- **Single Request** vs **Conversation Memory** — whether prior visible turns are sent with the next request. Visible chats themselves can be saved locally; this setting controls provider context, not persistence.
- **Suggested Changes** — proposals render as **Apply / Decline** cards (with *Apply all* for multi-action replies); **Confirm Before Applying Changes** keeps approval in your hands. Replies also offer **Insert into Note** and **Suggested Prompts**.
- **Assistant Activity** — every applied action is logged locally with **undo**.

### Local Help — no API key required

If you have no provider, no API key, or you're offline, **Local Help** answers
questions and guides you through features entirely on-device. Open it from the
assistant ("Browse Local Help" / "Open Local Help") or type `help`. Click through
multiple-choice options to get **local answers** (badged *"Answered locally"*),
step-by-step setup guidance, **Open in Sutra** navigation, and — only where it
helps — an optional **"Use provider instead"**. Product questions like *"how do I
make flashcards?"* or *"does Sutra send my data to a server?"* are answered from a
verified product-knowledge registry, never invented.

### Assistant Memory

The assistant can keep **long-term, local, user-controlled** memories — stable
facts you ask it to remember (study hours, goals, course preferences). It is
consent-first ("remember that …"), and it **never** stores passwords, keys,
financial/medical/precise-location, or locked/private content. Manage, search,
edit, enable/disable, or **forget** anything in **Settings ▸ Assistant ▸ Manage
Memory**; toggle **Use saved memory** to ignore it without deleting. Allowed
memories travel inside encrypted `.sutra` backups; secrets never do.

On mobile the panel fits the viewport, the composer stays usable with the software keyboard open, action cards stack, and the badge stays compact.

Full architecture, privacy invariants, and the local-vs-provider boundary are documented in [`docs/SUTRA_INTELLIGENCE.md`](docs/SUTRA_INTELLIGENCE.md).

## Themes, Customization, CSS Overrides, Plugins, Safe Mode

Apply any theme to the **current page**, **all pages**, or a **custom subset** (per-page theming). Built-in presets include Default, Dark, Botanical, Editorial, Luxury, Sepia, Ocean, Sunrise, Graphite, Aurora, Rosewater, macOS 26, Windows 11, ChromeOS, Ubuntu, GitHub, Spotify, Netflix, Slack, and Dune. You can create, edit, delete, import, and export **custom themes**, and set motion intensity to full / reduced / off (also tied to your OS *prefers-reduced-motion*).

**Customization** (`Settings → Customization`) is the polished power-user layer for restyling Sutra — local-first, no marketplace, traveling inside your workspace backup:

- **CSS Overrides** — multiple named snippets with enable/disable, live preview, brace-balance validation, duplicate, reorder, `.css` and JSON import/export, a non-destructive reset, and a **curated gallery of one-click safe presets** (Compact Sidebar, Bigger Editor Text, Minimal Today View, Softer Cards, High Contrast, Calm Focus Mode). Snippets only change *appearance* — they never run code — and custom CSS applies *after* themes and survives theme changes and refresh.
- **Safe Mode** — skip all custom CSS (and any experimental plugins) without deleting anything.

Guide: [`docs/features/CSS_MODS_GUIDE.md`](docs/features/CSS_MODS_GUIDE.md) (and the broader [`docs/features/MODS_AND_CUSTOMIZATION.md`](docs/features/MODS_AND_CUSTOMIZATION.md)).

> **Local Plugins are an experimental developer feature**, not a normal user surface. They live under `Settings → Advanced → Developer / Experimental` (off by default, never shown during onboarding) and are documented separately in [`docs/features/PLUGIN_SDK.md`](docs/features/PLUGIN_SDK.md). Plugins are **local bundles only** (no marketplace), run **sandboxed in an iframe** behind an explicit permission allowlist, install **disabled**, and are **reviewed before they run** (forced on import). Restored-from-backup runtime plugins return disabled and require re-review.

### Safe Mode

Safe Mode loads Sutra with **no custom CSS and no plugins** — and **never deletes** data, CSS, plugins, or workspace. Enter it any of these ways:

- Add `?sutraSafeMode=1` to the URL (the legacy `?atelierSafeMode=1` still works).
- Hold **Shift** while the app loads.
- Use the in-app **Recovery** controls.

## Backups & File Formats

### `.sutra` (default)

**`.sutra`** is the default backup format — a complete, portable, password-encrypted copy of your workspace. Exports are named `sutra_workspace_<YYYY-MM-DD>_<HH-mm-ss>.sutra` using your local timezone (24-hour, zero-padded), so same-day exports never collide. A new `.sutra` file is a binary envelope with magic `SUTRAENC`, envelope version `1`, a small authenticated JSON header, and AES-GCM ciphertext. The ciphertext contains the internal ZIP package with `manifest.json`, `workspace.json`, `assets/`, and `metadata/` (`export-summary.json`, `checksums.json`). Renaming a new `.sutra` to `.zip` should not expose workspace contents.

The encrypted envelope uses PBKDF2-HMAC-SHA-256 with 600,000 iterations, a fresh 16-byte salt for manual exports, AES-GCM-256, a fresh 12-byte IV per export, and a 128-bit authentication tag. The encoded header is authenticated as AES-GCM additional data. Sutra cannot recover a forgotten backup password.

Inside the encrypted package, the manifest identifies Sutra:

```json
{
  "product": "Sutra",
  "format": "sutra-workspace",
  "formatVersion": 1,
  "legacyCompatible": true,
  "appName": "Sutra"
}
```

Document backgrounds and inline note images ride along as internal `assets/` files (with checksums) via recursive inline-asset extraction, so a background survives `.sutra` export -> wipe -> restore.

### Legacy `.atelier` (still imports)

Old **`.atelier`** backups still import — the validator accepts both the new `sutra-workspace` manifest and the legacy `noteflow_atelier_project` manifest, and the import dispatcher routes both `.sutra` and `.atelier` files to the same package importer. **Old backups are never broken.**

Older unencrypted `.sutra` files also still import. Sutra warns that they are legacy plaintext backups, then runs them through the same package validation, checksum, asset rehydration, safety-snapshot, and atomic restore flow.

### Optional Google Drive sync

Google Drive sync is optional and disabled by default. When enabled from **Settings -> Data**, Sutra requests only:

`https://www.googleapis.com/auth/drive.appdata`

Sutra stores one encrypted sync file named `sutra-sync-current-v1.sutra` in Drive's hidden `appDataFolder`. The browser storage remains the working copy. Drive failures never block local saving. The Drive sync password and derived key stay in memory only; the access token is also memory-only. The device-local sync metadata key (`sutra:googleDriveSync:v1`) is not included in `.sutra` backups or cloud snapshots.

To configure a hosted deployment, set the public OAuth Web Client ID in `src/config/sutra-runtime-config.js` or by defining `window.SUTRA_CONFIG.googleDriveClientId` before `src/core/app.js` loads. Do not put client secrets, tokens, or passwords in static files. See [`docs/features/GOOGLE_DRIVE_SYNC_SETUP.md`](docs/features/GOOGLE_DRIVE_SYNC_SETUP.md).

### Plugins: `.sutra-plugin` (new) and `.atelier-plugin` (still imports)

**`.sutra-plugin`** is the new plugin export extension. Legacy **`.atelier-plugin`** bundles still import. (The bundled example, [`examples/plugins/study-helper.atelier-plugin`](examples/plugins/study-helper.atelier-plugin), uses the legacy extension and imports fine.)

### Never exported

API keys, provider credentials, tokens, backup passwords, cloud-sync passwords, and derived keys are **never** written into any backup. The assistant activity log (key `sutra:activityLog:v1`, migrated from the legacy `flow:activityLog:v1`) is **not** a secret and travels in backups.

### Internal storage names

For compatibility, Sutra intentionally **retains** its legacy internal identifiers so existing browser data keeps loading: IndexedDB databases `noteflow_atelier_db` (workspace) and `noteflow_attachments_db` (course/file binaries), plus the localStorage mirrors `hwCourses:v2` / `hwTasks:v2`. Treat these as **legacy-named compatibility identifiers** — the names are historical, not a sign that anything still calls itself "Atelier." Full detail in [Rebrand & Compatibility](docs/features/REBRAND_AND_COMPATIBILITY.md).

## Mobile & Tablet Behavior

Sutra is responsive from **1440 px down to 320 px**. Breakpoints in `styles/responsive/mobile.css` cover large tablet (1024 px), small tablet (768 px), and phone (640 px).

- The sidebar collapses behind a toggle and a tap-overlay; the pages list scrolls inside the drawer.
- The top tab strip becomes a single **current view** dropdown that expands the full list; overflowing tabs move into a *More* menu.
- Modals scroll internally and keep their primary actions visible above mobile browser chrome; under 640 px they stack to a single column.
- `Settings → Accessibility → Larger touch targets` enlarges interactive elements for thumb use.

## Accessibility

- Keyboard navigation throughout, with **visible focus** and **ARIA labels**.
- **Reduced-motion** and **JavaScript-disabled** fallbacks (the landing thread shows its final connected state with no pinned dead zones).
- Readable at **200% zoom**, with attention to color contrast.
- **Large touch targets** — at least 44 px for primary controls (40 px where space is constrained).

## Keyboard Shortcuts

Sutra is keyboard-first. The most important shortcut is **Global Search** (`Ctrl/⌘+K`) — type to search the whole workspace, arrow to navigate, `Enter` to open, `Esc` to close. For commands, the **Command Palette** (`Ctrl/⌘+Shift+P`) lets you jump to any view, run Quick Capture, export a backup, create a Weekly Review note, restart onboarding, open a class dashboard, and more.

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘+K` | Global Search (on AP Study, this is *Add subject* instead; in the Notes Editor V2 it is *Insert Link*). |
| `Ctrl/⌘+Shift+P` | Command Palette. |
| `Shift+Ctrl/⌘+F` | Global Search (legacy alternate) across Pages, Notes, Homework, Tasks, Timeline, Attachments, and more. |
| `Alt+Shift+F` | Toggle Focus Mode. |
| `Ctrl/⌘+Shift+M` | Toggle the markdown shortcut on the current selection (where supported). |
| `Tab` / `Shift+Tab` | Indent / outdent list items in the editor. |
| `/` (in editor) | Open the slash command menu. |

## Onboarding & Help

Sutra ships layered help:

1. **Sutra Setup** — the first-launch wizard that follows the student daily loop: Welcome (intent), Classes (add or import), Setup (paste work or starter packs), Mode (student / AP / writer), Protect (backup), and Finish (land on Today). Restart it anytime from `Settings → Advanced → Restart Sutra Setup`.
2. **Starter Packs** — local, preview-then-apply workspace seeds (notes, courses, review decks, timeline blocks, tasks) for goals like AP season, college apps, SAT/ACT, robotics, senior year, research, freelancing, or a personal life system. Apply all or selected parts, with one-tap undo. Open from `Settings → Integrations → Starter Packs` or the All Due empty state. See [Starter Packs](docs/features/STARTER_PACKS.md).
3. **Help & Docs page** — an auto-generated, non-removable page at the top of the page tree, with its own table of contents.
4. **Interactive tutorial** — a guided overlay tour from Settings → Advanced.

A long-form written tutorial lives in the [Sutra Guidebook](SUTRA_GUIDE.md).

## Privacy

- Storage is **local-first** on this device: IndexedDB holds the workspace; localStorage holds settings, health state, and a few caches.
- There is **no Sutra-operated server**. Fresh startup, manual encrypted `.sutra` backup, and JSON backup are designed to make **zero third-party requests**.
- Optional outbound calls happen only when you trigger them: Sutra Cloud/Google Drive OAuth and backup, opt-in Sutra Sync, Sutra Assistant provider requests, approved feedback-form embeds, approved media embeds (YouTube, Vimeo, Spotify, SoundCloud, CodePen, Figma, and YouTube thumbnails), AP Classroom resource links, AI-console help links, ChatGPT/Spotify launch shortcuts, configurable localhost/127.0.0.1 AI endpoints, and secondary document import/export libraries when a browser-native fallback is not enough.
- **API keys are session-only.** They are never persisted, exported, or synced.
- New `.sutra` exports are password-encrypted. JSON exports and document exports are not encrypted. Locked-page PINs protect a page within the browser UI (hashed credentials travel in backups), which is not full-disk encryption.
- Clearing browser storage without a backup will lose your local data.

## Troubleshooting

- **App won't open from `index.html`** — it redirects to `HomePage.html`. If your browser blocks the redirect, open `HomePage.html` or `Sutra.html` directly.
- **A custom CSS snippet or plugin broke the UI** — load Safe Mode (`?sutraSafeMode=1`, hold **Shift** at load, or the in-app Recovery button) and disable the offending snippet/plugin. Nothing is deleted.
- **Sutra Assistant returns 401 / model errors** — re-check the API key for the active provider and the exact Model ID. A wrong Model ID fails at the provider, not in Sutra.
- **An imported backup looks wrong** - a pre-import safety snapshot is written before every workspace import; restore it from `Settings -> Data -> Storage Health`.
- **Tabs are missing** — check `Settings → Packs & advanced → Feature packs` and the active Sutra Mode. Hiding a pack never deletes its data; re-enable it any time.
- **Fonts look different offline** - external web fonts are not requested on startup. Sutra uses local/system fallbacks unless you explicitly host or allow additional font assets.

## Limitations

- **Cloud services are optional and foreground-only.** Sutra Cloud/Google Drive backup and Sutra Sync run only after explicit setup while Sutra is open, online, unlocked, and authorized. They do not run after the browser is fully closed, and direct `file://` launch may not support OAuth.
- **Browser storage caps.** IndexedDB and localStorage quotas vary by browser; very large, media-rich workspaces can hit limits. Export `.sutra` regularly.
- **Document export is native and offline.** PDF uses the browser print pipeline (opens a print-ready view — choose *Save as PDF*); **Word (.docx)** creates a local OOXML package and **Word 97-2003 (.doc)** remains available for legacy workflows. HTML, Markdown, RTF, and TXT are produced locally with no third-party library. PDF can render slightly differently across browsers. See [Document Export](docs/features/DOCUMENT_EXPORT.md).
- **External media embeds** depend on the source's CORS / iframe policy and the approved-origin CSP list.
- **Sutra Assistant Model IDs** must match the provider's exact string; typos fail at the provider.
- **`file://` sandboxing** — some image-upload paths need an `http(s)://` origin; use a static server if you hit this.
- **Document backgrounds in document exports** — HTML export includes the background where feasible and PDF preserves it where browser printing allows; Markdown and plain text omit it cleanly. DOCX/RTF background support is not reliably available and is treated as a known limitation.

## Release Checklist

The canonical pre-release checklist lives at [`docs/release/TESTING_AND_RELEASE_CHECKLIST.md`](docs/release/TESTING_AND_RELEASE_CHECKLIST.md). The repository ships Node-based guards you can run with no dependencies:

```bash
node scripts/smoke-check.mjs            # structural assertions across the app
node scripts/round-trip-check.mjs       # backup export → import fidelity
node scripts/version-history-check.mjs  # note version history
node scripts/sutra-docbg-check.mjs      # document-background data model + export
node scripts/sutra-brand-assets-check.mjs  # brand logos, favicon, derivatives + references
npm run check:csp                       # CSP/static network policy guard
npm run check:persistence               # centralized persistence-health guard
npm run check:modal                     # modal accessibility primitive guard
npm run check:network                   # approved-origin/CDN guard
npm run test:e2e                        # Chromium, Firefox, WebKit Playwright matrix
```

Brand icons are generated from two canonical master PNGs (`assets/brand/sutra/`) with `python scripts/generate-sutra-brand-assets.py` (requires Pillow). Full reference: [`docs/features/BRAND_ASSETS.md`](docs/features/BRAND_ASSETS.md).

Per the release process, the suite also includes rebrand and responsive guards (`scripts/sutra-rebrand-check.mjs`, `scripts/sutra-responsive-check.mjs`) and a `node --check` syntax pass over each `src` JS file. A browser QA harness is provided at `scripts/sutra-persistence-qa.js`.

## License & Attribution

Sutra is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) for the full terms.

You may use, modify, and distribute this project under Apache 2.0. When redistributing or building derivative works, please retain the `LICENSE` and `NOTICE` files in full, clearly indicate that your version has been modified, and use the recommended attribution phrase: **"Based on Sutra by Tanuj Ranjith."** (Sutra was formerly NoteFlow Atelier; the legacy attribution phrase remains accurate for older forks.)

The Sutra name, logo, and official branding should not be used in a way that implies endorsement or official affiliation with the original project. See [`TRADEMARK.md`](TRADEMARK.md) for brand usage guidelines.

> **NoteFlow Classic** is a separate legacy app that lives under `noteflow-classic/`. It is not Sutra and is maintained independently.

Copyright 2026 Tanuj Ranjith.
