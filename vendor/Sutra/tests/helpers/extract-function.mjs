/*
 * tests/helpers/extract-function.mjs — behavior-level source assertions.
 *
 * Extracts a top-level function declaration body from a classic runtime
 * script (e.g. src/core/app.js) with a string/template/comment/regex-aware
 * brace scanner, so tests can assert on the actual call graph and conditions
 * instead of loose regex fragments. Pure Node module; no runtime deps.
 */
'use strict';

// A `/` after these characters starts a regular-expression literal rather
// than a division. Line-start is treated as regex-start.
const REGEX_START_AFTER = /[\(,\[=!&|?{}:;+\-*%^~<>]/;
const REGEX_START_AFTER_TEST = new RegExp(REGEX_START_AFTER.source);

function isRegexLiteralStart(prevSignificant) {
  if (prevSignificant === null || prevSignificant === '\n') return true;
  return REGEX_START_AFTER_TEST.test(prevSignificant);
}

// Scans a `/.../` regex literal beginning at `start` (the opening slash).
// Returns the index of the closing `/`, or -1 if the line ends first
// (regex literals cannot span raw newlines).
function skipRegexLiteral(text, start, len) {
  let i = start + 1;
  let inClass = false;
  while (i < len) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '\n' || ch === '\r') return -1;
    if (ch === '[') { inClass = true; i += 1; continue; }
    if (ch === ']') { inClass = false; i += 1; continue; }
    if (ch === '/' && !inClass) return i;
    i += 1;
  }
  return -1;
}

const DECL_PATTERNS = [
  (name) => new RegExp(`\\bfunction\\s+${name}\\s*\\(`, 'g'),
  (name) => new RegExp(`\\basync\\s+function\\s+${name}\\s*\\(`, 'g')
];

function findDeclarationStart(source, name) {
  for (const makePattern of DECL_PATTERNS) {
    const pattern = makePattern(name);
    const match = pattern.exec(source);
    if (match) return { start: match.index, parenAt: pattern.lastIndex - 1 };
  }
  return null;
}

// Scans from a function-declaration start and returns the index of the `{`
// that opens the body (the first brace at paren-depth 0, i.e. after the
// parameter list) plus the matching close brace index.
function locateBody(source, startIndex) {
  let i = startIndex;
  const len = source.length;
  let parenDepth = 0;
  let braceDepth = 0;
  let bodyStart = -1;
  let prevSignificant = null;
  while (i < len) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < len) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) break;
        i += 1;
      }
      prevSignificant = quote;
    } else if (ch === '`') {
      // Template literal: skip content and nested ${...} expressions.
      i += 1;
      let exprDepth = 0;
      while (i < len) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '$' && source[i + 1] === '{') { exprDepth += 1; i += 2; continue; }
        if (c === '{' && exprDepth > 0) { exprDepth += 1; i += 1; continue; }
        if (c === '}' && exprDepth > 0) { exprDepth -= 1; i += 1; continue; }
        if (c === '`' && exprDepth === 0) break;
        i += 1;
      }
      prevSignificant = '`';
    } else if (ch === '/' && source[i + 1] === '/') {
      while (i < len && source[i] !== '\n') i += 1;
      prevSignificant = '\n';
    } else if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      prevSignificant = '\n';
      continue;
    } else if (ch === '/') {
      const regexEnd = isRegexLiteralStart(prevSignificant) ? skipRegexLiteral(source, i, len) : -1;
      if (regexEnd >= 0) {
        i = regexEnd;
        prevSignificant = '/';
      }
    } else if (ch === '(') {
      parenDepth += 1;
      prevSignificant = ch;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      prevSignificant = ch;
    } else if (ch === '{') {
      if (parenDepth === 0 && bodyStart === -1) {
        bodyStart = i;
        braceDepth = 1;
      } else if (bodyStart !== -1) {
        braceDepth += 1;
      }
      prevSignificant = ch;
    } else if (ch === '}' && bodyStart !== -1) {
      braceDepth -= 1;
      if (braceDepth === 0) return { bodyStart, bodyEnd: i + 1 };
      prevSignificant = ch;
    } else {
      if (!/\s/.test(ch)) prevSignificant = ch;
    }
    i += 1;
  }
  return null;
}

/**
 * Returns { start, end, body } for the first top-level declaration of
 * `function NAME(` / `async function NAME(` in source, or null.
 * `body` includes the surrounding braces.
 */
function extractFunction(source, name) {
  const declared = findDeclarationStart(source, name);
  if (!declared) return null;
  const located = locateBody(source, declared.start);
  if (!located) return null;
  return {
    start: declared.start,
    end: located.bodyEnd,
    body: source.slice(declared.start, located.bodyEnd)
  };
}

/** Count of `name(` call occurrences inside a body string. */
function callCount(body, name) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  return (body.match(pattern) || []).length;
}

/**
 * Extracts the balanced `{...}` block that begins after `marker` (the first
 * `{` after the marker, closed by its matching brace, string/template/
 * comment/regex-aware). Returns { start, end, body } where body includes the
 * braces, or null. Useful for object-literal arrow methods such as
 * `discoverModels: async (provider) => { ... }`.
 */
export function extractBalancedBlock(source, marker) {
  const markerIndex = String(source).indexOf(marker);
  if (markerIndex === -1) return null;
  // When the marker itself ends with the opening brace (e.g. 'var PRESETS = {'),
  // that brace is the block opener; otherwise find the first `{` after it.
  const trimmedMarker = String(marker).replace(/\s+$/, '');
  const openIndex = trimmedMarker.endsWith('{')
    ? markerIndex + trimmedMarker.length - 1
    : String(source).indexOf('{', markerIndex + marker.length);
  if (openIndex === -1) return null;
  const text = String(source);
  const len = text.length;
  let i = openIndex;
  let depth = 0;
  let prevSignificant = null;
  while (i < len) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < len) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) break;
        i += 1;
      }
      prevSignificant = quote;
    } else if (ch === '`') {
      i += 1;
      let exprDepth = 0;
      while (i < len) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '$' && text[i + 1] === '{') { exprDepth += 1; i += 2; continue; }
        if (c === '{' && exprDepth > 0) { exprDepth += 1; i += 1; continue; }
        if (c === '}' && exprDepth > 0) { exprDepth -= 1; i += 1; continue; }
        if (c === '`' && exprDepth === 0) break;
        i += 1;
      }
      prevSignificant = '`';
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < len && text[i] !== '\n') i += 1;
      prevSignificant = '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      prevSignificant = '\n';
      continue;
    } else if (ch === '/') {
      const regexEnd = isRegexLiteralStart(prevSignificant) ? skipRegexLiteral(text, i, len) : -1;
      if (regexEnd >= 0) {
        i = regexEnd;
        prevSignificant = '/';
      }
    } else if (ch === '{') {
      depth += 1;
      prevSignificant = ch;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: markerIndex, end: i + 1, body: text.slice(markerIndex, i + 1) };
      }
      prevSignificant = ch;
    } else {
      if (!/\s/.test(ch)) prevSignificant = ch;
    }
    i += 1;
  }
  return null;
}

export { extractFunction, callCount };
