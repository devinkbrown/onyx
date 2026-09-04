// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/commands/registry.ts
 *
 * Typed command registry that powers the command palette. Commands from
 * every feature area register here so the palette is extensible without
 * touching the spotlight component.
 *
 * This module intentionally has no SolidJS dependency — it is pure TS so it
 * can be imported by tests and by non-component code alike.
 */

import {
  deviceMemoryStorageKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandSection = 'Rooms' | 'DMs' | 'People' | 'Actions';

/**
 * A single palette entry. The registry stores these; the palette displays them.
 *
 * `id`       — unique stable key used for recents tracking.
 * `section`  — groups entries in the result list.
 * `label`    — primary display text shown in the palette.
 * `icon`     — optional short glyph (1-2 chars or emoji) shown before the label.
 * `hint`     — secondary text (metadata, path, shortcut, …).
 * `keywords` — extra words used during fuzzy search (not displayed).
 * `run`      — invoked when the user picks this entry.
 */
export type PaletteCommand = {
  id: string;
  section: CommandSection;
  label: string;
  icon?: string;
  hint?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

// ── Registry singleton ────────────────────────────────────────────────────────

const _commands = new Map<string, PaletteCommand>();

/**
 * Register one command. Overwrites any previous registration with the same id.
 * Idempotent when called multiple times with identical arguments.
 */
export function registerCommand(command: PaletteCommand): void {
  _commands.set(command.id, command);
}

/**
 * Remove a command by id. No-op if the id is not registered.
 */
export function unregisterCommand(id: string): void {
  _commands.delete(id);
}

/**
 * Return all registered commands in registration order (Map preserves insertion).
 */
export function getCommands(): PaletteCommand[] {
  return Array.from(_commands.values());
}

/**
 * Return only commands in the given section.
 */
export function getCommandsBySection(section: CommandSection): PaletteCommand[] {
  return Array.from(_commands.values()).filter((cmd) => cmd.section === section);
}

/**
 * Clear every registered command. Primarily for tests.
 */
export function clearCommands(): void {
  _commands.clear();
}

// ── Recent targets ────────────────────────────────────────────────────────────

export const PALETTE_RECENTS_STORAGE_KEY = 'onyx:palette-recents';
export const MAX_PALETTE_RECENTS_STORAGE_CHARS = 16 * 1024;
/** Legacy key from the previous brand name; read-only for one-time migration. */
const MAX_RECENTS = 6;
const MAX_RECENT_ID_LENGTH = 256;
const MAX_RECENT_LABEL_LENGTH = 256;
const MAX_RECENT_TIMESTAMP_LENGTH = 40;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type RecentTarget = {
  id: string;
  label: string;
  section: CommandSection;
  /** ISO timestamp of last access */
  at: string;
};

function recentStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(PALETTE_RECENTS_STORAGE_KEY, owner) : null;
}

function purgeOwnerlessRecents(): void {
  localStorage.removeItem(PALETTE_RECENTS_STORAGE_KEY);
}

function parseRecentTarget(value: unknown): RecentTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { id, label, section: rawSection, at } = value as Record<string, unknown>;
  // Legacy palette recents stored section as `Channels`; normalize to `Rooms`.
  const section = rawSection === 'Channels' ? 'Rooms' : rawSection;
  if (
    typeof id !== 'string'
    || id.length === 0
    || id.length > MAX_RECENT_ID_LENGTH
    || CONTROL_CHARACTERS.test(id)
    || typeof label !== 'string'
    || label.length === 0
    || label.length > MAX_RECENT_LABEL_LENGTH
    || CONTROL_CHARACTERS.test(label)
    || (section !== 'Rooms' && section !== 'DMs' && section !== 'People' && section !== 'Actions')
    || typeof at !== 'string'
    || at.length === 0
    || at.length > MAX_RECENT_TIMESTAMP_LENGTH
    || !Number.isFinite(Date.parse(at))
  ) return null;
  return { id, label, section, at };
}

