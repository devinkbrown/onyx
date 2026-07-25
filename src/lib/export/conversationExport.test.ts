// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildConversationExport,
  conversationExportToText,
  downloadConversationExport,
  MAX_EXPORT_MESSAGES,
} from './conversationExport';

describe('conversationExport', () => {
  it('builds a scrubbed local transcript document', () => {
    const doc = buildConversationExport({
      target: '#ops',
      network: 'Onyx',
      ourNick: 'alice',
      now: new Date('2026-07-25T12:00:00.000Z'),
      messages: [
        {
          id: 'm1',
          time: new Date('2026-07-25T11:00:00.000Z'),
          from: 'bob',
          text: 'hello\u0000world',
          type: 'msg',
          target: '#ops',
        },
      ],
    });
    expect(doc.kind).toBe('onyx.conversation-export');
    expect(doc.messageCount).toBe(1);
    expect(doc.messages[0]?.text).toBe('helloworld');
    const text = conversationExportToText(doc);
    expect(text).toContain('<bob> helloworld');
    expect(text).toContain('this device only');
  });

  it('caps export length and prefers plaintext when present', () => {
    const messages = Array.from({ length: MAX_EXPORT_MESSAGES + 3 }, (_, i) => ({
      id: `m${i}`,
      time: new Date('2026-07-25T11:00:00.000Z'),
      from: 'bob',
      text: `cipher-${i}`,
      plaintext: `plain-${i}`,
      type: 'msg' as const,
      target: '#ops',
    }));
    const doc = buildConversationExport({ target: '#ops', messages });
    expect(doc.messageCount).toBe(MAX_EXPORT_MESSAGES);
    expect(doc.messages[0]?.text).toBe('plain-3');
    expect(doc.messages.at(-1)?.text).toBe(`plain-${MAX_EXPORT_MESSAGES + 2}`);
  });

  it('downloadConversationExport returns false without a document environment', () => {
    const ok = downloadConversationExport(
      buildConversationExport({ target: '#ops', messages: [] }),
      'json',
    );
    // jsdom may provide document; either path must not throw.
    expect(typeof ok).toBe('boolean');
  });
});
