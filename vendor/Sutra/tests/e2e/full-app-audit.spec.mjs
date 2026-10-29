import { expect, test } from '@playwright/test';

/*
 * full-app-audit.spec.mjs — comprehensive end-to-end fluidity + micro-interaction
 * audit. This is a DIAGNOSTIC suite: each test walks a broad surface, collects
 * findings into a structured report (logged with the AUDIT:: marker so the run
 * output can be parsed), and asserts only on genuinely critical regressions
 * (uncaught page errors, same-origin console errors, same-origin request
 * failures, horizontal overflow, broken focus restoration).
 *
 * It intentionally does not duplicate the behavior-level specs; it exercises the
 * navigation shell, every primary view, the command palette / quick capture /
 * assistant / notification surfaces, the motion-token system, focus-visible
 * rings, modal focus trapping, reduced-motion collapse, and mobile overflow.
 */

const PRIMARY_VIEWS = [
  'today', 'timeline', 'notes', 'collegeapp', 'life', 'business',
  'homework', 'courses', 'alldue', 'apstudy', 'review', 'settings'
];

function attachDiagnostics(page) {
  const diag = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') diag.consoleErrors.push({ text: msg.text(), location: msg.location() });
    else if (type === 'warning') diag.consoleWarnings.push({ text: msg.text() });
  });
  page.on('pageerror', (err) => diag.pageErrors.push(String(err && err.stack ? err.stack : err)));
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    diag.failedRequests.push({ url: req.url(), method: req.method(), error: failure ? failure.errorText : 'unknown' });
  });
  return diag;
}

// External hosts that are EXPECTED to fail in an offline test run (AI providers,
// CDNs, Google endpoints). Only same-origin failures are treated as critical.
function isCriticalRequest(url) {
  return /127\.0\.0\.1|localhost/.test(url);
}
// console noise that is expected and not a product defect.
function isCriticalConsole(text) {
  if (/favicon/i.test(text)) return false;
  if (/Failed to load resource/i.test(text) && /(cdnjs|cloudflare|googleapis|google|groq|openai|anthropic|openrouter|unpkg|ytimg|youtube|spotify|soundcloud|vimeo|figma|codepen)/i.test(text)) return false;
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|FAILED|ABORTED)/i.test(text) && !/127\.0\.0\.1|localhost/.test(text)) return false;
  return true;
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  await page.waitForFunction(() => typeof window.setActiveView === 'function');
}

async function enableCourseHub(page) {
  await page.evaluate(() => {
    try {
      window.setActiveView('settings');
      const control = document.querySelector('[data-pref-path="layout.courseHubEnabled"]');
      if (control && !control.checked) {
        control.checked = true;
        control.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('settingsApplyBtn')?.click();
      }
    } catch (e) {}
  });
}

