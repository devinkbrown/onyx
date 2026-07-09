import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { backgroundOptions, type BackgroundId } from '@/backgrounds';
import { getState, useStore } from '@/lib/store';
import type { State } from '@/lib/store/store';
import { applyThemeToDom, THEME_IDS, THEMES, type ThemeId } from '@/theme';
import { saveRecent } from '@/lib/commands/registry';
import {
  openPreferences,
  preferences,
  setPreference,
  type Density,
  type Width,
} from '@/lib/prefs/preferences';
import { openMessageSearchWithQuery } from '@/shell/search/useMessageSearch';
import { readClientExtensionActions, type ClientExtensionAction } from '@/lib/extensions/clientActions';
import { useSpotlight } from './useSpotlight';
import { parseTimeExpr } from './timeGrammar';

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

const BACKGROUND_STORAGE_KEY = 'onyx:bg';
const SPOTLIGHT_INPUT_ID = 'onyx-spotlight-input';

const JUMP_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function normalizeChannel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function activeTarget(state: Pick<State, 'activeView'>): string | null {
  const view = state.activeView;
  if (view.kind === 'channel') return view.channel;
  if (view.kind === 'dm') return view.nick;
  return null;
}

function activeTargetLabel(state: Pick<State, 'activeView'>): string {
  const view = state.activeView;
  if (view.kind === 'channel') return view.channel;
  if (view.kind === 'dm') return `@${view.nick}`;
  return '';
}

function timeExprFromQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.toLowerCase().startsWith('at:')) return trimmed.slice(3).trim();
  if (trimmed.startsWith('@')) return trimmed.slice(1).trim();
  return null;
}

function commandArg(query: string, command: string): string | null {
  const trimmed = query.trim();
  const prefix = `${command} `;
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length).trim() : null;
}

function exactCommand(query: string, ...commands: string[]): boolean {
  const normalized = query.trim().toLowerCase();
  return commands.some((command) => normalized === command);
}

function splitAtKeyword(value: string): { before: string; after: string } | null {
  const match = /^(.+?)\s+at\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const before = match[1]?.trim() ?? '';
  const after = match[2]?.trim() ?? '';
  return before && after ? { before, after } : null;
}

function parseTargetedTimeArg(value: string): { target: string; expr: string } | null {
  const trimmed = value.trim();
  const match = /^([#&][^\s,]+)\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  return {
    target: normalizeChannel(match[1] ?? ''),
    expr: match[2]?.trim() ?? '',
  };
}

function parseMuteDuration(expr: string): { ms: number; label: string } | null {
  const match = expr.trim().match(/^(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0) return null;
  const unit = match[2]!.toLowerCase();
  const multiplier =
    unit.startsWith('m') ? 60_000 :
    unit.startsWith('h') ? 3_600_000 :
    86_400_000;
  const ms = value * multiplier;
  if (ms > 7 * 86_400_000) return null;
  const noun =
    multiplier === 60_000 ? 'minute' :
    multiplier === 3_600_000 ? 'hour' :
    'day';
  return { ms, label: `${value} ${noun}${value === 1 ? '' : 's'}` };
}

function parseDensityArg(value: string): Density | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'compact' || normalized === 'cozy' || normalized === 'roomy') return normalized;
  if (normalized === 'dense') return 'compact';
  if (normalized === 'reader') return 'roomy';
  return null;
}

function parseWidthArg(value: string): Width | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'wide') return 'full';
  if (normalized === 'measured' || normalized === 'measure' || normalized === 'narrow') return 'measured';
  return null;
}

function readSpotlightQuery(): string {
  if (typeof document === 'undefined') return '';
  const input = document.getElementById(SPOTLIGHT_INPUT_ID);
  return input instanceof HTMLInputElement ? input.value : '';
}

