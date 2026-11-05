// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountId, OwnerSnapshot, RequestId, RuntimeFactoryContext, SendAdmission } from './contracts';
import { CadenceMediaEngine, type CadenceMediaClientPort } from '../../src/lib/cadence-media/MediaEngine';
import type { CadenceMediaCallbacks, MediaIdentityAdapter, MediaIdentityContext } from '../../src/lib/cadence-media/types';
import { formatIRCLine, parseIRCMessage } from '../../src/lib/irc/parser';

export interface CadenceTransportAdapterDependencies extends RuntimeFactoryContext {
  readonly currentNick: () => string;
  readonly activeRequest: () => { readonly owner: OwnerSnapshot; readonly requestId: RequestId; readonly conversationId: import('./contracts').ConversationId; readonly callRef: string } | null;
  /** Elm owns roster request correlation; suppress Cadence's fire-and-forget query in that composition. */
  readonly suppressEngineRosterQueries?: boolean;
}

function sameWireOwner(event: { readonly networkId: string; readonly accountId: AccountId | null; readonly accountGeneration: number; readonly connectionGeneration: number }, owner: OwnerSnapshot): boolean {
  return event.networkId === owner.networkId && event.accountId === owner.accountId
    && event.accountGeneration === owner.accountGeneration && event.connectionGeneration === owner.connectionGeneration;
}

/**
 * Constructs Cadence on the already-authenticated physical transport. It owns
 * no socket and accepts media control only from the private server-event feed.
 */
