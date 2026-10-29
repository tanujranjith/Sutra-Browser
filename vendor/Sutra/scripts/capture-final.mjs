// Final landing-page screenshot capture for Sutra.
// Boots the app, seeds a believable late-spring junior workspace, captures each
// marketable surface in the premium light theme, downscales to a web-friendly
// width via an in-page canvas, and writes optimized PNGs into assets/screenshots/.
//
// Usage:
//   node scripts/serve-static.mjs 5173   (in another shell)
//   node scripts/capture-final.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { SEED_SRC } from './demo-seed.mjs';

const BASE = process.env.SUTRA_BASE_URL || 'http://127.0.0.1:5173';
const SS = 'assets/screenshots';
const MAX_W = 1600;       // downscaled output width (source is 1440 @ DPR2 = 2880)
const errors = [];
const written = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// A throwaway page used purely to downscale PNG buffers with a canvas.
const canvasPage = await browser.newPage();
await canvasPage.setContent('<!doctype html><body></body>');
async function downscaleAndSave(buf, destPath) {
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  const out = await canvasPage.evaluate(async ({ dataUrl, maxW }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const scale = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  }, { dataUrl, maxW: MAX_W });
  const b64 = out.split(',')[1];
  writeFileSync(destPath, Buffer.from(b64, 'base64'));
  written.push(destPath);
}

async function capture(name) {
  const buf = await page.screenshot({ fullPage: false });
  await downscaleAndSave(buf, `${SS}/${name}.png`);
}

async function hideCaptureNotifications(targetPage) {
  await targetPage.evaluate(() => {
    const container = document.getElementById('notifToastContainer');
    if (!container) return;
    container.replaceChildren();
    container.style.display = 'none';
  });
}

