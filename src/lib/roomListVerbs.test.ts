// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  ROOM_VERB_COPY,
  shouldReopenClosedConversation,
  shouldRevealHiddenRoom,
} from './roomListVerbs';

describe('room list verbs', () => {
  it('keeps hide and leave copy distinct and never says archive', () => {
    expect(ROOM_VERB_COPY.hide.label).toBe('Hide room');
    expect(ROOM_VERB_COPY.leave.label).toBe('Leave room');
    expect(ROOM_VERB_COPY.closeConversation.label).toBe('Close conversation');
    expect(JSON.stringify(ROOM_VERB_COPY)).not.toMatch(/archive/i);
  });

  it('reveals a hidden room only on someone else mentioning or pinging you', () => {
    expect(shouldRevealHiddenRoom({ isSelf: false, classifiedHighlight: true })).toBe(true);
    expect(shouldRevealHiddenRoom({ isSelf: false, classifiedHighlight: false })).toBe(false);
    expect(shouldRevealHiddenRoom({ isSelf: true, classifiedHighlight: true })).toBe(false);
  });

  it('reopens a closed conversation only on inbound traffic', () => {
    expect(shouldReopenClosedConversation({ isSelf: false })).toBe(true);
    expect(shouldReopenClosedConversation({ isSelf: true })).toBe(false);
  });
});
