import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openHomework(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!window.SutraHomework && typeof window.setActiveView === 'function');
  await page.evaluate(() => {
    window.setActiveView('homework');
    window.SutraHomework.addCourse('Composer layout course');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    window.SutraHomework.createTask({ courseName: 'Composer layout course', title: 'Existing task', dueDate: today, priority: 'high' });
    window.SutraHomework.render();
    const homeworkSetup = document.getElementById('hwSetupOverlay');
    if (homeworkSetup) {
      homeworkSetup.hidden = true;
      homeworkSetup.classList.remove('active');
      homeworkSetup.style.setProperty('display', 'none', 'important');
    }
  });
}

test('Homework uses Quick Capture as the single assignment composer', async ({ page }) => {
  await openHomework(page);

  await page.locator('#hwOpenAddAssignment').click();
  await expect(page.locator('#quickCaptureModal')).toBeVisible();
  await expect(page.locator('#quickCaptureTitle')).toHaveText('Add homework');
  await expect(page.locator('#quickCaptureType')).toHaveValue('homework');
  await expect(page.locator('[data-inline-add]')).toHaveCount(0);
  await expect(page.locator('[data-quick-add-input]')).toHaveCount(0);
  await expect(page.locator('#hwGlobalAddModal')).toBeHidden();

  await page.locator('#quickCaptureInput').fill('Shared composer work');
  await page.locator('#quickCaptureDate').fill('2026-08-30');
  await page.locator('#quickCaptureSubmitBtn').click();
  await expect(page.locator('#quickCaptureModal')).toBeHidden();
  await expect(page.locator('.hw-assignment-row', { hasText: 'Shared composer work' })).toHaveCount(1);

  await page.evaluate(() => window.openQuickCaptureModal(''));
  await expect(page.locator('#quickCaptureTitle')).toHaveText('Quick Capture');
  await expect(page.locator('#quickCaptureSubmitBtn')).toHaveText('Capture');
  await expect(page.locator('#quickCaptureType')).toHaveValue('task');
  await page.locator('#quickCaptureCancelBtn').click();
});

test('Course Hub assignment actions open the same Homework composer', async ({ page }) => {
  await openHomework(page);

  const courseId = await page.evaluate(() => {
    const existing = window.courseHub.getCourses({ filter: 'active' })[0];
    return existing ? existing.id : window.courseHub.createCourse({ name: 'Course Hub composer course', type: 'class' }).id;
  });
  await page.evaluate((id) => {
    window.setActiveView('courses');
    window.cwAddAssignment(id);
  }, courseId);
  await expect(page.locator('#quickCaptureModal')).toBeVisible();
  await expect(page.locator('#quickCaptureTitle')).toHaveText('Add homework');
  await expect(page.locator('#quickCaptureType')).toHaveValue('homework');
  await expect(page.locator('#quickCaptureCourse')).toHaveValue(courseId);
  await expect(page.locator('#cwFormModal')).toHaveCount(0);
  await page.locator('#quickCaptureCancelBtn').click();
});

test('Homework workspace summaries, search, filters, and completion use live task data', async ({ page }) => {
  await openHomework(page);

  await expect(page.locator('#hwStatToday')).toHaveText('1');
  await expect(page.locator('.hw-assignment-row')).toHaveCount(1);

  await page.locator('#hwSearchInput').fill('not in this assignment');
  await expect(page.locator('.hw-filter-empty')).toBeVisible();
  await page.locator('#hwSearchInput').fill('Existing task');
  await expect(page.locator('.hw-assignment-row')).toHaveCount(1);

  await page.locator('#hwFilterToggle').click();
  await page.locator('#hwPriorityFilter').selectOption('low');
  await expect(page.locator('.hw-filter-empty')).toBeVisible();
  await page.locator('#hwPriorityFilter').selectOption('high');
  await expect(page.locator('.hw-assignment-row')).toHaveCount(1);

  await page.locator('.hw-assignment-row [data-task-toggle]').click();
  await expect(page.locator('#hwStatCompleted')).toHaveText('1');
  await page.locator('[data-homework-tab="completed"]').click();
  await expect(page.locator('.hw-assignment-row')).toHaveCount(1);
});

