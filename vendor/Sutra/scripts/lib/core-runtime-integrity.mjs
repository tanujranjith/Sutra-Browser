import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

// Budget ratchet (audit remediation): the previous minimum-size floor
// (>=4.5MB / >=80k lines) actively punished the sanctioned decomposition of
// app.js — a successful extraction failed CI. Accidental truncation is already
// caught by the parser, required-fragment, and ordering assertions below, so
// floors are replaced by a BLESSED MAXIMUM: growth beyond the recorded budget
// fails until a human re-blesses (`npm run core:budget`), and every
// decomposition can lower the budget as a visible, committable act.
export const CORE_RUNTIME_BUDGET_PATH = 'scripts/core-runtime-budget.json';

const REQUIRED_FRAGMENTS = [
  ['workspace serializer', 'function serializeWorkspace('],
  ['workspace deserializer', 'function deserializeWorkspace('],
  ['canonical local save', 'async function saveWorkspaceLocally('],
  ['canonical local load', 'async function loadWorkspaceLocally('],
  ['encrypted workspace export', 'async function exportWorkspaceAsAtelierPackage('],
  ['workspace import seam', 'function importWorkspacePayload('],
  ['round-trip verifier', 'window.verifyWorkspaceRoundTrip'],
  ['persistence public save API', 'window.saveWorkspaceLocally = saveWorkspaceLocally'],
  ['export failures survive unrelated saves', 'if (SUTRA_EXPORT_FAILURE_PHASES.has(failurePhase)) return false;'],
  ['successful exports resolve export failures', 'clearResolvedExportFailure();'],
  ['Drive mutation revision guard', 'const localMutationRevision = Math.max('],
  ['Drive restore action', 'async function restoreSutraDriveSnapshotAction('],
  ['Drive conflict chooser', 'enterSutraDriveConflict('],
  ['Sync engine creation', 'window.SutraSyncEngine.create('],
  ['Sync projection', 'window.SutraSyncProjection.buildProjection('],
  ['Sync public bridge', 'window.SutraSync = {'],
  ['cloud sign-out pauses Sync', "if (window.SutraSync && typeof window.SutraSync.pause === 'function') window.SutraSync.pause();"],
  ['public beta test hooks', 'window.__sutraPublicBetaTestHooks = {'],
  ['sidebar renderer', 'function renderPagesList()'],
  ['Help page render priority', '...topLevelPages.filter(isHelpDocsPage)'],
  ['Help page ordered render', 'orderedTopLevelPages.forEach(page => renderTree(page.id, 0, null))'],
  ['application DOM boot', "document.addEventListener('DOMContentLoaded', async () => {"]
];

const REQUIRED_ORDER = [
  'function renderPagesList()',
  'const localMutationRevision = Math.max(',
  'async function restoreSutraDriveSnapshotAction(',
  'async function exportWorkspaceAsAtelierPackage(',
  'function serializeWorkspace(',
  'async function saveWorkspaceLocally(',
  'window.__sutraPublicBetaTestHooks = {',
  'window.SutraSync = {'
];

// Required runtime contracts must be executable source, not prose that happens
// to contain the expected spelling. Keep strings intact (several contracts
// intentionally include literal values), but blank comments before checking
// fragments and ordering. The VM parser above remains the authority for lexical
// validity; this scanner only prevents comment-padding from spoofing a contract.
function withoutComments(source) {
  let output = '';
  let state = 'code';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') {
        output += char;
        state = 'code';
      } else output += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else output += char === '\n' || char === '\r' ? char : ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else {
      output += char;
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
    }
  }
  return output;
}

function readBudget(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const budgetPath = resolve(repoRoot, options.budgetPath || CORE_RUNTIME_BUDGET_PATH);
  let raw;
  try {
    raw = readFileSync(budgetPath, 'utf8');
  } catch (error) {
    return { ok: false, budgetPath, error };
  }
  try {
    const parsed = JSON.parse(raw);
    const maxBytes = Number(parsed.maxBytes);
    const maxLines = Number(parsed.maxLines);
    const reviewedReason = String(parsed.reviewedReason || '').trim();
    if (!Number.isFinite(maxBytes) || !Number.isFinite(maxLines) || maxBytes <= 0 || maxLines <= 0) {
      return { ok: false, budgetPath, error: new Error('budget file must contain positive numeric maxBytes and maxLines') };
    }
    if (!reviewedReason) {
      return { ok: false, budgetPath, error: new Error('budget file must contain a non-empty reviewedReason') };
    }
    return { ok: true, budgetPath, maxBytes, maxLines, reviewedReason };
  } catch (error) {
    return { ok: false, budgetPath, error };
  }
}

