#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { buildCsp } from './lib/csp-policy.mjs';
import { assertCoreRuntimeIntegrity, checkCoreRuntimeSource } from './lib/core-runtime-integrity.mjs';

const root = resolve(process.env.SUTRA_SERVE_ROOT || process.cwd());
const port = Number(process.env.PORT || process.argv[2] || 5173);

try {
  assertCoreRuntimeIntegrity({ appPath: join(root, 'src/core/app.js') });
} catch (error) {
  console.error(error.message);
  console.error('Static server not started — repair the core runtime before serving Sutra.');
  process.exit(1);
}

const coreRuntimePath = join(root, 'src/core/app.js');
let lastVerifiedRuntime = {
  source: readFileSync(coreRuntimePath, 'utf8'),
  fingerprint: null,
  rejectedFingerprint: null
};

function getRuntimeFingerprint() {
  const info = statSync(coreRuntimePath);
  return `${info.size}:${info.mtimeMs}`;
}

function refreshVerifiedRuntime() {
  let fingerprint;
  try {
    fingerprint = getRuntimeFingerprint();
  } catch (error) {
    console.error(`Core runtime guard: could not stat app.js; serving the last verified runtime. ${error.message}`);
    return false;
  }
  if (fingerprint === lastVerifiedRuntime.fingerprint) return true;

  try {
    const candidate = readFileSync(coreRuntimePath, 'utf8');
    const result = checkCoreRuntimeSource(candidate, { appPath: coreRuntimePath, bytes: Buffer.byteLength(candidate, 'utf8') });
    if (!result.ok) {
      if (fingerprint !== lastVerifiedRuntime.rejectedFingerprint) {
        console.error(`Core runtime guard rejected changed app.js; serving the last verified runtime.\n- ${result.failures.join('\n- ')}`);
        lastVerifiedRuntime.rejectedFingerprint = fingerprint;
      }
      return false;
    }
    lastVerifiedRuntime = { source: candidate, fingerprint, rejectedFingerprint: null };
    console.log('Core runtime guard accepted a newly validated app.js.');
    return true;
  } catch (error) {
    if (fingerprint !== lastVerifiedRuntime.rejectedFingerprint) {
      console.error(`Core runtime guard could not validate changed app.js; serving the last verified runtime. ${error.message}`);
      lastVerifiedRuntime.rejectedFingerprint = fingerprint;
    }
    return false;
  }
}

lastVerifiedRuntime.fingerprint = getRuntimeFingerprint();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function resolveRequestPath(urlPath) {
  const cleanPath = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const target = normalize(join(root, cleanPath === '/' ? 'index.html' : cleanPath));
  if (!target.startsWith(root)) return null;
  if (!existsSync(target)) return null;
  const info = statSync(target);
  if (info.isDirectory()) return join(target, 'index.html');
  return target;
}

const server = createServer((req, res) => {
  const filePath = resolveRequestPath(req.url);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const type = types[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': buildCsp({ includeFrameAncestors: true })
  };
  if (filePath === coreRuntimePath) {
    const accepted = refreshVerifiedRuntime();
    headers['X-Sutra-Core-Runtime'] = accepted ? 'verified' : 'fallback-last-verified';
    res.writeHead(200, headers);
    res.end(lastVerifiedRuntime.source);
    return;
  }
  res.writeHead(200, headers);
  // Stream the file, but never let an aborted request (the browser cancels
  // in-flight resource loads constantly during rapid navigation in the e2e
  // suite) throw an UNHANDLED stream error that would crash the whole server
  // and cascade `page.goto` timeouts into unrelated tests. Fail the single
  // response quietly instead.
  const stream = createReadStream(filePath);
  stream.on('error', () => { try { res.destroy(); } catch (_) {} });
  res.on('error', () => { try { stream.destroy(); } catch (_) {} });
  req.on('aborted', () => { try { stream.destroy(); } catch (_) {} });
  stream.pipe(res);
});

// Don't let a malformed/early-closed client connection throw at the server level.
server.on('clientError', (err, socket) => {
  try { socket.destroy(); } catch (_) {}
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Sutra static server listening on http://127.0.0.1:${port}`);
});
