// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  blockedDmComposeCopy,
  formatPersonReportDraft,
  isBlockedDmTarget,
  isPersonReportReason,
  personBlockBody,
  personBlockTitle,
  personReportHonesty,
  PERSON_REPORT_ROOM,
} from './personSafety';

describe('person safety policy', () => {
  it('blocks DMs to ignored nicks and leaves rooms alone', () => {
    const ignored = new Set(['trouble']);
    expect(isBlockedDmTarget('Trouble', ignored)).toBe(true);
    expect(isBlockedDmTarget('#general', ignored)).toBe(false);
    expect(isBlockedDmTarget('mira', ignored)).toBe(false);
  });

  it('uses the quiet block sentence and does not claim a network notice', () => {
    expect(personBlockTitle('bob')).toBe('Block bob?');
    expect(personBlockBody('bob')).toBe(
      'You will not see bob on this device. They are not told.',
    );
    expect(blockedDmComposeCopy('bob').description).toMatch(/Unblock them on this device/);
  });

  it('drafts an honest report to #root without inventing a review backend', () => {
    expect(PERSON_REPORT_ROOM).toBe('#root');
    expect(isPersonReportReason('harassment')).toBe(true);
    expect(isPersonReportReason('trust-center')).toBe(false);

    const draft = formatPersonReportDraft({
      nick: 'eve',
      reason: 'spam',
      note: 'posted links in #lounge',
      from: 'alice',
      guest: true,
    });
    expect(draft).toBe([
      'Report',
      'About: eve',
      'What: spam',
      'From: alice',
      'Guest: yes',
      'Note: posted links in #lounge',
    ].join('\n'));

    const honesty = personReportHonesty();
    expect(honesty).toMatch(/drafts a note to #root/i);
    expect(honesty).toMatch(/not a police report/i);
    expect(honesty).not.toMatch(/24 hours|Trust & Safety|we will review/i);
  });

  it('strips control characters from report tokens', () => {
    const draft = formatPersonReportDraft({
      nick: 'bad\nname',
      reason: 'other',
      note: 'line\u0000break',
    });
    expect(draft).not.toMatch(/\u0000/);
    expect(draft).toContain('About: badname');
    expect(draft).toContain('Note: linebreak');
  });
});
