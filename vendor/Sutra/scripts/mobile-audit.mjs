#!/usr/bin/env node
// mobile-audit.mjs — visual + programmatic mobile audit for Sutra.
//
// Drives the real app in headless Chromium across phone viewports, walks every
// top-level view, captures screenshots into .tmp/mobile-audit/, and flags:
//   - horizontal document overflow (and the offending elements)
//   - visible interactive controls below a 32px touch-target floor
//   - fixed-position elements that collide with each other
//
// Usage: node scripts/mobile-audit.mjs [--views today,notes] [--viewports narrow]
// Requires the static server on 127.0.0.1:5173 (npm run serve) or starts none.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173';
const OUT = '.tmp/mobile-audit';
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const ALL_VIEWPORTS = [
  { name: 'narrow', width: 360, height: 800 },
  { name: 'iphone', width: 390, height: 844 },
  { name: 'phablet', width: 430, height: 932 },
  { name: 'landscape', width: 844, height: 390 }
];
const ALL_VIEWS = ['today', 'timeline', 'notes', 'collegeapp', 'life', 'business', 'homework', 'courses', 'alldue', 'apstudy', 'settings'];

const onlyViewports = (argOf('--viewports') || '').split(',').filter(Boolean);
const onlyViews = (argOf('--views') || '').split(',').filter(Boolean);
const viewports = onlyViewports.length ? ALL_VIEWPORTS.filter(v => onlyViewports.includes(v.name)) : ALL_VIEWPORTS;
const views = onlyViews.length ? onlyViews : ALL_VIEWS;

const SEED = {
  'hwCourses:v2': JSON.stringify([
    { id: 'c1', name: 'AP Chemistry', color: '#7c5cff' },
    { id: 'c2', name: 'AP US History', color: '#ff7c5c' },
    { id: 'c3', name: 'Multivariable Calculus & Linear Algebra', color: '#3cb37a' }
  ]),
  'hwTasks:v2': JSON.stringify([
    { id: 't1', courseId: 'c1', title: 'Lab write-up: thermodynamics of dissolution experiments', due: '2026-06-15', priority: 'high', status: 'todo' },
    { id: 't2', courseId: 'c2', title: 'DBQ practice essay on industrialization', due: '2026-06-12', priority: 'medium', status: 'inprogress' },
    { id: 't3', courseId: 'c3', title: 'Problem set 11 — eigenvalues and a very long assignment title to stress wrapping behavior on narrow screens', due: '2026-06-18', priority: 'low', status: 'todo' }
  ])
};

