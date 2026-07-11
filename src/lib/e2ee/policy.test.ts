// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  E2EE_TAG,
  e2eeDevicePropKey,
  e2eeDeviceValue,
  e2eeMessageTag,
  parseE2eeDeviceValue,
  parseE2eeMessageTag,
  parseEncryptionPolicy,
} from './policy';

describe('Orochi E2EE policy helpers', () => {
  it('parses channel encryption policy values defensively', () => {
    expect(parseEncryptionPolicy('required')).toBe('required');
    expect(parseEncryptionPolicy(' OPTIONAL ')).toBe('optional');
    expect(parseEncryptionPolicy('mandatory')).toBe('off');
    expect(parseEncryptionPolicy('')).toBe('off');
  });

  it('builds and parses encrypted-message tags', () => {
    expect(e2eeMessageTag()).toEqual({ [E2EE_TAG]: 'mls' });
    expect(parseE2eeMessageTag({ [E2EE_TAG]: '1' })).toBe('generic');
    expect(parseE2eeMessageTag({ [E2EE_TAG]: 'sframe' })).toBe('sframe');
    expect(parseE2eeMessageTag({ [E2EE_TAG.slice(1)]: 'mls' })).toBe('mls');
    expect(parseE2eeMessageTag({ [E2EE_TAG]: '0' })).toBeNull();
  });

  it('validates E2EE device prop keys and values', () => {
    expect(e2eeDevicePropKey('phone-1')).toBe('e2ee.device.phone-1');
    expect(e2eeDevicePropKey('bad device')).toBeNull();
    expect(e2eeDeviceValue('mls-x25519', 'abcd+/=')).toBe('mls-x25519:abcd+/=');
    expect(e2eeDeviceValue('bad alg!', 'abcd')).toBeNull();
    expect(parseE2eeDeviceValue('mls-x25519:abcd+/=')).toEqual({
      algorithm: 'mls-x25519',
      publicKey: 'abcd+/=',
    });
    expect(parseE2eeDeviceValue('mls-x25519')).toBeNull();
  });
});
