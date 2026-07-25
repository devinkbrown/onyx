// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  encryptionPolicyBadge,
  parseEncryptionPolicy,
  withEncryptionPolicyParam,
} from './encryptionPolicyBadge';

describe('invite encryption policy badge', () => {
  it('parses and labels policies', () => {
    expect(parseEncryptionPolicy('REQUIRED')).toBe('required');
    expect(encryptionPolicyBadge('required').chip).toBe('E2EE required');
    expect(encryptionPolicyBadge('forbidden').tone).toBe('warn');
    expect(parseEncryptionPolicy('nope')).toBe('unknown');
  });

  it('annotates share URLs', () => {
    expect(withEncryptionPolicyParam('https://eshmaki.me/invite/?join=%23root', 'required')).toContain('e2ee=required');
    expect(withEncryptionPolicyParam('https://eshmaki.me/invite/', 'unknown')).toBe('https://eshmaki.me/invite/');
  });
});
