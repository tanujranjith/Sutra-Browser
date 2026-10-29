import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const homework = readFileSync(new URL('../../src/features/study/homework.js', import.meta.url), 'utf8');

test('the Homework by-class view makes saved empty classes visible', () => {
  const emptyState = extractFunction(homework, 'renderEmptyClassState');
  assert.ok(emptyState, 'Homework has a dedicated empty-class state');
  assert.match(emptyState.body, /Your classes are ready/);
  assert.match(emptyState.body, /No assignments yet/);

  const panel = extractFunction(homework, 'renderHomeworkAssignmentsPanel');
  assert.ok(panel, 'Homework assignments panel is available');
  assert.match(panel.body, /homeworkViewState\.tab === 'class'/);
  assert.match(panel.body, /renderEmptyClassState\(\)/, 'saved classes render even before they have assignments');
});
