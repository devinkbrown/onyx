// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { buildInviteCard, inviteDescription, inviteTitle } from '@/lib/invite/inviteCard';
import { setPageMeta } from './pageMeta';
import { PublicFooter } from './PublicFooter';

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
    <main class="r data-page invite-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 130 C 250 40, 460 290, 750 210 S 1170 130, 1500 260" />
        <path class="flow" d="M-40 570 C 330 650, 600 430, 900 540 S 1240 670, 1520 560" />
        <path d="M-40 790 C 380 710, 720 880, 1060 770 S 1340 710, 1540 830" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <Mascot variant="mark" />ONYX
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="/">Home</a>
          <a class="hideable" href="/stats/">Stats</a>
          <a class="hideable" href="/status/">Status</a>
          <a class="hideable" href="/roadmap/">Roadmap</a>
          <a class="hideable" href="/about/">About</a>
          <a class="hideable" href="/invite/?join=%23root" aria-current="page">Invite</a>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero" aria-labelledby="invite-heading">
        <p class="r-kicker">invite</p>
        <h1 id="invite-heading">
          <Show when={card().channel} fallback={<>Join<br /><span class="gold">{NETWORK_NAME}</span></>}>
            {(channel) => <>Join<br /><span class="gold">{channel()}</span></>}
          </Show>
        </h1>
        <p class="sub">{description()}</p>
        <div class="r-cta">
          <a class="r-btn primary" href={appHref()}>Open invite in Onyx</a>
          <button
            type="button"
            class="r-btn ghost"
            disabled={copyBusy()}
            aria-busy={copyBusy()}
            onClick={() => void copyInvite()}
          >
            {copyButtonLabel()}
          </button>
          <a class="r-btn ghost" href="/guides/">Read the quick guides</a>
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
              <div><strong>Room</strong><span>{card().channel ?? 'Choose a room from Home'}</span></div>
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
      <PublicFooter />
    </main>
  );
}
