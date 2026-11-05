import { describe, expect, it } from 'vitest';
import { createGroupAuthoring, type GroupAuthoringDeps, type GroupHead } from './group-authoring';
import { buildMembershipDigest, type VerifiedGroupDirectory } from './group-directory-trust';
import type { AccountId, ConversationId, OwnerSnapshot, PrivateIdentity, RequestContext, Transport } from './contracts';

const owner: OwnerSnapshot = { networkId: 'wss://custom.example/irc' as OwnerSnapshot['networkId'], accountId: 'alice' as AccountId,
  accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 3 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-epoch' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-ref' as OwnerSnapshot['ownerRef'] };
const room = '#secure' as ConversationId;
const request = (id: string, who: OwnerSnapshot = owner): RequestContext => ({ schemaVersion: 1, requestId: id.padEnd(24, '0') as RequestContext['requestId'], owner: who });

async function harness() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const wrap = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const signer = new Uint8Array(32).fill(7);
  const directory: VerifiedGroupDirectory = { complete: true, revision: 'directory-rev', mappingRevision: 'irc-casemapping-v1:rfc1459', canonicalRoom: room, scheme: 'rfc1459',
    devices: [{ accountId: 'alice' as AccountId, deviceId: 'ogc1-alicephone', signerPublicKey: signer, wrapPublicKey: wrap, trusted: true }] };
  const priorHash = new Uint8Array(32).fill(9);
  const digest = await buildMembershipDigest({ networkId: String(owner.networkId), priorEpoch: 1, priorCommitHash: priorHash, localAccount: 'alice', localDeviceId: 'ogc1-alicephone', directory });
  if (!digest) throw new Error('fixture digest unavailable');
  const head: GroupHead = { kind: 'established', epoch: 1, commitHash: priorHash, membershipRevision: 'directory-rev', mappingRevision: directory.mappingRevision,
    membershipDigest: digest, accountId: 'alice' as AccountId, deviceId: 'ogc1-alicephone' };
  const leases: string[] = [];
  const deps: GroupAuthoringDeps = {
    transport: { isCurrent: () => true } as unknown as Transport, privateIdentity: {} as PrivateIdentity,
    isCurrent: () => true,
    currentHead: async () => ({ ...head, commitHash: new Uint8Array(head.commitHash), membershipDigest: new Uint8Array(head.membershipDigest) }),
    authorizeAuthor: () => true, setRoomSendGate: () => {},
    directory: async () => directory,
    signingPublic: async () => ({ deviceId: 'ogc1-alicephone', signerPublicKey: signer, wrapPublicKey: wrap, revision: 'signing-rev' }),
    prepareRecoverableEpoch: async () => false,
    applyAuthenticatedControl: async () => ({ kind: 'rejected' }),
    verifyIngressReceipt: () => false,
    // Recording the lease attempt proves the commit passed its plan-binding gate.
    acquireAuthorLease: async ({ nonce }) => { leases.push(nonce); return null; },
    persistAuthorIntent: async () => false,
  };
  return { authoring: createGroupAuthoring(deps), leases };
}

describe('group authoring plan confirmation', () => {
  it('accepts the explicit confirmation as a separate request bound by the owner-scoped planRef', async () => {
    const { authoring, leases } = await harness();
    const plan = await authoring.plan({ ...request('planRequest'), conversationId: room, explicitUserIntent: true, expectedEpoch: 1, expectedCommitHash: new Uint8Array(32).fill(9) });
    expect(plan?.nextEpoch).toBe(2);
    // The UI confirmation is a distinct domain command with a new requestId.
    const result = await authoring.commit({ ...request('confirmRequest'), planRef: plan!.planRef, confirmMembershipRevision: plan!.membershipRevision, confirmBackupEnabled: true });
    expect(leases).toHaveLength(1);
    expect(result).toMatchObject({ phase: 'conflict', reason: 'commit-conflict' });
  });

  it('still refuses a confirmation from another owner and keeps the planRef single-use', async () => {
    const { authoring, leases } = await harness();
    const plan = await authoring.plan({ ...request('planRequest'), conversationId: room, explicitUserIntent: true, expectedEpoch: 1, expectedCommitHash: new Uint8Array(32).fill(9) });
    const other = { ...owner, ownerRef: 'other-owner' as OwnerSnapshot['ownerRef'] };
    const refused = await authoring.commit({ ...request('confirmRequest', other), planRef: plan!.planRef, confirmMembershipRevision: plan!.membershipRevision, confirmBackupEnabled: true });
    expect(refused).toMatchObject({ phase: 'failed', reason: 'stale-owner' });
    const replay = await authoring.commit({ ...request('confirmRequest'), planRef: plan!.planRef, confirmMembershipRevision: plan!.membershipRevision, confirmBackupEnabled: true });
    expect(replay).toMatchObject({ phase: 'failed', reason: 'invalid-chain' });
    expect(leases).toHaveLength(0);
  });
});
