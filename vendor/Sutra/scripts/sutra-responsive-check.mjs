#!/usr/bin/env node
// sutra-responsive-check.mjs — guard the mobile/responsive contract.
//
// Static checks that the responsive hooks every Sutra surface depends on are
// present: viewport metas, a mobile stylesheet with media queries, reduced-motion
// fallbacks, and the new-feature mobile rules (Sutra Assistant badge, document-
// background controls, the scrollytelling vertical-thread fallback). Static
// checks can't prove pixel layout, but they catch a desktop-only regression
// (a new component shipped with no mobile handling) before release.
//
// Run: node scripts/sutra-responsive-check.mjs
import { readFileSync } from 'node:fs';

let failures = 0;
function read(file) { try { return readFileSync(file, 'utf8'); } catch { return null; } }
function has(file, needle, label, re = false) {
  const text = read(file);
  if (text == null) { failures++; console.error('  MISSING FILE:', file); return; }
  const ok = re ? needle.test(text) : text.includes(needle);
  if (ok) console.log('  ok:', label);
  else { failures++; console.error(`  FAIL: ${label} — not found in ${file}`); }
}
function count(file, re) { const t = read(file) || ''; return (t.match(re) || []).length; }

console.log('Viewport + base responsive plumbing');
has('Sutra.html', 'name="viewport"', 'app shell has a viewport meta');
has('Sutra.html', 'width=device-width', 'app shell viewport scales to device width');
has('HomePage.html', 'width=device-width', 'landing viewport scales to device width');

