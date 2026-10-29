import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

async function openSeededHomework(page) {
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
    const biology = window.SutraHomework.addCourse('Biology');
    const history = window.SutraHomework.addCourse('World History');
    const completed = window.SutraHomework.createTask({
      courseId: biology.id,
      title: 'Completed past-due essay',
      dueDate: '2020-01-02',
      difficulty: 'hard'
    });
    const completedUndated = window.SutraHomework.createTask({
      courseId: history.id,
      title: 'Completed undated reading',
      difficulty: 'easy'
    });
    window.SutraHomework.createTask({
      courseId: biology.id,
      title: 'Open overdue quiz',
      dueDate: '2020-01-03',
      difficulty: 'medium'
    });
    window.SutraHomework.createTask({
      courseId: history.id,
      title: 'A very long history assignment name that should remain readable in the grouped view',
      dueDate: '2099-01-02',
      difficulty: 'easy'
    });
    window.SutraHomework.createTask({
      title: 'Unassigned reading',
      dueDate: '2099-01-03',
      difficulty: 'easy'
    });
    window.SutraHomework.setDone(completed.id, true);
    window.SutraHomework.setDone(completedUndated.id, true);
    window.SutraHomework.render();
    const homeworkSetup = document.getElementById('hwSetupOverlay');
    if (homeworkSetup) {
      homeworkSetup.hidden = true;
      homeworkSetup.classList.remove('active');
      homeworkSetup.style.setProperty('display', 'none', 'important');
    }
  });
}