function timeJumpCommands(state: CommandState, query: string): SpotlightCommand[] {
  const commands: SpotlightCommand[] = [];
  const atArg = commandArg(query, 'at');
  const targetTime = atArg ? parseTargetedTimeArg(atArg) : null;
  if (targetTime) {
    const at = parseTimeExpr(targetTime.expr);
    if (!at) return [];

    commands.push({
      id: `action:time-jump:${targetTime.target.toLowerCase()}:${at.toISOString()}`,
      section: 'Actions',
      title: `Jump ${targetTime.target} to ${JUMP_TIME_FORMATTER.format(at)}`,
      hint: 'time grammar',
      keywords: [query.trim(), targetTime.target, targetTime.expr, 'at', 'jump time history'],
      run: () => {
        const current = getState();
        current.joinChannel(targetTime.target);
        current.navigate({ kind: 'channel', channel: targetTime.target });
        current.travelTo(targetTime.target, at);
      },
    });
    return commands;
  }

  const expr = atArg ?? timeExprFromQuery(query);
  if (!expr) return [];

  const target = activeTarget(state);
  if (!target) return [];

  const at = parseTimeExpr(expr);
  if (!at) return [];

  return [
    {
      id: `action:time-jump:${target}:${at.toISOString()}`,
      section: 'Actions',
      title: `Jump to ${JUMP_TIME_FORMATTER.format(at)}`,
      hint: activeTargetLabel(state),
      keywords: [query.trim(), expr, 'at', 'jump time history'],
      run: () => {
        const current = getState();
        const currentTarget = activeTarget(current);
        if (!currentTarget) return;
        current.travelTo(currentTarget, at);
      },
    },
  ];
}

