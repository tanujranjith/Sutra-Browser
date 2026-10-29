#!/usr/bin/env node
// Round-trip parity check for NoteFlow Atelier save/export/import.
//
// This script does NOT load the app (which depends on the DOM); instead it
// statically verifies that all save and export paths agree on which fields
// belong to a workspace. The previous-generation bugs we want to catch:
//
//   1. A new top-level workspace field added to local save (persistAppData)
//      but forgotten in buildWorkspaceExportPayload's JSON projection — local
//      storage drifts ahead of exports.
//   2. A field present in the export payload but never read back by
//      importWorkspacePayload — round-trip silently drops it.
//   3. The .atelier sensitive-redaction path being skipped on the JSON export
//      path — secrets leak into the shareable file.
//   4. The set of localStorage keys captured by the snapshot diverging from
//      what the live app reads.
//
// Run with: node scripts/round-trip-check.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJs = readFileSync(resolve(repoRoot, 'src/core/app.js'), 'utf8');
const persistenceInventory = JSON.parse(readFileSync(resolve(repoRoot, 'docs/architecture/persistence-inventory.json'), 'utf8'));
const require = createRequire(import.meta.url);
const syncProtocol = require(resolve(repoRoot, 'src/sync/sync-protocol.js'));

const failures = [];
const warnings = [];

function fail(msg) { failures.push(msg); }
function warn(msg) { warnings.push(msg); }

// ---- Helpers ----------------------------------------------------------

function extractFunctionBody(source, signaturePattern) {
    const match = source.match(signaturePattern);
    if (!match) return null;
    // Walk past the parameter list `(...)` first — default values like
    // `options = {}` would otherwise be mistaken for the function body.
    let i = match.index + match[0].length - 1;
    if (source[i] !== '(') {
        i = source.indexOf('(', i);
        if (i === -1) return null;
    }
    let parenDepth = 0;
    for (; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) { i += 1; break; }
        }
    }
    const startIndex = source.indexOf('{', i);
    if (startIndex === -1) return null;
    let depth = 0;
    for (let j = startIndex; j < source.length; j += 1) {
        const ch = source[j];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, j + 1);
            }
        }
    }
    return null;
}

// ---- 1) Pull the field names from each canonical site -----------------

