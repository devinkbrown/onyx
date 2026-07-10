/**
 * channelNotifyMode.ts — pure logic for per-channel notification-preference modes.
 *
 * PUBLIC API surface uses the mode vocabulary `'all' | 'mentions' | 'mute'`.
 * The store persists a single source of truth (`OnyxState.channelNotify`) using the
 * legacy stored vocabulary `'all' | 'mentions' | 'none'` — `'none'` is the stored
 * spelling of the public `'mute'`. These helpers translate between the two so there
 * is exactly ONE map / ONE localStorage key (`onyx:channel-notify`), never a
 * duplicated second copy of the same state.
 *
 * All functions are pure: they read a Map value and return a value; no mutation,
 * no I/O. Channel keys are normalized with `.toLowerCase()`.
 */

/** Public per-channel notification mode. `'all'` is the default when unset. */
export type NotifyMode = 'all' | 'mentions' | 'mute';

/** Stored per-channel notification level (single source of truth in the store). */
export type NotifyLevel = 'all' | 'mentions' | 'none';

/** Translate a public mode to the stored level (`'mute'` → `'none'`). */
export function modeToLevel(mode: NotifyMode): NotifyLevel {
  return mode === 'mute' ? 'none' : mode;
}

/** Translate a stored level to the public mode (`'none'` → `'mute'`). */
export function levelToMode(level: NotifyLevel): NotifyMode {
  return level === 'none' ? 'mute' : level;
}

/**
 * Read the public notification mode for a channel from the stored level map.
 * Defaults to `'all'` when the channel has no entry.
 */
export function channelNotifyMode(
  levels: ReadonlyMap<string, NotifyLevel>,
  channel: string,
): NotifyMode {
  const level = levels.get(channel.toLowerCase());
  return level ? levelToMode(level) : 'all';
}

/**
 * Derived helper: should a message in `channel` fire a notification?
 *   - `'mute'`     → never
 *   - `'mentions'` → only when the message mentions us (`isMention`)
 *   - `'all'`      → always (also the default when unset)
 */
export function shouldNotify(
  levels: ReadonlyMap<string, NotifyLevel>,
  channel: string,
  isMention: boolean,
): boolean {
  switch (channelNotifyMode(levels, channel)) {
    case 'mute':
      return false;
    case 'mentions':
      return isMention;
    case 'all':
      return true;
  }
}