function grammarCommands(state: CommandState, query: string): SpotlightCommand[] {
  const commands: SpotlightCommand[] = [];
  const gotoArg = commandArg(query, 'goto') ?? commandArg(query, 'join') ?? commandArg(query, 'open');
  if (gotoArg) {
    const timed = splitAtKeyword(gotoArg);
    const channel = normalizeChannel(timed?.before ?? gotoArg);
    if (channel.length > 1) {
      const known = state.channels.get(channel.toLowerCase());
      const at = timed ? parseTimeExpr(timed.after) : null;
      commands.push({
        id: at
          ? `grammar:goto-time:${channel.toLowerCase()}:${at.toISOString()}`
          : `grammar:goto:${channel.toLowerCase()}`,
        section: 'Actions',
        title: at
          ? `Go to ${known?.name ?? channel} at ${JUMP_TIME_FORMATTER.format(at)}`
          : known ? `Go to ${known.name}` : `Join ${channel}`,
        hint: at ? 'time grammar' : known ? channelHint(known) : 'channel',
        keywords: [query.trim(), 'goto', 'join', 'open', 'go to', channel, timed?.after ?? ''],
        run: () => {
          const current = getState();
          current.joinChannel(known?.name ?? channel);
          current.navigate({ kind: 'channel', channel: known?.name ?? channel });
          if (at) current.travelTo(known?.name ?? channel, at);
        },
      });
    }
  }

  const dmArg = commandArg(query, 'dm');
  if (dmArg) {
    const nick = dmArg.replace(/^@/, '').trim();
    if (/^[^\s,]{1,64}$/.test(nick)) {
      const known = state.dms.get(nick.toLowerCase());
      commands.push({
        id: `grammar:dm:${nick.toLowerCase()}`,
        section: 'Actions',
        title: `Open DM with ${known?.nick ?? nick}`,
        hint: known ? dmHint(known) : '@nick',
        keywords: [query.trim(), 'dm', 'message', nick],
        run: () => getState().navigate({ kind: 'dm', nick: known?.nick ?? nick }),
      });
    }
  }

  const muteArg = commandArg(query, 'mute');
  if (muteArg) {
    if (/^(off|clear|cancel)$/i.test(muteArg)) {
      commands.push({
        id: 'grammar:mute:off',
        section: 'Actions',
        title: 'Turn off do not disturb',
        hint: 'notifications',
        keywords: [query.trim(), 'mute', 'unmute', 'do not disturb', 'off'],
        run: () => {
          const current = getState();
          current.setDndEnabled(false);
          current.setDndUntil(null);
        },
      });
      return commands;
    }

    const duration = parseMuteDuration(muteArg);
    if (duration) {
      commands.push({
        id: `grammar:mute:${duration.label}`,
        section: 'Actions',
        title: `Mute notifications for ${duration.label}`,
        hint: 'Do not disturb',
        keywords: [query.trim(), 'mute', 'do not disturb', duration.label],
        run: () => {
          const current = getState();
          current.setDndEnabled(false);
          current.setDndUntil(Date.now() + duration.ms);
        },
      });
    }
  }

  if (exactCommand(query, 'unmute', 'dnd off', 'quiet off')) {
    commands.push({
      id: 'grammar:dnd:off',
      section: 'Actions',
      title: 'Turn off do not disturb',
      hint: 'notifications',
      keywords: [query.trim(), 'unmute', 'dnd off', 'quiet off'],
      run: () => {
        const current = getState();
        current.setDndEnabled(false);
        current.setDndUntil(null);
      },
    });
  }

  if (exactCommand(query, 'dnd on', 'quiet on', 'do not disturb')) {
    commands.push({
      id: 'grammar:dnd:on',
      section: 'Actions',
      title: 'Turn on do not disturb',
      hint: 'notifications',
      keywords: [query.trim(), 'dnd on', 'quiet on', 'mute'],
      run: () => getState().setDndEnabled(true),
    });
  }

  if (exactCommand(query, 'home', 'go home')) {
    commands.push({
      id: 'grammar:home',
      section: 'Actions',
      title: 'Go home',
      hint: 'catch-up',
      keywords: [query.trim(), 'home', 'catch up'],
      run: () => getState().navigate({ kind: 'home' }),
    });
  }

  const searchArg = commandArg(query, 'search') ?? commandArg(query, 'find');
  if (searchArg) {
    commands.push({
      id: `grammar:search:${searchArg.toLowerCase()}`,
      section: 'Actions',
      title: `Search messages for “${searchArg}”`,
      hint: activeTargetLabel(state) || 'current conversation',
      keywords: [query.trim(), 'search', 'find', searchArg],
      run: () => openMessageSearchWithQuery(searchArg),
    });
  }

  const readerArg = commandArg(query, 'reader');
  if (readerArg || exactCommand(query, 'reader')) {
    const normalized = (readerArg ?? 'toggle').trim().toLowerCase();
    const enabled = normalized === 'on' || normalized === 'yes'
      ? true
      : normalized === 'off' || normalized === 'no'
        ? false
        : null;
    commands.push({
      id: `grammar:reader:${enabled === null ? 'toggle' : String(enabled)}`,
      section: 'Actions',
      title: enabled === null ? 'Toggle reader mode' : `${enabled ? 'Turn on' : 'Turn off'} reader mode`,
      hint: 'reading projection',
      keywords: [query.trim(), 'reader', 'reader mode', 'projection'],
      run: () => setPreference('readerMode', enabled ?? !preferencesSnapshot().readerMode),
    });
  }

  const densityArg = commandArg(query, 'density');
  if (densityArg) {
    const density = parseDensityArg(densityArg);
    if (density) {
      commands.push({
        id: `grammar:density:${density}`,
        section: 'Actions',
        title: `Set density to ${density}`,
        hint: 'projection',
        keywords: [query.trim(), 'density', 'compact', 'cozy', 'roomy', density],
        run: () => setPreference('density', density),
      });
    }
  }

  const widthArg = commandArg(query, 'width');
  if (widthArg) {
    const width = parseWidthArg(widthArg);
    if (width) {
      commands.push({
        id: `grammar:width:${width}`,
        section: 'Actions',
        title: `Set conversation width to ${width}`,
        hint: 'reading measure',
        keywords: [query.trim(), 'width', 'measure', 'full', 'measured', width],
        run: () => setPreference('width', width),
      });
    }
  }

  const motionArg = commandArg(query, 'motion');
  if (motionArg) {
    const normalized = motionArg.trim().toLowerCase();
    const reduceMotion = normalized === 'still' || normalized === 'off' || normalized === 'reduced'
      ? true
      : normalized === 'animated' || normalized === 'on'
        ? false
        : null;
    if (reduceMotion !== null) {
      commands.push({
        id: `grammar:motion:${reduceMotion ? 'still' : 'animated'}`,
        section: 'Actions',
        title: reduceMotion ? 'Use still motion mode' : 'Use animated motion mode',
        hint: 'accessibility',
        keywords: [query.trim(), 'motion', 'animation', 'still', 'animated'],
        run: () => setPreference('reduceMotion', reduceMotion),
      });
    }
  }

  if (exactCommand(query, 'preferences', 'prefs', 'settings')) {
    commands.push({
      id: 'grammar:preferences',
      section: 'Actions',
      title: 'Open preferences',
      hint: 'panel',
      keywords: [query.trim(), 'preferences', 'prefs', 'settings'],
      run: () => openPreferences(),
    });
  }

  if (exactCommand(query, 'shortcuts', 'keyboard')) {
    commands.push({
      id: 'grammar:shortcuts',
      section: 'Actions',
      title: 'Open keyboard shortcuts',
      hint: '?',
      keywords: [query.trim(), 'shortcuts', 'keyboard', 'keys'],
      run: () => getState().openKeyboardShortcuts(),
    });
  }

  return commands;
}

