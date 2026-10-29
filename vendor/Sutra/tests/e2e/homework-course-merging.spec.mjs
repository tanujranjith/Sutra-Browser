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
    window.setActiveView('homework');
    const setup = document.getElementById('hwSetupOverlay');
    if (setup) {
      setup.hidden = true;
      setup.classList.remove('active');
      setup.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!window.SutraHomework && !!window.SutraHomeworkStore);
}

test('class actions can merge two classes and preserve every assignment', async ({ page }) => {
  await openHomework(page);
  await page.evaluate(() => {
    const store = window.SutraHomeworkStore;
    const current = store.getSnapshot();
    const ids = new Set(['merge-physics', 'merge-lab', 'merge-history', 'merge-physics-task', 'merge-lab-task']);
    store.replace({
      ...current,
      courses: current.courses.filter(course => !ids.has(String(course.id))).concat([
        { id: 'merge-physics', name: 'Physics', type: 'class' },
        { id: 'merge-lab', name: 'Physics Lab', type: 'class' },
        { id: 'merge-history', name: 'History', type: 'class' }
      ]),
      tasks: current.tasks.filter(task => !ids.has(String(task.id))).concat([
        { id: 'merge-physics-task', courseId: 'merge-physics', title: 'Kinematics worksheet', dueDate: '2026-09-20' },
        { id: 'merge-lab-task', courseId: 'merge-lab', title: 'Lab report', dueDate: '2026-09-21' }
      ])
    }, { reason: 'homework-class-merge-test-seed' });
    window.SutraHomework.render();
  });

  await page.locator('[data-homework-tab="class"]').click();
  const menuTrigger = page.locator('[data-course-menu-trigger="merge-physics"]');
  await expect(menuTrigger).toBeVisible();
  await menuTrigger.click();
  await expect(page.locator('[data-course-menu="merge-physics"]')).toBeVisible();

  await page.locator('[data-course-merge="merge-physics"]').click();
  const mergeModal = page.locator('#hwCourseMergeModal');
  await expect(mergeModal).toBeVisible();
  await expect(mergeModal.locator('[data-course-merge-target] option')).toHaveCount(2);
  await mergeModal.locator('[data-course-merge-target]').selectOption('merge-lab');
  await mergeModal.locator('[data-course-merge-name]').fill('Physics & Lab');
  await mergeModal.locator('[data-course-merge-submit]').click();

  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();

  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.SutraHomeworkStore.getSnapshot();
    return {
      courses: snapshot.courses.filter(course => /^merge-/.test(String(course.id))).map(course => ({ id: course.id, name: course.name })),
      tasks: snapshot.tasks.filter(task => /^merge-/.test(String(task.id))).map(task => ({ id: task.id, courseId: task.courseId }))
    };
  })).toEqual({
    courses: [
      { id: 'merge-lab', name: 'Physics & Lab' },
      { id: 'merge-history', name: 'History' }
    ],
    tasks: [
      { id: 'merge-physics-task', courseId: 'merge-lab' },
      { id: 'merge-lab-task', courseId: 'merge-lab' }
    ]
  });
  await expect(mergeModal).toBeHidden();
  await expect(page.locator('[data-course-menu-trigger="merge-lab"]')).toBeVisible();
  await expect(page.locator('[data-course-menu-trigger="merge-physics"]')).toHaveCount(0);
});
