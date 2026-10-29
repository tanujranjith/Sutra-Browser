/* Cross-tab workspace write coordination (Web Locks + BroadcastChannel). */
(function (global) {
  'use strict';

  function create(options) {
    var config = options || {};
    var Locks = Object.prototype.hasOwnProperty.call(config, 'locks')
      ? config.locks
      : (global.navigator && global.navigator.locks);
    var Channel = Object.prototype.hasOwnProperty.call(config, 'BroadcastChannel')
      ? config.BroadcastChannel
      : global.BroadcastChannel;
    var lockName = String(config.lockName || 'sutra-workspace-write-v1');
    var channelName = String(config.channelName || 'sutra-workspace-events-v1');
    var now = typeof config.now === 'function' ? config.now : function () { return new Date().toISOString(); };
    var random = typeof config.random === 'function' ? config.random : Math.random;
    var tabId = String(config.tabId || ('tab-' + Date.now().toString(36) + '-' + random().toString(36).slice(2, 9)));
    var localQueue = Promise.resolve();
    var channel = null;
    var closed = false;
    var lastRemoteCommit = null;

    function clone(value) {
      if (value === undefined) return undefined;
      try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
    }

    function normalizeCommit(detail) {
      var source = detail && typeof detail === 'object' ? detail : {};
      return {
        type: 'workspace-commit',
        tabId: tabId,
        savedAt: String(source.savedAt || now()),
        reason: String(source.reason || 'save').slice(0, 80),
        hash: String(source.hash || '').slice(0, 160),
        revision: Math.max(0, Math.floor(Number(source.revision) || 0))
      };
    }

    function handleMessage(event) {
      var message = event && event.data;
      if (!message || message.type !== 'workspace-commit' || message.tabId === tabId) return;
      if (typeof message.tabId !== 'string' || typeof message.savedAt !== 'string') return;
      lastRemoteCommit = clone(message);
      if (typeof config.onRemoteCommit === 'function') config.onRemoteCommit(clone(message));
    }

    try {
      if (typeof Channel === 'function') {
        channel = new Channel(channelName);
        channel.addEventListener('message', handleMessage);
      }
    } catch (error) {
      channel = null;
    }

    function runLocalExclusive(work) {
      var run = function () { return Promise.resolve().then(work); };
      var result = localQueue.then(run, run);
      localQueue = result.then(function () {}, function () {});
      return result;
    }

    function runExclusive(work) {
      if (typeof work !== 'function') return Promise.reject(new TypeError('Workspace coordinator requires a function.'));
      if (closed) return Promise.reject(new Error('Workspace coordinator is closed.'));
      if (Locks && typeof Locks.request === 'function') {
        try { return Locks.request(lockName, { mode: 'exclusive' }, work); }
        catch (error) { return runLocalExclusive(work); }
      }
      return runLocalExclusive(work);
    }

    function publishCommit(detail) {
      var message = normalizeCommit(detail);
      if (!closed && channel) {
        try { channel.postMessage(message); } catch (error) { /* coordination is best-effort */ }
      }
      return clone(message);
    }

    function close() {
      closed = true;
      if (channel) {
        try { channel.removeEventListener('message', handleMessage); } catch (error) {}
        try { channel.close(); } catch (error) {}
      }
      channel = null;
    }

    return {
      tabId: tabId,
      runExclusive: runExclusive,
      publishCommit: publishCommit,
      getState: function () { return { tabId: tabId, closed: closed, lastRemoteCommit: clone(lastRemoteCommit) }; },
      close: close
    };
  }

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraWorkspaceCoordinator = api;
}(typeof window !== 'undefined' ? window : globalThis));
