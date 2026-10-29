import { expect, test } from '@playwright/test';

// Student-language regression coverage for the shared, local-only date parser
// and Quick Capture's routing hints. These assertions use a fixed clock so they
// do not depend on the day this suite happens to run.

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (_) {}
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
  await completeOnboarding(page);
  await page.waitForFunction(() =>
    !!window.SutraStudentDateParser && typeof window.parseQuickCaptureText === 'function'
  );
}

test('student date words stay deterministic and Quick Capture recognizes schoolwork intent', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const parser = window.SutraStudentDateParser;
    const now = new Date(2026, 2, 10, 9, 0, 0); // Tuesday, March 10, 2026.
    const date = (phrase) => parser.parseNaturalDate(phrase, { now });
    const parse = (phrase) => window.parseQuickCaptureText(phrase);
    const compact = (item) => ({
      type: item.type,
      title: item.title,
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      estimateMinutes: item.estimateMinutes
    });
    return {
      dates: {
        tomorrow: date('chem lab due tomorrow'),
        tonight: date('english essay outline tonight'),
        nextFriday: date('math worksheet next Friday'),
        nextTuesday: date('APUSH test next Tuesday'),
        weekend: date('SAT practice this weekend'),
        afterSchool: date('study physics after school'),
        none: date('read chapter')
      },
      captures: {
        homework: compact(parse('chem lab due friday')),
        tonightHomework: compact(parse('chem homework tonight')),
        tonightTimedHomework: compact(parse('chem homework tonight 7pm')),
        test: compact(parse('APUSH test next Tuesday unit 6')),
        quiz: compact(parse('physics quiz next block')),
        review: compact(parse('review bio chapter 12')),
        block: compact(parse('schedule AP Chem review tomorrow 7pm')),
        sat: compact(parse('SAT reading practice saturday'))
      }
    };
  });

  expect(result.dates.tomorrow).toMatchObject({ date: '2026-03-11', kind: 'tomorrow' });
  expect(result.dates.tonight).toMatchObject({ date: '2026-03-10', timeHint: '19:00', kind: 'tonight' });
  // "next" means the following calendar week; bare Friday means the upcoming one.
  expect(result.dates.nextFriday).toMatchObject({ date: '2026-03-20', kind: 'weekday' });
  expect(result.dates.nextTuesday).toMatchObject({ date: '2026-03-17', kind: 'weekday' });
  expect(result.dates.weekend).toMatchObject({ date: '2026-03-14', kind: 'weekend' });
  expect(result.dates.afterSchool).toMatchObject({ date: '2026-03-10', timeHint: '15:30', kind: 'after-school' });
  expect(result.dates.none).toBeNull();

  expect(result.captures.homework).toMatchObject({ type: 'homework' });
  expect(result.captures.tonightHomework).toMatchObject({ type: 'homework', dueTime: '23:59' });
  expect(result.captures.tonightTimedHomework).toMatchObject({ type: 'homework', dueTime: '19:00' });
  expect(result.captures.test).toMatchObject({ type: 'test' });
  expect(result.captures.quiz).toMatchObject({ type: 'test' });
  expect(result.captures.review).toMatchObject({ type: 'review', title: 'bio chapter 12' });
  expect(result.captures.block).toMatchObject({ type: 'block', dueTime: '19:00' });
  expect(result.captures.sat).toMatchObject({ type: 'apsession' });
});

test('Quick Capture offers test and review choices, and Word export labels distinguish docx from legacy doc', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.openQuickCaptureModal());
  await expect(page.locator('#quickCaptureType option[value="test"]')).toHaveText('Test / quiz');
  await expect(page.locator('#quickCaptureType option[value="review"]')).toHaveText('Review item / deck');

  const formats = await page.evaluate(() => {
    const labels = (value) => Array.from(document.querySelectorAll(`option[value="${value}"]`))
      .map((option) => String(option.textContent || '').trim());
    return { docx: labels('docx'), doc: labels('doc') };
  });

  expect(formats.docx.length).toBeGreaterThan(0);
  expect(formats.doc.length).toBeGreaterThan(0);
  formats.docx.forEach((label) => expect(label).toContain('(.docx)'));
  formats.doc.forEach((label) => expect(label).toMatch(/^Word 97.?2003 \(\.doc\)$/));
});

