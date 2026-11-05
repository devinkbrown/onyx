import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserRuntime } from './bootstrap';

class DialogWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: DialogWebSocket[] = [];
  readonly protocol = 'text.ircv3.net';
  readonly bufferedAmount = 0;
  binaryType: BinaryType = 'arraybuffer';
  readyState = DialogWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(readonly url: string) { DialogWebSocket.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const entries = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    entries.add(typeof listener === 'function' ? listener as (event: Event) => void : event => listener.handleEvent(event));
    this.listeners.set(type, entries);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const entries = this.listeners.get(type);
    if (!entries) return;
    for (const candidate of entries) {
      if (candidate === listener || (candidate as unknown as { original?: unknown }).original === listener) entries.delete(candidate);
    }
  }
  dispatch(type: string, event: Event): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  open(): void { this.readyState = DialogWebSocket.OPEN; this.dispatch('open', new Event('open')); }
  server(line: string): void { this.dispatch('message', Object.assign(new Event('message'), { data: line })); }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') return;
    const line = data.trim();
    if (line === 'CAP LS 302') this.server(':fixture.test CAP * LS :message-tags server-time echo-message batch labeled-response');
    else if (line.startsWith('CAP REQ ')) this.server(`:fixture.test CAP * ACK ${line.slice(8)}`);
    else if (line === 'CAP END') {
      this.server(':fixture.test 001 dialognick :Welcome');
      this.server(':fixture.test 005 dialognick CASEMAPPING=rfc1459 CHANTYPES=# STATUSMSG=! :supported');
    }
  }
  close(): void { this.readyState = DialogWebSocket.CLOSED; this.dispatch('close', new Event('close')); }
}

describe('runtime private presentation host after Elm owns the document body', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalBodyChildren: ChildNode[] = [];
  let runtime: ReturnType<typeof createBrowserRuntime> | null = null;

  afterEach(() => {
    runtime?.dispose();
    runtime = null;
    DialogWebSocket.instances.length = 0;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
    document.body.replaceChildren(...originalBodyChildren);
    originalBodyChildren.length = 0;
  });

  it('mounts the OUTHOOK private form outside a body containing only the Elm app root', async () => {
    originalBodyChildren.push(...Array.from(document.body.childNodes));
    const appRoot = document.createElement('div');
    appRoot.id = 'app';
    document.body.replaceChildren(appRoot);
    expect(document.getElementById('onyx-private-runtime-presentation')).toBeNull();

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: DialogWebSocket });
    runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: 'wss://fixture.test/ws',
      onLines: () => {},
    });
    expect(runtime.connect().kind).toBe('transport-admitted');
    const active = DialogWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK dialognick');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    active!.server(':fixture.test 900 dialognick FixtureDisplay fixtureacct :You are now logged in');
    const owner = runtime.ownerSnapshot();
    expect(owner.accountId).toBe('fixtureacct');

    const result = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'P'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'service-integration', action: 'outhook-input', payload: {},
    });
    expect(result).toMatchObject({ status: 'pending', view: { kind: 'service-integration', feature: 'outhook', operation: 'input' } });
    const host = document.getElementById('onyx-private-runtime-presentation');
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(document.body);
    expect(appRoot.contains(host)).toBe(false);
    expect(host?.querySelector('[role="dialog"][aria-label="Add outbound hook"]')).not.toBeNull();
    host?.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
  });
});
