#!/usr/bin/env node
// Smoke check: verifies that the Atelier .atelier export/import wiring
// and settings save/apply wiring are intact. Does not execute the app;
// runs text-level structural assertions against the shipped source.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rel = (p) => resolve(repoRoot, p);

const failures = [];

function mustContain(file, needle, label) {
    try {
        const text = readFileSync(rel(file), 'utf8');
        if (!text.includes(needle)) {
            failures.push(`${label} missing: ${needle} in ${file}`);
        }
    } catch (err) {
        failures.push(`${label} read failed for ${file}: ${err.message}`);
    }
}

function mustContainAny(file, needles, label) {
    try {
        const text = readFileSync(rel(file), 'utf8');
        if (!needles.some(n => text.includes(n))) {
            failures.push(`${label} missing any of: [${needles.join(', ')}] in ${file}`);
        }
    } catch (err) {
        failures.push(`${label} read failed for ${file}: ${err.message}`);
    }
}

function mustNotContain(file, needle, label) {
    try {
        const text = readFileSync(rel(file), 'utf8');
        if (text.includes(needle)) {
            failures.push(`${label} should be absent but found: ${needle} in ${file}`);
        }
    } catch (err) {
        failures.push(`${label} read failed for ${file}: ${err.message}`);
    }
}

function mustNotMatch(file, pattern, label) {
    try {
        const text = readFileSync(rel(file), 'utf8');
        if (pattern.test(text)) {
            failures.push(`${label} should be absent but matched ${pattern} in ${file}`);
        }
    } catch (err) {
        failures.push(`${label} read failed for ${file}: ${err.message}`);
    }
}

// .atelier export/import coverage
mustContain('src/core/app.js', 'exportWorkspaceAsAtelierPackage', '.atelier export function');
mustContain('src/core/app.js', 'importAtelierPackage', '.atelier import function');

