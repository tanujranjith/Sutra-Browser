import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Reminder-rules layer (notifications.js, shipped 2026-07-07):
//   1. Default thresholds notify; a tighter per-course rule suppresses.
//   2. Exact-category rule beats an any-category rule for the same course.
//   3. Mute suppresses the course's reminders entirely (incl. overdue).
//   4. Settings UI: timing input parses "5d, 12h, 0"; garbage reverts.
//   5. Rules survive exportState -> importState; garbage rules sanitized.

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
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  // The notification/Homework globals exist before canonical hydration.
  // Settle startup before onboarding or fixture writes can be replaced by it.
  await waitForAppReady(page);
  await completeOnboarding(page);
  await page.waitForFunction(() =>
    !!window.SutraNotifications && !!window.SutraHomework &&
    typeof window.SutraNotifications.getPreferences === 'function');
}

// Seed one course + one open homework task due `hoursAhead` from now, and
// return { courseId }. Uses the same stores the app reads.
async function seedHomework(page, hoursAhead) {
  return await page.evaluate((hrs) => {
    const course = window.SutraHomework.addCourse('Rules Spec Chem');
    const courseId = course && course.id
      ? course.id
      : (window.SutraHomework.getCourses().find(c => c.name === 'Rules Spec Chem') || {}).id;
    const due = new Date(Date.now() + hrs * 3600000);
    const iso = due.getFullYear() + '-' +
      String(due.getMonth() + 1).padStart(2, '0') + '-' +
      String(due.getDate()).padStart(2, '0');
    // Seed the homework into the canonical store (the source the notification/reminder
    // system reads), not the legacy hwTasks:v2 localStorage key.
    window.SutraHomeworkStore.transact((draft) => {
      draft.tasks = (draft.tasks || []).concat([{
        id: 'rulespec_1', courseId, title: 'Rules Spec Lab', dueDate: iso,
        dueTime: '', done: false, createdAt: Date.now()
      }]);
    }, { reason: 'test-seed' });
    return { courseId };
  }, hoursAhead);
}

function countSpecNotifs(page) {
  return page.evaluate(() => {
    window.SutraNotifications.refresh();
    return window.SutraNotifications.getNotifications()
      .filter(n => n.sourceKey && String(n.sourceKey).includes('rulespec_1')).length;
  });
}

test('per-course rules override thresholds and mute wins', async ({ page }) => {
  await openApp(page);
  const { courseId } = await seedHomework(page, 72); // due in ~3 days

  // Default homework thresholds (168h first) -> notifies.
  await page.evaluate(() => window.SutraNotifications.updatePreferences({ rules: [] }));
  expect(await countSpecNotifs(page)).toBe(1);

  // 24h any-category rule for the course -> 72h-away item is silent.
  await page.evaluate((cid) => window.SutraNotifications.updatePreferences({
    rules: [{ id: 'r1', courseId: cid, source: '', leadHours: [24], mute: false }]
  }), courseId);
  expect(await countSpecNotifs(page)).toBe(0);

  // Exact-category rule (homework, 168h) beats the any-category 24h rule.
  await page.evaluate((cid) => window.SutraNotifications.updatePreferences({
    rules: [
      { id: 'r1', courseId: cid, source: '', leadHours: [24], mute: false },
      { id: 'r2', courseId: cid, source: 'homework', leadHours: [168], mute: false }
    ]
  }), courseId);
  expect(await countSpecNotifs(page)).toBe(1);

  // Mute silences the course regardless of lead times.
  await page.evaluate((cid) => window.SutraNotifications.updatePreferences({
    rules: [{ id: 'r3', courseId: cid, source: 'homework', leadHours: [], mute: true }]
  }), courseId);
  expect(await countSpecNotifs(page)).toBe(0);

  // Removing rules restores the default behaviour.
  await page.evaluate(() => window.SutraNotifications.updatePreferences({ rules: [] }));
  expect(await countSpecNotifs(page)).toBe(1);
});

test('settings UI parses timing edits and reverts garbage', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.SutraNotifications.renderSettingsUI());
  await expect(page.locator('#notifThr-homework')).toBeAttached();

  // Valid edit parses to hours, most-specific first.
  await page.evaluate(() => {
    const el = document.getElementById('notifThr-tasks');
    el.value = '5d, 12h, 0';
    el.dispatchEvent(new Event('change'));
  });
  const tasksThr = await page.evaluate(() =>
    window.SutraNotifications.getPreferences().thresholds.tasks);
  expect(tasksThr).toEqual([120, 12, 0]);

  // Garbage reverts the input and leaves prefs untouched.
  await page.evaluate(() => {
    const el = document.getElementById('notifThr-homework');
    el.value = 'banana';
    el.dispatchEvent(new Event('change'));
  });
  const hwThr = await page.evaluate(() =>
    window.SutraNotifications.getPreferences().thresholds.homework);
  expect(hwThr).toEqual([168, 72, 24, 0]);
  await expect(page.locator('#notifThr-homework')).toHaveValue('7d, 3d, 1d, 0');

  // Reset restores defaults.
  await page.evaluate(() => document.getElementById('notifThrResetBtn').click());
  const tasksAfterReset = await page.evaluate(() =>
    window.SutraNotifications.getPreferences().thresholds.tasks);
  expect(tasksAfterReset).toEqual([168, 72, 24, 0]);
});

test('rules round-trip through exportState/importState and sanitize garbage', async ({ page }) => {
  await openApp(page);
  const { courseId } = await seedHomework(page, 72);

  const result = await page.evaluate((cid) => {
    const N = window.SutraNotifications;
    N.updatePreferences({
      rules: [{ id: 'keep', courseId: cid, source: 'homework', leadHours: [48, 4], mute: false }]
    });
    const exported = JSON.parse(JSON.stringify(N.exportState()));
    // Wipe, then import the export back.
    N.updatePreferences({ rules: [] });
    N.importState(exported);
    const roundTripped = N.getPreferences().rules;

    // Garbage import: missing courseId, unknown source, no-op rule, bad hours.
    exported.prefs.rules = [
      { id: 'a', courseId: '', leadHours: [24] },              // no course -> dropped
      { id: 'b', courseId: cid, source: 'nonsense', leadHours: [-5, 24, 24, 999999] },
      { id: 'c', courseId: cid, leadHours: [], mute: false },  // does nothing -> dropped
      'not-an-object'
    ];
    N.importState(exported);
    const sanitized = N.getPreferences().rules;
    return { roundTripped, sanitized };
  }, courseId);

  expect(result.roundTripped).toEqual([
    { id: 'keep', courseId, source: 'homework', leadHours: [48, 4], mute: false }
  ]);
  expect(result.sanitized).toHaveLength(1);
  expect(result.sanitized[0].id).toBe('b');
  expect(result.sanitized[0].source).toBe(''); // unknown source coerced to any
  expect(result.sanitized[0].leadHours).toEqual([2160, 24]); // clamped + deduped, desc
});
