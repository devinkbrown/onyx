// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DmSafetySheet — proactive, in-flow DM identity verification.
 *
 * This is deliberately not a modal Sheet. Verification should remain available
 * beside the conversation without hiding the transcript a person may need to
 * inspect. The panel self-gates to direct messages, loads the store-owned stable
 * safety number on demand (one conversation number over the full multi-device
 * pin set), shows the advertised peer device count from peerDmDeviceKeys, and
 * never renders either device's raw public key.
 */

import './dm-safety-sheet.css';

import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import {
  DM_VERIFY_ACTION,
  showDmPrivateChip,
  DM_PRIVATE_CHIP,
  DM_PRIVATE_CHIP_LABEL,
  DM_PRIVACY_SCOPE,
} from '@/lib/e2ee/dmPrivacyChrome';
import { getState, useStore, type ActiveView } from '@/lib/store';
import { registerDmSafetySheetOpener } from './dmSafetySheetOpen';

export type DmSafetySheetProps = {
  /** When true, PresenceRibbon owns the Verify action. */
  hideTrigger?: boolean;
};

export { openDmSafetySheet } from './dmSafetySheetOpen';

type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

function dmPeer(view: ActiveView): string | null {
  return view.kind === 'dm' ? view.nick : null;
}

function safetyGroups(value: string | null): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

