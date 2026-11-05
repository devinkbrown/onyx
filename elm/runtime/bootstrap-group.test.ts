import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRuntime } from './bootstrap';

/** Minimal Onyx Server stand-in using the real wire order observed in the local lab. */
class GroupFixtureSocket {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  static readonly instances: GroupFixtureSocket[] = [];
  readonly protocol = 'text.ircv3.net'; readonly bufferedAmount = 0; binaryType: BinaryType = 'arraybuffer';
  readyState = GroupFixtureSocket.CONNECTING; readonly sent: string[] = [];
  policy = new Map<string, string>(); account = '';
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  private welcomed = false;
  constructor(readonly url: string) { GroupFixtureSocket.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    set.add(typeof listener === 'function' ? listener as (event: Event) => void : event => listener.handleEvent(event)); this.listeners.set(type, set);
  }
  removeEventListener(): void {}
  dispatch(type: string, event: Event): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  open(): void { this.readyState = GroupFixtureSocket.OPEN; this.dispatch('open', new Event('open')); }
  server(line: string): void { this.dispatch('message', Object.assign(new Event('message'), { data: line })); }
  close(): void { this.readyState = GroupFixtureSocket.CLOSED; this.dispatch('close', new Event('close')); }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') return;
    this.sent.push(data); const line = data.trim();
    const nick = this.sent.find(value => value.startsWith('NICK '))?.slice(5) ?? 'fixture';
    const S = ':fixture.test';
    if (line === 'CAP LS 302') this.server(`${S} CAP * LS :message-tags server-time echo-message batch`);
    else if (line.startsWith('CAP REQ ')) this.server(`${S} CAP * ACK ${line.slice(8)}`);
    else if (line === 'CAP END' && !this.welcomed) {
      this.welcomed = true; this.server(`${S} 001 ${nick} :Welcome`);
      this.server(`${S} 005 ${nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ CASEMAPPING=rfc1459 WHOX :supported`);
    } else if (line.startsWith('CREATE ')) {
      // Onyx Server order: JOIN, MODE, 331, then the creator-only CREATE <oid>.
      // Replies arrive after the send returns, as on a real socket.
      const channel = line.split(' ')[1]!;
      setTimeout(() => {
        this.server(`:${nick}!u@h JOIN ${channel}`); this.server(`${S} MODE ${channel} +q ${nick}`);
        this.server(`${S} 331 ${nick} ${channel} :No topic is set`); this.server(`${S} CREATE ${channel} 0abcdef12`);
      }, 0);
    } else if (line.startsWith('MODE #')) this.server(`${S} 324 ${nick} ${line.slice(5).trim()} +nt`);
    else if (line.startsWith('PROP #')) {
      const [channel, key, ...rest] = line.slice(5).split(' ');
      if (key) this.policy.set(key, rest.join(' ').replace(/^:/u, ''));
      for (const [prop, value] of this.policy) this.server(`${S} 818 ${nick} ${channel} ${prop} ${value}`);
      this.server(`${S} 819 ${nick} ${channel} :End of properties`);
    } else if (line.startsWith('NAMES #')) {
      const channel = line.slice(6).trim();
      this.server(`${S} 353 ${nick} = ${channel} :~${nick}`); this.server(`${S} 366 ${nick} ${channel} :End of names`);
    } else if (line.startsWith('WHO #')) {
      const [, channel, fields] = line.split(' '); const token = fields?.split(',')[1];
      if (token) this.server(`${S} 354 ${nick} ${token} ${channel} ${nick} ~ ${this.account}`);
      this.server(`${S} 315 ${nick} ${channel} :End of WHO`);
    } else if (line.startsWith('E2EEKEY LIST ')) this.server(`${S} NOTICE ${nick} :E2EEKEY END account=${line.slice(13)} devices=0`);
  }
}

function memoryStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); }, clear: () => entries.clear(), key: (i: number) => [...entries.keys()][i] ?? null,
    get length() { return entries.size; } } as Storage });
}

describe('browser runtime group journey wiring', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.(); dispose = null; vi.restoreAllMocks(); GroupFixtureSocket.instances.length = 0;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  function start() {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: GroupFixtureSocket });
    memoryStorage();
    const runtime = createBrowserRuntime({ networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: 'wss://fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = GroupFixtureSocket.instances.at(-1)!; socket.open();
    runtime.sendLine('CAP LS 302'); runtime.sendLine('NICK founder'); runtime.sendLine('USER fixture 0 * :Fixture'); runtime.sendLine('CAP END');
    return { runtime, socket };
  }
  const command = (runtime: ReturnType<typeof createBrowserRuntime>, requestId: string, action: string, payload: Record<string, unknown>) => {
    const owner = runtime.ownerSnapshot();
    return { schemaVersion: 1, requestId, ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration), domain: 'group', action, payload };
  };

  it('issues a session credential after a mid-session sign-in retired the guest tab intent (fix F)', async () => {
    const { runtime, socket } = start();
    // In-session IDENTIFY: guest → account is an owner change.
    socket.server(':fixture.test 900 founder FixtureDisplay founderacct :You are now logged in');
    expect(runtime.ownerSnapshot().accountId).toBe('founderacct');
    await runtime.issueCredentialBundle();
    await vi.waitFor(() => expect(socket.sent.map(line => line.trim())).toContain('SESSION TOKEN'));
  });

  it('offers epoch 0 / zero hash for a fresh-create genesis once the founder-only room requires encryption (fix E)', async () => {
    const { runtime, socket } = start();
    socket.account = 'founderacct';
    socket.server(':fixture.test 900 founder FixtureDisplay founderacct :You are now logged in');
    expect(runtime.sendLine('CREATE #fresh').kind).toBe('transport-admitted');
    await vi.waitFor(() => expect(socket.sent.some(line => line.startsWith('WHO #fresh'))).toBe(true));
    const refresh = async (id: string) => runtime.dispatchDomain(command(runtime, id, 'directory-refresh', { conversationId: '#fresh' }));
    await vi.waitFor(async () => expect(await refresh(`directoryRefreshOff${String(Math.random()).slice(2, 8)}0000`.slice(0, 26))).toMatchObject({ status: 'accepted' }));
    expect(await refresh('directoryRefreshPolicyOff0')).toMatchObject({ view: { epoch: null, currentCommitHashHex: null } });
    expect(runtime.sendLine('PROP #fresh encryption-policy :required').kind).toBe('transport-admitted');
    await vi.waitFor(async () => expect(await refresh(`directoryRefreshReq${String(Math.random()).slice(2, 8)}0000`.slice(0, 26)))
      .toMatchObject({ status: 'accepted', view: { epoch: 0, currentCommitHashHex: '0'.repeat(64) } }));
  });
});
