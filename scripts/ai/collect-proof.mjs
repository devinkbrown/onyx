#!/usr/bin/env node
/* global console, process */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const [out, ...command] = process.argv.slice(2);
if (!out || !command.length) {
  console.error('Usage: node scripts/ai/collect-proof.mjs <proof.md> <command> [args...]');
  process.exit(2);
}
const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const timestamp = new Date().toISOString();
const body = `\n## ${timestamp}\n\n- Commit: \`${sha}\`\n- Command: \`${command.join(' ')}\`\n- Exit: ${result.status ?? 1}\n\n\`\`\`text\n${result.stdout}${result.stderr}\n\`\`\`\n`;
await mkdir(dirname(resolve(out)), { recursive: true });
await appendFile(resolve(out), body);
process.exit(result.status ?? 1);
