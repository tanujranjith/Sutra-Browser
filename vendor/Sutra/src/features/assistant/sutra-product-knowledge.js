// Sutra Product Knowledge Registry — verified, local, offline product facts.
//
// This module is the single source of truth for "what Sutra is and how it
// works." It powers offline product/help answers in Sutra Assistant (the Local
// Intent Router and the Local Help decision tree both read from here) WITHOUT
// any provider call or API key.
//
// Design rules (enforced by tests):
//   - Every entry describes ONLY implemented, reachable functionality.
//   - Each entry declares an `availability`:
//       'available'          — works now, offline, no setup
//       'requires_setup'     — needs a one-time local setup step
//       'requires_provider'  — needs an AI provider + API key (a network call)
//       'not_supported'      — explicitly NOT a thing Sutra does
//   - `nav` (when present) is a CERTIFIED navigation target: a view key the
//     assistant's navigate action understands, plus an optional settings section.
//   - Retrieval is deterministic keyword/title/summary scoring — no embeddings,
//     no network, no telemetry. Adding a feature = one new entry here.
//
// Public surface: window.SutraProductKnowledge (and module.exports for tests).
(function () {
    'use strict';

    const VERSION = '1.1.0';

    // Canonical view keys the navigate action accepts (kept in sync with the
    // assistant action catalog / app router). Used to validate nav targets.
    const KNOWN_VIEWS = [
        'today', 'notes', 'homework', 'courses', 'alldue', 'timeline', 'review',
        'cramhub', 'apstudy', 'testing', 'collegeapp', 'life', 'business', 'settings', 'assistantview'
    ];

    const AVAILABILITY = ['available', 'requires_setup', 'requires_provider', 'not_supported'];

    const AVAILABILITY_LABEL = {
        available: 'Available now',
        requires_setup: 'Requires a quick setup',
        requires_provider: 'Requires an AI provider + API key',
        not_supported: 'Not supported'
    };

    // --------------------------------------------------------------
    // The registry. Order is not significant; retrieval ranks by relevance.
    // --------------------------------------------------------------
    const ENTRIES = [
        {
            id: 'what-is-sutra',
            title: 'What is Sutra?',
            category: 'overview',
            availability: 'available',
            summary: 'Sutra is a private, local-first student workspace — a "student OS" for notes, planning, courses, studying, and college/life/work, all on your device.',
            body: [
                'Sutra is a **private, local-first student operating system**. Everything — your notes, tasks, homework, courses, flashcards, plans, and settings — lives in your browser on your device.',
                'There is no Sutra account and no Sutra server: the app itself never uploads your workspace. You only reach the network when *you* ask Sutra Assistant to use an AI provider you configured, or when you opt in to an encrypted cloud backup.',
                'Sutra bundles a notes editor, a planner, a Homework tracker, a Course Hub, a Timeline, a spaced-repetition Review system, AP study tools, an Assignment Studio, a Grade Planner, and College / Life / Business workspaces.'
            ],
            keywords: ['what is sutra', 'about sutra', 'overview', 'student os', 'local-first', 'private', 'what does sutra do', 'what can sutra do', 'introduction'],
            nav: null,
            relatedActions: [],
            related: ['intelligence-vs-assistant', 'privacy-local-first', 'feature-tour']
        },
        {
            id: 'feature-tour',
            title: 'What can Sutra do? (feature tour)',
            category: 'overview',
            availability: 'available',
            summary: 'Today, Capture, Notes, Canvas, Slides, planner Tasks, Homework, Course Hub, Timeline, All Due, Review/flashcards, Cram Hub, AP Study, Assignment Studio, Grade Planner, College/Life/Business, Themes, Search, Sutra Assistant, and optional Sutra Sync.',
            body: [
                'Sutra\'s main areas:',
                '- **Notes** — rich pages, templates, tags, folders, a freeform **Canvas**, and locked (password-protected) notes.',
                '- **Canvas & Slides** — local visual workspaces that save through the owning note page, with reviewed Assistant edits and encrypted backup/Sync parity.',
                '- **Today & Planner** — daily view, planner tasks, notifications, and a Timeline calendar.',
                '- **Capture & navigation** — one intake path for schoolwork, notes, reminders, study sessions, and time blocks, with calm desktop overflow and a phone All sections sheet.',
                '- **Homework** — assignments by course, with due dates, difficulty, and countdowns.',
                '- **Course Hub** — courses with linked notes, resources, assignments, and class dashboards.',
                '- **All Due** — one command center for every upcoming deadline across the workspace.',
                '- **Review & Cram Hub** — flashcard decks with spaced repetition, plus last-minute cram sessions.',
                '- **AP Study** — AP subjects, exam dates, topics, confidence, and study plans.',
                '- **Assignment Studio** — break big assignments into milestones with their own due dates.',
                '- **Grade Planner** — categories, weights, and deterministic local grade math / what-ifs.',
                '- **College, Life, Business** — applications/essays, life tracking, and professional/business workspaces.',
                '- **Themes** — presets, a custom 6-token theme builder, and AI theme generation.',
                '- **Sutra Assistant** — a contextual AI assistant with Local Help that needs no API key.',
                '- **Sutra Sync Beta** — optional, end-to-end encrypted multi-device replication that is separate from backups and off by default.'
            ],
            keywords: ['features', 'what can sutra do', 'capabilities', 'tour', 'everything', 'list features', 'overview'],
            nav: { view: 'today' },
            relatedActions: [],
            related: ['what-is-sutra', 'notes-pages', 'homework-vs-coursehub', 'review-flashcards']
        },
        {
            id: 'daily-loop-navigation',
            title: 'Today, Capture & adaptive navigation',
            category: 'overview',
            availability: 'available',
            summary: 'Today is the student command center; Capture accepts several kinds of work, while desktop More and mobile All sections preserve access to advanced surfaces.',
            body: [
                '**Today** brings together what is due, what to do next, schedule context, review debt, trackers, and save/backup confidence. **Quick Capture** previews the destination before it creates canonical data.',
                'The default student shell keeps Home, Homework, Create, Timeline, Review, Focus, and Data close at hand. Advanced packs stay available in Settings. Create owns the contextual page tree; other sections use the full workspace by default.',
                'On phones, the unified bottom bar and **All sections** sheet route through the same canonical tabs as desktop overflow.'
            ],
            keywords: ['today', 'capture', 'quick capture', 'navigation', 'all sections', 'more menu', 'mobile navigation', 'daily loop'],
            nav: { view: 'today' },
            relatedActions: ['navigate'],
            related: ['what-is-sutra', 'feature-tour', 'timeline']
        },
        {
            id: 'canvas-slides',
            title: 'Canvas & Slides',
            category: 'notes',
            availability: 'available',
            summary: 'Canvas and Slides are local-first visual Create surfaces that save through the owning page and support reviewed Assistant edits.',
            body: [
                '**Canvas** provides pan/zoom, a minimap, selection, drawing, shapes, sticky notes, connectors, groups, tables, locking, layout tools, and local export.',
                '**Slides** stores a deck on `page.slides` with themes, layouts, text, shapes, charts, local images, speaker notes, presentation mode, printing, and an experimental PPTX package export.',
                'Both use canonical page saves and participate in encrypted `.sutra` backup/import and Sutra Sync. Assistant mutations are bounded, approval-based, and undoable; Assistant mutations to locked content and remote image fetches are not supported.'
            ],
            keywords: ['canvas', 'slides', 'visual workspace', 'presentation', 'speaker notes', 'PPTX', 'board', 'minimap'],
            nav: { view: 'notes' },
            relatedActions: ['navigate'],
            related: ['notes-pages', 'assistant-providers', 'export-import']
        },
        {
            id: 'sync-beta',
            title: 'Sutra Sync Beta',
            category: 'backup',
            availability: 'requires_setup',
            summary: 'Optional end-to-end encrypted multi-device replication that is off by default and separate from point-in-time backups.',
            body: [
                'Sutra Sync is **off by default**. The availability notice, sign-in, reload, and restore do not enable it; only explicit setup and **Turn on sync** do.',
                'Sync encrypts operations, snapshots, conflicts, and required attachment bytes on the device. It supports offline outbox replay, deterministic conflict review, account-scoped device state, and revoke-and-wipe on a verified next connection.',
                'Keep an encrypted `.sutra` backup. Sync replicates changes, including mistakes; it is not a replacement for point-in-time backup. The passphrase and recovery kit are required to recover synced data.'
            ],
            keywords: ['sutra sync', 'sync beta', 'multi-device', 'encrypted sync', 'conflicts', 'revoke wipe', 'sync passphrase'],
            nav: { view: 'settings', section: 'backup' },
            relatedActions: ['navigate'],
            related: ['cloud-backup', 'encrypted-backup', 'privacy-local-first']
        },
        {
            id: 'intelligence-vs-assistant',
            title: 'Sutra Intelligence vs Sutra Assistant',
            category: 'assistant',
            availability: 'available',
            summary: 'Sutra Intelligence is the on-device thinking layer (signals, deterministic answers, Local Help). Sutra Assistant is the chat surface; it adds an AI provider only when you ask it to.',
            body: [
                '**Sutra Intelligence** is the local, on-device layer. It reads your workspace to compute signals (overdue work, schedule conflicts, review debt, grade risk), answers product questions from a verified knowledge registry, runs the Local Help decision tree, and does deterministic math. It never makes a network call.',
                '**Sutra Assistant** is the chat panel you talk to. For anything Intelligence can answer locally, it answers locally with no API key. Only when a request truly needs generation (drafting, explaining, transforming, open-ended reasoning) does it send a message to the AI provider *you* configured.',
                'In short: Intelligence = brains on your device; Assistant = the conversation, which can optionally call a provider you chose.'
            ],
            keywords: ['intelligence', 'assistant', 'difference', 'vs', 'local layer', 'what is intelligence', 'what is the assistant'],
            nav: { view: 'assistantview' },
            relatedActions: [],
            related: ['local-help', 'privacy-local-first', 'assistant-providers']
        },
        {
            id: 'privacy-local-first',
            title: 'Does Sutra send my data to a server?',
            category: 'privacy',
            availability: 'available',
            summary: 'No. Sutra is local-first with no backend. Data leaves your device only when you send an AI request to a provider you configured, or opt in to encrypted cloud backup. API keys are session-only by default, or encrypted in the optional device-local vault, and never exported.',
            body: [
                '**Sutra itself makes no server calls and has no backend.** Your workspace stays in your browser on your device.',
                'Data leaves your device only in two cases, both under your control:',
                '1. **You send an AI request.** Sutra Assistant sends your message (plus the workspace context allowed by your Workspace Access setting) to the AI provider *you* chose and entered a key for. Locked-note contents are excluded by default; an explicitly requested locked page requires one-time Assistant consent and its page PIN. API keys are never included.',
                '2. **You opt in to cloud backup.** Encrypted `.sutra` snapshots can be synced to a provider you connect (Google Drive, OneDrive, Dropbox, or Supabase). They are encrypted on your device first.',
                'Local Help, Product Knowledge, Assistant Memory, and deterministic calculations all work fully **offline with no API key**. API keys are session-only by default; if you opt in to remembering them, Sutra keeps only encrypted device-local vault records. Keys are never written to `.sutra` exports, Activity logs, Memory, diagnostics, or any prompt.'
            ],
            keywords: ['privacy', 'server', 'data', 'upload', 'cloud', 'send my data', 'tracking', 'telemetry', 'offline', 'local', 'secure', 'safe', 'api key'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: [],
            related: ['workspace-access', 'export-import', 'cloud-backup', 'assistant-memory']
        },
        {
            id: 'notes-pages',
            title: 'Notes, pages, templates, tags & Canvas',
            category: 'notes',
            availability: 'available',
            summary: 'Create rich note pages with templates and tags, organize them in folders, draw on a freeform Canvas, and lock sensitive notes behind a password.',
            body: [
                'Open **Notes** to write rich pages with Markdown-style formatting, tables, code, and math.',
                '- **Templates** give you starting points (lecture notes, study session, exam prep, project, and more).',
                '- **Tags & folders** organize pages; links connect a note to tasks, homework, decks, courses, and timeline blocks.',
                '- **Canvas** is a freeform board for sticky notes and cards; you can turn a selection into a note or task.',
                '- **Slides** is a local presentation surface on a normal note page. Decks keep themes, layouts, speaker notes, local images, and presentation state in `page.slides` and use the normal backup path.',
                '- **Locked notes** are protected by a password. Their contents are excluded from Assistant context by default; an explicitly requested page requires one-time Assistant consent and its page PIN. Locked content is never saved into Assistant Memory or readable `.sutra` exports.'
            ],
            keywords: ['notes', 'pages', 'note', 'templates', 'tags', 'canvas', 'sticky', 'folders', 'locked notes', 'write', 'editor', 'markdown'],
            nav: { view: 'notes' },
            relatedActions: ['create_page', 'append_note_text', 'navigate'],
            related: ['locked-notes', 'feature-tour']
        },
        {
            id: 'locked-notes',
            title: 'Locked (password-protected) notes',
            category: 'notes',
            availability: 'available',
            summary: 'Lock a note with a password to keep its contents private. Locked content is excluded from Assistant context by default; an explicitly requested page requires one-time Assistant consent and its page PIN. It is never saved in Memory or readable exports.',
            body: [
                'You can lock individual notes behind a password. While locked, the note body is hidden until you unlock it.',
                'Sutra excludes locked content from ordinary Assistant context. If you explicitly ask about an identified locked page, Assistant asks for one-time permission and verifies the page PIN before using it for that request. The grant does not unlock the editor, change saved privacy settings, or authorize a later request. Locked content is never saved into Assistant Memory or included in readable form in `.sutra` exports.'
            ],
            keywords: ['locked notes', 'password', 'private note', 'protect note', 'lock', 'encrypt note'],
            nav: { view: 'notes' },
            relatedActions: [],
            related: ['notes-pages', 'privacy-local-first']
        },
        {
            id: 'planner-tasks',
            title: 'Today, planner tasks & notifications',
            category: 'planner',
            availability: 'available',
            summary: 'The planner holds your tasks with due dates, priority, and categories. Home shows what matters now; notifications remind you of deadlines.',
            body: [
                '**Today** is your daily home: it surfaces what is due and what to work on now.',
                '**Planner tasks** have a title, optional due date and time, priority, category, and links to notes or courses. You can complete, reopen, reschedule, reprioritize, or archive them.',
                'Planner tasks are distinct from **Homework** assignments — Homework rows can mirror into the planner, but the assistant treats the authoritative Homework row and its planner mirror as one item so nothing is double-counted.',
                'Notifications remind you about upcoming deadlines and planner items.'
            ],
            keywords: ['today', 'planner', 'tasks', 'task', 'to-do', 'todo', 'due date', 'priority', 'notifications', 'reminders', 'schedule task'],
            nav: { view: 'today' },
            relatedActions: ['create_task', 'update_task_status', 'reschedule_tasks', 'change_task_priority', 'navigate'],
            related: ['homework-vs-coursehub', 'timeline', 'all-due']
        },
        {
            id: 'homework-vs-coursehub',
            title: 'Homework vs Course Hub',
            category: 'planner',
            availability: 'available',
            summary: 'Homework is the fast deadline list — assignments by course with due dates. Course Hub is the home for each course: linked notes, resources, assignments, and a class dashboard.',
            body: [
                '**Homework** is the lightweight assignment tracker: a list of what is due, grouped by course, with due dates, difficulty, and countdowns. Use it to capture and clear day-to-day work quickly.',
                '**Course Hub** is the deeper, per-course workspace. Each course gathers its **linked notes**, **resource links**, **assignments**, and a **class dashboard** that pulls everything about that class into one place.',
                'They are connected: creating a course in the Course Hub also bridges to Homework, and a course\'s assignments show up in Homework and All Due. Think of Homework as the *deadline feed* and Course Hub as the *course home*.'
            ],
            keywords: ['homework', 'course hub', 'courses', 'difference', 'vs', 'class', 'course', 'assignments', 'homework vs course'],
            nav: { view: 'homework' },
            relatedActions: ['create_homework', 'create_course', 'create_assignment_for_course', 'navigate_to_course', 'navigate'],
            related: ['planner-tasks', 'all-due', 'course-hub']
        },
        {
            id: 'course-hub',
            title: 'Course Hub & class dashboards',
            category: 'courses',
            availability: 'available',
            summary: 'Create courses, attach assignments, link notes and resources, and open a class dashboard for each course.',
            body: [
                'In the **Course Hub** you create a course (class, AP, activity, or self-study), then build it out:',
                '- add **assignments** with due dates and difficulty,',
                '- **link notes** so lecture pages live with the class,',
                '- add **resource links** (textbook sites, syllabi, drives),',
                '- open the **class dashboard** to see everything for that course at once.',
                'Courses can be archived and unarchived. Creating a course also bridges into Homework so its assignments appear in your deadline feeds.'
            ],
            keywords: ['course hub', 'course', 'class', 'class dashboard', 'create course', 'link note', 'resource', 'assignment'],
            nav: { view: 'courses' },
            relatedActions: ['create_course', 'create_assignment_for_course', 'add_resource_link_to_course', 'link_note_to_course', 'archive_course', 'open_class_dashboard', 'navigate_to_course'],
            related: ['homework-vs-coursehub', 'all-due']
        },
        {
            id: 'all-due',
            title: 'All Due — every deadline in one place',
            category: 'planner',
            availability: 'available',
            summary: 'All Due aggregates upcoming deadlines from tasks, homework, courses, and more into a single command center.',
            body: [
                '**All Due** is the workspace-wide deadline command center. It pulls together upcoming work from planner tasks, Homework, course assignments, exams, and other dated items so you can see — and triage — everything due in one list.'
            ],
            keywords: ['all due', 'alldue', 'deadlines', 'everything due', 'upcoming', 'deadline radar', 'what is due'],
            nav: { view: 'alldue' },
            relatedActions: ['navigate_to_all_due', 'run_deadline_radar', 'navigate'],
            related: ['planner-tasks', 'timeline', 'homework-vs-coursehub']
        },
        {
            id: 'timeline',
            title: 'Timeline (calendar scheduling)',
            category: 'planner',
            availability: 'available',
            summary: 'The Timeline is your calendar of time blocks. Schedule study and work sessions, link them to tasks, and let Sutra detect conflicts.',
            body: [
                'The **Timeline** is a calendar of **time blocks**. Each block has a date, start, and end, and can be linked to a task or homework item. Month, Week, and Day views adapt to phone screens; Month uses event counts on narrow devices.',
                'You can schedule existing work onto the Timeline, and Sutra detects **overlaps** and unrealistic back-to-back blocks locally. **Push time** shifts blocks atomically with undo, and local `.ics` import uses a preview, source-scoped re-import, backlog limits, and no reminder generation.'
            ],
            keywords: ['timeline', 'calendar', 'schedule', 'time block', 'blocks', 'plan time', 'conflicts', 'overlap'],
            nav: { view: 'timeline' },
            relatedActions: ['create_timeline_block', 'update_timeline_block', 'delete_timeline_block', 'schedule_existing_item', 'plan_day', 'plan_week', 'navigate'],
            related: ['planner-tasks', 'plans', 'all-due']
        },
        {
            id: 'review-flashcards',
            title: 'How do I make flashcards? (Review & spaced repetition)',
            category: 'study',
            availability: 'available',
            summary: 'Open Review to create a deck and add cards (front/back). Sutra schedules them with spaced repetition so you review at the right time.',
            body: [
                'Flashcards live in **Review**. To make them:',
                'You can also ask Sutra Assistant to "turn this note into flashcards" — it proposes a deck you confirm before anything is created.'
            ],
            steps: [
                'Open **Review** from the sidebar.',
                'Create a new **deck** and give it a name.',
                'Add **cards** with a front (prompt) and back (answer).',
                'Study the deck — Sutra uses **spaced repetition** to resurface cards over time.'
            ],
            keywords: ['flashcards', 'flash cards', 'review', 'spaced repetition', 'deck', 'cards', 'make flashcards', 'study cards', 'memorize', 'anki'],
            nav: { view: 'review' },
            relatedActions: ['create_review_deck', 'add_review_cards', 'schedule_review_session', 'convert_note_to_study_system', 'navigate'],
            related: ['cram-hub', 'ap-study']
        },
        {
            id: 'cram-hub',
            title: 'Cram Hub',
            category: 'study',
            availability: 'available',
            summary: 'Cram Hub is for last-minute, high-intensity review sessions on a topic before a test.',
            body: [
                '**Cram Hub** is built for the final push before a test. Add a cram session for a topic (optionally over a number of days) and Sutra helps you focus your last-minute review.'
            ],
            keywords: ['cram', 'cram hub', 'cramhub', 'last minute', 'before test', 'cram session'],
            nav: { view: 'cramhub' },
            relatedActions: ['create_cram_session', 'navigate'],
            related: ['review-flashcards', 'ap-study']
        },
        {
            id: 'ap-study',
            title: 'AP Study',
            category: 'study',
            availability: 'available',
            summary: 'Track AP subjects, exam dates, topics, and confidence. Sutra flags shaky subjects with an exam soon and helps build exam plans.',
            body: [
                '**AP Study** tracks your AP subjects with exam dates, topics, and a confidence level per subject.',
                'Sutra Intelligence flags **low-confidence subjects with an exam in the next few weeks** and can help you build an exam plan (study blocks + a review deck) linked to the subject.'
            ],
            keywords: ['ap', 'ap study', 'apstudy', 'ap exam', 'exam', 'advanced placement', 'exam plan', 'confidence'],
            nav: { view: 'apstudy' },
            relatedActions: ['create_exam_plan', 'navigate'],
            related: ['review-flashcards', 'grade-planner', 'plans']
        },
        {
            id: 'assignment-studio',
            title: 'Assignment Studio (milestones)',
            category: 'study',
            availability: 'available',
            summary: 'Break a big assignment into milestones (drafts, builds, rehearsals) with their own due dates leading up to the deadline.',
            body: [
                '**Assignment Studio** turns a large assignment into a sequence of **milestones** — for example outline → draft → revision → final — each with its own due date scheduled backward from the deadline.',
                'You can ask the assistant to break a homework item into milestones; it proposes them for your confirmation.'
            ],
            keywords: ['assignment studio', 'milestones', 'milestone', 'break down', 'subtasks', 'big project', 'essay plan', 'drafts'],
            nav: { view: 'homework' },
            relatedActions: ['add_assignment_milestones', 'create_assignment_plan', 'navigate'],
            related: ['homework-vs-coursehub', 'plans']
        },
        {
            id: 'grade-planner',
            title: 'Grade Planner (deterministic local grade math)',
            category: 'grades',
            availability: 'available',
            summary: 'Set up categories and weights per course, then compute current grades, what-ifs, and the score you need — all calculated locally, never by an AI.',
            body: [
                'The **Grade Planner** holds each course\'s categories, weights, and scores. Sutra computes everything **deterministically on your device**:',
                '- your current grade,',
                '- a **what-if** ("if I score 85 on the final…"),',
                '- the score you **need** to reach a target,',
                '- which **missing work** matters most.',
                'Grade math is always local — the AI never computes grades. If you ask the assistant a grade question, it runs the local Grade Planner calculation and shows the result.'
            ],
            keywords: ['grade', 'grades', 'grade planner', 'gpa', 'what if', 'what-if', 'target grade', 'final grade', 'score needed', 'weighted', 'how am i doing'],
            nav: { view: 'settings' },
            relatedActions: ['run_grade_what_if', 'solve_target_grade', 'rank_missing_work_by_grade_impact', 'explain_grade_risk'],
            related: ['ap-study', 'feature-tour']
        },
        {
            id: 'plans',
            title: 'Plans: day, week, study, exam & recovery',
            category: 'planner',
            availability: 'available',
            summary: 'Sutra can build day/week plans, study plans, exam plans, and catch-up recovery plans by spreading your work across free time. You approve every block before it is scheduled.',
            body: [
                'Sutra\'s planning engine builds plans from your real workload and free time:',
                '- **Plan my day / week** spreads open work across free time before each due date.',
                '- **Study & exam plans** reverse-schedule study sessions before tests and can include a review deck.',
                '- **Recovery / catch-up plans** rebuild your week when you fall behind or miss school.',
                'Plans are proposed block-by-block — **nothing is scheduled until you approve it.**'
            ],
            keywords: ['plan', 'plan my week', 'plan my day', 'study plan', 'exam plan', 'recovery plan', 'catch up', 'schedule my work', 'planning'],
            nav: { view: 'timeline' },
            relatedActions: ['plan_day', 'plan_week', 'create_study_plan', 'create_exam_plan', 'create_recovery_plan', 'triage_deadlines'],
            related: ['timeline', 'ap-study', 'assignment-studio']
        },
        {
            id: 'college-life-business',
            title: 'College, Life & Business workspaces',
            category: 'overview',
            availability: 'available',
            summary: 'Beyond academics, Sutra includes a College workspace (applications, essays, deadlines), a Life workspace, and a Business workspace.',
            body: [
                '- **College** — track applications, essays, scholarships, and college deadlines and tasks.',
                '- **Life** — a personal workspace for life tracking and journaling.',
                '- **Business** — a professional/business workspace for work projects.',
                'All three persist in your workspace and travel inside a `.sutra` export like everything else.'
            ],
            keywords: ['college', 'life', 'business', 'applications', 'essays', 'scholarship', 'work', 'professional', 'workspaces'],
            nav: { view: 'collegeapp' },
            relatedActions: ['create_college_task', 'navigate'],
            related: ['feature-tour', 'export-import']
        },
        {
            id: 'themes',
            title: 'Themes & AI theme generation',
            category: 'customization',
            availability: 'available',
            summary: 'Pick a theme preset, build a custom theme from 6 color tokens, or describe a vibe and let Sutra generate a theme you can preview before applying.',
            body: [
                'Open **Settings ▸ Appearance/Themes** to change how Sutra looks.',
                '- Choose a **preset** theme.',
                '- Build a **custom theme** from six color tokens.',
                '- **Generate a theme** by describing a vibe ("make Sutra feel like a foggy forest"). Sutra creates a palette with a contrast/readability guard, shows a **preview**, and lets you refine, **Apply**, or **Revert** — nothing changes until you apply.',
                'Theme generation reuses the same custom-theme pipeline and works through the assistant\'s dedicated theme flow.'
            ],
            keywords: ['theme', 'themes', 'dark mode', 'light mode', 'colors', 'appearance', 'customize', 'look', 'generate theme', 'custom theme'],
            nav: { view: 'settings', section: 'appearance' },
            relatedActions: ['navigate'],
            related: ['feature-tour', 'customize']
        },
        {
            id: 'customize',
            title: 'Customize Sutra (settings & accessibility)',
            category: 'customization',
            availability: 'available',
            summary: 'Settings let you set your start view, calendar and task preferences, appearance/motion, notifications, and assistant behavior.',
            body: [
                'Open **Settings** to tailor Sutra: default start view, calendar/time format, task sorting, appearance and motion intensity, notification preferences, and Sutra Assistant behavior (context depth, confirmation, memory).',
                'All preferences are stored locally and travel inside a `.sutra` export.'
            ],
            keywords: ['settings', 'customize', 'preferences', 'configure', 'options', 'accessibility', 'motion', 'start view'],
            nav: { view: 'settings' },
            relatedActions: ['navigate'],
            related: ['themes', 'assistant-settings']
        },
        {
            id: 'search',
            title: 'Search your workspace',
            category: 'overview',
            availability: 'available',
            summary: 'Use global search to find notes, tasks, courses, and more across your workspace.',
            body: [
                'Global search scans your workspace — notes, tasks, courses, and other items — so you can jump straight to what you need. You can also ask the assistant to "search for …".'
            ],
            keywords: ['search', 'find', 'lookup', 'global search', 'command palette'],
            nav: null,
            relatedActions: [],
            related: ['feature-tour']
        },
        {
            id: 'assistant-providers',
            title: 'Sutra Assistant: providers, API keys & models',
            category: 'assistant',
            availability: 'requires_provider',
            summary: 'Connect an AI provider (OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral, Together, DeepSeek, xAI, Perplexity, or a local endpoint) by adding its API key in Settings, then pick a model.',
            body: [
                'Sutra Assistant can use the AI provider **you** choose. Supported providers include **OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral AI, Together AI, DeepSeek, xAI, Perplexity**, and **local / OpenAI-compatible endpoints** (e.g. Ollama, LM Studio).',
                'To enable AI chat: open **Settings ▸ Integrations**, paste the provider\'s **API key**, then choose a **model**. Keys are kept for the session only and are never exported, logged, or put into prompts.',
                'Local endpoint URLs are validated and remain device-local. Sutra sends a request only after you choose that provider and model; the endpoint is not included in workspace backups or Sync.',
                'You do **not** need a key for product help, Local Help, navigation, deterministic answers, or Memory — those run locally.'
            ],
            keywords: ['provider', 'providers', 'api key', 'openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'deepseek', 'xai', 'perplexity', 'ollama', 'local model', 'connect ai', 'enable ai'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['navigate'],
            related: ['change-model', 'workspace-access', 'privacy-local-first']
        },
        {
            id: 'change-model',
            title: 'Where do I change my assistant model?',
            category: 'assistant',
            availability: 'requires_provider',
            summary: 'Change the provider and model from the Assistant panel\'s model picker, or in Settings ▸ Integrations / Assistant.',
            body: [
                'Open the **Sutra Assistant** panel and use the **model picker** (the provider/model chip in the chat) to switch provider or model.',
                'You can also manage providers, keys, and the active model in **Settings ▸ Integrations** (keys) and **Settings ▸ Assistant** (behavior).'
            ],
            keywords: ['change model', 'switch model', 'model', 'pick model', 'select model', 'which model', 'change provider', 'model picker'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['navigate'],
            related: ['assistant-providers', 'assistant-settings']
        },
        {
            id: 'assistant-settings',
            title: 'Assistant settings & behavior',
            category: 'assistant',
            availability: 'available',
            summary: 'Settings ▸ Assistant controls panel behavior, context depth (Workspace Access), confirmation mode, conversation memory depth, action previews, and long-term Assistant Memory.',
            body: [
                'In **Settings ▸ Assistant** you control how the assistant works:',
                '- **Workspace Access / context depth** — how much of your workspace it can read.',
                '- **Confirmation & action previews** — whether proposed actions need explicit approval.',
                '- **Conversation memory** — how many recent messages it remembers within a session.',
                '- **Assistant Memory** — manage the long-term facts it remembers across sessions.'
            ],
            keywords: ['assistant settings', 'assistant behavior', 'confirmation', 'context depth', 'workspace access', 'conversation memory', 'action previews'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['navigate', 'change_context_depth'],
            related: ['workspace-access', 'assistant-memory', 'activity-undo']
        },
        {
            id: 'assistant-answer-receipts',
            title: 'How this was answered receipts',
            category: 'assistant',
            availability: 'available',
            summary: 'Each Assistant answer has a keyboard-accessible disclosure showing local/provider handling, workspace scope, sources, memory influence, attachments, actions, and transmission categories.',
            body: [
                'Open **How this was answered** under an Assistant response to inspect its provenance.',
                'Local answers say **Answered locally** and **No provider contacted**. Provider answers name the provider/model, Workspace Access, selected text or conversation use, live-validated sources, attachment processing paths, deterministic engines, proposed actions, and information categories transmitted.',
                'Deleted sources become **Source no longer available** with no deep link. Receipts never reveal API keys, tokens, locked-note bodies, sensitive memory text, raw prompts/context, or provider reasoning.'
            ],
            keywords: ['how was this answered', 'receipt', 'provenance', 'sources used', 'data transmitted', 'provider contacted', 'context sent', 'privacy disclosure'],
            nav: { view: 'assistantview' },
            relatedActions: [],
            related: ['workspace-access', 'privacy-local-first', 'assistant-memory']
        },
        {
            id: 'assistant-tutoring-modes',
            title: 'Structured tutoring modes',
            category: 'assistant',
            availability: 'requires_provider',
            summary: 'Provider-connected modes support explanations, progressive hints, attempt checking, one-question-at-a-time quizzes, mistake diagnosis, practice, Review cards, study plans, rubric feedback, summaries, and teaching from selected materials.',
            body: [
                'Choose **Explain, Hint First, Check My Attempt, Quiz Me, Diagnose My Mistake, Create Practice, Turn This Into Review Cards, Build a Study Plan, Compare My Work to a Rubric, Summarize My Notes,** or **Teach From My Materials** in the Assistant.',
                'These are provider-backed generative modes. Without a provider Sutra does not simulate a free-text tutor; Guided Local Mode offers Connect a provider, local study tools, Review, Testing Hub, Notes, and Back.',
                'For likely active assessments Sutra offers hints, concept help, attempt checking, or analogous practice. It never fabricates citations, quotes, interviews, experiments, or data.'
            ],
            keywords: ['tutor', 'tutoring', 'hint first', 'check my attempt', 'quiz me', 'diagnose mistake', 'practice questions', 'rubric feedback', 'teach from materials'],
            nav: { view: 'assistantview' },
            relatedActions: ['navigate'],
            related: ['assistant-providers', 'local-help', 'action-confirmation']
        },
        {
            id: 'workspace-access',
            title: 'Workspace Access (context depth)',
            category: 'assistant',
            availability: 'available',
            summary: 'Workspace Access controls how much context the assistant can read: minimal, current view only, or full workspace. Locked notes are excluded by default and require a separate one-time consent and page-PIN check when explicitly requested.',
            body: [
                '**Workspace Access** (context depth) decides what the assistant can see when you send an AI request:',
                '- **Minimal** — almost nothing beyond your message.',
                '- **Current view** — only what is on the active screen / current area.',
                '- **Full workspace** — broad context across your workspace.',
                'Locked-note contents are excluded by default at every depth. An explicit request about an identified locked page starts a separate one-time permission and page-PIN check; that grant applies only to the current request. API keys are never included. Change context depth in Settings ▸ Assistant or by asking the assistant.'
            ],
            keywords: ['workspace access', 'context depth', 'minimal', 'current view', 'full workspace', 'how much context', 'what can it see'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['change_context_depth', 'navigate'],
            related: ['assistant-settings', 'privacy-local-first']
        },
        {
            id: 'action-confirmation',
            title: 'Action proposals, confirmation, Activity & Undo',
            category: 'assistant',
            availability: 'available',
            summary: 'The assistant proposes app actions as preview cards you Apply or Decline. Applied actions are recorded in Activity and can usually be Undone.',
            body: [
                'When the assistant wants to change your workspace, it proposes **action cards** with a preview. You **Apply** or **Decline** each one — previews never change anything on their own.',
                'High-risk and destructive actions (like deleting a timeline block) **always** require explicit confirmation.',
                'Every applied action is written to the **Activity** log, and most actions support **Undo** ("undo that").'
            ],
            keywords: ['action', 'actions', 'apply', 'decline', 'confirm', 'confirmation', 'activity', 'activity log', 'undo', 'preview', 'proposal'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['navigate'],
            related: ['assistant-settings', 'assistant-memory']
        },
        {
            id: 'activity-undo',
            title: 'Activity log & Undo',
            category: 'assistant',
            availability: 'available',
            summary: 'The Activity log lists actions the assistant applied; many can be undone. Open it from Settings ▸ Assistant.',
            body: [
                'The **Activity** log records each action the assistant applied to your workspace, with enough detail to **Undo** it where technically safe.',
                'Say "undo that" to reverse the most recent reversible action, or open the Activity log from Settings ▸ Assistant to review and undo specific entries.'
            ],
            keywords: ['activity', 'activity log', 'undo', 'history', 'reverse', 'revert action'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['navigate'],
            related: ['action-confirmation', 'assistant-memory']
        },
        {
            id: 'assistant-memory',
            title: 'How does Assistant Memory work?',
            category: 'assistant',
            availability: 'available',
            summary: 'Assistant Memory stores stable facts you ask it to remember (study hours, goals, preferences) across sessions. It is local, user-controlled, and never saves secrets or private note content.',
            body: [
                '**Assistant Memory** is long-term, on-device memory the assistant uses to personalize help across sessions. It is separate from short-term conversation memory.',
                'It remembers **only stable, useful facts you ask it to keep** — for example preferred study hours, planning style, recurring commitments, course preferences, goals, upcoming exams, or how you like explanations.',
                'It is consent-first: the assistant saves a memory only when you ask, or suggests one with **Save / Edit / Decline**. It never silently stores passwords, API keys, financial or medical data, precise location, locked-note content, or full chat transcripts.',
                'You stay in control: **view, edit, enable/disable, delete, or forget** any memory from the Memory manager. "Forget X" and "delete that memory" take effect immediately, and allowed memories travel inside encrypted `.sutra` exports.'
            ],
            keywords: ['memory', 'assistant memory', 'remember', 'forget', 'what do you remember', 'long-term memory', 'remember me', 'manage memory', 'preferences memory'],
            nav: { view: 'settings', section: 'assistant' },
            relatedActions: ['create_memory', 'update_memory', 'disable_memory', 'enable_memory', 'delete_memory', 'open_memory_manager', 'navigate'],
            related: ['assistant-settings', 'privacy-local-first', 'export-import']
        },
        {
            id: 'local-help',
            title: 'Local Help (no API key required)',
            category: 'assistant',
            availability: 'available',
            summary: 'Local Help is a click-through, multiple-choice help mode that works offline with no API key — answers, setup guidance, and navigation, all on-device.',
            body: [
                '**Local Help** lets you get answers without typing or any AI provider. Pick from multiple-choice options and Sutra shows a local answer plus follow-up choices, navigation buttons ("Open in Sutra"), and setup guidance.',
                'It works when no provider is selected, no API key is entered, or you are offline. Answers come from the verified Product Knowledge registry — they are **not** AI-generated. Where a generative follow-up could help, Local Help offers "Use provider instead," which only calls a provider if you choose it.'
            ],
            keywords: ['local help', 'help', 'no api key', 'offline help', 'how do i', 'guide me', 'multiple choice', 'answered locally', 'on-device'],
            nav: { view: 'assistantview' },
            relatedActions: [],
            related: ['intelligence-vs-assistant', 'privacy-local-first']
        },
        {
            id: 'export-import',
            title: 'Import & export your workspace (.sutra)',
            category: 'backup',
            availability: 'available',
            summary: 'A .sutra export is a complete workspace backup — notes, tasks, homework, courses, review, grades, memory, settings, and more. Import restores it into a clean Sutra. API keys are never included.',
            body: [
                'A **`.sutra` export** is a full workspace backup, not just notes. It includes your notes/pages/Canvas, planner tasks, Homework, Course Hub, Timeline, Review decks and spaced-repetition state, AP Study, Assignment Studio, Grade Planner, College/Life/Business, themes, settings, Activity log, and **Assistant Memory**.',
                'It **never** includes secrets: API keys, access tokens, passwords, and session credentials are deliberately excluded.',
                'To restore, import the `.sutra` file into a clean Sutra session. Import validates the file first, migrates older exports, tolerates missing or newer sections, and avoids creating duplicate tasks/homework/cards.'
            ],
            steps: [
                'Open **Settings**.',
                'Go to **Backups & Export**.',
                'Choose **Export** to save a `.sutra` file (optionally encrypted), or **Import** to restore one.'
            ],
            keywords: ['export', 'import', 'backup', 'restore', '.sutra', 'sutra file', 'save workspace', 'move to new device', 'transfer'],
            nav: { view: 'settings', section: 'backup' },
            relatedActions: ['navigate'],
            related: ['encrypted-backup', 'cloud-backup', 'assistant-memory']
        },
        {
            id: 'encrypted-backup',
            title: 'How do I back up my workspace? (encrypted .sutra)',
            category: 'backup',
            availability: 'available',
            summary: 'Back up locally with an encrypted .sutra export: open Settings ▸ Backups & Export and choose encrypted export. It is encrypted on your device with your passphrase.',
            body: [
                'You can back up your workspace locally, fully on-device.',
                'An **encrypted `.sutra` export** is protected with AES-256-GCM using a key derived from your passphrase (PBKDF2). Keep the passphrase safe — without it the backup cannot be opened.'
            ],
            steps: [
                'Open **Settings**.',
                'Go to **Backups & Export**.',
                'Choose **encrypted `.sutra` export** and set a passphrase.'
            ],
            keywords: ['back up', 'backup', 'encrypted', 'encrypt backup', 'passphrase', 'save my work', 'protect workspace', 'how do i back up'],
            nav: { view: 'settings', section: 'backup' },
            relatedActions: ['navigate'],
            related: ['export-import', 'cloud-backup']
        },
        {
            id: 'cloud-backup',
            title: 'Cloud backup (optional, consent-first)',
            category: 'backup',
            availability: 'requires_setup',
            summary: 'You can optionally store encrypted .sutra snapshots with Google Drive, OneDrive, Dropbox, Supabase, or other configured Sutra Cloud providers. It is opt-in and separate from Sutra Sync.',
            body: [
                'Cloud backup is **optional and consent-first**. If you connect a provider — **Google Drive, OneDrive, Dropbox, Supabase**, or another supported Sutra Cloud destination — Sutra can store encrypted `.sutra` snapshots there.',
                'The snapshot is encrypted **on your device** before upload, and provider credentials stay device-local — they are never written into a `.sutra` file. By default Sutra makes no cloud calls; nothing uploads until you set it up. **Sutra Sync** is a separate, incremental, end-to-end encrypted system for multi-device replication.'
            ],
            keywords: ['cloud', 'cloud backup', 'google drive', 'onedrive', 'dropbox', 'supabase', 'sync', 'cloud sync'],
            nav: { view: 'settings', section: 'backup' },
            relatedActions: ['navigate'],
            related: ['encrypted-backup', 'export-import', 'privacy-local-first']
        },
        {
            id: 'keyboard-shortcuts',
            title: 'Keyboard shortcuts',
            category: 'overview',
            availability: 'available',
            summary: 'Sutra has keyboard shortcuts for common actions; see Settings/Help for the current list.',
            body: [
                'Sutra supports keyboard shortcuts for navigation and common actions. The current set is listed in Settings / in-app Help.'
            ],
            keywords: ['keyboard', 'shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'keys'],
            nav: { view: 'settings' },
            relatedActions: [],
            related: ['customize']
        },
        {
            id: 'mobile',
            title: 'Using Sutra on mobile',
            category: 'overview',
            availability: 'available',
            summary: 'Sutra adapts to phones and tablets with a mobile navigation bar and a "right now" focused layout.',
            body: [
                'Sutra is responsive: on phones it uses a unified bottom navigation bar and **All sections** sheet, while Today, Timeline, Notes, Homework, Review, Focus, and Assistant keep their primary actions reachable.',
                'Sheets manage focus, browser Back, Escape, safe-area spacing, background scroll, and restoration. Timeline Month uses counts and opens Day for detail; Week remains contained inside its calendar region. The phone shell keeps the composer and touch targets usable with the software keyboard.'
            ],
            keywords: ['mobile', 'phone', 'tablet', 'ipad', 'android', 'iphone', 'responsive', 'touch'],
            nav: null,
            relatedActions: [],
            related: ['feature-tour']
        }
    ];

    // --------------------------------------------------------------
    // Retrieval — deterministic keyword/title/summary scoring.
    // --------------------------------------------------------------
    const STOPWORDS = new Set([
        'a', 'an', 'the', 'is', 'are', 'do', 'does', 'how', 'what', 'where', 'when',
        'i', 'my', 'me', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'can', 'with',
        'this', 'that', 'it', 'you', 'your', 'about', 'so', 'please', 'tell', 'show'
    ]);

    function tokenize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .split(' ')
            .filter(t => t && t.length > 1 && !STOPWORDS.has(t));
    }

    function entryHaystack(entry) {
        return [
            entry.title,
            entry.summary,
            (entry.keywords || []).join(' '),
            entry.category
        ].join(' ').toLowerCase();
    }

    // Score an entry against a query (0..). Higher is more relevant.
    function scoreEntry(entry, query) {
        const q = String(query || '').toLowerCase().trim();
        if (!q) return 0;
        let score = 0;

        // Strong signal: a keyword phrase appears verbatim in the query.
        (entry.keywords || []).forEach(kw => {
            const k = String(kw).toLowerCase();
            if (!k) return;
            if (q.includes(k)) score += (k.includes(' ') ? 6 : 3);
        });

        // Title phrase match.
        if (q.includes(entry.title.toLowerCase())) score += 5;

        // Token overlap against the haystack.
        const tokens = tokenize(q);
        if (tokens.length) {
            const hay = entryHaystack(entry);
            let hits = 0;
            tokens.forEach(t => { if (hay.includes(t)) hits += 1; });
            score += hits;
            // Reward dense matches (most of the query's meaningful tokens hit).
            if (hits / tokens.length >= 0.6) score += 2;
        }
        return score;
    }

    function search(query, limit) {
        const max = Number(limit) > 0 ? Number(limit) : 5;
        return ENTRIES
            .map(entry => ({ entry, score: scoreEntry(entry, query) }))
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
            .slice(0, max);
    }

    // Best single answer for the local router. Returns null when nothing is
    // confidently relevant (so the router can fall through to a provider).
    function answer(query, options) {
        const opts = options || {};
        const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 4;
        const results = search(query, 3);
        if (!results.length || results[0].score < minScore) return null;
        return { entry: results[0].entry, score: results[0].score, alternatives: results.slice(1).map(r => r.entry) };
    }

    function get(id) {
        return ENTRIES.find(e => e.id === id) || null;
    }

    function list() {
        return ENTRIES.slice();
    }

    function categories() {
        const set = new Set();
        ENTRIES.forEach(e => set.add(e.category));
        return Array.from(set).sort();
    }

    // Render an entry to a Markdown string (used by the local answer card).
    function formatEntry(entry, opts) {
        const e = typeof entry === 'string' ? get(entry) : entry;
        if (!e) return '';
        const options = opts || {};
        const lines = [];
        if (options.includeTitle !== false) lines.push('**' + e.title + '**', '');
        (e.body || []).forEach(b => lines.push(b));
        if (Array.isArray(e.steps) && e.steps.length) {
            lines.push('');
            e.steps.forEach((s, i) => lines.push((i + 1) + '. ' + s));
        }
        if (e.availability && e.availability !== 'available') {
            lines.push('', '_' + (AVAILABILITY_LABEL[e.availability] || e.availability) + '._');
        }
        return lines.join('\n').trim();
    }

    // --------------------------------------------------------------
    // Validation (used by the test harness): every entry is well-formed and
    // only points at real navigation targets / known availability states.
    // --------------------------------------------------------------
    function validateRegistry() {
        const problems = [];
        const ids = new Set();
        ENTRIES.forEach(e => {
            if (!e.id) problems.push('entry with no id: ' + (e.title || '?'));
            if (ids.has(e.id)) problems.push('duplicate id: ' + e.id);
            ids.add(e.id);
            if (!e.title) problems.push(e.id + ': missing title');
            if (!e.summary) problems.push(e.id + ': missing summary');
            if (!AVAILABILITY.includes(e.availability)) problems.push(e.id + ': invalid availability ' + e.availability);
            if (!Array.isArray(e.keywords) || !e.keywords.length) problems.push(e.id + ': missing keywords');
            if (e.nav && e.nav.view && !KNOWN_VIEWS.includes(e.nav.view)) {
                problems.push(e.id + ': nav.view is not a known view: ' + e.nav.view);
            }
        });
        // Related-id references must resolve.
        ENTRIES.forEach(e => {
            (e.related || []).forEach(rid => {
                if (!ids.has(rid)) problems.push(e.id + ': related id does not resolve: ' + rid);
            });
        });
        return { ok: problems.length === 0, problems };
    }

    const api = {
        VERSION,
        KNOWN_VIEWS: KNOWN_VIEWS.slice(),
        AVAILABILITY: AVAILABILITY.slice(),
        AVAILABILITY_LABEL,
        list,
        get,
        categories,
        search,
        answer,
        scoreEntry,
        formatEntry,
        validateRegistry
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.SutraProductKnowledge = api;
    }
})();
