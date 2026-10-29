// Settings Theme Panel + ghost-panel + modal-contrast fixes (Section 8).
import { expect, test } from '@playwright/test';

async function completeOnboarding(page) {
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
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

function alphaOf(rgb) {
  const m = String(rgb).match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(',').map(s => parseFloat(s));
  return p.length >= 4 ? p[3] : 1;
}

test('Settings "Open Theme Panel" opens the panel and it stays open (no immediate close)', async ({ page }) => {
  await openApp(page);
  // Click the real Settings trigger (it carries event.stopPropagation()).
  const stayedOpen = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Open Theme Panel/i.test(b.textContent || ''));
    if (!btn) return 'no-button';
    btn.click();
    return document.getElementById('themePanel').classList.contains('active');
  });
  expect(stayedOpen).toBe(true);

  // Clicking outside still closes it (outside-click behavior preserved).
  await page.evaluate(() => document.body.click());
  expect(await page.evaluate(() => document.getElementById('themePanel').classList.contains('active'))).toBe(false);
});

test('the Theme Panel is dismissed on view navigation (no ghost overlay over Settings)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => document.getElementById('themePanel').classList.add('active'));
  // Navigate to another primary view.
  await page.evaluate(() => {
    const t = document.querySelector('.view-tab[data-view="today"]') || document.querySelector('.view-tab[data-view="notes"]');
    if (t) t.click();
  });
  await expect.poll(() => page.evaluate(() => document.getElementById('themePanel').classList.contains('active'))).toBe(false);
});

test('the Theme Panel surface is a solid (non-ghost) theme surface when active', async ({ page }) => {
  await openApp(page);
  const bg = await page.evaluate(() => {
    const p = document.getElementById('themePanel');
    p.classList.add('active');
    return getComputedStyle(p).backgroundColor;
  });
  // Old value was rgba(...,0.03) — a faint ghost. The fix uses a near-opaque
  // theme surface (--bg-elevated). Require a substantial alpha.
  expect(alphaOf(bg)).toBeGreaterThan(0.85);
});

test('the remote-AI consent modal primary button has readable contrast on a pale accent', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    try { localStorage.removeItem('sutra_ai_send_ack_v1'); } catch (e) {}
    window.ensureAiSendDisclosure({ providerLabel: 'Test Provider', model: 'test-model' });
  });
  await expect(page.locator('.sutra-modal-overlay')).toBeVisible();
  const color = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sutra-modal-overlay button')];
    const primary = btns.find(b => /Send/i.test(b.textContent || ''));
    return primary ? getComputedStyle(primary).color : null;
  });
  // Default theme accent is pale tan (#d8c4a1): the readable-text helper must pick
  // dark text (#15110b = rgb(21,17,11)), NOT the previously hard-coded white.
  expect(color).toBe('rgb(21, 17, 11)');
});
