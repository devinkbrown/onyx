// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './invite.css';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildInviteCard,
  guestNameError,
  inviteDescription,
  inviteHeadline,
  inviteTitle,
  inviteWelcome,
  parseGuestName,
} from '@/lib/invite/inviteCard';
import { buildInviteLink } from '@/lib/invite/inviteLink';
import { updateCoordinator } from '@/pwa/updateCoordinator';
import { FormField } from '@/primitives/index';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

const NETWORK_NAME = 'Onyx';

function currentParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function currentOrigin(): string {
  if (typeof window === 'undefined') return 'https://eshmaki.me';
  return `${window.location.origin}/invite/`;
}

export default function InviteRoute() {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  const [copyBusy, setCopyBusy] = createSignal(false);
  const [displayName, setDisplayName] = createSignal('');
  const [nameError, setNameError] = createSignal<string | undefined>(undefined);
  let releaseUpdateHold: (() => void) | null = null;
  createEffect(() => {
    const protectedWork = displayName().trim().length > 0;
    if (protectedWork && !releaseUpdateHold) releaseUpdateHold = updateCoordinator.hold('invite-form');
    if (!protectedWork && releaseUpdateHold) { releaseUpdateHold(); releaseUpdateHold = null; }
  });
  onCleanup(() => { releaseUpdateHold?.(); releaseUpdateHold = null; });
  let copyEpoch = 0;
  let disposed = false;
  const card = createMemo(() => buildInviteCard(currentParams(), {
    network: NETWORK_NAME,
    origin: currentOrigin(),
  }));
  const title = createMemo(() => inviteTitle(card()));
  const headline = createMemo(() => inviteHeadline(card()));
  const description = createMemo(() => inviteDescription(card()));
  const welcome = createMemo(() => inviteWelcome(card()));
  const hasRoom = createMemo(() => card().channel !== null);

  createEffect(() => {
    const suggested = card().guestName;
    if (suggested) setDisplayName(suggested);
  });

  const joinHref = createMemo(() => {
    const name = parseGuestName(displayName());
    return buildInviteLink(
      {
        channel: card().channel ?? '',
        guestName: name,
        at: card().at,
        topic: card().topic,
        reader: card().readerMode,
      },
      { network: NETWORK_NAME, origin: currentOrigin(), appOrigin: '/app/' },
    ).appHref;
  });
  const signInHref = createMemo(() => {
    const url = new URL(joinHref(), window.location.origin);
    url.searchParams.set('signin', '1');
    return `${url.pathname}${url.search}`;
  });

  createEffect(() => {
    setPageMeta(title(), description(), card().url);
  });

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
  });

  async function copyInvite(): Promise<void> {
    if (copyBusy()) return;
    const epoch = ++copyEpoch;
    setCopyBusy(true);
    setCopyState('idle');
    let copied: boolean;
    try {
      copied = await writeClipboardText(card().url);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== copyEpoch) return;
    setCopyState(copied ? 'copied' : 'failed');
    setCopyBusy(false);
  }

  function copyButtonLabel(): string {
    if (copyBusy()) return 'Copying link…';
    if (copyState() === 'copied') return 'Copied link';
    return 'Copy link';
  }

  function onNameInput(value: string): void {
    setDisplayName(value);
    setNameError(guestNameError(value));
  }

  function validateJoin(event?: MouseEvent | SubmitEvent): boolean {
    const error = guestNameError(displayName());
    if (!error) return true;

    event?.preventDefault();
    setNameError(error);
    document.getElementById('invite-display-name')?.focus();
    return false;
  }

  return (
    <PublicFrame
      currentPath="/invite/"
      mainLabel="Onyx invite"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Friends</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Invite</span>
        </p>
      )}
    >
      <div class="ui-root r invite-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 130 C 250 40, 460 290, 750 210 S 1170 130, 1500 260" />
        <path class="flow" d="M-40 570 C 330 650, 600 430, 900 540 S 1240 670, 1520 560" />
        <path d="M-40 790 C 380 710, 720 880, 1060 770 S 1340 710, 1540 830" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      <section class="invite-door" aria-labelledby="invite-heading">
        <aside class="invite-destination">
          <div class="invite-identity">
            <span class="invite-room-mark" aria-hidden="true">{(card().channel ?? '#').slice(0, 1)}</span>
            <div class="invite-identity-copy">
              <h1 id="invite-heading">
                {card().channel === '#root' ? `Join ${card().channel}` : headline()}
              </h1>
              <p class="invite-lede">{welcome()}</p>
            </div>
          </div>
          <Show when={!hasRoom()}>
            <p class="invite-recovery" role="note">
              This link does not name a room. Open Onyx and choose one there, or ask your friend for a new room invite.
            </p>
          </Show>
          <Show when={hasRoom()}>
            <div class="invite-preview" role="note" aria-label="Invite preview">
              <p class="invite-preview-title">{title()}</p>
              <p class="invite-preview-desc">{description()}</p>
              <Show when={card().topic}>
                {(topic) => (
                  <p class="invite-preview-topic">
                    {topic()}
                  </p>
                )}
              </Show>
            </div>
          </Show>
          <p class="invite-access-note" role="note">
            This link points to a destination. The room still applies its own access rules when you join.
          </p>
        </aside>

        <div class="invite-form-panel">
        <form
          class="invite-join"
          onSubmit={(event) => {
            if (!validateJoin(event)) return;
            event.preventDefault();
            window.location.assign(joinHref());
          }}
        >
          <FormField
            id="invite-display-name"
            label="Display name"
            type="text"
            placeholder="your-name"
            autocomplete="username"
            maxlength={64}
            value={displayName()}
            error={nameError()}
            onInput={(event) => onNameInput(event.currentTarget.value)}
          />
          <div class="invite-actions">
            <a class="r-btn primary" href={guestNameError(displayName()) ? undefined : joinHref()} onClick={validateJoin} data-testid="invite-join">
              Join
            </a>
            <button
              type="button"
              class="r-btn ghost"
              disabled={copyBusy()}
              aria-busy={copyBusy()}
              onClick={() => void copyInvite()}
            >
              {copyButtonLabel()}
            </button>
          </div>
        </form>

        <p class="invite-alt">
          Already have an account?
          {' '}
          <a href={signInHref()}>Sign in</a>
        </p>
        <p class="invite-alt">
          <a href="/about/">How Onyx works</a>
        </p>

        <p
          class="invite-copy-status"
          role={copyState() === 'failed' ? 'alert' : 'status'}
          aria-live={copyState() === 'failed' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {copyState() === 'copied'
            ? 'Invite link copied to clipboard.'
            : copyState() === 'failed'
              ? 'Copy failed. You can still join below.'
              : ''}
        </p>
        </div>
      </section>
      </div>
    </PublicFrame>
  );
}
