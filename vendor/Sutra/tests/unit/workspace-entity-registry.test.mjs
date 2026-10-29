import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const singleton = require('../../src/domain/workspace-entity-registry.js');
const adaptersModule = require('../../src/features/workspace/workspace-entity-adapters.js');

function createRegistry(errors = []) {
  return singleton.createWorkspaceEntityRegistry({
    onError(error, context) {
      errors.push({ error, context });
    }
  });
}

function basicAdapter(overrides = {}) {
  return {
    id: 'note',
    label: 'Notes',
    singularLabel: 'note',
    collect: () => [{ id: 'n1', title: 'Chemistry', text: 'Covalent bonds', metadata: { course: 'chem' } }],
    open: () => true,
    actions: {
      review: { label: 'Create review cards', kind: 'study', run: () => true }
    },
    ...overrides
  };
}

test('normalizes stable entities and exposes declarative adapter capabilities', () => {
  const registry = createRegistry();
  registry.registerAdapter(basicAdapter());

  const [entity] = registry.collect();
  assert.equal(entity.key, 'note:n1');
  assert.equal(entity.type, 'note');
  assert.equal(entity.title, 'Chemistry');
  assert.equal(entity.text, 'Covalent bonds');
  assert.deepEqual(entity.metadata, { course: 'chem' });
  assert.equal(Object.isFrozen(entity), true);

  const [adapter] = registry.listAdapters();
  assert.equal(adapter.id, 'note');
  assert.equal(adapter.capabilities.open, true);
  assert.deepEqual(adapter.capabilities.actions, ['review']);
});

test('locked entities redact content and are excluded from searchable collection', () => {
  const registry = createRegistry();
  registry.registerAdapter(basicAdapter({
    lockedLabel: 'Locked note',
    collect: () => [{
      id: 'secret',
      title: 'Private therapy notes',
      text: 'content must never leak',
      keywords: ['therapy'],
      privacy: { locked: true, private: true }
    }]
  }));

  const [locked] = registry.collect();
  assert.equal(locked.title, 'Locked note');
  assert.equal(locked.text, '');
  assert.deepEqual(locked.keywords, []);
  assert.equal(locked.privacy.searchable, false);
  assert.equal(locked.privacy.private, true);
  assert.deepEqual(registry.collectSearchable(), []);
});

test('metadata drops credential-shaped keys recursively', () => {
  const registry = createRegistry();
  registry.registerAdapter(basicAdapter({
    collect: () => [{
      id: 'safe',
      title: 'Safe record',
      metadata: {
        course: 'Physics',
        apiKey: 'must-not-leak',
        nested: { accessToken: 'must-not-leak', value: 'kept' }
      }
    }]
  }));

  const [entity] = registry.collect();
  assert.deepEqual(entity.metadata, { course: 'Physics', nested: { value: 'kept' } });
});

test('deduplicates entity keys and isolates adapter failures', () => {
  const errors = [];
  const registry = createRegistry(errors);
  registry.registerAdapter(basicAdapter({
    collect: () => [
      { id: 'n1', title: 'First' },
      { id: 'n1', title: 'Duplicate' },
      { title: 'Missing id' }
    ]
  }));
  registry.registerAdapter({
    id: 'broken',
    label: 'Broken',
    collect() {
      throw new Error('boom');
    }
  });

  assert.deepEqual(registry.collect().map((entity) => entity.title), ['First']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.adapterId, 'broken');
});

test('resolves exact entities and delegates open and enabled actions', async () => {
  const calls = [];
  const registry = createRegistry();
  registry.registerAdapter(basicAdapter({
    open(entity) {
      calls.push(['open', entity.key]);
      return true;
    },
    actions: {
      review: {
        label: 'Create review cards',
        kind: 'study',
        available: () => true,
        run(entity) {
          calls.push(['review', entity.key]);
          return true;
        }
      },
      disabled: {
        label: 'Disabled',
        run: () => true,
        available: () => false
      }
    }
  }));

  assert.equal(registry.find('note:n1').title, 'Chemistry');
  assert.deepEqual(registry.getActions('note:n1'), [
    { id: 'open', label: 'Open', kind: 'primary', enabled: true },
    { id: 'review', label: 'Create review cards', kind: 'study', enabled: true },
    { id: 'disabled', label: 'Disabled', kind: 'secondary', enabled: false }
  ]);
  assert.equal((await registry.open('note:n1')).ok, true);
  assert.equal((await registry.runAction('note:n1', 'review')).ok, true);
  assert.equal((await registry.runAction('note:n1', 'disabled')).code, 'action_disabled');
  assert.deepEqual(calls, [['open', 'note:n1'], ['review', 'note:n1']]);
});