test('marking Homework done on Home immediately updates the Homework board', async ({ page }) => {
  await openHomework(page);

  await page.evaluate(() => window.setActiveView('today'));
  await page.evaluate(() => {
    window.flowAtelier.renderTaskViews();
    const mirror = window.flowAtelier.tasks.find((task) => task.origin === 'homework' && task.title.includes('Existing task'));
    window.toggleComplete(mirror.id);
  });

  await expect.poll(() => page.evaluate(() => window.SutraHomework.getTasks()
    .find((task) => task.title === 'Existing task')?.done)).toBe(true);

  await page.evaluate(() => window.setActiveView('homework'));
  const row = page.locator('.hw-assignment-row', { hasText: 'Existing task' });
  await expect(row).toHaveClass(/is-completed/);
  await expect(row.locator('.hw-work-status')).toContainText('Completed');

  const completedToggle = page.locator('[data-hw-past-toggle]');
  await expect(completedToggle).toContainText('Completed assignments (1)');
  await expect(row).toBeHidden();
  await completedToggle.click();
  await expect(row).toBeVisible();
  await row.locator('[data-task-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.SutraHomework.getTasks()
    .find((task) => task.title === 'Existing task')?.done)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.flowAtelier.tasks
    .find((task) => task.origin === 'homework' && task.title.includes('Existing task'))?.isActive)).toBe(true);
});

test('each Homework assignment immediately has exactly one connected Todo task', async ({ page }) => {
  await openHomework(page);

  const homeworkId = await page.evaluate(() => window.SutraHomework.getTasks()
    .find((task) => task.title === 'Existing task')?.id);

  await expect.poll(() => page.evaluate((sourceId) => window.flowAtelier.tasks
    .filter((task) => task.origin === 'homework' && task.homeworkSourceId === sourceId).length, homeworkId)).toBe(1);
});

test('Homework assignment actions provide a dedicated edit form', async ({ page }) => {
  await openHomework(page);

  await page.evaluate(() => {
    window.SutraHomework.createTask({
      courseName: 'Composer layout course',
      title: 'Timed existing assignment',
      dueDate: '2026-09-16',
      dueTime: '23:59',
      priority: 'low',
      difficulty: 'hard',
      recurrence: 'weekly'
    });
    window.SutraHomework.render();
  });

  // Overdue unfinished work stays in the active list until it is completed.
  const row = page.locator('.hw-assignment-row', { hasText: 'Timed existing assignment' });
  await row.locator('[data-task-menu-trigger]').click();
  await row.getByRole('menuitem', { name: 'Edit assignment' }).click();

  const modal = page.locator('#hwGlobalAddModal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#hwGlobalAddTitle')).toHaveText('Edit Assignment');
  await expect(modal.locator('[data-field="dueDate"]')).toHaveValue('2026-09-16');
  await expect(modal.locator('[data-field="dueTime"]')).toHaveValue('23:59');
  const dateLabel = modal.locator('[data-field="dueDate"]').locator('xpath=..').locator('.nf-date-label');
  const timeLabel = modal.locator('[data-field="dueTime"]').locator('xpath=..').locator('.nf-time-label');
  if (await dateLabel.count()) await expect(dateLabel).toHaveText('09/16/2026');
  else await expect(modal.locator('[data-field="dueDate"]')).toBeVisible();
  if (await timeLabel.count()) await expect(timeLabel).toHaveText('11:59 PM');
  else await expect(modal.locator('[data-field="dueTime"]')).toBeVisible();
  await expect(modal.locator('[data-field="difficulty"]')).toHaveValue('hard');
  await expect(modal.locator('[data-field="recurrence"]')).toHaveValue('weekly');
  await expect(modal.locator('[data-field="priority"]')).toHaveValue('low');
  await modal.locator('[data-field="title"]').fill('Renamed assignment');
  await modal.locator('[data-field="dueDate"]').fill('2026-08-31');
  await modal.locator('button[type="submit"]').click();

  const renamedRow = page.locator('.hw-assignment-row', { hasText: 'Renamed assignment' });
  await expect(renamedRow.locator('.hw-assignment-title-btn')).toHaveText('Renamed assignment');
  await expect(renamedRow.locator('.hw-due-cell')).toContainText('Aug 31');
  await expect.poll(() => page.evaluate(() => {
    const mirrors = window.flowAtelier.tasks.filter((task) => task.origin === 'homework' && task.title.includes('Renamed assignment'));
    return { count: mirrors.length, dueDate: mirrors[0]?.dueDate };
  })).toEqual({ count: 1, dueDate: '2026-08-31' });
});

