import { expect, test } from '@playwright/test';

async function openTimeline(page) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  try {
    await page.waitForFunction(() => !!window.flowAtelier && typeof window.flowAtelier.setActiveView === 'function', null, { timeout: 15_000 });
  } catch (error) {
    throw new Error(`Sutra bridge did not initialize: ${pageErrors.join(' | ') || error.message}`);
  }
  // The bridge and calendar renderer install before IndexedDB hydration.
  // This core binding is set by initApp only after the canonical workspace has
  // loaded, so injected test blocks cannot be replaced by a late hydrate.
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  await page.evaluate(() => {
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.hidden = true; overlay.classList.remove('active'); overlay.style.display = 'none'; }
    window.flowAtelier.setActiveView('timeline');
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const rows = window.flowAtelier.timeBlocks;
    rows.splice(0, rows.length,
      { id: 'cal-a', name: 'Overlap A', date, start: '09:00', end: '10:00', category: 'study' },
      { id: 'cal-b', name: 'Overlap B', date, start: '09:30', end: '10:30', category: 'homework' },
      { id: 'cal-c', name: 'Overflow 1', date, start: '11:00', end: '11:30', category: 'study' },
      { id: 'cal-d', name: 'Overflow 2', date, start: '12:00', end: '12:30', category: 'study' },
      { id: 'cal-e', name: 'Overflow 3', date, start: '13:00', end: '13:30', category: 'study' },
      { id: 'cal-f', name: 'Overflow 4', date, start: '14:00', end: '14:30', category: 'study' }
    );
    window.flowAtelier.renderTimeline();
  });
  await page.waitForSelector('#timelineLegacyCalendar .sutra-calendar-time-view', { state: 'attached' });
}

test('calendar renderer provides Month, Week, and Day grids without replacing Timeline data', async ({ page }) => {
  await openTimeline(page);
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await expect(page.locator('.sutra-calendar-time-week .sutra-calendar-time-column')).toHaveCount(7);
  await expect(page.locator('.sutra-calendar-time-week .sutra-calendar-time-gutter')).toHaveCount(2);
  const overlap = page.locator('.sutra-calendar-time-week [data-block-id="cal-a"], .sutra-calendar-time-week [data-block-id="cal-b"]');
  await expect(overlap).toHaveCount(2);
  const positions = await overlap.evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, width: node.getBoundingClientRect().width })));
  expect(positions[0].left).not.toBe(positions[1].left);
  expect(positions[0].width).toBeGreaterThan(20);

  await page.locator('[data-timeline-view-mode="month"]').click();
  await expect(page.locator('.sutra-calendar-month-grid')).toBeVisible();
  const days = page.locator('.sutra-calendar-day');
  expect([35, 42]).toContain(await days.count());
  expect(await page.locator('.sutra-calendar-day.is-outside').count()).toBeGreaterThan(0);
  await expect(page.locator('.sutra-calendar-more')).toBeVisible();
  await expect(page.locator('.sutra-calendar-month')).not.toContainText('No events');

  await page.locator('[data-timeline-view-mode="day"]').click();
  await expect(page.locator('.sutra-calendar-time-day .sutra-calendar-time-column')).toHaveCount(1);
  await expect(page.locator('.sutra-calendar-time-day [data-block-id="cal-a"]')).toBeVisible();
  await expect(page.locator('.sutra-calendar-time-day [data-block-id="cal-b"]')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('calendar date navigation is mode-aware and stays local-date safe', async ({ page }) => {
  await openTimeline(page);
  const before = await page.locator('#timelineDateInput').inputValue();
  await page.locator('#timelineStepNext').click();
  const afterWeek = await page.locator('#timelineDateInput').inputValue();
  expect((new Date(afterWeek + 'T00:00:00') - new Date(before + 'T00:00:00')) / 86400000).toBe(7);
  await page.locator('[data-timeline-view-mode="month"]').click();
  const beforeMonth = await page.locator('#timelineDateInput').inputValue();
  await page.locator('#timelineStepNext').click();
  const afterMonth = await page.locator('#timelineDateInput').inputValue();
  expect(new Date(afterMonth + 'T00:00:00').getMonth()).toBe((new Date(beforeMonth + 'T00:00:00').getMonth() + 1) % 12);
  await page.locator('#timelineTodayBtn').click();
  const today = await page.locator('#timelineDateInput').inputValue();
  const now = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  expect(today).toBe(now);
});

test('phone Month uses count indicators and opens the focused Day view without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTimeline(page);
  await page.locator('[data-timeline-view-mode="month"]').click();

  const todayCell = page.locator('.sutra-calendar-day.is-today');
  await expect(todayCell.locator('.sutra-calendar-month-events')).toHaveAttribute('data-event-count', '6');
  await expect(todayCell.locator('.sutra-calendar-month-event').first()).toBeHidden();
  const indicator = await todayCell.locator('.sutra-calendar-month-events').evaluate((node) => {
    const content = getComputedStyle(node, '::before').content;
    // Firefox serializes attr() rather than the resolved string. Check the
    // referenced value, retaining the same six-event rendering contract.
    return content === 'attr(data-event-count)' ? node.getAttribute('data-event-count') : content;
  });
  expect(indicator).toContain('6');

  await todayCell.locator('.sutra-calendar-day-number').click();
  await expect(page.locator('.sutra-calendar-time-day.sutra-calendar-time-view')).toBeVisible();
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.document).toBeLessThanOrEqual(2);
  expect(overflow.body).toBeLessThanOrEqual(2);
});

