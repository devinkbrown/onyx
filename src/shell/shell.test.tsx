// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetNamesBurstsForTests, store, type Server } from '@/lib/store/store';
import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import type { ChatMessage, ChannelUser } from '@/lib/irc/types';
import { saveChannelTopicDrafts } from '@/lib/channel/topicDrafts';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import { readReviewHistory, recordReviewHistory } from '@/lib/notifications/reviewHistory';
import { closePreferences, isPreferencesOpen, resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { readTopicReadMarker, TOPIC_READ_LEDGER_KEY } from '@/lib/topics/topicReadLedger';
import { _resetVaultForTests, queueOutbox, saveMessages } from '@/lib/vault/historyVault';
import { setMountedCadenceMediaEngine } from '@/lib/mediaEngineMount';
import { Spotlight } from '@/chat/spotlight';
import { AppShell, _setMediaModuleLoaderForTests } from './AppShell';

// AppShell lazily mounts the media engine on Join voice/video. Keep that path
// off the real codec graph in unit tests.
vi.mock('@/media/useCadenceMedia', () => ({
  mountMedia: vi.fn(),
}));

// ── Shared fixture helpers ────────────────────────────────────────────────────

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://example.test', identity: 'testuser' } as const;
const memoryServer: Server = {
  id: 'shell-memory',
  name: 'Example',
  network: 'Example',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: 'testuser',
  account: MEMORY_OWNER.identity,
  connected: true,
};
const TOPIC_READ_STORAGE_KEY = deviceMemoryStorageKey(TOPIC_READ_LEDGER_KEY, MEMORY_OWNER)!;

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
    networkName: 'Onyx',
  }, true);
}

