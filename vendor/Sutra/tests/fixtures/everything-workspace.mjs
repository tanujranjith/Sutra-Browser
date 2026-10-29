// Synthetic full-portability fixture. It contains no credentials, tokens,
// passphrases, recovery material, or real user data.
export const EVERYTHING_STAMP = '2026-07-16T12:34:56.000Z';
export const EVERYTHING_INLINE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/2W8XWQAAAABJRU5ErkJggg==';
export const EVERYTHING_ATTACHMENT = 'data:text/plain;base64,U3ludGhldGljIFN1dHJhIHBhcml0eSBhdHRhY2htZW50Lg==';
export const EVERYTHING_PDF = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iago=';

const clone = value => JSON.parse(JSON.stringify(value ?? {}));
const atomic = (base, key, extra = {}) => ({
  ...(base && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? clone(base[key]) : {}),
  paritySentinel: key + '-parity',
  ...extra
});

export const EVERYTHING_ASSISTANT_HISTORY = {
  version: 1,
  legacyMigrationComplete: true,
  currentChatId: 'chat-parity-main',
  conversations: [{
    id: 'chat-parity-main',
    title: 'Parity planning conversation',
    createdAt: EVERYTHING_STAMP,
    updatedAt: '2026-07-16T12:36:00.000Z',
    providerLabel: 'Synthetic local provider',
    modelLabel: 'synthetic-model',
    archived: false,
    pinned: true,
    restoredFromBackup: false,
    scope: { type: 'workspace', pageIds: ['page-child'], courseIds: ['course-parity'] },
    messages: [{
      id: 'msg-parity-user', role: 'user',
      content: 'Build a synthetic study plan from my parity note.',
      createdAt: EVERYTHING_STAMP,
      contextTags: [{ icon: 'fa-note-sticky', label: 'Parity child note' }],
      restoredFromBackup: false
    }, {
      id: 'msg-parity-assistant', role: 'assistant',
      content: 'Start with the linked note, then review the synthetic cards.',
      createdAt: '2026-07-16T12:35:00.000Z',
      claimType: 'workspace_fact',
      memoryUsedIds: ['memory-parity-1'],
      providerLabel: 'Synthetic local provider',
      modelLabel: 'synthetic-model',
      favorite: true,
      partial: false,
      restoredFromBackup: false,
      sources: [{
        id: 'source-parity-1', kind: 'note', noteId: 'page-child',
        blockId: 'block-rich', title: 'Parity Parent::Parity Child',
        headingPath: ['Evidence'], quote: 'Unique parity evidence.',
        href: 'sutra://page/page-child', updatedAt: EVERYTHING_STAMP,
        version: 'version-parity', sourceOffsets: null, score: 0, confidence: 'high',
        reasonCodes: ['exact-match'], safetyFlags: [], stale: false
      }],
      grounding: {
        evidenceStatus: 'supported', query: 'synthetic parity query',
        scope: { pageIds: ['page-child'], kinds: ['note'] }
      },
      receipt: {
        schema: 'sutra-assistant-receipt/1',
        status: 'completed', local: true, dataTransmitted: false,
        transmittedCategories: [], deterministicEngines: ['Sutra Intelligence'],
        areasInspected: ['notes'], actionsProposed: ['create_task'],
        sources: [], memoryUsedIds: ['memory-parity-1'],
        createdAt: '2026-07-16T12:35:01.000Z'
      }
    }]
  }, {
    id: 'chat-parity-empty', title: 'Durable empty thread', messages: [],
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
    providerLabel: '', modelLabel: '', archived: true, pinned: false,
    scope: { type: 'workspace' }
  }]
};

export const EVERYTHING_LOCAL_STATE = {
  chat_provider: 'local',
  chat_model_by_provider: JSON.stringify({ local: 'synthetic-model', openai: 'safe-model-name-only' }),
  chat_custom_model_by_provider: JSON.stringify({ local: 'synthetic-custom-model' }),
  'sutra:activityLog:v1': JSON.stringify([{ id: 'activity-parity', type: 'assistant-action', at: EVERYTHING_STAMP }]),
  'flow:activityLog:v1': JSON.stringify([{ id: 'legacy-activity-parity', at: EVERYTHING_STAMP }]),
  'sutra:assistantMemory:v1': JSON.stringify({
    version: 1,
    items: [{ id: 'memory-parity-1', text: 'Prefers synthetic review sessions.', createdAt: EVERYTHING_STAMP, enabled: true }]
  }),
  'sutra:starterPacks:custom:v1': JSON.stringify([{ id: 'pack-parity', name: 'Synthetic Pack', views: ['today', 'notes'] }]),
  'hwCountdownPins:v1': JSON.stringify(['homework-task-parity'])
};

