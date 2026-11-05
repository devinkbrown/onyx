// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
export function safeFile(root, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  const file = resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return file;
}

export async function serve({ root, key, cert, port = 0 }) {
  const base = resolve(root);
  const responseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const server = createServer({ key, cert }, async (request, response) => {
    try {
      const file = safeFile(base, request.url || '/');
      if (!file) { response.writeHead(400, responseHeaders).end(); return; }
      const index = resolve(base, 'index.html');
      let target = file;
      let targetInfo;
      try { targetInfo = await stat(target); }
      catch { target = index; }
      if (targetInfo && !targetInfo.isFile()) {
        target = index;
        targetInfo = undefined;
      }
      if (!targetInfo) {
        try { targetInfo = await stat(target); }
        catch { response.writeHead(404, responseHeaders).end(); return; }
      }
      if (!targetInfo.isFile()) { response.writeHead(404, responseHeaders).end(); return; }

      const stream = createReadStream(target);
      stream.once('error', error => {
        if (response.headersSent) { response.destroy(); return; }
        const status = error?.code === 'ENOENT' ? 404 : 500;
        response.writeHead(status, responseHeaders).end();
      });
      stream.once('open', () => {
        if (response.destroyed) { stream.destroy(); return; }
        response.writeHead(200, {
          ...responseHeaders,
          'content-type': types[extname(target)] || 'application/octet-stream',
        });
        stream.pipe(response);
      });
      response.once('close', () => { if (!stream.destroyed) stream.destroy(); });
    } catch {
      if (response.headersSent) response.destroy();
      else response.writeHead(500, responseHeaders).end();
    }
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolvePromise); });
  const address = server.address();
  if (!address || typeof address === 'string' || !['127.0.0.1', '::1'].includes(address.address)) throw new Error('https_listener_not_loopback');
  return { server, port: address.port, url: `https://127.0.0.1:${address.port}` };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  throw new Error('serve-https is a library; use run.mjs');
}
