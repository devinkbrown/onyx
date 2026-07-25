// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { ENVELOPE_PREFIX, LOCKED_PLACEHOLDER } from './dmCipher';
import { GROUP_ENVELOPE_PREFIX, GROUP_LOCKED_PLACEHOLDER } from './groupEnvelope';
import {
  hasEncryptedMessageBoundary,
  isEncryptedWireText,
  lockedPlaceholderForText,
  sanitizePersistedReplyPreviewText,
} from './replyPrivacy';

describe('replyPrivacy — group + DM envelope boundary', () => {
  it('detects ONYXDM1 and ONYXROOM1 as encrypted wire text', () => {
    expect(isEncryptedWireText(`${ENVELOPE_PREFIX}abc`)).toBe(true);
    expect(isEncryptedWireText(`${GROUP_ENVELOPE_PREFIX}abc`)).toBe(true);
    expect(isEncryptedWireText('ordinary chat')).toBe(false);
    expect(isEncryptedWireText('talking about ONYXROOM1 offline')).toBe(false);
  });

  it('picks the matching locked placeholder by envelope family', () => {
    expect(lockedPlaceholderForText(`${ENVELOPE_PREFIX}x`)).toBe(LOCKED_PLACEHOLDER);
    expect(lockedPlaceholderForText(`${GROUP_ENVELOPE_PREFIX}x`)).toBe(
      GROUP_LOCKED_PLACEHOLDER,
    );
  });

  it('treats group envelopes as encrypted even without the encrypted flag', () => {
    const msg = { text: `${GROUP_ENVELOPE_PREFIX}opaque`, encrypted: undefined as boolean | undefined };
    expect(hasEncryptedMessageBoundary(msg)).toBe(true);
  });

  it('sanitizes persisted reply previews for room envelopes fail-closed', () => {
    const room = `${GROUP_ENVELOPE_PREFIX}opaque-room-ciphertext`;
    expect(sanitizePersistedReplyPreviewText(room)).toBe(GROUP_LOCKED_PLACEHOLDER);
    expect(sanitizePersistedReplyPreviewText(room)).not.toContain('opaque');
    expect(sanitizePersistedReplyPreviewText('plain preview')).toBe('plain preview');
  });
});