export function createEverythingWorkspace(baseWorkspace = {}) {
  const base = clone(baseWorkspace);
  const settings = base.settings && typeof base.settings === 'object' ? clone(base.settings) : {};
  const preferences = settings.preferences && typeof settings.preferences === 'object' ? settings.preferences : {};
  return {
    ...base,
    version: 8,
    schema: { name: 'sutra-workspace', version: 8, paritySentinel: 'schema-parity' },
    migrationHistory: [
      { id: 'v5->v6', from: 5, to: 6, appliedAt: EVERYTHING_STAMP, paritySentinel: 'migration-parity' },
      { id: 'v6->v7', from: 6, to: 7, appliedAt: EVERYTHING_STAMP, paritySentinel: 'assistant-history-parity' },
      { id: 'v7->v8', from: 7, to: 8, appliedAt: EVERYTHING_STAMP, paritySentinel: 'pdf-workspace-parity' }
    ],
    pages: [{
      id: 'page-parent', title: 'Parity Parent', type: 'note',
      content: '<p>Parent sentinel.</p>', blocks: [], icon: 'folder',
      collapsed: false, theme: 'default', spaceId: 'space-school',
      createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP,
      isTemporary: false, temporaryCreatedAt: null, temporaryExpiresAt: null,
      isLocked: false, lockHash: null, lockSalt: null, lockedAt: null,
      lockAutoLock: 'navigation', canvas: null,
      htmlDocument: {
        version: 1,
        source: '<!doctype html><html><body><h1>HTML parity sentinel.</h1></body></html>',
        createdAt: EVERYTHING_STAMP,
        updatedAt: EVERYTHING_STAMP,
        futureHtmlField: { keep: true }
      },
      slides: { version: 1, theme: 'sutra', size: 'widescreen', slides: [{
        id: 'slide-parity', layout: 'title', title: 'Parity Slides', speakerNotes: 'Slide note sentinel.',
        elements: [{ id: 'slide-text-parity', type: 'text', x: 10, y: 10, width: 70, height: 12, text: 'Unique slide evidence.' }]
      }] },
      spreadsheet: {
        version: 1, title: 'Parity workbook', namedRanges: { total: 'Sheet1!B1' },
        styles: { bold: { fontWeight: '700' } },
        sheets: [{
          id: 'sheet-parity', name: 'Sheet1',
          rows: [{ id: 'row-parity-1', height: 28 }],
          columns: [{ id: 'col-parity-a', width: 120 }, { id: 'col-parity-b', width: 120 }],
          cells: {
            'row-parity-1:col-parity-a': { value: 7, formula: '', styleId: 'bold', note: 'Spreadsheet parity sentinel.', validation: null },
            'row-parity-1:col-parity-b': { value: '', formula: '=A1*2', styleId: '', note: '', validation: null }
          },
          merges: [], frozen: { rows: 1, columns: 0 }, filters: []
        }]
      },
      isSystemPage: false,
      builtInId: '', systemRole: '', pageMode: { enabled: false },
      documentBackground: { enabled: false }, formatting: {},
      documentLayout: {}, comments: [], suggestions: [], footnotes: [],
      citations: [], tags: [{ name: 'parent', color: '#4f46e5' }], versions: []
    }, {
      id: 'page-child', title: 'Parity Parent::Parity Child', type: 'note',
      content: '<h2>Evidence</h2><p>Unique parity evidence.</p><img alt="inline parity" src="' + EVERYTHING_INLINE_IMAGE + '">',
      blocks: [
        { id: 'block-rich', type: 'paragraph', text: 'Rich block parity', createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP },
        { id: 'block-drawing', type: 'drawing', background: 'grid', heightPx: 320, createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP,
          strokes: [{ id: 'stroke-parity', tool: 'pen', color: '#123456', width: 0.01, opacity: 1, createdAt: EVERYTHING_STAMP,
            points: [{ x: 0.1, y: 0.2, p: 0.5 }, { x: 0.8, y: 0.7, p: 0.9 }] }] }
      ],
      icon: 'doc', collapsed: false, theme: 'dark', spaceId: 'space-school',
      createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP,
      isLocked: true, lockHash: 'synthetic-lock-hash',
      lockSalt: 'synthetic-lock-salt', lockedAt: EVERYTHING_STAMP, lockAutoLock: 'session',
      lockDuressVerifier: 'v1$00000000000000000000000000000000$1111111111111111111111111111111111111111111111111111111111111111',
      pageMode: { enabled: true, size: 'a4', margins: { top: 18, bottom: 19, left: 20, right: 21 } },
      documentBackground: { enabled: true, dataUrl: EVERYTHING_INLINE_IMAGE, blurPx: 3, overlayOpacity: 0.2, name: 'parity-background.png', mimeType: 'image/png' },
      formatting: { fontFamily: 'Georgia', fontSize: '18', lineHeight: '1.7', textColor: '#112233', alignment: 'justify' },
      documentLayout: { header: { enabled: true, content: 'Parity Header' }, footer: { enabled: true, content: 'Parity Footer' }, pageNumbers: { enabled: true, position: 'bottom-center', startAt: 3 } },
      comments: [{ id: 'comment-parity', text: 'Synthetic comment', createdAt: EVERYTHING_STAMP }],
      suggestions: [{ id: 'suggestion-parity', type: 'insert', text: 'Synthetic suggestion', createdAt: EVERYTHING_STAMP }],
      footnotes: [{ id: 'footnote-parity', text: 'Synthetic footnote' }],
      citations: [{ id: 'citation-parity', title: 'Synthetic source', url: 'https://example.invalid/source' }],
      tags: [{ name: 'parity', color: '#0f766e' }],
      versions: [{ id: 'version-parity', label: 'Parity snapshot', savedAt: EVERYTHING_STAMP,
        state: { title: 'Parity Parent::Parity Child', content: '<p>Version sentinel.</p>', tags: [{ name: 'version', color: '#111827' }] } }]
    }],
    spaces: [{ id: 'space-school', name: 'Synthetic School', icon: 'graduation-cap', color: '#4f46e5', createdAt: EVERYTHING_STAMP }],
    tasks: [{
      id: 'task-parity-a', title: 'Complete synthetic parity audit',
      notes: 'Task notes sentinel', priority: 'high', difficulty: 'hard',
      status: 'in_progress', completed: false,
      isActive: true, scheduleType: 'weekly', weeklyDays: ['monday'],
      estimate: 50, category: 'learning',
      subtasks: [{ id: 'subtask-parity', title: 'Check Assistant history', completed: true }],
      dependencies: ['task-parity-b'], dueDate: '2026-07-20', dueTime: '17:30',
      reminder: { enabled: true, minutesBefore: 45 },
      recurrence: { frequency: 'weekly', interval: 1 },
      noteId: 'page-child', courseId: 'course-parity',
      createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
    }, {
      id: 'task-parity-b', title: 'Review synthetic evidence', notes: '',
      priority: 'medium', difficulty: 'medium', status: 'todo',
      completed: false, isActive: true, scheduleType: 'once', weeklyDays: [],
      estimate: 0, category: 'none',
      createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
    }],
    taskOrder: ['task-parity-b', 'task-parity-a'],
    timeBlocks: [{
      id: 'time-parity', title: 'Parity study block', name: 'Parity study block', date: '2026-07-18',
      startTime: '16:00', endTime: '16:45', start: '16:00', end: '16:45', category: 'study', color: '#6079d8',
      recurrence: 'weekly', weeklyDays: [6], recurrenceUntil: '2026-08-15', recurrenceExceptions: [],
      preserveRecurrence: true, importedRecurrence: false, isAllDay: false, notes: 'Everything fixture calendar block.',
      referenceUrl: '', source: 'sutra', sourceUid: '', calendarImportId: '', calendarName: 'Sutra', calendarUid: '',
      calendarRecurrenceId: '', calendarTimeZone: 'America/Grand_Turk', calendarRrule: '',
      taskId: 'task-parity-a', noteId: 'page-child', protected: true, createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
    }],
    streaks: { dayStates: { '2026-07-16': 'complete' }, taskStreaks: { 'task-parity-a': 4 }, streakState: { globalCurrent: 4, globalBest: 9, globalLastKeptDateKey: '2026-07-16', freezesRemainingThisWeek: 1, freezeWeekKey: '2026-W29' } },
    habitTracker: { habits: [{ id: 'habit-parity', name: 'Review parity cards', frequency: 'daily' }], dayStates: { 'habit-parity:2026-07-16': true } },
    collegeTracker: atomic(base, 'collegeTracker', {
      activeTab: 'research',
      research: [{ id: 'college-research-parity', college: 'Synthetic University', notes: 'Research sentinel' }],
      checklist: [{ id: 'college-check-parity', task: 'Synthetic checklist', completed: false }],
      deadlines: [{ id: 'college-deadline-parity', college: 'Synthetic University', date: '2026-11-01' }],
      essays: [{ id: 'college-essay-parity', title: 'Parity essay', status: 'drafting' }],
      prompts: [{ id: 'college-prompt-parity', prompt: 'Describe a synthetic experience.', completed: false }]
    }),
    academicWorkspace: atomic(base, 'academicWorkspace', {
      onboardingSeeded: false,
      classes: [{ id: 'academic-class-parity', name: 'Synthetic Calculus', teacher: 'Professor Example' }],
      assignments: [{ id: 'academic-assignment-parity', title: 'Synthetic problem set', classId: 'academic-class-parity', className: 'Synthetic Calculus', dueDate: '2026-07-22', notes: 'Assignment Studio sentinel', milestones: [{ id: 'milestone-parity', title: 'Outline', done: false }] }],
      exams: [{ id: 'academic-exam-parity', title: 'Synthetic midterm', className: 'Synthetic Calculus', date: '2026-07-30' }],
      notesTemplates: [{ id: 'academic-template-parity', title: 'Synthetic template', content: '<p>Template sentinel</p>' }],
      flashcards: [{ id: 'academic-card-parity', front: 'Derivative?', back: 'Synthetic answer' }],
      extracurriculars: [{ id: 'academic-extra-parity', name: 'Synthetic Club', role: 'Auditor' }]
    }),
    collegeAppWorkspace: atomic(base, 'collegeAppWorkspace', {
      setupDismissed: true,
      collegeTracker: [{ id: 'app-school-parity', name: 'Synthetic University', status: 'in_progress' }],
      essayOrganizer: [{ id: 'app-essay-parity', schoolId: 'app-school-parity', title: 'Main essay', draft: 'Synthetic draft.' }],
      scoreTracker: [{ id: 'score-parity', testType: 'SAT', score: 1500 }],
      awardsHonors: [{ id: 'award-parity', title: 'Synthetic Honor' }],
      recommenders: [{ id: 'recommender-parity', name: 'Teacher Example' }],
      scholarships: [{ id: 'scholarship-parity', name: 'Synthetic Scholarship' }],
      activities: [{ id: 'activity-college-parity', name: 'Synthetic Club', role: 'Lead', order: 1 }],
      applicationCosts: [{ id: 'cost-parity', schoolId: 'app-school-parity', amount: 75 }],
      financialAidDeadlines: [{ id: 'aid-parity', schoolId: 'app-school-parity', name: 'Synthetic Aid', dueDate: '2026-12-01' }]
    }),
    lifeWorkspace: atomic(base, 'lifeWorkspace', {
      onboardingSeeded: false,
      goals: [{ id: 'life-goal-parity', title: 'Synthetic life goal', specific: 'Complete parity verification' }],
      habits: [{ id: 'life-habit-parity', name: 'Synthetic habit', category: 'Learning' }],
      habitCompletions: { 'life-habit-parity:2026-07-16': true },
      habitExcused: { 'life-habit-parity:2026-07-15': true },
      spendingBudgets: { monthly: 300, categories: { Books: 75 } },
      recurringExpenses: [{ id: 'expense-recurring-parity', name: 'Synthetic subscription', amount: 5 }],
      skills: [{ id: 'skill-parity', name: 'Synthetic skill', level: 3 }],
      fitness: [{ id: 'fitness-parity', activity: 'Walk', duration: 30 }],
      calories: [{ id: 'calorie-parity', meal: 'Synthetic lunch', calories: 500 }],
      books: [{ id: 'book-parity', title: 'Synthetic Book', status: 'reading' }],
      spending: [{ id: 'spend-parity', description: 'Synthetic notebook', amount: 12.5 }],
      journals: [{ id: 'journal-parity', title: 'Synthetic reflection', content: 'Journal sentinel' }]
    }),
    businessWorkspace: atomic(base, 'businessWorkspace', {
      projects: [{ id: 'business-project-parity', name: 'Synthetic Project', status: 'active' }],
      clients: [{ id: 'client-parity', name: 'Synthetic Client' }],
      tasks: [{ id: 'business-task-parity', title: 'Synthetic work task' }],
      invoices: [{ id: 'invoice-parity', clientId: 'client-parity', amount: 125 }],
      expenses: [{ id: 'business-expense-parity', name: 'Synthetic expense', amount: 10 }]
    }),
    apStudyWorkspace: atomic(base, 'apStudyWorkspace', {
      subjects: [{ id: 'ap-subject-parity', name: 'AP Synthetic' }],
      units: [{ id: 'ap-unit-parity', subjectId: 'ap-subject-parity', name: 'Unit Parity' }],
      topics: [{ id: 'ap-topic-parity', unitId: 'ap-unit-parity', name: 'Topic Parity' }],
      sessions: [{ id: 'ap-session-parity', subjectId: 'ap-subject-parity', minutes: 45 }],
      practiceLogs: [{ id: 'ap-practice-parity', score: 8, total: 10 }],
      activity: [{ id: 'ap-activity-parity', type: 'practice', at: EVERYTHING_STAMP }]
    }),
    homeworkWorkspace: {
      schemaVersion: 2, revision: 17, updatedAt: EVERYTHING_STAMP,
      lastMutation: { type: 'fixture', at: EVERYTHING_STAMP },
      courses: [{ id: 'homework-course-parity', name: 'Synthetic Biology', color: '#16a34a' }],
      tasks: [{ id: 'homework-task-parity', courseId: 'homework-course-parity', title: 'Synthetic lab report', dueDate: '2026-07-21', completed: false, subtasks: [{ id: 'hw-sub-parity', title: 'Analyze data', completed: false }] }],
      quarantine: [{ id: 'homework-quarantine-parity', reason: 'synthetic compatibility check', value: { title: 'Recovered homework sentinel' } }]
    },
    reviewWorkspace: {
      decks: [{ id: 'review-deck-parity', name: 'Synthetic Biology Deck' }],
      items: [{ id: 'review-card-parity', deckId: 'review-deck-parity', front: 'Synthetic front', back: 'Synthetic back', noteId: 'page-child', homeworkId: 'homework-task-parity' }],
      sessions: [{ id: 'review-session-parity', deckId: 'review-deck-parity', startedAt: EVERYTHING_STAMP, reviewed: 12 }],
      settings: { dailyGoal: 12, newCardsPerDay: 5, paritySentinel: 'review-settings-parity' }
    },
    courseWorkspace: {
      schemaVersion: 1,
      courses: [{ id: 'course-parity', name: 'Synthetic Course Hub', type: 'class', description: 'Course Hub sentinel', createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP }],
      files: [{
        id: 'file-parity', courseId: 'course-parity', linkedEntityType: 'note',
        linkedEntityId: 'page-child', name: 'synthetic-notes.txt',
        originalName: 'synthetic-notes.txt', mimeType: 'text/plain',
        sizeBytes: 34, kind: 'file', tags: ['parity'],
        createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP,
        source: 'upload', storageType: 'indexeddb', blobKey: 'blob-parity',
        url: '',
        description: 'Attachment sentinel', summary: 'Synthetic attachment summary',
        _exportBlob: EVERYTHING_ATTACHMENT
      }, {
        id: 'file-pdf-parity', courseId: 'course-parity', linkedEntityType: 'note',
        linkedEntityId: 'page-child', name: 'synthetic-reader.pdf', originalName: 'synthetic-reader.pdf',
        mimeType: 'application/pdf', sizeBytes: 88, kind: 'pdf', tags: ['parity'],
        createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP, source: 'upload',
        storageType: 'indexeddb', blobKey: 'blob-pdf-parity', url: '', description: 'PDF parity source',
        summary: '', _exportBlob: EVERYTHING_PDF
      }],
      resourceLinks: [{ id: 'resource-parity', courseId: 'course-parity', title: 'Synthetic resource', url: 'https://example.invalid/resource' }],
      relationships: [{ id: 'relationship-parity', courseId: 'course-parity', entityType: 'note', entityId: 'page-child' }],
      settings: { activeCourseId: 'course-parity', courseFilter: 'all', allDueFilter: 'all', studentInboxFilter: 'all', studentInboxSort: 'smart', allDueCourseFilter: 'course-parity' }
    },
    attachmentLinks: [
      { id: 'alink-pdf-course', fileId: 'file-pdf-parity', entityType: 'course', entityId: 'course-parity', createdAt: EVERYTHING_STAMP },
      { id: 'alink-pdf-note', fileId: 'file-pdf-parity', entityType: 'note', entityId: 'page-child', createdAt: EVERYTHING_STAMP }
    ],
    pdfDocuments: [{
      id: 'pdfdoc-parity', fileId: 'file-pdf-parity', schemaVersion: 1,
      pages: [{ id: 'pdfpage-parity', sourceFileId: 'file-pdf-parity', sourcePageIndex: 0, order: 0, rotation: 90, width: 612, height: 792, removed: false }],
      bookmarks: [{ id: 'pdfbookmark-parity', pageId: 'pdfpage-parity', title: 'Synthetic bookmark', createdAt: EVERYTHING_STAMP }],
      checkpoints: [{ id: 'pdfcheckpoint-parity', label: 'Before parity rotation', pages: [{ id: 'pdfpage-parity', sourceFileId: 'file-pdf-parity', sourcePageIndex: 0, order: 0, rotation: 0, width: 612, height: 792, removed: false }], createdAt: EVERYTHING_STAMP }],
      createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
    }],
    pdfAnnotations: [{
      id: 'pdfann-parity', documentId: 'pdfdoc-parity', pageId: 'pdfpage-parity', type: 'highlight',
      geometry: { x: 0.1, y: 0.2, width: 0.4, height: 0.04, rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.04 }] },
      style: { color: '#facc15', opacity: 0.42, width: 0.004, fontSize: 0.025 }, text: 'PDF parity highlight',
      inkPaths: [], fieldKey: '', value: '', createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
    }],
    schoolSchedule: atomic(base, 'schoolSchedule', { periods: [{ id: 'period-parity', name: 'Synthetic Period', startTime: '08:00', endTime: '08:50' }] }),
    gradePlanner: atomic(base, 'gradePlanner', { courses: [{ id: 'grade-course-parity', name: 'Synthetic Course', currentGrade: 94, categories: [{ id: 'grade-category-parity', name: 'Tests', weight: 60 }] }] }),
    semesterSetup: atomic(base, 'semesterSetup', { semesters: [{ id: 'semester-parity', name: 'Fall Synthetic', courseIds: ['course-parity'] }], completed: true }),
    cramSessions: [{ id: 'cram-parity', title: 'Synthetic cram session', resources: { notes: [{ id: 'cram-resource-parity', text: 'Cram resource sentinel' }] } }],
    trash: [{ id: 'trash-parity', kind: 'page', deletedAt: EVERYTHING_STAMP, value: { id: 'deleted-page-parity', title: 'Recoverable synthetic note', content: '<p>Trash sentinel</p>' } }],
    focusSessions: [{ id: 'focus-session-parity', taskId: 'task-parity-a', startedAt: EVERYTHING_STAMP, durationSeconds: 1500, completed: true }],
    protectedTime: [{ id: 'protected-parity', label: 'Synthetic recovery', startTime: '19:00', endTime: '20:00' }],
    taskDependencies: [{ id: 'dependency-parity', taskId: 'task-parity-a', dependsOnTaskId: 'task-parity-b' }],
    studySessions: [{ id: 'study-session-parity', subject: 'Synthetic Biology', durationMinutes: 35 }],
    masteryRecords: [{ id: 'mastery-parity', entityId: 'review-card-parity', score: 0.82 }],
    confidenceObservations: [{ id: 'confidence-parity', entityId: 'review-card-parity', confidence: 4 }],
    studentDecisionState: { version: 1, preset: 'focused', snoozed: { 'task-parity-b': '2026-07-17T12:00:00.000Z' }, dismissed: ['synthetic-nudge'], pinned: ['task-parity-a'] },
    assistantPermissions: { version: 1, mode: 'propose', areas: { notes: 'read', tasks: 'propose' }, allowLockedNotes: false, allowWellness: true, allowFinancial: false, allowPrivateDocuments: false },
    assistantMemory: { version: 1, enabled: true, items: [{ id: 'assistant-memory-contract-parity', kind: 'preference', value: 'Synthetic deterministic memory', noteId: 'page-child' }] },
    syncAuditLog: [{ id: 'audit-parity', kind: 'reviewed_import', status: 'synthetic', changedIds: ['page-child'], at: EVERYTHING_STAMP }],
    workspaceMeta: { version: 1, revision: 999, lastWriterTabId: 'device-a-only', lastSavedAt: EVERYTHING_STAMP },
    privateDocuments: [{ id: 'private-doc-parity', fileId: 'file-parity', title: 'Synthetic Private Document', mimeType: 'text/plain', sizeBytes: 34, createdAt: EVERYTHING_STAMP }],
    sharedStudySessions: [{ id: 'shared-session-parity', title: 'Synthetic group review', participantNames: ['Student A', 'Student B'] }],
    operatingManual: { version: 1, preferredStudyTimes: ['16:00'], reminderStyle: 'calm', planningStyle: 'focused', accessibility: { reducedMotion: true }, notes: 'Operating manual sentinel' },
    portfolioWorkspace: { version: 1, entries: [{ id: 'portfolio-parity', title: 'Synthetic Portfolio Project', artifactPageIds: ['page-child'] }], settings: { publicByDefault: false } },
    testingHub: atomic(base, 'testingHub', {
      exams: [{ id: 'testing-exam-parity', name: 'Synthetic SAT', targetScore: 1500 }],
      practiceLogs: [{ id: 'testing-practice-parity', examId: 'testing-exam-parity', score: 1450 }],
      mistakes: [{ id: 'mistake-parity', examId: 'testing-exam-parity', topic: 'Synthetic algebra' }],
      resources: [{ id: 'testing-resource-parity', title: 'Synthetic formula sheet' }]
    }),
    focusTemplates: [{ id: 'focus-template-parity', name: 'Synthetic Deep Work', durationMinutes: 40, breakMinutes: 10 }],
    customTabs: [{ id: 'custom-tab-parity', name: 'Synthetic Dashboard', icon: 'fa-chart-line', order: 1, widgets: [
      { id: 'widget-notes-parity', type: 'notes', config: { pageIds: ['page-child'] }, state: { collapsed: false } },
      { id: 'widget-counter-parity', type: 'counter', config: { label: 'Parity' }, state: { value: 7 } }
    ] }],
    splitPaneContexts: { primary: { pageId: 'device-a-pane', scrollTop: 123 }, secondary: { pageId: 'device-a-secondary', scrollTop: 456 } },
    pinnedPages: ['page-child', 'page-parent'],
    notificationsState: { version: 1, read: { 'notification-parity': EVERYTHING_STAMP }, dismissed: ['notification-dismissed-parity'], snoozed: { 'notification-snoozed-parity': '2026-07-17T09:00:00.000Z' }, preferences: { enabled: true }, lastActiveAt: 999999 },
    assistantChatHistory: clone(EVERYTHING_ASSISTANT_HISTORY),
    settings: {
      ...settings,
      theme: 'dark', atelierTheme: 'dark', motionEnabled: false,
      customShortcuts: [{ id: 'shortcut-parity', label: 'Open parity note', action: 'open-page', value: 'page-child' }],
      customization: { modsEnabled: true, customCssEnabled: true, cssSnippets: [{ id: 'css-parity', name: 'Synthetic CSS', css: '.parity { color: #123456; }', enabled: true }], installedPlugins: [], pluginsExperimentalEnabled: false },
      customThemes: [{ id: 'theme-parity', name: 'Synthetic Theme', colors: { accent: '#123456' } }],
      activeCustomThemeId: 'theme-parity',
      onboarding: { ...(settings.onboarding || {}), completed: true, currentStep: 'complete', userIntent: 'study', completedAt: EVERYTHING_STAMP },
      preferences: {
        ...preferences,
        appearance: { ...(preferences.appearance || {}), density: 'compact', contrast: 'high' },
        layout: { ...(preferences.layout || {}), defaultStartView: 'notes', courseHubEnabled: true },
        editor: { ...(preferences.editor || {}), writingWidth: 'wide', showMetadata: false, fontScale: 110 },
        tasks: { ...(preferences.tasks || {}), sortStrategy: 'due_first', showCompleted: false },
        calendar: { ...(preferences.calendar || {}), defaultView: 'month', timeFormat: '24', weekStart: 'monday' },
        today: {
          ...(preferences.today || {}),
          priorityFocus: 'assignments',
          dashboard: {
            version: 1,
            preset: 'custom',
            order: ['next-up', 'upcoming-radar', 'review', 'assignments', 'today-plan', 'calendar', 'tasks', 'tests', 'tonight', 'backup', 'priorities', 'habits', 'tracker', 'completed', 'life-signals', 'academic-planner', 'momentum'],
            hidden: ['tracker', 'momentum'],
            sizes: { review: 'wide', assignments: 'standard', priorities: 'wide' }
          }
        },
        focus: { ...(preferences.focus || {}), defaultMinutes: 40 },
        quotes: { showInSidebar: true, showInCustomTabs: true, sourceMode: 'custom', enabledCategories: ['self-affirmation'], customQuotes: [{
          id: 'quote-parity', text: 'Synthetic courage belongs in the portable workspace.', author: 'Parity Student', category: 'self-affirmation', createdAt: EVERYTHING_STAMP, updatedAt: EVERYTHING_STAMP
        }] },
        study: { ...(preferences.study || {}), homeworkAddMethod: 'modal', apDefaultSection: 'practice' },
        business: { ...(preferences.business || {}), compactCards: true, defaultView: 'list' },
        assistant: { ...(preferences.assistant || {}), enabled: true, saveChatHistory: true, includeChatsInEncryptedBackups: true, includeChatsInPlaintextRecovery: false, chatMemoryMode: 'recent', chatMemoryDepth: 15, requireApprovalForActions: true,
          personalization: { nickname: 'Synthetic Student', persona: 'balanced', responseLength: 'concise', customInstructions: 'Use synthetic examples.', aboutUser: 'Parity fixture only.' },
          localEndpoint: { enabled: false, baseUrl: '', model: '', visionCapable: false } },
        studentPreferences: { ...(preferences.studentPreferences || {}), schoolStartHour: 7, preferredReviewStyle: 'mixed' },
        integrations: { spotifyEnabled: false, chatgptEnabled: false },
        notifications: { mode: 'focused', deadlineAlerts: true, studyReminders: false, plannerAlerts: true },
        accessibility: { interfaceScale: 120, largerTouchTargets: true, highContrast: true, quietMode: true },
        startup: { playSound: false },
        data: { defaultExportFormat: 'atelier', promptBeforeImport: true, showBackupNudges: false },
        workspace: { mode: 'student', profile: 'academic' },
        sync: { enabled: true, endpoint: 'https://device-a.invalid/never-sync-this-setting' }
      }
    },
    ui: { activeView: 'device-a-only', lastActiveView: 'device-a-only', scrollPositions: { notes: 777 } },
    globalTheme: 'dark',
    migrationDiagnostics: { quarantine: [{ path: '$.legacySynthetic', reason: 'fixture', value: { userContent: 'Recovered synthetic value' } }] },
    compatibility: { legacyHomeworkSnapshot: { courses: [{ id: 'legacy-course-parity', name: 'Recovered Synthetic Course' }], tasks: [{ id: 'legacy-task-parity', title: 'Recovered synthetic task' }], migratedAt: EVERYTHING_STAMP } },
    unknownWorkspaceFields: { futurePortableSentinel: { id: 'future-parity', nested: { content: 'Unknown-field parity sentinel' } } },
    localStorageSnapshot: clone(EVERYTHING_LOCAL_STATE),
    futurePortableSentinel: { id: 'future-parity', nested: { content: 'Unknown-field parity sentinel' } },
    exportedAt: EVERYTHING_STAMP
  };
}