export function DmSafetySheet(props: DmSafetySheetProps = {}): JSX.Element {
  const activeView = useStore((state) => state.activeView);
  const peerDmKeys = useStore((state) => state.peerDmKeys);
  const peerDmDeviceKeys = useStore((state) => state.peerDmDeviceKeys);
  const peerKeyChanges = useStore((state) => state.peerKeyChanges);
  const peerSafetyNumbers = useStore((state) => state.peerSafetyNumbers);

  const peer = createMemo(() => dmPeer(activeView()));
  const peerKey = createMemo(() => peer()?.toLowerCase() ?? null);
  /** Advertised multi-device directory size (ocean.dm-keys), never raw key material. */
  const peerDeviceCount = createMemo(() => {
    const key = peerKey();
    if (key === null) return 0;
    const multi = peerDmDeviceKeys().get(key);
    if (multi && multi.length > 0) return multi.length;
    return peerDmKeys().has(key) ? 1 : 0;
  });
  const advertisedKeyAvailable = createMemo(() => peerDeviceCount() > 0);
  const cachedSafetyNumber = createMemo(() => {
    const key = peerKey();
    return key === null ? null : peerSafetyNumbers().get(key) ?? null;
  });
  const safetyIdentity = createMemo(() => {
    const key = peerKey();
    const trustedKey = key === null ? null : peerDmKeys().get(key) ?? null;
    return `${key ?? ''}\u0000${trustedKey ?? ''}\u0000${cachedSafetyNumber() ?? ''}`;
  });

  const [open, setOpen] = createSignal(false);
  const [loadState, setLoadState] = createSignal<LoadState>('idle');
  const [loadedSafetyNumber, setLoadedSafetyNumber] = createSignal<string | null>(null);
  let openerRef: HTMLButtonElement | undefined;
  let requestEpoch = 0;
  let previousPeer: string | null = null;
  let requestedSafetyIdentity: string | null = null;
  let requestedTrustedKey: string | null = null;
  let displayedSafetyNumber: string | null = null;

  onCleanup(() => {
    requestEpoch += 1;
  });

  const safetyNumber = createMemo(() => loadedSafetyNumber() ?? cachedSafetyNumber());
  const groups = createMemo(() => safetyGroups(safetyNumber()));
  const sealDeviceLabel = createMemo(() => {
    const n = Math.max(1, peerDeviceCount());
    return String(Math.min(n, 99)).padStart(2, '0');
  });
  const peerDeviceReadiness = createMemo(() => {
    const n = peerDeviceCount();
    if (n <= 0) return 'Not received';
    if (n === 1) return '1 device received';
    return `${n} devices received`;
  });
  const privateChip = createMemo(() => {
    const name = peer();
    if (!name) return false;
    return showDmPrivateChip({
      peerDmKeys: peerDmKeys(),
      peerDmDeviceKeys: peerDmDeviceKeys(),
      peerKeyChanges: peerKeyChanges(),
    }, name);
  });

  const openThisSheet = (): void => {
    if (dmPeer(getState().activeView)) setOpen(true);
  };
  registerDmSafetySheetOpener(openThisSheet);
  onCleanup(() => {
    registerDmSafetySheetOpener(null);
  });

  // A verification receipt belongs to exactly one peer. Switching views closes
  // it and invalidates an in-flight computation so another DM never inherits
  // the prior peer's number or load result.
  createEffect(() => {
    const nextPeer = peer();
    if (nextPeer === previousPeer) return;
    previousPeer = nextPeer;
    requestEpoch += 1;
    setOpen(false);
    setLoadedSafetyNumber(null);
    setLoadState('idle');
    requestedSafetyIdentity = null;
    requestedTrustedKey = null;
    displayedSafetyNumber = null;
  });

  createEffect(() => {
    const name = peer();
    if (!open() || !name) return;

    const identity = safetyIdentity();
    if (identity === requestedSafetyIdentity) return;
    const key = peerKey();
    const trustedKey = key === null ? null : peerDmKeys().get(key) ?? null;
    const cached = cachedSafetyNumber();
    // loadSafetyNumber publishes its result into peerSafetyNumbers. Ignore
    // that write when it is the same identity this request already displayed;
    // a changed trusted key or number still enters the path below.
    if (
      requestedSafetyIdentity !== null
      && requestedTrustedKey === trustedKey
      && displayedSafetyNumber === cached
    ) {
      requestedSafetyIdentity = identity;
      return;
    }
    requestedSafetyIdentity = identity;
    requestedTrustedKey = trustedKey;

    const epoch = ++requestEpoch;
    displayedSafetyNumber = cached;
    setLoadedSafetyNumber(cached);
    setLoadState(cached ? 'ready' : 'loading');

    void getState().loadSafetyNumber(name).then((value) => {
      if (epoch !== requestEpoch) return;
      setLoadedSafetyNumber(value);
      setLoadState(value ? 'ready' : 'unavailable');
    }).catch(() => {
      if (epoch !== requestEpoch) return;
      setLoadedSafetyNumber(null);
      setLoadState('unavailable');
    });
  });

  function closeAndRestoreFocus(): void {
    requestEpoch += 1;
    setOpen(false);
    setLoadedSafetyNumber(null);
    setLoadState('idle');
    requestedSafetyIdentity = null;
    requestedTrustedKey = null;
    displayedSafetyNumber = null;
    queueMicrotask(() => {
      if (openerRef?.isConnected) openerRef.focus();
    });
  }

  function handlePanelKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeAndRestoreFocus();
  }

  return (
    <Show when={peer()}>
      {(name) => (
        <Show when={!props.hideTrigger || open()}>
        <section
          class="dm-safety"
          classList={{ 'dm-safety--header-owned': props.hideTrigger === true }}
          aria-label={`Safety number for ${name()}`}
        >
          <Show when={!props.hideTrigger}>
            <div class="dm-safety__bar">
              <Show when={privateChip()}>
                <span
                  class="dm-safety__private"
                  data-testid="dm-safety-private"
                  aria-label={DM_PRIVATE_CHIP_LABEL}
                >
                  {DM_PRIVATE_CHIP}
                </span>
              </Show>
              <button
                ref={openerRef}
                type="button"
                class="dm-safety__trigger"
                aria-expanded={open()}
                aria-controls="dm-safety-panel"
                onClick={() => (open() ? closeAndRestoreFocus() : setOpen(true))}
              >
                <svg class="dm-safety__trigger-icon" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z" />
                  <path d="m9.3 12 1.8 1.8 3.8-4" />
                </svg>
                <span>{DM_VERIFY_ACTION}</span>
                <span
                  class="dm-safety__trigger-state"
                  data-ready={safetyNumber() ? 'true' : 'false'}
                  aria-hidden="true"
                />
              </button>
            </div>
          </Show>

          <Show when={open()}>
            <div
              id="dm-safety-panel"
              class="dm-safety__panel"
              role="region"
              aria-labelledby="dm-safety-title"
              aria-describedby="dm-safety-guidance"
              onKeyDown={handlePanelKeyDown}
            >
              <div class="dm-safety__seal" aria-hidden="true">
                <span>DM</span>
                <span>{sealDeviceLabel()}</span>
              </div>

              <div class="dm-safety__content">
                <header class="dm-safety__header">
                  <div>
                    <p class="dm-safety__kicker">Safety number</p>
                  <h2 id="dm-safety-title">Review this safety number with {name()}</h2>
                  </div>
                  <button
                    type="button"
                    class="dm-safety__close"
                    aria-label="Close safety number"
                    onClick={closeAndRestoreFocus}
                  >×</button>
                </header>

                <p id="dm-safety-guidance" class="dm-safety__guidance">
                  Compare every group with {name()} in person, on a trusted voice call,
                  or through another channel you already trust. A matching number helps
                  this device to {peerDeviceCount() > 1
                    ? `all ${peerDeviceCount()} of their advertised device keys`
                    : 'the device key they published'}.
                </p>
                <p class="dm-safety__scope">{DM_PRIVACY_SCOPE}</p>

                <div class="dm-safety__readiness" role="list" aria-label="Encryption key readiness">
                  <div class="dm-safety__readiness-row" role="listitem">
                        <span>Your device</span>
                    <strong>{safetyNumber() ? 'Number available' : 'Number unavailable'}</strong>
                  </div>
                  <div class="dm-safety__readiness-row" role="listitem">
                    <span>{name()}'s device keys</span>
                    <strong>{peerDeviceReadiness()}</strong>
                  </div>
                  <div class="dm-safety__readiness-row" role="listitem">
                  <span>Review with {name()}</span>
                  <strong>Still required</strong>
                  </div>
                </div>

                <div class="dm-safety__number-block">
                  <p class="dm-safety__number-label">
                    {peerDeviceCount() > 1
                      ? `Current safety number · ${peerDeviceCount()} devices`
                      : 'Current safety number'}
                  </p>
                  <Show
                    when={groups().length > 0}
                    fallback={
                      <p class="dm-safety__empty" role="status" aria-live="polite">
                        {loadState() === 'loading'
                          ? 'Loading this device’s safety number…'
                          : advertisedKeyAvailable()
                            ? 'No trusted device pair is ready to compare yet.'
                            : `${name()}’s device key has not arrived yet.`}
                      </p>
                    }
                  >
                    <output
                      class="dm-safety__number"
                      aria-label={
                        peerDeviceCount() > 1
                          ? `Safety number for ${name()} across ${peerDeviceCount()} devices: ${safetyNumber()}`
                          : `Safety number for ${name()}: ${safetyNumber()}`
                      }
                      aria-live="off"
                    >
                      <For each={groups()}>
                        {(group, index) => (
                          <span class="dm-safety__number-group">
                            <small aria-hidden="true">{String(index() + 1).padStart(2, '0')}</small>
                            {group}
                          </span>
                        )}
                      </For>
                    </output>
                  </Show>
                </div>

                <p class="dm-safety__warning">
                  This number is a review aid, not proof by itself. Until you compare it,
                  treat the identity as unverified.
                  If their device key changes
                  {peerDeviceCount() > 1 ? ' or a new device appears' : ''},
                  messages stay locked until you review it.
                </p>
              </div>
            </div>
          </Show>
        </section>
        </Show>
      )}
    </Show>
  );
}

export default DmSafetySheet;
