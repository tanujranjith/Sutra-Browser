import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

test('Home and habit summaries do not add portable day records on render or reload', async ({ page }) => {
  await page.goto('/Sutra.html');
  await waitForAppReady(page);
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  const expected = { '2001-01-01': { completedHabitIds: ['habit-read-stable'] } };
  const rendered = await page.evaluate(async dayStates => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const habit = { id: 'habit-read-stable', name: 'Read a chapter', isActive: true };
    payload.habitTracker = { ...payload.habitTracker, habits: [habit], dayStates };
    payload.lifeWorkspace = {
      ...payload.lifeWorkspace,
      habits: [habit],
      habitCompletions: { '2001-01-01': ['habit-read-stable'] }
    };
    window.deserializeWorkspace(payload);
    window.SutraCustomTabsBridge.getHabitsToday();
    window.flowAtelier.setActiveView('today');
    await window.flowAtelier.flushAppSaveNow('habit-render-purity');
    return window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).habitTracker.dayStates;
  }, expected);
  expect(rendered).toEqual(expected);
  await page.reload();
  await waitForAppReady(page);
  expect(await page.evaluate(() => window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).habitTracker.dayStates))
    .toEqual(expected);
});