export function createCadenceTransportAdapter(deps: CadenceTransportAdapterDependencies): {
  createEngine(owner: OwnerSnapshot, callbacks: CadenceMediaCallbacks, identity: MediaIdentityAdapter, identityContext: (room: import('./contracts').ConversationId, callRef: string) => MediaIdentityContext | null): CadenceMediaEngine;
  sendCaption(input: { readonly owner: OwnerSnapshot; readonly conversationId: import('./contracts').ConversationId; readonly callRef: string; readonly text: string }): SendAdmission;
  retire(owner: OwnerSnapshot): void;
  dispose(): void;
} {
  const extraMessageHandlers = new Set<(message: import('../../src/lib/irc/types').IRCMessage) => void>();
  const binaryHandlers = new Set<(data: Uint8Array) => void>();
  let engine: CadenceMediaEngine | null = null;
  let engineOwner: OwnerSnapshot | null = null;
  let disposed = false;

  const admission = (line: string, owner: OwnerSnapshot): SendAdmission => {
    if (disposed || !engineOwner || engineOwner.ownerRef !== owner.ownerRef || engineOwner.accountGeneration !== owner.accountGeneration
      || engineOwner.connectionGeneration !== owner.connectionGeneration || !deps.isCurrent(owner) || deps.ownerSnapshot().ownerRef !== owner.ownerRef) return { kind: 'blocked', reason: 'owner-changed' };
    const request = deps.activeRequest();
    if (!request || request.owner.ownerRef !== owner.ownerRef || request.owner.connectionGeneration !== owner.connectionGeneration) return { kind: 'blocked', reason: 'policy' };
    return deps.transport.sendLine({ line, owner, requestId: request.requestId });
  };

  const client: CadenceMediaClientPort = {
    get currentNick() { return deps.currentNick(); },
    extraMessageHandlers,
    binaryHandlers,
    sendRaw(command, ...params) {
      if (deps.suppressEngineRosterQueries === true && command.toUpperCase() === 'MEDIA' && params[0]?.toUpperCase() === 'ROSTER') return false;
      const line = formatIRCLine(command, ...params).replace(/\r\n$/u, '');
      return admission(line, deps.ownerSnapshot()).kind === 'transport-admitted';
    },
    send(line) {
      if (/[\r\n\u0000]/u.test(line)) return false;
      return admission(line, deps.ownerSnapshot()).kind === 'transport-admitted';
    },
    sendBinary(bytes) {
      const owner = deps.ownerSnapshot();
      if (disposed || !deps.isCurrent(owner) || !engineOwner || engineOwner.ownerRef !== owner.ownerRef) return false;
      const request = deps.activeRequest();
      if (!request || request.owner.ownerRef !== owner.ownerRef) return false;
      return deps.transport.sendBinary({ bytes, owner, requestId: request.requestId }).kind === 'transport-admitted';
    },
  };

  const onPrivateIngress = deps.transport.onPrivateIngress(envelope => {
    const { line, owner: eventOwner, sourceKind } = envelope.payload;
    const owner = deps.ownerSnapshot();
    if (disposed || !engine || !engineOwner || sourceKind !== 'server' || eventOwner.ownerRef !== engineOwner.ownerRef
      || !sameWireOwner({ networkId:eventOwner.networkId,accountId:eventOwner.accountId,accountGeneration:eventOwner.accountGeneration,connectionGeneration:eventOwner.connectionGeneration },owner)
      || !sameWireOwner({ networkId:eventOwner.networkId,accountId:eventOwner.accountId,accountGeneration:eventOwner.accountGeneration,connectionGeneration:eventOwner.connectionGeneration },engineOwner)
      || !deps.isCurrent(engineOwner) || line.length > 64 * 1024 || /[\u0000\r\n]/u.test(line)) return false;
    let message: ReturnType<typeof parseIRCMessage>;
    try { message = parseIRCMessage(line); } catch { return false; }
    if (message.command !== 'EVENT' || message.params[1]?.toUpperCase() !== 'MEDIA') return false;
    const recipient = message.params[0];
    // Current Event Spine wire shape only: EVENT <nick> MEDIA <verb> <room> <detail>.
    const verb = message.params[2]?.toUpperCase();
    const room = message.params[3];
    const argument = message.params.slice(4).join(' ');
    const privateReply = verb === 'MACKEY' || verb === 'NATIVE-MACKEY' || verb === 'TRANSPORT' || verb === 'NATIVE';
    if (message.command === 'EVENT' && (!recipient || recipient !== deps.currentNick())) return privateReply;
    if (!verb || !room || room.length > 128) return privateReply;
    const normalized = { ...message, params: [recipient ?? '', 'MEDIA', verb, room, argument] };
    for (const handler of [...extraMessageHandlers]) {
      try { handler(normalized); } catch { /* isolate engine observers; secret stays private */ }
      if (disposed || !engine || !engineOwner || !deps.isCurrent(engineOwner)) break;
    }
    return privateReply;
  });
  const onBinary = deps.transport.onBinary(event => {
    if (disposed || !engine || !engineOwner || event.owner.ownerRef !== engineOwner.ownerRef
      || event.owner.connectionGeneration !== engineOwner.connectionGeneration || !deps.isCurrent(engineOwner)) return;
    for (const handler of [...binaryHandlers]) {
      try { handler(event.payload); } catch { /* isolate engine observers */ }
      if (disposed || !engine || !deps.isCurrent(engineOwner)) return;
    }
  });

  return {
    createEngine(owner, callbacks, identity, identityContext) {
      if (disposed || !deps.isCurrent(owner) || deps.ownerSnapshot().ownerRef !== owner.ownerRef) throw new Error('Cadence engine owner is stale');
      if (engine) {
        if (engineOwner?.ownerRef !== owner.ownerRef) throw new Error('Cadence adapter already belongs to another owner');
        return engine;
      }
      engineOwner = owner;
      engine = new CadenceMediaEngine(callbacks, { kind: 'video', identityAdapter: identity, identityContext: () => {
        const context = identityContext;
        const current = deps.ownerSnapshot();
        if (disposed || !deps.isCurrent(owner) || current.ownerRef !== owner.ownerRef) return null;
        // The caller supplies the room/call-scoped provider; Cadence asks it
        // only after its active room and local call reference are established.
        return context(currentRoom(), currentCallRef());
      } });
      engine.setClient(client);
      return engine;
    },
    sendCaption(input) {
      const request = deps.activeRequest();
      if (disposed || !request || request.owner.ownerRef !== input.owner.ownerRef
        || request.conversationId !== input.conversationId || request.callRef !== input.callRef
        || !deps.isCurrent(input.owner) || /[\r\n\u0000]/u.test(input.text)) return { kind: 'blocked', reason: 'policy' };
      const line = formatIRCLine('MEDIA', 'CAPTION', input.conversationId, input.text).replace(/\r\n$/u, '');
      return admission(line, input.owner);
    },
    retire(owner) {
      if (engineOwner?.ownerRef !== owner.ownerRef) return;
      try { engine?.setClient(null); } catch { /* engine teardown is best effort */ }
      engine = null; engineOwner = null; extraMessageHandlers.clear(); binaryHandlers.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      onPrivateIngress.dispose(); onBinary.dispose();
      engine?.setClient(null);
      engine = null; engineOwner = null;
      extraMessageHandlers.clear(); binaryHandlers.clear();
    },
  };

  // Cadence supplies its private active room/call reference to the identity
  // adapter through this provider. The engine's current identity request is
  // retained privately by the engine itself; these values are resolved from
  // the accepted active request context rather than a public message.
  function currentRoom(): import('./contracts').ConversationId {
    const request = deps.activeRequest();
    if (!request || request.owner.ownerRef !== deps.ownerSnapshot().ownerRef) throw new Error('Media identity request unavailable');
    return request.conversationId as import('./contracts').ConversationId;
  }
  function currentCallRef(): string {
    const request = deps.activeRequest();
    if (!request || request.owner.ownerRef !== deps.ownerSnapshot().ownerRef) throw new Error('Media call reference unavailable');
    return request.callRef;
  }
}
