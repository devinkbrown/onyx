// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AddToHomeScreenSheet — one quiet day-2 courtesy after real engagement.
 *
 * Never a first-run Connect wall. Chromium uses the captured
 * `beforeinstallprompt` only when the user taps Add to Home Screen.
 * iOS gets Share → Add to Home Screen copy, never a fake install button.
 */
import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js';

import { Button } from '@/primitives/Button';
import { Sheet } from '@/primitives/Sheet';
import { useStore } from '@/lib/store';
import { detectClientSurface, isStandaloneDisplayMode } from '@/lib/platform';

import {
  A2HS_TITLE,
  a2hsCopyFor,
  capturedInstallPrompt,
  detectA2hsPlatform,
  dismissAddToHomeScreen,
  hasHomeScreenEngagement,
  hasSentHomeScreenMessage,
  isA2hsDismissed,
  isReturningHomeScreenVisit,
  markHomeScreenMessageSent,
  requestHomeScreenAdd,
  shouldOfferAddToHomeScreen,
  stateHasSentMessage,
} from './addToHomeScreen';

import './add-to-home-screen.css';

export function AddToHomeScreenSheet(): JSX.Element {
  const [status, setStatus] = createSignal('');
  const platform = createMemo(() => detectA2hsPlatform());
  const surface = createMemo(() => detectClientSurface());
  const standalone = createMemo(() => isStandaloneDisplayMode({
    matchMedia: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null,
    navigator: typeof navigator !== 'undefined'
      ? { standalone: (navigator as { standalone?: boolean }).standalone }
      : null,
  }));
  const joinedRoom = useStore((state) => state.channels.size > 0);
  const sentLive = useStore((state) => stateHasSentMessage(state));

  createEffect(() => {
    if (sentLive()) markHomeScreenMessageSent();
  });

  const offer = createMemo(() => shouldOfferAddToHomeScreen({
    engaged: hasHomeScreenEngagement({
      sent: hasSentHomeScreenMessage() || sentLive(),
      returning: isReturningHomeScreenVisit(),
      joinedRoom: joinedRoom(),
    }),
    dismissed: isA2hsDismissed(),
    standalone: standalone(),
    surface: surface(),
    platform: platform(),
    hasCapturedPrompt: capturedInstallPrompt() !== null,
  }));

  function handleOpenChange(open: boolean): void {
    if (!open) dismissAddToHomeScreen();
  }

  const copy = createMemo(() => a2hsCopyFor(platform()));
  const canPrompt = createMemo(() => platform() !== 'ios' && capturedInstallPrompt() !== null);

  return (
    <Sheet
      data-testid="a2hs-sheet"
      open={offer()}
      onOpenChange={handleOpenChange}
      title={A2HS_TITLE}
      description={copy().lede}
      closeLabel="Dismiss Home Screen reminder"
    >
      <div class="a2hs-sheet">
        <Show when={copy().detail}>
          {(detail) => <p class="a2hs-sheet__detail">{detail()}</p>}
        </Show>
        <div class="a2hs-sheet__actions">
          <Show when={canPrompt()}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="a2hs-add"
              onClick={() => {
                setStatus('Opening your browser’s install prompt…');
                void requestHomeScreenAdd().then((outcome) => setStatus(
                  outcome === 'accepted'
                    ? 'Onyx was added to your Home Screen.'
                    : outcome === 'dismissed'
                      ? 'No changes made. You can add Onyx later from your browser menu.'
                      : 'Your browser could not open the install prompt. Use the browser menu to add Onyx.',
                ));
              }}
            >
              Add to Home Screen
            </Button>
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="a2hs-dismiss"
            onClick={() => dismissAddToHomeScreen()}
          >
            Not now
          </Button>
        </div>
        <Show when={status()}>
          <p class="a2hs-sheet__status" role="status" aria-live="polite">{status()}</p>
        </Show>
      </div>
    </Sheet>
  );
}
