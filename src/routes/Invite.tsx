// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './invite.css';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { buildInviteCard, inviteDescription, inviteTitle } from '@/lib/invite/inviteCard';
import { statsRoomHref } from '@/lib/stats/channelDetail';
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

function appHrefFromInvite(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.search ? `/app/${parsed.search}` : '/app/';
  } catch {
    return '/app/';
  }
}

function formatMoment(at: Date): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(at);
}

function isPublicStatsChannel(channel: string | null): channel is string {
  return channel !== null && /^[#&]/.test(channel.trim());
}

export default function InviteRoute() {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  const [copyBusy, setCopyBusy] = createSignal(false);
  let copyEpoch = 0;
  let disposed = false;
  const card = createMemo(() => buildInviteCard(currentParams(), {
    network: NETWORK_NAME,
    origin: currentOrigin(),
  }));
  const title = createMemo(() => inviteTitle(card()));
  const description = createMemo(() => inviteDescription(card()));
  const appHref = createMemo(() => appHrefFromInvite(card().url));

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
    if (copyBusy()) return 'Copying invite…';
    if (copyState() === 'copied') return 'Copied invite';
    return 'Copy invite link';
  }

  return (
    <PublicFrame
      currentPath="/invite/"
      mainLabel="Onyx invite"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Threshold</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Invite</span>
        </p>
      )}
    >
      <div class="ui-root r data-page invite-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 130 C 250 40, 460 290, 750 210 S 1170 130, 1500 260" />
        <path class="flow" d="M-40 570 C 330 650, 600 430, 900 540 S 1240 670, 1520 560" />
        <path d="M-40 790 C 380 710, 720 880, 1060 770 S 1340 710, 1540 830" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      <section class="r-wrap data-hero" aria-labelledby="invite-heading">
        <p class="r-kicker">invite</p>
        <h1 id="invite-heading">
          <Show when={card().channel} fallback={<>Join<br /><span class="invite-title-accent">{NETWORK_NAME}</span></>}>
            {(channel) => (
              <>
                Join<br />
                <Show
                  when={isPublicStatsChannel(channel())}
                  fallback={<span class="invite-title-accent">{channel()}</span>}
                >
                  <a
                    class="invite-title-accent invite-title-ledger"
                    href={statsRoomHref(channel())}
                    aria-label={`Channel ledger for ${channel()}`}
                    data-testid="invite-hero-ledger"
                  >
                    {channel()}
                  </a>
                </Show>
              </>
            )}
          </Show>
        </h1>
        <p class="sub">{description()}</p>
        <dl class="invite-safety-receipt" aria-label="Invite handoff receipt">
          <div>
            <dt>Source</dt>
            <dd>This invite URL</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{card().channel ?? 'Onyx room directory'}</dd>
          </div>
          <div>
            <dt>Handoff</dt>
            <dd>Only supported fields move into Onyx when you choose Open invite.</dd>
          </div>
        </dl>
        <div class="r-cta">
          <a class="r-btn primary" href={appHref()}>Open invite in Onyx</a>
          <Show when={isPublicStatsChannel(card().channel) ? card().channel : undefined}>
            {(channel) => (
              <a
                class="r-btn ghost"
                href={statsRoomHref(channel())}
                aria-label={`Channel ledger for ${channel()}`}
                data-testid="invite-cta-ledger"
              >
                Channel ledger
              </a>
            )}
          </Show>
          <button
            type="button"
            class="r-btn ghost"
            disabled={copyBusy()}
            aria-busy={copyBusy()}
            onClick={() => void copyInvite()}
          >
            {copyButtonLabel()}
          </button>
          <a class="r-btn ghost" href="/about/">How Onyx works</a>
        </div>
        <Show when={copyState() === 'copied'}>
          <p class="invite-copy-status" role="status">Invite link copied to clipboard.</p>
        </Show>
        <Show when={copyState() === 'failed'}>
          <p class="invite-copy-status" role="alert">Copy failed. The canonical invite is listed below.</p>
        </Show>
      </section>

      <section class="r-wrap r-section data-grid" aria-label="Invite details">
        <article class="data-card">
          <span class="label">entry</span>
          <h2>Walk in as a guest, claim a name when ready</h2>
          <p>
            Invite links preserve the room, optional moment, and suggested guest
            name. Onyx opens the same native guest, sign-in, and register flows,
            then joins the room after the connection is established.
          </p>
          <div class="data-list data-list--compact invite-facts">
            <div class="data-row">
              <div><strong>Network</strong><span>{card().network}</span></div>
            </div>
            <div class="data-row">
              <div>
                <strong>Room</strong>
                <Show
                  when={isPublicStatsChannel(card().channel) ? card().channel : undefined}
                  fallback={<span>{card().channel ?? 'Choose a room from Home'}</span>}
                >
                  {(channel) => (
                    <span class="invite-room-detail">
                      <span>{channel()}</span>
                      <a
                        class="invite-room-ledger"
                        href={statsRoomHref(channel())}
                        aria-label={`Channel ledger for ${channel()}`}
                        data-testid="invite-room-ledger"
                      >
                        Channel ledger
                      </a>
                    </span>
                  )}
                </Show>
              </div>
            </div>
            <Show when={card().at}>
              {(at) => (
                <div class="data-row">
                  <div><strong>Moment</strong><span>{formatMoment(at())} UTC</span></div>
                </div>
              )}
            </Show>
            <Show when={card().topic}>
              {(topic) => (
                <div class="data-row">
                  <div><strong>Named conversation</strong><span>{topic()}</span></div>
                </div>
              )}
            </Show>
            <Show when={card().readerMode}>
              <div class="data-row">
                <div><strong>Reading projection</strong><span>Reader mode opens before the room joins.</span></div>
              </div>
            </Show>
            <Show when={card().guestName}>
              {(guestName) => (
                <div class="data-row">
                  <div><strong>Suggested name</strong><span>{guestName()}</span></div>
                </div>
              )}
            </Show>
          </div>
        </article>
        <aside class="data-card">
          <span class="label">link preview</span>
          <h3>{title()}</h3>
          <p>{description()}</p>
          <div class="data-list data-list--compact">
            <div class="data-row"><div><strong>Open Graph title</strong><span>{title()}</span></div></div>
            <div class="data-row"><div><strong>Canonical invite</strong><span>{card().url}</span></div></div>
            <div class="data-row"><div><strong>App handoff</strong><span>{appHref()}</span></div></div>
          </div>
        </aside>
      </section>
      <section class="r-wrap r-section invite-runway" aria-labelledby="invite-runway-heading">
        <span class="r-eyebrow">first run</span>
        <h2 class="r-title" id="invite-runway-heading">What Onyx keeps from this link</h2>
        <div class="invite-runway__grid" role="list">
          <div role="listitem"><strong>Room</strong><span>{card().channel ?? 'Home directory'}</span></div>
          <div role="listitem"><strong>Moment</strong><span>{card().at ? formatMoment(card().at!) : 'Latest activity'}</span></div>
          <div role="listitem"><strong>Topic</strong><span>{card().topic ?? 'Whole room'}</span></div>
          <div role="listitem"><strong>Projection</strong><span>{card().readerMode ? 'Reader mode' : 'Standard mode'}</span></div>
          <div role="listitem"><strong>Identity</strong><span>{card().guestName ?? 'Choose guest or account'}</span></div>
          <div role="listitem"><strong>After claim</strong><span>Same room path, saved identity, local memory.</span></div>
        </div>
      </section>
      </div>
    </PublicFrame>
  );
}
