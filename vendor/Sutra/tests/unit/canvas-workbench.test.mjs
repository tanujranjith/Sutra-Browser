import test from 'node:test';
import assert from 'node:assert/strict';
import workbench from '../../src/features/workspace/canvas-workbench.js';

function objects() {
  return [
    { id: 'a', x: 10, y: 20, width: 100, height: 50, zIndex: 1, locked: false },
    { id: 'b', x: 210, y: 100, width: 80, height: 60, zIndex: 2, locked: false },
    { id: 'c', x: 400, y: 220, width: 120, height: 70, zIndex: 3, locked: false }
  ];
}

test('bounds, fit-to-content, and marquee selection are deterministic', () => {
  const list = objects();
  assert.deepEqual(workbench.getBounds(list), { x: 10, y: 20, width: 510, height: 270, right: 520, bottom: 290 });
  const viewport = workbench.fitViewport(list, { width: 1020, height: 540 }, { padding: 0, maxZoom: 4 });
  assert.equal(viewport.zoom, 2);
  assert.equal(viewport.x, -20);
  assert.equal(viewport.y, -40);
  assert.deepEqual(workbench.selectInRect(list, { x: 0, y: 0, width: 300, height: 180 }).sort(), ['a', 'b']);
  assert.deepEqual(workbench.selectInRect(list, { x: 0, y: 0, width: 250, height: 130 }, { mode: 'contain' }), ['a']);
});

test('alignment, distribution, tidy grid, and layers preserve source input', () => {
  const source = objects();
  const aligned = workbench.arrange(source, ['a', 'b', 'c'], 'align-left');
  assert.equal(aligned.ok, true);
  assert.deepEqual(aligned.objects.map((item) => item.x), [10, 10, 10]);
  assert.deepEqual(source.map((item) => item.x), [10, 210, 400]);

  const distributed = workbench.arrange(source, ['a', 'b', 'c'], 'distribute-horizontal');
  assert.equal(distributed.objects[0].x, 10);
  assert.equal(distributed.objects[2].x, 400);
  assert.equal(distributed.objects[1].x, 215);

  const tidy = workbench.arrange(source, ['a', 'b', 'c'], 'tidy-grid', { gap: 20 });
  assert.deepEqual(tidy.objects.map((item) => [item.x, item.y]), [[10, 20], [150, 20], [10, 110]]);

  const front = workbench.changeLayer(source, ['a'], 'front');
  assert.equal(front.objects.find((item) => item.id === 'a').zIndex, 3);
  assert.equal(front.objects.find((item) => item.id === 'c').zIndex, 2);
});

test('locked objects resist geometry changes but can be deliberately unlocked', () => {
  const source = objects();
  source[1].locked = true;
  const nudged = workbench.nudge(source, ['a', 'b'], 9, 9, { snapToGrid: true, gridSize: 16 });
  assert.deepEqual([nudged.objects[0].x, nudged.objects[0].y], [16, 32]);
  assert.deepEqual([nudged.objects[1].x, nudged.objects[1].y], [210, 100]);
  const unlocked = workbench.toggleLocked(source, ['b'], false);
  assert.equal(unlocked.objects[1].locked, false);
  assert.equal(source[1].locked, true);
});

test('clipboard round-trips selected objects with their internal connections and groups', () => {
  const model = {
    objects: [
      { id: 'a', x: 0, y: 0, width: 100, height: 50, groupId: 'g', locked: true },
      { id: 'b', x: 120, y: 0, width: 100, height: 50, groupId: 'g' },
      { id: 'c', x: 240, y: 0, width: 100, height: 50 }
    ],
    connections: [{ id: 'edge', fromId: 'a', toId: 'b' }, { id: 'outside', fromId: 'b', toId: 'c' }],
    groups: [{ id: 'g', objectIds: ['a', 'b'], label: 'Pair' }]
  };
  const clipboard = workbench.copySelection(model, ['a', 'b']);
  assert.equal(clipboard.connections.length, 1);
  assert.equal(clipboard.groups.length, 1);
  let sequence = 0;
  const pasted = workbench.pasteSelection(model, clipboard, { idFactory: () => `new-${++sequence}`, offset: 32 });
  assert.equal(pasted.ok, true);
  assert.equal(pasted.selectedIds.length, 2);
  assert.equal(pasted.model.objects.length, 5);
  assert.equal(pasted.model.connections.length, 3);
  assert.equal(pasted.model.groups.length, 2);
  const created = pasted.model.objects.slice(-2);
  assert.equal(created[0].locked, false);
  assert.deepEqual(created.map((item) => item.x), [32, 152]);
  assert.equal(created[0].groupId, created[1].groupId);
});
