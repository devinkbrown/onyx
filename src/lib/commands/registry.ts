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

const RECENTS_KEY = 'ruri:palette-recents';
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
    const raw = localStorage.getItem(RECENTS_KEY);
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
