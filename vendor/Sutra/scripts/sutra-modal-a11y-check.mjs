#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const app = readFileSync('src/core/app.js', 'utf8');
const css = readFileSync('styles/themes/sutra-pro.css', 'utf8');
const html = readFileSync('Sutra.html', 'utf8');
const review = readFileSync('src/features/study/review.js', 'utf8');
const homework = readFileSync('src/features/study/homework.js', 'utf8');

// Core SutraModalManager capabilities (present in app.js or the stylesheet).
const required = [
  'const SutraModalManager',
  'focusableSelector',
  'aria-modal',
  'aria-labelledby',
  'handleKeydown',
  "event.key === 'Escape'",
  "event.key !== 'Tab'",
  'previousFocus',
  'sutra-modal-lock',
  'MutationObserver',
  'getListenerCount',
  // Phase 4 hardening: single deterministic focus-restoration owner + per-modal
  // Escape opt-out + the is-visible open-signal used by Review/Homework modals.
  'restoreFocusTo',
  'data-sutra-no-escape',
  "classList.contains('is-visible')"
];

const surfaces = [
  'studentOnboardingOverlay',
  'exportOptionsModal',
  'homeworkPasteImportModal',
  'versionHistoryModal',
  'businessEntityModal',
  'googleFeedbackIframe',
  'atelierDialogBackdrop',
  'documentBackgroundModal',
  'cw-modal-overlay',
  'th2-modal-overlay',
  // Phase 4: Review + Homework quick-add now run through the central lifecycle.
  'reviewModalRoot',
  'hwCourseQuickModal'
];

let failures = 0;
const fail = (msg) => { console.error(`FAIL ${msg}`); failures += 1; };

for (const needle of required) {
  if (!app.includes(needle) && !css.includes(needle)) fail(`modal manager missing ${needle}`);
}
for (const needle of surfaces) {
  if (!app.includes(needle) && !html.includes(needle)) fail(`modal coverage missing surface ${needle}`);
}

// Review + Homework modals must be registered in the central modalSelector.
if (!app.includes("'#reviewModalRoot'")) fail('SutraModalManager modalSelector does not include #reviewModalRoot');
if (!app.includes("'#hwCourseQuickModal'")) fail('SutraModalManager modalSelector does not include #hwCourseQuickModal');

// Review modals: own Escape via data-sutra-no-escape + proper dialog semantics.
if (!review.includes("setAttribute('data-sutra-no-escape', 'true')")) {
  fail('review.js does not opt its modal root out of manager Escape (data-sutra-no-escape)');
}
if (!review.includes('role="dialog"') || !review.includes('aria-modal="true"') || !review.includes('aria-labelledby=')) {
  fail('review.js modal card is missing dialog semantics');
}
if (!review.includes('aria-label="Close"')) fail('review.js modal is missing an accessible close control');

// Homework quick-add: toggles the manager open-signal + has dialog semantics.
if (!homework.includes("classList.add('is-visible')") || !homework.includes("classList.remove('is-visible')")) {
  fail('homework.js quick-add modal does not toggle the is-visible open-signal');
}
if (!homework.includes('role="dialog"') || !homework.includes('aria-modal="true"') || !homework.includes('aria-labelledby="hwCourseQuickTitle"')) {
  fail('homework.js quick-add modal is missing dialog semantics');
}

if (!css.includes('@media (max-width: 720px)') || !css.includes('border-radius: 20px 20px 0 0')) {
  fail('mobile bottom-sheet modal styling missing');
}
if (app.includes('[aria-label^="Close"]')) {
  fail('SutraModalManager must not use broad [aria-label^="Close"] matching');
}
if (!app.includes('[aria-label="Close"]')) {
  fail('SutraModalManager should only use exact aria-label close fallback');
}

if (failures) {
  console.error(`Modal accessibility check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('Modal accessibility check passed (incl. Review + Homework surfaces).');