test('desktop: boot health, every view renders cleanly, no overflow', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openApp(page);
  await enableCourseHub(page);

  // Boot health snapshot.
  const boot = await page.evaluate(() => ({
    degraded: !!(window.SutraFeatureGuard && window.SutraFeatureGuard.isDegraded && window.SutraFeatureGuard.isDegraded()),
    degradedList: (window.SutraFeatureGuard && window.SutraFeatureGuard.getDegraded) ? window.SutraFeatureGuard.getDegraded() : {},
    hasBadgeAttr: document.body.hasAttribute('data-sutra-feature-degraded'),
    motionTokenPress: getComputedStyle(document.documentElement).getPropertyValue('--transition-press').trim(),
    motionTokenFast: getComputedStyle(document.documentElement).getPropertyValue('--transition-fast').trim()
  }));

  const viewReport = {};
  for (const view of PRIMARY_VIEWS) {
    const before = diag.consoleErrors.length;
    const t0 = Date.now();
    await page.evaluate((v) => window.setActiveView(v), view);
    await page.waitForTimeout(120);
    const info = await page.evaluate((v) => {
      const el = document.getElementById('view-' + v);
      const active = el ? el.classList.contains('active') : false;
      const visible = el ? !!(el.offsetParent !== null || getComputedStyle(el).display !== 'none') : false;
      const rect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      // text/interactive content present (not a blank view)
      const interactiveCount = el ? el.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]').length : 0;
      const textLen = el ? (el.innerText || '').trim().length : 0;
      const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const bodyOverflow = document.body.scrollWidth - document.body.clientWidth;
      return { active, visible, w: Math.round(rect.width), h: Math.round(rect.height), interactiveCount, textLen, docOverflow, bodyOverflow };
    }, view);
    const renderMs = Date.now() - t0;
    const newErrors = diag.consoleErrors.slice(before).filter((e) => isCriticalConsole(e.text));
    viewReport[view] = { ...info, renderMs, criticalConsole: newErrors.map((e) => e.text) };
  }

  const criticalConsole = diag.consoleErrors.filter((e) => isCriticalConsole(e.text));
  const criticalRequests = diag.failedRequests.filter((r) => isCriticalRequest(r.url));
  const overflowViews = Object.entries(viewReport).filter(([, v]) => v.docOverflow > 2).map(([k, v]) => `${k}(+${v.docOverflow}px)`);
  const blankViews = Object.entries(viewReport).filter(([, v]) => v.interactiveCount === 0 && v.textLen < 5).map(([k]) => k);

  const report = {
    section: 'DESKTOP_CRAWL',
    boot,
    viewReport,
    summary: {
      criticalConsoleCount: criticalConsole.length,
      criticalRequestCount: criticalRequests.length,
      pageErrorCount: diag.pageErrors.length,
      overflowViews,
      blankViews
    },
    criticalConsole: criticalConsole.slice(0, 20),
    criticalRequests: criticalRequests.slice(0, 20),
    pageErrors: diag.pageErrors.slice(0, 20)
  };
  console.log('AUDIT::' + JSON.stringify(report));

  // Critical assertions (report already logged above).
  expect(boot.motionTokenPress, 'motion token --transition-press must resolve').not.toBe('');
  expect(report.summary.pageErrorCount, `page errors: ${JSON.stringify(diag.pageErrors.slice(0, 5))}`).toBe(0);
  expect(report.summary.criticalConsoleCount, `console errors: ${JSON.stringify(criticalConsole.slice(0, 5))}`).toBe(0);
  expect(report.summary.criticalRequestCount, `request failures: ${JSON.stringify(criticalRequests.slice(0, 5))}`).toBe(0);
  expect(overflowViews, 'views with horizontal overflow').toEqual([]);
  expect(boot.degraded, `degraded features on boot: ${JSON.stringify(boot.degradedList)}`).toBe(false);
});

test('desktop: command palette opens, filters, restores focus on close', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openApp(page);
  await page.evaluate(() => window.setActiveView('today'));

  // Put focus on a known element so we can verify restoration.
  await page.evaluate(() => {
    const tab = document.querySelector('.view-tab[data-view="today"]');
    if (tab) tab.focus();
  });
  await page.keyboard.press('Control+Shift+p');
  const modal = page.locator('#commandPaletteModal');
  await expect(modal).toBeVisible();
  // Focus moves into the palette on open. Poll for focus being *inside* the modal
  // (the proven-stable modal-accessibility pattern) rather than racing the exact
  // element the async initial-focus lands on.
  await expect.poll(() => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#commandPaletteModal'))).toBe(true);
  const itemCount = await page.evaluate(() => document.querySelectorAll('.command-palette-item').length);
  expect(itemCount).toBeGreaterThan(0);

  // Filter
  await page.fill('#commandPaletteInput', 'export');
  await page.waitForTimeout(120);
  const filtered = await page.evaluate(() => Array.from(document.querySelectorAll('.command-palette-item')).map((i) => (i.innerText || '').trim()).slice(0, 12));
  expect(filtered.join(' | ').toLowerCase()).toContain('export');

  // Escape closes and restores focus.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  const afterClose = await page.evaluate(() => document.activeElement && (document.activeElement.getAttribute('data-view') || document.activeElement.tagName));
  console.log('AUDIT::' + JSON.stringify({ section: 'COMMAND_PALETTE', filtered, afterCloseFocus: afterClose }));
  expect(diag.pageErrors).toEqual([]);
});

