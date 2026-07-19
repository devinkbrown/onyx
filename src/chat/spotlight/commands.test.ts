// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundOptions } from '@/backgrounds';
import type { Channel } from '@/lib/irc/types';
import { getState, setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import {
  closePreferences,
  isPreferencesOpen,
  preferences,
  resetPreferences,
} from '@/lib/prefs/preferences';
import {
  readClientExtensionAudit,
  writeClientExtensionActionsForTests,
} from '@/lib/extensions/clientActions';
import { setVaultMode, vaultSearchMode } from '@/shell/search/useMessageSearch';
import { setTranslationTarget, translationTarget } from '@/lib/intelligence/translateMessage';
import { loadRecents } from '@/lib/commands/registry';
import {
  readReviewHistory,
  recordReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import type { DMConversation, Server } from '@/lib/store/store';
import { THEME_IDS } from '@/theme';
import { buildCommands } from './commands';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'ircs://ircx.us:6697', identity: 'kain' } as const;

function channel(name: string): Channel {
  return {
    name,
    topic: 'lapis relay',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 2,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function dm(nick: string): DMConversation {
  return {
    nick,
    account: `${nick}.acct`,
    unread: 1,
    highlights: 0,
    messages: [],
  };
}

function server(): Server {
  return {
    id: 'ircx',
    name: 'ircx',
    network: 'eshmaki',
    url: 'ircs://ircx.us:6697',
    icon: '◆',
    nick: 'kain',
    account: 'kain',
    connected: true,
  };
}

function review(
  target: string,
  reviewedAt: string,
  overrides: Partial<ReviewHistoryEntry> = {},
): ReviewHistoryEntry {
  return {
    target,
    name: target,
    kind: target.startsWith('#') ? 'channel' : 'dm',
    firstMessageId: `${target}-anchor`,
    firstAt: '2026-07-09T08:15:00.000Z',
    reviewedAt,
    messageCount: 4,
    mentionCount: 1,
    preview: `deployment preview in ${target}`,
    ...overrides,
  };
}

describe('buildCommands', () => {
  beforeEach(() => {
    vi.useRealTimers();
    store.setState(initialState, true);
    resetPreferences();
    closePreferences();
    setVaultMode('exact');
    setTranslationTarget('');
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('builds channel, DM, and action commands from the store', () => {
    setState({
      channels: new Map([['#lapis', channel('#lapis')]]),
      dms: new Map([['aoi', dm('aoi')]]),
      server: server(),
      networkName: 'eshmaki',
    });

    const commands = buildCommands(getState());

    expect(commands.some((command) => command.section === 'Channels' && command.title === 'Go to #lapis')).toBe(true);
    expect(commands.some((command) => command.section === 'DMs' && command.title === 'Open DM with aoi')).toBe(true);
    expect(commands.some((command) => command.section === 'Actions' && command.title === 'Join channel...')).toBe(true);
    expect(commands.some((command) => command.title === 'Copy node address' && command.hint === 'ircs://ircx.us:6697')).toBe(true);
  });

  it('opens the channel directory with one store-owned LIST request', () => {
    const sendRaw = vi.fn();
    setState({ client: { sendRaw } as never });

    buildCommands(getState()).find((entry) => entry.id === 'action-browse-channels')?.run();

    expect(sendRaw).toHaveBeenCalledOnce();
    expect(sendRaw).toHaveBeenCalledWith('LIST');
    expect(getState().showChannelBrowser).toBe(true);
    expect(getState().channelListLoading).toBe(true);
  });

  it('includes every theme and background action', () => {
    const commands = buildCommands(getState());

    const themeCommands = commands.filter((command) => command.id.startsWith('theme:'));
    const backgroundCommands = commands.filter((command) => command.id.startsWith('background:'));

    expect(themeCommands).toHaveLength(THEME_IDS.length);
    expect(backgroundCommands).toHaveLength(backgroundOptions.length);
  });

  it('runs channel commands through current store actions', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      server: server(),
      ourNick: 'kain',
      joinChannel,
      navigate,
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'channel:#forge');
    command?.run();

    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(loadRecents(MEMORY_OWNER).map((entry) => entry.id)).toEqual(['channel:#forge']);
  });

  it('does not write a stale channel command into a newly switched owner', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#alice-private', channel('#alice-private')]]),
      server: server(),
      ourNick: 'kain',
      joinChannel,
      navigate,
    });
    const command = buildCommands(getState()).find((entry) => entry.id === 'channel:#alice-private');

    setState({
      server: { ...server(), account: 'bob', nick: 'bob' },
      ourNick: 'bob',
    });
    command?.run();

    expect(loadRecents(MEMORY_OWNER)).toEqual([]);
    expect(loadRecents({ serverUrl: MEMORY_OWNER.serverUrl, identity: 'bob' })).toEqual([]);
  });

  it('builds a literal goto command for channel navigation', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      joinChannel,
      navigate,
    });

    const command = buildCommands(getState(), 'goto #forge').find((entry) => entry.id === 'grammar:goto:#forge');
    expect(command?.title).toBe('Go to #forge');
    command?.run();

    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
  });

  it('builds join and open aliases for channel navigation', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      joinChannel,
      navigate,
    });

    const join = buildCommands(getState(), 'join forge').find((entry) => entry.id === 'grammar:goto:#forge');
    const open = buildCommands(getState(), 'open #forge').find((entry) => entry.id === 'grammar:goto:#forge');

    expect(join?.title).toBe('Go to #forge');
    expect(open?.title).toBe('Go to #forge');
  });

  it('builds a literal goto-at command for channel time travel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      joinChannel,
      navigate,
      travelTo,
    });

    const command = buildCommands(getState(), 'goto #forge at yesterday 21:00')
      .find((entry) => entry.id.startsWith('grammar:goto-time:#forge:'));

    expect(command).toBeDefined();
    expect(command!.title).toContain('Go to #forge at');
    command!.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date(2026, 6, 7, 21, 0, 0, 0));
  });

  it('builds a goto-at command with the fleet teaching am/pm form', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0, 0));
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({
      channels: new Map([['#root', channel('#root')]]),
      joinChannel,
      navigate,
      travelTo,
    });

    // Spotlight teaching chip: "goto #root at yesterday 9pm" must land a
    // time-travel command, not a bare navigate that silently drops the clock.
    const command = buildCommands(getState(), 'goto #root at yesterday 9pm')
      .find((entry) => entry.id.startsWith('grammar:goto-time:#root:'));

    expect(command).toBeDefined();
    expect(command!.title).toContain('Go to #root at');
    expect(command!.hint).toBe('time grammar');
    command!.run();
    expect(joinChannel).toHaveBeenCalledWith('#root');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#root' });
    expect(travelTo).toHaveBeenCalledWith('#root', new Date(2026, 6, 7, 21, 0, 0, 0));
  });

  it('fails closed instead of navigating when goto-at has an invalid time', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      joinChannel,
      navigate,
      travelTo,
    });

    // Once the user supplies an `at` clause, discard the whole grammar hit if
    // the clock is unparseable — never silently drop the time and join only.
    const grammar = buildCommands(getState(), 'goto #forge at someday')
      .find((entry) => entry.id.startsWith('grammar:goto:'));

    expect(grammar).toBeUndefined();
    expect(
      buildCommands(getState(), 'goto #forge at someday')
        .find((entry) => entry.id.startsWith('grammar:goto-time:')),
    ).toBeUndefined();
    expect(joinChannel).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(travelTo).not.toHaveBeenCalled();
  });

  it('builds a targeted at command for a channel timeline jump', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({ joinChannel, navigate, travelTo });

    const command = buildCommands(getState(), 'at #forge 3h ago')
      .find((entry) => entry.id.startsWith('action:time-jump:#forge:'));

    expect(command).toBeDefined();
    expect(command!.title).toContain('Jump #forge to');
    command!.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date('2026-07-08T09:00:00.000Z'));
  });

  it('jumps the active conversation via at: yesterday 3pm (docs flagship)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0, 0));
    const travelTo = vi.fn();
    setState({
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([['#lapis', channel('#lapis')]]),
      travelTo,
    });

    const command = buildCommands(getState(), 'at: yesterday 3pm')
      .find((entry) => entry.id.startsWith('action:time-jump:#lapis:'));

    expect(command).toBeDefined();
    expect(command!.title).toContain('Jump to');
    command!.run();
    expect(travelTo).toHaveBeenCalledWith('#lapis', new Date(2026, 6, 7, 15, 0, 0, 0));
  });

  it('accepts channel-first "#room at: <expr>" (docs form) and am/pm clocks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0, 0));
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({ joinChannel, navigate, travelTo });

    const colon = buildCommands(getState(), '#forge at: last friday')
      .find((entry) => entry.id.startsWith('action:time-jump:#forge:'));
    expect(colon).toBeDefined();
    expect(colon!.title).toContain('Jump #forge to');
    colon!.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    // 2026-07-08 Wed → last friday = 2026-07-03 midnight local
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date(2026, 6, 3, 0, 0, 0, 0));

    joinChannel.mockClear();
    navigate.mockClear();
    travelTo.mockClear();

    const spaced = buildCommands(getState(), '#forge at yesterday 3pm')
      .find((entry) => entry.id.startsWith('action:time-jump:#forge:'));
    expect(spaced).toBeDefined();
    spaced!.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date(2026, 6, 7, 15, 0, 0, 0));
  });

  it('rejects channel-first and verb-first time jumps without a parseable expression', () => {
    setState({
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([['#lapis', channel('#lapis')]]),
      joinChannel: vi.fn(),
      navigate: vi.fn(),
      travelTo: vi.fn(),
    });

    // Empty / glued / garbage expressions must fail closed — no jump command.
    for (const query of ['#forge at:', '#forge at:last', 'at #forge', 'at #forge someday', '#forge at someday']) {
      const jumps = buildCommands(getState(), query).filter((entry) =>
        entry.id.startsWith('action:time-jump:'),
      );
      expect(jumps, query).toEqual([]);
    }
  });

  it('preserves & channel targets in time-jump grammar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0, 0));
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    const travelTo = vi.fn();
    setState({ joinChannel, navigate, travelTo });

    const command = buildCommands(getState(), 'at &ops yesterday 3pm')
      .find((entry) => entry.id.startsWith('action:time-jump:&ops:'));

    expect(command).toBeDefined();
    command!.run();
    expect(joinChannel).toHaveBeenCalledWith('&ops');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '&ops' });
    expect(travelTo).toHaveBeenCalledWith('&ops', new Date(2026, 6, 7, 15, 0, 0, 0));
  });

  it('builds a leave command that parts a named channel through partChannel', () => {
    const partChannel = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      partChannel,
    });

    const command = buildCommands(getState(), 'leave forge').find((entry) => entry.id === 'grammar:part:#forge');
    expect(command?.title).toBe('Leave #forge');
    expect(command?.keywords).toContain('part');
    command?.run();

    expect(partChannel).toHaveBeenCalledWith('#forge');
  });

  it('parts the active channel from the bare leave verb', () => {
    const partChannel = vi.fn();
    setState({
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([['#lapis', channel('#lapis')]]),
      partChannel,
    });

    const command = buildCommands(getState(), 'part').find((entry) => entry.id === 'grammar:part:#lapis');
    expect(command?.title).toBe('Leave #lapis');
    command?.run();
    expect(partChannel).toHaveBeenCalledWith('#lapis');
  });

  it('omits the bare leave verb when no channel is active', () => {
    setState({ activeView: { kind: 'home' } });
    const command = buildCommands(getState(), 'leave').find((entry) => entry.id.startsWith('grammar:part:'));
    expect(command).toBeUndefined();
  });

  it('jumps to the first unread in a named channel via navigate', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#busy', { ...channel('#busy'), unread: 7, highlights: 0 }]]),
      joinChannel,
      navigate,
    });

    const command = buildCommands(getState(), 'unread busy').find((entry) => entry.id === 'grammar:unread:#busy');
    expect(command?.title).toBe('Jump to first unread in #busy');
    expect(command?.hint).toBe('7 unread');
    expect(command?.keywords).toContain('first unread');
    command?.run();

    expect(joinChannel).toHaveBeenCalledWith('#busy');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#busy' });
  });

  it('omits the unread jump when the named channel has nothing unread', () => {
    setState({
      channels: new Map([['#quiet', { ...channel('#quiet'), unread: 0, highlights: 0 }]]),
    });
    const command = buildCommands(getState(), 'unread quiet').find((entry) => entry.id.startsWith('grammar:unread:'));
    expect(command).toBeUndefined();
  });

  it('builds a literal dm command for direct messages', () => {
    const navigate = vi.fn();
    setState({
      dms: new Map([['aoi', dm('aoi')]]),
      navigate,
    });

    const command = buildCommands(getState(), 'dm @aoi').find((entry) => entry.id === 'grammar:dm:aoi');
    expect(command?.title).toBe('Open DM with aoi');
    command?.run();

    expect(navigate).toHaveBeenCalledWith({ kind: 'dm', nick: 'aoi' });
  });

  it('builds a literal mute command for timed do-not-disturb', () => {
    const before = Date.now();
    const command = buildCommands(getState(), 'mute 1h').find((entry) => entry.id === 'grammar:mute:1 hour');

    expect(command?.title).toBe('Mute notifications for 1 hour');
    command?.run();

    const until = store.getState().dndUntil;
    expect(store.getState().dndEnabled).toBe(false);
    expect(until).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it('builds literal commands for turning quiet mode on and off', () => {
    const on = buildCommands(getState(), 'quiet on').find((entry) => entry.id === 'grammar:dnd:on');
    on?.run();
    expect(store.getState().dndEnabled).toBe(true);

    store.getState().setDndUntil(Date.now() + 60_000);
    const off = buildCommands(getState(), 'unmute').find((entry) => entry.id === 'grammar:dnd:off');
    off?.run();

    expect(store.getState().dndEnabled).toBe(false);
    expect(store.getState().dndUntil).toBeNull();
  });

  it('builds literal home, preferences, and shortcuts commands', () => {
    const navigate = vi.fn();
    const openKeyboardShortcuts = vi.fn();
    setState({ navigate, openKeyboardShortcuts });

    buildCommands(getState(), 'home').find((entry) => entry.id === 'grammar:home')?.run();
    buildCommands(getState(), 'prefs').find((entry) => entry.id === 'grammar:preferences')?.run();
    buildCommands(getState(), 'shortcuts').find((entry) => entry.id === 'grammar:shortcuts')?.run();

    expect(navigate).toHaveBeenCalledWith({ kind: 'home' });
    expect(openKeyboardShortcuts).toHaveBeenCalled();
  });

  it('builds reader, density, width, and motion projection commands', () => {
    buildCommands(getState(), 'reader on').find((entry) => entry.id === 'grammar:reader:true')?.run();
    buildCommands(getState(), 'density compact').find((entry) => entry.id === 'grammar:density:compact')?.run();
    buildCommands(getState(), 'width full').find((entry) => entry.id === 'grammar:width:full')?.run();
    buildCommands(getState(), 'motion still').find((entry) => entry.id === 'grammar:motion:still')?.run();

    expect(preferences()).toMatchObject({
      readerMode: true,
      density: 'compact',
      width: 'full',
      reduceMotion: true,
    });
    expect(document.documentElement.dataset.reader).toBe('true');
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.width).toBe('full');
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
  });

  it('builds message search grammar commands', () => {
    setState({
      activeView: { kind: 'channel', channel: '#forge' },
      channels: new Map([['#forge', channel('#forge')]]),
    });

    const command = buildCommands(getState(), 'search roadmap').find((entry) => entry.id === 'grammar:search:roadmap');
    expect(command?.title).toBe('Search messages for “roadmap”');
    expect(command?.hint).toBe('#forge');
  });

  it('lists bounded reviewed anchors newest-first and makes target and preview searchable', () => {
    setState({ server: server() });
    for (let index = 0; index < 7; index += 1) {
      recordReviewHistory(review(
        `#review-${index}`,
        `2026-07-09T08:0${index}:00.000Z`,
      ), MEMORY_OWNER);
    }

    expect(readReviewHistory(MEMORY_OWNER)).toHaveLength(5);
    const commands = buildCommands(getState()).filter((entry) => entry.id.startsWith('review:'));
    expect(commands.map((entry) => entry.title)).toEqual([
      'Reopen reviewed #review-6',
      'Reopen reviewed #review-5',
      'Reopen reviewed #review-4',
      'Reopen reviewed #review-3',
      'Reopen reviewed #review-2',
    ]);
    expect(commands[0]?.keywords).toEqual(expect.arrayContaining([
      'review',
      '#review-6',
      'deployment preview in #review-6',
    ]));
  });

  it('reopens a reviewed anchor through exact-id vault travel', () => {
    setState({ server: server() });
    recordReviewHistory(review('#forge', '2026-07-09T09:00:00.000Z', {
      firstMessageId: 'forge-exact-id',
      preview: 'handoff packet approved',
    }), MEMORY_OWNER);
    const openVaultResult = vi.fn();
    const travelTo = vi.fn();
    setState({ openVaultResult, travelTo });

    const command = buildCommands(getState(), 'review #forge')
      .find((entry) => entry.id === 'review:channel:#forge:forge-exact-id');
    expect(command?.title).toBe('Reopen reviewed #forge');
    expect(command?.keywords).toContain('handoff packet approved');
    command?.run();

    expect(openVaultResult).toHaveBeenCalledWith('#forge', 'forge-exact-id');
    expect(travelTo).toHaveBeenCalledWith(
      '#forge',
      new Date('2026-07-09T08:15:00.000Z'),
      'forge-exact-id',
    );
  });

  it('focuses an exact reviewed id but refuses time travel for an invalid date', () => {
    setState({ server: server() });
    recordReviewHistory(review('aoi', '2026-07-09T09:00:00.000Z', {
      firstMessageId: 'dm-exact-id',
      firstAt: 'not-a-date',
    }), MEMORY_OWNER);
    const openVaultResult = vi.fn();
    const travelTo = vi.fn();
    setState({ openVaultResult, travelTo });

    buildCommands(getState(), 'review aoi')
      .find((entry) => entry.id === 'review:dm:aoi:dm-exact-id')
      ?.run();

    expect(openVaultResult).toHaveBeenCalledWith('aoi', 'dm-exact-id');
    expect(travelTo).not.toHaveBeenCalled();
  });

  it('sets the vault search mode to semantic, exact, and hybrid', () => {
    const semantic = buildCommands(getState(), 'vault semantic').find((entry) => entry.id === 'grammar:vault:semantic');
    expect(semantic?.title).toBe('Search device memory by related terms');
    expect(semantic?.keywords).toContain('semantic');
    semantic?.run();
    expect(vaultSearchMode()).toBe('semantic');

    const exact = buildCommands(getState(), 'vault exact').find((entry) => entry.id === 'grammar:vault:exact');
    expect(exact?.title).toBe('Search device memory by exact text');
    exact?.run();
    expect(vaultSearchMode()).toBe('exact');

    const hybrid = buildCommands(getState(), 'vault hybrid').find((entry) => entry.id === 'grammar:vault:hybrid');
    expect(hybrid?.title).toBe('Search device memory by text, then related terms');
    expect(hybrid?.keywords).toContain('hybrid');
    hybrid?.run();
    expect(vaultSearchMode()).toBe('hybrid');
  });

  it('recognizes hybrid aliases in the vault grammar', () => {
    const combined = buildCommands(getState(), 'vault combined').find((entry) => entry.id === 'grammar:vault:hybrid');
    expect(combined?.title).toBe('Search device memory by text, then related terms');
    combined?.run();
    expect(vaultSearchMode()).toBe('hybrid');
  });

  it('cycles the vault search mode through all three from the bare vault verb', () => {
    setVaultMode('hybrid');
    const fromHybrid = buildCommands(getState(), 'vault').find((entry) => entry.id === 'grammar:vault:toggle');
    expect(fromHybrid?.title).toContain('exact');
    fromHybrid?.run();
    expect(vaultSearchMode()).toBe('exact');

    const fromExact = buildCommands(getState(), 'vault mode').find((entry) => entry.id === 'grammar:vault:toggle');
    expect(fromExact?.title).toContain('related terms');
    fromExact?.run();
    expect(vaultSearchMode()).toBe('semantic');

    const fromSemantic = buildCommands(getState(), 'vault mode').find((entry) => entry.id === 'grammar:vault:toggle');
    expect(fromSemantic?.title).toContain('text, then related terms');
    fromSemantic?.run();
    expect(vaultSearchMode()).toBe('hybrid');
  });

  it('sets the on-device translation target by language name and code', () => {
    const spanish = buildCommands(getState(), 'translate spanish').find((entry) => entry.id === 'grammar:translate:es');
    expect(spanish?.title).toBe('Translate messages to Spanish');
    expect(spanish?.keywords).toContain('translation');
    spanish?.run();
    expect(translationTarget()).toBe('es');
    expect(localStorage.getItem('onyx:translation-target')).toBe('es');

    const japanese = buildCommands(getState(), 'translate ja').find((entry) => entry.id === 'grammar:translate:ja');
    expect(japanese?.title).toBe('Translate messages to Japanese');
    japanese?.run();
    expect(translationTarget()).toBe('ja');
  });

  it('clears the translation target back to the browser default', () => {
    setTranslationTarget('es');
    const command = buildCommands(getState(), 'translate off').find((entry) => entry.id === 'grammar:translate:clear');
    expect(command?.title).toContain('browser default');
    command?.run();
    expect(translationTarget()).toBe('');
  });

  it('surfaces the active channel AI policy and opens preferences', () => {
    setState({
      activeView: { kind: 'channel', channel: '#forge' },
      channels: new Map([['#forge', { ...channel('#forge'), aiPolicy: 'no-ai' } as Channel]]),
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:ai-policy');
    expect(command?.title).toContain('No AI');
    expect(command?.title).toContain('#forge');
    expect(command?.keywords).toContain('ai policy');

    expect(isPreferencesOpen()).toBe(false);
    command?.run();
    expect(isPreferencesOpen()).toBe(true);
  });

  it('omits the AI policy command when the room policy is open', () => {
    setState({
      activeView: { kind: 'channel', channel: '#forge' },
      channels: new Map([['#forge', channel('#forge')]]),
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:ai-policy');
    expect(command).toBeUndefined();
  });

  it('applies theme commands immediately', () => {
    const command = buildCommands(getState()).find((entry) => entry.id === 'theme:shu');
    command?.run();

    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
    expect(store.getState().activeTheme).toBe('shu');
    expect(store.getState().theme).toBe('shu');
    expect(localStorage.getItem('onyx:theme')).toBe('shu');
  });

  it('applies background commands immediately', () => {
    const command = buildCommands(getState()).find((entry) => entry.id === 'background:obsidian');
    command?.run();

    expect(document.documentElement.dataset.onyxBackground).toBe('obsidian');
    expect(localStorage.getItem('onyx:bg')).toBe('obsidian');
  });

  it('surfaces a catch-up command for the channel with the most unread', () => {
    const navigate = vi.fn();
    const joinChannel = vi.fn();
    setState({
      channels: new Map([
        ['#quiet', { ...channel('#quiet'), unread: 0, highlights: 0 }],
        ['#busy', { ...channel('#busy'), unread: 9, highlights: 0 }],
        ['#lapis', { ...channel('#lapis'), unread: 3, highlights: 0 }],
      ]),
      navigate,
      joinChannel,
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:catch-up:#busy');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Catch up — jump to first unread in #busy');
    expect(command?.hint).toContain('9 unread');
    expect(command?.keywords).toContain('catch up');
    expect(command?.keywords).toContain('unread');

    command?.run();
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#busy' });
    // Only one catch-up command is produced, and it targets the busiest room.
    expect(buildCommands(getState()).filter((entry) => entry.id.startsWith('action:catch-up:'))).toHaveLength(1);
  });

  it('prefers the active channel for catch-up when it has unread', () => {
    setState({
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([
        ['#busy', { ...channel('#busy'), unread: 9, highlights: 0 }],
        ['#lapis', { ...channel('#lapis'), unread: 2, highlights: 0 }],
      ]),
    });

    const active = buildCommands(getState()).find((entry) => entry.id === 'action:catch-up:#lapis');
    expect(active?.title).toBe('Catch up — jump to first unread in #lapis');
    // The busier room is not surfaced separately when the active room is chosen.
    expect(buildCommands(getState()).some((entry) => entry.id === 'action:catch-up:#busy')).toBe(false);
  });

  it('omits the catch-up command when no channel has unread', () => {
    setState({
      channels: new Map([['#lapis', { ...channel('#lapis'), unread: 0, highlights: 0 }]]),
    });

    const command = buildCommands(getState()).find((entry) => entry.id.startsWith('action:catch-up:'));
    expect(command).toBeUndefined();
  });

  it('surfaces mark-all-read and dispatches through existing per-target actions', () => {
    const markRead = vi.fn();
    const markChannelRead = vi.fn();
    setState({
      channels: new Map([
        ['#busy', { ...channel('#busy'), unread: 4, highlights: 0 }],
        ['#read', { ...channel('#read'), unread: 0, highlights: 0 }],
      ]),
      dms: new Map([
        ['aoi', { ...dm('aoi'), unread: 2 }],
        ['sora', { ...dm('sora'), unread: 0 }],
      ]),
      markRead,
      markChannelRead,
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:mark-all-read');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Mark all read');
    expect(command?.keywords).toContain('mark all read');

    command?.run();

    // Unread channel: both the count and the badge map get cleared.
    expect(markRead).toHaveBeenCalledWith('#busy');
    expect(markChannelRead).toHaveBeenCalledWith('#busy');
    // Unread DM: the count is cleared.
    expect(markRead).toHaveBeenCalledWith('aoi');
    // Already-read conversations are left untouched.
    expect(markRead).not.toHaveBeenCalledWith('#read');
    expect(markRead).not.toHaveBeenCalledWith('sora');
    expect(markChannelRead).not.toHaveBeenCalledWith('#read');
  });

  it('omits mark-all-read when nothing is unread', () => {
    setState({
      channels: new Map([['#lapis', { ...channel('#lapis'), unread: 0, highlights: 0 }]]),
      dms: new Map([['aoi', { ...dm('aoi'), unread: 0 }]]),
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:mark-all-read');
    expect(command).toBeUndefined();
  });

  it('sets an away status with a message through setAway', () => {
    const setAway = vi.fn();
    setState({ setAway });

    const command = buildCommands(getState(), 'away lunch break').find((entry) => entry.id === 'grammar:away:set');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Set away — lunch break');
    expect(command?.keywords).toContain('afk');
    command?.run();

    expect(setAway).toHaveBeenCalledWith('lunch break');
  });

  it('clears the away status from the away-off verb and the bare back verb', () => {
    const unsetAway = vi.fn();
    setState({ unsetAway });

    const off = buildCommands(getState(), 'away off').find((entry) => entry.id === 'grammar:away:clear');
    expect(off?.title).toBe('Clear away status');
    off?.run();

    const back = buildCommands(getState(), 'back').find((entry) => entry.id === 'grammar:away:clear');
    expect(back?.title).toBe('Clear away status');
    back?.run();

    expect(unsetAway).toHaveBeenCalledTimes(2);
  });

  it('does not surface an away-set command for the clear keywords', () => {
    const command = buildCommands(getState(), 'away clear').find((entry) => entry.id === 'grammar:away:set');
    expect(command).toBeUndefined();
  });

  it('toggles focus mode from the focus verb', () => {
    const toggleFocusMode = vi.fn();
    setState({ toggleFocusMode });

    const command = buildCommands(getState(), 'focus').find((entry) => entry.id === 'grammar:focus:toggle');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Toggle focus mode');
    expect(command?.keywords).toContain('distraction free');
    command?.run();

    expect(toggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it('stars and unstars a channel through the star grammar verbs', () => {
    const starChannel = vi.fn();
    const unstarChannel = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      starChannel,
      unstarChannel,
    });

    const star = buildCommands(getState(), 'star forge').find((entry) => entry.id === 'grammar:star:#forge');
    expect(star?.title).toBe('Star #forge');
    expect(star?.keywords).toContain('favorite');
    star?.run();
    expect(starChannel).toHaveBeenCalledWith('#forge');

    const unstar = buildCommands(getState(), 'unstar #forge').find((entry) => entry.id === 'grammar:unstar:#forge');
    expect(unstar?.title).toBe('Unstar #forge');
    unstar?.run();
    expect(unstarChannel).toHaveBeenCalledWith('#forge');
  });

  it('builds capability-scoped client extension actions', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    setState({ server: server(), ourNick: MEMORY_OWNER.identity });
    writeClientExtensionActionsForTests([
      {
        id: 'build.open',
        title: 'Open build dashboard',
        capability: 'open-url',
        url: 'https://example.test/build',
        keywords: ['build'],
      },
    ], MEMORY_OWNER);

    const command = buildCommands(getState()).find((entry) => entry.id === 'extension:build.open');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Open build dashboard');
    expect(command?.keywords).toContain('extension');

    command?.run();
    expect(open).toHaveBeenCalledWith('https://example.test/build', '_blank', 'noopener,noreferrer');
    expect(readClientExtensionAudit(MEMORY_OWNER)[0]).toMatchObject({
      id: 'build.open',
      capability: 'open-url',
      detail: 'Opened https://example.test',
    });
    open.mockRestore();
  });

  it('audits an extension copy only after the clipboard write succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setState({ server: server(), ourNick: MEMORY_OWNER.identity });
    writeClientExtensionActionsForTests([
      {
        id: 'branch.copy',
        title: 'Copy release branch',
        capability: 'copy-text',
        text: 'release/onyx',
      },
    ], MEMORY_OWNER);

    const command = buildCommands(getState()).find((entry) => entry.id === 'extension:branch.copy');
    await command?.run();

    expect(writeText).toHaveBeenCalledWith('release/onyx');
    expect(readClientExtensionAudit(MEMORY_OWNER)[0]).toMatchObject({
      id: 'branch.copy',
      detail: 'Copied 12 characters',
    });
  });

  it.each(['unavailable', 'rejected'] as const)(
    'does not persist a fallback payload or audit a %s extension copy',
    async (mode) => {
      const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: mode === 'unavailable' ? undefined : { writeText },
        configurable: true,
      });
      setState({ server: server(), ourNick: MEMORY_OWNER.identity });
      writeClientExtensionActionsForTests([
        {
          id: 'secret.copy',
          title: 'Copy deploy token',
          capability: 'copy-text',
          text: 'do-not-persist-this',
        },
      ], MEMORY_OWNER);

      const command = buildCommands(getState()).find((entry) => entry.id === 'extension:secret.copy');
      await command?.run();

      expect(readClientExtensionAudit(MEMORY_OWNER)).toEqual([]);
      expect(localStorage.getItem('onyx:last-copied-node-address')).toBeNull();
    },
  );

  it('does not expose another owner actions or run a command captured before an account switch', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const bobOwner = { ...MEMORY_OWNER, identity: 'bob' } as const;
    setState({ server: server(), ourNick: MEMORY_OWNER.identity });
    writeClientExtensionActionsForTests([
      {
        id: 'alice.open',
        title: 'Open Alice dashboard',
        capability: 'open-url',
        url: 'https://alice.example.test/build',
      },
    ], MEMORY_OWNER);
    writeClientExtensionActionsForTests([
      {
        id: 'bob.open',
        title: 'Open Bob dashboard',
        capability: 'open-url',
        url: 'https://bob.example.test/build',
      },
    ], bobOwner);

    const capturedAliceCommand = buildCommands(getState()).find((entry) => entry.id === 'extension:alice.open');
    expect(capturedAliceCommand).toBeDefined();

    setState({
      server: { ...server(), account: 'bob', nick: 'bob' },
      ourNick: 'bob',
    });
    const bobCommands = buildCommands(getState());
    expect(bobCommands.some((entry) => entry.id === 'extension:alice.open')).toBe(false);
    expect(bobCommands.some((entry) => entry.id === 'extension:bob.open')).toBe(true);

    capturedAliceCommand?.run();
    expect(open).not.toHaveBeenCalled();
    expect(readClientExtensionAudit(MEMORY_OWNER)).toEqual([]);
    expect(readClientExtensionAudit(bobOwner)).toEqual([]);
  });

  describe('schedule message grammar', () => {
    const FIXED_NOW = Date.parse('2026-07-12T12:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);
    });

    it('schedules a message to the active channel from a relative future time', () => {
      setState({
        channels: new Map([['#forge', channel('#forge')]]),
        activeView: { kind: 'channel', channel: '#forge' },
        server: server(),
      });

      const command = buildCommands(getState(), 'schedule 15m: ship the release').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeDefined();
      command?.run();

      const queue = store.getState().scheduledMessages;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        channel: '#forge',
        text: 'ship the release',
        sendAt: FIXED_NOW + 15 * 60_000,
        owner: { serverUrl: 'ircs://ircx.us:6697', identity: 'kain' },
      });
    });

    it('accepts a leading "in" and an active DM target', () => {
      setState({
        dms: new Map([['aoi', dm('aoi')]]),
        activeView: { kind: 'dm', nick: 'aoi' },
        server: server(),
      });

      const command = buildCommands(getState(), 'schedule in 2h: coffee?').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeDefined();
      command?.run();

      const queue = store.getState().scheduledMessages;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        channel: 'aoi',
        text: 'coffee?',
        sendAt: FIXED_NOW + 2 * 3_600_000,
        owner: { serverUrl: 'ircs://ircx.us:6697', identity: 'kain' },
      });
    });

    it('rejects an absolute time in the past', () => {
      setState({
        channels: new Map([['#forge', channel('#forge')]]),
        activeView: { kind: 'channel', channel: '#forge' },
      });

      const command = buildCommands(getState(), 'schedule 2020-01-01T09:00: too late').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeUndefined();
      expect(store.getState().scheduledMessages).toHaveLength(0);
    });

    it('offers no schedule command without an active conversation', () => {
      setState({ activeView: { kind: 'home' } });

      const command = buildCommands(getState(), 'schedule 15m: hi').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeUndefined();
    });

    it('refuses to schedule a slash command as the body', () => {
      setState({
        channels: new Map([['#forge', channel('#forge')]]),
        activeView: { kind: 'channel', channel: '#forge' },
      });

      const command = buildCommands(getState(), 'schedule 15m: /part #forge').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeUndefined();
    });

    it('offers no schedule command when the body is empty', () => {
      setState({
        channels: new Map([['#forge', channel('#forge')]]),
        activeView: { kind: 'channel', channel: '#forge' },
      });

      const command = buildCommands(getState(), 'schedule 15m:   ').find((entry) =>
        entry.id.startsWith('grammar:schedule:'),
      );
      expect(command).toBeUndefined();
    });
  });

  it('copies an irc link to the active channel through the server URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setState({
      server: server(),
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([['#lapis', channel('#lapis')]]),
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'action:copy-channel-link');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Copy channel link');
    // The channel sigil is percent-encoded so the link round-trips unambiguously.
    expect(command?.hint).toBe('ircs://ircx.us:6697/%23lapis');
    expect(command?.keywords).toContain('share');

    await command?.run();
    expect(writeText).toHaveBeenCalledWith('ircs://ircx.us:6697/%23lapis');
  });

  it('omits copy-channel-link when not viewing a channel', () => {
    setState({ server: server(), activeView: { kind: 'home' } });
    const command = buildCommands(getState()).find((entry) => entry.id === 'action:copy-channel-link');
    expect(command).toBeUndefined();
  });

  it('omits copy-channel-link when no node is connected', () => {
    setState({
      server: null,
      activeView: { kind: 'channel', channel: '#lapis' },
      channels: new Map([['#lapis', channel('#lapis')]]),
    });
    const command = buildCommands(getState()).find((entry) => entry.id === 'action:copy-channel-link');
    expect(command).toBeUndefined();
  });

  it('opens the scheduled-messages queue', () => {
    const command = buildCommands(getState(), 'scheduled').find(
      (entry) => entry.id === 'action:scheduled-messages',
    );
    expect(command).toBeDefined();
    expect(command?.keywords).toContain('send later');
    command?.run();
    expect(store.getState().showScheduledMessages).toBe(true);
  });

  it('opens the jump-to-date sheet', () => {
    const command = buildCommands(getState(), 'jump date').find(
      (entry) => entry.id === 'action:jump-to-date',
    );
    expect(command).toBeDefined();
    expect(command!.title).toBe('Jump to date…');
    expect(command!.keywords).toContain('travel');
    command!.run();
    expect(store.getState().showJumpToDate).toBe(true);
  });

  it('reserves goto date for the sheet instead of treating date as a channel', () => {
    const joinChannel = vi.fn();
    setState({ joinChannel });

    const commands = buildCommands(getState(), 'goto date');
    // Must not invent a `#date` channel join from the sheet alias.
    expect(commands.find((entry) => entry.id === 'grammar:goto:#date')).toBeUndefined();
    expect(commands.find((entry) => entry.id.startsWith('grammar:goto:'))).toBeUndefined();

    const jumpToDate = commands.find((entry) => entry.id === 'action:jump-to-date');
    expect(jumpToDate).toBeDefined();
    jumpToDate!.run();

    expect(joinChannel).not.toHaveBeenCalled();
    expect(store.getState().showJumpToDate).toBe(true);
  });
});
