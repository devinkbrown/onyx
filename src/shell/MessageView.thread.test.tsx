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

    expect(screen.getByRole('article', { name: 'Thread parent from alice' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Thread replies to message m1' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Thread reply from bob' })).toBeInTheDocument();
  });
});
