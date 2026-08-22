// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DmKeyChangeBanner.tsx — the E2EE key-change (TOFU anti-MITM) warning surface.
 *
 * When a DM peer starts advertising a device key different from the one we
 * pinned on first use, the store fails CLOSED (no send under the new key,
 * inbound stays LOCKED) and records a `PeerKeyChange`. This banner is the
 * client's designed response: it names the peer, surfaces BOTH safety numbers
 * — the CURRENT pinned fingerprint and the NEW pending one — for the user to
 * compare out-of-band, and offers two decisions:
 *   - Accept  → acceptPeerKeyChange(): re-pin the new key + unlock held messages
 *   - Dismiss → dismissPeerKeyChange(): drop the warning WITHOUT trusting the key
 *
 * The banner self-gates: it renders only when the ACTIVE view is a DM whose
 * peer has a pending key-change. Mounted in the conversation column beside the
 * PresenceRibbon (which names the peer), so it reads as part of that DM.
 *
 * SOLID IDIOMS:
 *   - Component body runs ONCE. Reactivity lives in memos + <Show>.
 *   - No props. Reactive store reads go through useStore; the imperative
 *     accept/dismiss/load dispatches go through getState().
 *   - The two safety numbers are computed lazily by the store (async, cached in
 *     peerSafetyNumbers / pendingKeySafetyNumbers); an effect kicks off the
 *     loads whenever the banner becomes active for a peer, and the display
 *     reads the cached values reactively.
 */
import { createEffect, createMemo, For, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { DM_KEY_CHANGE_BODY, dmKeyChangeAlert } from '@/lib/e2ee/dmPrivacyChrome';
import './dm-key-change.css';

/** The active DM peer nick, or null when the active view is not a DM. */
function activePeerNick(view: ReturnType<typeof getState>['activeView']): string | null {
  return view.kind === 'dm' ? view.nick : null;
}

/** Split a "12345 67890 …" safety number into its readable 5-digit groups. */
function toGroups(sn: string | null | undefined): string[] {
  return sn ? sn.split(' ').filter(Boolean) : [];
}

export function DmKeyChangeBanner(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const peerKeyChanges = useStore((s) => s.peerKeyChanges);
  const peerSafetyNumbers = useStore((s) => s.peerSafetyNumbers);
  const pendingKeySafetyNumbers = useStore((s) => s.pendingKeySafetyNumbers);

  // The active DM peer, and its lowercased map key (store keys by nick.toLowerCase()).
  const peer = createMemo(() => activePeerNick(activeView()));
  const peerKey = createMemo(() => peer()?.toLowerCase() ?? null);

  // Self-gate: only when THIS active DM peer has a pending key-change.
  const change = createMemo(() => {
    const key = peerKey();
    return key ? peerKeyChanges().get(key) ?? null : null;
  });
  const active = createMemo(() => change() !== null);

  // Kick off the two async safety-number computations whenever the banner
  // becomes active for a peer. Both are cached in the store; re-running is
  // cheap (the store guards against redundant writes) and keeps the display in
  // sync if the pending key changes underneath us.
  createEffect(() => {
    const p = peer();
    if (!p || !active()) return;
    void getState().loadSafetyNumber(p);
    void getState().loadPendingKeySafetyNumber(p);
  });

  // null while the async load is in flight; '' is never produced (store caches a
  // real 60-digit string or leaves the entry absent).
  const pinnedSn = createMemo(() => {
    const key = peerKey();
    return key ? peerSafetyNumbers().get(key) ?? null : null;
  });
  const pendingSn = createMemo(() => {
    const key = peerKey();
    return key ? pendingKeySafetyNumbers().get(key) ?? null : null;
  });

  const onAccept = (): void => {
    const p = peer();
    if (p) getState().acceptPeerKeyChange(p);
  };
  const onDismiss = (): void => {
    const p = peer();
    if (p) getState().dismissPeerKeyChange(p);
  };

  return (
    <Show when={active() && peer()}>
      {(name) => (
        <section
          class="dm-keychange"
          role="region"
          aria-labelledby="dm-keychange-title"
        >
          {/*
            One-shot assertive announce, independent of the async safety-number
            population below (which would otherwise re-announce as chips fill in).
            Keyed by peer so switching to another affected DM announces afresh.
          */}
          <span class="sr-only" role="alert">
            {dmKeyChangeAlert(name())}
          </span>

          <div class="dm-keychange__rule" aria-hidden="true" />

          <div class="dm-keychange__head">
            <div class="dm-keychange__lede">
              <span class="dm-keychange__kicker">
                <span class="dm-keychange__glyph" aria-hidden="true">⚠</span>
                Device key changed
              </span>
              <h2 id="dm-keychange-title" class="dm-keychange__title">
                <span class="dm-keychange__peer">{name()}</span>'s device key changed
              </h2>
              <p class="dm-keychange__sub">
                {DM_KEY_CHANGE_BODY}
              </p>
            </div>

            <div class="dm-keychange__actions">
              <button type="button" class="dm-keychange__accept" onClick={onAccept}>
                Accept new key
              </button>
              <button type="button" class="dm-keychange__dismiss" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </div>

          <div class="dm-keychange__compare">
            <SafetyColumn
              label="Current (trusted)"
              tone="pinned"
              groups={toGroups(pinnedSn())}
              empty={pinnedSn() === null}
            />
            <SafetyColumn
              label="New (unverified)"
              tone="pending"
              groups={toGroups(pendingSn())}
              empty={pendingSn() === null}
            />
          </div>
        </section>
      )}
    </Show>
  );
}

type SafetyColumnProps = {
  label: string;
  tone: 'pinned' | 'pending';
  groups: string[];
  empty: boolean;
};

/** One labelled 60-digit fingerprint, laid out as comparable 5-digit chips. */
function SafetyColumn(props: SafetyColumnProps): JSX.Element {
  return (
    <div class="dm-keychange__col" data-tone={props.tone}>
      <span class="dm-keychange__col-label">{props.label}</span>
      <Show
        when={props.groups.length > 0}
        fallback={
          <p class="dm-keychange__col-empty">
            {props.empty ? 'Computing safety number…' : 'Safety number unavailable'}
          </p>
        }
      >
        {/*
          <output> carries an implicit role="status" + aria-live="polite": the
          fingerprints populate asynchronously, so left live they would announce
          ~60 digits (twice) over the top of the one-shot alert, and re-announce
          on every peer switch. Silence the live channel — the alert already
          carries the call to action; AT reaches the digits on demand via the
          accessible name. */}
        <output
          class="dm-keychange__fingerprint"
          aria-label={`${props.label} safety number`}
          aria-live="off"
        >
          <For each={props.groups}>
            {(group) => <span class="dm-keychange__group">{group}</span>}
          </For>
        </output>
      </Show>
    </div>
  );
}
