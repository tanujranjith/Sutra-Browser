#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCoreRuntime, blessCoreRuntimeBudget, CORE_RUNTIME_BUDGET_PATH } from './lib/core-runtime-integrity.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const explicitPath = process.argv.find((arg) => arg.startsWith('--app='));

if (process.argv.includes('--bless')) {
  const blessPath = explicitPath
    ? resolve(repoRoot, explicitPath.slice('--app='.length))
    : resolve(repoRoot, 'src/core/app.js');
  const reasonArg = process.argv.find((arg) => arg.startsWith('--reason='));
  const budget = blessCoreRuntimeBudget({
    appPath: blessPath,
    repoRoot,
    reason: reasonArg ? reasonArg.slice('--reason='.length) : '',
    allowGrowth: process.argv.includes('--allow-growth')
  });
  const outPath = resolve(repoRoot, CORE_RUNTIME_BUDGET_PATH);
  writeFileSync(outPath, `${JSON.stringify(budget, null, 2)}\n`, 'utf8');
  console.log(`Core runtime budget reviewed: ${budget.maxBytes} bytes / ${budget.maxLines} lines -> ${CORE_RUNTIME_BUDGET_PATH}`);
  process.exit(0);
}

const appPath = explicitPath
  ? resolve(repoRoot, explicitPath.slice('--app='.length))
  : resolve(repoRoot, 'src/core/app.js');
const result = checkCoreRuntime({ appPath });

console.log('Core runtime integrity check');
console.log('----------------------------');
console.log(`  source: ${result.appPath}`);
console.log(`  size:   ${result.bytes} bytes / ${result.lines} lines`);

if (!result.ok) {
  result.failures.forEach((failure) => console.error(`  FAIL ${failure}`));
  console.error(`\nCore runtime integrity check FAILED (${result.failures.length} issue${result.failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}

console.log(`Core runtime integrity check passed (${result.passes.length} assertions).`);
