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

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandSection = 'Channels' | 'DMs' | 'People' | 'Actions';

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

const RECENTS_KEY = 'onyx:palette-recents';
/** Legacy key from the previous brand name; read-only for one-time migration. */
const LEGACY_RECENTS_KEY = 'ruri:palette-recents';
const MAX_RECENTS = 6;

export type RecentTarget = {
  id: string;
  label: string;
  section: CommandSection;
  /** ISO timestamp of last access */
  at: string;
};

/**
 * Load recent targets from localStorage. Returns newest-first.
 */
export function loadRecents(): RecentTarget[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    // Current key first, then fall back to the legacy key (read-old-write-new)
    // so recent palette targets survive one load after the rebrand.
    const raw = localStorage.getItem(RECENTS_KEY) ?? localStorage.getItem(LEGACY_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as RecentTarget[]).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/**
 * Persist a recently-used command id + label. The entry is moved to the front
 * if it already exists.
 */
export function saveRecent(target: Omit<RecentTarget, 'at'>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = loadRecents().filter((r) => r.id !== target.id);
    const next: RecentTarget[] = [
      { ...target, at: new Date().toISOString() },
      ...existing,
    ].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Remove all recents. Primarily for tests.
 */
export function clearRecents(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(RECENTS_KEY);
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
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'me', usage: '/me <action>', description: 'Send an action message.', kind: 'irc' },
  { name: 'topic', usage: '/topic <text>', description: 'Set or view the channel topic.', kind: 'irc' },
  { name: 'nick', usage: '/nick <nick>', description: 'Change your nick.', kind: 'irc' },
  { name: 'join', usage: '/join #channel', description: 'Join a channel.', kind: 'irc', aliases: ['j'] },
  { name: 'part', usage: '/part [#channel]', description: 'Leave the current or named channel.', kind: 'irc', aliases: ['leave'] },
  { name: 'msg', usage: '/msg <nick> <text>', description: 'Send a private message.', kind: 'irc', aliases: ['query'] },
  { name: 'whois', usage: '/whois <nick>', description: 'Request user information.', kind: 'irc' },
  { name: 'invite', usage: '/invite <nick>', description: 'Invite someone into the channel.', kind: 'irc' },
  { name: 'event', usage: '/event <YYYY-MM-DDThh:mmZ> <title>', description: 'Schedule a channel event (ops); /event clear to remove.', kind: 'irc' },
  { name: 'webhook', usage: '/webhook <create|list|delete> ...', description: 'Manage Discord-compatible incoming webhooks (ops).', kind: 'irc' },
  { name: 'shrug', usage: '/shrug', description: 'Insert a shrug.', kind: 'text', insertText: String.raw`¯\_(ツ)_/¯` },
  { name: 'tableflip', usage: '/tableflip', description: 'Insert a table flip.', kind: 'text', insertText: '(╯°□°）╯︵ ┻━┻' },
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

export function getSlashCommandSuggestions(text: string, limit = 8): SlashCommand[] {
  const query = slashCommandQuery(text);
  if (query === null) return [];

  const matches = SLASH_COMMANDS.filter((command) => {
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
