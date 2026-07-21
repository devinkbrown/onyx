// SPDX-License-Identifier: AGPL-3.0-or-later
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { ThreadPanel } from './MessageView';

function message(id: string, from: string, text: string, replyTo?: ChatMessage['replyTo']): ChatMessage {
  return {
    id,
    from,
    text,
    replyTo,
    time: new Date('2026-07-09T03:00:00Z'),
    type: 'msg',
    target: '#general',
  };
}

describe('ThreadPanel accessibility', () => {
  it('names the parent message and reply log for the active thread', () => {
    render(() => (
      <ThreadPanel
        parentId="m1"
        messages={[
          message('m1', 'alice', 'Parent question'),
          message('m2', 'bob', 'First reply', { id: 'm1', from: 'alice', text: 'Parent question' }),
        ]}
      />
    ));

    expect(screen.getByRole('article', { name: /Thread parent: alice at .*Parent question/ })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Thread replies to message m1' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /Thread reply: bob at .*First reply/ })).toBeInTheDocument();
  });

  it('never paints E2EE ciphertext in the thread panel body or accessible name', () => {
    const lockedParent: ChatMessage = {
      ...message('m1', 'alice', 'ONYXDM1 ciphertext-must-not-leak'),
      encrypted: true,
    };
    const lockedReply: ChatMessage = {
      ...message('m2', 'bob', 'ONYXDM1 reply-ciphertext', { id: 'm1', from: 'alice', text: 'ONYXDM1 ciphertext-must-not-leak' }),
      encrypted: true,
    };

    render(() => <ThreadPanel parentId="m1" messages={[lockedParent, lockedReply]} />);

    const parent = screen.getByRole('article', { name: /Thread parent: alice at / });
    const reply = screen.getByRole('article', { name: /Thread reply: bob at / });
    expect(parent).toHaveAccessibleName(/Encrypted message/);
    expect(reply).toHaveAccessibleName(/Encrypted message/);
    expect(parent.textContent).not.toContain('TSUMUGI1');
    expect(reply.textContent).not.toContain('TSUMUGI1');
    expect(parent.textContent).not.toContain('ciphertext-must-not-leak');
    expect(reply.textContent).not.toContain('reply-ciphertext');
  });

  it('announces deleted thread rows without the original body', () => {
    const deleted: ChatMessage = {
      ...message('m1', 'alice', 'should not be read'),
      deleted: true,
    };
    render(() => <ThreadPanel parentId="m1" messages={[deleted]} />);

    const parent = screen.getByRole('article', { name: /Thread parent: alice at / });
    expect(parent).toHaveAccessibleName(/\[message deleted\]/);
    expect(parent).toHaveTextContent('[message deleted]');
    expect(parent.textContent).not.toContain('should not be read');
  });
});
