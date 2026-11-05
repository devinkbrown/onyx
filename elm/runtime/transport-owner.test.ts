import { describe, expect, it } from 'vitest';
import { createTransportOwner, type TransportOwnerDependencies } from './transport-owner';
import { parseIRCMessage } from '../../src/lib/irc/parser';
import { makeAccountGeneration, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeRequestId, type OwnerSnapshot, type SendAdmission } from './contracts';

type HookDependencies = Partial<Pick<TransportOwnerDependencies,
  'authenticatedPrefix' | 'beforeIngressLine' | 'beforeSend' | 'consumePrivateLine' | 'onWelcomeCandidate'>> & {
    readonly onPublicLine?: (line: string, owner: OwnerSnapshot) => void;
    readonly rotateOwner?: (phase: 'welcome' | 'public', line: string, owner: OwnerSnapshot) => OwnerSnapshot | null;
  };

function fixture(throwAt = -1, protocol = 'text.ircv3.net', hooks: HookDependencies = {}, order?: string[]) {
  const owner: OwnerSnapshot = {
    networkId: makeNetworkId('custom:wss://transport.test/irc')!, accountId: null,
    accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
  };
  let liveOwner = owner;
  const sent: string[] = [];
  const publicLines: string[] = [];
  const closeCalls: Array<{ readonly code: number | undefined; readonly reason: string | undefined }> = [];
  const requestedProtocols: string[][] = [];
  const stateChanges: string[] = [];
  const listeners = new Map<string, (event?: unknown) => void>();
  const socket = {
    readyState: 1, protocol, bufferedAmount: 0, binaryType: 'arraybuffer',
    addEventListener(name: string, listener: (event?: unknown) => void) { listeners.set(name, listener); },
    close(code?: number, reason?: string) { closeCalls.push({ code, reason }); },
    send(value: string | ArrayBuffer | ArrayBufferView) {
      order?.push(`wire:${typeof value === 'string' ? value : '[binary]'}`);
      if (sent.length === throwAt) throw new Error('transport test failure');
      sent.push(typeof value === 'string' ? value : '[binary]');
    },
  } as unknown as WebSocket;
  const transport = createTransportOwner({
    currentOwner: () => liveOwner, isCurrentOwner: () => true, authenticatedPrefix: hooks.authenticatedPrefix ?? (() => 'irc.transport.test'),
    endpoint: () => 'endpoint' as never,
    socketFactory: (_url, protocols) => { requestedProtocols.push([...protocols]); return socket; },
    ...(hooks.beforeIngressLine ? { beforeIngressLine: hooks.beforeIngressLine } : {}),
    ...(hooks.beforeSend ? { beforeSend: hooks.beforeSend } : {}),
    ...((hooks.onWelcomeCandidate || hooks.rotateOwner) ? {
      onWelcomeCandidate(line: string, capturedOwner: OwnerSnapshot) {
        hooks.onWelcomeCandidate?.(line, capturedOwner);
        const rotated = hooks.rotateOwner?.('welcome', line, capturedOwner);
        if (rotated) liveOwner = rotated;
      },
    } : {}),
    consumePrivateLine: hooks.consumePrivateLine ?? (() => false),
    onPublicLine(line, capturedOwner) {
      publicLines.push(line);
      hooks.onPublicLine?.(line, capturedOwner);
      const rotated = hooks.rotateOwner?.('public', line, capturedOwner);
      if (rotated) liveOwner = rotated;
    },
    onBinary() {}, onState(state) { stateChanges.push(state); },
  });
  transport.connect('wss://transport.test/irc');
  listeners.get('open')?.();
  return { get owner() { return liveOwner; }, sent, publicLines, closeCalls, requestedProtocols, stateChanges, transport, server: (data: string) => listeners.get('message')?.({ data }) };
}