test('All Assignments keeps open overdue work visible and groups completed assignments', async ({ page }) => {
  await openSeededHomework(page);
  await page.locator('[data-homework-tab="all"]').click();
  const table = page.locator('.hw-assignment-table:not(.is-by-class)');
  const past = table.locator('#hwPastAssignmentRows');
  const toggle = table.locator('[data-hw-past-toggle]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Completed assignments (2)');
  await expect(past).toBeHidden();
  await expect(table.locator('tbody:not(#hwPastAssignmentRows) .hw-assignment-row')).toHaveCount(3);
  await expect(table.locator('tbody:not(#hwPastAssignmentRows) .hw-assignment-row', { hasText: 'Open overdue quiz' })).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(past.locator('.hw-assignment-row')).toHaveCount(2);
  await expect(past.locator('.hw-assignment-row', { hasText: 'Completed past-due essay' })).toBeVisible();
  await expect(past.locator('.hw-assignment-row', { hasText: 'Completed undated reading' })).toBeVisible();
  await expect(table.locator('tbody:not(#hwPastAssignmentRows) .hw-assignment-row', { hasText: 'Completed undated reading' })).toHaveCount(0);
  await expect(past.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' })).toHaveCount(0);

  const actions = table.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' }).locator('.hw-row-actions');
  const geometry = await actions.evaluate(group => Array.from(group.children).map(child => {
    const button = child.matches('button') ? child : child.querySelector('button');
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height, centerY: rect.top + rect.height / 2 };
  }));
  expect(geometry).toHaveLength(3);
  expect(Math.max(...geometry.map(item => item.centerY)) - Math.min(...geometry.map(item => item.centerY))).toBeLessThanOrEqual(1);
  expect(new Set(geometry.map(item => item.width))).toEqual(new Set([geometry[0].width]));
  expect(new Set(geometry.map(item => item.height))).toEqual(new Set([geometry[0].height]));
  expect(Math.min(...geometry.map(item => Math.min(item.width, item.height)))).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSizes = await actions.evaluate(group => Array.from(group.children).map(child => {
    const button = child.matches('button') ? child : child.querySelector('button');
    const rect = button.getBoundingClientRect();
    return Math.min(rect.width, rect.height);
  }));
  expect(Math.min(...mobileSizes)).toBeGreaterThanOrEqual(44);

  await toggle.click();
  const openOverdue = table.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' });
  await openOverdue.locator('[data-task-toggle]').click();
  await expect(toggle).toContainText('Completed assignments (3)');
  await toggle.click();
  await expect(past.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' })).toBeVisible();
  await expect(table.locator('tbody:not(#hwPastAssignmentRows) .hw-assignment-row', { hasText: 'Open overdue quiz' })).toHaveCount(0);
  await past.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' }).locator('[data-task-toggle]').click();
  await expect(toggle).toContainText('Completed assignments (2)');
  await expect(table.locator('tbody:not(#hwPastAssignmentRows) .hw-assignment-row', { hasText: 'Open overdue quiz' })).toBeVisible();
  await toggle.click();
  await page.locator('#hwSearchInput').fill('overdue quiz');
  await expect(table.locator('.hw-assignment-row', { hasText: 'Open overdue quiz' })).toBeVisible();
  await expect(table.locator('[data-hw-past-toggle]')).toHaveCount(0);
  await page.locator('#hwSearchInput').fill('');
  await expect(table.locator('[data-hw-past-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-homework-tab="completed"]').click();
  await expect(table.locator('.hw-assignment-row', { hasText: 'Completed past-due essay' })).toBeVisible();
});

test('Homework completion takes precedence over overdue styling and By Class exposes difficulty', async ({ page }) => {
  await openSeededHomework(page);

  await page.locator('[data-homework-tab="class"]').click();
  const table = page.locator('.hw-assignment-table.is-by-class');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText([
    'Assignment', 'Class / activity', 'Due', 'Difficulty', 'Priority', 'Status', 'Actions'
  ]);
  await expect(table.locator('.hw-assignment-group-row')).toHaveCount(3);
  // Action menus are intentionally hidden until opened; assert the visible
  // group label rather than including hidden menu item textContent.
  expect((await table.locator('.hw-assignment-group-heading > span').allTextContents()).map((text) => text.trim())).toEqual([
    'BiologyClass · 2 assignments',
    'UnassignedUnassigned · 1 assignment',
    'World HistoryClass · 2 assignments'
  ]);

  const completed = table.locator('.hw-assignment-row', { hasText: 'Completed past-due essay' });
  await expect(completed).toHaveClass(/is-completed/);
  await expect(completed.locator('.hw-due-cell')).not.toHaveClass(/is-overdue/);
  await expect(completed.locator('.hw-due-cell')).not.toContainText('Overdue');
  await expect(completed.locator('.hw-work-status')).toHaveText(/Completed/);
  await expect(completed.locator('.hw-difficulty-badge')).toHaveText('Hard');
  await expect.poll(() => page.evaluate(() => window.SutraHomework.getTasks()
    .find((task) => task.title === 'Completed past-due essay')?.dueDate)).toBe('2020-01-02');
  await expect(page.locator('[data-deadline-filter="overdue"] strong')).toHaveText('1 task');

  await completed.locator('[data-task-toggle]').click();
  const reopened = table.locator('.hw-assignment-row', { hasText: 'Completed past-due essay' });
  await expect(reopened).not.toHaveClass(/is-completed/);
  await expect(reopened.locator('.hw-due-cell')).toHaveClass(/is-overdue/);
  await expect(reopened.locator('.hw-work-status')).toHaveText(/Not Started/);
  await expect.poll(() => page.evaluate(() => window.SutraHomework.getTasks()
    .find((task) => task.title === 'Completed past-due essay')?.dueDate)).toBe('2020-01-02');
  await expect(page.locator('[data-deadline-filter="overdue"] strong')).toHaveText('2 tasks');

  await page.locator('[data-homework-tab="all"]').click();
  const allTable = page.locator('.hw-assignment-table:not(.is-by-class)');
  await expect(allTable.locator('thead th')).toHaveText([
    'Assignment', 'Class / activity', 'Due', 'Priority', 'Status', 'Actions'
  ]);
  await expect(allTable.locator('.hw-difficulty-badge')).toHaveCount(0);

  await page.locator('[data-homework-tab="class"]').click();
  await page.locator('#hwSearchInput').fill('history');
  await expect(table.locator('.hw-assignment-group-row')).toHaveCount(1);
  await expect(table.locator('.hw-assignment-row')).toHaveCount(2);
  await expect(table.locator('.hw-assignment-title-btn', { hasText: 'long history assignment' })).toBeVisible();
});

test('Homework effort prompt follows the active theme surface and button tokens', async ({ page }) => {
  await openSeededHomework(page);

  for (const theme of ['default', 'dark', 'sutra', 'dune']) {
    await page.evaluate((themeKey) => window.applyAtelierTheme(themeKey), theme);
    const taskId = await page.evaluate((themeKey) => {
      const task = window.SutraHomework.createTask({
        title: `Theme prompt ${themeKey}`,
        dueDate: '2099-02-03'
      });
      window.SutraHomework.markDone(task.id);
      return task.id;
    }, theme);

    const toast = page.locator('.hw-time-log-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`Theme prompt ${theme}`);
    const colors = await page.evaluate(() => {
      const toast = document.querySelector('.hw-time-log-toast');
      const button = toast && toast.querySelector('.hw-time-log-btn');
      const probe = document.createElement('div');
      const buttonProbe = document.createElement('button');
      probe.style.cssText = [
        'position:fixed', 'visibility:hidden',
        'background:var(--bg-elevated)', 'color:var(--text-primary)',
        'border:1px solid var(--button-border)',
        'box-shadow:var(--shadow-soft)'
      ].join(';');
      buttonProbe.style.cssText = 'position:fixed;visibility:hidden;background:var(--button-bg);color:var(--button-text)';
      document.body.appendChild(probe);
      document.body.appendChild(buttonProbe);
      const expected = getComputedStyle(probe);
      const expectedButton = getComputedStyle(buttonProbe);
      const actual = getComputedStyle(toast);
      const actualButton = getComputedStyle(button);
      const result = {
        toastBackground: actual.backgroundColor,
        expectedBackground: expected.backgroundColor,
        toastColor: actual.color,
        expectedColor: expected.color,
        buttonBackground: actualButton.backgroundColor,
        expectedButtonBackground: expectedButton.backgroundColor,
        buttonColor: actualButton.color,
        expectedButtonColor: expectedButton.color
      };
      probe.remove();
      buttonProbe.remove();
      return result;
    });
    expect(colors.toastBackground, `${theme} toast background`).toBe(colors.expectedBackground);
    expect(colors.toastColor, `${theme} toast text`).toBe(colors.expectedColor);
    expect(colors.buttonBackground, `${theme} button background`).toBe(colors.expectedButtonBackground);
    expect(colors.buttonColor, `${theme} button text`).toBe(colors.expectedButtonColor);
    const later = page.locator('#sutraUpdateBanner').getByRole('button', { name: 'Later' });
    if (await later.isVisible()) await later.click();
    await toast.locator('.hw-time-log-skip').click();
    await expect(toast).toBeHidden();
    await page.evaluate((id) => window.SutraHomework.setDone(id, false), taskId);
  }
});

test('Homework By Class keeps grouped structure and assignment details on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeededHomework(page);

  await page.locator('[data-homework-tab="class"]').click();
  const table = page.locator('.hw-assignment-table.is-by-class');
  await expect(table.locator('.hw-assignment-group-row')).toHaveCount(3);
  await expect(table.locator('.hw-assignment-group-row th').first()).toHaveAttribute('colspan', '7');
  await expect(table.locator('.hw-assignment-row')).toHaveCount(5);
  await expect(table.locator('.hw-difficulty-cell')).toHaveCount(5);
  await expect(table.locator('.hw-assignment-title-btn', { hasText: 'long history assignment' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    rowDisplay: getComputedStyle(document.querySelector('.hw-assignment-row')).display
  }))).toEqual({ documentWidth: 390, viewportWidth: 390, rowDisplay: 'grid' });
});