function stubMobileViewport(matches = true): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('max-width') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function stubResizableViewport(initiallyMobile = false): (mobile: boolean) => void {
  let mobileListener: ((event: MediaQueryListEvent) => void) | undefined;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(max-width: 900px)' ? initiallyMobile : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (query === '(max-width: 900px)' && type === 'change') mobileListener = listener;
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  return (mobile: boolean) => mobileListener?.({ matches: mobile } as MediaQueryListEvent);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppShell', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    _resetNamesBurstsForTests();
    for (const key of followed()) unfollow(key);
    localStorage.clear();
    closePreferences();
    resetPreferences();
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    setMountedCadenceMediaEngine(null);
  });

  afterEach(() => {
    cleanup();
    _setMediaModuleLoaderForTests();
    setMountedCadenceMediaEngine(null);
    _resetNamesBurstsForTests();
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

    it('opens existing topics safely and returns composer focus when clearing to All', async () => {
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
        server: memoryServer,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        viewUnreadDividerId: new Map([['#general', 'msg-topic-b']]),
      }, true);
      const openChannelConversation = vi.fn(
        (channelName: string, topic: string | null) =>
          initialState.openChannelConversation(channelName, topic),
      );
      store.setState({ openChannelConversation });

      setPreference('topicTools', true);
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
      expect(openChannelConversation).toHaveBeenLastCalledWith('#general', 'roadmap');

      const clearTopic = screen.getByRole('button', { name: 'Clear topic roadmap' });
      clearTopic.focus();
      fireEvent.click(clearTopic);

      expect(store.getState().activeChannelTopics.has('#general')).toBe(false);
      expect(openChannelConversation).toHaveBeenLastCalledWith('#general', null);
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /message #general/i }));
      });
    });

    it('tracks interleaved topic reads independently and reserves the server room marker for All', () => {
      const sendRaw = vi.fn();
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-old', 'alice', 'Older roadmap item', '#general', 'roadmap'),
          makeMessage('msg-roadmap-new', 'alice', 'New roadmap item', '#general', 'roadmap'),
          makeMessage('msg-release-new', 'bob', 'New release item', '#general', 'release'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      channel.unread = 2;
      const channels = new Map<string, Channel>([['#general', channel]]);
      store.setState({
        ...initialState,
        server: memoryServer,
        client: {
          sendRaw,
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set(['draft/read-marker']),
        } as never,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        channelUnread: { '#general': 2 },
        firstUnreadId: new Map([['#general', 'msg-roadmap-new']]),
        viewUnreadDividerId: new Map([['#general', 'msg-roadmap-new']]),
      }, true);

      setPreference('topicTools', true);
      render(() => <AppShell />);

      expect(screen.getAllByLabelText('1 unread')).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: /roadmap.*1 unread/i }));
      expect(readTopicReadMarker('#general', 'roadmap', MEMORY_OWNER)?.lastReadMessageId).toBe('msg-roadmap-new');
      expect(readTopicReadMarker('#general', 'release', MEMORY_OWNER)).toBeNull();
      expect(screen.getAllByLabelText('1 unread')).toHaveLength(1);
      expect(store.getState().channels.get('#general')?.unread).toBe(1);
      expect(sendRaw).not.toHaveBeenCalledWith('MARKREAD', expect.anything(), expect.anything());

      fireEvent.click(screen.getByRole('button', { name: /release.*1 unread/i }));
      expect(readTopicReadMarker('#general', 'release', MEMORY_OWNER)?.lastReadMessageId).toBe('msg-release-new');
      expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument();
      expect(store.getState().channels.get('#general')?.unread).toBe(0);
      expect(sendRaw).not.toHaveBeenCalledWith('MARKREAD', expect.anything(), expect.anything());

      fireEvent.click(screen.getByRole('button', { name: 'All' }));
      expect(store.getState().channels.get('#general')?.unread).toBe(0);
      expect(store.getState().channelUnread['#general']).toBe(0);
      expect(store.getState().firstUnreadId.has('#general')).toBe(false);
      expect(sendRaw).toHaveBeenCalledWith('MARKREAD', '#general', expect.stringMatching(/^timestamp=/));
    });

    it('updates topic unread badges from sanitized cross-tab read markers', () => {
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-old', 'alice', 'Older release item', '#general', 'release'),
          makeMessage('msg-release-new', 'bob', 'New release item', '#general', 'release'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      store.setState({
        ...initialState,
        server: memoryServer,
        channels: new Map([['#general', channel]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        channelNotify: new Map([['#general', 'mentions']]),
        highlightWords: ['release'],
        viewUnreadDividerId: new Map([['#general', 'msg-release-new']]),
      }, true);

      setPreference('topicTools', true);
      render(() => <AppShell />);
      expect(screen.getByLabelText('1 unread')).toBeInTheDocument();

      window.dispatchEvent(new StorageEvent('storage', {
        key: TOPIC_READ_STORAGE_KEY,
        newValue: JSON.stringify([{
          channel: '#general',
          topic: 'release',
          lastReadMessageId: 'msg-release-new',
          lastReadAt: channel.messages[1]!.time.getTime(),
          text: 'must be discarded',
        }]),
      }));

      expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument();
    });

    it('starts a new named conversation before the first message', () => {
      seedStore('#general');
      const openChannelConversation = vi.fn(
        (channelName: string, topic: string | null) =>
          initialState.openChannelConversation(channelName, topic),
      );
      store.setState({ openChannelConversation });

      setPreference('topicTools', true);
      render(() => <AppShell />);

      fireEvent.input(screen.getByLabelText('New topic'), { target: { value: 'incident' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start topic' }));

      expect(store.getState().activeChannelTopics.get('#general')).toBe('incident');
      expect(screen.getByText('#incident')).toBeInTheDocument();
      expect(openChannelConversation).not.toHaveBeenCalled();
    });

    it('projects named conversations into a browsable forum view', async () => {
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
        server: memoryServer,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        viewUnreadDividerId: new Map([['#general', 'msg-topic-b']]),
      }, true);
      const openChannelConversation = vi.fn(
        (channelName: string, topic: string | null) =>
          initialState.openChannelConversation(channelName, topic),
      );
      store.setState({ openChannelConversation });

      setPreference('topicTools', true);
      render(() => <AppShell />);

      fireEvent.click(screen.getByRole('button', { name: 'Forum' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pin forum' }));

      const forum = screen.getByLabelText('Topic forum');
      expect(forum).toBeInTheDocument();
      expect(store.getState().forumChannels.has('#general')).toBe(true);
      expect(screen.getByRole('button', { name: 'Forum pinned' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(forum).getByText('2 messages')).toBeInTheDocument();
      expect(within(forum).getAllByText('1 unread')).toHaveLength(2);
      expect(within(forum).getByRole('button', { name: /Open topic roadmap, 2 messages, 1 unread on this device/i })).toBeInTheDocument();
      expect(within(forum).getByText('Another roadmap item')).toBeInTheDocument();

      const followRoadmap = within(forum).getByRole('button', { name: 'Follow topic roadmap' });
      fireEvent.click(followRoadmap);

      expect(isFollowed('#general', 'roadmap', MEMORY_OWNER)).toBe(true);
      expect(within(forum).getByRole('button', { name: 'Unfollow topic roadmap' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      fireEvent.click(within(forum).getByRole('button', { name: 'Unfollow topic roadmap' }));

      expect(isFollowed('#general', 'roadmap', MEMORY_OWNER)).toBe(false);

      fireEvent.click(within(forum).getByRole('button', { name: /Open topic roadmap/i }));

      expect(store.getState().activeChannelTopics.get('#general')).toBe('roadmap');
      expect(openChannelConversation).toHaveBeenCalledWith('#general', 'roadmap');
      expect(screen.queryByLabelText('Topic forum')).not.toBeInTheDocument();
      await waitFor(() => {
        const filters = screen.getByRole('group', { name: 'Topic filters' });
        expect(document.activeElement).toBe(within(filters).getByRole('button', { name: /roadmap/i }));
      });
    });

    it('opens pinned forum channels directly', () => {
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
        forumChannels: new Set(['#general']),
        ourNick: 'testuser',
      }, true);

      setPreference('topicTools', true);
      render(() => <AppShell />);

      expect(screen.getByLabelText('Topic forum')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Forum pinned' })).toHaveAttribute('aria-pressed', 'true');
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
        server: memoryServer,
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
      expect(readReviewHistory(MEMORY_OWNER)[0]).toMatchObject({
        target: '#general',
        firstMessageId: 'msg-new-a',
        messageCount: 2,
        mentionCount: 1,
        preview: 'New note two',
      });
    });

    it('keeps a valid non-hash channel in reader and reviewed-anchor handoffs', () => {
      setPreference('readerMode', true);
      setPreference('localHistory', true);
      const channel = makeChannel(
        '&ops',
        [
          makeMessage('ops-old', 'alice', 'Old ops note', '&ops'),
          makeMessage('ops-new', 'bob', 'New ops handoff', '&ops'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      const channels = new Map<string, Channel>();
      channels.set('&ops', channel);
      store.setState({
        ...initialState,
        server: memoryServer,
        channels,
        activeView: { kind: 'channel', channel: '&ops' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        viewUnreadDividerId: new Map([['&ops', 'ops-new']]),
      }, true);

      render(() => <AppShell />);

      const digest = screen.getByRole('region', { name: 'Since you left' });
      expect(within(digest).getByText('1 message across 1 channel')).toBeInTheDocument();
      fireEvent.click(within(digest).getByRole('button', { name: 'Review new messages' }));
      expect(readReviewHistory(MEMORY_OWNER)[0]).toMatchObject({
        target: '&ops', kind: 'channel', firstMessageId: 'ops-new',
      });
      expect(screen.getByRole('region', { name: 'Device memory context' })).toHaveTextContent('&ops');
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
        server: memoryServer,
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
      }, MEMORY_OWNER);

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

    it('hands off from reader memory into another room reviewed anchor', () => {
      setPreference('readerMode', true);
      setPreference('localHistory', true);
      const channel = makeChannel(
        '#general',
        [
          makeMessage('msg-memory-a', 'alice', 'Old remembered note', '#general'),
          makeMessage('msg-memory-b', 'bob', 'Hydrated note one', '#general'),
        ],
        [makeUser('alice'), makeUser('bob')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        server: memoryServer,
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
        messageCount: 2,
        mentionCount: 0,
        preview: 'Hydrated note one',
      }, MEMORY_OWNER);
      recordReviewHistory({
        target: '&ops',
        name: '&ops',
        kind: 'channel',
        firstMessageId: 'ops-anchor',
        firstAt: '2026-07-08T18:30:00.000Z',
        reviewedAt: '2026-07-09T00:06:00.000Z',
        messageCount: 4,
        mentionCount: 1,
        preview: 'Local ops handoff',
      }, MEMORY_OWNER);

      const openVaultResult = vi.spyOn(store.getState(), 'openVaultResult');
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo');

      render(() => <AppShell />);

      const memory = screen.getByRole('region', { name: 'Device memory context' });
      const peers = within(memory).getByRole('group', { name: 'Other rooms reviewed recently' });
      expect(within(peers).getByText('Other rooms')).toBeInTheDocument();
      const peerButton = within(peers).getByRole('button', { name: 'Open reviewed &ops' });
      expect(peerButton).toHaveTextContent('Local ops handoff');

      fireEvent.click(peerButton);
      expect(openVaultResult).toHaveBeenCalledWith('&ops', 'ops-anchor');
      expect(travelToSpy).toHaveBeenCalledWith(
        '&ops',
        new Date('2026-07-08T18:30:00.000Z'),
        'ops-anchor',
      );

      openVaultResult.mockRestore();
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
      await saveMessages('#general', vaultMessages, MEMORY_OWNER);
      const channel = makeChannel(
        '#general',
        [makeMessage('msg-memory-c', 'carol', 'Visible live tail', '#general')],
        [makeUser('alice'), makeUser('bob'), makeUser('carol')],
      );
      const channels = new Map<string, Channel>();
      channels.set('#general', channel);
      store.setState({
        ...initialState,
        server: memoryServer,
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
      }, MEMORY_OWNER);

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
        server: memoryServer,
        channels,
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      }, true);

      setPreference('topicTools', true);
      render(() => <AppShell />);

      fireEvent.click(screen.getByRole('button', { name: 'Follow room' }));
      expect(isFollowed('#general', null, MEMORY_OWNER)).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /roadmap/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Follow roadmap' }));
      expect(isFollowed('#general', 'roadmap', MEMORY_OWNER)).toBe(true);
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
    it('exposes the production composer to the advertised focus shortcut', () => {
      seedStore('#general');

      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector<HTMLTextAreaElement>('[data-composer-input]');
      expect(textarea).not.toBeNull();

      fireEvent.keyDown(window, { key: 'Enter' });

      expect(textarea).toHaveFocus();
    });

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

    it('preserves an offline IRC command instead of silently dropping the draft', async () => {
      seedStore('#general');
      store.setState({ connectionStatus: 'disconnected' });
      const sendMessageSpy = vi.spyOn(store.getState(), 'sendMessage').mockImplementation(() => {});
      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;

      fireEvent.input(textarea, { target: { value: '/me waves' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(await screen.findByText(/Commands can't be queued/)).toBeInTheDocument();
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(textarea).toHaveValue('/me waves');
      expect(store.getState().getComposerDraft('#general')).toBe('/me waves');
      await waitFor(() => expect(document.activeElement).toBe(textarea));
    });

    it('applies the same offline command guard from the Send button', async () => {
      seedStore('#general');
      store.setState({ connectionStatus: 'disconnected' });
      const sendMessageSpy = vi.spyOn(store.getState(), 'sendMessage').mockImplementation(() => {});
      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;

      fireEvent.input(textarea, { target: { value: '/join #elsewhere' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(await screen.findByText(/Commands can't be queued/)).toBeInTheDocument();
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(textarea).toHaveValue('/join #elsewhere');
      expect(store.getState().getComposerDraft('#general')).toBe('/join #elsewhere');
      await waitFor(() => expect(document.activeElement).toBe(textarea));
    });

    it('still expands text-only slash conveniences before queueing offline', async () => {
      seedStore('#general');
      store.setState({ connectionStatus: 'disconnected' });
      const sendMessageSpy = vi.spyOn(store.getState(), 'sendMessage').mockImplementation(() => {});
      const { container } = render(() => <AppShell />);
      const textarea = container.querySelector('.shell-composer-textarea') as HTMLTextAreaElement;

      fireEvent.input(textarea, { target: { value: '/shrug still shipping' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(sendMessageSpy).toHaveBeenCalledWith('#general', '¯\\_(ツ)_/¯ still shipping');
      });
      expect(textarea).toHaveValue('');
      expect(store.getState().getComposerDraft('#general')).toBe('');
      expect(screen.queryByText(/Commands can't be queued/)).not.toBeInTheDocument();
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

    it('applies bounded room identity tokens for active channels', () => {
      seedStore('#general');

      const { getByTestId } = render(() => <AppShell />);

      const shell = getByTestId('app-shell');
      expect(shell).toHaveAttribute('data-room-identity', '#general');
      expect(shell.getAttribute('style')).toContain('--room-accent: oklch(');
      expect(shell.getAttribute('style')).toContain('--room-accent-border: oklch(');
    });

    it('keeps the self nick out of the channel ribbon', () => {
      // Arrange
      seedStore('#general');

      // Act
      const { getByRole } = render(() => <AppShell />);

      // Assert
      const ribbon = getByRole('banner', { name: 'Channel information' });
      expect(ribbon.textContent).toContain('general');
      expect(ribbon.textContent).not.toContain('testuser');
    });

    function openRibbonMore(): void {
      // A8: account / prefs live in the ribbon More disclosure.
      const moreSurface = screen.getByTestId('ribbon-more');
      fireEvent.click(moreSurface.closest('button') ?? moreSurface);
    }

    it('shows a "Guest" account chip that opens the account panel', () => {
      // Arrange — connected guest (no logged-in account).
      seedStore('#general');

      // Act
      render(() => <AppShell />);
      openRibbonMore();
      const chip = screen.getByTestId('ribbon-account-chip');

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
          id: 'ircxnet', name: 'eshmaki.me', network: 'Onyx',
          url: 'wss://eshmaki.me', icon: '#000', nick: 'alice',
          account: 'alice', connected: true,
        },
      });

      // Act
      render(() => <AppShell />);
      openRibbonMore();
      const chip = screen.getByTestId('ribbon-account-chip');

      // Assert
      expect(chip).toHaveAttribute('data-guest', 'false');
      expect(chip.textContent).toContain('alice');
    });

    it('opens preferences from the desktop ribbon', () => {
      // Arrange
      seedStore('#general');

      // Act
      render(() => <AppShell />);
      openRibbonMore();
      fireEvent.click(screen.getByTestId('ribbon-preferences'));

      // Assert
      expect(isPreferencesOpen()).toBe(true);
      expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    });

    it('opens the channel video surface without opening voice settings', () => {
      // Arrange — previous behaviour opened Voice settings as a "loading"
      // affordance, which made Join video look like audio-device settings.
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });

      // Act
      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));

      // Assert — publish the in-flow call surface; settings stay closed (gear
      // on the bar). The pending-engine test below owns media invocation.
      expect(store.getState().voice.callState).toBe('in_call');
      expect(store.getState().voice.callChannel).toBe('#general');
      expect(store.getState().showVoiceSettings).toBe(false);
      expect(screen.queryByRole('dialog', { name: 'Voice settings' })).not.toBeInTheDocument();

    });

    it('opens an in-flow video panel before a cold media chunk finishes booting', () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      setMountedCadenceMediaEngine(null);

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));

      // The dynamic import continuation cannot run until this synchronous turn
      // yields. The call surface must nevertheless be visible immediately.
      expect(store.getState().voice.callState).toBe('in_call');
      expect(store.getState().voice.callChannel).toBe('#general');
      expect(store.getState().voice.callStartedAt).toBeNull();
      expect(screen.getByRole('region', { name: 'Voice call participants' })).toBeInTheDocument();
    });

    it('does not resurrect a video join abandoned before cold media boot resolves', async () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      const engine = {
        joinVideo: vi.fn(async () => undefined),
        joinVoice: vi.fn(async () => undefined),
        getLocalStream: vi.fn(() => null),
        setMuted: vi.fn(),
        leaveRoom: vi.fn(),
      };
      const mountMedia = vi.fn(() => setMountedCadenceMediaEngine(engine as never));
      let finishBoot!: () => void;
      const coldBoot = new Promise<{ mountMedia: typeof mountMedia }>((resolve) => {
        finishBoot = () => resolve({ mountMedia });
      });
      _setMediaModuleLoaderForTests(() => coldBoot);

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));
      expect(store.getState().voice.callState).toBe('in_call');

      store.getState().leaveVoiceChannel();
      expect(store.getState().voice.callState).toBe('idle');
      finishBoot();
      await waitFor(() => expect(mountMedia).toHaveBeenCalledOnce());
      await Promise.resolve();

      expect(engine.joinVideo).not.toHaveBeenCalled();
      expect(store.getState().voice.callState).toBe('idle');
      expect(screen.queryByRole('region', { name: 'Voice call participants' })).not.toBeInTheDocument();
    });

    it('does not toast when an abandoned cold media boot later rejects', async () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      let rejectBoot!: (error: Error) => void;
      const coldBoot = new Promise<{ mountMedia(): void }>((_resolve, reject) => {
        rejectBoot = reject;
      });
      _setMediaModuleLoaderForTests(() => coldBoot);
      const toastCount = store.getState().toasts.length;

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));
      store.getState().leaveVoiceChannel();
      rejectBoot(new Error('cold media chunk failed'));
      await coldBoot.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getState().voice.callState).toBe('idle');
      expect(store.getState().toasts).toHaveLength(toastCount);
    });

    it('toasts when the current video join rejects after media boot succeeds', async () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      const engine = {
        joinVideo: vi.fn(async () => { throw new Error('camera permission denied'); }),
        joinVoice: vi.fn(async () => undefined),
        getLocalStream: vi.fn(() => null),
        setMuted: vi.fn(),
        leaveRoom: vi.fn(),
      };
      setMountedCadenceMediaEngine(engine as never);

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));

      await waitFor(() => {
        expect(engine.joinVideo).toHaveBeenCalledWith('#general', null);
        expect(store.getState().toasts.at(-1)?.title).toBe('Video could not start');
      });
      expect(store.getState().voice.callState).toBe('idle');
    });

    it('hands a gesture-captured stream to joinVideo (desktop activation path)', async () => {
      // Desktop Chromium requires getUserMedia under the click; we capture first
      // and pass the stream so later awaits cannot burn user-activation.
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      const gestureStream = {
        getAudioTracks: () => [{ stop: vi.fn(), readyState: 'live', addEventListener: vi.fn() }],
        getVideoTracks: () => [{ stop: vi.fn(), readyState: 'live', addEventListener: vi.fn() }],
        getTracks: () => [],
      } as unknown as MediaStream;
      (gestureStream as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [
        ...gestureStream.getAudioTracks(),
        ...gestureStream.getVideoTracks(),
      ] as MediaStreamTrack[];
      const getUserMedia = vi.fn(async () => gestureStream);
      vi.stubGlobal('navigator', {
        ...navigator,
        mediaDevices: { getUserMedia },
      });
      const engine = {
        joinVideo: vi.fn(async () => undefined),
        joinVoice: vi.fn(async () => undefined),
        getLocalStream: vi.fn(() => gestureStream),
        setMuted: vi.fn(),
        leaveRoom: vi.fn(),
      };
      setMountedCadenceMediaEngine(engine as never);

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));

      await waitFor(() => {
        expect(getUserMedia).toHaveBeenCalled();
        expect(engine.joinVideo).toHaveBeenCalledWith('#general', gestureStream);
      });
      expect(store.getState().voice.callState).toBe('in_call');
      expect(store.getState().voice.callStartedAt).not.toBeNull();
    });

    it('opens the video call panel while Edge media startup is still pending', async () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });
      let finishJoin: (() => void) | undefined;
      const pendingJoin = new Promise<void>((resolve) => {
        finishJoin = resolve;
      });
      const stream = {
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      } as unknown as MediaStream;
      const engine = {
        joinVideo: vi.fn(() => pendingJoin),
        joinVoice: vi.fn(async () => undefined),
        getLocalStream: vi.fn(() => stream),
        setMuted: vi.fn(),
      };
      setMountedCadenceMediaEngine(engine as never);

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join video' }));

      await waitFor(() => {
        expect(engine.joinVideo).toHaveBeenCalledWith('#general', null);
        expect(screen.getByRole('region', { name: 'Voice call participants' })).toBeInTheDocument();
      });
      expect(store.getState().voice.callChannel).toBe('#general');
      expect(store.getState().voice.callStartedAt).toBeNull();

      finishJoin?.();
      await waitFor(() => {
        expect(store.getState().voice.callStartedAt).not.toBeNull();
      });
    });

    it('opens the channel voice surface without opening voice settings', () => {
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
          negotiatedCaps: new Set<string>(),
        } as never,
      });

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Join voice' }));

      expect(store.getState().voice.callState).toBe('in_call');
      expect(store.getState().voice.callChannel).toBe('#general');
      expect(store.getState().showVoiceSettings).toBe(false);

    });

    it('shows scheduled room events in the presence header and opens the event moment', () => {
      const eventAt = Math.floor(Date.now() / 1000) + 1800;
      seedStore('#general');
      store.setState({
        channelProps: new Map([['#general', { 'ocean.event': `${eventAt}|Office hours` }]]),
      });
      const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

      render(() => <AppShell />);

      const eventChip = screen.getByRole('button', { name: /Scheduled room event in #general: Office hours/i });
      expect(eventChip).toHaveTextContent('Office hours');

      fireEvent.click(eventChip);

      expect(travelToSpy).toHaveBeenLastCalledWith('#general', new Date(eventAt * 1000));
      travelToSpy.mockRestore();
    });

    it('shows voice room activity and local device health in the presence header', () => {
      seedStore('#general');
      store.setState({
        voiceChannelParticipants: new Map([['#general', new Set(['alice', 'bob', 'carol'])]]),
        speakingNicks: new Set(['alice']),
        voice: {
          ...initialState.voice,
          callState: 'in_call',
          callChannel: '#general',
          muted: true,
          screenshareActive: true,
        },
      });

      render(() => <AppShell />);

      const voiceChip = screen.getByRole('button', {
        name: /3 people in voice in #general, current call, alice is speaking, your microphone is muted, you are sharing your screen/i,
      });
      expect(voiceChip).toHaveTextContent('3 in voice · alice speaking · muted, sharing');
    });

    it('shows watch-together room activity from channel metadata', () => {
      seedStore('#general');
      store.setState({
        channelProps: new Map([[
          '#general',
          {
            'ocean.watch': 'title=Demo%20Night;url=https%3A%2F%2Fexample.test%2Fv;host=alice;state=paused;position=90;duration=300;participants=alice,bob',
          },
        ]]),
      });

      render(() => <AppShell />);

      const watch = screen.getByRole('region', {
        name: /Watch together: Demo Night, Paused 1:30, host alice, 2 watching/i,
      });
      expect(watch).toHaveTextContent('Watch together');
      expect(watch).toHaveTextContent('Demo Night');
      expect(watch).toHaveTextContent('1:30 / 5:00');
      expect(watch).toHaveTextContent('Host alice');
      expect(screen.getByRole('link', { name: /Open Demo Night in a new tab/i })).toHaveAttribute(
        'href',
        'https://example.test/v',
      );
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

    it('reveals the mounted member list when a connected Home session joins a channel', async () => {
      // Arrange — a nick-only guest starts connected on Home with no active
      // conversation, so the desktop member column exists but is hidden/inert.
      stubMobileViewport(false);
      store.setState({
        ...initialState,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        status: 'connected',
        ourNick: 'Guest42',
      }, true);

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('aside.shell-members');
      expect(memberList).not.toBeNull();
      expect(memberList).toHaveAttribute('aria-label', 'Member list');
      expect(memberList).toHaveAttribute('aria-hidden', 'true');
      expect(memberList).toHaveAttribute('inert');

      // Act — drive the same explicit JOIN + NAMES path as a room requested
      // after registration. AppShell stays mounted throughout the transition.
      store.getState()._handleMessage(parseIRCMessage(':Guest42!webchat@host JOIN #root'));
      store.getState()._handleMessage(parseIRCMessage(':server 353 Guest42 = #root :Guest42 Alice @Bob'));
      store.getState()._handleMessage(parseIRCMessage(':server 366 Guest42 #root :End of /NAMES list'));

      // Assert — the existing column reacts to activeView + roster state instead
      // of requiring a shell remount or a manual member-list toggle.
      await waitFor(() => {
        expect(container.querySelector('aside.shell-members')).toBe(memberList);
        expect(memberList).toHaveAttribute('aria-label', 'Member list for #root');
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberList).not.toHaveAttribute('inert');
        expect(within(memberList!).getByText('Guest42', { exact: true })).toBeInTheDocument();
        expect(within(memberList!).getByText('Alice', { exact: true })).toBeInTheDocument();
        expect(within(memberList!).getByText('Bob', { exact: true })).toBeInTheDocument();
      });
    });

    it('keeps the populated member list mounted while optional timeline data is pending', async () => {
      // Arrange — a slow or unavailable stats endpoint must never suspend the
      // connected AppShell. In particular, the authoritative NAMES roster is
      // unrelated to the optional timeline request and must remain usable.
      stubMobileViewport(false);
      seedStore('#general');
      setPreference('timeScrubber', true);
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

      // Act
      const { container } = render(() => (
        <Suspense fallback={<p data-testid="shell-suspended">Loading shell</p>}>
          <AppShell />
        </Suspense>
      ));

      // Assert
      // MessageView has its own short IndexedDB hydration resource, so wait for
      // that required data to settle. The deliberately unresolved network
      // request must not keep or return the shell to the fallback afterward.
      await waitFor(() => {
        expect(screen.queryByTestId('shell-suspended')).not.toBeInTheDocument();
        expect(container.querySelector('[data-testid="app-shell"]')).toBeInTheDocument();
        const roster = screen.getByRole('region', { name: 'Channel members in #general' });
        expect(roster).toBeInTheDocument();
        expect(within(roster).getByText('alice', { exact: true })).toBeInTheDocument();
        expect(within(roster).getByText('bob', { exact: true })).toBeInTheDocument();
        expect(within(roster).getByText('carol', { exact: true })).toBeInTheDocument();
      });
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

    it('moves focus into the mobile channel drawer and restores it on Escape', async () => {
      stubMobileViewport();
      seedStore('#general');

      const { container } = render(() => <AppShell />);

      const roomsButton = screen.getByRole('button', { name: 'Toggle channel list' });
      const conversation = container.querySelector<HTMLElement>('.shell-conversation');
      const mobileNav = container.querySelector<HTMLElement>('.shell-mobile-nav');
      expect(conversation).not.toHaveAttribute('inert');
      expect(mobileNav).not.toHaveAttribute('inert');
      roomsButton.focus();
      fireEvent.click(roomsButton);

      const drawer = screen.getByRole('dialog', { name: 'Channel drawer' });
      await waitFor(() => {
        expect(drawer.contains(document.activeElement)).toBe(true);
        expect(drawer).not.toHaveAttribute('inert');
        expect(conversation).toHaveAttribute('inert');
        expect(mobileNav).toHaveAttribute('inert');
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Channel drawer' })).not.toBeInTheDocument();
        expect(conversation).not.toHaveAttribute('inert');
        expect(mobileNav).not.toHaveAttribute('inert');
        expect(roomsButton).toHaveFocus();
      });
    });

    it('keeps the mobile channel drawer open for claimed or composing keys', async () => {
      stubMobileViewport();
      seedStore('#general');

      render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Toggle channel list' }));
      const drawer = screen.getByRole('dialog', { name: 'Channel drawer' });
      await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

      fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
      expect(screen.getByRole('dialog', { name: 'Channel drawer' })).toBeInTheDocument();

      const claimed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      claimed.preventDefault();
      document.dispatchEvent(claimed);
      expect(screen.getByRole('dialog', { name: 'Channel drawer' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Channel drawer' })).not.toBeInTheDocument();
      });
    });

    it('keeps the closed mobile member drawer inert and restores its trigger from the modal close control', async () => {
      stubMobileViewport();
      seedStore('#general');

      const { container } = render(() => <AppShell />);

      const membersButton = screen.getByRole('button', { name: 'Toggle member list' });
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      const sidebar = container.querySelector<HTMLElement>('.shell-sidebar-slot');
      const conversation = container.querySelector<HTMLElement>('.shell-conversation');
      const mobileNav = container.querySelector<HTMLElement>('.shell-mobile-nav');
      expect(memberList).not.toBeNull();
      expect(memberList).toHaveAttribute('aria-hidden', 'true');
      expect(memberList).toHaveAttribute('inert');
      expect(sidebar).not.toHaveAttribute('inert');
      expect(conversation).not.toHaveAttribute('inert');
      expect(mobileNav).not.toHaveAttribute('inert');
      expect(screen.queryByRole('region', { name: 'Channel members in #general' })).toBeNull();
      for (const trigger of memberList!.querySelectorAll<HTMLButtonElement>('.onyx-popover__trigger')) {
        expect(trigger).toBeDisabled();
      }

      membersButton.focus();
      fireEvent.click(membersButton);

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberList).not.toHaveAttribute('inert');
        expect(sidebar).toHaveAttribute('inert');
        expect(conversation).toHaveAttribute('inert');
        expect(mobileNav).toHaveAttribute('inert');
        for (const trigger of memberList!.querySelectorAll<HTMLButtonElement>('.onyx-popover__trigger')) {
          expect(trigger).not.toBeDisabled();
        }
        expect(within(memberList!).getByRole('button', { name: 'Close member list' })).toHaveFocus();
      });

      fireEvent.click(within(memberList!).getByRole('button', { name: 'Close member list' }));

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(sidebar).not.toHaveAttribute('inert');
        expect(conversation).not.toHaveAttribute('inert');
        expect(mobileNav).not.toHaveAttribute('inert');
        expect(membersButton).toHaveFocus();
      });
      expect(screen.queryByRole('region', { name: 'Channel members in #general' })).toBeNull();
    });

    it('closes member details before closing the mobile member drawer on Escape', async () => {
      stubMobileViewport();
      seedStore('#general');

      const { container } = render(() => <AppShell />);
      const membersButton = screen.getByRole('button', { name: 'Toggle member list' });
      membersButton.focus();
      fireEvent.click(membersButton);

      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));
      const aliceTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      fireEvent.click(aliceTrigger);
      expect(screen.getByRole('dialog', { name: 'Member details for alice' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Member details for alice' })).not.toBeInTheDocument();
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(membersButton).toHaveAttribute('aria-expanded', 'true');
        expect(aliceTrigger).toHaveFocus();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(membersButton).toHaveAttribute('aria-expanded', 'false');
        expect(membersButton).toHaveFocus();
      });
    });

    it('hands focus to the DM composer when Message leaves the mobile member drawer', async () => {
      stubMobileViewport();
      seedStore('#general');

      const { container } = render(() => <AppShell />);
      fireEvent.click(screen.getByRole('button', { name: 'Toggle member list' }));

      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));
      fireEvent.click(within(memberList!).getByRole('button', { name: /Open member details for alice/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Send DM to alice' }));

      const composer = container.querySelector<HTMLTextAreaElement>('[data-composer-input]');
      await waitFor(() => {
        expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'alice' });
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(composer).toHaveAttribute('aria-label', 'Message alice');
        expect(composer).toHaveFocus();
      });
    });

    it('closes the mobile member drawer when navigation replaces its channel target', async () => {
      stubMobileViewport();
      seedStore('#general');
      const current = store.getState().channels.get('#general');
      expect(current).toBeDefined();
      store.setState({
        channels: new Map([
          ...store.getState().channels,
          ['#other', { ...current!, name: '#other' }],
        ]),
      });

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      const membersButton = screen.getByRole('button', { name: 'Toggle member list' });
      membersButton.focus();
      fireEvent.click(membersButton);
      await waitFor(() => expect(memberList).toHaveAttribute('aria-label', 'Member list for #general'));

      store.setState({ activeView: { kind: 'channel', channel: '#other' } });

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-label', 'Member list for #other');
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(membersButton).toHaveAttribute('aria-expanded', 'false');
        expect(membersButton).toHaveFocus();
      });

      fireEvent.click(membersButton);
      await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));
      store.setState({ activeView: { kind: 'home' } });
      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByRole('button', { name: 'Toggle member list' })).toBeNull();
      });

      store.setState({ activeView: { kind: 'channel', channel: '#general' } });
      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-label', 'Member list for #general');
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByRole('button', { name: 'Toggle member list' })).toHaveAttribute('aria-expanded', 'false');
      });
    });

    it('focuses and names the empty mobile member drawer until Escape restores its trigger', async () => {
      stubMobileViewport();
      seedStore('#general');
      const channels = new Map(store.getState().channels);
      const channel = channels.get('#general');
      expect(channel).toBeDefined();
      channels.set('#general', { ...channel!, users: new Map() });
      store.setState({ channels });

      render(() => <AppShell />);
      const membersButton = screen.getByRole('button', { name: 'Toggle member list' });
      membersButton.focus();
      fireEvent.click(membersButton);

      const drawer = await screen.findByRole('dialog', { name: 'Member list for #general' });
      expect(drawer).toHaveAttribute('aria-modal', 'true');
      const closeButton = within(drawer).getByRole('button', { name: 'Close member list' });
      await waitFor(() => expect(closeButton).toHaveFocus());

      fireEvent.keyDown(document, { key: 'Tab' });
      expect(closeButton).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Member list for #general' })).not.toBeInTheDocument();
        expect(membersButton).toHaveFocus();
      });
    });

    it('makes the desktop-hidden member column inert until it is opened', async () => {
      stubMobileViewport(false);
      seedStore('#general');
      store.setState({ showMemberList: false });

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      expect(memberList).toHaveAttribute('aria-hidden', 'true');
      expect(memberList).toHaveAttribute('inert');
      expect(screen.queryByRole('region', { name: 'Channel members in #general' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /3 members — toggle member list/i }));

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberList).not.toHaveAttribute('inert');
        expect(screen.getByRole('region', { name: 'Channel members in #general' })).toBeInTheDocument();
      });
    });

    it('hands focus to the DM composer when Message hides the desktop member column', async () => {
      stubMobileViewport(false);
      seedStore('#general');

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      fireEvent.click(within(memberList!).getByRole('button', { name: /Open member details for alice/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Send DM to alice' }));

      const composer = container.querySelector<HTMLTextAreaElement>('[data-composer-input]');
      await waitFor(() => {
        expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'alice' });
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(composer).toHaveAttribute('aria-label', 'Message alice');
        expect(composer).toHaveFocus();
      });
    });

    it.each([
      { surface: 'desktop roster', mobile: false },
      { surface: 'mobile member drawer', mobile: true },
    ])('opens the live WHOIS profile from the $surface and restores its stable trigger', async ({ mobile }) => {
      stubMobileViewport(mobile);
      seedStore('#general');
      const sendRaw = vi.fn();
      store.setState({
        client: {
          sendRaw,
          isupport: { CHANTYPES: '#&' },
        } as never,
      });

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      if (mobile) {
        fireEvent.click(screen.getByRole('button', { name: 'Toggle member list' }));
        await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));
      }
      const memberTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      fireEvent.click(memberTrigger);
      const profileButton = screen.getByRole('button', { name: 'View profile of alice' });
      fireEvent.click(profileButton);

      const profile = await screen.findByRole('dialog', { name: 'Profile: alice' });
      expect(within(profile).getByRole('status')).toHaveTextContent('Asking the network');
      expect(sendRaw).toHaveBeenCalledWith('WHOIS', 'alice', 'alice');
      expect(store.getState().showWhois).toBe(true);
      expect(store.getState().whoisNick).toBe('alice');

      fireEvent.click(within(profile).getByRole('button', { name: 'Close member profile' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Profile: alice' })).toBeNull();
        expect(memberTrigger).toHaveFocus();
      });

      if (!mobile) {
        const laterOpener = screen.getByRole('button', { name: /3 members — toggle member list/i });
        laterOpener.focus();
        store.getState().whois('bob');
        const laterProfile = await screen.findByRole('dialog', { name: 'Profile: bob' });
        fireEvent.click(within(laterProfile).getByRole('button', { name: 'Close member profile' }));
        await waitFor(() => expect(laterOpener).toHaveFocus());
      }
    });

    it('preserves the roster and focus handoff when an open desktop profile resizes to mobile', async () => {
      const resize = stubResizableViewport(false);
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
        } as never,
      });

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      const memberTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      fireEvent.click(memberTrigger);
      fireEvent.click(screen.getByRole('button', { name: 'View profile of alice' }));
      const profile = await screen.findByRole('dialog', { name: 'Profile: alice' });

      resize(true);

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberList).toHaveAttribute('aria-modal', 'true');
        expect(memberList).not.toHaveAttribute('inert');
      });
      fireEvent.click(within(profile).getByRole('button', { name: 'Close member profile' }));
      await waitFor(() => expect(memberTrigger).toHaveFocus());

      fireEvent.keyDown(document, { key: 'Escape' });

      const mobileMembersButton = screen.getByRole('button', { name: 'Toggle member list' });
      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(mobileMembersButton).toHaveFocus();
      });
    });

    it('keeps an open member card and its Escape stack across a desktop-to-mobile resize', async () => {
      const resize = stubResizableViewport(false);
      seedStore('#general');

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      const memberTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      memberTrigger.focus();
      fireEvent.click(memberTrigger);
      const memberCard = screen.getByRole('dialog', { name: 'Member details for alice' });

      resize(true);

      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberList).toHaveAttribute('aria-modal', 'true');
        expect(memberList).not.toHaveAttribute('inert');
        expect(memberCard).not.toHaveAttribute('hidden');
        expect(memberTrigger).toHaveAttribute('aria-expanded', 'true');
      });

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(memberTrigger).toHaveAttribute('aria-expanded', 'false');
        expect(memberTrigger).toHaveFocus();
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
      });

      fireEvent.keyDown(document, { key: 'Escape' });
      const mobileMembersButton = screen.getByRole('button', { name: 'Toggle member list' });
      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(memberList).toHaveAttribute('inert');
        expect(mobileMembersButton).toHaveFocus();
      });
    });

    it.each([
      { surface: 'desktop roster', mobile: false },
      { surface: 'mobile member drawer', mobile: true },
    ])('falls back to the stable $surface when the profiled member leaves', async ({ mobile }) => {
      stubMobileViewport(mobile);
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
        } as never,
      });

      const { container } = render(() => <AppShell />);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      if (mobile) {
        fireEvent.click(screen.getByRole('button', { name: 'Toggle member list' }));
        await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));
      }

      const memberTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      fireEvent.click(memberTrigger);
      fireEvent.click(screen.getByRole('button', { name: 'View profile of alice' }));
      const profile = await screen.findByRole('dialog', { name: 'Profile: alice' });

      store.getState()._handleMessage(parseIRCMessage(':alice!user@example PART #general :Leaving'));
      await waitFor(() => expect(memberTrigger).not.toBeInTheDocument());
      fireEvent.click(within(profile).getByRole('button', { name: 'Close member profile' }));

      await waitFor(() => expect(memberList).toHaveFocus());
    });

    it('gives keyboard ownership to a portaled WHOIS before closing the mobile member drawer', async () => {
      stubMobileViewport();
      seedStore('#general');
      store.setState({
        client: {
          sendRaw: vi.fn(),
          isupport: { CHANTYPES: '#&' },
        } as never,
      });

      const { container } = render(() => <AppShell />);
      const membersButton = screen.getByRole('button', { name: 'Toggle member list' });
      membersButton.focus();
      fireEvent.click(membersButton);
      const memberList = container.querySelector<HTMLElement>('.shell-members');
      expect(memberList).not.toBeNull();
      await waitFor(() => expect(memberList).toHaveAttribute('aria-hidden', 'false'));

      const memberTrigger = within(memberList!).getByRole('button', { name: /Open member details for alice/i });
      fireEvent.click(memberTrigger);
      fireEvent.click(screen.getByRole('button', { name: 'View profile of alice' }));
      const profile = await screen.findByRole('dialog', { name: 'Profile: alice' });

      fireEvent.keyDown(document, { key: 'Tab' });
      expect(profile.contains(document.activeElement)).toBe(true);
      expect(within(profile).getByRole('button', { name: 'Close member profile' })).toHaveFocus();
      expect(memberList).toHaveAttribute('aria-hidden', 'false');

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Profile: alice' })).toBeNull();
        expect(memberList).toHaveAttribute('aria-hidden', 'false');
        expect(memberTrigger).toHaveFocus();
      });

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(memberList).toHaveAttribute('aria-hidden', 'true');
        expect(membersButton).toHaveFocus();
      });
    });

    it('does not expose an empty channel nicklist inside a direct message', () => {
      stubMobileViewport(false);
      seedStore('#general');
      store.setState({ activeView: { kind: 'dm', nick: 'alice' } });

      const { container } = render(() => <AppShell />);

      expect(container.querySelector('[data-testid="app-shell"]')).toHaveClass('shell--members-hidden');
      expect(container.querySelector('aside.shell-members')).toHaveAttribute('inert');
      expect(screen.queryByRole('region', { name: /Channel members/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Toggle member list' })).not.toBeInTheDocument();
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
        server: memoryServer,
        channels,
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        networkName: 'Onyx',
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
        expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('review #general');
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
      expect(travelToSpy).toHaveBeenLastCalledWith(
        '#general',
        new Date('2025-01-01T12:00:00Z'),
        'msg-new-a',
      );

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

    it('keeps reviewed catch-up ranges visible while disconnected', async () => {
      recordReviewHistory({
        target: '#general',
        name: '#general',
        kind: 'channel',
        firstMessageId: 'msg-new-a',
        firstAt: '2025-01-01T12:00:00.000Z',
        reviewedAt: '2025-01-01T12:03:00.000Z',
        messageCount: 2,
        mentionCount: 1,
        preview: 'Offline recall note',
      }, MEMORY_OWNER);
      store.setState({
        ...initialState,
        activeView: { kind: 'home' },
        composerDrafts: { '#general': 'room draft', alice: 'private draft' },
        connectionStatus: 'disconnected',
        networkName: 'Onyx',
        server: {
          id: 'home-memory', name: 'Onyx', network: 'Onyx',
          url: 'wss://example.test', icon: '', nick: 'testuser',
          account: 'testuser', connected: false,
        },
      }, true);
      saveChannelTopicDrafts(
        { '#general': 'topic draft', alice: 'ignored non-channel draft' },
        undefined,
        MEMORY_OWNER,
      );

      await queueOutbox('#general', 'queued while offline', {
        serverUrl: 'wss://example.test',
        identity: 'testuser',
      });

      render(() => <AppShell />);

      const localMemory = await screen.findByText(/Local-memory mode:.*1 queued send/);
      expect(localMemory).toHaveTextContent('1 room draft');
      expect(localMemory).toHaveTextContent('1 topic draft');
      const reviewHistory = await screen.findByLabelText('Recent catch-up reviews');
      expect(within(reviewHistory).getByText('Reviewed recently')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('offline recall')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('#general')).toBeInTheDocument();
      expect(within(reviewHistory).getByText('Offline recall note')).toBeInTheDocument();
    });

    it('shows joined-room chanstats rhythm with scheduled event context', async () => {
      const eventAt = Math.floor(Date.now() / 1000) + 3600;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        generated_at: Math.floor(Date.now() / 1000),
        network: 'Onyx',
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
        networkName: 'Onyx',
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
        networkName: 'Onyx',
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
