#!/usr/bin/env node
/* global console, process */
import { readFile } from 'node:fs/promises';

const [path] = process.argv.slice(2);
if (!path) {
  console.error('Usage: node scripts/ai/check-contract.mjs <contract.md>');
  process.exit(2);
}
const source = await readFile(path, 'utf8');
const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter) {
  console.error('Contract must start with YAML frontmatter.');
  process.exit(1);
}
const required = ['task_id:', 'base_sha:', 'mode:', 'owned_paths:', 'authority:', 'gates:'];
const missing = required.filter((field) => !frontmatter[1].includes(field));
const placeholders = [...frontmatter[1].matchAll(/REPLACE_WITH_[A-Z_]+/g)].map((match) => match[0]);
if (missing.length || placeholders.length) {
  console.error(`Invalid contract: ${[...missing, ...placeholders].join(', ')}`);
  process.exit(1);
}
if (!/base_sha:\s+[0-9a-f]{7,40}\b/i.test(frontmatter[1])) {
  console.error('base_sha must be a Git SHA.');
  process.exit(1);
}
if (!/authority:\s+codex-integrator\b/.test(frontmatter[1])) {
  console.error('authority must remain codex-integrator.');
  process.exit(1);
}
console.log(`Contract valid: ${path}`);
