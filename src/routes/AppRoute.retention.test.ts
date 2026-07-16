// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { getRetentionPolicy, setRetentionPolicy } from '@/lib/vault/historyVault';
import {
  RETENTION_POLICY_STORAGE_KEY,
  writeRetentionPolicy,
} from '@/lib/vault/retentionPolicy';
import { activatePersistedVaultRetention } from './AppRoute';

describe('AppRoute vault retention startup', () => {
  beforeEach(() => {
    localStorage.clear();
    setRetentionPolicy(null);
  });

  it('activates a persisted policy before the closed Preferences Sheet mounts', () => {
    expect(writeRetentionPolicy({ keep: 1000, maxAgeDays: 30 })).toBe(true);

    expect(activatePersistedVaultRetention()).toEqual({ keep: 1000, maxAgeDays: 30 });
    expect(getRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 30 });
    expect(localStorage.getItem(RETENTION_POLICY_STORAGE_KEY)).not.toBeNull();
  });
});