// Marketing captures must never depend on a provider key or persist synthetic
// conversation data. These helpers stage a small, representative exchange in
// the throwaway browser DOM only.
async function stageDockedConversation() {
  await page.evaluate(() => {
    const host = document.getElementById('chatbotMessages');
    if (!host) return;
    host.replaceChildren();
    const append = (role, text) => {
      const message = document.createElement('div');
      message.className = `chatbot-msg ${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      bubble.appendChild(paragraph);
      message.appendChild(bubble);
      host.appendChild(message);
    };
    append('user', 'I have a Calc quiz and APUSH reading tomorrow. What should I do first?');
    append('assistant', 'Start with the Calc quiz: it is due sooner and needs focused practice. Then spend 25 minutes outlining the APUSH reading.');
    const subtitle = document.getElementById('chatbotSubtitle');
    if (subtitle) subtitle.textContent = 'Today · Study plan';
    host.scrollTop = host.scrollHeight;
  });
}

async function stageFullAssistantConversation() {
  await page.evaluate(() => {
    const hero = document.getElementById('asstHero');
    if (hero) hero.hidden = true;
    const chips = document.getElementById('asstChips');
    if (chips) chips.replaceChildren();
    const host = document.getElementById('asstMessages');
    if (!host) return;
    host.replaceChildren();
    const append = (role, text) => {
      const message = document.createElement('div');
      message.className = `asst-msg ${role}`;
      const avatar = document.createElement('div');
      avatar.className = `asst-msg-avatar${role === 'assistant' ? ' asst-msg-avatar-logo' : ''}`;
      if (role === 'assistant') {
        const image = document.createElement('img');
        image.src = 'assets/brand/sutra/generated/sutra-assistant-icon-64.png';
        image.alt = '';
        avatar.appendChild(image);
      } else {
        const icon = document.createElement('i');
        icon.className = 'fas fa-user';
        icon.setAttribute('aria-hidden', 'true');
        avatar.appendChild(icon);
      }
      const wrap = document.createElement('div');
      wrap.className = 'asst-msg-wrap';
      const bubble = document.createElement('div');
      bubble.className = 'asst-msg-bubble';
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      bubble.appendChild(paragraph);
      wrap.appendChild(bubble);
      message.append(avatar, wrap);
      host.appendChild(message);
    };
    append('user', 'Make me a calm plan for my Calc quiz and APUSH reading tomorrow.');
    append('assistant', 'Start with one focused Calc block now: review series convergence, then solve three mixed problems. After a short break, outline the APUSH reading. I kept the plan to two clear steps so you can begin without overthinking.');
    const title = document.getElementById('asstTopbarTitle');
    if (title) title.textContent = 'Plan for tomorrow';
    const body = document.getElementById('asstBody');
    if (body) body.scrollTop = body.scrollHeight;
  });
}

async function boot(p) {
  await p.goto(`${BASE}/Sutra.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#storageOptions', { state: 'attached' });
  await p.evaluate(() => {
    try { window.markStudentOnboardingCompleted && window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) o.style.setProperty('display', 'none', 'important');
    document.body.classList.remove('onboarding-open');
    const intro = document.getElementById('sutraStartupIntro');
    if (intro) intro.remove();
  });
  await p.waitForFunction(() => !!window.flowAssistant && !!window.courseHub);
  await p.evaluate(() => {
    document.querySelectorAll('.feature-toggle-input[data-feature-view]').forEach((t) => { if (!t.checked) t.click(); });
  });
  await p.waitForTimeout(300);
}
async function go(view) { await page.evaluate((v) => { try { window.setActiveView(v); } catch (e) {} }, view); await page.waitForTimeout(650); }
async function theme(t) {
  await page.evaluate((th) => { try { window.applyTheme && window.applyTheme(th); } catch (e) {} document.body.setAttribute('data-theme', th); document.documentElement.setAttribute('data-theme', th); }, t);
  await page.waitForTimeout(400);
}

await boot(page);
const seedRes = await page.evaluate(SEED_SRC);
console.log('Seeded:', JSON.stringify(seedRes));
await page.waitForTimeout(700);
await hideCaptureNotifications(page);
await theme('default');

// Today
await go('today');
await capture('today');

// Timeline — Day view, scrolled to morning so the empty pre-dawn hours are hidden.
await go('timeline');
await page.evaluate(() => {
  const dayBtn = [...document.querySelectorAll('button,.seg-btn,[role="tab"]')].find(b => /^day$/i.test((b.textContent || '').trim()));
  if (dayBtn) dayBtn.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  window.scrollTo(0, 0);
  const sec = document.querySelector('#view-timeline');
  if (sec) sec.scrollTop = 0;
});
await page.waitForTimeout(300);
await capture('timeline-daily');

// Timeline — Week view
await page.evaluate(() => {
  const wk = [...document.querySelectorAll('button,.seg-btn,[role="tab"]')].find(b => /^week$/i.test((b.textContent || '').trim()));
  if (wk) wk.click();
});
await page.waitForTimeout(700);
await capture('timeline-weekly');

// Notes — open a seeded content note
await go('notes');
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.page-item, .sidebar-page, [data-page-id], li, a')].find(el => /Series Cheat Sheet/i.test(el.textContent || ''));
  if (item) item.click();
});
await page.waitForTimeout(700);
await capture('notes-editor');

// Homework
await go('homework');
await capture('homework');

// Testing Hub dashboard
await go('apstudy');
await capture('testing-hub');

// Testing Hub — Review (study sets / flashcards)
await page.evaluate(() => { try { window.switchTestingHubSection && window.switchTestingHubSection('review'); } catch (e) {} });
await page.waitForTimeout(650);
await capture('testing-hub-review');

// Deadline Radar (modal over Today)
await go('today');
await page.evaluate(() => { try { (window.openDeadlineRadar || window.OpenDeadlineRadar) && (window.openDeadlineRadar || window.OpenDeadlineRadar)(); } catch (e) {} });
await page.waitForTimeout(650);
await capture('deadline-radar');
await page.evaluate(() => { try { window.closeDeadlineRadar && window.closeDeadlineRadar(); } catch (e) {} const o = document.querySelector('.deadline-radar-overlay, #deadlineRadarOverlay'); if (o) o.remove(); });

// Settings — appearance + themes (customization)
await go('settings');
await page.evaluate(() => { try { window.toggleThemePanel && window.toggleThemePanel(); } catch (e) {} });
await page.waitForTimeout(450);
await capture('themes-customization');

// Sutra Assistant — panel open over Today, AI onboarding skipped to reveal pulse
await go('today');
await page.evaluate(() => { const b = document.getElementById('chatbotBtn'); if (b) b.click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { const s = document.querySelector('[data-flow-skip-ai]'); if (s) s.click(); });
await page.waitForTimeout(700);
await stageDockedConversation();
await capture('assistant');
await page.evaluate(() => {
  const panel = document.getElementById('chatbotPanel');
  if (panel) {
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
  }
  try { window.setActiveView('assistantview'); } catch (e) {}
});
await page.waitForTimeout(700);
await stageFullAssistantConversation();
await page.waitForTimeout(250);
await capture('assistant-full');
await page.close();

// Mobile — Today (responsive preview)
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
mobile.on('pageerror', (e) => errors.push('MOBILE PAGEERROR: ' + e.message));
await mobile.goto(`${BASE}/Sutra.html`, { waitUntil: 'domcontentloaded' });
await mobile.waitForSelector('#storageOptions', { state: 'attached' });
await mobile.evaluate(() => {
  try { window.markStudentOnboardingCompleted && window.markStudentOnboardingCompleted(true); } catch (e) {}
  const o = document.getElementById('studentOnboardingOverlay'); if (o) o.style.setProperty('display', 'none', 'important');
  document.body.classList.remove('onboarding-open');
  const intro = document.getElementById('sutraStartupIntro'); if (intro) intro.remove();
});
await mobile.waitForFunction(() => !!window.flowAssistant && !!window.courseHub);
await mobile.evaluate(SEED_SRC);
await mobile.waitForTimeout(800);
await hideCaptureNotifications(mobile);
await mobile.evaluate(() => { document.body.setAttribute('data-theme', 'default'); document.documentElement.setAttribute('data-theme', 'default'); try { window.setActiveView('today'); } catch (e) {} });
await mobile.waitForTimeout(700);
{
  const buf = await mobile.screenshot({ fullPage: false });
  await downscaleAndSave(buf, `${SS}/mobile-today.png`);
}
await mobile.close();

await browser.close();
console.log(`\nWrote ${written.length} optimized assets:`);
written.forEach((w) => console.log('  - ' + w));
console.log(`\nConsole errors (${errors.length}):`);
[...new Set(errors)].slice(0, 30).forEach((e) => console.log('  - ' + e));
