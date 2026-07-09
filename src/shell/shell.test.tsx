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

import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import type { ChatMessage, ChannelUser } from '@/lib/irc/types';
import { followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import { recordReviewHistory } from '@/lib/notifications/reviewHistory';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { _resetVaultForTests, saveMessages } from '@/lib/vault/historyVault';
import { Spotlight } from '@/chat/spotlight';
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
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

      render(() => (
        <>
          <AppShell />
          <Spotlight />
        </>
      ));

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
      const scrollIntoView = vi.fn();
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
        value: scrollIntoView,
        configurable: true,
      });
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

      fireEvent.click(within(digest).getByRole('button', { name: 'Review new messages' }));
      expect(scrollIntoView).toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: 'Since you left' })).not.toBeInTheDocument();
      expect(store.getState().viewUnreadDividerId.has('#general')).toBe(false);
    });

    it('shows device-memory context in reader mode', () => {
      const scrollIntoView = vi.fn();
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo');
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
        value: scrollIntoView,
        configurable: true,
      });
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
        viewUnreadDividerId: new Map([['#general', 'msg-memory-b']]),
      }, true);
      recordReviewHistory({
        target: '#general',
        name: '#general',
        kind: 'channel',
        firstMessageId: 'msg-memory-b',
        firstAt: '2025-01-01T12:00:00.000Z',
        reviewedAt: '2026-07-09T00:05:00.000Z',
        messageCount: 2,
        mentionCount: 1,
        preview: 'Hydrated note one',
      });

      render(() => <AppShell />);

      const memory = screen.getByRole('region', { name: 'Device memory context' });
      expect(within(memory).getByText('Device memory')).toBeInTheDocument();
      expect(within(memory).getByText('#general')).toBeInTheDocument();
      expect(within(memory).getByText('3 readable lines')).toBeInTheDocument();
      expect(within(memory).getByText('2 voices')).toBeInTheDocument();
      expect(within(memory).getByText('1 topic')).toBeInTheDocument();
      const voices = within(memory).getByLabelText('Remembered voices');
      expect(within(voices).getByText('alice')).toBeInTheDocument();
      expect(within(voices).getByText('bob')).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Start' })).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'New' })).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Latest' })).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Home' })).toBeInTheDocument();
      expect(within(memory).getByRole('group', { name: 'Reviewed catch-up span' })).toBeInTheDocument();
      expect(within(memory).getByText('Reviewed span')).toBeInTheDocument();
      expect(within(memory).getByText('2 lines, 1 mention', { exact: false })).toBeInTheDocument();
      expect(within(memory).getByText('Hydrated note one')).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Jump to reviewed span for #general' })).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Search reviewed text for #general' })).toBeInTheDocument();
      expect(within(memory).getByRole('group', { name: 'Reviewed context trail' })).toBeInTheDocument();
      expect(within(memory).getByText('Context trail')).toBeInTheDocument();
      expect(within(memory).getByText('Old remembered note')).toBeInTheDocument();
      expect(within(memory).getByText('Hydrated note two')).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Jump to before reviewed context' })).toBeInTheDocument();
      expect(within(memory).getByRole('button', { name: 'Jump to after reviewed context' })).toBeInTheDocument();

      fireEvent.click(within(memory).getByRole('button', { name: 'Start' }));
      expect(scrollIntoView).toHaveBeenCalled();

      fireEvent.click(within(memory).getByRole('button', { name: 'Jump to before reviewed context' }));
      expect(store.getState().timeTravelLandingId).toBe('msg-memory-a');

      fireEvent.click(within(memory).getByRole('button', { name: 'Jump to after reviewed context' }));
      expect(store.getState().timeTravelLandingId).toBe('msg-memory-c');

      fireEvent.click(within(memory).getByRole('button', { name: 'Jump to reviewed span for #general' }));
      expect(store.getState().timeTravelLandingId).toBe('msg-memory-b');
      expect(travelToSpy).toHaveBeenCalledWith('#general', new Date('2025-01-01T12:00:00.000Z'));

      fireEvent.click(within(memory).getByRole('button', { name: 'Search reviewed text for #general' }));
      expect(screen.getByRole('search', { name: 'Message search' })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('Hydrated note one');

      fireEvent.click(within(memory).getByRole('button', { name: 'Home' }));
      expect(store.getState().activeView).toEqual({ kind: 'home' });
      travelToSpy.mockRestore();
    });

    it('hydrates vault-only reviewed anchors before jumping in reader mode', async () => {
      setPreference('readerMode', true);
      setPreference('localHistory', true);
      const vaultMessages = [
        makeMessage('msg-memory-a', 'alice', 'Saved line before the anchor', '#general'),
        makeMessage('msg-memory-b', 'bob', 'Saved reviewed anchor', '#general'),
        makeMessage('msg-memory-c', 'carol', 'Visible live tail', '#general'),
      ];
      await saveMessages('#general', vaultMessages);
      const channel = makeChannel(
        '#general',
        [makeMessage('msg-memory-c', 'carol', 'Visible live tail', '#general')],
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
      recordReviewHistory({
        target: '#general',
        name: '#general',
        kind: 'channel',
        firstMessageId: 'msg-memory-b',
        firstAt: '2025-01-01T12:00:00.000Z',
        reviewedAt: '2026-07-09T00:05:00.000Z',
        messageCount: 1,
        mentionCount: 0,
        preview: 'Saved reviewed anchor',
      });

      render(() => <AppShell />);

      const memory = screen.getByRole('region', { name: 'Device memory context' });
      expect(await within(memory).findByText('saved on device')).toBeInTheDocument();
      expect(within(memory).getByText('Saved line before the anchor')).toBeInTheDocument();
      expect(within(memory).getByRole('button', {
        name: 'Load reviewed span from device memory for #general',
      })).toBeInTheDocument();

      fireEvent.click(within(memory).getByRole('button', {
        name: 'Load reviewed span from device memory for #general',
      }));

      await waitFor(() => {
        expect(store.getState().channels.get('#general')?.messages.map((message) => message.id))
          .toContain('msg-memory-b');
        expect(store.getState().timeTravelLandingId).toBe('msg-memory-b');
      });
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
      const aside = getByRole('complementary', { name: 'Member list for #general' });
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

    it('exposes Home in the mobile navigation', () => {
      seedStore('#general');

      render(() => <AppShell />);

      fireEvent.click(screen.getByRole('button', { name: 'Open Home' }));
      expect(store.getState().activeView).toEqual({ kind: 'home' });
      expect(screen.getByRole('button', { name: 'Open Home' })).toHaveAttribute('aria-current', 'page');
    });

    it('summarizes unread home recaps and hands them to Spotlight', async () => {
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo');
      const channel = {
        ...makeChannel(
          '#general',
          [
            makeMessage('msg-old', 'alice', 'Old note', '#general'),
            makeMessage('msg-new-a', 'bob', 'New handoff note one', '#general'),
            { ...makeMessage('msg-new-b', 'carol', 'New handoff note two', '#general'), highlight: true },
          ],
          [makeUser('alice'), makeUser('bob'), makeUser('carol')],
        ),
        unread: 2,
        highlights: 1,
      };
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        networkName: 'IRCXNet',
        channelLastActivity: new Map([['#general', new Date('2025-01-01T12:02:00Z').getTime()]]),
      }, true);

      render(() => (
        <>
          <AppShell />
          <Spotlight />
        </>
      ));

      const recaps = screen.getByRole('list', { name: 'Since you left recaps' });
      expect(within(recaps).getByText('#general')).toBeInTheDocument();
      expect(within(recaps).getByText('2 lines, 1 mention')).toBeInTheDocument();
      expect(within(recaps).getByText('bob, carol')).toBeInTheDocument();
      expect(within(recaps).getByText('New handoff note two')).toBeInTheDocument();
      expect(within(recaps).getAllByRole('listitem')).toHaveLength(1);

      fireEvent.click(within(recaps).getByRole('button', { name: 'Find related actions for #general' }));

      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('goto #general');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close spotlight' }));

      fireEvent.click(within(recaps).getByRole('button', { name: 'Review #general from first unread line' }));
      const activeView = store.getState().activeView;
      expect(activeView.kind).toBe('channel');
      if (activeView.kind === 'channel') expect(activeView.channel).toBe('#general');
      expect(store.getState().timeTravelLandingId).toBe('msg-new-a');
      expect(travelToSpy).toHaveBeenCalledWith('#general', new Date('2025-01-01T12:00:00Z'));

      store.getState().navigate({ kind: 'home' });

      const reviewHistory = await screen.findByLabelText('Recent catch-up reviews');
      const reviewCards = screen.getByRole('list', { name: 'Recent catch-up review cards' });
      expect(within(reviewHistory).getByText('Reviewed recently')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('#general')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('2 lines, 1 mention')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('New handoff note two')).toBeInTheDocument();
      expect(within(reviewCards).getAllByRole('listitem')).toHaveLength(1);

      fireEvent.click(within(reviewHistory).getByRole('button', {
        name: 'Find related actions for reviewed #general',
      }));
      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('goto #general');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close spotlight' }));

      fireEvent.click(within(reviewHistory).getByRole('button', {
        name: 'Reopen reviewed catch-up for #general',
      }));
      const reopenedView = store.getState().activeView;
      expect(reopenedView.kind).toBe('channel');
      if (reopenedView.kind === 'channel') expect(reopenedView.channel).toBe('#general');
      expect(store.getState().timeTravelLandingId).toBe('msg-new-a');
      expect(travelToSpy).toHaveBeenCalledTimes(2);
      expect(travelToSpy).toHaveBeenLastCalledWith('#general', new Date('2025-01-01T12:00:00Z'));

      store.getState().navigate({ kind: 'home' });
      const reviewHistoryAgain = await screen.findByLabelText('Recent catch-up reviews');
      fireEvent.click(within(reviewHistoryAgain).getByRole('button', {
        name: 'Search reviewed text for #general',
      }));
      await waitFor(() => {
        expect(screen.getByRole('search', { name: 'Message search' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('New handoff note two');
      });
      const searchedView = store.getState().activeView;
      expect(searchedView.kind).toBe('channel');
      if (searchedView.kind === 'channel') expect(searchedView.channel).toBe('#general');

      travelToSpy.mockRestore();
    });

    it('shows joined-room chanstats rhythm with scheduled event context', async () => {
      const eventAt = Math.floor(Date.now() / 1000) + 3600;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        generated_at: Math.floor(Date.now() / 1000),
        network: 'IRCXNet',
        node: 'eshmaki.me',
        users_online: 8,
        network_days: [],
        channels: [
          {
            channel: '#general',
            messages: 42,
            active_users: 2,
            present: 3,
            last_active: Math.floor(Date.now() / 1000) - 120,
            topic: 'Planning call',
            spark: [0, 2, 4, 1, 8, 3],
          },
          {
            channel: '#outside',
            messages: 99,
            active_users: 4,
            present: 5,
            last_active: Math.floor(Date.now() / 1000),
            topic: 'Not joined',
            spark: [9, 9, 9],
          },
        ],
      }), { status: 200 })));
      const channels = new Map<string, Channel>();
      channels.set('#general', makeChannel('#general', [makeMessage('m1', 'alice', 'hello', '#general')], [makeUser('alice')]));
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        networkName: 'IRCXNet',
        channelProps: new Map([['#general', { 'ocean.event': `${eventAt}|Office hours` }]]),
      }, true);
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

      render(() => <AppShell />);

      const rhythm = await screen.findByLabelText('Room rhythm');
      const directory = screen.getByRole('list', { name: 'Active channel directory' });
      expect(within(directory).getAllByRole('listitem')).toHaveLength(2);
      expect(within(rhythm).getByText('#general')).toBeInTheDocument();
      expect(within(rhythm).getByText('2 chatting')).toBeInTheDocument();
      expect(within(rhythm).getByText('Planning call')).toBeInTheDocument();
      expect(within(rhythm).getByText('Office hours')).toBeInTheDocument();
      expect(within(rhythm).queryByText('#outside')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Open #general for Office hours/i }));
      expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
      expect(travelToSpy).toHaveBeenLastCalledWith('#general', new Date(eventAt * 1000));

      store.getState().navigate({ kind: 'home' });
      const nextRhythm = await screen.findByLabelText('Room rhythm');
      fireEvent.click(within(nextRhythm).getByRole('button', { name: /Open #general, 2 chatting/i }));
      expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
      expect(travelToSpy).toHaveBeenLastCalledWith('#general', new Date(eventAt * 1000));
      travelToSpy.mockRestore();
    });

    it('collects quiet boosts on Home and opens the boosted message', () => {
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});
      const boosted = {
        ...makeMessage('boosted-home', 'alice', 'Quietly boosted note', '#general'),
        reactions: [
          { emoji: 'a', users: ['mio', 'testuser'] },
          { emoji: 'b', users: ['ren'] },
        ],
      };
      const channels = new Map<string, Channel>();
      channels.set('#general', makeChannel('#general', [boosted], [makeUser('alice')]));
      store.setState({
        ...initialState,
        channels,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        networkName: 'IRCXNet',
        ourNick: 'testuser',
      }, true);

      render(() => <AppShell />);

      const boosts = screen.getByLabelText('Quiet boosts');
      const boostCards = screen.getByRole('list', { name: 'Quiet boost cards' });
      expect(within(boosts).getByText('non-notifying reactions')).toBeInTheDocument();
      expect(within(boostCards).getAllByRole('listitem')).toHaveLength(1);
      expect(within(boosts).getByText('#general')).toBeInTheDocument();
      expect(boosts).toHaveTextContent('Quietly boosted note');
      expect(within(boosts).getByLabelText('3 quiet boosts')).toBeInTheDocument();
      expect(within(boosts).getByText('2')).toBeInTheDocument();

      fireEvent.click(within(boosts).getByRole('button', { name: 'Open boosted message in #general' }));

      const activeView = store.getState().activeView;
      expect(activeView.kind).toBe('channel');
      if (activeView.kind === 'channel') expect(activeView.channel).toBe('#general');
      expect(store.getState().timeTravelLandingId).toBe('boosted-home');
      expect(travelToSpy).toHaveBeenCalledWith('#general', boosted.time);
      travelToSpy.mockRestore();
    });
  });
});
