import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const engine = require('../../src/features/workspace/surface-assistant-actions.js');

function ids() {
  let value = 0;
  return () => `generated-${++value}`;
}

test('Canvas operation batches create, connect, group, arrange, and undo atomically', () => {
  const original = { version: 1, background: 'grid', objects: [], connections: [], groups: [] };
  const applied = engine.applyCanvas(original, [
    { type: 'add', clientId: 'claim', objectType: 'sticky', text: 'Claim' },
    { type: 'add', clientId: 'evidence', objectType: 'text', text: 'Evidence' },
    { type: 'connect', fromId: 'claim', toId: 'evidence', label: 'supported by' },
    { type: 'group', objectIds: ['claim', 'evidence'], label: 'Argument' },
    { type: 'arrange', objectIds: ['claim', 'evidence'], layout: 'row', gap: 24 },
    { type: 'background', value: 'dots' }
  ], { idFactory: ids(), now: '2026-08-07T12:00:00.000Z' });

  assert.equal(applied.ok, true);
  assert.equal(applied.model.objects.length, 2);
  assert.equal(applied.model.connections[0].fromId, applied.clientIds.claim);
  assert.equal(applied.model.groups[0].objectIds.length, 2);
  assert.equal(applied.model.background, 'dots');
  assert.deepEqual(original.objects, []);

  const undone = engine.undoCanvas(applied.model, applied.undo);
  assert.equal(undone.ok, true);
  assert.deepEqual(undone.model, original);
});

test('Canvas undo refuses to overwrite a later edit to a touched object', () => {
  const original = {
    version: 1,
    background: 'grid',
    objects: [{ id: 'object-1', type: 'text', text: 'Before', x: 0, y: 0, width: 220, height: 120, updatedAt: 'before' }],
    connections: [], groups: []
  };
  const applied = engine.applyCanvas(original, [{ type: 'update', objectId: 'object-1', patch: { text: 'Reviewed edit' } }], { idFactory: ids(), now: 'after' });
  assert.equal(applied.ok, true);
  const changedAgain = structuredClone(applied.model);
  changedAgain.objects[0].text = 'Student changed this later';
  const stale = engine.undoCanvas(changedAgain, applied.undo);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'stale_surface');
});

test('invalid Canvas operations leave the source model untouched', () => {
  const original = { background: 'grid', objects: [], connections: [], groups: [] };
  const before = structuredClone(original);
  const result = engine.applyCanvas(original, [{ type: 'connect', fromId: 'missing-a', toId: 'missing-b' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(original, before);
});

test('Slides operation batches add and edit structured local content with exact undo', () => {
  const original = { version: 1, theme: 'sutra', size: 'widescreen', slides: [] };
  const added = engine.applySlides(original, [{
    type: 'add_slide',
    title: 'Key finding',
    layout: 'blank',
    speakerNotes: 'Explain the evidence.',
    elements: [
      { elementType: 'text', text: 'A clear claim', x: 8, y: 10 },
      { elementType: 'chart', text: 'Results', chart: { labels: ['A', 'B'], values: [4, 9] } }
    ]
  }, { type: 'theme', theme: 'midnight' }], { idFactory: ids(), now: '2026-08-07T12:00:00.000Z' });

  assert.equal(added.ok, true);
  assert.equal(added.model.slides.length, 1);
  assert.equal(added.model.slides[0].elements[1].type, 'chart');
  assert.equal(added.model.theme, 'midnight');

  const slide = added.model.slides[0];
  const edited = engine.applySlides(added.model, [
    { type: 'update_slide', slideId: slide.id, title: 'Updated finding', speakerNotes: 'Updated notes.' },
    { type: 'arrange_elements', slideId: slide.id, elementIds: slide.elements.map((element) => element.id), layout: 'row' }
  ], { idFactory: ids(), now: '2026-08-07T12:01:00.000Z' });
  assert.equal(edited.ok, true);
  assert.equal(edited.model.slides[0].title, 'Updated finding');

  const undoEdit = engine.undoSlides(edited.model, edited.undo);
  assert.equal(undoEdit.ok, true);
  assert.deepEqual(undoEdit.model, added.model);
  const undoAdd = engine.undoSlides(undoEdit.model, added.undo);
  assert.equal(undoAdd.ok, false, 'the engine refuses an undo that would leave a deck empty');
});

test('Slides rejects remote/image injection and malformed chart replacements', () => {
  const deck = {
    version: 1, theme: 'sutra', size: 'widescreen',
    slides: [{ id: 'slide-1', title: 'One', layout: 'blank', elements: [{ id: 'image-1', type: 'image', dataUrl: 'data:image/png;base64,AA==' }, { id: 'chart-1', type: 'chart', chart: { labels: ['A'], values: [1] } }] }]
  };
  const imageEdit = engine.applySlides(deck, [{ type: 'update_element', slideId: 'slide-1', elementId: 'image-1', patch: { text: 'nope', dataUrl: 'https://example.com/image.png' } }]);
  assert.equal(imageEdit.ok, false);
  assert.equal(imageEdit.code, 'unsupported_target');
  const malformedChart = engine.applySlides(deck, [{ type: 'update_element', slideId: 'slide-1', elementId: 'chart-1', patch: { chart: { labels: ['A', 'B'], values: [1] } } }]);
  assert.equal(malformedChart.ok, false);
  const remoteImage = engine.applySlides({ version: 1, theme: 'sutra', size: 'widescreen', slides: [] }, [{ type: 'add_slide', title: 'Unsafe', elements: [{ elementType: 'image', src: 'https://example.com/image.png' }] }]);
  assert.equal(remoteImage.ok, false);
});