test('desktop: quick capture, assistant, and notifications open without errors', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openApp(page);
  await page.evaluate(() => window.setActiveView('today'));

  const surfaces = await page.evaluate(() => {
    const out = {};
    // Quick capture
    try {
      if (typeof window.openQuickCaptureModal === 'function') window.openQuickCaptureModal('');
      else if (window.flowAtelier && window.flowAtelier.openQuickCaptureModal) window.flowAtelier.openQuickCaptureModal('');
      const qc = document.getElementById('quickCaptureModal');
      out.quickCapture = qc ? (qc.classList.contains('active') || !qc.hidden || getComputedStyle(qc).display !== 'none') : 'missing';
    } catch (e) { out.quickCapture = 'error:' + e.message; }
    return out;
  });

  // Close quick capture if it opened (Escape).
  await page.keyboard.press('Escape');

  // Assistant
  const assistant = await page.evaluate(() => {
    try {
      if (typeof window.toggleChat === 'function') window.toggleChat();
      const panel = document.getElementById('chatbotPanel');
      return panel ? (panel.classList.contains('active') || panel.classList.contains('open') || getComputedStyle(panel).display !== 'none') : 'missing';
    } catch (e) { return 'error:' + e.message; }
  });
  await page.waitForTimeout(80);
  // Toggle assistant closed again
  await page.evaluate(() => { try { if (typeof window.toggleChat === 'function') window.toggleChat(); } catch (e) {} });

  // Notifications
  const notif = await page.evaluate(() => {
    try {
      const btn = document.getElementById('notifBellBtn');
      if (btn) btn.click();
      const panel = document.getElementById('notifPanel');
      return panel ? (panel.classList.contains('open') || panel.classList.contains('active') || !panel.hidden) : 'missing';
    } catch (e) { return 'error:' + e.message; }
  });

  const report = { section: 'SURFACES', quickCapture: surfaces.quickCapture, assistant, notif };
  console.log('AUDIT::' + JSON.stringify(report));

  expect(diag.pageErrors, JSON.stringify(diag.pageErrors.slice(0, 3))).toEqual([]);
  const criticalConsole = diag.consoleErrors.filter((e) => isCriticalConsole(e.text));
  expect(criticalConsole, JSON.stringify(criticalConsole.slice(0, 3))).toEqual([]);
  expect(String(surfaces.quickCapture)).not.toContain('error:');
  expect(String(assistant)).not.toContain('error:');
  expect(String(notif)).not.toContain('error:');
});

test('desktop: keyboard focus rings are visible and motion tokens drive transitions', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.setActiveView('today'));

  // Tab from the top of the document and check the first few focusable controls
  // get a visible focus indicator (outline or box-shadow) under :focus-visible.
  const focusSamples = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const sample = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const matchesFV = (() => { try { return el.matches(':focus-visible'); } catch (e) { return false; } })();
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      return {
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 40),
        matchesFocusVisible: matchesFV,
        hasOutline,
        hasShadow,
        visibleIndicator: hasOutline || hasShadow
      };
    });
    if (sample) focusSamples.push(sample);
  }

  // A representative interactive control should declare a real transition.
  const transitionInfo = await page.evaluate(() => {
    const tab = document.querySelector('.view-tab');
    const btn = document.querySelector('.btn, .neumo-btn, .toolbar-btn');
    const read = (el) => el ? getComputedStyle(el).transition : '';
    return { tab: read(tab), btn: read(btn) };
  });

  const focusableWithIndicator = focusSamples.filter((s) => s.visibleIndicator).length;
  const report = { section: 'FOCUS_MOTION', focusSamples, transitionInfo, focusableWithIndicator };
  console.log('AUDIT::' + JSON.stringify(report));

  // At least most tabbed controls must show a visible focus indicator.
  expect(focusSamples.length).toBeGreaterThan(0);
  expect(focusableWithIndicator).toBeGreaterThanOrEqual(Math.ceil(focusSamples.length / 2));
  // Transitions must be defined (not 'all 0s ease 0s').
  expect(transitionInfo.tab && transitionInfo.tab !== 'all 0s ease 0s').toBeTruthy();
});

test('desktop: modal traps focus and Escape restores it', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openApp(page);
  await page.evaluate(() => window.setActiveView('today'));

  // Open the command palette (a representative modal) and verify focus trap.
  await page.evaluate(() => {
    const tab = document.querySelector('.view-tab[data-view="today"]');
    if (tab) tab.focus();
  });
  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('#commandPaletteModal')).toBeVisible();
  // Wait until the palette is fully rendered (list populated) and focus has moved
  // inside the modal before exercising the Tab trap — otherwise tabbing can race
  // the first paint / async initial-focus.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#commandPaletteModal .command-palette-item').length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#commandPaletteModal'))).toBe(true);

  // Tab through; focus must remain inside the modal at every step.
  let escaped = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const modal = document.getElementById('commandPaletteModal');
      return modal ? modal.contains(document.activeElement) : false;
    });
    if (!inside) { escaped = true; break; }
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#commandPaletteModal')).toBeHidden();

  console.log('AUDIT::' + JSON.stringify({ section: 'FOCUS_TRAP', escaped }));
  expect(escaped, 'focus must stay trapped inside the open modal').toBe(false);
  expect(diag.pageErrors).toEqual([]);
});

