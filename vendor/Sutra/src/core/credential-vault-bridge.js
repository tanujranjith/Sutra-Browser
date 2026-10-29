/* Bridges the device-local credential vault into the existing app seams. */
(function (global) {
  'use strict';

  var ASSISTANT_PROVIDERS = [
    'groq', 'openai', 'anthropic', 'gemini', 'openrouter', 'nvidia',
    'mistral', 'together', 'deepseek', 'xai', 'perplexity', 'local'
  ];
  var CLOUD_SESSION_KEY = 'sutra:supabaseSession:v1';
  var CLOUD_VAULT_KEY = 'cloud:supabaseSession:v1';
  var ASSISTANT_VAULT_PREFIX = 'assistant:';
  var assistantRemember = false;
  var cloudRemember = false;
  var cloudWriteGeneration = null;
  var cloudHydration = null;

  function revocationLocked() {
    try {
      return !!(global.SutraRevocationWipe
        && typeof global.SutraRevocationWipe.readGuard === 'function'
        && global.SutraRevocationWipe.readGuard());
    } catch (error) {
      return true;
    }
  }

  function vault() {
    if (revocationLocked()) return null;
    return global.SutraCredentialVault && typeof global.SutraCredentialVault.get === 'function'
      ? global.SutraCredentialVault
      : null;
  }

  function operationActive(store) {
    return !!store && store === global.SutraCredentialVault && !revocationLocked();
  }

  function assertOperationActive(store) {
    if (operationActive(store)) return;
    throw new Error('Credential operation was cancelled because this device is revoked.');
  }

  function safeStorage() {
    return global.SutraSafeStorage || null;
  }

  function reportCredentialFailure(error, where, userMessage) {
    if (typeof global.SutraReportError === 'function') {
      global.SutraReportError(error, {
        where: where,
        feature: 'credential-vault',
        userMessage: userMessage,
        toast: !!userMessage
      }, 'warning');
      return;
    }
    try { console.warn('Credential vault operation failed:', error); } catch (ignored) {}
    if (userMessage && typeof global.showToast === 'function') global.showToast(userMessage);
  }

  function readSession(key) {
    try {
      var storage = safeStorage();
      return storage && typeof storage.sessionGet === 'function'
        ? storage.sessionGet(key, { fallback: null, parseJson: true })
        : null;
    } catch (error) {
      return null;
    }
  }

  function writeSession(key, value) {
    try {
      var storage = safeStorage();
      return storage && typeof storage.session === 'function'
        ? storage.session(key, value)
        : { ok: false };
    } catch (error) {
      return { ok: false, error: error };
    }
  }

  function removeSession(key) {
    try {
      var storage = safeStorage();
      if (storage && typeof storage.sessionRemove === 'function') return storage.sessionRemove(key);
    } catch (error) {}
    return { ok: false };
  }

  function getInput(provider) {
    return document.getElementById(provider + 'ApiKeyInput');
  }

  function assistantVaultKey(provider) {
    return ASSISTANT_VAULT_PREFIX + provider;
  }

  async function clearAssistantVault() {
    var store = vault();
    if (!store) return;
    await Promise.all(ASSISTANT_PROVIDERS.map(function (provider) {
      return store.remove(assistantVaultKey(provider));
    }));
  }

  async function hydrateAssistantKeys() {
    var store = vault();
    if (!store) return false;
    var remembered = await store.getPreference('assistantRemember', false).catch(function () { return false; });
    if (!operationActive(store)) return false;
    assistantRemember = remembered;
    var rememberInput = document.getElementById('assistantRememberKeysInput');
    if (rememberInput && rememberInput.dataset.userChanged !== 'true') rememberInput.checked = assistantRemember;
    if (!assistantRemember) return false;
    var restored = 0;
    for (var i = 0; i < ASSISTANT_PROVIDERS.length; i += 1) {
      var provider = ASSISTANT_PROVIDERS[i];
      var key = await store.get(assistantVaultKey(provider)).catch(function () { return null; });
      if (!operationActive(store)) return false;
      if (typeof key !== 'string' || !key) continue;
      var config = global.CHAT_PROVIDER_CONFIG;
      var storageKey = config && config[provider] && config[provider].keyStorage;
      if (!storageKey) storageKey = provider + '_api_key';
      if (!readSession(storageKey)) writeSession(storageKey, key);
      var input = getInput(provider);
      if (input) input.value = key;
      restored += 1;
    }
    if (restored && operationActive(store)) {
      try { global.dispatchEvent(new CustomEvent('sutra:assistant-credentials-restored', { detail: { count: restored } })); } catch (error) {}
    }
    return restored > 0 && operationActive(store);
  }

  async function saveAssistantKeys() {
    var store = vault();
    if (!store) return false;
    var requested = !!(document.getElementById('assistantRememberKeysInput') || {}).checked;
    await store.setPreference('assistantRemember', requested);
    assertOperationActive(store);
    if (!requested) {
      await clearAssistantVault();
      assertOperationActive(store);
      assistantRemember = false;
      return true;
    }
    for (var i = 0; i < ASSISTANT_PROVIDERS.length; i += 1) {
      var provider = ASSISTANT_PROVIDERS[i];
      var input = getInput(provider);
      var value = input ? String(input.value || '').trim() : '';
      if (value) await store.set(assistantVaultKey(provider), value);
      else await store.remove(assistantVaultKey(provider));
      assertOperationActive(store);
    }
    assistantRemember = true;
    return true;
  }

  function restoreAssistantRememberChoice(input, previous) {
    if (revocationLocked()) {
      assistantRemember = false;
      if (input) input.checked = false;
      return;
    }
    assistantRemember = previous;
    if (input) input.checked = previous;
    var store = vault();
    if (!store) return;
    store.setPreference('assistantRemember', previous).then(function () {
      assertOperationActive(store);
      if (!previous) return clearAssistantVault().then(function () { assertOperationActive(store); });
    }).catch(function (error) {
      if (revocationLocked()) {
        assistantRemember = false;
        if (input) input.checked = false;
      }
      reportCredentialFailure(error, 'credential-vault.assistant-rollback');
    });
  }

  function cloudBackendUrl() {
    try {
      var storage = safeStorage();
      var backend = storage && typeof storage.get === 'function'
        ? storage.get('sutra:supabaseCustomBackend:v1', { fallback: null })
        : null;
      if (backend && backend.mode === 'custom') return String(backend.customSupabaseUrl || '').replace(/\/+$/, '');
    } catch (error) {}
    var config = global.SUTRA_CONFIG || {};
    return String(config.supabaseUrl || '').replace(/\/+$/, '');
  }

  async function hydrateCloudSession() {
    if (cloudHydration) return cloudHydration;
    var store = vault();
    if (!store) return false;
    cloudHydration = (async function () {
      var remembered = await store.getPreference('cloudRemember', false).catch(function () { return false; });
      if (!operationActive(store)) return false;
      cloudRemember = remembered;
      if (!cloudRemember) return false;
      if (typeof store.getWriteGuard !== 'function') throw new Error('Credential vault write guards are unavailable.');
      var guard = await store.getWriteGuard(CLOUD_VAULT_KEY);
      if (!operationActive(store)) return false;
      if (guard.blocked) return false;
      cloudWriteGeneration = guard.generation;
      if (readSession(CLOUD_SESSION_KEY)) return false;
      var saved = await store.get(CLOUD_VAULT_KEY).catch(function () { return null; });
      if (!operationActive(store)) return false;
      if (!saved || saved.version !== 1 || !saved.refreshToken || !saved.user || !saved.user.id
          || String(saved.backendUrl || '') !== cloudBackendUrl()) {
        if (saved) {
          if (typeof store.removeGuarded !== 'function') throw new Error('Credential vault guarded removal is unavailable.');
          await store.removeGuarded(CLOUD_VAULT_KEY, guard.generation).catch(function () { return false; });
          if (!operationActive(store)) return false;
        }
        return false;
      }
      var currentGuard = await store.getWriteGuard(CLOUD_VAULT_KEY);
      if (!operationActive(store) || currentGuard.blocked || currentGuard.generation !== guard.generation) {
        cloudWriteGeneration = null;
        return false;
      }
      cloudWriteGeneration = currentGuard.generation;
      writeSession(CLOUD_SESSION_KEY, {
        accessToken: '',
        refreshToken: String(saved.refreshToken),
        expiresAtMs: 0,
        user: { id: String(saved.user.id), email: String(saved.user.email || '') }
      });
      return true;
    })().finally(function () { cloudHydration = null; });
    return cloudHydration;
  }

  async function captureCloudSession() {
    var store = vault();
    if (!store) return false;
    if (!cloudRemember) return false;
    if (!Number.isSafeInteger(cloudWriteGeneration) || typeof store.setGuarded !== 'function') return false;
    var session = readSession(CLOUD_SESSION_KEY);
    if (!session || !session.refreshToken || !session.user || !session.user.id) return false;
    var written = await store.setGuarded(CLOUD_VAULT_KEY, {
      version: 1,
      backendUrl: cloudBackendUrl(),
      refreshToken: String(session.refreshToken),
      user: { id: String(session.user.id), email: String(session.user.email || '') },
      savedAt: new Date().toISOString()
    }, cloudWriteGeneration);
    return operationActive(store) && written;
  }

  async function authorizeFreshCloudSession() {
    var store = vault();
    if (!store || !cloudRemember || typeof store.unblock !== 'function') return false;
    var generation = await store.unblock(CLOUD_VAULT_KEY);
    assertOperationActive(store);
    cloudWriteGeneration = generation;
    return captureCloudSession();
  }

  async function restoreCloudRememberChoice(store, input, previous) {
    if (!operationActive(store)) {
      cloudRemember = false;
      input.checked = false;
      cloudWriteGeneration = null;
      return false;
    }
    cloudRemember = previous;
    input.checked = previous;
    await store.setPreference('cloudRemember', previous);
    assertOperationActive(store);
    // Never re-authorize writes during rollback: an explicit sign-out may have
    // advanced and blocked the shared guard while this UI operation was failing.
    cloudWriteGeneration = null;
    if (!previous) {
      await store.block(CLOUD_VAULT_KEY);
      assertOperationActive(store);
    }
    return true;
  }

  function cloudRememberInput() {
    return document.getElementById('sutraCloudRememberSessionInput');
  }

  function mountCloudRememberControl() {
    var area = document.getElementById('sutraCloudSetupArea');
    if (!area || document.getElementById('sutraCloudRememberSessionInput')) return;
    var label = document.createElement('label');
    label.className = 'sutra-cloud-remember';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'sutraCloudRememberSessionInput';
    input.checked = cloudRemember;
    var copy = document.createElement('span');
    copy.textContent = 'Remember me on this device (encrypted, never exported)';
    label.appendChild(input);
    label.appendChild(copy);
    input.addEventListener('change', async function () {
      var previous = cloudRemember;
      var requested = input.checked;
      var store = vault();
      if (!store) return;
      cloudRemember = requested;
      try {
        await store.setPreference('cloudRemember', requested);
        assertOperationActive(store);
        if (requested) {
          if (typeof store.unblock !== 'function') throw new Error('Credential vault write guards are unavailable.');
          cloudWriteGeneration = await store.unblock(CLOUD_VAULT_KEY);
          assertOperationActive(store);
          await captureCloudSession();
        } else {
          if (typeof store.block !== 'function') throw new Error('Credential vault write guards are unavailable.');
          await store.block(CLOUD_VAULT_KEY);
          assertOperationActive(store);
          cloudWriteGeneration = null;
        }
      } catch (error) {
        restoreCloudRememberChoice(store, input, previous).catch(function (rollbackError) {
          reportCredentialFailure(rollbackError, 'credential-vault.cloud-preference-rollback');
        });
        reportCredentialFailure(error, 'credential-vault.cloud-preference', 'Could not update remembered Sutra Cloud sign-in on this device.');
      }
    });
    area.appendChild(label);
    area.addEventListener('click', function (event) {
      // The signed-in account row owns sign-out. Its canonical app boundary
      // clears the remembered token after local session removal; starting a
      // concurrent capture here could otherwise race and write the old token
      // back after sign-out completes.
      if (event && event.target && typeof event.target.closest === 'function'
          && event.target.closest('.sutra-cloud-account-row')) return;
      settleCloudVaultAfterInteraction();
    });
  }

  function settleCloudVaultAfterInteraction() {
    var attempts = 0;
    function check() {
      var session = readSession(CLOUD_SESSION_KEY);
      if (session && session.refreshToken) {
        captureCloudSession().catch(function () {});
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(check, 100);
    }
    setTimeout(check, 0);
  }

  function wrapCloudApi() {
    var api = global.SutraCloudSync;
    if (!api || api.__credentialVaultWrapped) return;
    api.__credentialVaultWrapped = true;
    var originalOpen = api.open;
    api.open = async function () {
      await hydrateCloudSession();
      var result = typeof originalOpen === 'function' ? originalOpen.apply(this, arguments) : undefined;
      mountCloudRememberControl();
      return result;
    };

    ['backupNow', 'listBackups', 'refreshBackupList', 'restore', 'deleteBackup'].forEach(function (name) {
      var original = api[name];
      if (typeof original !== 'function') return;
      api[name] = async function () {
        var result = await original.apply(this, arguments);
        await captureCloudSession().catch(function (error) {
          reportCredentialFailure(error, 'credential-vault.cloud-refresh');
        });
        return result;
      };
    });
  }

  function bindAssistantUi() {
    var input = document.getElementById('assistantRememberKeysInput');
    if (input) {
      input.checked = assistantRemember;
      if (input.dataset.bound !== 'true') {
        input.dataset.bound = 'true';
        input.addEventListener('change', function () {
          input.dataset.userChanged = 'true';
          var previous = assistantRemember;
          saveAssistantKeys().catch(function (error) {
            restoreAssistantRememberChoice(input, previous);
            reportCredentialFailure(error, 'credential-vault.assistant-preference', 'Could not update remembered API keys on this device.');
          });
        });
      }
    }
    var save = document.getElementById('saveChatKeysBtn');
    if (save && save.dataset.vaultBound !== 'true') {
      save.dataset.vaultBound = 'true';
      save.addEventListener('click', function () {
        setTimeout(function () {
          var previous = assistantRemember;
          saveAssistantKeys().then(function () {
            if (assistantRemember && typeof global.showToast === 'function') global.showToast('API keys saved on this device.');
          }).catch(function (error) {
            restoreAssistantRememberChoice(input, previous);
            reportCredentialFailure(error, 'credential-vault.assistant-save', 'API keys were saved for this session, but could not be remembered on this device.');
          });
        }, 0);
      });
    }
  }

  function bindCloudButton() {
    var button = document.getElementById('sutraCloudOpenBtn');
    if (!button || button.dataset.vaultBound === 'true') return;
    button.dataset.vaultBound = 'true';
    button.addEventListener('click', function () {
      setTimeout(function () {
        hydrateCloudSession().then(function () { mountCloudRememberControl(); }).catch(function () {});
      }, 0);
    });
  }

  async function initialize() {
    if (!vault()) return;
    // Bind synchronously so a user can save a key immediately after the shell
    // becomes visible, while the IndexedDB hydration continues in parallel.
    bindAssistantUi();
    wrapCloudApi();
    bindCloudButton();
    await hydrateAssistantKeys();
    await hydrateCloudSession();
  }

  function start() {
    initialize().catch(function (error) {
      try { console.warn('Device credential vault unavailable:', error); } catch (ignored) {}
    });
  }

  if (global && typeof global.addEventListener === 'function') {
    global.addEventListener('sutra:cloud-authenticated', function (event) {
      var task = authorizeFreshCloudSession().catch(function (error) {
        reportCredentialFailure(error, 'credential-vault.cloud-sign-in', 'Signed in, but Sutra could not remember this sign-in on the device.');
      });
      var pending = event && event.detail && event.detail.pending;
      if (Array.isArray(pending)) pending.push(task);
    });
  }

  if (global.document && global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}(typeof window !== 'undefined' ? window : globalThis));
