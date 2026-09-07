// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './public-info.css';
import { For, Show, createEffect, createMemo } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import NotFoundPage from './NotFound';

export type TrustPageId = 'privacy' | 'guidelines' | 'contact';

const TRUST_PATHS = {
  '/privacy': 'privacy',
  '/privacy/': 'privacy',
  '/guidelines': 'guidelines',
  '/guidelines/': 'guidelines',
  '/contact': 'contact',
  '/contact/': 'contact',
} as const satisfies Readonly<Record<string, TrustPageId>>;

export const HOUSE_RULES = [
  'Be kind. Argue about ideas, not people.',
  'Welcome people who just arrived.',
  'Do not harass, threaten, or stalk anyone.',
  'Do not share someone else’s private information.',
  'Do not spam rooms or DMs.',
  'A room can be stricter than this list.',
  'If a room is not for you, leave.',
  'Do not impersonate people or this project.',
  'Keep illegal content out of the rooms.',
  'Onyx is not 911. If someone is in danger, contact local emergency services.',
  'Report harm in the room, or open a GitHub issue that does not include exploit details.',
  'We can disable accounts or rooms that break these rules.',
] as const;

export const TRUST_PAGE_META = {
  privacy: {
    title: 'Onyx privacy — what stays here',
    description: 'Short facts about what the server stores, history on this device, and that this site does not sell ads.',
    heading: 'What we actually keep',
    kicker: 'Privacy',
    mainLabel: 'Onyx privacy',
    lede: 'Facts only. Not a terms of service.',
  },
  guidelines: {
    title: 'Onyx house rules',
    description: 'How we treat each other in the rooms, how to report harm, and that Onyx is not 911.',
    heading: 'House rules',
    kicker: 'Guidelines',
    mainLabel: 'Onyx house rules',
    lede: 'A short list. Rooms can be stricter.',
  },
  contact: {
    title: 'Onyx contact',
    description: 'How to reach the project for ordinary questions and security reports. No invented mailbox.',
    heading: 'Contact',
    kicker: 'Contact',
    mainLabel: 'Onyx contact',
    lede: 'GitHub is the public door. There is no report email in this repository.',
  },
} as const;

export function resolveTrustPage(path: string): TrustPageId {
  const page = TRUST_PATHS[path as keyof typeof TRUST_PATHS];
  if (!page) throw new Error('Onyx: Trust page route was not allowlisted');
  return page;
}

export function TrustPage(props: { page: TrustPageId }) {
  const meta = createMemo(() => TRUST_PAGE_META[props.page]);

  createEffect(() => {
    const item = meta();
    setPageMeta(item.title, item.description, `/${props.page}/`);
  });

  return (
    <PublicFrame
      currentPath={`/${props.page}/`}
      mainLabel={meta().mainLabel}
    >
      <div class={`ui-root r data-page public-info-page trust-page trust-page--${props.page}`}>
        <div class="r-ground" aria-hidden="true" />
        <section class="r-wrap data-hero">
          <p class="r-kicker">{meta().kicker}</p>
          <h1>{meta().heading}</h1>
          <p class="sub">{meta().lede}</p>
        </section>
        <section class="r-wrap r-section">
          <Show when={props.page === 'guidelines'}>
            <article class="data-card public-info-card">
              <div class="label">Rooms</div>
              <ol class="trust-rules">
                <For each={HOUSE_RULES}>
                  {(rule) => <li>{rule}</li>}
                </For>
              </ol>
              <p>
                Report a security issue through GitHub’s private vulnerability
                reporting on this repository, as <a href="https://github.com/devinkbrown/onyx/blob/onyx-solid/SECURITY.md">SECURITY.md</a> describes.
                There is no public report mailbox in this source tree.
              </p>
            </article>
          </Show>
          <Show when={props.page === 'privacy'}>
            <article class="data-card public-info-card">
              <div class="label">This device and the server</div>
              <p>
                If you register, the server stores the account name and the email
                you give it. Room messages stay with the room so it can stay open.
                Group rooms are not end-to-end encrypted. Group E2EE is not live.
              </p>
              <p>
                Private DMs are sealed on this device. If a DM cannot open, it
                stays locked. This page does not claim every class of message is
                unreadable to the operator.
              </p>
              <p>
                DM encryption covers encrypted message text and its wire payload.
                Plaintext local drafts and attachments are separate device data and
                are not covered by that message-encryption claim.
              </p>
              <p>
                This browser keeps about 400 recent messages per room on this
                device. Older lines are pruned here.
              </p>
              <p>
                Passkeys exist only when the server turns them on. They are not
                the everyday anonymous door.
              </p>
              <p>
                This site loads no ads, does not sell your attention, and does
                not load third-party analytics pixels.
              </p>
              <p>
                Questions: <a href="/contact/">Contact</a>.
              </p>
            </article>
          </Show>
          <Show when={props.page === 'contact'}>
            <article class="data-card public-info-card">
              <div class="label">How to reach us</div>
              <p>
                Ordinary product questions belong on GitHub issues for
                {' '}
                <a href="https://github.com/devinkbrown/onyx" rel="noreferrer noopener" target="_blank">devinkbrown/onyx</a>.
              </p>
              <p>
                Security reports follow
                {' '}
                <a href="https://github.com/devinkbrown/onyx/blob/onyx-solid/SECURITY.md">SECURITY.md</a>:
                use private vulnerability reporting when it is available, or open
                a minimal public issue that says a private contact is needed —
                without exploit details, payloads, or user data.
              </p>
              {/* TODO: RFC 9116 /.well-known/security.txt with Contact mailto + Expires
                  once a real mailbox exists in this repository. Do not invent an email. */}
              <p>
                There is no contact email checked into this repository, so this
                page does not publish one.
              </p>
            </article>
          </Show>
        </section>
      </div>
    </PublicFrame>
  );
}

export default function TrustPagesRoute() {
  const location = useLocation();
  const page = () => TRUST_PATHS[location.pathname as keyof typeof TRUST_PATHS];
  return (
    <Show when={page()} fallback={<NotFoundPage />}>
      {(current) => <TrustPage page={current()} />}
    </Show>
  );
}
