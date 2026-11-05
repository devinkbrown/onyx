import { describe, expect, it } from 'vitest';
import { createGroupRecovery, type GroupRecoveryDeps, type PortablePreview } from './group-recovery';
import type { OwnerSnapshot, RequestContext, Transport } from './contracts';

describe('portable group recovery approval', () => {
  it('previews without installing and requires the exact fingerprint for history-only approval', async () => {
    const owner: OwnerSnapshot = { networkId: 'wss://custom.example/irc' as OwnerSnapshot['networkId'], accountId: null,
      accountGeneration: 4 as OwnerSnapshot['accountGeneration'], connectionGeneration: 9 as OwnerSnapshot['connectionGeneration'],
      physicalRef: 'guest-epoch' as OwnerSnapshot['physicalRef'], ownerRef: 'retired-owner' as OwnerSnapshot['ownerRef'] };
    const transport = { isCurrent: () => false } as unknown as Transport;
    const preview: PortablePreview = { previewRef: 'preview-reference', networkId: String(owner.networkId), accountId: 'alice',
      conversationId: '#private' as never, epoch: 7, commitHashHex: '11'.repeat(32), signerAccountId: 'alice',
      signerDeviceId: 'old-device', signerFingerprintHex: '22'.repeat(32), trust: 'new-history-checkpoint', historyOnly: true };
    let installed = false; let requestedFingerprint = '';
    const deps: GroupRecoveryDeps = {
      transport, isCurrent: () => false, currentDeviceId: async () => null, isLocalCurrent: () => true,
      enrollVerifiedDevice: async () => null, createWelcomeRequest: async () => null,
      authoring: {} as GroupRecoveryDeps['authoring'],
      exportPortableBackup: async () => ({ kind: 'blocked', reason: 'epoch-material-unavailable' }),
      writePrivateBackupSelection: async () => false,
      previewPortableBackup: async () => ({ kind: 'preview', preview }),
      approvePortableBackup: async ({ confirmFingerprint }) => {
        requestedFingerprint = confirmFingerprint; installed = true;
        return { kind: 'installed-history-only', conversationId: preview.conversationId, epoch: preview.epoch, commitHashHex: preview.commitHashHex };
      },
      cancelPortableBackup: () => {}, authorizeRemovalIntent: async () => false,
    };
    const recovery = createGroupRecovery(deps);
    const request: RequestContext = { schemaVersion: 1, requestId: 'domainRequest000000000041' as never, owner };
    const reviewed = await recovery.importBackup({ ...request, conversationId: '#private' as never,
      inputRef: Symbol('input'), passwordRef: Symbol('password'), configuredNetworkId: String(owner.networkId) });
    expect(reviewed.phase).toBe('ready');
    expect(reviewed.backupOutcome).toBe('preview');
    expect(reviewed.preview).toEqual(preview);
    expect(installed).toBe(false);
    const approved = await recovery.approveBackup({ ...request, previewRef: preview.previewRef,
      confirmHistoryOnly: true, confirmFingerprint: preview.signerFingerprintHex });
    expect(approved.phase).toBe('ready');
    expect(approved.backupOutcome).toBe('installed-history-only');
    expect(installed).toBe(true);
    expect(requestedFingerprint).toBe(preview.signerFingerprintHex);
    recovery.dispose();
  });
});
