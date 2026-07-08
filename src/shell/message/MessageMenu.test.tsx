/**
 * MessageMenu.test.tsx — unit tests for the pure capability-gating helper that
 * decides which per-message actions (React/Reply/Copy/Edit/Delete) apply.
 *
 * AAA pattern; descriptive names. The component itself is exercised by the
 * shell integration tests and e2e; here we pin the gating rules in isolation.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { MessageMenu, messageMenuCapabilities, suggestTopicLabelFromMessage, type CapabilityInput } from './MessageMenu';

const initialState = store.getInitialState();

beforeEach(() => {
  cleanup();
  store.setState(initialState, true);
});

function input(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  const { msg: msgOverride, ...rest } = overrides;
  return {
    selfNick: 'alice',
    editingEnabled: true,
    deleteSupported: true,
    channelTarget: true,
    ...rest,
    msg: {
      from: 'alice',
      text: 'hello world',
      type: 'msg',
      deleted: false,
      redacted: false,
      ...(msgOverride ?? {}),
    },
  };
}

describe('messageMenuCapabilities', () => {
  it('allows every action for the user’s own live text message', () => {
    // Arrange
    const args = input();

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps).toEqual({
      canReply: true,
      canReact: true,
      canCopy: true,
      canStartTopic: true,
      canEdit: true,
      canDelete: true,
    });
  });

  it('disables edit and delete on someone else’s message but keeps reply/react/copy', () => {
    // Arrange
    const args = input({ selfNick: 'bob' });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReply).toBe(true);
    expect(caps.canReact).toBe(true);
    expect(caps.canCopy).toBe(true);
    expect(caps.canStartTopic).toBe(true);
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('disables every live-message action once a message is deleted', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: '[deleted]', type: 'msg', deleted: true } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReply).toBe(false);
    expect(caps.canReact).toBe(false);
    expect(caps.canCopy).toBe(false);
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('treats a redacted message the same as a deleted one', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: 'gone', type: 'msg', redacted: true } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReact).toBe(false);
    expect(caps.canStartTopic).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('forbids editing non-text messages (e.g. /me actions) even when owned', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: 'waves', type: 'action' } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(false);
    // ...but reply/react/copy/delete still apply to an own action line
    expect(caps.canReply).toBe(true);
    expect(caps.canDelete).toBe(true);
  });

  it('forbids editing when the server/account disables editing', () => {
    // Arrange
    const args = input({ editingEnabled: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(true);
  });

  it('forbids deleting when the store offers no redaction action', () => {
    // Arrange
    const args = input({ deleteSupported: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canDelete).toBe(false);
    expect(caps.canEdit).toBe(true);
  });

  it('forbids copy when there is no real text (whitespace only)', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: '   ', type: 'msg' } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canCopy).toBe(false);
    // reply/react still allowed on a live message
    expect(caps.canReply).toBe(true);
  });

  it('does not offer topic starts for direct messages', () => {
    // Arrange
    const args = input({ channelTarget: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canStartTopic).toBe(false);
    expect(caps.canReply).toBe(true);
  });

  it('matches nicks case-insensitively when deciding ownership', () => {
    // Arrange
    const args = input({ msg: { from: 'Alice', text: 'hi', type: 'msg' }, selfNick: 'alice' });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(true);
    expect(caps.canDelete).toBe(true);
  });
});

describe('suggestTopicLabelFromMessage', () => {
  it('uses the first meaningful words from a message', () => {
    expect(suggestTopicLabelFromMessage('Release blockers for mobile onboarding today')).toBe(
      'Release blockers for mobile onboarding today',
    );
  });

  it('strips markdown markers, links, and trailing punctuation', () => {
    expect(suggestTopicLabelFromMessage('## `Deploy notes`: https://example.test/build')).toBe('Deploy notes');
  });

  it('shrinks long messages to a valid topic label', () => {
    expect(suggestTopicLabelFromMessage('This is a very long incident investigation with many extra words')).toBe(
      'This is a very long incident',
    );
  });

  it('returns null when no usable label remains', () => {
    expect(suggestTopicLabelFromMessage('https://example.test')).toBeNull();
  });
});

describe('<MessageMenu>', () => {
  it('starts a named conversation from a channel message', () => {
    const msg: ChatMessage = {
      id: 'm-topic',
      from: 'alice',
      text: 'Release blockers for mobile onboarding today',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="bob"
        canEdit={false}
        menuOpen
      />
    ));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Start topic from here' }));

    expect(store.getState().activeChannelTopics.get('#general')).toBe('Release blockers for mobile onboarding today');
    expect(store.getState().replyingTo).toMatchObject({ id: 'm-topic', from: 'alice' });
  });
});
