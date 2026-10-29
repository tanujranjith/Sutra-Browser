#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCsp } from './lib/csp-policy.mjs';

const checkOnly = process.argv.includes('--check');
const metaPolicy = buildCsp();
const headerPolicy = buildCsp({ includeFrameAncestors: true });
const failures = [];

function update(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) return;
  if (checkOnly) failures.push(path);
  else writeFileSync(path, after, 'utf8');
}

for (const path of ['index.html', 'HomePage.html', 'Sutra.html']) {
  update(path, (text) => {
    const pattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(">)/i;
    if (!pattern.test(text)) throw new Error(`${path} has no replaceable CSP meta tag.`);
    return text.replace(pattern, `$1${metaPolicy}$2`);
  });
}

update('vercel.json', (text) => {
  const config = JSON.parse(text);
  const wildcard = (config.headers || []).find((entry) => entry.source === '/(.*)');
  const header = wildcard && (wildcard.headers || []).find((entry) => String(entry.key).toLowerCase() === 'content-security-policy');
  if (!header) throw new Error('vercel.json is missing the wildcard CSP header.');
  header.value = headerPolicy;
  return `${JSON.stringify(config, null, 2)}\n`;
});

if (failures.length) {
  console.error(`Canonical CSP output is stale: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(checkOnly ? 'Canonical CSP outputs are current.' : 'Canonical CSP outputs generated.');
