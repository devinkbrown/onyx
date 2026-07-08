import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundOptions } from '@/backgrounds';
import type { Channel } from '@/lib/irc/types';
import { getState, setState } from '@/lib/store';
import { store } from '@/lib/store/store';
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
    store.setState(initialState, true);
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
});
