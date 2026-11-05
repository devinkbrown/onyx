/** Explicit, password-protected local group epoch backup container. */
import { makeAccountId, makeNetworkId } from './contracts';
export const BACKUP_ITERATIONS = 600_000;
export const BACKUP_MAX_ITERATIONS = 2_000_000;
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
const MAGIC = new TextEncoder().encode('ONYXGBK1');
const MAGIC_V2 = new TextEncoder().encode('ONYXGBK2');
const DOMAIN = 'onyx-group-key-backup-v1';
const PORTABLE_DOMAIN = 'onyx-group-portable-backup-v2\0';
const PORTABLE_MAX_CONTAINER_BYTES = 128 * 1024;
const PORTABLE_MAX_PLAINTEXT_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export interface BackupMetadata {
  readonly networkId: string; readonly accountId: string; readonly deviceId: string;
  readonly room: string; readonly epoch: number; readonly commitHash: string;
  readonly membershipDigest: string; readonly kind: 'room-epoch-key';
}
export interface ParsedBackup { readonly metadata: BackupMetadata; readonly epochKey: Uint8Array }
export type PortableGroupBackup = {
  readonly version: 2; readonly kind: 'room-epoch-history'; readonly networkId: string; readonly accountId: string;
  readonly exportingDeviceId: string; readonly room: string; readonly epoch: number; readonly commitHashHex: string;
  readonly membershipDigestHex: string; readonly epochKeyB64url: string;
  readonly receipt: { readonly signedCommitPayload: string; readonly fromAccount: string; readonly fromDevice: string;
    readonly signerPublicKeyB64url: string; readonly signerFingerprintHex: string; readonly acceptanceTrust: 'first-use' | 'pinned';
    readonly acceptedMembershipRevision: string; readonly acceptedMappingScheme: 'ascii' | 'rfc1459' | 'strict-rfc1459';
    readonly provenance: 'source-observed-acceptance' | 'user-approved-history-checkpoint' };
};
export type ParsedPortableGroupBackup = { readonly payload: PortableGroupBackup; readonly epochKey: Uint8Array; readonly signerPublicKey: Uint8Array };
function base64urlBytes(value: unknown, size: number): Uint8Array | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length !== size || toB64url(bytes) !== value) { bytes.fill(0); return null; }
    return bytes;
  } catch { return null; }
}
function toB64url(bytes: Uint8Array): string {
  let binary = ''; for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
function portablePlaintext(payload: PortableGroupBackup): Uint8Array | null {
  const topKeys = ['version','kind','networkId','accountId','exportingDeviceId','room','epoch','commitHashHex','membershipDigestHex','epochKeyB64url','receipt'];
  const receiptKeys = ['signedCommitPayload','fromAccount','fromDevice','signerPublicKeyB64url','signerFingerprintHex','acceptanceTrust','acceptedMembershipRevision','acceptedMappingScheme','provenance'];
  if (!payload || typeof payload !== 'object' || !payload.receipt || typeof payload.receipt !== 'object') return null;
  const rawEpochKey = base64urlBytes(payload.epochKeyB64url, 32);
  const rawSignerKey = base64urlBytes(payload.receipt.signerPublicKeyB64url, 32);
  const valid = Object.keys(payload).length === topKeys.length && !Object.keys(payload).some((key) => !topKeys.includes(key))
    && Object.keys(payload.receipt).length === receiptKeys.length && !Object.keys(payload.receipt).some((key) => !receiptKeys.includes(key))
    && payload.version === 2 && payload.kind === 'room-epoch-history' && makeNetworkId(payload.networkId) === payload.networkId
    && makeAccountId(payload.accountId) === payload.accountId && makeAccountId(payload.receipt.fromAccount) === payload.receipt.fromAccount
    && !!rawEpochKey && !!rawSignerKey && /^[A-Za-z0-9_.-]{1,32}$/u.test(payload.exportingDeviceId) && /^[A-Za-z0-9_.-]{1,32}$/u.test(payload.receipt.fromDevice)
    && /^#[^\s\u0000-\u001f\u007f]{1,128}$/u.test(payload.room) && Number.isSafeInteger(payload.epoch) && payload.epoch >= 1 && payload.epoch <= 0xffffffff
    && /^[0-9a-f]{64}$/u.test(payload.commitHashHex) && /^[0-9a-f]{64}$/u.test(payload.membershipDigestHex)
    && /^[0-9a-f]{64}$/u.test(payload.receipt.signerFingerprintHex) && typeof payload.receipt.signedCommitPayload === 'string'
    && encoder.encode(payload.receipt.signedCommitPayload).byteLength <= 4096 && !!payload.receipt.signedCommitPayload
    && /^[^\u0000-\u001f\u007f]{1,256}$/u.test(payload.receipt.acceptedMembershipRevision)
    && ['ascii','rfc1459','strict-rfc1459'].includes(payload.receipt.acceptedMappingScheme)
    && ['first-use','pinned'].includes(payload.receipt.acceptanceTrust)
    && ['source-observed-acceptance','user-approved-history-checkpoint'].includes(payload.receipt.provenance);
  rawEpochKey?.fill(0); rawSignerKey?.fill(0);
  if (!valid) return null;
  const projected = { version: 2, kind: 'room-epoch-history', networkId: payload.networkId, accountId: payload.accountId,
    exportingDeviceId: payload.exportingDeviceId, room: payload.room, epoch: payload.epoch, commitHashHex: payload.commitHashHex,
    membershipDigestHex: payload.membershipDigestHex, epochKeyB64url: payload.epochKeyB64url,
    receipt: { signedCommitPayload: payload.receipt.signedCommitPayload, fromAccount: payload.receipt.fromAccount,
      fromDevice: payload.receipt.fromDevice, signerPublicKeyB64url: payload.receipt.signerPublicKeyB64url,
      signerFingerprintHex: payload.receipt.signerFingerprintHex, acceptanceTrust: payload.receipt.acceptanceTrust,
      acceptedMembershipRevision: payload.receipt.acceptedMembershipRevision, acceptedMappingScheme: payload.receipt.acceptedMappingScheme,
      provenance: payload.receipt.provenance } } satisfies PortableGroupBackup;
  const bytes = encoder.encode(JSON.stringify(projected));
  return bytes.length <= PORTABLE_MAX_PLAINTEXT_BYTES ? bytes : (bytes.fill(0), null);
}
function canonicalMetadata(m: BackupMetadata): Uint8Array | null {
  if (!m || typeof m !== 'object' || Object.keys(m).some((key) => !['kind','networkId','accountId','deviceId','room','epoch','commitHash','membershipDigest'].includes(key))
    || m.kind !== 'room-epoch-key' || makeNetworkId(m.networkId) !== m.networkId
    || makeAccountId(m.accountId) !== m.accountId || !/^[A-Za-z0-9_.-]{1,32}$/u.test(m.deviceId)
    || !/^#[^\s\u0000-\u001f]{1,128}$/u.test(m.room) || !Number.isSafeInteger(m.epoch)
    || m.epoch < 1 || m.epoch > 0xffffffff || !/^[0-9a-f]{64}$/u.test(m.commitHash)
    || !/^[0-9a-f]{64}$/u.test(m.membershipDigest)) return null;
  return encoder.encode(JSON.stringify({ domain: DOMAIN, kind: m.kind, networkId: m.networkId, accountId: m.accountId,
    deviceId: m.deviceId, room: m.room, epoch: m.epoch, commitHash: m.commitHash, membershipDigest: m.membershipDigest }));
}
function ab(b: Uint8Array): ArrayBuffer { return Uint8Array.from(b).buffer; }
async function derive(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const passwordBytes = ab(password);
  const saltBytes = ab(salt);
  try {
    const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { new Uint8Array(passwordBytes).fill(0); new Uint8Array(saltBytes).fill(0); }
}

/** Returns opaque encrypted bytes; caller must save/export only after explicit intent. */
export async function encryptGroupBackup(input: {
  readonly metadata: BackupMetadata; readonly epochKey: Uint8Array; readonly password: Uint8Array;
}): Promise<Uint8Array | null> {
  if (!(input.epochKey instanceof Uint8Array) || input.epochKey.byteLength !== 32
    || !(input.password instanceof Uint8Array) || input.password.byteLength < 12 || input.password.byteLength > 1024) return null;
  const aad = canonicalMetadata(input.metadata);
  const password = new Uint8Array(input.password);
  const epochKey = new Uint8Array(input.epochKey);
  if (!aad || epochKey.length !== 32 || password.length < 12 || password.length > 1024) {
    password.fill(0); epochKey.fill(0); aad?.fill(0); return null;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  let ivBytes: ArrayBuffer | null = null; let plaintextBytes: ArrayBuffer | null = null;
  try {
    const key = await derive(password, salt, BACKUP_ITERATIONS);
    ivBytes = ab(iv); plaintextBytes = ab(epochKey);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: ab(aad), tagLength: 128 }, key, plaintextBytes));
    const metadataBytes = aad;
    const header = new Uint8Array(8 + 4 + 2 + salt.length + 1 + iv.length + 4 + metadataBytes.length);
    let p = 0; header.set(MAGIC, p); p += MAGIC.length;
    new DataView(header.buffer).setUint32(p, BACKUP_ITERATIONS, false); p += 4;
    new DataView(header.buffer).setUint16(p, salt.length, false); p += 2; header.set(salt, p); p += salt.length;
    header[p++] = iv.length; header.set(iv, p); p += iv.length;
    new DataView(header.buffer).setUint32(p, metadataBytes.length, false); p += 4; header.set(metadataBytes, p);
    const out = new Uint8Array(header.length + ciphertext.length); out.set(header); out.set(ciphertext, header.length);
    return out.length <= BACKUP_MAX_BYTES ? out : null;
  } catch { return null; }
  finally { password.fill(0); epochKey.fill(0); aad.fill(0); salt.fill(0); iv.fill(0); if (ivBytes) new Uint8Array(ivBytes).fill(0); if (plaintextBytes) new Uint8Array(plaintextBytes).fill(0); }
}

