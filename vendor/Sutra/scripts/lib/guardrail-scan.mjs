/*
 * guardrail-scan.mjs — pure, dependency-free scanners for the architecture
 * guardrails. Kept separate from the runnable check so the detection logic can
 * be unit-tested directly (scripts/sutra-guardrails.selftest.mjs) against
 * intentionally-unsafe fixtures without touching the real source tree.
 *
 * Everything here is line/regex based (no JS parser) to match the existing
 * check-suite style and to stay robust against the 63k-line app.js.
 */

// An inline escape hatch: a line carrying one of these markers is treated as a
// reviewed, intentional exception and is NOT counted against the ratchet.
// Use sparingly and always with a reason, e.g.
//   el.innerHTML = TRUSTED_TEMPLATE; // sutra-allow-html: static developer markup
export const ALLOW_MARKERS = {
  html: /sutra-allow-html\b/,
  storage: /sutra-allow-storage\b/,
  global: /sutra-allow-global\b/
};

// Unsafe DOM sink patterns. Assignment forms and the two HTML-string APIs.
const SINK_PATTERNS = [
  { key: 'innerHTML', re: /\.innerHTML\s*=/ },
  { key: 'outerHTML', re: /\.outerHTML\s*=/ },
  { key: 'insertAdjacentHTML', re: /\.insertAdjacentHTML\s*\(/ },
  { key: 'document.write', re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/ }
];

// Direct browser-storage write patterns that should route through
// SutraSafeStorage instead (canonical IndexedDB pipeline excepted via files).
const STORAGE_PATTERNS = [
  { key: 'localStorage.setItem', re: /\blocalStorage\s*\.\s*setItem\s*\(/ },
  { key: 'sessionStorage.setItem', re: /\bsessionStorage\s*\.\s*setItem\s*\(/ },
  { key: 'localStorage[]', re: /\blocalStorage\s*\[[^\]]+\]\s*=/ },
  { key: 'sessionStorage[]', re: /\bsessionStorage\s*\[[^\]]+\]\s*=/ }
];

function splitLines(text) {
  return String(text).split(/\r\n|\r|\n/);
}

export function stableFindingFingerprint(key, text) {
  const normalized = `${key}|${String(text).trim().replace(/\s+/g, ' ')}`;
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${key}:${(hash >>> 0).toString(36)}`;
}

/**
 * Count unsafe DOM sinks in a source string.
 * Returns { total, byKey, hits: [{line, key, text}] } counting only lines that
 * are NOT annotated with the `sutra-allow-html` marker.
 */
export function scanSinks(text) {
  return scanPatterns(text, SINK_PATTERNS, ALLOW_MARKERS.html);
}

/**
 * Count direct storage writes (minus `sutra-allow-storage` annotated lines).
 */
export function scanStorage(text) {
  return scanPatterns(text, STORAGE_PATTERNS, ALLOW_MARKERS.storage);
}

function scanPatterns(text, patterns, allowMarker) {
  const lines = splitLines(text);
  const byKey = {};
  const hits = [];
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (allowMarker.test(line)) continue; // reviewed exception
    for (const { key, re } of patterns) {
      // A single line can contain multiple occurrences; count each.
      const matches = line.match(new RegExp(re.source, 'g'));
      if (matches) {
        byKey[key] = (byKey[key] || 0) + matches.length;
        total += matches.length;
        const excerpt = line.trim().slice(0, 200);
        hits.push({ line: i + 1, key, text: excerpt, fingerprint: stableFindingFingerprint(key, excerpt) });
      }
    }
  }
  return { total, byKey, hits };
}

/**
 * Collect the set of global NAMES assigned in a source string.
 * Matches `window.Foo =`, `window['Foo'] =`, and the IIFE-alias forms
 * `global.Foo =` / `globalThis.Foo =` (Sutra modules commonly capture the
 * global as `(function (global) { ... global.SutraX = api }(window))`, which
 * the window-only patterns would miss — letting a global bypass the ratchet).
 * The alias forms require the identifier not to be a property access
 * (`config.global.x`) so we don't collect unrelated `.global.*` chains.
 * Comparisons (`==`/`===`) are excluded. Lines annotated `sutra-allow-global`
 * are still collected (so they register) — the marker is informational here.
 */
export function scanWindowGlobals(text) {
  const names = new Set();
  const lines = splitLines(text);
  const dotRe = /\bwindow\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  const idxRe = /\bwindow\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=(?!=)/g;
  const aliasDotRe = /(?<![.\w$])(?:global|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  const aliasIdxRe = /(?<![.\w$])(?:global|globalThis)\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=(?!=)/g;
  for (const line of lines) {
    let m;
    dotRe.lastIndex = 0;
    while ((m = dotRe.exec(line))) names.add(m[1]);
    idxRe.lastIndex = 0;
    while ((m = idxRe.exec(line))) names.add(m[1]);
    aliasDotRe.lastIndex = 0;
    while ((m = aliasDotRe.exec(line))) names.add(m[1]);
    aliasIdxRe.lastIndex = 0;
    while ((m = aliasIdxRe.exec(line))) names.add(m[1]);
  }
  return names;
}

/**
 * Walk a balanced `{...}` body starting from a function signature match.
 * Mirrors the proven helper in round-trip-check.mjs.
 */
export function extractFunctionBody(source, signaturePattern) {
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

/**
 * Extract the set of top-level workspace fields the app actually persists and
 * exports, for parity against docs/persistence-inventory.json.
 *   - persistAppData:                 appData.<field> = ...
 *   - buildWorkspaceExportPayload:    fields in the `jsonPayload = { ... }` block
 */
export function extractWorkspaceFields(appJs) {
  const persistBody = extractFunctionBody(appJs, /function\s+persistAppData\s*\(/);
  const buildBody = extractFunctionBody(appJs, /function\s+buildWorkspaceExportPayload\s*\(/);

  const persistFields = persistBody
    ? Array.from(new Set(
        Array.from(persistBody.matchAll(/appData\.([a-zA-Z_$][\w$]*)\s*=/g)).map(m => m[1])
      ))
    : [];

  const jsonReturnMatch = buildBody && buildBody.match(/jsonPayload\s*=\s*\{([\s\S]*?)\};/);
  const jsonReturnBlock = jsonReturnMatch ? jsonReturnMatch[1] : '';
  const exportFields = Array.from(new Set(
    Array.from(jsonReturnBlock.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm)).map(m => m[1])
  ));

  return { persistFields, exportFields };
}
