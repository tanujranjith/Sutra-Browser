# Sutra Product Context

## What Sutra Is

Sutra is a private, local-first workspace built primarily for students. It brings notes, homework, classes, calendars, study systems, exams, projects, college applications, habits, focus sessions, planning, files, and optional AI assistance into one connected environment.

The core idea is that a student's work should not live as isolated pieces in separate apps. In Sutra, an assignment can belong to a course, appear in deadline views, be scheduled onto the Timeline, become a focus session, connect to notes, generate review material, and influence what Sutra recommends doing next. Sutra is designed as one system with shared context rather than a collection of unrelated utilities.

Sutra is local-first. The normal working workspace lives on the user's device. Core use does not require an account, a Sutra-operated backend, telemetry, a cloud connection, or a remote AI model. Cloud backup, multi-device synchronization, and provider-backed AI are optional capabilities.

Sutra was previously named **NoteFlow Atelier**. Existing NoteFlow Atelier data and legacy backups remain compatible. **NoteFlow Classic** is a separate legacy application.

The name "Sutra" refers to a thread or string, reflecting the idea of weaving the separate threads of academic and personal life into one workspace.

Existing product language includes:

- **Your academic life, woven into one private workspace.**
- **One workspace. Every thread.**
- **PRIVATE · LOCAL-FIRST · STUDENT-BUILT**

Sutra is built by **Tanuj Ranjith**.

## Who Sutra Is For

Sutra is centered on high-school and college students managing classes, homework, tests, AP exams, long-term projects, extracurriculars, college applications, study routines, and personal goals.

It can also serve writers, researchers, planners, freelancers, and other solo users who want structured notes, projects, planning, and lightweight work tools in one private workspace.

Academic workflows are fundamental to Sutra. Homework, courses, studying, deadlines, notes, planning, and focus are designed to work together rather than behave as independent modules.

## Core Product Principles

- **Local-first ownership:** the user's working copy is stored locally and remains useful without a required cloud service.
- **Connected information:** courses, assignments, notes, review decks, calendar blocks, deadlines, projects, and other objects can refer to one another.
- **Useful without AI:** many planning and prioritization systems are deterministic and local. AI is optional.
- **User control:** users control visible features, customization, synchronization, AI access, and whether Assistant-proposed changes are applied.
- **Portability and recovery:** Sutra supports portable workspace backups, imports, snapshots, recovery tools, and legacy compatibility.
- **Modularity:** Sutra Modes, Feature Packs, custom navigation, and customization let users expose only the parts of the workspace they need.

# Main Product Areas

## Home

**Home** is the daily command center. It combines current workload, schedule context, progress, and recommendations.

Key features include:

- **Daily Thread:** summarizes overdue work and items due today, tomorrow, and later in the week.
- **Next Step:** selects one useful action from the workspace based on current signals.
- **Shape My Day:** sequences priorities against calendar availability and can apply the resulting plan to Timeline.
- **Deadline Radar:** gathers deadlines from across Sutra and groups them by when they matter.
- **Quick Capture:** parses natural-language entries such as homework, tests, study blocks, notes, and review tasks and routes them to the relevant area.
- **Momentum:** progress and productivity signals.
- schedule snapshots, habits, completed work, life signals, and academic planning information.

## Timeline

**Timeline** is Sutra's calendar and time-blocking system, with Month, Planner, Week, and Day views. It supports time blocks, categories, colors, recurrence, reference links, a live Current Block, calendar import/export, schedule-aware planning, and moving work onto the calendar directly from other Sutra areas.

## Create

**Create** is Sutra's writing and knowledge workspace.

It supports hierarchical pages, search, tags, favorites, drag-and-drop organization, duplication, icons, breadcrumbs, page links, folders/spaces, and customizable navigation.

The rich editor supports headings, formatting, lists, quotes, code, links, tables, images, audio/video and embeds, checklists, collapsible sections, slash commands, indentation, word count, and autosave.