describe('transport ordered line groups', () => {
  it('admits a complete IRC line group synchronously before later ordinary sends', () => {
    const { owner, sent, transport } = fixture();
    const requestId = makeRequestId('abcdefghijklmnopqrstuv')!;
    const results = transport.sendLineGroup({ owner, requestId, lines: ['BATCH +m draft/multiline', '@batch=m PRIVMSG #room :first', '@batch=m PRIVMSG #room :second', 'BATCH -m'] });
    expect(results).toHaveLength(4);
    expect(results.every(result => result.kind === 'transport-admitted')).toBe(true);
    expect(transport.sendLine({ owner, requestId, line: 'PING :later' }).kind).toBe('transport-admitted');
    expect(sent).toEqual(['BATCH +m draft/multiline', '@batch=m PRIVMSG #room :first', '@batch=m PRIVMSG #room :second', 'BATCH -m', 'PING :later']);
    transport.dispose();
  });

  it('runs the ingress ordering hook before private, welcome, and public consumers', () => {
    const order: string[] = [];
    const f = fixture(-1, 'text.ircv3.net', {
      authenticatedPrefix: () => null,
      beforeIngressLine: () => { order.push('before'); },
      consumePrivateLine: () => { order.push('consume'); return false; },
      onWelcomeCandidate: () => { order.push('welcome'); },
      onPublicLine: () => { order.push('public'); },
    });
    f.transport.onPrivateIngress(() => { order.push('private'); return false; });

    f.server(':irc.transport.test 001 alice :welcome');

    expect(order).toEqual(['before', 'consume', 'welcome', 'private', 'public']);
    f.transport.dispose();
  });

  it('keeps a trusted welcome handoff on its newly proven account owner', () => {
    let learnedPrefix: string | null = null;
    const privateOwners: OwnerSnapshot[] = [];
    const publicOwners: OwnerSnapshot[] = [];
    const authenticatedEvents: Array<{ readonly line: string; readonly accountId: OwnerSnapshot['accountId']; readonly accountGeneration: OwnerSnapshot['accountGeneration'] }> = [];
    const f = fixture(-1, 'text.ircv3.net', {
      authenticatedPrefix: () => learnedPrefix,
      onWelcomeCandidate: () => { learnedPrefix = 'irc.transport.test'; },
      rotateOwner: (phase, _line, owner) => phase === 'welcome' ? {
        ...owner,
        accountId: 'alice' as OwnerSnapshot['accountId'],
        accountGeneration: makeAccountGeneration(1)!,
        ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!,
      } : null,
      onPublicLine: (_line, owner) => { publicOwners.push(owner); },
    });
    f.transport.onPrivateIngress(event => { privateOwners.push(event.owner); return false; });
    f.transport.onAuthenticatedServerEvent(event => {
      authenticatedEvents.push({ line: event.line, accountId: event.accountId, accountGeneration: event.accountGeneration });
    });
    const line = ':irc.transport.test 001 alice :welcome';

    f.server(line);

    expect(f.owner.accountId).toBe('alice');
    expect(f.owner.accountGeneration).toEqual(makeAccountGeneration(1));
    expect(f.publicLines).toEqual([line]);
    expect(privateOwners).toEqual([f.owner]);
    expect(publicOwners).toEqual([f.owner]);
    expect(authenticatedEvents).toEqual([{ line, accountId: 'alice', accountGeneration: makeAccountGeneration(1) }]);
    f.transport.dispose();
  });

  it('stops authenticated server fanout when public projection rotates the same socket to another account', () => {
    const publicOwners: OwnerSnapshot[] = [];
    const authenticatedLines: string[] = [];
    const f = fixture(-1, 'text.ircv3.net', {
      onPublicLine: (_line, owner) => { publicOwners.push(owner); },
      rotateOwner: (phase, _line, owner) => phase === 'public' ? {
        ...owner,
        accountId: 'alice' as OwnerSnapshot['accountId'],
        accountGeneration: makeAccountGeneration(1)!,
        ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!,
      } : null,
    });
    f.transport.onAuthenticatedServerEvent(event => { authenticatedLines.push(event.line); });
    const oldOwner = f.owner;
    const line = ':irc.transport.test NOTICE alice :same-socket owner rotation';

    f.server(line);

    expect(publicOwners).toEqual([oldOwner]);
    expect(f.owner.accountId).toBe('alice');
    expect(f.owner.connectionGeneration).toEqual(oldOwner.connectionGeneration);
    expect(f.owner.physicalRef).toEqual(oldOwner.physicalRef);
    expect(authenticatedLines).toEqual([]);
    f.transport.dispose();
  });

  it('rejects a WSS handshake with no selected subprotocol before ingress or writes', () => {
    const f = fixture(-1, '');
    const privateLines: string[] = [];
    const authenticatedLines: string[] = [];
    f.transport.onPrivateIngress(event => { privateLines.push(event.payload.line); return false; });
    f.transport.onAuthenticatedServerEvent(event => { authenticatedLines.push(event.line); });

    f.server(':irc.transport.test 001 alice :welcome');
    const admission = f.transport.sendLine({
      owner: f.owner,
      requestId: makeRequestId('abcdefghijklmnopqrstuv')!,
      line: 'CAP LS 302',
    });

    expect(f.requestedProtocols).toEqual([['text.ircv3.net']]);
    expect(f.closeCalls).toEqual([{ code: 1002, reason: 'Unsupported WebSocket protocol' }]);
    expect(f.stateChanges).not.toContain('live');
    expect(f.publicLines).toEqual([]);
    expect(privateLines).toEqual([]);
    expect(authenticatedLines).toEqual([]);
    expect(admission).toEqual({ kind: 'blocked', reason: 'offline' });
    expect(f.sent).toEqual([]);
    f.transport.dispose();
  });

  it('runs beforeSend once before contiguous ordered group wire writes', () => {
    const order: string[] = [];
    const f = fixture(-1, 'text.ircv3.net', { beforeSend: () => { order.push('before'); } }, order);
    const lines = ['BATCH +m draft/multiline', '@batch=m PRIVMSG #room :first', 'BATCH -m'];
    const results = f.transport.sendLineGroup({
      owner: f.owner,
      requestId: makeRequestId('abcdefghijklmnopqrstuv')!,
      lines,
    });

    expect(results.map(result => result.kind)).toEqual(['transport-admitted', 'transport-admitted', 'transport-admitted']);
    expect(order).toEqual([
      'before',
      'wire:BATCH +m draft/multiline',
      'wire:@batch=m PRIVMSG #room :first',
      'wire:BATCH -m',
    ]);
    f.transport.dispose();
  });

  it('fails closed when an ordering hook throws', () => {
    let downstreamCalls = 0;
    const f = fixture(-1, 'text.ircv3.net', {
      beforeIngressLine: () => { throw new Error('private hook failure'); },
      beforeSend: () => { throw new Error('send hook failure'); },
      consumePrivateLine: () => { downstreamCalls += 1; return false; },
      onPublicLine: () => { downstreamCalls += 1; },
    });
    f.transport.onPrivateIngress(() => { downstreamCalls += 1; return false; });
    f.server(':irc.transport.test NOTICE alice :SESSION TOKEN private');

    expect(downstreamCalls).toBe(0);
    expect(f.publicLines).toEqual([]);
    expect(f.transport.sendLine({ owner: f.owner, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, line: 'PING :probe' }))
      .toEqual({ kind: 'blocked', reason: 'policy' });
    expect(f.sent).toEqual([]);
    f.transport.dispose();
  });

  it('reports a partial write as one admitted line followed by unknown and blocked outcomes', () => {
    const { owner, transport } = fixture(1);
    const results = transport.sendLineGroup({ owner, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, lines: ['BATCH +m draft/multiline', '@batch=m PRIVMSG #room :part', 'BATCH -m'] });
    expect(results.map(result => result.kind)).toEqual(['transport-admitted', 'unknown', 'blocked']);
    transport.dispose();
  });

  it('rejects invalid direct lines before native socket admission', () => {
    const { owner, sent, transport } = fixture();
    const requestId = makeRequestId('abcdefghijklmnopqrstuv')!;
    expect(transport.sendLine({ owner, requestId, line: '@bad_key=value PRIVMSG #room :text' }))
      .toEqual({ kind: 'blocked', reason: 'invalid-intent' });
    expect(sent).toEqual([]);
    transport.dispose();
  });

  it('preflights every group member so one invalid line causes zero native writes', () => {
    const { owner, sent, transport } = fixture();
    const results = transport.sendLineGroup({
      owner,
      requestId: makeRequestId('abcdefghijklmnopqrstuv')!,
      lines: ['BATCH +m draft/multiline', '@batch=m PRIVMSG #room :part', '@bad_key=x BATCH -m'],
    });
    expect(results).toEqual([{ kind: 'blocked', reason: 'invalid-intent' }]);
    expect(sent).toEqual([]);
    transport.dispose();
  });

  it('routes tagged structured MACKEY events privately and never projects key material publicly', () => {
    const { publicLines, transport, server } = fixture();
    let privateDeliveries = 0;
    let safeShape: { readonly source: string | undefined; readonly family: string | undefined; readonly verb: string | undefined; readonly room: string | undefined; readonly detailLength: number } | null = null;
    transport.onPrivateIngress(event => {
      privateDeliveries += 1;
      const parsed = parseIRCMessage(event.payload.line);
      safeShape = {
        source: event.payload.sourceKind,
        family: parsed.params[1],
        verb: parsed.params[2],
        room: parsed.params[3],
        detailLength: parsed.params[4]?.length ?? 0,
      };
      return false;
    });

    server('@time=2026-11-04T00:00:00Z :irc.transport.test EVENT alice MEDIA MACKEY #room a2V5');

    expect(privateDeliveries).toBe(1);
    expect(safeShape).toEqual({ source: 'server', family: 'MEDIA', verb: 'MACKEY', room: '#room', detailLength: 4 });
    expect(publicLines).toEqual([]);
    transport.dispose();
  });

  it('keeps OUTHOOK URL notices private even when no matching request is active', () => {
    const { publicLines, transport, server } = fixture();
    const privateLines: string[] = [];
    transport.onPrivateIngress(event => { privateLines.push(event.payload.line); return false; });
    const line=':irc.transport.test NOTICE fixture :OUTHOOK: https://hooks.example/private/path categories=KILL';
    server(line);
    expect(privateLines).toEqual([line]);
    expect(publicLines).toEqual([]);
    transport.dispose();
  });

  it('keeps harmless unknown lines observable and quarantines sensitive-shaped unknown lines on WSS', () => {
    const { publicLines, transport, server } = fixture();
    let privateDeliveries = 0;
    transport.onPrivateIngress(() => { privateDeliveries++; return false; });
    server('FOO alice :ordinary diagnostic');
    server('@time=2026-11-04T00:00:00Z :irc.transport.test FOO alice MEDIA MACKEY #room secret-key-material');
    server(`FOO alice MEDIA MACKEY #room key-${'x'.repeat(9000)}`);
    expect(publicLines).toEqual(['FOO alice :ordinary diagnostic']);
    expect(privateDeliveries).toBe(1);
    transport.dispose();
  });
});

