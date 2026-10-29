import { expect, test } from '@playwright/test';

// Network stubs must own requests in every engine, including WebKit. Service
// worker behavior is covered separately by the offline/chaos suites.
test.use({ serviceWorkers: 'block' });

async function openApp(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('sutra_intro_played', '1'); } catch (_) {} });
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch (_) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

async function openAssistant(page) {
  await page.waitForFunction(() => window.SutraProviderMeta && window.flowAssistant);
  await page.evaluate(() => {
    window.setWorkspacePreference('assistant.enabled', true);
    window.SutraFeatureRegistry?.enable('assistant', { test: true });
    window.flowAssistant?.init?.();
    localStorage.setItem('sutra_ai_send_ack_v1', '1');
    const panel = document.getElementById('chatbotPanel');
    if (!panel || panel.offsetParent === null) window.toggleChat();
  });
  await expect(page.locator('#chatbotMessages')).toBeVisible();
}

test('NVIDIA, Mistral, and Together providers discover models with session-only keys', async ({ page }) => {
  const requests = [];
  const providers = [
    {
      id: 'nvidia', keyName: 'nvidia_api_key', key: 'nvapi-test-provider-secret-123456',
      endpoint: 'https://integrate.api.nvidia.com/v1/models', model: 'nvidia/test-model', arrayBody: false
    },
    {
      id: 'mistral', keyName: 'mistral_api_key', key: 'mistral-test-provider-secret-123456',
      endpoint: 'https://api.mistral.ai/v1/models', model: 'mistral-test-model', arrayBody: true
    },
    {
      id: 'together', keyName: 'together_api_key', key: 'together-test-provider-secret-123456',
      endpoint: 'https://api.together.xyz/v1/models', model: 'org/test-model', arrayBody: false
    }
  ];

  for (const provider of providers) {
    await page.route(provider.endpoint, async route => {
      requests.push({ id: provider.id, authorization: route.request().headers().authorization || '' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(provider.arrayBody ? [{ id: provider.model }] : { data: [{ id: provider.model }] })
      });
    });
  }

  await openApp(page);

  const result = await page.evaluate(async providerFixtures => {
    const meta = window.SutraProviderMeta;
    const registered = meta.list().map(provider => provider.id);
    const discovered = {};
    for (const fixture of providerFixtures) {
      meta.saveSessionKey(fixture.id, fixture.key);
      discovered[fixture.id] = await meta.discoverModels(fixture.id);
    }
    const serialized = JSON.stringify(window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }));
    return {
      registered,
      discovered,
      sessionValues: Object.fromEntries(providerFixtures.map(fixture => [fixture.id, sessionStorage.getItem(fixture.keyName)])),
      localValues: Object.fromEntries(providerFixtures.map(fixture => [fixture.id, localStorage.getItem(fixture.keyName)])),
      exportLeaksSecret: providerFixtures.some(fixture => serialized.includes(fixture.key))
    };
  }, providers);

  expect(result.registered).toEqual(expect.arrayContaining(['nvidia', 'mistral', 'together']));
  expect(result.discovered).toEqual({
    nvidia: ['nvidia/test-model'],
    mistral: ['mistral-test-model'],
    together: ['org/test-model']
  });
  expect(result.sessionValues).toEqual(Object.fromEntries(providers.map(provider => [provider.id, provider.key])));
  expect(result.localValues).toEqual({ nvidia: null, mistral: null, together: null });
  expect(result.exportLeaksSecret).toBe(false);
  expect(requests).toEqual(providers.map(provider => ({ id: provider.id, authorization: `Bearer ${provider.key}` })));

  await expect(page.locator('#chatProviderSelect option[value="nvidia"]')).toHaveCount(1);
  await expect(page.locator('#chatProviderSelect option[value="mistral"]')).toHaveCount(1);
  await expect(page.locator('#chatProviderSelect option[value="together"]')).toHaveCount(1);
  for (const provider of providers) {
    await expect(page.locator(`#${provider.id}ApiKeyInput`)).toHaveAttribute('type', 'password');
  }
});