// ---- .sutra / .sutra-plugin formats (new default, legacy .atelier still imports) ----
mustContain('src/core/app.js', "SUTRA_FORMAT_NAME = 'sutra-workspace'", 'canonical Sutra workspace format constant');
mustContain('src/core/app.js', "buildWorkspaceExportFilename('sutra_workspace')", 'default export filename routes through the canonical local-time .sutra builder');
mustContain('src/core/app.js', "product: 'Sutra'", 'export manifest carries Sutra product');
mustContain('src/core/app.js', 'manifestFormat !== SUTRA_FORMAT_NAME && manifestFormat !== ATELIER_FORMAT_NAME', 'import validator accepts .sutra AND legacy .atelier manifests');
mustContain('src/core/app.js', "WORKSPACE_PACKAGE_EXTENSIONS = new Set(['sutra', 'atelier'])", 'import dispatcher recognizes .sutra and legacy .atelier packages');
mustContain('src/core/app.js', 'detectImportedFileKind', 'import dispatcher uses content detection after file selection');
mustContain('src/core/app.js', "+ '.sutra-plugin'", 'plugin export uses .sutra-plugin');
mustContain('Sutra.html', 'id="modsPluginImportInput" hidden', 'plugin import picker has no restrictive proprietary-extension accept filter');
mustContain('Sutra.html', 'id="fileInput" style="display: none;"', 'workspace import picker exists without restrictive accept filter');
mustContain('src/core/app.js', "SUTRA_ENCRYPTED_MAGIC_TEXT = 'SUTRAENC'", 'encrypted .sutra envelope magic constant');
mustContain('src/core/app.js', 'SUTRA_KDF_ITERATIONS = 600000', 'encrypted .sutra PBKDF2 iteration floor');
mustContain('src/core/app.js', 'encryptSutraPackageBytes', 'encrypted .sutra package encryption helper');
mustContain('src/core/app.js', 'decryptSutraEncryptedEnvelopeBytes', 'encrypted .sutra package decryption helper');
mustContain('src/core/app.js', "SUTRA_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'", 'Drive sync uses appDataFolder-only OAuth scope');
mustNotMatch('src/core/app.js', /['"]https:\/\/www\.googleapis\.com\/auth\/drive['"]/, 'broad Google Drive OAuth scope');
mustNotMatch('src/core/app.js', /['"]https:\/\/www\.googleapis\.com\/auth\/drive\.readonly['"]/, 'read-only broad Google Drive OAuth scope');
mustNotMatch('src/core/app.js', /['"]https:\/\/www\.googleapis\.com\/auth\/drive\.file['"]/, 'drive.file scope for automatic sync');
mustContain('src/core/app.js', "parents = ['appDataFolder']", 'Drive sync creates files in appDataFolder');
mustContain('src/core/app.js', "spaces: 'appDataFolder'", 'Drive sync discovers files in appDataFolder');
mustContain('src/core/app.js', 'sutraDriveSyncRuntime.accessToken', 'Drive access token is runtime-only');
mustContain('src/core/app.js', 'sutraDriveSyncRuntime.derivedKey', 'Drive derived key is runtime-only');
mustContain('src/core/app.js', 'sutraDriveSyncRuntime.cyclePromise', 'Drive manual, debounce, and auto cycles are serialized');
mustContain('src/core/app.js', 'enterSutraDriveConflict(remote', 'Drive conflict state cancels queued upload work');
mustContain('src/core/app.js', '!meta.localDirty || sutraDriveSyncRuntime.conflictRemote', 'Drive conflict blocks automatic upload scheduling');
mustContain('src/config/sutra-runtime-config.js', 'googleDriveClientId', 'public Drive OAuth client ID runtime config');
mustContain('Sutra.html', 'src/config/sutra-runtime-config.js', 'runtime config loads before app');

// Sutra Intelligence Harness — module load order + wiring.
mustContain('src/config/feature-manifest.js', 'src/features/assistant/sutra-product-knowledge.js', 'product knowledge registry lazy-loaded');
mustContain('src/config/feature-manifest.js', 'src/features/assistant/sutra-capability-registry.js', 'capability registry lazy-loaded');
mustContain('src/config/feature-manifest.js', 'src/features/assistant/sutra-assistant-memory.js', 'assistant memory module lazy-loaded');
mustContain('src/config/feature-manifest.js', 'src/features/assistant/sutra-local-help.js', 'local help module lazy-loaded');
mustContain('src/config/feature-manifest.js', 'styles/features/sutra-assistant-help.css', 'local help / memory stylesheet lazy-loaded');
mustContain('Sutra.html', 'id="openSutraMemoryManagerBtn"', 'Manage Memory button in Assistant settings');
mustContain('Sutra.html', 'data-pref-path="assistant.useMemory"', 'use-saved-memory toggle in Assistant settings');
mustContain('src/core/app.js', "'sutra:assistantMemory:v1'", 'assistant memory key included in export snapshot');
mustContain('Sutra.html', 'id="asstSidebarResizer"', 'resizable chat-list drag handle present');
mustContain('src/features/assistant/flow-assistant.js', 'setupAsstSidebarResizer', 'chat-list resizer wiring present');
mustContain('src/features/assistant/flow-assistant.js', 'inferActionsFromReply', 'phantom-action safety net present');
mustContain('src/core/app.js', 'buildWorkspaceExportPayload', 'export payload builder');
mustContain('src/core/app.js', 'importWorkspacePayload', 'workspace import function');
mustContain('src/core/app.js', 'collectAtelierRawLocalStorageSnapshot', 'raw localStorage capture');
mustContain('src/core/app.js', 'restoreAtelierRawLocalStorageSnapshot', 'raw localStorage restore');
mustContain('src/core/app.js', 'createPreImportSafetySnapshot', 'pre-import safety snapshot');
mustContain('src/core/app.js', 'ATELIER_SENSITIVE_SETTING_KEYS', 'sensitive key filter');
mustContain('src/core/app.js', "localStorageSnapshot:", 'localStorageSnapshot in payload');
mustContain('src/core/app.js', 'recordAtelierDataHealth', 'data health recorder');
mustContain('src/core/app.js', 'updateAtelierDataHealthUi', 'data health UI update');

// Canonical save/export/import wrapper presence
mustContain('src/core/app.js', 'function serializeWorkspace', 'canonical serializeWorkspace wrapper');
mustContain('src/core/app.js', 'function deserializeWorkspace', 'canonical deserializeWorkspace wrapper');
mustContain('src/core/app.js', 'function saveWorkspaceLocally', 'canonical saveWorkspaceLocally wrapper');
mustContain('src/core/app.js', 'function loadWorkspaceLocally', 'canonical loadWorkspaceLocally wrapper');
mustContain('src/core/app.js', 'function exportWorkspaceAsAtelier', 'canonical exportWorkspaceAsAtelier wrapper');
mustContain('src/core/app.js', 'function exportWorkspaceAsJson', 'canonical exportWorkspaceAsJson wrapper');
mustContain('src/core/app.js', 'function importWorkspaceFile', 'canonical importWorkspaceFile wrapper');
mustContain('src/core/app.js', 'function verifyWorkspaceRoundTrip', 'in-browser round-trip verifier');
mustContain('src/core/app.js', 'window.verifyWorkspaceRoundTrip', 'round-trip verifier exposed on window');
mustContain('src/core/app.js', "atelierTheme: 'light'", 'Atelier shell theme default in settings');
mustContain('src/core/app.js', "retro95: {", 'Retro preset theme registry entry');
mustContain('src/core/app.js', "name: 'Retro 95'", 'Retro preset theme label');
mustContain('src/core/app.js', "['light', 'dark', 'retro95']", 'Atelier theme normalizer accepts Retro 95');
mustContain('src/core/app.js', 'applyAtelierTheme(normalizedTheme);', 'Retro preset syncs the shell theme');
// Regression guard: switching FROM Retro 95 to any other preset must clear the
// retro body class and inline CSS variable overrides.  This check ensures
// applyPresetTheme() calls applyAtelierTheme when wasRetroShellActive is true
// and the new theme is NOT retro95.
mustContain('src/core/app.js', 'wasRetroShellActive', 'applyPresetTheme detects when Retro 95 shell was active before switching away');
mustContain('src/core/app.js', '!isRetroTheme && wasRetroShellActive', 'applyPresetTheme resets Atelier shell when leaving Retro 95');
mustContain('src/core/app.js', "chatMemoryMode: 'stateless'", 'assistant chat memory mode default');
mustContain('src/core/app.js', 'chatMemoryDepth: 10', 'assistant chat memory depth default');

// JSON export must redact sensitive credentials, like the .atelier export does.
mustContain('src/core/app.js', 'mode: \'json\', includeSensitiveSettings: false', 'JSON export strips sensitive credentials');

// Settings save/apply UI hooks
mustContain('src/core/app.js', 'applySettingsDraftChanges', 'settings apply function');
mustContain('src/core/app.js', "settingsApplyBtn", 'settings apply button');
mustContain('src/core/app.js', "settingsApplyBtnTop", 'top settings apply button');
mustContain('Sutra.html', 'id="settingsApplyBtnTop"', 'top settings apply button in HTML');
mustContain('Sutra.html', 'atelier-data-health-card', 'data health card in HTML');
mustContain('Sutra.html', 'data-theme="retro95"', 'Retro shell theme button in settings');
mustContain('Sutra.html', "applyPresetTheme('retro95')", 'Retro preset tile in the preset grid');
mustContain('Sutra.html', 'Retro 95', 'Retro preset label in the preset grid');

// Workspace mode preference plumbing
mustContain('src/core/app.js', "workspace:", 'workspace preference group');
mustContain('src/core/app.js', "'ap_crunch'", 'ap_crunch mode choice');
mustContain('Sutra.html', 'data-pref-path="workspace.mode"', 'workspace mode select in HTML');

// Workspace Mode UI gating helpers
mustContain('src/core/app.js', 'getActiveWorkspaceMode', 'active workspace mode getter');
mustContain('src/core/app.js', 'getWorkspaceModeLabel', 'workspace mode label helper');
mustContain('src/core/app.js', 'shouldShowViewForWorkspaceMode', 'per-view gating helper');
mustContain('src/core/app.js', 'applyWorkspaceModeVisibility', 'apply workspace mode visibility');
mustContain('src/core/app.js', 'hasWorkspaceData', 'workspace data presence check');
mustContain('src/core/app.js', 'WORKSPACE_MODE_VIEW_PROFILE', 'workspace mode profile table');

// Deadline aggregation helpers
mustContain('src/core/app.js', 'collectWorkspaceDeadlines', 'deadline aggregator');
mustContain('src/core/app.js', 'groupDeadlinesByTimeframe', 'deadline grouper');
mustContain('src/core/app.js', 'normalizeDeadlineDate', 'deadline date normalizer');
mustContain('src/core/app.js', 'openDeadlineSource', 'open deadline source helper');
mustContain('src/core/app.js', 'pickNextBestAction', 'next best action picker');

// Daily Brief
mustContain('src/core/app.js', 'renderTodayDailyBrief', 'daily brief renderer');
mustContain('Sutra.html', 'id="todayDailyBrief"', 'Daily Brief container');

// Deadline Radar modal
mustContain('src/core/app.js', 'openDeadlineRadar', 'deadline radar open');
mustContain('src/core/app.js', 'closeDeadlineRadar', 'deadline radar close');
mustContain('Sutra.html', 'id="deadlineRadarModal"', 'Deadline Radar modal markup');

// Student Onboarding Wizard — preserved as compatibility wrappers around the
// unified onboarding controller.
mustContain('src/core/app.js', 'showStudentOnboarding', 'student onboarding opener');
mustContain('src/core/app.js', 'isStudentOnboardingPending', 'student onboarding pending check');
mustContain('src/core/app.js', 'applyStudentOnboarding', 'student onboarding apply');
mustContain('src/core/app.js', 'ONBOARDING_STEPS', 'onboarding step list');
mustContain('Sutra.html', 'id="studentOnboardingOverlay"', 'onboarding overlay markup');
mustContain('Sutra.html', 'id="rerunOnboardingBtn"', 'rerun onboarding button in Settings');

// Unified Onboarding controller (single source of truth replacing the user
// mode modal, feature setup overlay, student wizard, and tutorial auto-popup).
mustContain('src/core/app.js', 'AtelierOnboardingController', 'unified onboarding controller');
mustContain('src/core/app.js', 'getDefaultOnboardingState', 'unified onboarding default state factory');
mustContain('src/core/app.js', 'normalizeOnboardingState', 'unified onboarding state normalizer/migrator');
mustContain('src/core/app.js', 'maybeStartUnifiedOnboarding', 'unified onboarding first-run trigger');
mustContain('src/core/app.js', 'rerunAtelierOnboarding', 'Settings rerun-onboarding entry point');
mustContain('src/core/app.js', 'resetAtelierOnboardingForTesting', 'Settings reset-onboarding-status entry point');
mustContain('src/core/app.js', 'ONBOARDING_USER_INTENTS', 'unified onboarding user intent options');
mustContain('src/core/app.js', 'ONBOARDING_WORKSPACE_FOCUS_OPTIONS', 'unified onboarding workspace focus options');
mustContain('src/core/app.js', 'ONBOARDING_FEATURE_VIEWS', 'unified onboarding feature tile catalog');
mustContain('src/core/app.js', "const ONBOARDING_STEPS = ['welcome', 'classes', 'setup', 'mode', 'protect', 'finish']", 'unified onboarding daily-loop steps');
mustContain('src/core/app.js', 'syncOnboardingStatusUi', 'onboarding status text updater');
mustContain('Sutra.html', 'atelier-onboarding-rail', 'unified onboarding left rail markup');
mustContain('Sutra.html', 'id="onboardingSteps"', 'unified onboarding step list anchor');
mustContain('Sutra.html', 'id="onboardingMainPanel"', 'unified onboarding main panel anchor');
mustContain('Sutra.html', 'id="resetOnboardingBtn"', 'reset-onboarding-for-testing button in Settings');
mustContain('Sutra.html', 'rerunAtelierOnboarding()', 'rerun-onboarding wired to controller');
mustContain('styles/base/styles.css', '.atelier-onboarding-shell', 'unified onboarding shell stylesheet');
mustContain('styles/base/styles.css', '.atelier-onboarding-rail', 'unified onboarding rail stylesheet');
mustContain('styles/base/styles.css', '.atelier-onboarding-card.is-selected', 'unified onboarding selection state stylesheet');
mustContain('styles/base/styles.css', '.legacy-overlay-hidden', 'legacy overlay neutralizer stylesheet');

// Legacy overlays must be permanently neutralized — no separate user-mode or
// feature-setup modal can render.
mustContain('Sutra.html', 'id="userModeOverlay" class="legacy-overlay-hidden"', 'legacy user-mode overlay hidden');
mustContain('Sutra.html', 'feature-setup-overlay legacy-overlay-hidden', 'legacy feature-setup overlay hidden');

// Fresh-install defaults + existing-user preservation (Phase 8).
// Fresh installs emphasize the student-first modules; secondary modules stay
// opt-in. Existing users keep whatever enabled-view choices they already stored.
mustContain('src/state/workspace-normalizers.js', "STUDENT_DEFAULT_ENABLED_VIEWS = new Set(['today', 'homework', 'notes', 'timeline', 'review', 'cramhub'])", 'fresh-install defaults emphasize the student daily-loop surfaces');
mustContain('src/state/workspace-normalizers.js', 'function getDefaultEnabledViews', 'default enabled-views factory present');
mustContain('src/state/workspace-normalizers.js', 'function normalizeEnabledViews', 'enabled-views normalizer present');
mustContain('src/state/workspace-normalizers.js', 'normalized[view] = raw[view] !== false', 'existing-user enabled-view choices are preserved on load');

// Help/tutorial references
mustContainAny('src/core/app.js', ['Daily Brief', 'Deadline Radar', 'Workspace Mode', '.atelier'], 'tutorial mentions new features');
mustContainAny('src/core/app.js', ['Command Palette', 'Quick Capture', 'Weekly Review', 'AP Exam Battle Plan', 'Class Dashboard'], 'tutorial mentions newer features');

// Command Palette
mustContain('src/core/app.js', 'openCommandPalette', 'command palette opener');
mustContain('src/core/app.js', 'closeCommandPalette', 'command palette closer');
mustContain('src/core/app.js', 'getCommandPaletteCommands', 'command palette command list');
mustContain('src/core/app.js', 'renderCommandPalette', 'command palette renderer');
mustContain('src/core/app.js', 'bindCommandPaletteInput', 'command palette input binder');
mustContain('Sutra.html', 'id="commandPaletteModal"', 'command palette modal markup');

// Quick Capture
mustContain('src/core/app.js', 'openQuickCaptureModal', 'quick capture opener');
mustContain('src/core/app.js', 'closeQuickCaptureModal', 'quick capture closer');
mustContain('src/core/app.js', 'submitQuickCapture', 'quick capture submit');
mustContain('src/core/app.js', 'parseQuickCaptureText', 'quick capture parser');
mustContain('src/core/app.js', 'getQuickCaptureApSubjects', 'quick capture AP subject helper');
mustContain('src/core/app.js', 'syncQuickCaptureApSubjectField', 'quick capture AP picker sync');
mustContain('Sutra.html', 'id="quickCaptureModal"', 'quick capture modal markup');
mustContain('Sutra.html', 'id="quickCaptureApSubject"', 'quick capture AP picker markup');

// Global Search
mustContain('src/core/app.js', 'globalSearchAll', 'global search aggregator');

// Weekly Review
mustContain('src/core/app.js', 'createWeeklyReviewNote', 'weekly review note creator');

// AP Battle Plan
mustContain('src/core/app.js', 'computeApBattlePlan', 'AP Battle Plan computer');
mustContain('src/core/app.js', 'renderApBattlePlan', 'AP Battle Plan renderer');
mustContain('Sutra.html', 'id="apBattlePlanCard"', 'AP Battle Plan card markup');

// Class Dashboard
mustContain('src/core/app.js', 'openClassDashboardDrawer', 'class dashboard opener');
mustContain('src/core/app.js', 'closeClassDashboardDrawer', 'class dashboard closer');
mustContain('Sutra.html', 'id="classDashboardDrawer"', 'class dashboard markup');
mustContain('src/features/study/homework.js', 'data-task-dashboard', 'homework assignment class dashboard entry');
mustContain('src/features/study/ap-study.js', 'data-ap-action="open-class-dashboard"', 'AP Study class dashboard entry');
mustContain('src/core/app.js', 'breadcrumb-class-chip', 'notes class chip entry point');
mustContain('src/core/app.js', 'data-brief-open-class', 'daily brief class dashboard entry');
mustContain('src/core/app.js', 'data-deadline-open-class', 'deadline radar class dashboard entry');

// Schedule this on deadline items
mustContain('src/core/app.js', 'scheduleDeadlineItemAsBlock', 'Schedule-this helper for deadlines');
mustContain('src/core/app.js', 'data-deadline-schedule', 'Schedule button in deadline radar rendering');

// Mode-aware overflow menu
mustContain('src/core/app.js', 'shouldShowViewForWorkspaceMode(view)', 'overflow menu mode gating filter');

// Homework paste import
mustContain('src/core/app.js', 'parseHomeworkPasteText', 'homework paste parser');
mustContain('src/core/app.js', 'openHomeworkPasteImport', 'homework paste opener');
mustContain('src/core/app.js', 'submitHomeworkPasteImport', 'homework paste submit');
mustContain('Sutra.html', 'id="homeworkPasteImportModal"', 'homework paste modal markup');
mustContain('Sutra.html', 'id="hwPasteImportBtn"', 'homework paste import button');

// Split-screen presets
mustContain('src/core/app.js', 'NOTES_SPLIT_PRESETS', 'split-screen presets table');
mustContain('src/core/app.js', 'applyNotesSplitPreset', 'split-screen preset applier');
mustContain('src/core/app.js', 'openNotesSplitPresetsPicker', 'split-screen presets picker');
mustContain('Sutra.html', 'id="splitNotesPresetsBtn"', 'split-screen presets button');

// Class Dashboard note linking
mustContain('src/core/app.js', 'getNotesLinkedToClass', 'class-note linked notes getter');
mustContain('src/core/app.js', 'linkCurrentNoteToClass', 'class-note linker');
mustContain('src/core/app.js', 'createNoteLinkedToClass', 'class-note creator');
mustContain('src/core/app.js', 'classLinkId', 'class link property');

// AP Battle Plan native
mustContain('src/core/app.js', 'createApStudySessionFromBattlePlan', 'AP battle plan session creator');
mustContain('src/core/app.js', 'createApUnitNoteFromBattlePlan', 'AP battle plan note creator');
mustContain('src/core/app.js', 'apBattleCreateSessionBtn', 'AP battle plan session button');

// Global Search panel
mustContain('src/core/app.js', 'openGlobalSearchPanel', 'global search panel opener');
mustContain('src/core/app.js', 'closeGlobalSearchPanel', 'global search panel closer');
mustContain('Sutra.html', 'id="globalSearchPanel"', 'global search panel markup');

// Quick Capture native routing
mustContain('src/core/app.js', 'apStudyWorkspace.sessions.push', 'Quick Capture AP session creation');
mustContain('src/core/app.js', 'collegeTracker.essays', 'Quick Capture college essay routing');

// Schedule-this helpers
mustContain('src/core/app.js', 'scheduleGenericItemAsBlock', 'generic schedule helper');
mustContain('src/features/study/homework.js', 'data-task-schedule', 'Schedule this button in homework menu');
mustContain('src/core/app.js', "'college-action': 'schedule'", 'college sheet schedule action');
mustContain('src/core/app.js', "'collegeapp-action': 'schedule'", 'college app schedule action');
mustContain('src/core/app.js', 'createCollegeEssayNoteFromContext', 'college essay note creator');
mustContain('src/core/app.js', "'college-action': 'essay-note'", 'college sheet essay note action');
mustContain('src/core/app.js', "'collegeapp-action': 'essay-note'", 'college app essay note action');

// ICS import/export
mustContain('src/core/app.js', 'parseIcsEvents', 'ICS parser');
mustContain('src/core/app.js', 'exportCalendarIcs', 'ICS export function');
mustContainAny('src/core/app.js', ['importCalendarIcsBtn', 'parseIcsEvents(icsText)', 'calendar_ics'], 'ICS import wiring');

// Tutorial / help updates
mustContainAny('src/core/app.js', ['Homework Paste Import', 'homework-paste-import'], 'tutorial/help mentions homework paste import');
mustContainAny('src/core/app.js', ['Split-screen Workflow', 'split-screen-presets'], 'tutorial/help mentions split-screen presets');
mustContainAny('src/core/app.js', ['Search Everywhere', 'search-everywhere'], 'tutorial/help mentions Search Everywhere');
mustContainAny('src/core/app.js', ['First 10 Minutes In Sutra', 'Sutra Modes', 'Daily Thread And Deadline Radar'], 'help rewrite mentions current onboarding flow');
mustContainAny('src/core/app.js', ['encrypted .sutra backup/restore', 'Sutra cannot recover a forgotten backup password', 'JSON exports remain unencrypted'], 'help explains encrypted backup limits');

// Life / Business refinement
mustContain('Sutra.html', 'More Life Tools', 'life dashboard secondary tools grouping');
mustContainAny('src/core/app.js', ['bw.finance', 'bw.tasks', 'bw.proposals'], 'business data visibility logic');
mustContainAny('src/core/app.js', ['lw.journals', 'lw.spending'], 'life data visibility logic');

// ----------------------------------------------------------------------
// Connected productivity upgrade: Review, Focus templates, Split context,
// Mobile Today Mode, extended Global Search.
// ----------------------------------------------------------------------

// Review tab + scheduling module (Quizlet-style with 5 study modes)
mustContain('src/state/workspace-normalizers.js', "OPTIONAL_FEATURE_VIEWS = ['today'", 'feature-views array exists');
mustContain('src/state/workspace-normalizers.js', "'review'", 'review view registered in OPTIONAL_FEATURE_VIEWS');
mustContain('src/core/app.js', 'getDefaultReviewWorkspace', 'review workspace defaults helper');
mustContain('src/core/app.js', 'normalizeReviewWorkspace', 'review workspace normalizer');
mustContain('src/core/app.js', 'reviewWorkspace = getDefaultReviewWorkspace()', 'review workspace runtime variable');
mustContain('src/core/app.js', 'appData.reviewWorkspace = normalizeReviewWorkspace', 'review workspace persisted');
mustContain('src/core/app.js', "defaultStudyMode: 'flashcards'", 'review settings default study mode');
mustContain('src/core/app.js', 'testQuestionCount', 'review settings test question count');
mustContain('src/core/app.js', 'matchPairCount', 'review settings match pair count');
mustContain('src/features/study/review.js', 'function applyGrade', 'review SM-2 grader');
mustContain('src/features/study/review.js', 'function promoteMastery', 'review mastery promoter');
mustContain('src/features/study/review.js', 'function bulkImportCards', 'review bulk import helper');
mustContain('src/features/study/review.js', "function buildLearnChoices", 'review learn-mode choice builder');
mustContain('src/features/study/review.js', 'function buildTestQuestions', 'review test-mode question builder');
mustContain('src/features/study/review.js', 'function buildMatchTiles', 'review match-mode tile builder');
mustContain('src/features/study/review.js', "function fuzzyEqual", 'review fuzzy answer comparator');
mustContain('src/features/study/review.js', "STUDY_MODES = ['flashcards', 'learn', 'write', 'test', 'match']", 'review study modes list');
mustContain('src/features/study/review.js', 'window.renderReviewWorkspace', 'review render exposed on window');
mustContain('src/features/study/review.js', 'window.getReviewTodayStats', 'review today stats exposed on window');
mustContain('src/features/study/review.js', 'window.getReviewSearchResults', 'review search bridge exposed on window');
mustContain('src/features/study/review.js', 'window.openReviewDeck', 'review open-deck bridge exposed on window');
mustContain('Sutra.html', 'id="view-review"', 'review view section in HTML');
mustContain('Sutra.html', 'id="tabReview"', 'review tab button in HTML');
mustContain('Sutra.html', 'id="reviewMount"', 'review mount point in HTML');
mustContain('Sutra.html', 'id="reviewCreateItemForm"', 'legacy review form retained for back-compat');
mustContain('Sutra.html', 'src/features/study/review.js', 'review.js script included');
mustContain('styles/base/styles.css', '.review-bigcard', 'review big-card flashcard style present');
mustContain('styles/base/styles.css', '.review-match-grid', 'review match-mode grid style present');
mustContain('styles/base/styles.css', '.review-mastery-bar', 'review mastery bar style present');

// Focus templates
mustContain('src/core/app.js', 'getDefaultFocusTemplates', 'focus templates defaults helper');
mustContain('src/core/app.js', 'normalizeFocusTemplates', 'focus templates normalizer');
mustContain('src/core/app.js', 'function applyFocusTemplate', 'focus template applier');
mustContain('src/core/app.js', 'function renderFocusTemplateStrip', 'focus template strip renderer');
mustContain('src/core/app.js', 'window.applyFocusTemplate', 'focus template applier exposed on window');
mustContain('Sutra.html', 'id="focusTemplateStrip"', 'focus template strip in HTML');

// Split View pane context
mustContain('src/core/app.js', 'getDefaultSplitPaneContexts', 'split pane contexts defaults helper');
mustContain('src/core/app.js', 'normalizeSplitPaneContexts', 'split pane contexts normalizer');
mustContain('src/core/app.js', 'function updateSplitPaneContext', 'split pane context updater');
mustContain('src/core/app.js', 'function setSplitViewSelection', 'split view selection setter');
mustContain('src/core/app.js', 'splitPaneContexts = getDefaultSplitPaneContexts()', 'split pane contexts runtime variable');
mustContain('src/core/app.js', 'appData.splitPaneContexts = normalizeSplitPaneContexts', 'split pane contexts persisted');

// Today integration
mustContain('src/core/app.js', 'function renderTodayReviewCard', 'today review-due card renderer');
mustContain('src/core/app.js', 'function renderTodayTrackerSummary', 'today tracker summary renderer');
mustContain('src/core/app.js', 'function renderTodayMobileShell', 'today mobile shell renderer');
mustContain('Sutra.html', 'id="todayReviewCard"', 'today review card host in HTML');
mustContain('Sutra.html', 'id="todayTrackerSummary"', 'today tracker summary host in HTML');
mustContain('Sutra.html', 'id="todayMobileShell"', 'today mobile shell host in HTML');

// Today redesign — Next Up card + Upcoming Radar
mustContain('Sutra.html', 'src/features/workspace/today-command-center.js?v=', 'today command center module cache-busted include');
mustContain('Sutra.html', 'id="upcomingRadarMount"', 'upcoming radar mount in HTML');
mustContain('Sutra.html', 'id="upcomingRadarFilter"', 'upcoming radar filter dropdown in HTML');
mustContain('Sutra.html', 'styles/views/today-redesign.css?v=', 'today redesign stylesheet cache-busted include');
mustContain('src/features/workspace/today-command-center.js', 'window.SutraTodayCenter', 'today center helpers exposed on window');
mustContain('src/features/workspace/today-command-center.js', 'getNextPriorityItem', 'deterministic next-priority helper');
mustContain('src/features/workspace/today-command-center.js', 'groupItemsByTimeHorizon', 'time-horizon grouping helper');
mustContain('src/core/app.js', 'function renderUpcomingRadar', 'upcoming radar renderer wrapper');
mustContain('Sutra.html', 'src/features/workspace/today-dashboard.js?v=', 'today dashboard customizer cache-busted include');
mustContain('Sutra.html', 'id="todayDashboardModal"', 'today dashboard customizer modal');
mustContain('Sutra.html', 'id="todayCustomizeDashboardBtn"', 'today dashboard customizer entry point');
mustContain('src/features/workspace/today-dashboard.js', 'window.SutraTodayDashboard', 'today dashboard API exposed on window');
mustContain('src/core/app.js', "getWorkspacePreference('today.dashboard'", 'today dashboard canonical preference bridge');
mustContain('docs/architecture/persistence-inventory.json', '"settings.preferences.today.dashboard"', 'today dashboard nested persistence contract');

// Custom Tabs — user-composed widget dashboards
mustContain('Sutra.html', 'src/features/workspace/custom-tabs.js?v=', 'custom tabs module cache-busted include');
mustContain('Sutra.html', 'styles/views/custom-tabs.css?v=', 'custom tabs stylesheet cache-busted include');
mustContain('src/core/app.js', 'function normalizeCustomTabsSafe', 'custom tabs normalizer in core');
mustContain('src/core/app.js', 'window.SutraCustomTabsBridge', 'custom tabs core bridge exposed');
mustContain('src/core/app.js', 'customTabs: normalizeCustomTabsSafe(customTabsData)', 'custom tabs travel in workspace export payload');
mustContain('src/core/app.js', 'customTabs: payload.customTabs', 'custom tabs travel in JSON export payload');
mustContain('src/core/app.js', 'customTabsData = normalizeCustomTabsSafe(importedCustomTabs)', 'custom tabs restored on workspace import');
mustContain('src/features/workspace/custom-tabs.js', 'window.SutraCustomTabs', 'custom tabs module exposed on window');
mustContain('docs/architecture/persistence-inventory.json', '"customTabs"', 'custom tabs listed in persistence inventory');
mustContain('src/features/assistant/flow-assistant.js', 'function summarizeCustomTab', 'assistant summarizes custom tab widget content');
mustContain('src/features/assistant/flow-assistant.js', 'ctx.customTab = customTab', 'assistant attaches custom-tab context');

// Mobile Today Mode
mustContain('src/core/app.js', 'function shouldUseMobileTodayMode', 'mobile today mode decider');
mustContain('src/core/app.js', 'function applyMobileTodayModeClass', 'mobile today mode class applier');
mustContain('src/core/app.js', "mobileTodayMode: 'auto'", 'mobile today mode default in settings');
mustContain('styles/base/styles.css', '.today-mobile-shell', 'mobile today shell stylesheet block');
mustContain('styles/base/styles.css', 'body.mobile-today-mode', 'mobile today mode CSS scope');

// Extended Global Search + recent-searches persistence
mustContain('src/core/app.js', 'review: []', 'global search now indexes review');
mustContain('src/core/app.js', 'trackers: []', 'global search now indexes trackers');
mustContain('src/core/app.js', 'recentSearches', 'recent searches setting wired');

// Persistence parity for new top-level keys
mustContain('src/core/app.js', "reviewWorkspace: payload.reviewWorkspace", 'review workspace in jsonPayload');
mustContain('src/core/app.js', "focusTemplates: payload.focusTemplates", 'focus templates in jsonPayload');
mustContain('src/core/app.js', "splitPaneContexts: payload.splitPaneContexts", 'split pane contexts in jsonPayload');

// ----------------------------------------------------------------------
// Integrated New Page templates: 5 student templates + picker + helpers.
// ----------------------------------------------------------------------
mustContain('src/core/app.js', "lecture_notes:", 'lecture notes template registered');
mustContain('src/core/app.js', "homework_tracker:", 'homework tracker template registered');
mustContain('src/core/app.js', "study_session:", 'study session template registered');
mustContain('src/core/app.js', "exam_prep:", 'exam prep template registered');
mustContain('src/core/app.js', "project_workspace:", 'project workspace template registered');
mustContain('src/core/app.js', 'INTEGRATED_TEMPLATE_IDS', 'integrated template id list registered');
mustContain('src/core/app.js', 'isIntegratedStudentTemplate', 'integrated template predicate present');
mustContain('src/core/app.js', 'function getActiveCreationContext', 'creation context detector present');
mustContain('src/core/app.js', 'function addHomeworkAssignmentForTemplate', 'template homework helper present');
mustContain('src/core/app.js', 'function addCalendarBlockForTemplate', 'template calendar helper present');
mustContain('src/core/app.js', 'function addReviewDeckForTemplate', 'template review deck helper present');
mustContain('src/core/app.js', 'function fillTemplateContentTokens', 'template content token filler present');
mustContain('src/core/app.js', 'function readNewPageContextFields', 'context fields reader present');
mustContain('src/core/app.js', 'function renderTemplatePickerCards', 'template picker card renderer present');
mustContain('src/core/app.js', 'function setNewPageTemplateSelection', 'template picker selection setter present');
mustContain('src/core/app.js', 'function populateContextClassPicker', 'class picker populator present');
mustContain('src/core/app.js', 'TEMPLATE_CONNECTION_LABELS', 'template connection label map present');
mustContain('src/core/app.js', "templateType: template.id", 'page metadata records templateType');
mustContain('src/core/app.js', "linkedHomeworkTaskIds:", 'page metadata records linkedHomeworkTaskIds');
mustContain('src/core/app.js', "linkedReviewItemIds:", 'page metadata records linkedReviewItemIds');
mustContain('src/core/app.js', "linkedReviewDeckId:", 'page metadata records linkedReviewDeckId');
mustContain('src/core/app.js', "linkedCalendarBlockIds:", 'page metadata records linkedCalendarBlockIds');
mustContain('src/core/app.js', "sourceContext:", 'page metadata records sourceContext');
mustContain('Sutra.html', 'id="templatePickerGrid"', 'template picker grid in HTML');
mustContain('Sutra.html', 'id="templatePickerSearch"', 'template picker search input in HTML');
mustContain('Sutra.html', 'id="newPageContextPanel"', 'new page context panel in HTML');
mustContain('Sutra.html', 'id="newPageContextClass"', 'new page class picker in HTML');
mustContain('Sutra.html', 'id="newPageDueDate"', 'new page due date input in HTML');
mustContain('Sutra.html', 'id="newPageExamDate"', 'new page exam date input in HTML');
mustContain('Sutra.html', 'id="newPageDeadline"', 'new page deadline input in HTML');
mustContain('Sutra.html', 'id="templatePreviewConnections"', 'connections preview chips in HTML');
mustContain('styles/base/styles.css', '.template-card-grid', 'template card grid stylesheet');
mustContain('styles/base/styles.css', '.template-card.selected', 'selected card style');
mustContain('styles/base/styles.css', '.new-page-context-panel', 'context panel style');

// ----------------------------------------------------------------------
// Flow Assistant — contextual workspace assistant layer.
// ----------------------------------------------------------------------
mustContain('src/config/feature-manifest.js', 'src/features/assistant/flow-assistant.js', 'Flow Assistant script included in optional pack');
mustContain('Sutra.html', 'id="chatbotBtn"', 'Flow Assistant mascot button present');
mustContain('Sutra.html', 'id="chatbotPanel"', 'Flow Assistant panel present');

// ---- Sutra rebrand (public branding + assistant) -------------------------
mustContain('Sutra.html', '<title>Sutra</title>', 'app shell title rebranded to Sutra');
mustContain('Sutra.html', 'assets/brand/sutra/generated/sutra-icon-32.png', 'Sutra PNG favicon (32px) referenced');
mustContain('Sutra.html', 'aria-label="Sutra Assistant"', 'assistant panel renamed to Sutra Assistant');
mustContain('Sutra.html', 'data-sutra-component="assistant-intelligence-badge"', 'Powered by Sutra Intelligence badge hook present');
mustContain('Sutra.html', 'Powered by Sutra Intelligence', 'Sutra Intelligence badge label present');
mustContain('Sutra.html', 'placeholder="Ask about your notes, plans, or files…"', 'composer placeholder reads redesigned prompt');
mustContain('Sutra.html', '<span class="app-title-wordmark">Sutra</span>', 'sidebar wordmark rebranded to Sutra');
mustContain('Sutra.html', 'data-pref-path="assistant.contextDepth"', 'Assistant context depth setting in HTML');
mustContain('Sutra.html', 'data-pref-path="assistant.showActionPreviews"', 'Assistant show-action-previews setting in HTML');
mustContain('Sutra.html', 'data-pref-path="assistant.requireConfirmation"', 'Assistant require-confirmation setting in HTML');

mustContain('src/features/assistant/flow-assistant.js', 'function getFlowAssistantContext', 'Flow context gatherer');
mustContain('src/features/assistant/flow-assistant.js', 'function buildSystemPrompt', 'Flow system prompt builder');
mustContain('src/features/assistant/flow-assistant.js', 'function parseActions', 'Flow action parser');
mustContain('src/features/assistant/flow-assistant.js', 'function applyAction', 'Flow action dispatcher');
mustContain('src/features/assistant/flow-assistant.js', 'function renderActionCards', 'Flow action-card renderer');
mustContain('src/features/assistant/flow-assistant.js', 'function injectViewFlowRows', 'Flow per-view Ask-Flow row injector');
mustContain('src/features/assistant/flow-assistant.js', "'flow-context/1'", 'Flow context schema marker');
mustContain('src/features/assistant/flow-assistant.js', 'flow-actions', 'Flow action fence token');
mustContain('src/features/assistant/flow-assistant.js', 'window.flowAssistant', 'Flow Assistant exposed on window (legacy alias)');
mustContain('src/features/assistant/flow-assistant.js', 'window.sutraAssistant', 'Sutra Assistant exposed on window (canonical)');

mustContain('src/core/app.js', 'window.flowAtelier', 'Flow Assistant bridge exposed from app.js');
mustContain('src/core/app.js', 'buildRequestEnrichment', 'sendChat calls Flow request enrichment');
mustContain('src/core/app.js', "contextDepth: normalizeSettingChoice", 'assistant.contextDepth normalized in settings');
mustContain('src/core/app.js', "contextDepth: 'currentView'", 'assistant.contextDepth default registered');

mustContain('src/features/study/review.js', 'window.createReviewDeck', 'review.js exposes createReviewDeck for Flow actions');
mustContain('src/features/study/review.js', 'window.bulkImportReviewCards', 'review.js exposes bulkImportReviewCards for Flow actions');

mustContain('src/core/app.js', "'flow-ask'", 'Flow command palette entry: Ask Flow');
mustContain('src/core/app.js', "'flow-plan-day'", 'Flow command palette entry: Plan my day');
mustContain('src/core/app.js', "'flow-cards-from-note'", 'Flow command palette entry: Create review cards from note');
mustContain('src/core/app.js', "'flow-schedule-tasks'", 'Flow command palette entry: Schedule tasks');
mustContain('src/core/app.js', "'flow-import-assignments'", 'Flow command palette entry: Import assignments from pasted text');

// Confirm secret-key exclusion: chat provider API keys live in sessionStorage and
// must NOT be included in the .atelier raw-localStorage allowlist.
mustContainAny('src/core/app.js', ['Intentionally NOT exported', 'sessionStorage entries'],
    '.atelier export comment documents why chat API keys are excluded');

// ----------------------------------------------------------------------
// Flow Assistant upgrade — intelligence layer, workflows, activity log +
// undo, assignment import, proactive insights, context transparency, trust
// levels, student preferences, and an optional local/offline AI endpoint.
// ----------------------------------------------------------------------

// New intelligence module is loaded and exposes its surface.
mustContain('src/config/feature-manifest.js', 'src/features/assistant/flow-intelligence.js', 'Flow Intelligence script included in optional pack');
mustContain('src/features/assistant/flow-intelligence.js', 'window.flowIntelligence', 'Flow Intelligence exposed on window');
mustContain('src/features/assistant/flow-intelligence.js', 'function deriveStudentContext', 'student intelligence layer present');
mustContain('src/features/assistant/flow-intelligence.js', 'function pickNextBestAction', 'next-best-action picker present');
mustContain('src/features/assistant/flow-intelligence.js', 'function logActivity', 'Flow activity log writer present');
mustContain('src/features/assistant/flow-intelligence.js', 'function getActivityLog', 'Flow activity log reader present');
mustContain('src/features/assistant/flow-intelligence.js', 'function normalizeImportBatch', 'assignment import normalizer present');
mustContain('src/features/assistant/flow-intelligence.js', 'function detectDuplicate', 'assignment dedupe present');
mustContain('src/features/assistant/flow-intelligence.js', "ACTIVITY_LOG_KEY = 'sutra:activityLog:v1'", 'canonical Sutra activity log storage key present');
mustContain('src/features/assistant/flow-intelligence.js', "LEGACY_ACTIVITY_LOG_KEY = 'flow:activityLog:v1'", 'legacy Flow activity log key retained for migration');
mustContain('src/features/assistant/flow-intelligence.js', 'window.sutraIntelligence', 'Sutra Intelligence exposed on window');

// New action catalog entries (workflows) + risk classification.
mustContain('src/features/assistant/flow-assistant.js', 'function classifyRisk', 'action risk classifier present');
mustContain('src/features/assistant/action-system.js', 'stateFingerprint: stateFingerprint', 'assistant plan state fingerprinting present');
mustContain('src/features/assistant/action-system.js', 'code: \'stale_preview\'', 'assistant plan stale-preview refusal present');
mustContain('src/features/assistant/flow-assistant.js', 'function inspectWorkspacePlan', 'assistant dependency-plan inspector present');
mustContain('src/features/assistant/flow-assistant.js', 'inspectPlan(actions)', 'assistant plan inspector exposed through typed harness');
mustContain('src/features/assistant/flow-assistant.js', "type: 'import_assignments'", 'import_assignments action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'create_study_plan'", 'create_study_plan action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'create_exam_plan'", 'create_exam_plan action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'create_assignment_plan'", 'create_assignment_plan action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'plan_week'", 'plan_week action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'plan_day'", 'plan_day action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'triage_deadlines'", 'triage_deadlines action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'convert_note_to_study_system'", 'convert_note action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'link_workspace_objects'", 'link_workspace_objects action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'start_focus_session'", 'start_focus_session action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'change_context_depth'", 'change_context_depth action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'canvas_create_board'", 'Canvas board creation action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'canvas_edit_board'", 'Canvas atomic editing action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'slides_create_deck'", 'Slides deck creation action registered');
mustContain('src/features/assistant/flow-assistant.js', "type: 'slides_edit_deck'", 'Slides atomic editing action registered');
mustContain('src/features/workspace/surface-assistant-actions.js', 'function applyCanvas', 'pure Canvas Assistant operation engine present');
mustContain('src/features/workspace/surface-assistant-actions.js', 'function applySlides', 'pure Slides Assistant operation engine present');
mustContain('src/features/workspace/slides.js', 'function slidesUndo()', 'Slides session undo bridge present');
mustContain('src/features/workspace/slides.js', 'function beginElementDrag', 'Slides direct object manipulation present');
mustContain('src/features/workspace/slides.js', 'function syncElementInspector', 'Slides selection inspector present');
mustContain('src/features/workspace/canvas-workbench.js', 'function fitViewport', 'Canvas fit-to-content engine present');
mustContain('src/features/workspace/canvas-workbench.js', 'function pasteSelection', 'Canvas structured clipboard engine present');
mustContain('src/core/app.js', 'function canvasArrangeSelection', 'Canvas arrangement bridge present');
mustContain('src/core/app.js', 'function canvasFitView', 'Canvas viewport fitting bridge present');
mustContain('src/core/app.js', 'function canvasApplyAssistantOperations', 'Canvas canonical Assistant bridge present');
mustContain('src/features/workspace/slides.js', 'function applyAssistantOperations', 'Slides canonical Assistant bridge present');

// Object linking helper.
mustContain('src/features/assistant/flow-assistant.js', 'function addPageLinks', 'object linking helper present');
mustContain('src/features/assistant/flow-assistant.js', 'linkedReviewDeckId', 'workflow links page to review deck');

// Activity logging + undo on apply.
mustContain('src/features/assistant/flow-assistant.js', 'function applyActionLogged', 'logged apply wrapper present');
mustContain('src/features/assistant/flow-assistant.js', 'function undoActivity', 'undo helper present');
mustContain('src/features/assistant/flow-assistant.js', 'function getConfirmationMode', 'trust-level confirmation mode present');
mustContain('src/features/assistant/flow-assistant.js', 'flow-action-risk', 'risk badge rendered on action cards');

// Assignment import review table + context transparency + activity UI.
mustContain('src/features/assistant/flow-assistant.js', 'function renderImportReview', 'assignment import review table present');
mustContain('src/features/assistant/flow-assistant.js', 'function showContextModal', 'context transparency modal present');
mustContain('src/features/assistant/flow-assistant.js', 'function openActivityLog', 'activity log UI present');
mustContain('src/features/assistant/flow-assistant.js', 'function buildInspectableContext', 'inspectable context builder present');

// Data-aware quick actions + command layer.
mustContain('src/features/assistant/flow-assistant.js', 'function buildContextualQuickActions', 'data-aware quick actions present');
mustContain('src/features/assistant/flow-assistant.js', 'function tryHandleCommand', 'natural-language command layer present');

// File attachment plumbing (registry-driven; images + PDFs + local extraction).
mustContain('src/features/assistant/flow-assistant.js', 'function getVisionCapability', 'provider vision capability detection present');
mustContain('src/features/assistant/flow-assistant.js', 'function addAttachmentFromFile', 'attachment intake present');
mustContain('src/features/assistant/flow-assistant.js', 'function validateAttachmentsForSend', 'attachment send gate present');
mustContain('src/features/assistant/model-capabilities.js', 'determineAttachmentProcessingPlan', 'model-capability registry present');
mustContain('src/core/app.js', 'validateAttachmentsForSend', 'sendChat enforces the attachment compatibility gate');
mustContain('src/core/app.js', 'performIntelligenceRequest', 'centralized intelligence request core present');
mustContain('src/core/app.js', "type: 'image_url'", 'OpenAI-compatible image payload present');
mustContain('src/core/app.js', "type: 'image'", 'Anthropic image payload present');
mustContain('src/core/app.js', "type: 'document'", 'Anthropic PDF document payload present');
mustContain('src/core/app.js', 'inline_data', 'Gemini image/PDF payload present');

// app.js wiring: bridge, command interception, local endpoint.
mustContain('src/core/app.js', 'window.flowAssistant.handleOutgoing', 'sendChat routes commands through Flow');
mustContain('src/core/app.js', 'openQuickCaptureModal: (text)', 'bridge exposes Quick Capture');
mustContain('src/core/app.js', 'scheduleGenericItemAsBlock: (item)', 'bridge exposes Schedule-this');
mustContain('src/core/app.js', 'createWeeklyReviewNote: ()', 'bridge exposes Weekly Review');
mustContain('src/core/app.js', 'startFocusSession: (taskId, opts)', 'bridge exposes Focus session');
mustContain('src/core/app.js', "label: 'Local endpoint'", 'local AI endpoint provider registered');
mustContain('src/core/app.js', 'isLocalProvider', 'sendChat handles local endpoint provider');
mustContain('src/core/app.js', "'flow:activityLog:v1'", 'legacy activity log key in export allowlist');
mustContain('src/core/app.js', "'sutra:activityLog:v1'", 'canonical Sutra activity log key in export allowlist');

// Preferences: new assistant keys + student preferences section survive normalize.
mustContain('src/core/app.js', "confirmationMode: 'always'", 'assistant confirmation mode default');
mustContain('src/core/app.js', 'includeSelectionByDefault: true', 'assistant include-selection default');
mustContain('src/core/app.js', 'studentPreferences: {', 'student preferences default section');
mustContain('src/core/app.js', 'studyBlockMinutes: 45', 'student preferences study block default');
mustContain('src/core/app.js', 'localEndpoint: {', 'local endpoint config default');
mustContain('src/core/app.js', 'studentPrefSource', 'student preferences normalized');
mustContain('src/core/app.js', 'assistantLocalEndpointSource', 'local endpoint config normalized');

// HTML controls for the new settings + provider option.
mustContain('Sutra.html', 'data-pref-path="assistant.confirmationMode"', 'confirmation mode setting in HTML');
mustContain('Sutra.html', 'data-pref-path="assistant.includeSelectionByDefault"', 'include-selection setting in HTML');
mustContain('Sutra.html', 'data-pref-path="studentPreferences.studyBlockMinutes"', 'student preferences control in HTML');
mustContain('Sutra.html', 'data-pref-path="assistant.localEndpoint.baseUrl"', 'local endpoint base URL setting in HTML');
mustContain('Sutra.html', 'id="openFlowActivityLogBtn"', 'activity log button in Settings');
mustContain('Sutra.html', 'id="localApiKeyInput"', 'local endpoint key input in HTML');
mustContain('Sutra.html', '<option value="local">Local endpoint</option>', 'local provider option in Flow panel');

// New Flow CSS surfaces.
mustContain('styles/base/styles.css', '.flow-import-review', 'import review table stylesheet');
mustContain('styles/base/styles.css', '.flow-modal-overlay', 'Flow modal stylesheet');
mustContain('styles/base/styles.css', '.flow-action-risk', 'risk badge stylesheet');

// Undo wiring: review-deck removal must go through an exposed helper, and the
// Homework view must be refreshed via the event homework.js actually listens
// for (there is no global renderHomeworkWorkspace). Both were live-verified.
mustContain('src/features/study/review.js', 'window.deleteReviewDeck', 'review.js exposes deleteReviewDeck for Flow undo');
mustContain('src/features/assistant/flow-assistant.js', "new CustomEvent('homework:updated')", 'Flow refreshes Homework view via homework:updated event');
mustContain('src/features/study/homework.js', "'homework:updated'", 'homework.js listens for homework:updated');
mustContain('Sutra.html', 'src/features/study/review.js?v=', 'review.js cache-busted so undo fix ships');

// Syntax check already covers all .js files via check:syntax.

// ---- Course Hub & All Due ----
mustContain('src/core/app.js', 'function getDefaultCourseWorkspace', 'course workspace default factory');
mustContain('src/core/app.js', 'function normalizeCourseWorkspace', 'course workspace normalizer');
mustContain('src/core/app.js', 'function migrateAndBridgeCourses', 'homework->course migration/bridge');
mustContain('src/core/app.js', 'function getAllDueItems', 'All Due aggregation');
mustContain('src/core/app.js', 'function groupDueItemsByRange', 'All Due range grouping');
mustContain('src/core/app.js', 'function renderCourseHubView', 'Course Hub renderer');
mustContain('src/core/app.js', 'function renderAllDueView', 'All Due renderer');
mustContain('src/core/app.js', 'function createCourse', 'createCourse service');
mustContain('src/core/app.js', 'function createAssignmentForCourse', 'createAssignmentForCourse service');
mustContain('src/core/app.js', 'noteflow_attachments_db', 'isolated IndexedDB attachment store');
mustContain('src/core/app.js', 'courseWorkspace: payload.courseWorkspace', 'course workspace in jsonPayload');
mustContain('src/core/app.js', 'appData.courseWorkspace = normalizeCourseWorkspace', 'course workspace persisted in appData');
mustContain('src/core/app.js', 'buildCourseWorkspaceExportSnapshot', 'export snapshot embeds course file blobs');
mustContain('src/core/app.js', 'restoreCourseFileBlobsFromImport', 'import restores course file blobs');
mustContain('src/core/app.js', 'window.courseHub', 'course service surface exposed for Flow');
mustContain('src/core/app.js', "if (resolvedView === 'courses')", 'setActiveView renders Course Hub');
mustContain('src/core/app.js', "if (resolvedView === 'alldue')", 'setActiveView renders All Due');

// HTML mounts + nav tabs.
mustContain('Sutra.html', 'data-view="courses"', 'Courses tab button');
mustContain('Sutra.html', 'data-view="alldue"', 'All Due tab button');
mustContain('Sutra.html', 'id="courseHubMount"', 'Course Hub mount point');
mustContain('Sutra.html', 'id="allDueMount"', 'All Due mount point');
mustContain('Sutra.html', 'id="view-courses"', 'Course Hub view section');
mustContain('Sutra.html', 'id="view-alldue"', 'All Due view section');
mustContain('Sutra.html', 'src/core/app.js?v=', 'app.js cache-busted so the Sutra Sync bridge ships');

// ---- Sutra Sync (incremental encrypted multi-device sync) ----------------
mustContain('Sutra.html', 'src/sync/sync-engine.js?v=', 'sync engine module loads before app.js');
mustContain('Sutra.html', 'src/sync/sync-protocol.js?v=', 'sync protocol module loads before app.js');
mustContain('src/core/app.js', 'function notifySutraSyncLocalSave', 'confirmed-save hook feeds the sync engine');
mustContain('src/core/app.js', "notifySutraSyncLocalSave(reason, summary); } catch (syncError)", 'sync hook wrapped so it can never block local saving');
mustContain('src/core/app.js', 'function applySyncMergedWorkspace', 'merged remote state applies through the standard import path');
mustContain('src/core/app.js', "importWorkspacePayload(mergedWorkspaceJson, { silent: true, sync: true })", 'sync applies use silent sync-mode import (no interactive restore, with durable mirror hydration)');
mustContain('src/core/app.js', "getWorkspacePreference('sync.enabled', false)", 'sync is gated on the sync.enabled preference (default OFF)');
mustContain('Sutra.html', '<option value="atelier" selected>Sutra Workspace (.sutra)</option>', 'note-export modal defaults to .sutra');

// ---- Document backgrounds (per-page image + blur + dim) ------------------
mustContain('src/core/app.js', 'function normalizeDocumentBackground', 'document-background normalizer present');
mustContain('src/core/app.js', 'function applyDocumentBackgroundForEditor', 'document-background render-layer engine present');
mustContain('src/core/app.js', 'documentBackground: normalizeDocumentBackground(page.documentBackground)', 'documentBackground normalized in page model');
mustContain('src/core/app.js', 'sutraIsPageLockedNow', 'locked pages gate background rendering');
mustContain('src/core/app.js', 'window.openDocumentBackgroundModal', 'document-background modal exposed for the toolbar');
mustContain('src/core/app.js', "data-sutra-component', 'document-background-layer'", 'document-background layer hook created at runtime');
mustContain('Sutra.html', 'id="documentBackgroundModal"', 'Document Background modal markup present');
mustContain('Sutra.html', 'data-sutra-component="document-background-controls"', 'document-background controls hook present');
mustContain('Sutra.html', 'id="docBgBlur"', 'background blur slider present');
mustContain('Sutra.html', 'id="docBgDim"', 'dim background slider present');
mustContain('Sutra.html', 'openDocumentBackgroundModal()', 'Document Background toolbar button wired');

// CSS surfaces.
mustContain('styles/themes/sutra-pro.css', '.cw-course-card', 'course card stylesheet');
mustContain('styles/themes/sutra-pro.css', '.ad-row', 'All Due table row stylesheet');
mustContain('styles/themes/sutra-pro.css', '.cw-dropzone', 'file dropzone stylesheet');

// view registry.
mustContain('src/core/app.js', "'courses', 'alldue'", 'courses + alldue registered as feature views');

// Opt-in settings gate (default OFF — old UI is the default).
mustContain('src/core/app.js', 'function isCourseHubEnabled', 'course hub enablement gate');
mustContain('src/core/app.js', "view === 'courses' || view === 'alldue') return isCourseHubEnabled", 'isViewEnabled gates courses/alldue on the toggle');
mustContain('src/core/app.js', 'courseHubEnabled: false', 'course hub preference defaults OFF');
mustContain('src/core/app.js', 'courseHubEnabled: layoutSource.courseHubEnabled === true', 'course hub preference normalized');
mustContain('Sutra.html', 'data-pref-path="layout.courseHubEnabled"', 'Course Hub settings toggle in Layout');

// Flow Assistant integration.
mustContain('src/features/assistant/flow-assistant.js', 'create_assignment_for_course', 'Flow course-assignment action');
mustContain('src/features/assistant/flow-assistant.js', 'create_course', 'Flow create-course action');
mustContain('src/features/assistant/flow-assistant.js', 'function summarizeCourses', 'Flow course context');
mustContain('src/features/assistant/flow-assistant.js', 'function summarizeAllDue', 'Flow all-due context');
mustContain('src/features/assistant/flow-assistant.js', 'navigate_to_all_due', 'Flow navigate-to-all-due action');

// ----------------------------------------------------------------------
// Version History (Section 17) — repaired snapshot lifecycle, restore
// safety, split-pane parity, persisted throttle, and UI.
// ----------------------------------------------------------------------

// Canonical snapshot schema + pure, DOM-free transforms (module scope).
mustContain('src/core/app.js', 'PAGE_VERSION_STATE_FIELDS', 'canonical version snapshot field list');
mustContain('src/core/app.js', 'PAGE_VERSION_HISTORY_LIMIT', 'bounded version history limit constant');
mustContain('src/core/app.js', 'function buildPageVersionSnapshot', 'canonical version-snapshot builder');
mustContain('src/core/app.js', 'function buildPageVersionStateFromPage', 'page-state capture helper');
mustContain('src/core/app.js', 'function normalizePageVersionSnapshot', 'snapshot normalizer (legacy + rich)');
mustContain('src/core/app.js', 'function normalizePageVersionList', 'version list normalizer/bounder');
mustContain('src/core/app.js', 'function arePageVersionStatesEquivalent', 'snapshot equivalence/dedupe helper');
mustContain('src/core/app.js', 'function deepCloneVersionValue', 'snapshot deep-clone helper');
mustContain('src/core/app.js', 'function restorePageFromVersionSnapshot', 'snapshot restore helper');

// Lifecycle + safety helpers.
mustContain('src/core/app.js', 'function createVersionSnapshot', 'snapshot creation helper');
mustContain('src/core/app.js', 'function autoCreateVersionSnapshot', 'auto-snapshot/throttle helper');
mustContain('src/core/app.js', 'function flushPendingNoteSaves', 'pending-save flush safety helper');
mustContain('src/core/app.js', 'function saveVersionSnapshotManually', 'manual Save version action');
mustContain('src/core/app.js', 'function renderVersionHistoryBody', 'version history list renderer');
mustContain('src/core/app.js', 'cancelPendingPushes', 'undo manager cancel-pending-pushes (restore safety)');

// Persisted (not ephemeral) throttle: the in-memory map must be gone.
mustContain('src/core/app.js', 'VERSION_AUTOSNAPSHOT_INTERVAL_MS', 'persisted auto-snapshot throttle window');
mustNotContain('src/core/app.js', 'lastVersionSnapshotTime', 'ephemeral in-memory throttle map removed');

// Load/import normalization wiring (durable nested history).
mustContain('src/core/app.js', 'versions: normalizePageVersionList(page.versions)', 'normalizePagesCollection normalizes versions');

// Primary-editor checkpoint hook fires BEFORE the page is overwritten.
mustContain('src/core/app.js', 'capture a recoverable PRE-EDIT checkpoint BEFORE', 'primary save snapshots pre-edit state');
// Secondary-editor (split-pane) checkpoint hook uses the same policy.
mustContain('src/core/app.js', 'split-pane edits use the SAME checkpoint policy', 'secondary save snapshots like primary');

// Restore is forced, reversible, and atomic.
mustContain('src/core/app.js', "createVersionSnapshot(page, 'Before restore', { force: true })", 'restore writes a forced Before-restore checkpoint');
mustContain('src/core/app.js', 'restorePageFromVersionSnapshot(page, snapshot)', 'restore applies snapshot atomically');

// Restore targets use a data attribute + delegated handler (no inline onclick),
// so an imported snapshot id can never break out of a JS string (XSS guard).
mustContain('src/core/app.js', 'data-version-id="${escapeHtml(v.id)}"', 'restore button carries snapshot id via escaped data attribute');
mustNotContain('src/core/app.js', "onclick=\"restoreVersion('", 'no inline onclick interpolates a snapshot id (XSS-safe)');

// Modal markup + accessibility.
mustContain('Sutra.html', 'id="versionHistoryModal"', 'version history modal in HTML');
mustContain('Sutra.html', 'id="versionHistoryBody"', 'version history body in HTML');
mustContain('Sutra.html', 'id="versionHistorySubtitle"', 'version history note-title subtitle in HTML');
mustContain('Sutra.html', 'aria-labelledby="versionHistoryTitle"', 'version history dialog is labelled');

// Visible toolbar entry point (discoverable without the shortcut).
mustContain('Sutra.html', 'onclick="openVersionHistory()"', 'visible Version History toolbar button');
// Keyboard shortcut Ctrl/Cmd+Shift+H preserved.
mustContain('src/core/app.js', "e.shiftKey && e.key === 'H'", 'Ctrl/Cmd+Shift+H opens version history');

// Polished CSS surfaces.
mustContain('styles/themes/sutra-pro.css', '.version-history-toolbar', 'version history toolbar stylesheet');
mustContain('styles/themes/sutra-pro.css', '.version-history-empty', 'version history empty-state stylesheet');
mustContain('styles/themes/sutra-pro.css', '.version-current-chip', 'current-version marker stylesheet');
mustContain('styles/themes/sutra-pro.css', '.version-restore-btn', 'restore button stylesheet');

// =====================================================================
// HANDWRITING & DRAWING (Phase B)
// =====================================================================
mustContain('src/features/workspace/handwriting.js', 'global.AtelierHandwriting', 'handwriting engine exposes window.AtelierHandwriting');
mustContain('src/features/workspace/handwriting.js', 'function createController', 'handwriting drawing controller');
mustContain('src/features/workspace/handwriting.js', 'function renderStrokesToCanvas', 'handwriting renderer');
mustContain('src/features/workspace/handwriting.js', 'function strokeAt', 'eraser stroke hit-testing');
mustContainAny('src/features/workspace/handwriting.js', ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'], 'handwriting uses Pointer Events');
mustContain('src/features/workspace/handwriting.js', 'getCoalescedEvents', 'handwriting uses coalesced pointer events for smooth ink');
mustContain('src/features/workspace/handwriting.js', 'normalizeStrokes', 'handwriting vector stroke normalization');
mustContain('Sutra.html', 'src/features/workspace/handwriting.js', 'handwriting.js script included before app.js');
mustContain('Sutra.html', 'insertDrawingBlock()', 'Draw button in editor toolbar');
mustContain('src/core/app.js', "DRAWING: 'drawing'", 'DRAWING note block type registered');
mustContain('src/core/app.js', 'function createDrawingBlock', 'drawing block factory');
mustContain('src/core/app.js', 'function createDrawingAnchorElement', 'drawing block serializes to an anchor');
mustContain('src/core/app.js', 'function hydrateDrawingBlocksInContainer', 'drawing blocks hydrate on load');
mustContain('src/core/app.js', 'function syncDrawingBlocksFromEditor', 'drawing blocks reconcile from editor DOM');
mustContain('src/core/app.js', 'function disposeDrawingControllersForEditor', 'drawing controllers disposed on note switch (no leaks)');
mustContain('src/core/app.js', 'function insertHandwritingBlockIntoEditor', 'insert handwriting block (internal)');
mustContain('src/core/app.js', 'window.insertDrawingBlock', 'insert handwriting block exposed for toolbar onclick');
mustContain('src/core/app.js', 'function normalizeDrawingStrokeList', 'drawing strokes normalized on load (backward-compatible)');
mustContainAny('src/core/app.js', ['data-draw-tool="pen"', "data-draw-tool='pen'"], 'pen tool control');
mustContain('src/core/app.js', 'data-draw-tool="highlighter"', 'highlighter tool control');
mustContain('src/core/app.js', 'data-draw-tool="eraser"', 'eraser tool control');
mustContain('src/core/app.js', 'data-draw-action="undo"', 'drawing undo control');
mustContain('src/core/app.js', 'data-draw-action="redo"', 'drawing redo control');
mustContain('src/core/app.js', 'data-draw-action="clear"', 'drawing clear control');
mustContain('src/core/app.js', 'Clear this drawing?', 'clear-canvas confirmation path');
mustContain('src/core/app.js', 'schedulePersist', 'drawing strokes persisted debounced (not per pointermove)');
mustContain('src/core/app.js', 'onCommit: () => { schedulePersist(); refreshControls(); }', 'strokes persisted on each stroke commit');
mustContain('src/core/app.js', 'function flushAllDrawingControllers', 'last-stroke flush on pagehide/beforeunload');
mustContain('src/core/app.js', 'function safeCssColorValue', 'drawing swatch colors validated (CSS-injection safe)');
mustContain('src/features/workspace/handwriting.js', "raw.tool === TOOLS.ERASER", 'eraser strokes are not persisted (dropped on import)');
mustContain('src/features/workspace/handwriting.js', 'function refreshTheme', 'ink re-detects surface on theme change');
mustContain('src/core/app.js', 'function refreshAllDrawingControllersTheme', 'theme change refreshes drawing ink');
mustContain('src/core/app.js', 'function bindThemeChangeReapply', 'custom CSS + ink re-apply on theme change (MutationObserver)');
mustContain('styles/features/customization.css', '.drawing-block', 'handwriting block stylesheet');
mustContain('Sutra.html', 'styles/features/customization.css', 'customization stylesheet linked');

// =====================================================================
// MODS & CUSTOMIZATION — CSS overrides + Safe Mode (Phase C)
// =====================================================================
mustContain('src/features/customization/customization.js', 'global.AtelierCustomization', 'customization engine exposed');
mustContain('src/features/customization/customization.js', 'function applyCss', 'CSS injection function');
mustContain('src/features/customization/customization.js', 'function removeAllCss', 'CSS removal function');
mustContain('src/features/customization/customization.js', 'function validateCss', 'CSS bracket-balance validation');
mustContain('src/features/customization/customization.js', 'function previewCss', 'CSS live preview');
mustContain('src/features/customization/customization.js', "ROOT_STYLE_ID = 'atelier-user-css'", 'deterministic user CSS style id');
mustContain('src/features/customization/customization.js', 'function isSafeMode', 'Safe Mode detection');
mustContain('src/features/customization/customization.js', '(?:sutra|atelier)SafeMode=1', 'URL-based Safe Mode (Sutra canonical + legacy Atelier)');
mustContain('src/core/app.js', 'function normalizeCustomizationSettings', 'customization settings normalizer');
mustContain('src/core/app.js', 'function applyCustomizationCss', 'app applies custom CSS');
mustContain('src/core/app.js', 'function initModsAndCustomization', 'mods boot init');
mustContain('src/core/app.js', 'function showSafeModeBanner', 'Safe Mode recovery banner');
mustContain('src/core/app.js', 'customization: {', 'customization persisted in settings defaults');
mustContain('src/core/app.js', 'function renderModsSettings', 'mods settings renderer');
mustContainAny('src/core/app.js', ['css-add', 'css-save', 'css-delete'], 'CSS snippet add/save/delete actions');
mustContainAny('src/core/app.js', ['css-duplicate', 'css-up', 'css-down'], 'CSS snippet duplicate/reorder actions');
mustContainAny('src/core/app.js', ['css-import', 'css-export'], 'CSS snippet import/export actions');
mustContain('src/core/app.js', 'css-reset-all', 'CSS reset-all action');
mustContain('Sutra.html', 'data-settings-nav="mods"', 'Mods settings category nav');
mustContain('Sutra.html', 'data-settings-section="mods"', 'Mods settings section');
mustContain('Sutra.html', 'id="modsEnabledToggle"', 'mods master toggle');
mustContain('Sutra.html', 'Safe Mode', 'restrained mods warning references Safe Mode');
mustContain('Sutra.html', '__atelierShiftSafeMode', 'Shift-at-load Safe Mode capture');
mustContain('styles/features/customization.css', '.atelier-safe-mode-banner', 'Safe Mode banner stylesheet');
// Customization is now CSS-only (CSS Overrides + Safe Mode & Recovery); plugins moved
// to Settings ▸ Advanced ▸ Developer / Experimental.
mustContain('Sutra.html', 'data-mods-tab="css"', 'CSS Overrides tab present');
mustContain('Sutra.html', 'data-mods-tab="recovery"', 'Safe Mode & Recovery tab present');
mustNotContain('Sutra.html', 'data-mods-tab="plugins"', 'Plugins tab removed from normal Customization screen');
// Curated snippet gallery (safe one-click presets).
mustContain('src/features/customization/customization.js', 'function snippetGallery', 'curated CSS snippet gallery presets');
mustContain('src/features/customization/customization.js', "id: 'calm-focus'", 'gallery includes Calm Focus Mode preset');
mustContain('src/features/customization/customization.js', "id: 'high-contrast'", 'gallery includes High Contrast preset');
mustContain('src/core/app.js', 'function renderModsCssGallery', 'CSS panel renders the snippet gallery');
mustContain('src/core/app.js', 'css-gallery-add', 'gallery preset one-click add action');
mustContain('docs/features/CSS_MODS_GUIDE.md', 'snippet gallery', 'CSS guide documents the gallery');

// =====================================================================
// MODS & CUSTOMIZATION — Local plugins (Phase C)
// =====================================================================
mustContain('src/features/customization/plugin-system.js', 'global.AtelierPlugins', 'plugin engine exposed');
mustContain('src/features/customization/plugin-system.js', 'function validateManifest', 'plugin manifest validator');
mustContain('src/features/customization/plugin-system.js', 'function parseBundle', 'plugin bundle parser');
mustContain('src/features/customization/plugin-system.js', 'function createRuntimeHost', 'sandboxed plugin runtime host');
mustContain('src/features/customization/plugin-system.js', 'function markForReviewOnImport', 'imported runtime plugins require re-review');
mustContain('src/features/customization/plugin-system.js', 'var PERMISSIONS', 'plugin permission allowlist');
mustContain('src/features/customization/plugin-system.js', 'var BRIDGE_OPS', 'plugin bridge operation allowlist');
mustContain('src/features/customization/plugin-system.js', "setAttribute('sandbox', 'allow-scripts')", 'plugin iframe sandbox allow-scripts (no allow-same-origin)');
mustContain('src/features/customization/plugin-system.js', "connect-src 'none'", 'plugin sandbox blocks network');
mustNotContain('src/features/customization/plugin-system.js', 'new Function(', 'no new Function in plugin runtime');
mustNotContain('src/features/customization/plugin-system.js', 'eval(', 'no eval() call in plugin runtime');
mustContain('src/features/customization/plugin-system.js', 'event.source !== entry.iframe.contentWindow', 'plugin bridge validates event.source');
mustContain('src/features/customization/plugin-system.js', 'd.token !== entry.token', 'plugin bridge validates session token');
mustContain('src/features/customization/plugin-system.js', 'hasPermission', 'plugin bridge checks permissions');
mustContain('src/core/app.js', 'function setPluginEnabled', 'plugin enable/disable lifecycle');
mustContain('src/core/app.js', 'function uninstallPlugin', 'plugin uninstall lifecycle');
mustContain('src/core/app.js', 'function applyPluginContributions', 'declarative plugin contributions applied');
mustContain('src/core/app.js', 'function mountEnabledRuntimePlugins', 'runtime plugins mounted');
mustContain('src/core/app.js', 'function handlePluginBridgeOp', 'plugin bridge operations routed to real stores');
// All four declared bridge ops are implemented (no permission-without-handler gaps).
mustContain('src/core/app.js', "case 'note.writeCurrent'", 'note.writeCurrent bridge op implemented');
mustContain('src/core/app.js', "case 'timeline.create'", 'timeline.create bridge op implemented');
mustContain('src/core/app.js', "case 'timeline.list'", 'timeline.list bridge op implemented');
mustContain('src/core/app.js', "case 'command.register'", 'command.register bridge op implemented');
mustContain('src/core/app.js', 'function registerRuntimePluginCommand', 'runtime plugin command registry');
mustContain('src/core/app.js', 'function createPluginTimeBlock', 'plugin timeline blocks go through the real store');
mustContain('src/features/customization/plugin-system.js', 'onCommand:function', 'sandbox exposes onCommand for runtime command round-trip');
mustContain('src/features/customization/plugin-system.js', 'function invoke', 'runtime host can invoke a sandbox command');
mustContain('src/core/app.js', "options.includeSensitiveSettings === true", 'export secret-filtering is fail-safe by default');
mustContain('src/core/app.js', 'markForReviewOnImport', 'import marks runtime plugins for review');
mustContain('src/core/app.js', 'plugin-import', 'plugin import action');
mustContain('src/core/app.js', 'plugin-review', 'plugin re-review action');
mustContain('src/core/app.js', 'window.__atelierPluginCommands', 'plugin commands bridged to command palette');
mustContain('examples/plugins/study-helper.atelier-plugin', '"id": "example.study-helper"', 'example plugin bundle present');
mustContain('examples/plugins/study-helper.atelier-plugin', '"schemaVersion": 1', 'example plugin uses documented schema');
mustContain('docs/features/MODS_AND_CUSTOMIZATION.md', 'Safe Mode', 'mods docs cover Safe Mode');
mustContain('docs/features/PLUGIN_SDK.md', 'atelier-plugin', 'plugin SDK docs present');
// Plugins de-emphasized: experimental developer surface under Advanced, hidden by default.
mustContain('src/features/customization/customization.js', 'pluginsExperimentalEnabled', 'experimental-plugins opt-in flag in engine');
mustContain('src/core/app.js', 'function renderPluginsExperimental', 'plugins render only under Advanced/Experimental');
mustContain('src/core/app.js', 'pluginsExperimentalEnabled', 'plugins gated behind experimental flag');
mustContain('Sutra.html', 'id="pluginsExperimentalToggle"', 'Local Plugins (Experimental) opt-in toggle in Advanced');
mustContain('Sutra.html', 'Local Plugins (Experimental)', 'plugins labeled experimental in Advanced');
mustContain('Sutra.html', 'id="modsPluginImportInput" hidden', 'plugin import picker relocated with no restrictive accept filter');
mustContain('docs/features/PLUGIN_SDK.md', 'experimental', 'plugin SDK marked developer/experimental');
mustContain('docs/features/HANDWRITING_AND_DRAWING.md', 'highlighter', 'handwriting docs present');

// =====================================================================
// LANDING PAGE — scrollytelling redesign (Phase D)
// =====================================================================
mustContain('HomePage.html', 'id="ambient-canvas"', 'ambient canvas preserved (not removed)');
mustContain('HomePage.html', 'Sutra.html', 'app entry links preserved');
mustContain('HomePage.html', 'prefers-reduced-motion', 'reduced-motion styles present');
mustContainAny('HomePage.html', ['#story', '#workspace', '#privacy', '#start'], 'narrative nav anchors present');
mustContain('HomePage.html', "href=\"#privacy\"", 'Privacy nav anchor present');
mustContain('HomePage.html', 'id="privacy"', 'local-first / privacy section present');
mustContain('HomePage.html', 'id="persistentCta"', 'persistent desktop CTA present');
mustContain('HomePage.html', "addEventListener('visibilitychange'", 'ambient canvas pauses when tab hidden');
mustContain('HomePage.html', 'scroll-margin-top', 'anchored sections clear the fixed nav');
mustNotContain('HomePage.html', 'NoteFlow Classic', 'NoteFlow Classic legacy public link removed for the public beta');
mustNotContain('HomePage.html', 'cdnjs.cloudflare.com/ajax/libs/gsap', 'no GSAP scroll library added');
// Full scrollytelling narrative: problem -> solution reveal -> guided tour -> grid.
mustContain('HomePage.html', 'class="problem-section"', 'fragmentation PROBLEM section present');
mustContain('HomePage.html', 'class="reveal-section"', 'unified-workspace REVEAL section present');
mustContain('HomePage.html', 'id="workspace"', 'guided-tour (#workspace) section present');
mustContain('HomePage.html', 'data-tour-step="6"', 'guided tour has 7 data-tour-step markers (Today…Cram)');
mustContain('HomePage.html', 'data-tour-frame="0"', 'guided tour has a sticky screenshot stage with frames');
mustContain('HomePage.html', 'reveal-chip', 'progressive annotation chips in the solution reveal');
mustContain('HomePage.html', 'class="tour-cram-visual', 'Cram CSS visual rendered (no screenshot available)');
mustContain('HomePage.html', 'tour-step-media', 'mobile inline tour media (sticky stage hidden on phones)');
mustContain('HomePage.html', 'is-tour-ready', 'tour dimming only engages once JS drives it (JS-off safe)');
mustContain('HomePage.html', 'getBoundingClientRect', 'scroll-linked progress is viewport-relative (scroller-agnostic)');
mustContain('HomePage.html', "capture: true", 'scroll listeners use capture phase (work with body-as-scroller)');
mustContain('HomePage.html', 'IntersectionObserver', 'tour steps activate via IntersectionObserver');
mustContain('HomePage.html', 'hero-eyebrow', 'hero eyebrow (PRIVATE · LOCAL-FIRST · STUDENT-BUILT)');
mustContain('HomePage.html', 'Explore Sutra', 'hero secondary CTA (rebranded)');
mustContain('HomePage.html', '<title>Sutra | Student OS for School, Projects, and Life</title>', 'landing title rebranded to Sutra');
mustContain('HomePage.html', '<span class="brand-text">Sutra</span>', 'landing wordmark rebranded to Sutra');
mustContain('HomePage.html', 'Start your workspace', 'rebranded primary CTA');
mustContain('HomePage.html', 'A step change in academic productivity.', 'Sutra hero tagline present');
mustContain('HomePage.html', 'privacy-transfer', 'local-first workspace -> .atelier transfer visual');
mustContain('HomePage.html', 'founder-note-card', 'founder note preserved');
// Reduced-motion must collapse the tall pinned sections (no dead scroll space).
mustContain('HomePage.html', '.problem-section, .reveal-section { min-height: 0; }', 'reduced-motion collapses pinned sections');

// ---- Sutra thread scrollytelling (evolves the problem section) -----------
mustContain('HomePage.html', 'data-sutra-component="thread-story"', 'thread-story hook on the problem section');
mustContain('HomePage.html', 'data-sutra-component="thread-stage"', 'thread-stage hook on the fragment cluster');
mustContain('HomePage.html', 'data-sutra-component="thread-path"', 'continuous thread-path hook present');
mustContain('HomePage.html', 'sutraThreadGradient', 'thread gradient stroke defined');
mustContain('HomePage.html', 'data-sutra-thread-node="notes"', 'thread node: notes');
mustContain('HomePage.html', 'data-sutra-thread-node="assignments"', 'thread node: assignments');
mustContain('HomePage.html', 'data-sutra-thread-node="timeline"', 'thread node: timeline');
mustContain('HomePage.html', 'data-sutra-thread-node="radar"', 'thread node: radar');
mustContain('HomePage.html', 'data-sutra-thread-node="review"', 'thread node: review');
mustContain('HomePage.html', 'data-sutra-thread-node="focus"', 'thread node: focus');
mustContain('HomePage.html', 'getTotalLength', 'thread drawn via stroke-dashoffset on scroll progress');
mustContain('HomePage.html', '.problem-cluster::before', 'mobile vertical-thread fallback present');
mustNotContain('HomePage.html', 'gsap', 'no GSAP anywhere');
mustNotContain('HomePage.html', 'locomotive', 'no Locomotive Scroll');
mustNotContain('HomePage.html', 'lenis', 'no Lenis smooth-scroll engine');

// ---- Daily lock-in quote system ------------------------------------------
mustContain('Sutra.html', 'daily-lock-in-quote', 'daily lock-in quote container present in sidebar');
mustContain('Sutra.html', 'daily-lock-in-quotes.js', 'quote data file loaded');
mustContain('Sutra.html', 'daily-lock-in-quote.js', 'quote feature file loaded');
mustContain('src/data/daily-lock-in-quotes.js', 'SutraQuoteBank', 'SutraQuoteBank exported from data file');
mustContain('src/features/workspace/daily-lock-in-quote.js', 'getLocalDayNumber', 'deterministic day-number function present');
mustContain('src/features/workspace/daily-lock-in-quote.js', 'seededShuffle', 'seeded shuffle function present');
mustContain('src/features/workspace/daily-lock-in-quote.js', 'global.SutraQuote', 'SutraQuote public API exported');

// ---- Notification center -------------------------------------------------
mustContain('Sutra.html', 'notifBellBtn', 'notification bell button present');
mustContain('Sutra.html', 'notifPanel', 'notification panel present');
mustContain('Sutra.html', 'notifToastContainer', 'toast container present');
mustContain('Sutra.html', 'notifications.css', 'notifications CSS loaded');
mustContain('Sutra.html', 'notifications.js', 'notifications JS loaded');
mustContain('src/features/workspace/notifications.js', 'SutraNotifications', 'SutraNotifications namespace exported');
mustContain('src/features/workspace/notifications.js', 'collectWorkspaceDeadlines', 'notification center uses deadline aggregator');
mustContain('src/features/workspace/notifications.js', 'sutraNotifications:v1', 'notification state storage key');
mustContain('src/core/app.js', 'sutraNotifications:v1', 'notification key in localStorage snapshot allowlist');

// ---- Settings theme fix --------------------------------------------------
mustContain('styles/views/settings-redesign.css', 'body[data-theme="sutra"]', 'Sutra dark theme in settings CC override block');

// ---- Shortcut label migration --------------------------------------------
mustContain('src/core/app.js', 'NoteFlowAtelier GitHub repo', 'legacy shortcut label migration present');
mustContain('src/core/app.js', 'Sutra GitHub repo', 'migration target label present');

// ---- Stabilization pass: migrations, app shell, academic command center --
mustContain('Sutra.html', 'src/core/migrations.js', 'workspace migration registry loaded before app');
mustContain('src/core/app.js', 'SutraMigrations.migrateWorkspace', 'workspace hydrate path runs versioned migrations');
mustContain('Sutra.html', 'styles/views/focus-session.css', 'focus-session CSS extracted from the app shell');
mustNotContain('Sutra.html', 'id="focus-session-styles"', 'large focus-session style block removed from app shell');
mustContain('Sutra.html', 'src/features/academic/academic-command-center.js', 'academic command center module loaded');
mustContain('Sutra.html', 'styles/features/academic-command-center.css', 'academic command center styles loaded');
mustContain('src/core/app.js', 'SutraAcademicCommandCenter.renderHtml', 'Course Hub composes the academic command center');
mustContain('src/features/academic/academic-command-center.js', 'function rankActions', 'deterministic next-action ranking present');
mustContain('src/core/safe-storage.js', 'sessionGet: sessionGet', 'safe storage exposes session reads');

// ---- Runtime startup health layer ---------------------------------------
mustContain('Sutra.html', 'src/core/startup-health.js', 'startup health layer loaded in app shell');
mustContain('src/core/startup-health.js', 'window.SutraStartupHealth', 'startup health exposes its namespace');
mustContain('src/core/startup-health.js', "severity: 'critical'", 'startup health distinguishes critical failures');
mustContain('src/core/startup-health.js', 'sutraSafeMode', 'startup health recovery offers Safe Mode');

// ---- Sutra Cloud S3 brand-icon regression --------------------------------
// `fa-aws` is a Font Awesome BRAND glyph; rendered with the solid `fas` prefix
// it never displays. The card renderer keys off a `fa-brands` prefix. Checked
// independently of neighbouring fields (e.g. `availability`) so honest metadata
// additions to the S3 adapter don't trip this guard.
mustContain('src/core/app.js', "id: 's3', displayName: 'S3-compatible (AWS / R2 / B2 / Wasabi / MinIO)'", 'S3 cloud provider present');
mustContain('src/core/app.js', "id: 's3', displayName: 'S3-compatible (AWS / R2 / B2 / Wasabi / MinIO)', category: 'advanced', availability: 'preview', icon: 'fa-brands fa-aws'", 'S3 cloud provider declares a brand-prefixed icon');

if (failures.length) {
    console.error('SMOKE CHECK FAILED:');
    failures.forEach(f => console.error(' - ' + f));
    process.exit(1);
}

console.log('Smoke check passed (all assertions).');
