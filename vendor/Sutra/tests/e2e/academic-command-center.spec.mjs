import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  // The academic globals arrive before canonical workspace hydration. Settle
  // that boundary before hiding onboarding or seeding the command center.
  await waitForAppReady(page);
  await page.evaluate(() => {
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!window.courseHub && !!window.SutraAcademicCommandCenter && !!window.SutraAcademicState);
}

async function enableCourseHub(page) {
  await page.evaluate(() => {
    window.setActiveView('settings');
    const control = document.querySelector('[data-pref-path="layout.courseHubEnabled"]');
    if (!control) throw new Error('Course Hub preference control is unavailable');
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('settingsApplyBtn')?.click();
  });
}

test('academic command center ranks overdue grade-risk work and renders course context', async ({ page }) => {
  await openApp(page);
  await enableCourseHub(page);
  const result = await page.evaluate(() => {
    const course = window.courseHub.createCourse({ name: 'QA Chemistry', currentGrade: '68%', targetGrade: '85%', color: '#5277e8' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const tasks = [{ id: 'acc-overdue-1', courseId: course.id, title: 'Lab conclusion', text: 'Lab conclusion', done: false, dueDate, due: dueDate, priority: 'high', difficulty: 'hard' }];
    // Append into the canonical store (createCourse already persisted the course
    // there); a raw hwTasks:v2 write would be invisible to the command center.
    window.SutraHomeworkStore.transact((draft) => { draft.tasks = (draft.tasks || []).concat(tasks); }, { reason: 'test-seed' });
    window.dispatchEvent(new CustomEvent('homework:updated'));
    window.setActiveView('courses');
    window.renderCourseHubView();
    const model = window.SutraAcademicCommandCenter.buildModel(window.SutraAcademicCommandCenter.readSnapshot());
    return {
      topTitle: model.topAction && model.topAction.title,
      topReason: model.topAction && model.topAction.reason,
      atRisk: model.totals.atRisk,
      cards: document.querySelectorAll('.acc-course-card').length,
      heading: document.getElementById('academicCommandCenterTitle')?.textContent
    };
  });

  expect(result.topTitle).toBe('Lab conclusion');
  expect(result.topReason).toContain('overdue');
  expect(result.atRisk).toBeGreaterThanOrEqual(1);
  expect(result.cards).toBeGreaterThanOrEqual(1);
  expect(result.heading).toBe('What should I do now?');
});

test('academic command center remains usable at a phone width and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await enableCourseHub(page);
  await page.evaluate(() => {
    let course = window.courseHub.getCourses({ filter: 'active' })[0];
    if (!course) course = window.courseHub.createCourse({ name: 'Mobile Biology', currentGrade: '91%' });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    window.SutraHomeworkStore.transact((draft) => { draft.tasks = (draft.tasks || []).concat([{ id: 'mobile-acc-task', courseId: course.id, title: 'Biology review', done: false, dueDate, priority: 'high', difficulty: 'medium' }]); }, { reason: 'test-seed' });
    window.setActiveView('courses');
    window.renderCourseHubView();
  });
  const center = page.locator('.academic-command-center');
  await expect(center).toBeVisible();
  await expect(center.locator('.acc-course-card').first()).toBeVisible();
  const transition = await center.locator('.acc-course-card').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(['0s', '0.00001s']).toContain(transition);
  const minHeight = await center.locator('.acc-top-action .acc-btn').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(minHeight).toBeGreaterThanOrEqual(40);
  const overflow = await center.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
