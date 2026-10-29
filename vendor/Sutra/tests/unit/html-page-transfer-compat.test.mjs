import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const compat = readFileSync(new URL('../../src/features/workspace/html-page-transfer-compat.js', import.meta.url), 'utf8');

function loadMigration() {
  const context = {
    window: {
      SutraMigrations: {
        migrateWorkspace(input) {
          return { workspace: input };
        }
      }
    }
  };
  vm.runInNewContext(compat, context, { filename: 'html-page-transfer-compat.js' });
  return context.window.SutraMigrations.migrateWorkspace;
}

test('legacy HTML page content becomes the canonical htmlDocument source', () => {
  const migrateWorkspace = loadMigration();
  const result = migrateWorkspace({
    version: 8,
    pages: [{ id: 'legacy-html', type: 'html', title: 'Legacy demo', content: '<h1>Keep this source</h1>' }]
  }, { targetVersion: 8 });
  const page = result.workspace.pages[0];

  assert.equal(page.content, '');
  assert.equal(page.htmlDocument.version, 1);
  assert.equal(page.htmlDocument.source, '<h1>Keep this source</h1>');
});

test('legacy source aliases are accepted only for explicit HTML page types', () => {
  const migrateWorkspace = loadMigration();
  const result = migrateWorkspace({
    version: 8,
    pages: [
      { id: 'legacy-html-page', type: 'html-page', content: 'stale content', html: '<main>HTML alias</main>' },
      { id: 'ordinary-note', type: 'note', content: '<h1>Ordinary note</h1>' }
    ]
  }, { targetVersion: 8 });

  assert.equal(result.workspace.pages[0].htmlDocument.source, '<main>HTML alias</main>');
  assert.equal(result.workspace.pages[0].content, '');
  assert.equal(result.workspace.pages[1].htmlDocument, undefined);
  assert.equal(result.workspace.pages[1].content, '<h1>Ordinary note</h1>');
});

test('the migration wrapper does not mutate the import input', () => {
  const migrateWorkspace = loadMigration();
  const input = {
    version: 8,
    pages: [{ id: 'legacy-html', type: 'html_page', source: '<p>Wrapped source</p>' }]
  };
  const result = migrateWorkspace(input, { targetVersion: 8 });

  assert.equal(result.workspace.pages[0].htmlDocument.source, '<p>Wrapped source</p>');
  assert.equal(result.workspace.pages[0].content, '');
  assert.equal(input.pages[0].htmlDocument, undefined, 'compatibility must not mutate the import input');
});
