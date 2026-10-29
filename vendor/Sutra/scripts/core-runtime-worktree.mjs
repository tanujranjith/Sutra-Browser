#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve('.');
const name = String(process.argv[2] || '').trim().toLowerCase();
const primaryBranch = process.env.SUTRA_PRIMARY_BRANCH || 'main';

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(name)) {
  console.error('Usage: npm run core:worktree -- <short-task-name>');
  console.error('Task names must use lowercase letters, numbers, and hyphens.');
  process.exit(1);
}

try {
  if (git(['branch', '--show-current']) !== primaryBranch) throw new Error(`run this from the verified ${primaryBranch} worktree`);
  if (git(['status', '--porcelain'])) throw new Error('primary worktree is dirty; commit or recover it before creating a candidate');
  git(['rev-parse', '--verify', primaryBranch]);
  const branch = `codex/${name}`;
  let branchExists = false;
  try {
    git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    branchExists = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (branchExists) throw new Error(`branch ${branch} already exists`);
  const path = resolve(repoRoot, '.tmp', 'worktrees', name);
  if (existsSync(path)) throw new Error(`worktree path already exists: ${path}`);
  execFileSync('git', ['worktree', 'add', '-b', branch, path, primaryBranch], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`Candidate worktree created: ${path}`);
  console.log(`Make core changes only there, then run: npm run core:integrate -- ${branch}`);
} catch (error) {
  console.error(`core:worktree failed: ${error.message}`);
  process.exit(1);
}
