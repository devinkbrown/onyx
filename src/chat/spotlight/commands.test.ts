import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundOptions } from '@/backgrounds';
import type { Channel } from '@/lib/irc/types';
import { getState, setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';
import {
  readClientExtensionAudit,
  writeClientExtensionActionsForTests,
} from '@/lib/extensions/clientActions';
import type { DMConversation, Server } from '@/lib/store/store';
import { THEME_IDS } from '@/theme';
import { buildCommands } from './commands';

const initialState = store.getInitialState();

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

describe('buildCommands', () => {
  beforeEach(() => {
    vi.useRealTimers();
    store.setState(initialState, true);
    resetPreferences();
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
      joinChannel,
      navigate,
    });

    const command = buildCommands(getState()).find((entry) => entry.id === 'channel:#forge');
    command?.run();

    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
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

    expect(command?.title).toContain('Go to #forge at');
    command?.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date(2026, 6, 7, 21, 0, 0, 0));
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

    expect(command?.title).toContain('Jump #forge to');
    command?.run();
    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(travelTo).toHaveBeenCalledWith('#forge', new Date('2026-07-08T09:00:00.000Z'));
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

  it('builds capability-scoped client extension actions', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    writeClientExtensionActionsForTests([
      {
        id: 'build.open',
        title: 'Open build dashboard',
        capability: 'open-url',
        url: 'https://example.test/build',
        keywords: ['build'],
      },
    ]);

    const command = buildCommands(getState()).find((entry) => entry.id === 'extension:build.open');
    expect(command?.section).toBe('Actions');
    expect(command?.title).toBe('Open build dashboard');
    expect(command?.keywords).toContain('extension');

    command?.run();
    expect(open).toHaveBeenCalledWith('https://example.test/build', '_blank', 'noopener,noreferrer');
    expect(readClientExtensionAudit()[0]).toMatchObject({
      id: 'build.open',
      capability: 'open-url',
      detail: 'Opened https://example.test',
    });
    open.mockRestore();
  });
});
