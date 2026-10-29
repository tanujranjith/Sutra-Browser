/*
 * Device-local workspace privacy gate.
 *
 * This is intentionally independent of the canonical workspace and Sync. It
 * stores only a salted PBKDF2 verifier and timeout metadata; the raw PIN never
 * enters storage. The module executes before <body> so an enabled, valid gate
 * can suppress workspace paint before any content receives focus.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'sutra:workspaceLock:v1';
  var SIGNAL_KEY = 'sutra:workspaceLockSignal:v1';
  // A local privacy gate must remain responsive on slower WebKit devices.
  // This is deliberately not presented as encryption-at-rest protection; the
  // per-device count is persisted so it can be raised for future verifiers.
  var ITERATIONS = 120000;
  var PRESET_TIMEOUTS = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480, 720, 1440];
  var MIN_CUSTOM_TIMEOUT = 1;
  var MAX_CUSTOM_TIMEOUT = 1440;
  var config = null;
  var locked = false;
  var inactivityTimer = 0;
  var channel = null;
  var dialogPromise = null;

  function safeStorage() { return global.SutraSafeStorage || null; }
  function validPin(pin) { return /^\d{4,8}$/.test(String(pin || '')); }
  function validBase64(value, minLength) { return typeof value === 'string' && value.length >= minLength && /^[A-Za-z0-9+/]+={0,2}$/.test(value); }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.version) !== 1) return null;
    var enabled = raw.enabled === true;
    var iterations = Number(raw.iterations);
    var timeout = Number(raw.inactivityTimeout);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return null;
    if (!isValidTimeout(timeout)) return null;
    if (!validBase64(raw.salt, 20) || !validBase64(raw.verifier, 40)) return null;
    return {
      version: 1,
      enabled: enabled,
      salt: raw.salt,
      verifier: raw.verifier,
      iterations: iterations,
      inactivityTimeout: timeout
    };
  }

  function readConfig() {
    var storage = safeStorage();
    if (!storage) return null;
    return normalizeConfig(storage.get(STORAGE_KEY, { fallback: null, importance: 'important', label: 'workspace lock configuration' }));
  }

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return global.btoa(binary);
  }

  function base64ToBytes(value) {
    var binary = global.atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveVerifier(pin, salt, iterations) {
    if (!global.crypto || !global.crypto.subtle) throw new Error('Secure PIN verification is unavailable in this browser.');
    var key = await global.crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    var bits = await global.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(salt), iterations: iterations }, key, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function equalVerifier(a, b) {
    var left = String(a || '');
    var right = String(b || '');
    var mismatch = left.length ^ right.length;
    var length = Math.max(left.length, right.length);
    for (var i = 0; i < length; i += 1) mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
    return mismatch === 0;
  }

  async function verifyPin(pin, targetConfig) {
    var value = normalizeConfig(targetConfig || config);
    if (!value || !validPin(pin)) return false;
    try {
      return equalVerifier(await deriveVerifier(pin, value.salt, value.iterations), value.verifier);
    } catch (error) {
      report(error, 'verify');
      return false;
    }
  }

  function report(error, where) {
    try {
      if (typeof global.SutraReportError === 'function') global.SutraReportError(error, { where: 'workspaceLock:' + where }, 'warning');
      else if (global.console && typeof global.console.warn === 'function') global.console.warn('[SutraWorkspaceLock]', error);
    } catch (ignored) { /* diagnostics must never break the privacy gate */ }
  }

  function configMatches(a, b) {
    return !!(a && b && a.version === b.version && a.enabled === b.enabled && a.salt === b.salt && a.verifier === b.verifier && a.iterations === b.iterations && a.inactivityTimeout === b.inactivityTimeout);
  }

  function isValidTimeout(value) {
    var minutes = Number(value);
    return Number.isInteger(minutes) && minutes >= MIN_CUSTOM_TIMEOUT && minutes <= MAX_CUSTOM_TIMEOUT || minutes === 0;
  }

  function writeConfig(next) {
    var normalized = normalizeConfig(next);
    var storage = safeStorage();
    if (!normalized || !storage) return { ok: false, error: 'Browser storage is unavailable.' };
    var result = storage.set(STORAGE_KEY, normalized, { importance: 'important', label: 'workspace lock configuration' });
    if (!result || result.ok !== true) return { ok: false, error: 'Sutra could not verify this device can save the lock configuration.' };
    var readback = readConfig();
    if (!configMatches(normalized, readback)) {
      storage.remove(STORAGE_KEY, { importance: 'important', label: 'workspace lock configuration' });
      return { ok: false, error: 'Sutra could not verify the saved lock configuration. The lock was not enabled.' };
    }
    config = readback;
    return { ok: true, config: readback };
  }

  function broadcast(type) {
    var payload = { type: type, at: Date.now(), nonce: Math.random().toString(36).slice(2) };
    try { if (channel) channel.postMessage(payload); } catch (error) { report(error, 'broadcast'); }
    var storage = safeStorage();
    if (storage) storage.set(SIGNAL_KEY, payload, { importance: 'optional', label: 'workspace lock tab signal' });
  }

  function appRoot() { return document.querySelector('.app-container'); }
  function lockScreen() { return document.getElementById('sutraWorkspaceLockScreen'); }

  function applyDomState() {
    var app = appRoot();
    var screen = lockScreen();
    document.documentElement.toggleAttribute('data-sutra-workspace-locked', locked);
    if (locked) document.documentElement.setAttribute('data-sutra-workspace-locked', 'true');
    if (app) {
      app.toggleAttribute('inert', locked);
      if (locked) app.setAttribute('aria-hidden', 'true');
      else app.removeAttribute('aria-hidden');
    }
    if (screen) {
      screen.setAttribute('aria-hidden', locked ? 'false' : 'true');
      screen.toggleAttribute('inert', !locked);
    }
    if (locked) {
      global.clearTimeout(inactivityTimer);
      inactivityTimer = 0;
      global.setTimeout(function () {
        var pin = document.getElementById('sutraWorkspaceUnlockPin');
        if (pin) { pin.value = ''; pin.focus(); }
      }, 0);
    }
    updateSettingsUi();
  }

  function lock(reason, shouldBroadcast) {
    if (!config || config.enabled !== true) return false;
    locked = true;
    applyDomState();
    if (shouldBroadcast !== false) broadcast('lock');
    try { global.dispatchEvent(new CustomEvent('sutra:workspace-lock-changed', { detail: { locked: true, reason: reason || 'manual' } })); } catch (ignored) {}
    return true;
  }

  function scheduleInactivity() {
    global.clearTimeout(inactivityTimer);
    inactivityTimer = 0;
    if (locked || !config || !config.enabled || config.inactivityTimeout === 0) return;
    inactivityTimer = global.setTimeout(function () { lock('inactivity', true); }, config.inactivityTimeout * 60 * 1000);
  }

  function noteActivity() {
    if (!locked) scheduleInactivity();
  }

  async function unlock(pin) {
    if (!config || !config.enabled) {
      locked = false;
      applyDomState();
      return { ok: true };
    }
    if (!(await verifyPin(pin, config))) return { ok: false, error: 'That PIN is incorrect.' };
    locked = false;
    applyDomState();
    scheduleInactivity();
    try { global.dispatchEvent(new CustomEvent('sutra:workspace-lock-changed', { detail: { locked: false, reason: 'pin' } })); } catch (ignored) {}
    return { ok: true };
  }

  async function makeConfig(pin, timeout, enabled) {
    if (!validPin(pin)) return { ok: false, error: 'Use a 4–8 digit PIN.' };
    var minutes = Number(timeout);
    if (!isValidTimeout(minutes)) return { ok: false, error: 'Choose a duration from 1 minute to 24 hours.' };
    if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') return { ok: false, error: 'Secure random values are unavailable in this browser.' };
    var salt = bytesToBase64(global.crypto.getRandomValues(new Uint8Array(16)));
    try {
      return { ok: true, config: { version: 1, enabled: enabled !== false, salt: salt, verifier: await deriveVerifier(pin, salt, ITERATIONS), iterations: ITERATIONS, inactivityTimeout: minutes } };
    } catch (error) {
      report(error, 'create');
      return { ok: false, error: error.message || 'Could not prepare the lock.' };
    }
  }

  async function enable(pin, timeout) {
    var built = await makeConfig(pin, timeout, true);
    if (!built.ok) return built;
    var saved = writeConfig(built.config);
    if (!saved.ok) return saved;
    broadcast('config');
    lock('enabled', false);
    return { ok: true };
  }

  async function changePin(currentPin, newPin) {
    if (!config || !config.enabled) return { ok: false, error: 'The workspace lock is not enabled.' };
    if (!(await verifyPin(currentPin, config))) return { ok: false, error: 'The current PIN is incorrect.' };
    var built = await makeConfig(newPin, config.inactivityTimeout, true);
    if (!built.ok) return built;
    var saved = writeConfig(built.config);
    if (!saved.ok) return saved;
    broadcast('config');
    lock('pin-changed', false);
    return { ok: true };
  }

  async function changeTimeout(currentPin, minutes) {
    if (!config || !config.enabled) return { ok: false, error: 'The workspace lock is not enabled.' };
    var nextMinutes = Number(minutes);
    if (!isValidTimeout(nextMinutes)) return { ok: false, error: 'Choose a duration from 1 minute to 24 hours.' };
    if (!(await verifyPin(currentPin, config))) return { ok: false, error: 'The current PIN is incorrect.' };
    var next = Object.assign({}, config, { inactivityTimeout: nextMinutes });
    var saved = writeConfig(next);
    if (!saved.ok) return saved;
    broadcast('config');
    lock('timeout-changed', false);
    return { ok: true };
  }

  async function disable(currentPin) {
    if (!config || !config.enabled) return { ok: true };
    if (!(await verifyPin(currentPin, config))) return { ok: false, error: 'The current PIN is incorrect.' };
    var saved = writeConfig(Object.assign({}, config, { enabled: false }));
    if (!saved.ok) return saved;
    locked = false;
    applyDomState();
    broadcast('config');
    return { ok: true };
  }

  function updateSettingsUi() {
    if (!document.body) return;
    var enabled = !!(config && config.enabled);
    var status = document.getElementById('sutraWorkspaceLockStatus');
    var timeout = document.getElementById('sutraWorkspaceLockTimeout');
    var enableButton = document.getElementById('sutraWorkspaceLockEnableBtn');
    var lockButton = document.getElementById('sutraWorkspaceLockNowBtn');
    var changeButton = document.getElementById('sutraWorkspaceLockChangePinBtn');
    var disableButton = document.getElementById('sutraWorkspaceLockDisableBtn');
    if (status) status.textContent = enabled ? (locked ? 'Locked' : 'On') : 'Off';
    if (timeout) {
      var selectedTimeout = enabled ? config.inactivityTimeout : 5;
      timeout.value = PRESET_TIMEOUTS.indexOf(selectedTimeout) >= 0 ? String(selectedTimeout) : 'custom';
      timeout.disabled = !enabled;
    }
    var customWrap = document.getElementById('sutraWorkspaceLockCustomWrap');
    var customInput = document.getElementById('sutraWorkspaceLockCustomMinutes');
    var customSelected = timeout && timeout.value === 'custom';
    if (customWrap) customWrap.hidden = !customSelected;
    if (customInput) {
      if (enabled && customSelected) customInput.value = String(config.inactivityTimeout);
      customInput.disabled = !customSelected;
    }
    if (enableButton) enableButton.hidden = enabled;
    if (lockButton) lockButton.hidden = !enabled;
    if (changeButton) changeButton.hidden = !enabled;
    if (disableButton) disableButton.hidden = !enabled;
  }

  function ensureDialog() {
    var existing = document.getElementById('sutraWorkspaceLockDialog');
    if (existing) return existing;
    var dialog = document.createElement('dialog');
    dialog.id = 'sutraWorkspaceLockDialog';
    dialog.className = 'sutra-workspace-lock-dialog';
    dialog.innerHTML = '<form method="dialog" novalidate><h2 data-lock-dialog-title>Workspace lock</h2><p data-lock-dialog-copy></p><label data-lock-current-wrap>Current PIN<input type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="off" data-lock-current></label><label data-lock-new-wrap>New 4–8 digit PIN<input type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" data-lock-new></label><label data-lock-confirm-wrap>Confirm new PIN<input type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" data-lock-confirm></label><p data-lock-dialog-error role="alert" aria-live="assertive"></p><menu><button type="button" data-lock-cancel>Cancel</button><button type="submit" data-primary data-lock-submit>Continue</button></menu></form>'; // sutra-allow-html: reviewed static privacy-dialog chrome; PINs are read only into transient memory.
    document.body.appendChild(dialog);
    dialog.querySelector('[data-lock-cancel]').addEventListener('click', function () { dialog.close('cancel'); });
    return dialog;
  }

  function askForCredentials(options, action) {
    if (dialogPromise) return dialogPromise;
    var dialog = ensureDialog();
    var currentWrap = dialog.querySelector('[data-lock-current-wrap]');
    var newWrap = dialog.querySelector('[data-lock-new-wrap]');
    var confirmWrap = dialog.querySelector('[data-lock-confirm-wrap]');
    var currentInput = dialog.querySelector('[data-lock-current]');
    var newInput = dialog.querySelector('[data-lock-new]');
    var confirmInput = dialog.querySelector('[data-lock-confirm]');
    var error = dialog.querySelector('[data-lock-dialog-error]');
    dialog.querySelector('[data-lock-dialog-title]').textContent = options.title;
    dialog.querySelector('[data-lock-dialog-copy]').textContent = options.copy;
    dialog.querySelector('[data-lock-submit]').textContent = options.submit || 'Continue';
    currentWrap.hidden = !options.current;
    newWrap.hidden = !options.newPin;
    confirmWrap.hidden = !options.newPin;
    currentInput.value = newInput.value = confirmInput.value = error.textContent = '';
    dialogPromise = new Promise(function (resolve) {
      async function submit(event) {
        event.preventDefault();
        var currentPin = currentInput.value;
        var newPin = newInput.value;
        if (options.current && !validPin(currentPin)) { error.textContent = 'Enter your current 4–8 digit PIN.'; currentInput.focus(); return; }
        if (options.newPin && (!validPin(newPin) || newPin !== confirmInput.value)) { error.textContent = validPin(newPin) ? 'The new PINs do not match.' : 'Use a 4–8 digit new PIN.'; newInput.focus(); return; }
        var button = dialog.querySelector('[data-lock-submit]');
        button.disabled = true;
        error.textContent = 'Checking…';
        var result;
        try { result = await action({ currentPin: currentPin, newPin: newPin }); }
        catch (caught) { result = { ok: false, error: caught.message || 'The lock could not be updated.' }; report(caught, 'dialog'); }
        currentInput.value = newInput.value = confirmInput.value = '';
        button.disabled = false;
        if (!result || !result.ok) { error.textContent = result && result.error || 'The lock could not be updated.'; (options.current ? currentInput : newInput).focus(); return; }
        dialog.removeEventListener('submit', submit);
        dialog.close('success');
        resolve(result);
        dialogPromise = null;
      }
      function close() {
        if (dialog.returnValue !== 'success') {
          dialog.removeEventListener('submit', submit);
          resolve({ ok: false, cancelled: true });
          dialogPromise = null;
        }
        dialog.removeEventListener('close', close);
      }
      dialog.addEventListener('submit', submit);
      dialog.addEventListener('close', close);
      dialog.showModal();
      global.setTimeout(function () { (options.current ? currentInput : newInput).focus(); }, 0);
    });
    return dialogPromise;
  }

  function bindUi() {
    var unlockForm = document.getElementById('sutraWorkspaceUnlockForm');
    if (unlockForm) unlockForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var input = document.getElementById('sutraWorkspaceUnlockPin');
      var error = document.getElementById('sutraWorkspaceUnlockError');
      if (error) error.textContent = 'Checking…';
      var result = await unlock(input ? input.value : '');
      if (input) input.value = '';
      if (error) error.textContent = result.ok ? '' : result.error;
      if (!result.ok && input) input.focus();
    });
    var enableButton = document.getElementById('sutraWorkspaceLockEnableBtn');
    var lockButton = document.getElementById('sutraWorkspaceLockNowBtn');
    var changeButton = document.getElementById('sutraWorkspaceLockChangePinBtn');
    var disableButton = document.getElementById('sutraWorkspaceLockDisableBtn');
    var timeout = document.getElementById('sutraWorkspaceLockTimeout');
    var customWrap = document.getElementById('sutraWorkspaceLockCustomWrap');
    var customInput = document.getElementById('sutraWorkspaceLockCustomMinutes');
    var customApply = document.getElementById('sutraWorkspaceLockCustomApply');
    var customError = document.getElementById('sutraWorkspaceLockCustomError');
    function customIsSelected() { return !!(timeout && timeout.value === 'custom'); }
    function selectedTimeout() {
      if (!timeout) return 5;
      if (customIsSelected()) {
        var customMinutes = Number(customInput && customInput.value);
        return isValidTimeout(customMinutes) && customMinutes !== 0 ? customMinutes : null;
      }
      var presetMinutes = Number(timeout.value);
      return isValidTimeout(presetMinutes) ? presetMinutes : null;
    }
    function syncCustomUi() {
      var isCustom = customIsSelected();
      if (customWrap) customWrap.hidden = !isCustom;
      if (customInput) customInput.disabled = !isCustom || !config || !config.enabled;
      if (customError) customError.textContent = '';
      if (isCustom && customInput && !customInput.value) { customInput.value = '90'; customInput.focus(); }
    }
    function showCustomError(message) {
      if (customError) customError.textContent = message;
      if (customInput) customInput.focus();
    }
    function requestTimeoutChange(requested) {
      if (!isValidTimeout(requested)) { showCustomError('Enter a whole number from 1 to 1,440 minutes.'); return; }
      timeout.value = String(config && PRESET_TIMEOUTS.indexOf(requested) >= 0 ? requested : 'custom');
      askForCredentials({ title: 'Change inactivity timeout', copy: 'Enter the current PIN to change when this device locks.', current: true, submit: 'Change and lock' }, function (values) { return changeTimeout(values.currentPin, requested); }).then(function (result) {
        if (!result || !result.ok) updateSettingsUi();
      });
    }
    if (enableButton) enableButton.addEventListener('click', function () {
      var requested = selectedTimeout();
      if (requested === null) { showCustomError('Enter a whole number from 1 to 1,440 minutes.'); return; }
      askForCredentials({ title: 'Set up workspace PIN', copy: 'This PIN is stored only as a salted verifier on this device. You will need it after every refresh.', newPin: true, submit: 'Enable and lock' }, function (values) { return enable(values.newPin, requested); });
    });
    if (lockButton) lockButton.addEventListener('click', function () { lock('manual', true); });
    if (changeButton) changeButton.addEventListener('click', function () {
      askForCredentials({ title: 'Change workspace PIN', copy: 'Enter the current PIN, then choose a new one.', current: true, newPin: true, submit: 'Change and lock' }, function (values) { return changePin(values.currentPin, values.newPin); });
    });
    if (disableButton) disableButton.addEventListener('click', function () {
      askForCredentials({ title: 'Disable workspace lock', copy: 'Enter the current PIN to remove the privacy gate from future refreshes.', current: true, submit: 'Disable lock' }, function (values) { return disable(values.currentPin); });
    });
    if (timeout) timeout.addEventListener('change', function () {
      syncCustomUi();
      if (customIsSelected()) return;
      requestTimeoutChange(Number(timeout.value));
    });
    if (customApply) customApply.addEventListener('click', function () { if (config && config.enabled) requestTimeoutChange(selectedTimeout()); });
    if (customInput) customInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); if (config && config.enabled) requestTimeoutChange(selectedTimeout()); } });
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (name) { document.addEventListener(name, noteActivity, { capture: true, passive: name !== 'keydown' }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) noteActivity(); });
    document.addEventListener('focusin', function (event) {
      var screen = lockScreen();
      if (locked && screen && !screen.contains(event.target)) {
        event.stopPropagation();
        var pin = document.getElementById('sutraWorkspaceUnlockPin');
        if (pin) pin.focus();
      }
    }, true);
    applyDomState();
    syncCustomUi();
  }

  function receiveExternal(type) {
    if (type === 'lock') { config = readConfig() || config; lock('another-tab', false); return; }
    if (type === 'config') {
      config = readConfig();
      if (config && config.enabled) lock('configuration-changed', false);
      else { locked = false; applyDomState(); }
    }
  }

  config = readConfig();
  locked = !!(config && config.enabled);
  if (locked) document.documentElement.setAttribute('data-sutra-workspace-locked', 'true');
  try {
    if ('BroadcastChannel' in global) {
      channel = new global.BroadcastChannel('sutra-workspace-lock-v1');
      channel.addEventListener('message', function (event) { receiveExternal(event.data && event.data.type); });
    }
  } catch (error) { report(error, 'channel'); }
  global.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) receiveExternal('config');
    if (event.key === SIGNAL_KEY && event.newValue) receiveExternal('lock');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi, { once: true });
  else bindUi();

  global.SutraWorkspaceLock = {
    lock: function () { return lock('manual', true); },
    unlock: unlock,
    enable: enable,
    changePin: changePin,
    changeTimeout: changeTimeout,
    disable: disable,
    verifyPin: verifyPin,
    getStatus: function () { return { enabled: !!(config && config.enabled), locked: locked, inactivityTimeout: config ? config.inactivityTimeout : 5 }; },
    _test: { normalizeConfig: normalizeConfig, validPin: validPin, equalVerifier: equalVerifier, deriveVerifier: deriveVerifier, isValidTimeout: isValidTimeout }
  };
}(window));
