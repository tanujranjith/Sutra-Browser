/* Declarative optional feature packs. Runtime code consumes this as data only. */
(function (global) {
  'use strict';
  global.SUTRA_FEATURE_MANIFEST = Object.freeze({
    business: Object.freeze({
      id: 'business', displayName: 'Business Pack', pack: 'work', defaultEnabled: false,
      dependencies: [],
      scripts: ['./src/features/workspace/business-workspace.js?v=20260807-opsqueue1'],
      styles: [],
      initialization: 'NoteFlowBusiness.init', teardown: 'NoteFlowBusiness.teardown',
      navigationEntries: ['business'], persistenceNamespace: 'businessWorkspace',
      assistantCapabilities: ['business'], searchIntegration: ['business'], commandIntegration: ['open-business']
    }),
    assistant: Object.freeze({
      id: 'assistant', displayName: 'Sutra Assistant', pack: 'assistant', defaultEnabled: true,
      dependencies: [],
      scripts: [
        './src/domain/notes-knowledge-core.js?v=20260711-knowledge1',
        './src/features/assistant/assistant-core.js?v=20260714-assistant-trust1',
        './src/features/assistant/assistant-safety.js?v=20260714-intel1',
        './src/features/assistant/model-capabilities.js?v=20260807-providers1',
        './src/features/assistant/intelligence-diagnostics.js?v=20260714-intel1',
        './src/features/assistant/sutra-product-knowledge.js?v=20260913-locked-assistant-knowledge2',
        './src/features/assistant/sutra-capability-registry.js?v=20260807-surfaces2',
        './src/features/assistant/action-system.js?v=20260807-agentplans2',
        './src/features/assistant/note-patch-system.js?v=20260711-note-patch1',
        './src/features/assistant/flow-intelligence.js?v=20260825-oxremed1',
        './src/features/assistant/flow-assistant.js?v=20260913-locked-assistant-flow2',
        './src/features/assistant/sutra-assistant-memory.js?v=20260913-locked-assistant-memory1',
        './src/features/assistant/sutra-local-help.js?v=20260816-home-create1'
      ],
      styles: [
        './styles/features/sutra-assistant-help.css?v=20260729-providerwiz1',
        './styles/features/sutra-intelligence.css?v=20260610-intel1',
        './styles/views/assistant-view.css?v=20260818-cache-refresh1'
      ],
      initialization: 'sutraAssistant.init', teardown: 'sutraAssistant.teardown',
      navigationEntries: ['assistantview'], persistenceNamespace: 'assistantChatHistory',
      assistantCapabilities: ['*'], searchIntegration: ['assistant'], commandIntegration: ['open-assistant']
    })
  });
}(typeof window !== 'undefined' ? window : globalThis));
