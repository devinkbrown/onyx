// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ServerRail.tsx — left network rail.
 *
 * Collapses/hides when fewer than 3 servers (per #16 redesign).
 * Includes an Appearance link and a disconnect control.
 *
 * SOLID IDIOMS: components run once; never destructure props; use splitProps;
 * signals/memos/effects; For/Show.
 */

import { createMemo, Show, splitProps, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import { PrimaryNavigation, type PrimaryCurrentSection, type PrimarySection } from './PrimaryNavigation';

export type ServerRailProps = {
  /** Called when the user clicks [disconnect] */
  onDisconnect?: () => void;
  /** Currently active server id (for the active indicator) */
  activeServerId?: string;
  currentSection?: PrimaryCurrentSection | null;
  selectedCollection?: 'rooms' | 'messages' | null;
  youDialogOpen?: boolean;
  onSelect?: (section: PrimarySection) => void;
};

export function ServerRail(props: ServerRailProps): JSX.Element {
  const [local] = splitProps(props, ['onDisconnect', 'activeServerId', 'currentSection', 'selectedCollection', 'youDialogOpen', 'onSelect']);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);

  const unreadTotal = createMemo(() => {
    let total = 0;
    channels().forEach((channel) => { total += channel.unread; });
    dms().forEach((dm) => { total += dm.unread; });
    return total;
  });

  const mentionTotal = createMemo(() => {
    let total = 0;
    channels().forEach((channel) => { total += channel.highlights; });
    dms().forEach((dm) => { total += dm.highlights; });
    return total;
  });

  // The rail renders a single Onyx server entry (one connected network).
  // When fewer than 3 servers are present it hides itself via AppShell.
  return (
    <nav
      class="shell-rail"
      aria-label="Server list"
    >
      {/* Onyx server icon — the active (and only) network. It is a status
          indicator, not an action, so it is a labelled image rather than a
          fake button: an interactive role with no handler misleads AT. */}
      <div
        class="shell-rail-entry shell-rail-entry--active"
        role="img"
        aria-label={`Onyx — active server${unreadTotal() > 0 ? `, ${unreadTotal()} unread` : ''}${mentionTotal() > 0 ? `, ${mentionTotal()} mentions` : ''}`}
        aria-current="true"
      >
        {/* kin / server mark stands in for a proper server icon */}
        <span aria-hidden="true" style={{ 'font-family': 'var(--font-display)', 'font-size': '0.7rem', 'line-height': '1' }}>
          IR
        </span>
        <Show when={unreadTotal() > 0}>
          <span
            class={`shell-rail-badge${mentionTotal() > 0 ? ' shell-rail-badge--mention' : ''}`}
            aria-hidden="true"
          >
            {mentionTotal() > 0 ? (mentionTotal() > 9 ? '9+' : mentionTotal()) : ''}
          </span>
        </Show>
      </div>

      <div class="shell-rail-sep" aria-hidden="true" />

      <PrimaryNavigation
        variant="desktop"
        currentSection={local.currentSection}
        selectedCollection={local.selectedCollection}
        youDialogOpen={local.youDialogOpen}
        onSelect={(section) => local.onSelect?.(section)}
      />

      {/* Bottom controls */}
      <div class="shell-rail-bottom">
        {/* Appearance link */}
        <a
          href="/appearance/"
          class="shell-rail-entry"
          aria-label="Appearance settings"
          title="Appearance"
        >
          <span aria-hidden="true" style={{ 'font-size': '1rem', 'line-height': '1' }}>⊙</span>
        </a>

        {/* Disconnect */}
        <button
          type="button"
          class="shell-rail-entry"
          aria-label="Disconnect from network"
          title="Disconnect"
          onClick={() => local.onDisconnect?.()}
        >
          <span aria-hidden="true" style={{ 'font-family': 'var(--font-mono)', 'font-size': '0.7rem', 'line-height': '1', color: 'var(--shu)' }}>
            ✕
          </span>
        </button>
      </div>
    </nav>
  );
}