Additional Create features include:

- **Page Mode** for document-style writing.
- **Document Backgrounds** with blur and dim controls.
- **Handwriting and Drawing** with pen, highlighter, eraser, touch, mouse, and stylus input.
- **Split View** for paired workflows such as Note + Assignment or Essay + Research.
- **Locked Pages** for protecting private notes.
- links between notes and other Sutra entities.
- local document import/export workflows.
- a built-in **Help & Docs** page.

## Canvas

**Canvas** is a freeform visual Create surface with pan/zoom, minimap navigation, drawing, shapes, connectors, grouping, tables, alignment/layout tools, object locking, and local export. Canvas content belongs to its owning Sutra page.

## Slides

**Slides** is a presentation surface inside Create. It supports multiple slides, layouts, themes, speaker notes, local images, presentation mode, printing, local persistence, and experimental PPTX packaging/export workflows.

## Sutra Sheets

**Sutra Sheets** is an integrated local-first spreadsheet surface. It provides workbook-style grids, multiple sheets, cell editing, formulas, common spreadsheet functions, formatting, copy/cut/paste, row and column operations, sorting/finding data, CSV/TSV workflows, and local workspace persistence.

It is intended for useful student and personal spreadsheet workflows inside Sutra rather than complete Excel or Google Sheets parity.

## Homework

**Homework** tracks both academic subjects and extracurricular/activity work. Assignments can include title, course/activity, due date and time, priority, difficulty, notes, and completion state.

**Import from School Portal** lets users paste assignment data copied from school portals, preview parsed rows, correct them, and save them into Sutra.

### Assignment Studio

An assignment can expand into **Assignment Studio**, with milestones, subtasks, rubric information, linked notes/files, effort estimates, revisions, and planning actions. Milestones can surface in All Due and Timeline, and assignments can feed focus plans and review-card generation.

## All Due

**All Due** is a cross-workspace command center for deadline-bearing work. It can combine homework, tasks, assignment milestones, AP exams, review obligations, college deadlines, Timeline blocks, work items, and other signals.

Users can filter and sort work by urgency, importance, grade risk, effort, course, source, due state, and scheduling status. Sutra can explain why an item is prioritized and expose actions such as open, schedule, focus, create review material, complete, or defer.

## Course Hub

**Course Hub** is a dashboard for an individual class. It connects assignments, files, linked notes, review decks, schedule periods, teacher/contact information, academic status, and grade-planning information. A course can also receive a deterministic **Do this next** recommendation.

## Academic Planning

Sutra includes school schedule configuration, semester setup, course-aware planning, assignment decomposition, grade forecasting, workload analysis, and academic-risk signals that feed other planning surfaces.

## AP Study

**AP Study** includes Overview, Units, Sessions, Practice, and Analytics. AP subjects can track exam dates, target scores, confidence, teachers, current units, notes, and course relationships. Units can track topics, progress, and weak areas. Sessions can represent review, FRQ, MCQ, and other study activity.

Sutra uses these signals for exam countdowns, weak-area tracking, practice history, analytics, and **AP Battle Plan** workflows. AP work can surface in Home, All Due, Timeline, Focus, and Review.

## Testing Hub

**Testing Hub** tracks tests and quizzes and connects upcoming assessments with Sutra's academic, planning, and review systems.

## Review

**Review** is Sutra's spaced-repetition and active-recall system. It supports decks, cards, scheduled reviews, multiple study modes, progress/history, and due-review tracking.

**Review Generator** can derive study material from existing Sutra content. Review decks can also be linked to courses.

## College

The **College** area supports college-application management, including schools, statuses, deadlines, essays, scholarships, scores/testing, application tasks, comparison information, and decision-related tracking. College deadlines participate in the broader Sutra planning system.

## Life

Optional **Life** features include habits, sleep, journaling, spending, goals, books, fitness, calories/nutrition, and other personal trackers. These areas are modular and can be hidden when not needed.

