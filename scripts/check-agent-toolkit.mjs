#!/usr/bin/env node
/* global console, process */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

async function files(dir) {
  const entries = await readdir(dir);
  return Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry);
    return (await stat(path)).isFile() ? path : null;
  }));
}

for (const path of (await files(join(root, '.claude/agents'))).filter(Boolean)) {
  const text = await readFile(path, 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) failures.push(`${path}: missing YAML frontmatter`);
  for (const required of ['name:', 'description:', 'disallowedTools: Write, Edit', 'permissionMode: plan']) {
    if (!text.includes(required)) failures.push(`${path}: missing ${required}`);
  }
  for (const forbidden of ['tools: Read, Glob, Grep, Bash', 'deploy.sh', 'git commit', 'git merge', 'npm install']) {
    if (text.includes(forbidden)) failures.push(`${path}: read-only role mentions forbidden action ${forbidden}`);
  }
}

for (const path of (await files(join(root, '.codex/agents'))).filter(Boolean)) {
  const text = await readFile(path, 'utf8');
  for (const required of ['name =', 'description =', 'developer_instructions =']) {
    if (!text.includes(required)) failures.push(`${path}: missing ${required}`);
  }
}

const verification = await readFile(join(root, '.codex/agents/onyx-verification-release.toml'), 'utf8');
if (!verification.includes('sandbox_mode = "read-only"')) failures.push('onyx-verification-release must be read-only');

for (const relative of ['.codex/skills/cross-model-handoff/SKILL.md', '.codex/skills/onyx-roadmap-execution/SKILL.md']) {
  const text = await readFile(join(root, relative), 'utf8');
  if (!/^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/s.test(text)) failures.push(`${relative}: invalid skill metadata`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Agent toolkit policy check passed.');
