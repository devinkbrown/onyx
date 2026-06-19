/**
 * ServerRail.tsx — left network rail.
 *
 * Collapses/hides when fewer than 3 servers (per #16 redesign).
 * Includes an Appearance link and a disconnect control.
 *
 * SOLID IDIOMS: components run once; never destructure props; use splitProps;
 * signals/memos/effects; For/Show.
 */

import { splitProps, type JSX } from 'solid-js';

export type ServerRailProps = {
  /** Called when the user clicks [disconnect] */
  onDisconnect?: () => void;
  /** Currently active server id (for the active indicator) */
  activeServerId?: string;
};

export function ServerRail(props: ServerRailProps): JSX.Element {
  const [local] = splitProps(props, ['onDisconnect', 'activeServerId']);

  // The rail renders a single IRCXNet server entry (one connected network).
  // When fewer than 3 servers are present it hides itself via AppShell.
  return (
    <nav
      class="shell-rail"
      aria-label="Server list"
      role="navigation"
    >
      {/* IRCXNet server icon */}
      <div
        class="shell-rail-entry shell-rail-entry--active"
        role="button"
        tabIndex={0}
        aria-label="IRCXNet — active server"
        aria-current="true"
      >
        {/* kin / kintsugi ideogram stands in for a proper server icon */}
        <span aria-hidden="true" style={{ 'font-family': 'var(--font-display)', 'font-size': '0.7rem', 'line-height': '1' }}>
          IR
        </span>
      </div>

      <div class="shell-rail-sep" aria-hidden="true" />

      {/* Bottom controls */}
      <div class="shell-rail-bottom">
        {/* Appearance link */}
        <a
          href="/appearance"
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
