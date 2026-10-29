#!/usr/bin/env node
// Behavioral verification for the Notes Version History system (Section 17).
//
// Atelier is a local-first static web app whose logic lives inside a DOM-heavy
// src/core/app.js. This script does NOT load a DOM. Instead it surgically
// extracts the pure, module-scope version-history helpers (and the two
// closure-scope lifecycle functions) and executes them with minimal stubs —
// the same technique used by scripts/round-trip-check.mjs (extractFunctionBody)
// and scripts/course-logic-probe.mjs (new Function injection).
//
// It proves the repaired semantics:
//   - legacy snapshots normalize without inventing/clobbering fields
//   - rich snapshots capture the selected editable fields (and never security)
//   - snapshot values are deep-cloned (no shared references with the page)
//   - duplicate snapshots are suppressed; forced snapshots are retained
//   - history is bounded to the cap; oldest entries evicted predictably
//   - restore recovers selected state and leaves lock/identity untouched
//   - the auto-snapshot throttle reads PERSISTED timestamps (reload-stable)
//   - nested history survives JSON serialize/deserialize (export/import)
//   - primary + secondary saves both checkpoint BEFORE overwriting content
//
// Run with: node scripts/version-history-check.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appJs = readFileSync(resolve(repoRoot, 'src/core/app.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) { pass += 1; } else { fail += 1; console.error('FAIL:', msg); } };

// ---- Brace-matching function-body extractor (mirrors round-trip-check.mjs) ----
function extractFunctionBody(source, signaturePattern) {
    const match = source.match(signaturePattern);
    if (!match) return null;
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
            if (depth === 0) return source.slice(startIndex, j + 1);
        }
    }
    return null;
}

// ---- Pull the version-history logic out of app.js -----------------------
const MODEL_START = '// ===== VERSION HISTORY SNAPSHOT MODEL (Section 17) =====';
const MODEL_END = '// ===== END VERSION HISTORY SNAPSHOT MODEL =====';
const startIdx = appJs.indexOf(MODEL_START);
const endIdx = appJs.indexOf(MODEL_END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error('FATAL: could not locate the version-history snapshot model markers in app.js');
    process.exit(1);
}
const modelBlock = appJs.slice(startIdx, endIdx);

