import { expect, test } from '@playwright/test';

/*
 * Broken-symbol / mojibake regression guard.
 *
 * Renders every entry point + the Sutra Assistant panel and fails if any visible
 * text, attribute (placeholder/aria-label/title/alt), or detectable ::before /
 * ::after pseudo-content contains a cp1252 mojibake fragment or the U+FFFD
 * replacement character. Also captures a screenshot of the repaired assistant
 * panel as regression evidence.
 *
 * All non-ASCII test data is built from char codes so this file stays pure-ASCII
 * and passes the repo's own scripts/sutra-encoding-check.mjs.
 */

const s = (...codes) => String.fromCharCode(...codes);

// Leading chars of cp1252-double-encoded UTF-8, plus U+FFFD. None of these occur
// in legitimate English UI text.
const MOJIBAKE_FRAGMENTS = [
  [0x00E2, 0x20AC], // -> general punctuation (em/en dash, quotes, ellipsis, bullet)
  [0x00E2, 0x0153], // -> sparkles / dingbats
  [0x00E2, 0x02DC], // -> dingbats
  [0x00E2, 0x0161], // -> warning / gear / misc symbols
  [0x00E2, 0x2020], // -> arrows
  [0x00E2, 0x2013], // -> block / box-drawing
  [0x00F0, 0x0178], // -> emoji (F0 9F ...)
  [0x00E2, 0x0152], // -> technical symbols (command, etc.)
  [0x00C3, 0x00A9], // -> e-acute family
  [0x00C3, 0x00A8], // -> e-grave family
  [0xFFFD],          // replacement character
].map((codes) => s(...codes));

const SPARKLE = s(0x2726);    // the badge sparkle the screenshot showed corrupted
const WARNING = s(0x26A0);    // warning sign before "AI Disclaimer"

function scanForMojibake(text) {
  const hits = [];
  for (const frag of MOJIBAKE_FRAGMENTS) {
    if (text.includes(frag)) hits.push(JSON.stringify(frag));
  }
  return hits;
}

async function collectRenderedText(page) {
  return page.evaluate(() => {
    const parts = [];
    if (document.body) parts.push(document.body.innerText || '');
    const attrs = ['placeholder', 'aria-label', 'title', 'alt', 'value'];
    for (const a of attrs) {
      document.querySelectorAll('[' + a + ']').forEach((el) => {
        const v = el.getAttribute(a);
        if (v) parts.push(v);
      });
    }
    return parts.join('\n');
  });
}

async function collectPseudoContent(page, rootSelector) {
  return page.evaluate((sel) => {
    const out = [];
    const root = sel ? document.querySelector(sel) : document.body;
    if (!root) return out;
    const els = [root, ...root.querySelectorAll('*')];
    for (const el of els) {
      for (const pseudo of ['::before', '::after']) {
        const c = window.getComputedStyle(el, pseudo).content;
        if (c && c !== 'none' && c !== 'normal') out.push(c);
      }
    }
    return out;
  }, rootSelector);
}

async function dismissOnboarding(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (e) {}
    for (const id of ['studentOnboardingOverlay', 'sutraStartupIntro']) {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.classList.remove('active');
        overlay.hidden = true;
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  });
}

test('index.html root redirect contains no mojibake', async ({ page }) => {
  // index.html is a tiny redirect shell; scan the served bytes (rendering it
  // would race the redirect navigation).
  const resp = await page.request.get('/index.html');
  const html = await resp.text();
  expect(scanForMojibake(html), 'mojibake in index.html').toEqual([]);
});

test('HomePage landing page renders no mojibake', async ({ page }) => {
  await page.goto('/HomePage.html');
  await page.waitForLoadState('domcontentloaded');
  const text = await collectRenderedText(page);
  expect(scanForMojibake(text), 'mojibake in HomePage.html').toEqual([]);
});

test('Sutra workspace renders no mojibake in text or attributes', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await dismissOnboarding(page);
  const text = await collectRenderedText(page);
  expect(scanForMojibake(text), 'mojibake in Sutra workspace text/attributes').toEqual([]);
});

test('Sutra Assistant panel shows correct symbols and no mojibake (with screenshot)', async ({ page }, testInfo) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await dismissOnboarding(page);

  // The screenshot-area elements exist in the DOM even before the panel opens.
  // (Redesign: the brand line lives on the Sutra Intelligence badge; the header
  // line is now a dynamic subtitle.)
  const poweredBy = await page.locator('.sutra-intel-badge-title').first().textContent();
  expect(poweredBy).toContain('Powered by Sutra Intelligence');
  expect(scanForMojibake(poweredBy || '')).toEqual([]);

  const disclaimer = await page.locator('.chatbot-disclaimer').first().textContent();
  expect(disclaimer).toContain(WARNING);
  expect(scanForMojibake(disclaimer || '')).toEqual([]);

  // Open the panel via a direct DOM click (avoids actionability retries that can
  // hang if a transient overlay is mid-dismiss) for pseudo-scan + screenshot.
  await page.evaluate(() => {
    const btn = document.getElementById('chatbotBtn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);

  const panelText = await page.evaluate(() => {
    const p = document.getElementById('chatbotPanel');
    return p ? p.innerText + '\n' + (p.getAttribute('aria-label') || '') : '';
  });
  expect(scanForMojibake(panelText), 'mojibake in assistant panel').toEqual([]);

  const pseudo = await collectPseudoContent(page, '#chatbotPanel');
  expect(scanForMojibake(pseudo.join('\n')), 'mojibake in assistant pseudo-content').toEqual([]);

  await page.screenshot({ path: testInfo.outputPath('sutra-assistant-panel.png') }).catch(() => {});
  // Also drop a stable copy under the gitignored test-results/ dir for evidence.
  await page.screenshot({ path: 'test-results/sutra-assistant-panel.png' }).catch(() => {});
});

test('command palette + key placeholders contain no mojibake', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await dismissOnboarding(page);
  const placeholders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[placeholder]')).map((el) => el.getAttribute('placeholder') || '').join('\n'));
  expect(scanForMojibake(placeholders), 'mojibake in placeholders').toEqual([]);
});

test('stored-default migration repairs a seeded cp1252 brain icon on normalize', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await dismissOnboarding(page);
  await page.waitForFunction(
    () => window.__sutraPublicBetaTestHooks && typeof window.__sutraPublicBetaTestHooks.normalizePageIcon === 'function',
    null, { timeout: 15_000 });
  const result = await page.evaluate(() => {
    const hooks = window.__sutraPublicBetaTestHooks || {};
    const fn = hooks.normalizePageIcon;
    if (typeof fn !== 'function') return { available: false };
    const corruptedBrain = String.fromCharCode(0x00F0, 0x0178, 0x00A7, 0x00A0); // cp1252 mojibake of the brain emoji
    const repaired = fn(corruptedBrain);
    const cleanBrain = String.fromCodePoint(0x1F9E0);
    return {
      available: true,
      repairedToClean: repaired === cleanBrain,
      idempotent: fn(cleanBrain) === cleanBrain,            // a clean icon is left untouched
      userAuthoredUntouched: fn('my-custom-label') === 'my-custom-label',
    };
  });
  expect(result.available, 'normalizePageIcon should be reachable as a global').toBe(true);
  expect(result.repairedToClean, 'corrupted brain should normalize to the clean brain emoji').toBe(true);
  expect(result.idempotent, 'a clean icon must pass through unchanged').toBe(true);
  expect(result.userAuthoredUntouched, 'arbitrary user-authored icons must not be mutated').toBe(true);
});
