#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Verify that every precached shell asset served at a public origin matches the
// SHA-256 recorded in that origin's sw.js. One mismatch fails the service-worker
// install, which leaves returning visitors on their previous build.
// Usage: node tools/verify-live-shell.mjs https://eshmaki.me
import { createHash } from 'node:crypto';

const origin = new URL(process.argv[2] ?? 'https://eshmaki.me').origin;
const get = async (path) => {
  const response = await fetch(new URL(path, origin), { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
const sw = new TextDecoder().decode(await get('/sw.js'));
const match = /const BUILD_ENVELOPE = (\{.*?\});\n/su.exec(sw);
if (!match) { console.error('sw.js has no build envelope'); process.exit(2); }
const envelope = JSON.parse(match[1]);
const failures = [];
for (const asset of envelope.buildCompatibility.shellAssets) {
  try {
    const digest = createHash('sha256').update(await get(asset.path)).digest('hex');
    if (digest !== asset.sha256.toLowerCase()) failures.push(`${asset.path}: hash mismatch`);
  } catch (error) { failures.push(String(error.message ?? error)); }
}
const metadata = new TextDecoder().decode(await get('/runtime-build.json'));
if (metadata !== JSON.stringify(envelope)) failures.push('/runtime-build.json: does not match the sw.js envelope');
console.log(`build ${envelope.buildCompatibility.buildId}: ${envelope.buildCompatibility.shellAssets.length} shell assets checked, ${failures.length} failure(s)`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