/** Structurally validates bounded metadata before KDF; GCM authenticates it after derivation. */
export async function decryptGroupBackup(bytesInput: Uint8Array, passwordInput: Uint8Array): Promise<ParsedBackup | null> {
  if (!(bytesInput instanceof Uint8Array) || bytesInput.byteLength > BACKUP_MAX_BYTES
    || bytesInput.byteLength < 64 || !(passwordInput instanceof Uint8Array)
    || passwordInput.byteLength < 12 || passwordInput.byteLength > 1024) return null;
  const bytes = new Uint8Array(bytesInput); const password = new Uint8Array(passwordInput);
  let aad: Uint8Array | null = null; let salt: Uint8Array | null = null; let iv: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null; let ivBytes: ArrayBuffer | null = null; let ciphertextBytes: ArrayBuffer | null = null;
  try {
    if (bytes.length > BACKUP_MAX_BYTES || bytes.length < 8 + 4 + 2 + 16 + 1 + 12 + 4 + 2 + 16 + 32
      || password.length < 12 || password.length > 1024) return null;
    let p = 0; for (const b of MAGIC) if (bytes[p++] !== b) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const iterations = view.getUint32(p, false); p += 4;
    const saltLen = view.getUint16(p, false); p += 2;
    if (iterations < BACKUP_ITERATIONS || iterations > BACKUP_MAX_ITERATIONS || saltLen < 16 || saltLen > 64 || p + saltLen + 1 > bytes.length) return null;
    salt = bytes.slice(p, p + saltLen); p += saltLen;
    const ivLen = bytes[p++]!; if (ivLen !== 12 || p + ivLen + 4 > bytes.length) return null;
    iv = bytes.slice(p, p + ivLen); p += ivLen;
    const aadLen = view.getUint32(p, false); p += 4;
    if (aadLen < 2 || aadLen > 2048 || p + aadLen + 16 > bytes.length) return null;
    aad = bytes.slice(p, p + aadLen); p += aadLen;
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(aad)) as Record<string, unknown>;
    if (!parsed || parsed.domain !== DOMAIN) return null;
    const metadata: BackupMetadata = {
      kind: parsed.kind as BackupMetadata['kind'], networkId: parsed.networkId as string, accountId: parsed.accountId as string,
      deviceId: parsed.deviceId as string, room: parsed.room as string, epoch: parsed.epoch as number,
      commitHash: parsed.commitHash as string, membershipDigest: parsed.membershipDigest as string,
    };
    const expected = canonicalMetadata(metadata);
    if (!expected || expected.length !== aad.length || expected.some((v, i) => v !== aad![i])) return null;
    const key = await derive(password, salt, iterations);
    ivBytes = ab(iv); ciphertextBytes = ab(bytes.slice(p));
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: ab(aad), tagLength: 128 }, key, ciphertextBytes));
    if (plaintext.length !== 32) return null;
    return { metadata, epochKey: new Uint8Array(plaintext) };
  } catch { return null; }
  finally { bytes.fill(0); password.fill(0); aad?.fill(0); salt?.fill(0); iv?.fill(0); plaintext?.fill(0); if (ivBytes) new Uint8Array(ivBytes).fill(0); if (ciphertextBytes) new Uint8Array(ciphertextBytes).fill(0); }
}

