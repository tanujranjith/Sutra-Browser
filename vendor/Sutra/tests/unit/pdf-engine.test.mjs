import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdf = require('../../src/features/workspace/pdf-engine.js');

test('validates PDF signatures and reports malformed bytes', () => {
  assert.deepEqual(pdf.validatePdfBytes(new TextEncoder().encode('%PDF-1.7\n')), { ok: true, code: 'pdf' });
  assert.equal(pdf.validatePdfBytes(new TextEncoder().encode('not a pdf')).ok, false);
  assert.equal(pdf.validatePdfBytes(new Uint8Array([1, 2])).code, 'too-small');
});

test('normalizes annotation geometry, style, ink, and form values', () => {
  const annotation = pdf.normalizeAnnotation({
    id: 'annotation', documentId: 'document', pageId: 'page', type: 'form',
    geometry: { x: -1, y: 0.8, width: 2, height: 1, rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.1 }] },
    style: { color: 'unsafe', opacity: 5 }, fieldKey: 'student.name', value: 'Ada'
  });
  assert.equal(annotation.geometry.x, 0);
  assert.equal(annotation.geometry.y, 0.8);
  assert.equal(annotation.geometry.width, 1);
  assert.ok(Math.abs(annotation.geometry.height - 0.2) < Number.EPSILON);
  assert.deepEqual(annotation.geometry.rects, [{ x: 0.2, y: 0.3, width: 0.4, height: 0.1 }]);
  assert.equal(annotation.style.color, '#facc15');
  assert.equal(annotation.style.opacity, 1);
  assert.equal(annotation.value, 'Ada');
});

test('keeps geometry stable across rotation transforms', () => {
  assert.deepEqual(pdf.unrotatePoint({ x: 0.2, y: 0.3 }, 0), { x: 0.2, y: 0.3 });
  assert.deepEqual(pdf.unrotatePoint({ x: 0.2, y: 0.3 }, 90), { x: 0.3, y: 0.8 });
  assert.deepEqual(pdf.unrotatePoint({ x: 0.2, y: 0.3 }, 180), { x: 0.8, y: 0.7 });
  assert.deepEqual(pdf.unrotatePoint({ x: 0.2, y: 0.3 }, 270), { x: 0.7, y: 0.2 });
  const roundTrip = pdf.rotatePoint(pdf.unrotatePoint({ x: 0.2, y: 0.3 }, 90), 90);
  assert.ok(Math.abs(roundTrip.x - 0.2) < Number.EPSILON);
  assert.equal(roundTrip.y, 0.3);
  const rect = pdf.unrotateRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, 90);
  assert.ok(Math.abs(rect.x - 0.2) < Number.EPSILON);
  assert.ok(Math.abs(rect.y - 0.6) < Number.EPSILON);
  assert.ok(Math.abs(rect.width - 0.1) < Number.EPSILON);
  assert.ok(Math.abs(rect.height - 0.3) < Number.EPSILON);
});

test('page plans preserve stable IDs while moving, rotating, inserting, and removing', () => {
  let document = pdf.makeDocument('file-a', 3);
  const ids = document.pages.map(page => page.id);
  document = pdf.applyPagePlan(document, { type: 'move', pageId: ids[2], toIndex: 0 });
  assert.deepEqual(document.pages.map(page => page.id), [ids[2], ids[0], ids[1]]);
  document = pdf.applyPagePlan(document, { type: 'rotate', pageId: ids[0], degrees: 90 });
  assert.equal(document.pages.find(page => page.id === ids[0]).rotation, 90);
  document = pdf.applyPagePlan(document, { type: 'remove', pageId: ids[1] });
  assert.deepEqual(document.pages.map(page => page.order), [0, 1]);
});

test('merge and split planners retain source file/page references', () => {
  const first = pdf.makeDocument('file-a', 2);
  const second = pdf.makeDocument('file-b', 2);
  const merged = pdf.mergeDocuments([first, second], 'assembled-file');
  assert.deepEqual(merged.pages.map(page => page.sourceFileId), ['file-a', 'file-a', 'file-b', 'file-b']);
  const parts = pdf.splitDocument(merged, [{ start: 0, end: 1 }, { start: 1, end: 4 }]);
  assert.deepEqual(parts.map(part => part.pages.length), [1, 3]);
  assert.equal(parts[1].pages[2].sourcePageIndex, 1);
});

test('attachment link normalization deduplicates many-to-many relationships', () => {
  const links = pdf.normalizeAttachmentLinks([
    { id: 'a', fileId: 'file', entityType: 'note', entityId: 'note', createdAt: '2026-01-01' },
    { id: 'b', fileId: 'file', entityType: 'note', entityId: 'note', createdAt: '2026-01-02' },
    { id: 'c', fileId: 'file', entityType: 'unsupported entity', entityId: 'x' }
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].id, 'a');
});

test('normalizers preserve future fields and schema versions', () => {
  const document = pdf.normalizeDocument({
    id: 'document', fileId: 'file', schemaVersion: 3, futureDocumentField: { retained: true },
    pages: [{ id: 'page', sourceFileId: 'file', sourcePageIndex: 0, futurePageField: 'retained' }],
    bookmarks: [{ id: 'bookmark', pageId: 'page', title: 'Saved', futureBookmarkField: 1 }],
    checkpoints: [{ id: 'checkpoint', label: 'Saved', pages: [], futureCheckpointField: 2 }]
  });
  const annotation = pdf.normalizeAnnotation({
    id: 'annotation', documentId: 'document', pageId: 'page', type: 'comment',
    geometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.1, futureGeometryField: 3 },
    style: { color: '#123456', futureStyleField: 4 }, futureAnnotationField: 5
  });
  const [link] = pdf.normalizeAttachmentLinks([{ id: 'link', fileId: 'file', entityType: 'future_entity', entityId: 'future', futureLinkField: 6 }]);

  assert.equal(document.schemaVersion, 3);
  assert.deepEqual(document.futureDocumentField, { retained: true });
  assert.equal(document.pages[0].futurePageField, 'retained');
  assert.equal(document.bookmarks[0].futureBookmarkField, 1);
  assert.equal(document.checkpoints[0].futureCheckpointField, 2);
  assert.equal(annotation.futureAnnotationField, 5);
  assert.equal(annotation.geometry.futureGeometryField, 3);
  assert.equal(annotation.style.futureStyleField, 4);
  assert.equal(link.entityType, 'future_entity');
  assert.equal(link.futureLinkField, 6);
});

test('export defaults choose annotated only when annotations exist', () => {
  assert.equal(pdf.resolveExportOptions({}, 0).mode, 'clean');
  assert.equal(pdf.resolveExportOptions({}, 2).mode, 'annotated');
  assert.deepEqual(pdf.resolveExportOptions({ mode: 'original', includeForms: false, flattenForms: true, includeCommentSummary: false }, 2), {
    mode: 'original', includeForms: false, flattenForms: true, includeCommentSummary: false
  });
});

test('detects signed, encrypted, and JavaScript-bearing source warnings', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 /Encrypt /Type /Sig /ByteRange [0 1 2 3] /JavaScript');
  assert.deepEqual(pdf.detectDocumentSecurity(bytes), { signed: true, encrypted: true, hasJavaScript: true });
});