## Projects and Work

Sutra includes project and lightweight work/business tools for projects, tasks, clients, invoices, deadlines, and operational follow-ups.

## Focus

The **Focus Timer** is a Pomodoro-style system with reusable templates and session tracking. Work from assignments and planning surfaces can become focus sessions.

A separate **Focus Mode** provides a distraction-reduced writing environment inside Create.

# Sutra Assistant and Sutra Intelligence

## Sutra Assistant

Sutra Assistant is optional and workspace-aware. Users can connect supported AI providers or compatible endpoints and control how much workspace context the Assistant can access.

When the Assistant proposes structured workspace edits, **Suggested Changes** can be individually applied or declined. Applied actions are logged locally and can be undone.

## Local Help

**Local Help** works without a remote AI model. It uses verified local product knowledge to answer feature questions, guide setup, and navigate users around Sutra, including offline.

## Assistant Memory

Sutra can maintain consent-based local Assistant memories for stable preferences and goals. Users can inspect, search, edit, disable, or forget those memories.

## Sutra Intelligence

**Sutra Intelligence** analyzes workspace signals such as overdue work, workload, schedule conflicts, weak areas, review backlog, academic risk, and possible next actions. Much of the planning intelligence is deterministic and local; model-powered interpretation is optional.

# System-Wide Features

## Command Palette

The **Command Palette** provides keyboard-first navigation and actions, including view switching, Quick Capture, backup actions, weekly review creation, course navigation, and setup/help actions.

## Global Search

**Global Search** spans multiple data types across Create, tasks, Homework, AP Study, Review, College, Timeline, trackers, and other areas while respecting privacy boundaries.

## Sutra Modes and Feature Packs

**Sutra Modes** and **Feature Packs** change which areas are emphasized or visible without deleting underlying data.

## Custom Navigation

Sutra includes configurable navigation and custom tabs so users can surface the parts of the workspace they use most.

## Notifications and Reminders

Sutra contains local reminder and notification systems tied to deadlines and workspace rules, using browser capabilities where supported.

## Onboarding and Starter Packs

**Sutra Setup** guides first-time configuration of classes, initial content, mode, protection/backup, and entry into the daily workflow.

**Starter Packs** are preview-before-apply workspace seeds for goals such as AP season, college applications, SAT/ACT preparation, robotics, senior year, research, freelancing, and personal organization.

Sutra also includes an interactive tutorial and in-app Help & Docs.

# Customization

Sutra supports built-in and custom themes, per-page themes, document backgrounds, motion controls, and advanced CSS Overrides.

**Safe Mode** starts Sutra without custom CSS and experimental plugins while preserving the user's data and customization.

An experimental local plugin system lets advanced users run reviewed, permission-limited local plugins inside Sutra.

# Data, Privacy, Backup, Sync, and Recovery

## Local Workspace

The main workspace is stored locally and remains the authoritative working copy.

## `.sutra` Backups

The portable `.sutra` format stores a protected copy of the user's workspace and supported local assets. Sutra also supports legacy NoteFlow Atelier backup compatibility.

## Recovery

Sutra includes storage-health tools, safety snapshots, snapshot browsing, and **Workspace Time Machine** recovery capabilities.

## Google Drive

Users can optionally connect Google Drive for protected workspace snapshot storage. Local browser data remains the working copy and local saving does not depend on Drive availability.

## Sutra Cloud

**Sutra Cloud** is an optional cloud backup/restore layer. It is an additional service around the local workspace rather than the foundation of Sutra.

## Sutra Sync Beta

**Sutra Sync Beta** is the optional multi-device synchronization system. It is designed for protected multi-device continuity while keeping the local workspace authoritative and handling cross-device changes and conflicts deterministically.

Sync Beta is not Google-Docs-style live multi-user collaboration.

# Import, Export, and Interoperability

