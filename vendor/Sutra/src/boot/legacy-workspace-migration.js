// Compatibility bridge for workspaces created by pre-IndexedDB Atelier builds.
// It runs before app.js so the canonical adapter never observes an empty root
// while an older localStorage workspace is still available.
(function (global) {
    'use strict';

    if (!global || !global.SutraWorkspaceDB || typeof global.SutraWorkspaceDB.create !== 'function') return;
    // A verified device revocation must survive reload without recreating an
    // empty canonical database. The user must explicitly clear the terminal
    // guard and start fresh before any recovery adapter touches IndexedDB.
    if (global.SutraRevocationWipe && typeof global.SutraRevocationWipe.readGuard === 'function'
        && global.SutraRevocationWipe.readGuard()) return;

    const originalApi = global.SutraWorkspaceDB;
    const originalCreate = originalApi.create;
    const DB_NAME = 'noteflow_atelier_db';
    const STORE_NAME = 'workspace';
    const ROOT_KEY = 'root';
    const LAST_MEANINGFUL_KEY = 'workspace-last-meaningful';
    const EMPTY_BEFORE_RECOVERY_KEY = 'workspace-empty-before-recovery';
    const CONFIRMED_ROOT_KEY = 'workspace-confirmed-root';
    // Keep the boot-time recovery adapter on the same IndexedDB version as the
    // canonical runtime. Opening an existing v8 database with the old hard-coded
    // v7 request throws VersionError and silently skips empty-root recovery.
    // The migration registry loads before this bridge and is the shared schema
    // source of truth; the fallback supports defensive standalone loading.
    const CANONICAL_DB_VERSION = Math.max(
        1,
        Number(global.SutraMigrations && global.SutraMigrations.CURRENT_VERSION) || 8
    );
    const KNOWN_WORKSPACE_FIELDS = new Set([
        'version', 'schema', 'migrationHistory', 'pages', 'spaces', 'tasks', 'taskOrder', 'timeBlocks',
        'streaks', 'habitTracker', 'collegeTracker', 'academicWorkspace', 'collegeAppWorkspace',
        'lifeWorkspace', 'businessWorkspace', 'apStudyWorkspace', 'homeworkWorkspace', 'reviewWorkspace',
        'courseWorkspace', 'schoolSchedule', 'gradePlanner', 'semesterSetup', 'cramSessions', 'trash',
        'focusSessions', 'protectedTime', 'taskDependencies', 'studySessions',
        'masteryRecords', 'confidenceObservations', 'studentDecisionState', 'assistantPermissions',
        'assistantMemory', 'syncAuditLog', 'workspaceMeta', 'privateDocuments', 'sharedStudySessions',
        'operatingManual', 'portfolioWorkspace', 'testingHub', 'focusTemplates', 'customTabs',
        'splitPaneContexts', 'pinnedPages', 'notificationsState', 'assistantChatHistory', 'settings', 'ui',
        'globalTheme', 'migrationDiagnostics', 'compatibility', 'unknownWorkspaceFields',
        'localStorageSnapshot', 'exportedAt'
    ]);
    const USER_DATA_PATHS = [
        'tasks', 'timeBlocks', 'cramSessions', 'trash', 'focusSessions', 'protectedTime',
        'taskDependencies', 'studySessions', 'masteryRecords', 'confidenceObservations', 'syncAuditLog',
        'privateDocuments', 'sharedStudySessions', 'customTabs', 'migrationDiagnostics', 'compatibility',
        'unknownWorkspaceFields', 'assistantMemory.items', 'assistantChatHistory.conversations',
        'portfolioWorkspace.entries', 'homeworkWorkspace.courses', 'homeworkWorkspace.tasks',
        'homeworkWorkspace.quarantine', 'reviewWorkspace.decks', 'reviewWorkspace.items',
        'reviewWorkspace.sessions', 'courseWorkspace.courses', 'courseWorkspace.files',
        'courseWorkspace.resourceLinks', 'courseWorkspace.relationships', 'habitTracker.habits',
        'habitTracker.dayStates', 'streaks.dayStates', 'streaks.taskStreaks', 'collegeTracker.research',
        'collegeTracker.checklist', 'collegeTracker.deadlines', 'collegeTracker.essays',
        'collegeTracker.prompts', 'academicWorkspace.classes', 'academicWorkspace.assignments',
        'academicWorkspace.exams', 'academicWorkspace.notesTemplates', 'academicWorkspace.flashcards',
        'academicWorkspace.extracurriculars', 'collegeAppWorkspace.savedViews',
        'collegeAppWorkspace.collegeTracker', 'collegeAppWorkspace.essayOrganizer',
        'collegeAppWorkspace.scoreTracker', 'collegeAppWorkspace.awardsHonors',
        'collegeAppWorkspace.recommenders', 'collegeAppWorkspace.scholarships',
        'collegeAppWorkspace.activities', 'collegeAppWorkspace.submissionReadiness',
        'collegeAppWorkspace.applicationCosts', 'collegeAppWorkspace.financialAidDeadlines',
        'collegeAppWorkspace.decisionMatrix.colleges', 'collegeAppWorkspace.majorDecisionMatrix.majors',
        'collegeAppWorkspace.visitTracker.visits', 'lifeWorkspace.goals', 'lifeWorkspace.habits',
        'lifeWorkspace.habitCompletions', 'lifeWorkspace.habitExcused', 'lifeWorkspace.skills',
        'lifeWorkspace.fitness', 'lifeWorkspace.calories', 'lifeWorkspace.books', 'lifeWorkspace.spending',
        'lifeWorkspace.spendingBudgets', 'lifeWorkspace.recurringExpenses', 'lifeWorkspace.journals',
        'lifeWorkspace.wellness.checkIns', 'lifeWorkspace.wellness.journalEntries',
        'businessWorkspace.projects', 'businessWorkspace.clients', 'businessWorkspace.invoices',
        'businessWorkspace.finance', 'businessWorkspace.opportunities', 'businessWorkspace.meetings',
        'businessWorkspace.proposals', 'businessWorkspace.tasks', 'businessWorkspace.documents',
        'businessWorkspace.goals', 'businessWorkspace.notes', 'businessWorkspace.activity',
        'apStudyWorkspace.subjects', 'apStudyWorkspace.units', 'apStudyWorkspace.topics',
        'apStudyWorkspace.sessions', 'apStudyWorkspace.practiceLogs', 'apStudyWorkspace.activity',
        'schoolSchedule.schedules', 'schoolSchedule.dayTemplates', 'schoolSchedule.overrides',
        'schoolSchedule.subscriptions', 'gradePlanner.courses', 'semesterSetup.drafts',
        'testingHub.custom', 'testingHub.takenExams', 'settings.customShortcuts', 'settings.customThemes',
        'settings.selectedPagesForTheme', 'settings.recentSearches', 'settings.customization.cssSnippets',
        'settings.customization.installedPlugins', 'settings.preferences.quotes.customQuotes',
        'operatingManual.preferredStudyTimes', 'pinnedPages.life', 'pinnedPages.collegeapp',
        'pinnedPages.notesBySpace'
    ];
    const TESTING_PROFILE_KEYS = ['ap', 'sat', 'act', 'mcat', 'gre', 'lsat', 'gmat', 'psat', 'toefl', 'ielts', 'clep', 'ib', 'state'];
    const TESTING_PROFILE_DATA_KEYS = ['resourceLinks', 'weakAreas', 'practiceTests', 'mistakes', 'tasks'];
    const BUILT_IN_FOCUS_TEMPLATE_IDS = new Set([
        'tpl_deep_work', 'tpl_ap_review', 'tpl_homework_sprint', 'tpl_reading_block', 'tpl_project_build', 'tpl_review_focus'
    ]);
    let migrationPromise = null;

    function readLegacyWorkspace() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(DB_NAME);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const source = parsed && parsed.appData && typeof parsed.appData === 'object'
                ? parsed.appData
                : parsed;
            if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
            const workspace = { ...source };
            workspace.settings = {
                ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
            };
            const flags = [
                'studentOnboardingCompleted', 'studentOnboardingCompletedAt',
                'featureSelectionCompleted', 'userMode', 'userModeSetupCompleted',
                'tutorialSeen', 'tutorialCompleted', 'tutorialCompletedAt'
            ];
            flags.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(parsed, key)
                    && !Object.prototype.hasOwnProperty.call(workspace.settings, key)) {
                    workspace.settings[key] = parsed[key];
                }
            });
            return workspace;
        } catch (error) {
            try { console.warn('Unable to inspect legacy workspace storage', error); } catch (_) {}
            return null;
        }
    }

    function valueAtPath(source, path) {
        return path.split('.').reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, source);
    }

    function hasStoredValue(value) {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return typeof value === 'string' ? value.trim().length > 0 : false;
    }

    function hasUnknownStoredValue(value) {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        // Forward-compatible numeric and boolean fields may be the only copy of
        // future user state. Treat them conservatively, including 0 and false.
        return true;
    }

    function isGeneratedHelpPage(page) {
        if (!page || typeof page !== 'object') return false;
        if (page.isSystemPage === true || page.builtInId === 'help-docs' || page.systemRole === 'help-docs') return true;
        const id = String(page.id || '');
        return (id === 'help_page' || id.startsWith('help_page_'))
            && String(page.title || '').trim().toLowerCase() === 'help & docs';
    }

    function hasUserSpaces(spaces) {
        if (!Array.isArray(spaces)) return false;
        return spaces.some(space => space && String(space.id || '') !== 'default');
    }

    function hasMeaningfulData(workspace) {
        if (!workspace || typeof workspace !== 'object') return false;
        if (Array.isArray(workspace.pages) && workspace.pages.some(page => page && !isGeneratedHelpPage(page))) return true;
        if (hasUserSpaces(workspace.spaces)) return true;
        if (USER_DATA_PATHS.some(path => hasStoredValue(valueAtPath(workspace, path)))) return true;
        if (typeof valueAtPath(workspace, 'businessWorkspace.quickCapture') === 'string'
            && valueAtPath(workspace, 'businessWorkspace.quickCapture').trim()) return true;
        if (TESTING_PROFILE_KEYS.some(profileKey => {
            const profile = workspace.testingHub && workspace.testingHub[profileKey];
            if (!profile || typeof profile !== 'object') return false;
            if (TESTING_PROFILE_DATA_KEYS.some(key => hasStoredValue(profile[key]))) return true;
            return !!(profile.examDate || profile.targetScore != null || profile.currentScore != null
                || String(profile.notes || '').trim() || String(profile.resources || '').trim()
                || String(profile.pacingNotes || '').trim());
        })) return true;
        if (Array.isArray(workspace.focusTemplates)
            && workspace.focusTemplates.some(template => template && !BUILT_IN_FOCUS_TEMPLATE_IDS.has(String(template.id || '')))) return true;
        if (Object.keys(workspace).some(key => !KNOWN_WORKSPACE_FIELDS.has(key) && hasUnknownStoredValue(workspace[key]))) return true;
        return false;
    }

    function meaningfulDataScore(workspace) {
        if (!hasMeaningfulData(workspace)) return 0;
        const count = value => Array.isArray(value) ? value.length : 0;
        const userPages = Array.isArray(workspace.pages)
            ? workspace.pages.filter(page => page && page.isSystemPage !== true && !page.builtInId).length
            : 0;
        return (userPages * 10)
            + (count(workspace.tasks) * 8)
            + (count(workspace.homeworkWorkspace && workspace.homeworkWorkspace.tasks) * 8)
            + (count(workspace.timeBlocks) * 4)
            + (count(workspace.reviewWorkspace && workspace.reviewWorkspace.items) * 3)
            + (count(workspace.reviewWorkspace && workspace.reviewWorkspace.decks) * 5)
            + (count(workspace.courseWorkspace && workspace.courseWorkspace.courses) * 5)
            + (count(workspace.courseWorkspace && workspace.courseWorkspace.files) * 2)
            + count(workspace.focusSessions)
            + count(workspace.cramSessions)
            + 1;
    }

    function hasLegacySetupMetadata(workspace) {
        if (!workspace || typeof workspace !== 'object') return false;
        const settings = workspace.settings && typeof workspace.settings === 'object'
            ? workspace.settings
            : {};
        return settings.studentOnboardingCompleted === true
            || settings.featureSelectionCompleted === true
            || settings.userModeSetupCompleted === true
            || settings.tutorialSeen === true
            || settings.tutorialCompleted === true
            || typeof settings.userMode === 'string' && settings.userMode.trim().length > 0;
    }

    function chooseRecoveryCandidate(journal, legacy) {
        // The journal is the immediately previous confirmed canonical root.
        // A legacy localStorage copy can be much older, so record count must
        // never let it outrank the journal.
        if (hasMeaningfulData(journal)) return { source: 'journal', workspace: journal };
        // A few early builds stored setup-completion flags in the monolithic
        // localStorage record before the user created any notes. Preserve that
        // metadata too, otherwise an existing user can be treated as brand new
        // solely because their legacy record contains no content yet.
        if (hasMeaningfulData(legacy) || hasLegacySetupMetadata(legacy)) {
            return { source: 'legacy-local-storage', workspace: legacy };
        }
        return null;
    }

    function isConfirmedCanonicalRoot(root, marker) {
        if (!marker || typeof marker !== 'object' || marker.version !== 1) return false;
        return marker.meaningful === hasMeaningfulData(root);
    }

    function healOnboardingState(workspace) {
        if (!hasMeaningfulData(workspace)) return workspace;
        const settings = workspace.settings && typeof workspace.settings === 'object' ? workspace.settings : {};
        const onboarding = settings.onboarding && typeof settings.onboarding === 'object' ? settings.onboarding : {};
        if (onboarding.completed === true || onboarding.skipped === true) return workspace;
        // A versioned, migrated pending state is intentional (for example, the
        // user chose Continue later). Only heal absent or legacy/default state.
        if (onboarding.version === 1 && onboarding.migratedFromLegacy === true) return workspace;
        const healed = {
            ...workspace,
            settings: {
                ...settings,
                onboarding: {
                    ...onboarding,
                    version: 1,
                    completed: true,
                    skipped: false,
                    migratedFromLegacy: true,
                    completedAt: onboarding.completedAt || new Date().toISOString()
                },
                studentOnboardingCompleted: true,
                studentOnboardingCompletedAt: settings.studentOnboardingCompletedAt || new Date().toISOString(),
                featureSelectionCompleted: true,
                userModeSetupCompleted: true
            }
        };
        return healed;
    }

    const migrationAdapter = originalCreate.call(originalApi, {
        dbName: DB_NAME,
        storeName: STORE_NAME,
        version: CANONICAL_DB_VERSION
    });
    migrationPromise = Promise.all([
        migrationAdapter.read(ROOT_KEY),
        migrationAdapter.read(LAST_MEANINGFUL_KEY),
        migrationAdapter.read(CONFIRMED_ROOT_KEY)
    ]).then(async values => {
        let root = values[0];
        const journal = values[1];
        const confirmedRoot = values[2];
        try {
            // A matching marker proves the empty/default root was deliberately
            // accepted by the canonical save path. Do not resurrect older data
            // over an intentional delete-everything result.
            if (!hasMeaningfulData(root) && !isConfirmedCanonicalRoot(root, confirmedRoot)) {
                const recovery = chooseRecoveryCandidate(journal, readLegacyWorkspace());
                if (recovery) {
                    // Preserve even the empty/default candidate before replacing it.
                    // This makes the recovery reversible for diagnostics while the
                    // richer workspace becomes canonical again.
                    if (root) await migrationAdapter.write(EMPTY_BEFORE_RECOVERY_KEY, root);
                    root = recovery.workspace;
                    await migrationAdapter.write(ROOT_KEY, root);
                    try {
                        if (typeof global.SutraReportError === 'function') {
                            global.SutraReportError('Recovered an empty canonical workspace', {
                                where: 'legacy-workspace-migration',
                                source: recovery.source,
                                score: meaningfulDataScore(root)
                            }, 'warning');
                        } else {
                            console.warn('Recovered an empty canonical workspace from ' + recovery.source + '.');
                        }
                    } catch (_) {}
                }
            }
            const healed = healOnboardingState(root);
            if (healed !== root && healed) await migrationAdapter.write(ROOT_KEY, healed);
        } finally {
            try { migrationAdapter.close(); } catch (_) {}
        }
    }).catch(error => {
        try { console.warn('Legacy workspace migration deferred; canonical startup will report storage errors.', error); } catch (_) {}
    });

    global.SutraWorkspaceDB = {
        ...originalApi,
        create(options) {
            const requested = options && typeof options === 'object' ? options : {};
            const isCanonicalWorkspace = String(requested.dbName || '') === DB_NAME
                && String(requested.storeName || '') === STORE_NAME;
            const adapterOptions = isCanonicalWorkspace
                ? {
                    ...requested,
                    backupKey: requested.backupKey || LAST_MEANINGFUL_KEY,
                    shouldBackup: requested.shouldBackup || ((current, _next, key) => String(key) === ROOT_KEY && hasMeaningfulData(current)),
                    commitKey: requested.commitKey || CONFIRMED_ROOT_KEY,
                    buildCommit: requested.buildCommit || ((_current, next, key) => String(key) === ROOT_KEY
                        ? { version: 1, meaningful: hasMeaningfulData(next), confirmedAt: new Date().toISOString() }
                        : undefined)
                }
                : requested;
            const adapter = originalCreate.call(originalApi, adapterOptions);
            const waitForMigration = () => migrationPromise || Promise.resolve();
            return {
                ...adapter,
                read: async (...args) => { await waitForMigration(); return adapter.read(...args); },
                write: async (...args) => { await waitForMigration(); return adapter.write(...args); },
                writeIf: async (...args) => { await waitForMigration(); return adapter.writeIf(...args); }
            };
        }
    };

    // Onboarding historically queued completion through the ordinary debounce.
    // A reload immediately after Finish could beat that timer and reopen setup.
    // Observe the modal's open -> closed transition and force the public,
    // readback-verified workspace save once the controller has committed its
    // in-memory state. Dismissing midway is safe too: it durably preserves only
    // the user's current progress and still reopens setup next launch.
    function bindOnboardingCompletionFlush() {
        const overlay = global.document && global.document.getElementById('studentOnboardingOverlay');
        if (!overlay || overlay.dataset.storageFlushBound === 'true' || typeof MutationObserver === 'undefined') return;
        overlay.dataset.storageFlushBound = 'true';
        let wasOpen = overlay.classList.contains('active') && overlay.getAttribute('aria-hidden') !== 'true';
        let flushInFlight = false;
        const observer = new MutationObserver(() => {
            const isOpen = overlay.classList.contains('active') && overlay.getAttribute('aria-hidden') !== 'true';
            if (wasOpen && !isOpen && !flushInFlight) {
                flushInFlight = true;
                Promise.resolve().then(async () => {
                    if (typeof global.saveWorkspaceLocally === 'function') {
                        await global.saveWorkspaceLocally();
                    }
                }).catch(error => {
                    try {
                        if (typeof global.SutraReportError === 'function') {
                            global.SutraReportError(error, { where: 'onboarding.completion-flush' }, 'error');
                        }
                    } catch (_) {}
                }).finally(() => { flushInFlight = false; });
            }
            wasOpen = isOpen;
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', bindOnboardingCompletionFlush, { once: true });
    } else {
        bindOnboardingCompletionFlush();
    }
}(typeof window !== 'undefined' ? window : globalThis));