/**
 * Load recent targets from localStorage. Returns newest-first.
 */
export function loadRecents(owner?: DeviceMemoryOwner): RecentTarget[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    purgeOwnerlessRecents();
    const key = recentStorageKey(owner);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_PALETTE_RECENTS_STORAGE_CHARS) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENTS).flatMap((entry) => {
      const recent = parseRecentTarget(entry);
      return recent ? [recent] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Persist a recently-used command id + label. The entry is moved to the front
 * if it already exists.
 */
export function saveRecent(
  target: Omit<RecentTarget, 'at'>,
  owner?: DeviceMemoryOwner,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    purgeOwnerlessRecents();
    const key = recentStorageKey(owner);
    if (!key) return;
    const nextTarget = parseRecentTarget({ ...target, at: new Date().toISOString() });
    if (!nextTarget) return;
    const existing = loadRecents(owner).filter((r) => r.id !== target.id);
    const next: RecentTarget[] = [
      nextTarget,
      ...existing,
    ].slice(0, MAX_RECENTS);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Remove all recents. Primarily for tests.
 */
export function clearRecents(owner?: DeviceMemoryOwner): void {
  if (typeof localStorage === 'undefined') return;
  try {
    purgeOwnerlessRecents();
    const key = recentStorageKey(owner);
    if (key) localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

// ── Slash-command registry (composer) ──────────────────────────────────────
export type SlashCommandKind = 'irc' | 'text';

export type SlashCommand = {
  name: string;
  usage: string;
  description: string;
  kind: SlashCommandKind;
  aliases?: readonly string[];
  insertText?: string;
  /**
   * Network-operator command. Suggestions hide these unless the session holds
   * oper status, so ordinary members are never shown a verb the daemon would
   * answer with 481. `findSlashCommand` still resolves them, so `/help kill`
   * explains the command and the store keeps one validation path.
   */
  oper?: true;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'me', usage: '/me <action>', description: 'Send an action message.', kind: 'irc' },
  { name: 'topic', usage: '/topic <text>', description: 'Set or view the room topic.', kind: 'irc' },
  { name: 'nick', usage: '/nick <nick>', description: 'Change your nick.', kind: 'irc' },
  { name: 'join', usage: '/join #room', description: 'Join a room.', kind: 'irc', aliases: ['j'] },
  { name: 'part', usage: '/part [#room]', description: 'Leave the current or named room.', kind: 'irc', aliases: ['leave'] },
  { name: 'msg', usage: '/msg <nick> <text>', description: 'Send a private message.', kind: 'irc', aliases: ['query'] },
  { name: 'whois', usage: '/whois <nick>', description: 'Request profile details.', kind: 'irc' },
  { name: 'invite', usage: '/invite <nick>', description: 'Invite someone into the room.', kind: 'irc' },
  { name: 'event', usage: '/event <YYYY-MM-DDThh:mmZ> <title>', description: 'Schedule a room event (ops); /event clear to remove.', kind: 'irc' },
  { name: 'webhook', usage: '/webhook <create|list|delete> ...', description: 'Manage Discord-compatible incoming webhooks (ops).', kind: 'irc' },
  // Platform expansion (Era 3 wave)
  { name: 'notice', usage: '/notice <target> <text>', description: 'Send a notice (no auto-reply expectation).', kind: 'irc' },
  { name: 'away', usage: '/away [message]', description: 'Set or clear away status.', kind: 'irc' },
  { name: 'back', usage: '/back', description: 'Clear away status.', kind: 'irc', aliases: ['unaway'] },
  { name: 'mode', usage: '/mode <target> [modes]', description: 'View or change room/user modes.', kind: 'irc' },
  { name: 'kick', usage: '/kick <nick> [reason]', description: 'Remove a person from the room (ops).', kind: 'irc' },
  { name: 'ban', usage: '/ban <mask>', description: 'Ban a hostmask from the room (ops).', kind: 'irc' },
  { name: 'unban', usage: '/unban <mask>', description: 'Remove a room ban (ops).', kind: 'irc' },
  { name: 'op', usage: '/op <nick>', description: 'Grant room operator (ops).', kind: 'irc' },
  { name: 'deop', usage: '/deop <nick>', description: 'Remove room operator (ops).', kind: 'irc' },
  { name: 'voice', usage: '/voice <nick>', description: 'Grant voice in a moderated room (ops).', kind: 'irc' },
  { name: 'devoice', usage: '/devoice <nick>', description: 'Remove voice (ops).', kind: 'irc' },
  { name: 'quote', usage: '/quote <raw>', description: 'Send a raw IRC line (advanced).', kind: 'irc', aliases: ['raw'] },
  { name: 'clear', usage: '/clear', description: 'Clear local scrollback for this view (this device only).', kind: 'irc' },
  { name: 'ignore', usage: '/ignore <nick>', description: 'Hide a nick and silence their notifications locally.', kind: 'irc' },
  { name: 'unignore', usage: '/unignore <nick>', description: 'Stop ignoring a nick.', kind: 'irc' },
  { name: 'read', usage: '/read', description: 'Mark this room or DM as read.', kind: 'irc', aliases: ['markread'] },
  { name: 'star', usage: '/star [#channel]', description: 'Star the current (or named) room as a favorite.', kind: 'irc' },
  { name: 'unstar', usage: '/unstar [#channel]', description: 'Remove a room from favorites.', kind: 'irc' },
  { name: 'mute', usage: '/mute [#channel]', description: 'Mute notifications for the current (or named) room on this device.', kind: 'irc' },
  { name: 'unmute', usage: '/unmute [#channel]', description: 'Unmute room notifications on this device.', kind: 'irc' },
  { name: 'autojoin', usage: '/autojoin [#channel]', description: 'Rejoin this room on reconnect (this device).', kind: 'irc' },
  { name: 'unautojoin', usage: '/unautojoin [#channel]', description: 'Stop auto-joining a room on reconnect.', kind: 'irc' },
  { name: 'highlight', usage: '/highlight <word>', description: 'Add a local highlight word or phrase.', kind: 'irc' },
  { name: 'unhighlight', usage: '/unhighlight <word>', description: 'Remove a local highlight word.', kind: 'irc' },
  { name: 'snooze', usage: '/snooze <minutes>', description: 'Pause alerts for N minutes (1–1440).', kind: 'irc' },
  { name: 'dnd', usage: '/dnd [on|off|minutes]', description: 'Toggle do-not-disturb or set a timed snooze.', kind: 'irc' },
  { name: 'color', usage: '/color [#hex|clear]', description: 'Set a personal room accent color on this device.', kind: 'irc', aliases: ['colour'] },
  { name: 'share', usage: '/share', description: 'Copy a deep link to the current room.', kind: 'irc' },
  { name: 'export', usage: '/export [txt|json]', description: 'Download local scrollback for this view (this device only).', kind: 'irc' },
  { name: 'notify', usage: '/notify all|mentions|mute', description: 'Set personal notification mode for the current room.', kind: 'irc' },
  { name: 'ping', usage: '/ping [nick]', description: 'Latency check against the server or a peer.', kind: 'irc' },
  { name: 'ctcp', usage: '/ctcp <nick> <cmd>', description: 'Send a CTCP query.', kind: 'irc' },
  { name: 'stage', usage: '/stage [on|off]', description: 'Toggle or query stage mode for the room.', kind: 'irc' },
  { name: 'history', usage: '/history', description: 'Open message search / history tools.', kind: 'irc' },
  { name: 'search', usage: '/search <query>', description: 'Open message search with a query.', kind: 'irc' },
  { name: 'help', usage: '/help [command]', description: 'List local slash commands or describe one command.', kind: 'irc' },
  // Network operator desk. WIRE TRUTH (ONYX_SERVER_PROTOCOL.md §11, §16): this
  // daemon has no `OPER` command and no `+w` WALLOPS — a broadcast rides
  // `EVENT BROADCAST`, so `/wallops` is kept only as a familiar alias for it.
  { name: 'broadcast', usage: '/broadcast <text>', description: 'Announce to every member on the network (opers).', kind: 'irc', aliases: ['wallops'], oper: true },
  { name: 'kill', usage: '/kill <nick> <reason>', description: 'Disconnect someone from the network; the reason is recorded (opers).', kind: 'irc', oper: true },
  { name: 'rehash', usage: '/rehash', description: 'Ask this node to reload its configuration (opers).', kind: 'irc', oper: true },
  { name: 'privs', usage: '/privs', description: 'Show the operator privileges this session holds (opers).', kind: 'irc', oper: true },
  { name: 'events', usage: '/events <list|add|del> [category]', description: 'Manage Event Spine category subscriptions (opers).', kind: 'irc', oper: true },
  { name: 'observe', usage: '/observe <mask|list|off> [connect quit nick oper]', description: 'Watch a nick!user@host mask network-wide (opers).', kind: 'irc', oper: true },
  { name: 'shrug', usage: '/shrug', description: 'Insert a shrug.', kind: 'text', insertText: String.raw`¯\_(ツ)_/¯` },
  { name: 'tableflip', usage: '/tableflip', description: 'Insert a table flip.', kind: 'text', insertText: '(╯°□°）╯︵ ┻━┻' },
  { name: 'unflip', usage: '/unflip', description: 'Insert a table restore.', kind: 'text', insertText: '┬─┬ ノ( ゜-゜ノ)' },
  { name: 'lenny', usage: '/lenny', description: 'Insert a lenny face.', kind: 'text', insertText: '( ͡° ͜ʖ ͡°)' },
  { name: 'disapprove', usage: '/disapprove', description: 'Insert a look of disapproval.', kind: 'text', insertText: 'ಠ_ಠ' },
];

export function slashCommandQuery(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.startsWith('//')) return null;
  const firstToken = text.slice(1).split(/\s/, 1)[0] ?? '';
  if (firstToken.length === 0) return '';
  if (/\s/.test(text.slice(1, firstToken.length + 2))) return null;
  return firstToken.toLowerCase();
}

export function findSlashCommand(name: string): SlashCommand | null {
  const needle = name.replace(/^\//, '').toLowerCase();
  return SLASH_COMMANDS.find((command) =>
    command.name === needle || command.aliases?.includes(needle),
  ) ?? null;
}

export type SlashSuggestionOptions = {
  /** Session holds IRC operator status; unlocks the oper-only verbs. */
  isOper?: boolean;
};

export function getSlashCommandSuggestions(
  text: string,
  limit = 8,
  options: SlashSuggestionOptions = {},
): SlashCommand[] {
  const query = slashCommandQuery(text);
  if (query === null) return [];

  const matches = SLASH_COMMANDS.filter((command) => {
    if (command.oper && !options.isOper) return false;
    if (command.name.startsWith(query)) return true;
    return command.aliases?.some((alias) => alias.startsWith(query)) ?? false;
  });

  return matches.slice(0, limit);
}

export function completeSlashCommand(input: string, command: SlashCommand): string {
  const rest = input.replace(/^\/\S*/, '').trimStart();
  if (command.kind === 'text' && command.insertText) {
    return rest ? `${command.insertText} ${rest}` : command.insertText;
  }
  const completed = `/${command.name}`;
  return rest ? `${completed} ${rest}` : `${completed} `;
}

export function expandSlashTextCommand(input: string): string {
  const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return input;
  const command = findSlashCommand(match[1] ?? '');
  if (!command || command.kind !== 'text' || !command.insertText) return input;
  const suffix = match[2]?.trim();
  return suffix ? `${command.insertText} ${suffix}` : command.insertText;
}
