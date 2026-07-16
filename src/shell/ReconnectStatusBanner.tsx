// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ReconnectStatusBanner — calm, phase-scoped connection recovery feedback.
 *
 * The visible countdown is deliberately separate from the polite live region:
 * seconds may change often, but assistive technology only hears meaningful
 * connection phase boundaries. Recovery stays active through the brief
 * `connecting` handshake so a successful transition can surface Back online.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';

import { useStore } from '@/lib/store';

type ReconnectBannerPhase = 'disconnected' | 'reconnecting' | 'connecting' | 'online';

const BACK_ONLINE_NOTICE_MS = 3_000;

export function ReconnectStatusBanner(): JSX.Element {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const reconnectIn = useStore((state) => state.reconnectIn);
  const [phase, setPhase] = createSignal<ReconnectBannerPhase | null>(null);
  const [announcement, setAnnouncement] = createSignal('');

  let recovering = false;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDismissTimer(): void {
    if (dismissTimer === undefined) return;
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  createEffect(() => {
    const status = connectionStatus();
    clearDismissTimer();

    if (status === 'disconnected') {
      recovering = true;
      setPhase('disconnected');
      setAnnouncement('Disconnected from network. Working offline.');
      return;
    }

    if (status === 'reconnecting') {
      recovering = true;
      setPhase('reconnecting');
      setAnnouncement('Reconnecting to network.');
      return;
    }

    if (status === 'connecting' && recovering) {
      setPhase('connecting');
      setAnnouncement('Connecting to network.');
      return;
    }

    if (status === 'connected' && recovering) {
      recovering = false;
      setPhase('online');
      setAnnouncement('Back online.');
      dismissTimer = setTimeout(() => {
        dismissTimer = undefined;
        setPhase(null);
      }, BACK_ONLINE_NOTICE_MS);
      return;
    }

    setPhase(null);
    setAnnouncement('');
  });

  onCleanup(clearDismissTimer);

  const visualLabel = createMemo(() => {
    switch (phase()) {
      case 'disconnected':
        return 'Disconnected from network.';
      case 'reconnecting':
        return reconnectIn() > 0
          ? `Reconnecting in ${reconnectIn()}s…`
          : 'Reconnecting…';
      case 'connecting':
        return 'Connecting…';
      case 'online':
        return 'Back online';
      default:
        return '';
    }
  });

  return (
    <>
      <Show when={phase()}>
        <div
          class="shell-disconnected-banner"
          classList={{ 'shell-disconnected-banner--online': phase() === 'online' }}
          data-state={phase() ?? undefined}
          aria-hidden="true"
        >
          <span>{phase() === 'online' ? '✓' : '⚠'}</span>
          <span>{visualLabel()}</span>
        </div>
      </Show>
      {/* Pre-existing live node: phase text is inserted after mount and seconds
          churn happens outside this subtree, which keeps announcements calm. */}
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
    </>
  );
}