test('publishes bounded invalidation events for a future incremental index', () => {
  const registry = createRegistry();
  const events = [];
  const unsubscribe = registry.subscribe((event) => events.push(event));
  registry.registerAdapter(basicAdapter());
  registry.invalidate('workspace-persist', ['note', 'task', 'note']);
  unsubscribe();
  registry.invalidate('ignored-after-unsubscribe');

  assert.equal(events.length, 2);
  assert.equal(events[1].reason, 'workspace-persist');
  assert.deepEqual(events[1].types, ['note', 'task']);
  assert.ok(events[1].revision > events[0].revision);
});

test('browser adapters cover the connected student loop and preserve locked-note privacy', async () => {
  const calls = [];
  const previous = {
    flowAtelier: globalThis.flowAtelier,
    openHomeworkTaskModal: globalThis.openHomeworkTaskModal,
    openClassDashboardDrawer: globalThis.openClassDashboardDrawer,
    cwSetCourseTab: globalThis.cwSetCourseTab,
    openReviewDeck: globalThis.openReviewDeck,
    SutraHomework: globalThis.SutraHomework
  };

  globalThis.flowAtelier = {
    unlockedPageIds: new Set(['open-note']),
    getWorkspaceEntitySources: () => ({
      pages: [
        { id: 'open-note', title: 'Cell respiration', content: '<p>ATP and mitochondria</p>', tags: ['biology'] },
        { id: 'locked-note', title: 'Hidden title', content: 'hidden body', isLocked: true }
      ],
      tasks: [{ id: 'task-1', title: 'Read chapter 4', notes: 'Take notes', dueDate: '2026-08-01' }],
      timeBlocks: [{ id: 'block-1', name: 'Biology review', date: '2026-08-01', start: '16:00', end: '16:30' }],
      homeworkWorkspace: {
        courses: [{ id: 'bio', name: 'Biology' }],
        tasks: [{
          id: 'hw-1',
          title: 'Lab report',
          courseId: 'bio',
          studio: { milestones: [{ id: 'm1', title: 'Write conclusion' }] }
        }]
      },
      courseWorkspace: {
        courses: [{ id: 'bio', name: 'Biology', teacher: 'Dr. Rivera' }],
        files: [{ id: 'file-1', courseId: 'bio', name: 'Lab rubric.pdf', mimeType: 'application/pdf' }]
      },
      reviewWorkspace: {
        decks: [{ id: 'deck-1', name: 'Biology Unit 1' }],
        items: [{ id: 'card-1', deckId: 'deck-1', prompt: 'What is ATP?', answer: 'Energy carrier' }]
      },
      academicWorkspace: {},
      apStudyWorkspace: {},
      testingHub: {},
      gradePlanner: {},
      collegeAppWorkspace: {},
      collegeTracker: {},
      lifeWorkspace: {},
      businessWorkspace: {},
      customTabs: [{ id: 'dashboard', name: 'My Dashboard' }],
      assistantChatHistory: { conversations: [{ id: 'chat-1', title: 'Biology help', messages: [{ content: 'Explain ATP' }] }] },
      portfolioWorkspace: { entries: [] },
      focusTemplates: [],
      privateDocuments: [{ id: 'private-1', name: 'Private transcript', content: 'must not index' }],
      trash: []
    }),
    setActiveView(view) {
      calls.push(['view', view]);
      return true;
    },
    loadPage(id) {
      calls.push(['page', id]);
    },
    openTaskModal(id) {
      calls.push(['task', id]);
      return true;
    },
    openClassDashboardDrawer(id) {
      calls.push(['course', id]);
      return true;
    }
  };
  globalThis.openHomeworkTaskModal = (version, id) => {
    calls.push(['homework', version, id]);
    return true;
  };
  globalThis.cwSetCourseTab = (tab) => calls.push(['course-tab', tab]);
  globalThis.openReviewDeck = (id) => calls.push(['deck', id]);
  globalThis.SutraHomework = { markDone: () => true };

  try {
    const registry = createRegistry();
    adaptersModule.createAdapterDefinitions().forEach((definition) => registry.registerAdapter(definition));
    const searchable = registry.collectSearchable();
    const types = new Set(searchable.map((entity) => entity.type));

    for (const type of ['note', 'task', 'homework', 'assignment_milestone', 'course', 'course_file', 'timeline_block', 'review_deck', 'review_card', 'custom_tab', 'assistant_conversation']) {
      assert.equal(types.has(type), true, type);
    }
    assert.equal(searchable.some((entity) => entity.key === 'note:locked-note'), false);
    assert.equal(searchable.some((entity) => entity.key === 'private_document:private-1'), false);
    assert.equal(searchable.find((entity) => entity.key === 'note:open-note').text.includes('ATP'), true);

    assert.equal((await registry.open('note:open-note')).ok, true);
    assert.equal((await registry.open('homework:hw-1')).ok, true);
    assert.equal((await registry.open('course:bio')).ok, true);
    assert.deepEqual(calls.slice(0, 5), [
      ['view', 'notes'],
      ['page', 'open-note'],
      ['homework', 'v2', 'hw-1'],
      ['course', 'bio'],
      ['course-tab', 'overview']
    ]);
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  }
});