export function checkCoreRuntime(options = {}) {
  const appPath = resolve(options.appPath || 'src/core/app.js');
  let source;
  try {
    source = readFileSync(appPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      appPath,
      bytes: 0,
      lines: 0,
      failures: [`cannot read ${appPath}: ${error.message}`],
      passes: []
    };
  }

  return checkCoreRuntimeSource(source, {
    ...options,
    appPath,
    bytes: statSync(appPath).size,
    readLabel: `read ${appPath}`
  });
}

export function checkCoreRuntimeSource(source, options = {}) {
  const appPath = options.appPath || '<in-memory core runtime>';
  const failures = [];
  const passes = [];
  const text = String(source || '');
  const contractSource = withoutComments(text);
  const bytes = Number.isFinite(options.bytes) ? options.bytes : Buffer.byteLength(text, 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (options.readLabel) passes.push(options.readLabel);

  try {
    // Sutra's core is a classic browser script. vm.Script invokes Node's
    // JavaScript parser without executing the source or requiring a child
    // process, so this also works in restricted CI and coding sandboxes.
    new Script(text, { filename: appPath });
    passes.push('JavaScript parser accepted the core runtime');
  } catch (error) {
    failures.push(`JavaScript parser rejected the core runtime:\n${error.stack || error.message}`);
  }

  const budget = options.budget || readBudget(options);
  if (budget && budget.ok) {
    if (bytes <= budget.maxBytes) {
      passes.push(`runtime within blessed size budget (${bytes} / ${budget.maxBytes} bytes)`);
    } else {
      failures.push(
        `runtime grew past the blessed budget (${bytes} bytes > ${budget.maxBytes}). ` +
        'If this growth is intentional, re-bless with: npm run core:budget -- --reason="concise engineering rationale" --allow-growth'
      );
    }
    if (lines <= budget.maxLines) {
      passes.push(`runtime within blessed line budget (${lines} / ${budget.maxLines} lines)`);
    } else {
      failures.push(
        `runtime grew past the blessed line count (${lines} lines > ${budget.maxLines}). ` +
        'If this growth is intentional, re-bless with: npm run core:budget -- --reason="concise engineering rationale" --allow-growth'
      );
    }
  } else if (budget && !budget.ok) {
    failures.push(`core runtime budget unavailable (${budget.budgetPath}): ${budget.error.message}. Create it with: npm run core:budget -- --reason="initial reviewed ceiling"`);
  }

  for (const [label, fragment] of REQUIRED_FRAGMENTS) {
    if (contractSource.includes(fragment)) passes.push(label);
    else failures.push(`${label} is missing: ${fragment}`);
  }

  let previousIndex = -1;
  for (const fragment of REQUIRED_ORDER) {
    const index = contractSource.indexOf(fragment);
    if (index === -1) continue;
    if (index <= previousIndex) {
      failures.push(`critical runtime section is out of order: ${fragment}`);
      break;
    }
    previousIndex = index;
  }
  if (!failures.some((item) => item.includes('out of order'))) {
    passes.push('critical runtime sections retain their expected order');
  }

  return { ok: failures.length === 0, appPath, bytes, lines, failures, passes };
}

export function blessCoreRuntimeBudget(options = {}) {
  const appPath = resolve(options.appPath || 'src/core/app.js');
  const bytes = statSync(appPath).size;
  const lines = readFileSync(appPath, 'utf8').split(/\r?\n/).length;
  const reason = String(options.reason || '').trim();
  if (!reason) throw new Error('budget review requires --reason="concise engineering rationale"');
  const current = readBudget(options);
  const grows = current.ok && (bytes > current.maxBytes || lines > current.maxLines);
  if (grows && options.allowGrowth !== true) {
    throw new Error('runtime budget growth requires both --reason and --allow-growth');
  }
  return {
    schema: 1,
    note: 'Blessed maximum size of src/core/app.js. Growth requires an explicit reason and --allow-growth; decomposition should lower this file.',
    blessedAt: new Date().toISOString(),
    reviewedReason: reason,
    maxBytes: bytes,
    maxLines: lines
  };
}

export function assertCoreRuntimeIntegrity(options = {}) {
  const result = checkCoreRuntime(options);
  if (result.ok) return result;
  const error = new Error(`Core runtime integrity check failed:\n- ${result.failures.join('\n- ')}`);
  error.name = 'CoreRuntimeIntegrityError';
  error.result = result;
  throw error;
}

export const coreRuntimeContract = Object.freeze({
  requiredFragments: REQUIRED_FRAGMENTS.map(([label, fragment]) => ({ label, fragment })),
  requiredOrder: [...REQUIRED_ORDER]
});
