#!/usr/bin/env node
// Print a deterministic digest of the exact source closure used by the freeze
// tool. Tool provenance is reported separately from file hashes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectClosure } from './source-closure.mjs';
import { collectToolProvenance } from './tool-provenance.mjs';

const root = resolve(import.meta.dirname, '../..');
const closure = selectClosure(root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = closure.paths.map(path => {
  const absolute = resolve(root, path);
  const before = lstatSync(absolute);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Source input changed type during manifest capture: ${path}`);
  const bytes = readFileSync(absolute);
  const after = statSync(absolute);
  const sha256 = hash(bytes);
  if ((before.mode & 0o777) !== (after.mode & 0o777) || after.size !== bytes.length || hash(readFileSync(absolute)) !== sha256) {
    throw new Error(`Source input changed during manifest capture: ${path}`);
  }
  return { path, bytes: bytes.length, mode: before.mode & 0o777, sha256 };
});
const afterCapture = selectClosure(root);
if (JSON.stringify(afterCapture.paths) !== JSON.stringify(closure.paths)) throw new Error('Source file set changed during manifest capture');
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim() !== '';
const digest = hash(Buffer.from(files.map(file => `${file.path}\0${file.mode.toString(8)}\0${file.sha256}\n`).join('')));
const output = {
  schemaVersion: 2,
  scope: 'shared full Elm client source closure; includes tracked, modified, and untracked root client inputs',
  selectorVersion: closure.selectorVersion,
  gitHead,
  gitDirty: dirty,
  digestAlgorithm: 'sha256(path NUL octal-mode NUL file-sha256 LF, lexically sorted)',
  digest,
  fileCount: files.length,
  closure: closure.paths,
  exclusions: closure.exclusions,
  requiredInputs: closure.requiredInputs,
  resolvedToolProvenance: collectToolProvenance(root),
  files,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
