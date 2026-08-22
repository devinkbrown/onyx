// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  loadPersonReportReceipts,
  PERSON_REPORT_RECEIPTS_KEY,
  savePersonReportReceipt,
} from './personReportReceipt';

const alice = { serverUrl: 'wss://report.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://report.example/ws', identity: 'bob' } as const;

describe('person report receipts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps receipts on this device and isolates owners', () => {
    expect(savePersonReportReceipt({
      nick: 'eve',
      reason: 'spam',
      draft: 'Report\nAbout: eve\nWhat: spam',
    }, alice)).not.toBeNull();
    expect(savePersonReportReceipt({
      nick: 'mallory',
      reason: 'harassment',
      draft: 'Report\nAbout: mallory\nWhat: harassment',
    }, bob)).not.toBeNull();

    expect(loadPersonReportReceipts(alice).map((row) => row.nick)).toEqual(['eve']);
    expect(loadPersonReportReceipts(bob).map((row) => row.nick)).toEqual(['mallory']);
    expect(localStorage.getItem(PERSON_REPORT_RECEIPTS_KEY)).toBeNull();
    expect(deviceMemoryStorageKey(PERSON_REPORT_RECEIPTS_KEY, alice)).toMatch(/onyx:person-report-receipts/);
  });

  it('fails closed without an owner', () => {
    expect(savePersonReportReceipt({
      nick: 'eve',
      reason: 'other',
      draft: 'Report\nAbout: eve',
    })).toBeNull();
    expect(loadPersonReportReceipts()).toEqual([]);
  });
});
