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
import { store } from '@/lib/store/store';

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
    expect(honesty).toMatch(/draft in the shared #root report room/i);
    expect(honesty).toMatch(/visible to people in that room or operators/i);
    expect(honesty).toMatch(/not a private inbox/i);
    expect(honesty).toMatch(/not a private inbox or police report/i);
    expect(honesty).toMatch(/nothing is sent automatically/i);
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

  it('keeps consecutive composer handoffs unique after the pending slot is consumed', () => {
    const initial = store.getState();
    try {
      store.setState({ composerDrafts: {}, composerInject: null });
      store.getState().injectComposerText('#root', 'first', 'replace');
      const first = store.getState().composerInject;
      store.setState({ composerInject: null });
      store.getState().injectComposerText('#root', 'second', 'append');
      const second = store.getState().composerInject;

      expect(first?.seq).toBeDefined();
      expect(second?.seq).toBeGreaterThan(first?.seq ?? 0);
      expect(store.getState().getComposerDraft('#root')).toBe('first second');
    } finally {
      store.setState(initial, true);
    }
  });
});
