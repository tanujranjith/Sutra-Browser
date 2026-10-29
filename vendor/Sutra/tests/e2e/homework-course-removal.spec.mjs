import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openHomework(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const onboarding = document.getElementById('studentOnboardingOverlay');
    if (onboarding) {
      onboarding.hidden = true;
      onboarding.classList.remove('active');
      onboarding.style.setProperty('display', 'none', 'important');
    }
    document.body.classList.remove('onboarding-open');
  });
  await page.waitForFunction(() => !!window.SutraHomework && !!window.SutraHomeworkStore && typeof window.setActiveView === 'function');
  await page.evaluate(() => {
    window.setActiveView('homework');
    const setup = document.getElementById('hwSetupOverlay');
    if (setup) {
      setup.hidden = true;
      setup.classList.remove('active');
      setup.style.setProperty('display', 'none', 'important');
    }
    const store = window.SutraHomeworkStore;
    const current = store.getSnapshot();
    store.replace({
      ...current,
      courses: current.courses.concat([
        { id: 'remove-class', name: 'Remove Biology', type: 'class' },
        { id: 'remove-activity', name: 'Remove Robotics', type: 'misc' },
        { id: 'remove-empty-class', name: 'Remove Empty Chemistry', type: 'class' }
      ]),
      tasks: current.tasks.concat([
        { id: 'remove-class-task', courseId: 'remove-class', title: 'Biology assignment' },
        { id: 'remove-activity-task', courseId: 'remove-activity', title: 'Robotics assignment' }
      ])
    }, { reason: 'homework-course-removal-test-seed' });
    window.SutraHomework.render();
  });
}

async function acceptRemoval(page, selector) {
  await page.locator(selector).click();
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();
}

test('Homework exposes removal for classes and extracurriculars with recoverable assignments', async ({ page }) => {
  await openHomework(page);

  await page.locator('[data-homework-tab="class"]').click();
  await expect(page.locator('[data-course-delete="remove-class"]').first()).toBeVisible();
  await acceptRemoval(page, '[data-course-delete="remove-class"]');
  await expect.poll(() => page.evaluate(() => window.SutraHomeworkStore.getSnapshot().courses.some((course) => course.id === 'remove-class'))).toBe(false);

  await expect(page.locator('.hw-activity-row [data-course-delete="remove-activity"]')).toBeVisible();
  await acceptRemoval(page, '.hw-activity-row [data-course-delete="remove-activity"]');
  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.SutraHomeworkStore.getSnapshot();
    return {
      activityRemoved: !snapshot.courses.some((course) => course.id === 'remove-activity'),
      classAssignmentRemoved: !snapshot.tasks.some((task) => task.id === 'remove-class-task'),
      activityAssignmentRemoved: !snapshot.tasks.some((task) => task.id === 'remove-activity-task')
    };
  })).toEqual({ activityRemoved: true, classAssignmentRemoved: true, activityAssignmentRemoved: true });

  const trashTitles = await page.evaluate(() => window.__sutraPublicBetaTestHooks.getTrash()
    .filter((item) => item.kind === 'homework')
    .map((item) => item.title));
  expect(trashTitles).toEqual(expect.arrayContaining(['Biology assignment', 'Robotics assignment']));
});

test('an empty class can be removed from the class empty state', async ({ page }) => {
  await openHomework(page);
  await page.evaluate(() => {
    const store = window.SutraHomeworkStore;
    const current = store.getSnapshot();
    store.replace({ ...current, tasks: [] }, { reason: 'homework-empty-class-removal-test-seed' });
    window.SutraHomework.render();
  });

  await page.locator('[data-homework-tab="class"]').click();
  await expect(page.locator('[data-course-delete="remove-empty-class"]')).toBeVisible();
  await acceptRemoval(page, '[data-course-delete="remove-empty-class"]');
  await expect.poll(() => page.evaluate(() => window.SutraHomeworkStore.getSnapshot().courses.some((course) => course.id === 'remove-empty-class'))).toBe(false);
});

test('the class dashboard modal exposes the same removal action for both types', async ({ page }) => {
  await openHomework(page);

  await page.evaluate(() => window.openClassDashboardDrawer('remove-class'));
  await expect(page.locator('#classDashboardDrawer')).toHaveClass(/active/);
  await expect(page.locator('#classDashDeleteBtn')).toHaveText('Remove class');
  await expect(page.locator('.class-dash-actions .neumo-btn')).toHaveCount(3);
  await page.locator('#classDashDeleteBtn').click();
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();
  await expect(page.locator('#classDashboardDrawer')).not.toHaveClass(/active/);

  await page.evaluate(() => window.openClassDashboardDrawer('remove-activity'));
  await expect(page.locator('#classDashDeleteBtn')).toHaveText('Remove activity');
  await page.locator('#classDashDeleteBtn').click();
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();
  await expect(page.locator('#classDashboardDrawer')).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.SutraHomeworkStore.getSnapshot().courses
    .filter((course) => course.id === 'remove-class' || course.id === 'remove-activity'))).toHaveLength(0);
});

test('the dashboard removal action remains usable in the phone bottom sheet', async ({ page }) => {
  await openHomework(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.openClassDashboardDrawer('remove-class'));

  const footer = page.locator('.class-dash-actions');
  await expect(footer).toBeVisible();
  await expect(footer.locator('.neumo-btn')).toHaveCount(3);
  await expect(page.locator('#classDashDeleteBtn')).toHaveText('Remove class');
  await expect.poll(() => page.evaluate(() => {
    const element = document.querySelector('.class-dash-actions');
    const buttons = Array.from(element ? element.querySelectorAll('.neumo-btn') : []);
    const footerBox = element && element.getBoundingClientRect();
    return {
      footerFitsViewport: !!footerBox && footerBox.right <= window.innerWidth,
      buttonsFitViewport: buttons.every((button) => button.getBoundingClientRect().right <= window.innerWidth)
    };
  })).toEqual({ footerFitsViewport: true, buttonsFitViewport: true });
});
