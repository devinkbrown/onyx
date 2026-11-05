// SPDX-License-Identifier: AGPL-3.0-or-later
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

export function record(result: Record<string, unknown>) {
  const path = process.env.ONYX_PERF_RESULT;
  if (!path) return;
  const rows = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  rows.push(result);
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

export function writeJsonLine(path: string, value: unknown) {
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}
