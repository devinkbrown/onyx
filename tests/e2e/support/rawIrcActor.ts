import { connect, type Socket } from 'node:net';
import { createHash } from 'node:crypto';

export type WireSummary = Readonly<{ sha256: string; length: number }>;

export class RawIrcActor {
  private socket!: Socket;
  private buffer = '';
  private lines: string[] = [];
  private closed = false;
  constructor(private readonly port: number) {}
  async open(nick: string, capabilities: readonly string[] = []): Promise<void> {
    this.socket = await new Promise<Socket>((resolve, reject) => {
      const socket = connect(this.port, '127.0.0.1'); socket.once('connect', () => resolve(socket)); socket.once('error', reject);
    });
    this.socket.on('close', () => { this.closed = true; });
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const rows = this.buffer.split('\r\n');
      this.buffer = rows.pop() ?? '';
      for (const row of rows) {
        this.lines.push(row);
        const ping = /^PING\s+(.+)$/u.exec(row);
        if (ping) this.send(`PONG ${ping[1]}`);
      }
    });
    this.send('CAP LS 302');
    this.send(`NICK ${nick}`);
    this.send(`USER ${nick} 0 * :${nick}`);
    await this.waitFor(/ CAP \S+ LS /);
    if (capabilities.length > 0) {
      this.send(`CAP REQ :${capabilities.join(' ')}`);
      await this.waitFor(new RegExp(` CAP \\S+ ACK .*${capabilities.map(escapeRegex).join('.*')}`));
    }
    this.send('CAP END');
    await this.waitFor(/ 001 /);
  }
  send(line: string): void { this.socket.write(`${line}\r\n`); }
  async waitFor(pattern: RegExp, timeout = 15_000, after = 0): Promise<string> {
    const until = Date.now() + timeout;
    let cursor = after;
    while (Date.now() < until) {
      for (; cursor < this.lines.length; cursor += 1) {
        const line = this.lines[cursor]!;
        pattern.lastIndex = 0;
        if (pattern.test(line)) return line;
      }
      if (this.closed) throw new Error(`IRC socket closed before reply: ${pattern}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`IRC reply timeout: ${pattern}`);
  }
  async register(account: string, password: string): Promise<void> {
    this.send(`REGISTER ${account} * ${password}`);
    await this.waitFor(/ REGISTER SUCCESS /);
  }
  async identify(account: string, password: string): Promise<void> {
    this.send(`IDENTIFY ${account} ${password}`);
    await this.waitFor(/ NOTICE \S+ :You are now identified as \S+$/);
  }
  async enableIrcx(): Promise<void> { this.send('IRCX'); await this.waitFor(/ 800 /); }
  async requireReusableSession(): Promise<void> {
    const after = this.lines.length;
    this.send('SESSION TOKEN');
    const reply = await this.waitFor(/(?:NOTICE|WARN|FAIL) \S+ :?SESSION\s/u, 15_000, after);
    if (!/ :?SESSION TOKEN [A-Fa-f0-9]{32}(?:\s|$)/u.test(reply)) {
      const safe = reply.replace(/[A-Fa-f0-9]{32,}/gu, '[credential-redacted]');
      throw new Error(`Reusable session unavailable: ${safe}`);
    }
  }
  async join(room: string): Promise<void> {
    this.send(`JOIN ${room}`);
    await this.waitFor(new RegExp(` 366 \\S+ ${escapeRegex(room)} `));
  }
  async addE2eeKey(deviceId: string, algorithm: string, directory: string): Promise<void> {
    const accepted = new RegExp(`:?E2EEKEY ADDED id=${escapeRegex(deviceId)} alg=${escapeRegex(algorithm)}$`, 'u');
    let lastReply = 'no server reply';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const after = this.lines.length;
      this.send(`E2EEKEY ADD ${deviceId} ${algorithm} ${directory}`);
      const reply = await this.waitFor(/(?:NOTICE \S+ :E2EEKEY|FAIL E2EEKEY)\s/u, 15_000, after);
      if (accepted.test(reply)) return;
      lastReply = reply;
      if (!reply.includes('TEMPORARILY_UNAVAILABLE')) throw new Error(`E2EE device registration failed: ${reply}`);
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    throw new Error(`E2EE device registration failed after bounded transient retries: ${lastReply}`);
  }
  wireSummary(line: string): WireSummary {
    return { sha256: createHash('sha256').update(line).digest('hex'), length: Buffer.byteLength(line) };
  }
  isConnected(): boolean { return !this.closed && !this.socket.destroyed; }
  close(): void { this.socket?.destroy(); }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
