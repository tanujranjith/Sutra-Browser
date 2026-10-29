import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const source = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

function loadAppFunction(name, stubNames) {
  const extract = extractFunction(source, name);
  assert.ok(extract, `${name} must be a top-level declaration`);
  return new Function(...stubNames, `${extract.body}; return ${name};`);
}

test('the tutorial offers a short essentials path and a full walkthrough', () => {
  const getTutorialSteps = loadAppFunction('getTutorialSteps', ['tutorialTargetExists']);
  const full = getTutorialSteps(() => true)(false);
  const essentials = getTutorialSteps(() => true)(true);
  assert.equal(essentials.length, 6, 'the essentials tour is an intro plus exactly five steps');
  assert.ok(full.length > 50, 'the full tour remains a comprehensive walkthrough');
  assert.equal(essentials[0].title, 'The 5 essentials');
  assert.ok(essentials.slice(1).every(step => /^[1-5] · /.test(step.title)), 'the five numbered essentials steps follow the intro');
  assert.equal(essentials[6], undefined, 'there are no hidden extra essentials steps');
  assert.ok(full.some(step => step.title === 'You\'re ready to fly'), 'the full tour has a closing step');
  const body = extractFunction(source, 'getTutorialSteps').body;
  assert.ok(body.includes('essentialsOnly ? essentialSteps : allSteps'), 'the essentials path is a filtered subset of the full tour');
  assert.ok(body.includes('tutorialTargetExists(step.selector)'), 'dead selectors are filtered out before rendering');
});

test('the essentials command reuses the tutorial engine with skipConfirm', () => {
  const palette = source.indexOf("id: 'quick-start-tour'");
  assert.ok(palette >= 0, 'the quick-start command exists');
  const command = source.slice(palette, palette + 400);
  assert.ok(command.includes('startInteractiveTutorial(true, { skipConfirm: true, essentialsOnly: true })'), 'the command starts the essentials tour without a confirm dialog');
  const start = extractFunction(source, 'startInteractiveTutorial');
  assert.ok(start, 'startInteractiveTutorial is a top-level declaration');
  assert.ok(start.body.includes('getTutorialSteps(options.essentialsOnly === true)'), 'the skipConfirm branch builds the essentials steps');
  assert.ok(start.body.includes('tutorialState.steps = getTutorialSteps()'), 'the confirmed path starts the full tour');
  assert.ok(start.body.includes('options.skipConfirm === true'), 'the skipConfirm branch is explicit');
});
