// AI theme generation (Sutra Assistant) — Themes panel + Intelligence harness.
// All provider traffic is mocked with deterministic route handlers (no live AI).
// Covers: provider-gated generation, structured validation + repair, contrast
// enforcement, temporary live preview + revert, apply as a first-class custom
// theme, conversational refinement + regenerate, persistence, .sutra import/export
// round-trips, backward compatibility, missing-provider config, and provider errors.
import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });

const THEME_OK = {
  name: 'Kyoto Paper',
  description: 'Warm paper tones with soft ink contrast.',
  colors: {
    bgPrimary: '#f3ece0',
    bgSecondary: '#e8ddc9',
    textPrimary: '#2c2620',
    accent: '#9c6b4a',
    sidebar: '#ece2d0',
    button: '#e0d3bd'
  }
};

const THEME_REFINED = {
  name: 'Kyoto Paper Soft',
  description: 'Same paper tones with a gentler sidebar.',
  colors: {
    bgPrimary: '#f5efe4',
    bgSecondary: '#ece2d0',
    textPrimary: '#2c2620',
    accent: '#8c5f42',
    sidebar: '#f1e8d8',
    button: '#e3d7c1'
  }
};

async function openApp(page) {
  await page.addInitScript(() => { sessionStorage.setItem('sutra_intro_played', '1'); });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    document.body.classList.remove('onboarding-open');
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => window.SutraThemeAI && window.flowAssistant && window.serializeWorkspace);
}

async function armProvider(page, provider, model) {
  await page.evaluate((p) => {
    sessionStorage.setItem(`${p}_api_key`, 'mock-key-for-tests');
    localStorage.setItem('sutra_ai_send_ack_v1', '1');
    const sel = document.getElementById('chatProviderSelect');
    if (sel) { sel.value = p; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, provider);
  await page.waitForTimeout(300);
  await page.evaluate((mdl) => {
    const custom = document.getElementById('chatCustomModelInput');
    if (custom) { custom.value = mdl; custom.dispatchEvent(new Event('input', { bubbles: true })); }
  }, model);
  await expect.poll(() => page.evaluate(() => window.SutraIntelligence.getActiveProviderModel().model)).toBe(model);
}

function mockAnthropic(page, payloadText, { delayMs = 0, status = 200 } = {}) {
  return page.route('https://api.anthropic.com/**', async route => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: payloadText }] })
    });
  });
}

test('generates a valid theme from a description through the Intelligence harness', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, JSON.stringify(THEME_OK));
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');

  const res = await page.evaluate(async () => {
    return await window.SutraThemeAI.generate('a calm Japanese stationery look with warm paper tones');
  });
  expect(res.ok).toBe(true);
  expect(res.theme.name).toBe('Kyoto Paper');
  expect(res.theme.colors.accent).toBe('#9c6b4a');
  expect(res.theme.colors.bgPrimary).toBe('#f3ece0');
  // Every token must be a strict 6-digit hex (no CSS injection vectors survive).
  Object.values(res.theme.colors).forEach(v => expect(v).toMatch(/^#[0-9a-f]{6}$/));
});

test('Gemini theme generation requests JSON mode and safely recovers a fenced response with a trailing comma', async ({ page }) => {
  await openApp(page);
  let requestBody = null;
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: `<think>Choosing calm paper colors.</think>\nHere you go:\n\`\`\`json\n${JSON.stringify(THEME_OK, null, 2).replace(/\n}/, '\n,}') }\n\`\`\`` }] } }]
      })
    });
  });
  await armProvider(page, 'gemini', 'gemma-3-27b-it');

  const result = await page.evaluate(() => window.SutraThemeAI.generate('warm Japanese stationery'));
  expect(result.ok).toBe(true);
  expect(result.theme.name).toBe('Kyoto Paper');
  expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
});

test('validation repairs garbage, rejects unsafe values, and fills safe defaults (no network)', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const raw = {
      name: 'Sketchy <b>theme</b>',
      description: 'x'.repeat(400),
      colors: {
        bgPrimary: 'red',                              // named color -> rejected
        bgSecondary: 'linear-gradient(#fff,#000)',     // gradient -> rejected
        textPrimary: 'rgb(10, 10, 10)',                // rgb -> coerced to hex
        accent: 'url(javascript:alert(1))',            // url/script -> rejected
        sidebar: '#zzzzzz',                            // invalid hex -> rejected
        button: '#123',                                // shorthand hex -> expanded
        evilExtraKey: '<script>boom</script>'          // unknown key -> ignored
      }
    };
    const r = window.SutraThemeAI.validate(raw);
    return {
      ok: r.ok,
      colors: r.theme.colors,
      name: r.theme.name,
      descLen: r.theme.description.length,
      keys: Object.keys(r.theme.colors).sort()
    };
  });
  expect(out.ok).toBe(true);
  // Only the six known tokens exist; nothing else leaks through.
  expect(out.keys).toEqual(['accent', 'bgPrimary', 'bgSecondary', 'button', 'sidebar', 'textPrimary']);
  // Every surviving value is a strict hex — no "red", "url(", "javascript", "gradient".
  Object.values(out.colors).forEach(v => {
    expect(v).toMatch(/^#[0-9a-f]{6}$/);
    expect(v).not.toMatch(/url|javascript|gradient|script/i);
  });
  expect(out.colors.textPrimary).toBe('#0a0a0a'); // rgb(10,10,10)
  expect(out.colors.button).toBe('#112233');      // #123 expanded
  expect(out.name).not.toContain('<');            // markup stripped from name
  expect(out.descLen).toBeLessThanOrEqual(160);   // description clamped
});

