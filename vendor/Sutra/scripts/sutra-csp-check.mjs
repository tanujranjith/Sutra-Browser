#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { APPROVED_CONNECT_WILDCARDS, INLINE_CODE_BUDGETS, buildCsp } from './lib/csp-policy.mjs';

const files = ['index.html', 'HomePage.html', 'Sutra.html'];
// OneDrive restore fetches encrypted backup bytes from Microsoft's sharded
// content CDN, whose host is dynamic per account/region. These SPECIFIC provider
// wildcard families are a reviewed connect-src exception; any OTHER connect/
// frame-src wildcard still fails the check below.
let failures = 0;
const expectedMeta = buildCsp();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  if (!match) {
    console.error(`FAIL ${file}: missing CSP meta tag`);
    failures += 1;
    continue;
  }
  const csp = match[1];
  if (csp !== expectedMeta) {
    console.error(`FAIL ${file}: CSP differs from scripts/lib/csp-policy.mjs; run npm run csp:generate`);
    failures += 1;
  }
  let connectForWildcardCheck = csp.replace(/localhost:\*/g, '').replace(/127\.0\.0\.1:\*/g, '');
  for (const wildcard of APPROVED_CONNECT_WILDCARDS) connectForWildcardCheck = connectForWildcardCheck.split(wildcard).join('');
  if (/frame-src[^;]*\*/.test(csp) || /connect-src[^;]*\*/.test(connectForWildcardCheck)) {
    console.error(`FAIL ${file}: CSP contains an arbitrary frame/connect wildcard`);
    failures += 1;
  }
}

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const wildcardHeader = (vercel.headers || []).find((entry) => entry.source === '/(.*)');
const vercelCsp = wildcardHeader && (wildcardHeader.headers || []).find((entry) => String(entry.key).toLowerCase() === 'content-security-policy');
if (!vercelCsp || vercelCsp.value !== buildCsp({ includeFrameAncestors: true })) {
  console.error('FAIL vercel.json: CSP header differs from the canonical policy');
  failures += 1;
}
const server = readFileSync('scripts/serve-static.mjs', 'utf8');
if (!server.includes("buildCsp({ includeFrameAncestors: true })")) {
  console.error('FAIL scripts/serve-static.mjs: local server does not consume the canonical CSP');
  failures += 1;
}

for (const [file, budget] of Object.entries(INLINE_CODE_BUDGETS)) {
  const text = readFileSync(file, 'utf8');
  const scriptCount = Array.from(text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)).length;
  const styleCount = Array.from(text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)).length;
  if (scriptCount > budget.scripts || styleCount > budget.styles) {
    console.error(`FAIL ${file}: inline-code budget increased (scripts ${scriptCount}/${budget.scripts}, styles ${styleCount}/${budget.styles})`);
    failures += 1;
  }
}

for (const file of ['Sutra.html', 'HomePage.html', 'index.html']) {
  const text = readFileSync(file, 'utf8');
  if (/fonts\.googleapis|fonts\.gstatic/.test(text)) {
    console.error(`FAIL ${file}: eager Google Fonts startup request remains`);
    failures += 1;
  }
}

const docs = readFileSync('docs/release/TESTING_AND_RELEASE_CHECKLIST.md', 'utf8');
if (!docs.includes('frame-ancestors') || !docs.includes('hosting header')) {
  console.error('FAIL docs/release/TESTING_AND_RELEASE_CHECKLIST.md: hosting-header CSP follow-up is not documented');
  failures += 1;
}

if (failures) {
  console.error(`CSP check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('CSP check passed.');
