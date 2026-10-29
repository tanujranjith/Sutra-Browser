import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('../../', import.meta.url));
const iconSource = readFileSync(new URL('../../src/components/icons/icon-paths.js', import.meta.url), 'utf8');
const nonIconClasses = new Set([
  'fa', 'fas', 'far', 'fab', 'fal', 'fa-solid', 'fa-regular', 'fa-brands',
  'fa-light', 'fa-thin', 'fa-duotone', 'fa-fw', 'fa-spin', 'fa-pulse',
  'fa-spin-pulse', 'fa-lg', 'fa-sm', 'fa-xs', 'fa-xl', 'fa-2x', 'fa-3x',
  'fa-4x', 'fa-5x', 'fa-6x', 'fa-7x', 'fa-8x', 'fa-9x', 'fa-10x'
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:html|js)$/.test(entry.name) ? [path] : [];
  });
}

test('every Font Awesome class used by Sutra maps to a local icon', () => {
  const pathSource = iconSource.split('// Maps any FA name')[0];
  const paths = new Set(
    Array.from(pathSource.matchAll(/^\s*'(?<name>[^']+)'\s*:/gm), (match) => match.groups.name)
  );
  const aliases = new Map(
    Array.from(iconSource.matchAll(/'(?<name>fa-[^']+)'\s*:\s*'(?<target>[^']+)'/g), (match) => [match.groups.name, match.groups.target])
  );
  const files = [join(rootPath, 'Sutra.html'), ...sourceFiles(join(rootPath, 'src'))];
  const missing = new Map();

  for (const file of files) {
    const classes = readFileSync(file, 'utf8').match(/fa-[A-Za-z0-9-]+/g) || [];
    for (const className of classes) {
      if (nonIconClasses.has(className)) continue;
      const target = aliases.get(className);
      if (target && paths.has(target)) continue;
      const locations = missing.get(className) || [];
      locations.push(relative(rootPath, file));
      missing.set(className, locations);
    }
  }

  assert.deepEqual(
    [...missing.entries()],
    [],
    `Missing local icon mappings: ${[...missing.keys()].join(', ')}`
  );
});
