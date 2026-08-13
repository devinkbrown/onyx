// SPDX-License-Identifier: AGPL-3.0-or-later
/** Projection of the two existing non-extractable device identities into ODD1. */
import { deviceSigningKeys, type DeviceSigningKeys } from './deviceSign';
import { deviceKeys, fromB64url, type DeviceKeys } from './dmCipher';
import {
  deriveGroupDeviceId,
  encodeGroupDeviceDirectoryEntry,
  type GroupDeviceDirectoryEntry,
} from './groupDeviceDirectory';

export type GroupDeviceIdentity = Readonly<{
  deviceId: string;
  directory: string;
  entry: GroupDeviceDirectoryEntry;
}>;

export type GroupDeviceIdentityDependencies = Readonly<{
  signingKeys: () => Promise<DeviceSigningKeys | null>;
  dmKeys: () => Promise<DeviceKeys | null>;
}>;

const defaultDependencies: GroupDeviceIdentityDependencies = {
  signingKeys: deviceSigningKeys,
  dmKeys: deviceKeys,
};

/**
 * Produces a public directory projection only. This module never generates or
 * stores a keypair: a missing identity is an unavailable identity, not a cue
 * to mint a third private identity.
 */
export async function projectGroupDeviceIdentity(
  dependencies: GroupDeviceIdentityDependencies = defaultDependencies,
): Promise<GroupDeviceIdentity | null> {
  try {
    const [signing, dm] = await Promise.all([dependencies.signingKeys(), dependencies.dmKeys()]);
    if (!signing || !dm) return null;
    const encryptionPub = fromB64url(dm.publicB64);
    if (!encryptionPub) return null;
    const entry = { signerPub: new Uint8Array(signing.publicRaw), encryptionPub: new Uint8Array(encryptionPub) };
    const directory = encodeGroupDeviceDirectoryEntry(entry);
    if (!directory) return null;
    const deviceId = await deriveGroupDeviceId(entry);
    return deviceId ? { deviceId, directory, entry } : null;
  } catch {
    return null;
  }
}