describe('alternative transport ownership', () => {
  const makeOwner = (physical = '0123456789abcdef0123456789abcdef', ownerRef = 'abcdefghijklmnopqrstuv', generation = 1): OwnerSnapshot => ({
    networkId: makeNetworkId('custom:wss://transport.test/irc')!, accountId: 'alice' as OwnerSnapshot['accountId'],
    accountGeneration: makeAccountGeneration(generation)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch(physical)!, ownerRef: makeOwnerRef(ownerRef)!,
  });
  const setup = (hooks: HookDependencies = {}) => {
    let liveOwner = makeOwner();
    const publicLines: string[] = [];
    const order: string[] = [];
    let privateOwner: OwnerSnapshot | null = null;
    let written: string[] = [];
    const transport = createTransportOwner({
      currentOwner: () => liveOwner, isCurrentOwner: () => true,
      authenticatedPrefix: hooks.authenticatedPrefix ?? (() => 'irc.transport.test'),
      ...(hooks.beforeIngressLine ? { beforeIngressLine: hooks.beforeIngressLine } : {}),
      ...(hooks.beforeSend ? { beforeSend: hooks.beforeSend } : {}),
      ...(hooks.onWelcomeCandidate ? { onWelcomeCandidate: hooks.onWelcomeCandidate } : {}),
      endpoint: () => 'endpoint' as never,
      consumePrivateLine: hooks.consumePrivateLine ?? (() => false),
      onPublicLine(line, owner) { order.push('public'); publicLines.push(line); hooks.onPublicLine?.(line, owner); },
      onBinary() {}, onState() {},
    });
    transport.onPrivateIngress(event => { order.push('private'); privateOwner = event.owner; return false; });
    const intent = { owner: liveOwner, endpoint: 'endpoint' as never, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => {
      sink.opened();
      sink.line(':irc.transport.test EVENT alice WEBAUTHN SECRET private');
      return { sendLine(line: { readonly line: string }): SendAdmission { written.push(line.line); return { kind: 'transport-admitted' }; }, isOpen: () => true, close() {} };
    } };
    return { transport, get owner() { return liveOwner; }, set owner(value: OwnerSnapshot) { liveOwner = value; }, publicLines, order, get privateOwner() { return privateOwner; }, written, intent };
  };
  it('runs synchronous open callbacks only after driver binding and routes real writes through it', () => {
    const f = setup();
    expect(f.transport.connectAlternative(f.intent).kind).toBe('transport-admitted');
    expect(f.publicLines).toEqual([]);
    expect(f.privateOwner).toEqual(f.owner);
    expect(f.transport.sendLine({ owner: f.owner, requestId: f.intent.requestId, line: 'PING :probe' }).kind).toBe('transport-admitted');
    expect(f.written).toEqual(['PING :probe']);
    f.transport.dispose();
  });
  it('runs the ingress ordering hook before private and public alternative consumers', () => {
    const order: string[] = [];
    const f = setup({
      beforeIngressLine: () => { order.push('before'); },
      consumePrivateLine: () => { order.push('consume'); return false; },
      onPublicLine: () => { order.push('public'); },
    });
    f.transport.onPrivateIngress(() => { order.push('private'); return false; });
    expect(f.transport.connectAlternative(f.intent).kind).toBe('transport-admitted');
    expect(order).toEqual(['before', 'consume', 'private']);
    expect(f.publicLines).toEqual([]);
    f.transport.dispose();
  });
  it('runs the ingress ordering hook before alternative public projection', () => {
    const order: string[] = [];
    const f = setup({
      beforeIngressLine: () => { order.push('before'); },
      consumePrivateLine: () => { order.push('consume'); return false; },
      onPublicLine: () => { order.push('public'); },
    });
    f.transport.onPrivateIngress(() => { order.push('private'); return false; });
    const intent = { ...f.intent, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => {
      sink.line('FOO alice :ordinary diagnostic');
      return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} };
    } };

    expect(f.transport.connectAlternative(intent).kind).toBe('transport-admitted');
    expect(order).toEqual(['before', 'consume', 'private', 'public']);
    expect(f.publicLines).toEqual(['FOO alice :ordinary diagnostic']);
    f.transport.dispose();
  });
  it('keeps OUTHOOK URL notices private on the alternative transport too', () => {
    const f=setup();let deliveries=0;
    f.transport.onPrivateIngress(event=>{if(event.payload.line.includes('OUTHOOK:'))deliveries+=1;return false;});
    const line=':irc.transport.test NOTICE alice :OUTHOOK: https://hooks.example/private/path categories=KILL';
    const intent={...f.intent,open:(sink:{opened():void;line(value:string):void;closed():void})=>{
      sink.opened();sink.line(line);return {sendLine:()=>({kind:'transport-admitted' as const}),isOpen:()=>true,close(){}};
    }};
    expect(f.transport.connectAlternative(intent).kind).toBe('transport-admitted');
    expect(deliveries).toBe(1);expect(f.publicLines).toEqual([]);
    f.transport.dispose();
  });
  it('keeps harmless unknown lines observable and quarantines sensitive-shaped unknown lines on ALT', () => {
    const f = setup();
    let privateDeliveries = 0;
    f.transport.onPrivateIngress(() => { privateDeliveries++; return false; });
    const intent = { ...f.intent, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => {
      sink.opened();
      sink.line('FOO alice :ordinary diagnostic');
      sink.line('@label=x :irc.transport.test FOO alice MEDIA MACKEY #room secret-key-material');
      sink.line(`FOO alice MEDIA MACKEY #room key-${'x'.repeat(9000)}`);
      return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} };
    } };
    expect(f.transport.connectAlternative(intent).kind).toBe('transport-admitted');
    expect(f.publicLines).toEqual(['FOO alice :ordinary diagnostic']);
    expect(privateDeliveries).toBe(1);
    f.transport.dispose();
  });
  it('accepts same-physical proof rotation and stamps ingress with the fresh owner', () => {
    const f = setup();
    f.transport.connectAlternative(f.intent);
    f.owner = makeOwner('0123456789abcdef0123456789abcdef', 'bcdefghijklmnopqrstuvw', 2);
    // The sink passed to the provider remains physically bound while account proof advances.
    const callback: { current: ((value: string) => void) | null } = { current: null };
    f.transport.close();
    const intent = { ...f.intent, owner: f.owner, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => { callback.current = sink.line; sink.opened(); return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} }; } };
    f.transport.connectAlternative(intent);
    callback.current?.(':irc.transport.test EVENT alice WEBAUTHN SECRET private');
    expect(f.privateOwner).toEqual(f.owner);
    expect(f.publicLines).toEqual([]);
    f.transport.dispose();
  });
  it('drops late bytes after physical replacement and never admits a rejected group', () => {
    const f = setup();
    const lateLine: { current: ((value: string) => void) | null } = { current: null };
    const intent = { ...f.intent, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => { lateLine.current = sink.line; sink.opened(); return { sendLine: (line: { readonly line: string }) => { f.written.push(line.line); return { kind: 'transport-admitted' as const }; }, isOpen: () => true, close() {} }; } };
    f.transport.connectAlternative(intent);
    f.owner = makeOwner('fedcba9876543210fedcba9876543210', 'bcdefghijklmnopqrstuvw', 2);
    lateLine.current?.(':irc.transport.test PRIVMSG #room :stale');
    const result = f.transport.sendLineGroup({ owner: f.owner, requestId: f.intent.requestId, lines: ['PRIVMSG #room :ok', '@bad_key=x PRIVMSG #room :reject'] });
    expect(result).toEqual([{ kind: 'blocked', reason: 'invalid-intent' }]);
    expect(f.publicLines).toEqual([]);
    expect(f.written).toEqual([]);
    f.transport.dispose();
  });
  it('rechecks owner and attempt after ingress hooks and fences old alternative callbacks', () => {
    const callback: { current: ((value: string) => void) | null } = { current: null };
    let hookCalls = 0;
    let f!: ReturnType<typeof setup>;
    f = setup({ beforeIngressLine: (_line, capturedOwner) => {
      hookCalls += 1;
      expect(capturedOwner).toEqual(f.owner);
      f.owner = makeOwner('fedcba9876543210fedcba9876543210', 'bcdefghijklmnopqrstuvw', 2);
    } });
    const intent = { ...f.intent, open: (sink: { opened(): void; line(value: string): void; closed(): void }) => {
      callback.current = sink.line;
      return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} };
    } };
    f.transport.connectAlternative(intent);
    callback.current?.(':irc.transport.test PRIVMSG #room :reentrant stale line');
    callback.current?.(':irc.transport.test PRIVMSG #room :later stale line');

    expect(hookCalls).toBe(1);
    expect(f.order).toEqual([]);
    expect(f.publicLines).toEqual([]);
    expect(f.privateOwner).toBeNull();
    f.transport.dispose();
  });
  it('blocks an alternative wire write when beforeSend changes the owner', () => {
    let f!: ReturnType<typeof setup>;
    f = setup({ beforeSend: () => {
      f.owner = makeOwner('fedcba9876543210fedcba9876543210', 'bcdefghijklmnopqrstuvw', 2);
    } });
    expect(f.transport.connectAlternative(f.intent).kind).toBe('transport-admitted');

    expect(f.transport.sendLine({ owner: f.intent.owner, requestId: f.intent.requestId, line: 'PING :probe' }))
      .toEqual({ kind: 'blocked', reason: 'owner-changed' });
    expect(f.written).toEqual([]);
    f.transport.dispose();
  });
  it('drops reentrant open callbacks after a synchronous close invalidates the alternative epoch', () => {
    const f = setup();
    const states: string[] = [];
    const transport = createTransportOwner({
      currentOwner: () => f.owner, isCurrentOwner: () => true, authenticatedPrefix: () => 'irc.transport.test',
      endpoint: () => 'endpoint' as never, consumePrivateLine: () => false, onPublicLine(line) { f.publicLines.push(line); },
      onBinary() {}, onState(state) { states.push(state); },
    });
    transport.connectAlternative({ ...f.intent, open: sink => {
      sink.closed(); sink.opened(); sink.line(':irc.transport.test PRIVMSG #room :must drop');
      return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} };
    } });
    expect(states).toEqual(['connecting', 'offline']);
    expect(f.publicLines).toEqual([]);
    expect(transport.isOpen()).toBe(false);
    transport.dispose(); f.transport.dispose();
  });
});