test('NVIDIA, Mistral, and Together chat requests use their audited OpenAI-compatible endpoints', async ({ page }) => {
  const providers = [
    { id: 'nvidia', key: 'nvapi-chat-test-123456789', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/chat-test' },
    { id: 'mistral', key: 'mistral-chat-test-123456789', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-chat-test' },
    { id: 'together', key: 'together-chat-test-123456789', endpoint: 'https://api.together.xyz/v1/chat/completions', model: 'org/chat-test' }
  ];
  const requests = [];

  for (const provider of providers) {
    await page.route(provider.endpoint, async route => {
      const request = route.request();
      requests.push({
        id: provider.id,
        authorization: request.headers().authorization || '',
        body: request.postDataJSON()
      });
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: {"choices":[{"delta":{"content":"${provider.id} endpoint verified"}}]}\n\ndata: [DONE]\n\n`
      });
    });
  }

  await openApp(page);
  await openAssistant(page);

  for (const provider of providers) {
    await page.evaluate(async fixture => {
      window.SutraProviderMeta.saveSessionKey(fixture.id, fixture.key);
      window.SutraProviderMeta.selectModel(fixture.id, fixture.model);
      const input = document.getElementById('chatInput');
      input.value = `Return the provider handshake for ${fixture.id}.`;
      await window.sendChat();
    }, provider);
    await expect(page.locator('.chatbot-msg.assistant').last()).toContainText(`${provider.id} endpoint verified`);
  }

  expect(requests).toHaveLength(3);
  for (const provider of providers) {
    const request = requests.find(entry => entry.id === provider.id);
    expect(request.authorization).toBe(`Bearer ${provider.key}`);
    expect(request.body.model).toBe(provider.model);
    expect(request.body.stream).toBe(true);
    expect(request.body.max_tokens).toBeGreaterThan(0);
    expect(request.body.max_completion_tokens).toBeUndefined();
    for (const other of providers) expect(JSON.stringify(request.body)).not.toContain(other.key);
  }
});

test('an explicit max_tokens rejection retries OpenAI-compatible requests with the named alias', async ({ page }) => {
  const fixtures = [
    { id: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', key: 'openai-token-compat-test-key' },
    { id: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', key: 'groq-token-compat-test-key' }
  ];
  const requests = [];
  const attempts = new Map();
  for (const fixture of fixtures) {
    attempts.set(fixture.id, 0);
    await page.route(fixture.endpoint, async route => {
      const attempt = attempts.get(fixture.id) + 1;
      attempts.set(fixture.id, attempt);
      requests.push({ provider: fixture.id, body: route.request().postDataJSON() });
      if (attempt === 1) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
              type: 'invalid_request_error',
              param: 'max_tokens',
              code: 'unsupported_parameter'
            }
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }] })
      });
    });
  }

  await openApp(page);
  await openAssistant(page);
  for (const fixture of fixtures) {
    await page.evaluate(provider => {
      window.SutraProviderMeta.saveSessionKey(provider.id, provider.key);
      window.SutraProviderMeta.selectModel(provider.id, 'gpt-6-luna');
    }, fixture);
    const result = await page.evaluate(() => window.SutraIntelligenceBridge.extractStructured({ userText: 'Return a small JSON object.' }));
    expect(result).toMatchObject({ ok: true, value: { ok: true }, provider: fixture.id, model: 'gpt-6-luna' });

    const providerRequests = requests.filter(request => request.provider === fixture.id).map(request => request.body);
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests[0].max_tokens).toBe(4096);
    expect(providerRequests[0].max_completion_tokens).toBeUndefined();
    expect(providerRequests[1].max_tokens).toBeUndefined();
    expect(providerRequests[1].max_completion_tokens).toBe(4096);
    expect(providerRequests[1].messages).toEqual(providerRequests[0].messages);
  }
});

test('other provider adapters keep their token-limit fields and do not inherit an OpenAI alias', async ({ page }) => {
  const providers = [
    { id: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', family: 'compatible' },
    { id: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'together', endpoint: 'https://api.together.xyz/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'xai', endpoint: 'https://api.x.ai/v1/chat/completions', model: 'fixture-model', family: 'compatible' },
    { id: 'perplexity', endpoint: 'https://api.perplexity.ai/v1/sonar', model: 'fixture-model', family: 'compatible' },
    { id: 'local', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'fixture-local-model', family: 'compatible' },
    { id: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'fixture-claude-model', family: 'anthropic' },
    { id: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/**', model: 'fixture-gemini-model', family: 'gemini' }
  ];
  const requests = [];
  let activeProvider = '';

  for (const provider of providers) {
    await page.route(provider.endpoint, async route => {
      requests.push({ provider: activeProvider, body: route.request().postDataJSON() });
      let response;
      if (provider.family === 'anthropic') {
        response = { content: [{ type: 'text', text: '{"ok":true}' }] };
      } else if (provider.family === 'gemini') {
        response = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] };
      } else {
        response = { choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }] };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
  }

  await openApp(page);
  await openAssistant(page);
  for (const provider of providers) {
    activeProvider = provider.id;
    await page.evaluate(fixture => {
      if (fixture.id === 'local') {
        window.setWorkspacePreference('assistant.localEndpoint', {
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: fixture.model
        });
      } else {
        window.SutraProviderMeta.saveSessionKey(fixture.id, `test-key-${fixture.id}`);
      }
      window.SutraProviderMeta.selectModel(fixture.id, fixture.model);
    }, provider);
    const result = await page.evaluate(() => window.SutraIntelligenceBridge.extractStructured({ userText: 'Return a small JSON object.' }));
    expect(result.ok, provider.id).toBe(true);
  }

  expect(requests.map(request => request.provider)).toEqual(providers.map(provider => provider.id));
  for (const provider of providers.filter(item => item.family === 'compatible')) {
    const request = requests.find(item => item.provider === provider.id);
    expect(request.body.max_tokens, provider.id).toBe(4096);
    expect(request.body.max_completion_tokens, provider.id).toBeUndefined();
  }
  const anthropic = requests.find(item => item.provider === 'anthropic').body;
  expect(anthropic.max_tokens).toBe(4096);
  expect(anthropic.max_completion_tokens).toBeUndefined();
  const gemini = requests.find(item => item.provider === 'gemini').body;
  expect(gemini.generationConfig.maxOutputTokens).toBe(4096);
  expect(gemini.max_tokens).toBeUndefined();
  expect(gemini.max_completion_tokens).toBeUndefined();
});

test('an unrelated OpenAI-compatible 400 does not trigger a parameter rewrite retry', async ({ page }) => {
  const requests = [];
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' for this model." } })
    });
  });

  await openApp(page);
  await openAssistant(page);
  await page.evaluate(() => {
    window.SutraProviderMeta.saveSessionKey('openai', 'openai-token-compat-test-key');
    window.SutraProviderMeta.selectModel('openai', 'gpt-6-luna');
  });
  const result = await page.evaluate(() => window.SutraIntelligenceBridge.extractStructured({ userText: 'Return a small JSON object.' }));

  expect(result.ok).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0].max_tokens).toBe(4096);
  expect(requests[0].max_completion_tokens).toBeUndefined();
});
