import { expect, test } from '@playwright/test';

// The fixture imports America/New_York wall times and asserts their rendered
// clock values. Keep that expectation independent of the CI runner timezone.
test.use({ timezoneId: 'America/New_York' });

async function openTimeline(page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true && window.sutraIcs?.toTimeBlocks);
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
    window.flowAtelier.setActiveView('timeline');
  });
  await expect(page.locator('#view-timeline')).toBeVisible();
}

async function chooseCalendarFile(page, name, contents) {
  await page.locator('#timelineMoreBtn').click();
  await expect(page.locator('#timelineMoreMenu')).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#timelineImportIcsBtn').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: 'text/calendar', buffer: Buffer.from(contents) });
}

async function approveImport(page, name, contents) {
  await chooseCalendarFile(page, name, contents);
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  const preview = await page.locator('#customConfirmMessage').innerText();
  await page.locator('#customConfirmAcceptBtn').click();
  await expect(page.locator('#customConfirmModal')).not.toHaveClass(/active/);
  return preview;
}

const SCHOOL_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Sutra Tests//EN',
  'X-WR-CALNAME:School schedule',
  'BEGIN:VEVENT',
  'UID:shared-uid',
  'SUMMARY:Biology lab',
  'DTSTART;TZID=America/New_York:20260831T090000',
  'DURATION:PT1H',
  'RRULE:FREQ=WEEKLY;COUNT=2',
  'LOCATION:Science 204',
  'DESCRIPTION:Bring lab notebook',
  'CATEGORIES:SCHOOL,STUDY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday',
  'SUMMARY:Campus closed',
  'DTSTART;VALUE=DATE:20260901',
  'DTEND;VALUE=DATE:20260903',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:malformed',
  'SUMMARY:Bad date',
  'DTSTART:20260231T090000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const PERSONAL_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Personal calendar',
  'BEGIN:VEVENT',
  'UID:shared-uid',
  'SUMMARY:Dentist',
  'DTSTART:20260831T150000',
  'DTEND:20260831T160000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const SCHOOL_UPDATED_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:School schedule',
  'BEGIN:VEVENT',
  'UID:shared-uid',
  'SEQUENCE:2',
  'SUMMARY:Biology lab — updated',
  'DTSTART;TZID=America/New_York:20260831T100000',
  'DTEND;TZID=America/New_York:20260831T110000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('Timeline imports reviewed iCalendar data and re-imports only its own source', async ({ page }) => {
  await openTimeline(page);

  const firstPreview = await approveImport(page, 'school.ics', SCHOOL_ICS);
  expect(firstPreview).toContain('3 events parsed into 3 Timeline blocks');
  expect(firstPreview).toContain('1 warning');
  await page.waitForFunction(() => window.flowAtelier.timeBlocks.filter(block => block.calendarImportId).length === 3);

  const school = await page.evaluate(() => window.flowAtelier.timeBlocks
    .filter(block => block.calendarName === 'School schedule')
    .map(block => ({
      name: block.name,
      date: block.date,
      start: block.start,
      end: block.end,
      recurrence: block.recurrence,
      recurrenceUntil: block.recurrenceUntil,
      allDay: block.isAllDay,
      location: block.notes,
      timeZone: block.calendarTimeZone,
      sourceUid: block.sourceUid
    })));
  expect(school).toHaveLength(3);
  expect(school.find(block => block.name === 'Biology lab')).toMatchObject({
    recurrence: 'weekly',
    recurrenceUntil: '2026-09-07',
    timeZone: 'America/New_York'
  });
  expect(school.filter(block => block.name === 'Campus closed').map(block => block.date)).toEqual(['2026-09-01', '2026-09-02']);
  expect(school.filter(block => block.name === 'Campus closed').every(block => block.allDay)).toBe(true);

  const personalPreview = await approveImport(page, 'personal.ics', PERSONAL_ICS);
  expect(personalPreview).toContain('1 will be added');
  await page.waitForFunction(() => window.flowAtelier.timeBlocks.filter(block => block.calendarImportId).length === 4);
  const sourceIds = await page.evaluate(() => Array.from(new Set(window.flowAtelier.timeBlocks.filter(block => block.calendarImportId).map(block => block.calendarImportId))));
  expect(sourceIds).toHaveLength(2);

  const updatePreview = await approveImport(page, 'school.ics', SCHOOL_UPDATED_ICS);
  expect(updatePreview).toContain('0 will be added, 1 updated, and 2 removed from this calendar only');
  await page.waitForFunction(() => window.flowAtelier.timeBlocks.filter(block => block.calendarImportId).length === 2);
  const afterUpdate = await page.evaluate(() => window.flowAtelier.timeBlocks
    .filter(block => block.calendarImportId)
    .map(block => ({ name: block.name, start: block.start, importId: block.calendarImportId })));
  expect(afterUpdate.map(block => block.name).sort()).toEqual(['Biology lab — updated', 'Dentist']);
  expect(afterUpdate.find(block => block.name.startsWith('Biology')).start).toBe('10:00');

  await page.locator('#timelineDateInput').fill('2026-08-31');
  await page.locator('#timelineDateInput').dispatchEvent('change');
  await page.locator('[data-timeline-view-mode="month"]').click();
  await expect(page.locator('.sutra-calendar-month')).toContainText('Biology lab — updated');
  await expect(page.locator('.sutra-calendar-month')).toContainText('Dentist');

  await page.reload();
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  const afterReload = await page.evaluate(() => window.flowAtelier.timeBlocks
    .filter(block => block.calendarImportId)
    .map(block => block.name).sort());
  expect(afterReload).toEqual(['Biology lab — updated', 'Dentist']);
});

test('invalid or cancelled calendar previews never mutate the Timeline', async ({ page }) => {
  await openTimeline(page, { width: 390, height: 844 });
  const before = await page.evaluate(() => window.flowAtelier.timeBlocks.map(block => block.id));

  await chooseCalendarFile(page, 'broken.ics', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Incomplete');
  await expect(page.locator('#customConfirmModal')).not.toHaveClass(/active/);
  await expect(page.locator('#toastMessage')).toContainText('incomplete');
  expect(await page.evaluate(() => window.flowAtelier.timeBlocks.map(block => block.id))).toEqual(before);

  await chooseCalendarFile(page, 'cancelled.ics', PERSONAL_ICS);
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmCancelBtn').click();
  await expect(page.locator('#customConfirmModal')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => window.flowAtelier.timeBlocks.map(block => block.id))).toEqual(before);
});