console.log('\nMobile stylesheet');
has('Sutra.html', 'styles/responsive/mobile.css', 'mobile stylesheet linked in the app shell');
const mq = count('styles/responsive/mobile.css', /@media[^{]*max-width/gi);
if (mq >= 10) console.log(`  ok: mobile.css has ${mq} max-width media queries`);
else { failures++; console.error(`  FAIL: mobile.css has too few media queries (${mq})`); }

console.log('\nReduced motion + responsive math');
has('HomePage.html', 'prefers-reduced-motion', 'landing respects reduced motion');
has('Sutra.html', 'prefers-reduced-motion', 'app shell respects reduced motion (doc-bg + badge)');
has('HomePage.html', 'clamp(', 'landing uses fluid type/space (clamp)');

console.log('\nNew-feature mobile rules');
// Powered by Sutra Intelligence badge — compact on small screens.
has('Sutra.html', '@media (max-width:560px)', 'Sutra Intelligence badge has a mobile breakpoint', false);
has('Sutra.html', '.sutra-intel-badge', 'assistant intelligence badge styles present');
// Document-background controls — stack/expand under 520px.
has('Sutra.html', '@media (max-width:520px)', 'document-background controls have a mobile breakpoint', false);
has('Sutra.html', 'width:min(440px,94vw)', 'document-background modal is viewport-bounded (min())', false);
has('Sutra.html', 'max-height:90vh;overflow-y:auto', 'document-background modal scrolls internally on short screens', false);
// Scrollytelling — simplified vertical thread on phones.
has('HomePage.html', '.problem-cluster::before', 'scrollytelling has a mobile vertical-thread fallback');
has('HomePage.html', /@media \(max-width: 760px\)[\s\S]*sutra-thread-svg \{ display: none/, 'desktop SVG thread is hidden on phones', true);
// Assistant panel responsiveness (existing).
has('styles/responsive/mobile.css', 'chatbot-panel', 'Sutra Assistant panel has mobile styles');

console.log('\nTouch-target + overflow hygiene (new controls)');
has('Sutra.html', 'min-height:44px', 'document-background buttons meet the 44px touch target', false);
has('Sutra.html', 'flex-wrap:wrap', 'document-background action rows wrap rather than overflow', false);

console.log('\nMobile polish pass (2026-06-11) — phone chrome + editor contract');
// Storage bar must stay a single compact row on phones (status + 3 buttons).
has('styles/responsive/mobile.css', 'repeat(3, minmax(0, 1fr))', 'storage bar keeps Save, Export, Import, and unified Cloud in one phone row');
// Assistant quick-action chips scroll horizontally instead of stacking 2-3 rows.
has('styles/responsive/mobile.css', /\.view-flow-row\s*\{[^}]*flex-wrap:\s*nowrap/, 'assistant chips are a single scrollable row on phones', true);
// Notes: the chips row clears the fixed toolbar (prevents the chip/toolbar collision).
has('styles/responsive/mobile.css', /#view-notes \.view-flow-row\s*\{[^}]*margin-top/, 'Notes chips row clears the fixed toolbar', true);
// Editor padding is measured against the container, not the view (no double gap).
has('src/core/app.js', 'const containerRect = editorContainer.getBoundingClientRect();', 'Notes editor padding measures the container top (no double-reserved gap)');
// FAB stack floor matches the slim storage bar.
has('src/core/app.js', 'const minBottom = 84;', 'FAB stack floor matches the compact storage bar');
has('src/core/app.js', 'shortLandscapeViewport', 'FABs lay out side-by-side on short landscape viewports');
has('styles/legacy/responsive-hardening.css', '#lifeDashboard', 'responsive bottom-clearance covers Life custom mount');
has('styles/legacy/responsive-hardening.css', '#businessDashboardRoot', 'responsive bottom-clearance covers Business custom mount');
has('styles/legacy/responsive-hardening.css', '#hwMainArea', 'responsive bottom-clearance covers Homework custom mount');
// Mobile nav: the More toggle must not echo the visible active tab.
has('src/core/app.js', /const activeSecondary = \(tabsRow \? Array\.from\(tabsRow\.children\) : \[\]\)/, 'More-menu label derives from strip tabs only (no Today/Today echo)', true);
// Assistant input: 4-column grid (attach + mic + textarea + send) so the
// textarea is not squeezed to 86px.
has('styles/legacy/workspace-overrides.css', /\.chatbot-input\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto/, 'assistant input grid fits attach + mic + textarea + send', true);
// Touch-target floors apply on any coarse-pointer device (incl. landscape phones).
has('styles/responsive/mobile.css', /@media \(max-width: 768px\), \(hover: none\) and \(pointer: coarse\)/, 'touch-target floors keyed to coarse pointers, not just width', true);
has('styles/responsive/mobile.css', '.view-tab-add', 'view-tab add control has mobile touch-target floor');
has('styles/responsive/mobile.css', 'input[type="range"]', 'range sliders get coarse-pointer hit-area support');
has('styles/themes/sutra-pro.css', /\.cw-filter\s*\{[\s\S]*appearance:\s*none/, 'Course Hub filters hide the native select arrow', true);
has('styles/themes/sutra-pro.css', 'background-image:', 'Course Hub filters render a custom select caret');
// Template-category pills scroll in one row inside the New Page sheet.
has('styles/responsive/mobile.css', '.template-picker-category-tabs', 'New Page template pills have mobile rules');
has('styles/responsive/mobile.css', '.sutra-mobile-more-sheet', 'phone navigation exposes a dedicated all-sections sheet');
has('src/features/workspace/mobile-nav.js', "setAttribute('aria-modal', 'true')", 'mobile section sheet and notes drawer use modal semantics');
has('src/features/workspace/mobile-nav.js', "history.pushState", 'phone section sheet closes through browser Back');
has('src/core/app.js', /function shouldUseMobileTodayMode\(\)[\s\S]*?matchMedia\('\(max-width: 640px\)'\)/, 'mobile Today uses the same 640px boundary as phone navigation', true);
has('styles/views/today-redesign.css', /@media \(max-width: 640px\) \{[\s\S]*?body\.mobile-today-mode \.top-nav/, 'mobile Today hides desktop navigation only while the phone bar is available', true);
has('src/features/workspace/mobile-nav.js', /matchMedia\('\(max-width: 640px\)'\)/, 'phone navigation breakpoint remains aligned at 640px', true);
has('styles/views/timeline-calendar.css', '.sutra-calendar-month-events:not([data-event-count="0"])::before', 'phone Month view uses compact event-count indicators');
has('styles/views/timeline-calendar.css', '-webkit-overflow-scrolling: touch', 'calendar canvases keep contained momentum scrolling');
// Sync sheet is bounded to the dynamic mobile viewport, and the mobile rule
// must outrank the desktop cap (which already carries !important).
has('styles/features/cloud-sync.css', 'max-height: min(900px, calc(100dvh - 32px)) !important', 'Sync sheet desktop max-height cap stays authoritative');
has('styles/features/cloud-sync.css', 'max-height: calc(100dvh - max(8px, env(safe-area-inset-top, 0px))) !important', 'Sync sheet phone max-height carries !important so the bottom-sheet bound applies');
has('extension/options.html', 'min-width: 0', 'extension settings do not force a 360px minimum viewport');

if (failures) { console.error(`\nResponsive guard FAILED: ${failures} issue${failures === 1 ? '' : 's'}.`); process.exit(1); }
console.log('\nResponsive guard passed — required mobile hooks present.');
