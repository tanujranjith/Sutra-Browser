import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/Sutra.html?today-dashboard-test=1');
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await page.waitForFunction(() => !!window.SutraTodayDashboard
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('today-dashboard-ready'));
});

async function openHomeCustomizer(page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Customize Home' }).click();
}

test('Calm Home shows the essential workflow without duplicate cards', async ({ page }) => {
  await expect(page.locator('#view-today .today-nextup-card')).toBeVisible();
  await expect(page.locator('#view-today .today-radar-card')).toBeVisible();
  await expect(page.locator('#view-today .today-plan-section')).toBeVisible();
  await expect(page.locator('#view-today #tccBackupHealth')).toBeVisible();
  await expect(page.locator('#view-today #tccAttentionTasks')).toBeVisible();
  await expect(page.locator('#homeQuickTaskInput')).toBeVisible();

  for (const selector of [
    '#tccPlanCard',
    '#tccAttentionAssignments',
    '#tccAttentionCalendar',
    '#todayReviewCard',
    '#tccUpcomingTests',
    '#tccTonightPlan',
    '.today-panel-habits',
    '#todayTrackerSummary',
    '.today-completed-strip',
    '#todayJumpCollapsible',
    '#todayAcademicCollapsible',
    '#todayAnalyticsCollapsible'
  ]) {
    await expect(page.locator(`#view-today ${selector}`)).toBeHidden();
  }
});

test('Today widgets can be shown, resized, reordered, and persisted', async ({ page }) => {
  await openHomeCustomizer(page);
  const modal = page.getByRole('dialog', { name: 'Make Home yours' });
  await expect(modal).toBeVisible();

  const habits = modal.locator('[data-widget-id="habits"]');
  await habits.locator('input[type="checkbox"]').check();
  await expect(page.locator('#view-today .today-panel-habits')).toBeVisible();

  const review = modal.locator('[data-widget-id="review"]');
  await review.locator('select').selectOption('wide');
  await expect(page.locator('#todayReviewCard')).toHaveClass(/today-widget-size-wide/);

  const assignments = modal.locator('[data-widget-id="assignments"]');
  await assignments.getByRole('button', { name: 'Move Assignments later' }).click();
  await modal.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.waitForFunction(() => !!window.SutraTodayDashboard
    && !!window.flowAtelier
    && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('today-dashboard-reload-ready'));
  await expect(page.locator('#view-today .today-panel-habits')).toBeVisible();
  await expect(page.locator('#todayReviewCard')).toHaveClass(/today-widget-size-wide/);

  const stored = await page.evaluate(() => window.SutraTodayDashboard.getPreferences());
  expect(stored.preset).toBe('custom');
  expect(stored.hidden).not.toContain('habits');
});

test('Calm preset keeps the mobile Today shell canonical', async ({ page }) => {
  await openHomeCustomizer(page);
  await page.getByRole('button', { name: 'Calm Daily essentials first', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#todayMobileShell')).toBeVisible();
  await expect(page.locator('#todayCustomizeDashboardBtn')).toBeHidden();
});
