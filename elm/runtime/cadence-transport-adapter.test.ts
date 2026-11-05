import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadenceMediaEngine, type CadenceMediaClientPort } from '../../src/lib/cadence-media/MediaEngine';
import type { CadenceMediaCallbacks, MediaIdentityAdapter } from '../../src/lib/cadence-media/types';
import { createCadenceTransportAdapter } from './cadence-transport-adapter';
import { makeAccountGeneration, makeConnectionGeneration, makeConversationId, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeRequestId, type OwnerSnapshot } from './contracts';
import { parseIRCMessage } from '../../src/lib/irc/parser';
import { createTransportOwner } from './transport-owner';

describe('Cadence private Event Spine adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('delivers tagged structured MACKEY and record events to the private engine handler only', () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('fixture-network')!, accountId: 'alice' as OwnerSnapshot['accountId'],
      accountGeneration: makeAccountGeneration(1)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const socketListeners = new Map<string, (event?: unknown) => void>();
    const sentLines: string[] = [];
    const socket = {
      readyState: 1, protocol: 'text.ircv3.net', bufferedAmount: 0, binaryType: 'arraybuffer',
      addEventListener(name: string, listener: (event?: unknown) => void) { socketListeners.set(name, listener); },
      close() {}, send(line: string) { sentLines.push(line); },
    } as unknown as WebSocket;
    const publicLines: string[] = [];
    const privateRecordStatuses: string[] = [];
    const transport = createTransportOwner({
      currentOwner: () => owner, isCurrentOwner: () => true, authenticatedPrefix: () => 'irc.example',
      endpoint: () => 'fixture-endpoint' as never, socketFactory: () => socket,
      consumePrivateLine: () => false, onPublicLine: line => publicLines.push(line), onBinary() {}, onState() {},
    });
    transport.connect('wss://irc.example/ws');
    socketListeners.get('open')?.();

    const originalSetClient = CadenceMediaEngine.prototype.setClient;
    let engineClient: CadenceMediaClientPort | null = null;
    vi.spyOn(CadenceMediaEngine.prototype, 'setClient').mockImplementation(function (this: CadenceMediaEngine, client) {
      if (client) engineClient = client;
      return originalSetClient.call(this, client);
    });
    const mediaAdapter = createCadenceTransportAdapter({
      ownerSnapshot: () => owner, isCurrent: () => true, transport,
      privateIdentity: {} as never, emit() {},
      platform: {} as never, currentNick: () => 'alice',
      activeRequest: () => ({ owner, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, conversationId: makeConversationId('#room')!, callRef: 'call-reference-0123456789' }),
      suppressEngineRosterQueries: true,
    });
    transport.onPrivateIngress(event => {
      const message = parseIRCMessage(event.payload.line);
      if (message.command === 'EVENT' && message.params[1]?.toUpperCase() === 'MEDIA' && message.params[2]?.toUpperCase() === 'RECORD') {
        privateRecordStatuses.push(message.params[4] ?? '');
        return true;
      }
      return false;
    });
    const callbacks: CadenceMediaCallbacks = {
      onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {},
    };
    const identity: MediaIdentityAdapter = {
      async getPublicIdentity() { return null; }, async signHandshake() { return null; }, async signFrame() { return null; }, async verifyPeerBinding() { return null; },
    };
    mediaAdapter.createEngine(owner, callbacks, identity, () => null);
    const sentBeforeEngineRoster = sentLines.length;
    expect(engineClient!.sendRaw('MEDIA', 'ROSTER', '#room')).toBe(false);
    expect(sentLines).toHaveLength(sentBeforeEngineRoster);
    const observed: Array<{ readonly family: string | undefined; readonly verb: string | undefined; readonly room: string | undefined; readonly detailLength: number }> = [];
    engineClient!.extraMessageHandlers.add(message => observed.push({
      family: message.params[1], verb: message.params[2], room: message.params[3], detailLength: message.params[4]?.length ?? 0,
    }));

    socketListeners.get('message')?.({ data: '@time=2026-11-04T00:00:00Z :irc.example EVENT alice MEDIA MACKEY #room a2V5' });
    socketListeners.get('message')?.({ data: '@time=2026-11-04T00:00:01Z :irc.example EVENT alice MEDIA RECORD #room started' });
    // An unknown command is not reinterpreted as a media Event Spine event.
    socketListeners.get('message')?.({ data: ':irc.example FOO MEDIA #room' });

    expect(observed).toEqual([
      { family: 'MEDIA', verb: 'MACKEY', room: '#room', detailLength: 4 },
      { family: 'MEDIA', verb: 'RECORD', room: '#room', detailLength: 7 },
    ]);
    expect(privateRecordStatuses).toEqual(['started']);
    expect(publicLines).toEqual([':irc.example FOO MEDIA #room']);
    mediaAdapter.dispose();
    transport.dispose();
  });
});