function preferencesSnapshot() {
  return preferences();
}

function navigateTo(path: string): void {
  if (typeof window === 'undefined') return;

  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function applyTheme(id: ThemeId): void {
  applyThemeToDom(id);
  getState().setTheme(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('onyx:theme-change', { detail: { id } }));
  }
}

function applyBackground(id: BackgroundId): void {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.onyxBackground = id;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('onyx:background-change', { detail: { id } }));
  }
}

async function copyText(text: string): Promise<void> {
  if (!text) return;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  try {
    localStorage.setItem('onyx:last-copied-node-address', text);
  } catch {
    /* storage unavailable */
  }
}

function runClientExtensionAction(action: ClientExtensionAction): void | Promise<void> {
  if (action.capability === 'open-url' && action.url) {
    if (typeof window !== 'undefined') window.open(action.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (action.capability === 'copy-text' && action.text) {
    return copyText(action.text);
  }
}

function clientExtensionCommands(): SpotlightCommand[] {
  return readClientExtensionActions().map((action) => ({
    id: `extension:${action.id}`,
    section: 'Actions',
    title: action.title,
    hint: action.hint,
    keywords: ['extension', action.capability, ...action.keywords],
    run: () => runClientExtensionAction(action),
  }));
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
      id: 'action-browse-channels',
      section: 'Actions',
      title: 'Browse channels',
      hint: 'Every public channel on the network (LIST)',
      keywords: ['channels', 'browse', 'list', 'discover', 'directory'],
      run: () => {
        const current = getState();
        current.refreshChannelList();
        current.openChannelBrowser();
      },
    },
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
      id: 'action:preferences',
      section: 'Actions',
      title: 'Preferences — display & behaviour',
      hint: 'panel',
      keywords: ['preferences', 'settings', 'density', 'font', 'size', 'width', 'motion', 'events', 'display', 'behaviour', 'behavior'],
      run: () => openPreferences(),
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

export function buildCommands(state: CommandState = getState(), query = ''): SpotlightCommand[] {
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
    ...grammarCommands(state, query),
    ...timeJumpCommands(state, query),
    ...channels,
    ...dms,
    ...peopleCommands(state),
    ...baseActionCommands(state),
    ...clientExtensionCommands(),
    ...themeCommands,
    ...backgroundCommands,
  ];
}

export function useCommands(): Accessor<SpotlightCommand[]> {
  const spotlight = useSpotlight();
  const [query, setQuery] = createSignal('');
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

  onMount(() => {
    const handleInput = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === SPOTLIGHT_INPUT_ID) {
        setQuery(target.value);
      }
    };

    document.addEventListener('input', handleInput);
    onCleanup(() => document.removeEventListener('input', handleInput));
  });

  createEffect(() => {
    if (!spotlight.isOpen()) {
      setQuery('');
      return;
    }

    queueMicrotask(() => setQuery(readSpotlightQuery()));
  });

  const commands = createMemo(() => buildCommands(state(), query()));
  return commands;
}