const persistBody = extractFunctionBody(appJs, /function\s+persistAppData\s*\(/);
if (!persistBody) fail('Could not locate persistAppData function body');

const buildBody = extractFunctionBody(appJs, /function\s+buildWorkspaceExportPayload\s*\(/);
if (!buildBody) fail('Could not locate buildWorkspaceExportPayload function body');

// importWorkspacePayload is a thin guard wrapper (workspaceImportInProgress
// flag) around importWorkspacePayloadInner, which holds the actual field
// hydration this check audits.
const importBody = extractFunctionBody(appJs, /function\s+importWorkspacePayloadInner\s*\(/)
    || extractFunctionBody(appJs, /function\s+importWorkspacePayload\s*\(/);
if (!importBody) fail('Could not locate importWorkspacePayload function body');

// Fields written to appData inside persistAppData (left-hand side of `appData.foo = ...`)
const persistFields = persistBody
    ? Array.from(new Set(
        Array.from(persistBody.matchAll(/appData\.([a-zA-Z_$][\w$]*)\s*=/g)).map(m => m[1])
    )).filter(name => name !== 'ui' && name !== 'version')
    : [];

// Fields populated on the JSON-mode return of buildWorkspaceExportPayload
// (look for the `jsonPayload = { ... }` object literal section).
const jsonReturnMatch = buildBody && buildBody.match(/jsonPayload\s*=\s*\{([\s\S]*?)\};/);
const jsonReturnBlock = jsonReturnMatch ? jsonReturnMatch[1] : '';
const exportJsonFields = Array.from(new Set(
    Array.from(jsonReturnBlock.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm)).map(m => m[1])
));

// Fields read by importWorkspacePayload via `data.foo` accesses
const directImportReadFields = importBody
    ? Array.from(new Set(
        Array.from(importBody.matchAll(/data\.([a-zA-Z_$][\w$]*)/g)).map(m => m[1])
    ))
    : [];
// Some cohesive schema groups are intentionally restored through a reviewed
// key list so migration/default handling stays uniform. Treat those literal
// keys as importer reads as well as direct `data.foo` accesses.
const groupedImportMatch = importBody && importBody.match(/sutra2WorkspaceFields\s*=\s*\[([\s\S]*?)\]/);
const groupedImportFields = groupedImportMatch
    ? Array.from(new Set(
        Array.from(groupedImportMatch[1].matchAll(/'([a-zA-Z_$][\w$]*)'/g)).map(m => m[1])
    ))
    : [];
const helperImportFields = importBody
    ? Array.from(new Set(
        Array.from(importBody.matchAll(/importedField\('([a-zA-Z_$][\w$]*)'/g)).map(m => m[1])
    ))
    : [];
const importReadFields = Array.from(new Set([...directImportReadFields, ...groupedImportFields, ...helperImportFields]));

// ---- 2) Field parity assertions --------------------------------------

const expectedTopLevel = (persistenceInventory.workspaceTopLevelFields || [])
    .filter(field => !['version', 'exportedAt'].includes(field));

expectedTopLevel.forEach(field => {
    if (!exportJsonFields.includes(field)) {
        fail(`Export JSON payload is missing field: ${field}`);
    }
    if (!importReadFields.includes(field)) {
        fail(`importWorkspacePayload does not read field: ${field}`);
    }
});

// Any field local-saved but not exported = workspace drift on export.
persistFields.forEach(field => {
    if (field === 'homeworkWorkspace') return; // captured via separate localStorage path on import
    if (!exportJsonFields.includes(field)) {
        fail(`Local save writes appData.${field} but export omits it (drift risk).`);
    }
});

// Any field exported but not imported = silently dropped on round-trip.
exportJsonFields.forEach(field => {
    if (['version', 'exportedAt', 'exportDiagnostics'].includes(field)) return;
    if (!importReadFields.includes(field)) {
        fail(`Export emits "${field}" but importWorkspacePayload never reads it.`);
    }
});

// Every persistence field also needs an executable sync decision. This checks
// names and categories (not counts), then proves the protocol mechanics cover
// the same field exactly once.
const decisionCategories = new Set(Object.keys(persistenceInventory.classificationCategories || {}));
const fieldDecisions = persistenceInventory.workspaceFieldClassifications || {};
const classifiedFields = syncProtocol.listClassifiedFields();
const classifiedSeen = new Set();
classifiedFields.forEach(field => {
    if (classifiedSeen.has(field)) fail(`Sync classifies field more than once: ${field}`);
    classifiedSeen.add(field);
});
(persistenceInventory.workspaceTopLevelFields || []).forEach(field => {
    const decision = fieldDecisions[field];
    if (!decision) fail(`Persistence field has no sync decision: ${field}`);
    else if (!decisionCategories.has(decision.category)) fail(`Persistence field has invalid sync category: ${field} -> ${decision.category}`);
    if (!classifiedSeen.has(field)) fail(`Persistence field is absent from sync mechanics: ${field}`);
});
classifiedSeen.forEach(field => {
    if (!(persistenceInventory.workspaceTopLevelFields || []).includes(field)) {
        fail(`Sync mechanics contain a field absent from the persistence contract: ${field}`);
    }
});
Object.keys(fieldDecisions).forEach(field => {
    if (!(persistenceInventory.workspaceTopLevelFields || []).includes(field)) {
        fail(`Sync decision exists for a non-persistence field: ${field}`);
    }
});

// Canonical appData defaults must be inventoried; export-only/storage-backed
// synthetic fields are listed explicitly rather than hidden in exceptions.
const defaultsBodyForParity = extractFunctionBody(appJs, /function\s+getDefaultAppData\s*\(/);
const defaultTopLevel = defaultsBodyForParity
    ? Array.from(new Set(Array.from(defaultsBodyForParity.matchAll(/^ {16}([a-zA-Z_$][\w$]*)\s*:/gm)).map(m => m[1])))
    : [];
const syntheticFields = new Set(persistenceInventory.syntheticWorkspaceFields || []);
defaultTopLevel.forEach(field => {
    if (!(persistenceInventory.workspaceTopLevelFields || []).includes(field)) {
        fail(`getDefaultAppData field is absent from persistence inventory: ${field}`);
    }
});
(persistenceInventory.workspaceTopLevelFields || []).forEach(field => {
    if (!defaultTopLevel.includes(field) && !syntheticFields.has(field)) {
        fail(`Persistence field is neither a workspace default nor an explicit synthetic field: ${field}`);
    }
});

// ---- 3) Security checks ----------------------------------------------

// JSON export must request sensitive-stripping. Otherwise drive.apiKey leaks.
if (!/exportToFile\s*\([\s\S]*?buildWorkspaceExportPayload\s*\(\{[^}]*includeSensitiveSettings\s*:\s*false/.test(appJs)) {
    fail('exportToFile() must call buildWorkspaceExportPayload with includeSensitiveSettings:false (JSON export would otherwise leak credentials).');
}

// .atelier export must request sensitive-stripping (already true; assert).
if (!/exportWorkspaceAsAtelierPackage\s*\([\s\S]*?buildWorkspaceExportPayload\s*\(\{[\s\S]*?includeSensitiveSettings\s*:\s*false/.test(appJs)) {
    fail('exportWorkspaceAsAtelierPackage() must call buildWorkspaceExportPayload with includeSensitiveSettings:false.');
}

// Sensitive key set must include the well-known credential field names.
const requiredSensitive = ['apikey', 'accesstoken', 'refreshtoken', 'idtoken', 'token', 'clientsecret', 'secret', 'password'];
requiredSensitive.forEach(name => {
    if (!new RegExp(`'${name}'`).test(appJs)) {
        fail(`ATELIER_SENSITIVE_SETTING_KEYS is missing the "${name}" entry.`);
    }
});

// ---- 4) localStorage snapshot list sanity ----------------------------

const lsKeysMatch = appJs.match(/ATELIER_RAW_LOCALSTORAGE_KEYS\s*=\s*\[([\s\S]*?)\]/);
const lsKeys = lsKeysMatch
    ? Array.from(lsKeysMatch[1].matchAll(/'([^']+)'/g)).map(m => m[1])
    : [];

const requiredLsKeys = persistenceInventory.localStorageSnapshotKeys || [];
requiredLsKeys.forEach(key => {
    if (!lsKeys.includes(key)) {
        fail(`ATELIER_RAW_LOCALSTORAGE_KEYS is missing required key "${key}".`);
    }
});
const localStorageDecisions = persistenceInventory.localStorageClassifications || {};
requiredLsKeys.forEach(key => {
    const decision = localStorageDecisions[key];
    if (!decision) fail(`Portable localStorage key has no classification: ${key}`);
    else if (!decisionCategories.has(decision.category)) fail(`Portable localStorage key has invalid category: ${key}`);
});

// API-key-style storage keys must NEVER appear in the snapshot list.
const sensitiveLsKeys = [
    'groq_api_key', 'openai_api_key', 'anthropic_api_key', 'gemini_api_key',
    'openrouter_api_key', 'deepseek_api_key', 'xai_api_key', 'perplexity_api_key',
    'nvidia_api_key', 'mistral_api_key', 'together_api_key', 'local_api_key',
    'chat_history'
];
sensitiveLsKeys.forEach(key => {
    if (lsKeys.includes(key)) {
        fail(`Sensitive key "${key}" must not be in ATELIER_RAW_LOCALSTORAGE_KEYS — secrets belong in sessionStorage only.`);
    }
});
if (lsKeys.includes('sutra:googleDriveSync:v1')) {
    fail('Google Drive sync metadata must remain device-local and must not be included in ATELIER_RAW_LOCALSTORAGE_KEYS.');
}

// ---- 5) Canonical wrapper presence ----------------------------------

const requiredWrappers = [
    'serializeWorkspace',
    'deserializeWorkspace',
    'saveWorkspaceLocally',
    'loadWorkspaceLocally',
    'exportWorkspaceAsAtelier',
    'exportWorkspaceAsJson',
    'importWorkspaceFile',
    'verifyWorkspaceRoundTrip'
];
requiredWrappers.forEach(name => {
    if (!new RegExp(`function\\s+${name}\\s*\\(`).test(appJs)) {
        fail(`Canonical wrapper function ${name}() is missing.`);
    }
    if (!new RegExp(`window\\.${name}\\s*=`).test(appJs)) {
        fail(`Canonical wrapper ${name}() is not exposed on window for in-browser verification.`);
    }
});

// ---- 6) Settings field parity (sanity) -------------------------------

const defaultsBody = extractFunctionBody(appJs, /function\s+getDefaultAppData\s*\(/);
if (defaultsBody) {
    const defaultSettingsFields = Array.from(new Set(
        Array.from(defaultsBody.matchAll(/^\s{20}([a-zA-Z_$][\w$]*)\s*:/gm)).map(m => m[1])
    ));
    // The settings object must include these survival-critical fields:
    const requiredSettingsFields = [
        'theme', 'enabledViews', 'preferences', 'font', 'focusTimer',
        // Drive / Google Calendar settings are intentionally excluded here:
        // sync metadata and OAuth-adjacent state are device-local and stripped
        // from workspace merges/imports instead of being defaulted or exported.
        'temporaryPages', 'dataHealth',
        'customShortcuts', 'customThemes', 'themeApplyMode',
        'selectedPagesForTheme', 'tutorialSeen', 'tutorialCompleted',
        'featureSelectionCompleted',
        // Connected productivity upgrade settings:
        'mobileTodayMode', 'recentSearches'
    ];
    requiredSettingsFields.forEach(field => {
        if (!defaultSettingsFields.includes(field)) {
            warn(`getDefaultAppData().settings does not declare "${field}" — exports may carry it but new installs will lack a default.`);
        }
    });
}

if (importBody && !/loadThemeSettings\(\);\s*loadAtelierTheme\(\);/.test(importBody)) {
    fail('importWorkspacePayload() must reapply the Atelier shell theme after loading settings.');
}

// ---- 7) Connected-productivity helpers exist ---------------------------
const requiredHelpers = [
    'getDefaultReviewWorkspace',
    'normalizeReviewWorkspace',
    'getDefaultFocusTemplates',
    'normalizeFocusTemplates',
    'getDefaultSplitPaneContexts',
    'normalizeSplitPaneContexts',
    'normalizeRecentSearches'
];
requiredHelpers.forEach(name => {
    if (!new RegExp(`function\\s+${name}\\s*\\(`).test(appJs)) {
        fail(`Connected-productivity helper "${name}" is missing.`);
    }
});

// ---- 8) Course-attachment blobs must be warm before export -------------
// buildCourseWorkspaceExportSnapshot() reads attachment bytes ONLY from the
// in-memory courseAttachmentCache. Reading them from the separate
// noteflow_attachments_db IndexedDB is async, so the synchronous snapshot
// cannot fetch a cold blob. Every export entry point that serializes the
// course workspace must therefore await warmCourseAttachmentCache() BEFORE it
// calls buildWorkspaceExportPayload — otherwise a file added in a prior
// session (cache cold after reload) is exported with missingBlob=true and its
// bytes are silently lost. Guard against that regression here.
const snapshotBody = extractFunctionBody(appJs, /function\s+buildCourseWorkspaceExportSnapshot\s*\(/);
if (snapshotBody && !/courseAttachmentCache\.get\(/.test(snapshotBody)) {
    fail('buildCourseWorkspaceExportSnapshot() no longer reads from courseAttachmentCache — asset embedding assumptions changed.');
}
const exportPathsNeedingWarmCache = [
    'exportWorkspaceAsAtelierPackage',
    'exportToFile',
    'createPreImportSafetySnapshot'
];
exportPathsNeedingWarmCache.forEach(name => {
    const body = extractFunctionBody(appJs, new RegExp(`function\\s+${name}\\s*\\(`));
    if (!body) {
        fail(`Could not locate ${name}() to verify course-attachment cache warming.`);
        return;
    }
    const warmIdx = body.indexOf('warmCourseAttachmentCache');
    const buildIdx = body.indexOf('buildWorkspaceExportPayload');
    if (buildIdx === -1) return; // function does not build a payload directly
    if (warmIdx === -1) {
        fail(`${name}() builds an export payload but never warms the course-attachment cache (course file binaries can be silently dropped).`);
    } else if (warmIdx > buildIdx) {
        fail(`${name}() warms the course-attachment cache AFTER building the payload — warming must happen first.`);
    }
});

// ---- Report ----------------------------------------------------------

console.log('Atelier round-trip parity check');
console.log('--------------------------------');
console.log(`persistAppData fields:   ${persistFields.sort().join(', ') || '(none parsed)'}`);
console.log(`export JSON fields:      ${exportJsonFields.sort().join(', ') || '(none parsed)'}`);
console.log(`import-read fields:      ${importReadFields.sort().join(', ') || '(none parsed)'}`);
console.log(`localStorage snapshot:   ${lsKeys.join(', ') || '(none parsed)'}`);
console.log('');

if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach(w => console.log(' - ' + w));
    console.log('');
}

if (failures.length) {
    console.error('FAILED:');
    failures.forEach(f => console.error(' - ' + f));
    process.exit(1);
}

console.log(`OK — ${expectedTopLevel.length} workspace fields verified across save/export/import paths.`);
