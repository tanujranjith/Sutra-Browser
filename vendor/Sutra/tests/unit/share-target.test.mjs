import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../../src/features/workspace/share-target.js');

function mockFile(name, type, size = 100, content = 'content') {
    return { name, type, size, async text() { return content; } };
}

test('classifies title, text, URL, image, PDF, and supported documents', () => {
    assert.equal(api.classifyPayload({ title: 'Idea', files: [] }), 'text');
    assert.equal(api.classifyPayload({ url: 'https://example.com', files: [] }), 'url');
    assert.equal(api.classifyPayload({ text: 'Read https://example.com', files: [] }), 'url-with-text');
    assert.equal(api.classifyPayload({ files: [mockFile('photo.png', 'image/png')] }), 'image');
    assert.equal(api.classifyPayload({ files: [mockFile('paper.pdf', 'application/pdf')] }), 'pdf');
    assert.equal(api.classifyPayload({ files: [mockFile('essay.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')] }), 'document');
});

test('rejects unsupported, oversized, excessive, and empty shares', () => {
    assert.equal(api.validatePayload({ files: [mockFile('script.js', 'application/javascript')] }).code, 'unsupported_type');
    assert.equal(api.validatePayload({ files: [mockFile('large.pdf', 'application/pdf', api.MAX_FILE_SIZE + 1)] }).code, 'file_too_large');
    assert.equal(api.validatePayload({ files: Array.from({ length: api.MAX_FILES + 1 }, (_, index) => mockFile(index + '.txt', 'text/plain')) }).code, 'too_many_files');
    assert.equal(api.validatePayload({ files: [] }).code, 'empty');
    assert.equal(api.validatePayload({ url: 'javascript:alert(1)', files: [] }).code, 'unsafe_url');
});

test('preserves source title and URL in composed text without duplicating either', () => {
    assert.equal(
        api.composeText({ title: 'Source title', text: 'Source body', url: 'https://example.com' }),
        'Source title\n\nSource body\n\nhttps://example.com'
    );
    assert.equal(
        api.composeText({ title: 'Same', text: 'Same', url: 'https://example.com\n' }),
        'Same\n\nhttps://example.com'
    );
});

test('routes approved text through canonical Quick Capture with destination correction', async () => {
    let received = '';
    globalThis.flowAtelier = { openQuickCaptureModal(value) { received = value; return true; } };
    const result = await api.routeApprovedShare({ title: 'Lab report', text: 'Finish conclusion', url: 'https://school.test/lab', files: [] }, 'homework');
    assert.equal(result, true);
    assert.equal(received, 'homework: Lab report\n\nFinish conclusion\n\nhttps://school.test/lab');
});

test('routes supported text files to Smart Import without a permanent pre-confirmation write', async () => {
    let received = '';
    globalThis.flowAtelier = {};
    globalThis.SutraSmartImport = { open(value) { received = value; } };
    const result = await api.routeApprovedShare({ title: 'Syllabus', text: '', url: '', files: [mockFile('syllabus.txt', 'text/plain', 20, 'Quiz Friday')] }, 'homework');
    assert.equal(result, true);
    assert.equal(received, 'homework: Syllabus\n\nQuiz Friday');
});

test('cross-tab share-ready messages enforce same-origin, allowing only same-origin or empty origins', () => {
    assert.equal(api.isTrustedMessageOrigin('https://sutra.example', 'https://sutra.example'), true);
    assert.equal(api.isTrustedMessageOrigin('', 'https://sutra.example'), true, 'service-worker messages carry an empty origin');
    assert.equal(api.isTrustedMessageOrigin('https://sutra.example', ''), true, 'no known same-origin to compare against');
    assert.equal(api.isTrustedMessageOrigin('https://evil.example', 'https://sutra.example'), false, 'cross-origin sender must be rejected');
});

test('destination correction for text files reaches Smart Import before the note importer', async () => {
    let received = '';
    let importerCalls = 0;
    globalThis.SutraSmartImport = { open(value) { received = value; } };
    globalThis.SutraDocumentImport = { async importSharedFiles() { importerCalls += 1; return true; } };
    const result = await api.routeApprovedShare({ title: 'Exam dates', text: '', url: '', files: [mockFile('dates.txt', 'text/plain', 20, 'Test Friday')] }, 'homework');
    assert.equal(result, true);
    assert.equal(received, 'homework: Exam dates\n\nTest Friday');
    assert.equal(importerCalls, 0);
});
