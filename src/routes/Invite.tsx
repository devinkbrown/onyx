// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './invite.css';
import { createEffect, createMemo, createResource, createSignal, Index, onCleanup, Show } from 'solid-js';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildInviteCard,
  guestNameError,
  inviteDescription,
  inviteHeadline,
  inviteTitle,
  inviteWelcome,
  mergeInviteFaces,
  parseGuestName,
} from '@/lib/invite/inviteCard';
import { buildInviteLink } from '@/lib/invite/inviteLink';
import { loadInviteRoomPulse } from '@/lib/invite/inviteRoomPulse';
import { Avatar, FormField } from '@/primitives/index';
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
  const [pulse] = createResource(
    () => card().channel,
    (channel) => loadInviteRoomPulse(channel),
  );
  const purpose = createMemo(() => card().topic ?? pulse()?.topic ?? null);
  const faces = createMemo(() => mergeInviteFaces(card().faces, pulse()?.faces));
  const lastPulse = createMemo(() => pulse()?.lastPulse ?? null);

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
        inviter: card().inviter,
        faces: card().faces,
      },
      { network: NETWORK_NAME, origin: currentOrigin(), appOrigin: '/app/' },
    ).appHref;
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

  return (
    <PublicFrame
      currentPath="/invite/"
      mainLabel="Onyx invite"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Room</span>
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

      <section class="invite-card" aria-labelledby="invite-heading">
        <p class="invite-eyebrow">{card().channel ? 'Room' : 'Onyx'}</p>
        <h1 id="invite-heading">{headline()}</h1>
        <Show when={purpose()}>
          {(topic) => <p class="invite-purpose">{topic()}</p>}
        </Show>
        <p class="invite-lede">{welcome()}</p>

        <Show when={card().inviter || faces().length > 0 || lastPulse()}>
          <dl class="invite-facts">
            <Show when={card().inviter}>
              {(inviter) => (
                <div data-testid="invite-inviter">
                  <dt>Invited by</dt>
                  <dd>{inviter()}</dd>
                </div>
              )}
            </Show>
            <Show when={faces().length > 0}>
              <div data-testid="invite-faces">
                <dt>Already in</dt>
                <dd>
                  <ul class="invite-faces">
                    <Index each={faces()}>
                      {(nick) => (
                        <li class="invite-face">
                          <Avatar name={nick()} size="sm" />
                          <span>{nick()}</span>
                        </li>
                      )}
                    </Index>
                  </ul>
                </dd>
              </div>
            </Show>
            <Show when={lastPulse()}>
              {(label) => (
                <div data-testid="invite-pulse">
                  <dt>Last pulse</dt>
                  <dd>{label()}</dd>
                </div>
              )}
            </Show>
          </dl>
        </Show>

        <form
          class="invite-join"
          onSubmit={(event) => {
            event.preventDefault();
            const error = guestNameError(displayName());
            if (error) {
              setNameError(error);
              return;
            }
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
            <a class="r-btn primary" href={joinHref()} data-testid="invite-join">
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
          <a href={joinHref()}>Sign in</a>
        </p>
        <p class="invite-alt">
          <a href="/about/">How Onyx works</a>
        </p>

        <Show when={copyState() === 'copied'}>
          <p class="invite-copy-status" role="status">Invite link copied to clipboard.</p>
        </Show>
        <Show when={copyState() === 'failed'}>
          <p class="invite-copy-status" role="alert">Copy failed. You can still join below.</p>
        </Show>
      </section>
      </div>
    </PublicFrame>
  );
}
