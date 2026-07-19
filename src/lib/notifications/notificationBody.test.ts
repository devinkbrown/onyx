// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { ENVELOPE_PREFIX } from '@/lib/e2ee/dmCipher';

import {
  ENCRYPTED_NOTIFICATION_BODY,
  notificationBodyFor,
} from './notificationBody';

describe('notificationBodyFor', () => {
  it('returns plaintext bodies unchanged when short enough', () => {
    expect(notificationBodyFor('hello from alice')).toBe('hello from alice');
  });

  it('truncates long plaintext at 180 characters with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const body = notificationBodyFor(long);
    expect(body).toHaveLength(180);
    expect(body.endsWith('...')).toBe(true);
    expect(body.startsWith('x'.repeat(177))).toBe(true);
  });

  it('fail-closes an E2EE envelope to a neutral body (never leaks ciphertext)', () => {
    const envelope = `${ENVELOPE_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(notificationBodyFor(envelope)).toBe(ENCRYPTED_NOTIFICATION_BODY);
    expect(notificationBodyFor(envelope)).not.toContain(ENVELOPE_PREFIX.trim());
    expect(notificationBodyFor(envelope)).not.toContain('AAAA');
  });

  it('does not treat ordinary text that merely mentions the prefix word as an envelope', () => {
    // isEnvelope requires the exact "TSUMUGI1 " wire prefix at the start.
    expect(notificationBodyFor('talking about TSUMUGI1 offline')).toBe(
      'talking about TSUMUGI1 offline',
    );
  });

  it('fail-closes even when the envelope is shorter than the display truncate limit', () => {
    const shortEnvelope = `${ENVELOPE_PREFIX}abc`;
    expect(notificationBodyFor(shortEnvelope)).toBe(ENCRYPTED_NOTIFICATION_BODY);
  });
});
