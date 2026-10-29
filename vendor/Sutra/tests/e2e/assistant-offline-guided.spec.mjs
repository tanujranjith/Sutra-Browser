// Button-driven offline mode: with NO provider configured, a typed free-text
// prompt must NOT be treated as an offline AI request. It is redirected to the
// guided "needs generative AI" gate, and no network request is made.
import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('sutra_intro_played', '1'); } catch {} });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.classList.remove('active'); overlay.hidden = true; }
    document.body.classList.remove('onboarding-open');
  });
  await page.waitForFunction(() => !!window.SutraFeatureRegistry);
  await page.evaluate(() => window.SutraFeatureRegistry.enable('assistant', { test: true }));
  await page.waitForFunction(() => !!window.flowAssistant && !!window.SutraLocalHelp && !!window.SutraProviderMeta);
  await page.evaluate(() => { window.setWorkspacePreference('assistant.enabled', true); });
}

test('no-provider free-text send is redirected to the guided gate, not an AI request', async ({ page }) => {
  // Fail loudly if ANY request reaches a known provider host.
  const providerHits = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (/api\.(openai|anthropic|groq|x\.ai|deepseek|perplexity)\.com|generativelanguage\.googleapis\.com|openrouter\.ai|integrate\.api\.nvidia\.com|api\.mistral\.ai|api\.together\.xyz/.test(u)) {
      providerHits.push(u);
    }
    return route.continue();
  });

  await openApp(page);

  // Sanity: no provider key is configured in this fresh session.
  const anyKey = await page.evaluate(() => window.SutraProviderMeta.hasAnyKey());
  expect(anyKey).toBe(false);

  // Composer placeholder should signal guided mode (not "ask anything").
  await page.evaluate(() => { try { window.updateChatKeyBanner && window.updateChatKeyBanner(); } catch (e) {} });

  // Open the docked panel and send an arbitrary free-text prompt (NOT a local command).
  await page.evaluate(() => {
    // Ensure the docked panel + input exist.
    if (window.flowAssistant && typeof window.flowAssistant.init === 'function') { try { window.flowAssistant.init(); } catch (e) {} }
    const input = document.getElementById('chatInput');
    if (input) { input.value = 'write me a haiku about the ocean'; }
    if (typeof window.sendChat === 'function') window.sendChat();
  });

  // The guided gate node should now be rendered (button-driven), and no provider hit.
  await page.waitForFunction(() => {
    const host = document.querySelector('#chatbotMessages, #chatMessages, .chatbot-messages');
    return host && /needs generative AI|does locally|Connect an AI provider/i.test(host.textContent || '');
  }, { timeout: 8000 }).catch(() => {});

  const rendered = await page.evaluate(() => {
    const host = document.querySelector('#chatbotMessages, #chatMessages, .chatbot-messages');
    return host ? host.textContent : '';
  });

  expect(providerHits, 'no provider network request may be made offline: ' + providerHits.join(', ')).toEqual([]);
  expect(rendered).toMatch(/needs generative AI|does locally|Connect an AI provider|not sent anywhere/i);
});