export function createReverseDirectionWorkspace(deviceBWorkspace) {
  const next = clone(deviceBWorkspace);
  next.pages = (next.pages || []).map(page => page.id === 'page-child'
    ? { ...page, content: String(page.content || '') + '<p>Reverse note sentinel.</p>' }
    : page);
  next.tasks = (next.tasks || []).map(task => task.id === 'task-parity-a'
    ? { ...task, title: 'Reverse synthetic parity audit' }
    : task);
  next.homeworkWorkspace = { ...(next.homeworkWorkspace || {}), quarantine: [] };
  next.reviewWorkspace = { ...(next.reviewWorkspace || {}), settings: { ...((next.reviewWorkspace || {}).settings || {}), dailyGoal: 19 } };
  for (const key of ['lifeWorkspace', 'businessWorkspace', 'apStudyWorkspace', 'collegeAppWorkspace', 'testingHub']) {
    next[key] = { ...(next[key] || {}), paritySentinel: key + '-reverse' };
  }
  next.customTabs = (next.customTabs || []).map(tab => tab.id === 'custom-tab-parity'
    ? { ...tab, name: 'Reverse Synthetic Dashboard' } : tab);
  next.notificationsState = { ...(next.notificationsState || {}), dismissed: [] };
  next.assistantPermissions = { ...(next.assistantPermissions || {}), allowWellness: false };
  next.assistantMemory = { ...(next.assistantMemory || {}), enabled: false };
  next.operatingManual = { ...(next.operatingManual || {}), notes: 'Reverse operating manual sentinel' };
  next.globalTheme = 'default';
  return next;
}
