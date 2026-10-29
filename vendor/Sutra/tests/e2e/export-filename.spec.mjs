import { expect, test } from '@playwright/test';

// Regression coverage for the .sutra export-filename timestamp bug.
//
// The visible download filename used to be derived from
// `new Date().toISOString().split('T')[0]` — a UTC, date-only string. For any
// timezone behind UTC an evening export rolled forward to the next calendar
// day (e.g. 9:18 PM on June 5 became "...2026-06-06.sutra"), and the lack of a
// time component made same-day exports collide so the OS appended " (1)".
//
// The whole file runs in America/New_York (UTC-4 in June) so we can prove the
// non-rollover deterministically: a 9:18 PM June 5 instant is already June 6 in
// UTC, yet the local-time filename must still read June 5.
const PASS = 'correct horse battery staple';

test.use({ timezoneId: 'America/New_York' });

const TS_RE = /^sutra_workspace_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sutra$/;
const EMERGENCY_TS_RE = /^sutra_emergency_workspace_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sutra$/;

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (error) {}
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

test('local evening export does not roll forward to the next UTC calendar date', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const build = window.__sutraPublicBetaTestHooks.buildWorkspaceExportFilename;
    // 9:18:42 PM on June 5, 2026 in America/New_York === 2026-06-06T01:18:42Z.
    const localEvening = new Date(2026, 5, 5, 21, 18, 42);
    return {
      filename: build('sutra_workspace', localEvening),
      // Proves the timezone offset is actually in effect for this run: the old
      // UTC-derived approach would have produced the (wrong) next day.
      utcDatePart: localEvening.toISOString().slice(0, 10)
    };
  });

  expect(result.utcDatePart).toBe('2026-06-06');
  expect(result.filename).toBe('sutra_workspace_2026-06-05_21-18-42.sutra');
  expect(result.filename).not.toContain('2026-06-06');
});

test('every numeric field is zero-padded to a fixed width', async ({ page }) => {
  await openApp(page);
  const filename = await page.evaluate(() =>
    window.__sutraPublicBetaTestHooks.buildWorkspaceExportFilename(
      'sutra_workspace',
      new Date(2026, 0, 3, 4, 5, 9)
    )
  );
  expect(filename).toBe('sutra_workspace_2026-01-03_04-05-09.sutra');
});

test('two exports on the same day get distinct, collision-resistant filenames', async ({ page }) => {
  await openApp(page);
  const names = await page.evaluate(() => {
    const build = window.__sutraPublicBetaTestHooks.buildWorkspaceExportFilename;
    return {
      first: build('sutra_workspace', new Date(2026, 5, 5, 21, 18, 42)),
      second: build('sutra_workspace', new Date(2026, 5, 5, 21, 18, 43))
    };
  });
  expect(names.first).toBe('sutra_workspace_2026-06-05_21-18-42.sutra');
  expect(names.second).toBe('sutra_workspace_2026-06-05_21-18-43.sutra');
  expect(names.first).not.toBe(names.second);
});

test('the filename contains no characters that are illegal on Windows', async ({ page }) => {
  await openApp(page);
  const filename = await page.evaluate(() =>
    window.__sutraPublicBetaTestHooks.buildWorkspaceExportFilename(
      'sutra_workspace',
      new Date(2026, 11, 31, 23, 59, 59)
    )
  );
  // No colons (used by toISOString time) or any other reserved char: < > : " / \ | ? *
  expect(filename).toBe('sutra_workspace_2026-12-31_23-59-59.sutra');
  expect(filename).not.toMatch(/[<>:"/\\|?*]/);
});

test('standard and emergency .sutra exports both use the corrected local-time format', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async ({ pass }) => {
    const standard = await window.SutraEncryptedBackups.createBackupBlob(pass);
    const emergency = await window.SutraEncryptedBackups.createBackupBlob(pass, { emergency: true });
    return { standard: standard.filename, emergency: emergency.filename };
  }, { pass: PASS });

  expect(result.standard).toMatch(TS_RE);
  expect(result.emergency).toMatch(EMERGENCY_TS_RE);
});
