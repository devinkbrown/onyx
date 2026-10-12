// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSiteServer, resolveRequest } from './serve.mjs';

let root;
let server;
let base;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'onyx-serve-'));
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'assets', 'elm'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<title>home</title>');
  writeFileSync(join(root, 'app', 'index.html'), '<title>app</title>');
  writeFileSync(join(root, '404.html'), '<title>gone</title>');
  writeFileSync(join(root, 'assets', 'elm', 'app.js'), 'x');
  writeFileSync(join(root, 'secret.txt'), 'outside-adjacent');
  server = createSiteServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('local site server', () => {
  it('serves documents, redirects directories, and 404s with the flat 404.html', async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe('<title>home</title>');
    expect(await (await fetch(`${base}/app/`)).text()).toBe('<title>app</title>');
    const redirect = await fetch(`${base}/app`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/app/');
    const missing = await fetch(`${base}/nope/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('<title>gone</title>');
    const asset = await fetch(`${base}/assets/elm/app.js`);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
  });

  it('never resolves outside the root', () => {
    expect(resolveRequest(root, '/../secret.txt')).toEqual({ status: 404 });
    expect(resolveRequest(root, '/%2e%2e/secret.txt')).toEqual({ status: 404 });
    expect(resolveRequest(root, '/a%00b')).toEqual({ status: 400 });
    expect(resolveRequest(root, '/%zz')).toEqual({ status: 400 });
    expect(resolveRequest(root, '/secret.txt').status).toBe(200);
  });

  it('is read-only', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});