test('Homework add modal date picker accepts a real pointer selection', async ({ page }) => {
  await openHomework(page);

  await page.locator('#hwOpenAddAssignment').click();
  const modal = page.locator('#quickCaptureModal');
  await expect(modal).toBeVisible();

  const dateInput = modal.locator('#quickCaptureDate');
  await dateInput.locator('xpath=..').locator('.nf-date-trigger').click();

  const panel = page.locator('.nf-date-panel.is-open');
  await expect(panel).toBeVisible();
  const layerOrder = await page.evaluate(() => {
    const panelElement = document.querySelector('.nf-date-panel.is-open');
    const modalElement = document.querySelector('#quickCaptureModal');
    return {
      panel: Number.parseInt(getComputedStyle(panelElement).zIndex, 10),
      modal: Number.parseInt(getComputedStyle(modalElement).zIndex, 10)
    };
  });
  expect(layerOrder.panel).toBeGreaterThan(layerOrder.modal);

  const target = panel.locator('.nf-date-day:not(.is-other):not([disabled])').filter({ hasText: /^15$/ }).first();
  await expect(target).toBeVisible();
  const selectedDate = await target.getAttribute('data-date');
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(dateInput).toHaveValue(selectedDate);
  await expect(panel).toBeHidden();
});

test('Homework add modal time picker accepts real pointer spinner changes', async ({ page }) => {
  await openHomework(page);

  await page.locator('#hwOpenAddAssignment').click();
  const modal = page.locator('#quickCaptureModal');
  await expect(modal).toBeVisible();

  const timeInput = modal.locator('#quickCaptureTime');
  await timeInput.locator('xpath=..').locator('.nf-time-trigger').click();

  const panel = page.locator('.nf-time-panel.is-open');
  await expect(panel).toBeVisible();
  const hitState = await page.evaluate(() => {
    const panelElement = document.querySelector('.nf-time-panel.is-open');
    const modalElement = document.querySelector('#quickCaptureModal');
    const button = panelElement?.querySelector('.nf-time-spin-btn');
    const rect = button?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    return {
      panel: Number.parseInt(getComputedStyle(panelElement).zIndex, 10),
      modal: Number.parseInt(getComputedStyle(modalElement).zIndex, 10),
      ariaHidden: panelElement?.getAttribute('aria-hidden'),
      inert: panelElement?.inert === true || panelElement?.hasAttribute('inert'),
      hitIsButton: !!button && (hit === button || button.contains(hit))
    };
  });
  expect(hitState.panel).toBeGreaterThan(hitState.modal);
  expect(hitState.ariaHidden).not.toBe('true');
  expect(hitState.inert).toBe(false);
  expect(hitState.hitIsButton).toBe(true);

  const hour = panel.locator('.nf-time-spinner').nth(0);
  const minute = panel.locator('.nf-time-spinner').nth(1);
  const hourBefore = await hour.locator('.nf-time-num').innerText();
  const minuteBefore = await minute.locator('.nf-time-num').innerText();

  for (const button of [hour.locator('.nf-time-spin-btn').first(), minute.locator('.nf-time-spin-btn').last()]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  await expect(hour.locator('.nf-time-num')).not.toHaveText(hourBefore);
  await expect(minute.locator('.nf-time-num')).not.toHaveText(minuteBefore);
  await expect(timeInput).toHaveValue(/^\d{2}:\d{2}$/);
});
