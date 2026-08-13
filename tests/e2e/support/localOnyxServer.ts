import { connect, createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`local Onyx server exited (${child.exitCode}) before listen`);
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', reject);
      });
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error('local Onyx server did not listen before timeout');
}

export type LocalOnyxServer = { wsUrl: string; ircPort: number; stop(): Promise<void> };

/** Disposable plain-WS server. Its data and logs stay under the caller's PID-scoped work root. */
export async function startLocalOnyxServer(workRoot: string): Promise<LocalOnyxServer> {
  const ircPort = await freePort();
  const wsPort = await freePort();
  await mkdir(workRoot, { recursive: true });
  const config = join(workRoot, 'onyx-server.toml');
  await writeFile(config, `[node]\nid = 1\n[network]\nname = "Onyx D2"\nserver_name = "127.0.0.1"\n[listen]\nhost = "127.0.0.1"\nirc = ${ircPort}\nws = ${wsPort}\nws_plain = true\n[sasl]\nenabled = true\naccount_db = "${join(workRoot, 'accounts.db')}"\n[limits]\nnum_shards = 1\n`, { mode: 0o600 });
  const child = spawn('zig', ['build', 'run', '--', config], {
    cwd: '/home/kain/onyx-server', stdio: ['ignore', 'ignore', 'pipe'], detached: true,
  });
  await waitForPort(wsPort, child);
  return {
    wsUrl: `ws://127.0.0.1:${wsPort}`,
    ircPort,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    },
  };
}
