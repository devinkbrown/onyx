import { useOnyxStore } from '@/lib/store';

/**
 * Returns the local display name for a nick — override if set, otherwise the
 * nick itself. Safe to call outside React (uses getState()).
 */
export function getDisplayName(nick: string): string {
  const overrides = useOnyxStore.getState().displayNameOverrides;
  return overrides[nick] || nick;
}

/**
 * Returns our own local display name (or our actual IRC nick if none is set).
 * Safe to call outside React (uses getState()).
 */
export function getSelfDisplayName(): string {
  const { selfDisplayName, ourNick } = useOnyxStore.getState();
  return selfDisplayName || ourNick || '';
}

