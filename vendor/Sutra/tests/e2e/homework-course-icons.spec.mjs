import { expect, test } from '@playwright/test';

async function openHomework(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => window.SutraHomework && window.SutraHomeworkStore && typeof window.setActiveView === 'function');
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.style.setProperty('display', 'none', 'important');
    }
    document.body.classList.remove('onboarding-open');
    window.setActiveView('homework');
    const setup = document.getElementById('hwSetupOverlay');
    if (setup) {
      setup.hidden = true;
      setup.classList.remove('active');
      setup.style.setProperty('display', 'none', 'important');
    }
  });
}

test('an extracurricular icon can be chosen and survives reload', async ({ page }) => {
  // A full Pixel 7 startup plus an IndexedDB-backed reload can legitimately
  // approach the suite-wide 60s default on a busy local runner.
  test.setTimeout(120_000);
  await openHomework(page);
  await page.evaluate(() => {
    const snapshot = window.SutraHomeworkStore.getSnapshot();
    window.SutraHomeworkStore.replace({
      ...snapshot,
      courses: snapshot.courses.concat([{ id: 'icon-robotics', name: 'Robotics', type: 'misc' }])
    }, { reason: 'course-icon-test-seed' });
    window.dispatchEvent(new CustomEvent('homework:updated'));
  });

  const trigger = page.locator('[data-course-icon="icon-robotics"]');
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('i')).toHaveClass(/fa-users/);

  await trigger.click();
  const picker = page.locator('#hwCourseIconModal');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true');
  await picker.locator('[data-course-icon-choice="robot"]').click();

  await expect(trigger.locator('i')).toHaveClass(/fa-robot/);
  await expect.poll(() => page.evaluate(() => {
    return window.SutraHomeworkStore.getSnapshot().courses.find(course => course.id === 'icon-robotics')?.icon;
  })).toBe('robot');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('course-icon-test'));

  await page.reload();
  await openHomework(page);
  await expect(page.locator('[data-course-icon="icon-robotics"] i')).toHaveClass(/fa-robot/);
});

test('the extracurricular panel shows every activity', async ({ page }) => {
  await openHomework(page);
  await page.evaluate(() => {
    const snapshot = window.SutraHomeworkStore.getSnapshot();
    const activities = Array.from({ length: 6 }, (_, index) => ({
      id: `activity-${index + 1}`,
      name: `Activity ${index + 1}`,
      type: 'misc'
    }));
    window.SutraHomeworkStore.replace({
      ...snapshot,
      courses: snapshot.courses.concat(activities)
    }, { reason: 'all-activities-panel-test' });
    window.dispatchEvent(new CustomEvent('homework:updated'));
  });

  await expect(page.locator('.hw-extracurricular-panel .hw-activity-row')).toHaveCount(6);
});
