// Keep the original tests and assertions. A fresh CLI/browser process per case
// avoids shared Edge sessions being dropped on resource-constrained desktops.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
const config = 'tests/desktop/playwright.config.mjs';
const testArgs = process.argv.slice(2);

function run(args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    let output = '', errors = '';
    if (capture) {
      child.stdout.on('data', data => output += data);
      child.stderr.on('data', data => errors += data);
    }
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output, errors }));
  });
}

const listing = await run(['test', '--config', config, '--list', '--reporter=json'], true);
if (listing.code !== 0) throw new Error(listing.errors || listing.output || 'Could not discover desktop tests.');
const report = JSON.parse(listing.output);
if (report.errors?.length) throw new Error('Desktop test discovery reported errors.');
const specs = [];
function collect(suites) {
  for (const suite of suites || []) {
    specs.push(...(suite.specs || []));
    collect(suite.suites);
  }
}
collect(report.suites);
if (!specs.length) throw new Error('No desktop tests were discovered.');
let failures = 0;
for (let index = 0; index < specs.length; index++) {
  const spec = specs[index];
  const location = `${path.relative(root, spec.file).replaceAll('\\', '/')}:${spec.line}`;
  console.log(`\n[${index + 1}/${specs.length}] ${spec.title}`);
  const result = await run(['test', '--config', config, location, '--workers=1', '--reporter=list', '--output', `output/desktop-isolated/${index + 1}`, ...testArgs]);
  if (result.code !== 0) failures++;
}
console.log(`\nDesktop isolation: ${specs.length - failures} passed, ${failures} failed, ${specs.length} total.`);
process.exitCode = failures ? 1 : 0;
