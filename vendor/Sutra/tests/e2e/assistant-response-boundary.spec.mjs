// Response-boundary + message-lifecycle coverage for Sutra Assistant (Sections 9-11).
//
// Verifies through the REAL sendChat() runtime that:
//  - Gemini "thinking" parts (part.thought===true) never reach the visible transcript
//    or persisted history (the deterministic cause of the screenshot leak).
//  - Inlined <think> chain-of-thought from OpenAI-compatible providers is stripped.
//  - Stale notices ("Please choose a model first") are cleared on the next send and a
//    failed/validation-rejected send does not persist an orphaned user turn.
import { expect, test } from '@playwright/test';

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
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
  // The Assistant Pack is opt-in for fresh student workspaces (assistant.enabled
  // defaults OFF); enable it like a user would, otherwise toggleChat() is a no-op
  // and the panel never opens.
  await page.evaluate(() => { window.setWorkspacePreference('assistant.enabled', true); });
  // Open the assistant panel so the messages container is interactable/visible.
  await page.evaluate(() => {
    const panel = document.getElementById('chatbotPanel');
    const isOpen = panel && panel.offsetParent !== null;
    if (!isOpen && typeof window.toggleChat === 'function') window.toggleChat();
  });
  await expect(page.locator('#chatbotMessages')).toBeVisible();
}

// Configure the assistant for a deterministic, network-stubbed send.
async function configureProvider(page, { provider, key, model }) {
  await page.evaluate(({ provider, key, model }) => {
    localStorage.setItem('chat_provider', provider);
    localStorage.setItem('sutra_ai_send_ack_v1', '1'); // skip the one-time remote disclosure
    sessionStorage.setItem(provider + '_api_key', key);
    // getCurrentChatProvider reads the provider <select> first, so set it too.
    const ps = document.getElementById('chatProviderSelect');
    if (ps) ps.value = provider;
    const custom = document.getElementById('chatCustomModelInput');
    const sel = document.getElementById('chatModelSelect');
    if (sel) sel.value = '';
    if (custom) custom.value = model || '';
  }, { provider, key, model });
}

async function stubFetch(page, payload) {
  await page.evaluate((payload) => {
    window.__lastBody = null;
    window.fetch = async (_url, opts) => {
      try { window.__lastBody = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    };
  }, payload);
}

async function send(page, text) {
  await page.evaluate(async (text) => {
    const input = document.getElementById('chatInput');
    input.value = text;
    await window.sendChat();
  }, text);
}

function transcriptText(page) {
  return page.evaluate(() => document.getElementById('chatbotMessages').innerText);
}

// Assistant replies stream word-by-word; the reply-actions row is revealed by
// the stream's onDone callback, so its visibility is the deterministic
// "streaming finished" signal (reading the transcript earlier is a race).
async function waitForStreamComplete(page) {
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('#chatbotMessages .chatbot-msg.assistant:not(.chatbot-notice)');
    const last = msgs[msgs.length - 1];
    if (!last) return false;
    const actions = last.querySelector('.assistant-actions');
    return !!actions && actions.style.visibility !== 'hidden';
  });
}

test('Gemini thought/planning parts never reach the visible transcript or history', async ({ page }) => {
  await openApp(page);
  await configureProvider(page, { provider: 'gemini', key: 'test-gemini-key', model: 'gemini-2.5-flash' });
  await stubFetch(page, {
    candidates: [{
      content: {
        parts: [
          { thought: true, text: 'The user said "hi". This is a general greeting. As Sutra Assistant, I should respond politely. Plan: 1. Greet the user. 2. Offer help.' },
          { text: 'Hello! How can I help you today?' }
        ]
      }
    }]
  });
  await send(page, 'hi');
  await waitForStreamComplete(page);

  const text = await transcriptText(page);
  expect(text).toContain('Hello! How can I help you today?');
  expect(text).not.toContain('Plan:');
  expect(text).not.toContain('The user said');
  expect(text).not.toContain('As Sutra Assistant, I should');

  // Persistence boundary: history must not contain the planning either.
  const convo = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chat_history') || '[]'));
  const assistantTurns = convo.filter(m => m.role === 'assistant');
  expect(assistantTurns.length).toBe(1);
  expect(assistantTurns[0].content).toContain('Hello!');
  expect(assistantTurns[0].content).not.toContain('Plan:');
  expect(assistantTurns[0].content).not.toContain('As Sutra Assistant, I should');
});

test('inlined <think> chain-of-thought from OpenAI-compatible providers is stripped', async ({ page }) => {
  await openApp(page);
  await configureProvider(page, { provider: 'groq', key: 'test-groq-key', model: 'llama-3.3-70b-versatile' });
  await stubFetch(page, {
    choices: [{ message: { content: '<think>Internal planning: the user greeted me, I will greet back politely.</think>Hi there! What can I do for you?' } }]
  });
  await send(page, 'hi');
  await waitForStreamComplete(page);

  const text = await transcriptText(page);
  expect(text).toContain('Hi there! What can I do for you?');
  expect(text).not.toContain('Internal planning');

  const convo = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chat_history') || '[]'));
  const assistantTurns = convo.filter(m => m.role === 'assistant');
  expect(assistantTurns[0].content).not.toContain('Internal planning');
});

test('stale notice clears on next send and a rejected send does not persist an orphaned user turn', async ({ page }) => {
  await openApp(page);
  // Provider + key present but NO model -> validation notice, no network call.
  await configureProvider(page, { provider: 'gemini', key: 'test-gemini-key', model: '' });
  await send(page, 'first try with no model');
  await expect(page.locator('.chatbot-msg.chatbot-notice')).toContainText(/choose a model/i);

  // Now provide a model + stub the network and send a real message.
  await page.evaluate(() => { document.getElementById('chatCustomModelInput').value = 'gemini-2.5-flash'; });
  await stubFetch(page, { candidates: [{ content: { parts: [{ text: 'Second answer.' }] } }] });
  await send(page, 'second try with model');

  const text = await transcriptText(page);
  // Stale notice gone, real answer present.
  expect(await page.locator('.chatbot-msg.chatbot-notice').count()).toBe(0);
  expect(text).toContain('Second answer.');

  // History holds exactly one user turn (the successful one) — the rejected first
  // attempt was never persisted.
  const convo = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chat_history') || '[]'));
  const userTurns = convo.filter(m => m.role === 'user');
  expect(userTurns.length).toBe(1);
  expect(userTurns[0].content).toBe('second try with model');
});

test('a clean thinking indicator is shown during the request and removed after, with no raw reasoning', async ({ page }) => {
  await openApp(page);
  await configureProvider(page, { provider: 'gemini', key: 'test-gemini-key', model: 'gemini-2.5-flash' });
  // Stub fetch with a short delay so we can observe the thinking indicator mid-flight.
  await page.evaluate(() => {
    window.fetch = async () => {
      await new Promise(r => setTimeout(r, 250));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Done thinking.' }] } }] }), text: async () => '' };
    };
  });
  const sendPromise = page.evaluate(async () => {
    document.getElementById('chatInput').value = 'hi';
    await window.sendChat();
  });
  // Indicator visible during flight.
  await expect(page.locator('#chatbotThinking')).toBeVisible();
  await sendPromise;
  // Indicator removed after completion; answer present.
  await expect(page.locator('#chatbotThinking')).toHaveCount(0);
  expect(await transcriptText(page)).toContain('Done thinking.');
});
