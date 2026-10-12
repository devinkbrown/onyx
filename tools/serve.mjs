#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * serve.mjs — minimal local static server for the built site (dist/), with the
 * same document rules nginx applies in production: `/route` redirects to
 * `/route/`, a directory serves its index.html, an unknown path gets the flat
 * 404.html with a real 404 status. Read-only, loopback by default.
 *
 *   node tools/serve.mjs [--dir dist] [--host 127.0.0.1] [--port 3000] [--build]
 *
 * `--build` runs `pnpm build` first (this is what `pnpm dev` does); the
 * desktop host starts it as `pnpm dev -- --host 127.0.0.1 --port 3000`.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/** Resolve a request path to a file under root, or null (never escapes root). */
export function resolveRequest(root, rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath.split('?')[0].split('#')[0]);
  } catch {
    return { status: 400 };
  }
  if (path.includes('\0')) return { status: 400 };
  const target = normalize(join(root, path));
  if (target !== root && !target.startsWith(root + sep)) return { status: 404 };
  if (existsSync(target) && statSync(target).isDirectory()) {
    if (!path.endsWith('/')) return { status: 301, location: `${path}/` };
    const index = join(target, 'index.html');
    return existsSync(index) ? { status: 200, file: index } : { status: 404 };
  }
  return existsSync(target) && statSync(target).isFile() ? { status: 200, file: target } : { status: 404 };
}

export function createSiteServer(root) {
  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const hit = resolveRequest(root, req.url ?? '/');
    if (hit.status === 301) {
      res.writeHead(301, { Location: hit.location }).end();
      return;
    }
    const send = (status, file) => {
      res.writeHead(status, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
    };
    if (hit.status === 200) return send(200, hit.file);
    const notFound = join(root, '404.html');
    if (existsSync(notFound)) return send(hit.status === 400 ? 400 : 404, notFound);
    res.writeHead(hit.status).end();
  });
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
  };
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = resolve(repo, opt('--dir', 'dist'));
  if (args.includes('--build')) {
    const built = spawnSync('pnpm', ['build'], { cwd: repo, stdio: 'inherit' });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
  if (!existsSync(join(root, 'index.html'))) {
    console.error(`no build at ${root} — run: pnpm build`);
    process.exit(1);
  }
  const host = opt('--host', '127.0.0.1');
  const port = Number(opt('--port', '3000'));
  createSiteServer(root).listen(port, host, () => {
    console.log(`serving ${root} at http://${host}:${port}/`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