test('contrast enforcement guarantees readable text (>= 4.5:1)', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    // Near-white text on white -> unreadable; the repairer must fix it.
    const r = window.SutraThemeAI.validate({
      name: 'Low contrast',
      colors: { bgPrimary: '#ffffff', bgSecondary: '#f0f0f0', textPrimary: '#fdfdfd', accent: '#999999', sidebar: '#eeeeee', button: '#dddddd' }
    });
    return { ratio: window.SutraThemeAI.contrastRatio(r.theme.colors), warnings: r.theme.warnings, text: r.theme.colors.textPrimary };
  });
  expect(out.ratio).toBeGreaterThanOrEqual(4.5);
  expect(out.warnings.length).toBeGreaterThan(0);
});

test('temporary preview applies live then reverts without overwriting the saved theme', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const theme = window.SutraThemeAI.validate(JSON.parse(JSON.stringify({
      name: 'Preview Me',
      colors: { bgPrimary: '#101820', bgSecondary: '#16212c', textPrimary: '#eef4fb', accent: '#4f9dde', sidebar: '#16212c', button: '#1d2c39' }
    }))).theme;
    const savedThemeBefore = document.body.getAttribute('data-theme');
    const savedKeyBefore = document.body.getAttribute('data-theme-key');
    window.SutraThemeAI.preview(theme);
    const accentDuring = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const keyDuring = document.body.getAttribute('data-theme-key');
    const previewing = window.SutraThemeAI.isPreviewing();
    const bannerVisible = !document.getElementById('aiThemePreviewBanner').hidden;
    window.SutraThemeAI.revertPreview();
    return {
      savedThemeBefore, savedKeyBefore, accentDuring, keyDuring, previewing, bannerVisible,
      keyAfter: document.body.getAttribute('data-theme-key'),
      themeAfter: document.body.getAttribute('data-theme'),
      previewingAfter: window.SutraThemeAI.isPreviewing(),
      bannerHiddenAfter: document.getElementById('aiThemePreviewBanner').hidden
    };
  });
  expect(out.accentDuring.toLowerCase()).toBe('#4f9dde');
  expect(out.keyDuring).toBe('custom');
  expect(out.previewing).toBe(true);
  expect(out.bannerVisible).toBe(true);
  // Revert restores exactly what was on the body before.
  expect(out.keyAfter).toBe(out.savedKeyBefore);
  expect(out.themeAfter).toBe(out.savedThemeBefore);
  expect(out.previewingAfter).toBe(false);
  expect(out.bannerHiddenAfter).toBe(true);
});

test('apply saves a first-class custom theme that activates and survives a .sutra round-trip', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const theme = window.SutraThemeAI.validate(JSON.parse(JSON.stringify({
      name: 'Applied Theme',
      colors: { bgPrimary: '#fbf7ef', bgSecondary: '#f1e8d6', textPrimary: '#241f17', accent: '#b07a2e', sidebar: '#f1e8d6', button: '#e7dcc4' }
    }))).theme;
    const created = window.SutraThemeAI.apply(theme);
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const exported = (payload.settings.customThemes || []).find(t => t.id === created.id);
    // Round-trip: wipe and re-import.
    window.deserializeWorkspace(payload);
    const after = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const reimported = (after.settings.customThemes || []).find(t => t.name === 'Applied Theme');
    return {
      createdId: created && created.id,
      activeKey: document.body.getAttribute('data-theme-key'),
      exportedName: exported && exported.name,
      exportedAccent: exported && exported.accent,
      reimported: !!reimported,
      reimportedAccent: reimported && reimported.accent
    };
  });
  expect(out.createdId).toBeTruthy();
  expect(out.activeKey).toBe('custom');
  expect(out.exportedName).toBe('Applied Theme');
  expect(out.exportedAccent).toBe('#b07a2e');
  expect(out.reimported).toBe(true);
  expect(out.reimportedAccent).toBe('#b07a2e');
});

test('refine updates the current theme in place (and exposes a before/after)', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, JSON.stringify(THEME_OK));
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  const first = await page.evaluate(async () => await window.SutraThemeAI.generate('warm paper theme'));
  expect(first.ok).toBe(true);

  await page.unroute('https://api.anthropic.com/**');
  await mockAnthropic(page, JSON.stringify(THEME_REFINED));
  const refined = await page.evaluate(async (current) => {
    return await window.SutraThemeAI.refine('warm the sidebar slightly and lower the accent saturation', current);
  }, first.theme);
  expect(refined.ok).toBe(true);
  expect(refined.theme.colors.sidebar).toBe('#f1e8d8');
  expect(refined.theme.colors.accent).toBe('#8c5f42');
  // The refined theme differs from the original — it was updated, not regenerated blank.
  expect(refined.theme.colors.accent).not.toBe(first.theme.colors.accent);
});

