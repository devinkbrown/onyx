#!/usr/bin/env node
/* global console, process */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const base = value('--base');
const paths = value('--paths')?.split(',').map((path) => path.trim()).filter(Boolean);
if (!base || !paths?.length) {
  console.error('Usage: node scripts/ai/check-scope.mjs --base <sha> --paths <path,path>');
  process.exit(2);
}
execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' });
// Compare the selected base directly to the working tree so staged and
// unstaged integration changes are both checked before a commit exists.
const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
const forbidden = changed.filter((path) => path === 'pnpm-lock.yaml' || path.startsWith('out/') || path.startsWith('../onyx-server/'));
const outside = changed.filter((path) => !paths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)));
if (forbidden.length || outside.length) {
  console.error(`Scope violation: ${[...forbidden, ...outside].join(', ')}`);
  process.exit(1);
}
console.log(`Scope valid against ${base}: ${changed.length} changed path(s).`);
