// Manual-QA screenshot capture for the Sutra Assistant upgrade.
// Usage: node scripts/serve-static.mjs 5173  (in another shell), then
//        node scripts/qa-assistant-screens.mjs
// Saves screenshots to .tmp/assistant-qa-screens/.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.env.SUTRA_BASE_URL || 'http://127.0.0.1:5173';
const OUT = '.tmp/assistant-qa-screens';
mkdirSync(OUT, { recursive: true });

const shots = [];
async function shotPanel(page, name) {
  const panel = page.locator('#chatbotPanel');
  await panel.screenshot({ path: `${OUT}/${name}.png` });
  shots.push(name);
}
async function shotPage(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  shots.push(name);
}

async function boot(page) {
  await page.goto(`${BASE}/Sutra.html`);
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.style.setProperty('display', 'none', 'important'); }
    document.body.classList.remove('onboarding-open');
    const intro = document.getElementById('sutraStartupIntro');
    if (intro) intro.remove();
  });
  await page.waitForFunction(() => !!window.flowAssistant && !!window.SutraAssistantActions);
}

function isoDays(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function send(page, text, settle = 2600) {
  await page.evaluate((t) => {
    const input = document.getElementById('chatInput');
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.sendChat();
  }, text);
  await page.waitForTimeout(settle);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await boot(page);

// 01 — empty state with key onboarding (no provider configured).
await page.evaluate(() => document.getElementById('chatbotBtn').click());
await page.waitForTimeout(400);
await shotPanel(page, '01-empty-state-key-onboarding');

// 02 — context card + quick-action grid after "Continue without AI".
await page.evaluate(() => document.querySelector('[data-flow-skip-ai]').click());
await page.waitForTimeout(300);
await shotPanel(page, '02-working-from-and-quick-grid');

// Seed real workspace data (overdue tasks across BOTH stores + grades).
await page.evaluate(({ p11, p12, p7 }) => {
  const fa = window.flowAssistant;
  fa.applyAction({ type: 'create_task', title: 'Drill weakest unit first', dueDate: p11, priority: 'high', difficulty: 'hard' });
  fa.applyAction({ type: 'create_task', title: 'Build a one-week review plan', dueDate: p12, priority: 'high' });
  fa.applyAction({ type: 'create_task', title: 'Run final-day checklist', dueDate: p7, priority: 'medium' });
  fa.applyAction({ type: 'create_homework', title: 'Weekly reflection review', courseName: 'Study Skills', dueDate: p11 });
  const hub = window.courseHub;
  const gp = window.SutraGradePlanner;
  const course = hub.createCourse({ name: 'Chemistry', type: 'class' });
  gp.setCategoriesForCourse(course.id, [
    { id: 'cat_hw', name: 'Homework', weight: 30 },
    { id: 'cat_test', name: 'Tests', weight: 70 }
  ]);
  gp.addEntryForCourse(course.id, { categoryId: 'cat_hw', title: 'Worksheet 1', score: 9, maxScore: 10, status: 'graded' });
  gp.addEntryForCourse(course.id, { categoryId: 'cat_test', title: 'Test 1', score: 78, maxScore: 100, status: 'graded' });
  gp.addEntryForCourse(course.id, { categoryId: 'cat_hw', title: 'Missing lab report', score: null, maxScore: 50, status: 'missing' });
  window.flowAssistant.refresh();
}, { p11: isoDays(-11), p12: isoDays(-12), p7: isoDays(-7) });
await page.waitForTimeout(400);

// 03 — Workspace Pulse with real signals.
await shotPanel(page, '03-workspace-pulse-real-signals');

// 04 — conversation: deterministic overdue listing.
await send(page, "what's overdue?");
await shotPanel(page, '04-overdue-conversation');

// 05 — task-completion batch proposal with readable preview.
await send(page, 'mark those as complete');
await shotPanel(page, '05-task-completion-proposal');

// 06 — applied completion confirmation.
await page.evaluate(() => {
  const card = document.querySelectorAll('#chatbotMessages .flow-action-card[data-action-type="update_task_status"]');
  card[card.length - 1].querySelector('.flow-action-apply').click();
});
await page.waitForTimeout(600);
await shotPanel(page, '06-task-completion-applied');

// 07 — Activity log with Undo.
await page.evaluate(() => window.flowAssistant.openActivityLog());
await page.waitForTimeout(300);
await shotPage(page, '07-activity-and-undo');
await page.evaluate(() => { const o = document.getElementById('flowActivityOverlay'); if (o) o.remove(); });

// undo so later shots have open work again
await send(page, 'undo that', 2200);

// 08 — context editor with readable summary + planning prefs.
await page.evaluate(() => window.flowAssistant.showContextModal());
await page.waitForTimeout(300);
await shotPage(page, '08-context-editor');
await page.evaluate(() => { const o = document.getElementById('flowContextOverlay'); if (o) o.remove(); });

// 09 — daily briefing (deterministic local).
await send(page, 'what should I do today', 3000);
await shotPanel(page, '09-daily-briefing');

// 10 — grade what-if (deterministic local math).
await send(page, 'what happens if I score 85 on the next test in Chemistry?', 3000);
await shotPanel(page, '10-grade-what-if');

// 11 — reschedule preview (timeline-affecting proposal).
await send(page, 'move my overdue work to tomorrow', 2600);
await shotPanel(page, '11-reschedule-preview');

// 12 — recovery plan preview.
await send(page, 'make a recovery plan', 3000);
await shotPanel(page, '12-recovery-plan');

// 13 — attachments: compatible text file + blocked archive.
const txtPath = join(tmpdir(), 'qa-notes.txt');
writeFileSync(txtPath, 'Photosynthesis converts light energy into chemical energy.');
const zipPath = join(tmpdir(), 'qa-archive.zip');
writeFileSync(zipPath, 'PK\u0003\u0004fakezip');
await page.setInputFiles('#flowAttachInput', [txtPath, zipPath]);
await page.waitForTimeout(700);
await shotPanel(page, '13-attachment-chips-compat-and-blocked');
await page.evaluate(() => window.flowAssistant.clearAttachments());

// 14 — Assistant guide.
await page.evaluate(() => document.getElementById('chatGuideBtn').click());
await page.waitForTimeout(400);
await shotPage(page, '14-assistant-guide');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 15 — overflow menu.
await page.evaluate(() => document.getElementById('chatOverflowBtn').click());
await page.waitForTimeout(200);
await shotPanel(page, '15-overflow-menu');
await page.evaluate(() => document.body.click());

// 16 — study material generator (from current note source picker).
await page.evaluate(() => {
  try { window.SutraStudyMaterials.openSourcePicker(); } catch (e) { /* may need sources */ }
});
await page.waitForTimeout(500);
await shotPage(page, '16-study-material-generator');
await page.keyboard.press('Escape');

// 17 — dark theme.
await page.evaluate(() => {
  document.body.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(300);
await shotPanel(page, '17-dark-theme-panel');
await page.evaluate(() => {
  document.body.setAttribute('data-theme', 'default');
  document.documentElement.setAttribute('data-theme', 'default');
});

// 18 — mobile layout (fresh viewport).
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await boot(page);
await page.evaluate(() => document.getElementById('chatbotBtn').click());
await page.waitForTimeout(500);
await shotPage(page, '18-mobile-layout');

await browser.close();
console.log(`Captured ${shots.length} screenshots into ${OUT}/:`);
shots.forEach((s) => console.log('  - ' + s + '.png'));
