// Sutra Local Help — no-API-key, click-through help for non-generative features.
//
// A data-driven decision tree. Each node carries a title, an optional local
// answer (pulled from the verified Product Knowledge registry so there is ONE
// source of truth), optional numbered steps, a certified navigation target,
// branching follow-up choices, and — only where a generative follow-up could
// help — a "Use provider instead" option that fires ONLY if the user picks it.
//
// Nothing here calls a provider on its own. Answers are explicitly NOT
// AI-generated; the UI labels them "Answered locally / No API key required".
//
// Architecture:
//   - REGISTRY (data) — root menu + topic nodes. Adding a feature's help is one
//     entry that usually just references a Product Knowledge id.
//   - Engine (pure, Node-testable) — resolveNode/validate/matchTrigger.
//   - Renderer (browser-only) — accessible cards + multiple-choice buttons,
//     navigation history, keyboard support.
//
// Public surface: window.SutraLocalHelp (+ module.exports for tests).
(function () {
    'use strict';

    const VERSION = '1.0.0';

    function PK() {
        return (typeof window !== 'undefined' && window.SutraProductKnowledge)
            ? window.SutraProductKnowledge
            : (typeof require !== 'undefined' ? safeRequirePK() : null);
    }
    function safeRequirePK() {
        try { return require('./sutra-product-knowledge.js'); } catch (e) { return null; }
    }

    // --------------------------------------------------------------
    // Decision-tree registry.
    //   choice: { label, to?, nav?, action?, useProvider?, close? }
    //   node:   { id, title, category, description, local, question?, triggers?,
    //             knowledgeId?, answer?, steps?, choices?, nav?, useProvider? }
    // A node with `knowledgeId` pulls its answer/steps/nav from Product Knowledge
    // at render time, keeping help text and product facts in lockstep.
    // --------------------------------------------------------------
    const ROOT_CHOICES = [
        // Guided Local Mode — workspace task paths first (no API key required).
        { label: 'What should I do next?', to: 'next-step' },
        { label: 'Show what is due', to: 'whats-due' },
        { label: 'Handle overdue work', to: 'overdue' },
        { label: 'Check grade risk', to: 'grade-risk' },
        { label: 'Plan my day', to: 'plan-day' },
        { label: 'Prepare for an exam', to: 'prepare-exam' },
        { label: 'Break down an assignment', to: 'break-assignment' },
        { label: 'Build a study plan', to: 'build-study-plan' },
        { label: 'Organize my notes', to: 'organize-notes' },
        { label: 'Run a weekly review', to: 'weekly-review' },
        { label: 'What is Sutra?', to: 'what-is-sutra' },
        { label: 'What can Sutra Assistant do?', to: 'assistant-capabilities' },
        { label: 'Study with tutoring modes', to: 'tutoring-provider' },
        { label: 'How do I make flashcards?', to: 'flashcards' },
        { label: 'Back up my workspace', to: 'backup' },
        { label: 'Open Homework', nav: { view: 'homework' }, close: true },
        { label: 'Explain privacy', to: 'privacy' },
        { label: 'Course Hub vs Homework', to: 'homework-vs-coursehub' },
        { label: 'Manage Assistant Memory', to: 'memory' },
        { label: 'Change my assistant model', to: 'change-model' },
        { label: 'Plan my week', to: 'plans' },
        { label: 'Import or export my workspace', to: 'export-import' },
        { label: 'Customize Sutra', to: 'customize' },
        { label: 'Today, Capture & navigation', to: 'daily-loop-navigation' },
        { label: 'Notes & pages', to: 'notes' },
        { label: 'Canvas & Slides', to: 'canvas-slides' },
        { label: 'Course Hub', to: 'course-hub' },
        { label: 'Timeline', to: 'timeline' },
        { label: 'All Due', to: 'all-due' },
        { label: 'AP Study', to: 'ap-study' },
        { label: 'Grade Planner', to: 'grade-planner' },
        { label: 'Assignment Studio', to: 'assignment-studio' },
        { label: 'College / Life / Business', to: 'college-life-business' },
        { label: 'Themes', to: 'themes' },
        { label: 'Connect an AI provider', to: 'providers' },
        { label: 'Workspace Access', to: 'workspace-access' },
        { label: 'Encrypted backups', to: 'encrypted-backup' },
        { label: 'Sutra Sync Beta', to: 'sync-beta' },
        { label: 'Restore / import', to: 'restore' },
        { label: 'Activity & Undo', to: 'activity-undo' },
        { label: 'Search', to: 'search' },
        { label: 'Keyboard shortcuts', to: 'keyboard-shortcuts' },
        { label: 'Using Sutra on mobile', to: 'mobile' }
    ];

    const NODES = {
        root: {
            id: 'root',
            title: 'Local Help',
            category: 'root',
            local: true,
            question: 'What would you like help with?',
            triggers: ['local help', 'help', 'i need help', 'show help', 'get help', 'open help', 'help menu', 'sutra help', 'help me with sutra', 'what can sutra help with'],
            choices: ROOT_CHOICES,
            source: 'sutra-local-help'
        },

        // ---- Guided Local Mode: student task paths (no API key required) ----
        // Unlike the how-to topic nodes below, these answer questions about the
        // student's OWN workspace using Sutra's deterministic local engines and
        // certified read-only / navigation actions. Anything that genuinely needs
        // generation (a full recovery plan, a timed day plan) is offered only as
        // an explicit "Use provider instead" follow-up — the local path never
        // calls a provider on its own.
        'next-step': {
            id: 'next-step',
            title: 'What should I do next?',
            category: 'guided',
            local: true,
            answer: [
                'Sutra ranks your open work **locally — no AI needed**. It weighs due dates, how overdue something is, priority, grade impact, and what is already scheduled to surface what matters most right now.',
                'Open **All Due** for the full ranked list, or run the **Deadline Radar** to see the next 7 days at a glance.'
            ].join('\n\n'),
            nav: { view: 'alldue' },
            extraChoices: [
                { label: 'Open All Due', action: { type: 'navigate_to_all_due' }, close: true },
                { label: 'Run Deadline Radar', action: { type: 'run_deadline_radar' }, close: true }
            ],
            provider: 'Looking at my current workload, what is the single highest-leverage thing I should do right now? Explain why in one sentence.',
            followups: ['whats-due', 'overdue'],
            source: 'sutra-local-help'
        },
        'whats-due': {
            id: 'whats-due',
            title: 'Show what is due',
            category: 'guided',
            local: true,
            answer: [
                'Everything with a due date lives in **All Due** and on your **Timeline**, tracked entirely on this device.',
                'All Due groups your work by **overdue / today / this week**; the Timeline lays the same items out by day so you can see your load.'
            ].join('\n\n'),
            nav: { view: 'alldue' },
            extraChoices: [
                { label: 'Open All Due', action: { type: 'navigate_to_all_due' }, close: true },
                { label: 'Open Timeline', nav: { view: 'timeline' }, close: true }
            ],
            followups: ['overdue', 'next-step'],
            source: 'sutra-local-help'
        },
        overdue: {
            id: 'overdue',
            title: 'Handle overdue work',
            category: 'guided',
            local: true,
            answer: [
                'Overdue items are flagged in the **Overdue** group of **All Due**. Locally — no AI required — you can reschedule them onto the Timeline, mark them complete, or bump their priority.',
                'For a full recovery plan that re-sequences everything realistically around your free time, connect an AI provider.'
            ].join('\n\n'),
            steps: [
                'Open **All Due** and look at the **Overdue** group.',
                'Reschedule, complete, or reprioritize each item.',
                'Optionally schedule focus blocks for them on the **Timeline**.'
            ],
            nav: { view: 'alldue' },
            extraChoices: [
                { label: 'Open All Due', action: { type: 'navigate_to_all_due' }, close: true }
            ],
            provider: 'Build me a realistic recovery plan for my overdue work as timeline blocks and tasks.',
            followups: ['next-step', 'plan-day'],
            source: 'sutra-local-help'
        },
        'grade-risk': {
            id: 'grade-risk',
            title: 'Check grade risk',
            category: 'guided',
            local: true,
            answer: [
                'Grade math in Sutra is always **deterministic and local** — the AI never computes it.',
                'The **Grade Planner** shows your current standing. Sutra can also rank which missing assignments hurt your grade the most, or explain the risk for a course — all computed on this device.'
            ].join('\n\n'),
            nav: { view: 'courses' },
            extraChoices: [
                { label: 'Explain my grade risk', action: { type: 'explain_grade_risk' }, close: true },
                { label: 'Rank missing work by grade impact', action: { type: 'rank_missing_work_by_grade_impact' }, close: true }
            ],
            followups: ['whats-due', 'next-step'],
            source: 'sutra-local-help'
        },
        'plan-day': {
            id: 'plan-day',
            title: 'Plan my day',
            category: 'guided',
            local: true,
            answer: [
                'Sutra can check your next 7 days **locally** for overloaded days, scheduling conflicts, unscheduled priorities, AP exams without study time, and review backlog — no AI needed.',
                'Building a full **timed** day plan around your available hours uses AI generation; connect a provider for that.'
            ].join('\n\n'),
            nav: { view: 'timeline' },
            extraChoices: [
                { label: 'Check my schedule for problems (local)', action: { type: 'repair_plan' }, close: true },
                { label: 'Open Timeline', nav: { view: 'timeline' }, close: true }
            ],
            provider: 'Plan my day from my open tasks and timeline. Propose timeline blocks for the most important items.',
            followups: ['next-step', 'overdue'],
            source: 'sutra-local-help'
        },
        'prepare-exam': {
            id: 'prepare-exam',
            title: 'Prepare for an exam',
            category: 'guided',
            local: true,
            answer: [
                'Your exams live in **AP Study** and the **Cram Hub**, tracked on this device. Sutra\'s local 7-day schedule check flags **AP exams that have no study time** blocked out yet.',
                'A full, personalized study plan sized around your available days uses AI generation — connect a provider for that.'
            ].join('\n\n'),
            nav: { view: 'apstudy' },
            extraChoices: [
                { label: 'Check my schedule for gaps (local)', action: { type: 'repair_plan' }, close: true },
                { label: 'Open Cram Hub', nav: { view: 'cramhub' }, close: true }
            ],
            provider: 'Build me a study plan for my next exam as realistic timeline blocks.',
            followups: ['build-study-plan', 'plan-day'],
            source: 'sutra-local-help'
        },
        'break-assignment': {
            id: 'break-assignment',
            title: 'Break down an assignment',
            category: 'guided',
            local: true,
            answer: [
                '**Assignment Studio** (in Homework) breaks a big assignment into milestones you can schedule and check off — all managed locally.',
                'Auto-generating a milestone breakdown with sensible due dates uses AI; connect a provider for that.'
            ].join('\n\n'),
            nav: { view: 'homework' },
            extraChoices: [
                { label: 'Open Homework', nav: { view: 'homework' }, close: true }
            ],
            provider: 'Break my next big assignment into milestones with realistic due dates.',
            followups: ['build-study-plan', 'next-step'],
            source: 'sutra-local-help'
        },
        'build-study-plan': {
            id: 'build-study-plan',
            title: 'Build a study plan',
            category: 'guided',
            local: true,
            answer: [
                'Sutra schedules study blocks on your **Timeline**. Its local schedule check finds overloaded days, conflicts, and unscheduled priorities so you can place blocks where they fit.',
                'Generating a full plan sized around your open work and free time uses AI — connect a provider for that.'
            ].join('\n\n'),
            nav: { view: 'timeline' },
            extraChoices: [
                { label: 'Check my schedule for problems (local)', action: { type: 'repair_plan' }, close: true },
                { label: 'Open Timeline', nav: { view: 'timeline' }, close: true }
            ],
            provider: 'Build a realistic study plan as timeline blocks around my open work.',
            followups: ['prepare-exam', 'plan-day'],
            source: 'sutra-local-help'
        },
        'organize-notes': {
            id: 'organize-notes',
            title: 'Organize my notes',
            category: 'guided',
            local: true,
            answer: [
                '**Create** supports note pages, folders, spaces, tags, and full-text search — everything you need to organize by class or project, entirely on this device.',
                'Want Sutra to suggest a structure for you? That uses AI generation; connect a provider.'
            ].join('\n\n'),
            nav: { view: 'notes' },
            extraChoices: [
                { label: 'Open Create', nav: { view: 'notes' }, close: true }
            ],
            provider: 'Suggest a clean folder and tag structure for my classes.',
            followups: ['next-step', 'whats-due'],
            source: 'sutra-local-help'
        },
        'weekly-review': {
            id: 'weekly-review',
            title: 'Run a weekly review',
            category: 'guided',
            local: true,
            answer: [
                'A weekly review is a quick pass over what you finished, what slipped, and what is coming — Sutra keeps the raw material (tasks, homework, timeline, review stats) on this device.',
                'Sutra can draft a Weekly Review note for you; generating the written reflection uses AI.'
            ].join('\n\n'),
            nav: { view: 'today' },
            extraChoices: [
                { label: 'Open Home', nav: { view: 'today' }, close: true }
            ],
            provider: 'Draft a weekly review note from what I finished, what slipped, and what is due next week.',
            followups: ['next-step', 'plan-day'],
            source: 'sutra-local-help'
        },
        // Reusable "this needs generative AI" gate. Guided paths route here when a
        // task genuinely can't be done locally, so a no-key student always gets a
        // clear fork instead of a dead end or a silent provider call.
        'needs-provider': {
            id: 'needs-provider',
            title: 'This step needs generative AI',
            category: 'guided',
            local: true,
            answer: [
                'Sutra did as much as it can on this device. Finishing this step — writing, open-ended planning, or generating new content — needs a connected AI provider.',
                'You can connect one (your key stays on this device), or keep going with what Sutra does locally.'
            ].join('\n\n'),
            choices: [
                { label: 'Connect an AI provider', to: 'providers' },
                { label: 'Show what Sutra does locally', to: 'assistant-capabilities' },
                { label: 'Back to the guided menu', to: 'root' }
            ],
            source: 'sutra-local-help'
        },
        'tutoring-provider': {
            id: 'tutoring-provider',
            title: 'Structured tutoring modes',
            category: 'guided',
            local: true,
            answer: [
                'Explain, Hint First, Check My Attempt, Quiz Me, Diagnose My Mistake, Create Practice, Review Cards, Study Plan, Rubric feedback, Summarize Notes, and Teach From My Materials use a connected AI provider.',
                'Sutra does not simulate a local free-text tutor. Without a provider, use the local study tools below or connect your own provider.'
            ].join('\n\n'),
            choices: [
                { label: 'Connect a provider', to: 'providers' },
                { label: 'Browse local study tools', to: 'assistant-capabilities' },
                { label: 'Open Review', nav: { view: 'review' }, close: true },
                { label: 'Open Testing Hub', nav: { view: 'testing' }, close: true },
                { label: 'Open Create', nav: { view: 'notes' }, close: true },
                { label: 'Back', to: 'root' }
            ],
            source: 'sutra-local-help'
        },

        // ---- Topic nodes (most reference a Product Knowledge entry) ----
        'what-is-sutra': topic('what-is-sutra', { followups: ['feature-tour', 'privacy', 'memory'], provider: 'Give me a friendly overview of how to get started with Sutra.' }),
        // Reads live from flow-assistant.js's Actions Bank (dynamicAnswer, not a
        // static Product Knowledge entry) — so this list can NEVER drift from
        // what the assistant is actually told it can do.
        'assistant-capabilities': {
            id: 'assistant-capabilities',
            title: 'What can Sutra Assistant do?',
            category: 'topic',
            local: true,
            dynamicAnswer: () => {
                try {
                    const fa = (typeof window !== 'undefined') ? window.flowAssistant : null;
                    if (fa && typeof fa.getActionsBank === 'function' && typeof fa.renderActionsBankMarkdown === 'function') {
                        return fa.renderActionsBankMarkdown(fa.getActionsBank());
                    }
                } catch (e) { /* fall through */ }
                return 'Open the Assistant panel to see the current list of actions.';
            },
            followups: ['activity-undo', 'assistant-settings'],
            source: 'sutra-local-help'
        },
        'feature-tour': topic('feature-tour', { knowledgeId: 'feature-tour', followups: ['notes', 'homework-vs-coursehub', 'flashcards'] }),
        'daily-loop-navigation': topic('daily-loop-navigation', { knowledgeId: 'daily-loop-navigation', followups: ['feature-tour', 'timeline', 'mobile'] }),
        notes: topic('notes', { knowledgeId: 'notes-pages', followups: ['flashcards', 'export-import'], provider: 'Suggest a good note structure for my classes.' }),
        'canvas-slides': topic('canvas-slides', { knowledgeId: 'canvas-slides', followups: ['notes', 'export-import', 'assistant-settings'] }),
        flashcards: topic('flashcards', { knowledgeId: 'review-flashcards', followups: ['ap-study', 'plans'], provider: 'Turn my current note into a set of flashcards.' }),
        homework: topic('homework', { knowledgeId: 'planner-tasks', nav: { view: 'homework' }, followups: ['homework-vs-coursehub', 'all-due'] }),
        'homework-vs-coursehub': topic('homework-vs-coursehub', { knowledgeId: 'homework-vs-coursehub', followups: ['course-hub', 'all-due'] }),
        'course-hub': topic('course-hub', { knowledgeId: 'course-hub', followups: ['homework-vs-coursehub', 'all-due'] }),
        timeline: topic('timeline', { knowledgeId: 'timeline', followups: ['plans', 'all-due'], provider: 'Help me plan my study blocks for this week.' }),
        'all-due': topic('all-due', { knowledgeId: 'all-due', followups: ['timeline', 'plans'] }),
        'ap-study': topic('ap-study', { knowledgeId: 'ap-study', followups: ['flashcards', 'plans'], provider: 'Build me an AP exam study plan.' }),
        'grade-planner': topic('grade-planner', { knowledgeId: 'grade-planner', followups: ['ap-study'], provider: 'Explain how my grade is calculated in one of my courses.' }),
        'assignment-studio': topic('assignment-studio', { knowledgeId: 'assignment-studio', followups: ['homework', 'plans'], provider: 'Break my next big assignment into milestones.' }),
        'college-life-business': topic('college-life-business', { knowledgeId: 'college-life-business', followups: ['export-import'] }),
        themes: topic('themes', { knowledgeId: 'themes', followups: ['customize'], provider: 'Generate a calm theme for late-night studying.' }),
        customize: topic('customize', { knowledgeId: 'customize', followups: ['themes', 'workspace-access'] }),
        plans: topic('plans', { knowledgeId: 'plans', nav: { view: 'timeline' }, followups: ['timeline', 'ap-study'], provider: 'Plan my week around my current homework and exams.' }),
        privacy: topic('privacy', { knowledgeId: 'privacy-local-first', followups: ['workspace-access', 'export-import', 'memory'] }),
        'workspace-access': topic('workspace-access', { knowledgeId: 'workspace-access', followups: ['privacy', 'assistant-settings'] }),
        providers: topic('providers', { knowledgeId: 'assistant-providers', followups: ['change-model', 'workspace-access'] }),
        'change-model': topic('change-model', { knowledgeId: 'change-model', followups: ['providers', 'assistant-settings'] }),
        'assistant-settings': topic('assistant-settings', { knowledgeId: 'assistant-settings', followups: ['workspace-access', 'memory', 'activity-undo'] }),
        memory: topic('memory', {
            knowledgeId: 'assistant-memory',
            followups: ['privacy', 'export-import'],
            extraChoices: [{ label: 'Open Memory manager', action: { type: 'open_memory_manager' }, close: true }]
        }),
        'activity-undo': topic('activity-undo', { knowledgeId: 'activity-undo', followups: ['assistant-settings'] }),
        'export-import': topic('export-import', { knowledgeId: 'export-import', followups: ['encrypted-backup', 'restore', 'memory'] }),
        backup: topic('backup', { knowledgeId: 'encrypted-backup', followups: ['export-import', 'restore', 'cloud'] }),
        'encrypted-backup': topic('encrypted-backup', { knowledgeId: 'encrypted-backup', followups: ['restore', 'cloud'] }),
        'sync-beta': topic('sync-beta', { knowledgeId: 'sync-beta', followups: ['cloud', 'encrypted-backup', 'privacy'] }),
        restore: {
            id: 'restore',
            title: 'Restore / import a workspace',
            category: 'backup',
            local: true,
            answer: [
                'Importing a `.sutra` file restores a full workspace into a clean Sutra session.',
                'Import **validates the file first**, migrates older exports, tolerates missing or newer sections, and avoids creating duplicate tasks, homework, cards, or courses. If a file is invalid or corrupted, Sutra reports a clear error and does **not** partially overwrite your current workspace.'
            ].join('\n\n'),
            steps: ['Open **Settings**.', 'Go to **Backups & Export**.', 'Choose **Import** and select your `.sutra` file (enter the passphrase if it is encrypted).'],
            nav: { view: 'settings', section: 'backup' },
            choices: [{ label: 'Encrypted backups', to: 'encrypted-backup' }, { label: 'Cloud backup', to: 'cloud' }],
            source: 'sutra-local-help'
        },
        cloud: topic('cloud', { knowledgeId: 'cloud-backup', followups: ['encrypted-backup', 'privacy'] }),
        search: topic('search', { knowledgeId: 'search', followups: ['feature-tour'] }),
        'keyboard-shortcuts': topic('keyboard-shortcuts', { knowledgeId: 'keyboard-shortcuts', followups: ['customize'] }),
        mobile: topic('mobile', { knowledgeId: 'mobile', followups: ['feature-tour'] })
    };

    // Build a topic node from a Product Knowledge id with follow-up choices.
    function topic(id, cfg) {
        const c = cfg || {};
        return {
            id,
            knowledgeId: c.knowledgeId || id,
            nav: c.nav || null,           // null → derived from PK entry at resolve time
            followups: c.followups || [],
            extraChoices: c.extraChoices || [],
            provider: c.provider || null,
            local: true,
            category: c.category || 'topic',
            source: 'sutra-local-help'
        };
    }

    // --------------------------------------------------------------
    // Engine (pure)
    // --------------------------------------------------------------
    function rawNode(id) { return NODES[id] || null; }

    // Resolve a node into a fully-hydrated, render-ready shape.
    function resolveNode(id) {
        const node = rawNode(id);
        if (!node) return null;
        const pk = PK();
        const out = {
            id: node.id,
            title: node.title || id,
            category: node.category || 'topic',
            local: node.local !== false,
            question: node.question || null,
            answer: typeof node.answer === 'string' ? node.answer : '',
            steps: Array.isArray(node.steps) ? node.steps.slice() : [],
            nav: node.nav || null,
            availability: 'available',
            choices: [],
            useProvider: null,
            source: node.source || 'sutra-local-help'
        };

        // Pull verified content from Product Knowledge when referenced.
        if (node.knowledgeId && pk && typeof pk.get === 'function') {
            const entry = pk.get(node.knowledgeId);
            if (entry) {
                out.title = node.titleOverride || entry.title;
                out.answer = pk.formatEntry(entry, { includeTitle: false });
                if (entry.steps && entry.steps.length && !out.steps.length) out.steps = entry.steps.slice();
                if (!out.nav && entry.nav) out.nav = entry.nav;
                out.availability = entry.availability || 'available';
            }
        }

        // Nodes that read live app state (not a static Product Knowledge entry)
        // build their answer at resolve time via a function. Used by the
        // Actions Bank node so it can never drift from what the assistant
        // actually reads (same source flow-assistant.js sends the model).
        if (typeof node.dynamicAnswer === 'function') {
            try {
                const built = node.dynamicAnswer();
                if (typeof built === 'string' && built.trim()) out.answer = built;
            } catch (e) { /* fall back to whatever answer/steps were already set */ }
        }

        // Choices: explicit node.choices win; otherwise build from followups.
        if (Array.isArray(node.choices) && node.choices.length) {
            out.choices = node.choices.slice();
        } else {
            (node.extraChoices || []).forEach(ch => out.choices.push(ch));
            (node.followups || []).forEach(fid => {
                const t = rawNode(fid);
                if (!t) return;
                out.choices.push({ label: followLabel(fid), to: fid });
            });
        }

        // "Use provider instead" eligibility.
        if (node.provider) out.useProvider = node.provider;
        return out;
    }

    function followLabel(id) {
        const pk = PK();
        const node = rawNode(id);
        if (node && node.title) return node.title;
        if (node && node.knowledgeId && pk && pk.get) {
            const e = pk.get(node.knowledgeId);
            if (e) return e.title;
        }
        if (pk && pk.get) { const e = pk.get(id); if (e) return e.title; }
        return id;
    }

    function rootNode() { return resolveNode('root'); }

    function listNodeIds() { return Object.keys(NODES); }

    // Reverse lookup: which Local Help node surfaces a given Product Knowledge id?
    // Lets the intent router render a rich, badged Local Help card for a product
    // question instead of plain text. Prefers a node whose id equals the pk id.
    function nodeIdForKnowledge(pkId) {
        if (!pkId) return null;
        if (NODES[pkId] && NODES[pkId].knowledgeId === pkId) return pkId;
        const ids = Object.keys(NODES);
        for (let i = 0; i < ids.length; i += 1) {
            if (NODES[ids[i]] && NODES[ids[i]].knowledgeId === pkId) return ids[i];
        }
        return NODES[pkId] ? pkId : null;
    }

    // Match free text to a Local Help node (used by the intent router).
    // Deliberately EXACT (modulo trailing punctuation) so phrases like
    // "help me plan my week" fall through to the planning handler instead of
    // opening the help menu.
    function matchTrigger(text) {
        const t = String(text || '').toLowerCase().trim().replace(/[?.!]+$/, '');
        if (!t) return null;
        const root = NODES.root;
        if (root.triggers.indexOf(t) !== -1) return 'root';
        return null;
    }

    // Validate the registry — every reference resolves, nav targets are known,
    // and embedded actions are certified types.
    function validate() {
        const problems = [];
        const pk = PK();
        const knownViews = (pk && pk.KNOWN_VIEWS) ? pk.KNOWN_VIEWS : null;
        const certified = (typeof window !== 'undefined' && window.SutraAssistantActions && window.SutraAssistantActions.listActions)
            ? new Set(window.SutraAssistantActions.listActions())
            : null;
        const ids = new Set(Object.keys(NODES));

        Object.keys(NODES).forEach(id => {
            const node = NODES[id];
            // knowledgeId must resolve when PK is available.
            if (node.knowledgeId && pk && pk.get && !pk.get(node.knowledgeId)) {
                problems.push(`${id}: knowledgeId does not resolve: ${node.knowledgeId}`);
            }
            (node.followups || []).forEach(f => { if (!ids.has(f)) problems.push(`${id}: followup does not resolve: ${f}`); });
            const allChoices = [].concat(node.choices || [], node.extraChoices || []);
            allChoices.forEach(ch => {
                if (ch.to && !ids.has(ch.to)) problems.push(`${id}: choice 'to' does not resolve: ${ch.to}`);
                if (ch.nav && ch.nav.view && knownViews && knownViews.indexOf(ch.nav.view) === -1) {
                    problems.push(`${id}: choice nav.view is not a known view: ${ch.nav.view}`);
                }
                if (ch.action && ch.action.type && certified && !certified.has(ch.action.type)) {
                    problems.push(`${id}: choice action is not certified: ${ch.action.type}`);
                }
            });
            // Resolved nav target must be a known view.
            const resolved = resolveNode(id);
            if (resolved.nav && resolved.nav.view && knownViews && knownViews.indexOf(resolved.nav.view) === -1) {
                problems.push(`${id}: resolved nav.view is not a known view: ${resolved.nav.view}`);
            }
        });
        return { ok: problems.length === 0, problems };
    }

    // --------------------------------------------------------------
    // Renderer (browser-only)
    // --------------------------------------------------------------
    let providerSendHandler = null;
    function setProviderSendHandler(fn) { providerSendHandler = typeof fn === 'function' ? fn : null; }

    function sendToProvider(prompt) {
        try {
            if (providerSendHandler) { providerSendHandler(prompt); return true; }
            if (typeof window !== 'undefined' && window.flowAssistant && typeof window.flowAssistant.askFlow === 'function') {
                window.flowAssistant.askFlow(prompt, { send: true });
                return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    function navTargetSupported() {
        return typeof window !== 'undefined'
            && ((window.SutraAssistantActions && window.SutraAssistantActions.applyAction)
                || (window.flowAssistant && window.flowAssistant.applyAction)
                || typeof window.setActiveView === 'function');
    }

    function doNavigate(nav, close) {
        if (!nav || !nav.view) return;
        let ok = false;
        try {
            if (window.flowAssistant && typeof window.flowAssistant.applyAction === 'function') {
                ok = !!(window.flowAssistant.applyAction({ type: 'navigate', view: nav.view }) || {}).ok;
            } else if (window.SutraAssistantActions && window.SutraAssistantActions.applyAction) {
                ok = !!(window.SutraAssistantActions.applyAction({ type: 'navigate', view: nav.view }) || {}).ok;
            } else if (typeof window.setActiveView === 'function') {
                window.setActiveView(nav.view); ok = true;
            }
        } catch (e) { /* ignore */ }
        if (ok && nav.section) {
            setTimeout(() => {
                try {
                    const sel = String(nav.section).split(' ')[0];
                    const el = document.querySelector('[data-settings-nav="' + sel + '"], [data-settings-section="' + sel + '"]');
                    if (el && typeof el.click === 'function') el.click();
                    else if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } catch (e) { /* ignore */ }
            }, 120);
        }
        return ok;
    }

    // Find the visible assistant messages container.
    function activeMessagesHost() {
        if (typeof document === 'undefined') return null;
        const asstView = document.getElementById('view-assistantview');
        const asstMsgs = document.getElementById('asstMessages');
        if (asstView && asstMsgs && isVisible(asstView)) return asstMsgs;
        const panel = document.getElementById('chatbotPanel');
        const panelMsgs = document.getElementById('chatbotMessages');
        if (panel && panelMsgs && isVisible(panel)) return panelMsgs;
        return panelMsgs || asstMsgs || null;
    }
    function isVisible(el) {
        if (!el) return false;
        const s = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
        return el.offsetParent !== null || (s && s.position === 'fixed');
    }

    function elc(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function mdInline(text) {
        // Minimal, safe inline markdown for answer/step text. We escape first,
        // then re-introduce a few trusted tags via SutraDOMSafety.
        const escaped = String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let html = escaped
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/_([^_]+)_/g, '<em>$1</em>');
        return html;
    }

    function setHtml(el, html) {
        if (typeof window !== 'undefined' && window.SutraDOMSafety && window.SutraDOMSafety.setTrustedHTML) {
            window.SutraDOMSafety.setTrustedHTML(el, html);
        } else {
            el.textContent = String(html || '').replace(/<[^>]+>/g, '');
        }
    }

    // Render a Local Help card for a node into a host element.
    // history: array of node ids for the Back button.
    function renderCard(host, nodeId, history) {
        if (!host) return null;
        const node = resolveNode(nodeId);
        if (!node) return null;
        const hist = Array.isArray(history) ? history.slice() : [];

        const card = elc('div', 'sutra-help-card');
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', 'Local Help: ' + node.title);

        // Header / badges
        const hdr = elc('div', 'sutra-help-hdr');
        hdr.appendChild(elc('span', 'sutra-help-badge', 'Answered locally'));
        hdr.appendChild(elc('span', 'sutra-help-badge sutra-help-badge-soft', 'No API key required'));
        if (node.availability && node.availability !== 'available') {
            const map = (PK() && PK().AVAILABILITY_LABEL) || {};
            hdr.appendChild(elc('span', 'sutra-help-badge sutra-help-badge-warn', map[node.availability] || node.availability));
        }
        card.appendChild(hdr);

        // Title
        card.appendChild(elc('div', 'sutra-help-title', node.title));

        // Question (branching) or answer (leaf)
        if (node.question) {
            card.appendChild(elc('div', 'sutra-help-question', node.question));
        }
        if (node.answer) {
            const ans = elc('div', 'sutra-help-answer');
            // Render answer paragraphs as safe inline markdown.
            String(node.answer).split(/\n{2,}/).forEach(para => {
                if (!para.trim()) return;
                const p = elc('p');
                setHtml(p, mdInline(para.trim()));
                ans.appendChild(p);
            });
            card.appendChild(ans);
        }
        if (node.steps && node.steps.length) {
            const ol = elc('ol', 'sutra-help-steps');
            node.steps.forEach(s => { const li = elc('li'); setHtml(li, mdInline(s)); ol.appendChild(li); });
            card.appendChild(ol);
        }

        // Primary "Open in Sutra" button when a nav target exists.
        if (node.nav && node.nav.view && navTargetSupported()) {
            const open = elc('button', 'sutra-help-primary', 'Open in Sutra');
            open.type = 'button';
            open.addEventListener('click', () => { doNavigate(node.nav, true); });
            card.appendChild(open);
        }

        // Choice buttons
        const choices = elc('div', 'sutra-help-choices');
        (node.choices || []).forEach(ch => {
            const btn = elc('button', 'sutra-help-choice', ch.label);
            btn.type = 'button';
            btn.addEventListener('click', () => {
                if (ch.action && window.SutraAssistantActions && window.SutraAssistantActions.applyAction) {
                    try { window.SutraAssistantActions.applyAction(ch.action); } catch (e) { /* ignore */ }
                    if (ch.close) return;
                } else if (ch.nav) {
                    doNavigate(ch.nav, true);
                    if (ch.close) return;
                }
                if (ch.to) {
                    renderCard(host, ch.to, hist.concat([nodeId]));
                    scrollHost(host);
                }
            });
            choices.appendChild(btn);
        });
        card.appendChild(choices);

        // Footer controls: Use provider instead / Back / Never mind
        const foot = elc('div', 'sutra-help-foot');
        if (node.useProvider) {
            const hasProvider = typeof window !== 'undefined' && window.flowAssistant && typeof window.flowAssistant.askFlow === 'function';
            const useBtn = elc('button', 'sutra-help-provider', 'Use provider instead');
            useBtn.type = 'button';
            useBtn.title = hasProvider ? 'Ask the AI provider for a generated answer' : 'Connect an AI provider in Settings to use this';
            useBtn.addEventListener('click', () => {
                const sent = sendToProvider(typeof node.useProvider === 'string' ? node.useProvider : node.title);
                if (!sent) { renderCard(host, 'providers', hist.concat([nodeId])); scrollHost(host); }
            });
            foot.appendChild(useBtn);
        }
        if (hist.length) {
            const back = elc('button', 'sutra-help-foot-btn', '← Back');
            back.type = 'button';
            back.addEventListener('click', () => { const prev = hist[hist.length - 1]; renderCard(host, prev, hist.slice(0, -1)); scrollHost(host); });
            foot.appendChild(back);
        } else if (nodeId !== 'root') {
            const menu = elc('button', 'sutra-help-foot-btn', '☰ Help menu');
            menu.type = 'button';
            menu.addEventListener('click', () => { renderCard(host, 'root', []); scrollHost(host); });
            foot.appendChild(menu);
        }
        const dismiss = elc('button', 'sutra-help-foot-btn', 'Never mind');
        dismiss.type = 'button';
        dismiss.addEventListener('click', () => {
            const wrap = card.closest ? card.closest('.sutra-help-wrap') : null;
            if (wrap) wrap.remove(); else card.remove();
        });
        foot.appendChild(dismiss);
        card.appendChild(foot);

        // Replace the host's current help card (cards are re-rendered in place).
        const existing = host.querySelector ? host.querySelector('.sutra-help-wrap') : null;
        const wrap = elc('div', 'chatbot-msg assistant sutra-help-wrap');
        wrap.appendChild(card);
        if (existing && existing.parentNode === host) {
            host.replaceChild(wrap, existing);
        } else {
            host.appendChild(wrap);
        }
        // Focus the first interactive control for keyboard users.
        setTimeout(() => {
            const first = card.querySelector('button');
            if (first && typeof first.focus === 'function') first.focus();
        }, 30);
        return card;
    }

    function scrollHost(host) {
        try { if (host) host.scrollTop = host.scrollHeight; } catch (e) { /* ignore */ }
    }

    // Open Local Help at a node (default root) in the active assistant panel.
    function open(nodeId, options) {
        if (typeof document === 'undefined') return false;
        const host = (options && options.host) || activeMessagesHost();
        if (!host) return false;
        // Ensure the assistant panel is visible (sidebar panel).
        try {
            const panel = document.getElementById('chatbotPanel');
            if (panel && !isVisible(panel) && !isVisible(document.getElementById('view-assistantview')) && typeof window.toggleChat === 'function') {
                window.toggleChat();
            }
        } catch (e) { /* ignore */ }
        const targetHost = (options && options.host) || activeMessagesHost() || host;
        renderCard(targetHost, NODES[nodeId] ? nodeId : 'root', []);
        scrollHost(targetHost);
        return true;
    }

    const api = {
        VERSION,
        // engine
        rootNode, resolveNode, listNodeIds, matchTrigger, validate, nodeIdForKnowledge,
        getRawNode: rawNode,
        // renderer / control
        open, renderCard, setProviderSendHandler, activeMessagesHost,
        ROOT_CHOICES
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.SutraLocalHelp = api;
    }
})();
