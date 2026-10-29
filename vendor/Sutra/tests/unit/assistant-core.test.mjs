import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = require('../../src/features/assistant/assistant-core.js');

test('canonical models preserve grounded source metadata and note scope', () => {
  const chat = core.normalizeConversation({ id: 'c1', scope: { type: 'note', noteId: 'n1' }, messages: [{ role: 'assistant', content: 'Grounded', claimType: 'workspace_fact', receipt: { schema: 'sutra-assistant-receipt/1', provider: 'Mock', apiKey: 'sk-unit-secret-1234567890' }, sources: [{ noteId: 'n1', title: 'One', quote: 'Exact evidence', href: 'sutra://page/n1', confidence: 'high' }] }] });
  assert.equal(chat.scope.noteId, 'n1');
  assert.equal(chat.messages[0].sources[0].quote, 'Exact evidence');
  assert.equal(chat.messages[0].sources[0].confidence, 'high');
  assert.equal(chat.messages[0].claimType, 'workspace_fact');
  assert.equal(chat.messages[0].receipt.provider, 'Mock');
  assert.equal(JSON.stringify(chat.messages[0].receipt).includes('unit-secret'), false);
});

test('one controller notifies all registered shells from the same state', () => {
  const controller = core.createController();
  const panel = [], full = [];
  controller.registerShell('panel', (state) => panel.push(state));
  controller.registerShell('full', (state) => full.push(state));
  controller.load({ conversations: [{ id: 'c1', title: 'Shared', messages: [] }], currentConversationId: 'c1' });
  controller.addMessage({ role: 'user', content: 'Hello' });
  assert.equal(panel.at(-1).conversations[0].messages[0].content, 'Hello');
  assert.deepEqual(panel.at(-1), full.at(-1));
});

test('canonical render model gives both shells identical visible content, actions, and grounding', () => {
  const raw = {
    id: 'message-1',
    createdAt: '2026-07-12T12:00:00.000Z',
    role: 'assistant',
    content: '<think>private plan</think>Visible answer\n```flow-actions\n[{"type":"create_page","title":"A","body":"B"}]\n```',
    sources: [{ id: 'chunk-1', noteId: 'n1', title: 'Source', quote: 'Evidence' }],
    claimType: 'workspace_fact',
    memoryUsedIds: ['m1'],
    receipt: { schema: 'sutra-assistant-receipt/1', local: false, provider: 'Mock', createdAt: '2026-07-12T12:00:00.000Z' }
  };
  const options = {
    splitContent: content => ({ thoughts: ['private plan'], clean: content.replace(/<think>[\s\S]*?<\/think>/, '').trim() }),
    parseActions: clean => ({ cleanText: clean.split('```flow-actions')[0].trim(), actions: [{ type: 'create_page', title: 'A', body: 'B' }] })
  };
  const dock = core.prepareMessageView(raw, options);
  const full = core.prepareMessageView(raw, options);
  assert.deepEqual(dock, full);
  assert.equal(dock.displayedContent, 'Visible answer');
  assert.deepEqual(dock.thoughts, []);
  assert.equal(dock.receipt.provider, 'Mock');
  assert.equal(dock.actions.length, 1);
  assert.equal(dock.sources[0].noteId, 'n1');
  assert.equal(dock.claimType, 'workspace_fact');
});
