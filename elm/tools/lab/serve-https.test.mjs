// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { serve } from './serve-https.mjs';

async function startFixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'onyx-serve-https-'));
  const tlsDir = await mkdtemp(join(tmpdir(), 'onyx-serve-https-tls-'));
  const keyPath = join(tlsDir, 'key.pem');
  const certPath = join(tlsDir, 'cert.pem');
  let served;
  t.after(async () => {
    if (served) {
      served.server.closeAllConnections?.();
      await new Promise(resolvePromise => served.server.close(resolvePromise));
    }
    await Promise.all([rm(root, { recursive: true, force: true }), rm(tlsDir, { recursive: true, force: true })]);
  });
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certPath,
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4096, windowsHide: true });
  assert.equal(generated.error, undefined, 'openssl is available for HTTPS fixture');
  assert.equal(generated.status, 0, `openssl certificate generation failed: ${generated.stderr || generated.status}`);
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents, { mode: 0o600 });
  }
  served = await serve({ root, key: await readFile(keyPath), cert: await readFile(certPath) });
  return served.url;
}

function request(url, pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = httpsGet(new URL(pathname, url), { rejectUnauthorized: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolvePromise({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
  });
}

test('serves E84 and E91 named harness HTML over loopback HTTPS', async t => {
  const url = await startFixture(t, {
    'webrtc-server-investigation.html': '<main>E84 harness</main>',
    'elm/tools/transport/webtransport-server-investigation.html': '<main>E91 harness</main>',
  });
  for (const [pathname, expectedBody] of [
    ['/webrtc-server-investigation.html', '<main>E84 harness</main>'],
    ['/elm/tools/transport/webtransport-server-investigation.html', '<main>E91 harness</main>'],
  ]) {
    const response = await request(url, pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.body, expectedBody);
  }
});

test('returns 404 for absent favicon and absent root index, then keeps serving named HTML', async t => {
  const url = await startFixture(t, {
    'webrtc-server-investigation.html': '<main>still alive</main>',
  });
  for (const pathname of ['/favicon.ico', '/']) {
    const response = await request(url, pathname);
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  const named = await request(url, '/webrtc-server-investigation.html');
  assert.equal(named.status, 200);
  assert.equal(named.body, '<main>still alive</main>');
});

test('keeps SPA index fallback when index.html exists', async t => {
  const url = await startFixture(t, {
    'index.html': '<main>SPA fallback</main>',
    'webrtc-server-investigation.html': '<main>named harness</main>',
  });
  const response = await request(url, '/client/room/one');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.body, '<main>SPA fallback</main>');
});