/** Encrypts the portable authenticated history checkpoint. No key is exported by this helper. */
export async function encryptPortableGroupBackup(payload: PortableGroupBackup, passwordInput: Uint8Array): Promise<Uint8Array | null> {
  if (!(passwordInput instanceof Uint8Array) || passwordInput.byteLength < 12 || passwordInput.byteLength > 1024) return null;
  const plaintext = portablePlaintext(payload); if (!plaintext) return null;
  const password = passwordInput.slice(); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  let ciphertext: Uint8Array | null = null; let cipherBuffer: ArrayBuffer | null = null; let aad: Uint8Array | null = null;
  try {
    const header = new Uint8Array(47); let p = 0; header.set(MAGIC_V2, p); p += 8;
    const view = new DataView(header.buffer); view.setUint32(p, BACKUP_ITERATIONS, false); p += 4;
    view.setUint16(p, 16, false); p += 2; header.set(salt, p); p += 16;
    header[p++] = 12; header.set(iv, p); p += 12;
    view.setUint32(p, plaintext.length + 16, false);
    const key = await derive(password, salt, BACKUP_ITERATIONS);
    const prefix = encoder.encode(PORTABLE_DOMAIN); aad = new Uint8Array(prefix.length + header.length); aad.set(prefix); aad.set(header, prefix.length); prefix.fill(0);
    cipherBuffer = ab(plaintext);
    ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv), additionalData: ab(aad), tagLength: 128 }, key, cipherBuffer));
    if (ciphertext.length > PORTABLE_MAX_PLAINTEXT_BYTES + 16) return null;
    const output = new Uint8Array(header.length + ciphertext.length); output.set(header); output.set(ciphertext, header.length);
    return output.length <= PORTABLE_MAX_CONTAINER_BYTES ? output : (output.fill(0), null);
  } catch { return null; }
  finally { plaintext.fill(0); password.fill(0); salt.fill(0); iv.fill(0); ciphertext?.fill(0); aad?.fill(0); if (cipherBuffer) new Uint8Array(cipherBuffer).fill(0); }
}

