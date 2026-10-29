#!/usr/bin/env node
/*
 * Sutra encoding-integrity check.
 *
 * Scans tracked, runtime-facing text files for *unexplained* encoding defects:
 *   - cp1252 double-encoding (mojibake) -- runs that re-encode to valid UTF-8
 *   - U+FFFD replacement characters
 *   - invalid UTF-8 byte sequences
 *   - suspicious C0/C1 control characters (excluding tab/LF/CR)
 *   - double-escaped HTML entities (an ampersand entity that itself re-wraps an
 *     entity name or numeric reference)
 *   - leftover Private-Use-Area icon-font escapes in CSS `content:` (broken once
 *     the icon font is gone -- empty glyph boxes)
 *
 * A minimal, justified allowlist covers intentional mojibake (the page-icon
 * migration map). Exits non-zero on any unexplained finding.
 *
 * This file is intentionally pure-ASCII (defects are expressed via char codes /
 * \uXXXX escapes) so it passes its own scan.
 *
 * Usage: node scripts/sutra-encoding-check.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const REPLACEMENT = String.fromCharCode(0xFFFD);

const TEXT_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.markdown', '.md',
  '.webmanifest', '.svg', '.txt', '.atelier-plugin',
]);

// Files excluded from the scan entirely (vendored / generated noise).
const SKIP_FILES = new Set([
  'assets/vendor/jszip/jszip.min.js', // vendored minified third-party lib
  'assets/vendor/editor/sutra-editor.min.js', // vendored minified TipTap engine (embeds a literal U+001F ProseMirror leaf separator)
  'assets/vendor/pdf-fontkit/fontkit.umd.min.js', // vendored minified font parser embeds binary lookup tables
  'assets/vendor/pdf-lib/pdf-lib.min.js', // vendored minified PDF writer embeds PDF encoding tables
  'assets/vendor/pdfjs/build/pdf.worker.min.mjs', // vendored PDF.js worker embeds font/character tables
  'assets/vendor/pdfjs/build/pdf.worker.sutra.min.js', // local classic build of the same pinned PDF.js worker tables
  'assets/vendor/office/mammoth.browser.min.js', // vendored minified DOCX parser (embeds control chars in string tables)
  'assets/vendor/office/xlsx.full.min.js', // vendored minified XLSX parser embeds codepage/binary tables
]);
const SKIP_PREFIXES = [
  'scripts/_',              // local throwaway analysis helpers, never committed
  'noteflow-classic/',    // archived, frozen legacy app -- not part of the Sutra runtime
];

// Minimal justified allowlist: findings inside these regions are intentional.
const ALLOW_REGIONS = [
  {
    file: 'src/core/app.js',
    start: 'const PAGE_ICON_MOJIBAKE_MAP = Object.freeze({',
    end: '});',
    reason: 'Intentional mojibake->clean-icon migration map; keys must stay corrupted to match contaminated stored data.',
  },
];

// ---- cp1252 (WHATWG) inverse table, for surgical mojibake detection ----------
const HIGH = {
  0x80: 0x20AC, 0x81: 0x0081, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039,
  0x8C: 0x0152, 0x8D: 0x008D, 0x8E: 0x017D, 0x8F: 0x008F, 0x90: 0x0090, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9D: 0x009D,
  0x9E: 0x017E, 0x9F: 0x0178,
};
const INV = new Map();
for (let b = 0; b < 0x80; b++) INV.set(b, b);
for (let b = 0xA0; b <= 0xFF; b++) INV.set(b, b);
for (const [b, cp] of Object.entries(HIGH)) INV.set(cp, Number(b));
const strict = new TextDecoder('utf-8', { fatal: true });

function reverseMojibake(run) {
  const bytes = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0);
    if (!INV.has(cp)) return null;
    bytes.push(INV.get(cp));
  }
  try {
    const out = strict.decode(new Uint8Array(bytes));
    if (out === run || out.includes(REPLACEMENT)) return null;
    return out;
  } catch { return null; }
}
const isCand = (ch) => { const cp = ch.codePointAt(0); return cp >= 0x80 && INV.has(cp); };

// ---- file gathering ----------------------------------------------------------
function trackedTextFiles() {
  // Include committed files and intentional, non-ignored additions while
  // excluding local browser profiles, QA captures, deploy output, and other
  // ignored artifacts that can never enter the reviewed commit.
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean).sort()
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !SKIP_FILES.has(f))
    .filter((f) => !SKIP_PREFIXES.some((p) => f.startsWith(p)));
}

function allowedRegions(rel, text) {
  const ranges = [];
  for (const r of ALLOW_REGIONS) {
    if (r.file !== rel) continue;
    const s = text.indexOf(r.start);
    if (s < 0) continue;
    const e = text.indexOf(r.end, s + r.start.length);
    const startLine = text.slice(0, s).split('\n').length;
    const endLine = e < 0 ? Infinity : text.slice(0, e).split('\n').length;
    ranges.push([startLine, endLine]);
  }
  return ranges;
}
const inRanges = (line, ranges) => ranges.some(([a, b]) => line >= a && line <= b);

// ---- detectors (regexes built from escape strings to keep this file ASCII) ---
const C0 = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]');
const C1 = new RegExp('[\\x80-\\x9F]');
// ZWSP / ZWNJ / word-joiner / BOM. U+200D (ZWJ) is intentionally excluded -- it
// is legitimately used inside emoji ZWJ sequences (e.g. eye-in-speech-bubble).
const ZERO_WIDTH = new RegExp('[\\u200B\\u200C\\u2060\\uFEFF]');
const PUA = new RegExp('[\\uE000-\\uF8FF]');
const DOUBLE_ENTITY = new RegExp('&amp;(?:amp|lt|gt|quot|apos|nbsp|#x?[0-9a-fA-F]+);');
const PUA_CONTENT = new RegExp('content\\s*:\\s*(["\'])[^"\']*[\\uE000-\\uF8FF][^"\']*\\1');
const PUA_ESCAPE_CONTENT = new RegExp('content\\s*:\\s*(["\'])\\s*\\\\[efEF][0-9a-fA-F]{2,5}\\s*\\1');

const findings = [];
let allowedCount = 0;
function add(rel, line, type, sample, ranges) {
  if (inRanges(line, ranges)) { allowedCount++; return; }
  findings.push({ rel, line, type, sample });
}

for (const rel of trackedTextFiles()) {
  const abs = path.join(ROOT, rel);
  let buf;
  try { buf = fs.readFileSync(abs); } catch { continue; }

  let text;
  try { text = strict.decode(buf); }
  catch {
    text = buf.toString('utf8');
    findings.push({ rel, line: 0, type: 'invalid-utf8', sample: '(file is not valid UTF-8)' });
  }

  const ranges = allowedRegions(rel, text);
  const lines = text.split('\n');
  const isCss = rel.toLowerCase().endsWith('.css');
  const isDoc = /\.(md|markdown|txt)$/i.test(rel);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const ln = li + 1;

    const chars = Array.from(line);
    let i = 0;
    while (i < chars.length) {
      if (!isCand(chars[i])) { i++; continue; }
      let j = i;
      while (j < chars.length && isCand(chars[j])) j++;
      const run = chars.slice(i, j).join('');
      const rev = reverseMojibake(run);
      if (rev !== null) add(rel, ln, 'mojibake', `${JSON.stringify(run)} -> ${JSON.stringify(rev)}`, ranges);
      i = j;
    }

    if (line.includes(REPLACEMENT)) add(rel, ln, 'replacement-char', 'U+FFFD present', ranges);
    if (C0.test(line)) add(rel, ln, 'control-c0', 'C0 control char', ranges);
    if (C1.test(line)) add(rel, ln, 'control-c1', 'C1 control char', ranges);
    if (ZERO_WIDTH.test(line)) add(rel, ln, 'zero-width', 'zero-width/BOM char', ranges);
    if (!isDoc && DOUBLE_ENTITY.test(line)) add(rel, ln, 'double-entity', line.match(DOUBLE_ENTITY)[0], ranges);
    if (isCss && PUA.test(line) && (PUA_CONTENT.test(line) || PUA_ESCAPE_CONTENT.test(line)))
      add(rel, ln, 'css-pua-icon', 'PUA icon-font content (breaks without the font)', ranges);
  }
}

findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
const byType = {};
for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;

if (findings.length === 0) {
  console.log(`encoding-check: OK -- no unexplained encoding defects (${allowedCount} allowlisted finding(s) suppressed).`);
  process.exit(0);
}

console.error('encoding-check: FAILED -- unexplained encoding defects found:\n');
for (const f of findings) console.error(`  ${f.rel}:${f.line}  [${f.type}]  ${f.sample}`);
console.error('\nSummary by type:');
for (const [t, n] of Object.entries(byType)) console.error(`  ${t}: ${n}`);
console.error(`\nAllowlisted (intentional) findings suppressed: ${allowedCount}`);
console.error('\nIf a finding is legitimate, add a narrow justified entry to ALLOW_REGIONS in scripts/sutra-encoding-check.mjs.');
process.exit(1);
