// SPDX-License-Identifier: AGPL-3.0-or-later
// Safe local website workbench. It never writes out/ and never deploys.
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

const choices = [
  ['1', 'Start Vite development server', ['pnpm', ['dev']]],
  ['2', 'Run the full safe website gate', ['pnpm', ['site:check']]],
  ['3', 'Preview the current dist/ build', ['pnpm', ['preview']]],
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function printPlan() {
  console.log('\nOnyx website workbench');
  console.log('  source build: dist/');
  console.log(`  local preview: ${existsSync('dist/index.html') ? 'ready' : 'run pnpm build first'}`);
  console.log('  production root: out/ (intentionally read-only here)');
  console.log('  deployment: run ./deploy.sh explicitly after reviewing its output\n');
}

printPlan();
if (!process.stdin.isTTY) {
  console.log('Interactive selection requires a terminal. Nothing changed.');
  process.exit(0);
}

for (const [id, label] of choices) console.log(`  ${id}. ${label}`);
console.log('  4. Inspect deployment boundary (no deployment)');
console.log('  q. Quit');

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await prompt.question('\nChoose a safe local action: ')).trim().toLowerCase();
prompt.close();

if (answer === 'q' || answer === '') process.exit(0);
if (answer === '4') {
  console.log('\nDeploy is deliberately not an option in this menu. ./deploy.sh is the sole writer of out/ and requires an explicit operator decision.');
  process.exit(0);
}
const selected = choices.find(([id]) => id === answer);
if (!selected) {
  console.error('Unknown choice. Nothing changed.');
  process.exit(2);
}
const [, label, [command, args]] = selected;
console.log(`\n==> ${label}`);
process.exitCode = await run(command, args);