test('Quick Capture keeps parsed dates and times visible in enhanced controls', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.openQuickCaptureModal('chem lab due 09/16/2026 at 11:59 pm', { type: 'homework' }));
  const modal = page.locator('#quickCaptureModal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#quickCaptureDate')).toHaveValue('2026-09-16');
  await expect(modal.locator('#quickCaptureTime')).toHaveValue('23:59');
  const dateLabel = modal.locator('#quickCaptureDate').locator('xpath=..').locator('.nf-date-label');
  const timeLabel = modal.locator('#quickCaptureTime').locator('xpath=..').locator('.nf-time-label');
  if (await dateLabel.count()) await expect(dateLabel).toHaveText('09/16/2026');
  else await expect(modal.locator('#quickCaptureDate')).toBeVisible();
  if (await timeLabel.count()) await expect(timeLabel).toHaveText('11:59 PM');
  else await expect(modal.locator('#quickCaptureTime')).toBeVisible();
});

test('Homework capture treats tonight as 11:59 PM unless a clock time is stated', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.openQuickCaptureModal('SAT formulate chatting plan for sat tonight', { type: 'homework' }));
  const modal = page.locator('#quickCaptureModal');
  await expect(modal).toBeVisible();
  const today = await page.evaluate(() => window.SutraStudentDateParser.localDateKey(new Date()));
  await expect(modal.locator('#quickCaptureType')).toHaveValue('homework');
  await expect(modal.locator('#quickCaptureDate')).toHaveValue(today);
  await expect(modal.locator('#quickCaptureTime')).toHaveValue('23:59');
  await expect(modal.locator('#quickCapturePreview')).toContainText('time: 23:59');

  await modal.locator('#quickCaptureInput').fill('SAT formulate chatting plan for sat tonight 7pm');
  await expect(modal.locator('#quickCaptureTime')).toHaveValue('19:00');

  await modal.locator('#quickCaptureCancelBtn').click();
  await page.evaluate(() => window.openQuickCaptureModal('SAT formulate chatting plan for sat tonight'));
  await page.locator('#quickCaptureType').selectOption('homework');
  await expect(modal.locator('#quickCaptureTime')).toHaveValue('23:59');
});

test('empty Homework teaches one primary action: paste or type your homework', async ({ page }) => {
  await openApp(page);
  const ui = await page.evaluate(() => {
    try { localStorage.setItem('hwCourses:v2', '[]'); localStorage.setItem('hwTasks:v2', '[]'); } catch (e) {}
    if (window.SutraHomework && typeof window.SutraHomework.render === 'function') {
      try { window.SutraHomework.render(); } catch (e) {}
    }
    const view = document.getElementById('view-homework');
    const html = view ? view.innerHTML : '';
    const btn = view ? view.querySelector('[data-hw-empty-capture]') : null;
    return { hasCaptureBtn: !!btn, label: btn ? btn.textContent.trim() : '', html };
  });
  expect(ui.hasCaptureBtn).toBe(true);
  expect(ui.label).toContain('Paste or type your homework');
});

test('homework captured without a class remains editable', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.openQuickCaptureModal());
  await page.locator('#quickCaptureInput').fill('Classless chemistry lab');
  await page.locator('#quickCaptureType').selectOption('homework');
  await page.locator('#quickCaptureDate').fill('2026-08-28');
  await page.locator('#quickCaptureSubmitBtn').click();

  await page.locator('#tabHomework:visible, [data-bn-view="homework"]:visible').first().click();
  const classSetup = page.getByRole('dialog').filter({ hasText: 'Set Up Your Classes' });
  if (await classSetup.isVisible()) {
    await classSetup.getByRole('button', { name: 'Cancel for now' }).click();
  }
  const pastAssignments = page.locator('[data-hw-past-toggle]');
  if (await pastAssignments.isVisible()) await pastAssignments.click();
  const taskCard = page.locator('[data-task-id]').filter({ hasText: 'Classless chemistry lab' }).first();
  await expect(taskCard).toBeVisible();
  await expect(taskCard).toContainText('No class');

  await taskCard.locator('[data-task-menu-trigger]').click();
  await taskCard.locator('[data-task-edit]').click();
  const editModal = page.locator('#hwGlobalAddModal');
  await expect(editModal).toBeVisible();
  await editModal.locator('[data-field="title"]').fill('Classless chemistry lab revised');
  await editModal.locator('[data-field="dueDate"]').fill('2026-08-29');
  await editModal.locator('button[type="submit"]').click();

  await expect(editModal).toBeHidden();
  const updatedCard = page.locator('[data-task-id]').filter({ hasText: 'Classless chemistry lab revised' }).first();
  await expect(updatedCard).toBeVisible();
  await expect(updatedCard).toContainText('Sat, Aug 29');
  await expect(page.getByText('Pick a class first.', { exact: true })).toHaveCount(0);
});
