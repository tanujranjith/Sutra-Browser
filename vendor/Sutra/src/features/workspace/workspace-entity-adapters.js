/*
 * Browser adapters for the canonical workspace entity registry.
 *
 * Adapters read live canonical state through the core bridge and delegate all
 * navigation/mutations to existing Sutra APIs. They never persist a copy.
 */
(function (global) {
  'use strict';

  var installed = false;
  var cachedSources = null;
  var cacheReleaseScheduled = false;
  var SENSITIVE_KEY_PATTERN = /(api.?key|access.?token|refresh.?token|secret|password|passphrase|credential|private.?key|wrapped.?key|oauth)/i;
  var TEXT_KEY_PATTERN = /^(title|name|text|content|body|notes?|description|summary|prompt|answer|question|label|topic|subject|course|className|tags?|category|status|type|kind|company|client|school|college|essay|activity|goal|skill|book|journal|message|messages|reason|front|back|blocks|canvas|slides|elements|items|children)$/i;

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
  }

  function firstText(record, keys, fallback) {
    var source = record && typeof record === 'object' ? record : {};
    for (var i = 0; i < keys.length; i += 1) {
      var value = text(source[keys[i]]);
      if (value) return value;
    }
    return text(fallback);
  }

  function joinText(values) {
    var seen = Object.create(null);
    var out = [];
    values.forEach(function (value) {
      var clean = text(value);
      var key = clean.toLowerCase();
      if (!clean || /^data:/i.test(clean) || clean.length > 100000 || seen[key]) return;
      seen[key] = true;
      out.push(clean);
    });
    return out.join(' ');
  }

  function collectRecordText(value, depth, output) {
    if (depth > 4 || value === undefined || value === null || output.length >= 120) return;
    if (typeof value === 'string' || typeof value === 'number') {
      var clean = text(value);
      if (clean && !/^data:/i.test(clean) && clean.length <= 100000) output.push(clean);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach(function (entry) { collectRecordText(entry, depth + 1, output); });
      return;
    }
    if (typeof value !== 'object') return;
    Object.keys(value).slice(0, 120).forEach(function (key) {
      if (SENSITIVE_KEY_PATTERN.test(key)) return;
      if (TEXT_KEY_PATTERN.test(key) || depth > 0) collectRecordText(value[key], depth + 1, output);
    });
  }

  function recordText(record, extraValues) {
    var output = [];
    collectRecordText(record, 0, output);
    return joinText(output.concat(extraValues || []));
  }

  function stableId(record, collection, index) {
    var source = record && typeof record === 'object' ? record : {};
    return text(source.id || source.key || source.uuid || source.recordId || (collection + '-' + index));
  }

  function dateFields(record) {
    var source = record && typeof record === 'object' ? record : {};
    return {
      due: source.dueDate || source.due || source.deadline || source.date || '',
      start: source.startAt || source.start || '',
      end: source.endAt || source.end || '',
      created: source.createdAt || source.created || '',
      updated: source.updatedAt || source.updated || ''
    };
  }

  function metadata(record, extra) {
    var source = record && typeof record === 'object' ? record : {};
    return Object.assign({
      sourceType: text(source.type || source.kind || ''),
      priority: text(source.priority || ''),
      difficulty: text(source.difficulty || ''),
      noteId: text(source.noteId || source.linkedNoteId || ''),
      estimateMinutes: Number(source.estimateMinutes || source.effortMinutes || source.estimate || 0) || 0
    }, extra || {});
  }

  function bridge() {
    return global.flowAtelier || {};
  }

  function sources() {
    if (cachedSources) return cachedSources;
    var appBridge = bridge();
    if (typeof appBridge.getWorkspaceEntitySources === 'function') {
      try { cachedSources = appBridge.getWorkspaceEntitySources() || {}; }
      catch (error) { report(error, 'workspace-entity-adapters:sources'); }
    }
    var portable = {};
    if (!cachedSources && typeof global.serializeWorkspace === 'function') {
      try {
        // The sync projection is already sensitive-stripped, includes durable
        // private/chat records, and omits course attachment bytes. It is used
        // only as a transient read snapshot and is never persisted as an index.
        portable = global.serializeWorkspace({ mode: 'sync', includeSensitiveSettings: false }) || {};
      } catch (error) {
        report(error, 'workspace-entity-adapters:portable-snapshot');
      }
    }
    cachedSources = cachedSources || Object.assign({}, portable, {
      pages: appBridge.pages || [],
      tasks: appBridge.tasks || [],
      timeBlocks: appBridge.timeBlocks || [],
      homeworkWorkspace: global.SutraHomeworkStore && typeof global.SutraHomeworkStore.getSnapshot === 'function'
        ? global.SutraHomeworkStore.getSnapshot()
        : { courses: [], tasks: [] },
      reviewWorkspace: appBridge.reviewWorkspace || {},
      collegeAppWorkspace: appBridge.collegeAppWorkspace || {},
      lifeWorkspace: appBridge.lifeWorkspace || {},
      businessWorkspace: appBridge.businessWorkspace || {},
      apStudyWorkspace: appBridge.apStudyWorkspace || {},
      testingHub: appBridge.testingHub || {}
    });
    if (!cacheReleaseScheduled && typeof Promise !== 'undefined') {
      cacheReleaseScheduled = true;
      Promise.resolve().then(function () {
        cachedSources = null;
        cacheReleaseScheduled = false;
      });
    }
    return cachedSources;
  }

  function invalidateSourceCache() {
    cachedSources = null;
    cacheReleaseScheduled = false;
  }

  function report(error, where) {
    if (typeof global.SutraReportError === 'function') {
      global.SutraReportError(error, { where: where }, 'warning');
    }
  }

  function setView(view) {
    var appBridge = bridge();
    if (typeof appBridge.setActiveView === 'function') {
      appBridge.setActiveView(view);
      return true;
    }
    if (typeof global.setActiveView === 'function') {
      global.setActiveView(view);
      return true;
    }
    return false;
  }

  function openNote(entity) {
    if (!setView('notes')) return false;
    var appBridge = bridge();
    if (typeof appBridge.loadPage === 'function') {
      appBridge.loadPage(entity.id);
      return true;
    }
    return false;
  }

  function openTask(entity) {
    var appBridge = bridge();
    if (typeof appBridge.openTaskModal === 'function') return appBridge.openTaskModal(entity.id) !== false;
    return setView('today');
  }

  function openHomework(entity) {
    if (typeof global.openHomeworkTaskModal === 'function') {
      return global.openHomeworkTaskModal('v2', entity.id) !== false;
    }
    return setView('homework');
  }

  function openCourse(entity, tab) {
    var appBridge = bridge();
    if (typeof appBridge.openClassDashboardDrawer === 'function') {
      appBridge.openClassDashboardDrawer(entity.courseId || entity.id);
      if (tab && typeof global.cwSetCourseTab === 'function') global.cwSetCourseTab(tab);
      return true;
    }
    setView('courses');
    if (typeof global.cwSelectCourse === 'function') global.cwSelectCourse(entity.courseId || entity.id);
    if (tab && typeof global.cwSetCourseTab === 'function') global.cwSetCourseTab(tab);
    return true;
  }

  function openReviewDeck(entity) {
    setView('review');
    if (typeof global.openReviewDeck === 'function') global.openReviewDeck(entity.metadata.deckId || entity.id);
    return true;
  }

  function openTestingExam(entity) {
    setView('apstudy');
    if (typeof global.openExamDetail === 'function') global.openExamDetail(entity.metadata.examId || entity.id);
    return true;
  }

  function collectNamedCollections(workspace, names, domain, view) {
    var out = [];
    names.forEach(function (collection) {
      rows(workspace && workspace[collection]).forEach(function (record, index) {
        var id = stableId(record, collection, index);
        if (!id) return;
        out.push({
          id: collection + ':' + id,
          title: firstText(record, ['title', 'name', 'label', 'text', 'college', 'school', 'essay', 'activity', 'goal'], collection),
          text: recordText(record),
          keywords: [domain, collection, record && record.type, record && record.status],
          courseId: record && (record.courseId || record.classId),
          status: record && (record.status || record.stage),
          dates: dateFields(record),
          deepLink: { view: view, params: { collection: collection, id: id } },
          metadata: metadata(record, { collection: collection, recordId: id, domain: domain })
        });
      });
    });
    return out;
  }

  function createAdapterDefinitions() {
    return [
      {
        id: 'note',
        label: 'Notes',
        singularLabel: 'note',
        lockedLabel: 'Locked note',
        priority: 10,
        collect: function () {
          var src = sources();
          var unlocked = bridge().unlockedPageIds;
          return rows(src.pages).filter(function (page) {
            return page && page.id && page.isSystemPage !== true && page.systemRole !== 'help';
          }).map(function (page) {
            var locked = page.isLocked === true && !(unlocked && typeof unlocked.has === 'function' && unlocked.has(page.id));
            return {
              id: page.id,
              title: page.title || 'Untitled note',
              lockedTitle: 'Locked note',
              text: recordText({ content: page.content, blocks: page.blocks, canvas: page.canvas, slides: page.slides, tags: page.tags }),
              keywords: ['note'].concat(rows(page.tags)),
              courseId: page.classLinkId || page.courseId || '',
              status: page.isTemporary ? 'temporary' : '',
              dates: dateFields(page),
              deepLink: { view: 'notes', params: { pageId: page.id } },
              privacy: { locked: locked, private: page.private === true, searchable: !locked, reason: locked ? 'locked' : '' },
              metadata: { pageType: page.type || '', spaceId: page.spaceId || '', hasCanvas: !!page.canvas, hasSlides: !!page.slides }
            };
          });
        },
        open: openNote,
        actions: {
          review: {
            label: 'Create review cards',
            kind: 'study',
            available: function () { return !!(global.SutraReviewGenerator && typeof global.SutraReviewGenerator.fromNote === 'function'); },
            run: function (entity) { return global.SutraReviewGenerator.fromNote(entity.id) !== false; }
          }
        }
      },
      {
        id: 'task',
        label: 'Tasks',
        singularLabel: 'task',
        priority: 20,
        collect: function () {
          return rows(sources().tasks).filter(function (task) {
            return task && task.id && task.origin !== 'homework';
          }).map(function (task) {
            return {
              id: task.id,
              title: task.title || task.text || 'Untitled task',
              text: recordText(task),
              keywords: ['task', task.category, task.priority, task.status],
              courseId: task.courseId || '',
              status: task.completed ? 'completed' : (task.status || 'open'),
              dates: dateFields(task),
              deepLink: { view: 'today', params: { taskId: task.id } },
              metadata: metadata(task)
            };
          });
        },
        open: openTask,
        actions: {
          focus: {
            label: 'Start Focus',
            kind: 'primary',
            available: function () { return typeof bridge().startFocusSession === 'function'; },
            run: function (entity) {
              return bridge().startFocusSession(entity.id, {
                title: entity.title,
                plannedDurationSeconds: Math.max(0, Number(entity.metadata.estimateMinutes || 0)) * 60
              }) !== false;
            }
          },
          schedule: {
            label: 'Schedule',
            kind: 'calendar',
            available: function () { return typeof bridge().scheduleGenericItemAsBlock === 'function'; },
            run: function (entity) {
              return bridge().scheduleGenericItemAsBlock({
                title: entity.title,
                dueDate: entity.dates.due,
                source: 'task',
                sourceId: entity.id,
                courseId: entity.courseId
              }) !== false;
            }
          },
          complete: {
            label: 'Mark complete',
            kind: 'complete',
            available: function () { return typeof global.cwMarkInboxDone === 'function'; },
            run: function (entity) { return global.cwMarkInboxDone('planner', entity.id, '') !== false; }
          }
        }
      },
      {
        id: 'homework',
        label: 'Homework',
        singularLabel: 'assignment',
        priority: 25,
        collect: function () {
          var workspace = sources().homeworkWorkspace || {};
          var coursesById = Object.create(null);
          rows(workspace.courses).forEach(function (course) { if (course && course.id) coursesById[String(course.id)] = course; });
          return rows(workspace.tasks).filter(function (task) { return task && task.id; }).map(function (task) {
            var course = coursesById[String(task.courseId || '')] || {};
            return {
              id: task.id,
              title: task.title || task.text || 'Untitled assignment',
              text: recordText(task, [course.name]),
              keywords: ['homework', 'assignment', course.name, task.type, task.priority, task.status],
              courseId: task.courseId || '',
              status: task.done ? 'completed' : (task.status || 'open'),
              dates: dateFields(task),
              deepLink: { view: 'homework', params: { assignmentId: task.id } },
              metadata: metadata(task, { courseName: course.name || '', source: 'homework' })
            };
          });
        },
        open: openHomework,
        actions: {
          schedule: {
            label: 'Schedule',
            kind: 'calendar',
            available: function () { return typeof global.cwScheduleInboxItem === 'function'; },
            run: function (entity) { return global.cwScheduleInboxItem('homework', entity.id, '', '') !== false; }
          },
          complete: {
            label: 'Mark complete',
            kind: 'complete',
            available: function () { return !!(global.SutraHomework && typeof global.SutraHomework.markDone === 'function'); },
            run: function (entity) { return global.SutraHomework.markDone(entity.id) !== false; }
          },
          review: {
            label: 'Create review cards',
            kind: 'study',
            available: function () { return !!(global.SutraReviewGenerator && typeof global.SutraReviewGenerator.fromHomeworkTask === 'function'); },
            run: function (entity) { return global.SutraReviewGenerator.fromHomeworkTask(entity.id) !== false; }
          }
        }
      },
      {
        id: 'assignment_milestone',
        label: 'Assignment milestones',
        singularLabel: 'assignment milestone',
        priority: 28,
        collect: function () {
          var out = [];
          rows((sources().homeworkWorkspace || {}).tasks).forEach(function (task) {
            rows(task && task.studio && task.studio.milestones).forEach(function (milestone, index) {
              if (!milestone) return;
              var milestoneId = stableId(milestone, 'milestone', index);
              out.push({
                id: String(task.id) + ':' + milestoneId,
                title: milestone.title || milestone.text || 'Assignment milestone',
                text: recordText(milestone, [task.title]),
                keywords: ['assignment', 'milestone', task.title],
                courseId: task.courseId || '',
                parentKey: 'homework:' + task.id,
                status: milestone.done ? 'completed' : (milestone.status || 'open'),
                dates: dateFields(milestone),
                deepLink: { view: 'homework', params: { assignmentId: task.id, milestoneId: milestoneId } },
                metadata: metadata(milestone, { assignmentId: String(task.id), milestoneId: milestoneId })
              });
            });
          });
          return out;
        },
        open: function (entity) {
          var assignmentId = entity.metadata.assignmentId;
          if (global.SutraAssignmentStudio && typeof global.SutraAssignmentStudio.open === 'function') {
            global.SutraAssignmentStudio.open(assignmentId);
            return true;
          }
          return openHomework({ id: assignmentId });
        },
        actions: {
          complete: {
            label: 'Mark complete',
            kind: 'complete',
            available: function () { return typeof global.cwMarkInboxDone === 'function'; },
            run: function (entity) {
              return global.cwMarkInboxDone('milestone', entity.metadata.assignmentId, entity.metadata.milestoneId) !== false;
            }
          }
        }
      },
      {
        id: 'course',
        label: 'Courses',
        singularLabel: 'course',
        priority: 30,
        collect: function () {
          var src = sources();
          var list = rows((src.courseWorkspace || {}).courses);
          if (!list.length) list = rows((src.homeworkWorkspace || {}).courses);
          return list.filter(function (course) { return course && course.id; }).map(function (course) {
            return {
              id: course.id,
              title: course.name || course.title || 'Untitled course',
              text: recordText(course),
              keywords: ['course', 'class', course.subject, course.teacher, course.term],
              status: course.archived ? 'archived' : 'active',
              dates: dateFields(course),
              deepLink: { view: 'courses', params: { courseId: course.id } },
              metadata: { color: course.color || '', teacher: course.teacher || '', term: course.term || '' }
            };
          });
        },
        open: function (entity) { return openCourse(entity, 'overview'); }
      },
      {
        id: 'course_file',
        label: 'Course files',
        singularLabel: 'course file',
        priority: 32,
        collect: function () {
          return rows((sources().courseWorkspace || {}).files).filter(function (file) {
            return file && file.id;
          }).map(function (file) {
            return {
              id: file.id,
              title: file.name || file.originalName || 'Course file',
              text: recordText({ description: file.description, summary: file.summary, tags: file.tags, kind: file.kind }),
              keywords: ['file', 'resource', file.kind, file.mimeType].concat(rows(file.tags)),
              courseId: file.courseId || '',
              dates: dateFields(file),
              deepLink: { view: 'courses', params: { courseId: file.courseId || '', tab: 'files', fileId: file.id } },
              privacy: { private: file.private === true, searchable: true },
              metadata: { fileId: file.id, mimeType: file.mimeType || '', kind: file.kind || '', sizeBytes: Number(file.sizeBytes) || 0 }
            };
          });
        },
        open: function (entity) {
          openCourse(entity, 'files');
          if (typeof global.cwOpenFile === 'function') global.cwOpenFile(entity.id);
          return true;
        }
      },
      {
        id: 'timeline_block',
        label: 'Timeline',
        singularLabel: 'timeline block',
        priority: 35,
        collect: function () {
          return rows(sources().timeBlocks).filter(function (block) { return block && block.id; }).map(function (block) {
            return {
              id: block.id,
              title: block.name || block.title || 'Timeline block',
              text: recordText(block),
              keywords: ['timeline', 'calendar', block.category, block.source],
              courseId: block.courseId || '',
              status: block.completed ? 'completed' : '',
              dates: {
                due: block.date || '',
                start: block.startAt || joinText([block.date, block.start]),
                end: block.endAt || joinText([block.date, block.end]),
                created: block.createdAt || '',
                updated: block.updatedAt || ''
              },
              deepLink: { view: 'timeline', params: { blockId: block.id, date: block.date || '' } },
              metadata: metadata(block, { source: block.source || '', sourceId: block.sourceId || '' })
            };
          });
        },
        open: function () { return setView('timeline'); }
      },
      {
        id: 'habit',
        label: 'Habits',
        singularLabel: 'habit',
        priority: 40,
        collect: function () {
          var src = sources();
          var core = rows(src.habits);
          var life = rows((src.lifeWorkspace || {}).habits);
          return core.concat(life).filter(function (habit) { return habit && habit.id; }).map(function (habit) {
            return {
              id: habit.id,
              title: habit.name || habit.title || 'Habit',
              text: recordText(habit),
              keywords: ['habit', habit.type, habit.category],
              status: habit.archived ? 'archived' : 'active',
              dates: dateFields(habit),
              deepLink: { view: core.indexOf(habit) >= 0 ? 'today' : 'life', params: { habitId: habit.id } },
              metadata: metadata(habit)
            };
          });
        },
        open: function (entity) { return setView(entity.deepLink && entity.deepLink.view || 'today'); }
      },
      {
        id: 'review_deck',
        label: 'Review decks',
        singularLabel: 'review deck',
        priority: 45,
        collect: function () {
          return rows((sources().reviewWorkspace || {}).decks).filter(function (deck) { return deck && deck.id; }).map(function (deck) {
            return {
              id: deck.id,
              title: deck.name || deck.title || 'Review deck',
              text: recordText(deck),
              keywords: ['review', 'deck', deck.subject, deck.tags],
              courseId: deck.courseId || deck.sourceProjectId || '',
              status: deck.archived ? 'archived' : 'active',
              dates: dateFields(deck),
              deepLink: { view: 'review', params: { deckId: deck.id } },
              metadata: { deckId: deck.id, sourceNoteId: deck.sourceNoteId || '' }
            };
          });
        },
        open: openReviewDeck
      },
      {
        id: 'review_card',
        label: 'Review cards',
        singularLabel: 'review card',
        priority: 46,
        collect: function () {
          return rows((sources().reviewWorkspace || {}).items).filter(function (item) { return item && item.id; }).map(function (item) {
            return {
              id: item.id,
              title: item.prompt || item.front || item.question || 'Review card',
              text: recordText(item),
              keywords: ['review', 'card', item.tags],
              courseId: item.courseId || item.sourceProjectId || '',
              parentKey: item.deckId ? 'review_deck:' + item.deckId : '',
              status: item.status || '',
              dates: { due: item.dueAt || item.nextReviewAt || '', created: item.createdAt || '', updated: item.updatedAt || '' },
              deepLink: { view: 'review', params: { deckId: item.deckId || '', cardId: item.id } },
              metadata: { deckId: item.deckId || '', cardId: item.id }
            };
          });
        },
        open: openReviewDeck
      },
      {
        id: 'academic_record',
        label: 'Academic records',
        singularLabel: 'academic record',
        priority: 50,
        collect: function () {
          return collectNamedCollections(
            sources().academicWorkspace || {},
            ['classes', 'assignments', 'exams', 'notesTemplates', 'flashcards', 'extracurriculars'],
            'academic',
            'today'
          );
        },
        open: function () { return setView('today'); }
      },
      {
        id: 'study_record',
        label: 'Study records',
        singularLabel: 'study record',
        priority: 52,
        collect: function () {
          return collectNamedCollections(
            sources().apStudyWorkspace || {},
            ['subjects', 'units', 'topics', 'sessions', 'practiceLogs', 'activity'],
            'study',
            'apstudy'
          );
        },
        open: function () { return setView('apstudy'); }
      },
      {
        id: 'testing_exam',
        label: 'Exams',
        singularLabel: 'exam',
        priority: 54,
        collect: function () {
          var workspace = sources().testingHub || {};
          var exams = rows(workspace.customExams).concat(rows(workspace.exams));
          return exams.filter(function (exam) { return exam && exam.id; }).map(function (exam) {
            var examId = exam.type ? String(exam.type) : ('custom:' + exam.id);
            return {
              id: examId,
              title: exam.name || exam.title || exam.label || 'Exam',
              text: recordText(exam),
              keywords: ['exam', 'test', exam.type, exam.status],
              status: exam.status || '',
              dates: dateFields(exam),
              deepLink: { view: 'apstudy', params: { examId: examId } },
              metadata: { examId: examId, custom: !exam.type }
            };
          });
        },
        open: openTestingExam
      },
      {
        id: 'testing_mistake',
        label: 'Testing mistakes',
        singularLabel: 'testing mistake',
        priority: 55,
        collect: function () {
          var workspace = sources().testingHub || {};
          return collectNamedCollections(workspace, ['mistakes', 'practiceTests', 'tasks'], 'testing', 'apstudy');
        },
        open: function (entity) {
          setView('apstudy');
          var examId = entity.metadata && entity.metadata.examId;
          if (examId && typeof global.openExamDetail === 'function') global.openExamDetail(examId);
          return true;
        }
      },
      {
        id: 'grade_record',
        label: 'Grades',
        singularLabel: 'grade record',
        priority: 56,
        collect: function () {
          var workspace = sources().gradePlanner || {};
          var courses = workspace.courses && typeof workspace.courses === 'object' ? workspace.courses : {};
          var out = [];
          Object.keys(courses).forEach(function (courseId) {
            var course = courses[courseId] || {};
            out.push({
              id: 'course:' + courseId,
              title: course.name || course.title || 'Course grades',
              text: recordText(course),
              keywords: ['grade', 'gpa', 'course'],
              courseId: courseId,
              deepLink: { view: 'courses', params: { courseId: courseId, tab: 'grades' } },
              metadata: { courseId: courseId, recordType: 'course' }
            });
            ['categories', 'entries', 'assignments', 'scores'].forEach(function (collection) {
              rows(course[collection]).forEach(function (record, index) {
                var id = stableId(record, collection, index);
                out.push({
                  id: courseId + ':' + collection + ':' + id,
                  title: firstText(record, ['title', 'name', 'label'], 'Grade entry'),
                  text: recordText(record, [course.name]),
                  keywords: ['grade', collection, course.name],
                  courseId: courseId,
                  parentKey: 'grade_record:course:' + courseId,
                  dates: dateFields(record),
                  deepLink: { view: 'courses', params: { courseId: courseId, tab: 'grades', recordId: id } },
                  metadata: { courseId: courseId, collection: collection, recordId: id }
                });
              });
            });
          });
          return out;
        },
        open: function (entity) { return openCourse(entity, 'grades'); }
      },
      {
        id: 'college_record',
        label: 'College',
        singularLabel: 'college record',
        priority: 60,
        collect: function () {
          var src = sources();
          var app = src.collegeAppWorkspace || {};
          var tracker = src.collegeTracker || {};
          var out = collectNamedCollections(app, [
            'collegeTracker', 'essayOrganizer', 'scoreTracker', 'awardsHonors', 'recommenders',
            'scholarships', 'activities', 'submissionReadiness', 'applicationCosts', 'financialAidDeadlines'
          ], 'college', 'collegeapp');
          out = out.concat(collectNamedCollections(tracker, ['research', 'checklist', 'deadlines', 'essayOrganizer', 'prompts'], 'college', 'collegeapp'));
          if (app.decisionMatrix) out = out.concat(collectNamedCollections(app.decisionMatrix, ['colleges'], 'college', 'collegeapp'));
          if (app.majorDecisionMatrix) out = out.concat(collectNamedCollections(app.majorDecisionMatrix, ['majors'], 'college', 'collegeapp'));
          if (app.visitTracker) out = out.concat(collectNamedCollections(app.visitTracker, ['visits'], 'college', 'collegeapp'));
          return out;
        },
        open: function () { return setView('collegeapp'); }
      },
      {
        id: 'life_record',
        label: 'Life',
        singularLabel: 'life record',
        priority: 65,
        collect: function () {
          var workspace = sources().lifeWorkspace || {};
          var out = collectNamedCollections(workspace, [
            'goals', 'habits', 'skills', 'fitness', 'calories', 'books', 'spending',
            'recurringExpenses', 'journals'
          ], 'life', 'life');
          if (workspace.wellness) {
            out = out.concat(collectNamedCollections(workspace.wellness, ['checkIns', 'journalEntries'], 'wellness', 'life'));
          }
          return out;
        },
        open: function () { return setView('life'); }
      },
      {
        id: 'business_record',
        label: 'Work',
        singularLabel: 'work record',
        priority: 70,
        collect: function () {
          return collectNamedCollections(sources().businessWorkspace || {}, [
            'projects', 'clients', 'invoices', 'finance', 'opportunities', 'meetings',
            'proposals', 'tasks', 'documents', 'goals', 'notes', 'activity'
          ], 'work', 'business');
        },
        open: function () { return setView('business'); }
      },
      {
        id: 'custom_tab',
        label: 'Custom tabs',
        singularLabel: 'custom tab',
        priority: 75,
        collect: function () {
          return rows(sources().customTabs).filter(function (tab) { return tab && tab.id; }).map(function (tab) {
            return {
              id: tab.id,
              title: tab.name || tab.title || 'Custom tab',
              text: recordText(tab),
              keywords: ['custom tab', 'dashboard', tab.tags],
              dates: dateFields(tab),
              deepLink: { view: 'custom-' + tab.id, params: { tabId: tab.id } },
              metadata: { tabId: tab.id }
            };
          });
        },
        open: function (entity) { return setView('custom-' + entity.id); }
      },
      {
        id: 'assistant_conversation',
        label: 'Assistant conversations',
        singularLabel: 'Assistant conversation',
        priority: 80,
        collect: function () {
          var history = sources().assistantChatHistory || {};
          return rows(history.conversations).filter(function (conversation) {
            return conversation && conversation.id;
          }).map(function (conversation) {
            return {
              id: conversation.id,
              title: conversation.title || 'Assistant conversation',
              text: joinText(rows(conversation.messages).map(function (message) { return message && message.content; })),
              keywords: ['assistant', 'conversation', conversation.providerLabel, conversation.modelLabel],
              status: conversation.archived ? 'archived' : 'active',
              dates: dateFields(conversation),
              deepLink: { view: 'assistantview', params: { conversationId: conversation.id } },
              privacy: { private: true, searchable: true },
              metadata: { conversationId: conversation.id, pinned: conversation.pinned === true }
            };
          });
        },
        open: function () { return setView('assistantview'); }
      },
      {
        id: 'portfolio_entry',
        label: 'Portfolio',
        singularLabel: 'portfolio entry',
        priority: 82,
        collect: function () {
          return collectNamedCollections(sources().portfolioWorkspace || {}, ['entries'], 'portfolio', 'notes');
        },
        open: function () { return setView('notes'); }
      },
      {
        id: 'focus_template',
        label: 'Focus templates',
        singularLabel: 'focus template',
        priority: 84,
        collect: function () {
          return rows(sources().focusTemplates).filter(function (template) { return template && template.id; }).map(function (template) {
            return {
              id: template.id,
              title: template.name || 'Focus template',
              text: recordText(template),
              keywords: ['focus', 'template', template.mode],
              dates: dateFields(template),
              deepLink: { view: template.linkedView || 'today', params: { focusTemplateId: template.id } },
              metadata: { durationMinutes: Number(template.durationMinutes) || 0, linkedView: template.linkedView || '' }
            };
          });
        },
        open: function (entity) { return setView(entity.deepLink && entity.deepLink.view || 'today'); }
      },
      {
        id: 'private_document',
        label: 'Private documents',
        singularLabel: 'private document',
        lockedLabel: 'Private document',
        priority: 90,
        collect: function () {
          return rows(sources().privateDocuments).filter(function (document) {
            return document && document.id;
          }).map(function (document) {
            return {
              id: document.id,
              title: document.name || document.title || 'Private document',
              lockedTitle: 'Private document',
              text: '',
              keywords: [],
              dates: dateFields(document),
              deepLink: { view: 'settings', params: { section: 'private-vault', documentId: document.id } },
              privacy: { private: true, locked: true, searchable: false, reason: 'private-vault-locked' },
              metadata: { documentType: document.type || '', sizeBytes: Number(document.sizeBytes) || 0 }
            };
          });
        },
        open: function () { return setView('settings'); }
      },
      {
        id: 'trash_item',
        label: 'Trash',
        singularLabel: 'trash item',
        priority: 95,
        collect: function () {
          return rows(sources().trash).filter(function (item) { return item && item.id; }).map(function (item) {
            return {
              id: item.id,
              title: item.title || item.name || 'Deleted item',
              text: '',
              keywords: [],
              dates: dateFields(item),
              deepLink: { view: 'settings', params: { section: 'trash', itemId: item.id } },
              privacy: { searchable: false, reason: 'trash-filter-required' },
              metadata: { deletedType: item.type || item.kind || '' }
            };
          });
        },
        open: function () {
          if (typeof global.openTrashModal === 'function') {
            global.openTrashModal();
            return true;
          }
          return setView('settings');
        }
      }
    ];
  }

  function installWorkspaceEntityAdapters(registry) {
    var target = registry || global.SutraWorkspaceEntityRegistry;
    if (!target || typeof target.registerAdapter !== 'function') return false;
    if (installed) return true;
    createAdapterDefinitions().forEach(function (definition) {
      target.registerAdapter(definition);
    });
    installed = true;
    target.invalidate('workspace-entity-adapters-ready');
    if (global && typeof global.addEventListener === 'function') {
      [
        'homework:updated',
        'sutra:custom-tabs-changed',
        'sutra:assistant-chat-store-restored',
        'sutra:workspace-remote-commit',
        'sutra:schedule-changed',
        'sutra:school-schedule-updated'
      ].forEach(function (eventName) {
        global.addEventListener(eventName, function () {
          invalidateSourceCache();
          target.invalidate(eventName);
        });
      });
    }
    return true;
  }

  function installWhenReady() {
    try {
      if (installWorkspaceEntityAdapters()) return;
    } catch (error) {
      report(error, 'workspace-entity-adapters:install');
      return;
    }
    if (global && typeof global.addEventListener === 'function') {
      global.addEventListener('sutra:flow-bridge-ready', function () {
        try { installWorkspaceEntityAdapters(); }
        catch (error) { report(error, 'workspace-entity-adapters:install-ready'); }
      }, { once: true });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createAdapterDefinitions: createAdapterDefinitions,
      installWorkspaceEntityAdapters: installWorkspaceEntityAdapters
    };
  }
  if (global && global.document) installWhenReady();
}(typeof window !== 'undefined' ? window : globalThis));
