// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SEED, DISK_TARGETS, PER_TARGET, diskRows } from './fixtures.ts';
import { digestRecords } from './source-cut.mjs';

test('seeded disk fixture is deterministic, exact, and within per-target vault bounds', () => {
  const first = diskRows();
  assert.equal(SEED, 0x0e90);
  assert.equal(first.length, DISK_TARGETS * PER_TARGET);
  assert.equal(new Set(first.map(row => row.target)).size, DISK_TARGETS);
  const counts = new Map();
  for (const row of first) counts.set(row.target, (counts.get(row.target) ?? 0) + 1);
  for (let target = 0; target < DISK_TARGETS; target++) {
    const name = target < 50 ? `#perf-${target}` : `#archive-${target - 50}`;
    assert.equal(counts.get(name), PER_TARGET);
  }
  assert.deepEqual(diskRows().slice(0, 10), first.slice(0, 10));
  assert.ok(first.every(row => row.body.length >= 20 && row.body.length <= 300 && !/https?:\/\//i.test(row.body)));
});

test('source digest changes when a selected source byte changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'onyx-perf-hash-'));
  try {
    mkdirSync(join(directory, 'elm'), { recursive: true });
    const file = join(directory, 'elm', 'fixture.txt');
    writeFileSync(file, 'alpha');
    const before = readFileSync(file);
  const record = bytes => [{ path: 'elm/fixture.txt', bytes: bytes.length, mode: 0o644, sha256: importHash(bytes) }];
    const beforeDigest = digestRecords(record(before));
    writeFileSync(file, 'alphb');
    const after = readFileSync(file);
    assert.notEqual(digestRecords(record(after)), beforeDigest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function importHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