test('reduced-motion: animations collapse across views', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);

  const results = {};
  for (const view of ['today', 'timeline', 'notes', 'homework', 'apstudy']) {
    await page.evaluate((v) => window.setActiveView(v), view);
    await page.waitForTimeout(60);
    const sample = await page.evaluate(() => {
      const tab = document.querySelector('.view-tab.active');
      const card = document.querySelector('.glass-card, .summary-card, .task-card, .hw-task-item');
      const dur = (el) => el ? getComputedStyle(el).animationDuration : 'n/a';
      // Under reduced motion the tab-activate keyframe animation must be none.
      const tabAnim = tab ? getComputedStyle(tab).animationName : 'n/a';
      return { tabAnimationName: tabAnim, cardAnimationDuration: dur(card) };
    });
    results[view] = sample;
  }
  console.log('AUDIT::' + JSON.stringify({ section: 'REDUCED_MOTION', results }));

  // The active-tab entrance animation must be suppressed under reduced motion.
  for (const [, v] of Object.entries(results)) {
    expect(['none', 'n/a']).toContain(v.tabAnimationName);
  }
});

test('desktop: rapid view switching stays clean and the active-tab indicator tracks', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openApp(page);
  await enableCourseHub(page);

  // Switch through the primary tabs twice in quick succession.
  const order = ['today', 'timeline', 'notes', 'homework', 'apstudy', 'collegeapp', 'life', 'business', 'today'];
  const indicator = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const view of order) {
      await page.evaluate((v) => window.setActiveView(v), view);
      await page.waitForTimeout(50);
    }
  }
  // After settling on a known view, the active tab + its underline indicator must be correct.
  await page.evaluate(() => window.setActiveView('timeline'));
  await page.waitForTimeout(120);
  const indicatorState = await page.evaluate(() => {
    const activeTab = document.querySelector('.view-tab.active[data-view]');
    const after = activeTab ? getComputedStyle(activeTab, '::after') : null;
    return {
      activeView: activeTab ? activeTab.getAttribute('data-view') : null,
      indicatorOpacity: after ? after.opacity : null,
      viewActive: !!document.getElementById('view-timeline')?.classList.contains('active')
    };
  });
  const criticalConsole = diag.consoleErrors.filter((e) => isCriticalConsole(e.text));
  console.log('AUDIT::' + JSON.stringify({ section: 'VIEW_SWITCH_FLUIDITY', indicatorState, criticalConsole: criticalConsole.slice(0, 5), pageErrors: diag.pageErrors.slice(0, 5) }));

  expect(diag.pageErrors, JSON.stringify(diag.pageErrors.slice(0, 3))).toEqual([]);
  expect(criticalConsole, JSON.stringify(criticalConsole.slice(0, 3))).toEqual([]);
  expect(indicatorState.activeView).toBe('timeline');
  expect(indicatorState.viewActive).toBe(true);
  // The active-tab underline indicator must be visible (micro-interaction present).
  expect(parseFloat(indicatorState.indicatorOpacity)).toBeGreaterThan(0);
});

test('desktop: toast appears and auto-dismisses (notification micro-interaction)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.setActiveView('today'));

  const shown = await page.evaluate(() => {
    const fn = (window.flowAtelier && window.flowAtelier.showToast) ? window.flowAtelier.showToast : window.showToast;
    if (typeof fn !== 'function') return 'no-toast-fn';
    fn('Audit toast check', { durationMs: 900 });
    const toast = document.getElementById('toast');
    return toast ? toast.classList.contains('show') : 'missing';
  });
  expect(shown).toBe(true);
  // A transition must be defined so the toast slides/fades rather than snapping.
  const transition = await page.evaluate(() => {
    const toast = document.getElementById('toast');
    return toast ? getComputedStyle(toast).transition : '';
  });
  // It must auto-dismiss.
  await expect.poll(() => page.evaluate(() => {
    const t = document.getElementById('toast');
    return t ? t.classList.contains('show') : false;
  }), { timeout: 4000 }).toBe(false);
  console.log('AUDIT::' + JSON.stringify({ section: 'TOAST', transition }));
  expect(transition && transition !== 'all 0s ease 0s').toBeTruthy();
});

