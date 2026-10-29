#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'];
const failures = [];
const texts = Object.fromEntries(files.map((file) => [file, readFileSync(file, 'utf8')]));

for (const [file, source] of Object.entries(texts)) {
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
    const action = match[1];
    if (!/@[a-f0-9]{40}$/i.test(action)) failures.push(`${file}: action is not pinned to a 40-character commit SHA: ${action}`);
  }
  if (!/concurrency:[\s\S]*cancel-in-progress:\s*true/.test(source)) failures.push(`${file}: superseded runs are not cancelled`);
  if (!/cache:\s*npm/.test(source)) failures.push(`${file}: npm dependency cache is not configured`);
}

const ci = texts['.github/workflows/ci.yml'];
if (!/SUTRA_SERVE_ROOT:\s*\.deploy/.test(ci)) failures.push('ci.yml: browser tests do not serve the generated artifact');
if (!/download-artifact@[a-f0-9]{40}/i.test(ci)) failures.push('ci.yml: browser jobs do not download the build job artifact');
if (!/failure\(\)[\s\S]*playwright/i.test(ci)) failures.push('ci.yml: Playwright failure diagnostics are not retained');

const ciBrowserJob = ci.split(/^  browser-tests:/m)[1]?.split(/^  browser-compatibility-matrix:/m)[0] || '';
if (!ciBrowserJob.includes('shard: [1, 2, 3]') || !ciBrowserJob.includes('--shard=${{ matrix.shard }}/${{ strategy.job-total }}')) {
  failures.push('ci.yml: normal Chromium coverage is not split into parallel verified-artifact shards');
}
if (!ci.includes('PLAYWRIGHT_BROWSERS_PATH: ${{ runner.temp }}/ms-playwright')) {
  failures.push('ci.yml: Playwright browser path is not pinned to the runner temp directory');
}
if (!ci.includes('browser_install:') || !ci.includes('npx playwright install --with-deps ${{ matrix.browser_install }}')) {
  failures.push('ci.yml: compatibility lanes install a fixed browser set instead of their matrix browser set');
}
if (Object.values(texts).some((source) => source.includes('~/.cache/ms-playwright'))) {
  failures.push('workflows: Playwright cache still uses the ineffective literal ~/.cache/ms-playwright path');
}

const deploy = texts['.github/workflows/deploy.yml'];
const deployJob = deploy.split(/^  deploy:/m)[1]?.split(/^  live-smoke:/m)[0] || '';
const browserJob = deploy.split(/^  browser-tests:/m)[1]?.split(/^  package-pages:/m)[0] || '';
const packageJob = deploy.split(/^  package-pages:/m)[1]?.split(/^  deploy:/m)[0] || '';
if (!/needs:\s*release-gate/.test(browserJob) || !/--workers=1/.test(browserJob)) failures.push('deploy.yml: browser lanes must depend on the build and run serially');
if (!browserJob.includes('browser_install:') || !browserJob.includes('npx playwright install --with-deps ${{ matrix.browser_install }}')) {
  failures.push('deploy.yml: browser lanes install a fixed browser set instead of their matrix browser set');
}
if (!browserJob.includes('path: ${{ runner.temp }}/ms-playwright')) {
  failures.push('deploy.yml: Playwright cache is not stored in the runner temp directory');
}
for (const project of ['chromium', 'chrome', 'firefox', 'webkit', 'mobile-chromium', 'mobile-webkit', 'tablet', 'narrow-desktop']) {
  if (!new RegExp(`--project=${project}(?=\\s|$)`).test(browserJob)) failures.push(`deploy.yml: missing browser project ${project}`);
}
for (const [label, job] of [['browser', browserJob], ['packaging', packageJob]]) {
  if (!/download-artifact@[a-f0-9]{40}/i.test(job) || !/name:\s*deploy-candidate-\$\{\{ github.sha \}\}/.test(job)) failures.push(`deploy.yml: ${label} must download the original candidate artifact`);
  if (/build:deploy/.test(job)) failures.push(`deploy.yml: ${label} must not rebuild the candidate`);
}
if (!/needs:\s*\[release-gate, browser-tests\]/.test(packageJob) || /^\s+if:/m.test(packageJob)) failures.push('deploy.yml: Pages packaging must require all release checks to succeed');
if (!/needs:\s*package-pages/.test(deployJob)) failures.push('deploy.yml: deploy must depend on verified Pages packaging');
if (/checkout|build:deploy|npm\s/.test(deployJob)) failures.push('deploy.yml: deploy job rebuilds or checks out instead of using the verified Pages artifact');
if (!/SUTRA_SERVE_ROOT:\s*\.deploy/.test(deploy)) failures.push('deploy.yml: release gate does not browser-test .deploy');
if (!/upload-pages-artifact@[a-f0-9]{40}/i.test(deploy)) failures.push('deploy.yml: verified artifact is not uploaded to Pages');
if (!/permissions:\s*\n\s+pages:\s*write\s*\n\s+id-token:\s*write/.test(deployJob)) failures.push('deploy.yml: deploy permissions are missing or not job-scoped');

if (failures.length) {
  failures.forEach((failure) => console.error('FAIL', failure));
  process.exit(1);
}
console.log('Workflow check passed — immutable actions, cached dependencies, exact-artifact browser tests, and no deploy rebuild.');