const createBody = extractFunctionBody(appJs, /function\s+createVersionSnapshot\s*\(/);
const autoBody = extractFunctionBody(appJs, /function\s+autoCreateVersionSnapshot\s*\(/);
if (!createBody || !autoBody) {
    console.error('FATAL: could not extract createVersionSnapshot / autoCreateVersionSnapshot bodies');
    process.exit(1);
}

// Deterministic id stub so assertions are stable; the helpers prefer it via
// `typeof generateId === 'function'`.
let idN = 0;
const generateId = () => 'id_' + (idN++).toString(36);

const factory = new Function(
    'generateId',
    modelBlock +
    '\nfunction createVersionSnapshot(page, label, options) ' + createBody +
    '\nfunction autoCreateVersionSnapshot(page) ' + autoBody +
    '\nreturn {' +
    '  PAGE_VERSION_STATE_FIELDS, PAGE_VERSION_HISTORY_LIMIT, VERSION_AUTOSNAPSHOT_INTERVAL_MS,' +
    '  deepCloneVersionValue, pageVersionStateSignature, arePageVersionStatesEquivalent,' +
    '  buildPageVersionStateFromPage, normalizePageVersionSnapshot, normalizePageVersionList,' +
    '  buildPageVersionSnapshot, restorePageFromVersionSnapshot,' +
    '  createVersionSnapshot, autoCreateVersionSnapshot' +
    '};'
);
const api = factory(generateId);

// ---- Test fixtures ------------------------------------------------------
let pageN = 0;
function makeRichPage() {
    return {
        id: 'page-' + (pageN++),
        title: 'Parent::Child',
        content: '<p>Body</p><div class="html-embed-anchor" data-block-id="b1"></div>',
        icon: '📘',
        tags: [{ name: 'math', color: '#f00' }, { name: 'exam', color: '#0f0' }],
        pageMode: { enabled: true, size: 'a4', margins: { top: 10, bottom: 10, left: 10, right: 10 } },
        formatting: { fontFamily: 'Inter', fontSize: '16', lineHeight: '1.5', textColor: '#111', alignment: 'left' },
        documentLayout: {
            header: { enabled: true, content: 'H' },
            footer: { enabled: false, content: '' },
            pageNumbers: { enabled: true, position: 'footer', startFrom: 1 }
        },
        comments: [{ id: 'c1', text: 'note' }],
        suggestions: [{ id: 's1', type: 'insert' }],
        footnotes: [{ id: 'f1', number: 1, content: 'fn' }],
        citations: [{ id: 'cite1', number: 1, title: 'Book' }],
        blocks: [{ id: 'b1', type: 'htmlEmbed', html: '<b>embed</b>', widthPct: 100, heightPx: 360 }],
        // Fields that must NOT be captured/restored:
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-02T00:00:00.000Z',
        spaceId: 'default',
        collapsed: false,
        isLocked: false,
        lockHash: null,
        versions: []
    };
}

const ISO_A = '2021-01-01T00:00:00.000Z';
const ISO_B = '2021-06-01T00:00:00.000Z';

// ---- 1) Legacy snapshots normalize safely -------------------------------
{
    const legacy = { id: 'v-legacy', content: '<p>old</p>', title: 'Old Title', savedAt: '2020-01-01T00:00:00.000Z', label: 'Auto-saved' };
    const n = api.normalizePageVersionSnapshot(legacy);
    ok(n && n.id === 'v-legacy', 'legacy: id preserved');
    ok(n.state.title === 'Old Title' && n.state.content === '<p>old</p>', 'legacy: title+content lifted into state');
    ok(!('blocks' in n.state) && !('tags' in n.state) && !('comments' in n.state),
        'legacy: fields the snapshot never captured are NOT invented (prevents clobber on restore)');
    ok(n.label === 'Auto-saved' && n.savedAt === '2020-01-01T00:00:00.000Z', 'legacy: label + savedAt preserved');
    ok(api.normalizePageVersionSnapshot(null) === null, 'legacy: null entry rejected gracefully');
}

// ---- 2) Rich snapshots preserve selected editable fields ----------------
{
    const p = makeRichPage();
    const snap = api.buildPageVersionSnapshot(p, 'Manual', { id: 'v1', savedAt: ISO_A });
    ok(snap.state.title === p.title, 'rich: title captured');
    ok(snap.state.content === p.content, 'rich: content captured');
    ok(JSON.stringify(snap.state.blocks) === JSON.stringify(p.blocks), 'rich: blocks captured (atomic with content)');
    ok(JSON.stringify(snap.state.tags) === JSON.stringify(p.tags), 'rich: tags captured');
    ok(snap.state.icon === p.icon, 'rich: icon captured');
    ok(JSON.stringify(snap.state.footnotes) === JSON.stringify(p.footnotes), 'rich: footnotes captured');
    ok(JSON.stringify(snap.state.citations) === JSON.stringify(p.citations), 'rich: citations captured');
    ok(JSON.stringify(snap.state.comments) === JSON.stringify(p.comments), 'rich: comments captured');
    ok(JSON.stringify(snap.state.formatting) === JSON.stringify(p.formatting), 'rich: formatting captured');
    ok(JSON.stringify(snap.state.documentLayout) === JSON.stringify(p.documentLayout), 'rich: documentLayout captured');
    ok(JSON.stringify(snap.state.pageMode) === JSON.stringify(p.pageMode), 'rich: pageMode captured');
    // Security + identity must never enter a snapshot.
    ok(!('isLocked' in snap.state) && !('lockHash' in snap.state) && !('lockSalt' in snap.state) && !('lockDuressVerifier' in snap.state),
        'rich: lock/security fields are NEVER captured');
    ok(!('id' in snap.state) && !('spaceId' in snap.state) && !('createdAt' in snap.state) && !('versions' in snap.state),
        'rich: identity/placement/timestamps/history are NEVER captured');
}

// ---- 3) Snapshot values are deep-cloned ---------------------------------
{
    const p = makeRichPage();
    const snap = api.buildPageVersionSnapshot(p, 'x', { id: 's', savedAt: ISO_A });
    const originalTagCount = snap.state.tags.length;
    p.blocks[0].html = 'MUTATED';
    p.tags.push({ name: 'late', color: '#000' });
    p.comments[0].text = 'edited';
    ok(snap.state.blocks[0].html === '<b>embed</b>', 'deep clone: mutating page.blocks does not change the snapshot');
    ok(snap.state.tags.length === originalTagCount, 'deep clone: mutating page.tags does not change the snapshot');
    ok(snap.state.comments[0].text === 'note', 'deep clone: mutating page.comments does not change the snapshot');

    const target = makeRichPage();
    api.restorePageFromVersionSnapshot(target, snap);
    target.blocks[0].html = 'AFTER_RESTORE_EDIT';
    ok(snap.state.blocks[0].html === '<b>embed</b>', 'deep clone: editing a restored page does not mutate stored history');
}

// ---- 4) Duplicate suppression + forced retention ------------------------
{
    const p = { id: 'dp', title: 'T', content: 'C', blocks: [], tags: [] };
    const first = api.createVersionSnapshot(p, 'first');
    ok(first && p.versions.length === 1, 'dedupe: first snapshot stored');
    const dup = api.createVersionSnapshot(p, 'dup');
    ok(dup === null && p.versions.length === 1, 'dedupe: an identical snapshot is suppressed');
    const forced = api.createVersionSnapshot(p, 'Before restore', { force: true });
    ok(forced && p.versions.length === 2, 'force: a forced snapshot is retained even when identical');
    p.content = 'C2';
    const changed = api.createVersionSnapshot(p, 'after-change');
    ok(changed && p.versions.length === 3, 'dedupe: a changed state produces a new snapshot');
}

// ---- 5) History cap is enforced predictably -----------------------------
{
    const p = { id: 'cp', title: 'T', content: 'c0', blocks: [], tags: [] };
    for (let i = 0; i < 30; i += 1) {
        p.content = 'c' + i;
        api.createVersionSnapshot(p, 'n' + i, { force: true });
    }
    ok(p.versions.length === api.PAGE_VERSION_HISTORY_LIMIT, 'cap: history bounded to PAGE_VERSION_HISTORY_LIMIT');
    ok(p.versions[p.versions.length - 1].label === 'n29', 'cap: newest entry retained');
    ok(!p.versions.some(v => v.label === 'n0'), 'cap: oldest entries evicted predictably (FIFO)');
}

// ---- 6) Restore recovers selected state; lock/identity untouched --------
{
    const p = makeRichPage();
    p.isLocked = true; p.lockHash = 'HASH'; p.lockSalt = 'SALT'; p.lockAutoLock = 'session'; p.lockDuressVerifier = 'DURESS';
    const snap = api.buildPageVersionSnapshot(p, 'snap', { id: 'r', savedAt: ISO_A });
    const originalTitle = p.title;
    const originalContent = p.content;
    p.title = 'Parent::Renamed'; p.content = 'totally new'; p.tags = [{ name: 'new', color: '#abc' }]; p.icon = '🧪';
    api.restorePageFromVersionSnapshot(p, snap);
    ok(p.title === originalTitle && p.content === originalContent, 'restore: title + content recovered');
    ok(p.tags.length === 2 && p.tags[0].name === 'math', 'restore: tags recovered');
    ok(p.icon === '📘', 'restore: icon recovered');
    ok(p.isLocked === true && p.lockHash === 'HASH' && p.lockSalt === 'SALT' && p.lockAutoLock === 'session' && p.lockDuressVerifier === 'DURESS',
        'restore: lock/security metadata is never weakened or overwritten');
    ok(typeof p.updatedAt === 'string', 'restore: updatedAt refreshed');

    // Legacy snapshot restore must not wipe fields it never captured.
    const lp = { id: 'lp', title: 'T', content: 'C', blocks: [{ id: 'b1', type: 'htmlEmbed', html: '<b>x</b>' }], tags: [{ name: 'keep', color: '#1' }] };
    const legacySnap = { id: 'ls', content: 'OLD BODY', title: 'OLD TITLE', savedAt: ISO_A, label: 'old' };
    api.restorePageFromVersionSnapshot(lp, legacySnap);
    ok(lp.content === 'OLD BODY' && lp.title === 'OLD TITLE', 'legacy restore: title + content applied');
    ok(Array.isArray(lp.blocks) && lp.blocks.length === 1 && lp.blocks[0].html === '<b>x</b>', 'legacy restore: blocks NOT wiped');
    ok(Array.isArray(lp.tags) && lp.tags.length === 1, 'legacy restore: tags NOT wiped');

    // Hierarchy preservation: a page moved/renamed since the snapshot keeps its
    // CURRENT parent path; only the leaf title segment is restored (matches how
    // savePage/loadPage treat the '::'-delimited title everywhere else).
    const hp = makeRichPage();
    hp.title = 'Parent::OldLeaf';
    const hsnap = api.buildPageVersionSnapshot(hp, 'h', { id: 'h', savedAt: ISO_A });
    hp.title = 'NewParent::Sub::CurrentLeaf';   // moved deeper under a different parent
    api.restorePageFromVersionSnapshot(hp, hsnap);
    ok(hp.title === 'NewParent::Sub::OldLeaf', 'restore: keeps current tree location, restores only the leaf title');

    const top = { id: 'top', title: 'Solo', content: 'c', blocks: [], tags: [] };
    const topSnap = { id: 'ts', state: { title: 'RenamedSolo', content: 'c2' }, savedAt: ISO_A, label: 'x' };
    api.restorePageFromVersionSnapshot(top, topSnap);
    ok(top.title === 'RenamedSolo', 'restore: top-level (no parent) page restores leaf cleanly');
}

// ---- 7) Auto-snapshot throttle reads PERSISTED timestamps ---------------
{
    const p = { id: 'tp', title: 'T', content: 'c', blocks: [], tags: [] };
    const first = api.autoCreateVersionSnapshot(p);
    ok(first && p.versions.length === 1, 'throttle: first auto-snapshot creates a baseline');
    p.content = 'changed-but-recent';
    const second = api.autoCreateVersionSnapshot(p);
    ok(second === null && p.versions.length === 1, 'throttle: a second auto-snapshot inside the window is suppressed');
    // Back-date the persisted snapshot to simulate the window elapsing (and a
    // page reload, which would have reset any in-memory throttle map).
    p.versions[p.versions.length - 1].savedAt = '2000-01-01T00:00:00.000Z';
    const third = api.autoCreateVersionSnapshot(p);
    ok(third && p.versions.length === 2, 'throttle: a new auto-snapshot is allowed once the persisted window elapses');
}

// ---- 8) Nested history survives serialization/deserialization -----------
{
    const a = api.buildPageVersionSnapshot(makeRichPage(), 'a', { id: 'snap-a', savedAt: ISO_A });
    const b = api.buildPageVersionSnapshot(makeRichPage(), 'b', { id: 'snap-b', savedAt: ISO_B });
    const pages = [{ id: 'p1', title: 'T', content: 'C', versions: [a, b] }];
    const round = JSON.parse(JSON.stringify(pages));
    const restored = api.normalizePageVersionList(round[0].versions);
    ok(restored.length === 2, 'round-trip: nested history survives JSON serialize/deserialize');
    ok(restored[0].id === 'snap-a' && restored[1].id === 'snap-b', 'round-trip: snapshot identity intact');
    ok(restored[1].state.title === 'Parent::Child' && Array.isArray(restored[1].state.blocks), 'round-trip: snapshot state intact');

    // Malformed / legacy entries are normalized or dropped, never fatal.
    const messy = [null, 'bad', 42, { id: 'good', state: { title: 't', content: 'c' } }, {}];
    const cleaned = api.normalizePageVersionList(messy);
    ok(cleaned.length === 2, 'normalize: non-object entries dropped, valid ones kept');
    ok(cleaned.every(s => s && s.state && typeof s.state.title === 'string'), 'normalize: every surviving entry has a well-formed state');
}

// ---- 9) Save paths checkpoint BEFORE overwriting (structural) -----------
{
    const savePageBody = extractFunctionBody(appJs, /function\s+savePage\s*\(/);
    ok(!!savePageBody, 'structural: savePage located');
    if (savePageBody) {
        const snapIdx = savePageBody.indexOf('autoCreateVersionSnapshot');
        const persistIdx = savePageBody.indexOf('persistEditorSnapshotToPage');
        ok(snapIdx !== -1 && persistIdx !== -1 && snapIdx < persistIdx,
            'structural: savePage snapshots the pre-edit state BEFORE persistEditorSnapshotToPage overwrites it');
    }
    const secBody = extractFunctionBody(appJs, /function\s+saveSecondaryPageNow\s*\(/);
    ok(!!secBody, 'structural: saveSecondaryPageNow located');
    if (secBody) {
        const snapIdx = secBody.indexOf('autoCreateVersionSnapshot');
        const persistIdx = secBody.indexOf('persistEditorSnapshotToPage');
        ok(snapIdx !== -1, 'structural: saveSecondaryPageNow creates a checkpoint (split-pane parity)');
        ok(snapIdx !== -1 && persistIdx !== -1 && snapIdx < persistIdx,
            'structural: saveSecondaryPageNow snapshots BEFORE overwriting content');
    }
    const restoreBody = extractFunctionBody(appJs, /async\s+function\s+restoreVersion\s*\(/);
    ok(!!restoreBody, 'structural: restoreVersion located');
    if (restoreBody) {
        ok(restoreBody.indexOf('flushPendingNoteSaves') !== -1, 'structural: restore flushes pending saves first');
        const flushIdx = restoreBody.indexOf('flushPendingNoteSaves');
        const beforeIdx = restoreBody.indexOf("'Before restore'");
        const applyIdx = restoreBody.indexOf('restorePageFromVersionSnapshot');
        ok(flushIdx !== -1 && beforeIdx !== -1 && applyIdx !== -1 && flushIdx < beforeIdx && beforeIdx < applyIdx,
            'structural: restore order is flush -> Before-restore checkpoint -> apply snapshot');
    }
}

// ---- Report -------------------------------------------------------------
console.log('Version History behavioral check');
console.log('--------------------------------');
console.log(`captured fields: ${api.PAGE_VERSION_STATE_FIELDS.join(', ')}`);
console.log(`history limit:   ${api.PAGE_VERSION_HISTORY_LIMIT}`);
console.log(`throttle window: ${api.VERSION_AUTOSNAPSHOT_INTERVAL_MS} ms`);
console.log('');

if (fail) {
    console.error(`FAILED — ${pass} passed, ${fail} failed.`);
    process.exit(1);
}
console.log(`OK — all ${pass} version-history assertions passed.`);
