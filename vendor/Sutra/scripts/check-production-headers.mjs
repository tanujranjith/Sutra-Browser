#!/usr/bin/env node
/**
 * Validate Sutra's required production response headers.
 *
 * With no URL this checks vercel.json. Supply a deployed HTTPS URL as the
 * first argument (or SUTRA_DEPLOYED_URL) to verify the headers browsers
 * actually receive: npm run check:headers -- https://example.test/Sutra.html
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = {
  'content-security-policy': [
    /default-src\s+'self'/i,
    /object-src\s+'none'/i,
    /frame-ancestors\s+'none'/i
  ],
  'x-content-type-options': [/^nosniff$/i],
  'referrer-policy': [/^no-referrer$/i],
  'permissions-policy': [/camera=\(\)/i, /microphone=\(self\)/i],
  'cross-origin-opener-policy': [/^same-origin-allow-popups$/i],
  'cross-origin-resource-policy': [/^same-origin$/i],
  'strict-transport-security': [/max-age=\d+/i]
};

function verify(headers, label) {
  const failures = [];
  for (const [name, patterns] of Object.entries(REQUIRED)) {
    const value = String(headers[name] || '').trim();
    if (!value) {
      failures.push(name + ': missing');
      continue;
    }
    for (const pattern of patterns) {
      if (!pattern.test(value)) failures.push(name + ': missing ' + pattern + ' in ' + JSON.stringify(value));
    }
  }
  if (headers['cross-origin-embedder-policy']) {
    console.log('  COEP enabled: ' + headers['cross-origin-embedder-policy']);
  } else {
    console.log('  COEP intentionally omitted: Sutra embeds approved cross-origin media and OAuth/provider flows.');
  }
  if (failures.length) {
    console.error('Production header check FAILED (' + label + '):\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('Production header check passed (' + label + ').');
}

const target = process.argv[2] || process.env.SUTRA_DEPLOYED_URL;
if (target) {
  const url = new URL(target);
  if (url.protocol !== 'https:') throw new Error('Production header checks require an HTTPS URL.');
  // Header verification does not need a response body. HEAD also mirrors the
  // release acceptance check and avoids downloading the full static shell.
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error('Header target returned HTTP ' + response.status + ': ' + response.url);
  verify(Object.fromEntries(response.headers.entries()), response.url);
} else {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
  const wildcard = (config.headers || []).find((entry) => entry.source === '/(.*)');
  if (!wildcard) throw new Error('vercel.json has no wildcard response-header rule.');
  const values = Object.fromEntries((wildcard.headers || []).map((item) => [String(item.key).toLowerCase(), item.value]));
  verify(values, 'vercel.json');
}