/** Structurally validates the complete fixed header before KDF and returns only privately owned decoded buffers. */
export async function decryptPortableGroupBackup(inputBytes: Uint8Array, passwordInput: Uint8Array): Promise<ParsedPortableGroupBackup | null> {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength < 63 || inputBytes.byteLength > PORTABLE_MAX_CONTAINER_BYTES
    || !(passwordInput instanceof Uint8Array) || passwordInput.byteLength < 12 || passwordInput.byteLength > 1024) return null;
  const bytes = inputBytes.slice(); const password = passwordInput.slice();
  let salt: Uint8Array | null = null; let iv: Uint8Array | null = null; let aad: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null; let cipherBuffer: ArrayBuffer | null = null;
  try {
    let p = 0; for (const value of MAGIC_V2) if (bytes[p++] !== value) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const iterations = view.getUint32(p, false); p += 4;
    const saltLength = view.getUint16(p, false); p += 2;
    if (iterations < BACKUP_ITERATIONS || iterations > BACKUP_MAX_ITERATIONS || saltLength !== 16) return null;
    salt = bytes.slice(p, p + 16); p += 16;
    const ivLength = bytes[p++]!; if (ivLength !== 12) return null;
    iv = bytes.slice(p, p + 12); p += 12;
    const cipherLength = view.getUint32(p, false); p += 4;
    if (p !== 47 || cipherLength < 16 || cipherLength > PORTABLE_MAX_PLAINTEXT_BYTES + 16 || p + cipherLength !== bytes.length) return null;
    const prefix = encoder.encode(PORTABLE_DOMAIN); aad = new Uint8Array(prefix.length + 47); aad.set(prefix); aad.set(bytes.slice(0, 47), prefix.length); prefix.fill(0);
    const key = await derive(password, salt, iterations); cipherBuffer = ab(bytes.slice(47));
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv), additionalData: ab(aad), tagLength: 128 }, key, cipherBuffer));
    if (plaintext.byteLength > PORTABLE_MAX_PLAINTEXT_BYTES) return null;
    const parsed: unknown = JSON.parse(decoder.decode(plaintext));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const payload = parsed as PortableGroupBackup;
    const canonical = portablePlaintext(payload);
    if (!canonical || canonical.length !== plaintext.length || !canonical.every((value, index) => value === plaintext![index])) { canonical?.fill(0); return null; }
    canonical.fill(0);
    const epochKey = base64urlBytes(payload.epochKeyB64url, 32); const signerPublicKey = base64urlBytes(payload.receipt.signerPublicKeyB64url, 32);
    if (!epochKey || !signerPublicKey) { epochKey?.fill(0); signerPublicKey?.fill(0); return null; }
    return { payload, epochKey, signerPublicKey };
  } catch { return null; }
  finally { bytes.fill(0); password.fill(0); salt?.fill(0); iv?.fill(0); aad?.fill(0); plaintext?.fill(0); if (cipherBuffer) new Uint8Array(cipherBuffer).fill(0); }
}
