#!/usr/bin/env node
// sutra-brand-assets-check.mjs
// Verifies that all Sutra brand assets are in place and correctly referenced.
//
// Run: node scripts/sutra-brand-assets-check.mjs
//
// Fails when:
//   - Either canonical master PNG is missing
//   - Generated favicon sizes are missing
//   - Generated assistant sizes are missing
//   - favicon.ico is missing
//   - HTML entry points reference the old sutra-favicon.svg
//   - HTML entry points reference the stale NoteFlow Atelier favicon-64.png
//   - Main Sutra PNG favicon is not referenced in HTML files
//   - Apple touch icon is not referenced in HTML files
//   - Assistant launcher uses the old Mascot-320.png
//   - Startup loader uses the old sutra-favicon.svg
//   - Assistant panel header uses the old Mascot-320.png

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const join = (...parts) => resolve(ROOT, ...parts);
const read = (p) => { try { return readFileSync(join(p), 'utf8'); } catch { return ''; } };

let failures = 0;
function fail(msg) { console.error('  FAIL:', msg); failures++; }
function pass(msg) { console.log('  ok  :', msg); }

function requireFile(relPath, label) {
  if (existsSync(join(relPath))) {
    pass(`${label || relPath} exists`);
  } else {
    fail(`${label || relPath} is MISSING  (${relPath})`);
  }
}

function requireContains(filePath, needle, label) {
  const text = read(filePath);
  if (text.includes(needle)) {
    pass(label || `${filePath} contains "${needle}"`);
  } else {
    fail(`${label || filePath}: expected to contain "${needle}"`);
  }
}

function requireNotContains(filePath, needle, label) {
  const text = read(filePath);
  if (!text.includes(needle)) {
    pass(label || `${filePath} does not contain stale "${needle}"`);
  } else {
    fail(`${label || filePath}: must NOT contain "${needle}" — stale reference`);
  }
}

// ── Masters ──────────────────────────────────────────────────────────────────

console.log('\n── Canonical master PNGs ───────────────────────────────────────');
requireFile('assets/brand/sutra/sutra-app-icon-master.png',       'Main Sutra master PNG');
requireFile('assets/brand/sutra/sutra-assistant-icon-master.png', 'Sutra Assistant master PNG');

// ── Main Sutra derivatives ───────────────────────────────────────────────────

console.log('\n── Main Sutra icon derivatives ─────────────────────────────────');
const APP_SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024];
for (const s of APP_SIZES) {
  requireFile(`assets/brand/sutra/generated/sutra-icon-${s}.png`, `sutra-icon-${s}.png`);
}
requireFile('assets/brand/sutra/generated/favicon.ico', 'favicon.ico');
requireFile('assets/brand/sutra/generated/social-preview.png', 'social-preview.png');

// ── Assistant derivatives ────────────────────────────────────────────────────

console.log('\n── Sutra Assistant icon derivatives ────────────────────────────');
const ASST_SIZES = [32, 44, 64, 96, 128, 192, 256, 512];
for (const s of ASST_SIZES) {
  requireFile(`assets/brand/sutra/generated/sutra-assistant-icon-${s}.png`, `sutra-assistant-icon-${s}.png`);
}

// ── HTML: no stale favicon references ────────────────────────────────────────

console.log('\n── HTML: stale favicon references removed ──────────────────────');
for (const html of ['index.html', 'HomePage.html', 'Sutra.html']) {
  requireNotContains(html, 'sutra-favicon.svg',
    `${html}: old sutra-favicon.svg not referenced`);
  requireNotContains(html, 'NoteFlow%20Atelier%20favicon-64.png',
    `${html}: stale NoteFlow Atelier favicon-64 not referenced`);
  requireNotContains(html, 'NoteFlow Atelier favicon-64.png',
    `${html}: stale NoteFlow Atelier favicon-64 (unencoded) not referenced`);
}

// ── HTML: new PNG favicon present ────────────────────────────────────────────

console.log('\n── HTML: new brand PNG favicon referenced ──────────────────────');
for (const html of ['index.html', 'HomePage.html', 'Sutra.html']) {
  requireContains(html, 'assets/brand/sutra/generated/sutra-icon-32.png',
    `${html}: 32px PNG favicon linked`);
  requireContains(html, 'assets/brand/sutra/generated/sutra-icon-16.png',
    `${html}: 16px PNG favicon linked`);
  requireContains(html, 'assets/brand/sutra/generated/favicon.ico',
    `${html}: favicon.ico shortcut linked`);
  requireContains(html, 'assets/brand/sutra/generated/sutra-icon-180.png',
    `${html}: apple-touch-icon (180px) linked`);
  requireContains(html, 'assets/brand/sutra/generated/social-preview.png',
    `${html}: social preview metadata linked`);
}

// ── Sutra.html: app shell brand placements ───────────────────────────────────

console.log('\n── Sutra.html: app shell brand placements ──────────────────────');
requireContains('Sutra.html', 'assets/brand/sutra/generated/sutra-icon-256.png',
  'Sutra.html: startup loader uses sutra-icon-256.png');
requireContains('Sutra.html', 'data-sutra-component="startup-loader"',
  'Sutra.html: startup loader has data-sutra-component hook');
requireContains('Sutra.html', 'assets/brand/sutra/generated/sutra-icon-64.png',
  'Sutra.html: sidebar brand uses sutra-icon-64.png');
requireContains('Sutra.html', 'data-sutra-component="brand-mark"',
  'Sutra.html: brand mark has data-sutra-component hook');

// ── Sutra.html: assistant surfaces use assistant icon ────────────────────────

console.log('\n── Sutra.html: assistant icon placements ───────────────────────');
requireContains('Sutra.html', 'assets/brand/sutra/generated/sutra-assistant-icon-44.png',
  'Sutra.html: assistant launcher uses sutra-assistant-icon-44.png');
requireContains('Sutra.html', 'assets/brand/sutra/generated/sutra-assistant-icon-64.png',
  'Sutra.html: assistant panel header uses sutra-assistant-icon-64.png');
requireContains('Sutra.html', 'data-sutra-component="assistant-launcher"',
  'Sutra.html: assistant launcher has data-sutra-component hook');
requireContains('Sutra.html', 'data-sutra-component="assistant-intelligence-badge"',
  'Sutra.html: intelligence badge has data-sutra-component hook');

// ── Sutra.html: old mascot removed ───────────────────────────────────────────

console.log('\n── Sutra.html: stale Mascot-320.png removed ────────────────────');
requireNotContains('Sutra.html', 'Mascot-320.png',
  'Sutra.html: old Mascot-320.png not referenced');

// ── HomePage.html: landing brand ──────────────────────────────────────────────

console.log('\n── HomePage.html: landing page brand ───────────────────────────');
requireContains('HomePage.html', 'assets/brand/sutra/generated/sutra-icon-64.png',
  'HomePage.html: navbar brand uses sutra-icon-64.png');
requireContains('HomePage.html', 'data-sutra-component="brand-mark"',
  'HomePage.html: brand mark has data-sutra-component hook');

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
if (failures > 0) {
  console.error(`Brand assets check FAILED: ${failures} issue${failures === 1 ? '' : 's'}.`);
  process.exit(1);
} else {
  console.log('Brand assets check passed — all Sutra brand assets present and correctly referenced.');
}
