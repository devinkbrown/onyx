import { describe, expect, it, vi } from 'vitest';
import { makeLocalPhysicalEpoch, makeNetworkId, makeRequestId, type EndpointId, type OwnerSnapshot, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createSendAcceptanceRegistry } from './send-acceptance-registry';
import { parseIRCMessage } from '../../src/lib/irc/parser';
import type { JournalRow } from './outbox-journal';

const owner: OwnerSnapshot = {
  networkId: makeNetworkId('network-a')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
  accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
  physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const context: RequestContext = { schemaVersion: 1, requestId: makeRequestId('0123456789abcdef0123456789abcdef')!, owner };
const ticket: LocalNamespaceTicket = {
  scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-a', installationDeviceId: 'device-a', localWorkspaceEpoch: 1 },
  ownerKey: 'local-owner-a', workspaceEpoch: 1,
  conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('namespace-ticket'),
};

function fixture() {
  const proofs: Array<{ recordId: string; proofRef: symbol; context: RequestContext; messageIds: readonly string[]; storageKind: 'durable' | 'memory' }> = [];
  const registry = createSendAcceptanceRegistry({
    ownerSnapshot: () => owner, isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef, isNamespaceCurrent: () => true,
    negotiatedCaps: () => new Set(['message-tags', 'labeled-response', 'echo-message']),
    currentServerPrefix: () => 'irc.example', currentNick: () => 'Alice', currentEndpointId: () => 'endpoint-a' as EndpointId,
    currentMappingRevision: () => 'irc-casemapping-v1:ascii', onProofReady: (proof) => proofs.push(proof), now: () => 1000,
  });
  return { registry, proofs };
}

describe('private send acceptance registry', () => {
  it('requires each labelled message to return as a self echo with a server msgid', async () => {
    const { registry, proofs } = fixture();
    const prepared = await registry.prepareAttempt({
      context, ticket, recordId: 'record-a', clientIntentId: context.requestId, semanticCommitment: 'a'.repeat(64), storageKind: 'durable',
      claimNonce: 'abcdefghijklmnopqrstuv', operation: 'privmsg', baseTarget: '#room', baseTargetKey: '#room', wireTarget: '#room',
      lines: ['@+onyx/e2ee=mls PRIVMSG #room :hello'], semanticShape: 'single-message',
    });
    expect(prepared).not.toBeNull();
    const parsed = parseIRCMessage(prepared!.lines[0]!);
    const label = parsed.tags.label!;

    expect(registry.ingest({ line: `@label=${label};msgid=peer-id :Mallory!u@host PRIVMSG #room :hello`, owner, sourceKind: 'user' })).toBe(false);
    expect(proofs).toHaveLength(0);
    expect(registry.ingest({ line: `@label=${label} :irc.example ACK`, owner, sourceKind: 'server' })).toBe(false);
    expect(registry.ingest({ line: `@label=${label};msgid=server-id :Alice!u@host PRIVMSG #room :hello`, owner, sourceKind: 'user' })).toBe(true);
    // An exact echo can race the durable transport-admission write. Do not
    // publish its proof until the journal confirms the claimed plan outcome.
    expect(proofs).toHaveLength(0);
    registry.observeAdmission({ recordId: 'record-a', claimNonce: 'abcdefghijklmnopqrstuv', planHash: prepared!.planHash, kind: 'transport-admitted' });
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.messageIds).toEqual(['server-id']);

    const row: JournalRow = {
      id: JSON.stringify([ticket.ownerKey, 'record-a']), ownerKey: ticket.ownerKey, ownerAccountGeneration: 2,
      ownerConnectionGeneration: 4, clientIntentId: context.requestId, retryOfRecordId: null, operation: 'privmsg',
      target: '#room', targetKey: '#room', payload: { kind: 'sealed-local-plaintext', ciphertext: new Uint8Array(40), payloadCommitment: 'a'.repeat(64) },
      policyRevision: 'policy-a', queuedAt: 1, expiresAt: 9_999, state: 'transport-admitted', claimNonce: 'abcdefghijklmnopqrstuv',
      claimExpiresAt: 9_999, policyGeneration: 1,
      dispatchAttempt: { nonce: 'abcdefghijklmnopqrstuv', planHash: prepared!.planHash, lineCount: 1, policyRevision: 'policy-a', mappingRevision: ticket.conversationScheme!.revision, startedAt: 1000 },
    };
    expect(registry.verifyAcceptanceProof(proofs[0]!.proofRef, { ...context, recordId: 'record-a' } as RequestContext & { readonly recordId: string }, row)).toBe(true);
    registry.dispose();
  });

  it('keeps a no-label memo stream fenced after an unknown result', async () => {
    // No tagged capabilities means only one private, serialized MEMO can own the response stream.
    const noLabels = createSendAcceptanceRegistry({
      ownerSnapshot: () => owner, isCurrent: () => true, isNamespaceCurrent: () => true, negotiatedCaps: () => new Set(),
      currentServerPrefix: () => 'irc.example', currentNick: () => 'Alice', currentEndpointId: () => 'endpoint-a' as EndpointId,
      currentMappingRevision: () => 'irc-casemapping-v1:ascii', onProofReady: vi.fn(), now: () => 2000,
    });
    const first = await noLabels.prepareAttempt({
      context, ticket, recordId: 'memo-a', clientIntentId: context.requestId, semanticCommitment: 'b'.repeat(64), storageKind: 'durable',
      claimNonce: 'abcdefghijklmnopqrstuv', operation: 'memo-send', baseTarget: 'bob', wireTarget: 'bob',
      baseTargetKey: 'bob', lines: ['MEMO SEND bob :note'], semanticShape: 'memo',
    });
    expect(first).not.toBeNull();
    noLabels.observeAdmission({ recordId: 'memo-a', claimNonce: 'abcdefghijklmnopqrstuv', planHash: first!.planHash, kind: 'unknown' });
    expect(await noLabels.prepareAttempt({
      context, ticket, recordId: 'memo-b', clientIntentId: context.requestId, semanticCommitment: 'c'.repeat(64), storageKind: 'durable',
      claimNonce: 'zyxwvutsrqponmlkjihgfe', operation: 'memo-send', baseTarget: 'bob', wireTarget: 'bob',
      baseTargetKey: 'bob', lines: ['MEMO SEND bob :another note'], semanticShape: 'memo',
    })).toBeNull();
    expect(noLabels.memoCorrelationClear(context, ticket)).toBe(false);
    noLabels.retireOwner(owner);
    expect(noLabels.memoCorrelationClear(context, ticket)).toBe(true);
    noLabels.dispose();
  });

  it('holds a no-label memo success until its journal outcome is durable', async () => {
    const proofs: Array<{ recordId: string; proofRef: symbol; context: RequestContext; messageIds: readonly string[]; storageKind: 'durable' | 'memory' }> = [];
    const noLabels = createSendAcceptanceRegistry({
      ownerSnapshot: () => owner, isCurrent: () => true, isNamespaceCurrent: () => true, negotiatedCaps: () => new Set(),
      currentServerPrefix: () => 'irc.example', currentNick: () => 'Alice', currentEndpointId: () => 'endpoint-a' as EndpointId,
      currentMappingRevision: () => 'irc-casemapping-v1:ascii', onProofReady: (proof) => proofs.push(proof), now: () => 3000,
    });
    const prepared = await noLabels.prepareAttempt({
      context, ticket, recordId: 'memo-race', clientIntentId: context.requestId, semanticCommitment: 'd'.repeat(64), storageKind: 'durable',
      claimNonce: 'abcdefghijklmnopqrstuv', operation: 'memo-send', baseTarget: 'bob', wireTarget: 'bob',
      baseTargetKey: 'bob', lines: ['MEMO SEND bob :note'], semanticShape: 'memo',
    });
    expect(prepared).not.toBeNull();
    expect(noLabels.ingest({ line: ':irc.example NOTICE Alice :MEMO: message stored for delivery', owner, sourceKind: 'server' })).toBe(true);
    expect(proofs).toHaveLength(0);
    noLabels.observeAdmission({ recordId: 'memo-race', claimNonce: 'abcdefghijklmnopqrstuv', planHash: prepared!.planHash, kind: 'unknown' });
    expect(proofs).toHaveLength(1);
    noLabels.dispose();
  });
});
