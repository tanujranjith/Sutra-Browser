import { expect, test } from '@playwright/test';

// Wave E — Background reminders (#4), local-first.
// Periodic Background Sync only runs for an installed PWA on supporting browsers,
// so this asserts the wiring is present and safe rather than driving a real sync.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.SutraNotifications && window.SutraNotifications.registerBackgroundReminders));
}

test('registerBackgroundReminders is exposed and safe to call', async ({ page }) => {
  await openApp(page);
  const ok = await page.evaluate(() => {
    try { window.SutraNotifications.registerBackgroundReminders(); return true; } catch (e) { return false; }
  });
  expect(ok).toBe(true);
});

test('the service worker ships periodicsync + notificationclick handlers (no push server)', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain("addEventListener('periodicsync'");
  expect(sw).toContain('sutra-daily-reminder');
  expect(sw).toContain("addEventListener('notificationclick'");
  expect(sw).toContain('showNotification');
  // Local-first: no push subscription / server.
  expect(sw).not.toContain('pushManager');
});
