// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './public-info.css';
import './guides.css';
import { createEffect, createMemo, For, Show } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import NotFoundPage from './NotFound';

export type GuidesSurface = 'guides' | 'community';

const GUIDES_PATHS = {
  '/guides': 'guides',
  '/guides/': 'guides',
  '/community': 'community',
  '/community/': 'community',
} as const satisfies Readonly<Record<string, GuidesSurface>>;

export function resolveGuidesSurface(path: string): GuidesSurface {
  const surface = GUIDES_PATHS[path as keyof typeof GUIDES_PATHS];
  if (!surface) throw new Error('Onyx: Guides route was not allowlisted');
  return surface;
}

export const GUIDE_PAGE_META = {
  guides: {
    title: 'Onyx guides — join a room in the official app',
    description: 'Short how-tos for joining a room, inviting a friend, private messages, calls, and keeping Onyx on this device.',
    kicker: 'Guides',
    mainLabel: 'Onyx guides',
    contextLabel: 'Getting started',
  },
  community: {
    title: 'Onyx community — how to join and be here',
    description: 'How to join a room in Onyx, invite a friend, and treat each other well. The official app is the usual way in.',
    kicker: 'Community',
    mainLabel: 'Onyx community',
    contextLabel: 'Getting started',
  },
} as const satisfies Record<GuidesSurface, {
  title: string;
  description: string;
  kicker: string;
  mainLabel: string;
  contextLabel: string;
}>;

export const GUIDE_HOWTOS = [
  {
    id: 'join',
    title: 'Join a room',
    optional: false,
    body: [
      'Open Onyx in your browser. Pick a name — guests are welcome, and an account is optional.',
      'Browse rooms, or open a room someone invited you to. Say hello.',
    ],
    links: [
      { href: '/app/', label: 'Join a room' },
      { href: '/app/?join=%23root', label: 'Open the public room' },
    ],
  },
  {
    id: 'invite',
    title: 'Invite a friend',
    optional: false,
    body: [
      'Send them to Onyx, or share an invite if you have one. They can join as a guest and pick a name.',
      'Tell them the room you are in. Friends, clubs, and class groups all start the same way: one person opens the door.',
    ],
    links: [
      { href: '/invite/', label: 'Open an invite' },
    ],
  },
  {
    id: 'messages',
    title: 'Messages and private DMs',
    optional: false,
    body: [
      'Rooms are shared conversations. Everyone in the room can read them.',
      'Direct messages are one-to-one. Those can be private: Onyx seals them on your device so the rest of the room does not see the words. If a private message cannot open, it stays locked instead of turning into plain text.',
      'Group rooms are not end-to-end encrypted. Passkeys are not the everyday way to sign in.',
    ],
    links: [],
  },
  {
    id: 'calls',
    title: 'Calls when you want them',
    optional: false,
    body: [
      'In a room, start a call when you want one — voice, video, or your screen. Joining is a choice; a call does not pull you in.',
      'Calls are not recorded. You can see whether the call is protected while you are in it.',
    ],
    links: [],
  },
  {
    id: 'this-device',
    title: 'Keep it on this device',
    optional: false,
    body: [
      'Add Onyx to your Home Screen so it sits with your other apps. On a phone, use the browser menu or Share, then Add to Home Screen. On a computer, use the browser menu and Install app when your browser offers it.',
      'Your history and sign-in stay on this device. Coming back in the same browser usually picks up where you left off.',
    ],
    links: [
      { href: '/download/', label: 'Other ways to keep Onyx' },
    ],
  },
  {
    id: 'another-client',
    title: 'Another client, or your own server',
    optional: true,
    body: [
      'The official Onyx app in the browser is the usual way in.',
      'WeeChat, irssi, and similar clients can sit in the same rooms. That path is last, optional, and not how most people join.',
      'Running your own copy of the engine is for people who want to operate a server.',
    ],
    links: [
      { href: 'https://github.com/devinkbrown/onyx-server', label: 'Onyx Server on GitHub' },
      { href: '/about/', label: 'How Onyx is put together' },
    ],
  },
] as const;

export function Guides(props: { surface: GuidesSurface }) {
  const meta = createMemo(() => GUIDE_PAGE_META[props.surface]);

  createEffect(() => {
    const item = meta();
    setPageMeta(item.title, item.description, `/${props.surface}/`);
  });

  return (
    <PublicFrame
      currentPath={`/${props.surface}/`}
      mainLabel={meta().mainLabel}
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">{meta().kicker}</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">{meta().contextLabel}</span>
        </p>
      )}
    >
      <div class={`ui-root r data-page public-info-page guides-page guides-page--${props.surface}`}>
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <section class="r-wrap data-hero">
          <p class="r-kicker">{meta().kicker}</p>
          <h1>Getting started</h1>
          <p class="sub">
            Friends, clubs, rooms. Open Onyx in your browser, join a room, and talk.
            These short how-tos are for the official app — not another chat program.
          </p>
          <p class="guides-hero-actions">
            <a class="guides-action" href="/app/">Join a room</a>
          </p>
        </section>
        <section class="r-wrap r-section guides-body">
          <article class="data-card public-info-card guides-card" id="together">
            <div class="label">How we treat each other</div>
            <h2>Be kind, then talk</h2>
            <p>
              Welcome people. Argue about ideas, not people. Do not harass anyone,
              do not share someone else&apos;s private information, and do not spam.
              A room can be stricter than that. If a room is not for you, leave.
            </p>
          </article>
          <For each={GUIDE_HOWTOS}>
            {(howto) => (
              <article
                class="data-card public-info-card guides-card"
                classList={{ 'guides-card--optional': howto.optional }}
                id={howto.id}
              >
                <div class="label">{howto.optional ? 'Optional' : 'How-to'}</div>
                <h2>{howto.title}</h2>
                <For each={howto.body}>
                  {(paragraph) => <p>{paragraph}</p>}
                </For>
                <Show when={howto.links.length > 0}>
                  <p class="guides-card-actions">
                    <For each={howto.links}>
                      {(link) => (
                        <a
                          class="guides-action"
                          href={link.href}
                          rel={link.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                        >
                          {link.label}
                        </a>
                      )}
                    </For>
                  </p>
                </Show>
              </article>
            )}
          </For>
        </section>
      </div>
    </PublicFrame>
  );
}

/** Route-facing resolver; the named component remains useful for focused rendering tests. */
export default function GuidesRoute() {
  const location = useLocation();
  const surface = () => GUIDES_PATHS[location.pathname as keyof typeof GUIDES_PATHS];
  return (
    <Show when={surface()} fallback={<NotFoundPage />}>
      {(current) => <Guides surface={current()} />}
    </Show>
  );
}