test('the Themes panel card opens the modal, shows loading, then a result with swatches', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, JSON.stringify(THEME_OK), { delayMs: 700 });
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');

  // Open the theme panel and click the AI card.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Open Theme Panel/i.test(b.textContent || ''));
    if (btn) btn.click();
    document.getElementById('aiThemeGenerateCard').click();
  });
  await expect(page.locator('#aiThemeModal')).toHaveClass(/active/);
  await expect(page.locator('#aiThemeComposeSection')).toBeVisible();

  await page.fill('#aiThemePromptInput', 'dark futuristic theme');
  await page.click('#aiThemeGenerateBtn');
  // Loading state appears while the (delayed) mock resolves.
  await expect(page.locator('#aiThemeLoadingSection')).toBeVisible();
  // Then the result with the generated name + swatches.
  await expect(page.locator('#aiThemeResultName')).toHaveText('Kyoto Paper', { timeout: 5000 });
  await expect(page.locator('#aiThemeSwatches .ai-theme-swatch')).toHaveCount(6);
  await expect(page.locator('#aiThemeApplyBtn')).toBeVisible();
  await expect(page.locator('#aiThemePreviewBtn')).toBeVisible();
});

test('missing provider configuration disables generation but keeps built-in themes working', async ({ page }) => {
  await openApp(page);
  const status = await page.evaluate(() => ({
    configured: window.SutraThemeAI.isProviderConfigured()
  }));
  expect(status.configured).toBe(false);

  const res = await page.evaluate(async () => await window.SutraThemeAI.generate('any theme'));
  expect(res.ok).toBe(false);
  expect(res.errorCategory).toBe('no-provider');

  // The modal shows the no-provider state with an Open Settings affordance.
  await page.evaluate(() => window.SutraThemeAI.openModal());
  await expect(page.locator('#aiThemeErrorSection')).toBeVisible();
  await expect(page.locator('#aiThemeOpenSettingsBtn')).toBeVisible();
  await expect(page.locator('#aiThemeGenerateBtn')).toBeHidden();
  await page.evaluate(() => document.getElementById('aiThemeCancelBtn').click());

  // Built-in themes still apply with no provider configured.
  const themed = await page.evaluate(() => {
    window.applyPresetTheme('dark');
    return document.body.getAttribute('data-theme');
  });
  expect(themed).toBe('dark');
});

test('provider errors fail safely with a recoverable message and persist nothing', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, 'upstream exploded', { status: 500 });
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  const out = await page.evaluate(async () => {
    const before = (window.serializeWorkspace({ mode: 'json' }).settings.customThemes || []).length;
    const r = await window.SutraThemeAI.generate('something');
    const after = (window.serializeWorkspace({ mode: 'json' }).settings.customThemes || []).length;
    return { ok: r.ok, msg: r.errorMessage, saved: after - before };
  });
  expect(out.ok).toBe(false);
  expect(out.msg).toBeTruthy();
  expect(out.saved).toBe(0);
});

test('malformed (non-JSON) model output is rejected as a validation error', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, 'Sure! Here is a lovely theme described in prose.');
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  const res = await page.evaluate(async () => await window.SutraThemeAI.generate('prose please'));
  expect(res.ok).toBe(false);
  expect(res.errorCategory).toBe('validation');
});

test('backward compatibility: importing a workspace with no customThemes does not break theming', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    // Simulate an older workspace that predates custom themes entirely.
    delete payload.settings.customThemes;
    delete payload.settings.activeCustomThemeId;
    let threw = false;
    try { window.deserializeWorkspace(payload); } catch (e) { threw = true; }
    window.applyPresetTheme('sutra');
    return {
      threw,
      themeApplied: document.body.getAttribute('data-theme'),
      customThemes: (window.serializeWorkspace({ mode: 'json' }).settings.customThemes || []).length,
      themeAiUsable: typeof window.SutraThemeAI.generate === 'function'
    };
  });
  expect(out.threw).toBe(false);
  expect(out.themeApplied).toBe('sutra');
  expect(out.customThemes).toBe(0);
  expect(out.themeAiUsable).toBe(true);
});

test('Sutra Assistant routes a natural-language theme request to the generator', async ({ page }) => {
  await openApp(page);
  await mockAnthropic(page, JSON.stringify(THEME_OK), { delayMs: 200 });
  await armProvider(page, 'anthropic', 'claude-sonnet-4-20250514');
  const handled = await page.evaluate(() => {
    const r = window.flowAssistant.tryHandleCommand('make me a dark futuristic theme');
    return { handled: r.handled, message: r.message, modalActive: document.getElementById('aiThemeModal').classList.contains('active') };
  });
  expect(handled.handled).toBe(true);
  expect(handled.message).toMatch(/theme/i);
  expect(handled.modalActive).toBe(true);
});
