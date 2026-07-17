#!/usr/bin/env node
/* global console, process */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [out] = process.argv.slice(2);
if (!out) {
  console.error('Usage: node scripts/new-ai-handoff.mjs <path>');
  process.exit(2);
}
const template = await readFile('.ai/templates/task-contract.md', 'utf8');
await writeFile(resolve(out), template);
console.log(`Created task contract: ${resolve(out)}`);
