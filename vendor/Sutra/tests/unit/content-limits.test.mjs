import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const homework = require('../../src/domain/homework-store.js');
const semester = require('../../src/features/academic/semester-setup.js');
const imported = require('../../src/domain/import-engine.js');

function loadApNormalizer() {
  const source = readFileSync(new URL('../../src/features/study/ap-study.js', import.meta.url), 'utf8');
  const context = { window: {}, console, Date, Math, Set, Map };
  vm.runInNewContext(source, context, { filename: 'ap-study.js' });
  return context.window.normalizeApStudyWorkspace;
}

test('Homework keeps long authored course names, titles, and notes canonical', () => {
  const courseName = 'Course ' + 'C'.repeat(320);
  const title = 'Assignment ' + 'T'.repeat(1600);
  const notes = 'Note ' + 'N'.repeat(21000);
  const result = homework.normalizeWorkspace({
    courses: [{ id: 'long-course', name: courseName }],
    tasks: [{ id: 'long-task', title, courseId: 'long-course', notes }]
  }, { now: '2026-09-13T12:00:00.000Z' });

  assert.equal(result.courses[0].name, courseName);
  assert.equal(result.tasks[0].title, title);
  assert.equal(result.tasks[0].text, title);
  assert.equal(result.tasks[0].notes, notes);
});

test('Semester Setup preserves long parsed and normalized authored fields', () => {
  const assignmentTitle = 'Assignment ' + 'A'.repeat(260) + ' due 09/12/2026';
  const examTitle = 'Final Exam ' + 'E'.repeat(260) + ' 12/16/2026';
  const parsed = semester.parseSourceText(`${assignmentTitle}\n${examTitle}`, { id: 'source-1' });
  assert.equal(parsed.items.find((item) => item.kind === 'assignment').title, assignmentTitle);
  assert.equal(parsed.items.find((item) => item.kind === 'exam').title, examTitle);

  const item = {
    kind: 'assignment',
    title: 'T'.repeat(300),
    courseName: 'C'.repeat(220),
    teacher: 'Teacher '.repeat(40),
    teacherEmail: 'teacher@example.com',
    room: 'Room '.repeat(30),
    details: 'D'.repeat(1200),
    sourceSnippet: 'S'.repeat(300)
  };
  const normalized = semester.normalizeSemesterSetup({ drafts: [{ items: [item], sources: [] }] });
  const stored = normalized.drafts[0].items[0];
  assert.equal(stored.title, item.title);
  assert.equal(stored.courseName, item.courseName);
  assert.equal(stored.teacher, item.teacher.trim());
  assert.equal(stored.room, item.room.trim());
  assert.equal(stored.details, item.details);
  assert.equal(stored.sourceSnippet, item.sourceSnippet.slice(0, 240));
});

test('import previews keep long item fields while retaining the source-size boundary', () => {
  const title = 'Imported assignment ' + 'T'.repeat(320);
  const course = 'Course ' + 'C'.repeat(220);
  const details = 'Details ' + 'D'.repeat(12500);
  const csv = `title,course,due,details\n"${title}","${course}",2026-09-12,"${details}"`;
  const batch = imported.preview({ format: 'csv', sourceId: 'csv-1', text: csv });
  assert.equal(batch.items[0].title, title);
  assert.equal(batch.items[0].courseName, course);
  assert.equal(batch.items[0].details, details);
  assert.equal(batch.warnings.length, 0);
});

test('AP Study keeps long quick-task text through workspace normalization', () => {
  const normalize = loadApNormalizer();
  const text = 'Quick task ' + 'Q'.repeat(180);
  const workspace = normalize({ subjects: [{ id: 'ap', name: 'AP Biology', quickTasks: [{ id: 'task', text }] }] });
  assert.equal(workspace.subjects[0].quickTasks[0].text, text);
});
