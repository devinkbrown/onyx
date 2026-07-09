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

import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import type { ChatMessage, ChannelUser } from '@/lib/irc/types';
import { followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
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
  topic?: string | null,
): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date('2025-01-01T12:00:00Z'),
    type: 'msg',
    target,
    ...(topic !== undefined ? { topic } : {}),
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
    for (const key of followed()) unfollow(key);
    localStorage.clear();
    resetPreferences();
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
    it('reflects OS accessibility media signals on the root element', () => {
      seedStore('#general');

      render(() => <AppShell />);

      expect(document.documentElement.dataset.prefersReducedMotion).toBe('false');
      expect(document.documentElement.dataset.prefersMoreContrast).toBe('false');
      expect(document.documentElement.dataset.prefersReducedTransparency).toBe('false');
      expect(document.documentElement.dataset.forcedColors).toBe('false');
    });

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

    it('makes message rows keyboard traversable and revealable', () => {
      seedStore('#general');

      render(() => <AppShell />);

      const rows = screen.getAllByRole('article', { name: / at .*:/ });
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const firstRow = rows[0];
      if (!firstRow) throw new Error('expected at least one message row');
      expect(firstRow).toHaveAttribute('tabindex', '0');
      expect(firstRow).toHaveAccessibleName(/alice at .*Hello world/);

      firstRow.focus();
      expect(document.activeElement).toBe(firstRow);

      fireEvent.keyDown(firstRow, { key: 'Enter' });
      expect(firstRow).toHaveClass('shell-msg-revealed');
      expect(within(firstRow).getByRole('group', { name: 'Actions for message from alice' })).toBeInTheDocument();

      fireEvent.keyDown(firstRow, { key: ' ' });
      expect(firstRow).not.toHaveClass('shell-msg-revealed');
    });

    it('filters channel messages by named conversation topic', () => {
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-topic-a', 'alice', 'Roadmap item', '#general', 'roadmap'),
          makeMessage('msg-topic-b', 'bob', 'Release item', '#general', 'release'),
          makeMessage('msg-loose', 'carol', 'Loose note', '#general', null),
        ],
        [makeUser('alice'), makeUser('bob'), makeUser('carol')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        viewUnreadDividerId: new Map([['#general', 'msg-topic-b']]),
      }, true);

      render(() => <AppShell />);

      expect(screen.getByText('Roadmap item')).toBeInTheDocument();
      expect(screen.getByText('Release item')).toBeInTheDocument();
      expect(screen.getByLabelText('1 unread')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /roadmap/i }));

      expect(screen.getByText('Roadmap item')).toBeInTheDocument();
      expect(screen.queryByText('Release item')).not.toBeInTheDocument();
      expect(screen.queryByText('Loose note')).not.toBeInTheDocument();
      expect(screen.getByText('#roadmap')).toBeInTheDocument();
      expect(store.getState().activeChannelTopics.get('#general')).toBe('roadmap');

      fireEvent.click(screen.getByRole('button', { name: 'Clear topic roadmap' }));

      expect(store.getState().activeChannelTopics.has('#general')).toBe(false);
    });

    it('starts a new named conversation before the first message', () => {
      seedStore('#general');

      render(() => <AppShell />);

      fireEvent.input(screen.getByLabelText('New topic'), { target: { value: 'incident' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start topic' }));

      expect(store.getState().activeChannelTopics.get('#general')).toBe('incident');
      expect(screen.getByText('#incident')).toBeInTheDocument();
    });

    it('projects named conversations into a browsable forum view', () => {
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-topic-a', 'alice', 'Roadmap item', '#general', 'roadmap'),
          makeMessage('msg-topic-b', 'bob', 'Another roadmap item', '#general', 'roadmap'),
          makeMessage('msg-topic-c', 'carol', 'Release item', '#general', 'release'),
        ],
        [makeUser('alice'), makeUser('bob'), makeUser('carol')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      render(() => <AppShell />);

      fireEvent.click(screen.getByRole('button', { name: 'Forum' }));

      const forum = screen.getByLabelText('Topic forum');
      expect(forum).toBeInTheDocument();
      expect(within(forum).getByText('2 messages')).toBeInTheDocument();
      expect(within(forum).getByText('Another roadmap item')).toBeInTheDocument();

      fireEvent.click(within(forum).getByRole('button', { name: /#roadmap/i }));

      expect(store.getState().activeChannelTopics.get('#general')).toBe('roadmap');
      expect(screen.queryByLabelText('Topic forum')).not.toBeInTheDocument();
    });

    it('renders reactions as quiet boosts and toggles them without notifications', () => {
      const channel = makeChannel(
        '#general',
        [
          {
            ...makeMessage('boosted', 'alice', 'Worth boosting', '#general'),
            reactions: [{ emoji: '🌊', users: ['alice', 'testuser'] }],
          },
        ],
        [makeUser('alice'), makeUser('testuser')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      render(() => <AppShell />);

      const boosts = screen.getByLabelText('Boosts');
      expect(within(boosts).getByText('2')).toBeInTheDocument();

      fireEvent.click(within(boosts).getByTitle('alice, testuser'));

      expect(store.getState().notifications).toHaveLength(0);
      expect(store.getState().channels.get('#general')?.messages[0]?.reactions).toEqual([
        { emoji: '🌊', users: ['alice'] },
      ]);
    });

    it('renders a since-you-left digest from the unread boundary', () => {
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-old', 'alice', 'Old note', '#general'),
          makeMessage('msg-new-a', 'bob', 'New note one', '#general'),
          { ...makeMessage('msg-new-b', 'carol', 'New note two', '#general'), highlight: true },
        ],
        [makeUser('alice'), makeUser('bob'), makeUser('carol')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        viewUnreadDividerId: new Map([['#general', 'msg-new-a']]),
      }, true);

      render(() => <AppShell />);

      const digest = screen.getByRole('region', { name: 'Since you left' });
      expect(within(digest).getByText('Since you left')).toBeInTheDocument();
      expect(within(digest).getByText('2 messages across 1 channel · 1 mention')).toBeInTheDocument();
      expect(within(digest).getByText('Read from here: bob and carol added 2 lines.')).toBeInTheDocument();
      expect(within(digest).getByText('bob')).toBeInTheDocument();
      expect(within(digest).getByText('carol')).toBeInTheDocument();
    });

    it('shows device-memory context in reader mode', () => {
      setPreference('readerMode', true);
      setPreference('localHistory', true);
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-memory-a', 'alice', 'Old remembered note', '#general', 'roadmap'),
          makeMessage('msg-memory-b', 'bob', 'Hydrated note one', '#general', 'roadmap'),
          makeMessage('msg-memory-c', 'alice', 'Hydrated note two', '#general', 'roadmap'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      render(() => <AppShell />);

      const memory = screen.getByRole('region', { name: 'Device memory context' });
      expect(within(memory).getByText('Device memory')).toBeInTheDocument();
      expect(within(memory).getByText('#general')).toBeInTheDocument();
      expect(within(memory).getByText('3 readable lines')).toBeInTheDocument();
      expect(within(memory).getByText('2 voices')).toBeInTheDocument();
      expect(within(memory).getByText('1 topic')).toBeInTheDocument();
      expect(within(memory).getByText('alice')).toBeInTheDocument();
      expect(within(memory).getByText('bob')).toBeInTheDocument();
    });

    it('follows the room or selected topic from the topic strip', () => {
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-topic-a', 'alice', 'Roadmap item', '#general', 'roadmap'),
          makeMessage('msg-topic-b', 'bob', 'Release item', '#general', 'release'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      render(() => <AppShell />);

      fireEvent.click(screen.getByRole('button', { name: 'Follow room' }));
      expect(isFollowed('#general')).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /roadmap/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Follow roadmap' }));
      expect(isFollowed('#general', 'roadmap')).toBe(true);
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

    it('keeps the composer usable while disconnected (offline outbox)', () => {
      // Arrange — active channel present, but the connection has dropped
      seedStore('#general');
      store.setState({ connectionStatus: 'disconnected' });

      // Act
      const { container } = render(() => <AppShell />);

      // Assert — composing stays possible: text written offline queues to
      // the outbox and sends on reconnect. The placeholder says so.
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;
      expect(textarea).not.toBeDisabled();
      expect(textarea.placeholder).toContain('Offline');
      // Attachments DO need the network right now — that tool locks.
      const attach = container.querySelector('button[aria-label="Attach files"]') as HTMLButtonElement;
      expect(attach).toBeDisabled();
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
      const main = getByRole('main', { name: 'Network home' });
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
