#!/usr/bin/env node
// Capture and restore-verify the exact shared Elm source closure. Outputs stay
// under /tmp and are created exclusively with private file permissions.
// Usage: node elm/tools/freeze-source-cut.mjs /tmp/onyx-elm-source-cut
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { selectClosure } from './source-closure.mjs';
import { collectToolProvenance } from './tool-provenance.mjs';

const root = resolve(import.meta.dirname, '../..');
const destination = process.argv[2];
if (!destination || !resolve(destination).startsWith('/tmp/')) throw new Error('Supply an output prefix under /tmp (never out/).');
const prefix = resolve(destination);
const temp = mkdtempSync('/tmp/onyx-elm-cut-');
chmodSync(temp, 0o700);
const snapshot = join(temp, 'snapshot');
const extracted = join(temp, 'restored');
mkdirSync(snapshot, { mode: 0o700 });
mkdirSync(extracted, { mode: 0o700 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function scan(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(base, full).split('\\').join('/');
    const st = lstatSync(full);
    if (st.isSymbolicLink()) throw new Error(`Unexpected symlink in frozen source tree: ${rel}`);
    if (st.isDirectory()) out.push(...scan(full, base));
    else if (st.isFile()) out.push(rel);
    else throw new Error(`Unsupported entry in frozen source tree: ${rel}`);
  }
  return out;
}

function tarOctal(value, width) {
  const text = Math.max(0, value).toString(8).padStart(width - 1, '0');
  if (text.length >= width) throw new Error('Tar numeric field overflow');
  return `${text}\0`;
}

function tarHeader(path, size, mode, type = '0') {
  const header = Buffer.alloc(512);
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const split = name.lastIndexOf('/');
    if (split > 0 && Buffer.byteLength(name.slice(split + 1)) <= 100 && Buffer.byteLength(name.slice(0, split)) <= 155) {
      prefix = name.slice(0, split);
      name = name.slice(split + 1);
    } else throw new Error(`Tar path requires PAX record: ${path}`);
  }
  header.write(name, 0, 100, 'utf8');
  header.write(tarOctal(mode, 8), 100, 8, 'ascii');
  header.write(tarOctal(0, 8), 108, 8, 'ascii');
  header.write(tarOctal(0, 8), 116, 8, 'ascii');
  header.write(tarOctal(size, 12), 124, 12, 'ascii');
  header.write(tarOctal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix) header.write(prefix, 345, 155, 'utf8');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return Buffer.from(record);
    length = actual;
  }
}

function appendTarEntry(chunks, path, bytes, mode, paxPath = null, ordinal = 0) {
  if (paxPath !== null) {
    const pax = paxRecord('path', paxPath);
    const paxName = `PaxHeaders/${ordinal}`;
    chunks.push(tarHeader(paxName, pax.length, 0o600, 'x'), pax);
    if (pax.length % 512) chunks.push(Buffer.alloc(512 - pax.length % 512));
    path = `PaxFiles/${ordinal}`;
  }
  chunks.push(tarHeader(path, bytes.length, mode), bytes);
  if (bytes.length % 512) chunks.push(Buffer.alloc(512 - bytes.length % 512));
}

function makeDeterministicTar(files, snapshot) {
  const chunks = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const bytes = readFileSync(resolve(snapshot, file.path));
    const split = file.path.lastIndexOf('/');
    const fits = Buffer.byteLength(file.path) <= 100 || (split > 0
      && Buffer.byteLength(file.path.slice(split + 1)) <= 100 && Buffer.byteLength(file.path.slice(0, split)) <= 155);
    appendTarEntry(chunks, file.path, bytes, file.mode, fits ? null : file.path, index);
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function restoreDeterministicTar(bytes, destination) {
  let offset = 0;
  let pendingPath = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) return;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/su, '');
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/su, '').trim(), 8);
    const mode = Number.parseInt(header.subarray(100, 108).toString('ascii').replace(/\0.*$/su, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(mode) || mode < 0) throw new Error('Invalid tar header');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error('Truncated tar entry');
    const type = String.fromCharCode(header[156] ?? 0);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'x') {
      for (let cursor = 0; cursor < data.length;) {
        const space = data.indexOf(0x20, cursor);
        if (space < 0) throw new Error('Malformed PAX record');
        const length = Number.parseInt(data.subarray(cursor, space).toString('ascii'), 10);
        if (!Number.isSafeInteger(length) || length <= space - cursor + 1 || cursor + length > data.length) throw new Error('Malformed PAX length');
        const record = data.subarray(space + 1, cursor + length - 1).toString('utf8');
        const equals = record.indexOf('=');
        if (equals < 1) throw new Error('Malformed PAX value');
        if (record.slice(0, equals) === 'path') pendingPath = record.slice(equals + 1);
        cursor += length;
      }
    } else if (type === '0' || type === '\0') {
      const path = pendingPath ?? headerPath;
      pendingPath = null;
      if (!path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) throw new Error(`Unsafe tar path: ${path}`);
      const target = resolve(destination, path);
      if (!target.startsWith(`${resolve(destination)}/`)) throw new Error(`Tar path escapes restore root: ${path}`);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, data, { mode });
      chmodSync(target, mode);
    } else throw new Error(`Unsupported tar entry type: ${type}`);
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('Tar archive has no terminator');
}

