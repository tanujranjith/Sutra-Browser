import { expect, test } from '@playwright/test';

const USER_DATES = `can u add these dates to the calender: First day of school, August 31
Schedules: expected during the second week of August, but the letter gives no exact release date.
interpreted as August 10-16. Warrior Block begins September 8: 34 days away.
Homecoming Weekend, begins in 51 days and ends in 52 days.`;

const ASSISTANT_PROMISE = 'I can add those dates to your Timeline for you—approve the cards below:';

async function openApp(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sutra_intro_played', '1'); } catch {}
  });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
    document.getElementById('sutraStartupIntro')?.remove();
  });
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => !!window.flowAssistant
    && !!window.flowAtelier
    && !!window.SutraAssistantConversationController);
  await page.evaluate(() => window.setWorkspacePreference('assistant.enabled', true));
}

test('a terse scheduling promise recovers concrete dates from its user turn', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(({ userText, replyText }) => {
    const repaired = window.flowAssistant.parseActions(replyText, {
      userText,
      now: '2026-08-07T12:00:00'
    });
    const uncertain = window.flowAssistant.parseActions(replyText, {
      userText: 'Schedules are expected during the second week of August, but there is no exact release date.',
      now: '2026-08-07T12:00:00'
    });
    const noPromise = window.flowAssistant.parseActions('Those dates are listed in your message.', {
      userText,
      now: '2026-08-07T12:00:00'
    });
    return {
      inferred: repaired.inferred === true,
      actions: repaired.actions.map(action => ({
        type: action.type,
        name: action.name,
        date: action.date,
        valid: window.flowAssistant.validateAction(action).ok
      })),
      uncertainCount: uncertain.actions.length,
      noPromiseCount: noPromise.actions.length
    };
  }, { userText: USER_DATES, replyText: ASSISTANT_PROMISE });

  expect(result.inferred).toBe(true);
  expect(result.actions).toEqual([
    { type: 'create_timeline_block', name: 'First day of school', date: '2026-08-31', valid: true },
    { type: 'create_timeline_block', name: 'Warrior Block', date: '2026-09-08', valid: true },
    { type: 'create_timeline_block', name: 'Homecoming Weekend', date: '2026-09-27', valid: true }
  ]);
  expect(result.uncertainCount).toBe(0);
  expect(result.noPromiseCount).toBe(0);
});

test('persisted Assistant replies show review cards and mutate only after Apply', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-07T12:00:00Z'));
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await openApp(page);
  const seeded = await page.evaluate(({ userText, replyText }) => {
    const controller = window.SutraAssistantConversationController;
    const before = window.flowAtelier.timeBlocks.length;
    const chat = controller.create({
      title: 'Calendar dates',
      messages: [
        { role: 'user', content: userText },
        { role: 'assistant', content: replyText, claimType: 'generative_suggestion' }
      ]
    });
    controller.select(chat.id);
    window.flowAtelier.setActiveView('assistantview');
    controller.render('full');
    return { before };
  }, { userText: USER_DATES, replyText: ASSISTANT_PROMISE });

  const assistantView = page.locator('#view-assistantview');
  await expect(assistantView).toBeVisible();
  const cards = assistantView.locator('.flow-action-card[data-action-type="create_timeline_block"]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('First day of school');
  await expect(cards.nth(1)).toContainText('Warrior Block');
  await expect(cards.nth(2)).toContainText('Homecoming Weekend');
  await expect(assistantView.locator('.assistant-claim-proposed_action')).toContainText('not applied');
  await expect(page.locator('#chatbotMessages .flow-action-card[data-action-type="create_timeline_block"]')).toHaveCount(3);

  expect(await page.evaluate(() => window.flowAtelier.timeBlocks.length)).toBe(seeded.before);
  await cards.nth(0).locator('.flow-action-apply').click();
  await expect(cards.nth(0).locator('.flow-action-receipt')).toBeVisible();
  const applied = await page.evaluate(() => {
    const blocks = window.flowAtelier.timeBlocks;
    const block = blocks.find(item => item && item.name === 'First day of school');
    return { count: blocks.length, date: block && block.date };
  });
  expect(applied).toEqual({ count: seeded.before + 1, date: '2026-08-31' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards.nth(2)).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    cards: Array.from(document.querySelectorAll('#view-assistantview .flow-action-card')).map(card => {
      const box = card.getBoundingClientRect();
      return { left: box.left, right: box.right };
    })
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.cards.every(card => card.left >= -1 && card.right <= layout.viewport + 1)).toBe(true);
  expect(browserErrors).toEqual([]);
});
