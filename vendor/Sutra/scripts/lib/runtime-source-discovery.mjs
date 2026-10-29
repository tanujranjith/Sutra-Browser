import { readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// These are source categories, not ad-hoc filenames. Each exclusion has an
// explicit reason so first-party runtime code cannot disappear silently.
export const EXCLUDED_DIRECTORY_REASONS = Object.freeze({
  vendor: 'third-party vendored code is governed by its pinned upstream artifact',
  generated: 'generated output is checked against its owning generator',
  fixtures: 'test fixtures are hostile/non-runtime inputs by design',
  legacy: 'legacy applications are outside the current Sutra runtime',
  'test-output': 'ephemeral test artifacts are not application source',
  deployment: 'built deployment artifacts are verified by deploy checks'
});

export function isGeneratedRuntimeFile(path) {
  return /(?:^|\/)[^/]+\.generated\.(?:js|html)$/i.test(String(path).replace(/\\/g, '/'));
}

function walk(root, repoRoot, found, excluded) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    const relativePath = relative(repoRoot, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      const reason = EXCLUDED_DIRECTORY_REASONS[entry.name.toLowerCase()];
      if (reason) excluded.push({ path: relativePath + '/', reason });
      else walk(absolute, repoRoot, found, excluded);
      continue;
    }
    if (!entry.isFile() || !/\.js$/i.test(entry.name)) continue;
    if (isGeneratedRuntimeFile(relativePath)) {
      excluded.push({ path: relativePath, reason: 'generated output is checked against its owning generator' });
      continue;
    }
    found.push(relativePath);
  }
}

export function discoverRuntimeSources(repoRoot) {
  const root = resolve(repoRoot);
  const files = [];
  const excluded = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.html$/i.test(entry.name) && !isGeneratedRuntimeFile(entry.name)) {
      files.push(entry.name);
    }
  }
  walk(resolve(root, 'src'), root, files, excluded);
  return { files: files.sort(), excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)) };
}