try {
  const closure = selectClosure(root);
  const files = [];
  for (const path of closure.paths) {
    const source = resolve(root, path);
    const capturedStat = lstatSync(source);
    if (capturedStat.isSymbolicLink() || !capturedStat.isFile()) throw new Error(`Unsafe source input: ${path}`);
    const bytes = readFileSync(source); // capture bytes once; archive and hash this snapshot
    const mode = capturedStat.mode & 0o777;
    const target = resolve(snapshot, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode });
    chmodSync(target, mode);
    files.push({ path, size: bytes.length, sha256: hash(bytes), mode });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

  // Detect a moving working tree: every source byte and mode must still match
  // what was captured before archive generation.
  for (const record of files) {
    const source = resolve(root, record.path);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() || (stat.mode & 0o777) !== record.mode || hash(readFileSync(source)) !== record.sha256) {
      throw new Error(`Source changed during snapshot; cut is unstable: ${record.path}`);
    }
  }
  const afterCapture = selectClosure(root);
  if (JSON.stringify(afterCapture.paths) !== JSON.stringify(closure.paths)) {
    throw new Error('Source file set changed during snapshot; cut is unstable');
  }

  const names = files.map(file => file.path);
  const tar = makeDeterministicTar(files, snapshot);
  const archive = gzipSync(tar, { level: 9, mtime: 0 });
  archive[9] = 255; // normalize the gzip platform marker for cross-platform hashes
  restoreDeterministicTar(gunzipSync(archive), extracted);
  const restoredPaths = scan(extracted).sort();
  if (JSON.stringify(restoredPaths) !== JSON.stringify(names)) throw new Error('Restored archive file set differs from source closure');
  for (const record of files) {
    const restored = resolve(extracted, record.path);
    const stat = statSync(restored);
    if (stat.size !== record.size || (stat.mode & 0o777) !== record.mode || hash(readFileSync(restored)) !== record.sha256) {
      throw new Error(`Archive restore verification failed for ${record.path}`);
    }
  }
  for (const record of files) {
    const source = resolve(root, record.path);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() || (stat.mode & 0o777) !== record.mode || stat.size !== record.size || hash(readFileSync(source)) !== record.sha256) {
      throw new Error(`Source changed during archive restore verification: ${record.path}`);
    }
  }
  if (JSON.stringify(selectClosure(root).paths) !== JSON.stringify(closure.paths)) throw new Error('Source file set changed before source-cut output');

  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const gitDirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim() !== '';
  const manifestDigest = hash(Buffer.from(files.map(file => `${file.path}\0${file.mode.toString(8)}\0${file.sha256}\n`).join('')));
  const body = {
    schemaVersion: 2,
    scope: 'shared full Elm client source closure; excludes external toolchain and dependency cache',
    selectorVersion: closure.selectorVersion,
    archiveFormat: 'POSIX pax tar.gz; normalized owner, group, mtime, path order, and gzip timestamp',
    gitHead,
    gitDirty,
    manifestDigest,
    archiveSha256: hash(archive),
    archiveBytes: archive.length,
    fileCount: files.length,
    exclusions: closure.exclusions,
    requiredInputs: closure.requiredInputs,
    toolProvenance: collectToolProvenance(root),
    restoreVerified: true,
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
  const manifestSha256 = hash(manifestBytes);
  const manifest = { ...body, manifestSha256 };
  mkdirSync(dirname(prefix), { recursive: true, mode: 0o700 });
  writeFileSync(`${prefix}.tar.gz`, archive, { flag: 'wx', mode: 0o600 });
  writeFileSync(`${prefix}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${files.length} files; manifest ${manifestDigest}; archive SHA-256 ${body.archiveSha256}; restore verified; tool provenance ${body.toolProvenance.provenanceComplete ? 'complete' : 'incomplete'}\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