async function bootApp(page) {
  await page.addInitScript(seed => {
    sessionStorage.setItem('sutra_intro_played', '1');
    for (const [k, v] of Object.entries(seed)) {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v);
    }
  }, SEED);
  await page.goto(`${BASE}/Sutra.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    document.body.classList.remove('onboarding-open');
    for (const id of ['studentOnboardingOverlay', 'sutraStartupIntro', 'featureSetupOverlay']) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('active', 'intro-exiting');
        el.hidden = true;
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  });
  // Enable all optional feature views + Course Hub through the real settings
  // controls so every user-facing surface is auditable. Settings stage their
  // changes, so click the Save Changes button afterwards.
  await page.evaluate(() => {
    document.querySelectorAll('.feature-toggle-input[data-feature-view]').forEach(t => {
      if (!t.checked) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    const hub = document.querySelector('input[data-pref-path="layout.courseHubEnabled"]');
    if (hub && !hub.checked) { hub.checked = true; hub.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const save = document.getElementById('settingsApplyBtn') || document.getElementById('settingsApplyBtnTop');
    if (save) save.click();
  });
  await page.waitForTimeout(400);
}

// Runs inside the page: report overflow offenders, small touch targets, fixed collisions.
function inspectPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = { docScrollWidth: document.documentElement.scrollWidth, vw, overflowers: [], smallTargets: [], fixedCollisions: [] };

  function describe(el) {
    let d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    else if (el.classList.length) d += '.' + [...el.classList].slice(0, 3).join('.');
    return d;
  }
  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  // climb to nearest scrollable/clipping ancestor; overflow inside a scroller is fine
  function clippedByScroller(el) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX)) return true;
      p = p.parentElement;
    }
    return false;
  }

  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    // Overflow: extends past right edge or starts left of 0 (ignore offscreen-by-design elements far away)
    const overhangR = r.right - vw;
    const overhangL = -r.left;
    if ((overhangR > 2 && r.left < vw && overhangR < vw * 3) || (overhangL > 2 && r.right > 0 && overhangL < vw * 3)) {
      if (!clippedByScroller(el)) {
        out.overflowers.push({ el: describe(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], overhang: Math.round(Math.max(overhangR, overhangL)) });
      }
    }
  }
  // de-dup children of the same offender: keep the 20 widest unique descriptions
  const seen = new Set();
  out.overflowers = out.overflowers
    .sort((a, b) => b.overhang - a.overhang)
    .filter(o => { if (seen.has(o.el)) return false; seen.add(o.el); return true; })
    .slice(0, 20);

  const interactive = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]');
  for (const el of interactive) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top > vh || r.bottom < 0) continue; // only what's on screen
    if ((r.height < 32 || r.width < 32) && r.height > 4 && r.width > 4) {
      out.smallTargets.push({ el: describe(el), size: [Math.round(r.width), Math.round(r.height)] });
    }
  }
  out.smallTargets = out.smallTargets.slice(0, 25);

  const fixed = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= vw * 0.95 && r.height >= vh * 0.95) continue; // full-screen overlays
    if (r.width < 20 || r.height < 20) continue;
    fixed.push({ el, r, d: describe(el) });
  }
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 8 && oy > 8) out.fixedCollisions.push({ a: a.d, b: b.d, overlap: [Math.round(ox), Math.round(oy)] });
    }
  }
  out.fixedCollisions = out.fixedCollisions.slice(0, 12);
  return out;
}

// Deep surfaces: sub-pages, modals, panels, menus — opened like a user would.
// Each action runs after setActiveView(view); cleanup is Escape + overlay reset.
const DEEP_SURFACES = [
  { name: 'college-sheets', view: 'collegeapp', action: p => p.evaluate(() => document.querySelector('[data-collegeapp-page="sheets"]')?.click()) },
  { name: 'college-tracker', view: 'collegeapp', action: p => p.evaluate(() => document.querySelector('[data-collegeapp-page="tracker"]')?.click()) },
  { name: 'college-essays', view: 'collegeapp', action: p => p.evaluate(() => document.querySelector('[data-collegeapp-page="essays"]')?.click()) },
  { name: 'semester-setup', view: 'courses', action: p => p.evaluate(() => { const b = [...document.querySelectorAll('#view-courses button')].find(x => /semester setup/i.test(x.textContent)); b?.click(); }) },
  { name: 'task-modal', view: 'today', action: p => p.evaluate(() => { const b = [...document.querySelectorAll('.today-header-actions button')].find(x => /task/i.test(x.textContent)); b?.click(); }) },
  { name: 'command-palette', view: 'today', action: p => p.evaluate(() => { const item = [...document.querySelectorAll('#todayHeaderMoreMenu .today-hero-menu-item')].find(x => /palette/i.test(x.textContent)); if (item) { item.click(); } else if (window.bindCommandPaletteInput && window.openCommandPalette) { window.bindCommandPaletteInput(); window.openCommandPalette(''); } }) },
  { name: 'block-modal', view: 'timeline', action: p => p.evaluate(() => document.getElementById('addBlockBtn')?.click()) },
  { name: 'timeline-more-menu', view: 'timeline', action: p => p.evaluate(() => document.getElementById('timelineMoreBtn')?.click()) },
  { name: 'notif-panel', view: 'today', action: p => p.evaluate(() => document.getElementById('notifBellBtn')?.click()) },
  { name: 'more-views-menu', view: 'today', action: p => p.evaluate(() => document.getElementById('moreViewsToggle')?.click()) },
  { name: 'chatbot-panel', view: 'today', action: p => p.evaluate(() => { if (typeof window.toggleChat === 'function') window.toggleChat(); else document.querySelector('.chatbot-btn')?.click(); }) },
  { name: 'theme-panel', view: 'today', action: p => p.evaluate(() => { if (typeof window.toggleThemePanel === 'function') window.toggleThemePanel(); }) },
  { name: 'export-modal', view: 'notes', action: p => p.evaluate(() => { if (typeof window.openExportOptionsModal === 'function') window.openExportOptionsModal(); else document.getElementById('exportFileBtn')?.click(); }) },
  { name: 'sidebar-drawer', view: 'notes', action: p => p.evaluate(() => { document.querySelector('.sidebar-toggle-btn')?.click(); }) },
  { name: 'new-page-modal', view: 'notes', action: async p => { await p.evaluate(() => document.querySelector('.sidebar-toggle-btn')?.click()); await p.waitForTimeout(350); await p.evaluate(() => document.querySelector('.sidebar-new-page .new-page-btn, .new-page-btn')?.click()); } },
  { name: 'spaces-dropdown', view: 'notes', action: async p => { await p.evaluate(() => document.querySelector('.sidebar-toggle-btn')?.click()); await p.waitForTimeout(350); await p.evaluate(() => document.querySelector('.spaces-current')?.click()); } },
  { name: 'feedback-modal', view: 'today', action: p => p.evaluate(() => document.getElementById('feedbackFabBtn')?.click()) }
];

async function cleanupSurface(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    document.body.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
    const panel = document.getElementById('chatbotPanel');
    if (panel && panel.style.display === 'flex' && typeof window.toggleChat === 'function') window.toggleChat();
    // Brute-force: dismiss anything still open so surfaces don't bleed together.
    document.querySelectorAll('.modal, .acad-modal-overlay, .version-history-modal').forEach(m => {
      m.classList.remove('active');
      if (m.style.display && m.style.display !== 'none') m.style.display = 'none';
    });
    const notifPanel = document.getElementById('notifPanel');
    if (notifPanel && getComputedStyle(notifPanel).display !== 'none' && notifPanel.getBoundingClientRect().height > 0) {
      document.getElementById('notifCloseBtn')?.click();
    }
    notifPanel?.classList.remove('open', 'active');
    document.getElementById('notifOverlay')?.classList.remove('active');
    for (const id of ['commandPaletteModal', 'quickCaptureModal', 'globalSearchPanel']) {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active', 'open'); if (el.style.display && el.style.display !== 'none') el.style.display = 'none'; }
    }
    document.getElementById('themePanel')?.classList.remove('active');
    document.getElementById('moreViewsMenu')?.classList.remove('open');
    document.querySelectorAll('.spaces-dropdown.open, .spaces-dropdown.active').forEach(m => m.classList.remove('open', 'active'));
    const fb = document.getElementById('googleFeedbackModal');
    if (fb) { fb.hidden = true; fb.setAttribute('aria-hidden', 'true'); document.body.classList.remove('google-feedback-open'); }
  }).catch(() => {});
  await page.waitForTimeout(200);
}

const report = {};
const browser = await chromium.launch();
for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await ctx.newPage();
  await bootApp(page);
  report[vp.name] = {};
  for (const view of views) {
    try {
      await page.evaluate(v => { window.setActiveView?.(v); }, view);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${vp.name}-${view}.png` });
      const data = await page.evaluate(inspectPage);
      report[vp.name][view] = data;
      const flags = [];
      if (data.docScrollWidth > vp.width + 2) flags.push(`DOC-OVERFLOW ${data.docScrollWidth}px`);
      if (data.overflowers.length) flags.push(`${data.overflowers.length} overflowing el`);
      if (data.smallTargets.length) flags.push(`${data.smallTargets.length} small targets`);
      if (data.fixedCollisions.length) flags.push(`${data.fixedCollisions.length} fixed collisions`);
      console.log(`[${vp.name}] ${view}: ${flags.length ? flags.join(' | ') : 'clean'}`);
    } catch (err) {
      console.log(`[${vp.name}] ${view}: ERROR ${err.message.split('\n')[0]}`);
      report[vp.name][view] = { error: err.message };
    }
  }
  if (args.includes('--deep')) {
    for (const surf of DEEP_SURFACES) {
      try {
        await page.evaluate(v => { window.setActiveView?.(v); }, surf.view);
        await page.waitForTimeout(350);
        await surf.action(page);
        await page.waitForTimeout(550);
        await page.screenshot({ path: `${OUT}/${vp.name}-deep-${surf.name}.png` });
        const data = await page.evaluate(inspectPage);
        report[vp.name][`deep:${surf.name}`] = data;
        const flags = [];
        if (data.docScrollWidth > vp.width + 2) flags.push(`DOC-OVERFLOW ${data.docScrollWidth}px`);
        if (data.overflowers.length) flags.push(`${data.overflowers.length} overflowing el`);
        if (data.smallTargets.length) flags.push(`${data.smallTargets.length} small targets`);
        if (data.fixedCollisions.length) flags.push(`${data.fixedCollisions.length} fixed collisions`);
        console.log(`[${vp.name}] deep:${surf.name}: ${flags.length ? flags.join(' | ') : 'clean'}`);
      } catch (err) {
        console.log(`[${vp.name}] deep:${surf.name}: ERROR ${err.message.split('\n')[0]}`);
      }
      await cleanupSurface(page);
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nReport: ${OUT}/report.json — screenshots in ${OUT}/`);