describe('binary media transport readiness', () => {
  it('reports ready only for the current negotiated binary WebSocket and clears on alternative transport', () => {
    const { owner, transport } = fixture(-1, 'onyx.irc-media.v1');
    expect(transport.supportsBinaryMedia()).toBe(true);
    transport.connectAlternative({ owner, endpoint: 'endpoint' as never, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, open: sink => {
      sink.opened(); return { sendLine: () => ({ kind: 'transport-admitted' as const }), isOpen: () => true, close() {} };
    } });
    expect(transport.supportsBinaryMedia()).toBe(false);
    transport.dispose();
  });
  it('keeps text-only and offline WSS unavailable for media frames', () => {
    const textOnly = fixture();
    expect(textOnly.transport.supportsBinaryMedia()).toBe(false);
    textOnly.transport.dispose();
    const binary = fixture(-1, 'onyx.irc-media.v1');
    binary.transport.close();
    expect(binary.transport.supportsBinaryMedia()).toBe(false);
    binary.transport.dispose();
  });
});

describe('E12 WSS transport boundary', () => {
  type FakeSocket = {
    readyState: number; protocol: string; bufferedAmount: number; binaryType: string;
    readonly sent: string[]; readonly closeCalls: Array<{ readonly code: number | undefined; readonly reason: string | undefined }>;
    onSend?: (socket: FakeSocket, value: string) => void;
    fire(name: 'open' | 'message' | 'close' | 'error', event?: unknown): void;
  };
  const multiSocket = (protocols: readonly string[]) => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:wss://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const sockets: FakeSocket[] = [];
    const publicLines: string[] = [];
    const privateLines: string[] = [];
    const binaryFrames: number[] = [];
    const states: string[] = [];
    const transport = createTransportOwner({
      currentOwner: () => owner, isCurrentOwner: () => true, authenticatedPrefix: () => 'irc.transport.test',
      endpoint: () => 'endpoint' as never,
      socketFactory: () => {
        const listeners = new Map<string, Array<(event?: unknown) => void>>();
        const socket: FakeSocket = {
          readyState: 0, protocol: protocols[sockets.length] ?? 'text.ircv3.net', bufferedAmount: 0, binaryType: 'blob',
          sent: [], closeCalls: [],
          fire(name, event) { for (const listener of listeners.get(name) ?? []) listener(event); },
        };
        const native = Object.assign(socket, {
          addEventListener(name: string, listener: (event?: unknown) => void) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); },
          close(code?: number, reason?: string) { socket.closeCalls.push({ code, reason }); },
          send(value: string | ArrayBuffer | ArrayBufferView) {
            const line = typeof value === 'string' ? value : '[binary]';
            socket.sent.push(line);
            socket.onSend?.(socket, line);
          },
        });
        sockets.push(socket);
        return native as unknown as WebSocket;
      },
      consumePrivateLine: () => false,
      onPublicLine(line) { publicLines.push(line); },
      onBinary(bytes) { binaryFrames.push(bytes.byteLength); },
      onState(state) { states.push(state); },
    });
    transport.onPrivateIngress(event => { privateLines.push(event.payload.line); return false; });
    const open = (socket: FakeSocket) => { socket.readyState = 1; socket.fire('open'); };
    const requestId = makeRequestId('abcdefghijklmnopqrstuv')!;
    return { owner, sockets, publicLines, privateLines, binaryFrames, states, transport, open, requestId };
  };

  it('closes a handshake that selected a non-empty wrong subprotocol before any ingress or write', () => {
    const f = multiSocket(['irc']);
    f.transport.connect('wss://transport.test/irc');
    const socket = f.sockets[0]!;
    f.open(socket);
    socket.fire('message', { data: ':irc.transport.test 001 alice :welcome' });
    const admission = f.transport.sendLine({ owner: f.owner, requestId: f.requestId, line: 'CAP LS 302' });
    const group = f.transport.sendLineGroup({ owner: f.owner, requestId: f.requestId, lines: ['NICK alice', 'USER a 0 * :a'] });

    expect(socket.closeCalls).toEqual([{ code: 1002, reason: 'Unsupported WebSocket protocol' }]);
    expect(f.states).toEqual(['connecting']);
    expect(f.publicLines).toEqual([]);
    expect(f.privateLines).toEqual([]);
    expect(admission).toEqual({ kind: 'blocked', reason: 'offline' });
    expect(group.map(result => result.kind)).toEqual(['blocked', 'blocked']);
    expect(socket.sent).toEqual([]);
    expect(f.transport.supportsBinaryMedia()).toBe(false);
    f.transport.dispose();
  });

  it('closes a text-protocol socket on a binary frame and never delivers or sends binary on it', () => {
    const f = multiSocket(['text.ircv3.net']);
    f.transport.connect('wss://transport.test/irc');
    const socket = f.sockets[0]!;
    f.open(socket);
    const listenerFrames: number[] = [];
    f.transport.onBinary(event => { listenerFrames.push(event.payload.byteLength); });

    socket.fire('message', { data: new Uint8Array([1, 2, 3, 4]).buffer });
    const binary = f.transport.sendBinary({ owner: f.owner, requestId: f.requestId, bytes: new Uint8Array([9, 9]) });

    expect(socket.closeCalls).toEqual([{ code: 1002, reason: 'Invalid binary frame' }]);
    expect(f.binaryFrames).toEqual([]);
    expect(listenerFrames).toEqual([]);
    expect(f.publicLines).toEqual([]);
    expect(binary).toEqual({ kind: 'blocked', reason: 'offline' });
    expect(socket.sent).toEqual([]);
    f.transport.dispose();
  });

  it('ignores every event from a replaced socket and routes sends only to its replacement', () => {
    const f = multiSocket(['text.ircv3.net', 'text.ircv3.net']);
    f.transport.connect('wss://a.transport.test/irc');
    const a = f.sockets[0]!;
    f.open(a);
    f.transport.connect('wss://b.transport.test/irc');
    const b = f.sockets[1]!;
    f.open(b);
    expect(a.closeCalls).toHaveLength(1);
    const statesBefore = [...f.states];

    a.fire('message', { data: ':irc.transport.test PRIVMSG #room :stale from a' });
    a.fire('message', { data: new Uint8Array([1]).buffer });
    a.fire('open');
    a.fire('close');
    a.fire('error');
    const admission = f.transport.sendLine({ owner: f.owner, requestId: f.requestId, line: 'PRIVMSG #room :fresh' });
    b.fire('message', { data: ':irc.transport.test PRIVMSG #room :live from b' });

    expect(statesBefore).toEqual(['connecting', 'live', 'connecting', 'live']);
    expect(f.states).toEqual(statesBefore);
    expect(f.publicLines).toEqual([':irc.transport.test PRIVMSG #room :live from b']);
    expect(f.privateLines).toEqual([':irc.transport.test PRIVMSG #room :live from b']);
    expect(f.binaryFrames).toEqual([]);
    expect(admission).toEqual({ kind: 'transport-admitted' });
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual(['PRIVMSG #room :fresh']);
    expect(f.transport.isOpen()).toBe(true);
    f.transport.dispose();
  });

  it('reports admitted, admitted, blocked when the socket closes mid group and replays nothing after reconnect', () => {
    const f = multiSocket(['text.ircv3.net', 'text.ircv3.net']);
    f.transport.connect('wss://a.transport.test/irc');
    const a = f.sockets[0]!;
    f.open(a);
    a.onSend = (socket) => { if (socket.sent.length === 2) socket.readyState = 3; };
    const lines = ['BATCH +m draft/multiline #room', '@batch=m PRIVMSG #room :first', 'BATCH -m'];

    const results = f.transport.sendLineGroup({ owner: f.owner, requestId: f.requestId, lines });
    a.fire('close');
    f.transport.connect('wss://b.transport.test/irc');
    const b = f.sockets[1]!;
    f.open(b);

    expect(results).toEqual([{ kind: 'transport-admitted' }, { kind: 'transport-admitted' }, { kind: 'blocked', reason: 'offline' }]);
    expect(a.sent).toEqual(lines.slice(0, 2));
    expect(f.states).toEqual(['connecting', 'live', 'offline', 'connecting', 'live']);
    expect(b.sent).toEqual([]);
    f.transport.dispose();
  });
});
