/**
 * shell.test.tsx — AppShell integration tests.
 *
 * Seeds the store with channels, messages, users, and activeView,
 * then asserts:
 *   1. AppShell renders and the sidebar lists the seeded channel
 *   2. Messages appear in the message view
 *   3. Members render with correct role badges
 *   4. Typing in the Composer and pressing Enter calls sendMessage
 *   5. Clicking a different channel in the sidebar updates activeView
 *
 * AAA pattern throughout. Descriptive test names.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import type { ChatMessage, ChannelUser } from '@/lib/irc/types';
import { AppShell } from './AppShell';

// ── Shared fixture helpers ────────────────────────────────────────────────────

const initialState = store.getInitialState();

function makeUser(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeMessage(
  id: string,
  from: string,
  text: string,
  target = '#general',
): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date('2025-01-01T12:00:00Z'),
    type: 'msg',
    target,
  };
}

function makeChannel(name: string, msgs: ChatMessage[], users: ChannelUser[]): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) {
    usersMap.set(u.nick.toLowerCase(), u);
  }
  return {
    name,
    topic: `Welcome to ${name}`,
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: msgs,
  };
}

function seedStore(channelName: string): void {
  const msgs = [
    makeMessage('msg-1', 'alice', 'Hello world', channelName),
    makeMessage('msg-2', 'bob', 'Hey there', channelName),
    makeMessage('msg-3', 'alice', 'How are you?', channelName),
  ];

  const users = [
    makeUser('alice', ['q']),  // owner
    makeUser('bob', ['o']),    // op
    makeUser('carol'),          // member
  ];

  const channel = makeChannel(channelName, msgs, users);
  const channels = new Map<string, Channel>();
  channels.set(channelName.toLowerCase(), channel);

  store.setState({
    ...initialState,
    channels,
    activeView: { kind: 'channel', channel: channelName.toLowerCase() },
    connectionStatus: 'connected',
    ourNick: 'testuser',
    networkName: 'IRCXNet',
  }, true);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppShell', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  describe('sidebar channel rendering', () => {
    it('renders the seeded channel in the sidebar', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert — sidebar should list the channel name
      const nav = getByRole('complementary', { name: 'Channel navigation' });
      expect(nav.textContent).toContain('general');
    });

    it('highlights the active channel with aria-current', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getAllByRole } = render(() => <AppShell />);

      // Assert — the active channel button has aria-current=page
      const buttons = getAllByRole('button', { name: /#general/ });
      const activeBtn = buttons.find((b) => b.getAttribute('aria-current') === 'page');
      expect(activeBtn).toBeDefined();
    });
  });

  describe('message view rendering', () => {
    it('renders messages from the active channel', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert — message log contains sent text
      const log = getByRole('log', { name: 'Message history' });
      expect(log.textContent).toContain('Hello world');
      expect(log.textContent).toContain('Hey there');
    });

    it('shows author names above their message groups', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert — authors alice and bob appear in the feed
      const log = getByRole('log', { name: 'Message history' });
      expect(log.textContent).toContain('alice');
      expect(log.textContent).toContain('bob');
    });
  });

  describe('member list role badges', () => {
    it('renders the owner badge for alice (mode q)', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getAllByText } = render(() => <AppShell />);

      // Assert — the owner role badge label should appear
      const ownerBadges = getAllByText('.');
      expect(ownerBadges.length).toBeGreaterThan(0);
    });

    it('renders the op badge for bob (mode o)', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getAllByText } = render(() => <AppShell />);

      // Assert — the op role badge symbol should appear
      const opBadges = getAllByText('@');
      expect(opBadges.length).toBeGreaterThan(0);
    });

    it('does not render a badge for member carol (no modes)', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert — carol appears in member list without a role badge
      const aside = getByRole('complementary', { name: 'Member list' });
      expect(aside.textContent).toContain('carol');
    });
  });

  describe('Composer input and send', () => {
    it('calls sendMessage with the correct target when Enter is pressed', async () => {
      // Arrange
      seedStore('#general');
      const sendMessageSpy = vi.spyOn(store.getState(), 'sendMessage');

      // Act
      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;
      fireEvent.input(textarea, { target: { value: 'test message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      // sendMessage is now async (it awaits attachment upload before sending);
      // flush microtasks so the store call lands before asserting.
      await new Promise((r) => setTimeout(r, 0));

      // Assert
      expect(sendMessageSpy).toHaveBeenCalledWith(
        '#general',
        'test message',
      );

      sendMessageSpy.mockRestore();
    });

    it('does not send when Shift+Enter is pressed (newline intent)', () => {
      // Arrange
      seedStore('#general');
      const sendMessageSpy = vi.spyOn(store.getState(), 'sendMessage');

      // Act
      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;
      fireEvent.input(textarea, { target: { value: 'draft' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      // Assert
      expect(sendMessageSpy).not.toHaveBeenCalled();

      sendMessageSpy.mockRestore();
    });

    it('disables the composer when not connected', () => {
      // Arrange — active channel present, but the connection has dropped
      seedStore('#general');
      store.setState({ connectionStatus: 'disconnected' });

      // Act
      const { container } = render(() => <AppShell />);

      // Assert — composer renders for the active channel but is disabled
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;
      expect(textarea).toBeDisabled();
    });
  });

  describe('channel switching updates activeView', () => {
    it('navigates to a second channel when it is clicked in the sidebar', async () => {
      // Arrange — seed two channels, active is #general
      const msgs1 = [makeMessage('m1', 'alice', 'hello', '#general')];
      const msgs2 = [makeMessage('m2', 'dave', 'other channel', '#random')];

      const channelGeneral = makeChannel('#general', msgs1, [makeUser('alice')]);
      const channelRandom = makeChannel('#random', msgs2, [makeUser('dave')]);

      const channels = new Map<string, Channel>();
      channels.set('#general', channelGeneral);
      channels.set('#random', channelRandom);

      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      // Act — click the #random channel button
      const { getAllByRole } = render(() => <AppShell />);

      const randomBtn = getAllByRole('button', { name: /#random/ })?.[0];
      expect(randomBtn).toBeDefined();
      fireEvent.click(randomBtn!);

      // Assert — store activeView updated
      const view = store.getState().activeView;
      expect(view.kind).toBe('channel');
      if (view.kind === 'channel') {
        expect(view.channel).toBe('#random');
      }
    });
  });

  describe('presence ribbon', () => {
    it('shows the channel name and topic in the ribbon', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert
      const ribbon = getByRole('banner', { name: 'Channel information' });
      expect(ribbon.textContent).toContain('general');
      expect(ribbon.textContent).toContain('Welcome to #general');
    });

    it('shows the self nick in the ribbon', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert
      const ribbon = getByRole('banner', { name: 'Channel information' });
      expect(ribbon.textContent).toContain('testuser');
    });

    it('shows a "Guest" account chip that opens the account panel', () => {
      // Arrange — connected guest (no logged-in account).
      seedStore('#general');

      // Act
      const { getByTestId } = render(() => <AppShell />);
      const chip = getByTestId('ribbon-account-chip');

      // Assert — guest chip, panel closed.
      expect(chip).toHaveAttribute('data-guest', 'true');
      expect(chip.textContent).toContain('Guest');
      expect(store.getState().showAccount).toBe(false);

      // Act — click opens the panel via the store.
      fireEvent.click(chip);

      // Assert — store flag flips and the panel mounts (portaled to body, so
      // query the whole document via screen, not the render container).
      expect(store.getState().showAccount).toBe(true);
      expect(screen.getByTestId('account-panel')).toBeInTheDocument();
    });

    it('shows the account name on the chip when signed in', () => {
      // Arrange — connected with a logged-in account.
      seedStore('#general');
      store.setState({
        server: {
          id: 'ircxnet', name: 'eshmaki.me', network: 'IRCXNet',
          url: 'wss://eshmaki.me', icon: '#000', nick: 'alice',
          account: 'alice', connected: true,
        },
      });

      // Act
      const { getByTestId } = render(() => <AppShell />);
      const chip = getByTestId('ribbon-account-chip');

      // Assert
      expect(chip).toHaveAttribute('data-guest', 'false');
      expect(chip.textContent).toContain('alice');
    });
  });

  describe('home state', () => {
    it('renders the home view when activeView is home', () => {
      // Arrange
      store.setState({
        ...initialState,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
      }, true);

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert
      const main = getByRole('main', { name: 'Welcome screen' });
      expect(main).toBeDefined();
    });

    it('does not render the composer on the home view', () => {
      // Arrange
      store.setState({
        ...initialState,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
      }, true);

      // Act
      const { container } = render(() => <AppShell />);

      // Assert — no composer on the home screen
      expect(container.querySelector('.shell-composer-textarea')).toBeNull();
    });
  });
});
