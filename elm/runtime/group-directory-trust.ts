/** Owner-fenced adapter for complete, authenticated ODD1 device snapshots. */
import type { AccountId, ConversationId, OwnerSnapshot, RequestContext } from './contracts';
import { isValidP256UncompressedPublicKey } from '../../src/lib/e2ee/groupDeviceDirectory';

export interface VerifiedGroupDevice {
  readonly accountId: AccountId;
  readonly deviceId: string;
  readonly signerPublicKey: Uint8Array;
  readonly wrapPublicKey: Uint8Array;
  readonly trusted: true;
}
export interface VerifiedGroupDirectory {
  readonly complete: true;
  readonly revision: string;
  readonly mappingRevision: string;
  readonly canonicalRoom: string;
  readonly scheme: 'ascii' | 'rfc1459' | 'strict-rfc1459';
  readonly devices: readonly VerifiedGroupDevice[];
}
export interface GroupDirectoryProvider {
  snapshot(input: RequestContext & { readonly conversationId: ConversationId }): Promise<VerifiedGroupDirectory | null>;
}

const encoder = new TextEncoder();
const ACCOUNT = /^[A-Za-z0-9_.@-]{1,64}$/u;
const DEVICE = /^[A-Za-z0-9_.-]{1,32}$/u;
const MAX_DEVICES = 256;
function cmp(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
function putU16(out: number[], bytes: Uint8Array): boolean {
  if (!bytes.length || bytes.length > 0xffff) return false;
  out.push(bytes.length >>> 8, bytes.length & 255, ...bytes);
  return true;
}
function isNonzero(b: Uint8Array): boolean { return b.some((x) => x !== 0); }

/**
 * Builds the frozen v1 membership transcript from a complete, owner-scoped,
 * authenticated directory. It rejects incomplete or ambiguous snapshots;
 * it never turns a nick/NAMES list into device authority.
 */
export async function buildMembershipDigest(input: {
  readonly networkId: string;
  readonly priorEpoch: number;
  readonly priorCommitHash: Uint8Array;
  readonly localAccount: string;
  readonly localDeviceId: string;
  readonly directory: VerifiedGroupDirectory;
}): Promise<Uint8Array | null> {
  const d = input.directory;
  if (d.complete !== true || !d.revision || !d.mappingRevision || !d.canonicalRoom
    || input.priorCommitHash.byteLength !== 32 || !Number.isSafeInteger(input.priorEpoch) || input.priorEpoch < 0
    || (input.priorEpoch === 0 ? isNonzero(input.priorCommitHash) : !isNonzero(input.priorCommitHash))
    || !ACCOUNT.test(input.localAccount) || !DEVICE.test(input.localDeviceId)
    || d.devices.length === 0 || d.devices.length > MAX_DEVICES) return null;
  const devices = [...d.devices].filter((x) => x.trusted === true);
  if (devices.length !== d.devices.length) return null;
  const encoded = devices.map((x) => ({
    account: x.accountId.toLowerCase(),
    device: x.deviceId,
    accountBytes: encoder.encode(x.accountId.toLowerCase()),
    deviceBytes: encoder.encode(x.deviceId),
    signer: new Uint8Array(x.signerPublicKey),
    wrap: new Uint8Array(x.wrapPublicKey),
  }));
  if (encoded.some((x) => !ACCOUNT.test(x.account) || !DEVICE.test(x.device)
    || x.signer.length !== 32 || !isNonzero(x.signer)
    || x.wrap.length !== 65 || !isValidP256UncompressedPublicKey(x.wrap))) return null;
  encoded.sort((a, b) => cmp(a.accountBytes, b.accountBytes) || cmp(a.deviceBytes, b.deviceBytes));
  for (let i = 1; i < encoded.length; i++) {
    const p = encoded[i - 1]!; const c = encoded[i]!;
    if (cmp(p.accountBytes, c.accountBytes) === 0 && cmp(p.deviceBytes, c.deviceBytes) === 0) return null;
  }
  if (!encoded.some((x) => x.account === input.localAccount.toLowerCase() && x.device === input.localDeviceId)) return null;
  const network = encoder.encode(input.networkId);
  const room = encoder.encode(d.canonicalRoom);
  const scheme = encoder.encode(d.scheme);
  if (!network.length || network.length > 0xffff || !room.length || room.length > 0xffff) return null;
  const output: number[] = [...encoder.encode('ONYX-GROUP-MEMBERSHIP-v1\0')];
  if (!putU16(output, network) || !putU16(output, room) || !putU16(output, scheme)) return null;
  output.push(...input.priorCommitHash, (encoded.length >>> 8) & 255, encoded.length & 255);
  try {
    for (const item of encoded) {
      const signerHash = new Uint8Array(await crypto.subtle.digest('SHA-256', item.signer));
      const wrapHash = new Uint8Array(await crypto.subtle.digest('SHA-256', item.wrap));
      if (!putU16(output, item.accountBytes) || !putU16(output, item.deviceBytes)) return null;
      output.push(...signerHash, ...wrapHash);
      signerHash.fill(0); wrapHash.fill(0);
    }
    return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(output)));
  } catch { return null; }
  finally {
    for (const item of encoded) { item.signer.fill(0); item.wrap.fill(0); }
    network.fill(0); room.fill(0); scheme.fill(0); output.fill(0);
  }
}

export function createGroupDirectoryTrust(provider: GroupDirectoryProvider, isCurrent: (o: OwnerSnapshot) => boolean) {
  return {
    async snapshot(req: RequestContext & { readonly conversationId: ConversationId }): Promise<VerifiedGroupDirectory | null> {
      if (!isCurrent(req.owner)) return null;
      try {
        const result = await provider.snapshot(req);
        if (!isCurrent(req.owner) || !result || result.complete !== true || result.devices.length > MAX_DEVICES) return null;
        return result;
      } catch { return null; }
    },
  };
}