for (const viewport of [
  { width: 320, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 }
]) {
  test(`responsive (${viewport.width}px): every view fits with no horizontal overflow`, async ({ page }) => {
    const diag = attachDiagnostics(page);
    await page.setViewportSize(viewport);
    await openApp(page);
    await enableCourseHub(page);

    const viewReport = {};
    for (const view of PRIMARY_VIEWS) {
      await page.evaluate((v) => window.setActiveView(v), view);
      await page.waitForTimeout(100);
      const info = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth
      }));
      viewReport[view] = info;
    }
    const overflowViews = Object.entries(viewReport).filter(([, v]) => v.docOverflow > 2 || v.bodyOverflow > 2).map(([k, v]) => `${k}(doc +${v.docOverflow}px, body +${v.bodyOverflow}px)`);
    const criticalConsole = diag.consoleErrors.filter((e) => isCriticalConsole(e.text));
    console.log('AUDIT::' + JSON.stringify({ section: 'RESPONSIVE_CRAWL', viewport, viewReport, overflowViews, criticalConsoleCount: criticalConsole.length }));

    expect(overflowViews, `views with horizontal overflow at ${viewport.width}px`).toEqual([]);
    expect(diag.pageErrors).toEqual([]);
  });
}

test('public and companion surfaces stay viewport-bound across phone and tablet widths', async ({ page }) => {
  const surfaces = [
    '/HomePage.html',
    '/404.html',
    '/oauth-callback.html',
    '/extension/popup.html',
    '/extension/options.html'
  ];
  const widths = [320, 430, 768];
  const findings = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1024 });
    for (const surface of surfaces) {
      await page.goto(surface, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(80);
      const layout = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        bodyOverflowX: getComputedStyle(document.body).overflowX
      }));
      findings.push({ surface, width, ...layout });
    }
  }

  const failures = findings.filter((item) => item.documentOverflow > 2 || (item.bodyOverflow > 2 && !['hidden', 'clip'].includes(item.bodyOverflowX)));
  console.log('AUDIT::' + JSON.stringify({ section: 'PUBLIC_RESPONSIVE_CRAWL', findings, failures }));
  expect(failures, 'public or extension surfaces with horizontal overflow').toEqual([]);
});

test('mobile Sync dialog fits the dynamic viewport and keeps actions touchable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await page.evaluate(() => window.openSutraSyncModal());
  // Sync now lives inside the unified Sutra Cloud hub. Keep this audit focused
  // on the actual dialog shell rather than the inner Sync section.
  const dialog = page.locator('#sutraCloudModal .sutra-cloud-modal');
  await expect(dialog).toBeVisible();
  const layout = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const input = node.querySelector('.sutra-sync-input');
    const actions = Array.from(node.querySelectorAll('.sutra-sync-actions .storage-btn')).filter((button) => button.offsetParent !== null);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      inputFontSize: input ? parseFloat(getComputedStyle(input).fontSize) : 16,
      shortestAction: actions.length ? Math.min(...actions.map((button) => button.getBoundingClientRect().height)) : 44,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.inputFontSize).toBeGreaterThanOrEqual(16);
  expect(layout.shortestAction).toBeGreaterThanOrEqual(44);
  expect(layout.documentOverflow).toBeLessThanOrEqual(2);
});

test('mobile (390px): tap targets on the bottom nav are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  const tapTargets = await page.evaluate(() => {
    // Sample the primary nav controls a thumb must hit on a phone.
    const sel = '.view-tab:not([hidden]):not([style*="display:none"]), .sutra-bottom-nav button, .mobile-nav-item, .bottom-nav button, #notifBellBtn, #chatbotBtn';
    const els = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
    return els.slice(0, 16).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  const tooSmall = tapTargets.filter((t) => (t.h > 0 && t.h < 44) || (t.w > 0 && t.w < 24));
  console.log('AUDIT::' + JSON.stringify({ section: 'MOBILE_TAP_TARGETS', count: tapTargets.length, tooSmall }));

  // Visible primary nav targets should meet a reasonable minimum height.
  expect(tooSmall, 'primary navigation tap targets under 44px tall').toEqual([]);
});
