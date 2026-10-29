import { expect, test } from '@playwright/test';

// A locked note must not be deletable without first proving the PIN. Previously
// deletePage() only showed a generic "Are you sure?" confirm and removed the
// page regardless of its lock state, so a locked note could be destroyed without
// ever unlocking it.
const PIN = '2468';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (error) {}
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
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

// Seed a dedicated page and lock it with a known PIN; returns its id.
async function seedLockedPage(page, id = 'locked-note-qa') {
  return page.evaluate(async ({ id, pin }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    base.pages = [
      ...base.pages,
      { id, title: 'Secret QA Note', content: '<p>secret body</p>', blocks: [] }
    ];
    window.deserializeWorkspace(base);
    await window.__sutraPublicBetaTestHooks.lockPageWithPin(id, pin);
    return id;
  }, { id, pin: PIN });
}

async function startDelete(page, id) {
  await page.evaluate((pageId) => {
    window.__deleteResult = window.__sutraPublicBetaTestHooks.deletePageById(pageId);
  }, id);
}

async function pageExists(page, id) {
  return page.evaluate((pageId) => window.__sutraPublicBetaTestHooks.pageExists(pageId), id);
}

test('a locked note is not deleted when the PIN prompt is cancelled', async ({ page }) => {
  await openApp(page);
  const id = await seedLockedPage(page);
  expect(await pageExists(page, id)).toBe(true);

  await startDelete(page, id);

  // Step 1: the generic delete confirmation.
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();

  // Step 2: the lock gate now demands the PIN — confirming delete is not enough.
  await expect(page.locator('#customPromptModal')).toHaveClass(/active/);
  await page.locator('#customPromptCancelBtn').click();

  await page.evaluate(() => window.__deleteResult);
  expect(await pageExists(page, id)).toBe(true);
});

test('a wrong PIN re-prompts and never deletes the locked note', async ({ page }) => {
  await openApp(page);
  const id = await seedLockedPage(page);

  await startDelete(page, id);
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();

  await expect(page.locator('#customPromptModal')).toHaveClass(/active/);
  // The PIN input is masked so it is not shoulder-surfed.
  await expect(page.locator('#customPromptInput')).toHaveAttribute('type', 'password');

  await page.fill('#customPromptInput', '0000');
  await page.locator('#customPromptConfirmBtn').click();

  // Still prompting after a wrong PIN; page survives.
  await expect(page.locator('#customPromptModal')).toHaveClass(/active/);
  await page.locator('#customPromptCancelBtn').click();
  await page.evaluate(() => window.__deleteResult);
  expect(await pageExists(page, id)).toBe(true);
});

test('the correct PIN unlocks deletion of a locked note', async ({ page }) => {
  await openApp(page);
  const id = await seedLockedPage(page);

  await startDelete(page, id);
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();

  await expect(page.locator('#customPromptModal')).toHaveClass(/active/);
  await page.fill('#customPromptInput', PIN);
  await page.locator('#customPromptConfirmBtn').click();

  await page.evaluate(() => window.__deleteResult);
  await expect.poll(() => pageExists(page, id)).toBe(false);
});

test('an unlocked (plain) note deletes without any PIN prompt', async ({ page }) => {
  await openApp(page);
  const id = await page.evaluate(() => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const pid = 'plain-note-qa';
    base.pages = [...base.pages, { id: pid, title: 'Plain QA Note', content: '<p>x</p>', blocks: [] }];
    window.deserializeWorkspace(base);
    return pid;
  });

  await startDelete(page, id);
  await expect(page.locator('#customConfirmModal')).toHaveClass(/active/);
  await page.locator('#customConfirmAcceptBtn').click();

  // No PIN prompt for a note that is not locked.
  await expect(page.locator('#customPromptModal')).not.toHaveClass(/active/);
  await page.evaluate(() => window.__deleteResult);
  await expect.poll(() => pageExists(page, id)).toBe(false);
});
