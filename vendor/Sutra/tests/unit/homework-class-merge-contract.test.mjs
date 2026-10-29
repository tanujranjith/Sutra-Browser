import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const homework = readFileSync(new URL('../../src/features/study/homework.js', import.meta.url), 'utf8');

test('Homework exposes class actions and a recoverable merge path', () => {
  const actions = extractFunction(homework, 'renderCourseGroupActions');
  assert.ok(actions, 'class group actions are rendered by a dedicated helper');
  assert.match(actions.body, /data-course-menu-trigger/);
  assert.match(actions.body, /data-course-merge/);
  assert.match(actions.body, /data-course-delete/);

  const merge = extractFunction(homework, 'mergeClasses');
  assert.ok(merge, 'class merging is implemented as a named operation');
  assert.match(merge.body, /type !== 'class'/);
  assert.match(merge.body, /store\.transact/);
  assert.match(merge.body, /courseId: String\(target\.id\)/);
  assert.match(merge.body, /archiveCourse\(source\.id, true\)/);
  assert.match(merge.body, /could not be merged safely/);

  const api = homework.slice(homework.lastIndexOf('Object.assign(window.SutraHomework'));
  assert.match(api, /mergeClasses,/);
});

test('empty class rows retain the same merge actions as populated class groups', () => {
  const emptyState = extractFunction(homework, 'renderEmptyClassState');
  assert.ok(emptyState, 'empty class state remains explicit');
  assert.match(emptyState.body, /renderCourseGroupActions\(course, 'Class', course\.name\)/);
});