Depending on the feature, Sutra supports workspace backup/restore, legacy backup import, structured-data import/export, school-portal assignment import, ICS calendar import/export, CSV/TSV spreadsheet workflows, document export, local images and attachments, browser/PWA capture workflows, and companion browser-extension integration.

# Mobile, Offline, Accessibility, and Input

Sutra is responsive across desktop, tablet, and phone layouts. Mobile behavior includes collapsible navigation, compact view switching, small-screen modal layouts, reachable primary actions, touch-friendly controls, and a mobile-aware Assistant.

Sutra includes offline/PWA infrastructure for supported browsers.

Accessibility and input support includes keyboard navigation, visible focus, ARIA semantics, reduced motion, zoom/contrast considerations, larger touch targets, touch interaction, and stylus/touch handwriting.

Common shortcuts include:

- `Ctrl/⌘+K` for Global Search
- `Ctrl/⌘+Shift+P` for Command Palette
- `Alt+Shift+F` for Focus Mode
- `/` in the editor for slash commands
- `Tab` / `Shift+Tab` for list indentation

# What Defines Sutra

Sutra is not only a note editor, homework tracker, calendar, study app, spreadsheet, presentation tool, or AI wrapper. Its defining characteristic is that these systems share one workspace and feed one another.

For example, one Homework assignment can belong to a Course Hub, appear in All Due and Deadline Radar, be scheduled to Timeline, expand into Assignment Studio milestones, become a Focus plan, generate Review material, affect academic/workload prioritization, and influence Home's Next Step. Sutra Assistant can then work with the same permitted context rather than operating as a disconnected chatbot.

A second defining characteristic is local ownership. Sutra is useful before the user connects a cloud service or AI provider. Cloud backup, Sync Beta, and remote AI are optional capabilities around the core local workspace.

A third is breadth with controllable complexity. Sutra contains both quick actions and deep workspaces, but Modes, Feature Packs, navigation customization, and per-page customization allow users to expose only what they need.

# Current Product Boundaries

- Sutra is fundamentally a local-first, single-user workspace. Sync Beta is for multi-device continuity, not live multi-user collaboration.
- Remote AI is optional. Deterministic planning and Local Help remain useful without it.
- Sutra Sheets provides integrated spreadsheet fundamentals, not complete Excel or Google Sheets parity.
- Slides provides integrated presentation workflows, not complete PowerPoint parity.
- Browser storage limits still apply to very large local workspaces.
- Some capabilities work best when Sutra is served over HTTP/HTTPS rather than opened directly as a local file.
- Optional cloud, sync, and external integrations depend on user setup and service/browser availability.

# Important Sutra Terminology

- Sutra
- Home
- Daily Thread
- Next Step
- Shape My Day
- Deadline Radar
- Quick Capture
- Momentum
- Timeline
- Create
- Page Mode
- Canvas
- Slides
- Sutra Sheets
- Homework
- Assignment Studio
- All Due
- Course Hub
- Academic Planning
- AP Study
- AP Battle Plan
- Testing Hub
- Review
- Review Generator
- College
- Life
- Projects / Work
- Focus Timer
- Focus Mode
- Sutra Assistant
- Sutra Intelligence
- Local Help
- Suggested Changes
- Command Palette
- Global Search
- Sutra Modes
- Feature Packs
- Starter Packs
- Help & Docs
- Safe Mode
- Sutra Cloud
- Sutra Sync Beta
- `.sutra` backup
- Workspace Time Machine

# Repository Sources of Truth

More detailed information is maintained throughout the repository, especially:

- `README.md`
- `SUTRA_GUIDE.md`
- `docs/SUTRA_INTELLIGENCE.md`
- `docs/SUTRA_CLOUD_PROVIDERS.md`
- `docs/features/`
- `src/features/`
- `src/core/`
- `tests/`

The current source code and tests are the final authority when documentation and implementation differ.