test('short calendar blocks prioritize their title over a clipped time stack', async ({ page }) => {
  await openTimeline(page);
  await page.evaluate(() => {
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    window.flowAtelier.timeBlocks.push({
      id: 'cal-short', name: 'Quick check-in', date, start: '06:00', end: '06:45', category: 'study'
    });
    window.flowAtelier.renderTimeline();
  });

  const event = page.locator('.sutra-calendar-time-week [data-block-id="cal-short"]');
  await expect(event).toHaveClass(/is-compact/);
  await expect(event.locator('.sutra-calendar-event-time')).toHaveCount(0);
  await expect(event.locator('.sutra-calendar-event-source')).toHaveCount(0);
  await expect(event.locator('.sutra-calendar-event-title')).toHaveText('Quick check-in');
  await expect(event).toHaveAttribute('aria-label', /Quick check-in/);
});

test('phone day blocks keep a 45-minute title readable without a clipped time stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTimeline(page);
  await page.evaluate(() => {
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    window.flowAtelier.timeBlocks.push({
      id: 'cal-phone-short', name: 'Phone study block', date, start: '06:00', end: '06:45', category: 'study'
    });
    window.flowAtelier.renderTimeline();
  });

  await page.locator('[data-timeline-view-mode="day"]').click();
  const event = page.locator('.sutra-calendar-time-day [data-block-id="cal-phone-short"]');
  await expect(event).toHaveClass(/is-compact/);
  await expect(event.locator('.sutra-calendar-event-time')).toHaveCount(0);
  await expect(event.locator('.sutra-calendar-event-source')).toHaveCount(0);
  await expect(event.locator('.sutra-calendar-event-title')).toHaveText('Phone study block');
  await expect(event).toHaveAttribute('aria-label', /6:00 AM to 6:45 AM/);
});

test('an open canvas cannot remain visible beneath Timeline after navigation', async ({ page }) => {
  await openTimeline(page);

  await page.evaluate(() => {
    const notes = document.getElementById('view-notes');
    const canvas = document.getElementById('canvasEditor');
    if (!notes || !canvas) throw new Error('Notes canvas surface is unavailable');
    window.flowAtelier.setActiveView('notes');
    canvas.hidden = false;
    document.body.classList.add('canvas-page-active');
    document.body.dataset.canvasBackground = 'grid';
    window.flowAtelier.setActiveView('timeline');
  });

  await expect(page.locator('#view-timeline')).toBeVisible();
  await expect(page.locator('#view-notes')).toBeHidden();
  await expect(page.locator('#view-notes')).toHaveCSS('display', 'none');
});

test('Push time shifts every calendar block and survives reload', async ({ page }) => {
  await openTimeline(page);
  await page.locator('#timelineMoreBtn').click();
  await page.locator('#timelinePushTimeBtn').click();

  await expect(page.locator('#sutraPushTimeOverlay')).toBeVisible();
  await expect(page.locator('#pushTimeSummary')).toHaveText('6 blocks will move forward by 30 minutes.');
  await expect(page.locator('.sutra-push-time-examples li')).toHaveCount(3);
  await page.locator('#applyPushTimeBtn').click();
  await expect(page.locator('#sutraPushTimeOverlay')).toHaveCount(0);

  const shifted = await page.evaluate(() => window.flowAtelier.timeBlocks
    .filter(block => block.id === 'cal-a' || block.id === 'cal-f')
    .map(block => ({ id: block.id, start: block.start, end: block.end })));
  expect(shifted).toEqual([
    { id: 'cal-a', start: '09:30', end: '10:30' },
    { id: 'cal-f', start: '14:30', end: '15:00' }
  ]);
  const storedBeforeReload = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('noteflow_atelier_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('root');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve((get.result && get.result.timeBlocks || [])
        .filter(block => block.id === 'cal-a' || block.id === 'cal-f')
        .map(block => ({ id: block.id, start: block.start, end: block.end })));
      tx.oncomplete = () => db.close();
    };
  }));
  expect(storedBeforeReload).toEqual(shifted);

  await page.reload();
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
  const afterReload = await page.evaluate(() => new Promise((resolve, reject) => {
    const live = window.flowAtelier.timeBlocks
      .filter(block => block.id === 'cal-a' || block.id === 'cal-f')
      .map(block => ({ id: block.id, start: block.start, end: block.end }));
    const open = indexedDB.open('noteflow_atelier_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('root');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve({
        live,
        stored: (get.result && get.result.timeBlocks || [])
          .filter(block => block.id === 'cal-a' || block.id === 'cal-f')
          .map(block => ({ id: block.id, start: block.start, end: block.end }))
      });
      tx.oncomplete = () => db.close();
    };
  }));
  expect(afterReload).toEqual({ live: shifted, stored: shifted });
});
