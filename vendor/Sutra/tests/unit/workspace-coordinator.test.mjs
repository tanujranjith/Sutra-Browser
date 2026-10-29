import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const coordinatorApi = require('../../src/persistence/workspace-coordinator.js');

class FakeChannel {
  static channels = new Map();
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    const list = FakeChannel.channels.get(name) || new Set();
    list.add(this);
    FakeChannel.channels.set(name, list);
  }
  addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
  postMessage(data) {
    for (const peer of FakeChannel.channels.get(this.name) || []) {
      if (peer === this) continue;
      for (const listener of peer.listeners) listener({ data: JSON.parse(JSON.stringify(data)) });
    }
  }
  close() { (FakeChannel.channels.get(this.name) || new Set()).delete(this); }
}

test('broadcasts commits to other tabs without echoing to the writer', () => {
  FakeChannel.channels.clear();
  const received = [];
  const first = coordinatorApi.create({ BroadcastChannel: FakeChannel, tabId: 'one', now: () => '2026-07-10T12:00:00.000Z' });
  const second = coordinatorApi.create({ BroadcastChannel: FakeChannel, tabId: 'two', onRemoteCommit: detail => received.push(detail) });
  const sent = first.publishCommit({ reason: 'autosave', hash: 'abc', revision: 4 });
  assert.equal(sent.tabId, 'one');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], sent);
  assert.deepEqual(second.getState().lastRemoteCommit, sent);
  assert.equal(first.getState().lastRemoteCommit, null);
  first.close(); second.close();
});

test('uses Web Locks when available', async () => {
  const calls = [];
  const locks = { request: async (name, options, work) => { calls.push({ name, options }); return work(); } };
  const coordinator = coordinatorApi.create({ locks, BroadcastChannel: null, tabId: 'lock-tab' });
  const result = await coordinator.runExclusive(async () => 42);
  assert.equal(result, 42);
  assert.deepEqual(calls, [{ name: 'sutra-workspace-write-v1', options: { mode: 'exclusive' } }]);
});

test('fallback queue serializes writes and continues after rejection', async () => {
  const coordinator = coordinatorApi.create({ locks: null, BroadcastChannel: null, tabId: 'queue-tab' });
  const order = [];
  const first = coordinator.runExclusive(async () => { order.push('first-start'); await Promise.resolve(); order.push('first-end'); throw new Error('nope'); });
  const second = coordinator.runExclusive(async () => { order.push('second'); return 'ok'; });
  await assert.rejects(first, /nope/);
  assert.equal(await second, 'ok');
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
