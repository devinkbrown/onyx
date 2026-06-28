import { createMemo, type Accessor } from 'solid-js';
import { backgroundOptions, type BackgroundId } from '@/backgrounds';
import { getState, useStore } from '@/lib/store';
import type { State } from '@/lib/store/store';
import { applyThemeToDom, THEME_IDS, THEMES, type ThemeId } from '@/theme';
import { saveRecent } from '@/lib/commands/registry';

export type SpotlightSection = 'Channels' | 'DMs' | 'People' | 'Actions';

export type SpotlightCommand = {
  id: string;
  section: SpotlightSection;
  title: string;
  hint?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

type CommandState = Pick<State, 'channels' | 'dms' | 'server' | 'networkName' | 'activeView' | 'showMemberList' | 'voice'>;

const THEME_STORAGE_KEY = 'ruri:theme';
const BACKGROUND_STORAGE_KEY = 'ruri:bg';

function normalizeChannel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function navigateTo(path: string): void {
  if (typeof window === 'undefined') return;

  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function persistTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

function applyTheme(id: ThemeId): void {
  applyThemeToDom(id);
  persistTheme(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ruri:theme-change', { detail: { id } }));
  }
}

function applyBackground(id: BackgroundId): void {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.ruriBackground = id;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ruri:background-change', { detail: { id } }));
  }
}

async function copyText(text: string): Promise<void> {
  if (!text) return;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  try {
    localStorage.setItem('ruri:last-copied-node-address', text);
  } catch {
    /* storage unavailable */
  }
}

function channelHint(channel: CommandState['channels'] extends Map<string, infer C> ? C : never): string {
  const parts = [`${channel.users.size} users`];
  if (channel.unread > 0) parts.push(`${channel.unread} unread`);
  if (channel.topic) parts.push(channel.topic);
  return parts.join(' · ');
}

function dmHint(dm: CommandState['dms'] extends Map<string, infer D> ? D : never): string {
  const parts = [];
  if (dm.account) parts.push(dm.account);
  if (dm.away) parts.push('away');
  if (dm.unread > 0) parts.push(`${dm.unread} unread`);
  return parts.join(' · ');
}

function baseActionCommands(state: CommandState): SpotlightCommand[] {
  const nodeAddress = state.server?.url ?? '';
  const inVoice = state.voice.callState !== 'idle';
  const activeChannel = state.activeView.kind === 'channel' ? state.activeView.channel : null;

  return [
    {
      id: 'action:join-channel',
      section: 'Actions',
      title: 'Join channel...',
      hint: 'Open a channel by name',
      keywords: ['channel', 'join', 'irc'],
      run: () => {
        const raw = typeof window === 'undefined' ? '' : window.prompt('Join channel', '#');
        const channel = normalizeChannel(raw ?? '');
        if (!channel) return;

        const current = getState();
        current.joinChannel(channel);
        current.navigate({ kind: 'channel', channel });
      },
    },
    {
      id: 'action:appearance',
      section: 'Actions',
      title: 'Appearance — theme & background',
      hint: 'panel',
      keywords: ['theme', 'background', 'customize', 'appearance', 'color', 'dark', 'light'],
      run: () => getState().openAppearance(),
    },
    {
      id: 'action:theme-studio',
      section: 'Actions',
      title: 'Open Theme Studio',
      hint: '/appearance',
      keywords: ['theme', 'studio', 'custom', 'tokens', 'editor', 'create theme'],
      run: () => navigateTo('/appearance'),
    },
    {
      id: 'action:toggle-member-list',
      section: 'Actions',
      title: state.showMemberList ? 'Hide member list' : 'Show member list',
      hint: 'Alt+M',
      keywords: ['members', 'sidebar', 'panel', 'people', 'list'],
      run: () => getState().toggleMemberList(),
    },
    {
      id: 'action:focus-composer',
      section: 'Actions',
      title: 'Focus composer',
      hint: 'Alt+Enter',
      keywords: ['compose', 'type', 'message', 'input', 'chat'],
      run: () => {
        const el = typeof document !== 'undefined'
          ? document.querySelector<HTMLElement>('[data-composer-input]')
          : null;
        el?.focus();
      },
    },
    ...(!inVoice && activeChannel
      ? [
          {
            id: 'action:start-voice',
            section: 'Actions' as SpotlightSection,
            title: 'Start voice in current channel',
            hint: activeChannel,
            keywords: ['voice', 'audio', 'call', 'join'],
            run: () => {
              const current = getState();
              const view = current.activeView;
              if (view.kind === 'channel') {
                void current.joinVoiceChannel(view.channel, false);
              }
            },
          },
          {
            id: 'action:start-video',
            section: 'Actions' as SpotlightSection,
            title: 'Start video in current channel',
            hint: activeChannel,
            keywords: ['video', 'camera', 'call', 'join'],
            run: () => {
              const current = getState();
              const view = current.activeView;
              if (view.kind === 'channel') {
                void current.joinVoiceChannel(view.channel, true);
              }
            },
          },
        ]
      : []),
    {
      id: 'action:disconnect',
      section: 'Actions',
      title: 'Disconnect',
      hint: state.networkName || state.server?.name || 'Current node',
      keywords: ['quit', 'close', 'server', 'node'],
      run: () => getState().disconnect(),
    },
    {
      id: 'action:copy-node-address',
      section: 'Actions',
      title: 'Copy node address',
      hint: nodeAddress || 'No node connected',
      keywords: ['copy', 'server', 'url', 'address', 'node'],
      run: () => copyText(getState().server?.url ?? ''),
    },
  ];
}

/**
 * Build "People" commands — members of the active channel who aren't already
 * in the DMs list. Provides a fast way to jump to a DM with anyone you can see.
 */
function peopleCommands(state: CommandState): SpotlightCommand[] {
  const view = state.activeView;
  if (view.kind !== 'channel') return [];

  const channel = state.channels.get(view.channel);
  if (!channel) return [];

  const dmNicks = new Set(Array.from(state.dms.keys()).map((n) => n.toLowerCase()));

  return Array.from(channel.users.values())
    .filter((user) => !dmNicks.has(user.nick.toLowerCase()))
    .sort((a, b) => a.nick.localeCompare(b.nick))
    .map<SpotlightCommand>((user) => ({
      id: `people:${user.nick.toLowerCase()}`,
      section: 'People',
      title: `Message ${user.nick}`,
      hint: user.account ? `@${user.account}` : undefined,
      keywords: [user.nick, user.account ?? '', 'dm', 'message', 'people'],
      run: () => {
        saveRecent({ id: `people:${user.nick.toLowerCase()}`, label: `Message ${user.nick}`, section: 'People' });
        getState().navigate({ kind: 'dm', nick: user.nick });
      },
    }));
}

export function buildCommands(state: CommandState = getState()): SpotlightCommand[] {
  const seenChannels = new Set<string>();
  const channels = Array.from(state.channels.values())
    .filter((channel) => {
      const key = channel.name.toLowerCase();
      if (seenChannels.has(key)) return false;
      seenChannels.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<SpotlightCommand>((channel) => ({
      id: `channel:${channel.name.toLowerCase()}`,
      section: 'Channels',
      title: `Go to ${channel.name}`,
      hint: channelHint(channel),
      keywords: [channel.name, channel.name.replace(/^#/, ''), channel.topic],
      run: () => {
        const current = getState();
        saveRecent({ id: `channel:${channel.name.toLowerCase()}`, label: `Go to ${channel.name}`, section: 'Channels' });
        current.joinChannel(channel.name);
        current.navigate({ kind: 'channel', channel: channel.name });
      },
    }));

  const dms = Array.from(state.dms.values())
    .sort((a, b) => a.nick.localeCompare(b.nick))
    .map<SpotlightCommand>((dm) => ({
      id: `dm:${dm.nick.toLowerCase()}`,
      section: 'DMs',
      title: `Open DM with ${dm.nick}`,
      hint: dmHint(dm),
      keywords: [dm.nick, dm.account ?? '', 'direct message', 'dm'],
      run: () => {
        saveRecent({ id: `dm:${dm.nick.toLowerCase()}`, label: `Open DM with ${dm.nick}`, section: 'DMs' });
        getState().navigate({ kind: 'dm', nick: dm.nick });
      },
    }));

  const themeCommands = THEME_IDS.map<SpotlightCommand>((id) => ({
    id: `theme:${id}`,
    section: 'Actions',
    title: `Switch theme: ${THEMES[id].label}`,
    hint: THEMES[id].description,
    keywords: ['theme', id, THEMES[id].label],
    run: () => applyTheme(id),
  }));

  const backgroundCommands = backgroundOptions.map<SpotlightCommand>((option) => ({
    id: `background:${option.id}`,
    section: 'Actions',
    title: `Switch background: ${option.label}`,
    hint: option.kind,
    keywords: ['background', option.id, option.label, option.kind],
    run: () => applyBackground(option.id as BackgroundId),
  }));

  return [
    ...channels,
    ...dms,
    ...peopleCommands(state),
    ...baseActionCommands(state),
    ...themeCommands,
    ...backgroundCommands,
  ];
}

export function useCommands(): Accessor<SpotlightCommand[]> {
  const state = useStore(
    (store) => ({
      channels: store.channels,
      dms: store.dms,
      server: store.server,
      networkName: store.networkName,
      activeView: store.activeView,
      showMemberList: store.showMemberList,
      voice: store.voice,
    }),
    (a, b) => (
      a.channels === b.channels &&
      a.dms === b.dms &&
      a.server === b.server &&
      a.networkName === b.networkName &&
      a.activeView === b.activeView &&
      a.showMemberList === b.showMemberList &&
      a.voice === b.voice
    ),
  );

  return createMemo(() => buildCommands(state()));
}
