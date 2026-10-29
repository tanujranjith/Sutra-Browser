#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve('.');
const candidateBranch = String(process.argv[2] || '').trim();
const primaryBranch = process.env.SUTRA_PRIMARY_BRANCH || 'main';
const isWindows = process.platform === 'win32';
const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npxCli = resolve(dirname(npmCli), 'npx-cli.js');
const npmCommand = isWindows ? process.execPath : 'npm';
const npxCommand = isWindows ? process.execPath : 'npx';
const npmPrefix = isWindows ? [npmCli] : [];
const npxPrefix = isWindows ? [npxCli] : [];

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env });
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function candidateWorktree(branch) {
  const lines = git(['worktree', 'list', '--porcelain']).split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length), branch: '' };
    else if (current && line.startsWith('branch ')) current.branch = line.slice('branch '.length);
    else if (!line && current) {
      if (current.branch === `refs/heads/${branch}`) return current.path;
      current = null;
    }
  }
  return current && current.branch === `refs/heads/${branch}` ? current.path : '';
}

try {
  if (!candidateBranch) throw new Error('Usage: npm run core:integrate -- codex/<task-name>');
  if (git(['branch', '--show-current']) !== primaryBranch) throw new Error(`run integration from the ${primaryBranch} worktree`);
  if (git(['status', '--porcelain'])) throw new Error('primary worktree is dirty; integration is intentionally fail-closed');
  git(['show-ref', '--verify', '--quiet', `refs/heads/${candidateBranch}`]);
  git(['merge-base', '--is-ancestor', primaryBranch, candidateBranch]);
  const candidatePath = candidateWorktree(candidateBranch);
  if (!candidatePath || resolve(candidatePath) === repoRoot) throw new Error('candidate branch is not checked out in a separate worktree');
  if (git(['-C', candidatePath, 'status', '--porcelain'])) throw new Error('candidate worktree is dirty; commit its verified changes first');

  console.log(`Validating isolated candidate ${candidateBranch} at ${candidatePath}`);
  run(npmCommand, [...npmPrefix, 'run', 'check:runtime'], candidatePath);
  run(npmCommand, [...npmPrefix, 'run', 'check:all'], candidatePath);
  run(npmCommand, [...npmPrefix, 'run', 'test:unit'], candidatePath);
  const browserPort = await reservePort();
  run(
    npxCommand,
    [...npxPrefix, 'playwright', 'test', '--project=chromium', '--workers=1', 'tests/e2e/startup-health.spec.mjs', 'tests/e2e/today-redesign.spec.mjs'],
    candidatePath,
    { ...process.env, PLAYWRIGHT_PORT: String(browserPort), CI: '1' }
  );

  execFileSync('git', ['merge', '--ff-only', candidateBranch], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`Integrated ${candidateBranch} into ${primaryBranch}. Build/cache-stamp deployment artifacts only after the desired release checks pass.`);
} catch (error) {
  console.error(`core:integrate blocked: ${String(error.stderr || error.message).trim()}`);
  process.exit(1);
}
